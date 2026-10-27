// Lobby + authoritative game room. Transport-agnostic: used by the Node server
// (LAN host / dedicated / internet) and in-process for single player & hotseat.
import { createGame, applyCommand, activeSide } from './rules.js';
import { aiNextCommand } from './ai.js';
import { MECHS, MISSIONS, PROTOCOL, VERSION, SIDE_NAMES, SIDE_COLORS, mechBV } from './data.js';
import { buildTemplate } from './custom.js';

let nextClient = 1;
const rid = () => Math.random().toString(36).slice(2, 10);

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export function autoLance(seed, maxTons, count = 4) {
  // A plausible AI lance close to the tonnage budget
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) | 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) | 0) >>> 0) / 4294967296;
  const pool = MECHS.filter((m) => m.t <= 100);
  let best = null;
  for (let tries = 0; tries < 60; tries++) {
    const pickN = Math.max(1, count);
    const lance = [];
    for (let i = 0; i < pickN; i++) lance.push(pool[Math.floor(rnd() * pool.length)]);
    const tons = lance.reduce((s, m) => s + m.t, 0);
    if (tons > maxTons) continue;
    const score = tons + rnd() * 10;
    if (!best || score > best.score) best = { score, lance };
  }
  return (best ? best.lance : [pool[0]]).map((m) => m.n);
}

export function entryTons(e) {
  if (e && typeof e === 'object' && e.custom) return buildTemplate(e.custom).template.t;
  return MECHS.find((m) => m.n === e)?.t || 0;
}
export function lanceTons(lance) {
  return lance.reduce((s, e) => s + entryTons(e), 0);
}
// Accept stock names, or custom designs that pass validation (rebuilt here, never trusted)
export function cleanLance(list, max) {
  const out = [];
  for (const e of (list || []).slice(0, max)) {
    if (typeof e === 'string') { if (MECHS.some((m) => m.n === e)) out.push(e); continue; }
    if (e && typeof e === 'object' && e.custom) { const b = buildTemplate(e.custom); if (b.ok) out.push({ custom: b.spec }); }
  }
  return out;
}

export class Room {
  constructor({ code, send, onEmpty, aiDelay = 700, local = false }) {
    this.code = code || randomCode();
    this.send = send; // (clientId, msg)
    this.onEmpty = onEmpty || (() => {});
    this.aiDelay = aiDelay;
    this.local = local;
    this.clients = new Map();
    this.hostId = null;
    this.settings = { mission: 'generic', mapSize: 'M', theme: 'temperate', tonnage: 200, seed: rid(), sides: 2, lanceSize: 4 };
    this.slots = [];
    this.game = null;
    this.aiTimer = null;
    this.created = Date.now();
    this.resizeSlots();
  }

  resizeSlots() {
    const mis = MISSIONS.find((m) => m.id === this.settings.mission) || MISSIONS[0];
    const n = Math.max(mis.sides[0], Math.min(mis.sides[1], this.settings.sides || 2));
    this.settings.sides = n;
    while (this.slots.length < n) {
      const i = this.slots.length;
      this.slots.push({ ctrl: 'ai', name: SIDE_NAMES[i], color: SIDE_COLORS[i], lance: autoLance(this.code + i + rid(), this.settings.tonnage), ready: false });
    }
    this.slots.length = n;
  }

  // ---- clients
  join(info) {
    let c = info.token && [...this.clients.values()].find((x) => x.token === info.token);
    if (c) { c.connected = true; c.name = info.name || c.name; }
    else {
      c = { id: 'c' + nextClient++, token: info.token || rid() + rid(), name: (info.name || 'Pilot').slice(0, 16), platform: info.platform || '?', connected: true };
      this.clients.set(c.id, c);
      if (!this.hostId) this.hostId = c.id;
      // seat new players in an open or AI slot if no game is running
      if (!this.game) {
        const mine = this.slots.some((s) => s.ctrl === c.id);
        if (!mine) {
          const free = this.slots.findIndex((s) => s.ctrl === 'open') >= 0 ? this.slots.findIndex((s) => s.ctrl === 'open')
            : this.slots.findIndex((s) => s.ctrl === 'ai');
          if (free >= 0) { this.slots[free].ctrl = c.id; this.slots[free].ready = false; }
        }
      }
    }
    this.send(c.id, { t: 'welcome', id: c.id, token: c.token, room: this.code, version: VERSION, protocol: PROTOCOL, host: this.hostId === c.id });
    if (this.game) this.send(c.id, { t: 'start', state: this.game });
    this.pushLobby();
    return c.id;
  }

  leave(id) {
    const c = this.clients.get(id);
    if (!c) return;
    c.connected = false;
    if (this.hostId === id) {
      const next = [...this.clients.values()].find((x) => x.connected);
      this.hostId = next ? next.id : null;
    }
    if (!this.game) {
      this.slots.forEach((s) => { if (s.ctrl === id) { s.ctrl = 'open'; s.ready = false; } });
      this.clients.delete(id);
    }
    this.pushLobby();
    if (![...this.clients.values()].some((x) => x.connected)) this.onEmpty(this);
  }

  lobbyState() {
    return {
      code: this.code, host: this.hostId, settings: this.settings, inGame: !!this.game,
      slots: this.slots, clients: [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, platform: c.platform, connected: c.connected })),
    };
  }
  pushLobby() { const l = this.lobbyState(); for (const c of this.clients.values()) if (c.connected) this.send(c.id, { t: 'lobby', lobby: l }); }
  broadcast(msg) { for (const c of this.clients.values()) if (c.connected) this.send(c.id, msg); }

  summary() {
    return { code: this.code, host: this.clients.get(this.hostId)?.name || '?', players: [...this.clients.values()].filter((c) => c.connected).length,
      sides: this.slots.length, open: this.slots.filter((s) => s.ctrl === 'open' || s.ctrl === 'ai').length, mission: this.settings.mission, inGame: !!this.game };
  }

  // ---- messages
  handle(id, msg) {
    const c = this.clients.get(id);
    if (!c) return;
    const isHost = id === this.hostId;
    const err = (m) => this.send(id, { t: 'error', msg: m });
    switch (msg.t) {
      case 'settings': {
        if (!isHost || this.game) return err('Only the host can change settings');
        const s = msg.settings || {};
        for (const k of ['mission', 'mapSize', 'theme', 'tonnage', 'seed', 'sides', 'lanceSize']) if (s[k] !== undefined) this.settings[k] = s[k];
        this.settings.tonnage = Math.max(20, Math.min(800, +this.settings.tonnage || 200));
        this.settings.lanceSize = Math.max(1, Math.min(4, +this.settings.lanceSize || 4));
        this.resizeSlots();
        this.slots.forEach((sl) => { if (sl.ctrl === 'ai') sl.lance = autoLance(rid(), this.settings.tonnage, this.settings.lanceSize); sl.ready = sl.ctrl === 'ai'; if (sl.lance.length > this.settings.lanceSize) sl.lance.length = this.settings.lanceSize; });
        return this.pushLobby();
      }
      case 'slot': {
        if (this.game) return;
        const sl = this.slots[msg.side];
        if (!sl) return;
        if (msg.ctrl === 'me') {
          if (sl.ctrl !== 'open' && sl.ctrl !== 'ai' && sl.ctrl !== id && !(this.local)) return err('Slot taken');
          if (!this.local) this.slots.forEach((s) => { if (s.ctrl === id) s.ctrl = 'open'; });
          sl.ctrl = id; sl.ready = false;
        } else if (msg.ctrl === 'ai' || msg.ctrl === 'open') {
          if (!isHost && sl.ctrl !== id) return err('Only the host can change that slot');
          sl.ctrl = msg.ctrl; sl.ready = msg.ctrl === 'ai';
          if (msg.ctrl === 'ai') sl.lance = autoLance(rid(), this.settings.tonnage, this.settings.lanceSize);
        }
        return this.pushLobby();
      }
      case 'lance': {
        const sl = this.slots[msg.side];
        if (!sl || this.game) return;
        if (sl.ctrl !== id && !(isHost && sl.ctrl === 'ai')) return err('Not your slot');
        const lance = cleanLance(msg.lance, this.settings.lanceSize);
        if ((msg.lance || []).length && lance.length < Math.min((msg.lance || []).length, this.settings.lanceSize)) this.send(id, { t: 'error', msg: 'A custom design was rejected because it breaks the construction rules.' });
        sl.lance = lance; sl.ready = false;
        if (msg.name) sl.name = String(msg.name).slice(0, 18);
        return this.pushLobby();
      }
      case 'ready': {
        const sl = this.slots[msg.side];
        if (!sl || sl.ctrl !== id) return;
        if (msg.v && (!sl.lance.length || lanceTons(sl.lance) > this.settings.tonnage)) return err('Lance is over the tonnage limit or empty');
        sl.ready = !!msg.v;
        return this.pushLobby();
      }
      case 'start': {
        if (!isHost) return err('Only the host can start');
        if (this.game) return;
        const problems = [];
        this.slots.forEach((sl, i) => {
          if (sl.ctrl === 'open') problems.push(`${sl.name} has no commander`);
          else if (!sl.lance.length) problems.push(`${sl.name} has no mechs`);
          else if (lanceTons(sl.lance) > this.settings.tonnage) problems.push(`${sl.name} is over ${this.settings.tonnage}t`);
          else if (sl.ctrl !== 'ai' && sl.ctrl !== id && !sl.ready && !this.local) problems.push(`${sl.name} is not ready`);
          void i;
        });
        if (problems.length) return err(problems[0]);
        this.game = createGame({
          seed: this.settings.seed, mission: this.settings.mission, mapSize: this.settings.mapSize, theme: this.settings.theme,
          sides: this.slots.map((sl) => ({ name: sl.name, color: sl.color, ctrl: sl.ctrl, lance: sl.lance, gunnery: 4, piloting: 5 })),
        });
        this.broadcast({ t: 'start', state: this.game });
        this.pushLobby();
        return this.scheduleAI();
      }
      case 'cmd': {
        const g = this.game;
        if (!g || g.over) return;
        const side = msg.side ?? activeSide(g);
        if (side !== activeSide(g)) return err('Not your turn');
        if (g.sides[side].ctrl !== id) return err('Not your side');
        const r = applyCommand(g, side, msg.cmd);
        if (!r.ok) return err(r.error);
        this.broadcast({ t: 'update', events: r.events, state: g, seq: g.seq });
        return this.scheduleAI(r.events);
      }
      case 'concede': {
        const g = this.game;
        if (!g || g.over) return;
        g.sides.forEach((s, i) => {
          if (s.ctrl === id && !s.conceded && (msg.side === undefined || msg.side === i)) {
            const r = applyCommand(g, i, { type: 'concede' });
            this.broadcast({ t: 'update', events: r.events, state: g, seq: g.seq });
          }
        });
        return this.scheduleAI();
      }
      case 'lobby': {
        // back to lobby for a rematch
        if (!isHost) return;
        clearTimeout(this.aiTimer);
        this.game = null;
        this.settings.seed = rid();
        this.slots.forEach((s) => { s.ready = s.ctrl === 'ai'; });
        this.broadcast({ t: 'tolobby' });
        return this.pushLobby();
      }
      case 'chat': {
        return this.broadcast({ t: 'chat', from: c.name, text: String(msg.text || '').slice(0, 200) });
      }
      case 'ping': return this.send(id, { t: 'pong', at: msg.at });
      default: return;
    }
  }

  scheduleAI(events) {
    clearTimeout(this.aiTimer);
    const g = this.game;
    if (!g || g.over) return;
    const side = activeSide(g);
    if (side < 0 || g.sides[side].ctrl !== 'ai') return;
    // Give clients time to play the previous animations.
    const shots = (events || []).filter((e) => e.k === 'shot' || e.k === 'melee').length;
    const moves = (events || []).filter((e) => e.k === 'move').map((e) => e.path.length).reduce((a, b) => a + b, 0);
    const delay = this.aiDelay + shots * 260 + moves * 140;
    this.aiTimer = setTimeout(() => this.aiStep(), delay);
  }

  aiStep() {
    const g = this.game;
    if (!g || g.over) return;
    const side = activeSide(g);
    if (side < 0 || g.sides[side].ctrl !== 'ai') return;
    let cmd = aiNextCommand(g);
    if (!cmd) return;
    let r = applyCommand(g, side, cmd);
    if (!r.ok && cmd.id !== undefined) r = applyCommand(g, side, { type: 'end', id: cmd.id });
    if (!r.ok) return;
    this.broadcast({ t: 'update', events: r.events, state: g, seq: g.seq });
    this.scheduleAI(r.events);
  }

  dispose() { clearTimeout(this.aiTimer); }
}

export { mechBV };
