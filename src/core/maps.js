// Custom maps and structures. A map is { name, size, theme, w, h, t[], e[], s[] } where s is
// the list of structures: { k: kind, x, y, f: facing, team: owning deployment zone (0 West,
// 1 East, 2 North, 3 South, -1 neutral), load: [loadout ids] }. Maps made in the editor are
// checked here by the host before use, so a broken or tampered map can't break a game.
import { MAP_SIZES, THEMES, STRUCTS, STRUCT_KINDS, LOADOUTS, LOADOUT_IDS, UNITS, UNIT_KINDS } from './data.js';
import { nextRand, hashSeed } from './rng.js';
import { neighbor } from './hex.js';

const int = (v, lo, hi, d = lo) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export const MAX_ELEV = 5;
export const MAX_STRUCTS = 40;
export const MAX_UNITS = 24;
// where each kind of conventional unit can stand (infantry can't swim, wheels and hovercraft avoid woods)
export function unitCanStand(kind, t) {
  const K = UNITS[kind];
  if (!K) return false;
  if (K.motion === 'hover') return t === 0 || t === 3 || t === 4 || t === 5;
  if (K.motion === 'wheeled') return t === 0 || t === 3;
  if (K.motion === 'tracked') return t <= 3;
  return t <= 3; // infantry
}
// The two outer rows and columns are where mechs deploy: no structures or deep water there
export const inDeployBand = (map, x, y) => x <= 1 || y <= 1 || x >= map.w - 2 || y >= map.h - 2;

export function sanitizeMap(m) {
  if (!m || typeof m !== 'object') return null;
  const size = MAP_SIZES.find((z) => z.id === m.size) || MAP_SIZES.find((z) => z.w === m.w && z.h === m.h);
  if (!size) return null;
  const { w, h } = size;
  if (!Array.isArray(m.t) || !Array.isArray(m.e) || m.t.length !== w * h || m.e.length !== w * h) return null;
  const t = m.t.map((v, i) => { const k = int(v, 0, 5); return k === 5 && inDeployBand({ w, h }, i % w, Math.floor(i / w)) ? 4 : k; });
  const e = m.e.map((v, i) => (t[i] >= 4 ? 0 : int(v, 0, MAX_ELEV)));
  const used = new Set();
  const s = [];
  for (const d of Array.isArray(m.s) ? m.s.slice(0, MAX_STRUCTS) : []) {
    if (!d || !STRUCT_KINDS.includes(d.k)) continue;
    const x = Math.round(Number(d.x)), y = Math.round(Number(d.y));
    if (!(x >= 0 && y >= 0 && x < w && y < h) || inDeployBand({ w, h }, x, y) || used.has(y * w + x) || t[y * w + x] >= 4) continue;
    used.add(y * w + x);
    const slots = STRUCTS[d.k].slots;
    const load = (Array.isArray(d.load) ? d.load : []).filter((l) => LOADOUT_IDS.includes(l)).slice(0, slots);
    if (slots && !load.length) load.push('ac10');
    s.push({ k: d.k, x, y, f: int(d.f, 0, 5), team: slots ? int(d.team, -1, 3, -1) : -1, load });
  }
  // conventional forces: infantry and vehicles, one per hex, not on structures
  const u = [];
  for (const d of Array.isArray(m.u) ? m.u.slice(0, MAX_UNITS) : []) {
    if (!d || !UNIT_KINDS.includes(d.k)) continue;
    const x = Math.round(Number(d.x)), y = Math.round(Number(d.y));
    if (!(x >= 0 && y >= 0 && x < w && y < h) || inDeployBand({ w, h }, x, y) || used.has(y * w + x) || !unitCanStand(d.k, t[y * w + x])) continue;
    used.add(y * w + x);
    u.push({ k: d.k, x, y, f: int(d.f, 0, 5), team: int(d.team, -1, 3, -1) });
  }
  const theme = THEMES.some((th) => th.id === m.theme) ? m.theme : 'temperate';
  const name = String(m.name || 'Custom map').replace(/[^\w .\-'!#&]/g, '').trim().slice(0, 24) || 'Custom map';
  return { name, size: size.id, theme, w, h, t, e, s, u };
}

export function blankMap(sizeId = 'M', theme = 'temperate', name = 'New map') {
  const size = MAP_SIZES.find((z) => z.id === sizeId) || MAP_SIZES[1];
  return { name, size: size.id, theme, w: size.w, h: size.h, t: new Array(size.w * size.h).fill(0), e: new Array(size.w * size.h).fill(0), s: [], u: [] };
}

// Hexes in front of a team's deployment edge, nearest the middle of the edge first
function frontHexes(map, team, depth) {
  const { w, h } = map;
  const out = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const d = team === 0 ? x : team === 1 ? w - 1 - x : team === 2 ? y : h - 1 - y;
    if (d < depth[0] || d > depth[1]) continue;
    if (team >= 2 && (x < 3 || x > w - 4)) continue;
    if (map.t[y * w + x] >= 4) continue;
    out.push({ x, y, along: team < 2 ? y - h / 2 : x - w / 2 });
  }
  return out;
}
const towards = (team) => [0, 3, 5, 1][team] ?? 0; // facing that points across the map

// Random battlefields can be fortified: 'light' gives each side two gun emplacements,
// 'heavy' a bunker and three emplacements, sited on the best ground in front of its edge.
export function addDefences(map, seed, nTeams, level) {
  if (!level || level === 'none') return map;
  const rng = { rng: hashSeed('def' + seed) };
  const s = map.s || (map.s = []);
  const taken = new Set(s.map((d) => d.y * map.w + d.x));
  const pick = (team, n, depth) => {
    const cands = frontHexes(map, team, depth).filter((c) => !taken.has(c.y * map.w + c.x));
    const out = [];
    for (let k = 0; k < n; k++) {
      // spread along the edge, prefer high ground
      const target = (k + 0.5) / n - 0.5;
      const span = team < 2 ? map.h : map.w;
      let best = null, bs = -1e9;
      for (const c of cands) {
        if (taken.has(c.y * map.w + c.x) || out.some((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 3)) continue;
        const sc = map.e[c.y * map.w + c.x] * 1.5 - Math.abs(c.along / span - target) * 8 - (map.t[c.y * map.w + c.x] ? 0.5 : 0) + nextRand(rng) * 0.6;
        if (sc > bs) { bs = sc; best = c; }
      }
      if (best) { out.push(best); taken.add(best.y * map.w + best.x); }
    }
    return out;
  };
  const loads = ['ac10', 'lrm', 'laser', 'srm', 'ppc', 'ac20'];
  for (let team = 0; team < nTeams; team++) {
    const f = towards(team);
    if (level === 'heavy') for (const c of pick(team, 1, [4, 5])) s.push({ k: 'bunker', x: c.x, y: c.y, f, team, load: [loads[Math.floor(nextRand(rng) * 3)], 'mg'] });
    for (const c of pick(team, level === 'heavy' ? 3 : 2, [3, 5])) s.push({ k: 'turret', x: c.x, y: c.y, f, team, load: [loads[Math.floor(nextRand(rng) * loads.length)]] });
  }
  return map;
}

// Symmetry for the editor. Rotating half a turn about the centre is exact on this hex grid
// (every map has an even number of rows), so a 'point' mirror makes a perfectly fair map
// for West vs East; 'lr' flips left to right (rows keep their offset, so it's close).
export function mirrorHex(map, x, y, mode) {
  if (mode === 'lr') return { x: map.w - 1 - x, y };
  if (mode === 'point') return { x: map.w - 1 - x, y: map.h - 1 - y };
  return null;
}
export const mirrorFacing = (f, mode) => (mode === 'point' ? (f + 3) % 6 : mode === 'lr' ? (9 - f) % 6 : f);
export const mirrorTeam = (team, mode) => (team < 0 ? team : mode ? [1, 0, 3, 2][team] : team);
export { neighbor };

// Conventional forces for any battlefield: each side gets support (vehicles and infantry
// a few hexes in front of its edge) and the locals field militia platoons and armour that
// guard the middle of the map. 'few': 1 per side + 2 local; 'many': 2 per side + 4 local.
export function addForces(map, seed, nTeams, level) {
  if (!level || level === 'none') return map;
  const rng = { rng: hashSeed('frc' + seed) };
  const u = map.u || (map.u = []);
  const taken = new Set([...(map.s || []), ...u].map((d) => d.y * map.w + d.x));
  const r = (n) => Math.floor(nextRand(rng) * n);
  const place = (k, team, cands) => {
    const ok = cands.filter((c) => !taken.has(c.y * map.w + c.x) && unitCanStand(k, map.t[c.y * map.w + c.x]));
    if (!ok.length || u.length >= MAX_UNITS) return;
    // infantry likes woods and rough ground; vehicles like open ground
    const inf = UNITS[k].inf;
    ok.sort((a, b) => score(b) - score(a));
    function score(c) { const t = map.t[c.y * map.w + c.x]; return (inf ? (t === 1 || t === 2 ? 2 : t === 3 ? 1 : 0) : (t === 0 ? 1 : 0)) + nextRand(rng) * 1.5; }
    const c = ok[0];
    taken.add(c.y * map.w + c.x);
    u.push({ k, x: c.x, y: c.y, f: team === 0 ? 0 : team === 1 ? 3 : team === 2 ? 5 : team === 3 ? 1 : r(6), team });
  };
  const n = level === 'many' ? 2 : 1;
  const supportKinds = ['ltank', 'hover', 'car', 'tank', 'carrier', 'jump', 'laser', 'srm'];
  for (let team = 0; team < nTeams; team++) for (let i = 0; i < n; i++) place(supportKinds[r(supportKinds.length)], team, frontHexes(map, team, [2, 4]));
  const mid = [];
  for (let y = 2; y < map.h - 2; y++) for (let x = Math.floor(map.w * 0.3); x <= Math.ceil(map.w * 0.7); x++) mid.push({ x, y });
  const localKinds = ['rifle', 'rifle', 'laser', 'srm', 'car', 'ltank'];
  for (let i = 0; i < n * 2; i++) place(localKinds[r(localKinds.length)], -1, mid.filter(() => nextRand(rng) < 0.5));
  return map;
}
