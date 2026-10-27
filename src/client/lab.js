// Mech Lab: design custom mechs. Saved designs live in this device's storage and travel
// with your lance when you play; the host re-checks them against the same rules.
import { WEAPONS, CLASS_NAMES, critName } from '../core/data.js';
import { buildTemplate, defaultSpec, distributeArmor, maxArmorPoints, maxWalk, TONNAGES, LOCS, LOC_SHORT, WSTAT, usesAmmo, SLOT_CAP, engineTons, jetTons } from '../core/custom.js';
import { $, $$, html, esc, toast, paperDoll } from './ui.js';
import { attr as tipAttr, weaponBlurb } from './tips.js';
import { sfx } from './audio.js';
import { ICON } from './icons.js';
import { MechPreview } from './preview.js';

const KEY = 'mechforce.custom';
export function loadDesigns() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
export function saveDesigns(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function designStatus(spec) { const b = buildTemplate(spec); return { ok: b.ok, b }; }

const BUDGET_LABEL = { structure: 'Internal structure', engine: 'Engine', gyro: 'Gyro', cockpit: 'Cockpit', heatsinks: 'Extra heat sinks', jets: 'Jump jets', armor: 'Armour', weapons: 'Weapons', ammo: 'Ammunition' };
const BUDGET_TIP = {
  structure: 'The skeleton: always 10% of the mech\'s tonnage.',
  engine: 'Engine size is tonnage × walking speed. Bigger engines get heavy fast — a fast heavy mech spends a lot on engine.',
  gyro: 'Keeps the mech upright. Scales with engine size.',
  cockpit: 'Always 3 tons.',
  heatsinks: 'The engine includes 10 heat sinks for free. Each extra one weighs 1 ton and takes a slot.',
  jets: 'Each jump jet adds 1 hex of jumping. Weight per jet depends on the mech\'s size.',
  armor: '16 armour points per ton.',
  weapons: 'Weight of all mounted weapons.',
  ammo: '1 ton per ammo bin. Each bin holds a set number of shots for that weapon.',
};

export function showLab(app, startSpec, { onExit, slotIndex } = {}) {
  let spec = JSON.parse(JSON.stringify(startSpec || defaultSpec(`Custom ${loadDesigns().length + 1}`)));
  let savedIndex = typeof slotIndex === 'number' ? slotIndex : -1;
  let dirty = false;
  let armorTotal = spec.armor.reduce((s, v) => s + v, 0);
  const color = '#d9a441';

  const change = (fn) => { fn(); dirty = true; render(); };
  const pickLoc = (t) => {
    const b = buildTemplate(spec);
    const prefs = WEAPONS[t].kind === 'm' ? [1, 3, 2, 4, 5] : [4, 5, 1, 3, 2, 0];
    for (const l of prefs) if (b.slotsFree[l] >= WSTAT[t].slots + (usesAmmo(t) ? 1 : 0)) return l;
    return prefs[0];
  };
  const SETTINGS = {
    tons: { label: 'Tonnage', tip: 'Heavier mechs carry more armour and weapons but need bigger, heavier engines to move fast.', fmt: () => `${spec.tons} t · ${CLASS_NAMES[spec.tons <= 35 ? 0 : spec.tons <= 55 ? 1 : spec.tons <= 75 ? 2 : 3]}`,
      step: (d) => { const i = TONNAGES.indexOf(spec.tons); spec.tons = TONNAGES[Math.max(0, Math.min(TONNAGES.length - 1, i + d))]; spec.walk = Math.min(spec.walk, maxWalk(spec.tons)); spec.jump = Math.min(spec.jump, spec.walk); armorTotal = Math.min(armorTotal, maxArmorPoints(spec.tons)); spec.armor = distributeArmor(spec.tons, armorTotal); } },
    walk: { label: 'Speed', tip: 'Movement points per turn. Engine rating = tonnage × walk (max 400).', fmt: () => `walk ${spec.walk} · run ${Math.ceil(spec.walk * 1.5)}`,
      step: (d) => { spec.walk = Math.max(1, Math.min(maxWalk(spec.tons), spec.walk + d)); spec.jump = Math.min(spec.jump, spec.walk); } },
    jump: { label: 'Jump jets', tip: 'Jump distance in hexes. Can\'t exceed walking speed. Jets go in the legs and torsos.', fmt: () => spec.jump ? `${spec.jump} · ${(spec.jump * jetTons(spec.tons)).toFixed(1)} t` : 'None',
      step: (d) => { spec.jump = Math.max(0, Math.min(spec.walk, spec.jump + d)); } },
    hs: { label: 'Heat sinks', tip: 'Heat removed each turn. 10 come free with the engine; extras weigh 1 ton and use a slot each.', fmt: () => `${spec.hs}${spec.hs > 10 ? ` (+${spec.hs - 10} t)` : ' (free)'}`,
      step: (d) => { spec.hs = Math.max(10, Math.min(40, spec.hs + d)); } },
    armor: { label: 'Armour', tip: 'Total armour points, spread automatically over the body (16 points per ton). Use Max armour to fill every location.', fmt: () => `${armorTotal} / ${maxArmorPoints(spec.tons)} pts`,
      step: (d) => { armorTotal = Math.max(0, Math.min(maxArmorPoints(spec.tons), armorTotal + d * 16)); spec.armor = distributeArmor(spec.tons, armorTotal); } },
  };

  const render = () => {
    const b = buildTemplate(spec);
    const tpl = b.template;
    const over = b.used > spec.tons;
    const status = b.ok ? `<span class="ok-chip">${ICON.check} Battle-ready</span>` : `<span class="bad-chip">Not battle-ready</span>`;
    const el = html(`<div class="screen lab">
      <div class="screen-head"><div><div class="eyebrow">Mech Lab</div><h2>${esc(b.spec.name)}</h2></div>${status}<div class="spacer"></div>
        <div class="budget-big ${over ? 'over' : ''}" ${tipAttr('Tonnage budget', '<p>Everything has weight. The bar below each setting shows where the tons go. You can\'t go over the chassis tonnage.</p>')}>
          <span class="num">${b.used.toFixed(1)}</span><span class="faint"> / ${spec.tons} t</span><div class="tbar"><s style="width:${Math.min(100, b.used / spec.tons * 100)}%"></s></div></div></div>
      <div class="screen-body lab-grid">
        <div class="panel scroll stack pad lab-left">
          <div class="field"><label for="dname">Design name</label><input id="dname" class="nav" data-key="name" maxlength="18" value="${esc(spec.name)}" autocomplete="off"></div>
          ${Object.entries(SETTINGS).map(([k, s]) => `<div class="btn nav" data-key="set-${k}" data-setting="${k}" ${tipAttr(s.label, s.tip)}>${esc(s.label)}<span class="val arrows">${esc(s.fmt())}</span></div>`).join('')}
          <div class="row-btns"><div class="btn nav" data-key="maxarmor">Max armour</div><div class="btn nav" data-key="stock">Start from stock</div></div>
          <div class="budget">${Object.entries(b.budget).map(([k, v]) => `<div ${tipAttr(BUDGET_LABEL[k], BUDGET_TIP[k])}><span>${BUDGET_LABEL[k]}</span><b class="num">${v.toFixed(1)}</b></div>`).join('')}
            <div class="tot"><span>Total</span><b class="num ${over ? 'bad' : ''}">${b.used.toFixed(1)} / ${spec.tons}</b></div></div>
        </div>
        <div class="panel lab-mid">
          <div class="viewer lab-viewer"><div class="vbtns"><button class="vb" data-v="walk">${ICON.walk} Walk</button>${spec.jump ? `<button class="vb" data-v="jump">${ICON.jump} Jump</button>` : ''}<button class="vb" data-v="fire">${ICON.target} Fire all</button></div></div>
          <div class="slots-map" ${tipAttr('Critical slots', '<p>Each body location has a limited number of slots. Fixed parts (cockpit, engine, gyro, actuators) take some; weapons, ammo, extra heat sinks and jump jets fill the rest.</p><p>Hits that get through the armour can strike any of these — a hit on an ammo bin can explode.</p>')}>
            ${[0, 4, 1, 2, 3, 5, 6, 7].map((l) => `<div class="loc"><b>${LOC_SHORT[l]}</b><div class="cells">${tpl.cr[l].slice(0, SLOT_CAP[l]).map((c) => `<i class="${cellClass(c)}" title="${esc(c < 0 ? 'Free' : critName(c))}"></i>`).join('')}</div><small>${b.slotsFree[l]} free</small></div>`).join('')}
          </div>
          <div class="msgs">${b.errors.map((e) => `<div class="err">${esc(e)}</div>`).join('')}${b.warnings.map((e) => `<div class="warn-m">${esc(e)}</div>`).join('')}</div>
        </div>
        <div class="panel scroll stack pad lab-right">
          <h3>Mounted weapons <span class="faint">(${spec.weapons.length}/16)</span></h3>
          <div class="mounted">${spec.weapons.map((w, i) => `<div class="mrow nav" data-key="mw${i}" data-mw="${i}" ${tipAttr(WEAPONS[w.t].name, `<p>${esc(weaponBlurb(w.t))}</p><p>${WSTAT[w.t].tons} t · ${WSTAT[w.t].slots} slot${WSTAT[w.t].slots > 1 ? 's' : ''} · ${WSTAT[w.t].heat} heat · damage ${WSTAT[w.t].dmg}${WEAPONS[w.t].n > 1 ? ' × ' + WEAPONS[w.t].n : ''} · range ${WSTAT[w.t].rng}</p><p>Left/right moves it to another location${usesAmmo(w.t) ? '; Y changes the tons of ammo' : ''}; X removes it.</p>`)}>
              <span class="wn"><b>${esc(WEAPONS[w.t].short)}</b><small>${WSTAT[w.t].tons} t${usesAmmo(w.t) ? ` + ${w.ammo} t ammo (${w.ammo * WSTAT[w.t].ammo} shots)` : ''}</small></span>
              <span class="locsel"><button data-act="locl" aria-label="Previous location">◀</button><span>${LOC_SHORT[w.loc]}</span><button data-act="locr" aria-label="Next location">▶</button></span>
              ${usesAmmo(w.t) ? `<button class="mini" data-act="ammo" aria-label="Ammo">+ammo</button>` : '<span></span>'}
              <button class="mini x" data-act="del" aria-label="Remove">✕</button></div>`).join('') || '<div class="faint">No weapons yet. Add some below.</div>'}</div>
          <h3>Add weapon</h3>
          <div class="addgrid">${WEAPONS.map((W, t) => `<div class="addw nav" data-key="add${t}" data-add="${t}" ${tipAttr(W.name, `<p>${esc(weaponBlurb(t))}</p><p>${WSTAT[t].tons} t · ${WSTAT[t].slots} slot${WSTAT[t].slots > 1 ? 's' : ''} · ${WSTAT[t].heat} heat · damage ${WSTAT[t].dmg}${W.n > 1 ? ' × ' + W.n : ''} · range ${WSTAT[t].minr ? WSTAT[t].minr + '–' : ''}${WSTAT[t].rng}${usesAmmo(t) ? ` · ${WSTAT[t].ammo} shots per ton` : ''}</p>`)}><b>${esc(W.short)}</b><small>${WSTAT[t].tons}t · ${WSTAT[t].slots}sl</small></div>`).join('')}</div>
        </div>
      </div>
      <div class="lab-actions"><div class="btn primary nav" data-key="save">${ICON.check} Save design</div><div class="btn nav" data-key="copy">Save as copy</div>${savedIndex >= 0 ? '<div class="btn nav" data-key="delete">Delete</div>' : ''}<div class="btn nav" data-key="exit">Done</div></div>
    </div>`);
    // name
    const nameIn = $('#dname', el);
    nameIn.addEventListener('input', () => { spec.name = nameIn.value; dirty = true; $('.screen-head h2', el).textContent = buildTemplate(spec).spec.name; });
    nameIn.addEventListener('click', () => nameIn.focus());
    $$('[data-setting]', el).forEach((bt) => bt.addEventListener('click', () => change(() => SETTINGS[bt.dataset.setting].step(1))));
    $('[data-key=maxarmor]', el).addEventListener('click', () => change(() => { armorTotal = maxArmorPoints(spec.tons); spec.armor = distributeArmor(spec.tons, armorTotal); }));
    $('[data-key=stock]', el).addEventListener('click', () => { onExit && onExit('stock', spec); });
    $$('.mrow', el).forEach((row) => {
      const i = +row.dataset.mw;
      row.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'locl' || act === 'locr') change(() => { spec.weapons[i].loc = (spec.weapons[i].loc + (act === 'locr' ? 1 : 7)) % 8; });
        else if (act === 'ammo') change(() => { spec.weapons[i].ammo = (spec.weapons[i].ammo + 1) % 5; });
        else if (act === 'del') change(() => { spec.weapons.splice(i, 1); });
      });
    });
    $$('.addw', el).forEach((a) => a.addEventListener('click', () => {
      if (spec.weapons.length >= 16) { toast('16 weapons is the limit.'); return; }
      const t = +a.dataset.add;
      change(() => { spec.weapons.push({ t, loc: pickLoc(t), ammo: usesAmmo(t) ? 1 : 0 }); });
      sfx('ui-ok');
    }));
    $('[data-key=save]', el).addEventListener('click', () => save(false));
    $('[data-key=copy]', el).addEventListener('click', () => save(true));
    const del = $('[data-key=delete]', el);
    if (del) del.addEventListener('click', () => {
      const list = loadDesigns(); list.splice(savedIndex, 1); saveDesigns(list); toast('Design deleted', true); onExit && onExit('done');
    });
    $('[data-key=exit]', el).addEventListener('click', () => exit());
    app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'left', label: 'Adjust' }, { a: 'x', label: 'Remove weapon' }, { a: 'y', label: 'Ammo' }, { a: 'menu', label: 'Save' }, { a: 'back', label: 'Done' }]);
    // 3D model
    if (!app.preview) app.preview = new MechPreview();
    app.preview.attach($('.lab-viewer', el));
    if (!app.preview.tpl || app.preview.lastSig !== JSON.stringify(b.spec)) { app.preview.show(tpl, color); app.preview.lastSig = JSON.stringify(b.spec); }
    $$('.vb', el).forEach((bt) => bt.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = bt.dataset.v; const pv = app.preview;
      if (v === 'fire') { pv.autoDemo = false; pv.weapons.forEach((w, k) => setTimeout(() => { pv.setHighlight(k); pv.fire(k, true); }, k * 170)); setTimeout(() => { pv.autoDemo = true; }, pv.weapons.length * 170 + 1500); } else pv.setMode(v);
    }));
  };

  const save = (asCopy) => {
    const b = buildTemplate(spec);
    const list = loadDesigns();
    const clean = { ...b.spec, armor: b.spec.armor };
    if (asCopy || savedIndex < 0) {
      if (asCopy) clean.name = (clean.name + ' II').slice(0, 18);
      list.push(clean); savedIndex = list.length - 1;
    } else list[savedIndex] = clean;
    spec = JSON.parse(JSON.stringify(clean));
    if (!saveDesigns(list)) { toast('This device would not let the game save. Check storage settings.'); return; }
    dirty = false;
    toast(b.ok ? `Saved “${clean.name}”. Find it under Custom in the Mech Bay.` : `Saved “${clean.name}” as a draft — fix the problems before using it in battle.`, true);
    sfx('ui-ok');
    render();
  };
  const exit = () => {
    if (dirty) { save(false); }
    onExit && onExit('done');
  };
  const act = (a) => {
    const cur = app.nav.cur;
    if ((a === 'left' || a === 'right') && cur) {
      const d = a === 'right' ? 1 : -1;
      if (cur.dataset.setting) { change(() => SETTINGS[cur.dataset.setting].step(d)); sfx('ui-move'); return true; }
      if (cur.dataset.mw !== undefined) { const i = +cur.dataset.mw; change(() => { spec.weapons[i].loc = (spec.weapons[i].loc + (d > 0 ? 1 : 7)) % 8; }); sfx('ui-move'); return true; }
    }
    if (a === 'x' && cur && cur.dataset.mw !== undefined) { const i = +cur.dataset.mw; change(() => spec.weapons.splice(i, 1)); sfx('ui-back'); return true; }
    if (a === 'y' && cur && cur.dataset.mw !== undefined) { const i = +cur.dataset.mw; if (usesAmmo(spec.weapons[i].t)) change(() => { spec.weapons[i].ammo = (spec.weapons[i].ammo + 1) % 5; }); return true; }
    if (a === 'menu') { save(false); return true; }
    if (a === 'confirm' && cur && cur.tagName === 'INPUT') { cur.focus(); return true; }
    return false;
  };
  app.nav.onChange = null;
  app.setScreen('lab', render, act, exit);
}

function cellClass(c) {
  if (c < 0) return 'free';
  if (c <= 16) return 'wpn';
  if (c <= 28) return 'ammo';
  if (c === 50 || c === 52) return 'jet';
  if (c === 51) return 'hs';
  return 'fixed';
}

export { engineTons };
