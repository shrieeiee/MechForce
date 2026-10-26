// Computer opponent. Returns one command at a time for the active AI side.
import { WEAPONS, TERRAIN } from './data.js';
import { computeReach, canEndAt, toHit, availableMechs, operational, canAct, lineOfSight, inArc, missionOf,
  walkMP, expectedDamage, dissipation, totalArmor, maxArmor, tileOf, activeSide } from './rules.js';
import { distance, relBearing } from './hex.js';
import { chance, nextRand } from './rng.js';

function moveMod(mode, hexes) {
  let v = hexes >= 18 ? 5 : hexes >= 10 ? 4 : hexes >= 7 ? 3 : hexes >= 5 ? 2 : hexes >= 3 ? 1 : 0;
  return v + (mode === 'jump' ? 1 : 0);
}

function goalFor(st, m) {
  const mis = missionOf(st);
  const { w } = st.map;
  const it = st.item;
  if (mis.id === 'crossing' && m.side === 0) return { x: w - 1, y: m.y, weight: 3, edge: 'E' };
  if (it && !it.gone) {
    if (it.carrier === m.id) {
      if (mis.homeExit) return { x: m.side === 0 ? 0 : w - 1, y: m.y, weight: 4, edge: m.side === 0 ? 'W' : 'E' };
      if (mis.id === 'pepsi') return { x: m.side === 0 ? w - 1 : 0, y: m.y, weight: 4, edge: m.side === 0 ? 'E' : 'W' };
      if (mis.spy) return { x: w - 1, y: m.y, weight: 4, edge: 'E' };
    }
    if (it.carrier === null && (mis.carriers.includes(m.side) || (mis.spy && m.side === 0))) return { x: it.x, y: it.y, weight: 2.5 };
    if (it.carrier !== null) {
      const c = st.mechs[it.carrier];
      if (c && c.side !== m.side) return { x: c.x, y: c.y, weight: 1.5, hunt: c.id };
      if (c && c.side === m.side) return { x: c.x, y: c.y, weight: 0.6 };
    }
  }
  if (mis.scout && m.side === 0) {
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
  const enemies = st.mechs.filter((e) => operational(e) && e.side !== m.side);
  const allies = st.mechs.filter((e) => operational(e) && e.side === m.side && e.id !== m.id);
  const goal = goalFor(st, m);
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
  const myWoods = (x, y) => TERRAIN[tileOf(st, x, y)].woods + (TERRAIN[tileOf(st, x, y)].depth === 1 ? 1 : 0);
  const best = { score: -1e9, cmd: null };
  const modes = ['walk', 'run', 'jump'];
  const fragile = totalArmor(m) / maxArmor(m);
  for (const mode of modes) {
    const reach = computeReach(st, m, mode);
    if (reach.mp <= 0 && mode !== 'walk') continue;
    const moveHeatBase = mode === 'walk' ? 1 : mode === 'run' ? 2 : 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let anyF = false;
      for (let f = 0; f < 6; f++) if (isFinite(reach.cost[(y * w + x) * 6 + f])) { anyF = true; break; }
      if (!anyF || !canEndAt(st, m, x, y)) continue;
      const info = hexInfo(x, y);
      // Threat at this hex
      for (let f = 0; f < 6; f++) {
        const k = (y * w + x) * 6 + f;
        if (!isFinite(reach.cost[k])) continue;
        const hexes = reach.steps[k];
        const stand = hexes === 0 && x === m.x && y === m.y;
        const md = stand ? 'stand' : mode;
        const mvHeat = stand ? (f === m.f ? 0 : 1) : (mode === 'jump' ? Math.max(3, hexes) : moveHeatBase);
        const atkMod = { stand: 0, walk: 1, run: 2, jump: 3 }[md];
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
        let score = offense * 1.2 - threat * (0.35 + (1 - fragile) * 0.5);
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
        if (m.heat + mvHeat - dissipation(st, m) > 8) score -= (m.heat + mvHeat - dissipation(st, m) - 8) * 1.5;
        score += nextRand({ rng: (x * 73856093) ^ (y * 19349663) ^ (f * 83492791) ^ st.seq }) * 0.3;
        if (score > best.score) best.score = score, best.cmd = { type: 'move', id: m.id, x, y, f, mode };
      }
    }
  }
  return best.cmd;
}
function moveModE(e) { return moveMod(e.lastMove.mode, e.lastMove.hexes) + (e.prone ? 1 : 0); }

function chooseAttack(st, m) {
  const enemies = st.mechs.filter((e) => operational(e) && e.side !== m.side);
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
    for (const kind of ['kick', 'punch']) {
      const th = toHit(st, m, e, null, { kind });
      if (!th.ok) continue;
      const dmg = kind === 'kick' ? Math.ceil(m.tons / 5) : Math.ceil(m.tons / 10);
      const val = th.p * dmg * (kind === 'kick' ? 0.85 : 1);
      if (val > best.v) best = { v: val, cmd: { type: 'melee', id: m.id, target: e.id, kind } };
    }
  }
  return best.cmd || { type: 'end', id: m.id };
}

export function aiNextCommand(st) {
  const side = activeSide(st);
  if (side < 0) return null;
  if (!st.act) {
    const av = availableMechs(st, side);
    if (!av.length) return null;
    // slow mechs commit first, fast ones keep their options open
    av.sort((a, b) => walkMP(a) - walkMP(b) || a.id - b.id);
    const m = av[0];
    return evalPositions(st, m) || { type: 'end', id: m.id };
  }
  const m = st.mechs[st.act.id];
  if (st.act.phase === 'move') return evalPositions(st, m) || { type: 'end', id: m.id };
  return chooseAttack(st, m);
}
