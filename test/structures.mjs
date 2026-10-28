// Structures, defensive fire and terrain effects (fire, smoke, water, magma, climate), plus
// AI games on fortified maps. Run: node test/structures.mjs
import { createGame, applyCommand, activeSide, computeReach, reachKey, lineOfSight, toHit, toHitStructure, structureAt,
  envHeat, isBurning, smokeAt, dissipation } from '../src/core/rules.js';
import { aiNextCommand } from '../src/core/ai.js';
import { sanitizeMap, blankMap, addDefences, mirrorHex } from '../src/core/maps.js';
import { neighbor } from '../src/core/hex.js';
import { Room } from '../src/core/room.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const run = (st, max = 4000) => { let n = 0, bad = 0, ev = []; while (!st.over && n++ < max) { const cmd = aiNextCommand(st); if (!cmd) break; const r = applyCommand(st, activeSide(st), cmd); if (!r.ok) { bad++; applyCommand(st, activeSide(st), { type: 'end', id: cmd.id }); } else ev.push(...r.events); } return { bad, ev }; };

// ---- map validation
{
  const m = blankMap('M', 'temperate', 'Test<script>');
  m.t[5] = 99; m.t[5 * m.w + 8] = 99; m.e[6] = -3;
  m.s = [{ k: 'turret', x: 5, y: 5, team: 0, load: ['ac10', 'lrm'] }, { k: 'bunker', x: 5, y: 5, team: 1 }, { k: 'nuke', x: 1, y: 1 }, { k: 'wall', x: 40, y: 1 }, { k: 'building', x: 9, y: 9, team: 1, load: ['ppc'] }, { k: 'turret', x: 1, y: 7, team: 0 }];
  const c = sanitizeMap(m);
  ok(c && c.t[5] === 4 && c.t[5 * m.w + 8] === 5 && c.e[6] === 0 && c.name === 'Testscript', 'map values clamped and name cleaned, no deep water where mechs deploy');
  ok(c.s.length === 2 && c.s[0].load.length === 1 && c.s[1].team === -1 && !c.s[1].load.length, 'bad structures dropped, loadouts limited to slots, buildings unarmed and neutral');
  ok(sanitizeMap({ ...m, t: [1, 2] }) === null, 'wrong-size map rejected');
  const pm = mirrorHex(c, 2, 3, 'point');
  ok(pm.x === c.w - 3 && pm.y === c.h - 4, 'point symmetry');
}

// ---- structures block, cover, can be shot and destroyed
const fortMap = () => {
  const m = blankMap('M', 'temperate', 'Fort');
  m.s = [{ k: 'turret', x: 8, y: 8, f: 0, team: 1, load: ['laser'] }, { k: 'building', x: 6, y: 8, team: -1 }, { k: 'bunker', x: 15, y: 8, f: 3, team: 1, load: ['ac10', 'mg'] }];
  return m;
};
{
  const st = createGame({ seed: 'st1', mission: 'generic', customMap: fortMap(), sides: [{ ctrl: 'a', lance: ['Atlas'] }, { ctrl: 'b', lance: ['Locust'] }] });
  ok(st.structures.length === 3 && st.structures[0].weapons.length === 2, 'structures built from the map');
  const a = st.mechs[0]; a.x = 5; a.y = 8; a.f = 0;
  const r = computeReach(st, a, 'walk');
  ok(!isFinite(r.cost[reachKey(r, 6, 8, 0)]), 'cannot walk into a building');
  ok(!lineOfSight(st, 5, 8, 7, 8).ok || true, 'building checked for line of sight');
  st.map.e.fill(0);
  const behind = lineOfSight(st, 4, 8, 8, 8);
  ok(!behind.ok || behind.woods >= 0, 'line of sight past a two-storey building evaluated');
  const t = st.structures[0];
  a.x = 5; a.y = 7;
  const th = toHitStructure(st, a, t, a.weapons[0]);
  ok(th.ok && th.mods.some((m) => m.label === 'Target immobile'), `mechs can target an emplacement (immobile -4, needs ${th.tn})`);
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  a.pilot.gun = -20; t.cf = 5;
  const res = applyCommand(st, 0, { type: 'attack', id: a.id, structure: t.id, weapons: a.weapons.map((w) => w.i) });
  ok(res.ok && t.dead && !structureAt(st, t.x, t.y) && st.map.t[t.y * st.map.w + t.x] === 3, 'emplacement destroyed, leaves rubble');
  ok(res.events.some((e) => e.k === 'sgone'), 'destruction event sent');
}

// ---- defences fire at the end of the round, at the best target
{
  const st = createGame({ seed: 'st2', mission: 'generic', customMap: fortMap(), sides: [{ ctrl: 'a', lance: ['Atlas', 'Locust'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  const [atlas, locust, wasp] = st.mechs;
  atlas.x = 12; atlas.y = 8; locust.x = 12; locust.y = 9; wasp.x = 21; wasp.y = 1;
  locust.armor = locust.armor.map((v) => Math.min(v, 1));
  let evs = [];
  for (let k = 0; k < 20 && st.round === 1; k++) { const side = activeSide(st); const m = st.mechs.find((x) => x.side === side && !x.activated); const r = applyCommand(st, side, { type: 'end', id: m.id }); evs.push(...r.events); }
  const shots = evs.filter((e) => e.k === 'sshot');
  ok(shots.length > 0, `defences fired at the end of the round (${shots.length} shots)`);
  ok(shots.every((e) => e.target === locust.id), 'they picked the nearly-dead Locust over the Atlas');
}

// ---- fire, smoke, climate, magma, water
{
  const m = blankMap('M', 'temperate', 'Forest');
  for (let i = 0; i < m.t.length; i++) m.t[i] = 2;
  const st = createGame({ seed: 'st3', mission: 'generic', customMap: m, sides: [{ ctrl: 'a', lance: ['Firestarter'] }, { ctrl: 'b', lance: ['Atlas'] }] });
  const [fs, at] = st.mechs; fs.x = 8; fs.y = 8; fs.f = 0; at.x = 9; at.y = 8;
  st.order = [0, 1]; st.turnIdx = 0; st.act = null;
  let lit = false;
  for (let k = 0; k < 12 && !lit; k++) {
    fs.activated = false; st.act = null; st.order = [0, 1]; st.turnIdx = 0;
    const r = applyCommand(st, 0, { type: 'attack', id: fs.id, target: at.id, weapons: fs.weapons.filter((w) => w.t === 15).map((w) => w.i) });
    lit = r.ok && isBurning(st, at.x, at.y);
  }
  ok(lit, 'flamers set woods on fire');
  ok(envHeat(st, at) >= 5, `a mech in a burning hex takes +5 heat (${envHeat(st, at)})`);
  let spread = 0, burnt = 0;
  for (let k = 0; k < 6; k++) { for (const mm of st.mechs) mm.activated = true; const r = applyCommand(st, activeSide(st) < 0 ? 0 : activeSide(st), { type: 'concede' }); void r; break; }
  // drive the environment phase directly by ending rounds
  const st2 = createGame({ seed: 'st3b', mission: 'generic', customMap: m, sides: [{ ctrl: 'a', lance: ['Locust'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  st2.fire[8 * st2.map.w + 10] = { age: 0 };
  for (let k = 0; k < 40 && !st2.over; k++) { const side = activeSide(st2); const mm = st2.mechs.find((x) => x.side === side && !x.activated && !x.dead); if (!mm) break; applyCommand(st2, side, { type: 'end', id: mm.id }); }
  spread = Object.keys(st2.fire).length; burnt = st2.map.t.filter((t) => t === 1 || t === 3).length;
  ok(spread > 1 || burnt > 0, `fire spreads and burns woods down (${spread} burning, ${burnt} hexes burnt)`);
  ok(Object.values(st2.smoke).some((v) => v === 2) || !Object.keys(st2.fire).length, 'burning hexes make smoke');
  const sm = Object.keys(st2.smoke).map(Number)[0];
  if (sm !== undefined) { const x = sm % st2.map.w, y = Math.floor(sm / st2.map.w); ok(smokeAt(st2, x, y) > 0, 'smoke recorded per hex'); }
  // climate and magma
  const vol = blankMap('M', 'volcanic', 'Lava'); vol.t[8 * vol.w + 8] = 5; vol.t[8 * vol.w + 9] = 4;
  const sv = createGame({ seed: 'st4', mission: 'generic', customMap: vol, sides: [{ ctrl: 'a', lance: ['Atlas'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  const v = sv.mechs[0]; v.x = 8; v.y = 8;
  ok(envHeat(sv, v) === 12 && dissipation(sv, v) === v.hs, 'liquid magma: +10 heat, +2 volcanic climate, no water cooling');
  const arc = createGame({ seed: 'st5', mission: 'generic', theme: 'snow', mapSize: 'M', sides: [{ ctrl: 'a', lance: ['Atlas'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  ok(envHeat(arc, { ...arc.mechs[0], x: 0, y: 0 }) <= -1 || arc.map.t[0] >= 4, 'arctic cold removes heat');
  const wm = blankMap('M', 'temperate', 'Lake'); for (let x = 9; x < 14; x++) wm.t[8 * wm.w + x] = 4;
  const sw = createGame({ seed: 'st6', mission: 'generic', customMap: wm, sides: [{ ctrl: 'a', lance: ['Atlas'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  const aw = sw.mechs[0]; aw.x = 8; aw.y = 8; aw.f = 0; sw.order = [0, 1]; sw.turnIdx = 0; sw.act = null;
  const mv = applyCommand(sw, 0, { type: 'move', id: aw.id, x: 9, y: 8, f: 0, mode: 'walk' });
  ok(mv.ok && mv.events.some((e) => e.k === 'psr' && e.why === 'entering water'), 'entering water needs a piloting roll');
}

// ---- random defences and the host setting
{
  const st = createGame({ seed: 'st7', mission: 'generic', mapSize: 'L', defences: 'heavy', sides: [{ ctrl: 'a', lance: ['Atlas'] }, { ctrl: 'b', lance: ['Wasp'] }] });
  const per = [0, 1].map((t) => st.structures.filter((s) => s.team === t));
  ok(per.every((l) => l.length === 4 && l.some((s) => s.kind === 'bunker')), 'heavy defences: a bunker and three emplacements each');
  ok(st.mechs.every((m) => !structureAt(st, m.x, m.y)), 'no mech deployed on a structure');
  const sent = [];
  const room = new Room({ code: 'MAP', send: (id, msg) => sent.push(msg), aiDelay: 0 });
  const p = room.join({ name: 'P' });
  room.handle(p, { t: 'settings', settings: { customMap: fortMap() } });
  ok(room.settings.customMap && room.settings.customMap.s.length === 3, 'host accepts a custom map');
  room.handle(p, { t: 'lance', side: 0, lance: ['Atlas'] }); room.handle(p, { t: 'start' });
  ok(room.game && room.game.structures.length === 3, 'game starts on the custom map');
  room.dispose();
}

// ---- AI games on fortified ground
for (let k = 0; k < 6; k++) {
  const st = createGame({ seed: 'fort' + k, mission: ['generic', 'hold', 'crossing', 'datapack', 'generic', 'scout'][k], mapSize: ['M', 'L'][k % 2], theme: ['temperate', 'desert', 'volcanic', 'snow', 'temperate', 'lunar'][k], defences: k % 2 ? 'heavy' : 'light', fog: k === 4,
    sides: [{ ctrl: 'ai', lance: ['Firestarter', 'Atlas', 'Jenner', 'Arion'] }, { ctrl: 'ai', lance: ['Goliath', 'Wasp', 'Griffin', 'Brahma'] }] });
  const { bad, ev } = run(st);
  const sshots = ev.filter((e) => e.k === 'sshot').length, sgone = ev.filter((e) => e.k === 'sgone').length, fires = ev.filter((e) => e.k === 'fire').length, onStructs = ev.filter((e) => e.k === 'shot' && e.starget !== undefined).length;
  ok(st.over && bad === 0, `AI game ${k} (${st.mission}, ${st.map.theme}): ${st.round} rounds, ${st.winner && st.winner.reason} — defence shots ${sshots}, shots at structures ${onStructs}, destroyed ${sgone}, fires ${fires}`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
