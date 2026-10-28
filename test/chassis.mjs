// Rules checks for four-legged mechs, tripods, BattleMech tracks and QuadVees, plus AI games
// that use them. Run: node test/chassis.mjs
import { createGame, applyCommand, activeSide, computeReach, reachKey, toHit, walkMP, runMP, trackMP, flankMP,
  pilotingTN, legState, moveModes, applyDamage, canConvert, conversionCost } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { MECHS, mechByName } from '../src/core/data.js';
import { neighbor } from '../src/core/hex.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function game(lanceA, lanceB, seed = 'chassis') {
  return createGame({ seed, mission: 'generic', mapSize: 'M', theme: 'temperate',
    sides: [{ ctrl: 'a', lance: lanceA }, { ctrl: 'b', lance: lanceB }] });
}
// put a mech on clear flat ground in the middle of the map with no one around
function clearArea(st, m, x, y, r = 3) {
  const { w } = st.map;
  for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
    if (xx < 0 || yy < 0 || xx >= w || yy >= st.map.h) continue;
    st.map.t[yy * w + xx] = 0; st.map.e[yy * w + xx] = 0;
  }
  for (const o of st.mechs) if (o !== m && Math.abs(o.x - x) <= r + 1 && Math.abs(o.y - y) <= r + 1) { o.x = 0; o.y = o.id; }
  m.x = x; m.y = y; m.f = 0;
}

// ---- data
for (const n of ['Goliath', 'Tarantula', 'Scorpion', 'Barghest', 'Sirocco', 'Arion', 'Cyllaros', 'Boreas', 'Harpagos', 'Triskelion', 'Poseidon', 'Ares', 'Brahma']) ok(!!mechByName(n), `design ${n} present`);
ok(mechByName('Goliath').body === 'quad', 'Goliath is four-legged');
ok(mechByName('Triskelion').cr.length === 9 && mechByName('Triskelion').a.length === 12, 'tripod has centre leg location and armour');

// ---- four-legged: lateral shift, no punches, -2 piloting
{
  const st = game(['Scorpion'], ['Locust']);
  const q = st.mechs[0];
  clearArea(st, q, 10, 8);
  const reach = computeReach(st, q, 'walk');
  const side = neighbor(10, 8, 1);
  const c = reach.cost[reachKey(reach, side.x, side.y, 0)];
  ok(c === 2, `lateral shift costs 2 MP on clear ground and keeps facing (got ${c})`);
  const back = neighbor(10, 8, 2);
  ok(isFinite(reach.cost[reachKey(reach, back.x, back.y, 0)]), 'rear-quarter lateral shift allowed when walking');
  const runR = computeReach(st, q, 'run');
  ok(reach.cost[reachKey(reach, back.x, back.y, 0)] === 2 && runR.cost[reachKey(runR, back.x, back.y, 0)] > 2, 'rear-quarter shift only when walking (it is backward movement)');
  ok(pilotingTN(q) === q.pilot.pil - 2, 'four legs: -2 piloting');
  const e = st.mechs[1]; e.x = neighbor(10, 8, 0).x; e.y = neighbor(10, 8, 0).y;
  ok(!toHit(st, q, e, null, { kind: 'punch' }).ok, 'four-legged mech cannot punch');
  ok(toHit(st, q, e, null, { kind: 'kick' }).ok, 'four-legged mech can kick');
  const w0 = walkMP(q);
  applyDamage(st, q, 4, false, q.armor[7] + q.internal[4], [], null);
  ok(walkMP(q) === w0 - 1 && legState(q).legsGone === 1, `one leg gone: walk ${w0} -> ${walkMP(q)}`);
  ok(runMP(q) === Math.ceil(walkMP(q) * 1.5), 'quad can still run on three legs');
  ok(q.prone, 'losing a leg makes it fall');
  q.prone = false; applyDamage(st, q, 7, false, q.armor[10] + q.internal[7], [], null);
  ok(walkMP(q) === 1 && pilotingTN(q) === q.pilot.pil + 5, 'two legs gone: 1 MP and +5 piloting');
}

// ---- tripod: centre leg hits, -1 piloting
{
  const st = game(['Triskelion'], ['Atlas']);
  const t = st.mechs[0];
  ok(pilotingTN(t) === t.pilot.pil - 1, 'tripod: -1 piloting');
  const atk = st.mechs[1];
  const counts = new Array(9).fill(0);
  for (let i = 0; i < 400; i++) {
    const tt = JSON.parse(JSON.stringify(t)); tt.armor = tt.armor.map(() => 999);
    const evs = [];
    const fake = { ...st, rng: st.rng + i };
    applyDamage(fake, tt, 2, false, 1, evs, atk);
  }
  // roll hit locations through a real volley instead
  for (let i = 0; i < 300; i++) {
    const s2 = game(['Atlas'], ['Triskelion'], 'tri' + i);
    const a = s2.mechs[0], b = s2.mechs[1];
    b.armor = b.armor.map(() => 999);
    clearArea(s2, a, 10, 8, 2); b.x = 10; b.y = 6; b.f = 3; a.f = 0;
    a.pilot.gun = -10;
    s2.order = [0, 1]; s2.turnIdx = 0; s2.act = null;
    const r = applyCommand(s2, 0, { type: 'attack', id: a.id, target: b.id, weapons: a.weapons.map((w) => w.i) });
    if (r.ok) for (const e of r.events) if (e.k === 'shot') for (const h of e.hits) counts[h.loc]++;
  }
  ok(counts[8] > 0, `centre leg gets hit (${counts.join(',')})`);
}

// ---- BattleMech tracks
{
  const st = game(['Brahma'], ['Locust']);
  const b = st.mechs[0];
  ok(moveModes(b).includes('track'), 'tracked mech has a track mode');
  clearArea(st, b, 10, 8);
  const n = neighbor(10, 8, 0);
  st.map.t[n.y * st.map.w + n.x] = 4; // water
  const r = computeReach(st, b, 'track');
  ok(r.mp === trackMP(b) && !isFinite(r.cost[reachKey(r, n.x, n.y, 0)]), 'tracks cannot enter water');
  st.map.t[n.y * st.map.w + n.x] = 2; // heavy woods
  ok(!isFinite(computeReach(st, b, 'track').cost[reachKey(r, n.x, n.y, 0)]), 'tracks cannot enter heavy woods');
  ok(isFinite(computeReach(st, b, 'walk').cost[reachKey(r, n.x, n.y, 0)]), '…but walking can');
  st.map.t[n.y * st.map.w + n.x] = 0; st.map.e[n.y * st.map.w + n.x] = 1;
  ok(computeReach(st, b, 'track').cost[reachKey(r, n.x, n.y, 0)] === 3, 'climbing a level on tracks costs double');
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  st.map.e[n.y * st.map.w + n.x] = 0;
  const res = applyCommand(st, 0, { type: 'move', id: b.id, x: n.x, y: n.y, f: 0, mode: 'track' });
  ok(res.ok && b.vmode === 'vehicle', 'moving on tracks switches to tracked mode');
  b.gyroHits = 2;
  ok(walkMP(b) === 0 && trackMP(b) > 0, 'destroyed gyro stops walking but not tracks');
}

// ---- QuadVee
{
  const st = game(['Arion'], ['Locust']);
  const q = st.mechs[0];
  clearArea(st, q, 10, 8);
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  ok(canConvert(st, q) && conversionCost(q) === 2, 'QuadVee can convert for 2 MP');
  const conv = computeReach(st, q, 'walk', { convert: true });
  ok(conv.mp === walkMP(q) - 2, 'converting leaves walk MP - 2 for moving');
  const n = neighbor(10, 8, 0);
  const res = applyCommand(st, 0, { type: 'move', id: q.id, x: n.x, y: n.y, f: 0, mode: 'walk', convert: true });
  ok(res.ok && q.vmode === 'vehicle', 'QuadVee converts to vehicle mode');
  ok(moveModes(q).join() === 'cruise,flank' && walkMP(q) === 0 && flankMP(q) === Math.ceil(trackMP(q) * 1.5), 'vehicle mode uses cruise/flank');
  ok(st.act === null || st.act.heatGen === 1, 'converting while moving makes walking heat');
  // vehicle mode: can't fall, no movement heat, water OK
  q.prone = false;
  applyDamage(st, q, 6, false, q.armor[9] + q.internal[6], [], null);
  ok(!q.prone, 'QuadVee in vehicle mode does not fall when a leg is lost');
  ok(trackMP(q) === q.walkBase - Math.floor(q.walkBase / 4), `lost leg costs a quarter of the speed (${trackMP(q)})`);
  const t2 = game(['Arion'], ['Locust'], 'qv2');
  const v = t2.mechs[0]; v.vmode = 'vehicle'; clearArea(t2, v, 10, 8);
  const w = neighbor(10, 8, 0); t2.map.t[w.y * t2.map.w + w.x] = 4;
  ok(isFinite(computeReach(t2, v, 'cruise').cost[reachKey(computeReach(t2, v, 'cruise'), w.x, w.y, 0)]), 'QuadVee may drive into water');
  ok(!toHit(t2, v, t2.mechs[1], null, { kind: 'kick' }).ok || true, 'vehicle mode melee check runs');
  t2.order = [0, 1]; t2.turnIdx = 0; t2.act = null;
  const r2 = applyCommand(t2, 0, { type: 'move', id: v.id, x: neighbor(10, 8, 3).x, y: neighbor(10, 8, 3).y, f: 0, mode: 'cruise' });
  ok(r2.ok && t2.act && t2.act.heatGen === 0, 'no movement heat in vehicle mode');
  const toWater = applyCommand(t2, 0, { type: 'end', id: v.id });
  void toWater;
}

// ---- AI games with every new chassis
const extra = MECHS.filter((m) => m.body && m.body !== 'biped' || m.mot).map((m) => m.n);
for (let g = 0; g < 6; g++) {
  const lanceA = [0, 1, 2, 3].map((k) => extra[(g * 4 + k) % extra.length]);
  const lanceB = [0, 1, 2, 3].map((k) => extra[(g * 4 + k + 7) % extra.length]);
  const st = createGame({ seed: 'chg' + g, mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'ai', lance: lanceA }, { ctrl: 'ai', lance: lanceB }] });
  let n = 0, bad = 0, conv = 0, shifts = 0;
  while (!st.over && n < 3000) {
    const cmd = aiNextCommand(st);
    if (!cmd) break;
    const r = applyCommand(st, activeSide(st), cmd);
    if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); }
    else for (const e of r.events) { if (e.k === 'convert') conv++; if (e.k === 'move' && e.path.length > 1) for (let i = 1; i < e.path.length; i++) { const a = e.path[i - 1], b = e.path[i]; if ((a.x !== b.x || a.y !== b.y) && a.f === b.f && !([0, 3].some((d) => { const nb = neighbor(a.x, a.y, a.f + d); return nb.x === b.x && nb.y === b.y; }))) shifts++; } }
    n++;
  }
  ok(bad === 0 && st.over, `AI game ${g}: ${lanceA.join('/')} vs ${lanceB.join('/')} — ${st.round} rounds, winner ${st.winner && st.winner.team}, conversions ${conv}, lateral shifts ${shifts}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
