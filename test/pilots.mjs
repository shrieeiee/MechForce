// Persistent pilots: abilities, ejection, self-destruct, experience. Run: node test/pilots.mjs
import { createGame, applyCommand, activeSide, toHit, pilotingTN, __test } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { sanitizePilot, newPilot, applyBattle, battleXP, improve, canImprove, restBattle, BACKGROUNDS, ABILITIES, GUN_COST } from '../src/core/pilots.js';
import { Room } from '../src/core/room.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const flat = (st) => { for (let i = 0; i < st.map.t.length; i++) { st.map.t[i] = 0; st.map.e[i] = 0; } st.structures = []; };

// ---- sanitizing what a client sends
{
  const p = sanitizePilot({ id: 'p1', callsign: 'Ace<script>', name: 'Jo', gun: -5, pil: 99, abilities: ['sniper', 'sniper', 'bogus', 'melee', 'ace', 'cluster'], portrait: { skin: 99 } });
  ok(p.gun === 1 && p.pil === 8 && p.abilities.join() === 'sniper,melee,ace' && p.name === 'Acescript' && p.portrait.skin === 15, 'pilot values clamped, abilities deduped and capped at 3');
}
// ---- pilots reach the battle, abilities change the numbers
const duel = (pa, pb, a = 'Griffin', b = 'Griffin') => {
  const st = createGame({ seed: 'pil' + Math.random(), mission: 'generic', mapSize: 'M', theme: 'temperate', sides: [{ ctrl: 'a', lance: [a], pilots: [pa] }, { ctrl: 'b', lance: [b], pilots: [pb] }] });
  flat(st);
  const [m, e] = st.mechs; m.x = 4; m.y = 8; m.f = 0; e.x = 10; e.y = 8; e.f = 3;
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  return st;
};
{
  const plain = newPilot({ name: 'A B', callsign: 'Plain', bg: 'noble' }); // 4/4, no ability
  const sniper = { ...plain, abilities: ['sniper'] };
  const st = duel(sniper, plain);
  const [m, e] = st.mechs;
  ok(m.pilot.name === 'Plain' && m.pilot.gun === 4 && m.pilot.pil === 4 && m.pilot.pid, 'lobby pilot drives the mech');
  const lr = m.weapons.find((w) => w.rng >= 12) || m.weapons[0];
  e.x = m.x + Math.ceil(lr.rng * 2 / 3) + 1;
  const th = toHit(st, m, e, lr);
  ok(th.mods.some((x) => /Long range \(Sniper\)/.test(x.label) && x.v === 2), 'Sniper halves the long-range penalty');
  const st2 = duel({ ...plain, abilities: ['ace'] }, plain);
  ok(pilotingTN(st2.mechs[0]) === pilotingTN(st2.mechs[1]) - 1, 'Maneuvering Ace: -1 to piloting rolls');
  const st3 = duel({ ...plain, abilities: ['jumpjack'] }, plain);
  const r = applyCommand(st3, 0, { type: 'move', id: 0, mode: 'jump', x: 6, y: 8, f: 0 });
  ok(r.ok && toHit(st3, st3.mechs[0], st3.mechs[1], st3.mechs[0].weapons[0]).mods.some((x) => x.label.includes('Jumping Jack') && x.v === 1), 'Jumping Jack: +1 after a jump');
}
// ---- ejecting on purpose
{
  const st = duel(newPilot({ callsign: 'Runner', bg: 'agro' }), null);
  const r = applyCommand(st, 0, { type: 'eject', id: 0 });
  const m = st.mechs[0];
  ok(r.ok && m.dead && m.pilot.fate === 'ejected' && r.events.some((e) => e.k === 'eject'), 'eject: pilot punches out, mech is out of the fight');
  ok(st.over, 'abandoning the last mech loses the battle');
}
// ---- automatic ejection when destroyed, deaths from head hits
{
  let ej = 0, killed = 0, n = 0;
  for (let k = 0; k < 40; k++) {
    const st = duel(null, null);
    const m = st.mechs[1];
    const ev = [];
    m.engineHits = 2;
    m.crit[2] = m.crit[2].map((c) => (c === 48 ? 48 : -1)); m.critHit[2] = m.critHit[2].map(() => 0);
    __test.applyCrit(st, m, 2, ev, st.mechs[0]);
    if (!m.dead) continue;
    n++;
    if (m.pilot.fate === 'ejected') ej++;
    if (m.pilot.fate === 'killed') killed++;
  }
  ok(n === 40 && ej > 30, `engine kills: pilot ejects ${ej}/${n}, killed ${killed} (reactor breach only)`);
}
// ---- self-destruct
{
  let boom = 0, fizz = 0;
  for (let k = 0; k < 30; k++) {
    const st = duel(null, null, 'Atlas', 'Griffin');
    const [m, e] = st.mechs; e.x = 5; e.y = 8;
    const arm0 = e.armor.reduce((a, b) => a + b, 0) + e.internal.reduce((a, b) => a + b, 0);
    const r = applyCommand(st, 0, { type: 'selfdestruct', id: 0 });
    if (!r.ok) continue;
    if (m.dead) { boom++; if (!r.events.some((x) => x.k === 'blast')) fails++; const arm1 = e.armor.reduce((a, b) => a + b, 0) + e.internal.reduce((a, b) => a + b, 0); if (arm1 >= arm0 && !e.dead) { fails++; console.log('FAIL no blast damage'); } }
    else fizz++;
  }
  ok(boom > 20 && fizz > 0, `self-destruct: ${boom} blew, ${fizz} safeties held`);
}
// ---- experience, improvements, injuries
{
  const p = newPilot({ name: 'Mira Okafor', callsign: 'Kestrel', bg: 'militia' });
  ok(p.gun === BACKGROUNDS.militia.gun && p.abilities[0] === 'ironman' && p.xp === 12, 'background sets skills, ability and starting XP');
  const st = duel(p, null);
  const m = st.mechs[0];
  m.stats.kills = 2; m.stats.dmg = 60; m.pilot.hits = 3;
  st.over = true; st.winner = { side: 0, team: 0 };
  const x = battleXP(st, m);
  ok(x.total === 1 + 1 + 2 + 4 + 2, `battle XP adds up (${x.parts.map((q) => q.join(' ')).join(', ')})`);
  const sum = applyBattle(p, st, m, st.gid);
  ok(sum && p.xp === 12 + x.total && p.rest === 2 && p.kills === 2, 'roster pilot gains XP, wounds mean 2 battles of rest');
  ok(applyBattle(p, st, m, st.gid) === null, 'the same battle is never counted twice');
  restBattle(p); restBattle(p);
  ok(p.rest === 0, 'rested back to fitness');
  const before = p.xp;
  ok(canImprove(p, 'pil').ok && improve(p, 'pil') && p.pil === 4 && p.xp === before - 10, 'spend XP to improve piloting');
  ok(!canImprove(p, 'gun').ok || p.xp >= GUN_COST[p.gun - 1], 'gunnery costs are checked');
  m.pilot.fate = 'killed';
  const st2 = { ...st, gid: 'other' };
  applyBattle(p, st2, m, 'other');
  ok(p.dead, 'a pilot killed in battle is gone');
}
// ---- through the host: pilots message, AI games use eject/self-destruct sometimes
{
  const sent = [];
  const room = new Room({ code: 'PIL', send: (id, msg) => sent.push(msg), aiDelay: 0 });
  const id = room.join({ name: 'P1' });
  room.handle(id, { t: 'lance', side: 0, lance: ['Griffin', 'Jenner'] });
  room.handle(id, { t: 'pilots', side: 0, pilots: [newPilot({ callsign: 'Hawk', bg: 'merc' }), null] });
  room.scheduleAI = () => {};
  room.handle(id, { t: 'start' });
  ok(room.game.mechs[0].pilot.name === 'Hawk' && room.game.mechs[0].pilot.gun === 3 && room.game.gid.length > 8, 'host uses the sent pilot and gives the battle an id');
}
{
  let ejects = 0, sds = 0;
  for (let k = 0; k < 10; k++) {
    const st = createGame({ seed: 'pilai' + k, mission: 'generic', mapSize: 'S', theme: 'temperate', sides: [{ ctrl: 'ai', lance: ['Atlas', 'Jenner', 'Griffin', 'Hunchback'] }, { ctrl: 'ai', lance: ['Victor', 'Spider', 'Bruiser', 'Wolverine'] }] });
    let n = 0, bad = 0;
    while (!st.over && n++ < 4000) {
      const cmd = aiNextCommand(st);
      if (!cmd) break;
      const r = applyCommand(st, activeSide(st), cmd);
      if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); continue; }
      ejects += r.events.filter((e) => e.k === 'eject').length;
      sds += r.events.filter((e) => e.k === 'selfdestruct').length;
    }
    ok(st.over && bad === 0, `AI game ${k}: ${st.round} rounds, fates ${st.mechs.map((m) => m.pilot.fate || (m.dead ? 'wreck' : '-')).join(' ')}`);
  }
  ok(ejects > 0, `ejections happened (${ejects}), self-destructs ${sds}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
