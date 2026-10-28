// Sessions: LocalSession runs the authoritative Room in-process (single player, hotseat);
// RemoteSession talks to a host over WebSocket (LAN host app, dedicated or internet server).
import { Room, randomCode } from '../core/room.js';
import { Peer } from 'peerjs';
import { PROTOCOL, VERSION } from '../core/data.js';

export class LocalSession {
  constructor(name, platform) {
    this.local = true;
    this.handlers = new Set();
    this.room = new Room({ code: 'LOCAL', local: true, aiDelay: 450, send: (id, msg) => queueMicrotask(() => this.emit(msg)) });
    this.myId = this.room.join({ name, platform });
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(msg) { if (msg.t === 'welcome') this.myId = msg.id; for (const h of [...this.handlers]) h(msg); }
  send(msg) { queueMicrotask(() => this.room.handle(this.myId, msg)); }
  close() { this.room.dispose(); this.handlers.clear(); }
}

export function wsUrlFor(address) {
  let a = (address || '').trim();
  if (!a) return null;
  if (/^wss?:\/\//i.test(a)) return a.replace(/\/?$/, '').replace(/(\/ws)?$/, '/ws');
  if (/^https?:\/\//i.test(a)) { const u = new URL(a); return (u.protocol === 'https:' ? 'wss://' : 'ws://') + u.host + '/ws'; }
  if (!/:\d+$/.test(a)) a += ':7373';
  return 'ws://' + a + '/ws';
}

export class RemoteSession {
  constructor(url, { name, platform, room, create, token }) {
    this.local = false;
    this.url = url;
    this.hello = { t: 'hello', name, platform, version: VERSION, protocol: PROTOCOL, room, create, token };
    this.handlers = new Set();
    this.status = 'connecting';
    this.closed = false;
    this.retries = 0;
    this.connect();
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(msg) { for (const h of [...this.handlers]) h(msg); }
  setStatus(s) { this.status = s; this.emit({ t: '_status', status: s }); }
  connect() {
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.setStatus('failed'); this.emit({ t: 'error', fatal: true, msg: 'Could not connect: ' + e.message }); return; }
    this.ws = ws;
    const timeout = setTimeout(() => { if (ws.readyState !== 1) ws.close(); }, 6000);
    ws.onopen = () => { clearTimeout(timeout); this.retries = 0; this.setStatus('online'); ws.send(JSON.stringify(this.hello)); };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') { this.myId = msg.id; this.hello.token = msg.token; this.hello.room = msg.room; this.hello.create = false; this.roomCode = msg.room; }
      if (msg.t === 'error' && msg.fatal) this.closed = true;
      this.emit(msg);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.closed) { this.setStatus('closed'); return; }
      this.retries++;
      if (this.retries > 8) { this.setStatus('failed'); this.emit({ t: 'error', fatal: true, msg: 'Lost connection to the host.' }); return; }
      this.setStatus('reconnecting');
      setTimeout(() => !this.closed && this.connect(), Math.min(4000, 500 * this.retries));
    };
    ws.onerror = () => {};
  }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { this.closed = true; try { this.ws && this.ws.close(); } catch {} this.handlers.clear(); }
}

// ---------------------------------------------------------------------------
// Peer-to-peer hosting (WebRTC via PeerJS). Any device can host: the host's game
// runs the authoritative Room in-page and other players connect directly to it.
// A public matchmaking server only introduces the peers; game traffic is direct.

export const PEER_PREFIX = 'mechforce-p2-';

export function peerOptions(cfg = {}) {
  const ice = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const turn = parseTurn(cfg.turn);
  if (turn) ice.push(turn);
  const o = { config: { iceServers: ice }, debug: 0 };
  if (cfg.signal) { // optional self-hosted matchmaking server, e.g. "localhost:9000" or "https://example.com/peerjs"
    try {
      const u = new URL(/^https?:/.test(cfg.signal) ? cfg.signal : 'http://' + cfg.signal);
      o.host = u.hostname; o.port = +u.port || (u.protocol === 'https:' ? 443 : 80); o.secure = u.protocol === 'https:'; o.path = u.pathname === '/' ? '/' : u.pathname;
    } catch {}
  }
  return o;
}
// "turn:user:password@host:port" or "turns:..." -> RTCIceServer
export function parseTurn(s) {
  const m = /^(turns?):([^:@]+):([^@]+)@(.+)$/.exec((s || '').trim());
  return m ? { urls: `${m[1]}:${m[4]}`, username: m[2], credential: m[3] } : null;
}
const friendlyPeerError = (e) => ({
  'peer-unavailable': 'No game is hosting with that code. Check the code, or ask the host if their game is still open.',
  network: 'Could not reach the matchmaking service. Check your internet connection.',
  'server-error': 'The matchmaking service had a problem. Try again in a moment.',
  'socket-error': 'Lost contact with the matchmaking service.',
  'browser-incompatible': 'This browser does not support direct connections.',
  'webrtc': 'The direct connection failed. One of the networks may be blocking it — try a TURN relay in Settings.',
}[e && e.type] || (e && e.message) || 'Connection problem');

export class PeerHostSession {
  constructor({ name, platform, cfg }) {
    this.local = false;
    this.peerHost = true;
    this.handlers = new Set();
    this.conns = new Map(); // clientId -> DataConnection
    this.cfg = cfg || {};
    this.code = randomCode() + randomCode().slice(0, 1);
    this.room = new Room({ code: this.code, send: (id, msg) => this.route(id, msg), aiDelay: 700 });
    this.selfJoin = true;
    this.myId = this.room.join({ name, platform });
    this.selfJoin = false;
    this.status = 'connecting';
    this.open();
  }
  open() {
    this.peer = new Peer(PEER_PREFIX + this.code, peerOptions(this.cfg));
    this.peer.on('open', () => { this.setStatus('online'); });
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => { if (!this.closed) { this.setStatus('reconnecting'); setTimeout(() => !this.closed && this.peer.reconnect(), 1500); } });
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { // code clash: pick another
        this.peer.destroy(); this.code = randomCode() + randomCode().slice(0, 1); this.room.code = this.code; this.open(); this.room.pushLobby(); return;
      }
      if (e.type === 'peer-unavailable') return;
      this.emit({ t: 'error', msg: friendlyPeerError(e) });
    });
  }
  accept(conn) {
    let cid = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (!cid) {
        if (msg.t !== 'hello') return;
        if (msg.protocol !== PROTOCOL) { conn.send({ t: 'error', fatal: true, msg: `Version mismatch: host has ${VERSION}, you have ${msg.version || '?'}. Update both.` }); setTimeout(() => conn.close(), 300); return; }
        this.pending = conn;
        cid = this.room.join({ name: msg.name, platform: msg.platform, token: msg.token });
        this.pending = null;
        this.conns.set(cid, conn);
        // welcome + lobby were routed while pending; re-send current state to be safe
        return;
      }
      this.room.handle(cid, msg);
    });
    const gone = () => { if (cid && this.conns.get(cid) === conn) { this.conns.delete(cid); this.room.leave(cid); } };
    conn.on('close', gone);
    conn.on('error', gone);
  }
  route(id, msg) {
    if (id === this.myId || this.selfJoin) { queueMicrotask(() => this.emit(msg)); return; }
    const c = this.conns.get(id) || (this.pending && !this.conns.has(id) ? this.pending : null);
    if (c && c.open) { try { c.send(msg); } catch {} }
    else if (c) c.once('open', () => { try { c.send(msg); } catch {} });
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(msg) { if (msg.t === 'welcome' && msg.id === this.myId) this.roomCode = msg.room; for (const h of [...this.handlers]) h(msg); }
  setStatus(s) { this.status = s; this.emit({ t: '_status', status: s }); }
  send(msg) { queueMicrotask(() => this.room.handle(this.myId, msg)); }
  get players() { return this.conns.size; }
  close() { this.closed = true; try { this.peer.destroy(); } catch {} this.room.dispose(); this.handlers.clear(); }
}

export class PeerClientSession {
  constructor(code, { name, platform, cfg, token }) {
    this.local = false;
    this.handlers = new Set();
    this.code = String(code || '').toUpperCase().trim();
    this.cfg = cfg || {};
    this.hello = { t: 'hello', name, platform, version: VERSION, protocol: PROTOCOL, token };
    this.retries = 0;
    this.status = 'connecting';
    this.peer = new Peer(peerOptions(this.cfg));
    this.peer.on('open', () => this.connect());
    this.peer.on('error', (e) => {
      if (e.type === 'peer-unavailable' && this.retries < 2 && this.everOpen) { this.retry(); return; }
      if (['peer-unavailable', 'network', 'browser-incompatible', 'server-error'].includes(e.type) && !this.everOpen) { this.closed = true; this.emit({ t: 'error', fatal: true, msg: friendlyPeerError(e) }); return; }
      if (!this.closed) this.retry();
    });
  }
  connect() {
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
    this.conn = conn;
    const timer = setTimeout(() => { if (!conn.open && !this.closed) { this.closed = !this.everOpen && this.retries >= 2; if (this.closed) this.emit({ t: 'error', fatal: true, msg: friendlyPeerError({ type: 'webrtc' }) }); else { try { conn.close(); } catch {} this.retry(); } } }, 12000);
    conn.on('open', () => { clearTimeout(timer); this.everOpen = true; this.retries = 0; this.setStatus('online'); conn.send(this.hello); });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'welcome') { this.myId = msg.id; this.hello.token = msg.token; this.roomCode = msg.room; }
      if (msg.t === 'error' && msg.fatal) this.closed = true;
      this.emit(msg);
    });
    conn.on('close', () => { clearTimeout(timer); if (!this.closed && this.conn === conn) this.retry(); });
  }
  retry() {
    if (this.closed) return;
    this.retries++;
    if (this.retries > 8) { this.closed = true; this.setStatus('failed'); this.emit({ t: 'error', fatal: true, msg: 'Lost connection to the host.' }); return; }
    this.setStatus('reconnecting');
    setTimeout(() => { if (this.closed) return; if (this.peer.disconnected) this.peer.reconnect(); else this.connect(); }, Math.min(4000, 700 * this.retries));
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(msg) { for (const h of [...this.handlers]) h(msg); }
  setStatus(s) { this.status = s; this.emit({ t: '_status', status: s }); }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  close() { this.closed = true; try { this.peer.destroy(); } catch {} this.handlers.clear(); }
}
