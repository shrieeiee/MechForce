// Custom mech construction. A design "spec" is small and is what gets saved and sent over
// the network; buildTemplate() turns it into the same template format as the original
// disk mechs and validates it. Host and clients run the same code, so a design that is
// illegal on one is illegal everywhere.
import { WEAPONS } from './data.js';

// Standard BattleTech-style weapon stats used for custom builds
// tons, slots, heat, dmg (per missile), range (long), min range, shots per ton of ammo
export const WSTAT = [
  { tons: 6, slots: 1, heat: 1, dmg: 2, rng: 24, minr: 4, ammo: 45 },
  { tons: 8, slots: 4, heat: 1, dmg: 5, rng: 18, minr: 3, ammo: 20 },
  { tons: 12, slots: 7, heat: 3, dmg: 10, rng: 15, minr: 0, ammo: 10 },
  { tons: 14, slots: 10, heat: 7, dmg: 20, rng: 9, minr: 0, ammo: 5 },
  { tons: 0.5, slots: 1, heat: 0, dmg: 2, rng: 3, minr: 0, ammo: 200 },
  { tons: 2, slots: 1, heat: 2, dmg: 1, rng: 21, minr: 6, ammo: 24 },
  { tons: 5, slots: 2, heat: 4, dmg: 1, rng: 21, minr: 6, ammo: 12 },
  { tons: 7, slots: 3, heat: 5, dmg: 1, rng: 21, minr: 6, ammo: 8 },
  { tons: 10, slots: 5, heat: 6, dmg: 1, rng: 21, minr: 6, ammo: 6 },
  { tons: 1, slots: 1, heat: 2, dmg: 2, rng: 9, minr: 0, ammo: 50 },
  { tons: 2, slots: 1, heat: 3, dmg: 2, rng: 9, minr: 0, ammo: 25 },
  { tons: 3, slots: 2, heat: 4, dmg: 2, rng: 9, minr: 0, ammo: 15 },
  { tons: 0.5, slots: 1, heat: 1, dmg: 3, rng: 3, minr: 0, ammo: 0 },
  { tons: 1, slots: 1, heat: 3, dmg: 5, rng: 9, minr: 0, ammo: 0 },
  { tons: 5, slots: 2, heat: 8, dmg: 8, rng: 15, minr: 0, ammo: 0 },
  { tons: 1, slots: 1, heat: 3, dmg: 2, rng: 3, minr: 0, ammo: 0 },
  { tons: 7, slots: 3, heat: 10, dmg: 10, rng: 18, minr: 3, ammo: 0 },
];
export const usesAmmo = (t) => WEAPONS[t].kind !== 'e';

export const TONNAGES = []; for (let t = 20; t <= 100; t += 5) TONNAGES.push(t);
export const LOCS = ['Head', 'Left torso', 'Center torso', 'Right torso', 'Left arm', 'Right arm', 'Left leg', 'Right leg'];
export const LOC_SHORT = ['HD', 'LT', 'CT', 'RT', 'LA', 'RA', 'LL', 'RL'];
// Fixed equipment per location (original crit codes) — the rest of the 12 slots are free
const FIXED = [
  [45, 46, 47, 46, 45], [], [48, 48, 48, 48, 48, 48, 49, 49, 49, 49], [],
  [29, 30, 31, 32], [33, 34, 35, 36], [37, 38, 39, 40], [41, 42, 43, 44],
];
export const SLOT_CAP = [6, 12, 12, 12, 12, 12, 12, 12];
export const freeSlotsBase = FIXED.map((f, i) => SLOT_CAP[i] - f.length);

// Internal structure by tonnage: [head, center torso, side torso, arm, leg]
export function structureFor(t) {
  const T = {
    20: [3, 6, 5, 3, 4], 25: [3, 8, 6, 4, 6], 30: [3, 10, 7, 5, 7], 35: [3, 11, 8, 6, 8], 40: [3, 12, 10, 6, 10],
    45: [3, 14, 11, 7, 11], 50: [3, 16, 12, 8, 12], 55: [3, 18, 13, 9, 13], 60: [3, 20, 14, 10, 14], 65: [3, 21, 15, 10, 15],
    70: [3, 22, 15, 11, 15], 75: [3, 23, 16, 12, 16], 80: [3, 25, 17, 13, 17], 85: [3, 27, 18, 14, 18], 90: [3, 29, 19, 15, 19],
    95: [3, 30, 20, 16, 20], 100: [3, 31, 21, 17, 21],
  }[t] || [3, 10, 7, 5, 7];
  const [h, ct, st, arm, leg] = T;
  return [h, st, ct, st, arm, arm, leg, leg];
}
// Max armour per zone (11 zones). Torso front+rear share 2× structure.
export function maxArmorFor(t) {
  const i = structureFor(t);
  return { head: 9, lt: i[1] * 2, ct: i[2] * 2, rt: i[3] * 2, la: i[4] * 2, ra: i[5] * 2, ll: i[6] * 2, rl: i[7] * 2 };
}
const ZONE_MAX = (t) => { const m = maxArmorFor(t); return [m.head, m.lt, m.ct, m.rt, m.lt, m.ct, m.rt, m.la, m.ra, m.ll, m.rl]; };

export function engineTons(rating) {
  const r = Math.max(10, rating);
  const w = (r / 100) ** 2 * 1.6 + r * 0.012 + Math.max(0, r - 300) ** 2 / 500;
  return Math.ceil(w * 2) / 2;
}
export const jetTons = (t) => (t <= 55 ? 0.5 : t <= 85 ? 1 : 2);
export const maxWalk = (t) => Math.min(9, Math.floor(400 / t));

// Spread a total number of armour points over the 11 zones, in proportion to their maximums,
// with roughly 75/25 front/rear on the torso.
export function distributeArmor(tons, total) {
  const max = ZONE_MAX(tons);
  const cap = max[0] + max[1] + max[2] + max[3] + max[7] + max[8] + max[9] + max[10];
  const k = Math.min(1, total / cap);
  const a = new Array(11).fill(0);
  a[0] = Math.floor(max[0] * k);
  for (const [f, r] of [[1, 4], [2, 5], [3, 6]]) { const z = Math.floor(max[f] * k); a[f] = Math.ceil(z * 0.75); a[r] = z - a[f]; }
  for (const z of [7, 8, 9, 10]) a[z] = Math.floor(max[z] * k);
  // hand out the remainder front-first
  let left = total - a.reduce((s, v) => s + v, 0);
  const order = [2, 1, 3, 9, 10, 7, 8, 0, 5, 4, 6];
  let guard = 0;
  while (left > 0 && guard++ < 500) {
    let moved = false;
    for (const z of order) {
      if (left <= 0) break;
      const loc = [0, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7][z];
      const pair = z >= 1 && z <= 3 ? z + 3 : z >= 4 && z <= 6 ? z - 3 : -1;
      const limit = pair >= 0 ? max[z] - a[pair] : max[z];
      if (a[z] < limit) { a[z]++; left--; moved = true; }
      void loc;
    }
    if (!moved) break;
  }
  return a;
}
export function maxArmorPoints(tons) {
  const m = ZONE_MAX(tons);
  return m[0] + m[1] + m[2] + m[3] + m[7] + m[8] + m[9] + m[10];
}

export function defaultSpec(name = 'Custom') {
  return { v: 1, name, tons: 50, walk: 5, jump: 0, hs: 10, armor: distributeArmor(50, 128), weapons: [{ t: 13, loc: 4, ammo: 0 }, { t: 13, loc: 5, ammo: 0 }, { t: 10, loc: 1, ammo: 1 }] };
}

// Convert an original disk design into an editable spec (weapons get standard stats)
export function specFromStock(m) {
  return {
    v: 1, name: (m.n + ' Mk2').slice(0, 18), tons: Math.min(100, Math.max(20, Math.round(m.t / 5) * 5)), walk: Math.min(m.w, maxWalk(Math.min(100, m.t))), jump: m.j, hs: Math.max(10, m.hs),
    armor: m.a.slice(0, 11),
    weapons: m.wp.map((w) => ({ t: w[0], loc: w[7], ammo: usesAmmo(w[0]) ? 1 : 0 })),
  };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// Validate and build. Returns { ok, errors, warnings, template, budget }
export function buildTemplate(specIn) {
  const errors = [], warnings = [];
  const spec = specIn || {};
  const name = String(spec.name || 'Custom').replace(/[^\w .\-'!#]/g, '').trim().slice(0, 18) || 'Custom';
  const tons = TONNAGES.includes(+spec.tons) ? +spec.tons : 50;
  const walk = clampInt(spec.walk, 1, maxWalk(tons));
  const jump = clampInt(spec.jump, 0, walk);
  const hs = clampInt(spec.hs, 10, 40);
  const zmax = ZONE_MAX(tons);
  const armor = new Array(11).fill(0).map((_, z) => clampInt((spec.armor || [])[z], 0, zmax[z]));
  for (const [f, r] of [[1, 4], [2, 5], [3, 6]]) if (armor[f] + armor[r] > zmax[f]) armor[r] = Math.max(0, zmax[f] - armor[f]);
  const weapons = (Array.isArray(spec.weapons) ? spec.weapons : []).slice(0, 16).map((w) => ({
    t: clampInt(w.t, 0, 16), loc: clampInt(w.loc, 0, 7), ammo: usesAmmo(clampInt(w.t, 0, 16)) ? clampInt(w.ammo, 0, 4) : 0,
  }));
  if (!weapons.length) errors.push('Mount at least one weapon.');

  // ---- tonnage
  const rating = tons * walk;
  const budget = {
    structure: tons / 10,
    engine: engineTons(rating),
    gyro: Math.ceil(rating / 100),
    cockpit: 3,
    heatsinks: Math.max(0, hs - 10),
    jets: jump * jetTons(tons),
    armor: Math.ceil(armor.reduce((s, v) => s + v, 0) / 16 * 2) / 2,
    weapons: weapons.reduce((s, w) => s + WSTAT[w.t].tons, 0),
    ammo: weapons.reduce((s, w) => s + w.ammo, 0),
  };
  const used = Object.values(budget).reduce((s, v) => s + v, 0);
  if (used > tons + 1e-9) errors.push(`Overweight by ${(used - tons).toFixed(1)} tons.`);
  if (rating > 400) errors.push('Engine too big: tonnage × walk must be 400 or less.');

  // ---- critical slots
  const crit = FIXED.map((f, i) => { const row = new Array(12).fill(-1); f.forEach((c, k) => { row[k] = c; }); for (let k = SLOT_CAP[i]; k < 12; k++) row[k] = -1; return row; });
  const free = (loc) => { const out = []; for (let k = 0; k < SLOT_CAP[loc]; k++) if (crit[loc][k] === -1) out.push(k); return out; };
  const place = (loc, n, code) => {
    // contiguous block
    for (let k = 0; k + n <= SLOT_CAP[loc]; k++) {
      let ok = true;
      for (let q = 0; q < n; q++) if (crit[loc][k + q] !== -1) { ok = false; break; }
      if (ok) { for (let q = 0; q < n; q++) crit[loc][k + q] = code; return k; }
    }
    return -1;
  };
  const wp = [];
  const order = weapons.map((w, i) => ({ w, i })).sort((a, b) => WSTAT[b.w.t].slots - WSTAT[a.w.t].slots);
  const recs = new Array(weapons.length);
  for (const { w, i } of order) {
    const S = WSTAT[w.t];
    const slot = place(w.loc, S.slots, w.t);
    if (slot < 0) { errors.push(`${WEAPONS[w.t].name} doesn't fit in the ${LOCS[w.loc].toLowerCase()} (needs ${S.slots} slot${S.slots > 1 ? 's' : ''}, ${free(w.loc).length} free).`); continue; }
    let aloc = -1, aslot = -1;
    if (w.ammo > 0) {
      for (const l of [w.loc, 1, 3, 2, 4, 5, 6, 7]) { const k = place(l, 1, 17 + w.t); if (k >= 0) { aloc = l; aslot = k; break; } }
      if (aloc < 0) errors.push(`No room left for ${WEAPONS[w.t].short} ammo.`);
      // extra ammo tons take extra slots in the same place
      for (let e = 1; e < w.ammo; e++) { let okp = false; for (const l of [aloc, 1, 3, 2]) { if (l >= 0 && place(l, 1, 17 + w.t) >= 0) { okp = true; break; } } if (!okp) errors.push(`No room for extra ${WEAPONS[w.t].short} ammo.`); }
    } else if (usesAmmo(w.t)) warnings.push(`${WEAPONS[w.t].name} has no ammo and can't fire.`);
    recs[i] = [w.t, S.heat, S.dmg, S.rng, S.minr, S.slots, w.ammo * S.ammo, w.loc, slot, aloc, aslot];
  }
  for (const r of recs) if (r) wp.push(r);
  // heat sinks beyond the 10 in the engine, then jump jets
  for (let k = 0; k < hs - 10; k++) { let okp = false; for (const l of [1, 3, 4, 5, 2, 6, 7, 0]) if (place(l, 1, 51) >= 0) { okp = true; break; } if (!okp) { errors.push('Not enough free slots for all the heat sinks.'); break; } }
  for (let k = 0; k < jump; k++) { let okp = false; for (const l of [6, 7, 1, 3, 2]) if (place(l, 1, 50) >= 0) { okp = true; break; } if (!okp) { errors.push('Not enough free slots for the jump jets.'); break; } }

  // heat balance hint
  const fireHeat = wp.reduce((s, w) => s + w[1], 0);
  if (fireHeat > hs + 6) warnings.push(`Firing everything makes ${fireHeat} heat against ${hs} heat sinks — you will overheat.`);
  const armorPts = armor.reduce((s, v) => s + v, 0);
  if (armorPts < maxArmorPoints(tons) * 0.4) warnings.push('Very light armour.');

  const cls = tons <= 35 ? 0 : tons <= 55 ? 1 : tons <= 75 ? 2 : 3;
  const template = { n: name, c: cls, t: tons, a: armor, i: structureFor(tons), hs, w: walk, j: jump, wp, cr: crit, custom: true };
  const slotsFree = crit.map((row, l) => row.slice(0, SLOT_CAP[l]).filter((c) => c === -1).length);
  return { ok: errors.length === 0, errors, warnings, template, budget, used, rating, slotsFree, spec: { v: 1, name, tons, walk, jump, hs, armor, weapons } };
}

export function isCustomEntry(e) { return e && typeof e === 'object' && e.custom; }
export function entryName(e) { return typeof e === 'string' ? e : e && e.custom ? String(e.custom.name || 'Custom') : '?'; }
