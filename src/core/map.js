import { nextRand, hashSeed } from './rng.js';
import { center, neighbor } from './hex.js';
import { MAP_SIZES } from './data.js';

function valueNoise(seed, scale) {
  const h = { rng: seed };
  const g = 24;
  const grid = [];
  for (let i = 0; i < g * g; i++) grid.push(nextRand(h));
  const at = (ix, iy) => grid[((iy % g) + g) % g * g + ((ix % g) + g) % g];
  const sm = (t) => t * t * (3 - 2 * t);
  return (px, py) => {
    const x = px / scale, y = py / scale;
    const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export function generateMap(seed, sizeId = 'M', theme = 'temperate') {
  const size = MAP_SIZES.find((s) => s.id === sizeId) || MAP_SIZES[1];
  const { w, h } = size;
  const s = hashSeed(seed);
  const nElev = valueNoise(s ^ 0x1234, 5.5);
  const nElev2 = valueNoise(s ^ 0x9876, 2.5);
  const nWood = valueNoise(s ^ 0x5555, 3.2);
  const nRough = valueNoise(s ^ 0x7777, 2.2);
  const nWet = valueNoise(s ^ 0x3333, 4.5);
  const t = new Array(w * h).fill(0);
  const e = new Array(w * h).fill(0);
  const dry = theme === 'desert' || theme === 'lunar';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = center(x, y);
      const ev = nElev(c.px, c.py) * 0.75 + nElev2(c.px, c.py) * 0.25;
      let el = ev < 0.42 ? 0 : ev < 0.56 ? 1 : ev < 0.68 ? 2 : 3;
      let ter = 0;
      const wet = nWet(c.px, c.py);
      const wd = nWood(c.px, c.py);
      const ro = nRough(c.px, c.py);
      if (!dry && el === 0 && wet > 0.7) ter = wet > 0.82 ? 5 : 4;
      else if (dry && el === 0 && wet > 0.84 && theme !== 'lunar') ter = 4;
      else if (wd > (dry ? 0.8 : 0.6)) ter = wd > (dry ? 0.9 : 0.74) ? 2 : 1;
      else if (ro > 0.72) ter = 3;
      if (theme === 'lunar' && ter === 1) ter = 3;
      if (theme === 'lunar' && ter === 2) ter = 3;
      t[y * w + x] = ter;
      e[y * w + x] = ter >= 4 ? 0 : el;
    }
  }
  // Keep deploy edges friendly: no deep water in the outer two columns / rows
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x < 2 || x >= w - 2 || y < 1 || y >= h - 1;
    if (edge && t[y * w + x] === 5) t[y * w + x] = 4;
  }
  return { w, h, theme, size: size.id, t, e };
}

export function inMap(map, x, y) { return x >= 0 && y >= 0 && x < map.w && y < map.h; }
export function tileAt(map, x, y) { return map.t[y * map.w + x]; }
export function elevAt(map, x, y) { return map.e[y * map.w + x]; }

// Deployment hexes for a side (0 west, 1 east, 2 north, 3 south)
export function deployZone(map, side, nSides) {
  const out = [];
  const { w, h } = map;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = false;
    if (side === 0) ok = x <= 1 && (nSides < 3 || (y > 1 && y < h - 2));
    if (side === 1) ok = x >= w - 2 && (nSides < 3 || (y > 1 && y < h - 2));
    if (side === 2) ok = y <= 1 && x > 2 && x < w - 3;
    if (side === 3) ok = y >= h - 2 && x > 2 && x < w - 3;
    if (ok && map.t[y * w + x] !== 5) out.push({ x, y });
  }
  // order from middle outward so lances deploy together
  const mid = side < 2 ? h / 2 : w / 2;
  out.sort((a, b) => Math.abs((side < 2 ? a.y : a.x) - mid) - Math.abs((side < 2 ? b.y : b.x) - mid) || (side === 0 ? b.x - a.x : a.x - b.x));
  return out;
}

export { neighbor };
