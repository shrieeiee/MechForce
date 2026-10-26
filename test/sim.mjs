import { createGame, applyCommand, activeSide } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { MECHS, MISSIONS } from '../src/core/data.js';
const pick = (i) => MECHS[(i * 37) % MECHS.length].n;
let total = 0;
for (const mis of MISSIONS) {
  for (let g = 0; g < 3; g++) {
    const t0 = Date.now();
    const nS = mis.id === 'generic' && g === 2 ? 4 : 2;
    const sides = Array.from({ length: nS }, (_, s) => ({ ctrl: 'ai', lance: [0, 1, 2, 3].map((k) => pick(g * 11 + s * 4 + k)) }));
    const st = createGame({ seed: 'sim' + mis.id + g, mission: mis.id, mapSize: ['S', 'M', 'L'][g], theme: 'temperate', sides });
    let n = 0, worst = 0;
    while (!st.over && n < 4000) {
      const c0 = Date.now();
      const cmd = aiNextCommand(st);
      worst = Math.max(worst, Date.now() - c0);
      if (!cmd) { console.log('null cmd', st.round, st.act); break; }
      const r = applyCommand(st, activeSide(st), cmd);
      if (!r.ok) { console.log('FAIL', mis.id, r.error, JSON.stringify(cmd)); applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); }
      n++;
    }
    total += Date.now() - t0;
    const alive = st.sides.map((_, s) => st.mechs.filter((m) => m.side === s && !m.dead && !m.exited).length);
    console.log(mis.id.padEnd(9), 'map', ['S','M','L'][g], 'rounds', st.round, 'cmds', n, 'winner', st.winner && st.winner.side, '|', st.winner && st.winner.reason, '| alive', alive.join('/'), '| worst ms', worst, '| JSON kb', (JSON.stringify(st).length/1024).toFixed(0));
  }
}
console.log('total ms', total);
