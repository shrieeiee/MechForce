import { computeReach, canEndAt, pathFrom, reachKey, toHit, availableMechs, operational, canAct, activeSide, missionOf,
  walkMP, runMP, jumpMP, dissipation, expectedDamage, totalArmor, maxArmor, secondsElapsed, attackDirection } from '../core/rules.js';
import { WEAPONS, MISSIONS, CLASS_NAMES, TERRAIN, critName } from '../core/data.js';
import { neighbor, distance, facingToward, relBearing } from '../core/hex.js';
import { $, $$, html, esc, promptBar, toast, banner, paperDoll, FocusNav, glyphHTML, floatText } from './ui.js';
import { input } from './input.js';
import { sfx, music } from './audio.js';

const MODE_COLOR = { walk: '#5fd3ff', run: '#ffb23e', jump: '#b98cff' };
const MODE_LABEL = { walk: 'Walk', run: 'Run', jump: 'Jump' };

export class Battle {
  constructor(app) {
    this.app = app;
    this.r = app.renderer;
    this.state = null;
    this.ix = { mode: 'wait' };
    this.cursor = { x: 0, y: 0 };
    this.feed = [];
    this.wnav = new FocusNav();
    this.lastLocalSide = null;
    this.moveRepeat = 0;
    this.root = html('<div id="battle"></div>');
    this.r.onFloat = (text, pos, cls) => { const s = this.r.project(pos); if (!s.behind) floatText(text, s.x, s.y, cls); };
  }

  get session() { return this.app.session; }
  get myId() { return this.session.myId; }
  mySides() { return this.state ? this.state.sides.map((s, i) => (s.ctrl === this.myId ? i : -1)).filter((i) => i >= 0) : []; }
  isMine(side) { return this.state && this.state.sides[side] && this.state.sides[side].ctrl === this.myId; }

  // ------------------------------------------------------------ lifecycle
  start(state) {
    this.state = state;
    this.feed = [];
    this.r.buildMap(state.map);
    this.r.syncMechs(state);
    this.setExitEdges();
    const mine = this.mySides();
    const focusSide = mine.length ? mine[0] : 0;
    const m = state.mechs.find((x) => x.side === focusSide) || state.mechs[0];
    this.cursor = { x: m.x, y: m.y };
    this.r.focusHex(m.x, m.y, true);
    this.r.cam.yaw = focusSide === 1 ? Math.PI / 2 : focusSide === 0 ? -Math.PI / 2 : focusSide === 2 ? Math.PI : 0;
    this.app.ui.replaceChildren(this.root);
    this.ix = { mode: 'briefing' };
    this.lastLocalSide = null;
    music('battle');
    this.render();
  }
  stop() { this.r.clearOverlays(); this.r.setCursor(null); this.ix = { mode: 'wait' }; }

  setExitEdges() {
    const st = this.state, mis = missionOf(st), w = st.map.w;
    const edges = [];
    const col = (s) => st.sides[s].color;
    if (mis.id === 'crossing') edges.push({ x: w - 1, color: col(0) });
    if (mis.homeExit) { edges.push({ x: 0, color: col(0) }); if (mis.carriers.includes(1)) edges.push({ x: w - 1, color: col(1) }); }
    if (mis.id === 'pepsi') edges.push({ x: w - 1, color: col(0) }, { x: 0, color: col(1) });
    if (mis.spy) edges.push({ x: w - 1, color: col(1) });
    if (mis.scout) edges.push({ x: 0, color: col(0) });
    this.r.setExitEdges(edges);
  }

  onUpdate(msg) {
    const prevSide = this.state ? activeSide(this.state) : -1;
    this.state = msg.state;
    const briefing = this.ix.mode === 'briefing';
    if (!briefing) { this.ix = { mode: 'anim' }; this.r.clearOverlays(); }
    this.render();
    this.r.play(msg.events, msg.state, (e) => this.onEvent(e)).then(() => {
      if (this.state !== msg.state) return; // newer update queued
      if (this.ix.mode === 'briefing') { this.render(); return; }
      this.refresh(prevSide);
    });
  }

  onEvent(e) {
    const st = this.state;
    if (e.k === 'log') this.pushFeed(e.text, e.tone, e.side);
    if (e.k === 'round') { banner(`Round ${e.n}`, `T+${(e.n - 1) * 50} seconds`); }
    if (e.k === 'turn' && st && !st.over) {
      const s = st.sides[e.side];
      if (this.isMine(e.side)) sfx('turn');
      void s;
    }
    if (e.k === 'win') {
      const me = this.mySides();
      if (e.side >= 0 && me.includes(e.side)) sfx('win'); else if (me.length) sfx('lose');
    }
  }

  pushFeed(text, tone, side) {
    this.feed.push({ text, tone, side, at: performance.now() });
    if (this.feed.length > 7) this.feed.shift();
    this.renderFeed();
  }

  refresh(prevSide) {
    const st = this.state;
    if (!st) return;
    if (st.over) { this.ix = { mode: 'over' }; this.r.clearOverlays(); this.render(); this.app.showResults(st); return; }
    const side = activeSide(st);
    if (this.isMine(side)) {
      const localHumans = this.mySides();
      if (localHumans.length > 1 && this.lastLocalSide !== null && this.lastLocalSide !== side) {
        this.ix = { mode: 'pass', side };
        this.lastLocalSide = side;
        this.render();
        return;
      }
      this.lastLocalSide = side;
      this.beginMyTurn();
    } else {
      this.ix = { mode: 'wait' };
      this.r.clearOverlays();
      if (st.act) { this.r.setActive(st.act.id); }
      this.render();
    }
    void prevSide;
  }

  beginMyTurn(preferId) {
    const st = this.state;
    const side = activeSide(st);
    if (st.act) {
      const m = st.mechs[st.act.id];
      if (st.act.phase === 'move') return this.enterMove(m.id);
      return this.enterAttack(m.id);
    }
    const av = availableMechs(st, side);
    if (!av.length) return;
    const pick = av.find((m) => m.id === preferId) || av.find((m) => m.id === this.lastPicked) || av[0];
    this.enterMove(pick.id);
  }

  // ------------------------------------------------------------ modes
  enterMove(id) {
    const st = this.state;
    const m = st.mechs[id];
    this.lastPicked = id;
    const reach = { walk: computeReach(st, m, 'walk'), run: computeReach(st, m, 'run'), jump: jumpMP(m) > 0 ? computeReach(st, m, 'jump') : null };
    const prevMode = this.ix.mechId === id ? this.ix.moveMode : 'walk';
    this.ix = { mode: 'move', mechId: id, reach, moveMode: prevMode && reach[prevMode] ? prevMode : 'walk' };
    this.cursor = { x: m.x, y: m.y };
    this.r.setActive(id);
    this.r.focusMech(id);
    this.updateMoveOverlay();
    this.render();
  }

  bestFacingAt(reach, x, y, m) {
    let best = -1, bc = Infinity;
    const enemies = this.state.mechs.filter((e) => operational(e) && e.side !== m.side);
    let near = null, nd = 99;
    for (const e of enemies) { const d = distance(x, y, e.x, e.y); if (d < nd) { nd = d; near = e; } }
    const want = near ? facingToward(x, y, near.x, near.y) : m.f;
    const allowed = [];
    for (let f = 0; f < 6; f++) {
      const c = reach.cost[reachKey(reach, x, y, f)];
      if (isFinite(c)) { allowed.push(f); const score = c + Math.min(Math.abs(f - want), 6 - Math.abs(f - want)) * 0.01; if (score < bc) { bc = score; best = f; } }
    }
    if (allowed.includes(want)) best = want;
    return { best, allowed };
  }

  updateMoveOverlay() {
    const ix = this.ix, st = this.state;
    const m = st.mechs[ix.mechId];
    const reach = ix.reach[ix.moveMode];
    const cells = [];
    const { w, h } = st.map;
    if (reach) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let ok = false;
      for (let f = 0; f < 6; f++) if (isFinite(reach.cost[(y * w + x) * 6 + f])) { ok = true; break; }
      if (ok && canEndAt(st, m, x, y) && !(x === m.x && y === m.y)) cells.push({ x, y, color: MODE_COLOR[ix.moveMode] });
    }
    this.r.setReach(cells);
    this.updateCursorOverlay();
  }

  hexReachable(x, y) {
    const ix = this.ix, st = this.state, m = st.mechs[ix.mechId];
    const reach = ix.reach[ix.moveMode];
    if (!reach || !canEndAt(st, m, x, y)) return false;
    for (let f = 0; f < 6; f++) if (isFinite(reach.cost[reachKey(reach, x, y, f)])) return true;
    return false;
  }

  updateCursorOverlay() {
    const ix = this.ix, st = this.state;
    const { x, y } = this.cursor;
    if (ix.mode === 'move') {
      const m = st.mechs[ix.mechId];
      const reach = ix.reach[ix.moveMode];
      const ok = this.hexReachable(x, y);
      this.r.setCursor(x, y, ok ? MODE_COLOR[ix.moveMode] : '#ffd166');
      if (ok && !(x === m.x && y === m.y)) {
        const { best } = this.bestFacingAt(reach, x, y, m);
        const path = pathFrom(reach, x, y, best);
        this.r.setPath(ix.moveMode === 'jump' ? [path[0], path[path.length - 1]] : path, MODE_COLOR[ix.moveMode]);
      } else this.r.setPath(null);
      this.r.setFacing(null);
    } else if (ix.mode === 'facing') {
      this.r.setCursor(ix.dest.x, ix.dest.y, MODE_COLOR[ix.moveMode]);
      this.r.setFacing(ix.dest.x, ix.dest.y, ix.allowed, ix.facing);
      const reach = ix.reach[ix.moveMode];
      const path = pathFrom(reach, ix.dest.x, ix.dest.y, ix.facing);
      this.r.setPath(ix.moveMode === 'jump' ? [path[0], path[path.length - 1]] : path, MODE_COLOR[ix.moveMode]);
    } else {
      this.r.setCursor(x, y, '#ffd166');
    }
    const hov = st.mechs.find((mm) => operational(mm) && mm.x === x && mm.y === y);
    this.r.setHighlight(hov ? hov.id : null);
    this.hover = hov || null;
    this.renderCards();
  }

  enterFacing(x, y) {
    const ix = this.ix, m = this.state.mechs[ix.mechId];
    const reach = ix.reach[ix.moveMode];
    const isHome = x === m.x && y === m.y;
    const r = isHome ? ix.reach.walk : reach;
    const { best, allowed } = this.bestFacingAt(r, x, y, m);
    if (!allowed.length) return;
    this.ix = { ...ix, mode: 'facing', dest: { x, y }, allowed, facing: isHome ? m.f : best, moveMode: isHome ? 'walk' : ix.moveMode, homeMode: ix.moveMode };
    sfx('ui-ok');
    this.updateCursorOverlay();
    this.render();
  }

  confirmMove() {
    const ix = this.ix;
    const m = this.state.mechs[ix.mechId];
    const cmd = { type: 'move', id: m.id, x: ix.dest.x, y: ix.dest.y, f: ix.facing, mode: ix.moveMode };
    this.send(cmd);
    this.ix = { mode: 'sent' };
    this.r.clearOverlays();
    this.render();
  }

  enterAttack(id) {
    const st = this.state, m = st.mechs[id];
    const enemies = st.mechs.filter((e) => operational(e) && e.side !== m.side);
    const scored = enemies.map((e) => {
      let ed = 0;
      for (const w of m.weapons) { const th = toHit(st, m, e, w); if (th.ok) ed += expectedDamage(w, th.p); }
      const mth = toHit(st, m, e, null, { kind: 'kick' });
      return { e, ed, can: ed > 0 || mth.ok, d: distance(m.x, m.y, e.x, e.y) };
    }).sort((a, b) => (b.can - a.can) || (b.ed - a.ed) || (a.d - b.d));
    const prev = this.ix.targetId;
    const targets = scored.map((s) => s.e.id);
    const tgt = targets.includes(prev) && scored.find((s) => s.e.id === prev).can ? prev : targets[0];
    this.ix = { mode: 'attack', mechId: id, targets, targetId: tgt, sel: null, melee: null, noShots: !scored.some((x) => x.can) };
    this.r.setActive(id);
    this.r.setReach([]); this.r.setPath(null); this.r.setFacing(null);
    this.selectTarget(tgt, true);
  }

  selectTarget(tid, initial) {
    const ix = this.ix, st = this.state, m = st.mechs[ix.mechId];
    ix.targetId = tid;
    ix.melee = null;
    const t = st.mechs[tid];
    if (!t) { this.render(); return; }
    // default selection: every weapon that can fire, trimmed to a sane heat level
    const opts = m.weapons.map((w) => ({ w, th: toHit(st, m, t, w) })).filter((o) => o.th.ok && o.th.p > 0);
    const budget = dissipation(st, m) - m.heat - (st.act ? st.act.heatGen : 0) + 6;
    opts.sort((a, b) => expectedDamage(b.w, b.th.p) / Math.max(1, b.w.heat) - expectedDamage(a.w, a.th.p) / Math.max(1, a.w.heat));
    let heat = 0; const sel = new Set();
    for (const o of opts) { if (o.w.heat === 0 || heat + o.w.heat <= Math.max(budget, 0)) { sel.add(o.w.i); heat += o.w.heat; } }
    if (!sel.size && opts.length) sel.add(opts[0].w.i);
    ix.sel = sel;
    this.cursor = { x: t.x, y: t.y };
    this.r.setTargetLine(m.id, t.id, opts.length > 0);
    this.r.focusHex(Math.round((m.x + t.x) / 2), Math.round((m.y + t.y) / 2));
    this.updateCursorOverlay();
    if (!initial) sfx('ui-move');
    this.render();
  }

  fire() {
    const ix = this.ix, m = this.state.mechs[ix.mechId];
    if (ix.melee) { this.send({ type: 'melee', id: m.id, target: ix.targetId, kind: ix.melee }); }
    else {
      if (!ix.sel || !ix.sel.size) { toast('Select at least one weapon, or end the turn.'); return; }
      this.send({ type: 'attack', id: m.id, target: ix.targetId, weapons: [...ix.sel] });
    }
    this.ix = { mode: 'sent' };
    this.r.clearOverlays();
    this.render();
  }

  endTurn() {
    const id = this.ix.mechId;
    if (id === undefined) return;
    this.send({ type: 'end', id });
    this.ix = { mode: 'sent' };
    this.r.clearOverlays();
    this.render();
  }

  send(cmd) {
    const side = activeSide(this.state);
    this.session.send({ t: 'cmd', cmd, side });
  }

  onError(msg) {
    if (this.ix.mode === 'sent') { this.refresh(); }
    toast(msg);
  }

  // ------------------------------------------------------------ input
  stepCursor(dir) {
    const f = this.r.screenDirToHex(...dir);
    const n = neighbor(this.cursor.x, this.cursor.y, f);
    if (n.x < 0 || n.y < 0 || n.x >= this.state.map.w || n.y >= this.state.map.h) return;
    this.cursor = n;
    this.r.focusHex(n.x, n.y);
    sfx('ui-move');
    if (this.ix.mode === 'attack') {
      const t = this.state.mechs.find((e) => operational(e) && e.x === n.x && e.y === n.y && this.ix.targets.includes(e.id));
      if (t && t.id !== this.ix.targetId) { this.selectTarget(t.id); return; }
    }
    this.updateCursorOverlay();
  }

  tick(dt, now) {
    if (!this.state) return;
    const mode = this.ix.mode;
    if (['move', 'wait', 'attack'].includes(mode)) {
      const mx = input.move.x, my = input.move.y;
      if (Math.hypot(mx, my) > 0.5) {
        if (now >= this.moveRepeat) { this.stepCursor([mx, my]); this.moveRepeat = now + (this.moveHeld ? 110 : 260); this.moveHeld = true; }
      } else { this.moveHeld = false; this.moveRepeat = 0; }
    }
    // fade the feed
    if (this.feed.length && now - this.feed[0].at > 9000) { this.feed.shift(); this.renderFeed(); }
  }

  onAction(a) {
    const ix = this.ix;
    if (a === 'menu') { this.app.pause(); return true; }
    switch (ix.mode) {
      case 'briefing':
        if (a === 'confirm' || a === 'back') { sfx('ui-ok'); if (this.r.busy) { this.ix = { mode: 'anim' }; this.render(); } else this.refresh(); }
        return true;
      case 'pass':
        if (a === 'confirm') { sfx('ui-ok'); this.beginMyTurn(); }
        return true;
      case 'move': {
        const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        if (dirs[a]) { this.stepCursor(dirs[a]); return true; }
        if (a === 'confirm') {
          const m = this.state.mechs[ix.mechId];
          if (this.cursor.x === m.x && this.cursor.y === m.y) { this.enterFacing(m.x, m.y); return true; }
          if (this.hexReachable(this.cursor.x, this.cursor.y)) this.enterFacing(this.cursor.x, this.cursor.y);
          else {
            const other = this.state.mechs.find((mm) => mm.x === this.cursor.x && mm.y === this.cursor.y && availableMechs(this.state, activeSide(this.state)).includes(mm) && mm.id !== ix.mechId);
            if (other && !this.state.act) this.enterMove(other.id); else toast(`Out of ${MODE_LABEL[ix.moveMode].toLowerCase()} range`);
          }
          return true;
        }
        if (a === 'y') { this.cycleMoveMode(); return true; }
        if (a === 'lb' || a === 'rb') { this.cycleMech(a === 'rb' ? 1 : -1); return true; }
        if (a === 'x') { const m = this.state.mechs[ix.mechId]; this.cursor = { x: m.x, y: m.y }; this.enterFacing(m.x, m.y); return true; }
        if (a === 'view') { this.endTurn(); return true; }
        if (a === 'back') { const m = this.state.mechs[ix.mechId]; this.cursor = { x: m.x, y: m.y }; this.r.focusHex(m.x, m.y); this.updateCursorOverlay(); return true; }
        return false;
      }
      case 'facing': {
        if (a === 'left' || a === 'lb' || a === 'up') { this.rotateFacing(-1); return true; }
        if (a === 'right' || a === 'rb' || a === 'down') { this.rotateFacing(1); return true; }
        if (a === 'confirm') { this.confirmMove(); return true; }
        if (a === 'back') { sfx('ui-back'); this.ix = { ...ix, mode: 'move', moveMode: ix.homeMode || ix.moveMode }; this.updateMoveOverlay(); this.render(); return true; }
        return false;
      }
      case 'attack': {
        if (a === 'up' || a === 'down') { this.wnav.move(a); return true; }
        if (a === 'left' || a === 'lb') { this.cycleTarget(-1); return true; }
        if (a === 'right' || a === 'rb') { this.cycleTarget(1); return true; }
        if (ix.noShots && (a === 'confirm' || a === 'x')) { this.endTurn(); return true; }
        if (a === 'confirm') { this.wnav.activate(); return true; }
        if (a === 'x') { this.fire(); return true; }
        if (a === 'y') { this.cycleMelee(); return true; }
        if (a === 'view') { this.endTurn(); return true; }
        if (a === 'back') { const t = this.state.mechs[ix.targetId]; if (t) this.r.focusHex(t.x, t.y); return true; }
        return false;
      }
      case 'wait': {
        const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        if (dirs[a]) { this.stepCursor(dirs[a]); return true; }
        return false;
      }
      default: return false;
    }
  }

  rotateFacing(d) {
    const ix = this.ix;
    const order = ix.allowed.slice().sort((a, b) => a - b);
    let i = order.indexOf(ix.facing);
    // DIR order is counter-clockwise on screen; flip so right = clockwise
    i = (i - d + order.length) % order.length;
    ix.facing = order[i];
    sfx('servo');
    this.updateCursorOverlay();
    this.render();
  }

  cycleMoveMode() {
    const ix = this.ix;
    const modes = ['walk', 'run', 'jump'].filter((k) => ix.reach[k] && ix.reach[k].mp > 0);
    if (!modes.length) return;
    const i = modes.indexOf(ix.moveMode);
    ix.moveMode = modes[(i + 1) % modes.length];
    sfx('ui-move');
    this.updateMoveOverlay();
    this.render();
  }

  cycleMech(d) {
    const st = this.state;
    if (st.act && (st.act.phase !== 'move')) return;
    const av = availableMechs(st, activeSide(st));
    if (av.length < 2) return;
    const i = av.findIndex((m) => m.id === this.ix.mechId);
    const next = av[(i + d + av.length) % av.length];
    if (st.act && st.act.id !== next.id) { this.send({ type: 'select', id: next.id }); }
    this.enterMove(next.id);
    sfx('ui-move');
  }

  cycleTarget(d) {
    const ix = this.ix;
    if (!ix.targets.length) return;
    const i = ix.targets.indexOf(ix.targetId);
    this.selectTarget(ix.targets[(i + d + ix.targets.length) % ix.targets.length]);
  }

  cycleMelee() {
    const ix = this.ix, st = this.state, m = st.mechs[ix.mechId], t = st.mechs[ix.targetId];
    const opts = [null, ...['punch', 'kick'].filter((k) => toHit(st, m, t, null, { kind: k }).ok)];
    if (opts.length < 2) { toast('Melee needs an adjacent target in your front arc.'); return; }
    const i = opts.indexOf(ix.melee);
    ix.melee = opts[(i + 1) % opts.length];
    sfx('ui-move');
    this.render();
  }

  // pointer
  pointer(e, kind) {
    if (!this.state) return;
    const mode = this.ix.mode;
    const hit = this.r.pick(e.clientX, e.clientY);
    if (kind === 'move') {
      if (!hit || !['move', 'wait', 'attack', 'facing'].includes(mode)) return;
      if (mode === 'facing') {
        const d = this.ix.dest;
        if (hit.x === d.x && hit.y === d.y) return;
        const f = facingToward(d.x, d.y, hit.x, hit.y);
        if (this.ix.allowed.includes(f) && f !== this.ix.facing) { this.ix.facing = f; this.updateCursorOverlay(); this.render(); }
        return;
      }
      if (hit.x === this.cursor.x && hit.y === this.cursor.y) return;
      this.cursor = { x: hit.x, y: hit.y };
      this.updateCursorOverlay();
      return;
    }
    if (kind === 'click') {
      if (!hit) return;
      const touch = e.pointerType === 'touch';
      if (mode === 'move') {
        if (touch && (hit.x !== this.cursor.x || hit.y !== this.cursor.y)) { this.cursor = { x: hit.x, y: hit.y }; this.updateCursorOverlay(); return; }
        this.cursor = { x: hit.x, y: hit.y };
        this.onAction('confirm');
      } else if (mode === 'facing') {
        const d = this.ix.dest;
        if (hit.x === d.x && hit.y === d.y) { this.confirmMove(); return; }
        const f = facingToward(d.x, d.y, hit.x, hit.y);
        if (this.ix.allowed.includes(f)) { if (touch && f !== this.ix.facing) { this.ix.facing = f; this.updateCursorOverlay(); this.render(); return; } this.ix.facing = f; this.confirmMove(); }
      } else if (mode === 'attack') {
        const t = this.state.mechs.find((mm) => operational(mm) && mm.x === hit.x && mm.y === hit.y);
        if (t && this.ix.targets.includes(t.id)) this.selectTarget(t.id);
      } else if (mode === 'wait') { this.cursor = { x: hit.x, y: hit.y }; this.updateCursorOverlay(); }
    }
  }

  // ------------------------------------------------------------ rendering
  render() {
    const st = this.state;
    if (!st) return;
    const root = this.root;
    root.replaceChildren();
    const mis = missionOf(st);
    const side = activeSide(st);
    const mine = this.mySides();
    const goalSide = mine.length ? (this.isMine(side) ? side : mine[0]) : -1;
    const limit = MISSIONS.find((x) => x.id === st.mission).rounds;
    const top = html(`<div class="hud-top">
      <div class="mission-card panel"><div class="eyebrow">${esc(mis.name)}</div>
        <div class="goal">${esc(goalSide >= 0 ? st.sides[goalSide].goal : 'Spectating')}</div>
        <div class="clock">Round ${st.round}/${limit} · T+${secondsElapsed(st)}s${st.item && !st.item.gone ? ` · ${esc(st.item.name)}: ${st.item.carrier !== null ? esc(st.mechs[st.item.carrier].design) : 'on the ground'}` : ''}</div></div>
      <div class="turn-banner panel" style="--side:${side >= 0 ? st.sides[side].color : 'var(--amber)'}">${this.turnText()}</div>
      <div class="feed"></div></div>`);
    root.appendChild(top);
    this.feedEl = $('.feed', top);
    this.renderFeed();
    // roster
    const rosterSide = this.isMine(side) ? side : (mine[0] ?? side);
    if (rosterSide >= 0) {
      const ro = html('<div class="roster"></div>');
      for (const m of st.mechs.filter((x) => x.side === rosterSide)) {
        const cls = !operational(m) ? 'dead' : m.activated ? 'done' : '';
        const cur = this.ix.mechId === m.id ? 'cur' : '';
        const r = html(`<div class="r ${cls} ${cur}" style="--side:${st.sides[m.side].color}">${esc(m.design)}<span class="faint" style="margin-left:auto">${m.exited ? 'OUT' : m.dead ? 'KIA' : Math.round(100 * totalArmor(m) / maxArmor(m)) + '%'}</span></div>`);
        r.addEventListener('click', () => {
          if (this.ix.mode === 'move' && !m.activated && canAct(m) && this.isMine(m.side) && m.side === side) this.enterMove(m.id);
          else { this.cursor = { x: m.x, y: m.y }; this.r.focusHex(m.x, m.y); this.updateCursorOverlay(); }
        });
        ro.appendChild(r);
      }
      root.appendChild(ro);
    }
    this.cardsEl = html('<div></div>');
    root.appendChild(this.cardsEl);
    this.renderCards();
    root.appendChild(promptBar(this.prompts(), (a) => this.onAction(a)));
    // modals
    if (this.ix.mode === 'briefing') root.appendChild(this.briefingModal());
    if (this.ix.mode === 'pass') {
      const s = st.sides[this.ix.side];
      const mod = html(`<div class="modal-bg"><div class="modal panel" style="border-top:3px solid ${s.color}"><div class="eyebrow">Hotseat</div><h2>${esc(s.name)}</h2><p class="brief">Pass the controls to ${esc(s.name)}. ${esc(s.goal)}</p>
        <div class="btn primary nav focus" data-k="go">${glyphHTML('confirm')} Take command</div></div></div>`);
      $('[data-k=go]', mod).addEventListener('click', () => this.onAction('confirm'));
      root.appendChild(mod);
    }
  }

  renderPrompts() {
    const old = [...this.root.children].find((c) => c.classList.contains('prompts'));
    const bar = promptBar(this.prompts(), (a) => this.onAction(a));
    if (old) old.replaceWith(bar); else this.root.appendChild(bar);
  }

  turnText() {
    const st = this.state, side = activeSide(st);
    if (st.over) return 'Mission over';
    if (side < 0) return '';
    const s = st.sides[side];
    const m = st.act ? st.mechs[st.act.id] : null;
    if (this.isMine(side)) {
      const step = { move: 'Move', facing: 'Choose facing', attack: 'Attack', sent: 'Executing…', anim: '…' }[this.ix.mode] || 'Your turn';
      return `${esc(s.name)}<small>${m || this.ix.mechId !== undefined ? esc((m || st.mechs[this.ix.mechId]).design) + ' — ' : ''}${step}</small>`;
    }
    return `${esc(s.name)}<small>${s.ctrl === 'ai' ? 'Computer is thinking' : 'Opponent\'s turn'}${m ? ' — ' + esc(m.design) : ''}</small>`;
  }

  prompts() {
    const ix = this.ix, st = this.state;
    const P = (a, label) => ({ a, label });
    switch (ix.mode) {
      case 'move': {
        const m = st.mechs[ix.mechId];
        const modes = ['walk', 'run', 'jump'].filter((k) => ix.reach[k] && ix.reach[k].mp > 0);
        const av = availableMechs(st, activeSide(st));
        return [P('confirm', 'Move here'), modes.length > 1 ? P('y', `Mode: ${MODE_LABEL[ix.moveMode]}`) : null, P('x', 'Stay / turn'),
          av.length > 1 && (!st.act || st.act.phase === 'move') ? P('rb', 'Next mech') : null, P('view', 'End turn'), P('menu', 'Menu')].filter(Boolean).map((p) => { void m; return p; });
      }
      case 'facing': return [P('confirm', 'Confirm'), P('rb', 'Rotate'), P('back', 'Back')];
      case 'attack': if (ix.noShots) return [P('confirm', 'No shots — end turn'), P('rb', 'Target'), P('menu', 'Menu')];
        return [P('confirm', 'Toggle weapon'), P('x', this.ix.melee ? MODE_MELEE[this.ix.melee] : 'Fire'), P('rb', 'Target'), P('y', 'Melee'), P('view', 'End turn'), P('menu', 'Menu')];
      case 'wait': return [P('menu', 'Menu')];
      default: return [P('menu', 'Menu')];
    }
  }

  renderFeed() {
    if (!this.feedEl) return;
    this.feedEl.replaceChildren(...this.feed.map((f) => html(`<div class="t-${f.tone || 'n'}" style="--sidec:${f.side !== undefined && this.state ? this.state.sides[f.side]?.color : 'transparent'}">${esc(f.text)}</div>`)));
  }

  renderCards() {
    if (!this.cardsEl || !this.state) return;
    const st = this.state, ix = this.ix;
    this.cardsEl.replaceChildren();
    const activeId = ix.mechId ?? (st.act ? st.act.id : null);
    if (activeId !== null && activeId !== undefined && st.mechs[activeId]) this.cardsEl.appendChild(this.unitCard(st.mechs[activeId], false));
    if (ix.mode === 'attack' && ix.targetId !== undefined && st.mechs[ix.targetId]) this.cardsEl.appendChild(this.targetCard(st.mechs[ix.mechId], st.mechs[ix.targetId]));
    else if (this.hover && this.hover.id !== activeId) this.cardsEl.appendChild(this.unitCard(this.hover, true));
    else if (ix.mode === 'move') this.cardsEl.appendChild(this.terrainCard());
  }

  terrainCard() {
    const st = this.state, { x, y } = this.cursor;
    const t = TERRAIN[st.map.t[y * st.map.w + x]];
    const e = st.map.e[y * st.map.w + x];
    const ix = this.ix;
    let costTxt = '';
    if (ix.mode === 'move') {
      const reach = ix.reach[ix.moveMode];
      let c = Infinity;
      for (let f = 0; f < 6; f++) c = Math.min(c, reach.cost[reachKey(reach, x, y, f)]);
      costTxt = isFinite(c) ? `${c}/${reach.mp} MP (${MODE_LABEL[ix.moveMode]})` : `Out of ${MODE_LABEL[ix.moveMode].toLowerCase()} range`;
    }
    const card = html(`<div class="unit-card target tcard panel" style="--side:var(--amber);grid-template-columns:1fr">
      <div class="nm"><b>${esc(t.name)}</b><span>Level ${e}</span></div>
      <div class="bars"><div>${esc(costTxt)}</div><div class="dim">Move cost ${t.cost}${t.woods ? ` · +${t.woods} to-hit cover` : ''}${t.depth ? ` · Water depth ${t.depth}: cools heat` : ''}</div></div></div>`);
    return card;
  }

  unitCard(m, other) {
    const st = this.state;
    const s = st.sides[m.side];
    const tags = [];
    if (m.dead) tags.push(['bad', 'Destroyed']);
    if (m.exited) tags.push(['ok', 'Left battlefield']);
    if (m.prone) tags.push(['warn', 'Prone']);
    if (m.shutdown) tags.push(['bad', 'Shut down']);
    if (m.pilot.ko) tags.push(['bad', 'Pilot unconscious']);
    if (m.carrying && st.item) tags.push(['ok', 'Carrying ' + st.item.name]);
    if (m.scouted) tags.push(['ok', 'Scouted']);
    if (m.engineHits) tags.push(['bad', `Engine ×${m.engineHits}`]);
    if (m.gyroHits) tags.push(['bad', `Gyro ×${m.gyroHits}`]);
    if (m.sensorHits) tags.push(['warn', `Sensors ×${m.sensorHits}`]);
    if (m.hsLost) tags.push(['warn', `-${m.hsLost} heat sinks`]);
    if (m.activated && !other) tags.push(['ok', 'Done this round']);
    const ticks = [5, 8, 14, 19].map((v) => `<span class="tick" style="left:${v / 30 * 100}%"></span>`).join('');
    const arm = totalArmor(m) / maxArmor(m);
    const card = html(`<div class="unit-card panel ${other ? 'target' : ''}" style="--side:${s.color}">
      <div class="nm"><b>${esc(m.design)}</b><span>${CLASS_NAMES[m.cls]} · ${m.tons}t · ${esc(s.name)}</span></div>
      <div class="doll">${paperDoll(m)}</div>
      <div class="bars">
        <div class="bar"><span>ARMOR</span><span class="track"><span class="fill" style="width:${arm * 100}%;background:hsl(${20 + arm * 110},70%,50%)"></span></span><span class="num">${Math.round(arm * 100)}%</span></div>
        <div class="bar heat"><span>HEAT</span><span class="track"><span class="fill" style="width:${Math.min(100, m.heat / 30 * 100)}%"></span>${ticks}</span><span class="num">${m.heat}</span></div>
      </div>
      <div class="mp"><span>W <b>${walkMP(m)}</b></span><span>R <b>${runMP(m)}</b></span><span>J <b>${jumpMP(m)}</b></span><span class="dim">HS ${m.hs - m.hsLost}</span></div>
      <div class="pilot" style="display:flex;gap:8px;align-items:center;font-size:14px">${esc(m.pilot.name)} <span class="pips">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < m.pilot.hits ? 'on' : ''}"></i>`).join('')}</span></div>
      ${tags.length ? `<div class="status-tags">${tags.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`);
    return card;
  }

  targetCard(m, t) {
    const st = this.state, ix = this.ix;
    const s = st.sides[t.side];
    const rows = m.weapons.map((w) => ({ w, th: toHit(st, m, t, w) }));
    const sel = ix.sel || new Set();
    const heatGen = (st.act ? st.act.heatGen : 0) + rows.filter((r) => sel.has(r.w.i)).reduce((a, r) => a + r.w.heat, 0) + m.engineHits * 5;
    const proj = Math.max(0, m.heat + heatGen - dissipation(st, m));
    const ed = rows.filter((r) => sel.has(r.w.i) && r.th.ok).reduce((a, r) => a + expectedDamage(r.w, r.th.p), 0);
    const dir = attackDirection(st, m.x, m.y, t);
    const dirTxt = { F: 'front', L: 'left side', R: 'right side', B: 'REAR' }[dir];
    const card = html(`<div class="unit-card target panel" style="--side:${s.color}">
      <div class="nm"><b>${esc(t.design)}</b><span>${t.tons}t · ${distance(m.x, m.y, t.x, t.y)} hexes · ${dirTxt}</span></div>
      <div class="doll">${paperDoll(t)}</div>
      <div class="bars">
        <div class="bar"><span>ARMOR</span><span class="track"><span class="fill" style="width:${totalArmor(t) / maxArmor(t) * 100}%"></span></span><span class="num">${Math.round(totalArmor(t) / maxArmor(t) * 100)}%</span></div>
        <div class="dim" style="font-size:13px">Pilot ${esc(t.pilot.name)} · ${t.pilot.hits}/6 hits${t.prone ? ' · PRONE' : ''}${t.shutdown ? ' · SHUTDOWN' : ''}</div>
      </div>
      <div class="weapons"></div>
      <div class="fire-sum"><span>${ix.melee ? MODE_MELEE[ix.melee] : `Exp. damage <b class="num" style="color:var(--amber-hi)">${ed.toFixed(1)}</b>`}</span><span>Heat after turn <b class="num" style="color:${proj >= 14 ? 'var(--red)' : proj >= 8 ? 'var(--amber)' : 'var(--green)'}">${proj}</b></span></div>
      <div class="mods"></div>
    </div>`);
    const list = $('.weapons', card);
    if (ix.melee) {
      const th = toHit(st, m, t, null, { kind: ix.melee });
      const dmg = ix.melee === 'kick' ? Math.ceil(m.tons / 5) : Math.ceil(m.tons / 10);
      list.appendChild(html(`<div class="wrow on nav" data-key="melee"><span class="chk"></span><span>${MODE_MELEE[ix.melee]} (${dmg} dmg)</span><span class="pct">${Math.round(th.p * 100)}%</span></div>`));
      $('.mods', card).textContent = th.mods.map((x) => `${x.label} ${x.v >= 0 ? '+' : ''}${x.v}`).join(' · ') + ` → need ${th.tn}+`;
    } else {
      for (const { w, th } of rows) {
        const W = WEAPONS[w.t];
        const on = sel.has(w.i);
        const row = html(`<div class="wrow nav ${th.ok ? (on ? 'on' : '') : 'off'}" data-key="w${w.i}">
          <span class="chk"></span><span>${esc(W.short)}<span class="faint"> ${['HD', 'LT', 'CT', 'RT', 'LA', 'RA', 'LL', 'RL'][w.loc]}${w.ammo >= 0 ? ' · ' + w.ammo : ''}</span></span>
          <span class="rng num faint">${w.rng}</span><span class="ht num faint">${w.heat}h</span><span class="pct">${th.ok ? Math.round(th.p * 100) + '%' : '—'}</span>
          ${th.ok ? '' : `<span class="why">${esc(th.reason)}</span>`}</div>`);
        row.addEventListener('click', () => {
          if (!th.ok) { toast(th.reason); return; }
          if (sel.has(w.i)) sel.delete(w.i); else sel.add(w.i);
          sfx('ui-move');
          this.renderCards();
        });
        row._th = th;
        list.appendChild(row);
      }
    }
    this.wnav.onChange = (el) => {
      const th = el && el._th;
      const mods = $('.mods', card);
      if (th && th.ok && mods) mods.textContent = th.mods.map((x) => `${x.label} ${x.v >= 0 ? '+' : ''}${x.v}`).join(' · ') + ` → need ${th.tn}+ on 2d6`;
    };
    queueMicrotask(() => this.wnav.attach(list));
    return card;
  }

  briefingModal() {
    const st = this.state, mis = missionOf(st);
    const mine = this.mySides();
    const s = mine.length ? mine[0] : 0;
    const side = st.sides[s];
    const theme = st.map.theme;
    const mod = html(`<div class="modal-bg"><div class="modal wide panel" style="border-top:3px solid ${side.color}">
      <div class="eyebrow">Orders · ${esc(side.name)}</div>
      <h2>${esc(mis.name)}</h2>
      <p class="brief" style="font-style:italic">“${esc(side.brief)}”</p>
      <div class="stat-grid">
        <div class="stat"><div class="k">Objective</div><div style="font-size:15px">${esc(side.goal)}</div></div>
        <div class="stat"><div class="k">Time limit</div><div class="v">${mis.rounds * 50}s</div></div>
        <div class="stat"><div class="k">Map</div><div class="v" style="font-size:16px">${esc(theme)} ${st.map.w}×${st.map.h}</div></div>
        <div class="stat"><div class="k">Forces</div><div style="font-size:15px">${st.sides.map((x, i) => `<span style="color:${x.color}">${esc(x.name)}</span> ${st.mechs.filter((m) => m.side === i).length}`).join(' · ')}</div></div>
      </div>
      <div class="btn primary nav focus" data-k="go">${glyphHTML('confirm')} Deploy</div>
      <div class="faint touch-hint" style="font-size:14px">Tap a hex to preview, tap again to confirm. Two fingers rotate and zoom the camera.</div>
    </div></div>`);
    $('[data-k=go]', mod).addEventListener('click', () => this.onAction('confirm'));
    return mod;
  }
}

const MODE_MELEE = { punch: 'Punch', kick: 'Kick' };
export { critName, relBearing, CLASS_NAMES };
