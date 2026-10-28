// Map editor: paint terrain and height, place gun emplacements, bunkers, buildings and walls,
// and save battlefields on this device to play from the lobby. Mouse or touch to paint,
// or a controller: stick moves the cursor, A paints, Y changes what's painted, LB/RB the tool.
import { TERRAIN, STRUCTS, STRUCT_KINDS, LOADOUTS, LOADOUT_IDS, THEMES, MAP_SIZES, SIDE_COLORS, TEAM_ZONE_NAMES, CLIMATE } from '../core/data.js';
import { sanitizeMap, blankMap, mirrorHex, mirrorFacing, mirrorTeam, inDeployBand, MAX_ELEV, MAX_STRUCTS } from '../core/maps.js';
import { makeStructure } from '../core/rules.js';
import { generateMap } from '../core/map.js';
import { neighbor } from '../core/hex.js';
import { input } from './input.js';
import { $, $$, html, esc, toast, glyphHTML } from './ui.js';
import { attr, structTip } from './tips.js';
import { sfx, music } from './audio.js';
import { loadMaps, saveMap, deleteMap } from './mapstore.js';

const TOOLS = [
  { id: 'paint', name: 'Terrain', tip: '<p>Paint ground: clear, woods, rough or water. Water is always at ground level; deep water can\'t go in the deployment zones.</p>' },
  { id: 'height', name: 'Height', tip: '<p>Raise or lower the ground one level at a time (0–5), or flatten to the height of the first hex you touch. Each level is a hill mechs climb and hide behind.</p>' },
  { id: 'build', name: 'Build', tip: '<p>Place gun emplacements, bunkers, buildings and walls. Click a structure of the same kind to turn it. Not in the deployment zones at the edges.</p>' },
  { id: 'erase', name: 'Erase', tip: '<p>Remove structures.</p>' },
];
const HEIGHT_OPTS = [{ id: 'raise', name: 'Raise' }, { id: 'lower', name: 'Lower' }, { id: 'flatten', name: 'Flatten' }];
const OWNERS = [0, 1, 2, 3, -1];
const ownerName = (t) => (t < 0 ? 'Neutral' : TEAM_ZONE_NAMES[t]);
const ownerColor = (t) => (t < 0 ? '#9aa3ad' : SIDE_COLORS[t]);
const MIRRORS = [{ id: null, name: 'Off' }, { id: 'point', name: 'Rotate (fair 1v1)' }, { id: 'lr', name: 'Left ↔ right' }];
const ZONES = [{ n: 2, name: '2 sides' }, { n: 4, name: '4 sides' }, { n: 0, name: 'Hidden' }];
const FACE_ARROW = ['→', '↗', '↖', '←', '↙', '↘'];

export function showEditor(app, { map: startMap, onExit } = {}) {
  const r = app.renderer;
  app.stopAttract();
  app.endSession && app.endSession();
  music('menu');
  let map = startMap ? sanitizeMap(startMap) : null;
  if (!map) {
    // start from a random battlefield so there's something to shape
    const g = generateMap('ed' + Math.random().toString(36).slice(2, 7), 'M', 'temperate');
    map = sanitizeMap({ ...g, size: 'M', theme: 'temperate', name: 'New map', s: [] }) || blankMap('M');
  }
  const ed = {
    tool: 'paint', terrain: 1, height: 'raise', kind: 'turret', owner: 0, facing: 0,
    load: { turret: ['ac10'], bunker: ['ac20', 'mg'] }, brush: 1, mirror: null, zones: 2,
    cursor: { x: Math.floor(map.w / 2), y: Math.floor(map.h / 2) }, dirty: false, saved: true,
  };
  const undo = [];
  let stroke = null; // { touched:Set, flatten:level }
  let terrainDirty = false, lastRebuild = 0;
  let moveRepeat = 0, moveHeld = false;

  const idx = (x, y) => y * map.w + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h;
  const structAt = (x, y) => map.s.find((d) => d.x === x && d.y === y);
  const snapshot = () => { undo.push(JSON.stringify(map)); if (undo.length > 60) undo.shift(); };
  const changed = () => { ed.saved = false; };

  // ---- view
  const viewState = () => ({
    teams: [0, 1, 2, 3].map((t) => ({ color: SIDE_COLORS[t], name: TEAM_ZONE_NAMES[t] })),
    structures: map.s.map((d, i) => makeStructure(i, d, 4)),
  });
  const rebuildAll = () => {
    r.buildMap(map);
    r.syncMechs({ mechs: [], sides: [], teams: [] });
    syncStructs();
    r.setEnvironment({ map, fire: {}, smoke: {}, wind: 0 });
    overlay();
  };
  const syncStructs = () => {
    // models carry their weapons and colour, so rebuild them from scratch on every change
    if (r.structs) { for (const sv of r.structs.values()) r.structGroup.remove(sv.model.root); r.structs.clear(); }
    r.syncStructures(viewState());
  };
  const brushHexes = (x, y) => {
    const out = [{ x, y }];
    if (ed.brush >= 2) for (let f = 0; f < 6; f++) out.push(neighbor(x, y, f));
    if (ed.brush >= 3) { const ring = new Map(); for (const p of out.slice(1)) for (let f = 0; f < 6; f++) { const n = neighbor(p.x, p.y, f); ring.set(n.x + ',' + n.y, n); } for (const n of ring.values()) if (!out.some((o) => o.x === n.x && o.y === n.y)) out.push(n); }
    return out.filter((p) => inMap(p.x, p.y));
  };
  const withMirror = (cells) => {
    if (!ed.mirror) return cells;
    const out = cells.slice();
    for (const c of cells) { const m = mirrorHex(map, c.x, c.y, ed.mirror); if (!out.some((o) => o.x === m.x && o.y === m.y)) out.push({ ...m, mirrored: true }); }
    return out;
  };
  const overlay = () => {
    const cells = [];
    if (ed.zones) {
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (!inDeployBand(map, x, y)) continue;
        let z = -1;
        if (ed.zones === 2) z = x <= 1 ? 0 : x >= map.w - 2 ? 1 : -1;
        else z = x <= 1 && y > 1 && y < map.h - 2 ? 0 : x >= map.w - 2 && y > 1 && y < map.h - 2 ? 1 : y <= 1 && x > 2 && x < map.w - 3 ? 2 : y >= map.h - 2 && x > 2 && x < map.w - 3 ? 3 : -1;
        if (z >= 0) cells.push({ x, y, color: SIDE_COLORS[z] });
      }
    }
    const { x, y } = ed.cursor;
    const paintCells = ed.tool === 'build' ? withMirror([{ x, y }]) : withMirror(brushHexes(x, y));
    for (const c of paintCells) cells.push({ x: c.x, y: c.y, color: c.mirrored ? '#8fd3ff' : '#ffd166' });
    r.setReach(cells);
    r.setCursor(x, y, '#ffd166');
    renderInfo();
  };

  // ---- editing
  const applyAt = (x, y, first) => {
    if (!inMap(x, y)) return;
    if (first) { snapshot(); stroke = { touched: new Set(), flatten: map.t[idx(x, y)] >= 4 ? 0 : map.e[idx(x, y)] }; }
    if (ed.tool === 'build') { if (first) build(x, y); return; }
    let any = false;
    for (const c of withMirror(brushHexes(x, y))) {
      const k = idx(c.x, c.y);
      if (stroke.touched.has(k)) continue;
      stroke.touched.add(k);
      if (ed.tool === 'paint') {
        let t = ed.terrain;
        if (t === 5 && inDeployBand(map, c.x, c.y)) t = 4;
        if (map.t[k] !== t) { map.t[k] = t; any = true; }
        if (t >= 4) { if (map.e[k]) { map.e[k] = 0; any = true; } const si = map.s.findIndex((d) => d.x === c.x && d.y === c.y); if (si >= 0) { map.s.splice(si, 1); any = true; } }
      } else if (ed.tool === 'height') {
        if (map.t[k] >= 4) continue;
        const e = ed.height === 'raise' ? Math.min(MAX_ELEV, map.e[k] + 1) : ed.height === 'lower' ? Math.max(0, map.e[k] - 1) : stroke.flatten;
        if (e !== map.e[k]) { map.e[k] = e; any = true; }
      } else if (ed.tool === 'erase') {
        const si = map.s.findIndex((d) => d.x === c.x && d.y === c.y);
        if (si >= 0) { map.s.splice(si, 1); any = true; }
      }
    }
    if (any) {
      changed();
      if (ed.tool === 'erase') syncStructs(); else terrainDirty = true;
      sfx('ui-move');
    }
  };
  const build = (x, y) => {
    const K = STRUCTS[ed.kind];
    const ex = structAt(x, y);
    if (ex && ex.k === ed.kind) {
      // same kind: turn it, and its mirror twin
      ex.f = (ex.f + 1) % 6;
      if (ed.mirror) { const m = mirrorHex(map, x, y, ed.mirror); const tw = structAt(m.x, m.y); if (tw && tw !== ex && tw.k === ex.k) tw.f = mirrorFacing(ex.f, ed.mirror); }
      ed.facing = ex.f;
      changed(); syncStructs(); overlay(); sfx('ui-move');
      return;
    }
    const place = (px, py, f, team) => {
      if (inDeployBand(map, px, py)) return 'band';
      if (map.t[idx(px, py)] >= 4) return 'water';
      const old = map.s.findIndex((d) => d.x === px && d.y === py);
      if (old < 0 && map.s.length >= MAX_STRUCTS) return 'full';
      const d = { k: ed.kind, x: px, y: py, f, team: K.slots ? team : -1, load: K.slots ? (ed.load[ed.kind] || []).slice(0, K.slots) : [] };
      if (old >= 0) map.s[old] = d; else map.s.push(d);
      return null;
    };
    const err = place(x, y, ed.facing, ed.owner);
    if (err) { undo.pop(); toast(err === 'band' ? 'Mechs deploy here — build further in from the edge.' : err === 'water' ? 'Structures can\'t stand in water.' : `That's the most structures a map can hold (${MAX_STRUCTS}).`); sfx('ui-back'); return; }
    if (ed.mirror) { const m = mirrorHex(map, x, y, ed.mirror); if (m.x !== x || m.y !== y) place(m.x, m.y, mirrorFacing(ed.facing, ed.mirror), mirrorTeam(ed.owner, ed.mirror)); }
    changed(); syncStructs(); overlay(); sfx('ui-ok');
  };
  const endStroke = () => { stroke = null; };
  const doUndo = () => {
    if (!undo.length) { toast('Nothing to undo'); return; }
    const prev = JSON.parse(undo.pop());
    const sizeChanged = prev.w !== map.w || prev.theme !== map.theme;
    map = prev; changed();
    if (sizeChanged) rebuildAll(); else { r.updateTerrain(map); syncStructs(); overlay(); }
    sfx('ui-back');
  };

  // ---- options
  const cycleTool = (d) => { const i = TOOLS.findIndex((t) => t.id === ed.tool); ed.tool = TOOLS[(i + d + TOOLS.length) % TOOLS.length].id; sfx('ui-move'); render(); overlay(); };
  const cycleOption = (d = 1) => {
    if (ed.tool === 'paint') ed.terrain = (ed.terrain + d + TERRAIN.length) % TERRAIN.length;
    else if (ed.tool === 'height') { const i = HEIGHT_OPTS.findIndex((o) => o.id === ed.height); ed.height = HEIGHT_OPTS[(i + d + 3) % 3].id; }
    else if (ed.tool === 'build') { const i = STRUCT_KINDS.indexOf(ed.kind); ed.kind = STRUCT_KINDS[(i + d + STRUCT_KINDS.length) % STRUCT_KINDS.length]; }
    sfx('ui-move'); render();
  };
  const cycleOwner = () => { ed.owner = OWNERS[(OWNERS.indexOf(ed.owner) + 1) % OWNERS.length]; sfx('ui-move'); render(); };
  const cycleLoad = (slot) => {
    const L = ed.load[ed.kind];
    const cur = L[slot];
    const opts = slot > 0 ? [undefined, ...LOADOUT_IDS] : LOADOUT_IDS;
    const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    if (next === undefined) L.splice(slot, 1); else L[slot] = next;
    sfx('ui-move'); render();
  };
  const cycleBrushOrFacing = () => {
    if (ed.tool === 'build') ed.facing = (ed.facing + 1) % 6; else ed.brush = ed.brush % 3 + 1;
    sfx('ui-move'); render(); overlay();
  };
  const setSize = (id) => {
    if (id === map.size) return;
    snapshot();
    const old = map;
    const n = blankMap(id, old.theme, old.name);
    for (let y = 0; y < Math.min(n.h, old.h); y++) for (let x = 0; x < Math.min(n.w, old.w); x++) { n.t[y * n.w + x] = old.t[y * old.w + x]; n.e[y * n.w + x] = old.e[y * old.w + x]; }
    n.s = old.s.filter((d) => d.x < n.w - 2 && d.y < n.h - 2);
    map = sanitizeMap(n); changed();
    ed.cursor = { x: Math.min(ed.cursor.x, map.w - 1), y: Math.min(ed.cursor.y, map.h - 1) };
    rebuildAll(); render();
  };
  const setTheme = (id) => { snapshot(); map.theme = id; changed(); rebuildAll(); render(); };

  // ---- save / load / play
  const trySave = () => {
    const name = String(map.name || '').trim();
    if (!name) { toast('Give the map a name first'); return false; }
    const clean = sanitizeMap(map);
    if (!clean) { toast('This map couldn\'t be saved'); return false; }
    map.name = clean.name;
    if (!saveMap(clean)) { toast('Couldn\'t save — this device\'s storage is full or blocked'); return false; }
    ed.saved = true; toast(`Saved “${clean.name}”`, true); render();
    return true;
  };
  const loadDialog = () => {
    const list = loadMaps();
    const el = html(`<div class="panel pad stack modal ed-load"><div class="eyebrow">Saved maps</div>
      ${list.length ? '' : '<div class="faint">No saved maps on this device yet.</div>'}<div class="stack ed-list"></div>
      <div class="row"><div class="btn nav" data-key="new-random">New random map</div><div class="btn nav" data-key="new-blank">New blank map</div><div class="btn nav" data-key="close">Cancel</div></div></div>`);
    const lst = $('.ed-list', el);
    list.forEach((m, i) => {
      const row = html(`<div class="row ed-maprow"><div class="btn nav grow" data-key="load-${i}">${esc(m.name)}<span class="val">${esc(MAP_SIZES.find((z) => z.id === m.size).name)} · ${esc(THEMES.find((t) => t.id === m.theme).name)} · ${m.s.length} structures</span></div><div class="btn nav" data-key="del-${i}" title="Delete">Delete</div></div>`);
      $(`[data-key=load-${i}]`, row).addEventListener('click', () => { snapshot(); map = sanitizeMap(m); ed.saved = true; app.closeModal(); rebuildAll(); render(); });
      $(`[data-key=del-${i}]`, row).addEventListener('click', () => { if (confirmDelete(m.name)) { deleteMap(m.name); app.closeModal(); loadDialog(); } });
      lst.appendChild(row);
    });
    $('[data-key=new-random]', el).addEventListener('click', () => { snapshot(); const g = generateMap('ed' + Math.random().toString(36).slice(2, 7), map.size, map.theme); map = sanitizeMap({ ...g, size: map.size, theme: map.theme, name: 'New map', s: [] }); ed.saved = false; app.closeModal(); rebuildAll(); render(); });
    $('[data-key=new-blank]', el).addEventListener('click', () => { snapshot(); map = blankMap(map.size, map.theme, 'New map'); ed.saved = false; app.closeModal(); rebuildAll(); render(); });
    $('[data-key=close]', el).addEventListener('click', () => app.closeModal());
    app.openModal(el, { onBack: () => app.closeModal(), prompts: [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }] });
  };
  let delArm = null;
  const confirmDelete = (name) => { if (delArm === name) { delArm = null; return true; } delArm = name; toast(`Press Delete again to remove “${name}”`); return false; };
  const play = () => {
    if (!trySave()) return;
    const m = sanitizeMap(map);
    exit(() => app.startLocal('skirmish', { customMap: m }));
  };
  const exit = (then) => {
    app.setScreen('blank', () => {}, null, null);
    r.setReach([]); r.setCursor(null);
    (then || onExit)();
  };
  const leave = () => {
    if (!ed.saved && !leave.armed) { leave.armed = true; toast('Unsaved changes — press Back again to leave without saving'); setTimeout(() => { leave.armed = false; }, 3000); return; }
    exit();
  };
  const menu = () => {
    const el = html(`<div class="panel pad stack modal ed-menu"><div class="eyebrow">Map editor</div>
      <div class="field"><label for="mname">Map name</label><input id="mname" class="nav" data-key="name" maxlength="24" value="${esc(map.name)}" autocomplete="off"></div>
      <div class="stack opts"></div>
      <div class="row wrap"><div class="btn primary nav" data-key="play">Save & play</div><div class="btn nav" data-key="save">Save</div><div class="btn nav" data-key="load">Open / new…</div><div class="btn nav" data-key="resume">Back to editing</div><div class="btn nav" data-key="quit">Exit editor</div></div></div>`);
    const opts = $('.opts', el);
    const opt = (key, label, value, fn, tip) => { const b = html(`<div class="btn nav" data-key="${key}" ${tip ? attr(label, tip) : ''}>${esc(label)}<span class="val arrows">${esc(value)}</span></div>`); b.addEventListener('click', () => { fn(); app.closeModal(); menu(); }); opts.appendChild(b); };
    opt('o-size', 'Size', MAP_SIZES.find((z) => z.id === map.size).name, () => setSize(MAP_SIZES[(MAP_SIZES.findIndex((z) => z.id === map.size) + 1) % MAP_SIZES.length].id), '<p>Growing a map keeps what you built and adds empty ground; shrinking crops the right and bottom edges.</p>');
    opt('o-theme', 'World', THEMES.find((t) => t.id === map.theme).name, () => setTheme(THEMES[(THEMES.findIndex((t) => t.id === map.theme) + 1) % THEMES.length].id), `<p>${esc(CLIMATE[map.theme]?.text || '')}</p>`);
    opt('o-mirror', 'Mirror', MIRRORS.find((m) => m.id === ed.mirror).name, () => { ed.mirror = MIRRORS[(MIRRORS.findIndex((m) => m.id === ed.mirror) + 1) % MIRRORS.length].id; overlay(); render(); }, '<p>Paint both halves at once. <b>Rotate</b> spins every change half a turn about the centre — a perfectly fair map for West vs East, with structures handed to the other side.</p>');
    opt('o-zones', 'Deployment zones', ZONES.find((z) => z.n === ed.zones).name, () => { ed.zones = ZONES[(ZONES.findIndex((z) => z.n === ed.zones) + 1) % ZONES.length].n; overlay(); });
    if (ed.tool === 'build' && STRUCTS[ed.kind].slots) {
      opt('o-owner', 'Owner', ownerName(ed.owner), cycleOwner);
      for (let k = 0; k < STRUCTS[ed.kind].slots; k++) opt('o-load' + k, `Weapon ${k + 1}`, ed.load[ed.kind][k] ? LOADOUTS[ed.load[ed.kind][k]].name : 'None', () => cycleLoad(k));
    }
    const nameIn = $('#mname', el);
    nameIn.addEventListener('input', () => { map.name = nameIn.value; changed(); const n = root && $('.ed-name', root); if (n) n.textContent = map.name || 'Untitled'; });
    $('[data-key=play]', el).addEventListener('click', () => { app.closeModal(); play(); });
    $('[data-key=save]', el).addEventListener('click', () => { app.closeModal(); trySave(); });
    $('[data-key=load]', el).addEventListener('click', () => { app.closeModal(); loadDialog(); });
    $('[data-key=resume]', el).addEventListener('click', () => app.closeModal());
    $('[data-key=quit]', el).addEventListener('click', () => { app.closeModal(); leave(); });
    app.openModal(el, { onBack: () => app.closeModal(), prompts: [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }] });
  };

  // ---- panel
  let root = null;
  const optionLabel = () => (ed.tool === 'paint' ? TERRAIN[ed.terrain].name : ed.tool === 'height' ? HEIGHT_OPTS.find((o) => o.id === ed.height).name : ed.tool === 'build' ? STRUCTS[ed.kind].name : '');
  const render = () => {
    const K = STRUCTS[ed.kind];
    const el = html(`<div class="editor">
      <div class="panel ed-panel">
        <div class="ed-head"><div><div class="eyebrow">Map editor${ed.saved ? '' : ' · unsaved'}</div><b class="ed-name">${esc(map.name || 'Untitled')}</b></div></div>
        <div class="ed-tools">${TOOLS.map((t) => `<div class="btn sm ${t.id === ed.tool ? 'on' : ''}" data-tool="${t.id}" ${attr(t.name, t.tip)}>${esc(t.name)}</div>`).join('')}</div>
        <div class="ed-opts">
          ${ed.tool === 'paint' ? TERRAIN.map((t, i) => `<div class="btn sm swatch t${i} ${i === ed.terrain ? 'on' : ''}" data-terrain="${i}">${esc(map.theme === 'volcanic' && i >= 4 ? (i === 4 ? 'Magma crust' : 'Liquid magma') : t.name)}</div>`).join('') : ''}
          ${ed.tool === 'height' ? HEIGHT_OPTS.map((o) => `<div class="btn sm ${o.id === ed.height ? 'on' : ''}" data-height="${o.id}">${o.name}</div>`).join('') : ''}
          ${ed.tool === 'build' ? STRUCT_KINDS.map((k) => `<div class="btn sm ${k === ed.kind ? 'on' : ''}" data-kind="${k}" ${attr(STRUCTS[k].name, structTip({ kind: k, load: STRUCTS[k].slots ? ed.load[k] : [], cf: STRUCTS[k].cf, cfMax: STRUCTS[k].cf, hard: STRUCTS[k].hard }))}>${esc(STRUCTS[k].name)}</div>`).join('') : ''}
        </div>
        ${ed.tool === 'build' ? `<div class="ed-sub">
          ${K.slots ? `<div class="btn sm" data-act="owner" ${attr('Owner', '<p>Which deployment zone\'s side the emplacement fights for. In a 1-on-1 battle West and East are the two sides; North and South join in 3- and 4-sided battles. Neutral structures shoot at nobody.</p>')}><span class="dot" style="background:${ownerColor(ed.owner)}"></span>${esc(ownerName(ed.owner))}</div>` : ''}
          ${Array.from({ length: K.slots }, (_, k) => `<div class="btn sm" data-load="${k}">${esc(ed.load[ed.kind][k] ? LOADOUTS[ed.load[ed.kind][k]].name : '+ weapon')}</div>`).join('')}
          <div class="btn sm" data-act="face" ${attr('Facing', '<p>Which way new structures face. Gun emplacements turn to shoot anywhere; bunkers and walls look the same either way round.</p>')}>Facing ${FACE_ARROW[ed.facing]}</div></div>`
        : `<div class="ed-sub"><div class="btn sm" data-act="brush">Brush ${ed.brush === 1 ? '1 hex' : ed.brush === 2 ? '7 hexes' : '19 hexes'}</div></div>`}
        <div class="ed-sub"><div class="btn sm" data-act="mirror" ${attr('Mirror', '<p><b>Rotate</b> copies every change half a turn about the centre: a perfectly fair West-vs-East map. <b>Left ↔ right</b> copies across the middle.</p>')}>Mirror: ${esc(MIRRORS.find((m) => m.id === ed.mirror).name)}</div>
          <div class="btn sm" data-act="undo">Undo</div></div>
        <div class="ed-info faint"></div>
        <div class="ed-actions"><div class="btn sm primary" data-act="play">Save & play</div><div class="btn sm" data-act="save">Save</div><div class="btn sm" data-act="menu">Map…</div></div>
      </div></div>`);
    $$('[data-tool]', el).forEach((b) => b.addEventListener('click', () => { ed.tool = b.dataset.tool; render(); overlay(); }));
    $$('[data-terrain]', el).forEach((b) => b.addEventListener('click', () => { ed.terrain = +b.dataset.terrain; render(); }));
    $$('[data-height]', el).forEach((b) => b.addEventListener('click', () => { ed.height = b.dataset.height; render(); }));
    $$('[data-kind]', el).forEach((b) => b.addEventListener('click', () => { ed.kind = b.dataset.kind; render(); }));
    $$('[data-load]', el).forEach((b) => b.addEventListener('click', () => cycleLoad(+b.dataset.load)));
    const act = { owner: cycleOwner, face: cycleBrushOrFacing, brush: cycleBrushOrFacing, undo: doUndo, play, save: trySave, menu,
      mirror: () => { ed.mirror = MIRRORS[(MIRRORS.findIndex((m) => m.id === ed.mirror) + 1) % MIRRORS.length].id; render(); overlay(); } };
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => { sfx('ui-ok'); act[b.dataset.act](); }));
    root = el;
    app.mount(el, [
      { a: 'confirm', label: ed.tool === 'build' ? 'Place / turn' : 'Paint' }, { a: 'y', label: optionLabel() || 'Option' },
      { a: 'rb', label: 'Tool' }, { a: 'x', label: ed.tool === 'build' ? 'Facing' : 'Brush' }, { a: 'view', label: 'Undo' }, { a: 'menu', label: 'Map…' },
    ].filter((p) => p.label));
    renderInfo();
  };
  const renderInfo = () => {
    const box = root && $('.ed-info', root);
    if (!box) return;
    const { x, y } = ed.cursor;
    const k = idx(x, y);
    const t = map.t[k];
    const tn = map.theme === 'volcanic' && t >= 4 ? (t === 4 ? 'Magma crust' : 'Liquid magma') : TERRAIN[t].name;
    const S = structAt(x, y);
    const zone = inDeployBand(map, x, y) ? ' · deployment zone' : '';
    box.innerHTML = `Hex ${x},${y} · ${esc(tn)}${t < 4 ? ' · level ' + map.e[k] : ''}${zone}${S ? `<br>${esc(STRUCTS[S.k].name)} · ${esc(ownerName(S.team))}${S.load.length ? ' · ' + esc(S.load.map((l) => LOADOUTS[l].name).join(' + ')) : ''}` : ''}<br>${map.s.length}/${MAX_STRUCTS} structures`;
  };

  // ---- input
  const moveCursor = (dir) => {
    const f = r.screenDirToHex(...dir);
    const n = neighbor(ed.cursor.x, ed.cursor.y, f);
    if (!inMap(n.x, n.y)) return;
    ed.cursor = n; r.focusHex(n.x, n.y); overlay();
    if (stroke && ed.tool !== 'build') applyAt(n.x, n.y, false);
  };
  const onAction = (a) => {
    const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    if (dirs[a]) { moveCursor(dirs[a]); return true; }
    if (a === 'confirm') { applyAt(ed.cursor.x, ed.cursor.y, true); endStroke(); return true; }
    if (a === 'y') { cycleOption(1); return true; }
    if (a === 'rb') { cycleTool(1); return true; }
    if (a === 'lb') { cycleTool(-1); return true; }
    if (a === 'x') { cycleBrushOrFacing(); return true; }
    if (a === 'view') { doUndo(); return true; }
    if (a === 'menu') { menu(); return true; }
    if (a === 'camcentre') { r.focusHex(ed.cursor.x, ed.cursor.y); return true; }
    return false;
  };
  const pointer = (e, kind) => {
    const hit = r.pick(e.clientX, e.clientY);
    if (kind === 'up') { endStroke(); return; }
    if (!hit) return;
    if (hit.x !== ed.cursor.x || hit.y !== ed.cursor.y) { ed.cursor = { x: hit.x, y: hit.y }; overlay(); }
    if (kind === 'down') applyAt(hit.x, hit.y, true);
    else if (kind === 'move' && stroke && (e.buttons & 1) && ed.tool !== 'build') applyAt(hit.x, hit.y, false);
    else if (kind === 'click' && e.pointerType === 'touch') { applyAt(hit.x, hit.y, true); endStroke(); }
  };
  const tick = (dt, now) => {
    const mx = input.move.x, my = input.move.y;
    if (Math.hypot(mx, my) > 0.5 && !app.modal) {
      if (now >= moveRepeat) { moveCursor([mx, my]); moveRepeat = now + (moveHeld ? 110 : 260); moveHeld = true; }
    } else { moveHeld = false; moveRepeat = 0; }
    // rebuilding the terrain mesh is the slow part: at most ~8 times a second while painting
    if (terrainDirty && now - lastRebuild > 120) {
      terrainDirty = false; lastRebuild = now;
      r.updateTerrain(map); syncStructs(); overlay();
    }
  };

  rebuildAll();
  r.cam.wantDist = 26; r.cam.pitch = 0.95;
  app.setScreen('editor', render, onAction, leave, { pointer, tick });
  overlay();
}
