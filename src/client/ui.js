import { glyph, glyphClass, input } from './input.js';
import { sfx } from './audio.js';
import { locName } from '../core/data.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function html(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstElementChild; }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- spatial focus navigation
export class FocusNav {
  constructor() { this.root = null; this.cur = null; }
  attach(root, keepIndex = true) {
    const prevIdx = this.root === root && this.cur ? this.items().indexOf(this.cur) : -1;
    const prevKey = this.cur && this.cur.dataset.key;
    this.root = root;
    const items = this.items();
    let next = (prevKey && items.find((i) => i.dataset.key === prevKey)) || (keepIndex && prevIdx >= 0 && items[prevIdx]) || items.find((i) => i.dataset.autofocus !== undefined) || items[0] || null;
    this.set(next, false);
    items.forEach((it) => {
      if (it._navBound) return;
      it._navBound = true;
      it.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.set(it, false); });
      it.addEventListener('click', () => { this.set(it, false); });
    });
  }
  items() { return this.root ? $$('.nav', this.root).filter((e) => e.offsetParent !== null && !e.classList.contains('hidden')) : []; }
  set(el, sound = true) {
    if (this.cur === el) return;
    if (this.cur) this.cur.classList.remove('focus');
    this.cur = el;
    if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (sound) sfx('ui-move'); }
    window.dispatchEvent(new CustomEvent('mf-focus', { detail: { el, fromNav: sound } }));
    if (this.onChange) this.onChange(el);
  }
  move(dir) {
    const items = this.items();
    if (!items.length) return false;
    if (!this.cur || !items.includes(this.cur)) { this.set(items[0]); return true; }
    const a = this.cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bs = Infinity;
    for (const it of items) {
      if (it === this.cur) continue;
      const b = it.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      let primary, secondary;
      if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -4) continue; primary = -dy; secondary = Math.abs(dx); }
      else if (dir === 'down') { if (b.top < a.bottom - 4 && dy <= 4) continue; primary = dy; secondary = Math.abs(dx); }
      else if (dir === 'left') { if (b.right > a.left + 4 && dx >= -4) continue; primary = -dx; secondary = Math.abs(dy); }
      else { if (b.left < a.right - 4 && dx <= 4) continue; primary = dx; secondary = Math.abs(dy); }
      if (primary <= 0) continue;
      const score = primary + secondary * 2.2;
      if (score < bs) { bs = score; best = it; }
    }
    if (best) { this.set(best); return true; }
    return false;
  }
  activate() { if (this.cur) { this.cur.click(); return true; } return false; }
}

// ---------------------------------------------------------------- prompts
export function promptBar(list, onAction) {
  const bar = html('<div class="prompts"></div>');
  for (const p of list) {
    if (!p) continue;
    const g = glyph(p.a);
    const el = html(`<div class="prompt" data-a="${p.a}">${g ? `<span class="g ${glyphClass(p.a)}">${esc(g)}</span>` : ''}<span>${esc(p.label)}</span></div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); onAction(p.a); });
    bar.appendChild(el);
  }
  return bar;
}
export function glyphHTML(a) { const g = glyph(a); return g ? `<span class="g ${glyphClass(a)}">${esc(g)}</span>` : ''; }

let toastTimer = null;
export function toast(text, ok = false) {
  const ui = $('#ui');
  $$('.toast', ui).forEach((t) => t.remove());
  const t = html(`<div class="toast ${ok ? 'ok' : ''}">${esc(text)}</div>`);
  ui.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
  if (!ok) sfx('ui-err');
}
export function banner(text, sub = '', color = '') {
  const ui = $('#ui');
  $$('.banner', ui).forEach((t) => t.remove());
  const b = html(`<div class="banner" style="${color ? '--side:' + color : ''}"><b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`);
  ui.appendChild(b);
  setTimeout(() => b.remove(), 1700);
}

export function floatText(text, x, y, cls) {
  const layer = $('#floats');
  const f = html(`<div class="float ${cls || ''}">${esc(text)}</div>`);
  f.style.left = x + 'px'; f.style.top = y + 'px';
  layer.appendChild(f);
  setTimeout(() => f.remove(), 1400);
}

// ---------------------------------------------------------------- paper doll
const ZONES = [
  [0, 42, 3, 16, 13], [1, 26, 18, 15, 34], [2, 42, 18, 16, 40], [3, 59, 18, 15, 34],
  [7, 11, 20, 13, 38], [8, 76, 20, 13, 38], [9, 29, 60, 15, 44], [10, 56, 60, 15, 44],
  [4, 27, 109, 14, 10], [5, 43, 109, 14, 10], [6, 59, 109, 14, 10],
];
// four-legged: legs at the corners, seen from above
const ZONES_QUAD = [
  [0, 42, 3, 16, 13], [1, 26, 18, 15, 40], [2, 42, 18, 16, 46], [3, 59, 18, 15, 40],
  [7, 8, 8, 15, 40], [8, 77, 8, 15, 40], [9, 8, 60, 15, 42], [10, 77, 60, 15, 42],
  [4, 27, 109, 14, 10], [5, 43, 109, 14, 10], [6, 59, 109, 14, 10],
];
// tripod: a third leg in the middle
const ZONES_TRI = [
  [0, 42, 3, 16, 13], [1, 26, 18, 15, 34], [2, 42, 18, 16, 40], [3, 59, 18, 15, 34],
  [7, 11, 20, 13, 38], [8, 76, 20, 13, 38], [9, 24, 62, 15, 42], [11, 42.5, 62, 15, 42], [10, 61, 62, 15, 42],
  [4, 27, 109, 14, 10], [5, 43, 109, 14, 10], [6, 59, 109, 14, 10],
];
const ZONE_LOC = [0, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8];
export function armorColor(frac, internalFrac, gone) {
  if (gone) return '#1b1f24';
  if (frac > 0) return `hsl(${Math.round(20 + frac * 110)}, 70%, ${42 + frac * 8}%)`;
  return `hsl(${Math.round(internalFrac * 20)}, 85%, ${22 + internalFrac * 20}%)`;
}
export function paperDoll(m, { max = false, hl = null } = {}) {
  let s = '<svg viewBox="0 0 100 122" aria-label="Armor diagram">';
  const body = m.body || 'biped';
  for (const [z, x, y, w, h] of body === 'quad' ? ZONES_QUAD : body === 'tripod' ? ZONES_TRI : ZONES) {
    const loc = ZONE_LOC[z];
    const gone = !max && m.locGone && m.locGone[loc];
    const a = max ? m.a[z] : m.armor[z];
    const amax = max ? m.a[z] : m.armorMax[z];
    const i = max ? m.i[loc] : m.internal[loc];
    const imax = max ? m.i[loc] : m.internalMax[loc];
    const fill = armorColor(amax ? a / amax : 0, imax ? i / imax : 0, gone);
    const stroke = hl === loc ? 'stroke="#ffd27a" stroke-width="2"' : '';
    s += `<rect class="z" x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${stroke}><title>${locName(body, loc)}${z >= 4 && z <= 6 ? ' (rear)' : ''}: ${a} armor, ${i} structure</title></rect>`;
    s += gone ? `<text x="${x + w / 2}" y="${y + h / 2 + 3}" style="fill:#ff5a3c">✕</text>` : `<text x="${x + w / 2}" y="${y + h / 2 + 3}">${a}</text>`;
  }
  s += '<text x="50" y="106.5" style="fill:#66727e;font-size:6px;letter-spacing:1px">REAR</text></svg>';
  return s;
}

export { input };
