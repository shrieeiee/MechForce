import { startServer } from '../server/server.js';
import WebSocket from 'ws';
import { aiNextCommand } from '../src/core/ai.js';
import { activeSide } from '../src/core/rules.js';
const srv = await startServer({ port: 7398, beacon: false, log: () => {} });
const names = ['Deck', 'PC', 'Phone', 'Browser'];
const clients = [];
const connect = (name, extra) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:7398/ws');
  const c = { name, ws, msgs: [], acted: 0 };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'welcome') c.id = m.id; if (m.t === 'lobby') c.lobby = m.lobby; if (m.t === 'start' || m.t === 'update') { c.state = m.state; c.onState && c.onState(); } });
  ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name, platform: name, protocol: 3, ...extra })); setTimeout(() => res(c), 250); });
});
const host = await connect('Deck', { create: true });
host.ws.send(JSON.stringify({ t: 'settings', settings: { mission: 'crossing', sides: 4, mapSize: 'M', lanceSize: 2, tonnage: 160 } }));
await new Promise((r) => setTimeout(r, 200));
const code = host.lobby.code;
for (const n of names.slice(1)) clients.push(await connect(n, { room: code }));
clients.unshift(host);
await new Promise((r) => setTimeout(r, 300));
const L = host.lobby;
console.log('room', code, 'slots:', L.slots.map((s) => `${s.name}=${L.clients.find((c) => c.id === s.ctrl)?.name || s.ctrl} (team ${s.team + 1})`).join(', '));
for (const c of clients.slice(1)) { const side = c.lobby.slots.findIndex((s) => s.ctrl === c.id); c.ws.send(JSON.stringify({ t: 'ready', side, v: true })); }
await new Promise((r) => setTimeout(r, 300));
host.ws.send(JSON.stringify({ t: 'start' }));
const done = new Promise((res) => {
  for (const c of clients) c.onState = () => {
    const st = c.state;
    if (st.over) { res(st); return; }
    const side = activeSide(st);
    if (side < 0 || st.sides[side].ctrl !== c.id) return;
    clearTimeout(c.t);
    c.t = setTimeout(() => { const cmd = aiNextCommand(st); if (cmd) { c.acted++; c.ws.send(JSON.stringify({ t: 'cmd', cmd, side })); } }, 5);
  };
});
// kick the first turn
setTimeout(() => clients.forEach((c) => c.onState && c.state && c.onState()), 500);
const st = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 60000))]);
if (!st) console.log('TIMEOUT');
else {
  console.log('teams:', st.teams.map((t) => t.name).join(' vs '), '| winner:', st.winner.team >= 0 ? st.teams[st.winner.team].name : 'draw', '-', st.winner.reason, '| rounds', st.round);
  console.log('commands sent per player:', clients.map((c) => `${c.name} ${c.acted}`).join(', '));
  await new Promise((r) => setTimeout(r, 400));
  const same = clients.every((c) => c.state.seq === clients[0].state.seq && JSON.stringify(c.state.mechs) === JSON.stringify(clients[0].state.mechs));
  console.log('all four clients in sync:', same);
}
clients.forEach((c) => c.ws.close()); await srv.close(); process.exit(0);
