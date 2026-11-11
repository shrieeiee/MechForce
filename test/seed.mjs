// Imported first by every rules test: makes Math.random repeatable, so lobby lances, room
// codes and pilot ids are the same on every run and a failure can be reproduced.
// TEST_SEED=<n> picks another sequence (CI uses the default).
let s = (Number(process.env.TEST_SEED) || 0x5eed1989) >>> 0;
Math.random = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
