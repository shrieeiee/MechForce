// Taking damage: hit locations, armour and structure, critical hits, ammo explosions,
// falls and pilot injuries, destruction, ejection and reactor blasts.
import { WEAPONS, FRONT_ZONE, REAR_ZONE, TRANSFER, critName, locName, bodyOf, legLocs } from './data.js';
import { roll2d6, d6 } from './rng.js';
import { hasAbility } from './pilots.js';
import { tryIgnite } from './environment.js';
import { isEnemy, isQuadVee, legState, log, onTracks } from './rules.js';
import { attackDirection, groupDamage, setWinner } from './rules.js';
import { damageStructure } from './structures.js';
import { hurtUnit } from './forces.js';
import { distance } from './hex.js';
import { nextRand } from './rng.js';

// ---------------------------------------------------------------- damage
const TABLE = {
  F: { 2: 2, 3: 5, 4: 5, 5: 7, 6: 3, 7: 2, 8: 1, 9: 6, 10: 4, 11: 4, 12: 0 },
  L: { 2: 1, 3: 6, 4: 4, 5: 4, 6: 6, 7: 1, 8: 2, 9: 3, 10: 5, 11: 7, 12: 0 },
  R: { 2: 3, 3: 7, 4: 5, 5: 5, 6: 7, 7: 3, 8: 2, 9: 1, 10: 4, 11: 6, 12: 0 },
};
// Standard 'Mech hit location table. On a four-legged mech the arm results strike the front
// legs (locations 4/5). On a tripod a leg result is re-rolled on 1D6 to pick the leg:
// 1-2 right, 3-4 centre, 5-6 left (+1 from the left side, -1 from the right).
export function tripodLeg(st, dir) {
  const r = d6(st) + (dir === 'L' ? 1 : dir === 'R' ? -1 : 0);
  return r <= 2 ? 7 : r <= 4 ? 8 : 6;
}
export function rollLocation(st, dir, tgt) {
  const r = roll2d6(st);
  let loc = TABLE[dir === 'B' ? 'F' : dir][r];
  if (tgt && bodyOf(tgt) === 'tripod' && (loc === 6 || loc === 7)) loc = tripodLeg(st, dir);
  return { loc, rear: dir === 'B', tac: r === 2 };
}

export function pilotHit(st, m, n, ev, why) {
  if (m.dead) return;
  m.pilot.hits += n;
  ev.push({ k: 'pilot', id: m.id, hits: m.pilot.hits });
  if (m.pilot.hits >= 6) {
    log(st, ev, `MechWarrior ${m.pilot.name} (${m.design}) is killed!`, { tone: 'bad', id: m.id, side: m.side });
    destroyMech(st, m, ev, null, 'pilot killed');
    return;
  }
  log(st, ev, `${m.pilot.name} is injured${why ? ' (' + why + ')' : ''} — ${m.pilot.hits}/6 hits`, { id: m.id, side: m.side });
  if (!m.pilot.ko) {
    const tn = [0, 3, 5, 7, 10, 11][m.pilot.hits] - (hasAbility(m, 'ironman') ? 2 : 0);
    const r = roll2d6(st);
    if (r < tn) {
      m.pilot.ko = true;
      log(st, ev, `${m.pilot.name} is unconscious!`, { tone: 'bad', id: m.id, side: m.side });
      ev.push({ k: 'ko', id: m.id });
    }
  }
}

// When a mech is destroyed its MechWarrior tries to eject (a piloting roll; a bad landing
// costs a hit). A head or cockpit kill takes the pilot too. An unconscious pilot can't
// eject, except that ammo explosions trigger the automatic ejection system; a pilot left
// in the cockpit survives unless the reactor breaches.
export const PILOT_DEATHS = ['head destroyed', 'cockpit destroyed', 'pilot killed'];
export function eject(st, m, ev, mod = 0, why = '') {
  if (m.pilot.fate || m.exited) return;
  const tn = pilotingTN(m, mod);
  const r = roll2d6(st);
  const ok = r >= tn;
  m.pilot.fate = 'ejected';
  if (!ok) m.pilot.hits = Math.min(6, m.pilot.hits + 1);
  if (m.pilot.hits >= 6) m.pilot.fate = 'killed';
  ev.push({ k: 'eject', id: m.id, ok, tn, roll: r, killed: m.pilot.fate === 'killed' });
  log(st, ev, m.pilot.fate === 'killed' ? `${m.pilot.name} ejects from the ${m.design} but doesn't survive the landing.`
    : ok ? `${m.pilot.name} ejects from the ${m.design}${why} and gets clear!` : `${m.pilot.name} ejects from the ${m.design}${why} — a hard landing (${m.pilot.hits}/6 hits), but alive.`,
  { tone: m.pilot.fate === 'killed' ? 'bad' : 'info', id: m.id, side: m.side });
}
export function destroyMech(st, m, ev, by, why) {
  if (m.dead) return;
  m.dead = true;
  ev.push({ k: 'destroyed', id: m.id, by: by ? by.id : -1 });
  if (PILOT_DEATHS.includes(why)) m.pilot.fate = 'killed';
  else if (!m.exited && (!m.pilot.ko || m.booming)) eject(st, m, ev, m.booming ? 0 : 0);
  if (!m.exited) tryIgnite(st, m.x, m.y, 8, ev, `The burning wreck of the ${m.design}`);
  log(st, ev, `${m.design} (${m.pilot.name}) is DESTROYED${why ? ' — ' + why : ''}!`, { tone: 'kill', id: m.id, side: m.side });
  if (by && isEnemy(by, m)) by.stats.kills++;
  dropItem(st, m, ev);
  if (!m.exited && m.x >= 0) {
    // a wrecked fusion engine can lose containment (on 10+), and ammo that blows a mech apart
    // throws burning debris at its neighbours
    if (why === 'self-destruct' || (why === 'engine destroyed' && roll2d6(st) >= REACTOR_BREACH_TN)) {
      if (!m.pilot.fate) { m.pilot.fate = 'killed'; log(st, ev, `${m.pilot.name} was still in the cockpit.`, { tone: 'bad', id: m.id, side: m.side }); }
      blast(st, m, reactorBlast(m), 2, why === 'self-destruct' ? 'SELF-DESTRUCT' : 'REACTOR BREACH', ev);
    }
    else if (m.booming) blast(st, m, Math.ceil(m.booming / 4), 1, 'The ammo explosion', ev);
  }
  if (st.mission === 'spy' && st.item && st.item.carrier === m.id) {
    // the spy dies with his ride
  }
}

export const REACTOR_BREACH_TN = 10;
export const SELF_DESTRUCT_TN = 5;
// blast strength from the engine rating (tonnage x walking speed): a 300-rated engine does 30
export const reactorBlast = (m) => Math.min(40, Math.ceil(m.tons * (m.walkBase || 4) / 10));
// Everything within `radius` hexes takes `dmg` (half that at range 2), in 5-point groups
// from the blast's direction; mechs caught in it must keep their balance.
function blast(st, src, dmg, radius, what, ev) {
  if (dmg <= 0) return;
  ev.push({ k: 'blast', id: src.id, x: src.x, y: src.y, r: radius, dmg });
  log(st, ev, radius > 1 ? `${what}! The ${src.design}'s reactor explodes — ${dmg} damage to everything nearby!` : `${what} tears the ${src.design} apart — ${dmg} damage to everything next to it!`, { tone: 'crit', id: src.id, side: src.side });
  for (const m of st.mechs) {
    if (m === src || m.dead || m.exited || m.x < 0) continue;
    const d = distance(src.x, src.y, m.x, m.y);
    if (d < 1 || d > radius) continue;
    const amt = d === 1 ? dmg : Math.floor(dmg / 2);
    if (amt <= 0) continue;
    const dir = attackDirection(st, src.x, src.y, m);
    groupDamage(st, m, amt, () => rollLocation(st, dir, m).loc, dir === 'B', ev, null);
    ev.push({ k: 'blasthit', id: m.id, dmg: amt });
    if (!m.dead) pilotingCheck(st, m, d === 1 ? 2 : 1, 'blast', ev);
  }
  for (const s of st.structures || []) {
    if (s.dead) continue;
    const d = distance(src.x, src.y, s.x, s.y);
    if (d < 1 || d > radius) continue;
    damageStructure(st, s, d === 1 ? dmg : Math.floor(dmg / 2), ev, null);
  }
  for (const u of st.units || []) {
    if (u.dead) continue;
    const d = distance(src.x, src.y, u.x, u.y);
    if (d < 1 || d > radius) continue;
    hurtUnit(st, u, null, 1, ev, null, d === 1 ? dmg : Math.floor(dmg / 2));
  }
  for (let y = src.y - radius; y <= src.y + radius; y++) for (let x = src.x - radius; x <= src.x + radius; x++) {
    if (x < 0 || y < 0 || x >= st.map.w || y >= st.map.h || distance(src.x, src.y, x, y) > radius) continue;
    tryIgnite(st, x, y, distance(src.x, src.y, x, y) <= 1 ? 6 : 9, ev, what);
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
  log(st, ev, `${m.design}'s ${locName(bodyOf(m), loc)} is blown off!`, { tone: 'crit', id: m.id, side: m.side });
  if (loc === 0 || loc === 2) { destroyMech(st, m, ev, by, loc === 0 ? 'head destroyed' : 'center torso destroyed'); return; }
  if (loc === 1) destroyLocation(st, m, 4, ev, by);
  if (loc === 3) destroyLocation(st, m, 5, ev, by);
  if (legLocs(bodyOf(m)).includes(loc)) {
    if (!m.prone && !m.dead) fall(st, m, ev, 'leg destroyed');
  }
}

// A QuadVee in vehicle mode can't fall (it's a tank on four tracks)
const canFall = (m) => !(isQuadVee(m) && m.vmode === 'vehicle');
// Falling damage is tonnage/10 per level fallen plus one, in 5-point groups
export function fall(st, m, ev, why, levels = 0) {
  if (m.dead || m.prone || !canFall(m)) return;
  m.prone = true;
  ev.push({ k: 'fall', id: m.id });
  log(st, ev, `${m.design} falls! (${why})`, { tone: 'bad', id: m.id, side: m.side });
  let dmg = Math.ceil(m.tons / 10) * (levels + 1);
  while (dmg > 0 && !m.dead) {
    const d = Math.min(5, dmg); dmg -= d;
    const hl = rollLocation(st, 'F', m);
    applyDamage(st, m, hl.loc, false, d, ev, null, { noFall: true });
  }
  pilotHit(st, m, 1, ev, 'fall');
}

// Piloting skill roll target. Four legs make a steady platform (-2 while all legs work);
// a tripod gets -1. A quad only takes the +5 leg penalty once two legs are gone.
export function pilotingMods(m) {
  const { legsGone, hips, legAct } = legState(m);
  const body = bodyOf(m);
  const out = [];
  if (m.gyroHits) out.push(['Gyro damage', m.gyroHits * 3]);
  if (hips) out.push(['Hip actuators', hips * 2]);
  if (legAct) out.push(['Leg actuators', legAct]);
  if (body === 'quad') { if (!legsGone) out.push(['Four legs', -2]); else if (legsGone >= 2) out.push(['Legs destroyed', 5]); }
  else if (body === 'tripod' && !legsGone) out.push(['Three legs', -1]);
  else if (legsGone) out.push(['Leg destroyed', legsGone * 5]);
  return out;
}
export function pilotingTN(m, mod = 0) {
  return m.pilot.pil + pilotingMods(m).reduce((s, [, v]) => s + v, 0) + mod + (hasAbility(m, 'ace') ? -1 : 0);
}

// gyroLeg: rolls caused by gyro or leg actuator damage, which a mech running on tracks ignores
export function pilotingCheck(st, m, mod, why, ev, gyroLeg) {
  if (m.dead || m.prone || !canFall(m)) return true;
  if (gyroLeg && onTracks(m)) return true;
  const tn = pilotingTN(m, mod);
  const r = roll2d6(st);
  ev.push({ k: 'psr', id: m.id, tn, roll: r, why });
  if (r < tn) { fall(st, m, ev, why); return false; }
  return true;
}

export function ammoExplosion(st, m, w, ev, by) {
  if (w.ammo <= 0) return;
  const W = WEAPONS[w.t];
  const dmg = Math.min(40, w.ammo * w.dmg * W.n);
  w.ammo = 0;
  const loc = w.aloc >= 0 ? w.aloc : w.loc;
  ev.push({ k: 'boom', id: m.id, loc, dmg });
  log(st, ev, `AMMO EXPLOSION! ${m.design}'s ${W.short} ammo cooks off for ${dmg} damage!`, { tone: 'crit', id: m.id, side: m.side });
  tryIgnite(st, m.x, m.y, 8, ev, 'The explosion');
  m.booming = dmg;
  applyDamage(st, m, loc, false, dmg, ev, by, { internalOnly: true });
  delete m.booming;
  pilotHit(st, m, 2, ev, 'ammo explosion');
}

export function applyCrit(st, m, loc, ev, by) {
  const slots = [];
  m.crit[loc].forEach((c, s) => { if (c >= 0 && !m.critHit[loc][s]) slots.push(s); });
  if (!slots.length) return;
  const s = slots[Math.floor(nextRand(st) * slots.length)];
  const code = m.crit[loc][s];
  m.critHit[loc][s] = 1;
  ev.push({ k: 'crit', id: m.id, loc, code });
  log(st, ev, `CRITICAL: ${m.design} — ${critName(code, bodyOf(m))} hit (${locName(bodyOf(m), loc)})`, { tone: 'crit', id: m.id, side: m.side });
  if (code <= 16) {
    const w = m.weapons.find((w) => w.loc === loc && s >= w.slot && s < w.slot + w.slots && w.ok) ||
      m.weapons.find((w) => w.loc === loc && w.t === code && w.ok);
    if (w) w.ok = false;
  } else if (code <= 28) {
    const w = m.weapons.find((w) => w.aloc === loc && w.aslot === s && w.ammo > 0) ||
      m.weapons.find((w) => w.t === code - 17 && w.ammo > 0);
    if (w) ammoExplosion(st, m, w, ev, by);
  } else if (code <= 44 || (code >= 53 && code <= 64)) {
    m.actu.push(code);
    if (code >= 37) pilotingCheck(st, m, 0, 'leg actuator', ev, true);
  } else if (code === 45) m.lifeSupport = true;
  else if (code === 46) m.sensorHits++;
  else if (code === 47) { log(st, ev, `Cockpit hit! ${m.pilot.name} is killed!`, { tone: 'kill' }); destroyMech(st, m, ev, by, 'cockpit destroyed'); }
  else if (code === 48) { m.engineHits++; if (m.engineHits >= 3) destroyMech(st, m, ev, by, 'engine destroyed'); }
  else if (code === 49) { m.gyroHits++; pilotingCheck(st, m, 0, 'gyro hit', ev, true); }
  else if (code === 50 || code === 52) m.jumpLost++;
  else if (code === 51) m.hsLost++;
}

function rollCrits(st, m, loc, ev, by, force) {
  const r = roll2d6(st);
  let n = r >= 12 ? 3 : r >= 10 ? 2 : r >= 8 ? 1 : 0;
  if (force && !n) return;
  if (r >= 12 && (loc === 0 || loc >= 4)) { destroyLocation(st, m, loc, ev, by); return; } // limb or head blown off
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
