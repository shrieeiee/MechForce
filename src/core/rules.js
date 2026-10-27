// MechForce rules engine. Pure functions over a JSON-serialisable state object.
// The same code runs on the host server, in local games, and inside the AI.
import { MECHS, WEAPONS, MISSIONS, TERRAIN, ZONE_LOC, FRONT_ZONE, REAR_ZONE, TRANSFER, LOC_NAMES, critName,
  SIDE_COLORS, SIDE_NAMES, PILOT_NAMES, mechByName } from './data.js';
import { generateMap, deployZone, inMap } from './map.js';
import { buildTemplate } from './custom.js';
import { neighbor, distance, relBearing, line, facingToward, turnCost, center } from './hex.js';
import { nextRand, roll2d6, d6, hashSeed, chance } from './rng.js';

export const HEAT_MAX = 30;
const ROUND_SECONDS = 50;

// ---------------------------------------------------------------- setup
export function createGame(setup) {
  const mission = MISSIONS.find((m) => m.id === setup.mission) || MISSIONS[0];
  const nSides = Math.max(2, Math.min(setup.sides.length, mission.sides[1]));
  const seed = setup.seed ?? Math.floor(Math.random() * 1e9);
  const map = generateMap(seed, setup.mapSize || 'M', setup.theme || 'temperate');
  const st = {
    v: 1, seed, rng: hashSeed('dice' + seed), mission: mission.id, map, round: 0, over: false,
    sides: [], teams: [], mechs: [], order: [], turnIdx: 0, act: null, item: null, winner: null, log: [], seq: 0,
  };
  const teamOfSide = assignTeams(setup.sides.slice(0, nSides), mission);
  const nTeams = Math.max(...teamOfSide) + 1;
  for (let t = 0; t < nTeams; t++) st.teams.push({ members: [], name: '', color: '' });
  teamOfSide.forEach((t, s) => st.teams[t].members.push(s));
  let pilotIx = Math.floor(nextRand(st) * PILOT_NAMES.length);
  for (let s = 0; s < nSides; s++) {
    const sd = setup.sides[s];
    const team = teamOfSide[s];
    const role = mission.id === 'generic' ? 0 : team;
    st.sides.push({
      name: sd.name || SIDE_NAMES[s], color: sd.color || SIDE_COLORS[s], ctrl: sd.ctrl || 'ai', init: 0, team,
      goal: mission.goal[Math.min(role, mission.goal.length - 1)], brief: mission.brief[Math.min(role, mission.brief.length - 1)],
      conceded: false, gunnery: sd.gunnery ?? 4, piloting: sd.piloting ?? 5,
    });
  }
  st.teams.forEach((tm) => {
    tm.name = tm.members.length === 1 ? st.sides[tm.members[0]].name : tm.members.map((i) => st.sides[i].name.replace(/ Force$/, '')).join(' & ');
    tm.color = st.sides[tm.members[0]].color;
  });
  for (let s = 0; s < nSides; s++) {
    const sd = setup.sides[s];
    const team = teamOfSide[s];
    const mates = st.teams[team].members;
    const zoneIdx = team;
    let zone = deployZone(map, zoneIdx, nTeams);
    if (mates.length > 1) {
      const k = mates.indexOf(s), n = mates.length;
      const byAxis = zone.slice().sort((a, b) => (zoneIdx < 2 ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y));
      const chunk = byAxis.slice(Math.floor(k * byAxis.length / n), Math.floor((k + 1) * byAxis.length / n));
      const cy = chunk.reduce((q, p) => q + p.y, 0) / chunk.length, cx = chunk.reduce((q, p) => q + p.x, 0) / chunk.length;
      zone = chunk.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy) || (zoneIdx === 0 ? b.x - a.x : a.x - b.x));
    }
    const lance = (sd.lance || []).slice(0, 4);
    lance.forEach((entry, i) => {
      let tpl;
      if (entry && typeof entry === 'object' && entry.custom) {
        const b = buildTemplate(entry.custom);
        tpl = b.ok ? b.template : MECHS[0];
      } else tpl = mechByName(typeof entry === 'string' ? entry : entry.design) || MECHS[0];
      const pos = zone[i * 2 % zone.length] || zone[0];
      const pilot = (typeof entry === 'object' && entry.pilot) || PILOT_NAMES[(pilotIx++) % PILOT_NAMES.length];
      const f = team === 0 ? 0 : team === 1 ? 3 : team === 2 ? 5 : 1;
      const mech = makeMech(st.mechs.length, s, tpl, pilot, pos.x, pos.y, f, st.sides[s]);
      mech.team = team;
      st.mechs.push(mech);
    });
  }
  // Mission item
  if (mission.item) {
    const { w, h } = map;
    let pos;
    if (mission.itemZone === 'carried') {
      const carrier = st.mechs.filter((m) => m.team === 0).sort((a, b) => b.tons - a.tons)[0]; // the heavily guarded convoy
      st.item = { name: mission.item, x: carrier.x, y: carrier.y, carrier: carrier.id, gone: false };
      carrier.carrying = true;
    } else {
      const cands = [];
      for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) {
        const t = map.t[y * w + x];
        if (t === 5) continue;
        const ok = mission.itemZone === 'east' ? x >= Math.floor(w * 0.6) && x <= w - 4
          : mission.itemZone === 'eastish' ? x >= Math.floor(w * 0.58) && x <= Math.floor(w * 0.72) : Math.abs(x - w / 2) <= 2;
        if (ok) cands.push({ x, y });
      }
      pos = cands[Math.floor(nextRand(st) * cands.length)] || { x: w >> 1, y: h >> 1 };
      st.item = { name: mission.item, x: pos.x, y: pos.y, carrier: null, gone: false };
    }
  }
  startRound(st, []);
  return st;
}

// Work out a team number for each force. Objective missions always have exactly two
// teams (team 0 plays the first briefing, team 1 the second). Search & Destroy can be
// free-for-all (every force on its own) or any grouping the lobby chose.
export function assignTeams(sides, mission) {
  const n = sides.length;
  const raw = sides.map((sd, i) => (Number.isInteger(sd.team) ? sd.team : i));
  if (mission.id !== 'generic') {
    const t = raw.map((v) => (v % 2 === 0 ? 0 : 1));
    if (!t.includes(0)) t[0] = 0;
    if (!t.includes(1)) t[n - 1] = 1;
    return t;
  }
  const map = new Map();
  const t = raw.map((v) => { if (!map.has(v)) map.set(v, map.size); return map.get(v); });
  if (map.size === 1) return sides.map((_, i) => i);
  return t;
}

function makeMech(id, side, tpl, pilot, x, y, f, sd) {
  const weapons = tpl.wp.map((w, i) => {
    const W = WEAPONS[w[0]];
    let ammo = w[6];
    if (W.kind !== 'e' && ammo <= 0) ammo = W.kind === 'm' ? 8 : 15;
    return { t: w[0], heat: w[1], dmg: w[2], rng: w[3], minr: w[4], slots: w[5], ammo: W.kind === 'e' ? -1 : ammo,
      loc: w[7], slot: w[8], aloc: w[9], aslot: w[10], ok: true, i };
  });
  return {
    id, side, design: tpl.n, custom: !!tpl.custom, cls: tpl.c, tons: tpl.t, pilot: { name: pilot, gun: sd.gunnery, pil: sd.piloting, hits: 0, ko: false },
    x, y, f, armor: tpl.a.slice(), armorMax: tpl.a.slice(), internal: tpl.i.slice(), internalMax: tpl.i.slice(),
    crit: tpl.cr.map((r) => r.slice()), critHit: tpl.cr.map((r) => r.map(() => 0)),
    weapons, heat: 0, hs: tpl.hs, hsLost: 0, walkBase: tpl.w, jumpBase: tpl.j, jumpLost: 0,
    engineHits: 0, gyroHits: 0, sensorHits: 0, lifeSupport: false, actu: [],
    locGone: [0, 0, 0, 0, 0, 0, 0, 0], prone: false, shutdown: false, dead: false, exited: false,
    activated: false, lastMove: { mode: 'stand', hexes: 0 }, carrying: false, scouted: false,
    stats: { dmg: 0, kills: 0, shots: 0, hits: 0 },
  };
}

export const missionOf = (st) => MISSIONS.find((m) => m.id === st.mission);
export const operational = (m) => !m.dead && !m.exited;
export const canAct = (m) => operational(m) && !m.shutdown && !m.pilot.ko;
export const mechAt = (st, x, y) => st.mechs.find((m) => operational(m) && m.x === x && m.y === y);
export const tileOf = (st, x, y) => st.map.t[y * st.map.w + x];
export const elevOf = (st, x, y) => st.map.e[y * st.map.w + x];
export const sideAlive = (st, s) => !st.sides[s].conceded && st.mechs.some((m) => m.side === s && operational(m));
export const teamOf = (st, side) => (st.sides[side] ? st.sides[side].team ?? side : side);
export const teamAlive = (st, t) => st.teams[t].members.some((s) => sideAlive(st, s));
export const isEnemy = (a, b) => (a.team ?? a.side) !== (b.team ?? b.side);
export const activeSide = (st) => (st.over ? -1 : st.order[st.turnIdx]);
export const secondsElapsed = (st) => Math.max(0, st.round - 1) * ROUND_SECONDS;

function log(st, ev, text, extra) {
  st.log.push(text);
  if (st.log.length > 60) st.log.shift();
  ev.push({ k: 'log', text, ...(extra || {}) });
}

// ---------------------------------------------------------------- derived stats
function actuCount(m, codes) { return m.actu.filter((c) => codes.includes(c)).length; }
export function legState(m) {
  const legsGone = m.locGone[6] + m.locGone[7];
  const hips = actuCount(m, [37, 41]);
  const legAct = actuCount(m, [38, 39, 40, 42, 43, 44]);
  return { legsGone, hips, legAct };
}
export function walkMP(m) {
  if (!canAct(m)) return 0;
  const { legsGone, hips, legAct } = legState(m);
  if (legsGone >= 2 || m.gyroHits >= 2 || m.engineHits >= 3) return 0;
  let w = m.walkBase - legAct - Math.floor(m.heat / 5);
  if (hips) w = Math.ceil(w / (2 * hips));
  if (legsGone) w = Math.min(w, 1);
  return Math.max(0, w);
}
export function runMP(m) {
  const { legsGone } = legState(m);
  if (legsGone) return walkMP(m);
  return Math.ceil(walkMP(m) * 1.5);
}
export function jumpMP(m) {
  if (!canAct(m) || m.prone) return 0;
  const { legsGone } = legState(m);
  let j = m.jumpBase - m.jumpLost;
  if (legsGone) j = Math.floor(j / 2);
  return Math.max(0, j);
}
export function dissipation(st, m) {
  const t = tileOf(st, m.x, m.y);
  const depth = TERRAIN[t].depth || 0;
  return Math.max(0, m.hs - m.hsLost) + depth * 2;
}
export function heatToHit(h) { return h >= 24 ? 4 : h >= 17 ? 3 : h >= 13 ? 2 : h >= 8 ? 1 : 0; }

// ---------------------------------------------------------------- movement
function enterCost(st, m, fx, fy, tx, ty, mode) {
  if (!inMap(st.map, tx, ty)) return -1;
  const t = tileOf(st, tx, ty);
  const de = elevOf(st, tx, ty) - elevOf(st, fx, fy);
  if (Math.abs(de) > 2) return -1;
  if (mode === 'run' && t === 5) return -1;
  const o = mechAt(st, tx, ty);
  if (o && isEnemy(o, m)) return -1;
  return TERRAIN[t].cost + Math.abs(de);
}

// Dijkstra over (hex, facing). Returns reach info for a mode.
export function computeReach(st, m, mode) {
  const { w, h } = st.map;
  const N = w * h * 6;
  const cost = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const steps = new Int16Array(N).fill(0);
  const mp = mode === 'jump' ? jumpMP(m) : mode === 'run' ? runMP(m) : walkMP(m);
  const res = { mode, mp, cost, prev, steps, w, h };
  if (mode === 'jump') {
    if (mp <= 0) return res;
    const s0 = (m.y * w + m.x) * 6 + m.f;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = distance(m.x, m.y, x, y);
      if (d === 0 || d > mp) continue;
      if (Math.abs(elevOf(st, x, y) - elevOf(st, m.x, m.y)) > mp) continue;
      for (let f = 0; f < 6; f++) { const k = (y * w + x) * 6 + f; cost[k] = d; prev[k] = s0; steps[k] = d; }
    }
    cost[s0] = 0;
    return res;
  }
  const start = (m.y * w + m.x) * 6 + m.f;
  const startCost = m.prone ? 2 : 0;
  if (startCost > mp) { cost[start] = 0; res.cantStand = m.prone; return res; }
  cost[start] = startCost;
  const heap = [[startCost, start]];
  const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s; } } return top; };
  while (heap.length) {
    const [c, k] = pop();
    if (c > cost[k]) continue;
    const f = k % 6, hx = Math.floor(k / 6), x = hx % w, y = Math.floor(hx / w);
    // turns
    for (const df of [1, 5]) {
      const nf = (f + df) % 6, nk = hx * 6 + nf, nc = c + 1;
      if (nc <= mp && nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; steps[nk] = steps[k]; push(nc, nk); }
    }
    // forward / backward
    for (const back of mode === 'walk' ? [0, 1] : [0]) {
      const n = neighbor(x, y, back ? f + 3 : f);
      const ec = enterCost(st, m, x, y, n.x, n.y, mode);
      if (ec < 0) continue;
      const nc = c + ec + (back ? 0 : 0);
      const nk = (n.y * w + n.x) * 6 + f;
      if (nc <= mp && nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; steps[nk] = steps[k] + 1; push(nc, nk); }
    }
  }
  return res;
}

export function canEndAt(st, m, x, y) {
  const o = mechAt(st, x, y);
  return !o || o.id === m.id;
}

export function reachKey(reach, x, y, f) { return (y * reach.w + x) * 6 + f; }

export function pathFrom(reach, x, y, f) {
  const out = [];
  let k = reachKey(reach, x, y, f);
  if (!isFinite(reach.cost[k])) return null;
  let guard = 0;
  while (k >= 0 && guard++ < 999) {
    const hx = Math.floor(k / 6);
    out.push({ x: hx % reach.w, y: Math.floor(hx / reach.w), f: k % 6 });
    k = reach.prev[k];
  }
  return out.reverse();
}

// ---------------------------------------------------------------- line of sight & to-hit
export function lineOfSight(st, ax, ay, bx, by) {
  const hexes = line(ax, ay, bx, by);
  const ea = elevOf(st, ax, ay) + 1.6, eb = elevOf(st, bx, by) + 1.0;
  let woods = 0;
  const n = hexes.length - 1;
  for (let i = 1; i < n; i++) {
    const hx = hexes[i];
    const lh = ea + (eb - ea) * (i / n);
    const e = elevOf(st, hx.x, hx.y);
    if (e >= lh) return { ok: false, woods, block: hx, hexes };
    const wd = TERRAIN[tileOf(st, hx.x, hx.y)].woods;
    if (wd && e + 1.3 > lh) woods += wd;
    if (woods >= 3) return { ok: false, woods, block: hx, hexes };
  }
  return { ok: true, woods, hexes };
}

export function attackDirection(st, ax, ay, t) {
  // which side of the target faces the attacker
  const rel = relBearing(t.x, t.y, t.f, ax, ay);
  if (Math.abs(rel) <= 60.01) return 'F';
  if (Math.abs(rel) >= 119.99) return 'B';
  return rel < 0 ? 'L' : 'R';
}

export function inArc(att, wloc, tx, ty, pos) {
  const p = pos || att;
  const rel = relBearing(p.x, p.y, p.f, tx, ty);
  if (wloc === 4) return rel >= -120.01 && rel <= 60.01;
  if (wloc === 5) return rel >= -60.01 && rel <= 120.01;
  return Math.abs(rel) <= 60.01;
}

function moveMod(lm) {
  const n = lm.hexes;
  let v = n >= 18 ? 5 : n >= 10 ? 4 : n >= 7 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0;
  if (lm.mode === 'jump') v += 1;
  return v;
}

function armMods(m, loc) {
  if (loc !== 4 && loc !== 5) return 0;
  const base = loc === 4 ? 29 : 33;
  if (m.actu.includes(base)) return 4;
  return actuCount(m, [base + 1, base + 2]);
}

// Full to-hit breakdown. pos/mode let the AI evaluate hypothetical positions.
export function toHit(st, att, tgt, w, opts = {}) {
  const pos = opts.pos || att;
  const mode = opts.mode || (st.act && st.act.id === att.id ? att.lastMove.mode : 'stand');
  const mods = [];
  const add = (label, v) => { if (v) mods.push({ label, v }); };
  if (!operational(tgt) || !isEnemy(tgt, att)) return { ok: false, reason: 'Invalid target', tn: 99, mods };
  const dist = distance(pos.x, pos.y, tgt.x, tgt.y);
  const los = opts.los || lineOfSight(st, pos.x, pos.y, tgt.x, tgt.y);
  if (!los.ok) return { ok: false, reason: 'No line of sight', tn: 99, mods, dist };
  let tn = att.pilot.gun;
  mods.push({ label: 'Gunnery', v: att.pilot.gun });
  if (w) {
    if (!w.ok) return { ok: false, reason: 'Destroyed', tn: 99, mods, dist };
    if (w.ammo === 0) return { ok: false, reason: 'No ammo', tn: 99, mods, dist };
    if (dist > w.rng) return { ok: false, reason: 'Out of range', tn: 99, mods, dist };
    if (!inArc(att, w.loc, tgt.x, tgt.y, pos)) return { ok: false, reason: 'Out of arc', tn: 99, mods, dist };
    const s = Math.ceil(w.rng / 3), md = Math.ceil(w.rng * 2 / 3);
    add(dist <= s ? '' : dist <= md ? 'Medium range' : 'Long range', dist <= s ? 0 : dist <= md ? 2 : 4);
    if (w.minr && dist <= w.minr) add('Minimum range', w.minr - dist + 1);
    add('Arm actuators', armMods(att, w.loc));
  } else {
    if (dist !== 1) return { ok: false, reason: 'Not adjacent', tn: 99, mods, dist };
    if (!inArc(att, 2, tgt.x, tgt.y, pos)) return { ok: false, reason: 'Out of arc', tn: 99, mods, dist };
    if (Math.abs(elevOf(st, pos.x, pos.y) - elevOf(st, tgt.x, tgt.y)) > 1) return { ok: false, reason: 'Elevation', tn: 99, mods, dist };
    tn = att.pilot.pil; mods.length = 0; mods.push({ label: 'Piloting', v: att.pilot.pil });
    if (opts.kind === 'kick') add('Kick', -2);
    if (opts.kind === 'punch') {
      const arm = bestPunchArm(att);
      if (arm < 0) return { ok: false, reason: 'No arms', tn: 99, mods, dist };
      add('Arm actuators', armMods(att, arm));
    }
    if (opts.kind === 'kick' && legState(att).legsGone) return { ok: false, reason: 'Leg destroyed', tn: 99, mods, dist };
  }
  add({ walk: 'You walked', run: 'You ran', jump: 'You jumped' }[mode] || '', { walk: 1, run: 2, jump: 3 }[mode] || 0);
  add('Target movement', moveMod(tgt.lastMove));
  if (tgt.prone) add('Target prone', dist <= 1 ? -2 : 1);
  if (tgt.shutdown || tgt.pilot.ko) add('Target immobile', -4);
  add('Woods', los.woods + TERRAIN[tileOf(st, tgt.x, tgt.y)].woods);
  if (TERRAIN[tileOf(st, tgt.x, tgt.y)].depth) add('Partial cover', 1);
  add('Heat', heatToHit(att.heat));
  add('Sensors damaged', att.sensorHits * 2);
  if (att.prone) add('You are prone', 2);
  tn = mods.reduce((s, m) => s + m.v, 0);
  return { ok: true, tn, p: chance(tn), mods: mods.filter((m) => m.label), dist, los };
}

function bestPunchArm(m) {
  let best = -1, bm = 99;
  for (const loc of [4, 5]) {
    if (m.locGone[loc]) continue;
    const md = armMods(m, loc);
    if (md < 4 && md < bm) { bm = md; best = loc; }
  }
  return best;
}

// ---------------------------------------------------------------- damage
const TABLE = {
  F: { 2: 2, 3: 5, 4: 5, 5: 7, 6: 3, 7: 2, 8: 1, 9: 6, 10: 4, 11: 4, 12: 0 },
  L: { 2: 1, 3: 6, 4: 4, 5: 4, 6: 6, 7: 1, 8: 2, 9: 3, 10: 5, 11: 7, 12: 0 },
  R: { 2: 3, 3: 7, 4: 5, 5: 5, 6: 7, 7: 3, 8: 2, 9: 1, 10: 4, 11: 6, 12: 0 },
};
function rollLocation(st, dir) {
  const r = roll2d6(st);
  const loc = TABLE[dir === 'B' ? 'F' : dir][r];
  return { loc, rear: dir === 'B', tac: r === 2 };
}

function pilotHit(st, m, n, ev, why) {
  if (m.dead) return;
  m.pilot.hits += n;
  ev.push({ k: 'pilot', id: m.id, hits: m.pilot.hits });
  if (m.pilot.hits >= 6) {
    log(st, ev, `MechWarrior ${m.pilot.name} (${m.design}) is killed!`, { tone: 'bad', side: m.side });
    destroyMech(st, m, ev, null, 'pilot killed');
    return;
  }
  log(st, ev, `${m.pilot.name} is injured${why ? ' (' + why + ')' : ''} — ${m.pilot.hits}/6 hits`, { side: m.side });
  if (!m.pilot.ko) {
    const tn = [0, 3, 5, 7, 10, 11][m.pilot.hits];
    const r = roll2d6(st);
    if (r < tn) {
      m.pilot.ko = true;
      log(st, ev, `${m.pilot.name} is unconscious!`, { tone: 'bad', side: m.side });
      ev.push({ k: 'ko', id: m.id });
    }
  }
}

function destroyMech(st, m, ev, by, why) {
  if (m.dead) return;
  m.dead = true;
  ev.push({ k: 'destroyed', id: m.id, by: by ? by.id : -1 });
  log(st, ev, `${m.design} (${m.pilot.name}) is DESTROYED${why ? ' — ' + why : ''}!`, { tone: 'kill', side: m.side });
  if (by && isEnemy(by, m)) by.stats.kills++;
  dropItem(st, m, ev);
  if (st.mission === 'spy' && st.item && st.item.carrier === m.id) {
    // the spy dies with his ride
  }
}

function dropItem(st, m, ev) {
  if (!st.item || st.item.carrier !== m.id) return;
  st.item.carrier = null; st.item.x = m.x; st.item.y = m.y; m.carrying = false;
  if (st.mission === 'spy') {
    st.item.gone = true;
    log(st, ev, 'The spy was killed in the wreckage!', { tone: 'kill' });
    setWinner(st, ev, 0, 'The spy is dead.');
    return;
  }
  log(st, ev, `The ${st.item.name} drops to the ground.`, { tone: 'info' });
  ev.push({ k: 'drop', x: m.x, y: m.y });
}

function destroyLocation(st, m, loc, ev, by) {
  if (m.locGone[loc]) return;
  m.locGone[loc] = 1;
  m.internal[loc] = 0;
  FRONT_ZONE[loc] >= 0 && (m.armor[FRONT_ZONE[loc]] = 0);
  REAR_ZONE[loc] >= 0 && (m.armor[REAR_ZONE[loc]] = 0);
  m.weapons.forEach((w) => { if (w.loc === loc) w.ok = false; });
  ev.push({ k: 'locgone', id: m.id, loc });
  log(st, ev, `${m.design}'s ${LOC_NAMES[loc]} is blown off!`, { tone: 'crit', side: m.side });
  if (loc === 0 || loc === 2) { destroyMech(st, m, ev, by, loc === 0 ? 'head destroyed' : 'center torso destroyed'); return; }
  if (loc === 1) destroyLocation(st, m, 4, ev, by);
  if (loc === 3) destroyLocation(st, m, 5, ev, by);
  if (loc === 6 || loc === 7) {
    if (!m.prone && !m.dead) fall(st, m, ev, 'leg destroyed');
  }
}

function fall(st, m, ev, why) {
  if (m.dead || m.prone) return;
  m.prone = true;
  ev.push({ k: 'fall', id: m.id });
  log(st, ev, `${m.design} falls! (${why})`, { tone: 'bad', side: m.side });
  const dmg = Math.ceil(m.tons / 10);
  const hl = rollLocation(st, 'F');
  applyDamage(st, m, hl.loc, false, dmg, ev, null, { noFall: true });
  pilotHit(st, m, 1, ev, 'fall');
}

export function pilotingTN(m, mod = 0) {
  const { legsGone, hips, legAct } = legState(m);
  return m.pilot.pil + m.gyroHits * 3 + hips * 2 + legAct + legsGone * 5 + mod;
}

function pilotingCheck(st, m, mod, why, ev) {
  if (m.dead || m.prone) return true;
  const tn = pilotingTN(m, mod);
  const r = roll2d6(st);
  ev.push({ k: 'psr', id: m.id, tn, roll: r, why });
  if (r < tn) { fall(st, m, ev, why); return false; }
  return true;
}

function ammoExplosion(st, m, w, ev, by) {
  if (w.ammo <= 0) return;
  const W = WEAPONS[w.t];
  const dmg = Math.min(40, w.ammo * w.dmg * W.n);
  w.ammo = 0;
  const loc = w.aloc >= 0 ? w.aloc : w.loc;
  ev.push({ k: 'boom', id: m.id, loc, dmg });
  log(st, ev, `AMMO EXPLOSION! ${m.design}'s ${W.short} ammo cooks off for ${dmg} damage!`, { tone: 'crit', side: m.side });
  applyDamage(st, m, loc, false, dmg, ev, by, { internalOnly: true });
  pilotHit(st, m, 2, ev, 'ammo explosion');
}

function applyCrit(st, m, loc, ev, by) {
  const slots = [];
  m.crit[loc].forEach((c, s) => { if (c >= 0 && !m.critHit[loc][s]) slots.push(s); });
  if (!slots.length) return;
  const s = slots[Math.floor(nextRand(st) * slots.length)];
  const code = m.crit[loc][s];
  m.critHit[loc][s] = 1;
  ev.push({ k: 'crit', id: m.id, loc, code });
  log(st, ev, `CRITICAL: ${m.design} — ${critName(code)} hit (${LOC_NAMES[loc]})`, { tone: 'crit', side: m.side });
  if (code <= 16) {
    const w = m.weapons.find((w) => w.loc === loc && s >= w.slot && s < w.slot + w.slots && w.ok) ||
      m.weapons.find((w) => w.loc === loc && w.t === code && w.ok);
    if (w) w.ok = false;
  } else if (code <= 28) {
    const w = m.weapons.find((w) => w.aloc === loc && w.aslot === s && w.ammo > 0) ||
      m.weapons.find((w) => w.t === code - 17 && w.ammo > 0);
    if (w) ammoExplosion(st, m, w, ev, by);
  } else if (code <= 44) {
    m.actu.push(code);
    if (code >= 37) pilotingCheck(st, m, 0, 'leg actuator', ev);
  } else if (code === 45) m.lifeSupport = true;
  else if (code === 46) m.sensorHits++;
  else if (code === 47) { log(st, ev, `Cockpit hit! ${m.pilot.name} is killed!`, { tone: 'kill' }); destroyMech(st, m, ev, by, 'cockpit destroyed'); }
  else if (code === 48) { m.engineHits++; if (m.engineHits >= 3) destroyMech(st, m, ev, by, 'engine destroyed'); }
  else if (code === 49) { m.gyroHits++; pilotingCheck(st, m, 0, 'gyro hit', ev); }
  else if (code === 50 || code === 52) m.jumpLost++;
  else if (code === 51) m.hsLost++;
}

function rollCrits(st, m, loc, ev, by, force) {
  const r = roll2d6(st);
  let n = r >= 12 ? 3 : r >= 10 ? 2 : r >= 8 ? 1 : 0;
  if (force && !n) return;
  if (r >= 12 && (loc === 0 || loc >= 4)) { destroyLocation(st, m, loc, ev, by); return; }
  for (let i = 0; i < n && !m.dead; i++) applyCrit(st, m, loc, ev, by);
}

export function applyDamage(st, m, loc, rear, dmg, ev, by, opts = {}) {
  let left = dmg;
  let guard = 0;
  while (left > 0 && !m.dead && guard++ < 10) {
    if (m.locGone[loc]) { loc = TRANSFER[loc]; if (loc < 0) return; rear = false; continue; }
    if (!opts.internalOnly) {
      const zone = rear && REAR_ZONE[loc] >= 0 ? REAR_ZONE[loc] : FRONT_ZONE[loc];
      const a = Math.min(m.armor[zone], left);
      m.armor[zone] -= a; left -= a;
      if (by && a) by.stats.dmg += a;
    }
    if (left <= 0) {
      if (opts.tac) rollCrits(st, m, loc, ev, by, true);
      return;
    }
    const i = Math.min(m.internal[loc], left);
    m.internal[loc] -= i; left -= i;
    if (by && i) by.stats.dmg += i;
    if (m.internal[loc] <= 0) {
      destroyLocation(st, m, loc, ev, by);
      if (m.dead) return;
      loc = TRANSFER[loc]; rear = false; opts = { ...opts, internalOnly: false };
      if (loc < 0) return;
    } else {
      rollCrits(st, m, loc, ev, by);
      return;
    }
  }
}

// ---------------------------------------------------------------- objective helpers
function setWinner(st, ev, team, reason) {
  if (st.over) return;
  st.over = true;
  const side = team >= 0 ? st.teams[team].members[0] : -1;
  st.winner = { team, side, reason };
  st.act = null;
  ev.push({ k: 'win', team, side, reason });
  log(st, ev, team < 0 ? `Mission ends in a draw — ${reason}` : `${st.teams[team].name} win${st.teams[team].members.length > 1 ? '' : 's'}! ${reason}`, { tone: 'win' });
}

function afterMove(st, m, ev) {
  const mis = missionOf(st);
  const { w } = st.map;
  const it = st.item;
  if (it && !it.gone && it.carrier === null && m.x === it.x && m.y === it.y) {
    if (mis.spy && m.team === 0) {
      it.gone = true;
      log(st, ev, `${m.design} finds and eliminates the spy!`, { tone: 'kill' });
      setWinner(st, ev, 0, 'The spy is dead.');
      return true;
    }
    if (mis.carriers.includes(m.team) && !m.carrying) {
      it.carrier = m.id; m.carrying = true;
      ev.push({ k: 'pickup', id: m.id });
      log(st, ev, `${m.design} picks up the ${it.name}!`, { tone: 'info', side: m.side });
    }
  }
  if (it && it.carrier === m.id) { it.x = m.x; it.y = m.y; }
  if (mis.scout && m.team === 0 && m.x >= Math.floor(w * 2 / 3) && !m.scouted) {
    m.scouted = true;
    log(st, ev, `${m.design} has scouted the enemy rear area. Now get home!`, { tone: 'info', side: 0 });
  }
  // exits
  const atE = m.x === w - 1, atW = m.x === 0;
  let exit = false, winNow = null;
  if (mis.id === 'crossing' && m.team === 0 && atE) exit = true;
  if (mis.homeExit && m.carrying && ((m.team === 0 && atW) || (m.team === 1 && atE))) { exit = true; winNow = `${m.design} escaped with the ${it.name}.`; }
  if (mis.id === 'pepsi' && m.carrying && ((m.team === 0 && atE) || (m.team === 1 && atW))) {
    exit = true; winNow = m.team === 0 ? 'The Pepsi reached the bride!' : 'The Pepsi was captured!';
  }
  if (mis.spy && m.carrying && m.team === 1 && atE) { exit = true; winNow = 'The spy made it home.'; }
  if (mis.scout && m.team === 0 && m.scouted && atW) { exit = true; winNow = 'Scouting data delivered.'; }
  if (exit) {
    m.exited = true;
    ev.push({ k: 'exit', id: m.id });
    log(st, ev, `${m.design} leaves the battlefield.`, { tone: 'info', side: m.side });
    if (winNow) setWinner(st, ev, m.team, winNow);
    return true;
  }
  return false;
}

function checkVictory(st, ev) {
  if (st.over) return;
  const mis = missionOf(st);
  const alive = st.teams.map((_, t) => teamAlive(st, t));
  const nAlive = alive.filter(Boolean).length;
  if (mis.id === 'crossing') {
    const n0 = st.mechs.filter((m) => m.team === 0).length;
    const need = Math.ceil(n0 / 2);
    const ex = st.mechs.filter((m) => m.team === 0 && m.exited).length;
    const live = st.mechs.filter((m) => m.team === 0 && operational(m) && !st.sides[m.side].conceded).length;
    if (ex >= need) return setWinner(st, ev, 0, `${ex} mechs crossed safely.`);
    if (ex + live < need) return setWinner(st, ev, 1, 'The crossing was stopped.');
    if (!alive[1]) return setWinner(st, ev, 0, 'The blocking force was destroyed.');
    return;
  }
  if (nAlive <= 1) {
    const s = alive.indexOf(true);
    if (s < 0) return setWinner(st, ev, -1, 'Mutual destruction.');
    return setWinner(st, ev, s, 'All enemy mechs neutralized.');
  }
}

function roundLimit(st, ev) {
  const mis = missionOf(st);
  if (st.round <= mis.rounds) return false;
  const byId = {
    hold: [0, 'The position held for 500 seconds.'], datapack: [1, 'The datapack was never recovered.'],
    pepsi: [1, 'The Pepsi never arrived.'], scout: [1, 'The scouts never returned.'],
    crossing: [1, 'The crossing failed.'], memcell: [-1, 'Time ran out.'], spy: [-1, 'The spy slipped away into the hills.'],
  };
  if (byId[mis.id]) { setWinner(st, ev, byId[mis.id][0], byId[mis.id][1]); return true; }
  // generic: most surviving structure wins
  const score = st.teams.map((_, t) => st.mechs.filter((m) => m.team === t && operational(m))
    .reduce((t, m) => t + m.armor.reduce((a, b) => a + b, 0) + m.internal.reduce((a, b) => a + b, 0), 0));
  const best = Math.max(...score);
  const winners = score.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  setWinner(st, ev, winners.length === 1 ? winners[0] : -1, 'Time limit reached.');
  return true;
}

// ---------------------------------------------------------------- rounds & turns
function startRound(st, ev) {
  st.round++;
  if (roundLimit(st, ev)) return;
  ev.push({ k: 'round', n: st.round });
  // initiative: lowest roll activates first
  const rolls = st.sides.map((s, i) => ({ i, r: roll2d6(st) + nextRand(st) * 0.5 }));
  st.sides.forEach((s, i) => { s.init = Math.floor(rolls[i].r); });
  st.order = rolls.filter((r) => sideAlive(st, r.i)).sort((a, b) => a.r - b.r).map((r) => r.i);
  ev.push({ k: 'init', order: st.order.slice(), rolls: st.sides.map((s) => s.init) });
  log(st, ev, `— Round ${st.round} (T+${secondsElapsed(st)}s) — Initiative: ${st.order.map((i) => st.sides[i].name).join(' → ')}`, { tone: 'round' });
  for (const m of st.mechs) {
    m.activated = false;
    if (!operational(m)) continue;
    if (m.pilot.ko) {
      const tn = [0, 3, 5, 7, 10, 11][Math.min(5, m.pilot.hits)];
      if (roll2d6(st) >= tn) { m.pilot.ko = false; log(st, ev, `${m.pilot.name} wakes up.`, { side: m.side }); ev.push({ k: 'wake', id: m.id }); }
      else { m.activated = true; m.lastMove = { mode: 'stand', hexes: 0 }; coolDown(st, m, ev); }
    }
    if (m.shutdown && !m.dead) {
      m.activated = true; m.lastMove = { mode: 'stand', hexes: 0 };
      coolDown(st, m, ev);
      const tn = shutdownTN(m.heat);
      if (m.heat < 30 && (tn === 0 || roll2d6(st) >= tn)) { m.shutdown = false; log(st, ev, `${m.design} restarts its reactor.`, { side: m.side }); ev.push({ k: 'restart', id: m.id }); }
    }
  }
  st.turnIdx = 0;
  if (!hasAvailable(st, st.order[0])) nextTurn(st, ev, true);
}

function coolDown(st, m, ev) {
  m.heat = Math.max(0, m.heat - dissipation(st, m) + m.engineHits * 5);
  ev.push({ k: 'heat', id: m.id, heat: m.heat });
}
function shutdownTN(h) { return h >= 30 ? 99 : h >= 26 ? 10 : h >= 22 ? 8 : h >= 18 ? 6 : h >= 14 ? 4 : 0; }
function ammoTN(h) { return h >= 28 ? 8 : h >= 23 ? 6 : h >= 19 ? 4 : 0; }

export function availableMechs(st, side) {
  return st.mechs.filter((m) => m.side === side && canAct(m) && !m.activated);
}
function hasAvailable(st, side) { return side !== undefined && !st.sides[side].conceded && availableMechs(st, side).length > 0; }

function nextTurn(st, ev, fromStart) {
  if (st.over) return;
  const n = st.order.length;
  for (let k = fromStart ? 0 : 1; k <= n; k++) {
    const idx = (st.turnIdx + k) % n;
    if (hasAvailable(st, st.order[idx])) {
      st.turnIdx = idx;
      ev.push({ k: 'turn', side: st.order[idx] });
      return;
    }
  }
  startRound(st, ev);
}

function endActivation(st, m, ev) {
  const act = st.act;
  st.act = null;
  m.activated = true;
  if (operational(m)) {
    const before = m.heat;
    const gen = (act ? act.heatGen : 0) + m.engineHits * 5;
    m.heat = Math.max(0, Math.min(40, m.heat + gen - dissipation(st, m)));
    ev.push({ k: 'heat', id: m.id, heat: m.heat, gen, from: before });
    if (m.heat >= 14 && !m.shutdown) {
      const tn = shutdownTN(m.heat);
      const r = roll2d6(st);
      if (r < tn) {
        m.shutdown = true;
        ev.push({ k: 'shutdown', id: m.id });
        log(st, ev, `${m.design} overheats and SHUTS DOWN! (heat ${m.heat})`, { tone: 'bad', side: m.side });
      }
    }
    const at = ammoTN(m.heat);
    if (at && roll2d6(st) < at) {
      const w = m.weapons.find((w) => w.ammo > 0);
      if (w) { log(st, ev, `${m.design}'s ammo cooks off from the heat!`, { tone: 'crit', side: m.side }); ammoExplosion(st, m, w, ev, null); }
    }
    if (m.lifeSupport && m.heat >= 15 && !m.dead) pilotHit(st, m, m.heat >= 26 ? 2 : 1, ev, 'life support failure');
  }
  checkVictory(st, ev);
  if (!st.over) nextTurn(st, ev);
}

function beginActivation(st, m, ev) {
  st.act = { id: m.id, phase: 'move', heatGen: 0 };
  m.lastMove = { mode: 'stand', hexes: 0 };
  ev.push({ k: 'activate', id: m.id });
}

// ---------------------------------------------------------------- commands
// cmd types: select, move, attack, melee, end, concede
export function applyCommand(st, side, cmd) {
  const ev = [];
  const fail = (error) => ({ ok: false, error, events: [] });
  if (cmd.type === 'concede') {
    if (st.over) return fail('Game over');
    st.sides[side].conceded = true;
    log(st, ev, `${st.sides[side].name} withdraws from the field.`, { tone: 'bad' });
    if (st.act && st.mechs[st.act.id].side === side) st.act = null;
    checkVictory(st, ev);
    if (!st.over && activeSide(st) === side) nextTurn(st, ev);
    st.seq++;
    return { ok: true, events: ev };
  }
  if (st.over) return fail('Game over');
  if (activeSide(st) !== side) return fail('Not your turn');
  const m = st.mechs[cmd.id];
  if (!m || m.side !== side) return fail('Not your mech');
  if (st.act && st.act.id !== m.id) {
    // switching selection is only allowed before anything happened
    const cur = st.mechs[st.act.id];
    if (st.act.phase === 'move' && cur.lastMove.mode === 'stand' && !st.act.heatGen && cmd.type === 'select') {
      st.act = null;
    } else return fail('Another mech is active');
  }
  if (!st.act) {
    if (!canAct(m) || m.activated) return fail('That mech cannot act');
    beginActivation(st, m, ev);
  }
  const act = st.act;
  switch (cmd.type) {
    case 'select': break;
    case 'move': {
      if (act.phase !== 'move') return fail('Already moved');
      const mode = cmd.mode;
      if (!['walk', 'run', 'jump'].includes(mode)) return fail('Bad mode');
      const reach = computeReach(st, m, mode);
      const k = reachKey(reach, cmd.x, cmd.y, cmd.f);
      if (!inMap(st.map, cmd.x, cmd.y) || !isFinite(reach.cost[k]) || !canEndAt(st, m, cmd.x, cmd.y)) return fail('Unreachable');
      const path = pathFrom(reach, cmd.x, cmd.y, cmd.f);
      const hexes = reach.steps[k];
      const wasProne = m.prone && mode !== 'jump';
      if (wasProne) m.prone = false;
      m.x = cmd.x; m.y = cmd.y; m.f = cmd.f;
      const moved = hexes > 0 || path.length > 1;
      const realMode = !moved ? 'stand' : mode;
      m.lastMove = { mode: realMode, hexes };
      act.heatGen += realMode === 'walk' ? 1 : realMode === 'run' ? 2 : realMode === 'jump' ? Math.max(3, hexes) : 0;
      act.phase = 'attack';
      ev.push({ k: 'move', id: m.id, path, mode: realMode });
      if (wasProne) log(st, ev, `${m.design} stands up.`, { side: m.side });
      if (realMode === 'jump' && legState(m).legsGone + m.gyroHits > 0) pilotingCheck(st, m, 0, 'landing', ev);
      if (afterMove(st, m, ev)) { if (!st.over) { st.act = act; endActivation(st, m, ev); } break; }
      if (m.dead) { endActivation(st, m, ev); }
      break;
    }
    case 'attack': {
      if (act.phase === 'done') return fail('Already attacked');
      const tgt = st.mechs[cmd.target];
      if (!tgt) return fail('Bad target');
      if (act.phase === 'move') { act.phase = 'attack'; }
      const list = (cmd.weapons || []).map((i) => m.weapons[i]).filter(Boolean);
      const usable = list.filter((w) => toHit(st, m, tgt, w).ok);
      if (!usable.length) return fail('No weapon can fire');
      fireWeapons(st, m, tgt, usable, ev);
      act.phase = 'done';
      endActivation(st, m, ev);
      break;
    }
    case 'melee': {
      if (act.phase === 'done') return fail('Already attacked');
      const tgt = st.mechs[cmd.target];
      const th = tgt && toHit(st, m, tgt, null, { kind: cmd.kind });
      if (!th || !th.ok) return fail(th ? th.reason : 'Bad target');
      physical(st, m, tgt, cmd.kind, th, ev);
      act.phase = 'done';
      endActivation(st, m, ev);
      break;
    }
    case 'end': {
      endActivation(st, m, ev);
      break;
    }
    default: return fail('Unknown command');
  }
  st.seq++;
  return { ok: true, events: ev };
}

function clusterHits(st, n) {
  const T = {
    2: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2], 4: [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4], 5: [1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5],
    6: [2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6], 10: [3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10], 15: [5, 5, 6, 9, 9, 9, 9, 12, 12, 15, 15],
    20: [6, 6, 9, 12, 12, 12, 12, 16, 16, 20, 20],
  };
  const r = roll2d6(st);
  return (T[n] || T[6])[r - 2];
}

function fireWeapons(st, m, tgt, weapons, ev) {
  const dir = attackDirection(st, m.x, m.y, tgt);
  m.f = m.f; // torso stays; arcs already validated
  let volley = 0;
  const startPilot = tgt.pilot.hits;
  for (const w of weapons) {
    if (tgt.dead) break;
    const th = toHit(st, m, tgt, w);
    if (!th.ok) continue;
    const W = WEAPONS[w.t];
    st.act.heatGen += w.heat;
    if (w.ammo > 0) w.ammo--;
    m.stats.shots++;
    const r = roll2d6(st);
    const hit = r >= th.tn;
    const shot = { k: 'shot', id: m.id, target: tgt.id, w: w.i, wt: w.t, tn: th.tn, roll: r, hit, hits: [] };
    ev.push(shot);
    if (!hit) { continue; }
    m.stats.hits++;
    if (W.kind === 'm') {
      const n = clusterHits(st, W.n);
      shot.missiles = n;
      if (W.lrm) {
        let left = n * w.dmg;
        while (left > 0) {
          const d = Math.min(5, left); left -= d;
          const hl = rollLocation(st, dir);
          shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: d });
          applyDamage(st, tgt, hl.loc, hl.rear, d, ev, m, { tac: hl.tac });
          volley += d;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const hl = rollLocation(st, dir);
          shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: w.dmg });
          applyDamage(st, tgt, hl.loc, hl.rear, w.dmg, ev, m, { tac: hl.tac });
          volley += w.dmg;
        }
      }
    } else {
      const hl = rollLocation(st, dir);
      shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: w.dmg });
      if (hl.loc === 0 && !tgt.dead) pilotHit(st, tgt, 1, ev, 'head hit');
      applyDamage(st, tgt, hl.loc, hl.rear, w.dmg, ev, m, { tac: hl.tac });
      volley += w.dmg;
      if (w.t === 15) tgt.heat = Math.min(40, tgt.heat + 2);
    }
  }
  const nh = ev.filter((e) => e.k === 'shot' && e.hit).length;
  log(st, ev, `${m.design} fires ${weapons.length} weapon${weapons.length > 1 ? 's' : ''} at ${tgt.design}: ${nh} hit, ${volley} damage.`, { side: m.side, tone: volley ? 'hit' : 'miss' });
  if (volley >= 20 && !tgt.dead) pilotingCheck(st, tgt, 1, 'heavy damage', ev);
  void startPilot;
}

function physical(st, m, tgt, kind, th, ev) {
  const r = roll2d6(st);
  const hit = r >= th.tn;
  const dir = attackDirection(st, m.x, m.y, tgt);
  let dmg = 0, loc = 2, rear = dir === 'B';
  if (kind === 'punch') {
    const arm = bestPunchArm(m);
    dmg = Math.ceil(m.tons / 10);
    const ah = actuCount(m, arm === 4 ? [30, 31] : [34, 35]);
    dmg = Math.max(1, Math.floor(dmg / (1 + ah)));
    const t = { F: [4, 1, 2, 3, 5, 0], L: [1, 1, 2, 4, 4, 0], R: [3, 3, 2, 5, 5, 0], B: [4, 1, 2, 3, 5, 0] }[dir];
    loc = t[d6(st) - 1];
  } else {
    dmg = Math.ceil(m.tons / 5);
    const t = { F: [7, 7, 7, 6, 6, 6], L: [6, 6, 6, 6, 6, 6], R: [7, 7, 7, 7, 7, 7], B: [7, 7, 7, 6, 6, 6] }[dir];
    loc = t[d6(st) - 1];
  }
  ev.push({ k: 'melee', id: m.id, target: tgt.id, kind, hit, tn: th.tn, roll: r, dmg, loc });
  if (hit) {
    log(st, ev, `${m.design} ${kind === 'punch' ? 'punches' : 'kicks'} ${tgt.design} for ${dmg} damage!`, { side: m.side, tone: 'hit' });
    applyDamage(st, tgt, loc, rear, dmg, ev, m);
    if (loc === 0 && !tgt.dead) pilotHit(st, tgt, 1, ev, 'head hit');
    if (kind === 'kick' && !tgt.dead) pilotingCheck(st, tgt, 0, 'kicked', ev);
  } else {
    log(st, ev, `${m.design}'s ${kind} misses.`, { side: m.side, tone: 'miss' });
    if (kind === 'kick') pilotingCheck(st, m, 0, 'missed kick', ev);
  }
}

// ---------------------------------------------------------------- helpers for UI/AI
export function weaponOptions(st, m, tgt, pos, mode) {
  return m.weapons.map((w) => ({ w, th: toHit(st, m, tgt, w, pos ? { pos, mode } : {}) }));
}
export function expectedDamage(w, p) {
  const W = WEAPONS[w.t];
  const avg = W.kind === 'm' ? ({ 2: 1.4, 4: 2.6, 5: 3.2, 6: 4, 10: 6.3, 15: 9.5, 20: 12.7 }[W.n] || W.n * 0.6) : 1;
  return p * avg * w.dmg;
}
export function totalArmor(m) { return m.armor.reduce((a, b) => a + b, 0) + m.internal.reduce((a, b) => a + b, 0); }
export function maxArmor(m) { return m.armorMax.reduce((a, b) => a + b, 0) + m.internalMax.reduce((a, b) => a + b, 0); }
export { center, facingToward, turnCost, distance };
