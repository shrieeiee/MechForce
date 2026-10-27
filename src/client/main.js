import css from './styles.css';
import fontDisplay600 from '@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2';
import fontDisplay700 from '@fontsource/chakra-petch/files/chakra-petch-latin-700-normal.woff2';
import fontBody500 from '@fontsource/rajdhani/files/rajdhani-latin-500-normal.woff2';
import fontBody600 from '@fontsource/rajdhani/files/rajdhani-latin-600-normal.woff2';
import fontBody700 from '@fontsource/rajdhani/files/rajdhani-latin-700-normal.woff2';
import { Renderer } from './renderer.js';
import { Battle } from './battle.js';
import { input, pollInput, glyph } from './input.js';
import { initAudio, sfx, music, audioSettings, applyVolumes } from './audio.js';
import { $, $$, html, esc, FocusNav, promptBar, toast, paperDoll, glyphHTML } from './ui.js';
import { initTips, tipSettings, hideTip, MANUAL, attr as tipAttr, weaponBlurb, ARMOR_TIP } from './tips.js';
import { MechPreview } from './preview.js';
import { ICON } from './icons.js';
import { LocalSession, RemoteSession, wsUrlFor } from './net.js';
import { native, isCapacitor, servedByHost, secureBrowser, platformName, canHost, canQuit, discover } from './platform.js';
import { MECHS, WEAPONS, MISSIONS, THEMES, MAP_SIZES, CLASS_NAMES, VERSION, mechBV } from '../core/data.js';
import { Room, lanceTons, autoLance } from '../core/room.js';
import { totalArmor, maxArmor } from '../core/rules.js';

// ------------------------------------------------------------------ boot
const style = document.createElement('style');
style.textContent = `
@font-face{font-family:'Chakra Petch';font-weight:600;font-display:swap;src:url(${fontDisplay600}) format('woff2')}
@font-face{font-family:'Chakra Petch';font-weight:700;font-display:swap;src:url(${fontDisplay700}) format('woff2')}
@font-face{font-family:'Rajdhani';font-weight:500;font-display:swap;src:url(${fontBody500}) format('woff2')}
@font-face{font-family:'Rajdhani';font-weight:600;font-display:swap;src:url(${fontBody600}) format('woff2')}
@font-face{font-family:'Rajdhani';font-weight:700;font-display:swap;src:url(${fontBody700}) format('woff2')}
` + css;
document.head.appendChild(style);

const DEFAULTS = { name: '', quality: isCapacitor ? 'medium' : 'high', speed: 1, camSpeed: 1, sfx: 0.8, music: 0.4, sound: 'modern', glyphs: 'auto', tips: true, lastServer: '', lastRoom: '', tonnage: 200 };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('mechforce.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}

class App {
  constructor() {
    document.body.insertAdjacentHTML('beforeend', '<canvas id="gl"></canvas><div id="labels"></div><div id="floats"></div><div id="ui"></div>');
    this.settings = loadSettings();
    if (!this.settings.name) this.settings.name = (platformName() === 'Steam Deck' ? 'Deck' : platformName()) + ' Pilot';
    this.ui = $('#ui');
    this.renderer = new Renderer($('#gl'), $('#labels'));
    this.applySettings();
    this.nav = new FocusNav();
    this.battle = new Battle(this);
    this.screen = null;
    this.session = null;
    this.lobby = null;
    this.modal = null;
    this.bindPointer();
    initTips();
    input.on((a) => this.onAction(a));
    window.addEventListener('mf-device', () => this.rerenderPrompts());
    window.addEventListener('pointerdown', () => initAudio(), { once: false });
    window.addEventListener('keydown', () => initAudio());
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      pollInput(now);
      if (Math.abs(input.move.x) + Math.abs(input.move.y) + Math.abs(input.cam.x) > 0.3) initAudio();
      if (this.screen === 'battle') this.battle.tick(dt, now);
      else if (this.screen === 'title') this.renderer.cam.yaw += dt * 0.04;
      this.renderer.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    if (servedByHost && location.port === '7373') this.autoJoinHost();
    else this.showTitle();
  }

  saveSettings() { try { localStorage.setItem('mechforce.settings', JSON.stringify(this.settings)); } catch {} this.applySettings(); }
  applySettings() {
    const s = this.settings;
    this.renderer.setQuality(s.quality);
    this.renderer.speed = s.speed;
    this.renderer.camSpeed = s.camSpeed;
    audioSettings.sfx = s.sfx; audioSettings.music = s.music; audioSettings.style = s.sound;
    input.forcedGlyphs = s.glyphs;
    tipSettings.on = s.tips !== false;
    document.documentElement.dataset.device = s.glyphs !== 'auto' ? s.glyphs : input.device;
    applyVolumes();
  }

  // ------------------------------------------------------------ input routing
  onAction(a) {
    initAudio();
    if (a === 'help') { if (this.modal && this.modal.manual) this.closeModal(); else this.showManual(); return; }
    if (a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right') hideTip();
    if (this.modal) return this.modalAction(a);
    if (this.screen === 'battle') { if (this.battle.onAction(a)) return; return; }
    if (this.screenAction && this.screenAction(a) === true) return;
    if (['up', 'down', 'left', 'right'].includes(a)) { this.nav.move(a); return; }
    if (a === 'confirm') { if (this.nav.activate()) sfx('ui-ok'); return; }
    if (a === 'back' && this.onBack) { sfx('ui-back'); this.onBack(); }
  }
  modalAction(a) {
    const m = this.modal;
    if (m.onTab && (a === 'lb' || a === 'rb' || a === 'left' || a === 'right')) { m.onTab(a === 'rb' || a === 'right' ? 1 : -1); return; }
    if (m.manual && (a === 'up' || a === 'down')) { const b = $('.man-body', m.el); if (b) b.scrollBy({ top: a === 'down' ? 120 : -120, behavior: 'smooth' }); return; }
    if (['up', 'down', 'left', 'right'].includes(a)) { m.nav.move(a); return; }
    if (a === 'confirm') { if (m.nav.activate()) sfx('ui-ok'); return; }
    if ((a === 'back' || (a === 'menu' && m.menuCloses)) && m.onBack) { sfx('ui-back'); m.onBack(); }
  }

  bindPointer() {
    const gl = $('#gl');
    let pinch = null;
    const touches = new Map();
    gl.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (!touches.has(e.pointerId)) return;
        const prev = touches.get(e.pointerId);
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (pinch) { this.renderer.cam.wantDist = Math.max(6, Math.min(34, this.renderer.cam.wantDist * pinch.d / d)); this.renderer.cam.wantYaw = null; this.renderer.cam.yaw -= (ang - pinch.ang); }
          pinch = { d, ang };
        } else if (touches.size === 1 && prev && this.dragging) {
          const c = this.renderer.cam;
          const k = c.dist / 600;
          const dx = (e.clientX - prev.x) * k, dy = (e.clientY - prev.y) * k;
          c.want.x -= dx * Math.cos(c.yaw) + dy * Math.sin(c.yaw);
          c.want.z -= -dx * Math.sin(c.yaw) + dy * Math.cos(c.yaw);
          this.dragMoved = (this.dragMoved || 0) + Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
        }
        return;
      }
      if (e.buttons & 2 && this.rDrag) { this.rDrag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); }
      if (e.buttons & 4 || e.buttons & 2 || (e.buttons & 1 && e.altKey)) { this.renderer.orbit(e.movementX, e.movementY); return; }
      if (this.screen === 'battle' && !this.modal) this.battle.pointer(e, 'move');
    });
    gl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.dragging = touches.size === 1; this.dragMoved = 0; if (touches.size === 2) pinch = null; return; }
      if (e.button === 2) { e.preventDefault(); this.rDrag = { moved: 0 }; gl.setPointerCapture(e.pointerId); }
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        const wasSingle = touches.size === 1;
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = null;
        if (wasSingle && (this.dragMoved || 0) < 12 && this.screen === 'battle' && !this.modal) this.battle.pointer(e, 'click');
        this.dragging = false;
        return;
      }
      if (e.button === 2 && this.rDrag) { const moved = this.rDrag.moved; this.rDrag = null; if (moved < 6) this.onAction('back'); return; }
      if (e.button === 0 && !e.altKey && this.screen === 'battle' && !this.modal) this.battle.pointer(e, 'click');
    };
    gl.addEventListener('pointerup', up);
    gl.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); pinch = null; });
    gl.addEventListener('contextmenu', (e) => e.preventDefault());
    gl.addEventListener('wheel', (e) => { input.zoom += Math.sign(e.deltaY) * 1.2; e.preventDefault(); }, { passive: false });
  }

  rerenderPrompts() {
    document.documentElement.dataset.device = this.settings.glyphs !== 'auto' ? this.settings.glyphs : input.device;
    // Only swap the prompt bars, and only after the current tap/click has finished.
    clearTimeout(this.promptTimer);
    this.promptTimer = setTimeout(() => {
      if (this.screen === 'battle' && !this.modal) { this.battle.renderPrompts(); return; }
      if (this.modal && this.modal.prompts) this.swapPrompts(this.modal.el, this.modal.prompts);
      else if (this.currentPrompts) this.swapPrompts(this.ui, this.currentPrompts);
    }, 400);
  }
  swapPrompts(container, list) {
    const old = [...container.children].find((c) => c.classList && c.classList.contains('prompts'));
    const bar = promptBar(list, (a) => this.onAction(a));
    if (old) old.replaceWith(bar); else container.appendChild(bar);
  }

  setScreen(name, render, onAction, onBack) {
    this.screen = name;
    this.renderScreen = render;
    this.screenAction = onAction;
    this.onBack = onBack;
    this.closeModal();
    render();
  }
  mount(el, prompts) {
    this.currentPrompts = prompts || null;
    this.ui.replaceChildren(el);
    if (prompts) this.ui.appendChild(promptBar(prompts, (a) => this.onAction(a)));
    this.nav.attach(el);
  }

  openModal(el, { onBack, menuCloses = true, prompts } = {}) {
    this.closeModal();
    const bg = html('<div class="modal-bg"></div>');
    bg.appendChild(el);
    if (prompts) bg.appendChild(promptBar(prompts, (a) => this.onAction(a)));
    this.ui.appendChild(bg);
    const nav = new FocusNav();
    nav.attach(el);
    this.modal = { el: bg, nav, onBack, menuCloses, prompts };
  }
  closeModal() { if (this.modal) { this.modal.el.remove(); const after = this.modal.after; this.modal = null; hideTip(); if (after) after(); } }

  // ---- field manual
  showManual(startKey) {
    let idx = Math.max(0, MANUAL.findIndex((m) => m.k === startKey));
    const el = html(`<div class="modal wide panel manual"><div class="eyebrow">${ICON.help} Field manual</div>
      <div class="tabs man-tabs"></div><div class="man-body scroll"></div></div>`);
    const paint = () => {
      $('.man-tabs', el).innerHTML = MANUAL.map((m, i) => `<div class="tab ${i === idx ? 'on' : ''}" data-i="${i}">${esc(m.t)}</div>`).join('');
      $$('.tab', el).forEach((t) => t.addEventListener('click', () => { idx = +t.dataset.i; paint(); }));
      $('.man-body', el).innerHTML = `<h2>${esc(MANUAL[idx].t)}</h2>${MANUAL[idx].body}`;
    };
    paint();
    this.openModal(el, { onBack: () => this.closeModal(), prompts: [{ a: 'rb', label: 'Next page' }, { a: 'lb', label: 'Previous' }, { a: 'back', label: 'Close' }] });
    this.modal.manual = true;
    this.modal.onTab = (d) => { idx = (idx + d + MANUAL.length) % MANUAL.length; paint(); sfx('ui-move'); };
  }

  // ------------------------------------------------------------ sessions
  endSession() {
    if (this.session) { this.session.close(); this.session = null; }
    if (this.hosting && native) { native.hostStop?.(); this.hosting = null; }
    this.battle.stop();
    this.lobby = null;
  }

  attachSession(sess) {
    this.session = sess;
    sess.on((msg) => this.onMsg(msg));
  }

  onMsg(msg) {
    switch (msg.t) {
      case 'welcome': this.isHost = msg.host; break;
      case 'lobby': {
        this.lobby = msg.lobby;
        this.isHost = msg.lobby.host === this.session.myId;
        if (this.screen === 'lobby') this.renderScreen();
        else if (!msg.lobby.inGame && this.screen !== 'bay' && this.screen !== 'battle') this.showLobby();
        break;
      }
      case 'start': this.stopAttract(); this.screen = 'battle'; this.closeModal(); this.renderScreen = null; this.screenAction = null; this.battle.start(msg.state); break;
      case 'update': if (this.screen === 'battle') this.battle.onUpdate(msg); break;
      case 'tolobby': this.closeModal(); this.battle.stop(); this.showLobby(); break;
      case 'error':
        if (msg.fatal) { toast(msg.msg); this.endSession(); this.showTitle(); }
        else if (this.screen === 'battle') this.battle.onError(msg.msg);
        else toast(msg.msg);
        break;
      case 'chat': if (this.screen === 'battle') this.battle.pushFeed(`${msg.from}: ${msg.text}`, 'chat'); break;
      case '_status':
        if (msg.status === 'reconnecting') toast('Connection lost — reconnecting…');
        if (msg.status === 'online' && this.wasOnline) toast('Reconnected', true);
        if (msg.status === 'online') this.wasOnline = true;
        break;
      default: break;
    }
  }

  startLocal(kind) {
    this.endSession();
    const sess = new LocalSession(this.settings.name, platformName());
    this.attachSession(sess);
    this.localKind = kind;
    sess.send({ t: 'settings', settings: { tonnage: this.settings.tonnage } });
    if (kind === 'hotseat') sess.send({ t: 'slot', side: 1, ctrl: 'me' });
    // give the player a sensible starter lance
    queueMicrotask(() => sess.send({ t: 'lance', side: 0, lance: autoLance(Math.random(), this.settings.tonnage, 4) }));
    if (kind === 'hotseat') queueMicrotask(() => sess.send({ t: 'lance', side: 1, lance: autoLance(Math.random(), this.settings.tonnage, 4) }));
  }

  async hostLan() {
    this.endSession();
    try {
      const res = await native.hostStart();
      this.hosting = res;
      const sess = new RemoteSession(`ws://127.0.0.1:${res.port}/ws`, { name: this.settings.name, platform: platformName(), create: true });
      this.attachSession(sess);
      this.localKind = 'host';
      this.wasOnline = false;
    } catch (e) { toast('Could not start hosting: ' + (e.message || e)); }
  }

  joinRemote(address, room, create = false) {
    const url = wsUrlFor(address);
    if (!url) { toast('Enter the host address shown on the host screen.'); return; }
    if (secureBrowser && url.startsWith('ws://')) { toast('This page is HTTPS, so it can only join secure (wss://) servers. Open the host\'s address in your browser instead.'); return; }
    this.endSession();
    this.settings.lastServer = address; this.settings.lastRoom = room || ''; this.saveSettings();
    const sess = new RemoteSession(url, { name: this.settings.name, platform: platformName(), room: room || undefined, create });
    this.attachSession(sess);
    this.localKind = 'remote';
    this.wasOnline = false;
    toast('Connecting to ' + address + '…', true);
  }

  autoJoinHost() {
    this.startAttract();
    this.joinRemote(location.host, new URLSearchParams(location.search).get('room') || '');
  }

  // ------------------------------------------------------------ attract mode
  startAttract() {
    if (this.attract) return;
    audioSettings.attract = true;
    const room = new Room({ code: 'DEMO', local: true, aiDelay: 350, send: (id, msg) => {
      if (this.attract !== room) return;
      if (msg.t === 'start') { this.renderer.buildMap(msg.state.map); this.renderer.syncMechs(msg.state); this.renderer.cam.wantDist = 24; this.renderer.cam.pitch = 0.7; }
      if (msg.t === 'update') {
        this.renderer.play(msg.events, msg.state);
        if (msg.state.over) setTimeout(() => { if (this.attract === room) { this.stopAttract(); this.startAttract(); } }, 3000);
      }
    } });
    this.attract = room;
    const id = room.join({ name: 'demo' });
    room.handle(id, { t: 'slot', side: 0, ctrl: 'ai' });
    const themes = THEMES.map((t) => t.id);
    room.handle(id, { t: 'settings', settings: { mission: 'generic', mapSize: 'S', theme: themes[Math.floor(Math.random() * themes.length)], tonnage: 240 } });
    room.handle(id, { t: 'start' });
  }
  stopAttract() { if (this.attract) { this.attract.dispose(); this.attract = null; audioSettings.attract = false; } }

  // ------------------------------------------------------------ screens
  showTitle() {
    this.endSession();
    this.startAttract();
    music('menu');
    const items = [
      { k: 'skirmish', label: 'Skirmish', hint: 'You vs the computer', fn: () => this.startLocal('skirmish') },
      canHost ? { k: 'host', label: 'Host LAN Game', hint: 'Crossplay on your network', fn: () => this.hostLan() } : null,
      { k: 'join', label: 'Join Game', hint: 'Find a host or enter an address', fn: () => this.showJoin() },
      { k: 'hotseat', label: 'Hotseat', hint: 'Pass the controller', fn: () => this.startLocal('hotseat') },
      { k: 'bay', label: 'Mech Bay', hint: `${MECHS.length} original designs`, fn: () => this.showBay(null) },
      { k: 'manual', label: 'How to Play', hint: 'Turns, aiming, heat, damage', fn: () => this.showManual() },
      { k: 'settings', label: 'Settings', hint: '', fn: () => this.showSettings(() => this.showTitle()) },
      canQuit ? { k: 'quit', label: 'Quit', hint: '', fn: () => native.quit() } : null,
    ].filter(Boolean);
    const render = () => {
      const el = html(`<div><div class="title-shade"></div><div class="title-wrap">
        <div class="logo">MechForce<span>Heavy Metal Combat</span></div>
        <div class="menu"></div></div>
        <div class="version">v${VERSION} · ${esc(platformName())}<br>After the 1989 Amiga original by Ralph H. Reed</div></div>`);
      const menu = $('.menu', el);
      for (const it of items) {
        const b = html(`<div class="btn nav" data-key="${it.k}">${esc(it.label)}<small>${esc(it.hint)}</small></div>`);
        b.addEventListener('click', () => { sfx('ui-ok'); it.fn(); });
        menu.appendChild(b);
      }
      this.mount(el, [{ a: 'confirm', label: 'Select' }]);
    };
    this.setScreen('title', render, null, null);
  }

  // ---- lobby
  showLobby() {
    this.stopAttract();
    if (!this.attractMapForLobby) { /* keep the last battlefield as a backdrop */ }
    music('menu');
    const render = () => this.renderLobby();
    this.setScreen('lobby', render, (a) => this.lobbyAction(a), () => this.leaveToTitle());
  }

  leaveToTitle() {
    const kind = this.localKind;
    this.endSession();
    this.showTitle();
    void kind;
  }

  lobbySettingDefs() {
    const L = this.lobby;
    const mis = MISSIONS.find((m) => m.id === L.settings.mission);
    const defs = [
      { k: 'mission', label: 'Mission', value: mis.name, opts: MISSIONS.map((m) => m.id) },
      { k: 'mapSize', label: 'Battlefield', value: MAP_SIZES.find((s) => s.id === L.settings.mapSize).name, opts: MAP_SIZES.map((s) => s.id) },
      { k: 'theme', label: 'Terrain', value: THEMES.find((t) => t.id === L.settings.theme).name, opts: THEMES.map((t) => t.id) },
      { k: 'tonnage', label: 'Tonnage limit', value: L.settings.tonnage + 't', opts: [100, 120, 140, 160, 180, 200, 240, 280, 320, 360, 400] },
      { k: 'lanceSize', label: 'Mechs per side', value: String(L.settings.lanceSize), opts: [1, 2, 3, 4] },
    ];
    if (mis.sides[1] > 2) defs.push({ k: 'sides', label: 'Sides', value: String(L.settings.sides), opts: [2, 3, 4] });
    return defs;
  }

  changeSetting(k, dir) {
    const def = this.lobbySettingDefs().find((d) => d.k === k);
    if (!def || !this.isHost) return;
    const cur = this.lobby.settings[k];
    const i = def.opts.indexOf(cur);
    const next = def.opts[(i + dir + def.opts.length) % def.opts.length];
    if (k === 'tonnage') { this.settings.tonnage = next; this.saveSettings(); }
    this.session.send({ t: 'settings', settings: { [k]: next } });
    sfx('ui-move');
  }

  lobbyAction(a) {
    const cur = this.nav.cur;
    if ((a === 'left' || a === 'right') && cur && cur.dataset.setting) { this.changeSetting(cur.dataset.setting, a === 'right' ? 1 : -1); return true; }
    if (a === 'x' && this.isHost) { this.session.send({ t: 'start' }); return true; }
    if (a === 'menu') { this.session.send({ t: 'start' }); return true; }
    return false;
  }

  renderLobby() {
    const L = this.lobby;
    if (!L) return;
    const me = this.session.myId;
    const mis = MISSIONS.find((m) => m.id === L.settings.mission);
    const remote = !this.session.local;
    const kindLabel = this.localKind === 'hotseat' ? 'Hotseat' : this.localKind === 'skirmish' ? 'Skirmish' : this.localKind === 'host' ? 'Hosting LAN game' : 'Online lobby';
    const addrs = this.hosting ? this.hosting.addresses : [];
    const el = html(`<div class="screen">
      <div class="screen-head"><div><div class="eyebrow">${esc(kindLabel)}</div><h2>${esc(mis.name)}</h2></div><div class="spacer"></div>
      ${remote ? `<div style="text-align:right"><div class="eyebrow">Room</div><div class="code-big">${esc(L.code)}</div></div>` : ''}</div>
      <div class="screen-body cols-2">
        <div class="stack scroll">
          <div class="stack settings"></div>
          <p class="brief">${esc(mis.goal[0])}${mis.goal[1] && mis.goal[1] !== mis.goal[0] ? ' <span class="faint">vs</span> ' + esc(mis.goal[1]) : ''}</p>
          ${this.hosting ? `<div class="panel pad stack"><div class="eyebrow">Players join from</div>
            <div style="font-size:15px">Steam Deck / PC / Android: <b>Join Game</b> finds this host automatically, or enter <b class="num">${esc(addrs[0]?.address || '?')}</b></div>
            <div style="font-size:15px">Any browser on this network: <b class="num">${addrs.map((a) => `http://${esc(a.address)}:${this.hosting.port}`).join('<br>')}</b></div></div>` : ''}
          ${remote && !this.hosting ? `<div class="faint" style="font-size:14px">${L.clients.filter((c) => c.connected).map((c) => `${esc(c.name)} (${esc(c.platform)})`).join(' · ')}</div>` : ''}
        </div>
        <div class="slots scroll"></div>
      </div></div>`);
    const settingsEl = $('.settings', el);
    for (const d of this.lobbySettingDefs()) {
      const b = html(`<div class="btn nav ${this.isHost ? '' : 'disabled'}" data-key="set-${d.k}" data-setting="${d.k}">${esc(d.label)}<span class="val ${this.isHost ? 'arrows' : ''}">${esc(d.value)}</span></div>`);
      b.addEventListener('click', () => this.changeSetting(d.k, 1));
      settingsEl.appendChild(b);
    }
    if (this.isHost) {
      const rr = html('<div class="btn nav" data-key="reroll">New map seed<span class="val num">' + esc(String(L.settings.seed).slice(0, 6)) + '</span></div>');
      rr.addEventListener('click', () => this.session.send({ t: 'settings', settings: { seed: Math.random().toString(36).slice(2, 10) } }));
      settingsEl.appendChild(rr);
    }
    const slotsEl = $('.slots', el);
    L.slots.forEach((sl, i) => {
      const mine = sl.ctrl === me;
      const who = sl.ctrl === 'ai' ? 'Computer' : sl.ctrl === 'open' ? 'Open' : mine ? 'You' : (L.clients.find((c) => c.id === sl.ctrl)?.name || 'Player');
      const tons = lanceTons(sl.lance);
      const card = html(`<div class="slot panel" style="--side:${sl.color}">
        <div class="slot-head"><span class="sw"></span><b>${esc(sl.name)}</b><span class="who">${esc(who)}</span></div>
        <div class="lance-list">${sl.lance.map((n) => { const m = MECHS.find((x) => x.n === n); return `<div><span>${esc(n)}</span><span class="num faint">${m ? m.t : '?'}t</span></div>`; }).join('') || '<div class="faint">No mechs selected</div>'}</div>
        <div class="tons-bar ${tons > L.settings.tonnage ? 'over' : ''}"><s style="width:${Math.min(100, tons / L.settings.tonnage * 100)}%"></s></div>
        <div class="dim num" style="font-size:14px">${tons} / ${L.settings.tonnage} tons${remote && sl.ctrl !== 'ai' && sl.ctrl !== 'open' ? ` · <span class="ready-chip ${sl.ready ? 'on' : 'off'}">${sl.ready ? 'Ready' : 'Not ready'}</span>` : ''}</div>
        <div class="stack acts"></div></div>`);
      const acts = $('.acts', card);
      const addBtn = (key, label, fn) => { const b = html(`<div class="btn nav" data-key="${key}">${esc(label)}</div>`); b.addEventListener('click', fn); acts.appendChild(b); };
      if (mine || (this.isHost && sl.ctrl === 'ai')) addBtn(`lance-${i}`, mine ? 'Choose mechs' : 'Choose computer mechs', () => this.showBay({ side: i, lance: sl.lance.slice(), limit: L.settings.tonnage, max: L.settings.lanceSize }));
      if (!mine && (sl.ctrl === 'open' || sl.ctrl === 'ai') && (remote || this.localKind === 'hotseat')) addBtn(`take-${i}`, 'Command this side', () => this.session.send({ t: 'slot', side: i, ctrl: 'me' }));
      if (this.isHost && sl.ctrl !== 'ai' && (remote || L.slots.filter((s) => s.ctrl === me).length > 1)) addBtn(`ai-${i}`, 'Hand to computer', () => this.session.send({ t: 'slot', side: i, ctrl: 'ai' }));
      if (this.isHost && remote && sl.ctrl === 'ai') addBtn(`open-${i}`, 'Open for a player', () => this.session.send({ t: 'slot', side: i, ctrl: 'open' }));
      if (mine && remote && !this.isHost) addBtn(`ready-${i}`, sl.ready ? 'Not ready' : 'Ready', () => this.session.send({ t: 'ready', side: i, v: !sl.ready }));
      slotsEl.appendChild(card);
    });
    const startBtn = this.isHost ? html(`<div class="btn primary nav" data-key="start">${glyphHTML('x')} Start battle</div>`) : html('<div class="btn nav disabled" data-key="start">Waiting for host to start</div>');
    if (this.isHost) startBtn.addEventListener('click', () => this.session.send({ t: 'start' }));
    settingsEl.prepend(startBtn);
    this.mount(el, [{ a: 'confirm', label: 'Select' }, this.isHost ? { a: 'x', label: 'Start' } : null, { a: 'back', label: 'Leave' }].filter(Boolean));
  }

  // ---- mech bay
  showBay(edit) {
    const prevScreen = this.screen;
    const st = { cls: edit ? -1 : 0, edit, focus: null };
    if (st.cls === -1) st.cls = 1;
    const list = () => MECHS.filter((m) => m.c === st.cls).sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));
    const done = () => {
      if (edit) { this.session.send({ t: 'lance', side: edit.side, lance: edit.lance }); if (this.session.local === false && this.lobby && this.lobby.slots[edit.side].ctrl === this.session.myId) { /* stays not-ready until confirmed */ } this.showLobby(); }
      else if (prevScreen === 'lobby') this.showLobby();
      else this.showTitle();
    };
    const color = edit && this.lobby ? this.lobby.slots[edit.side].color : '#d9a441';
    const info = (m) => {
      if (!m) return '<div class="faint">Select a mech</div>';
      const arm = m.a.reduce((x, y) => x + y, 0);
      const LOCN = ['Head', 'L.torso', 'C.torso', 'R.torso', 'L.arm', 'R.arm', 'L.leg', 'R.leg'];
      const rows = m.wp.map((w, i) => `<tr class="wr" data-wi="${i}" ${tipAttr(WEAPONS[w[0]].name, `<p>${esc(weaponBlurb(w[0]))}</p><p>Hover or tap to see it fire on the model.</p>`)}><td><span class="wdot"></span>${esc(WEAPONS[w[0]].name)}</td><td class="num">${w[2]}${WEAPONS[w[0]].n > 1 ? '×' + WEAPONS[w[0]].n : ''}</td><td class="num">${w[1]}</td><td class="num">${w[4] ? w[4] + '–' : ''}${w[3]}</td><td>${LOCN[w[7]]}</td><td class="num">${WEAPONS[w[0]].kind === 'e' ? '—' : w[6]}</td></tr>`).join('');
      return `<div class="bay-stats">
          <div class="doll" ${tipAttr('Armour layout', ARMOR_TIP)}>${paperDoll(m, { max: true })}</div>
          <div class="stat-grid">
            <div class="stat" ${tipAttr('Movement', 'Hexes per turn walking / running (movement points; terrain costs more).')}><div class="k">Walk/Run</div><div class="v">${m.w}/${Math.ceil(m.w * 1.5)}</div></div>
            <div class="stat" ${tipAttr('Jump jets', 'How far it can jump, ignoring terrain. A dash means no jump jets.')}><div class="k">Jump</div><div class="v">${m.j || '—'}</div></div>
            <div class="stat" ${tipAttr('Armour', 'Total armour points across all 11 zones.')}><div class="k">Armor</div><div class="v">${arm}</div></div>
            <div class="stat" ${tipAttr('Heat sinks', 'Heat removed at the end of each activation. More sinks means you can fire more weapons without overheating.')}><div class="k">Heat sinks</div><div class="v">${m.hs}</div></div>
            <div class="stat" ${tipAttr('Rating', 'A rough overall strength score combining armour, firepower and speed. Useful for comparing designs.')}><div class="k">Rating</div><div class="v">${mechBV(m)}</div></div>
          </div></div>
        <div style="overflow-x:auto"><table class="wtable"><tr><th>Weapon</th><th>Dmg</th><th>Heat</th><th>Range</th><th>Mount</th><th>Ammo</th></tr>${rows}</table></div>`;
    };
    const showMech = (m) => {
      const det = $('.detail', this.ui);
      if (!det || !m) return;
      $('.vname', det).innerHTML = `<div class="eyebrow">${CLASS_NAMES[m.c]} · ${m.t} tons</div><h2>${esc(m.n)}</h2>`;
      $('.vjump', det).classList.toggle('hidden', !m.j);
      $('.info', det).innerHTML = info(m);
      const pv = this.preview;
      pv.show(m, color);
      pv.onFire = (i) => { $$('.wr', det).forEach((r) => r.classList.toggle('firing', +r.dataset.wi === i)); };
      let lastHover = 0;
      $$('.wr', det).forEach((r) => {
        const i = +r.dataset.wi;
        r.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse') return; pv.autoDemo = false; pv.setHighlight(i); if (performance.now() - lastHover > 350) { lastHover = performance.now(); pv.fire(i, true); } });
        r.addEventListener('pointerleave', () => { pv.autoDemo = true; pv.demoT = 1.5; });
        r.addEventListener('click', () => { pv.autoDemo = false; pv.setHighlight(i); pv.fire(i, true); clearTimeout(this.demoResume); this.demoResume = setTimeout(() => { pv.autoDemo = true; }, 2500); });
      });
    };
    const salvo = () => {
      const pv = this.preview; if (!pv.weapons) return;
      pv.autoDemo = false;
      pv.weapons.forEach((w, k) => setTimeout(() => { pv.setHighlight(k); pv.fire(k, true); }, k * 170));
      clearTimeout(this.demoResume); this.demoResume = setTimeout(() => { pv.autoDemo = true; }, pv.weapons.length * 170 + 1800);
    };
    const render = () => {
      const mechs = list();
      const tons = edit ? lanceTons(edit.lance) : 0;
      const el = html(`<div class="screen">
        <div class="screen-head"><div><div class="eyebrow">${edit ? 'Choose your lance' : 'Mech Bay'}</div><h2>${edit ? `${esc(this.lobby.slots[edit.side].name)}` : 'Original MechForce designs'}</h2></div><div class="spacer"></div>
          <div class="tabs">${CLASS_NAMES.map((c, i) => `<div class="tab ${i === st.cls ? 'on' : ''}" data-c="${i}">${c} ${MECHS.filter((m) => m.c === i).length}</div>`).join('')}</div></div>
        ${edit ? `<div class="lance-tray"><span class="eyebrow">Lance</span>${edit.lance.map((n, i) => `<span class="chip">${esc(n)}</span>`).join('') || '<span class="faint">Empty — add up to ' + edit.max + '</span>'}
          <span class="num ${tons > edit.limit ? '' : 'dim'}" style="margin-left:auto;${tons > edit.limit ? 'color:var(--red)' : ''}">${tons} / ${edit.limit}t</span></div>` : ''}
        <div class="screen-body bay"><div class="panel scroll list"></div><div class="panel detail scroll">
          <div class="viewer"><div class="vname"></div>
            <div class="vbtns"><button class="vb" data-v="walk">${ICON.walk} Walk</button><button class="vb vjump" data-v="jump">${ICON.jump} Jump</button><button class="vb" data-v="fire">${ICON.target} Fire all</button></div>
            <div class="vhint">Drag to rotate · tap to pause spin</div></div>
          <div class="info"></div></div></div></div>`);
      $$('.tab', el).forEach((t) => t.addEventListener('click', () => { st.cls = +t.dataset.c; render(); }));
      const lst = $('.list', el);
      for (const m of mechs) {
        const count = edit ? edit.lance.filter((n) => n === m.n).length : 0;
        const row = html(`<div class="mech-row nav" data-key="${esc(m.n)}"><span class="n">${esc(m.n)}${count ? ` <span class="in">×${count}</span>` : ''}</span><span class="num dim">${m.t}t</span><span class="num faint">${m.w}/${Math.ceil(m.w * 1.5)}/${m.j}</span><span class="num faint">${m.wp.length}w</span></div>`);
        row.addEventListener('click', () => { if (edit) add(m); });
        lst.appendChild(row);
      }
      this.mount(el, edit ? [{ a: 'confirm', label: 'Add' }, { a: 'x', label: 'Remove last' }, { a: 'y', label: 'Random lance' }, { a: 'view', label: 'Fire all' }, { a: 'rb', label: 'Class' }, { a: 'back', label: 'Done' }]
        : [{ a: 'x', label: 'Fire all' }, { a: 'y', label: 'Walk / jump' }, { a: 'rb', label: 'Weight class' }, { a: 'back', label: 'Back' }]);
      if (!this.preview) this.preview = new MechPreview();
      this.preview.attach($('.viewer', el));
      $$('.vb', el).forEach((bt) => bt.addEventListener('click', (e) => { e.stopPropagation(); const v = bt.dataset.v; if (v === 'fire') salvo(); else this.preview.setMode(v); sfx('ui-move'); }));
      this.nav.onChange = (row) => { const key = row ? row.dataset.key : null; if (key === st.focus && this.preview.tpl && this.preview.tpl.n === key) return; st.focus = key; showMech(MECHS.find((x) => x.n === st.focus)); };
      if (st.focus) { const r = $$('.mech-row', el).find((x) => x.dataset.key === st.focus); if (r) this.nav.set(r, false); }
      this.nav.onChange(this.nav.cur);
    };
    const add = (m) => {
      if (edit.lance.length >= edit.max) { toast(`A lance holds ${edit.max} mech${edit.max > 1 ? 's' : ''}. Remove one first.`); return; }
      if (lanceTons(edit.lance) + m.t > edit.limit) { toast(`${m.n} would put you over ${edit.limit} tons.`); return; }
      edit.lance.push(m.n); sfx('ui-ok'); render();
    };
    const act = (a) => {
      if (a === 'lb' || a === 'rb') { st.cls = (st.cls + (a === 'rb' ? 1 : 3)) % 4; st.focus = null; sfx('ui-move'); render(); return true; }
      if (a === 'view' || (!edit && a === 'x')) { salvo(); return true; }
      if (!edit && a === 'y') { this.preview.setMode(this.preview.mode === 'walk' && this.preview.tpl.j ? 'jump' : 'walk'); return true; }
      if (!edit) return false;
      if (a === 'x') { edit.lance.pop(); sfx('ui-back'); render(); return true; }
      if (a === 'y') { edit.lance = autoLance(Math.random(), edit.limit, edit.max); sfx('ui-ok'); render(); return true; }
      if (a === 'menu') { done(); return true; }
      return false;
    };
    this.nav.onChange = null;
    this.setScreen('bay', render, act, done);
  }

  // ---- join
  showJoin() {
    const st = { hosts: [], scanning: false, address: this.settings.lastServer || '', room: this.settings.lastRoom || '' };
    let abort = null;
    const scan = async () => {
      if (st.scanning) return;
      st.scanning = true; render();
      abort = new AbortController();
      await discover((hosts) => { st.hosts = hosts; if (this.screen === 'join') render(); }, { signal: abort.signal, prefixes: st.address ? [st.address.split('.').slice(0, 3).join('.')] : [] });
      st.scanning = false;
      if (this.screen === 'join') render();
    };
    const render = () => {
      const rows = [];
      for (const h of st.hosts) {
        if (!h.rooms || !h.rooms.length) rows.push({ h, room: null });
        else for (const r of h.rooms) rows.push({ h, room: r });
      }
      const el = html(`<div class="screen"><div class="screen-head"><div><div class="eyebrow">Crossplay</div><h2>Join Game</h2></div></div>
        <div class="screen-body cols-2">
          <div class="stack">
            <div class="field"><label for="addr">Host address</label><input id="addr" class="nav" data-key="addr" placeholder="192.168.4.20 or wss://server" value="${esc(st.address)}" autocomplete="off" spellcheck="false"></div>
            <div class="field"><label for="room">Room code (optional)</label><input id="room" class="nav" data-key="room" placeholder="ABCD" maxlength="4" value="${esc(st.room)}" autocomplete="off"></div>
            <div class="btn primary nav" data-key="connect">Connect</div>
            <div class="btn nav" data-key="create">Create new room on that server</div>
            <div class="field"><label for="pname">Your name</label><input id="pname" class="nav" data-key="pname" value="${esc(this.settings.name)}" maxlength="16"></div>
            ${secureBrowser ? '<p class="brief" style="font-size:14px">This web version can join internet servers that use wss://. To play on your home network from a browser, open the address shown on the host\'s lobby screen (it starts with http://).</p>' : ''}
          </div>
          <div class="stack scroll">
            <div class="btn nav" data-key="scan">${st.scanning ? '<span class="spinner"></span> Scanning your network…' : 'Scan network for games'}</div>
            <div class="hosts"></div>
            ${!st.hosts.length && !st.scanning ? `<p class="brief" style="font-size:15px">No games found yet. On a PC or Steam Deck, choose <b>Host LAN Game</b>; it will show up here. If it doesn't, type the address from the host's lobby screen.</p>` : ''}
          </div></div></div>`);
      const hostsEl = $('.hosts', el);
      rows.forEach(({ h, room }, i) => {
        const mis = room ? MISSIONS.find((m) => m.id === room.mission) : null;
        const r = html(`<div class="host panel nav" data-key="h${i}"><b>${esc(h.name)}${room ? ` · <span class="num">${esc(room.code)}</span>` : ''}</b><span class="num dim">${esc(h.address)}</span>
          <small>${room ? `${esc(mis ? mis.name : room.mission)} · ${room.players} player${room.players === 1 ? '' : 's'} · ${room.inGame ? 'in battle' : room.open + ' side(s) free'}` : 'No rooms yet — joining creates one'} · v${esc(h.version)}</small></div>`);
        r.addEventListener('click', () => { abort && abort.abort(); this.joinRemote(`${h.address}:${h.port}`, room ? room.code : ''); });
        hostsEl.appendChild(r);
      });
      const bindInput = (id, key) => { const i = $('#' + id, el); i.addEventListener('input', () => { st[key] = i.value; }); i.addEventListener('click', () => i.focus()); };
      bindInput('addr', 'address'); bindInput('room', 'room');
      const pn = $('#pname', el); pn.addEventListener('input', () => { this.settings.name = pn.value || 'Pilot'; this.saveSettings(); }); pn.addEventListener('click', () => pn.focus());
      $('[data-key=connect]', el).addEventListener('click', () => { abort && abort.abort(); this.joinRemote(st.address, st.room.toUpperCase()); });
      $('[data-key=create]', el).addEventListener('click', () => { abort && abort.abort(); this.joinRemote(st.address, '', true); });
      $('[data-key=scan]', el).addEventListener('click', scan);
      this.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }]);
    };
    const act = (a) => {
      if (a === 'confirm' && this.nav.cur && this.nav.cur.tagName === 'INPUT') { this.nav.cur.focus(); return true; }
      return false;
    };
    this.setScreen('join', render, act, () => { abort && abort.abort(); this.showTitle(); });
    if (native || isCapacitor || servedByHost) scan();
  }

  // ---- settings
  showSettings(back) {
    const s = this.settings;
    const defs = [
      { k: 'quality', label: 'Graphics', opts: ['low', 'medium', 'high'], fmt: (v) => ({ low: 'Low (fast)', medium: 'Medium', high: 'High' }[v]) },
      { k: 'speed', label: 'Animation speed', opts: [0.75, 1, 1.5, 2, 3, 8], fmt: (v) => (v >= 8 ? 'Instant' : v + '×') },
      { k: 'camSpeed', label: 'Camera speed', opts: [0.5, 0.75, 1, 1.5, 2], fmt: (v) => v + '×' },
      { k: 'sfx', label: 'Sound effects', opts: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: (v) => Math.round(v * 10) + '/10' },
      { k: 'music', label: 'Music', opts: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: (v) => Math.round(v * 10) + '/10' },
      { k: 'sound', label: 'Weapon sounds', opts: ['modern', 'amiga', 'both'], fmt: (v) => ({ modern: 'Modern', amiga: 'Original Amiga', both: 'Both' }[v]) },
      { k: 'tips', label: 'Tooltips & hints', opts: [true, false], fmt: (v) => (v ? 'On' : 'Off') },
      { k: 'glyphs', label: 'Button prompts', opts: ['auto', 'xbox', 'ps', 'kb'], fmt: (v) => ({ auto: 'Automatic', xbox: 'Xbox / Steam Deck', ps: 'PlayStation', kb: 'Keyboard' }[v]) },
    ];
    const change = (k, dir) => {
      const d = defs.find((x) => x.k === k);
      const i = d.opts.indexOf(s[k]);
      s[k] = d.opts[((i < 0 ? 0 : i) + dir + d.opts.length) % d.opts.length];
      this.saveSettings();
      sfx('ui-ok');
      render();
    };
    const render = () => {
      const el = html(`<div class="screen"><div class="screen-head"><div><div class="eyebrow">Options</div><h2>Settings</h2></div></div>
        <div class="stack" style="max-width:560px;width:100%"></div></div>`);
      const box = $('.stack', el);
      const name = html(`<div class="field"><label for="sname">Pilot name</label><input id="sname" class="nav" data-key="name" value="${esc(s.name)}" maxlength="16"></div>`);
      $('input', name).addEventListener('input', (e) => { s.name = e.target.value || 'Pilot'; this.saveSettings(); });
      $('input', name).addEventListener('click', (e) => e.target.focus());
      box.appendChild(name);
      for (const d of defs) {
        const b = html(`<div class="btn nav" data-key="${d.k}" data-setting="${d.k}">${esc(d.label)}<span class="val arrows">${esc(d.fmt(s[d.k]))}</span></div>`);
        b.addEventListener('click', () => change(d.k, 1));
        box.appendChild(b);
      }
      if (native && native.toggleFullscreen) { const fb = html('<div class="btn nav" data-key="fs">Toggle fullscreen<span class="val">F11</span></div>'); fb.addEventListener('click', () => native.toggleFullscreen()); box.appendChild(fb); }
      const controls = html(`<div class="panel pad" style="font-size:15px;line-height:1.5"><div class="eyebrow">Controls</div>
        Controller: left stick / d-pad move the cursor, right stick rotates the camera, triggers zoom. ${glyphHTML('confirm')} select, ${glyphHTML('back')} back, ${glyphHTML('x')} fire / stay, ${glyphHTML('y')} walk-run-jump / melee, bumpers cycle mechs and targets, View ends the turn.<br>
        Keyboard &amp; mouse: WASD / arrows, Enter, Esc, F fire, R mode, Tab cycle, T end turn, Q/E rotate, wheel zoom, middle-drag orbit. Click hexes and mechs directly.</div>`);
      box.appendChild(controls);
      this.mount(el, [{ a: 'confirm', label: 'Change' }, { a: 'back', label: 'Back' }]);
    };
    const act = (a) => {
      const cur = this.nav.cur;
      if ((a === 'left' || a === 'right') && cur && cur.dataset.setting) { change(cur.dataset.setting, a === 'right' ? 1 : -1); return true; }
      if (a === 'confirm' && cur && cur.tagName === 'INPUT') { cur.focus(); return true; }
      return false;
    };
    const prev = { screen: this.screen, render: this.renderScreen, action: this.screenAction, back: this.onBack };
    this.setScreen('settings', render, act, back || (() => this.setScreen(prev.screen, prev.render, prev.action, prev.back)));
  }

  // ---- in battle
  pause() {
    if (this.screen !== 'battle' || this.modal) return;
    sfx('ui-ok');
    const st = this.battle.state;
    const mineAlive = st && this.battle.mySides().some((s) => !st.sides[s].conceded);
    const el = html(`<div class="modal panel"><div class="eyebrow">Paused${this.session && !this.session.local ? ' · the battle keeps running' : ''}</div><h2>Menu</h2>
      <div class="stack">
        <div class="btn nav" data-key="resume">Resume</div>
        <div class="btn nav" data-key="manual">How to play</div>
        <div class="btn nav" data-key="log">Battle log</div>
        <div class="btn nav" data-key="settings">Settings</div>
        ${mineAlive && !st.over ? '<div class="btn nav" data-key="concede">Withdraw from battle</div>' : ''}
        <div class="btn nav" data-key="quit">Quit to title</div></div></div>`);
    const close = () => this.closeModal();
    $('[data-key=resume]', el).addEventListener('click', close);
    $('[data-key=manual]', el).addEventListener('click', () => { this.closeModal(); this.showManual(); });
    $('[data-key=log]', el).addEventListener('click', () => {
      const log = html(`<div class="modal wide panel"><div class="eyebrow">Battle log</div><div class="scroll" style="max-height:60vh;font-size:15px;line-height:1.45">${st.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div><div class="btn nav" data-key="ok">Close</div></div>`);
      $('[data-key=ok]', log).addEventListener('click', () => this.closeModal());
      this.openModal(log, { onBack: () => this.closeModal() });
    });
    $('[data-key=settings]', el).addEventListener('click', () => { this.closeModal(); this.settingsOverlay(); });
    const cq = $('[data-key=concede]', el);
    if (cq) cq.addEventListener('click', () => { this.session.send({ t: 'concede' }); close(); });
    $('[data-key=quit]', el).addEventListener('click', () => { close(); this.endSession(); this.showTitle(); });
    this.openModal(el, { onBack: close, prompts: [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Resume' }] });
  }

  settingsOverlay() {
    // reuse the settings screen, then return to the battle HUD
    const battleRoot = this.battle.root;
    this.showSettings(() => { this.screen = 'battle'; this.renderScreen = null; this.screenAction = null; this.onBack = null; this.ui.replaceChildren(battleRoot); this.battle.render(); });
  }

  showResults(st) {
    const w = st.winner;
    const me = this.battle.mySides();
    const won = w && w.side >= 0 && me.includes(w.side);
    const title = !w ? 'Mission over' : w.side < 0 ? 'Draw' : me.length ? (won ? 'Victory' : 'Defeat') : `${st.sides[w.side].name} wins`;
    const rows = st.sides.map((s, i) => {
      const ms = st.mechs.filter((m) => m.side === i);
      const dmg = ms.reduce((a, m) => a + m.stats.dmg, 0), kills = ms.reduce((a, m) => a + m.stats.kills, 0);
      const alive = ms.filter((m) => !m.dead).length;
      const acc = ms.reduce((a, m) => a + m.stats.shots, 0) ? Math.round(100 * ms.reduce((a, m) => a + m.stats.hits, 0) / ms.reduce((a, m) => a + m.stats.shots, 0)) : 0;
      return `<tr><td style="color:${s.color};font-weight:700">${esc(s.name)}</td><td class="num">${alive}/${ms.length}</td><td class="num">${dmg}</td><td class="num">${kills}</td><td class="num">${acc}%</td></tr>`;
    }).join('');
    const mvp = st.mechs.slice().sort((a, b) => b.stats.dmg + b.stats.kills * 30 - (a.stats.dmg + a.stats.kills * 30))[0];
    const canRematch = this.isHost;
    const el = html(`<div class="modal wide panel" style="border-top:3px solid ${w && w.side >= 0 ? st.sides[w.side].color : 'var(--amber)'}">
      <div class="eyebrow">${esc(MISSIONS.find((m) => m.id === st.mission).name)} · ${st.round} rounds · T+${(st.round - 1) * 50}s</div>
      <h2 style="font-size:40px">${esc(title)}</h2><p class="brief">${esc(w ? w.reason : '')}</p>
      <div style="overflow-x:auto"><table class="results-table"><tr><th>Force</th><th>Mechs left</th><th>Damage dealt</th><th>Kills</th><th>Accuracy</th></tr>${rows}</table></div>
      ${mvp ? `<div class="dim">Top performer: <b style="color:var(--ink)">${esc(mvp.design)}</b> (${esc(mvp.pilot.name)}) — ${mvp.stats.dmg} damage, ${mvp.stats.kills} kill${mvp.stats.kills === 1 ? '' : 's'}</div>` : ''}
      <div class="stack">${canRematch ? '<div class="btn primary nav" data-key="again">Back to lobby</div>' : '<div class="faint">Waiting for the host…</div>'}
      <div class="btn nav" data-key="field">View battlefield</div>
      <div class="btn nav" data-key="quit">Quit to title</div></div></div>`);
    const again = $('[data-key=again]', el);
    if (again) again.addEventListener('click', () => { this.closeModal(); this.session.send({ t: 'lobby' }); });
    $('[data-key=field]', el).addEventListener('click', () => { this.closeModal(); });
    $('[data-key=quit]', el).addEventListener('click', () => { this.closeModal(); this.endSession(); this.showTitle(); });
    this.openModal(el, { onBack: () => this.closeModal(), prompts: [{ a: 'confirm', label: 'Select' }] });
  }
}

window.addEventListener('error', (e) => console.error('MechForce error:', e.message));
window.__mf = new App();
