// Sessions: LocalSession runs the authoritative Room in-process (single player, hotseat);
// RemoteSession talks to a host over WebSocket (LAN host app, dedicated or internet server).
import { Room } from '../core/room.js';
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
