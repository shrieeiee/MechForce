// Mercenary campaign: a company of mechs and MechWarriors taking contracts for pay and
// salvage. Damage carries over between battles until it's repaired; wrecked mechs must be
// rebuilt or scrapped; pilots come from the Barracks roster and are paid per contract.
// Everything here is plain data and pure functions, saved on the device by the client.
import { MECHS, MISSIONS, THEMES, MAP_SIZES, AI_LEVEL_IDS, mechBV } from './data.js';
import { hashSeed, nextRand } from './rng.js';
import { buildTemplate } from './custom.js';

export const START_CBILLS = 4000000;
export const SALARY = 20000;           // per MechWarrior per contract
export const ARMOR_COST = 6000;        // per armour point
export const STRUCT_COST = 18000;      // per internal structure point
export const DEBT_LIMIT = -1500000;

const rng = (seed) => { const s = { rng: hashSeed(String(seed)) }; return () => nextRand(s); };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const round10k = (v) => Math.round(v / 10000) * 10000;

export const templateOf = (design) => (design && typeof design === 'object' && design.custom ? buildTemplate(design.custom).template : MECHS.find((m) => m.n === design));
export const designName = (design) => (design && typeof design === 'object' && design.custom ? design.custom.name : design);
// purchase price: battle value and tonnage
export function mechPrice(design) {
  const t = templateOf(design);
  if (!t) return 0;
  return round10k(t.t * 30000 + mechBV(t) * 900);
}

// ---- the company
export function newCompany(name, seed = Date.now()) {
  const r = rng('co' + seed);
  const light = MECHS.filter((m) => m.t <= 40 && !m.body), medium = MECHS.filter((m) => m.t >= 45 && m.t <= 55 && !m.body);
  const starters = [pick(r, medium), pick(r, medium), pick(r, light), pick(r, light)];
  const co = {
    v: 1, name: String(name || 'Grey Wolves').slice(0, 28), seed: String(seed), cbills: START_CBILLS, rep: 0, day: 1, contracts: 0, wins: 0,
    mechs: starters.map((m, i) => ({ uid: 'm' + i, design: m.n, armor: null, internal: null, wrecked: false, kills: 0 })),
    nextUid: starters.length, board: [], market: [], log: [{ day: 1, text: `${String(name || 'Grey Wolves')} founded with ${starters.length} BattleMechs and ${fmtC(START_CBILLS)}.` }],
  };
  refresh(co);
  return co;
}
export const fmtC = (v) => (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('en-GB') + ' C';

// ---- state of a mech in the hangar
export function mechState(m) {
  const t = templateOf(m.design);
  if (!t) return { ok: false, needs: 0, cost: 0, armorPct: 0, missing: true };
  const arm = m.armor || t.a, int = m.internal || t.i;
  const missA = t.a.reduce((s, v, i) => s + Math.max(0, v - arm[i]), 0);
  const missI = t.i.reduce((s, v, i) => s + Math.max(0, v - int[i]), 0);
  const destroyedLoc = int.some((v, i) => v <= 0 && t.i[i] > 0);
  const cost = m.wrecked ? round10k(mechPrice(m.design) * 0.45) : missA * ARMOR_COST + missI * STRUCT_COST;
  const armorPct = Math.round(100 * (arm.reduce((s, v) => s + v, 0) + int.reduce((s, v) => s + v, 0)) / (t.a.reduce((s, v) => s + v, 0) + t.i.reduce((s, v) => s + v, 0)));
  // a mech with a destroyed location or a wreck can't fight until it's fixed
  return { ok: !m.wrecked && !destroyedLoc, needs: missA + missI, cost, armorPct: m.wrecked ? 0 : armorPct, wrecked: m.wrecked, destroyedLoc, tons: t.t };
}
export function repair(co, uid) {
  const m = co.mechs.find((x) => x.uid === uid);
  if (!m) return false;
  const s = mechState(m);
  if (!s.cost || co.cbills - s.cost < DEBT_LIMIT) return false;
  co.cbills -= s.cost;
  m.armor = null; m.internal = null; m.wrecked = false;
  co.log.unshift({ day: co.day, text: `Repaired the ${designName(m.design)} for ${fmtC(s.cost)}.` });
  return true;
}
export function sellMech(co, uid) {
  const i = co.mechs.findIndex((x) => x.uid === uid);
  if (i < 0) return 0;
  const m = co.mechs[i];
  const value = round10k(mechPrice(m.design) * (m.wrecked ? 0.1 : 0.5 * Math.max(0.3, mechState(m).armorPct / 100)));
  co.mechs.splice(i, 1);
  co.cbills += value;
  co.log.unshift({ day: co.day, text: `Sold the ${designName(m.design)} for ${fmtC(value)}.` });
  return value;
}
export function buyMech(co, idx) {
  const offer = co.market[idx];
  if (!offer || co.cbills < offer.price) return false;
  co.cbills -= offer.price;
  co.mechs.push({ uid: 'm' + co.nextUid++, design: offer.design, armor: null, internal: null, wrecked: false, kills: 0 });
  co.market.splice(idx, 1);
  co.log.unshift({ day: co.day, text: `Bought a ${designName(offer.design)} for ${fmtC(offer.price)}.` });
  return true;
}

// ---- contracts and the market
const EMPLOYERS = ['Planetary governor', 'Mining consortium', 'Rebel militia', 'Noble house', 'Trade guild', 'Colonial authority', 'Border garrison', 'Shipping cartel'];
const WORLDS = ['Kessel Reach', 'Tamar Deep', 'Nova Arcadia', 'Haldane', 'Ostrava IV', 'Merrow', 'Galt Prime', 'Sindri', 'Corvane', 'Ashfall', 'Bryce', 'Elara', 'Vantaa', 'Kiruna', 'Dorne Minor', 'Hollis'];
const MISSION_TEXT = {
  generic: 'Destroy the enemy lance.', datapack: 'Recover a data core from the battlefield.', crossing: 'Break through to the far edge.',
  hold: 'Hold a position until relieved.', scout: 'Scout the enemy deployment and get the data out.', pepsi: 'Escort a supply drop across the field.',
  base: 'Storm a fortified command post.', defend: 'Hold a command post against raiders.', convoy: 'Escort supply haulers across the field.',
};
export const DIFFICULTY = ['Routine', 'Standard', 'Dangerous', 'Deadly'];
export function companyStrength(co) {
  const ready = co.mechs.filter((m) => mechState(m).ok).map((m) => templateOf(m.design).t).sort((a, b) => b - a).slice(0, 4);
  return Math.max(120, ready.reduce((s, v) => s + v, 0));
}
export function refresh(co) {
  const r = rng(co.seed + ':' + co.contracts + ':' + co.day);
  const strength = companyStrength(co);
  const missions = MISSIONS.filter((m) => MISSION_TEXT[m.id] && m.sides[0] <= 2);
  co.board = [];
  for (let i = 0; i < 3; i++) {
    const diff = Math.min(3, Math.max(0, Math.floor(r() * 3) + (co.rep >= 6 ? 1 : 0) - (i === 0 ? 1 : 0)));
    const mission = pick(r, missions).id;
    const enemyTons = Math.round(strength * [0.75, 0.95, 1.15, 1.35][diff] / 5) * 5;
    const pay = round10k(enemyTons * [9000, 12000, 16000, 22000][diff] * (1 + co.rep * 0.04));
    co.board.push({
      id: co.contracts + '-' + i, employer: pick(r, EMPLOYERS), world: pick(r, WORLDS), mission, diff, enemyTons, pay,
      killBonus: round10k(pay * 0.08), salvage: [0.1, 0.2, 0.3, 0.4, 0.5][Math.floor(r() * 5)],
      mapSize: pick(r, MAP_SIZES).id, theme: pick(r, THEMES).id, aiLevel: AI_LEVEL_IDS[diff],
      forces: r() < 0.4 ? (diff >= 2 ? 'many' : 'few') : 'none', defences: r() < 0.3 ? (diff >= 2 ? 'heavy' : 'light') : 'none', fog: r() < 0.35,
      seed: co.seed + '-' + co.contracts + '-' + i, text: MISSION_TEXT[mission],
    });
  }
  // the market: five mechs, a mix of sizes
  const pool = MECHS.filter((m) => m.t <= 100);
  co.market = [];
  for (let i = 0; i < 5; i++) { const m = pick(r, pool); co.market.push({ design: m.n, price: round10k(mechPrice(m.n) * (0.9 + r() * 0.3)) }); }
}
// The enemy lance for a contract: up to four mechs close to the tonnage
export function enemyLance(c) {
  const r = rng('en' + c.seed);
  const pool = MECHS.filter((m) => m.t <= 100);
  let best = null;
  for (let t = 0; t < 80; t++) {
    const l = [0, 1, 2, 3].map(() => pick(r, pool));
    const tons = l.reduce((s, m) => s + m.t, 0);
    const score = -Math.abs(tons - c.enemyTons) + r() * 4;
    if (!best || score > best.score) best = { score, l };
  }
  return best.l.map((m) => m.n);
}

// ---- after a battle
// st: final game state; mySide: the player's side; deployed: [{ uid, mechId }]
export function settle(co, c, st, mySide, deployed) {
  const myTeam = st.sides[mySide].team ?? mySide;
  const w = st.winner;
  const won = !!w && (w.team ?? w.side) === myTeam;
  const enemyMechs = st.mechs.filter((m) => (m.team ?? m.side) !== myTeam);
  const kills = enemyMechs.filter((m) => m.dead && !m.exited).length;
  const out = { won, pay: 0, bonus: 0, salaries: 0, salvage: [], salvageC: 0, damaged: [], wrecked: [], rep: 0 };
  // a failed contract pays nothing beyond kill bonuses and scrap
  out.pay = won ? c.pay : 0;
  out.bonus = kills * c.killBonus;
  out.salaries = deployed.length * SALARY;
  // salvage: each destroyed enemy is a chance at the mech itself, otherwise parts for cash
  const r = rng('sv' + c.seed + st.round);
  for (const m of enemyMechs.filter((x) => x.dead && !x.exited)) {
    if (won && r() < c.salvage) { out.salvage.push(m.design); co.mechs.push({ uid: 'm' + co.nextUid++, design: m.design, armor: null, internal: null, wrecked: true, kills: 0 }); }
    else out.salvageC += round10k(mechPrice(m.design) * c.salvage * 0.25 * (won ? 1 : 0.4));
  }
  // our mechs' damage carries over
  for (const d of deployed) {
    const cm = co.mechs.find((x) => x.uid === d.uid);
    const gm = st.mechs[d.mechId];
    if (!cm || !gm) continue;
    cm.kills += gm.stats.kills;
    if (gm.dead) { cm.wrecked = true; cm.armor = null; cm.internal = null; out.wrecked.push(designName(cm.design)); continue; }
    cm.armor = gm.armor.slice(); cm.internal = gm.internal.slice();
    if (mechState(cm).needs) out.damaged.push(designName(cm.design));
  }
  out.rep = won ? (c.diff >= 2 ? 2 : 1) : -1;
  const total = out.pay + out.bonus + out.salvageC - out.salaries;
  co.cbills += total;
  co.rep = Math.max(0, co.rep + out.rep);
  co.contracts++; if (won) co.wins++;
  co.day += 20 + Math.floor(r() * 25);
  co.log.unshift({ day: co.day, text: `${won ? 'Won' : 'Lost'} “${MISSIONS.find((m) => m.id === c.mission).name}” for the ${c.employer.toLowerCase()} on ${c.world}: ${fmtC(total)}${out.salvage.length ? `, salvaged ${out.salvage.join(', ')}` : ''}.` });
  co.log = co.log.slice(0, 40);
  out.total = total;
  refresh(co);
  return out;
}
export const bankrupt = (co) => co.cbills < DEBT_LIMIT || (co.cbills < 0 && !co.mechs.some((m) => mechState(m).ok) && co.mechs.every((m) => mechState(m).cost > co.cbills - DEBT_LIMIT));

// What it costs to hire a MechWarrior of this quality
export const hireCost = (p) => round10k(80000 + (10 - p.gun - p.pil) * 45000 + (p.abilities || []).length * 40000);
