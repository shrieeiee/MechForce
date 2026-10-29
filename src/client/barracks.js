// Barracks: the player's MechWarriors. Recruit with the character generator, spend
// experience on skills and special abilities, read their service record.
import { ABILITIES, ABILITY_IDS, BACKGROUNDS, BACKGROUND_IDS, GUN_COST, PIL_COST, ABILITY_COST, MAX_ABILITIES,
  RANKS, canImprove, improve, newPilot, randomName, randomPortrait } from '../core/pilots.js';
import { MISSIONS } from '../core/data.js';
import { $, $$, html, esc, toast } from './ui.js';
import { attr } from './tips.js';
import { sfx } from './audio.js';
import { portraitSVG, PORTRAIT_PARTS } from './portrait.js';
import { loadRoster, saveRoster, MAX_ROSTER } from './pilotstore.js';

const FATE = { ok: 'Unhurt', wounded: 'Wounded', ejected: 'Ejected', killed: 'Killed in action' };
export const skillTip = (what) => (what === 'gun'
  ? '<p><b>Gunnery</b> is the starting number for every weapon shot: lower is better. A regular MechWarrior has 4.</p>'
  : '<p><b>Piloting</b> is the starting number for punches, kicks, death from above, keeping your balance and ejecting: lower is better. A regular MechWarrior has 5.</p>');
export const abilityTip = (a) => `<p><b>${esc(ABILITIES[a].name)}</b>: ${esc(ABILITIES[a].text)}</p>`;
export const statusOf = (p) => (p.dead ? 'Killed in action' : p.rest > 0 ? `Recovering · ${p.rest} battle${p.rest > 1 ? 's' : ''}` : 'Fit for duty');

export function showBarracks(app, { onExit, select } = {}) {
  let roster = loadRoster();
  let cur = select || (roster.find((p) => !p.dead) || roster[0] || {}).id || null;
  const save = () => { if (!saveRoster(roster)) toast('Couldn\'t save — this device\'s storage is full or blocked'); };
  const byId = (id) => roster.find((p) => p.id === id);

  const render = () => {
    roster = loadRoster();
    const p = byId(cur);
    const alive = roster.filter((x) => !x.dead).length;
    const el = html(`<div class="screen barracks">
      <div class="screen-head"><div><div class="eyebrow">Barracks</div><h2>Your MechWarriors</h2></div><div class="spacer"></div>
        <div class="dim">${alive} / ${MAX_ROSTER} on the roster</div></div>
      <div class="screen-body bk-grid">
        <div class="panel scroll bk-list">
          <div class="btn primary nav" data-key="recruit">+ Recruit a MechWarrior</div>
          ${roster.map((x) => `<div class="bk-row nav ${x.id === cur ? 'on' : ''} ${x.dead ? 'kia' : ''}" data-key="p-${x.id}" data-id="${x.id}">
            ${portraitSVG(x.portrait, { size: 44, dead: x.dead })}
            <div><b>${esc(x.callsign)}</b> <span class="faint">${esc(RANKS(x))}</span><div class="dim sm">G${x.gun} / P${x.pil} · ${x.xp} XP${x.abilities.length ? ' · ' + x.abilities.map((a) => esc(ABILITIES[a].name)).join(', ') : ''}</div>
            <div class="sm ${x.dead ? 'bad-t' : x.rest > 0 ? 'warn' : 'ok-t'}">${statusOf(x)}</div></div></div>`).join('')}
          ${roster.length ? '' : '<p class="faint">No MechWarriors yet. Recruit one, then pick them for your lance in the battle setup. They earn experience in every battle — and can be hurt or killed.</p>'}
        </div>
        <div class="panel scroll bk-detail pad">${p ? detail(p) : '<p class="brief">Recruit MechWarriors to build a career: they gain experience from every battle, improve their gunnery and piloting, learn special abilities, and carry their wounds — and, rarely, their deaths — from battle to battle.</p>'}</div>
      </div></div>`);
    $('[data-key=recruit]', el).addEventListener('click', () => {
      if (roster.filter((x) => !x.dead).length >= MAX_ROSTER) { toast(`The barracks hold ${MAX_ROSTER} MechWarriors. Retire one first.`); return; }
      showGenerator(app, { onDone: (np) => { if (np) { roster = loadRoster(); roster.unshift(np); save(); cur = np.id; } showBarracks(app, { onExit, select: cur }); } });
    });
    $$('.bk-row', el).forEach((r) => r.addEventListener('click', () => { cur = r.dataset.id; sfx('ui-move'); render(); }));
    if (p) wire(el, p);
    app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }]);
    const sel = $(`[data-key="p-${cur}"]`, el);
    if (sel && !app.nav.cur) app.nav.set(sel, false);
  };
  const detail = (p) => {
    const B = BACKGROUNDS[p.bg] || BACKGROUNDS.academy;
    const g = canImprove(p, 'gun'), pl = canImprove(p, 'pil');
    const full = p.abilities.length >= MAX_ABILITIES;
    const log = (p.log || []).slice(0, 8).map((l) => `<tr><td>${esc(MISSIONS.find((m) => m.id === l.mission)?.name || '')}</td><td>${esc(l.mech)}</td><td>${l.won ? 'Won' : 'Lost'}</td><td class="num">${l.kills}</td><td class="num">${l.dmg}</td><td class="num">+${l.xp}</td><td>${esc(FATE[l.fate] || '')}</td></tr>`).join('');
    return `<div class="bk-top">${portraitSVG(p.portrait, { size: 132, dead: p.dead })}
      <div class="bk-id"><div class="eyebrow">${esc(RANKS(p))} · ${esc(B.name)}</div><h2>${esc(p.name.split(' ')[0])} “${esc(p.callsign)}” ${esc(p.name.split(' ').slice(1).join(' '))}</h2>
        <div class="${p.dead ? 'bad-t' : p.rest > 0 ? 'warn' : 'ok-t'}">${statusOf(p)}${p.dead && p.diedIn ? ' in a ' + esc(p.diedIn) : ''}</div>
        <p class="dim sm">${esc(B.text)}</p></div></div>
      <div class="bk-skills">
        <div class="stat" ${attr('Gunnery', skillTip('gun'))}><div class="k">Gunnery</div><div class="v">${p.gun}</div>
          ${p.dead ? '' : g.max ? '<div class="faint sm">Best possible</div>' : `<div class="btn sm nav ${g.ok ? '' : 'disabled'}" data-key="imp-gun">Improve to ${g.to} · ${g.cost} XP</div>`}</div>
        <div class="stat" ${attr('Piloting', skillTip('pil'))}><div class="k">Piloting</div><div class="v">${p.pil}</div>
          ${p.dead ? '' : pl.max ? '<div class="faint sm">Best possible</div>' : `<div class="btn sm nav ${pl.ok ? '' : 'disabled'}" data-key="imp-pil">Improve to ${pl.to} · ${pl.cost} XP</div>`}</div>
        <div class="stat" ${attr('Experience', '<p>Earned in battle: 1 for taking part, 1 for surviving, 2 for a victory, 2 per kill, 1 per 25 damage dealt (up to 4), 2 for carrying the objective out. Spend it to improve skills and learn abilities.</p>')}><div class="k">XP to spend</div><div class="v">${p.xp}</div><div class="faint sm">${p.xpTotal || 0} earned in all</div></div>
      </div>
      <div class="eyebrow">Special abilities · ${p.abilities.length}/${MAX_ABILITIES}</div>
      <div class="bk-abil">${p.abilities.map((a) => `<span class="chip on" ${attr(ABILITIES[a].name, abilityTip(a))}>${esc(ABILITIES[a].name)}</span>`).join('') || '<span class="faint">None yet</span>'}</div>
      ${p.dead || full ? '' : `<div class="eyebrow">Learn an ability · ${ABILITY_COST} XP</div><div class="bk-learn">${ABILITY_IDS.filter((a) => !p.abilities.includes(a)).map((a) => `<div class="btn sm nav ${p.xp >= ABILITY_COST ? '' : 'disabled'}" data-key="learn-${a}" ${attr(ABILITIES[a].name, abilityTip(a))}>${esc(ABILITIES[a].name)}</div>`).join('')}</div>`}
      <div class="eyebrow">Service record</div>
      <div class="bk-rec"><span><b>${p.battles || 0}</b> battles</span><span><b>${p.wins || 0}</b> victories</span><span><b>${p.kills || 0}</b> kills</span><span><b>${p.dmg || 0}</b> damage</span><span><b>${p.ejections || 0}</b> ejections</span></div>
      ${log ? `<div style="overflow-x:auto"><table class="results-table sm"><tr><th>Mission</th><th>Mech</th><th></th><th>Kills</th><th>Dmg</th><th>XP</th><th>Fate</th></tr>${log}</table></div>` : ''}
      <div class="row wrap bk-acts">${p.dead ? '' : '<div class="btn nav" data-key="look">Change look</div>'}<div class="btn nav" data-key="retire">${p.dead ? 'Remove from the memorial' : 'Retire'}</div></div>`;
  };
  let retireArm = null;
  const wire = (el, p) => {
    const imp = (what, label) => { const b = $(`[data-key=imp-${what}]`, el); if (b) b.addEventListener('click', () => { if (improve(p, what)) { save(); sfx('ui-ok'); toast(`${p.callsign}'s ${label} improves to ${p[what]}`, true); render(); } else { sfx('ui-err'); toast('Not enough experience yet'); } }); };
    imp('gun', 'gunnery'); imp('pil', 'piloting');
    $$('[data-key^=learn-]', el).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.key.slice(6);
      if (improve(p, a)) { save(); sfx('ui-ok'); toast(`${p.callsign} learns ${ABILITIES[a].name}`, true); render(); } else { sfx('ui-err'); toast('Not enough experience yet'); }
    }));
    const lk = $('[data-key=look]', el);
    if (lk) lk.addEventListener('click', () => showGenerator(app, { edit: p, onDone: (np) => { if (np) { Object.assign(p, { portrait: np.portrait, name: np.name, callsign: np.callsign }); save(); } showBarracks(app, { onExit, select: p.id }); } }));
    $('[data-key=retire]', el).addEventListener('click', () => {
      if (retireArm !== p.id) { retireArm = p.id; toast(p.dead ? 'Press again to remove them from the memorial' : `Press Retire again to send ${p.callsign} home for good`); return; }
      roster = roster.filter((x) => x.id !== p.id); save(); cur = (roster[0] || {}).id; retireArm = null; render();
    });
    // persist edits made by improve() on the shared object
    roster = roster.map((x) => (x.id === p.id ? p : x));
  };
  app.setScreen('barracks', render, null, () => onExit());
}

// ---- character generator
export function showGenerator(app, { onDone, edit } = {}) {
  const st = edit
    ? { bg: edit.bg, name: edit.name, callsign: edit.callsign, portrait: { ...randomPortrait(), ...edit.portrait } }
    : { bg: BACKGROUND_IDS[Math.floor(Math.random() * BACKGROUND_IDS.length)], ...randomName(), portrait: randomPortrait() };
  const partKeys = Object.keys(PORTRAIT_PARTS);
  const render = () => {
    const B = BACKGROUNDS[st.bg];
    const el = html(`<div class="screen gen">
      <div class="screen-head"><div><div class="eyebrow">${edit ? 'Change look' : 'Recruit a MechWarrior'}</div><h2>${esc(st.callsign || 'New recruit')}</h2></div><div class="spacer"></div>
        <div class="btn nav" data-key="cancel">Cancel</div><div class="btn primary nav" data-key="enlist">${edit ? 'Save' : 'Enlist'}</div></div>
      <div class="screen-body gen-grid">
        <div class="panel pad stack gen-look">
          <div class="gen-portrait">${portraitSVG(st.portrait, { size: 180 })}</div>
          <div class="btn nav" data-key="roll-look">Randomise face</div>
          <div class="gen-parts">${partKeys.map((k) => `<div class="btn sm nav part" data-key="part-${k}" data-part="${k}"><span class="arrows-l">‹</span>${esc(PORTRAIT_PARTS[k].name)} <span class="faint">${(st.portrait[k] % PORTRAIT_PARTS[k].n) + 1}/${PORTRAIT_PARTS[k].n}</span><span class="arrows-r">›</span></div>`).join('')}</div>
        </div>
        <div class="panel pad stack scroll gen-form">
          <div class="row wrap"><div class="field grow"><label for="gname">Name</label><input id="gname" class="nav" data-key="name" maxlength="28" value="${esc(st.name)}" autocomplete="off"></div>
            <div class="field"><label for="gcall">Callsign</label><input id="gcall" class="nav" data-key="call" maxlength="16" value="${esc(st.callsign)}" autocomplete="off"></div>
            <div class="btn nav" data-key="roll-name" title="New name">Roll name</div></div>
          ${edit ? '' : `<div class="eyebrow">Background</div>
          <div class="gen-bgs">${BACKGROUND_IDS.map((id) => { const b = BACKGROUNDS[id]; return `<div class="bg-card nav ${id === st.bg ? 'on' : ''}" data-key="bg-${id}" data-bg="${id}">
            <b>${esc(b.name)}</b><div class="num dim">Gunnery ${b.gun} · Piloting ${b.pil}${b.xp ? ` · ${b.xp} XP` : ''}</div>
            <div class="sm">${b.ability ? `<span class="chip on" ${attr(ABILITIES[b.ability].name, abilityTip(b.ability))}>${esc(ABILITIES[b.ability].name)}</span>` : '<span class="faint">No ability — better skills</span>'}</div></div>`; }).join('')}</div>
          <p class="brief">${esc(B.text)}</p>
          <p class="faint sm">Lower skill numbers are better. Experience from battles buys skill improvements (gunnery ${Object.entries(GUN_COST).map(([k, v]) => `→${k}: ${v}`).join(', ')} XP; piloting ${Object.entries(PIL_COST).map(([k, v]) => `→${k}: ${v}`).join(', ')} XP) and up to ${MAX_ABILITIES} special abilities at ${ABILITY_COST} XP each.</p>`}
        </div></div></div>`);
    const nm = $('#gname', el), cs = $('#gcall', el);
    nm.addEventListener('input', () => { st.name = nm.value; });
    cs.addEventListener('input', () => { st.callsign = cs.value; $('h2', el).textContent = st.callsign || 'New recruit'; });
    $('[data-key=roll-name]', el).addEventListener('click', () => { Object.assign(st, randomName()); sfx('ui-move'); render(); });
    $('[data-key=roll-look]', el).addEventListener('click', () => { st.portrait = randomPortrait(); sfx('ui-move'); render(); });
    $$('.part', el).forEach((b) => b.addEventListener('click', (e) => { const left = e.offsetX < b.offsetWidth * 0.3; cyclePart(b.dataset.part, left ? -1 : 1); }));
    $$('.bg-card', el).forEach((b) => b.addEventListener('click', () => { st.bg = b.dataset.bg; sfx('ui-move'); render(); }));
    $('[data-key=cancel]', el).addEventListener('click', () => onDone(null));
    $('[data-key=enlist]', el).addEventListener('click', enlist);
    app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'left', label: '‹ ›' }, { a: 'y', label: 'Random face' }, { a: 'x', label: edit ? 'Save' : 'Enlist' }, { a: 'back', label: 'Cancel' }]);
  };
  const cyclePart = (k, d) => {
    const n = PORTRAIT_PARTS[k].n;
    st.portrait[k] = ((st.portrait[k] || 0) + d + n) % n;
    sfx('ui-move');
    const key = app.nav.cur && app.nav.cur.dataset.key;
    render();
    if (key) { const b = $(`[data-key="${key}"]`, app.ui); if (b) app.nav.set(b, false); }
  };
  const enlist = () => {
    if (!String(st.callsign || '').trim()) { toast('Give them a callsign'); return; }
    sfx('ui-ok');
    if (edit) { onDone({ ...edit, name: st.name, callsign: st.callsign, portrait: st.portrait }); return; }
    const p = newPilot({ name: st.name, callsign: st.callsign, bg: st.bg, portrait: st.portrait });
    toast(`${p.callsign} joins your roster`, true);
    onDone(p);
  };
  const act = (a) => {
    const c = app.nav.cur;
    if ((a === 'left' || a === 'right') && c && c.dataset.part) { cyclePart(c.dataset.part, a === 'right' ? 1 : -1); return true; }
    if (a === 'y') { st.portrait = randomPortrait(); sfx('ui-move'); render(); return true; }
    if (a === 'x' || a === 'menu') { enlist(); return true; }
    return false;
  };
  app.setScreen('generator', render, act, () => onDone(null));
}
