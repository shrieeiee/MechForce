// Tooltip engine + the plain-language explanations shown in tooltips and the field manual.
// Any element with data-tip (HTML) and optional data-tip-title gets a tooltip:
//   mouse: hover · controller/keyboard: when the element has focus · touch: long-press.
import { WEAPONS, TERRAIN } from '../core/data.js';
import { chance } from '../core/rng.js';
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
  'Piloting': 'Your pilot\'s piloting skill — the starting number for punches and kicks.',
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
  'Out of arc': 'This weapon can\'t point that way. Torso and head weapons fire into your front 120°; arm weapons also cover their own side. Turn to face the target next time.',
  'No line of sight': 'Hills or thick woods block the view. Move to higher ground or around the obstacle.',
  'No ammo': 'This weapon has fired all its ammunition.',
  'Destroyed': 'This weapon was knocked out by a critical hit.',
  'Not adjacent': 'You need to be in the hex next to the target.',
  'Elevation': 'The height difference is too big to reach.',
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
};
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

export function pilotTip(m) {
  return `<p>${esc(m.pilot.name)} has taken <b>${m.pilot.hits} of 6</b> injuries. Injuries come from head hits, falls, ammo explosions and overheating with damaged life support.</p><p>Each injury risks knocking the pilot unconscious (the mech stops until they wake). Six injuries kill the pilot.</p><p>Gunnery ${m.pilot.gun} (lower is better at shooting) · Piloting ${m.pilot.pil} (lower is better at staying upright and melee).</p>`;
}

export const ARMOR_TIP = '<p>Each block is one part of the mech; the number is its armour. Green is healthy, red is nearly stripped, dark red means armour is gone and the internal structure is exposed — hits there can cause critical damage.</p><p>The small row marked REAR is the back armour of the torso: much thinner, so shots from behind hurt more. Losing the head or center torso destroys the mech.</p>';

export const STATUS_TIP = {
  'Prone': 'Knocked down. Standing up costs 2 movement points. Easier to hit up close, harder from range.',
  'Shut down': 'The reactor overheated and shut down. The mech sits still this round while it cools and tries to restart.',
  'Pilot unconscious': 'The pilot is knocked out. The mech can\'t act until they wake up (rolled at the start of each round).',
  'Done this round': 'This mech has already acted this round.',
  'Destroyed': 'Out of the fight.',
  'Left battlefield': 'This mech has exited the map for the mission objective.',
  'Scouted': 'This mech has reached the enemy rear. Get it home off the west edge.',
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
    <p>A round is 50 seconds of battle time, so "hold for 500 seconds" means 10 rounds.</p>` },
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
    <p>Next to an enemy you can <b>punch</b> or <b>kick</b> instead. Kicks hit hard and can knock the target over, but a missed kick may topple you.</p>` },
  { k: 'heat', t: 'Heat', body: `
    <p>Every mech has a heat scale. Moving and firing add heat; heat sinks remove it at the end of each activation.</p>
    <ul class="mods-list"><li><span class="mv">5+</span> lose movement</li><li><span class="mv">8+</span> aiming penalty</li><li><span class="mv">14+</span> chance to shut down and lose a turn</li><li><span class="mv">19+</span> chance your ammo explodes</li><li><span class="mv">30</span> automatic shutdown</li></ul>
    <p>The attack panel shows your heat after this turn before you fire. Standing in water helps cool off.</p>` },
  { k: 'damage', t: 'Damage', body: `
    <p>Hits land on a random location, weighted by which side you are shooting from. Damage strips <b>armour</b> first, then the <b>internal structure</b>.</p>
    <p>Once structure is hit, <b>critical hits</b> can knock out weapons, ammo (which may explode), heat sinks, jump jets, the engine, gyro, sensors or cockpit.</p>
    <p>Lose an arm and its weapons go with it. Lose a leg and you fall and crawl. Lose the head or center torso and the mech is destroyed. Taking 20+ damage in one volley can knock a mech over.</p>
    <p>Pilots can be injured and knocked out; six injuries are fatal.</p>` },
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
