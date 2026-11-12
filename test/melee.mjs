// Hatchets, charges and pushes. Run: node test/melee.mjs
import './seed.mjs';
import { createGame, applyCommand, toHit, meleeDamage, chargeSelfDamage, hatchetProblem, shoveHex, MELEE_KINDS, totalArmor } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
function setup(seed, att, def) {
  const st = createGame({ seed, mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'a', lance: [att] }, { ctrl: 'b', lance: [def] }] });
  for (let i = 0; i < st.map.t.length; i++) { st.map.t[i] = 0; st.map.e[i] = 0; }
  st.structures = []; st.units = [];
  const a = st.mechs[0], d = st.mechs[1];
  a.x = 6; a.y = 8; a.f = 0; d.x = 10; d.y = 8; d.f = 3;
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  return st;
}
const elev = (st, x, y, e) => { st.map.e[y * st.map.w + x] = e; };

// ---- hatchet
{
  const st = setup('h1', 'Hatchetman', 'Griffin');
  const a = st.mechs[0], d = st.mechs[1];
  ok(a.hatchet === 5 && d.hatchet === undefined, 'only the Hatchetman carries a hatchet (right arm)');
  ok(!toHit(st, d, a, null, { kind: 'hatchet' }).ok, 'no hatchet attack without one');
  a.x = 9;
  const th = toHit(st, a, d, null, { kind: 'hatchet' }), tp = toHit(st, a, d, null, { kind: 'punch' });
  ok(th.ok && th.tn === tp.tn - 1 && th.mods.some((m) => m.label === 'Hatchet' && m.v === -1), `hatchet swings at -1 (${th.tn}+ against a punch's ${tp.tn}+)`);
  ok(meleeDamage(a, 'hatchet') === 8 && meleeDamage(a, 'punch') === 4, 'hatchet does tonnage / 5: 8 for a 40-tonner, twice its punch');
  a.actu.push(36);
  ok(hatchetProblem(a) && !toHit(st, a, d, null, { kind: 'hatchet' }).ok, 'no swing with the hand actuator gone');
  a.actu.length = 0; a.locGone[5] = 1;
  ok(!toHit(st, a, d, null, { kind: 'hatchet' }).ok, 'no swing with the arm gone');
}
{
  let hits = 0, n = 0, dmgOk = true;
  for (let k = 0; k < 40; k++) {
    const st = setup('hN' + k, 'Hatchetman', 'Griffin');
    const a = st.mechs[0], d = st.mechs[1];
    a.x = 9;
    const before = totalArmor(d);
    const r = applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'hatchet' });
    const e = r.events.find((x) => x.k === 'melee');
    n++; if (e.hit) { hits++; if (before - totalArmor(d) !== 8) dmgOk = false; } else if (before !== totalArmor(d)) dmgOk = false;
  }
  ok(hits > 8 && hits < n && dmgOk, `hatchet: ${hits}/${n} hit, each for exactly 8`);
}
// ---- charge
{
  const st = setup('c1', 'Atlas', 'Griffin');
  const a = st.mechs[0], d = st.mechs[1];
  a.x = 9;
  ok(toHit(st, a, d, null, { kind: 'charge' }).reason === 'Walk or run first', 'no charge from a standing start');
  a.x = 6;
  const r = applyCommand(st, 0, { type: 'move', id: 0, mode: 'walk', x: 9, y: 8, f: 0 });
  ok(r.ok && a.lastMove.hexes === 3, 'walked three hexes up to the target');
  const th = toHit(st, a, d, null, { kind: 'charge' });
  ok(th.ok && th.mods.some((m) => m.label === 'You walked'), `charge to-hit ${th.tn}+`);
  const cd = Math.ceil(a.tons / 10) * 3, cs = Math.ceil(d.tons / 10);
  ok(meleeDamage(a, 'charge') === cd && chargeSelfDamage(d) === cs, `a ${a.tons}-tonner that moved 3 hexes hits for ${cd} and takes ${cs} back from a ${d.tons}-tonner`);
  d.pilot.pil = a.pilot.pil - 2;
  ok(toHit(st, a, d, null, { kind: 'charge' }).tn === th.tn + 2, 'a better pilot is harder to ram');
  a.f = 1;
  ok(toHit(st, a, d, null, { kind: 'charge' }).reason === 'Not straight ahead', 'the target has to be straight ahead');
  a.f = 0; d.prone = true;
  ok(!toHit(st, a, d, null, { kind: 'charge' }).ok, 'no charging a mech on the ground');
}
{
  let hits = 0, n = 0, good = true, shoved = 0, jumped = 0;
  for (let k = 0; k < 40; k++) {
    const st = setup('cN' + k, 'Atlas', 'Griffin');
    const a = st.mechs[0], d = st.mechs[1];
    applyCommand(st, 0, { type: 'move', id: 0, mode: 'walk', x: 9, y: 8, f: 0 });
    const b = { a: totalArmor(a), d: totalArmor(d) };
    const r = applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'charge' });
    const e = r.events.find((x) => x.k === 'melee');
    n++;
    if (e.hit) {
      hits++;
      const fellA = r.events.some((x) => x.k === 'fall' && x.id === 0), fellD = r.events.some((x) => x.k === 'fall' && x.id === 1);
      if (!d.dead && b.d - totalArmor(d) < 30) good = false;
      if (b.a - totalArmor(a) < 5 || (!fellA && b.a - totalArmor(a) !== 5)) good = false;
      if (r.events.some((x) => x.k === 'shove' && x.id === 1 && x.x === 11 && x.y === 8) && d.x === 11) shoved++;
      void fellD;
    } else if (b.a !== totalArmor(a) || b.d !== totalArmor(d) || d.x !== 10) good = false;
    // jumping in doesn't count
    const s2 = setup('cJ' + k, 'Grasshopper', 'Griffin');
    applyCommand(s2, 0, { type: 'move', id: 0, mode: 'jump', x: 9, y: 8, f: 0 });
    if (!applyCommand(s2, 0, { type: 'melee', id: 0, target: 1, kind: 'charge' }).ok) jumped++;
  }
  ok(hits > 5 && hits < n && good, `charge: ${hits}/${n} hit; the target takes 30+, the attacker 5+, a miss costs nothing`);
  ok(shoved === hits, `every hit knocks the target back a hex (${shoved}/${hits})`);
  ok(jumped === n, 'a jump can\'t end in a charge');
}
// ---- push
{
  const st = setup('p1', 'Atlas', 'Griffin');
  const a = st.mechs[0], d = st.mechs[1];
  a.x = 9;
  const th = toHit(st, a, d, null, { kind: 'push' }), tp = toHit(st, a, d, null, { kind: 'punch' });
  ok(th.ok && th.tn === tp.tn - 1, `push at -1 (${th.tn}+)`);
  ok(meleeDamage(a, 'push') === 0, 'a push does no damage of its own');
  elev(st, 11, 8, 2);
  ok(toHit(st, a, d, null, { kind: 'push' }).reason === 'Nowhere to push' && !shoveHex(st, d, 0), 'can\'t push a mech up a cliff');
  elev(st, 11, 8, 0); st.mechs.push({ ...JSON.parse(JSON.stringify(d)), id: 2, x: 11, y: 8 });
  ok(!toHit(st, a, d, null, { kind: 'push' }).ok, 'can\'t push into another mech');
  st.mechs.pop();
  a.locGone[4] = 1;
  ok(toHit(st, a, d, null, { kind: 'push' }).reason === 'Needs both arms', 'a push needs both arms');
  const q = setup('p2', 'Scorpion', 'Griffin'); q.mechs[0].x = 9;
  ok(!toHit(q, q.mechs[0], q.mechs[1], null, { kind: 'push' }).ok, 'four-legged mechs can\'t push');
  const e = setup('p3', 'Atlas', 'Griffin'); e.mechs[0].x = 9; e.mechs[1].x = 10; e.mechs[0].f = 0;
  e.mechs[1].x = e.map.w - 1; e.mechs[0].x = e.map.w - 2;
  ok(!toHit(e, e.mechs[0], e.mechs[1], null, { kind: 'push' }).ok, 'can\'t push a mech off the map');
}
{
  let hits = 0, n = 0, good = true, falls = 0, cliff = 0, cliffFalls = 0;
  for (let k = 0; k < 40; k++) {
    const st = setup('pN' + k, 'Atlas', 'Griffin');
    const a = st.mechs[0], d = st.mechs[1];
    a.x = 9;
    const b = totalArmor(d);
    const r = applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'push' });
    const e = r.events.find((x) => x.k === 'melee');
    n++;
    if (e.hit) { hits++; if (d.x !== 11 || d.y !== 8) good = false; if (d.prone) falls++; else if (totalArmor(d) !== b) good = false; }
    else if (d.x !== 10) good = false;
    // off a three-level ledge
    const s2 = setup('pC' + k, 'Atlas', 'Griffin');
    for (let x = 0; x <= 10; x++) for (let y = 0; y < s2.map.h; y++) elev(s2, x, y, 3);
    s2.mechs[0].x = 9;
    const b2 = totalArmor(s2.mechs[1]);
    const r2 = applyCommand(s2, 0, { type: 'melee', id: 0, target: 1, kind: 'push' });
    if (r2.events.find((x) => x.k === 'melee').hit) { cliff++; if (s2.mechs[1].prone && b2 - totalArmor(s2.mechs[1]) >= Math.ceil(s2.mechs[1].tons / 10) * 4) cliffFalls++; }
  }
  ok(hits > 8 && hits < n && good, `push: ${hits}/${n} landed, moving the target one hex with no damage unless it fell (${falls} fell)`);
  ok(cliff > 5 && cliffFalls === cliff, `pushed off a three-level ledge it always falls, for four levels' worth (${cliffFalls}/${cliff})`);
}
// ---- the item goes with a shoved carrier
{
  const st = setup('i1', 'Atlas', 'Griffin');
  const a = st.mechs[0], d = st.mechs[1];
  st.item = { name: 'Datapack', x: 10, y: 8, carrier: 1, gone: false }; d.carrying = true;
  for (let k = 0; k < 30 && d.x === 10; k++) { a.x = 9; a.activated = false; st.act = null; st.turnIdx = 0; st.order = [0, 1]; applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'push' }); d.prone = false; }
  ok(d.x === 11 && st.item.x === 11, 'a carried objective moves with the mech that was shoved');
}
// ---- every kind is a known command, and nonsense isn't
{
  const st = setup('k1', 'Atlas', 'Griffin');
  st.mechs[0].x = 9;
  ok(MELEE_KINDS.join() === 'punch,kick,hatchet,charge,push,dfa', 'six physical attacks');
  ok(applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'bite' }).error === 'Unknown attack', 'unknown attacks are refused');
}
// ---- the computer uses them
{
  const used = {};
  for (let k = 0; k < 14; k++) {
    const st = createGame({ seed: 'aim' + k, mission: 'generic', mapSize: 'S', theme: 'temperate', aiLevel: 'hard',
      sides: [{ ctrl: 'ai', lance: ['Hatchetman', 'Atlas', 'Banshee', 'Hatchetman'] }, { ctrl: 'ai', lance: ['Griffin', 'Hatchetman', 'Wolverine', 'Atlas'] }] });
    let n = 0;
    while (!st.over && n++ < 5000) {
      const c = aiNextCommand(st);
      if (c.type === 'melee') used[c.kind] = (used[c.kind] || 0) + 1;
      const r = applyCommand(st, st.order[st.turnIdx], c);
      if (!r.ok) { ok(false, 'AI command refused: ' + r.error + ' ' + JSON.stringify(c)); break; }
    }
  }
  ok(used.kick > 0, `computer pilots kick (${JSON.stringify(used)})`);
  ok(used.charge > 0, 'computer pilots charge');
}
// ---- a Hatchetman whose guns are gone reaches for the hatchet, not its fist or foot
{
  let swings = 0, other = 0;
  for (let k = 0; k < 12; k++) {
    const st = setup('ah' + k, 'Hatchetman', 'Griffin');
    st.sides[0].ctrl = 'ai';
    const a = st.mechs[0];
    a.x = 9; for (const w of a.weapons) w.ok = false;
    for (let n = 0; n < 12 && st.order[st.turnIdx] === 0 && !st.over; n++) {
      const c = aiNextCommand(st);
      if (c.type === 'melee') { if (c.kind === 'hatchet') swings++; else other++; }
      if (!applyCommand(st, 0, c).ok) break;
    }
  }
  ok(swings >= 8 && swings > other * 3, `with its guns gone a computer Hatchetman swings the hatchet (${swings} swings, ${other} other attacks in 12 tries)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
