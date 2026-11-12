// Infantry platoons and combat vehicles: damage rules and their end-of-round orders.
import { WEAPONS, TERRAIN, UNITS, UNIT_GUNNERY } from './data.js';
import { WSTAT } from './custom.js';
import { roll2d6, d6 } from './rng.js';
import { checkVictory, log, pilotingCheck, tileOf, toHit } from './rules.js';
import { applyDamage, attackDirection, clusterHits, elevOf, expectedDamage, landHits, mechAt, operational, rollLocation } from './rules.js';
import { structureAt } from './structures.js';
import { envHeat, hotGun, isBurning, tryIgnite } from './environment.js';
import { unitCanStand } from './maps.js';
import { inMap } from './map.js';
import { distance, facingToward, neighbor } from './hex.js';
import { convoyField } from './objectives.js';

// ---------------------------------------------------------------- conventional forces
// Infantry platoons and combat vehicles (Total Warfare, simplified). They're run by the
// computer for their side, or for the locals (team -1, hostile to everyone who comes close),
// and act together at the end of each round: move, then shoot. Mechs can shoot them.
// Against infantry, BattleMech weapons are clumsy: ballistic and energy weapons kill
// damage/10 troopers (rounded up), missiles damage/5, while machine guns (2D6) and flamers
// (3D6) mow them down; anything in the open counts double. Vehicles lose armour then
// structure, and every hit can damage their motive system.
export function makeUnit(id, d, nTeams) {
  const K = UNITS[d.k];
  const weapons = (K.w || []).map((t, i) => {
    const S = WSTAT[t];
    return { t, heat: 0, dmg: S.dmg, rng: S.rng, minr: S.minr, slots: S.slots, ammo: WEAPONS[t].kind === 'e' ? -1 : S.ammo, loc: -1, ok: true, i };
  });
  if (K.inf) weapons.push({ t: K.fx, heat: 0, dmg: 0, rng: K.rng, minr: 0, slots: 0, ammo: -1, loc: -1, ok: true, i: 0, inf: true });
  return {
    id, kind: d.k, x: d.x, y: d.y, f: d.f || 0, home: { x: d.x, y: d.y }, team: d.team >= 0 && d.team < nTeams ? d.team : -1, inf: !!K.inf,
    troops: K.troops || 0, troopsMax: K.troops || 0, armor: K.armor || 0, armorMax: K.armor || 0, struct: K.struct || 0, structMax: K.struct || 0,
    mp: K.mp, mpMax: K.mp, motion: K.motion, weapons, moved: 0, dead: false, immobile: false, stats: { dmg: 0, kills: 0 },
    ...(d.convoy ? { convoy: true } : {}),
  };
}
// 'Battle tank' -> 'battle tank', but 'SRM platoon' keeps its capitals
export const lcName = (n) => (/^[A-Z]{2}/.test(n) ? n : n[0].toLowerCase() + n.slice(1));
export const unitAt = (st, x, y) => (st.units || []).find((u) => !u.dead && u.x === x && u.y === y && !u.hidden);
const unitMode = (u) => (!u.moved ? 'stand' : u.motion === 'jump' ? 'jump' : 'walk');
const unitShooter = (u) => ({ id: -2000 - u.id, x: u.x, y: u.y, f: u.f, team: u.team, side: u.team, pilot: { gun: UNIT_GUNNERY, pil: 5, ko: false },
  heat: 0, sensorHits: 0, prone: false, dead: u.dead, exited: false, body: 'biped', actu: [], lastMove: { mode: unitMode(u), hexes: u.moved }, structure: true });
const unitTarget = (u) => ({ id: -2000 - u.id, uid: u.id, x: u.x, y: u.y, f: u.f, team: u.team, side: u.team, dead: u.dead, exited: false, prone: false,
  shutdown: u.immobile && !u.inf, pilot: { ko: false, hits: 0 }, lastMove: { mode: unitMode(u), hexes: u.moved }, structure: true, infantry: u.inf });
// a mech (or anything mech-shaped) shooting at a unit
export function toHitUnit(st, att, u, w, opts = {}) { return toHit(st, att, unitTarget(u), w, opts); }
export const unitStrength = (u) => (u.inf ? u.troops / u.troopsMax : (u.armor + u.struct) / (u.armorMax + u.structMax));
const infDamage = (u) => Math.ceil(u.troops * UNITS[u.kind].perT);

// Troopers killed / damage done to a unit by one weapon hit (n = missiles that hit)
export function hurtUnit(st, u, w, n, ev, by, flat) {
  if (u.dead) return 0;
  const W = w ? WEAPONS[w.t] : null;
  let dealt;
  if (u.inf) {
    let k;
    if (flat !== undefined) k = flat; // blasts and fire: area effects
    else if (w.t === 4) k = roll2d6(st);
    else if (w.t === 15) k = roll2d6(st) + d6(st);
    else if (W.kind === 'm') k = Math.ceil(n * w.dmg / 5);
    else k = Math.ceil(w.dmg * n / 10);
    if (TERRAIN[tileOf(st, u.x, u.y)].woods === 0) k *= 2;
    dealt = Math.min(u.troops, k);
    u.troops -= dealt;
  } else {
    let d = flat !== undefined ? flat : n * w.dmg;
    dealt = d;
    const a = Math.min(u.armor, d); u.armor -= a; d -= a;
    u.struct = Math.max(0, u.struct - d);
    if (dealt > 0) motiveHit(st, u, ev);
  }
  if (by && by.stats) by.stats.dmg += dealt;
  ev.push({ k: 'uhit', uid: u.id, dmg: dealt });
  if (!u.dead && ((u.inf && u.troops <= 0) || (!u.inf && u.struct <= 0))) destroyUnit(st, u, ev, by);
  return dealt;
}
// Motive damage: hovercraft and wheels are fragile (+3 / +2 to the roll)
function motiveHit(st, u, ev) {
  if (u.immobile || u.dead) return;
  // haulers are built to keep rolling: their running gear shrugs off most hits
  const r = roll2d6(st) + ({ hover: 3, wheeled: 2 }[u.motion] || 0) - (UNITS[u.kind].sturdy ? 2 : 0);
  if (r < 10) return;
  if (r >= 12) u.mp = 0;
  else u.mp = Math.max(0, u.mp - (r === 11 ? Math.ceil(u.mp / 2) : 1));
  if (!u.mp) {
    u.immobile = true;
    log(st, ev, `The ${lcName(UNITS[u.kind].name)} is immobilised!`, { tone: 'crit' });
    if (u.motion === 'hover' && TERRAIN[tileOf(st, u.x, u.y)].depth) { log(st, ev, 'It sinks!', { tone: 'kill' }); destroyUnit(st, u, ev, null); }
  } else log(st, ev, `The ${lcName(UNITS[u.kind].name)}'s ${u.motion === 'hover' ? 'lift fan' : u.motion === 'wheeled' ? 'wheels' : 'tracks'} are damaged (${u.mp} MP left).`, { tone: 'crit' });
  ev.push({ k: 'umotive', uid: u.id, mp: u.mp });
}
function destroyUnit(st, u, ev, by) {
  if (u.dead) return;
  u.dead = true;
  ev.push({ k: 'ugone', uid: u.id, x: u.x, y: u.y, inf: u.inf });
  log(st, ev, u.inf ? `The ${lcName(UNITS[u.kind].name)} is wiped out!` : `The ${lcName(UNITS[u.kind].name)} is destroyed!`, { tone: 'kill' });
  if (by && by.stats) by.stats.ukills = (by.stats.ukills || 0) + 1;
  if (!u.inf) tryIgnite(st, u.x, u.y, 9, ev, 'The burning wreck');
}

export function fireAtUnit(st, m, u, weapons, ev) {
  m.reveal = { r: st.round, t: u.team };
  let volley = 0, nh = 0;
  for (const w of weapons) {
    if (u.dead) break;
    const th = toHitUnit(st, m, u, w);
    if (!th.ok) continue;
    const W = WEAPONS[w.t];
    st.act.heatGen += w.heat;
    if (w.ammo > 0) w.ammo--;
    m.stats.shots++;
    const r = roll2d6(st);
    const hit = r >= th.tn;
    const shot = { k: 'shot', id: m.id, target: -1, utarget: u.id, w: w.i, wt: w.t, tn: th.tn, roll: r, hit, hits: [] };
    ev.push(shot);
    hotGun(st, w, u.x, u.y, hit, ev);
    if (!hit) continue;
    m.stats.hits++; nh++;
    const n = W.kind === 'm' ? clusterHits(st, W.n, m) : 1;
    if (W.kind === 'm') shot.missiles = n;
    const dmg = hurtUnit(st, u, w, n, ev, m);
    shot.hits.push({ dmg });
    volley += dmg;
  }
  const K = UNITS[u.kind];
  log(st, ev, `${m.design} fires at the ${lcName(K.name)}: ${nh} hit, ${volley} ${u.inf ? `trooper${volley === 1 ? '' : 's'} down` : 'damage'}${u.dead ? '' : u.inf ? ` (${u.troops} left)` : ''}.`, { id: m.id, side: m.side, tone: volley ? 'hit' : 'miss' });
}

// ---- end-of-round orders for every unit
const unitFoe = (u, o) => (o.team ?? o.side) !== u.team;
// how far a unit can go this round, avoiding anything occupied, fire and impassable ground
function unitReach(st, u) {
  const { w, h } = st.map;
  const best = new Map([[u.y * w + u.x, 0]]);
  if (u.immobile || !u.mp) return best;
  const blocked = (x, y) => mechAt(st, x, y) || structureAt(st, x, y) || unitAt(st, x, y) || isBurning(st, x, y);
  if (u.motion === 'jump') {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = distance(u.x, u.y, x, y);
      if (d && d <= u.mp && unitCanStand(u.kind, tileOf(st, x, y)) && !blocked(x, y)) best.set(y * w + x, d);
    }
    return best;
  }
  const q = [[u.x, u.y, 0]];
  while (q.length) {
    q.sort((a, b) => a[2] - b[2]);
    const [x, y, c] = q.shift();
    if (c > (best.get(y * w + x) ?? 99)) continue;
    for (let f = 0; f < 6; f++) {
      const n = neighbor(x, y, f);
      if (!inMap(st.map, n.x, n.y)) continue;
      const t = tileOf(st, n.x, n.y);
      if (!unitCanStand(u.kind, t) || blocked(n.x, n.y)) continue;
      const de = Math.abs(elevOf(st, n.x, n.y) - elevOf(st, x, y));
      if (de > (u.inf ? 2 : 1)) continue;
      const nc = c + (u.motion === 'hover' && TERRAIN[t].depth ? 1 : TERRAIN[t].cost) + (u.motion === 'wheeled' && t === 3 ? 1 : 0) + de;
      if (nc > u.mp || nc >= (best.get(n.y * w + n.x) ?? 99)) continue;
      best.set(n.y * w + n.x, nc);
      q.push([n.x, n.y, nc]);
    }
  }
  return best;
}
// targets a unit cares about: side units fight the other sides' mechs and units (and locals
// that come close); the locals defend their ground against anything near home
function unitFoes(st, u) {
  const out = [];
  const home = (x, y) => distance(u.home.x, u.home.y, x, y);
  for (const m of st.mechs) {
    if (!operational(m) || m.x < 0 || !unitFoe(u, m)) continue;
    if (u.team < 0 && home(m.x, m.y) > 6) continue;
    out.push({ o: m, mech: true });
  }
  for (const o of st.units || []) {
    if (o === u || o.dead || !unitFoe(u, o)) continue;
    if ((u.team < 0 || o.team < 0) && distance(u.x, u.y, o.x, o.y) > 4) continue;
    out.push({ o, mech: false });
  }
  return out;
}
function unitWeaponsAt(st, u, x, y, foe) {
  const shooter = { ...unitShooter(u), x, y };
  const tgt = foe.mech ? foe.o : unitTarget(foe.o);
  let ed = 0;
  const opts = [];
  for (const w of u.weapons) {
    if (!w.ok || w.ammo === 0) continue;
    const th = toHit(st, shooter, tgt, w, { mode: u.moved || (x !== u.x || y !== u.y) ? (u.motion === 'jump' ? 'jump' : 'walk') : 'stand', pos: { x, y, f: u.f } });
    if (!th.ok || th.p <= 0.03) continue;
    const dmg = w.inf ? infDamage(u) : expectedDamage(w, 1);
    ed += th.p * dmg;
    opts.push({ w, th });
  }
  return { ed, opts };
}
// A convoy vehicle has one order: drive for the far edge by the shortest road, and leave
// the battlefield when it gets there.
function convoyMove(st, u, field, ev) {
  const { w } = st.map;
  const reach = unitReach(st, u);
  let best = null, bs = Infinity;
  for (const [k, c] of reach) {
    const sc = field[k] + c * 0.01;
    if (sc < bs) { bs = sc; best = { x: k % w, y: Math.floor(k / w), c }; }
  }
  if (best && (best.x !== u.x || best.y !== u.y)) {
    const from = { x: u.x, y: u.y };
    u.f = facingToward(u.x, u.y, best.x, best.y);
    u.x = best.x; u.y = best.y;
    u.moved = Math.max(1, Math.round(best.c));
    ev.push({ k: 'umove', uid: u.id, from, x: u.x, y: u.y, f: u.f, jump: false });
  }
  if (field[u.y * w + u.x] === 0) {
    u.exited = true; u.dead = true;
    ev.push({ k: 'uexit', uid: u.id });
    log(st, ev, `A ${lcName(UNITS[u.kind].name)} drives off the battlefield.`, { tone: 'info' });
  }
}
export function unitsPhase(st, ev) {
  const live = (st.units || []).filter((u) => !u.dead);
  if (!live.length) return;
  const { w } = st.map;
  let fired = false, field = null;
  for (const u of live) {
    if (u.dead || st.over) continue;
    u.moved = 0;
    if (u.convoy) { convoyMove(st, u, field || (field = convoyField(st)), ev); continue; }
    const foes = unitFoes(st, u);
    // ---- move: towards a good firing spot (cover for infantry), or home for the locals
    const reach = unitReach(st, u);
    const maxR = Math.max(1, ...u.weapons.map((wp) => wp.rng));
    const pref = u.inf ? maxR : Math.max(2, Math.round(maxR * 0.55));
    let best = null, bs = -1e9;
    for (const [k, c] of reach) {
      const x = k % w, y = Math.floor(k / w);
      const t = tileOf(st, x, y);
      let sc = (u.inf ? TERRAIN[t].woods * 1.5 : 0) + elevOf(st, x, y) * 0.3 - c * 0.05 - (envHeat(st, { x, y, f: 0 }) > 2 ? 4 : 0);
      if (foes.length) {
        let nd = 99, att = 0;
        for (const f of foes) {
          const d = distance(x, y, f.o.x, f.o.y);
          nd = Math.min(nd, d);
          if (d <= maxR) att = Math.max(att, unitWeaponsAt(st, u, x, y, f).ed * (f.mech ? 1 : 0.8));
          // stay out of mech kicking range unless that's where our guns work
          if (f.mech && d <= 1 && !u.inf) sc -= 1.5;
        }
        sc += att * 1.2 - Math.abs(nd - pref) * 0.6;
      } else if (u.team >= 0) {
        // no one in sight: drift towards the middle of the map
        sc -= distance(x, y, Math.floor(st.map.w / 2), Math.floor(st.map.h / 2)) * 0.25;
      }
      if (u.team < 0) sc -= Math.max(0, distance(x, y, u.home.x, u.home.y) - 3) * 2;
      if (sc > bs) { bs = sc; best = { x, y, c }; }
    }
    if (best && (best.x !== u.x || best.y !== u.y)) {
      const from = { x: u.x, y: u.y };
      u.f = facingToward(u.x, u.y, best.x, best.y);
      u.x = best.x; u.y = best.y;
      u.moved = u.motion === 'jump' ? distance(from.x, from.y, best.x, best.y) : Math.max(1, Math.round(best.c));
      ev.push({ k: 'umove', uid: u.id, from, x: u.x, y: u.y, f: u.f, jump: u.motion === 'jump' });
    }
    // ---- fire at the most damaging target
    let pick = null, pv = 0;
    for (const f of foes) {
      if (f.o.dead) continue;
      const r = unitWeaponsAt(st, u, u.x, u.y, f);
      const val = r.ed * (f.mech ? 1 : 0.8) * (f.mech && st.item && st.item.carrier === f.o.id ? 1.5 : 1);
      if (r.opts.length && val > pv) { pv = val; pick = { f, opts: r.opts }; }
    }
    if (!pick) continue;
    if (!fired) { fired = true; ev.push({ k: 'units' }); log(st, ev, 'Infantry and vehicles open fire!', { tone: 'round' }); }
    const tgtObj = pick.f.o;
    u.f = facingToward(u.x, u.y, tgtObj.x, tgtObj.y);
    u.reveal = { r: st.round, t: tgtObj.team ?? tgtObj.side };
    let total = 0, nh = 0;
    for (const { w: wp, th } of pick.opts) {
      if (tgtObj.dead) break;
      if (wp.ammo > 0) wp.ammo--;
      const r = roll2d6(st);
      const hit = r >= th.tn;
      const shot = { k: 'ushot', uid: u.id, w: wp.i, wt: wp.t, tn: th.tn, roll: r, hit, hits: [], inf: !!wp.inf, ...(pick.f.mech ? { target: tgtObj.id } : { tu: tgtObj.id }) };
      ev.push(shot);
      hotGun(st, wp, tgtObj.x, tgtObj.y, hit, ev);
      if (!hit) continue;
      nh++;
      if (pick.f.mech) {
        const dir = attackDirection(st, u.x, u.y, tgtObj);
        if (wp.inf) {
          let left = infDamage(u);
          shot.hits.push({ dmg: left });
          total += left;
          while (left > 0 && !tgtObj.dead) { const d = Math.min(2, left); left -= d; applyDamage(st, tgtObj, rollLocation(st, dir, tgtObj).loc, dir === 'B', d, ev, null); }
        } else total += landHits(st, wp, tgtObj, dir, shot, ev, null);
      } else {
        const W = WEAPONS[wp.t];
        const n = W.kind === 'm' && !wp.inf ? clusterHits(st, W.n, null) : 1;
        const d = wp.inf ? hurtUnit(st, tgtObj, null, 1, ev, u, infDamage(u) / (tgtObj.inf ? 2 : 1)) : hurtUnit(st, tgtObj, wp, n, ev, u);
        shot.hits.push({ dmg: d });
        total += d;
      }
    }
    const name = UNITS[u.kind].name;
    const tname = pick.f.mech ? tgtObj.design : 'the ' + lcName(UNITS[tgtObj.kind].name);
    log(st, ev, `${u.team < 0 ? 'Local ' + lcName(name) : name} fires at ${tname}: ${nh} hit, ${total} ${!pick.f.mech && tgtObj.inf ? 'troopers down' : 'damage'}.`, { tone: total ? 'hit' : 'miss', ...(pick.f.mech ? { id: tgtObj.id, side: tgtObj.side } : {}) });
    if (pick.f.mech && total >= 20 && !tgtObj.dead) pilotingCheck(st, tgtObj, 1, 'heavy damage', ev);
    if (pick.f.mech && tgtObj.dead) checkVictory(st, ev);
  }
}
