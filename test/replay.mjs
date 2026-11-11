// Replays: the host records every command; playing them back reproduces the battle exactly.
import { Room } from '../src/core/room.js';
import { replayPlayer, validReplay } from '../src/core/replay.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
for (const [k, extra] of [[0, {}], [1, { fog: true, forces: 'many', defences: 'light', mapSize: 'L' }], [2, { forces: 'few', theme: 'volcanic', mission: 'crossing' }]]) {
  const sent = [];
  const room = new Room({ code: 'R' + k, send: (id, msg) => sent.push(msg), aiDelay: 0 });
  const p1 = room.join({ name: 'P1' });
  room.handle(p1, { t: 'settings', settings: { seed: 'rep' + k, ...extra } });
  room.handle(p1, { t: 'slot', side: 0, ctrl: 'ai' });
  room.scheduleAI = () => {};
  room.handle(p1, { t: 'start' });
  const g = room.game;
  let n = 0;
  while (!g.over && n++ < 5000) room.aiStep();
  const rep = sent.find((m) => m.t === 'replay');
  ok(g.over && rep && validReplay(rep.replay), `game ${k} over in ${g.round} rounds; replay sent (${rep ? rep.replay.cmds.length : 0} commands, ${rep ? (JSON.stringify(rep.replay).length / 1024).toFixed(0) : 0} KB)`);
  if (!rep) continue;
  // round trip through JSON, like a saved file
  const pl = replayPlayer(JSON.parse(JSON.stringify(rep.replay)));
  let bad = 0;
  while (!pl.done()) { const r = pl.step(); if (!r.ok) bad++; }
  const a = JSON.stringify({ m: g.mechs, w: g.winner, r: g.round, u: g.units, s: g.structures });
  const b = JSON.stringify({ m: pl.state.mechs, w: pl.state.winner, r: pl.state.round, u: pl.state.units, s: pl.state.structures });
  ok(bad === 0 && a === b, `game ${k}: playback ends in exactly the same state (${bad} rejected)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
