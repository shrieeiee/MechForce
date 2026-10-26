// Unified input: gamepads (browser Gamepad API + Android native bridge), keyboard,
// mouse and touch, all mapped to the same abstract actions. Tracks which device was
// used last so on-screen prompts show the right glyphs.
//
// Actions: up down left right confirm back x y lb rb lt rt view menu
// Analog: move (left stick), cam (right stick)

const listeners = new Set();
export const input = {
  device: 'kb', // kb | xbox | ps | touch
  forcedGlyphs: 'auto',
  move: { x: 0, y: 0 },
  cam: { x: 0, y: 0 },
  zoom: 0,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(action, src) { for (const fn of [...listeners]) if (fn(action, src) === true) break; },
};

function setDevice(d) {
  if (input.device === d) return;
  input.device = d;
  document.documentElement.dataset.device = glyphSet();
  window.dispatchEvent(new CustomEvent('mf-device'));
}
export function glyphSet() {
  if (input.forcedGlyphs && input.forcedGlyphs !== 'auto') return input.forcedGlyphs;
  return input.device;
}

// ----------------------------------------------------------------- keyboard
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', Space: 'confirm', NumpadEnter: 'confirm', Escape: 'back', Backspace: 'back',
  KeyF: 'x', KeyR: 'y', Tab: 'rb', KeyT: 'view', KeyP: 'menu', F10: 'menu',
};
const keysDown = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
    if (e.code === 'Escape') { e.target.blur(); input.emit('back', 'kb'); }
    if (e.code === 'Enter') { e.target.blur(); }
    return;
  }
  setDevice('kb');
  if (e.code === 'KeyQ') { keysDown.add('KeyQ'); e.preventDefault(); return; }
  if (e.code === 'KeyE') { keysDown.add('KeyE'); e.preventDefault(); return; }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') { input.zoom -= 1; return; }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') { input.zoom += 1; return; }
  if (e.code === 'F11') { window.mfNative?.toggleFullscreen?.(); e.preventDefault(); return; }
  let a = KEYMAP[e.code];
  if (e.code === 'Tab' && e.shiftKey) a = 'lb';
  if (!a) return;
  e.preventDefault();
  if (e.repeat && !['up', 'down', 'left', 'right'].includes(a)) return;
  input.emit(a, 'kb');
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());

// ----------------------------------------------------------------- gamepads
const BTN = ['confirm', 'back', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', null, null, 'up', 'down', 'left', 'right'];
const prev = new Map();
const repeat = { dir: null, next: 0 };
let nativePad = null; // filled by the Android shell
window.__mfNativePad = (state) => { nativePad = state; };

function padKind(id) {
  const s = (id || '').toLowerCase();
  if (s.includes('054c') || s.includes('playstation') || s.includes('dualsense') || s.includes('dualshock') || s.includes('wireless controller')) return 'ps';
  return 'xbox';
}

function readPads() {
  const out = [];
  try {
    for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (p && p.connected) out.push({ id: p.id, kind: padKind(p.id), buttons: p.buttons.map((b) => b.pressed || b.value > 0.5), triggers: [p.buttons[6]?.value || 0, p.buttons[7]?.value || 0], axes: p.axes.slice(0, 4) });
    }
  } catch {}
  if (nativePad && !out.length) out.push({ id: 'native', kind: nativePad.kind || 'xbox', buttons: nativePad.buttons || [], triggers: nativePad.triggers || [0, 0], axes: nativePad.axes || [0, 0, 0, 0] });
  return out;
}

const dz = (v) => (Math.abs(v) < 0.22 ? 0 : (v - Math.sign(v) * 0.22) / 0.78);

export function pollInput(now) {
  const pads = readPads();
  let mx = 0, my = 0, cx = 0, cy = 0;
  pads.forEach((p, pi) => {
    const before = prev.get(pi) || [];
    p.buttons.forEach((down, i) => {
      if (down && !before[i] && BTN[i]) { setDevice(p.kind); input.emit(BTN[i], 'pad'); if (['up', 'down', 'left', 'right'].includes(BTN[i])) { repeat.dir = BTN[i]; repeat.next = now + 380; } }
      if (!down && before[i] && repeat.dir === BTN[i]) repeat.dir = null;
    });
    prev.set(pi, p.buttons.slice());
    const ax = p.axes;
    if (Math.abs(ax[0]) > 0.25 || Math.abs(ax[1]) > 0.25 || Math.abs(ax[2]) > 0.25 || Math.abs(ax[3]) > 0.25) setDevice(p.kind);
    mx += dz(ax[0] || 0); my += dz(ax[1] || 0); cx += dz(ax[2] || 0); cy += dz(ax[3] || 0);
    const lt = p.triggers[0] || 0, rt = p.triggers[1] || 0;
    input.zoom += (lt - rt) * 0.06;
  });
  if (repeat.dir) {
    const held = pads.some((p) => p.buttons[BTN.indexOf(repeat.dir)]);
    if (!held) repeat.dir = null;
    else if (now >= repeat.next) { input.emit(repeat.dir, 'pad'); repeat.next = now + 120; }
  }
  if (keysDown.has('KeyQ')) cx -= 1;
  if (keysDown.has('KeyE')) cx += 1;
  input.move.x = Math.max(-1, Math.min(1, mx));
  input.move.y = Math.max(-1, Math.min(1, my));
  input.cam.x = Math.max(-1, Math.min(1, cx));
  input.cam.y = Math.max(-1, Math.min(1, cy));
}

// Mouse/touch: the UI and renderer attach their own handlers, but they report device here.
window.addEventListener('pointerdown', (e) => setDevice(e.pointerType === 'touch' ? 'touch' : 'kb'), true);
window.addEventListener('mousemove', () => { if (input.device !== 'kb' && input.device !== 'touch') { /* keep pad glyphs while pad active */ } });

window.addEventListener('mf-back', () => input.emit('back', 'touch'));

export function markDevice(d) { setDevice(d); }

// ----------------------------------------------------------------- glyphs
const GLYPHS = {
  xbox: { confirm: 'A', back: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: '⧉', menu: '≡', up: '▲', down: '▼', left: '◀', right: '▶', lr: 'LB/RB', dpad: '✚', stick: 'L', cam: 'R' },
  ps: { confirm: '✕', back: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: 'SHARE', menu: 'OPT', up: '▲', down: '▼', left: '◀', right: '▶', lr: 'L1/R1', dpad: '✚', stick: 'L', cam: 'R' },
  kb: { confirm: 'Enter', back: 'Esc', x: 'F', y: 'R', lb: '⇧Tab', rb: 'Tab', lt: '−', rt: '+', view: 'T', menu: 'P', up: 'W', down: 'S', left: 'A', right: 'D', lr: 'Tab', dpad: 'WASD', stick: 'WASD', cam: 'Q/E' },
  touch: { confirm: 'Tap', back: 'Back', x: '', y: '', lb: '‹', rb: '›', lt: '', rt: '', view: '', menu: '☰', up: '', down: '', left: '', right: '', lr: '', dpad: '', stick: '', cam: '' },
};
export function glyph(action) {
  const set = GLYPHS[glyphSet()] || GLYPHS.kb;
  return set[action] ?? action;
}
export function glyphClass(action) {
  const g = glyphSet();
  if (g === 'xbox' && ['confirm', 'back', 'x', 'y'].includes(action)) return 'g-face g-' + action;
  if (g === 'ps' && ['confirm', 'back', 'x', 'y'].includes(action)) return 'g-face g-ps-' + action;
  return 'g-key';
}
