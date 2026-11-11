// Move your stuff between devices: one backup file (or text code) holding pilots, saved maps,
// custom mechs, the mercenary company and settings. Importing merges: pilots by identity
// (the more experienced copy wins), maps and designs by name, and the company only if you
// say so — there's one company per device.
import { $, $$, html, esc, toast } from './ui.js';
import { sfx } from './audio.js';
import { loadRoster, saveRoster } from './pilotstore.js';
import { loadMaps, saveMap } from './mapstore.js';
import { loadDesigns, saveDesigns } from './lab.js';
import { loadCompany, saveCompany } from './campaign.js';
import { sanitizeMap } from '../core/maps.js';
import { saveFile, openFile, toCode, fromCode, copyText } from './files.js';
import { pasteDialog } from './replays.js';

const KINDS = [
  { k: 'pilots', label: 'MechWarriors', count: () => loadRoster().length },
  { k: 'maps', label: 'Saved maps', count: () => loadMaps().length },
  { k: 'designs', label: 'Custom mechs', count: () => loadDesigns().length },
  { k: 'company', label: 'Mercenary company', count: () => (loadCompany() ? 1 : 0) },
  { k: 'settings', label: 'Settings', count: () => 1 },
];

export function makeBackup(app, pick) {
  const b = { mf: 'backup', v: 1, at: Date.now() };
  if (pick.pilots) b.pilots = loadRoster();
  if (pick.maps) b.maps = loadMaps();
  if (pick.designs) b.designs = loadDesigns();
  if (pick.company) b.company = loadCompany();
  if (pick.settings) { const s = { ...app.settings }; delete s.lastServer; delete s.lastRoom; b.settings = s; }
  return b;
}

// merge a backup into this device; returns a summary line
export function importBackup(app, b, { replaceCompany = false } = {}) {
  if (!b || b.mf !== 'backup') throw new Error('That isn\'t a MechForce backup');
  const out = [];
  if (Array.isArray(b.pilots)) {
    const roster = loadRoster();
    let n = 0;
    for (const p of b.pilots) {
      if (!p || !p.id) continue;
      const i = roster.findIndex((q) => q.id === p.id);
      if (i < 0) { roster.push(p); n++; } else if ((p.xpTotal || 0) + (p.battles || 0) > (roster[i].xpTotal || 0) + (roster[i].battles || 0)) { roster[i] = p; n++; }
    }
    if (saveRoster(roster)) out.push(`${n} MechWarrior${n === 1 ? '' : 's'}`);
  }
  if (Array.isArray(b.maps)) {
    let n = 0;
    for (const m of b.maps.slice().reverse()) if (sanitizeMap(m) && saveMap(m)) n++;
    out.push(`${n} map${n === 1 ? '' : 's'}`);
  }
  if (Array.isArray(b.designs)) {
    const list = loadDesigns();
    let n = 0;
    for (const d of b.designs) {
      if (!d || !d.name) continue;
      const i = list.findIndex((x) => x.name === d.name);
      if (i < 0) list.push(d); else list[i] = d;
      n++;
    }
    if (saveDesigns(list)) out.push(`${n} custom mech${n === 1 ? '' : 's'}`);
  }
  if (b.company && b.company.v === 1) {
    if (!loadCompany() || replaceCompany) { if (saveCompany(b.company)) out.push('the company'); }
    else out.push('not the company (you already have one)');
  }
  if (b.settings && typeof b.settings === 'object') {
    const keep = { name: app.settings.name };
    Object.assign(app.settings, b.settings, keep);
    app.saveSettings();
    out.push('settings');
  }
  return out.length ? 'Imported ' + out.join(', ') : 'Nothing to import';
}

export function showTransfer(app, done) {
  const pick = { pilots: true, maps: true, designs: true, company: true, settings: false };
  const el = html(`<div class="panel pad stack modal xfer-dlg"><div class="eyebrow">Move to another device</div>
    <div class="faint">Save a backup on this device, then open it on the other one — or copy it as a text code and paste it there. Importing adds to what's already on the device.</div>
    <div class="stack xfer-kinds"></div>
    <div class="row wrap"><div class="btn primary nav" data-key="file">Save backup file</div><div class="btn nav" data-key="code">Copy as code</div></div>
    <div class="row wrap"><div class="btn nav" data-key="open">Open backup file…</div><div class="btn nav" data-key="paste">Paste code…</div><div class="btn nav" data-key="close">Close</div></div></div>`);
  const kinds = $('.xfer-kinds', el);
  const draw = () => {
    kinds.innerHTML = '';
    for (const K of KINDS) {
      const b = html(`<div class="btn nav" data-key="x-${K.k}">${esc(K.label)} <span class="dim">(${K.count()})</span><span class="val">${pick[K.k] ? '✔ Included' : 'Left out'}</span></div>`);
      b.addEventListener('click', () => { pick[K.k] = !pick[K.k]; sfx('ui-move'); draw(); });
      kinds.appendChild(b);
    }
  };
  const doImport = async (b) => {
    let replace = false;
    if (b && b.company && loadCompany()) replace = await confirmReplace(app);
    const msg = importBackup(app, b, { replaceCompany: replace });
    toast(msg, true); draw();
  };
  $('[data-key=file]', el).addEventListener('click', async () => {
    const res = await saveFile(`mechforce-backup-${new Date().toISOString().slice(0, 10)}.mechforce`, makeBackup(app, pick));
    toast(res === 'saved' ? 'Backup saved' : res === 'copied' ? 'This device can\'t save files — the backup was copied as a code instead' : 'Couldn\'t save the backup', res !== 'failed');
  });
  $('[data-key=code]', el).addEventListener('click', async () => { toast((await copyText(await toCode(makeBackup(app, pick)))) ? 'Backup code copied — paste it on the other device' : 'Couldn\'t copy', true); });
  $('[data-key=open]', el).addEventListener('click', async () => { try { const b = await openFile('.mechforce,.json'); if (b) await doImport(b); } catch (e) { toast(e.message); } });
  $('[data-key=paste]', el).addEventListener('click', () => { app.closeModal(); pasteDialog(app, 'Paste a backup code', async (code) => { await doImport(await fromCode(code)); }); });
  const close = () => { app.closeModal(); if (done) done(); };
  $('[data-key=close]', el).addEventListener('click', close);
  draw();
  app.openModal(el, { onBack: close, prompts: [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Close' }] });
}

function confirmReplace(app) {
  return new Promise((resolve) => {
    const prev = app.modal;
    const el = html(`<div class="panel pad stack modal"><div class="eyebrow">Mercenary company</div><p>This device already has a company. Replace it with the one in the backup?</p>
      <div class="row"><div class="btn nav" data-key="keep">Keep mine</div><div class="btn primary nav" data-key="replace">Replace it</div></div></div>`);
    const end = (v) => { app.closeModal(); resolve(v); };
    $('[data-key=keep]', el).addEventListener('click', () => end(false));
    $('[data-key=replace]', el).addEventListener('click', () => end(true));
    void prev;
    app.openModal(el, { onBack: () => end(false), prompts: [{ a: 'back', label: 'Keep mine' }] });
  });
}
void $$;
