// Death from above and exploding mechs. Run: node test/dfa.mjs
import { createGame, applyCommand, activeSide, toHit, dfaDamage, dfaSelfDamage, reactorBlast, __test } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const flat = (st) => { for (let i = 0; i < st.map.t.length; i++) { st.map.t[i] = 0; st.map.e[i] = 0; } st.structures = []; };

// a duel: side 0's jumper lands next to side 1's mech
function setup(seed, att = 'Grasshopper', def = 'Atlas') {
  const st = createGame({ seed, mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'a', lance: [att] }, { ctrl: 'b', lance: [def] }] });
  flat(st);
  return st;
}
// play side 0's activation: jump to (x,y) then return the result of the melee command
function jumpAndDfa(st, x, y) {
  const a = st.mechs[0], d = st.mechs[1];
  d.x = 10; d.y = 8; d.f = 3; a.x = 7; a.y = 8; a.f = 0;
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  return applyCommand(st, 0, { type: 'move', id: 0, mode: 'jump', x, y, f: 0 });
}

{
  const st = setup('dfa1', 'Grasshopper');
  const a = st.mechs[0], d = st.mechs[1];
  ok(!toHit(st, a, d, null, { kind: 'dfa' }).ok, 'no death from above without jumping');
  const r = jumpAndDfa(st, 9, 8);
  ok(r.ok, 'jumped next to the target ' + (r.error || ''));
  const th = toHit(st, a, d, null, { kind: 'dfa' });
  ok(th.ok && th.mods.some((m) => m.label === 'Piloting') && th.mods.some((m) => m.label === 'You jumped'), `DFA to-hit uses piloting and the jump (${th.tn}+)`);
  const before = { d: d.armor.reduce((s, v) => s + v, 0) + d.internal.reduce((s, v) => s + v, 0), a: a.armor.reduce((s, v) => s + v, 0) + a.internal.reduce((s, v) => s + v, 0) };
  const res = applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'dfa' });
  ok(res.ok, 'DFA command accepted');
  const e = res.events.find((x) => x.k === 'melee');
  const after = { d: d.armor.reduce((s, v) => s + v, 0) + d.internal.reduce((s, v) => s + v, 0), a: a.armor.reduce((s, v) => s + v, 0) + a.internal.reduce((s, v) => s + v, 0) };
  if (e.hit) ok(before.d - after.d === dfaDamage(a) && before.a - after.a >= dfaSelfDamage(a), `hit: target took ${before.d - after.d} (want ${dfaDamage(a)}), attacker's legs ${before.a - after.a}`);
  else ok(a.prone && before.a - after.a >= Math.ceil(a.tons / 10) * 3, `miss: attacker fell for ${before.a - after.a}`);
}
// many trials: hit rate and both outcomes happen
{
  let hits = 0, miss = 0, n = 0;
  for (let k = 0; k < 60; k++) {
    const st = setup('dfaN' + k, 'Grasshopper', 'Griffin');
    jumpAndDfa(st, 9, 8);
    const res = applyCommand(st, 0, { type: 'melee', id: 0, target: 1, kind: 'dfa' });
    if (!res.ok) continue;
    n++;
    if (res.events.find((x) => x.k === 'melee').hit) hits++; else miss++;
  }
  ok(n > 50 && hits > 0 && miss > 0, `60 tries: ${hits} hits, ${miss} misses`);
}
// reactor breach hits the neighbours
{
  let breaches = 0, hurt = 0;
  for (let k = 0; k < 80 && breaches < 3; k++) {
    const st = createGame({ seed: 'boom' + k, mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'a', lance: ['Atlas', 'Locust'] }, { ctrl: 'b', lance: ['Atlas'] }] });
    flat(st);
    const [v, n1, att] = st.mechs;
    v.x = 10; v.y = 8; n1.x = 11; n1.y = 8; att.x = 4; att.y = 8;
    // two engine hits already; the next engine critical wrecks it
    v.engineHits = 2;
    const ct = v.crit[2];
    v.crit[2] = ct.map((c) => (c === 48 ? 48 : -1)); v.critHit[2] = v.critHit[2].map(() => 0);
    const arm0 = n1.armor.reduce((a, b) => a + b, 0) + n1.internal.reduce((a, b) => a + b, 0);
    const ev = [];
    // force the critical through the public path: shoot until destroyed is too random, so use the internal hook
    __test.applyCrit(st, v, 2, ev, att);
    if (ev.some((e) => e.k === 'blast')) {
      breaches++;
      const arm1 = n1.armor.reduce((a, b) => a + b, 0) + n1.internal.reduce((a, b) => a + b, 0);
      if (arm0 - arm1 >= reactorBlast(v) || n1.dead) hurt++;
    }
  }
  ok(breaches > 0 && hurt === breaches, `reactor breaches damage adjacent mechs (${breaches} breaches, neighbour took the full blast)`);
}
// AI games still finish, and the AI sometimes jumps on people
{
  let dfas = 0, blasts = 0;
  for (let k = 0; k < 8; k++) {
    const st = createGame({ seed: 'dfaai' + k, mission: 'generic', mapSize: 'S', theme: 'temperate', sides: [{ ctrl: 'ai', lance: ['Grasshopper', 'Jenner', 'Griffin', 'Phoenix Hawk'] }, { ctrl: 'ai', lance: ['Victor', 'Spider', 'Bruiser', 'Wolverine'] }] });
    let n = 0, bad = 0;
    while (!st.over && n++ < 4000) {
      const cmd = aiNextCommand(st);
      if (!cmd) break;
      const r = applyCommand(st, activeSide(st), cmd);
      if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); continue; }
      dfas += r.events.filter((e) => e.k === 'melee' && e.kind === 'dfa').length;
      blasts += r.events.filter((e) => e.k === 'blast').length;
    }
    ok(st.over && bad === 0, `AI game ${k}: ${st.round} rounds`);
  }
  ok(dfas > 0, `AI used death from above ${dfas} times (${blasts} blasts)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
