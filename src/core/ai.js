// Computer opponent. Returns one command at a time for the active AI side.
import { WEAPONS, TERRAIN } from './data.js';
import { computeReach, canEndAt, toHit, availableMechs, operational, canAct, lineOfSight, inArc, missionOf,
  expectedDamage, dissipation, totalArmor, maxArmor, tileOf, activeSide, moveModes, moveKind, availMP, canConvert, MOVE_HEAT, visibleTo, toHitStructure, envHeat, smokeAt, isBurning, defenceTargets, dfaDamage, dfaSelfDamage, pilotingMods, elevOf } from './rules.js';
import { STRUCTS } from './data.js';
import { distance, relBearing } from './hex.js';
import { chance, nextRand } from './rng.js';

function moveMod(mode, hexes) {
  let v = hexes >= 18 ? 5 : hexes >= 10 ? 4 : hexes >= 7 ? 3 : hexes >= 5 ? 2 : hexes >= 3 ? 1 : 0;
  return v + (mode === 'jump' ? 1 : 0);
}

// With fog of war the computer only knows about enemies its team can see
const knownEnemies = (st, m) => st.mechs.filter((e) => operational(e) && e.team !== m.team && visibleTo(st, m.team, e));
// ...and otherwise hunts towards where it last saw one, or the middle of the map
function searchGoal(st, m) {
  const mem = st.seen && st.seen[m.team];
  let best = null;
  if (mem) for (const [id, g] of Object.entries(mem)) {
    const e = st.mechs[id];
    if (!e || !operational(e)) continue;
    const score = g.r * 10 - distance(m.x, m.y, g.x, g.y);
    if (!best || score > best.score) best = { x: g.x, y: g.y, score };
  }
  if (best && distance(m.x, m.y, best.x, best.y) > 1) return { x: best.x, y: best.y, weight: 1.2 };
  return { x: st.map.w >> 1, y: st.map.h >> 1, weight: 0.8 };
}

function goalFor(st, m) {
  const mis = missionOf(st);
  const { w } = st.map;
  const it = st.item;
  if (mis.id === 'crossing' && m.team === 0) return { x: w - 1, y: m.y, weight: 3, edge: 'E' };
  if (it && !it.gone) {
    if (it.carrier === m.id) {
      if (mis.homeExit) return { x: m.team === 0 ? 0 : w - 1, y: m.y, weight: 4, edge: m.team === 0 ? 'W' : 'E' };
      if (mis.id === 'pepsi') return { x: m.team === 0 ? w - 1 : 0, y: m.y, weight: 4, edge: m.team === 0 ? 'E' : 'W' };
      if (mis.spy) return { x: w - 1, y: m.y, weight: 4, edge: 'E' };
    }
    if (it.carrier === null && (mis.carriers.includes(m.team) || (mis.spy && m.team === 0))) return { x: it.x, y: it.y, weight: 2.5 };
    if (it.carrier !== null) {
      const c = st.mechs[it.carrier];
      if (c && c.team !== m.team) return { x: c.x, y: c.y, weight: 1.5, hunt: c.id };
      if (c && c.team === m.team) return { x: c.x, y: c.y, weight: 0.6 };
    }
  }
  if (mis.scout && m.team === 0) {
    if (m.scouted) return { x: 0, y: m.y, weight: 4, edge: 'W' };
    return { x: Math.floor(w * 2 / 3) + 1, y: m.y, weight: 2.5 };
  }
  return null;
}

function heatBudget(st, m, moveHeat) {
  return dissipation(st, m) - m.heat - moveHeat + 4;
}

function bestVolley(opts, budget) {
  // opts: [{w, ed, heat}] choose greedily by damage per heat within budget
  const free = opts.filter((o) => o.heat <= 0);
  const hot = opts.filter((o) => o.heat > 0).sort((a, b) => b.ed / b.heat - a.ed / a.heat);
  let dmg = free.reduce((s, o) => s + o.ed, 0), heat = 0;
  const picked = free.slice();
  for (const o of hot) { if (heat + o.heat <= budget) { heat += o.heat; dmg += o.ed; picked.push(o); } }
  return { dmg, heat, picked };
}

function evalPositions(st, m) {
  const enemies = knownEnemies(st, m);
  const allies = st.mechs.filter((e) => operational(e) && e.team === m.team && e.id !== m.id);
  const goal = goalFor(st, m) || (st.fog && !enemies.length ? searchGoal(st, m) : null);
  const { w, h } = st.map;
  const avgRange = m.weapons.filter((x) => x.ok).reduce((s, x) => s + x.rng, 0) / Math.max(1, m.weapons.filter((x) => x.ok).length) || 6;
  const optRange = Math.max(1, Math.min(9, Math.round(avgRange * 0.5)));
  const hexCache = new Map();
  const hexInfo = (x, y) => {
    const key = y * w + x;
    if (hexCache.has(key)) return hexCache.get(key);
    const info = enemies.map((e) => {
      const los = lineOfSight(st, x, y, e.x, e.y);
      return { e, los, d: distance(x, y, e.x, e.y) };
    });
    hexCache.set(key, info);
    return info;
  };
  const myWoods = (x, y) => TERRAIN[tileOf(st, x, y)].woods + (TERRAIN[tileOf(st, x, y)].depth === 1 ? 1 : 0) + smokeAt(st, x, y);
  // enemy gun emplacements and bunkers: they shoot back at the end of the round, and are
  // worth knocking out when there's nothing better to shoot
  const forts = (st.structures || []).filter((s) => !s.dead && s.team !== m.team && (s.team >= 0 || STRUCTS[s.kind].slots));
  const armedForts = forts.filter((s) => s.team >= 0 && s.weapons.some((w) => w.ok && w.ammo !== 0));
  const fortInfo = new Map();
  const fortAt = (x, y) => {
    const key = y * w + x;
    if (!fortInfo.has(key)) fortInfo.set(key, armedForts.map((s) => ({ s, los: lineOfSight(st, s.x, s.y, x, y), d: distance(x, y, s.x, s.y) })));
    return fortInfo.get(key);
  };
  const best = { score: -1e9, cmd: null };
  const fragile = totalArmor(m) / maxArmor(m);
  // QuadVees also weigh converting: vehicle mode makes no movement heat and can't fall,
  // BattleMech mode can kick and jump
  const plans = moveModes(m).map((mode) => ({ mode, convert: false }));
  if (canConvert(st, m)) for (const mode of moveModes(m)) if (mode !== 'jump') plans.push({ mode, convert: true });
  let nearest = 99;
  for (const e of enemies) nearest = Math.min(nearest, distance(m.x, m.y, e.x, e.y));
  for (const { mode, convert } of plans) {
    const reach = computeReach(st, m, mode, { convert });
    if (reach.mp < 0 || (reach.mp <= 0 && mode !== moveModes(m)[0])) continue;
    const moveHeatBase = mode === 'jump' ? 3 : MOVE_HEAT[convert ? moveKind(mode) : mode] || 0;
    let convBias = 0;
    if (convert) {
      const toVehicle = m.vmode !== 'vehicle';
      convBias = toVehicle ? (m.heat >= 6 ? 2 : 0) + (nearest > 9 ? 1.5 : -1) : (nearest <= 3 ? 2 : -0.5);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let anyF = false;
      for (let f = 0; f < 6; f++) if (isFinite(reach.cost[(y * w + x) * 6 + f])) { anyF = true; break; }
      if (!anyF || !canEndAt(st, m, x, y, reach)) continue;
      const info = hexInfo(x, y);
      // Threat at this hex
      for (let f = 0; f < 6; f++) {
        const k = (y * w + x) * 6 + f;
        if (!isFinite(reach.cost[k])) continue;
        const hexes = reach.steps[k];
        const stand = hexes === 0 && x === m.x && y === m.y;
        const md = stand ? 'stand' : mode;
        const mvHeat = stand ? (f === m.f ? 0 : 1) : (mode === 'jump' ? Math.max(3, hexes) : moveHeatBase);
        const atkMod = { stand: 0, walk: 1, run: 2, jump: 3 }[moveKind(md)];
        const defMod = moveMod(md, hexes);
        let offense = 0, threat = 0;
        for (const it of info) {
          const e = it.e;
          if (!it.los.ok) continue;
          const opts = [];
          for (const wp of m.weapons) {
            if (!wp.ok || wp.ammo === 0 || it.d > wp.rng) continue;
            if (!inArc(m, wp.loc, e.x, e.y, { x, y, f })) continue;
            const s = Math.ceil(wp.rng / 3), mr = Math.ceil(wp.rng * 2 / 3);
            let tn = m.pilot.gun + (it.d <= s ? 0 : it.d <= mr ? 2 : 4) + atkMod + moveModE(e) + it.los.woods + TERRAIN[tileOf(st, e.x, e.y)].woods;
            if (wp.minr && it.d <= wp.minr) tn += wp.minr - it.d + 1;
            if (e.shutdown || e.pilot.ko) tn -= 4;
            tn += Math.floor(m.heat >= 8 ? 1 : 0);
            const p = chance(tn);
            if (p > 0) opts.push({ w: wp, ed: expectedDamage(wp, p), heat: wp.heat });
          }
          if (mode === 'jump' && !stand && it.d === 1 && !e.hidden && m.tons >= 40 && (e.prone || elevOf(st, e.x, e.y) <= elevOf(st, x, y))) {
            const p = chance(m.pilot.pil + 3 + moveModE(e) + (e.prone ? -2 : 0) + pilotingMods(m).reduce((a2, [, v2]) => a2 + v2, 0));
            const dmg = dfaDamage(m);
            const dfaVal = p * dmg * (totalArmor(e) < dmg * 2.5 ? 1.6 : 1) - p * dfaSelfDamage(m) * 0.25 - (1 - p) * dmg * 0.35;
            offense = Math.max(offense, dfaVal);
          }
          if (opts.length) {
            const v = bestVolley(opts, heatBudget(st, m, mvHeat));
            const finish = totalArmor(e) < v.dmg * 2.5 ? 1.6 : 1;
            const carrierBonus = st.item && st.item.carrier === e.id ? 1.5 : 1;
            offense = Math.max(offense, v.dmg * finish * carrierBonus);
          }
          // enemy shooting back
          if (canAct(e)) {
            let ed = 0;
            for (const wp of e.weapons) {
              if (!wp.ok || wp.ammo === 0 || it.d > wp.rng) continue;
              const s = Math.ceil(wp.rng / 3), mr = Math.ceil(wp.rng * 2 / 3);
              const tn = e.pilot.gun + (it.d <= s ? 0 : it.d <= mr ? 2 : 4) + 1 + defMod + it.los.woods + myWoods(x, y);
              ed += expectedDamage(wp, chance(tn));
            }
            const rel = Math.abs(relBearing(x, y, f, e.x, e.y));
            const rearF = rel >= 120 ? 1.6 : rel > 60 ? 1.2 : 1;
            threat += ed * rearF * (e.activated ? 0.6 : 1);
          }
        }
        // incoming fire from enemy defences at the end of the round
        for (const fi of fortAt(x, y)) {
          if (!fi.los.ok) continue;
          for (const wp of fi.s.weapons) {
            if (!wp.ok || wp.ammo === 0 || fi.d > wp.rng) continue;
            const s2 = Math.ceil(wp.rng / 3), mr = Math.ceil(wp.rng * 2 / 3);
            const tn = 4 + (fi.d <= s2 ? 0 : fi.d <= mr ? 2 : 4) + defMod + fi.los.woods + myWoods(x, y) + (wp.minr && fi.d <= wp.minr ? wp.minr - fi.d + 1 : 0);
            threat += expectedDamage(wp, chance(tn));
          }
          // ...and we could shoot it
          if (offense < 3) {
            const opts = [];
            for (const wp of m.weapons) if (wp.ok && wp.ammo !== 0 && fi.d <= wp.rng && inArc(m, wp.loc, fi.s.x, fi.s.y, { x, y, f })) {
              const s2 = Math.ceil(wp.rng / 3), mr = Math.ceil(wp.rng * 2 / 3);
              const p = chance(m.pilot.gun + (fi.d <= s2 ? 0 : fi.d <= mr ? 2 : 4) + atkMod - 4 + fi.los.woods);
              if (p > 0) opts.push({ w: wp, ed: expectedDamage(wp, p), heat: wp.heat });
            }
            if (opts.length) offense = Math.max(offense, bestVolley(opts, heatBudget(st, m, mvHeat)).dmg * 0.55);
          }
        }
        // the ground itself: fire, magma, climate
        const envH = envHeat(st, { ...m, x, y });
        let score = offense * 1.2 - threat * (0.35 + (1 - fragile) * 0.5) + convBias - Math.max(0, envH) * 1.6 - (isBurning(st, x, y) ? 4 : 0);
        if (goal) {
          const gd = goal.edge ? (goal.edge === 'E' ? w - 1 - x : x) : distance(x, y, goal.x, goal.y);
          score -= gd * goal.weight;
          if (gd === 0) score += 30;
        } else if (enemies.length) {
          let nd = 99;
          for (const it of info) nd = Math.min(nd, it.d);
          score -= Math.abs(nd - optRange) * 0.8;
        }
        // stay near friends, avoid deep water, prefer high ground
        if (allies.length) {
          let ad = 99;
          for (const a of allies) ad = Math.min(ad, distance(x, y, a.x, a.y));
          if (ad > 5) score -= (ad - 5) * 0.3;
        }
        score += st.map.e[y * w + x] * 0.4;
        if (m.heat + mvHeat + envH - dissipation(st, { ...m, x, y }) > 8) score -= (m.heat + mvHeat + envH - dissipation(st, { ...m, x, y }) - 8) * 1.5;
        score += nextRand({ rng: (x * 73856093) ^ (y * 19349663) ^ (f * 83492791) ^ st.seq }) * 0.3;
        if (score > best.score) best.score = score, best.cmd = { type: 'move', id: m.id, x, y, f, mode, ...(convert ? { convert: true } : {}) };
      }
    }
  }
  return best.cmd;
}
function moveModE(e) { return moveMod(moveKind(e.lastMove.mode), e.lastMove.hexes) + (e.prone ? 1 : 0); }

function chooseAttack(st, m) {
  const enemies = knownEnemies(st, m);
  let best = { v: 0, cmd: null };
  const budget = dissipation(st, m) - m.heat - (st.act ? st.act.heatGen : 0) + 5;
  for (const e of enemies) {
    const opts = [];
    for (const wp of m.weapons) {
      const th = toHit(st, m, e, wp);
      if (!th.ok || th.p <= 0.03) continue;
      opts.push({ w: wp, ed: expectedDamage(wp, th.p), heat: wp.heat });
    }
    if (opts.length) {
      const killable = totalArmor(e) < 25;
      const v = bestVolley(opts, killable ? budget + 6 : budget);
      let val = v.dmg * (killable ? 1.5 : 1) * (st.item && st.item.carrier === e.id ? 1.6 : 1);
      if (v.picked.length && val > best.v) best = { v: val, cmd: { type: 'attack', id: m.id, target: e.id, weapons: v.picked.map((o) => o.w.i) } };
    }
    for (const kind of ['kick', 'punch', 'dfa']) {
      const th = toHit(st, m, e, null, { kind });
      if (!th.ok) continue;
      const dmg = kind === 'dfa' ? dfaDamage(m) : kind === 'kick' ? Math.ceil(m.tons / 5) : Math.ceil(m.tons / 10);
      // death from above hurts the attacker too: its legs on a hit, a nasty fall on a miss
      const risk = kind === 'dfa' ? th.p * dfaSelfDamage(m) * 0.25 + (1 - th.p) * dmg * 0.35 : 0;
      const val = th.p * dmg * (kind === 'kick' ? 0.85 : 1) * (kind === 'dfa' && totalArmor(e) < dmg * 2.5 ? 1.6 : 1) - risk;
      if (val > best.v) best = { v: val, cmd: { type: 'melee', id: m.id, target: e.id, kind } };
    }
  }
  // enemy emplacements: worth a volley when no mech is a better target
  for (const s of (st.structures || [])) {
    if (s.dead || s.team === m.team || (s.team < 0 && !STRUCTS[s.kind].slots)) continue;
    const opts = [];
    for (const wp of m.weapons) { const th = toHitStructure(st, m, s, wp); if (th.ok && th.p > 0.05) opts.push({ w: wp, ed: expectedDamage(wp, th.p), heat: wp.heat }); }
    if (!opts.length) continue;
    const v = bestVolley(opts, budget);
    const armed = s.team >= 0 && s.weapons.some((w) => w.ok && w.ammo !== 0);
    const val = v.dmg * (armed ? (s.cf <= v.dmg * 1.5 ? 0.9 : 0.6) : 0.15);
    if (v.picked.length && val > best.v) best = { v: val, cmd: { type: 'attack', id: m.id, structure: s.id, weapons: v.picked.map((o) => o.w.i) } };
  }
  return best.cmd || { type: 'end', id: m.id };
}
void defenceTargets;

// A computer pilot gives up a mech that can no longer fight: no working weapon and either
// crippled legs or a badly hurt pilot. With enemies crowding in and no friends nearby, a
// heavy mech's pilot may take them along with a self-destruct instead.
function abandonShip(st, m) {
  if (m.pilot.ko) return null;
  const armed = m.weapons.some((w) => w.ok && w.ammo !== 0);
  const legs = legsDown(m);
  const hurt = m.pilot.hits >= 4;
  if (armed || !(legs || hurt)) return null;
  const close = st.mechs.filter((e) => operational(e) && !e.hidden && e.x >= 0 && distance(m.x, m.y, e.x, e.y) <= 2);
  const foes = close.filter((e) => (e.team ?? e.side) !== (m.team ?? m.side)).length;
  const friends = close.filter((e) => e !== m && (e.team ?? e.side) === (m.team ?? m.side)).length;
  if (foes >= 1 && !friends && m.tons >= 50 && m.engineHits < 3) return { type: 'selfdestruct', id: m.id };
  return { type: 'eject', id: m.id };
}
const legsDown = (m) => m.locGone.some((g, l) => g && (l >= 6)) && (m.body === 'quad' ? m.locGone.filter((g, l) => g && l >= 4).length >= 2 : true);

export function aiNextCommand(st) {
  const side = activeSide(st);
  if (side < 0) return null;
  if (!st.act) {
    const av = availableMechs(st, side);
    if (!av.length) return null;
    // slow mechs commit first, fast ones keep their options open
    const speed = (x) => availMP(x, moveModes(x)[0]);
    av.sort((a, b) => speed(a) - speed(b) || a.id - b.id);
    const m = av[0];
    return abandonShip(st, m) || evalPositions(st, m) || { type: 'end', id: m.id };
  }
  const m = st.mechs[st.act.id];
  if (st.act.phase === 'move') return evalPositions(st, m) || { type: 'end', id: m.id };
  return chooseAttack(st, m);
}
