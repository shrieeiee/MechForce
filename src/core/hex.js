// Pointy-top hex grid, "odd-r" offset storage (x = column, y = row), cube maths internally.
export const SQ3 = Math.sqrt(3);

// Axial direction vectors, pointy-top. 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE (screen y grows downward)
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
// Screen-space angle (degrees, y down) of each facing
export const DIR_ANGLE = [0, -60, -120, 180, 120, 60];

export function toAxial(x, y) { return { q: x - (y - (y & 1)) / 2, r: y }; }
export function fromAxial(q, r) { return { x: q + (r - (r & 1)) / 2, y: r }; }

export function neighbor(x, y, d) {
  const a = toAxial(x, y);
  const [dq, dr] = DIRS[((d % 6) + 6) % 6];
  return fromAxial(a.q + dq, a.r + dr);
}

export function distance(x1, y1, x2, y2) {
  const a = toAxial(x1, y1), b = toAxial(x2, y2);
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Hex centre in unit-size layout (size = 1 = centre-to-corner)
export function center(x, y) {
  const a = toAxial(x, y);
  return { px: SQ3 * (a.q + a.r / 2), py: 1.5 * a.r };
}

export function angleBetween(x1, y1, x2, y2) {
  const a = center(x1, y1), b = center(x2, y2);
  return Math.atan2(b.py - a.py, b.px - a.px) * 180 / Math.PI;
}

export function normAngle(a) {
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return a;
}

// Relative bearing of (x2,y2) seen from (x1,y1) facing f. Negative = left.
export function relBearing(x1, y1, f, x2, y2) {
  return normAngle(angleBetween(x1, y1, x2, y2) - DIR_ANGLE[f]);
}

// Facing that points most directly at a target
export function facingToward(x1, y1, x2, y2) {
  const ang = angleBetween(x1, y1, x2, y2);
  let best = 0, bd = 999;
  for (let f = 0; f < 6; f++) {
    const d = Math.abs(normAngle(ang - DIR_ANGLE[f]));
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

function cubeRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// Hexes on the line between two hexes, inclusive of both ends.
export function line(x1, y1, x2, y2) {
  const a = toAxial(x1, y1), b = toAxial(x2, y2);
  const n = distance(x1, y1, x2, y2);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t + 1e-6, r = a.r + (b.r - a.r) * t + 1e-6;
    const c = cubeRound(q, r);
    out.push(fromAxial(c.q, c.r));
  }
  return out;
}

export function turnCost(f1, f2) {
  const d = Math.abs(f1 - f2) % 6;
  return Math.min(d, 6 - d);
}
