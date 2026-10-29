// Persistent MechWarriors: backgrounds, special pilot abilities, experience and injuries.
// Pilots live on the player's device; a lobby sends the host a copy of each assigned pilot,
// which the host clamps to legal values before the battle. After the battle the owner's
// device works out experience, injuries and fates from the final game state.

// Special pilot abilities, after BattleTech's Campaign Operations (simplified to fit the game)
export const ABILITIES = {
  sniper: { name: 'Sniper', text: 'Range penalties are halved: +1 at medium range, +2 at long range.' },
  jumpjack: { name: 'Jumping Jack', text: 'Firing after a jump is +1 to hit instead of +3.' },
  melee: { name: 'Melee Specialist', text: '-1 to hit with punches, kicks and death from above, and +1 damage to each.' },
  hotdog: { name: 'Hot Dog', text: 'Shrugs off heat: shutdown and ammo cook-off checks are made as if 3 heat lower.' },
  ironman: { name: 'Iron Man', text: '-2 to the roll needed to stay conscious after an injury.' },
  ace: { name: 'Maneuvering Ace', text: '-1 to every piloting roll to stay upright, and to eject.' },
  tactical: { name: 'Tactical Genius', text: '+1 to the side\'s initiative roll each round (once per side).' },
  cluster: { name: 'Cluster Hitter', text: '+1 on the missile cluster roll, so more missiles from each salvo land.' },
  spec_e: { name: 'Energy Specialist', text: '-1 to hit with lasers, PPCs, plasma weapons and flamers.' },
  spec_b: { name: 'Gunslinger', text: '-1 to hit with autocannons, gauss rifles and machine guns.' },
  spec_m: { name: 'Missile Specialist', text: '-1 to hit with missile racks.' },
};
export const ABILITY_IDS = Object.keys(ABILITIES);
export const MAX_ABILITIES = 3;

// Where the pilot came from: starting skills, a starting ability and some colour
export const BACKGROUNDS = {
  academy: { name: 'Military academy', gun: 4, pil: 5, ability: 'sniper', xp: 0, text: 'Graduated from a great house\'s war college: textbook gunnery drilled on the long ranges.' },
  noble: { name: 'Noble heir', gun: 4, pil: 4, ability: null, xp: 0, text: 'Tutored in a family BattleMech since childhood. Fine all-round skills and an ego to match.' },
  merc: { name: 'Mercenary', gun: 3, pil: 5, ability: 'hotdog', xp: 0, text: 'A decade of contracts on the frontier. Shoots straight and runs hot without blinking.' },
  clan: { name: 'Clan warrior', gun: 3, pil: 5, ability: 'spec_e', xp: 0, text: 'Bred and trained for war in the Clan sibkos, with a warrior\'s taste for energy weapons.' },
  pirate: { name: 'Periphery pirate', gun: 5, pil: 4, ability: 'melee', xp: 0, text: 'Raided border worlds in a battered salvage mech; learned that a fist never runs out of ammo.' },
  militia: { name: 'Planetary militia', gun: 5, pil: 5, ability: 'ironman', xp: 12, text: 'Part-time defender of a quiet world. Green, but stubborn — and keen to learn.' },
  agro: { name: 'Farmworld jockey', gun: 5, pil: 4, ability: 'ace', xp: 6, text: 'Drove IndustrialMechs through the harvest. Nobody keeps their footing better.' },
  arena: { name: 'Arena gladiator', gun: 4, pil: 5, ability: 'jumpjack', xp: 0, text: 'Fought for the crowds on the game world of Solaris VII. Loves to jump in close.' },
};
export const BACKGROUND_IDS = Object.keys(BACKGROUNDS);

// Experience costs to improve a skill to the given value (lower is better)
export const GUN_COST = { 6: 6, 5: 8, 4: 12, 3: 18, 2: 26, 1: 36 };
export const PIL_COST = { 7: 4, 6: 6, 5: 8, 4: 10, 3: 16, 2: 22, 1: 30 };
export const ABILITY_COST = 12;
export const MIN_GUN = 1, MIN_PIL = 1;
export const RANKS = (p) => {
  const s = p.gun + p.pil;
  return s <= 4 ? 'Legendary' : s <= 6 ? 'Elite' : s <= 8 ? 'Veteran' : s <= 9 ? 'Regular' : 'Green';
};

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const cleanText = (s, n) => String(s || '').replace(/[^\p{L}\p{N} .'\-]/gu, '').trim().slice(0, n);

// What the host accepts for a pilot in battle: name, skills, abilities, portrait
export function sanitizePilot(p) {
  if (!p || typeof p !== 'object') return null;
  const abilities = [...new Set((Array.isArray(p.abilities) ? p.abilities : []).filter((a) => ABILITY_IDS.includes(a)))].slice(0, MAX_ABILITIES);
  const callsign = cleanText(p.callsign || p.name, 16) || 'Rookie';
  return {
    pid: cleanText(p.pid || p.id, 24),
    name: callsign,
    full: cleanText(p.name, 28),
    gun: int(p.gun, MIN_GUN, 7, 4),
    pil: int(p.pil, MIN_PIL, 8, 5),
    abilities,
    portrait: p.portrait && typeof p.portrait === 'object' ? sanitizePortrait(p.portrait) : null,
  };
}
export function sanitizePortrait(q) {
  const out = {};
  for (const k of ['skin', 'hair', 'hairColor', 'eyes', 'brows', 'mouth', 'face', 'extra', 'helmet', 'bg', 'beard']) out[k] = int(q[k], 0, 15, 0);
  return out;
}

export const hasAbility = (m, a) => !!(m && m.pilot && m.pilot.abilities && m.pilot.abilities.includes(a));

// ---- experience after a battle
// Taking part 1, surviving 1, winning 2, each kill 2, 1 per 25 damage dealt (up to 4),
// completing the mission's objective personally 2.
export function battleXP(st, m) {
  const parts = [];
  parts.push(['Took part', 1]);
  const fate = pilotFate(m);
  if (fate !== 'killed') parts.push(['Survived', 1]);
  const won = st.winner && (st.winner.team === (m.team ?? m.side) || st.winner.side === m.side);
  if (won) parts.push(['Victory', 2]);
  if (m.stats.kills) parts.push([`${m.stats.kills} kill${m.stats.kills > 1 ? 's' : ''}`, m.stats.kills * 2]);
  const d = Math.min(4, Math.floor(m.stats.dmg / 25));
  if (d) parts.push([`${m.stats.dmg} damage dealt`, d]);
  if (m.exited && st.item && st.item.carrier === m.id) parts.push(['Carried the objective out', 2]);
  return { total: parts.reduce((s, [, v]) => s + v, 0), parts };
}
// killed | ejected | wounded | ok
export function pilotFate(m) {
  if (m.pilot.fate === 'killed' || m.pilot.hits >= 6) return 'killed';
  if (m.pilot.fate === 'ejected') return 'ejected';
  if (m.pilot.hits > 0) return 'wounded';
  return 'ok';
}
// Battles a wounded pilot sits out to heal: one per two hits, at least one after ejecting
export const restFor = (m) => Math.max(m.pilot.fate === 'ejected' && m.dead ? 1 : 0, Math.ceil(m.pilot.hits / 2));

// Apply one finished battle to a roster pilot (the device's own copy). Returns a summary.
export function applyBattle(p, st, m, gid) {
  if (!p || p.dead) return null;
  p.log = p.log || [];
  if (p.log.some((l) => l.gid === gid)) return null; // already counted
  const xp = battleXP(st, m);
  const fate = pilotFate(m);
  p.xp = (p.xp || 0) + xp.total;
  p.xpTotal = (p.xpTotal || 0) + xp.total;
  p.battles = (p.battles || 0) + 1;
  p.kills = (p.kills || 0) + m.stats.kills;
  p.dmg = (p.dmg || 0) + m.stats.dmg;
  if (fate === 'killed') { p.dead = true; p.diedIn = m.design; }
  else p.rest = restFor(m);
  if (fate === 'ejected') p.ejections = (p.ejections || 0) + 1;
  const won = xp.parts.some(([k]) => k === 'Victory');
  if (won) p.wins = (p.wins || 0) + 1;
  p.log.unshift({ gid, at: Date.now(), mech: m.design, mission: st.mission, won, xp: xp.total, kills: m.stats.kills, dmg: m.stats.dmg, fate, hits: m.pilot.hits });
  p.log = p.log.slice(0, 30);
  return { xp, fate, rest: p.rest || 0 };
}
// Pilots who didn't fight this battle get a step closer to being fit
export function restBattle(p) { if (p && !p.dead && p.rest > 0) p.rest--; }

export function canImprove(p, what) {
  if (!p || p.dead) return { ok: false, cost: 0 };
  if (what === 'gun') { const to = p.gun - 1; const cost = GUN_COST[to]; return { ok: !!cost && p.xp >= cost, cost, to, max: !cost }; }
  if (what === 'pil') { const to = p.pil - 1; const cost = PIL_COST[to]; return { ok: !!cost && p.xp >= cost, cost, to, max: !cost }; }
  if (ABILITIES[what]) {
    const full = (p.abilities || []).length >= MAX_ABILITIES;
    const has = (p.abilities || []).includes(what);
    return { ok: !full && !has && p.xp >= ABILITY_COST, cost: ABILITY_COST, full, has };
  }
  return { ok: false, cost: 0 };
}
export function improve(p, what) {
  const c = canImprove(p, what);
  if (!c.ok) return false;
  p.xp -= c.cost;
  if (what === 'gun') p.gun = c.to;
  else if (what === 'pil') p.pil = c.to;
  else p.abilities = [...(p.abilities || []), what];
  return true;
}

export function newPilot({ name, callsign, bg, portrait, id }) {
  const B = BACKGROUNDS[bg] || BACKGROUNDS.academy;
  return {
    id: id || 'p' + Math.random().toString(36).slice(2, 10),
    name: cleanText(name, 28) || 'Unnamed',
    callsign: cleanText(callsign, 16) || 'Rookie',
    bg: BACKGROUNDS[bg] ? bg : 'academy',
    gun: B.gun, pil: B.pil, abilities: B.ability ? [B.ability] : [],
    xp: B.xp, xpTotal: 0, battles: 0, kills: 0, wins: 0, dmg: 0, rest: 0, dead: false,
    portrait: portrait || {}, created: Date.now(), log: [],
  };
}

// ---- name generator: a spread of Inner Sphere cultures, plus callsigns
const FIRST = ['Aleksandr', 'Mira', 'Kenji', 'Saoirse', 'Tomas', 'Imani', 'Rafael', 'Yuki', 'Dmitri', 'Leila', 'Owen', 'Priya', 'Hakon', 'Mei', 'Jonah', 'Ines', 'Viktor', 'Ama', 'Kaito', 'Elena', 'Marcus', 'Freya', 'Tariq', 'Nadia', 'Bram', 'Sora', 'Diego', 'Astrid', 'Kwame', 'Lucia', 'Ivo', 'Rhea'];
const LAST = ['Kerensky', 'Okafor', 'Tanaka', 'Murphy', 'Novak', 'Haddad', 'Varga', 'Lindqvist', 'Ortega', 'Chen', 'Volkov', 'Mbeki', 'Sato', 'Delacroix', 'Reyes', 'Brandt', 'Kowalski', 'Adeyemi', 'Ishikawa', 'Moreau', 'Petrov', 'Castillo', 'Nakamura', 'Hale', 'Sandoval', 'Rask', 'Oduya', 'Fenwick'];
const CALL = ['Hawk', 'Viper', 'Tex', 'Ghost', 'Mako', 'Rook', 'Jinx', 'Bishop', 'Kestrel', 'Nova', 'Ronin', 'Anvil', 'Banshee', 'Cinder', 'Duke', 'Echo', 'Flint', 'Grit', 'Halo', 'Ironside', 'Jackal', 'Kodiak', 'Lynx', 'Maverick', 'Nomad', 'Onyx', 'Pike', 'Quill', 'Rascal', 'Sable', 'Tank', 'Umbra', 'Vex', 'Wraith', 'Yeti', 'Zephyr', 'Boomer', 'Dancer', 'Hammer', 'Scrap'];
export function randomName(rnd = Math.random) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  return { name: `${pick(FIRST)} ${pick(LAST)}`, callsign: pick(CALL) };
}
export function randomPortrait(rnd = Math.random) {
  const r = (n) => Math.floor(rnd() * n);
  return { skin: r(8), hair: r(10), hairColor: r(8), eyes: r(6), brows: r(4), mouth: r(5), face: r(4), extra: r(8), helmet: r(4), bg: r(6), beard: r(5) };
}
