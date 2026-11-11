// Computer skill levels: pilots get the level's skills, and battles reach a decision.
import './seed.mjs';
import { createGame, applyCommand, activeSide } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { AI_LEVELS } from '../src/core/data.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const avg = {};
for (const level of Object.keys(AI_LEVELS)) {
  let rounds = 0, timeouts = 0, bad = 0;
  for (let k = 0; k < 4; k++) {
    const st = createGame({ seed: `lvl-${level}-${k}`, mission: 'generic', mapSize: ['S', 'M'][k % 2], theme: 'temperate', aiLevel: level, fog: k === 3,
      sides: [{ ctrl: 'ai', lance: ['Atlas', 'Jenner', 'Griffin', 'Wolverine'] }, { ctrl: 'p1', lance: ['Goliath', 'Wasp', 'Hunchback', 'Phoenix Hawk'] }] });
    if (k === 0) ok(st.mechs[0].pilot.gun === AI_LEVELS[level].gun && st.mechs[4].pilot.gun === 4, `${level}: computer pilots gunnery ${st.mechs[0].pilot.gun}, players keep 4`);
    let n = 0;
    while (!st.over && n++ < 5000) { const cmd = aiNextCommand(st); if (!cmd) break; const r = applyCommand(st, activeSide(st), cmd); if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); } }
    rounds += st.round; if (/Time limit/.test(st.winner && st.winner.reason)) timeouts++;
  }
  ok(bad === 0, `${level}: 4 games, avg ${(rounds / 4).toFixed(1)} rounds, ${timeouts} hit the time limit`);
  avg[level] = rounds / 4;
}
ok(avg.veteran < avg.easy, `sharper computer pilots settle battles sooner (veteran ${avg.veteran.toFixed(1)} vs easy ${avg.easy.toFixed(1)} rounds)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
