// Fog of war checks: visibility, last-seen memory, what each player is sent, and AI games.
// Run: node test/fog.mjs
import { createGame, applyCommand, activeSide, visibleTo, hexSeenBy, lineOfSight } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { fogView, fogEvents } from '../src/core/fog.js';
import { Room } from '../src/core/room.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// ---- visibility basics
{
  const st = createGame({ seed: 'fog1', mission: 'generic', mapSize: 'L', theme: 'temperate', fog: true, sides: [{ ctrl: 'a', lance: ['Atlas', 'Locust'] }, { ctrl: 'b', lance: ['Atlas', 'Locust'] }] });
  const [a, , b] = st.mechs;
  // wall a 1-hex ring of hills round mech b so no one can see it
  const { w } = st.map;
  b.x = 20; b.y = 10; a.x = 3; a.y = 10; st.mechs[1].x = 3; st.mechs[1].y = 12; st.mechs[3].x = 20; st.mechs[3].y = 12;
  for (let y = 0; y < st.map.h; y++) for (let x = 0; x < w; x++) { st.map.t[y * w + x] = 0; st.map.e[y * w + x] = 0; }
  for (let y = 0; y < st.map.h; y++) st.map.e[y * w + 12] = 4; // a ridge down the middle
  ok(!visibleTo(st, 0, b), 'enemy behind a ridge is hidden');
  ok(visibleTo(st, 1, b) && visibleTo(st, 0, a), 'own mechs are always visible');
  const v = fogView(st, [0]);
  ok(v.mechs[2].hidden && v.mechs[2].x === -1 && !v.mechs[0].hidden, 'player view takes hidden enemies off the map');
  ok(!v.seen[1], 'player view does not include the other team\'s sightings');
  for (let y = 0; y < st.map.h; y++) st.map.e[y * w + 12] = 0;
  ok(visibleTo(st, 0, b), 'enemy in open ground is visible');
  st.map.e[10 * w + 12] = 4; st.map.e[11 * w + 12] = 4; st.map.e[9 * w + 12] = 4;
  b.reveal = { r: st.round, t: 0 };
  for (let y = 0; y < st.map.h; y++) st.map.e[y * w + 12] = 4;
  ok(visibleTo(st, 0, b), 'firing gives a mech away for the rest of the round');
  ok(!visibleTo(st, 1, a) || lineOfSight(st, b.x, b.y, a.x, a.y).ok, 'reveal only to the team that was shot at');
}

// ---- what a player is sent, through the real host
{
  const sent = new Map();
  const room = new Room({ code: 'FOG', send: (id, msg) => { if (!sent.has(id)) sent.set(id, []); sent.get(id).push(msg); }, aiDelay: 0 });
  const p1 = room.join({ name: 'P1' });
  room.handle(p1, { t: 'settings', settings: { fog: true, mapSize: 'M', seed: 'fogroom' } });
  room.handle(p1, { t: 'lance', side: 0, lance: ['Atlas', 'Jenner', 'Arion'] });
  room.handle(p1, { t: 'start' });
  const g = room.game;
  ok(g.fog, 'lobby fog setting reaches the game');
  // play it out with the AI on side 1 and the AI also choosing for P1
  let leaks = 0, hiddenSeen = 0, moveTrims = 0, n = 0;
  room.scheduleAI = () => {};
  while (!g.over && n++ < 3000) {
    const side = activeSide(g);
    const cmd = aiNextCommand(g);
    if (!cmd) break;
    if (g.sides[side].ctrl === p1) room.handle(p1, { t: 'cmd', cmd, side });
    else room.aiStep();
    const msgs = sent.get(p1) || [];
    const last = msgs[msgs.length - 1];
    if (!last || last.t !== 'update') continue;
    for (const m of last.state.mechs) {
      const real = g.mechs[m.id];
      if (m.hidden) { hiddenSeen++; if (m.x !== -1 || real.dead) leaks++; }
      else if (real.team !== 0 && !visibleTo(g, 0, real)) leaks++;
    }
    for (const e of last.events) {
      if (e.k === 'move' && g.mechs[e.id].team !== 0) { for (const p of e.path) if (!hexSeenBy(g, 0, p.x, p.y, e.id)) leaks++; if (e.appear || e.vanish) moveTrims++; }
      if (e.k === 'activate' && g.mechs[e.id].team !== 0 && !visibleTo(g, 0, g.mechs[e.id])) leaks++;
    }
    sent.set(p1, []);
  }
  ok(g.over, `fog game finished (round ${g.round}, ${g.winner && g.winner.reason})`);
  ok(hiddenSeen > 0, `enemies were hidden from the player at times (${hiddenSeen} hidden mech-updates, ${moveTrims} moves seen only in part)`);
  ok(leaks === 0, `no hidden enemy positions or moves sent to the player (${leaks} leaks)`);
}

// ---- AI-vs-AI games with fog
for (let k = 0; k < 6; k++) {
  const st = createGame({ seed: 'fogai' + k, mission: ['generic', 'crossing', 'datapack', 'scout', 'generic', 'hold'][k], mapSize: ['S', 'M', 'L'][k % 3], theme: 'temperate', fog: true,
    sides: [{ ctrl: 'ai', lance: ['Atlas', 'Jenner', 'Arion', 'Hunchback'] }, { ctrl: 'ai', lance: ['Goliath', 'Wasp', 'Griffin', 'Brahma'] }] });
  let n = 0, bad = 0;
  while (!st.over && n++ < 4000) {
    const cmd = aiNextCommand(st);
    if (!cmd) break;
    const r = applyCommand(st, activeSide(st), cmd);
    if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); }
    else void fogEvents(st, r.events, [0]);
  }
  ok(st.over && bad === 0, `AI fog game ${k} (${st.mission}): ${st.round} rounds, ${st.winner && st.winner.reason}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
