// MechForce rules engine. Pure functions over a JSON-serialisable state object.
// The same code runs on the host server, in local games, and inside the AI.
import { MECHS, WEAPONS, MISSIONS, TERRAIN, FRONT_ZONE, REAR_ZONE, TRANSFER, critName, locName,
  SIDE_COLORS, SIDE_NAMES, PILOT_NAMES, mechByName, bodyOf, legLocs, LEG_ACT, CODE_TRACKS, CODE_CONVERSION,
  STRUCTS, LOADOUTS, STRUCT_GUNNERY, CLIMATE, UNITS, UNIT_GUNNERY, AI_LEVELS } from './data.js';
import { sanitizeMap, addDefences, addForces, unitCanStand } from './maps.js';
import { generateMap, deployZone, inMap } from './map.js';
import { buildTemplate, WSTAT } from './custom.js';
import { neighbor, distance, relBearing, line, facingToward, turnCost, center } from './hex.js';
import { nextRand, roll2d6, d6, hashSeed, chance } from './rng.js';
import { sanitizePilot, hasAbility } from './pilots.js';

import { hotGun, magma, smokeAt, tryIgnite } from './environment.js';
import { fireAtUnit, makeUnit, toHitUnit, unitAt } from './forces.js';
import { fireAtStructure, makeStructure, structureAt, toHitStructure } from './structures.js';
import { damageStructure, defenceTargets, defencesFire } from './structures.js';
import { hurtUnit, unitStrength, unitsPhase } from './forces.js';
import { envHeat, envHeatParts, environmentPhase, isBurning, magmaBurn } from './environment.js';
export { envHeat, envHeatParts, isBurning, smokeAt } from './environment.js';
export { makeUnit, toHitUnit, unitAt, unitStrength } from './forces.js';
export { defenceTargets, makeStructure, structureAt, toHitStructure } from './structures.js';

import { applyCrit, pilotingCheck } from './damage.js';
import { PILOT_DEATHS, REACTOR_BREACH_TN, SELF_DESTRUCT_TN, ammoExplosion, applyDamage, destroyMech, eject, fall, pilotHit, pilotingMods, pilotingTN, reactorBlast, rollLocation, tripodLeg } from './damage.js';
import { canEndAt, computeReach, pathFrom, reachKey } from './movement.js';
export { PILOT_DEATHS, REACTOR_BREACH_TN, SELF_DESTRUCT_TN, applyDamage, pilotingCheck, pilotingMods, pilotingTN, reactorBlast, rollLocation } from './damage.js';
export { canEndAt, computeReach, pathFrom, reachKey } from './movement.js';

export const HEAT_MAX = 30;
const ROUND_SECONDS = 50;

// ---------------------------------------------------------------- setup
export function createGame(setup) {
  const mission = MISSIONS.find((m) => m.id === setup.mission) || MISSIONS[0];
  const nSides = Math.max(2, Math.min(setup.sides.length, mission.sides[1]));
  const seed = setup.seed ?? Math.floor(Math.random() * 1e9);
  const custom = setup.customMap ? sanitizeMap(setup.customMap) : null;
  const map = custom ? { ...custom, t: custom.t.slice(), e: custom.e.slice(), s: custom.s.map((d) => ({ ...d })), u: (custom.u || []).map((d) => ({ ...d })) } : generateMap(seed, setup.mapSize || 'M', setup.theme || 'temperate');
  if (custom && setup.theme) map.theme = setup.theme;
  const st = {
    v: 1, seed, gid: String(setup.gid || 'g' + seed), rng: hashSeed('dice' + seed), mission: mission.id, map, round: 0, over: false, fog: !!setup.fog, seen: {},
    structures: [], units: [], fire: {}, smoke: {}, wind: 0, aiLevel: AI_LEVELS[setup.aiLevel] ? setup.aiLevel : 'normal',
    roundLimit: ROUND_LIMITS.includes(setup.roundLimit) ? setup.roundLimit : 'standard',
    sides: [], teams: [], mechs: [], order: [], turnIdx: 0, act: null, item: null, winner: null, log: [], seq: 0,
  };
  const teamOfSide = assignTeams(setup.sides.slice(0, nSides), mission);
  const nTeams = Math.max(...teamOfSide) + 1;
  // structures: from the custom map, or a random battlefield's optional defences
  if (!custom) addDefences(map, seed, nTeams, setup.defences);
  st.structures = (map.s || []).map((d, i) => makeStructure(i, d, nTeams));
  delete map.s;
  // infantry and vehicles: placed on the custom map, plus the setup's conventional forces
  addForces(map, seed, nTeams, setup.forces);
  st.units = (map.u || []).map((d, i) => makeUnit(i, d, nTeams));
  delete map.u;
  st.wind = Math.floor(nextRand(st) * 6);
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
      conceded: false, gunnery: sd.ctrl === 'ai' && AI_LEVELS[setup.aiLevel] ? AI_LEVELS[setup.aiLevel].gun : sd.gunnery ?? 4,
      piloting: sd.ctrl === 'ai' && AI_LEVELS[setup.aiLevel] ? AI_LEVELS[setup.aiLevel].pil : sd.piloting ?? 5,
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
    let zone = deployZone(map, zoneIdx, nTeams).filter((p) => !structureAt(st, p.x, p.y) && !unitAt(st, p.x, p.y));
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
      const given = sd.pilots && sd.pilots[i] ? sanitizePilot(sd.pilots[i]) : null;
      const pilot = given || { name: (typeof entry === 'object' && entry.pilot) || PILOT_NAMES[(pilotIx++) % PILOT_NAMES.length] };
      const f = team === 0 ? 0 : team === 1 ? 3 : team === 2 ? 5 : 1;
      const mech = makeMech(st.mechs.length, s, tpl, pilot, pos.x, pos.y, f, st.sides[s]);
      mech.team = team;
      // campaign mechs arrive with the damage they took last time (never more than full)
      const dmg = sd.damage && sd.damage[i];
      if (dmg && Array.isArray(dmg.armor) && Array.isArray(dmg.internal)) {
        mech.armor = mech.armor.map((v, l) => Math.max(0, Math.min(v, Math.round(Number(dmg.armor[l]) || 0))));
        mech.internal = mech.internal.map((v, l) => Math.max(1, Math.min(v, Math.round(Number(dmg.internal[l]) || 1))));
      }
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
        if (t === 5 || structureAt(st, x, y) || unitAt(st, x, y)) continue;
        const ok = mission.itemZone === 'east' ? x >= Math.floor(w * 0.6) && x <= w - 4
          : mission.itemZone === 'eastish' ? x >= Math.floor(w * 0.58) && x <= Math.floor(w * 0.72) : Math.abs(x - w / 2) <= 2;
        if (ok) cands.push({ x, y });
      }
      pos = cands[Math.floor(nextRand(st) * cands.length)] || { x: w >> 1, y: h >> 1 };
      st.item = { name: mission.item, x: pos.x, y: pos.y, carrier: null, gone: false };
    }
  }
  startRound(st, []);
  updateSighting(st);
  return st;
}

// ---------------------------------------------------------------- fog of war
// With fog of war on, a team only sees enemy mechs that one of its own mechs has line of
// sight to (or is standing next to). Firing gives a mech away to the team it shot at for
// the rest of the round. Wrecks stay visible. Each team remembers where it last saw
// every enemy (st.seen), which the AI and the "last seen" markers use.
export function visibleTo(st, team, m) {
  if (!st.fog || m.dead || (m.team ?? m.side) === team) return true;
  if (m.exited || m.hidden) return false;
  if (m.reveal && m.reveal.r === st.round && m.reveal.t === team) return true;
  for (const f of st.mechs) {
    if ((f.team ?? f.side) !== team || !operational(f) || f.hidden) continue;
    if (distance(f.x, f.y, m.x, m.y) <= 1 || lineOfSight(st, f.x, f.y, m.x, m.y).ok) return true;
  }
  return false;
}
export function hexSeenBy(st, team, x, y, exceptId) {
  for (const f of st.mechs) {
    if ((f.team ?? f.side) !== team || !operational(f) || f.hidden || f.id === exceptId) continue;
    if (distance(f.x, f.y, x, y) <= 1 || lineOfSight(st, f.x, f.y, x, y).ok) return true;
  }
  return false;
}
export function updateSighting(st) {
  if (!st.fog) return;
  st.seen = st.seen || {};
  st.teams.forEach((_, t) => {
    const mem = st.seen[t] = st.seen[t] || {};
    for (const m of st.mechs) if ((m.team ?? m.side) !== t && operational(m) && visibleTo(st, t, m)) mem[m.id] = { x: m.x, y: m.y, f: m.f, r: st.round };
  });
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
    id, side, design: tpl.n, custom: !!tpl.custom, cls: tpl.c, tons: tpl.t, pilot: { name: pilot.name, gun: pilot.gun ?? sd.gunnery, pil: pilot.pil ?? sd.piloting, hits: 0, ko: false,
      ...(pilot.pid ? { pid: pilot.pid, full: pilot.full, abilities: pilot.abilities, portrait: pilot.portrait } : {}) },
    body: tpl.body || 'biped', mot: tpl.mot || null, vmode: 'mech',
    x, y, f, armor: tpl.a.slice(), armorMax: tpl.a.slice(), internal: tpl.i.slice(), internalMax: tpl.i.slice(),
    crit: tpl.cr.map((r) => r.slice()), critHit: tpl.cr.map((r) => r.map(() => 0)),
    weapons, heat: 0, hs: tpl.hs, hsLost: 0, walkBase: tpl.w, jumpBase: tpl.j, jumpLost: 0,
    engineHits: 0, gyroHits: 0, sensorHits: 0, lifeSupport: false, actu: [],
    locGone: tpl.i.map(() => 0), prone: false, shutdown: false, dead: false, exited: false,
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

export function log(st, ev, text, extra) {
  st.log.push(text);
  if (st.fog) { st.logIds = st.logIds || []; st.logIds.push(extra && extra.id !== undefined ? extra.id : -1); if (st.logIds.length > 60) st.logIds.shift(); }
  if (st.log.length > 60) st.log.shift();
  ev.push({ k: 'log', text, ...(extra || {}) });
}

// ---------------------------------------------------------------- derived stats
// Chassis rules follow BattleTech: Total Warfare for bipeds, four-legged mechs and tracks,
// Interstellar Operations for tripods and QuadVees.
function actuCount(m, codes) { return m.actu.filter((c) => codes.includes(c)).length; }
export const isQuadVee = (m) => m.mot === 'quadvee';
export const onTracks = (m) => (m.mot === 'tracks' || m.mot === 'quadvee') && m.vmode === 'vehicle';
export function legState(m) {
  const legs = legLocs(bodyOf(m));
  let legsGone = 0, hips = 0, legAct = 0;
  for (const l of legs) {
    if (m.locGone[l]) { legsGone++; continue; }
    const [hip, ...rest] = LEG_ACT[l];
    if (m.actu.includes(hip)) hips++;
    legAct += actuCount(m, rest);
  }
  return { legsGone, hips, legAct, nLegs: legs.length };
}
function critHitIn(m, loc, code) { const row = m.crit[loc]; return !!row && row.some((c, s) => c === code && m.critHit[loc][s]); }
// Legs whose track (or, on a QuadVee, conversion gear) no longer works
export function badTracks(m) {
  return legLocs(bodyOf(m)).filter((l) => m.locGone[l] || critHitIn(m, l, CODE_TRACKS) || (isQuadVee(m) && critHitIn(m, l, CODE_CONVERSION))).length;
}
// Walking MP on legs
export function walkMP(m) {
  if (!canAct(m) || (isQuadVee(m) && m.vmode === 'vehicle')) return 0;
  const body = bodyOf(m);
  const { legsGone, hips, legAct } = legState(m);
  if (m.gyroHits >= 2 || m.engineHits >= 3) return 0;
  if (body === 'quad' ? legsGone >= 3 : legsGone >= 2) return 0;
  let w = m.walkBase - legAct - Math.floor(m.heat / 5);
  if (hips) w = Math.ceil(w / (2 * hips));
  if (body === 'quad') { if (legsGone === 1) w -= 1; else if (legsGone === 2) w = Math.min(w, 1); }
  else if (legsGone) w = Math.min(w, 1);
  return Math.max(0, w);
}
export function runMP(m) {
  const { legsGone } = legState(m);
  if (legsGone && !(bodyOf(m) === 'quad' && legsGone === 1)) return walkMP(m);
  return Math.ceil(walkMP(m) * 1.5);
}
export function jumpMP(m) {
  if (!canAct(m) || m.prone || (isQuadVee(m) && m.vmode === 'vehicle')) return 0;
  const { legsGone } = legState(m);
  let j = m.jumpBase - m.jumpLost;
  if (legsGone) j = Math.floor(j / 2);
  return Math.max(0, j);
}
// Tracked movement: BattleMech tracks (cruise speed only) or a QuadVee in vehicle mode.
// Each lost leg or track takes away its share of the speed; leg actuator and gyro damage don't matter.
export function trackMP(m) {
  if (!canAct(m) || !m.mot || m.engineHits >= 3) return 0;
  if (isQuadVee(m) && m.vmode !== 'vehicle') return 0;
  const n = legLocs(bodyOf(m)).length, bad = badTracks(m);
  if (bad >= n) return 0;
  let mp = m.walkBase;
  mp -= Math.floor(mp * bad / n);
  return Math.max(0, mp - Math.floor(m.heat / 5));
}
export function flankMP(m) { return isQuadVee(m) && m.vmode === 'vehicle' ? Math.ceil(trackMP(m) * 1.5) : 0; }
// QuadVee conversion: 2 MP, +1 per damaged leg actuator, conversion gear or track
export function conversionCost(m) {
  let c = 2;
  for (const l of legLocs(bodyOf(m))) m.crit[l].forEach((code, s) => { if (m.critHit[l][s] && (LEG_ACT[l].includes(code) || code === CODE_TRACKS || code === CODE_CONVERSION)) c++; });
  return c;
}
export function canConvert(st, m) {
  if (!isQuadVee(m) || m.prone || !canAct(m)) return false;
  return availMP(m, m.vmode === 'vehicle' ? 'cruise' : 'walk') >= conversionCost(m);
}
// Movement modes this mech can use right now. Legs: walk/run/jump; BattleMech tracks add
// 'track' (cruise only); a QuadVee in vehicle mode has 'cruise' and 'flank' instead.
export const MOVE_HEAT = { walk: 1, run: 2, track: 1, cruise: 0, flank: 0 };
export function moveModes(m) {
  if (isQuadVee(m) && m.vmode === 'vehicle') return ['cruise', 'flank'];
  return m.mot === 'tracks' ? ['walk', 'run', 'jump', 'track'] : ['walk', 'run', 'jump'];
}
export function availMP(m, mode) {
  return mode === 'jump' ? jumpMP(m) : mode === 'run' ? runMP(m) : mode === 'track' || mode === 'cruise' ? trackMP(m) : mode === 'flank' ? flankMP(m) : walkMP(m);
}
// What a mode counts as for to-hit purposes
export const moveKind = (mode) => (mode === 'track' || mode === 'cruise' ? 'walk' : mode === 'flank' ? 'run' : mode);
export function dissipation(st, m) {
  const t = tileOf(st, m.x, m.y);
  const depth = st.map.theme === 'volcanic' ? 0 : (TERRAIN[t] && TERRAIN[t].depth) || 0;
  return Math.max(0, m.hs - m.hsLost) + depth * 2;
}
export function heatToHit(h) { return h >= 24 ? 4 : h >= 17 ? 3 : h >= 13 ? 2 : h >= 8 ? 1 : 0; }

// ---------------------------------------------------------------- line of sight & to-hit
export function lineOfSight(st, ax, ay, bx, by) {
  const hexes = line(ax, ay, bx, by);
  const ea = elevOf(st, ax, ay) + 1.6, eb = elevOf(st, bx, by) + 1.0;
  let woods = 0, smoke = 0;
  const n = hexes.length - 1;
  for (let i = 1; i < n; i++) {
    const hx = hexes[i];
    const lh = ea + (eb - ea) * (i / n);
    const sb = st.structures && structureAt(st, hx.x, hx.y);
    const e = elevOf(st, hx.x, hx.y) + (sb ? sb.h * 0.9 : 0);
    if (e >= lh) return { ok: false, woods, smoke, block: hx, hexes };
    const wd = TERRAIN[tileOf(st, hx.x, hx.y)].woods;
    if (wd && e + 1.3 > lh) woods += wd;
    const sm = st.smoke ? smokeAt(st, hx.x, hx.y) : 0;
    if (sm) smoke += sm;
    if (woods + smoke >= 3) return { ok: false, woods, smoke, block: hx, hexes };
  }
  return { ok: true, woods, smoke, hexes };
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
  if (wloc === -1) return true; // emplacement turrets turn all the way round
  const arms = bodyOf(att) !== 'quad'; // a quad's front legs fire straight ahead
  if (arms && wloc === 4) return rel >= -120.01 && rel <= 60.01;
  if (arms && wloc === 5) return rel >= -60.01 && rel <= 120.01;
  return Math.abs(rel) <= 60.01;
}

function moveMod(lm) {
  const n = lm.hexes;
  let v = n >= 18 ? 5 : n >= 10 ? 4 : n >= 7 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0;
  if (lm.mode === 'jump') v += 1;
  return v;
}

function armMods(m, loc) {
  if ((loc !== 4 && loc !== 5) || bodyOf(m) === 'quad') return 0;
  const base = loc === 4 ? 29 : 33;
  if (m.actu.includes(base)) return 4;
  return actuCount(m, [base + 1, base + 2]);
}

// Full to-hit breakdown. pos/mode let the AI evaluate hypothetical positions.
export function toHit(st, att, tgt, w, opts = {}) {
  const pos = opts.pos || att;
  const mode = moveKind(opts.mode || (st.act && st.act.id === att.id ? att.lastMove.mode : 'stand'));
  const mods = [];
  const add = (label, v) => { if (v) mods.push({ label, v }); };
  if (!operational(tgt) || !isEnemy(tgt, att)) return { ok: false, reason: 'Invalid target', tn: 99, mods };
  if (tgt.hidden || tgt.x < 0) return { ok: false, reason: 'No line of sight', tn: 99, mods };
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
    const half = hasAbility(att, 'sniper') ? 2 : 1;
    add(dist <= s ? '' : (dist <= md ? 'Medium range' : 'Long range') + (half > 1 ? ' (Sniper)' : ''), (dist <= s ? 0 : dist <= md ? 2 : 4) / half);
    const kind = WEAPONS[w.t].kind;
    if (hasAbility(att, 'spec_' + kind)) add({ e: 'Energy Specialist', b: 'Gunslinger', m: 'Missile Specialist' }[kind], -1);
    if (w.minr && dist <= w.minr) add('Minimum range', w.minr - dist + 1);
    add('Arm actuators', armMods(att, w.loc));
  } else {
    if (dist !== 1) return { ok: false, reason: 'Not adjacent', tn: 99, mods, dist };
    const dfa = opts.kind === 'dfa';
    // death from above: the attacker comes down on the target from a jump, so arc and
    // height don't matter, but it has to have jumped this turn
    if (dfa && mode !== 'jump') return { ok: false, reason: 'Jump first', tn: 99, mods, dist };
    if (dfa && !tgt.prone && elevOf(st, tgt.x, tgt.y) > elevOf(st, pos.x, pos.y)) return { ok: false, reason: 'Target is higher', tn: 99, mods, dist };
    if (!dfa && !inArc(att, 2, tgt.x, tgt.y, pos)) return { ok: false, reason: 'Out of arc', tn: 99, mods, dist };
    if (!dfa && Math.abs(elevOf(st, pos.x, pos.y) - elevOf(st, tgt.x, tgt.y)) > 1) return { ok: false, reason: 'Elevation', tn: 99, mods, dist };
    if (onTracks(att) && isQuadVee(att)) return { ok: false, reason: 'Vehicle mode', tn: 99, mods, dist };
    tn = att.pilot.pil; mods.length = 0; mods.push({ label: 'Piloting', v: att.pilot.pil });
    if (opts.kind === 'kick') add('Kick', -2);
    if (hasAbility(att, 'melee')) add('Melee Specialist', -1);
    if (opts.kind === 'punch') {
      const arm = bestPunchArm(att);
      if (arm < 0) return { ok: false, reason: bodyOf(att) === 'quad' ? 'Four-legged' : 'No arms', tn: 99, mods, dist };
      add('Arm actuators', armMods(att, arm));
    }
    if (opts.kind === 'kick' && legState(att).legsGone) return { ok: false, reason: 'Leg destroyed', tn: 99, mods, dist };
  }
  add({ walk: 'You walked', run: 'You ran', jump: hasAbility(att, 'jumpjack') ? 'You jumped (Jumping Jack)' : 'You jumped' }[mode] || '', { walk: 1, run: 2, jump: hasAbility(att, 'jumpjack') ? 1 : 3 }[mode] || 0);
  add('Target movement', moveMod(tgt.lastMove));
  if (tgt.prone) add('Target prone', dist <= 1 ? -2 : 1);
  if (tgt.shutdown || tgt.pilot.ko) add('Target immobile', -4);
  if (tgt.infantry) add('Infantry', 1);
  // death from above comes down from the sky: woods, smoke and cover don't affect it
  const fromAbove = opts.kind === 'dfa' && !w;
  if (!fromAbove) {
    add('Woods', los.woods + TERRAIN[tileOf(st, tgt.x, tgt.y)].woods);
    add('Smoke', (los.smoke || 0) + (st.smoke ? smokeAt(st, tgt.x, tgt.y) : 0));
    if (TERRAIN[tileOf(st, tgt.x, tgt.y)].depth) add('Partial cover', 1);
  }
  add('Heat', heatToHit(att.heat));
  add('Sensors damaged', att.sensorHits * 2);
  if (att.prone) add('You are prone', 2);
  tn = mods.reduce((s, m) => s + m.v, 0);
  return { ok: true, tn, p: chance(tn), mods: mods.filter((m) => m.label), dist, los };
}

function bestPunchArm(m) {
  let best = -1, bm = 99;
  if (bodyOf(m) === 'quad') return -1;
  for (const loc of [4, 5]) {
    if (m.locGone[loc]) continue;
    const md = armMods(m, loc);
    if (md < 4 && md < bm) { bm = md; best = loc; }
  }
  return best;
}

// ---------------------------------------------------------------- objective helpers
export function setWinner(st, ev, team, reason) {
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
      log(st, ev, `${m.design} picks up the ${it.name}!`, { tone: 'info', id: m.id, side: m.side });
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
    log(st, ev, `${m.design} leaves the battlefield.`, { tone: 'info', id: m.id, side: m.side });
    if (winNow) setWinner(st, ev, m.team, winNow);
    return true;
  }
  return false;
}

export function checkVictory(st, ev) {
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
    const quit = st.teams.some((t, i) => i !== s && t.members.length && t.members.every((m) => st.sides[m].conceded || !st.mechs.some((x) => x.side === m && operational(x))) && t.members.some((m) => st.sides[m].conceded));
    return setWinner(st, ev, s, quit ? 'The enemy withdrew from the field.' : 'All enemy mechs neutralized.');
  }
}

// The battle's round limit: the mission's own, half again as long, or none at all. Hold
// Position is won by holding out, so its limit never changes. 0 means no limit.
export const ROUND_LIMITS = ['standard', 'long', 'none'];
export function maxRounds(st) {
  const mis = missionOf(st);
  if (mis.id === 'hold' || !st.roundLimit || st.roundLimit === 'standard') return mis.rounds;
  return st.roundLimit === 'long' ? Math.round(mis.rounds * 1.5) : 0;
}
function roundLimit(st, ev) {
  const mis = missionOf(st);
  const lim = maxRounds(st);
  if (!lim || st.round <= lim) return false;
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
  // highest roll moves last (an advantage); a Tactical Genius adds 1 for the side
  const genius = (i) => (st.mechs.some((m) => m.side === i && canAct(m) && hasAbility(m, 'tactical')) ? 1 : 0);
  const rolls = st.sides.map((s, i) => ({ i, r: roll2d6(st) + genius(i) + nextRand(st) * 0.5 }));
  st.sides.forEach((s, i) => { s.init = Math.floor(rolls[i].r); });
  st.order = rolls.filter((r) => sideAlive(st, r.i)).sort((a, b) => a.r - b.r).map((r) => r.i);
  ev.push({ k: 'init', order: st.order.slice(), rolls: st.sides.map((s) => s.init) });
  log(st, ev, `— Round ${st.round} (T+${secondsElapsed(st)}s) — Initiative: ${st.order.map((i) => st.sides[i].name).join(' → ')}`, { tone: 'round' });
  for (const m of st.mechs) {
    m.activated = false;
    if (!operational(m)) continue;
    if (m.pilot.ko) {
      const tn = [0, 3, 5, 7, 10, 11][Math.min(5, m.pilot.hits)];
      if (roll2d6(st) >= tn) { m.pilot.ko = false; log(st, ev, `${m.pilot.name} wakes up.`, { id: m.id, side: m.side }); ev.push({ k: 'wake', id: m.id }); }
      else { m.activated = true; m.lastMove = { mode: 'stand', hexes: 0 }; coolDown(st, m, ev); }
    }
    if (m.shutdown && !m.dead) {
      m.activated = true; m.lastMove = { mode: 'stand', hexes: 0 };
      coolDown(st, m, ev);
      const tn = shutdownTN(m.heat);
      if (m.heat < 30 && (tn === 0 || roll2d6(st) >= tn)) { m.shutdown = false; log(st, ev, `${m.design} restarts its reactor.`, { id: m.id, side: m.side }); ev.push({ k: 'restart', id: m.id }); }
    }
  }
  st.turnIdx = 0;
  if (!hasAvailable(st, st.order[0])) nextTurn(st, ev, true);
}

function coolDown(st, m, ev) {
  m.heat = Math.max(0, m.heat - dissipation(st, m) + m.engineHits * 5 + envHeat(st, m));
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
  if (st.round > 0) {
    defencesFire(st, ev);
    if (st.over) return;
    unitsPhase(st, ev);
    if (st.over) return;
    environmentPhase(st, ev);
    checkVictory(st, ev);
    if (st.over) return;
  }
  startRound(st, ev);
}

function endActivation(st, m, ev) {
  const act = st.act;
  st.act = null;
  m.activated = true;
  if (operational(m)) {
    const before = m.heat;
    const gen = (act ? act.heatGen : 0) + m.engineHits * 5 + envHeat(st, m);
    magmaBurn(st, m, ev);
    m.heat = Math.max(0, Math.min(40, m.heat + gen - dissipation(st, m)));
    ev.push({ k: 'heat', id: m.id, heat: m.heat, gen, from: before });
    if (m.heat >= 14 && !m.shutdown) {
      const tn = shutdownTN(m.heat - (hasAbility(m, 'hotdog') ? 3 : 0));
      const r = roll2d6(st);
      if (r < tn) {
        m.shutdown = true;
        ev.push({ k: 'shutdown', id: m.id });
        log(st, ev, `${m.design} overheats and SHUTS DOWN! (heat ${m.heat})`, { tone: 'bad', id: m.id, side: m.side });
      }
    }
    const at = ammoTN(m.heat - (hasAbility(m, 'hotdog') ? 3 : 0));
    if (at && roll2d6(st) < at) {
      const w = m.weapons.find((w) => w.ammo > 0);
      if (w) { log(st, ev, `${m.design}'s ammo cooks off from the heat!`, { tone: 'crit', id: m.id, side: m.side }); ammoExplosion(st, m, w, ev, null); }
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
      if (!moveModes(m).includes(mode)) return fail('Bad mode');
      const convert = !!cmd.convert;
      if (convert && !canConvert(st, m)) return fail('Cannot convert now');
      const reach = computeReach(st, m, mode, { convert });
      const k = reachKey(reach, cmd.x, cmd.y, cmd.f);
      if (!inMap(st.map, cmd.x, cmd.y) || !isFinite(reach.cost[k]) || !canEndAt(st, m, cmd.x, cmd.y, reach)) return fail('Unreachable');
      const path = pathFrom(reach, cmd.x, cmd.y, cmd.f);
      const hexes = reach.steps[k];
      const wasProne = m.prone && mode !== 'jump';
      if (wasProne) m.prone = false;
      m.x = cmd.x; m.y = cmd.y; m.f = cmd.f;
      const moved = hexes > 0 || path.length > 1;
      const realMode = !moved ? 'stand' : mode;
      m.lastMove = { mode: realMode, hexes };
      // a QuadVee generates no movement heat in vehicle mode, but does while converting
      const heatMode = convert && moved ? moveKind(realMode) : realMode;
      act.heatGen += realMode === 'jump' ? Math.max(3, hexes) : MOVE_HEAT[heatMode] || 0;
      act.phase = 'attack';
      ev.push({ k: 'move', id: m.id, path, mode: realMode, vmode: m.vmode });
      if (wasProne) log(st, ev, `${m.design} stands up.`, { id: m.id, side: m.side });
      if (realMode !== 'jump' && !magma(st)) {
        for (let i = 1; i < path.length && !m.prone && !m.dead; i++) {
          const a = path[i - 1], b = path[i];
          if (a.x === b.x && a.y === b.y) continue;
          const d = TERRAIN[tileOf(st, b.x, b.y)].depth || 0;
          if (d && !(TERRAIN[tileOf(st, a.x, a.y)].depth >= d)) pilotingCheck(st, m, d === 1 ? -1 : 0, 'entering water', ev);
        }
      }
      if (m.mot === 'tracks' && mode !== 'jump') {
        const nm = mode === 'track' ? 'vehicle' : 'mech';
        if (nm !== m.vmode) { m.vmode = nm; ev.push({ k: 'mode', id: m.id, vmode: nm }); }
      }
      if (convert) {
        m.vmode = m.vmode === 'vehicle' ? 'mech' : 'vehicle';
        ev.push({ k: 'convert', id: m.id, vmode: m.vmode });
        log(st, ev, `${m.design} converts to ${m.vmode === 'vehicle' ? 'vehicle' : 'BattleMech'} mode.`, { id: m.id, side: m.side, tone: 'info' });
      }
      if (realMode === 'jump' && legState(m).legsGone + m.gyroHits > 0) pilotingCheck(st, m, 0, 'landing', ev);
      if (afterMove(st, m, ev)) { if (!st.over) { st.act = act; endActivation(st, m, ev); } break; }
      if (m.dead) { endActivation(st, m, ev); }
      break;
    }
    case 'attack': {
      if (act.phase === 'done') return fail('Already attacked');
      if (cmd.unit !== undefined) {
        const u = (st.units || [])[cmd.unit];
        if (!u || u.dead || u.hidden || u.team === m.team) return fail('Bad target');
        if (act.phase === 'move') act.phase = 'attack';
        const usable = (cmd.weapons || []).map((i) => m.weapons[i]).filter((w) => w && toHitUnit(st, m, u, w).ok);
        if (!usable.length) return fail('No weapon can fire');
        fireAtUnit(st, m, u, usable, ev);
        act.phase = 'done';
        endActivation(st, m, ev);
        break;
      }
      if (cmd.structure !== undefined) {
        const s = (st.structures || [])[cmd.structure];
        if (!s || s.dead || s.team === m.team) return fail('Bad target');
        if (act.phase === 'move') act.phase = 'attack';
        const usable = (cmd.weapons || []).map((i) => m.weapons[i]).filter((w) => w && toHitStructure(st, m, s, w).ok);
        if (!usable.length) return fail('No weapon can fire');
        fireAtStructure(st, m, s, usable, ev);
        act.phase = 'done';
        endActivation(st, m, ev);
        break;
      }
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
      if (!['punch', 'kick', 'dfa'].includes(cmd.kind)) return fail('Unknown attack');
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
    // Abandon the mech: the pilot punches out and the mech is out of the battle
    case 'eject': {
      if (m.pilot.ko) return fail('Pilot is unconscious');
      log(st, ev, `${m.pilot.name} abandons the ${m.design}!`, { tone: 'bad', id: m.id, side: m.side });
      st.act = null; m.activated = true;
      eject(st, m, ev, 0);
      destroyMech(st, m, ev, null, 'abandoned');
      checkVictory(st, ev);
      if (!st.over) nextTurn(st, ev);
      break;
    }
    // Override the reactor safeties and eject: on 5+ the engine blows like a breach
    case 'selfdestruct': {
      if (m.pilot.ko) return fail('Pilot is unconscious');
      const r = roll2d6(st);
      ev.push({ k: 'selfdestruct', id: m.id, ok: r >= SELF_DESTRUCT_TN, roll: r, tn: SELF_DESTRUCT_TN });
      if (r < SELF_DESTRUCT_TN) {
        log(st, ev, `${m.pilot.name} tries to override the ${m.design}'s reactor, but the safeties hold.`, { tone: 'miss', id: m.id, side: m.side });
        endActivation(st, m, ev);
        break;
      }
      log(st, ev, `${m.pilot.name} overrides the ${m.design}'s reactor safeties and punches out!`, { tone: 'crit', id: m.id, side: m.side });
      st.act = null; m.activated = true;
      eject(st, m, ev, 0);
      destroyMech(st, m, ev, null, 'self-destruct');
      checkVictory(st, ev);
      if (!st.over) nextTurn(st, ev);
      break;
    }
    default: return fail('Unknown command');
  }
  st.seq++;
  updateSighting(st);
  return { ok: true, events: ev };
}

export function clusterHits(st, n, by) {
  const T = {
    2: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2], 4: [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4], 5: [1, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5],
    6: [2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6], 10: [3, 3, 4, 6, 6, 6, 6, 8, 8, 10, 10], 15: [5, 5, 6, 9, 9, 9, 9, 12, 12, 15, 15],
    20: [6, 6, 9, 12, 12, 12, 12, 16, 16, 20, 20],
  };
  const r = Math.min(12, roll2d6(st) + (hasAbility(by, 'cluster') ? 1 : 0));
  return (T[n] || T[6])[r - 2];
}

// Damage from one weapon that hit (missile clusters, LRM 5-point groups, head hits, flamer heat)
export function landHits(st, w, tgt, dir, shot, ev, by) {
  const W = WEAPONS[w.t];
  let volley = 0;
  if (W.kind === 'm') {
    const n = clusterHits(st, W.n, by);
    shot.missiles = n;
    if (W.lrm) {
      let left = n * w.dmg;
      while (left > 0 && !tgt.dead) {
        const d = Math.min(5, left); left -= d;
        const hl = rollLocation(st, dir, tgt);
        shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: d });
        applyDamage(st, tgt, hl.loc, hl.rear, d, ev, by, { tac: hl.tac });
        volley += d;
      }
    } else {
      for (let i = 0; i < n && !tgt.dead; i++) {
        const hl = rollLocation(st, dir, tgt);
        shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: w.dmg });
        applyDamage(st, tgt, hl.loc, hl.rear, w.dmg, ev, by, { tac: hl.tac });
        volley += w.dmg;
      }
    }
  } else {
    const hl = rollLocation(st, dir, tgt);
    shot.hits.push({ loc: hl.loc, rear: hl.rear, dmg: w.dmg });
    if (hl.loc === 0 && !tgt.dead) pilotHit(st, tgt, 1, ev, 'head hit');
    applyDamage(st, tgt, hl.loc, hl.rear, w.dmg, ev, by, { tac: hl.tac });
    volley += w.dmg;
    if (w.t === 15) tgt.heat = Math.min(40, tgt.heat + 2);
  }
  return volley;
}

function fireWeapons(st, m, tgt, weapons, ev) {
  const dir = attackDirection(st, m.x, m.y, tgt);
  m.reveal = { r: st.round, t: tgt.team ?? tgt.side };
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
    hotGun(st, w, tgt.x, tgt.y, hit, ev);
    if (!hit) { continue; }
    m.stats.hits++;
    volley += landHits(st, w, tgt, dir, shot, ev, m);
  }
  const nh = ev.filter((e) => e.k === 'shot' && e.hit).length;
  log(st, ev, `${m.design} fires ${weapons.length} weapon${weapons.length > 1 ? 's' : ''} at ${tgt.design}: ${nh} hit, ${volley} damage.`, { id: m.id, side: m.side, tone: volley ? 'hit' : 'miss' });
  if (volley >= 20 && !tgt.dead) pilotingCheck(st, tgt, 1, 'heavy damage', ev);
  void startPilot;
}

// Hit locations for punches (upper body) and kicks (the legs facing the attacker)
const punchLoc = (st, dir) => ({ F: [4, 1, 2, 3, 5, 0], L: [1, 1, 2, 4, 4, 0], R: [3, 3, 2, 5, 5, 0], B: [4, 1, 2, 3, 5, 0] }[dir])[d6(st) - 1];
function kickLoc(st, tgt, dir) {
  const tb = bodyOf(tgt);
  if (tb === 'tripod') return tripodLeg(st, dir);
  const t = tb === 'quad'
    ? { F: [5, 5, 5, 4, 4, 4], L: [4, 4, 4, 6, 6, 6], R: [5, 5, 5, 7, 7, 7], B: [7, 7, 7, 6, 6, 6] }[dir]
    : { F: [7, 7, 7, 6, 6, 6], L: [6, 6, 6, 6, 6, 6], R: [7, 7, 7, 7, 7, 7], B: [7, 7, 7, 6, 6, 6] }[dir];
  return t[d6(st) - 1];
}
// Damage in 5-point groups, each to a new location
export function groupDamage(st, tgt, total, pick, rear, ev, by) {
  const locs = [];
  while (total > 0 && !tgt.dead) {
    const d = Math.min(5, total); total -= d;
    const loc = pick();
    locs.push(loc);
    applyDamage(st, tgt, loc, rear, d, ev, by);
    if (loc === 0 && !tgt.dead) pilotHit(st, tgt, 1, ev, 'head hit');
  }
  return locs;
}

// Death from above (Total Warfare): a mech that jumped this turn lands on an adjacent enemy.
// Piloting roll to hit; the target takes tonnage/10 x 3 to the upper body, the attacker
// tonnage/5 to its own legs, and both must keep their balance. A miss means the attacker
// crashes to the ground as if it fell two levels.
export const dfaDamage = (m) => Math.ceil(m.tons / 10) * 3 + (hasAbility(m, 'melee') ? 1 : 0);
export const dfaSelfDamage = (m) => Math.ceil(m.tons / 5);
function deathFromAbove(st, m, tgt, th, ev) {
  m.reveal = { r: st.round, t: tgt.team ?? tgt.side };
  const r = roll2d6(st);
  const hit = r >= th.tn;
  const dir = attackDirection(st, m.x, m.y, tgt);
  const dmg = dfaDamage(m);
  ev.push({ k: 'melee', id: m.id, target: tgt.id, kind: 'dfa', hit, tn: th.tn, roll: r, dmg: hit ? dmg : 0, loc: -1 });
  if (hit) {
    log(st, ev, `DEATH FROM ABOVE! ${m.design} lands on ${tgt.design} for ${dmg} damage!`, { id: m.id, side: m.side, tone: 'hit' });
    groupDamage(st, tgt, dmg, () => (bodyOf(tgt) === 'quad' && !tgt.prone ? kickLoc(st, tgt, dir) : punchLoc(st, dir)), dir === 'B', ev, m);
    if (!tgt.dead) pilotingCheck(st, tgt, 2, 'death from above', ev);
    if (!m.dead) {
      log(st, ev, `${m.design}'s legs take ${dfaSelfDamage(m)} damage from the impact.`, { id: m.id, side: m.side });
      groupDamage(st, m, dfaSelfDamage(m), () => kickLoc(st, m, 'F'), false, ev, null);
      if (!m.dead) pilotingCheck(st, m, 4, 'landing a death from above', ev);
    }
  } else {
    log(st, ev, `${m.design} misses its death from above and crashes to the ground!`, { id: m.id, side: m.side, tone: 'miss' });
    fall(st, m, ev, 'missed death from above', 2);
  }
}

function physical(st, m, tgt, kind, th, ev) {
  if (kind === 'dfa') { deathFromAbove(st, m, tgt, th, ev); return; }
  m.reveal = { r: st.round, t: tgt.team ?? tgt.side };
  const r = roll2d6(st);
  const hit = r >= th.tn;
  const dir = attackDirection(st, m.x, m.y, tgt);
  let dmg = 0, loc = 2, rear = dir === 'B';
  if (kind === 'punch') {
    const arm = bestPunchArm(m);
    dmg = Math.ceil(m.tons / 10);
    const ah = actuCount(m, arm === 4 ? [30, 31] : [34, 35]);
    dmg = Math.max(1, Math.floor(dmg / (1 + ah))) + (hasAbility(m, 'melee') ? 1 : 0);
    loc = punchLoc(st, dir);
  } else {
    dmg = Math.ceil(m.tons / 5) + (hasAbility(m, 'melee') ? 1 : 0);
    loc = kickLoc(st, tgt, dir);
  }
  ev.push({ k: 'melee', id: m.id, target: tgt.id, kind, hit, tn: th.tn, roll: r, dmg, loc });
  if (hit) {
    log(st, ev, `${m.design} ${kind === 'punch' ? 'punches' : 'kicks'} ${tgt.design} for ${dmg} damage!`, { id: m.id, side: m.side, tone: 'hit' });
    applyDamage(st, tgt, loc, rear, dmg, ev, m);
    if (loc === 0 && !tgt.dead) pilotHit(st, tgt, 1, ev, 'head hit');
    if (kind === 'kick' && !tgt.dead) pilotingCheck(st, tgt, 0, 'kicked', ev);
  } else {
    log(st, ev, `${m.design}'s ${kind} misses.`, { id: m.id, side: m.side, tone: 'miss' });
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

// internal hooks for tests
export const __test = { applyCrit: (...a) => applyCrit(...a) };
