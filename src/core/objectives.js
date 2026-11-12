// Mission objectives built from structures and conventional forces: a command post to
// destroy or defend, and a convoy of supply haulers to see across the map.
import { UNITS, STRUCTS } from './data.js';
import { hashSeed, nextRand } from './rng.js';
import { unitCanStand, inDeployBand } from './maps.js';
import { inMap } from './map.js';
import { neighbor, distance } from './hex.js';

const CONVOY_KIND = 'truck';

// ---- setup: runs on the map before its structures and units are built
export function addObjectives(map, mission, seed, custom) {
  if (mission.fort) placeFort(map, mission.fort, seed, custom);
  if (mission.convoy) placeConvoy(map, mission.convoy);
  return map;
}

function placeFort(map, fort, seed, custom) {
  const { w, h } = map;
  const s = map.s || (map.s = []);
  const rng = { rng: hashSeed('fort' + seed) };
  const used = new Set([...s, ...(map.u || [])].map((d) => d.y * w + d.x));
  const free = (x, y) => inMap(map, x, y) && !inDeployBand(map, x, y) && map.t[y * w + x] < 4 && !used.has(y * w + x);
  const face = fort.team === 0 ? 0 : 3;
  const depth = (x) => (fort.team === 0 ? x : w - 1 - x);
  let hq = s.find((d) => d.k === 'hq' && d.team === fort.team);
  if (!hq) {
    let best = null, bs = -1e9;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (!free(x, y) || depth(x) < 3 || depth(x) > 6) continue;
      const sc = -Math.abs(y - (h - 1) / 2) * 0.6 - Math.abs(depth(x) - 4) - (map.t[y * w + x] ? 1 : 0) + map.e[y * w + x] * 0.2 + nextRand(rng) * 0.5;
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    if (!best) best = { x: fort.team === 0 ? 4 : w - 5, y: h >> 1 };
    // a custom map's other structures give way to the objective
    const at = s.findIndex((d) => d.x === best.x && d.y === best.y);
    if (at >= 0) s.splice(at, 1);
    if (map.t[best.y * w + best.x] >= 4) { map.t[best.y * w + best.x] = 0; }
    hq = { k: 'hq', x: best.x, y: best.y, f: face, team: fort.team, load: [] };
    s.push(hq);
    used.add(hq.y * w + hq.x);
  }
  hq.obj = true;
  if (fort.cf) hq.cf = fort.cf;
  if (custom) return; // a designed map brings its own defences
  // the garrison's guns: out in front of the command post, spread to either side
  const front = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const d = distance(x, y, hq.x, hq.y);
    if (!free(x, y) || d < 2 || d > 3 || depth(x) < depth(hq.x)) continue;
    front.push({ x, y, d });
  }
  const placed = [];
  const put = (k, load, want) => {
    let best = null, bs = -1e9;
    for (const c of front) {
      if (used.has(c.y * w + c.x) || placed.some((p) => distance(p.x, p.y, c.x, c.y) < 3)) continue;
      const sc = -Math.abs((c.y - hq.y) - want) * 1.2 + map.e[c.y * w + c.x] * 0.6 - (map.t[c.y * w + c.x] ? 0.4 : 0) + nextRand(rng) * 0.4;
      if (sc > bs) { bs = sc; best = c; }
    }
    if (!best) return;
    placed.push(best); used.add(best.y * w + best.x);
    s.push({ k, x: best.x, y: best.y, f: face, team: fort.team, load });
  };
  const loads = ['ac10', 'lrm', 'laser', 'srm', 'ppc'];
  if (fort.bunker) put('bunker', [loads[Math.floor(nextRand(rng) * 3)], 'mg'], 0);
  for (let i = 0; i < (fort.turrets || 0); i++) put('turret', [loads[Math.floor(nextRand(rng) * loads.length)]], (fort.turrets === 1 ? 0 : i % 2 ? 3 : -3));
}

// Where a hauler can drive: its kind of ground, no cliffs, nothing built in the way
function driveField(map, blocked) {
  const { w, h } = map;
  const dist = new Array(w * h).fill(Infinity);
  const q = [];
  const ok = (x, y) => unitCanStand(CONVOY_KIND, map.t[y * w + x]) && !blocked(x, y);
  for (let y = 0; y < h; y++) if (ok(w - 1, y)) { dist[y * w + w - 1] = 0; q.push([w - 1, y]); }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (let f = 0; f < 6; f++) {
      const n = neighbor(x, y, f);
      if (!inMap(map, n.x, n.y) || !ok(n.x, n.y) || dist[n.y * w + n.x] <= dist[y * w + x] + 1) continue;
      if (Math.abs(map.e[n.y * w + n.x] - map.e[y * w + x]) > 1) continue;
      dist[n.y * w + n.x] = dist[y * w + x] + 1;
      q.push([n.x, n.y]);
    }
  }
  return dist;
}
export function convoyField(st) {
  const taken = new Set((st.structures || []).filter((s) => !s.dead).map((s) => s.y * st.map.w + s.x));
  return driveField(st.map, (x, y) => taken.has(y * st.map.w + x));
}

function placeConvoy(map, conv) {
  const { w, h } = map;
  const u = map.u || (map.u = []);
  const s = map.s || (map.s = []);
  const west = conv.team === 0;
  const xs = Array.from({ length: conv.n }, (_, i) => (west ? 2 + i : w - 3 - i));
  // the road: the row near the middle that needs the least work
  let row = h >> 1, bs = -1e9;
  for (let y = 3; y < h - 3; y++) {
    let sc = -Math.abs(y - (h - 1) / 2) * 1.5;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!unitCanStand(CONVOY_KIND, map.t[k])) sc -= 2;
      if (x && Math.abs(map.e[k] - map.e[k - 1]) > 1) sc -= 2;
      if (s.some((d) => d.x === x && d.y === y)) sc -= 3;
    }
    if (sc > bs) { bs = sc; row = y; }
  }
  const clearHex = (x) => {
    const k = row * w + x;
    if (!unitCanStand(CONVOY_KIND, map.t[k])) map.t[k] = 0;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].x === x && s[i].y === row) s.splice(i, 1);
    for (let i = u.length - 1; i >= 0; i--) if (u[i].x === x && u[i].y === row && !u[i].convoy) u.splice(i, 1);
  };
  for (const x of xs) clearHex(x);
  const blocked = (x, y) => s.some((d) => d.x === x && d.y === y);
  const reach = () => { const f = driveField(map, blocked); return xs.every((x) => isFinite(f[row * w + x])); };
  if (!reach()) {
    // no way through: the engineers have cut a track and forded the water along this row
    for (let x = 0; x < w; x++) clearHex(x);
    for (let x = 1; x < w; x++) { const k = row * w + x; map.e[k] = Math.max(map.e[k - 1] - 1, Math.min(map.e[k - 1] + 1, map.e[k])); }
  }
  xs.forEach((x) => u.push({ k: CONVOY_KIND, x, y: row, f: west ? 0 : 3, team: conv.team, convoy: true }));
}

// ---- during the battle
export const objectiveStructure = (st) => (st.structures || []).find((s) => s.obj);
export const convoyUnits = (st) => (st.units || []).filter((u) => u.convoy);
export function convoyCount(st) {
  const all = convoyUnits(st);
  const out = all.filter((u) => u.exited).length;
  const lost = all.filter((u) => !u.exited && (u.dead || u.immobile)).length;
  return { n: all.length, out, lost, rolling: all.length - out - lost };
}
// One line for the mission card: how the objective stands right now
export function objectiveStatus(st, mission) {
  if (mission.fort) {
    const s = objectiveStructure(st);
    return s ? (s.dead ? `${STRUCTS[s.kind].name} destroyed` : `${STRUCTS[s.kind].name}: ${s.cf} of ${s.cfMax}`) : '';
  }
  if (mission.convoy) {
    const c = convoyCount(st);
    return `${UNITS[CONVOY_KIND].name}s: ${c.out} through, ${c.rolling} rolling, ${c.lost} lost`;
  }
  return '';
}
