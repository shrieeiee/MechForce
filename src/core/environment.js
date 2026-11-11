// The battlefield itself: fire, smoke and wind, water and magma, climate heat.
import { WEAPONS, bodyOf, legLocs, STRUCTS, CLIMATE, UNITS } from './data.js';
import { inMap } from './map.js';
import { neighbor } from './hex.js';
import { roll2d6, d6 } from './rng.js';
import { applyDamage, log, tileOf } from './rules.js';
import { hurtUnit, lcName } from './forces.js';
import { damageStructure, structureAt } from './structures.js';

// ---------------------------------------------------------------- terrain: fire, smoke, water, magma, climate
// Total Warfare / Tactical Operations fire rules, simplified: woods (and buildings) can be
// set alight by flamers and plasma, by stray laser shots, and by mechs blowing up in them.
// Fire spreads downwind (9+ on 2D6) and to either side of the wind (11+), throws smoke
// downwind, and burns heavy woods down to light woods and then to bare rough ground. A mech
// standing in a burning hex takes +5 heat. Smoke blocks sight like woods.
const ignitable = (st, x, y) => { const t = tileOf(st, x, y); const s = structureAt(st, x, y); return t === 1 || t === 2 || (s && STRUCTS[s.kind].burns); };
export const isBurning = (st, x, y) => !!(st.fire && st.fire[y * st.map.w + x]);
export const smokeAt = (st, x, y) => (st.smoke && st.smoke[y * st.map.w + x]) || 0;
export const magma = (st) => st.map.theme === 'volcanic';
export function tryIgnite(st, x, y, tn, ev, why) {
  if (!inMap(st.map, x, y) || isBurning(st, x, y) || !ignitable(st, x, y)) return false;
  const r = roll2d6(st);
  if (r < tn) return false;
  st.fire[y * st.map.w + x] = { age: 0 };
  ev.push({ k: 'fire', x, y });
  log(st, ev, `${why} sets the ${structureAt(st, x, y) ? 'building' : tileOf(st, x, y) === 2 ? 'heavy woods' : 'woods'} on fire!`, { tone: 'crit' });
  return true;
}
// Flamers ignite on 5+ and plasma on 7+ whether they hit or not; a missed laser can start a fire on 11+
export function hotGun(st, w, x, y, hit, ev) {
  const W = WEAPONS[w.t];
  if (W.fx === 'flamer') tryIgnite(st, x, y, 5, ev, 'Flamer fire');
  else if (W.fx === 'plasma') tryIgnite(st, x, y, hit ? 7 : 9, ev, 'Plasma');
  else if (W.kind === 'e' && !hit) tryIgnite(st, x, y, 11, ev, 'A stray laser shot');
}
const neighbors6 = (x, y) => [0, 1, 2, 3, 4, 5].map((d) => neighbor(x, y, d));
export function environmentPhase(st, ev) {
  const { w } = st.map;
  // the wind can veer
  const wr = roll2d6(st);
  if (wr === 2 || wr === 12) { st.wind = (st.wind + (wr === 2 ? 5 : 1)) % 6; ev.push({ k: 'wind', dir: st.wind }); log(st, ev, 'The wind shifts.', { tone: 'info' }); }
  const burning = Object.keys(st.fire).map(Number);
  // spread
  for (const i of burning) {
    const f = st.fire[i]; if (!f) continue;
    f.age++;
    const x = i % w, y = Math.floor(i / w);
    tryIgnite(st, ...xy(neighbor(x, y, st.wind)), 9, ev, 'Wind-blown fire');
    tryIgnite(st, ...xy(neighbor(x, y, st.wind + 1)), 11, ev, 'Spreading fire');
    tryIgnite(st, ...xy(neighbor(x, y, st.wind + 5)), 11, ev, 'Spreading fire');
  }
  // burn down
  for (const i of burning) {
    const f = st.fire[i]; if (!f) continue;
    const x = i % w, y = Math.floor(i / w);
    const s = structureAt(st, x, y);
    if (s) { if (!s.dead) { damageStructure(st, s, d6(st) + d6(st), ev, null); ev.push({ k: 'sburn', sid: s.id }); } if (s.dead) delete st.fire[i]; continue; }
    if (f.age >= 3) {
      const t = st.map.t[i];
      if (t === 2) { st.map.t[i] = 1; f.age = 1; ev.push({ k: 'terrain', x, y, t: 1 }); }
      else { st.map.t[i] = 3; delete st.fire[i]; ev.push({ k: 'terrain', x, y, t: 3 }); log(st, ev, 'A fire burns itself out, leaving scorched ground.', { tone: 'info' }); }
    } else if (!ignitable(st, x, y)) delete st.fire[i];
  }
  // infantry caught in a fire take losses; crews bail out of burning vehicles' way next round
  for (const u of st.units || []) if (!u.dead && isBurning(st, u.x, u.y)) { if (u.inf) { log(st, ev, `Fire sweeps through the ${lcName(UNITS[u.kind].name)}!`, { tone: 'bad' }); hurtUnit(st, u, null, 1, ev, null, d6(st)); } else hurtUnit(st, u, null, 1, ev, null, d6(st)); }
  // smoke: thick over the flames, thinner downwind
  st.smoke = {};
  for (const i of Object.keys(st.fire).map(Number)) {
    const x = i % w, y = Math.floor(i / w);
    st.smoke[i] = 2;
    for (const d of [st.wind, st.wind + 1, st.wind + 5]) {
      const n = neighbor(x, y, d);
      if (inMap(st.map, n.x, n.y)) { const k = n.y * w + n.x; st.smoke[k] = Math.max(st.smoke[k] || 0, 1); }
    }
  }
}
const xy = (p) => [p.x, p.y];
// Heat from the surroundings, added at the end of an activation
export function envHeat(st, m) {
  let h = (CLIMATE[st.map.theme] || CLIMATE.temperate).heat;
  if (isBurning(st, m.x, m.y)) h += 5;
  const t = tileOf(st, m.x, m.y);
  if (magma(st) && (t === 4 || t === 5)) h += t === 5 ? 10 : 5;
  return h;
}
export function envHeatParts(st, m) {
  const out = [];
  const c = (CLIMATE[st.map.theme] || CLIMATE.temperate).heat;
  if (c) out.push([c > 0 ? 'Hot climate' : 'Cold climate', c]);
  if (isBurning(st, m.x, m.y)) out.push(['Standing in fire', 5]);
  const t = tileOf(st, m.x, m.y);
  if (magma(st) && (t === 4 || t === 5)) out.push([t === 5 ? 'Liquid magma' : 'Magma crust', t === 5 ? 10 : 5]);
  return out;
}
// Liquid magma burns the legs (2D6 each; everything if the mech is lying in it)
export function magmaBurn(st, m, ev) {
  if (!magma(st) || tileOf(st, m.x, m.y) !== 5 || m.dead) return;
  log(st, ev, `${m.design} is burned by liquid magma!`, { id: m.id, side: m.side, tone: 'bad' });
  const locs = m.prone ? m.locGone.map((_, l) => l) : legLocs(bodyOf(m));
  for (const l of locs) if (!m.dead && !m.locGone[l]) applyDamage(st, m, l, false, d6(st) + d6(st), ev, null);
}
