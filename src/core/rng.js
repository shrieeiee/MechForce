// Seeded RNG (mulberry32). State lives inside the serialisable game state so the
// server, local games and replays all roll identical dice.
export function nextRand(holder) {
  let t = (holder.rng = (holder.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function d6(h) { return 1 + Math.floor(nextRand(h) * 6); }
export function roll2d6(h) { return d6(h) + d6(h); }
export function pick(h, arr) { return arr[Math.floor(nextRand(h) * arr.length)]; }
export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
// Probability that 2d6 >= tn
const P = [1, 1, 1, 35 / 36, 33 / 36, 30 / 36, 26 / 36, 21 / 36, 15 / 36, 10 / 36, 6 / 36, 3 / 36, 1 / 36];
export function chance(tn) { return tn <= 2 ? 1 : tn > 12 ? 0 : P[tn]; }
