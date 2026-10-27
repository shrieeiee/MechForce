import { createGame, applyCommand, activeSide } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { MECHS, MISSIONS } from '../src/core/data.js';
const pick = (i) => MECHS[(i * 37 + 11) % MECHS.length].n;
const setups = [['2v2', [0, 1, 0, 1]], ['2v1', [0, 1, 0]], ['1v1v1v1', [0, 1, 2, 3]], ['3 sides 2v1', [0, 0, 1]]];
let friendly = 0, overlaps = 0;
for (const mis of MISSIONS) for (const [label, teams] of setups) {
  if (mis.id !== 'generic' && label === '1v1v1v1') continue;
  const sides = teams.map((t, s) => ({ ctrl: 'ai', team: t, lance: [0, 1].map((k) => pick(s * 5 + k + label.length)) }));
  const st = createGame({ seed: 'team' + mis.id + label, mission: mis.id, mapSize: 'M', sides });
  const pos = new Set(); for (const m of st.mechs) { const k = m.x + ',' + m.y; if (pos.has(k)) overlaps++; pos.add(k); }
  let n = 0;
  while (!st.over && n++ < 5000) {
    const c = aiNextCommand(st);
    if (c && c.type === 'attack') { const a = st.mechs[c.id], t = st.mechs[c.target]; if (a.team === t.team) friendly++; }
    const r = applyCommand(st, activeSide(st), c);
    if (!r.ok) applyCommand(st, activeSide(st), { type: 'end', id: c.id });
  }
  const teamNames = st.teams.map((t) => t.name).join(' vs ');
  console.log(mis.id.padEnd(9), label.padEnd(12), 'teams:', teamNames.padEnd(36), 'round', String(st.round).padStart(2), '→', st.winner.team < 0 ? 'draw' : st.teams[st.winner.team].name, '|', st.winner.reason);
}
console.log('friendly-fire attempts:', friendly, '| deploy overlaps:', overlaps);
