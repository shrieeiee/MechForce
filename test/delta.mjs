// State deltas: patch(prev, diff(prev, next)) must equal next for real game states, and be small.
import { createGame, applyCommand, activeSide } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { fogView } from '../src/core/fog.js';
import { diff, patch, jclone } from '../src/core/delta.js';
import { Room } from '../src/core/room.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// unit cases
{
  const cases = [[{ a: 1, b: [1, 2, 3] }, { a: 2, b: [1, 2, 3, 4] }], [{ x: { y: 1 } }, { x: null }], [[1, 2, 3], [1, 2]], [{ a: 1, k: 2 }, { a: 1 }], [{ a: [{ p: 1 }, { p: 2 }] }, { a: [{ p: 1 }, { p: 3, q: 4 }] }], [{ a: 'x' }, { a: { b: 1 } }]];
  ok(cases.every(([a, b]) => JSON.stringify(patch(jclone(a), jclone(diff(a, b)))) === JSON.stringify(b)), 'unit cases round-trip');
}
// real games, with and without fog
for (const fog of [false, true]) {
  const st = createGame({ seed: 'delta' + fog, mission: 'datapack', mapSize: 'M', theme: 'temperate', fog, forces: 'few', defences: 'light', sides: [{ ctrl: 'ai', lance: ['Atlas', 'Jenner', 'Griffin', 'Wolverine'] }, { ctrl: 'ai', lance: ['Goliath', 'Wasp', 'Hunchback', 'Phoenix Hawk'] }] });
  let prev = jclone(fog ? fogView(st, [0]) : st), bad = 0, full = 0, sent = 0, n = 0;
  while (!st.over && n++ < 3000) {
    const cmd = aiNextCommand(st); if (!cmd) break;
    applyCommand(st, activeSide(st), cmd);
    const next = jclone(fog ? fogView(st, [0]) : st);
    const d = diff(prev, next);
    const wire = JSON.stringify(d === undefined ? null : d);
    const got = d === undefined ? prev : patch(jclone(prev), JSON.parse(wire));
    if (JSON.stringify(got) !== JSON.stringify(next)) bad++;
    full += JSON.stringify(next).length; sent += wire.length;
    prev = next;
  }
  ok(bad === 0, `${fog ? 'fog' : 'open'} game: ${n} updates reconstruct exactly (${bad} mismatches)`);
  ok(sent < full * 0.25, `deltas are ${(sent / 1024).toFixed(0)} KB vs ${(full / 1024).toFixed(0)} KB full (${(100 * sent / full).toFixed(1)}%)`);
}
// through a Room with deltas on: a client that applies patches tracks the host's view
{
  const msgs = [];
  const room = new Room({ code: 'DLT', deltas: true, send: (id, m) => msgs.push(JSON.parse(JSON.stringify(m))), aiDelay: 0 });
  const p1 = room.join({ name: 'P1' });
  room.handle(p1, { t: 'settings', settings: { seed: 'dr', mapSize: 'S', fog: true } });
  room.handle(p1, { t: 'start' });
  room.scheduleAI = () => {};
  let state = null, seq = -1, bad = 0, patched = 0;
  const g = room.game;
  let n = 0;
  while (!g.over && n++ < 1500) {
    const side = activeSide(g); const cmd = aiNextCommand(g); if (!cmd) break;
    if (g.sides[side].ctrl === p1) room.handle(p1, { t: 'cmd', cmd, side }); else room.aiStep();
    while (msgs.length) {
      const m = msgs.shift();
      if (m.t === 'start') { state = m.state; seq = m.vseq; }
      if (m.t === 'update') {
        if (m.patch !== undefined) { if (m.base !== seq) { bad++; continue; } state = patch(state, m.patch); patched++; } else state = m.state;
        seq = m.vseq;
        if (!g.over && JSON.stringify(state) !== JSON.stringify(jclone(room.viewFor(p1, g)))) bad++;
      }
    }
  }
  ok(bad === 0 && patched > 20, `room deltas keep the client in step (${patched} patched updates, ${bad} problems)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
