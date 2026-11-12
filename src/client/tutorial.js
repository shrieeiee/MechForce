// The tutorial: one short guided battle. A coach panel under the objective walks a new
// player through moving, firing, heat and finishing a damaged mech, advancing as they do
// each thing. The battle itself is an ordinary local game.
import { operational, dissipation, totalArmor, maxArmor, activeSide } from '../core/rules.js';
import { distance } from '../core/hex.js';
import { html, esc } from './ui.js';

export const TUTORIAL_SETUP = { mission: 'generic', mapSize: 'S', theme: 'temperate', seed: 'boot-camp-7', lanceSize: 1, sides: 2, aiLevel: 'easy',
  tonnage: 800, roundLimit: 'none', fog: false, forces: 'none', defences: 'none', teamMode: 'ffa', customMap: null };
export const TUTORIAL_MECH = 'Warhammer';
export const TUTORIAL_ENEMY = 'Shadow Hawk';
const STEPS = ['move', 'fire', 'heat', 'damage', 'finish'];
const TITLES = { move: 'Moving', fire: 'Opening fire', heat: 'Watch your heat', damage: 'Armour and angles', finish: 'Finish it off', done: 'Tutorial complete' };

export class Tutorial {
  constructor() { this.seen = { moved: false, fired: false, firedRound: 0, read: 0 }; this.hidden = false; }
  // called for every battle event as it is animated
  onEvent(e, st) {
    if (!st || e.id === undefined || !st.mechs[e.id] || st.mechs[e.id].side !== 0) return;
    if (e.k === 'move' && e.mode !== 'stand') this.seen.moved = true;
    if ((e.k === 'shot' || e.k === 'melee') && !this.seen.fired) { this.seen.fired = true; this.seen.firedRound = st.round; }
  }
  step(st) {
    const s = this.seen;
    if (st.over) return 'done';
    if (!s.moved) return 'move';
    if (!s.fired) return 'fire';
    if (st.round <= s.firedRound) return 'heat';
    if (st.round <= s.firedRound + 1) return 'damage';
    return 'finish';
  }
  body(st, bt) {
    const me = st.mechs.find((m) => m.side === 0), foe = st.mechs.find((m) => m.side === 1);
    const mode = bt.ix.mode, mine = activeSide(st) === 0;
    const wait = '<p class="faint">The enemy is taking its turn. Sides take turns moving one mech each until every mech has acted, then the round ends.</p>';
    const d = me && foe ? distance(me.x, me.y, foe.x, foe.y) : 0;
    switch (this.step(st)) {
      case 'move': return `<p>This is your <b>${esc(me.design)}</b>. Each round a mech <b>moves</b>, then <b>attacks</b>.</p>`
        + (!mine ? wait : mode === 'pick' ? '<p><b>Select your mech</b> to begin its turn.</p>'
          : mode === 'facing' ? '<p>Now choose which way to <b>face</b>. Weapons only fire into your front arc, and your rear armour is thin, so face the enemy.</p>'
          : '<p>The lit hexes are where it can go. <b>Pick a hex towards the enemy</b>. Use <b>Walk / run</b> to switch: running goes further but builds heat and spoils your aim. Woods and hills cost extra movement.</p>');
      case 'fire': return (!mine ? wait : mode === 'attack'
        ? `<p>The enemy ${esc(foe.design)} is <b>${d} hexes</b> away. Each weapon shows its <b>chance to hit</b>: range, your movement and the target's movement all count. Tick the weapons you want, then press <b>Fire</b>.</p><p class="faint">Nothing in range? Hold fire and close in next round.</p>`
        : '<p>Close the distance until your guns can reach. Your plasma cannons reach 18 hexes; lasers and short-range missiles need 9 or less. After you move and face, you choose a target.</p>');
      case 'heat': return `<p>Every weapon you fire makes <b>heat</b>. Your heat sinks remove <b>${dissipation(st, me)}</b> a round; the rest stays. Heat is now <b>${me.heat}</b>.</p>`
        + '<p>A hot mech aims worse and moves slower, and past 14 it may <b>shut down</b> or cook off its ammunition. Your two plasma cannons alone make 20. The Fire button shows the heat a volley will add: hold some weapons back when the bar turns red.</p>';
      case 'damage': {
        const pct = Math.round(100 * totalArmor(foe) / maxArmor(foe));
        return `<p>Hits land on a <b>location</b>: armour first, then the structure underneath, where <b>critical hits</b> wreck weapons, engines and gyros. Select the enemy to see where it's weak.</p><p>The ${esc(foe.design)} came into this fight damaged: it's at <b>${pct}%</b>. Shots into a mech's <b>back</b> hit much thinner armour, so try to get behind it and keep your own front towards it.</p>`;
      }
      case 'finish': return `<p>Now finish it. A mech dies when its <b>centre torso</b> or <b>head</b> is destroyed, or it loses both legs.</p>`
        + `<p>${d <= 1 ? 'You\'re next to it: press <b>Melee</b> to pick a <b>kick</b> or <b>punch</b> instead of shooting. Physical attacks make no heat.' : 'Keep firing, or walk up next to it and press <b>Melee</b> to kick: physical attacks make no heat, and a kick can knock it down.'}${foe.prone ? ' It\'s <b>down</b>: prone mechs are much easier to hit from close by.' : ''}</p>`;
      default: return `<p>${st.winner && st.winner.side === 0 ? 'Target destroyed. That\'s the whole loop: move, face, fire, mind your heat.' : 'That one got away from you. Run it again, or try a skirmish on Easy.'}</p><p class="faint">How to Play on the title screen covers everything else: missions, pilots, the Mech Lab and playing with friends.</p>`;
    }
  }
  panel(st, bt) {
    const step = this.step(st), n = STEPS.indexOf(step);
    if (this.hidden) {
      const tab = html('<div class="coach min panel btn sm">Tutorial ▸</div>');
      tab.addEventListener('click', () => { this.hidden = false; bt.render(); });
      return tab;
    }
    const el = html(`<div class="coach panel"><div class="eyebrow">Tutorial${n >= 0 ? ` · ${n + 1} of ${STEPS.length}` : ''}<span class="coach-x" title="Hide">×</span></div>
      <b>${TITLES[step]}</b>${this.body(st, bt)}
      <div class="coach-dots">${STEPS.map((k, i) => `<i class="${i < n || step === 'done' ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</div></div>`);
    el.querySelector('.coach-x').addEventListener('click', () => { this.hidden = true; bt.render(); });
    return el;
  }
}
export const tutorialOk = (st) => !!st && st.mechs.some((m) => m.side === 0 && operational(m));
