import { computeReach, canEndAt, pathFrom, reachKey, toHit, availableMechs, operational, canAct, activeSide, missionOf,
  walkMP, runMP, jumpMP, dissipation, expectedDamage, totalArmor, maxArmor, secondsElapsed, attackDirection } from '../core/rules.js';
import { WEAPONS, MISSIONS, CLASS_NAMES, TERRAIN, critName } from '../core/data.js';
import { neighbor, distance, facingToward, relBearing } from '../core/hex.js';
import { $, $$, html, esc, promptBar, toast, banner, paperDoll, FocusNav, glyphHTML, floatText } from './ui.js';
import { input } from './input.js';
import { sfx, music } from './audio.js';
import { ICON } from './icons.js';
import { attr, weaponTip, heatTip, MODE_TIP, moveDefense, turnOrderTip, terrainTip, pilotTip, ARMOR_TIP, statusTip, hitDirTip, brackets, reasonText, modLine, hideTip, tipGC } from './tips.js';

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
    this.r.restoreZoom();
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
    this.r.frameMechs(m.id, t.id);
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
    if (a === 'camcentre') { const id = ix.mechId ?? (this.state.act ? this.state.act.id : null); if (id !== null && id !== undefined) this.r.focusMech(id); else this.r.focusHex(this.cursor.x, this.cursor.y); return true; }
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
    const itemTxt = st.item && !st.item.gone ? `${esc(st.item.name)}: ${st.item.carrier !== null ? 'carried by ' + esc(st.mechs[st.item.carrier].design) : 'on the ground'}` : '';
    const top = html(`<div class="hud-top">
      <div class="mission-card panel" ${attr('Your objective', `<p>${esc(goalSide >= 0 ? st.sides[goalSide].goal : 'You are watching this battle.')}</p><p>Time limit: ${limit} rounds (${limit * 50} seconds). ${esc(mis.name)} briefings come from the original 1989 game.</p>`)}>
        <div class="eyebrow">${ICON.flag} ${esc(mis.name)}</div>
        <div class="goal">${esc(goalSide >= 0 ? st.sides[goalSide].goal : 'Spectating')}</div>
        ${itemTxt ? `<div class="clock">${itemTxt}</div>` : ''}</div>
      ${this.trackerHTML(limit)}
      <div class="hud-right"><button class="help-btn" data-k="help" ${attr('Field manual', 'How turns, movement, aiming, heat and damage work. Shortcut: H, or Menu → How to play.')} aria-label="How to play">${ICON.help}</button><div class="camctl panel" ${attr('Camera', '<p>Rotate the battlefield and zoom.</p><p>Controller: right stick rotates and tilts, triggers zoom. Keyboard: Q / E rotate, + / − zoom. Mouse: right-drag or middle-drag to rotate, wheel to zoom. Touch: twist and pinch with two fingers.</p><p>The centre button jumps back to your active mech.</p>')}>
        <button data-cam="l" aria-label="Rotate left">⟲</button><button data-cam="c" aria-label="Centre on mech">◎</button><button data-cam="r" aria-label="Rotate right">⟳</button>
        <button data-cam="out" aria-label="Zoom out">−</button><button data-cam="in" aria-label="Zoom in">+</button></div>
      <div class="feed"></div></div></div>`);
    $('[data-k=help]', top).addEventListener('click', () => this.app.showManual());
    $$('[data-cam]', top).forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = b.dataset.cam;
      if (k === 'l') this.r.rotateStep(-1); else if (k === 'r') this.r.rotateStep(1);
      else if (k === 'in') this.r.zoomStep(-1); else if (k === 'out') this.r.zoomStep(1);
      else { const id = this.ix.mechId ?? (this.state.act ? this.state.act.id : null); if (id !== null && id !== undefined) this.r.focusMech(id); }
      sfx('ui-move');
    }));
    root.appendChild(top);
    this.feedEl = $('.feed', top);
    this.renderFeed();
    // roster
    const rosterSide = this.isMine(side) ? side : (mine[0] ?? side);
    if (rosterSide >= 0) {
      const ro = html('<div class="roster"></div>');
      for (const m of st.mechs.filter((x) => x.side === rosterSide)) {
        const cls = !operational(m) ? 'dead' : m.activated ? 'done' : !canAct(m) ? 'idle' : '';
        const cur = this.ix.mechId === m.id ? 'cur' : '';
        const arm = Math.round(100 * totalArmor(m) / maxArmor(m));
        const stateTxt = m.exited ? 'Left the battlefield' : m.dead ? 'Destroyed' : m.activated ? 'Has acted this round' : !canAct(m) ? (m.shutdown ? 'Shut down' : 'Pilot unconscious') : 'Waiting to act';
        const r = html(`<div class="r ${cls} ${cur}" style="--side:${st.sides[m.side].color}" ${attr(m.design, `<p>${stateTxt}. Armour ${arm}%, heat ${m.heat}.</p><p>${this.isMine(m.side) && side === m.side && !m.activated && canAct(m) ? 'Click or press LB/RB to command this mech next.' : 'Click to find it on the map.'}</p>`)}>
          <span class="st">${m.dead ? '✕' : m.activated ? ICON.check : ''}</span>${esc(m.design)}<span class="faint" style="margin-left:auto">${m.exited ? 'OUT' : m.dead ? '' : arm + '%'}</span></div>`);
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
    if (!['briefing', 'pass', 'over'].includes(this.ix.mode)) root.appendChild(this.stepBar());
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
    tipGC();
  }

  renderPrompts() {
    const old = [...this.root.children].find((c) => c.classList.contains('prompts'));
    const bar = promptBar(this.prompts(), (a) => this.onAction(a));
    if (old) old.replaceWith(bar); else this.root.appendChild(bar);
  }

  trackerHTML(limit) {
    const st = this.state;
    const side = activeSide(st);
    const chips = st.order.map((i, k) => {
      const s = st.sides[i];
      const pips = st.mechs.filter((m) => m.side === i).map((m) => {
        const c = !operational(m) ? 'out' : m.activated ? 'done' : !canAct(m) ? 'idle' : 'todo';
        return `<i class="${c}"></i>`;
      }).join('');
      const now = i === side && !st.over;
      return `${k ? `<span class="tr-arrow">${ICON.arrow}</span>` : ''}<div class="tr-side ${now ? 'now' : ''}" style="--side:${s.color}">
        <span class="tr-name">${esc(s.name.replace(/ Force$/, ''))}${this.isMine(i) ? ' <small>you</small>' : ''}</span>
        <span class="tr-die">${ICON.dice}${s.init}</span><span class="tr-pips">${pips}</span></div>`;
    }).join('');
    return `<div class="tracker panel" ${attr('Turn order', turnOrderTip(st))}>
      <div class="tr-head"><span>${ICON.turn} Round ${st.round}<span class="faint">/${limit}</span></span><span>${ICON.clock} T+${secondsElapsed(st)}s</span></div>
      <div class="tr-sides">${chips}</div>
      <div class="tr-status">${this.statusText()}</div></div>`;
  }

  statusText() {
    const st = this.state, side = activeSide(st);
    if (st.over) return 'Mission over';
    if (side < 0) return '';
    const s = st.sides[side];
    const m = st.act ? st.mechs[st.act.id] : null;
    if (this.isMine(side)) {
      const mech = m || (this.ix.mechId !== undefined ? st.mechs[this.ix.mechId] : null);
      return `<b style="color:${s.color}">Your turn</b>${mech ? ' · ' + esc(mech.design) : ''}`;
    }
    return `<b style="color:${s.color}">${esc(s.name)}</b> · ${s.ctrl === 'ai' ? 'computer' : 'opponent'}${m ? ' moving ' + esc(m.design) : ' choosing'}`;
  }

  stepBar() {
    const ix = this.ix, st = this.state;
    const side = activeSide(st);
    const mine = this.isMine(side);
    const steps = [['pick', 'Mech'], ['move', 'Move'], ['facing', 'Face'], ['attack', 'Attack']];
    const order = { move: 1, facing: 2, attack: 3 };
    const cur = order[ix.mode];
    const av = mine ? availableMechs(st, side) : [];
    const mech = ix.mechId !== undefined ? st.mechs[ix.mechId] : null;
    let hint = '';
    if (!mine) hint = st.over ? 'The battle is over.' : `${esc(st.sides[side]?.name || '')} is taking its turn. Hover or select any mech to inspect it.`;
    else if (ix.mode === 'move') hint = `Pick a lit hex for <b>${esc(mech.design)}</b>: <span class="c-walk">walk</span>, <span class="c-run">run</span> or <span class="c-jump">jump</span> (switch with ${glyphHTML('y')}). Moving makes you harder to hit but costs heat and accuracy. ${av.length > 1 ? `${glyphHTML('rb')} picks a different mech.` : ''}`;
    else if (ix.mode === 'facing') hint = 'Choose which way to face. Most weapons fire forwards only, and your back armour is thin.';
    else if (ix.mode === 'attack') hint = ix.noShots ? 'No enemy is in range and in sight. End this mech\'s turn.' : 'Tick weapons and check the hit chances, then fire. Watch your heat. Hover a weapon to see why the chance is what it is.';
    else hint = 'Resolving…';
    const chips = mine && cur ? steps.map(([k, label], i) => {
      const state = i < cur ? 'done' : i === cur ? 'now' : '';
      const sub = i === 0 && mech ? esc(mech.design) : i === 1 && ix.mode === 'move' ? MODE_LABEL[ix.moveMode] : '';
      return `<span class="step ${state}"><b>${i + 1}</b>${label}${sub ? `<small>${sub}</small>` : ''}</span>`;
    }).join('') : '';
    return html(`<div class="stepbar">${chips ? `<div class="steps">${chips}</div>` : ''}<div class="hint">${hint}</div></div>`);
  }

  prompts() {
    const ix = this.ix, st = this.state;
    const P = (a, label) => ({ a, label });
    switch (ix.mode) {
      case 'move': {
        const modes = ['walk', 'run', 'jump'].filter((k) => ix.reach[k] && ix.reach[k].mp > 0);
        const av = availableMechs(st, activeSide(st));
        return [P('confirm', 'Move here'), modes.length > 1 ? P('y', `${MODE_LABEL[ix.moveMode]} ▸ ${MODE_LABEL[modes[(modes.indexOf(ix.moveMode) + 1) % modes.length]]}`) : null, P('x', 'Stay here'),
          av.length > 1 && (!st.act || st.act.phase === 'move') ? P('rb', 'Other mech') : null, P('view', 'Skip mech'), P('menu', 'Menu')].filter(Boolean);
      }
      case 'facing': return [P('confirm', 'Face this way'), P('rb', 'Rotate'), P('back', 'Back')];
      case 'attack': if (ix.noShots) return [P('confirm', 'End turn'), P('rb', 'Look at targets'), P('menu', 'Menu')];
        return [P('confirm', 'Toggle'), P('x', ix.melee ? MODE_MELEE[ix.melee] + '!' : 'Fire'), P('rb', 'Next target'), P('y', 'Melee'), P('view', 'Hold fire'), P('menu', 'Menu')];
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
    else if (ix.mode === 'move' || ix.mode === 'wait') this.cardsEl.appendChild(this.terrainCard());
    tipGC();
  }

  terrainCard() {
    const st = this.state, { x, y } = this.cursor;
    const tn = st.map.t[y * st.map.w + x];
    const t = TERRAIN[tn];
    const e = st.map.e[y * st.map.w + x];
    const ix = this.ix;
    let costTxt = '';
    if (ix.mode === 'move') {
      const reach = ix.reach[ix.moveMode];
      let c = Infinity;
      for (let f = 0; f < 6; f++) c = Math.min(c, reach.cost[reachKey(reach, x, y, f)]);
      costTxt = isFinite(c) ? `<b class="c-${ix.moveMode}">${MODE_LABEL[ix.moveMode]}</b> here uses ${c} of ${reach.mp} movement points` : `Out of ${MODE_LABEL[ix.moveMode].toLowerCase()} range`;
    }
    return html(`<div class="unit-card target tcard panel" style="--side:var(--amber)" ${attr(t.name, terrainTip(tn))}>
      <div class="uc-head"><div><div class="eyebrow">${ICON.tree} Terrain</div><b>${esc(t.name)}</b></div><span class="chip-sm">Level ${e}</span></div>
      <div class="facts"><span>Enter cost <b>${t.cost}</b></span><span>Cover <b>${t.woods ? '+' + t.woods : '—'}</b></span>${t.depth ? `<span>Cooling <b>+${t.depth * 2}</b></span>` : ''}</div>
      ${costTxt ? `<div class="dim">${costTxt}</div>` : ''}</div>`);
  }

  unitCard(m, other) {
    const st = this.state, ix = this.ix;
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
    const arm = totalArmor(m) / maxArmor(m);
    const sinks = dissipation(st, m);
    // projected heat when this is the mech being commanded
    let proj;
    const mine = !other && ix.mechId === m.id;
    if (mine && ix.mode === 'move') proj = Math.max(0, m.heat + ({ walk: 1, run: 2, jump: 3 }[ix.moveMode] || 0) + m.engineHits * 5 - sinks);
    if (mine && ix.mode === 'attack') proj = this.projectedHeat(m);
    const moveModes = [['walk', walkMP(m)], ['run', runMP(m)], ['jump', jumpMP(m)]];
    const selectable = mine && ix.mode === 'move';
    const card = html(`<div class="unit-card panel ${other ? 'target' : ''}" style="--side:${s.color}">
      <div class="uc-head"><div><div class="eyebrow">${CLASS_NAMES[m.cls]} · ${m.tons}t · ${esc(s.name)}</div><b>${esc(m.design)}</b></div>
        <span class="chip-sm" ${attr('Armour remaining', 'Total armour and internal structure left, compared with a fresh mech.')}>${ICON.shield} ${Math.round(arm * 100)}%</span></div>
      <div class="uc-body">
        <div class="doll" ${attr('Armour diagram', ARMOR_TIP)}>${paperDoll(m)}</div>
        <div class="uc-stats">
          ${this.heatBar(m, proj)}
          <div class="lbl">Movement</div>
          <div class="modes">${moveModes.map(([k, mp]) => `<button class="mode ${k} ${selectable && ix.moveMode === k ? 'on' : ''} ${mp ? '' : 'none'}" data-mode="${k}" ${attr(MODE_LABEL[k] + ` · ${mp} MP`, `<p>${MODE_TIP[k]}</p><p>${moveDefense}</p>`)}>${ICON[k]}<span>${MODE_LABEL[k]}</span><b>${mp || '—'}</b></button>`).join('')}</div>
          <div class="pilot" ${attr('MechWarrior ' + m.pilot.name, pilotTip(m))}>${ICON.pilot}<span>${esc(m.pilot.name)}</span><span class="pips">${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < m.pilot.hits ? 'on' : ''}"></i>`).join('')}</span></div>
        </div>
      </div>
      ${tags.length ? `<div class="status-tags">${tags.map(([c, t]) => `<span class="tag ${c}" ${attr(t, statusTip(t))}>${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`);
    if (selectable) $$('.mode', card).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.setMoveMode(b.dataset.mode); }));
    return card;
  }

  heatBar(m, proj) {
    const sinks = dissipation(this.state, m);
    const ticks = [5, 8, 14, 19].map((v) => `<span class="tick" style="left:${v / 30 * 100}%"></span>`).join('');
    const now = Math.min(100, m.heat / 30 * 100);
    const ghost = proj !== undefined ? Math.min(100, proj / 30 * 100) : null;
    const col = (h) => (h >= 14 ? 'var(--red)' : h >= 8 ? 'var(--amber)' : 'var(--green)');
    return `<div class="heatbar" ${attr('Heat', heatTip(m.heat, proj, sinks))}>
      <div class="lbl">${ICON.heat} Heat <span class="num" style="color:${col(m.heat)}">${m.heat}</span>${proj !== undefined ? ` <span class="faint">→</span> <span class="num" style="color:${col(proj)}">${proj}</span> <span class="faint">after turn</span>` : ''}</div>
      <div class="track">${ghost !== null && ghost > now ? `<span class="ghost" style="left:${now}%;width:${ghost - now}%"></span>` : ''}<span class="fill" style="width:${ghost !== null && ghost < now ? ghost : now}%"></span>${ticks}</div></div>`;
  }

  projectedHeat(m) {
    const st = this.state, ix = this.ix;
    const sel = ix.sel || new Set();
    const gen = (st.act ? st.act.heatGen : 0) + (ix.melee ? 0 : m.weapons.filter((w) => sel.has(w.i)).reduce((a, w) => a + w.heat, 0)) + m.engineHits * 5;
    return Math.max(0, m.heat + gen - dissipation(st, m));
  }

  setMoveMode(mode) {
    const ix = this.ix;
    if (ix.mode !== 'move' || !ix.reach[mode] || ix.reach[mode].mp <= 0) { toast(`${MODE_LABEL[mode]} isn't possible for this mech right now.`); return; }
    ix.moveMode = mode;
    sfx('ui-move');
    this.updateMoveOverlay();
    this.render();
  }

  targetCard(m, t) {
    const st = this.state, ix = this.ix;
    const s = st.sides[t.side];
    const dist = distance(m.x, m.y, t.x, t.y);
    const rows = m.weapons.map((w) => ({ w, th: toHit(st, m, t, w) }));
    const sel = ix.sel || new Set();
    const proj = this.projectedHeat(m);
    const ed = rows.filter((r) => sel.has(r.w.i) && r.th.ok).reduce((a, r) => a + expectedDamage(r.w, r.th.p), 0);
    const dir = attackDirection(st, m.x, m.y, t);
    const dirTxt = { F: 'Front', L: 'Left side', R: 'Right side', B: 'Rear shot' }[dir];
    const scale = Math.max(dist + 1, ...m.weapons.map((w) => w.rng));
    const melee = ['punch', 'kick'].map((k) => ({ k, th: toHit(st, m, t, null, { kind: k }), dmg: k === 'kick' ? Math.ceil(m.tons / 5) : Math.ceil(m.tons / 10) })).filter((x) => x.th.ok);
    const nSel = rows.filter((r) => sel.has(r.w.i) && r.th.ok).length;
    const card = html(`<div class="unit-card target panel" style="--side:${s.color}">
      <div class="uc-head"><div><div class="eyebrow">${ICON.target} Target · ${dist} hex${dist === 1 ? '' : 'es'} · ${esc(s.name)}</div><b>${esc(t.design)}</b></div>
        <span class="chip-sm ${dir === 'B' ? 'hot' : ''}" ${attr('Attack angle', hitDirTip(dir))}>${dirTxt}</span></div>
      <div class="tgt-row">
        <div class="doll mini" ${attr('Target armour', ARMOR_TIP)}>${paperDoll(t)}</div>
        <div class="tgt-facts">
          <div class="bar"><span class="track"><span class="fill" style="width:${totalArmor(t) / maxArmor(t) * 100}%"></span></span><span class="num">${Math.round(totalArmor(t) / maxArmor(t) * 100)}%</span></div>
          <div class="dim">${t.tons}t ${CLASS_NAMES[t.cls].toLowerCase()} · moved ${t.lastMove.hexes} hex${t.lastMove.hexes === 1 ? '' : 'es'}${t.lastMove.mode === 'jump' ? ' (jumped)' : ''}${t.prone ? ' · prone' : ''}${t.shutdown ? ' · shut down' : ''}</div>
        </div>
      </div>
      <div class="whead"><span></span><span>Weapon</span><span ${attr('Range bands', '<p>Each bar shows a weapon\'s reach: <span class="c-walk">short</span>, <span class="c-run">medium</span> and <span class="c-far">long</span> range. Hatching is the minimum range where the weapon struggles.</p><p>The white line is where the target is. If it falls past the end of a bar, that weapon can\'t reach.</p>')}>Range ${ICON.info}</span><span>Dmg</span><span>Heat</span><span ${attr('Hit chance', '<p>The chance this weapon hits, from rolling two dice against the target number. Hover or focus a weapon to see every modifier.</p>')}>Hit ${ICON.info}</span></div>
      <div class="weapons"></div>
      <div class="fire-sum">
        <span ${attr('Expected damage', '<p>Average damage if you fire the ticked weapons, accounting for each hit chance and how many missiles usually connect.</p>')}>Expected <b class="num">${ix.melee ? (melee.find((x) => x.k === ix.melee)?.th.p * melee.find((x) => x.k === ix.melee)?.dmg || 0).toFixed(1) : ed.toFixed(1)}</b> dmg</span>
        ${this.heatBar(m, proj)}
      </div>
      <div class="why"></div>
    </div>`);
    const list = $('.weapons', card);
    for (const { w, th } of rows) {
      const W = WEAPONS[w.t];
      const on = sel.has(w.i) && !ix.melee;
      const b = brackets(w);
      const pct = th.ok ? Math.round(th.p * 100) : 0;
      const pc = pct >= 58 ? 'good' : pct >= 28 ? 'mid' : 'low';
      const seg = (from, to, cls) => `<span class="seg ${cls}" style="left:${from / scale * 100}%;width:${(to - from) / scale * 100}%"></span>`;
      const rbar = `<span class="rbar">${seg(0, b.s, 's')}${seg(b.s, b.m, 'm')}${seg(b.m, b.l, 'l')}${b.min ? seg(0, b.min, 'min') : ''}<span class="mark" style="left:${Math.min(dist, scale) / scale * 100}%"></span></span>`;
      const row = html(`<div class="wrow nav ${th.ok ? (on ? 'on' : '') : 'off'}" data-key="w${w.i}" ${attr(W.name, weaponTip(w, th, dist))}>
        <span class="chk">${on ? ICON.check : ''}</span>
        <span class="wn"><b>${esc(W.short)}</b><small>${['Head', 'L.torso', 'C.torso', 'R.torso', 'L.arm', 'R.arm', 'L.leg', 'R.leg'][w.loc]}${w.ammo >= 0 ? ` · ${w.ammo} shots` : ''}</small></span>
        ${rbar}<span class="num">${w.dmg}${W.n > 1 ? `<small>×${W.n}</small>` : ''}</span><span class="num faint">${w.heat}</span>
        <span class="pm ${pc}">${th.ok ? `<s style="width:${pct}%"></s><em>${pct}%</em>` : `<em class="no">${esc(shortReason(th.reason))}</em>`}</span></div>`);
      row.addEventListener('click', () => {
        if (!th.ok) { toast(reasonText(th.reason)); return; }
        if (ix.melee) ix.melee = null;
        if (sel.has(w.i)) sel.delete(w.i); else sel.add(w.i);
        sfx('ui-move');
        this.renderCards();
      });
      row._th = th;
      list.appendChild(row);
    }
    for (const mo of melee) {
      const on = ix.melee === mo.k;
      const pct = Math.round(mo.th.p * 100);
      const row = html(`<div class="wrow melee nav ${on ? 'on' : ''}" data-key="melee-${mo.k}" ${attr(MODE_MELEE[mo.k], `<p>${mo.k === 'kick' ? 'A kick does a fifth of your tonnage in damage to the legs and can knock the target down, but if you miss you may fall over yourself.' : 'A punch does a tenth of your tonnage in damage to the upper body. It needs a working arm.'}</p><p>Melee replaces your weapons this turn. Need <b>${mo.th.tn}+</b>: ${pct}%.</p><ul class="mods-list">${mo.th.mods.map(modLine).join('')}</ul>`)}>
        <span class="chk">${on ? ICON.check : ''}</span><span class="wn"><b>${ICON.fist} ${MODE_MELEE[mo.k]}</b><small>instead of shooting</small></span><span></span><span class="num">${mo.dmg}</span><span class="num faint">0</span>
        <span class="pm ${pct >= 58 ? 'good' : 'mid'}"><s style="width:${pct}%"></s><em>${pct}%</em></span></div>`);
      row.addEventListener('click', () => { ix.melee = on ? null : mo.k; sfx('ui-move'); this.renderCards(); });
      row._th = mo.th;
      list.appendChild(row);
    }
    const fireLabel = ix.melee ? `${MODE_MELEE[ix.melee]}!` : nSel ? `Fire ${nSel} weapon${nSel === 1 ? '' : 's'}` : 'Nothing selected';
    const fire = html(`<div class="btn primary nav fire-btn ${!ix.melee && !nSel ? 'disabled' : ''}" data-key="fire">${glyphHTML('x')} ${fireLabel}</div>`);
    fire.addEventListener('click', (e) => { e.stopPropagation(); this.fire(); });
    list.appendChild(fire);
    const why = $('.why', card);
    const showWhy = (el) => {
      const th = el && el._th;
      if (!th || !th.ok) { why.innerHTML = el && el._th ? `<span class="warn">${esc(reasonText(th.reason))}</span>` : ''; return; }
      why.innerHTML = `<span class="need">Need <b>${th.tn}+</b> on 2 dice</span>` + th.mods.map((x) => `<span class="mchip ${x.v > 0 ? 'bad' : x.v < 0 ? 'good' : ''}">${esc(x.label)} ${x.v > 0 ? '+' : ''}${x.v}</span>`).join('');
    };
    this.wnav.onChange = showWhy;
    queueMicrotask(() => { this.wnav.attach(list); showWhy(this.wnav.cur); });
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
        <div class="stat"><div class="k">Time limit</div><div class="v">${mis.rounds} rounds</div></div>
        <div class="stat"><div class="k">Map</div><div class="v" style="font-size:16px">${esc(theme)} ${st.map.w}×${st.map.h}</div></div>
        <div class="stat"><div class="k">Forces</div><div style="font-size:15px">${st.sides.map((x, i) => `<span style="color:${x.color}">${esc(x.name)}</span> ${st.mechs.filter((m) => m.side === i).length}`).join(' · ')}</div></div>
      </div>
      <div class="howto">
        <div><b>1</b> Each round, forces take turns activating one mech.</div>
        <div><b>2</b> Move it: walk, run or jump to a lit hex, then pick a facing.</div>
        <div><b>3</b> Attack: tick weapons, check hit chances and heat, fire.</div>
      </div>
      <div class="row-btns"><div class="btn primary nav focus" data-k="go">${glyphHTML('confirm')} Deploy</div><div class="btn nav" data-k="manual">${ICON.help} How to play</div></div>
      <div class="faint touch-hint" style="font-size:14px">Tap a hex to preview, tap again to confirm. Long-press anything for an explanation. Two fingers rotate and zoom.</div>
    </div></div>`);
    $('[data-k=go]', mod).addEventListener('click', () => this.onAction('confirm'));
    $('[data-k=manual]', mod).addEventListener('click', (e) => { e.stopPropagation(); this.app.showManual(); });
    return mod;
  }
}

function shortReason(r) {
  return { 'Out of range': 'Too far', 'Out of arc': 'Wrong way', 'No line of sight': 'No sight', 'No ammo': 'Empty', 'Destroyed': 'Broken' }[r] || r;
}

const MODE_MELEE = { punch: 'Punch', kick: 'Kick' };
export { critName, relBearing, CLASS_NAMES };
