// Mercenary campaign: company, contracts, damage carry-over, settlement, repairs, market.
import { createGame, applyCommand, activeSide } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { newCompany, mechState, enemyLance, settle, repair, sellMech, buyMech, templateOf, mechPrice, bankrupt, START_CBILLS } from '../src/core/campaign.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const co = newCompany('Test Company', 42);
ok(co.mechs.length === 4 && co.board.length === 3 && co.market.length === 5 && co.cbills === START_CBILLS, `new company: ${co.mechs.map((m) => m.design).join(', ')}; ${co.board.map((c) => c.mission + '/' + c.diff).join(' ')}`);
ok(co.mechs.every((m) => mechState(m).ok && mechState(m).cost === 0), 'starter mechs are ready and need no repairs');
ok(co.mechs.every((m) => mechPrice(m.design) > 500000), `prices look sane (${co.mechs.map((m) => (mechPrice(m.design) / 1e6).toFixed(1) + 'M').join(' ')})`);

// play three contracts with the AI on both sides
for (let k = 0; k < 3; k++) {
  const c = co.board[0];
  const ready = co.mechs.filter((m) => mechState(m).ok).slice(0, 4);
  const st = createGame({ seed: c.seed, mission: c.mission, mapSize: c.mapSize, theme: c.theme, aiLevel: c.aiLevel, forces: c.forces, defences: c.defences, fog: c.fog,
    sides: [{ ctrl: 'me', lance: ready.map((m) => m.design), damage: ready.map((m) => ({ armor: m.armor || templateOf(m.design).a, internal: m.internal || templateOf(m.design).i })) },
      { ctrl: 'ai', lance: enemyLance(c) }] });
  // damage carried in
  for (let i = 0; i < ready.length; i++) if (ready[i].armor) ok(st.mechs[i].armor.join() === ready[i].armor.map((v, l) => Math.min(v, templateOf(ready[i].design).a[l])).join(), `contract ${k}: the ${ready[i].design} starts with last battle's damage`);
  let n = 0;
  while (!st.over && n++ < 5000) { const cmd = aiNextCommand(st); if (!cmd) break; const r = applyCommand(st, activeSide(st), cmd); if (!r.ok) applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); }
  const before = co.cbills;
  const res = settle(co, c, st, 0, ready.map((m, i) => ({ uid: m.uid, mechId: i })));
  ok(Math.abs(co.cbills - before - res.total) < 1 && co.board.length === 3 && co.contracts === k + 1, `contract ${k} (${c.mission}, ${['routine', 'standard', 'dangerous', 'deadly'][c.diff]}): ${res.won ? 'won' : 'lost'} — pay ${res.pay}, bonus ${res.bonus}, salvage ${res.salvage.length} mechs + ${res.salvageC}, salaries ${res.salaries}; damaged ${res.damaged.length}, wrecked ${res.wrecked.length}`);
  // fix everything we can afford
  for (const m of co.mechs) if (mechState(m).cost) repair(co, m.uid);
}
ok(co.mechs.filter((m) => mechState(m).ok).length >= 2, `after repairs: ${co.mechs.length} mechs, ${co.mechs.filter((m) => mechState(m).ok).length} ready, ${Math.round(co.cbills / 1000)}k C-bills, rep ${co.rep}`);
const n0 = co.mechs.length, c0 = co.cbills;
const got = sellMech(co, co.mechs[co.mechs.length - 1].uid);
ok(co.mechs.length === n0 - 1 && co.cbills === c0 + got && got > 0, `selling a mech pays ${got}`);
co.cbills = 1e8;
ok(buyMech(co, 0) && co.mechs.length === n0, 'buying from the market adds a mech');
co.cbills = -2e6;
ok(bankrupt(co), 'deep debt bankrupts the company');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
