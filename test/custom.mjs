import { Room } from '../src/core/room.js';
import { defaultSpec, distributeArmor } from '../src/core/custom.js';
const msgs = [];
const room = new Room({ local: true, aiDelay: 0, send: (id, m) => msgs.push(m) });
const id = room.join({ name: 't' });
const good = defaultSpec('Lancer'); const bad = { ...defaultSpec('Cheater'), weapons: Array(10).fill({ t: 3, loc: 1, ammo: 1 }) };
room.handle(id, { t: 'lance', side: 0, lance: [{ custom: good }, { custom: bad }, 'Atlas'] });
console.log('slot0 lance:', JSON.stringify(room.slots[0].lance.map((e) => typeof e === 'string' ? e : '*' + e.custom.name)), '| error sent:', msgs.some((m) => m.t === 'error'));
room.handle(id, { t: 'slot', side: 0, ctrl: 'ai' });
room.slots[0].lance = [{ custom: good }, 'Atlas'];
room.handle(id, { t: 'start' });
const g = room.game;
console.log('mechs:', g.mechs.filter((m) => m.side === 0).map((m) => `${m.design}${m.custom ? '*' : ''} ${m.tons}t ${m.weapons.length}w`).join(', '));
const { aiNextCommand } = await import('../src/core/ai.js'); const { applyCommand, activeSide } = await import('../src/core/rules.js');
let n = 0; while (!g.over && n++ < 3000) { const c = aiNextCommand(g); const r = applyCommand(g, activeSide(g), c); if (!r.ok) applyCommand(g, activeSide(g), { type: 'end', id: c.id }); }
console.log('game finished:', g.over, 'round', g.round, g.winner.reason);
room.dispose();
