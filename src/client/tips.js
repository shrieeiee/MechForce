// Tooltip engine + the plain-language explanations shown in tooltips and the field manual.
// Any element with data-tip (HTML) and optional data-tip-title gets a tooltip:
//   mouse: hover · controller/keyboard: when the element has focus · touch: long-press.
import { WEAPONS, TERRAIN, STRUCTS, LOADOUTS } from '../core/data.js';
import { chance } from '../core/rng.js';
import { ABILITIES } from '../core/pilots.js';
import { esc } from './ui.js';
import { input } from './input.js';

export const tipSettings = { on: true };
let tipEl = null, showTimer = null, current = null, lastPointer = 'mouse', pressTimer = null, pinned = false;

export function attr(title, body) {
  return `data-tip-title="${esc(title)}" data-tip="${esc(body)}"`;
}

function ensure() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  return tipEl;
}

export function showTip(el, { force = false } = {}) {
  if (!el || (!tipSettings.on && !force)) return;
  const body = el.dataset.tip;
  if (!body) return;
  const t = ensure();
  current = el;
  t.innerHTML = (el.dataset.tipTitle ? `<b>${el.dataset.tipTitle}</b>` : '') + `<div>${body}</div>`;
  t.classList.add('on');
  const r = el.getBoundingClientRect();
  const tw = Math.min(340, window.innerWidth - 24);
  t.style.maxWidth = tw + 'px';
  t.style.left = '0px'; t.style.top = '0px';
  const th = t.offsetHeight, w = t.offsetWidth;
  let x = r.left + r.width / 2 - w / 2;
  let y = r.top - th - 10;
  if (y < 8) y = r.bottom + 10;
  if (y + th > window.innerHeight - 8) y = Math.max(8, window.innerHeight - th - 8);
  // keep it beside wide panels rather than over them
  if (r.width > 280 && r.left > window.innerWidth / 2) { x = r.left - w - 12; y = Math.min(Math.max(8, r.top), window.innerHeight - th - 8); }
  x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
export function tipGC() { if (current && !current.isConnected) hideTip(); }
export function hideTip() { current = null; pinned = false; if (tipEl) tipEl.classList.remove('on'); }

export function initTips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    lastPointer = 'mouse';
    const el = e.target.closest && e.target.closest('[data-tip]');
    clearTimeout(showTimer);
    if (!el) { if (!pinned) hideTip(); return; }
    if (el === current) return;
    showTimer = setTimeout(() => showTip(el), 280);
  });
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType;
    if (e.pointerType === 'touch') {
      if (pinned) hideTip();
      const el = e.target.closest && e.target.closest('[data-tip]');
      clearTimeout(pressTimer);
      if (el) pressTimer = setTimeout(() => { showTip(el, { force: true }); pinned = true; }, 450);
    } else if (!(e.target.closest && e.target.closest('[data-tip]'))) hideTip();
  }, true);
  document.addEventListener('pointerup', () => clearTimeout(pressTimer), true);
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') clearTimeout(pressTimer); }, true);
  window.addEventListener('mf-focus', (e) => {
    const { el, fromNav } = e.detail || {};
    if (!fromNav || input.device === 'touch') return;
    if (el && el.dataset && el.dataset.tip) showTip(el); else if (!pinned) hideTip();
  });
  window.addEventListener('resize', hideTip);
}

// ---------------------------------------------------------------- explanatory copy
export const WEAPON_BLURB = {
  b: 'Ballistic cannon. Fires shells from a limited ammo supply and makes little heat.',
  mg: 'Machine gun. Short range and light damage, but no heat at all. Good for finishing off exposed internals.',
  lrm: 'Long-range missile rack. Fires a volley; a dice roll decides how many missiles connect, and the damage lands in 5-point groups spread over the target. Poor at close range.',
  srm: 'Short-range missile rack. Each missile that connects strikes its own spot on the target, which makes it great for finding a weak point.',
  e: 'Energy weapon. Never runs out of ammo, but every shot builds heat.',
  flamer: 'Flamethrower. Very short range; besides damage it adds heat to the target.',
  plasma: 'Plasma cannon. Heavy, accurate-at-range energy weapon. Lots of damage, lots of heat, and it struggles at point-blank range.',
};
export function weaponBlurb(t) {
  const W = WEAPONS[t];
  if (t === 4) return WEAPON_BLURB.mg;
  if (t === 15) return WEAPON_BLURB.flamer;
  if (t === 16) return WEAPON_BLURB.plasma;
  if (W.kind === 'm') return W.lrm ? WEAPON_BLURB.lrm : WEAPON_BLURB.srm;
  return W.kind === 'b' ? WEAPON_BLURB.b : WEAPON_BLURB.e;
}

export function brackets(w) {
  const s = Math.ceil(w.rng / 3), m = Math.ceil(w.rng * 2 / 3);
  return { s, m, l: w.rng, min: w.minr || 0 };
}

const MOD_EXPLAIN = {
  'Gunnery': 'Your pilot\'s gunnery skill. This is the starting number to beat on two dice.',
  'Piloting': 'Your pilot\'s piloting skill — the starting number for punches, kicks and death from above.',
  'Medium range': 'The target is in this weapon\'s middle range band.',
  'Long range': 'The target is near this weapon\'s maximum range.',
  'Minimum range': 'Too close: this weapon needs room to work.',
  'Arm actuators': 'Damaged shoulder or arm joints make this arm harder to aim.',
  'You walked': 'Walking this turn shakes your aim a little.',
  'You ran': 'Running this turn makes your shots much less steady.',
  'You jumped': 'Firing after a jump is the least accurate of all.',
  'Target movement': 'The further the target moved last turn, the harder it is to hit.',
  'Target prone': 'A fallen mech is easier to hit up close and harder from range.',
  'Target immobile': 'The target is shut down or its pilot is out cold — an easy shot.',
  'Woods': 'Trees between you and the target, or around it, give it cover.',
  'Partial cover': 'The target is standing in water, which hides its legs.',
  'Heat': 'Your mech is running hot and its targeting suffers.',
  'Sensors damaged': 'Your sensors are hit, so your targeting is degraded.',
  'You are prone': 'You are lying on the ground, which spoils your aim.',
  'Kick': 'Kicks are easier to land than punches.',
};
export function modLine(m) {
  const sign = m.v > 0 ? '+' + m.v : String(m.v);
  return `<li><span class="mv ${m.v > 0 ? 'bad' : m.v < 0 ? 'good' : ''}">${sign}</span> <b>${esc(m.label)}</b> — ${esc(MOD_EXPLAIN[m.label] || '')}</li>`;
}

const REASON_EXPLAIN = {
  'Out of range': 'The target is further away than this weapon can reach.',
  'Out of arc': 'This weapon can\'t point that way. Torso, head and leg weapons fire into your front 120°; arm weapons also cover their own side. Turn to face the target next time.',
  'No line of sight': 'Hills or thick woods block the view. Move to higher ground or around the obstacle.',
  'No ammo': 'This weapon has fired all its ammunition.',
  'Destroyed': 'This weapon was knocked out by a critical hit.',
  'Not adjacent': 'You need to be in the hex next to the target.',
  'Elevation': 'The height difference is too big to reach.',
  'Four-legged': 'A four-legged mech has no arms, so it can\'t punch. It can still kick.',
  'Vehicle mode': 'A QuadVee in vehicle mode can\'t make physical attacks. Convert back to BattleMech mode first.',
};
export const reasonText = (r) => REASON_EXPLAIN[r] || r;

export function weaponTip(w, th, dist) {
  const W = WEAPONS[w.t];
  const b = brackets(w);
  const band = !th.dist ? '' : dist <= b.s ? 'short' : dist <= b.m ? 'medium' : dist <= b.l ? 'long' : 'out of range';
  const dmg = W.n > 1 ? `${w.dmg} per missile × ${W.n} missiles` : `${w.dmg}`;
  let s = `<p>${esc(weaponBlurb(w.t))}</p><table class="tt">
    <tr><td>Damage</td><td>${dmg}</td></tr><tr><td>Heat per shot</td><td>${w.heat}</td></tr>
    <tr><td>Range</td><td>Short 1–${b.s} · Medium ${b.s + 1}–${b.m} · Long ${b.m + 1}–${b.l}${b.min ? ` · minimum ${b.min}` : ''}</td></tr>
    ${w.ammo >= 0 ? `<tr><td>Ammo left</td><td>${w.ammo}</td></tr>` : ''}</table>`;
  if (th.ok) {
    s += `<p>Target is <b>${dist} hexes</b> away (${band} range). You need <b>${th.tn}+</b> on two dice: <b>${Math.round(th.p * 100)}%</b>.</p><ul class="mods-list">${th.mods.map(modLine).join('')}</ul>`;
  } else s += `<p class="warn">${esc(reasonText(th.reason))}</p>`;
  return s;
}

export function heatTip(heat, proj, sinks) {
  const row = (lvl, txt) => `<li class="${heat >= lvl ? 'hit' : ''}"><span class="mv">${lvl}+</span> ${txt}</li>`;
  return `<p>Moving and firing builds heat. At the end of each activation your heat sinks remove <b>${sinks}</b> point${sinks === 1 ? '' : 's'} (standing in water cools faster).</p>
    <ul class="mods-list">${row(5, 'Slower: lose 1 movement point per 5 heat')}${row(8, 'Aiming suffers (+1 to hit, worse as it climbs)')}${row(14, 'Risk of reactor shutdown — you lose your next turn')}${row(19, 'Risk of your own ammo exploding')}${row(30, 'Automatic shutdown')}</ul>
    <p>Now <b>${heat}</b>${proj !== undefined ? ` → after this turn <b>${proj}</b>` : ''}.</p>`;
}

export const MODE_TIP = {
  walk: 'Walk: the safest way to move. +1 heat. Your shots this turn get +1 to hit (slightly harder). You can also step backwards.',
  run: 'Run: about 50% further than walking. +2 heat and +2 to your own shots this turn. Can\'t enter deep water.',
  jump: 'Jump: fly over anything to any hex in range and land facing any way. At least +3 heat and +3 to your shots, but the target number to hit YOU rises too.',
  track: 'Tracks: kneel down and roll at walking speed. +1 heat and +1 to your shots, like walking. On tracks the mech ignores leg and gyro damage when keeping its balance, but it can\'t enter heavy woods or water, can climb only one level at a time, and climbing costs double. Can reverse.',
  cruise: 'Cruise (vehicle mode): drive at walking speed. No movement heat at all, +1 to your shots. Can\'t enter heavy woods, climbs one level at a time at double cost, but can drive through water. Can reverse.',
  flank: 'Flank (vehicle mode): drive flat out, about 50% further. Still no movement heat, +2 to your shots. Forward only.',
};
export const SHIFT_TIP = 'Four-legged mechs can side-step: move to a hex at the front-left or front-right without turning, for 1 extra movement point. Walking, they can also side-step backwards.';
export const CONVERT_TIP = (cost, toVehicle) => `<p>Fold into a ${toVehicle ? 'tracked tank' : 'four-legged BattleMech'} at the end of this move. Converting uses <b>${cost}</b> movement points (2, plus 1 for each damaged leg actuator, track or conversion gear), so you move that much less this turn.</p><p>${toVehicle ? 'Vehicle mode: no movement heat, can\'t fall over, can drive through water. No jumping, kicking or side-stepping.' : 'BattleMech mode: can jump, kick and side-step, and gets the four-legged -2 bonus to stay upright.'}</p><p>You can't convert in water or while lying down.</p>`;

// ---- chassis descriptions (Mech Bay, Mech Lab, unit cards)
export const CHASSIS_TIP = {
  biped: '<p>A standard two-legged BattleMech with two arms.</p>',
  quad: '<p><b>Four-legged.</b> No arms, so no punches, and its front legs carry what would be arm armour. Four legs make it very steady: -2 to every piloting roll while all four work. It can side-step without turning (+1 MP), and keeps going after losing a leg (-1 MP; with two gone it crawls at 1 MP).</p><p>Its weapons all fire forwards.</p>',
  tripod: '<p><b>Tripod.</b> Two arms and three legs, with a two-seat cockpit. -1 to piloting rolls while all three legs work. Shots that hit "a leg" can strike the centre leg too. Losing a leg drops it to 1 MP; losing two leaves it immobile.</p>',
  tracks: '<p><b>BattleMech tracks.</b> This mech can kneel and roll on tracks at walking speed instead of walking. On tracks it ignores leg actuator and gyro damage when keeping its balance, and keeps rolling even with a wrecked gyro, but it can\'t run, can\'t enter heavy woods or water, and climbing costs double.</p>',
  quadvee: '<p><b>QuadVee.</b> A Clan four-legged mech that converts into a tracked tank (2 MP). As a tank it cruises at walking speed or flanks at running speed with <b>no movement heat</b>, can\'t fall over and can drive through water — but it can\'t jump, kick or side-step. Each lost leg or track costs a quarter of its tank speed.</p>',
};
export function chassisName(m) {
  const b = (m && m.body) || 'biped';
  if (m.mot === 'quadvee') return 'QuadVee';
  return ({ biped: 'Biped', quad: 'Four-legged', tripod: 'Tripod' }[b]) + (m.mot === 'tracks' ? ' + tracks' : '');
}
export function chassisTag(m) { return m.mot === 'quadvee' ? 'QuadVee' : m.body === 'quad' ? 'Quad' : m.body === 'tripod' ? 'Tripod' : m.mot === 'tracks' ? 'Tracks' : ''; }
const LOC_ABBR = ['Head', 'L.torso', 'C.torso', 'R.torso', 'L.arm', 'R.arm', 'L.leg', 'R.leg', 'C.leg'];
const QUAD_ABBR = ['Head', 'L.torso', 'C.torso', 'R.torso', 'FL leg', 'FR leg', 'RL leg', 'RR leg'];
export const locAbbr = (body, l) => (body === 'quad' ? QUAD_ABBR : LOC_ABBR)[l];
export const moveDefense = 'Moving also makes you harder to hit: enemies get +1 to hit you for 3–4 hexes moved, +2 for 5–6, +3 for 7–9, +4 for 10+, and +1 more if you jumped.';

export function turnOrderTip(st) {
  const order = st.order.map((i) => `<span style="color:${st.sides[i].color}">${esc(st.sides[i].name)}</span> (rolled ${st.sides[i].init})`).join(' → ');
  return `<p>Every round each force rolls two dice for initiative. <b>The lowest roll goes first</b>, which sounds bad but means the winner gets to react to what they see.</p>
    <p>Forces then take turns activating <b>one mech at a time</b>: move it, then attack with it. When every mech has acted, a new round starts. Each round is 50 seconds of battle time.</p>
    <p>This round: ${order}</p><p>Filled pips are mechs still waiting to act; hollow pips have finished.</p>`;
}

export function terrainTip(tn) {
  const T = TERRAIN[tn];
  const lines = {
    0: 'Open ground. Cheap to cross, no cover.',
    1: 'Light woods: costs 2 to enter and gives +1 cover to anyone in it or shooting through it.',
    2: 'Heavy woods: costs 3 to enter and gives +2 cover. Three points of woods in a line block sight completely.',
    3: 'Rough ground: costs 2 to enter, no cover.',
    4: 'Shallow water: costs 2, hides the legs (+1 cover) and helps cool your mech (+2 heat removed).',
    5: 'Deep water: costs 4 and can\'t be run through, but cools your mech a lot (+4 heat removed).',
  };
  return `<p>${lines[tn] || T.name}</p><p>Climbing or dropping a level costs 1 extra per level; you can't step up or down more than 2 levels. Higher ground blocks sight for mechs below it.</p>`;
}

export function pilotTip(m, mods) {
  const extra = mods && mods.length ? `<p>Staying upright: piloting ${m.pilot.pil} ${mods.map(([l, v]) => `${v > 0 ? '+' : '−'}${Math.abs(v)} ${esc(l.toLowerCase())}`).join(', ')}.</p>` : '';
  return extra + `<p>${esc(m.pilot.name)} has taken <b>${m.pilot.hits} of 6</b> injuries. Injuries come from head hits, falls, ammo explosions and overheating with damaged life support.</p><p>Each injury risks knocking the pilot unconscious (the mech stops until they wake). Six injuries kill the pilot.</p><p>Gunnery ${m.pilot.gun} (lower is better at shooting) · Piloting ${m.pilot.pil} (lower is better at staying upright and melee).</p>${(m.pilot.abilities || []).map((a) => `<p><b>${esc(ABILITIES[a].name)}</b>: ${esc(ABILITIES[a].text)}</p>`).join('')}${m.pilot.pid ? '<p class="faint">A MechWarrior from the barracks: experience, wounds and death carry over.</p>' : ''}`;
}

export const ARMOR_TIP = '<p>Each block is one part of the mech; the number is its armour. Green is healthy, red is nearly stripped, dark red means armour is gone and the internal structure is exposed — hits there can cause critical damage.</p><p>The small row marked REAR is the back armour of the torso: much thinner, so shots from behind hurt more. Losing the head or center torso destroys the mech.</p><p>Four-legged mechs show four legs where the arms would be; a tripod has a third leg in the middle.</p>';

export const STATUS_TIP = {
  'Prone': 'Knocked down. Standing up costs 2 movement points. Easier to hit up close, harder from range.',
  'Shut down': 'The reactor overheated and shut down. The mech sits still this round while it cools and tries to restart.',
  'Pilot unconscious': 'The pilot is knocked out. The mech can\'t act until they wake up (rolled at the start of each round).',
  'Done this round': 'This mech has already acted this round.',
  'Destroyed': 'Out of the fight.',
  'Left battlefield': 'This mech has exited the map for the mission objective.',
  'Scouted': 'This mech has reached the enemy rear. Get it home off the west edge.',
  'Vehicle mode': 'This QuadVee is folded into a tank: cruise/flank with no movement heat, can\'t fall, can drive through water. No jumping, kicking or side-stepping.',
  'On tracks': 'Rolling on its tracks: it ignores leg and gyro damage when keeping its balance, but can\'t enter heavy woods or water.',
};
export function statusTip(label) {
  if (label.startsWith('Engine')) return 'Engine damage adds 5 heat every turn per hit. A third hit destroys the mech.';
  if (label.startsWith('Gyro')) return 'Gyro damage makes it harder to stay standing. Two hits and the mech can no longer walk.';
  if (label.startsWith('Sensors')) return 'Damaged sensors add +2 to hit per hit.';
  if (label.includes('heat sinks')) return 'Destroyed heat sinks: the mech cools down more slowly.';
  if (label.startsWith('Carrying')) return 'This mech carries the mission objective. If it is destroyed the item drops where it fell.';
  return STATUS_TIP[label] || '';
}

export function hitDirTip(dir) {
  return {
    F: 'You are shooting at its front: the toughest armour.',
    L: 'You are hitting its left side: shots tend to land on the left arm, leg and torso.',
    R: 'You are hitting its right side: shots tend to land on the right arm, leg and torso.',
    B: 'You are behind it! Torso hits strike the thin rear armour.',
  }[dir];
}

// ---------------------------------------------------------------- field manual
export const MANUAL = [
  { k: 'basics', t: 'Basics', body: `
    <p>You command a <b>lance</b> of up to four BattleMechs. Each mission has an objective (top left of the screen); usually that means wrecking the enemy, but some missions are about crossing the map, grabbing an item, or simply surviving.</p>
    <p>Everything happens on a hex grid. Hexes have terrain and height, which affect how far you can move, what you can see, and how hard you are to hit.</p>
    <p>Rotate the battlefield any time with the ⟲ ⟳ buttons (top right), the right stick, Q/E, right-dragging with the mouse, or twisting two fingers. During attacks the camera swings round automatically so you can see both the attacker and the target.</p>
    <p>On your turn the bar at the bottom shows the current step and what each button does. Hover, focus or long-press almost anything for an explanation.</p>` },
  { k: 'turns', t: 'Turn order', body: `
    <p>Each round, every force rolls two dice for <b>initiative</b>. The lowest roll moves first; the highest goes last and gets to react.</p>
    <p>Forces then alternate, activating <b>one mech at a time</b>. An activation is: <b>move</b>, then <b>attack</b>. When all mechs have acted, the round ends. The strip at the top of the screen shows the order and which mechs are still waiting.</p>
    <p>A round is 50 seconds of battle time, so "hold for 500 seconds" means 10 rounds.</p>
    <p><b>Up to four forces</b> can fight, each commanded by a player or the computer. In team games (any mission, or Search &amp; Destroy with Teams on) forces on the same team share an edge of the map, can't shoot each other and win together. Each force still takes its own turns. Search &amp; Destroy can also be a free-for-all.</p>` },
  { k: 'move', t: 'Moving', body: `
    <p>Choose <b>walk</b>, <b>run</b> or <b>jump</b>. Reachable hexes light up (blue, orange, purple). Pick a hex, then pick which way to face.</p>
    <p>Terrain costs movement points: clear 1, light woods 2, heavy woods 3, rough 2, water 2–4, plus 1 per level climbed. Turning on the spot costs 1 per hex-side.</p>
    <p><b>Moving protects you.</b> Enemies get +1 to hit you if you moved 3–4 hexes, +2 for 5–6, +3 for 7–9, +4 for 10 or more, and +1 more if you jumped.</p>
    <p>But it also spoils <b>your</b> aim this turn: +1 walking, +2 running, +3 jumping. Standing still is the most accurate.</p>
    <p><b>Facing matters.</b> Most weapons only fire into your front 120°. Your rear armour is thin, so don't turn your back on enemies.</p>` },
  { k: 'attack', t: 'Attacking', body: `
    <p>After moving, pick a target and tick the weapons to fire. Each weapon shows its <b>hit chance</b>.</p>
    <p>A shot hits when two dice beat the <b>target number</b>. It starts at your pilot's gunnery (4) and goes up for range, movement, cover and heat. Need 7 or more? That's about 58%. Need 10? Only 17%.</p>
    <p>Weapons have short, medium and long range bands (+0, +2, +4). Some (LRMs, Plasma, AC/2, AC/5) are bad at very close range.</p>
    <p>Lines of sight are blocked by higher hills, or by three points of woods in between.</p>
    <p>Next to an enemy you can <b>punch</b> or <b>kick</b> instead. Kicks hit hard and can knock the target over, but a missed kick may topple you.</p>
    <p><b>Death from above</b>: jump next to an enemy, then press Melee to come down on top of it. It does three times a punch's damage to the upper body and can knock the target over, but your own legs take a kick's worth of damage, and if you miss you crash to the ground hard. You can't land on a mech standing on higher ground.</p>
    <p><b>Exploding mechs</b>: when an engine is destroyed, the reactor can lose containment (10+ on two dice) and blow apart, hitting everything within 2 hexes (half damage at 2) — engine rating ÷ 10, up to 40. A mech torn apart by its own ammo sprays its neighbours too. Blasts can knock mechs over, set woods alight and flatten structures; chain reactions happen.</p>` },
  { k: 'heat', t: 'Heat', body: `
    <p>Every mech has a heat scale. Moving and firing add heat; heat sinks remove it at the end of each activation.</p>
    <ul class="mods-list"><li><span class="mv">5+</span> lose movement</li><li><span class="mv">8+</span> aiming penalty</li><li><span class="mv">14+</span> chance to shut down and lose a turn</li><li><span class="mv">19+</span> chance your ammo explodes</li><li><span class="mv">30</span> automatic shutdown</li></ul>
    <p>The attack panel shows your heat after this turn before you fire. Standing in water helps cool off.</p>` },
  { k: 'damage', t: 'Damage', body: `
    <p>Hits land on a random location, weighted by which side you are shooting from. Damage strips <b>armour</b> first, then the <b>internal structure</b>.</p>
    <p>Once structure is hit, <b>critical hits</b> can knock out weapons, ammo (which may explode), heat sinks, jump jets, the engine, gyro, sensors or cockpit.</p>
    <p>Lose an arm and its weapons go with it. Lose a leg and you fall and crawl. Lose the head or center torso and the mech is destroyed. Taking 20+ damage in one volley can knock a mech over.</p>
    <p>Pilots can be injured and knocked out; six injuries are fatal.</p>` },
  { k: 'lab', t: 'Mech Lab', body: `
    <p>Design your own mechs from the title screen (<b>Mech Lab</b>) or the <b>★ Custom</b> tab in the Mech Bay. You can also press <b>Customise</b> on any original design to start from it.</p>
    <p>Every part has weight: structure (10% of tonnage), the engine (tonnage × walking speed — fast heavy mechs need huge engines), gyro, cockpit, extra heat sinks, jump jets, armour (16 points per ton), weapons and ammo. The total can't go over the chassis tonnage.</p>
    <p>Each body location also has limited <b>critical slots</b>. The slot map under the model shows what's where; a weapon that doesn't fit has to move.</p>
    <p>Designs are saved on this device. They work in skirmish, hotseat and online games: the host rebuilds every custom mech with the same rules, so designs can't be tampered with.</p>` },
  { k: 'online', t: 'Playing online', body: `
    <p><b>Host Online</b> (title screen) works on every version, including the web page. You get a five-letter code and an invite link; friends choose <b>Join Game</b> and enter the code, or just open the link. It works over the internet and on the same Wi-Fi, and every platform can join.</p>
    <p>The game runs on the host's device, so the host must keep MechForce open (on a phone, keep the screen on). Players who drop out reconnect into the same seat.</p>
    <p>If someone can't connect, one of the networks is probably blocking direct connections. Add a TURN relay under <b>Settings → Online play</b>, or use a LAN or dedicated server instead.</p>
    <p><b>Host LAN Server</b> (Windows and Steam Deck apps) runs a server on your home network that other apps find automatically.</p>` },
  { k: 'chassis', t: 'Legs & tracks', body: `
    <p>Most mechs walk on two legs, but BattleTech also has other chassis, and MechForce plays them by the board game's rules.</p>
    <p><b>Four-legged mechs</b> (Goliath, Scorpion, Barghest…) have no arms: no punching, and all their weapons fire forwards. Four legs make them steady (-2 to piloting rolls while all legs work), and they can <b>side-step</b> — move to the front-left or front-right hex without turning, for 1 extra MP (walking, also backwards). Losing one leg costs only 1 MP; with two gone they crawl at 1 MP. Hits that would strike an arm land on a front leg.</p>
    <p><b>Tripods</b> (Triskelion, Poseidon, Ares) have arms and three legs: -1 to piloting rolls, and leg hits can land on the centre leg. One lost leg drops them to 1 MP.</p>
    <p><b>Tracks</b> (Brahma, or any design in the Mech Lab): pick <b>Tracks</b> as the movement mode to kneel and roll at walking speed. On tracks the mech ignores leg and gyro damage when keeping its balance, but can't enter heavy woods or water, climbs one level at a time and pays double to climb.</p>
    <p><b>QuadVees</b> (Arion, Cyllaros, Boreas, Harpagos) are Clan four-legged mechs that fold into tanks. Press <b>Convert</b> while moving: it costs 2 MP and happens at the end of the move. In vehicle mode they <b>cruise</b> or <b>flank</b> with no movement heat, can't fall over and can drive through water, but can't jump, kick or side-step. Each lost leg or track takes a quarter of their tank speed.</p>` },
  { k: 'fog', t: 'Fog of war', body: `
    <p>Turn on <b>Fog of war</b> in the battle setup and you only see enemy mechs that at least one of your mechs can see: a clear line of sight (hills block it, and three hexes' worth of woods), or standing right next to it. Enemies out of sight move unseen.</p>
    <p>A faded marker with a <b>?</b> shows where you last saw each enemy and which way it was facing. They won't be there for long.</p>
    <p>Firing gives a mech away: whoever it shot at can see it for the rest of the round. Wrecks stay visible.</p>
    <p>The computer plays by the same rules. Online, each player's device is only sent what their side can see; in hotseat games the view switches with each player's turn. When the battle ends, everything is revealed.</p>` },
  { k: 'pilots', t: 'MechWarriors', body: `
    <p>In the <b>Barracks</b> (main menu) you recruit MechWarriors who stay with you from battle to battle. The <b>character generator</b> sets their look, name, callsign and <b>background</b> — military academy, noble heir, mercenary, Clan warrior, pirate, militia, farmworld jockey or arena gladiator — which decides their starting gunnery and piloting and their first special ability.</p>
    <p>In the battle setup, <b>Assign pilots</b> puts them in your mechs (fit pilots are filled in for you). Mechs without one get an unsaved rookie (gunnery 4, piloting 5).</p>
    <p><b>Experience</b>: 1 for taking part, 1 for surviving, 2 for a win, 2 per kill, 1 per 25 damage (up to 4), 2 for carrying the objective out. Spend it in the Barracks on better gunnery or piloting, or on up to three <b>special abilities</b> (Sniper, Jumping Jack, Melee Specialist, Hot Dog, Iron Man, Maneuvering Ace, Tactical Genius, Cluster Hitter, and weapon specialists).</p>
    <p><b>Wounds and death</b>: a wounded pilot sits out a battle for every two hits; one who ejected sits out at least one. Pilots die only when the head or cockpit is destroyed, they take six hits, or they're still aboard when the reactor goes. Dead pilots stay on the memorial.</p>
    <p><b>Ejecting</b>: when a mech is destroyed the pilot ejects automatically (a piloting roll; a bad landing is a wound). An unconscious pilot can't, unless an ammo explosion fires the automatic ejection system. You can also eject on purpose from the menu (P) during a mech's turn.</p>
    <p><b>Self-destruct</b> (menu, during a mech's turn): override the reactor safeties (works on 5+) and eject — the mech explodes like a reactor breach, hurting everything within two hexes, friends included. The computer does this too when a crippled mech is surrounded.</p>` },
  { k: 'structures', t: 'Defences & buildings', body: `
    <p><b>Gun emplacements</b> and <b>bunkers</b> belong to a side and fire on their own at the end of every round, at the best target in range and sight (gunnery 4, and they never move: +0 for movement). An emplacement mounts one weapon and turns to face anything; a bunker is hardened (it takes half damage) and mounts two. They run out of ammunition like mechs do.</p>
    <p><b>Buildings</b> and <b>walls</b> are unarmed cover: they block movement and sight like a hill of their height. Buildings can burn.</p>
    <p>You can shoot any of them: select it as a target in attack mode. It's immobile (-4 to hit). When its <b>construction factor</b> reaches 0 it collapses into rubble. Turn on <b>Defences</b> in the battle setup to fortify a random map, or place your own in the <b>Map editor</b>.</p>` },
  { k: 'terrain', t: 'Fire, smoke & climate', body: `
    <p><b>Fire.</b> Flamers set woods alight easily, plasma weapons sometimes, and a stray laser or an exploding mech can too. Fires spread downwind at the end of each round, burn heavy woods down to light woods and then to rough ground, and set buildings ablaze. Standing in a burning hex adds <b>+5 heat</b>.</p>
    <p><b>Smoke</b> drifts from fires and blocks sight like woods: +1 or +2 to hit through it.</p>
    <p><b>Water</b> cools a mech that stands in it (more when deeper), but stepping into it needs a piloting roll. On volcanic worlds the lakes are <b>magma</b>: +5 heat on the crust, +10 and leg damage in liquid magma, and no cooling.</p>
    <p><b>Climate</b> changes heat every turn: desert +1, volcanic +2, arctic −1.</p>` },
  { k: 'controls', t: 'Controls', body: `
    <table class="tt"><tr><td>Move cursor</td><td>Left stick / d-pad · WASD / arrows · mouse · tap</td></tr>
    <tr><td>Confirm</td><td>A / ✕ · Enter · click · tap again</td></tr>
    <tr><td>Back</td><td>B / ○ · Esc · right-click</td></tr>
    <tr><td>Walk / run / jump · Melee</td><td>Y / △ · R</td></tr>
    <tr><td>Stay & turn · Fire</td><td>X / □ · F</td></tr>
    <tr><td>Next mech / target</td><td>LB RB · Tab</td></tr>
    <tr><td>End this mech's turn</td><td>View · T</td></tr>
    <tr><td>Rotate / tilt camera</td><td>Right stick · Q/E · right- or middle-drag · two-finger twist · ⟲ ⟳ buttons</td></tr><tr><td>Zoom</td><td>Triggers · + / − · mouse wheel · pinch · − + buttons</td></tr><tr><td>Centre on your mech</td><td>Click right stick · C · ◎ button</td></tr>
    <tr><td>Field manual</td><td>Menu → How to play · H · the ? button</td></tr></table>` },
];

export { chance };

export function structTip(S) {
  const K = STRUCTS[S.kind];
  const guns = S.load && S.load.length ? S.load.map((l) => LOADOUTS[l] ? LOADOUTS[l].name : l).join(' and ') : '';
  return `<p>${esc(K.name)}${guns ? ' armed with ' + esc(guns) + '. It fires at the end of every round at the best enemy it can see.' : '. Unarmed cover that blocks movement and sight.'}</p>`
    + `<p>Construction factor ${S.cf} of ${S.cfMax}.${S.hard ? ' Hardened: takes half damage.' : ''}${K.burns ? ' Can catch fire.' : ''} Immobile: -4 to hit.</p>`;
}
