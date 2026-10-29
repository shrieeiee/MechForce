// Sound: synthesised modern SFX, optional original Amiga samples, light procedural music.
import { AMIGA_SAMPLES } from './samples.js';

let ctx = null, master = null, sfxBus = null, musicBus = null;
const buffers = {};
export const audioSettings = { sfx: 0.8, music: 0.4, style: 'modern' }; // modern | amiga | both

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }
  master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18; comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(comp);
  buildFx(sfxBus);
  musicBus = ctx.createGain(); musicBus.connect(master);
  applyVolumes();
  for (const [k, b64] of Object.entries(AMIGA_SAMPLES)) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    ctx.decodeAudioData(u8.buffer).then((buf) => { buffers[k] = buf; }).catch(() => {});
  }
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = audioSettings.sfx;
  musicBus.gain.value = audioSettings.music * 0.5;
}

const AMIGA_MAP = { laser: 'Laser', cannon: 'Cannon', mg: 'MachineGun', rocket: 'Rocket', flamer: 'Flamer', plasma: 'Laser', melee: 'Crunch', hit: 'Crunch', boom: 'Cannon' };

let noiseBuf = null, revIn = null, driveIn = null;
const now = () => ctx.currentTime;
const rnd = (a, b) => a + Math.random() * (b - a);

// Room for the sounds: a short generated reverb tail, and a soft-clipping drive stage that
// gives the heavy sounds their grit. Both are built once when audio starts.
function buildFx(out) {
  const len = Math.floor(ctx.sampleRate * 1.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1); }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  revIn = ctx.createGain(); revIn.connect(conv); conv.connect(wet); wet.connect(out);
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 3.2) / Math.tanh(3.2); }
  ws.curve = curve; ws.oversample = '2x';
  driveIn = ctx.createGain(); driveIn.gain.value = 1.6;
  const post = ctx.createGain(); post.gain.value = 0.55;
  driveIn.connect(ws); ws.connect(post); post.connect(out);
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
// route a voice: panned, dry to the bus (or through the drive), plus a reverb send
function route(node, t, o) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  let last = node;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, o.pan || 0)); node.connect(p); last = p; }
  last.connect(o.drive && driveIn ? driveIn : sfxBus);
  if (o.rev && revIn) { const s = ctx.createGain(); s.gain.value = o.rev; last.connect(s); s.connect(revIn); }
}
function noise(t, dur, filterType, f0, f1, peak, q = 1, pan = 0, o = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, o.attack || 0.004, peak, dur);
  src.connect(f); f.connect(g); route(g, t, { pan, ...o });
  src.start(t, Math.random()); src.stop(t + dur + 0.08);
}
function tone(t, type, f0, f1, dur, peak, pan = 0, attack = 0.005, o = {}) {
  const osc = ctx.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain(); env(g, t, attack, peak, dur);
  let last = osc;
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q || 0.8; f.frequency.setValueAtTime(o.lp[0], t); f.frequency.exponentialRampToValueAtTime(o.lp[1], t + dur); osc.connect(f); last = f; }
  last.connect(g); route(g, t, { pan, ...o });
  osc.start(t); osc.stop(t + attack + dur + 0.08);
}
// frequency modulation: a gritty, buzzing zap
function fm(t, f0, f1, ratio, index, dur, peak, pan = 0, o = {}) {
  const car = ctx.createOscillator(); car.type = o.type || 'sine';
  const mod = ctx.createOscillator(); mod.type = 'sine';
  const mg = ctx.createGain();
  car.frequency.setValueAtTime(f0, t); car.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  mod.frequency.setValueAtTime(f0 * ratio, t); mod.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * ratio), t + dur);
  mg.gain.setValueAtTime(index, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.15), t + dur);
  mod.connect(mg); mg.connect(car.frequency);
  const g = ctx.createGain(); env(g, t, o.attack || 0.004, peak, dur);
  car.connect(g); route(g, t, { pan, ...o });
  car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
}
// a struck metal plate: a handful of inharmonic partials
function clang(t, base, dur, peak, pan = 0, o = {}) {
  for (const [r, a] of [[1, 1], [1.58, 0.7], [2.17, 0.5], [3.06, 0.35], [4.11, 0.2]]) tone(t, 'sine', base * r, base * r * 0.985, dur * (1.2 - r * 0.12), peak * a, pan, 0.002, o);
}
function sample(name, rate = 1, gain = 0.8, delay = 0) {
  const b = buffers[name];
  if (!b) return false;
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(g); g.connect(sfxBus); s.start(now() + delay);
  return true;
}

// ---- weapons
// one "pew": a bright square chirp diving down, a sine an octave under it, a fizz on top
function pew(t, f, dur, peak, pan, rev = 0.12) {
  tone(t, 'square', f, f * 0.12, dur, peak * 0.55, pan, 0.002, { lp: [9000, 1800], rev });
  tone(t, 'sine', f * 0.5, f * 0.07, dur * 1.2, peak, pan, 0.002, { rev });
  noise(t, dur * 0.5, 'highpass', 6000, 3000, peak * 0.18, 0.7, pan);
}
function laser(t, size, pan) {
  if (size >= 1.4) {
    // large laser: a charge whine, an FM crack, then a thick distorted beam that sags in pitch
    tone(t, 'sine', 380, 2200, 0.09, 0.05, pan, 0.03);
    const b = t + 0.07;
    fm(b, 2400, 160, 1.5, 900, 0.22, 0.32, pan, { rev: 0.25 });
    tone(b, 'sawtooth', 210, 62, 0.62, 0.3, pan, 0.006, { lp: [5200, 500], drive: true, rev: 0.3 });
    tone(b, 'sawtooth', 213, 64, 0.62, 0.22, pan, 0.006, { lp: [5200, 500], drive: true, detune: 12 });
    tone(b, 'square', 55, 30, 0.55, 0.3, pan, 0.01, { lp: [400, 120] });
    tone(b, 'sine', 110, 42, 0.5, 0.5, pan, 0.004);
    noise(b, 0.5, 'highpass', 7000, 2500, 0.08, 0.6, pan, { rev: 0.3 });
  } else if (size >= 1) {
    // medium laser: pew-pew
    for (let i = 0; i < 2; i++) { const s = t + i * 0.1; pew(s, rnd(1650, 1850), 0.17, 0.38, pan); fm(s, 900, 140, 2, 260, 0.14, 0.1, pan); }
  } else {
    // small laser: a quick pew-pew-pew
    for (let i = 0; i < 3; i++) pew(t + i * 0.075, rnd(2300, 2700), 0.11, 0.3, pan, 0.08);
  }
}
function cannon(t, size, pan) {
  noise(t, 0.03, 'highpass', 4000, 2000, 0.5, 0.7, pan);                         // muzzle crack
  noise(t, 0.38 * size, 'lowpass', 3200, 90, 0.85, 0.8, pan, { drive: true, rev: 0.35 });
  tone(t, 'sine', 150 / size, 34, 0.5 * size, 0.75, pan, 0.003);                 // chest thump
  tone(t, 'triangle', 90 / size, 30, 0.35 * size, 0.35, pan, 0.003, { drive: true });
  noise(t + 0.06, 0.9 * size, 'lowpass', 900, 120, 0.12, 0.6, pan, { rev: 0.4 }); // rolling echo
  tone(t + 0.22, 'square', 420, 340, 0.04, 0.05, pan, 0.002);                    // breech clack
  tone(t + 0.29, 'square', 300, 260, 0.05, 0.05, pan, 0.002);
}
function machineGun(t, pan) {
  // a long rattling burst of little pews, with brass tinkling down afterwards
  const n = 16;
  for (let i = 0; i < n; i++) {
    const s = t + i * 0.048 + rnd(0, 0.008);
    const f = rnd(820, 1100);
    tone(s, 'square', f, f * 0.25, 0.04, 0.12, pan, 0.001, { lp: [7000, 1500] });
    noise(s, 0.035, 'bandpass', 2400, 900, 0.32, 1.1, pan, { drive: true });
    tone(s, 'sine', 160, 60, 0.04, 0.12, pan, 0.001);
  }
  for (let i = 0; i < 5; i++) tone(t + 0.2 + i * 0.13 + rnd(0, 0.06), 'sine', rnd(4200, 6400), rnd(4000, 6000), 0.06, 0.02, pan + rnd(-0.2, 0.2), 0.001);
}
function rockets(t, count, pan) {
  for (let i = 0; i < count; i++) {
    const s = t + i * 0.065, p = pan + rnd(-0.25, 0.25);
    tone(s, 'sawtooth', 700, 260, 0.07, 0.08, p, 0.002);                              // launch pop
    noise(s, 0.06, 'lowpass', 2500, 400, 0.3, 0.8, p, { drive: true });
    noise(s + 0.02, rnd(0.45, 0.6), 'bandpass', 500, 3200, 0.16, 2.2, p, { rev: 0.2 }); // whoosh
  }
}

export function sfx(name, opts = {}) {
  if (!ctx || audioSettings.sfx <= 0) return;
  if (audioSettings.attract && !name.startsWith('ui-')) return;
  const t = now() + (opts.delay || 0);
  const pan = opts.pan || 0;
  const style = audioSettings.style;
  if (style !== 'modern' && AMIGA_MAP[name]) {
    const rate = name === 'plasma' ? 0.6 : name === 'boom' ? 0.55 : name === 'hit' ? 1.2 : 1;
    sample(AMIGA_MAP[name], rate * (opts.rate || 1), style === 'both' ? 0.5 : 0.9, opts.delay || 0);
    if (style === 'amiga') return;
  }
  switch (name) {
    case 'laser': laser(t, opts.size || 1, pan); break;
    case 'plasma': {
      fm(t, 120, 38, 0.5, 220, 0.6, 0.35, pan, { type: 'sawtooth', drive: true, rev: 0.3 });
      tone(t, 'sawtooth', 1900, 110, 0.42, 0.14, pan, 0.003, { lp: [8000, 600] });
      tone(t, 'sine', 70, 30, 0.6, 0.5, pan, 0.01);
      noise(t, 0.45, 'bandpass', 3400, 260, 0.25, 3, pan, { rev: 0.3 });
      break;
    }
    case 'cannon': cannon(t, opts.size || 1, pan); break;
    case 'mg': machineGun(t, pan); break;
    case 'rocket': rockets(t, Math.min(8, opts.count || 3), pan); break;
    case 'flamer': {
      noise(t, 0.85, 'lowpass', 1100, 260, 0.45, 0.6, pan, { attack: 0.06, drive: true, rev: 0.2 });
      noise(t, 0.75, 'bandpass', 2400, 700, 0.15, 2, pan, { attack: 0.04 });
      for (let i = 0; i < 6; i++) noise(t + rnd(0.1, 0.7), 0.03, 'highpass', 5000, 3000, 0.06, 1, pan);
      break;
    }
    case 'hit': {
      // shell against armour: a crunch and a ringing clang
      noise(t, 0.16, 'bandpass', 2200, 400, 0.45, 1.3, pan, { drive: true });
      clang(t, rnd(260, 420), 0.35, 0.06, pan, { rev: 0.25 });
      tone(t, 'triangle', 240, 70, 0.12, 0.22, pan, 0.002);
      break;
    }
    case 'boom': {
      const big = opts.size || 1;
      noise(t, 1.2 * big, 'lowpass', 2200, 50, 0.95, 0.6, pan, { drive: true, rev: 0.45 });
      tone(t, 'sine', 80, 22, 1.1 * big, 0.9, pan, 0.008);
      tone(t, 'triangle', 55, 25, 0.8 * big, 0.4, pan, 0.008, { drive: true });
      noise(t + 0.04, 0.5, 'highpass', 3500, 900, 0.15, 0.7, pan, { rev: 0.3 });
      for (let i = 0; i < Math.round(6 * big); i++) noise(t + rnd(0.15, 1.1 * big), rnd(0.02, 0.05), 'bandpass', rnd(900, 3000), 500, rnd(0.05, 0.12), 1.5, pan + rnd(-0.3, 0.3));
      break;
    }
    case 'step': {
      // a big clumpy footfall: hydraulic hiss and servo whine as the leg swings, then a heavy
      // ground thump, gravel crunch, a clank of metal and a rattle of debris
      const tons = opts.tons ?? Math.max(20, (1.4 - (opts.rate || 1)) * 200);
      const h = Math.max(0.2, Math.min(1.6, tons / 75));
      const g = opts.gain ?? (0.35 + tons / 110);
      const k = 1.3 - h * 0.45;
      tone(t, 'sawtooth', 150 * k, 230 * k, 0.1, 0.025 * g, pan, 0.03, { lp: [1400, 900] });
      noise(t, 0.08, 'highpass', 5000, 3500, 0.025 * g, 0.7, pan, { attack: 0.02 });
      const s = t + 0.07;
      tone(s, 'sine', 62 * k, 26, 0.28 + h * 0.22, 0.75 * g, pan, 0.004);
      tone(s, 'triangle', 95 * k, 34, 0.18 + h * 0.1, 0.3 * g, pan, 0.003, { drive: true });
      noise(s, 0.2 + h * 0.12, 'lowpass', 900, 110, 0.38 * g, 0.9, pan, { drive: true, rev: 0.18 });
      clang(s + 0.005, rnd(150, 190) * k, 0.16, 0.035 * g, pan);
      for (let i = 0; i < 3; i++) noise(s + rnd(0.04, 0.16), 0.025, 'bandpass', rnd(1800, 3200), 900, 0.05 * g, 2, pan);
      break;
    }
    case 'servo': {
      tone(t, 'sawtooth', 200, 300, 0.2, 0.05, pan, 0.03, { lp: [2000, 1200] });
      for (let i = 0; i < 5; i++) noise(t + i * 0.05, 0.02, 'bandpass', 1400, 800, 0.08 * (opts.gain || 1), 2, pan);
      break;
    }
    case 'jet': {
      noise(t, 1.0, 'lowpass', 500, 180, 0.45, 0.7, pan, { attack: 0.06, drive: true, rev: 0.2 });
      noise(t, 0.9, 'bandpass', 600, 2200, 0.22, 1.2, pan, { attack: 0.05 });
      tone(t, 'sine', 55, 40, 0.9, 0.3, pan, 0.08);
      break;
    }
    case 'melee': {
      noise(t, 0.3, 'lowpass', 1500, 70, 0.9, 1, pan, { drive: true, rev: 0.3 });
      tone(t, 'sine', 110, 32, 0.35, 0.7, pan, 0.003);
      clang(t, rnd(140, 200), 0.4, 0.07, pan, { rev: 0.3 });
      break;
    }
    case 'alarm': for (let i = 0; i < 3; i++) tone(t + i * 0.22, 'square', 880, 860, 0.12, 0.08); break;
    case 'ui-move': tone(t, 'triangle', 1400, 1300, 0.04, 0.05); break;
    case 'ui-ok': tone(t, 'triangle', 900, 1500, 0.08, 0.09); tone(t + 0.06, 'triangle', 1500, 1800, 0.08, 0.06); break;
    case 'ui-back': tone(t, 'triangle', 900, 500, 0.1, 0.08); break;
    case 'ui-err': tone(t, 'square', 200, 150, 0.15, 0.06); break;
    case 'turn': tone(t, 'sine', 520, 520, 0.12, 0.1); tone(t + 0.12, 'sine', 780, 780, 0.2, 0.1); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.14, 'triangle', f, f, 0.35, 0.12)); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.18, 'triangle', f, f * 0.98, 0.4, 0.12)); break;
    default: break;
  }
}

// --------------------------------------------------------------- music
// Two generative scores, scheduled a little ahead of time. Each mode plays into its own
// gain stage so switching modes crossfades instead of cutting off.
//  menu   — ambient electronica: slow detuned pads through a long reverb, a soft plucked
//           arpeggio echoing on a ping-pong delay, deep sub bass, glassy bells, and a light
//           pulse (kick, hats, shaker) that drifts in and out every few phrases.
//  battle — the driving minor-key loop.
let musicTimer = null, musicMode = null, step = 0, modeOut = null, mfx = null;
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function musicFx() {
  if (mfx) return mfx;
  // big soft hall
  const len = Math.floor(ctx.sampleRate * 4.5);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
  const rev = ctx.createConvolver(); rev.buffer = ir;
  const revIn = ctx.createGain(); const revOut = ctx.createGain(); revOut.gain.value = 0.9;
  revIn.connect(rev); rev.connect(revOut); revOut.connect(musicBus);
  // ping-pong dotted-eighth delay with a darkening feedback path
  const dIn = ctx.createGain();
  const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
  const fb = ctx.createGain(); fb.gain.value = 0.42;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
  const merger = ctx.createChannelMerger(2);
  dIn.connect(dl); dl.connect(dr); dr.connect(tone); tone.connect(fb); fb.connect(dl);
  dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
  const dOut = ctx.createGain(); dOut.gain.value = 0.5;
  merger.connect(dOut); dOut.connect(musicBus); dOut.connect(revIn);
  mfx = { revIn, dIn, dl, dr };
  return mfx;
}
function setDelay(beat) { const fx = musicFx(); fx.dl.delayTime.value = beat * 0.75; fx.dr.delayTime.value = beat * 0.75; }

// a note into the current mode's output, with optional reverb/delay sends
function mvoice(t, { type = 'sine', f, dur, peak, attack = 0.01, release, cutoff, q = 0.7, pan = 0, rev = 0, delay = 0, detune = 0, sweep }) {
  if (!modeOut) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = q;
  fl.frequency.setValueAtTime(cutoff || 8000, t);
  if (sweep) { fl.frequency.linearRampToValueAtTime(sweep, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(cutoff, t + dur); }
  const g = ctx.createGain();
  const rel = release ?? dur * 0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + Math.max(attack, dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  o.connect(fl); fl.connect(g);
  let last = g; if (p) { p.pan.value = pan; g.connect(p); last = p; }
  last.connect(modeOut);
  const fx = musicFx();
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s); s.connect(fx.revIn); }
  if (delay) { const s = ctx.createGain(); s.gain.value = delay; last.connect(s); s.connect(fx.dIn); }
  o.start(t); o.stop(t + dur + 0.05);
}
function mnoise(t, dur, type, f, peak, pan = 0, rev = 0) {
  if (!modeOut || !noiseBuf) return;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  s.connect(fl); fl.connect(g);
  let last = g; if (p) { p.pan.value = pan; g.connect(p); last = p; }
  last.connect(modeOut);
  if (rev) { const r = ctx.createGain(); r.gain.value = rev; last.connect(r); r.connect(musicFx().revIn); }
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function mkick(t, peak) {
  if (!modeOut) return;
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g); g.connect(modeOut); o.start(t); o.stop(t + 0.35);
}

// ---- ambient score
// chords: [bass root, pad voicing] — Am9, Fmaj9, Cmaj7/E, G6add9, with a darker turn every
// fourth phrase (Dm9, Bbmaj7#11)
const AMB = [
  [45, [57, 60, 64, 67, 71]], [41, [53, 57, 60, 64, 67]], [40, [52, 55, 59, 64, 67]], [43, [55, 59, 62, 64, 69]],
  [45, [57, 60, 64, 67, 71]], [41, [53, 57, 60, 64, 67]], [38, [50, 53, 57, 60, 64]], [46, [53, 57, 62, 64, 69]],
];
const AMB_BPM = 84, BAR = 4 * 60 / AMB_BPM, CHORD_BARS = 2;
function ambientStep(t, s) {
  // s counts 16th notes
  const s16 = 60 / AMB_BPM / 4;
  const bar = Math.floor(s / 16);
  const ci = Math.floor(bar / CHORD_BARS) % AMB.length;
  const [root, pad] = AMB[ci];
  const phrase = Math.floor(bar / 8);
  const pulse = phrase % 3 !== 0;          // the beat drops out every third phrase
  const busy = phrase % 2 === 1;
  // pads at each chord change: three detuned saws per note, slow attack, breathing filter
  if (s % (16 * CHORD_BARS) === 0) {
    const dur = BAR * CHORD_BARS + 1.6;
    pad.forEach((n, k) => {
      for (const dt of [-9, 0, 8]) mvoice(t, { type: 'sawtooth', f: midi(n), detune: dt + (Math.random() - 0.5) * 4, dur, peak: 0.012, attack: 1.4, release: 1.8, cutoff: 900 + k * 120, sweep: 1700 + k * 150, pan: (k / (pad.length - 1) - 0.5) * 0.9 + dt / 40, rev: 0.7 });
    });
    // sub bass under it
    mvoice(t, { type: 'sine', f: midi(root - 12), dur: BAR * CHORD_BARS + 0.3, peak: 0.06, attack: 0.25, release: 1.1 });
    mvoice(t, { type: 'triangle', f: midi(root), dur: BAR * CHORD_BARS, peak: 0.018, attack: 0.3, release: 0.8, cutoff: 500 });
    // an airy noise swell
    if (bar % 4 === 0) mnoise(t, BAR * 2, 'bandpass', 2400, 0.006, (Math.random() - 0.5) * 0.6, 0.8);
  }
  // plucked arpeggio: chord tones across two octaves, a walking pattern with gaps
  const arp = [...pad, ...pad.map((n) => n + 12)];
  const pat = [0, 2, 4, 3, 5, 2, 6, 4, 1, 3, 7, 5, 2, 4, 8, 6];
  const play = s % 2 === 0 ? Math.random() < (busy ? 0.85 : 0.6) : Math.random() < (busy ? 0.35 : 0.12);
  if (play && bar >= 2) {
    const n = arp[(pat[s % 16] + Math.floor(bar / 2)) % arp.length];
    const pan = Math.sin(s * 0.7) * 0.6;
    mvoice(t, { type: 'triangle', f: midi(n), dur: 0.55, peak: 0.035, attack: 0.004, release: 0.5, cutoff: 2600, pan, delay: 0.55, rev: 0.35 });
    mvoice(t, { type: 'sine', f: midi(n + 12), dur: 0.3, peak: 0.012, attack: 0.002, release: 0.28, pan: -pan, delay: 0.4 });
  }
  // glassy bells now and then
  if (s % 8 === 4 && Math.random() < 0.12) {
    const n = pad[Math.floor(Math.random() * pad.length)] + 24;
    mvoice(t, { type: 'sine', f: midi(n), dur: 2.6, peak: 0.02, attack: 0.003, release: 2.5, pan: (Math.random() - 0.5) * 1.2, delay: 0.5, rev: 0.8 });
    mvoice(t, { type: 'sine', f: midi(n) * 2.76, dur: 0.9, peak: 0.006, attack: 0.002, release: 0.85, rev: 0.6 });
  }
  // the pulse: soft kick, ticking hats, a shaker; off for the first phrase
  if (pulse && bar >= 8) {
    if (s % 4 === 0) mkick(t, s % 16 === 0 ? 0.16 : 0.1);
    if (s % 4 === 2) mnoise(t, 0.05, 'highpass', 8000, 0.03, 0.2, 0.1);
    if (s % 2 === 1) mnoise(t, 0.035, 'highpass', 9500, 0.012 + Math.random() * 0.008, -0.3);
    if (s % 16 === 12 && busy) mnoise(t, 0.18, 'bandpass', 1800, 0.035, 0, 0.5); // soft clap
  }
  return s16;
}

// ---- battle score (the driving loop)
function battleStep(t, s, mode) {
  const root = 41, stepDur = 60 / 104 / 2;
  const bar = Math.floor(s / 16) % 4;
  const prog = [0, -4, 3, -2][bar];
  if (s % 8 === 0) mvoice(t, { type: 'sawtooth', f: midi(root + prog - 12), dur: stepDur * 7.5, peak: 0.05, attack: 0.05, cutoff: 900 });
  if (s % 2 === 0) {
    const n = root + prog + SCALE[(s * 5 + bar * 3) % SCALE.length] + 12;
    if ((s * 7) % 5 !== 0) mvoice(t, { type: 'triangle', f: midi(n), dur: stepDur * 1.6, peak: 0.025, attack: 0.05, cutoff: 3000 });
  }
  if (s % 4 === 0) mkick(t, s % 16 === 0 ? 0.25 : 0.12);
  void mode;
  return stepDur;
}

export function music(mode) {
  if (!ctx) return;
  if (mode === musicMode) return;
  musicMode = mode;
  clearInterval(musicTimer);
  // fade out whatever was playing
  if (modeOut) { const old = modeOut; old.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5); setTimeout(() => old.disconnect(), 3000); modeOut = null; }
  if (!mode) return;
  modeOut = ctx.createGain(); modeOut.gain.value = 0.0001; modeOut.connect(musicBus);
  modeOut.gain.setTargetAtTime(mode === 'menu' ? 1.8 : 1, ctx.currentTime, mode === 'menu' ? 1.5 : 0.3);
  if (mode === 'menu') setDelay(60 / AMB_BPM);
  step = 0;
  let next = ctx.currentTime + 0.15;
  const out = modeOut;
  musicTimer = setInterval(() => {
    if (modeOut !== out) return;
    if (audioSettings.music <= 0) { next = ctx.currentTime + 0.1; return; }
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05; // tab was asleep
    while (next < ctx.currentTime + 0.5) {
      next += mode === 'menu' ? ambientStep(next, step) : battleStep(next, step, mode);
      step++;
    }
  }, 100);
}
// schedule `seconds` of a score in one go (offline rendering for previews and tests)
export function scoreOffline(mode, seconds) {
  if (!ctx) return;
  musicMode = mode;
  modeOut = ctx.createGain(); modeOut.connect(musicBus);
  if (mode === 'menu') setDelay(60 / AMB_BPM);
  let t = 0.1, s = 0;
  while (t < seconds) { t += mode === 'menu' ? ambientStep(t, s) : battleStep(t, s, mode); s++; }
}
