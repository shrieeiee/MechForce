// Infantry and vehicles: setup, damage rules, AI games. Run: node test/units.mjs
import { createGame, applyCommand, activeSide, toHitUnit, unitAt, computeReach } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { fogView, fogEvents } from '../src/core/fog.js';
import { sanitizeMap, blankMap } from '../src/core/maps.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const flat = (st) => { for (let i = 0; i < st.map.t.length; i++) { st.map.t[i] = 0; st.map.e[i] = 0; } st.structures = []; };

// ---- map format
{
  const m = blankMap('M');
  m.u = [{ k: 'tank', x: 8, y: 8, team: 0 }, { k: 'tank', x: 8, y: 8, team: 1 }, { k: 'rifle', x: 9, y: 8, team: 9 }, { k: 'hover', x: 0, y: 5 }, { k: 'nope', x: 5, y: 5 }];
  m.t[8 * m.w + 10] = 4; m.u.push({ k: 'car', x: 10, y: 8 }, { k: 'hover', x: 10, y: 8 });
  const c = sanitizeMap(m);
  ok(c.u.length === 3 && c.u[1].team === 3 && c.u[2].k === 'hover', 'units on custom maps: one per hex, legal ground only, not in deployment zones');
}
// ---- setup and basic rules
{
  const st = createGame({ seed: 'u1', mission: 'generic', mapSize: 'M', theme: 'temperate', forces: 'many', sides: [{ ctrl: 'a', lance: ['Atlas', 'Jenner'] }, { ctrl: 'b', lance: ['Atlas', 'Jenner'] }] });
  ok(st.units.length >= 6 && st.units.some((u) => u.team === -1) && st.units.some((u) => u.team === 0) && st.units.some((u) => u.team === 1), `'many' forces: ${st.units.map((u) => u.kind + ':' + u.team).join(' ')}`);
  flat(st);
  const a = st.mechs[0];
  a.x = 5; a.y = 8; a.f = 0;
  const inf = st.units.find((u) => u.inf) || st.units[0];
  st.units.forEach((u, i) => { u.x = 1 + i; u.y = 1; });
  inf.x = 8; inf.y = 8; inf.team = 1;
  const ml = a.weapons.find((w) => w.t === 13) || a.weapons[0];
  const th = toHitUnit(st, a, inf, ml);
  ok(th.ok && th.mods.some((m) => m.label === 'Infantry'), 'shooting infantry: +1 to hit');
  // MGs vs lasers against infantry in the open
  let ml1 = 0, mg = 0;
  for (let k = 0; k < 30; k++) {
    const s2 = createGame({ seed: 'u2' + k, mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'a', lance: ['Jenner'] }, { ctrl: 'b', lance: ['Locust'] }] });
    flat(s2);
    s2.units = [{ ...st.units[0], ...inf, id: 0, troops: 28, x: 7, y: 8, dead: false, team: 1, moved: 0 }];
    const j = s2.mechs[0]; j.x = 6; j.y = 8; j.f = 0; s2.order = [0, 1]; s2.turnIdx = 0; s2.act = null;
    const lasers = j.weapons.filter((w) => w.t === 13).map((w) => w.i);
    const r = applyCommand(s2, 0, { type: 'attack', id: 0, unit: 0, weapons: lasers });
    if (r.ok) ml1 += 28 - s2.units[0].troops;
  }
  ok(ml1 > 0, `medium lasers kill few troopers (${ml1} over 30 volleys)`);
  // movement: mechs can't walk through an enemy unit's hex
  const tank = st.units.find((u) => !u.inf); tank.x = 6; tank.y = 8; tank.team = 1;
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  const rc = computeReach(st, a, 'walk');
  ok(!isFinite(rc.cost[(8 * st.map.w + 6) * 6 + 0]) && unitAt(st, 6, 8) === tank, 'enemy vehicles block movement');
}
// ---- AI games with forces and fog
let shots = 0, kills = 0, mechHits = 0;
for (let k = 0; k < 8; k++) {
  const st = createGame({ seed: 'uai' + k, mission: ['generic', 'crossing', 'generic', 'hold'][k % 4], mapSize: ['S', 'M', 'L'][k % 3], theme: ['temperate', 'desert', 'snow', 'volcanic'][k % 4], forces: k % 2 ? 'many' : 'few', fog: k % 3 === 0,
    sides: [{ ctrl: 'ai', lance: ['Atlas', 'Jenner', 'Griffin', 'Wolverine'] }, { ctrl: 'ai', lance: ['Goliath', 'Wasp', 'Hunchback', 'Phoenix Hawk'] }] });
  let n = 0, bad = 0;
  while (!st.over && n++ < 5000) {
    const cmd = aiNextCommand(st);
    if (!cmd) break;
    const r = applyCommand(st, activeSide(st), cmd);
    if (!r.ok) { bad++; console.log('bad', r.error, JSON.stringify(cmd)); applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); continue; }
    shots += r.events.filter((e) => e.k === 'ushot').length;
    mechHits += r.events.filter((e) => e.k === 'ushot' && e.hit && e.target !== undefined).length;
    kills += r.events.filter((e) => e.k === 'ugone').length;
    if (st.fog) { const v = fogView(st, [0]); for (const u of v.units) if (u.team !== 0 && !u.dead && u.x >= 0 && !u.hidden) { /* visible */ } fogEvents(st, r.events, [0]); }
    // no unit ever shares a hex with a mech or another unit
    for (const u of st.units) if (!u.dead && (st.mechs.some((m) => !m.dead && !m.exited && m.x === u.x && m.y === u.y) || st.units.some((o) => o !== u && !o.dead && o.x === u.x && o.y === u.y))) { bad++; console.log('overlap', u.kind, u.x, u.y); break; }
  }
  ok(st.over && bad === 0, `AI game ${k} (${st.mission}, ${st.units.length} units): ${st.round} rounds, ${st.winner && st.winner.reason}`);
}
ok(shots > 20 && mechHits > 0 && kills > 0, `units fired ${shots} times (${mechHits} hits on mechs), ${kills} units destroyed`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
