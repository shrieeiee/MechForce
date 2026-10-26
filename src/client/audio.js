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
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.connect(comp);
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

let noiseBuf = null;
const now = () => ctx.currentTime;

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noise(t, dur, filterType, f0, f1, peak, q = 1, pan = 0) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, 0.005, peak, dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  src.connect(f); f.connect(g);
  if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone(t, type, f0, f1, dur, peak, pan = 0, attack = 0.005) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, attack, peak, dur);
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  o.connect(g);
  if (p) { p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
  o.start(t); o.stop(t + attack + dur + 0.05);
}
function sample(name, rate = 1, gain = 0.8, delay = 0) {
  const b = buffers[name];
  if (!b) return false;
  const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(g); g.connect(sfxBus); s.start(now() + delay);
  return true;
}

const AMIGA_MAP = { laser: 'Laser', cannon: 'Cannon', mg: 'MachineGun', rocket: 'Rocket', flamer: 'Flamer', plasma: 'Laser', melee: 'Crunch', hit: 'Crunch', boom: 'Cannon' };

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
    case 'laser': {
      const big = opts.size || 1;
      tone(t, 'sawtooth', 2400 / big, 300 / big, 0.22 * big, 0.18, pan);
      tone(t, 'sine', 1800 / big, 600 / big, 0.25 * big, 0.2, pan);
      noise(t, 0.12, 'highpass', 4000, 2000, 0.06, 1, pan);
      break;
    }
    case 'plasma': {
      tone(t, 'square', 90, 40, 0.45, 0.22, pan);
      tone(t, 'sawtooth', 1600, 120, 0.4, 0.15, pan);
      noise(t, 0.4, 'bandpass', 3000, 300, 0.25, 3, pan);
      break;
    }
    case 'cannon': {
      const big = opts.size || 1;
      noise(t, 0.35 * big, 'lowpass', 3000, 120, 0.7, 0.7, pan);
      tone(t, 'sine', 140 / big, 38, 0.35 * big, 0.6, pan);
      break;
    }
    case 'mg': {
      for (let i = 0; i < 8; i++) { noise(t + i * 0.055, 0.04, 'bandpass', 2600, 900, 0.35, 1.2, pan); tone(t + i * 0.055, 'square', 180, 60, 0.03, 0.08, pan); }
      break;
    }
    case 'rocket': {
      const n = Math.min(6, opts.count || 3);
      for (let i = 0; i < n; i++) noise(t + i * 0.07, 0.5, 'bandpass', 600, 2800, 0.18, 2, pan + (Math.random() - 0.5) * 0.3);
      break;
    }
    case 'flamer': noise(t, 0.7, 'lowpass', 900, 300, 0.35, 0.5, pan); noise(t, 0.6, 'bandpass', 2000, 800, 0.12, 2, pan); break;
    case 'hit': noise(t, 0.18, 'bandpass', 1800, 500, 0.35, 1.5, pan); tone(t, 'triangle', 300, 90, 0.12, 0.15, pan); break;
    case 'boom': {
      const big = opts.size || 1;
      noise(t, 1.1 * big, 'lowpass', 1800, 60, 0.9, 0.6, pan);
      tone(t, 'sine', 70, 25, 1.0 * big, 0.8, pan, 0.01);
      noise(t + 0.05, 0.6, 'highpass', 3000, 800, 0.12, 0.7, pan);
      break;
    }
    case 'step': tone(t, 'sine', 70 * (opts.rate || 1), 35, 0.16, 0.35 * (opts.gain || 1), pan); noise(t, 0.08, 'lowpass', 600, 120, 0.12 * (opts.gain || 1), 1, pan); break;
    case 'servo': tone(t, 'sawtooth', 220, 330, 0.18, 0.04, pan, 0.03); break;
    case 'jet': noise(t, 0.9, 'bandpass', 500, 1600, 0.3, 0.8, pan); break;
    case 'melee': noise(t, 0.25, 'lowpass', 1200, 80, 0.8, 1, pan); tone(t, 'sine', 120, 40, 0.25, 0.6, pan); break;
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
let musicTimer = null, musicMode = null, step = 0;
const SCALE = [0, 3, 5, 7, 10, 12, 15];
export function music(mode) {
  if (!ctx) return;
  if (mode === musicMode) return;
  musicMode = mode;
  clearInterval(musicTimer);
  if (!mode) return;
  const root = mode === 'battle' ? 41 : 45;
  const bpm = mode === 'battle' ? 104 : 76;
  const stepDur = 60 / bpm / 2;
  let next = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (audioSettings.music <= 0) { next = ctx.currentTime + 0.1; return; }
    while (next < ctx.currentTime + 0.4) {
      const bar = Math.floor(step / 16) % 4;
      const prog = [0, -4, 3, -2][bar];
      const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
      if (step % 8 === 0) mtone(next, 'sawtooth', midi(root + prog - 12), stepDur * 7.5, 0.05, 900);
      if (step % 2 === 0) {
        const n = root + prog + SCALE[(step * 5 + bar * 3) % SCALE.length] + 12;
        if ((step * 7) % 5 !== 0) mtone(next, 'triangle', midi(n), stepDur * 1.6, 0.025, 3000);
      }
      if (mode === 'battle' && step % 4 === 0) mkick(next, step % 16 === 0 ? 0.25 : 0.12);
      next += stepDur;
      step++;
    }
  }, 120);
}
function mtone(t, type, f, dur, peak, cutoff) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.1);
}
function mkick(t, peak) {
  const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
  const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.3);
}
