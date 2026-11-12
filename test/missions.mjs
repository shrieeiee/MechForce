// The remake's own missions: base assault, base defence and the convoy escort.
import './seed.mjs';
import assert from 'node:assert';
import { createGame, applyCommand, activeSide, objectiveStructure, convoyUnits, convoyCount, convoyField, checkVictory, maxRounds } from '../src/core/rules.js';
import { damageStructure } from '../src/core/structures.js';
import { hurtUnit } from '../src/core/forces.js';
import { aiNextCommand } from '../src/core/ai.js';
import { blankMap } from '../src/core/maps.js';
import { refresh, newCompany } from '../src/core/campaign.js';

const sides = () => [0, 1].map(() => ({ ctrl: 'ai', lance: ['Hunchback', 'Centurion', 'Griffin', 'Wolverine'] }));
const game = (mission, extra = {}) => createGame({ seed: 'mis-' + mission, mission, mapSize: 'M', theme: 'temperate', sides: sides(), ...extra });
const playOut = (st, max = 6000) => { let n = 0; while (!st.over && n++ < max) { const c = aiNextCommand(st); const r = applyCommand(st, activeSide(st), c); assert(r.ok, r.error + ' ' + JSON.stringify(c)); } return st; };

// ---- base assault: the defender (team 1) gets a command post with guns in front of it
{
  const st = game('base');
  const hq = objectiveStructure(st);
  assert(hq && hq.kind === 'hq' && hq.team === 1 && hq.obj, 'command post belongs to the defender');
  assert(hq.x >= st.map.w - 8 && hq.x < st.map.w - 2, 'command post sits on the defender\'s side');
  const guns = st.structures.filter((s) => s.team === 1 && s.weapons.length);
  assert(guns.length >= 2, 'the base has emplacements');
  assert(guns.every((s) => Math.abs(s.x - hq.x) <= 4), 'emplacements stand by the command post');
  assert(st.sides[0].goal.includes('command post') && st.sides[1].goal.includes('command post'));
  // knocking it down ends the battle for the attacker
  const ev = [];
  damageStructure(st, hq, 9999, ev, null);
  assert(st.over && st.winner.team === 0 && /command post/.test(st.winner.reason), 'attacker wins when the command post falls');
  assert(ev.some((e) => e.k === 'sgone' && e.sid === hq.id));
}
// ---- time runs out: the base holds
{
  const st = game('base');
  st.round = maxRounds(st);
  for (const m of st.mechs) m.activated = true;
  st.act = null;
  // force the end of the round through an ordinary command
  const m = st.mechs.find((x) => x.side === activeSide(st));
  m.activated = false;
  applyCommand(st, m.side, { type: 'end', id: m.id });
  assert(st.over && st.winner.team === 1 && /held/.test(st.winner.reason), 'defender wins on time: ' + JSON.stringify(st.winner));
}
// ---- defend: the same, the other way round, and the clock is the objective
{
  const st = game('defend', { roundLimit: 'none' });
  const hq = objectiveStructure(st);
  assert(hq.team === 0 && hq.x <= 7, 'the west side defends');
  assert.equal(maxRounds(st), 12, 'the round limit is the objective and can\'t be switched off');
  damageStructure(st, hq, 9999, [], null);
  assert(st.winner.team === 1);
}
// ---- a custom map's own command post is used, and nothing extra is built
{
  const map = blankMap('M');
  map.s.push({ k: 'hq', x: 15, y: 5, f: 3, team: 1, load: [] }, { k: 'hq', x: 6, y: 5, f: 0, team: 0, load: [] });
  const st = game('base', { customMap: map });
  const hq = objectiveStructure(st);
  assert(hq.x === 15 && hq.y === 5 && hq.team === 1, 'the map\'s command post is the objective');
  assert.equal(st.structures.length, 2, 'no extra emplacements on a designed map');
  assert(!st.structures.find((s) => s.x === 6).obj, 'the other side\'s command post is just a building here');
  const st2 = game('defend', { customMap: blankMap('M') });
  assert(objectiveStructure(st2), 'a map without one gets a command post');
}
// ---- convoy: three haulers on a road that reaches the far edge
for (const [size, theme, seed] of [['S', 'temperate', 1], ['M', 'arctic', 2], ['L', 'volcanic', 3], ['M', 'desert', 4], ['L', 'temperate', 5], ['S', 'volcanic', 6]]) {
  const st = createGame({ seed: 'conv' + seed, mission: 'convoy', mapSize: size, theme, sides: sides(), defences: 'heavy', forces: 'many' });
  const trucks = convoyUnits(st);
  assert.equal(trucks.length, 3);
  assert(trucks.every((u) => u.team === 0 && u.kind === 'truck' && !u.weapons.length));
  const f = convoyField(st);
  assert(trucks.every((u) => isFinite(f[u.y * st.map.w + u.x])), `every hauler has a road east (${size} ${theme})`);
  assert(!st.mechs.some((m) => trucks.some((u) => u.x === m.x && u.y === m.y)), 'nobody deploys on a hauler');
}
{
  const st = game('convoy');
  const trucks = convoyUnits(st);
  const x0 = trucks.map((u) => u.x);
  // two lost: the raiders win
  const st2 = game('convoy');
  const t2 = convoyUnits(st2);
  hurtUnit(st2, t2[0], null, 1, [], null, 9999);
  assert(!st2.over, 'one hauler lost is not the end');
  t2[1].immobile = true; t2[1].mp = 0;
  checkVictory(st2, []);
  assert(st2.over && st2.winner.team === 1 && /stopped/.test(st2.winner.reason), 'a crippled hauler counts as lost');
  // left alone (the enemy concedes nothing, but can't shoot: no weapons), they drive off the east edge
  for (const m of st.mechs) if (m.team === 1) for (const w of m.weapons) w.ok = false;
  for (const m of st.mechs) m.jumpBase = 0;
  playOut(st);
  const c = convoyCount(st);
  assert(trucks.some((u, i) => u.x > x0[i]) || c.out > 0, 'the haulers drive east');
  assert(st.winner.team === 0 && c.out >= 2, 'the escort wins when two get through: ' + JSON.stringify(st.winner) + JSON.stringify(c));
}
// ---- the computer can play all three to a finish, from both sides
for (const mission of ['base', 'defend', 'convoy']) for (let g = 0; g < 3; g++) {
  const st = createGame({ seed: 'ai' + mission + g, mission, mapSize: ['S', 'M', 'L'][g], theme: 'temperate', sides: sides(), fog: g === 1 });
  playOut(st);
  assert(st.over && st.winner, mission + ' finishes');
}
// ---- campaign contracts offer them
{
  const seen = new Set();
  for (let i = 0; i < 60; i++) { const co = newCompany('Test', 's' + i); refresh(co); co.board.forEach((c) => seen.add(c.mission)); }
  for (const m of ['base', 'defend', 'convoy']) assert(seen.has(m), 'contracts include ' + m);
}
console.log('missions ok');
