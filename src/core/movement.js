// Movement: costs, reachable hexes, facing, jumping, water and the piloting rolls on the way.
import { TERRAIN, bodyOf } from './data.js';
import { inMap } from './map.js';
import { neighbor, distance } from './hex.js';
import { unitAt } from './forces.js';
import { structureAt } from './structures.js';
import { availMP, canConvert, conversionCost, elevOf, isEnemy, isQuadVee, mechAt, moveModes, tileOf } from './rules.js';

// ---------------------------------------------------------------- movement
const TRACKED = { track: 1, cruise: 1, flank: 1 };
function enterCost(st, m, fx, fy, tx, ty, mode) {
  if (!inMap(st.map, tx, ty)) return -1;
  const t = tileOf(st, tx, ty);
  const de = elevOf(st, tx, ty) - elevOf(st, fx, fy);
  if (Math.abs(de) > (TRACKED[mode] ? 1 : 2)) return -1;
  if ((mode === 'run' || mode === 'flank') && t === 5) return -1;
  if (TRACKED[mode]) {
    // tracked movement follows ground-vehicle rules: no heavy woods, and BattleMech tracks
    // can't be used in water (a QuadVee's sealed hull can)
    if (t === 2) return -1;
    if (TERRAIN[t].depth && !isQuadVee(m)) return -1;
  }
  const o = mechAt(st, tx, ty);
  if (o && isEnemy(o, m)) return -1;
  if (st.structures && structureAt(st, tx, ty)) return -1;
  const uo = st.units && unitAt(st, tx, ty);
  if (uo && (uo.team < 0 || uo.team !== (m.team ?? m.side))) return -1;
  return TERRAIN[t].cost + Math.abs(de) * (TRACKED[mode] ? 2 : 1);
}

// Dijkstra over (hex, facing). Returns reach info for a mode.
export function computeReach(st, m, mode, opts = {}) {
  const { w, h } = st.map;
  const N = w * h * 6;
  const cost = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const steps = new Int16Array(N).fill(0);
  let mp = moveModes(m).includes(mode) ? availMP(m, mode) : 0;
  if (opts.convert) mp = canConvert(st, m) && mode !== 'jump' ? mp - conversionCost(m) : -1;
  const res = { mode, mp, cost, prev, steps, w, h, convert: !!opts.convert };
  if (mp < 0) return res;
  if (mode === 'jump') {
    if (mp <= 0) return res;
    const s0 = (m.y * w + m.x) * 6 + m.f;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = distance(m.x, m.y, x, y);
      if (d === 0 || d > mp) continue;
      if (Math.abs(elevOf(st, x, y) - elevOf(st, m.x, m.y)) > mp) continue;
      if (st.structures && structureAt(st, x, y)) continue;
      if (st.units && unitAt(st, x, y)) continue;
      for (let f = 0; f < 6; f++) { const k = (y * w + x) * 6 + f; cost[k] = d; prev[k] = s0; steps[k] = d; }
    }
    cost[s0] = 0;
    return res;
  }
  const start = (m.y * w + m.x) * 6 + m.f;
  const startCost = m.prone ? 2 : 0;
  const shift = bodyOf(m) === 'quad' && !TRACKED[mode];
  // a QuadVee can't convert in water
  const noEnd = opts.convert ? (x, y) => !!TERRAIN[tileOf(st, x, y)].depth : null;
  res.noEnd = noEnd;
  if (startCost > mp) { if (!opts.convert) cost[start] = 0; res.cantStand = m.prone; return res; }
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
    // forward / backward, and a four-legged mech's lateral shift (sideways without turning,
    // +1 MP; the two rear-quarter shifts count as backward movement)
    const back = mode === 'walk' || mode === 'track' || mode === 'cruise';
    const dirs = [[0, 0]];
    if (back) dirs.push([3, 0]);
    if (shift) { dirs.push([1, 1], [5, 1]); if (back) dirs.push([2, 1], [4, 1]); }
    for (const [dd, extra] of dirs) {
      const n = neighbor(x, y, f + dd);
      const ec = enterCost(st, m, x, y, n.x, n.y, mode);
      if (ec < 0) continue;
      const nc = c + ec + extra;
      const nk = (n.y * w + n.x) * 6 + f;
      if (nc <= mp && nc < cost[nk]) { cost[nk] = nc; prev[nk] = k; steps[nk] = steps[k] + 1; push(nc, nk); }
    }
  }
  return res;
}

export function canEndAt(st, m, x, y, reach) {
  const o = mechAt(st, x, y);
  if (reach && reach.noEnd && reach.noEnd(x, y)) return false;
  if (st.units && unitAt(st, x, y)) return false;
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
