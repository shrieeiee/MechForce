// Gun emplacements, bunkers, buildings and walls: placing them, shooting them, and the
// defences firing on their own at the end of each round.
import { WEAPONS, STRUCTS, LOADOUTS, STRUCT_GUNNERY } from './data.js';
import { WSTAT } from './custom.js';
import { roll2d6 } from './rng.js';
import { attackDirection, checkVictory, clusterHits, expectedDamage, landHits, log, maxArmor, operational, pilotingCheck, toHit, totalArmor } from './rules.js';
import { hotGun } from './environment.js';

// ---------------------------------------------------------------- structures
// Gun emplacements and bunkers belong to a team (the deployment zone they were built in)
// and fire automatically at the end of every round. Buildings and walls are cover and
// obstacles. All of them block movement and line of sight until destroyed, leaving rubble.
export function makeStructure(id, d, nTeams) {
  const K = STRUCTS[d.k];
  const team = d.team >= 0 && d.team < nTeams ? d.team : -1;
  const weapons = [];
  for (const l of d.load || []) for (const t of (LOADOUTS[l] || { w: [] }).w) {
    const S = WSTAT[t];
    weapons.push({ t, heat: 0, dmg: S.dmg, rng: S.rng, minr: S.minr, slots: S.slots, ammo: WEAPONS[t].kind === 'e' ? -1 : S.ammo * 2, loc: -1, ok: true, i: weapons.length });
  }
  return { id, kind: d.k, x: d.x, y: d.y, f: d.f || 0, team: K.slots ? team : -1, cf: K.cf, cfMax: K.cf, h: K.h, hard: K.hard, load: (d.load || []).slice(), weapons, dead: false };
}
export const structureAt = (st, x, y) => (st.structures || []).find((s) => !s.dead && s.x === x && s.y === y);
const structShooter = (s) => ({ id: -1000 - s.id, x: s.x, y: s.y, f: s.f, team: s.team, side: s.team, pilot: { gun: STRUCT_GUNNERY, pil: 5, ko: false },
  heat: 0, sensorHits: 0, prone: false, dead: s.dead, exited: false, body: 'biped', actu: [], lastMove: { mode: 'stand', hexes: 0 }, structure: true });
const structTarget = (s) => ({ id: -1000 - s.id, sid: s.id, x: s.x, y: s.y, f: 0, team: s.team, side: s.team, dead: s.dead, exited: false, prone: false,
  shutdown: true, pilot: { ko: false, hits: 0 }, lastMove: { mode: 'stand', hexes: 0 }, structure: true });
// To-hit for a mech shooting at a structure: an immobile target (-4)
export function toHitStructure(st, att, s, w, opts = {}) { return toHit(st, att, structTarget(s), w, opts); }
export function damageStructure(st, s, dmg, ev, by) {
  const d = s.hard ? Math.ceil(dmg / 2) : dmg;
  s.cf = Math.max(0, s.cf - d);
  if (by && by.stats) by.stats.dmg += d;
  if (s.cf <= 0 && !s.dead) destroyStructure(st, s, ev, by);
  return d;
}
function destroyStructure(st, s, ev, by) {
  s.dead = true;
  const i = s.y * st.map.w + s.x;
  if (st.map.t[i] < 4) st.map.t[i] = 3; // rubble
  delete st.fire[i];
  ev.push({ k: 'sgone', sid: s.id, x: s.x, y: s.y });
  log(st, ev, `${STRUCTS[s.kind].name} destroyed${by && by.design ? ' by ' + by.design : ''}!`, { tone: 'kill', side: s.team >= 0 ? st.teams[s.team]?.members[0] : undefined });
}
export function fireAtStructure(st, m, s, weapons, ev) {
  m.reveal = { r: st.round, t: s.team };
  let volley = 0, nh = 0;
  for (const w of weapons) {
    if (s.dead) break;
    const th = toHitStructure(st, m, s, w);
    if (!th.ok) continue;
    const W = WEAPONS[w.t];
    st.act.heatGen += w.heat;
    if (w.ammo > 0) w.ammo--;
    m.stats.shots++;
    const r = roll2d6(st);
    const hit = r >= th.tn;
    const shot = { k: 'shot', id: m.id, target: -1, starget: s.id, w: w.i, wt: w.t, tn: th.tn, roll: r, hit, hits: [] };
    ev.push(shot);
    hotGun(st, w, s.x, s.y, hit, ev);
    if (!hit) continue;
    m.stats.hits++; nh++;
    const n = W.kind === 'm' ? clusterHits(st, W.n, m) : 1;
    if (W.kind === 'm') shot.missiles = n;
    const dmg = damageStructure(st, s, n * w.dmg, ev, m);
    shot.hits.push({ dmg });
    volley += dmg;
  }
  log(st, ev, `${m.design} fires at the ${STRUCTS[s.kind].name.toLowerCase()}: ${nh} hit, ${volley} damage${s.dead ? '' : ` (${s.cf}/${s.cfMax} left)`}.`, { id: m.id, side: m.side, tone: volley ? 'hit' : 'miss' });
}

// End of round: automated defences pick the most valuable target they can hurt. They
// prefer damaged mechs and objective carriers, stay out of their minimum range, and save
// their last rounds of ammunition for good shots.
export function defenceTargets(st, s) {
  if (s.dead || s.team < 0) return [];
  const shooter = structShooter(s);
  const out = [];
  for (const m of st.mechs) {
    if (!operational(m) || (m.team ?? m.side) === s.team) continue;
    const opts = s.weapons.map((w) => ({ w, th: toHit(st, shooter, m, w) })).filter((o) => o.th.ok && o.th.p > 0.03);
    if (!opts.length) continue;
    const ed = opts.reduce((a, o) => a + expectedDamage(o.w, o.th.p), 0);
    const frac = totalArmor(m) / maxArmor(m);
    let val = ed * (1.4 - frac * 0.6) * (1 + 0.04 * Math.max(0, 8 - opts[0].th.dist));
    if (st.item && st.item.carrier === m.id) val *= 1.6;
    if (totalArmor(m) < ed * 2.5) val *= 1.4;
    out.push({ m, opts, val, ed });
  }
  return out.sort((a, b) => b.val - a.val);
}
export function defencesFire(st, ev) {
  const armed = (st.structures || []).filter((s) => !s.dead && s.team >= 0 && s.weapons.some((w) => w.ok && w.ammo !== 0));
  let announced = false;
  for (const s of armed) {
    const best = defenceTargets(st, s)[0];
    if (!best) continue;
    if (!announced) { ev.push({ k: 'defences' }); log(st, ev, 'Emplacements open fire!', { tone: 'round' }); announced = true; }
    const tgt = best.m;
    const shooter = structShooter(s);
    const dir = attackDirection(st, s.x, s.y, tgt);
    let volley = 0, nh = 0;
    for (const { w, th } of best.opts) {
      if (tgt.dead) break;
      if (w.ammo > 0 && w.ammo <= 4 && th.p < 0.3) continue; // hold the last rounds for a better shot
      if (w.ammo > 0) w.ammo--;
      const r = roll2d6(st);
      const hit = r >= th.tn;
      const shot = { k: 'sshot', sid: s.id, target: tgt.id, w: w.i, wt: w.t, tn: th.tn, roll: r, hit, hits: [] };
      ev.push(shot);
      hotGun(st, w, tgt.x, tgt.y, hit, ev);
      if (!hit) continue;
      nh++;
      volley += landHits(st, w, tgt, dir, shot, ev, null);
    }
    void shooter;
    log(st, ev, `${STRUCTS[s.kind].name} fires at ${tgt.design}: ${nh} hit, ${volley} damage.`, { id: tgt.id, side: tgt.side, tone: volley ? 'hit' : 'miss' });
    if (volley >= 20 && !tgt.dead) pilotingCheck(st, tgt, 1, 'heavy damage', ev);
    if (tgt.dead) checkVictory(st, ev);
    if (st.over) return;
  }
}
