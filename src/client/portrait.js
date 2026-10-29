// Procedural MechWarrior portraits: an SVG head and shoulders from a handful of feature
// numbers, so a pilot's face travels with them as a few bytes.
const SKIN = ['#f6d3b8', '#eec19d', '#d9a77f', '#c18a5f', '#a26c44', '#83542f', '#6a3f22', '#4b2b17'];
const HAIR = ['#141414', '#3b2416', '#6b4423', '#a0703a', '#d9b56b', '#b5432a', '#9da3a8', '#e8e3d6'];
const BG = [['#24323d', '#0f161c'], ['#3a2a1a', '#140e09'], ['#1d3527', '#0b140f'], ['#33233a', '#120c16'], ['#3b1f1f', '#160b0b'], ['#28303a', '#0c0f12']];
export const PORTRAIT_PARTS = {
  skin: { name: 'Skin', n: SKIN.length }, face: { name: 'Face', n: 4 }, hair: { name: 'Hair', n: 10 }, hairColor: { name: 'Hair colour', n: HAIR.length },
  eyes: { name: 'Eyes', n: 6 }, brows: { name: 'Brows', n: 4 }, mouth: { name: 'Mouth', n: 5 }, beard: { name: 'Beard', n: 5 },
  extra: { name: 'Marks', n: 8 }, helmet: { name: 'Headgear', n: 4 }, bg: { name: 'Background', n: BG.length },
};
let uid = 0;
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((c) => c.toString(16).padStart(2, '0')).join('');
};

export function portraitSVG(p = {}, { size = 96, color = '#d9a441', dead = false, cls = '' } = {}) {
  const g = (k) => ((p[k] | 0) % PORTRAIT_PARTS[k].n + PORTRAIT_PARTS[k].n) % PORTRAIT_PARTS[k].n;
  const id = 'pt' + (uid++);
  const skin = SKIN[g('skin')], skinD = shade(skin, 0.82), hair = HAIR[g('hairColor')], hairD = shade(hair, 0.7);
  const [b0, b1] = BG[g('bg')];
  const face = g('face');
  // head geometry per face shape: [rx, ry, jaw]
  const [rx, ry, jaw] = [[17, 21, 0], [18, 20, 4], [19, 19, 2], [16, 23, 1]][face];
  const cx = 50, cy = 52;
  const parts = [];
  // shoulders: flight suit / cooling vest in the side colour
  const body = [];
  body.push(`<path d="M2 120 C4 98 20 88 34 85 L66 85 C80 88 96 98 98 120 Z" fill="#2a3138"/>`);
  body.push(`<path d="M20 120 C22 103 30 94 39 90 L61 90 C70 94 78 103 80 120 Z" fill="${color}" opacity=".85"/>`);
  body.push(`<path d="M28 104 h44 M25 112 h50" stroke="#11161b" stroke-width="2" opacity=".5"/>`);
  body.push(`<path d="M40 74 L60 74 L62 92 Q50 98 38 92 Z" fill="${skinD}"/>`);
  // hair behind the head (long styles)
  const hs = g('hair');
  if (hs === 5) parts.push(`<path d="M${cx - rx - 3} ${cy - 4} C${cx - rx - 6} ${cy + 26} ${cx - rx} ${cy + 34} ${cx - 8} ${cy + 30} L${cx + 8} ${cy + 30} C${cx + rx} ${cy + 34} ${cx + rx + 6} ${cy + 26} ${cx + rx + 3} ${cy - 4} Z" fill="${hairD}"/>`);
  if (hs === 6) parts.push(`<path d="M${cx + rx - 4} ${cy - 6} q12 10 6 34 q-3 6 -8 2 q3 -18 -4 -30 Z" fill="${hairD}"/>`);
  // head
  parts.push(`<path d="M${cx - rx} ${cy - 2} C${cx - rx} ${cy - ry - 4} ${cx + rx} ${cy - ry - 4} ${cx + rx} ${cy - 2} C${cx + rx} ${cy + ry * 0.6} ${cx + 6 + jaw} ${cy + ry} ${cx} ${cy + ry} C${cx - 6 - jaw} ${cy + ry} ${cx - rx} ${cy + ry * 0.6} ${cx - rx} ${cy - 2} Z" fill="url(#${id}s)"/>`);
  parts.push(`<ellipse cx="${cx - rx + 1}" cy="${cy + 2}" rx="3" ry="5" fill="${skinD}"/><ellipse cx="${cx + rx - 1}" cy="${cy + 2}" rx="3" ry="5" fill="${skinD}"/>`);
  // beard under features
  const bd = g('beard');
  if (bd === 1) parts.push(`<path d="M${cx - rx + 4} ${cy + 8} C${cx - rx + 6} ${cy + ry} ${cx + rx - 6} ${cy + ry} ${cx + rx - 4} ${cy + 8} C${cx + 6} ${cy + ry - 2} ${cx - 6} ${cy + ry - 2} ${cx - rx + 4} ${cy + 8} Z" fill="${hairD}" opacity=".35"/>`);
  if (bd === 2) parts.push(`<path d="M${cx - 6} ${cy + 15} q6 10 12 0 q-2 8 -6 9 q-4 -1 -6 -9 Z" fill="${hair}"/>`);
  if (bd === 3) parts.push(`<path d="M${cx - rx + 2} ${cy + 4} C${cx - rx + 2} ${cy + ry + 6} ${cx + rx - 2} ${cy + ry + 6} ${cx + rx - 2} ${cy + 4} C${cx + rx - 8} ${cy + 14} ${cx - rx + 8} ${cy + 14} ${cx - rx + 2} ${cy + 4} Z" fill="${hair}"/>`);
  if (bd === 4 || bd === 3) parts.push(`<path d="M${cx - 9} ${cy + 12} q9 -5 18 0 q-9 2 -18 0 Z" fill="${hair}"/>`);
  // eyes
  const ey = cy + 1, ex = 7.5;
  const eye = (x, kind) => {
    if (kind === 3 && x > cx) return `<circle cx="${x}" cy="${ey}" r="3.2" fill="#2b2f33"/><circle cx="${x}" cy="${ey}" r="1.8" fill="#ff4b3a"/><circle cx="${x}" cy="${ey}" r="3.6" fill="none" stroke="#9aa3ad" stroke-width="1"/>`;
    if (kind === 4 && x < cx) return `<ellipse cx="${x}" cy="${ey}" rx="4.2" ry="3.4" fill="#151515"/><path d="M${x - 4} ${ey - 3} L${cx + rx} ${cy - 10}" stroke="#151515" stroke-width="1.2"/>`;
    const ry2 = kind === 1 ? 1.2 : kind === 2 ? 2.4 : 1.8;
    return `<ellipse cx="${x}" cy="${ey}" rx="3" ry="${ry2}" fill="#f4f1ea"/><circle cx="${x + 0.3}" cy="${ey}" r="${Math.min(1.6, ry2)}" fill="#2a2420"/>`;
  };
  const ek = g('eyes');
  parts.push(eye(cx - ex, ek), eye(cx + ex, ek));
  if (ek === 5) parts.push(`<rect x="${cx - 14}" y="${ey - 4}" width="28" height="7" rx="3" fill="#7fd1ff" opacity=".55" stroke="#2b3238" stroke-width="1.4"/>`);
  // brows
  const bw = g('brows');
  const brow = (x, dir) => {
    const tilt = [0, 1.6, -1.2, 0][bw] * dir;
    const th = bw === 3 ? 2.6 : 1.6;
    return `<path d="M${x - 4} ${ey - 5 + tilt} L${x + 4} ${ey - 5 - tilt}" stroke="${hairD}" stroke-width="${th}" stroke-linecap="round"/>`;
  };
  parts.push(brow(cx - ex, -1), brow(cx + ex, 1));
  // nose
  parts.push(`<path d="M${cx} ${ey + 2} q-2.6 6 -1 8 q1 .8 3 0" fill="none" stroke="${skinD}" stroke-width="1.3" stroke-linecap="round"/>`);
  // mouth
  const my = cy + 14, mk = g('mouth');
  const mouths = [`M${cx - 5} ${my} h10`, `M${cx - 6} ${my - 1} q6 5 12 0`, `M${cx - 5} ${my} q6 1 9 -3`, `M${cx - 5} ${my + 1} q5 -4 10 0`, `M${cx - 6} ${my} h12`];
  parts.push(`<path d="${mouths[mk]}" fill="none" stroke="#5b2f27" stroke-width="${mk === 4 ? 2.2 : 1.6}" stroke-linecap="round"/>`);
  // marks
  const xk = g('extra');
  if (xk === 1) parts.push(`<path d="M${cx + 9} ${cy + 6} l6 7 M${cx + 11} ${cy + 7} l-1 2 M${cx + 13} ${cy + 10} l-1 2" stroke="#8b3b33" stroke-width="1.2" opacity=".8"/>`);
  if (xk === 2) parts.push(`<path d="M${cx - ex - 2} ${ey - 9} l3 16" stroke="#8b3b33" stroke-width="1.4" opacity=".8"/>`);
  if (xk === 3) for (let i = 0; i < 9; i++) parts.push(`<circle cx="${cx - 12 + (i % 5) * 6 + (i > 4 ? 3 : 0)}" cy="${ey + 6 + (i > 4 ? 2 : 0)}" r=".8" fill="${shade(skin, 0.6)}"/>`);
  if (xk === 4) parts.push(`<path d="M${cx - rx + 3} ${cy + 2} l4 -3 l2 4 l3 -3" fill="none" stroke="#2c4a6b" stroke-width="1.3"/>`);
  if (xk === 6) parts.push(`<circle cx="${cx + rx}" cy="${cy + 8}" r="1.6" fill="#e2c35a"/>`);
  if (xk === 7) parts.push(`<path d="M${cx - 8} ${cy + ry - 4} q8 5 16 0 l0 3 q-8 5 -16 0 Z" fill="#8c959d" stroke="#555" stroke-width=".8"/>`);
  // hair on top
  const top = cy - ry - 2;
  const hairTop = [
    '',
    `<path d="M${cx - rx} ${cy - 6} C${cx - rx} ${top - 2} ${cx + rx} ${top - 2} ${cx + rx} ${cy - 6} C${cx + 8} ${top + 6} ${cx - 8} ${top + 6} ${cx - rx} ${cy - 6} Z" fill="${hair}" opacity=".8"/>`,
    `<path d="M${cx - rx - 1} ${cy - 2} C${cx - rx - 3} ${top - 6} ${cx + rx + 3} ${top - 6} ${cx + rx + 1} ${cy - 2} C${cx + rx - 2} ${top + 8} ${cx - rx + 6} ${top + 10} ${cx - rx - 1} ${cy - 2} Z" fill="${hair}"/>`,
    `<path d="M${cx - rx - 1} ${cy} C${cx - rx - 4} ${top - 6} ${cx + rx + 4} ${top - 6} ${cx + rx + 1} ${cy} C${cx + rx} ${top + 8} ${cx - 2} ${top + 4} ${cx - 6} ${top + 10} C${cx - 10} ${top + 6} ${cx - rx + 2} ${top + 10} ${cx - rx - 1} ${cy} Z" fill="${hair}"/>`,
    `<path d="M${cx - 4} ${top + 8} C${cx - 5} ${top - 10} ${cx + 5} ${top - 10} ${cx + 4} ${top + 8} Z" fill="${hair}"/><path d="M${cx - rx} ${cy - 4} C${cx - rx} ${top} ${cx + rx} ${top} ${cx + rx} ${cy - 4}" fill="none" stroke="${hairD}" stroke-width="1" opacity=".4"/>`,
    `<path d="M${cx - rx - 2} ${cy + 4} C${cx - rx - 5} ${top - 7} ${cx + rx + 5} ${top - 7} ${cx + rx + 2} ${cy + 4} C${cx + rx - 3} ${top + 10} ${cx - rx + 3} ${top + 10} ${cx - rx - 2} ${cy + 4} Z" fill="${hair}"/>`,
    `<path d="M${cx - rx - 1} ${cy - 2} C${cx - rx - 3} ${top - 6} ${cx + rx + 3} ${top - 6} ${cx + rx + 1} ${cy - 2} C${cx + 6} ${top + 7} ${cx - 6} ${top + 7} ${cx - rx - 1} ${cy - 2} Z" fill="${hair}"/>`,
    `<path d="M${cx - rx - 1} ${cy - 2} C${cx - rx - 3} ${top - 6} ${cx + rx + 3} ${top - 6} ${cx + rx + 1} ${cy - 2} C${cx + 6} ${top + 7} ${cx - 6} ${top + 7} ${cx - rx - 1} ${cy - 2} Z" fill="${hair}"/><circle cx="${cx}" cy="${top - 4}" r="7" fill="${hair}"/>`,
    Array.from({ length: 11 }, (_, i) => `<circle cx="${cx - rx + 2 + i * (rx * 2 - 4) / 10}" cy="${top + 2 + Math.abs(i - 5) * 1.6}" r="5.5" fill="${hair}"/>`).join(''),
    `<rect x="${cx - rx + 1}" y="${top - 7}" width="${rx * 2 - 2}" height="13" rx="2" fill="${hair}"/>`,
  ][hs];
  parts.push(hairTop);
  // headgear
  const hm = g('helmet');
  if (hm === 1) parts.push(`<path d="M${cx - rx - 2} ${cy - 4} C${cx - rx - 2} ${top - 8} ${cx + rx + 2} ${top - 8} ${cx + rx + 2} ${cy - 4} Z" fill="#3b4650"/><path d="M${cx - rx - 2} ${cy - 5} h${rx * 2 + 4}" stroke="${color}" stroke-width="2.4"/><rect x="${cx + rx - 1}" y="${cy - 2}" width="5" height="9" rx="2" fill="#2b3238"/><path d="M${cx + rx + 2} ${cy + 6} q-4 10 -16 9" fill="none" stroke="#2b3238" stroke-width="1.6"/>`);
  if (hm === 2 || hm === 3) {
    // neurohelmet: a bulky shell with sensor pads
    parts.push(`<path d="M${cx - rx - 6} ${cy + 6} C${cx - rx - 8} ${top - 12} ${cx + rx + 8} ${top - 12} ${cx + rx + 6} ${cy + 6} L${cx + rx + 2} ${cy + 8} L${cx + rx + 1} ${cy - 6} C${cx + 6} ${top + 2} ${cx - 6} ${top + 2} ${cx - rx - 1} ${cy - 6} L${cx - rx - 2} ${cy + 8} Z" fill="url(#${id}h)" stroke="#1b2126" stroke-width="1"/>`);
    parts.push(`<rect x="${cx - 3}" y="${top - 9}" width="6" height="8" rx="1.5" fill="${color}"/><circle cx="${cx - rx - 3}" cy="${cy}" r="3" fill="#1b2126"/><circle cx="${cx + rx + 3}" cy="${cy}" r="3" fill="#1b2126"/>`);
    if (hm === 3) parts.push(`<path d="M${cx - rx} ${cy - 8} C${cx - rx} ${top - 6} ${cx + rx} ${top - 6} ${cx + rx} ${cy - 8} Z" fill="#7fd1ff" opacity=".35" stroke="#2b3238" stroke-width="1.2"/>`);
  }
  if (xk === 5) parts.push(`<path d="M${cx - rx - 2} ${cy - 2} q-3 14 10 17" fill="none" stroke="#2b3238" stroke-width="1.8"/><circle cx="${cx - rx + 9}" cy="${cy + 15}" r="1.8" fill="#2b3238"/>`);
  return `<svg class="portrait ${cls}${dead ? ' dead' : ''}" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" role="img" aria-label="Pilot portrait">
    <defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b0}"/><stop offset="1" stop-color="${b1}"/></linearGradient>
    <radialGradient id="${id}s" cx=".42" cy=".38" r=".75"><stop offset="0" stop-color="${shade(skin, 1.05)}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
    <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d6a75"/><stop offset="1" stop-color="#2c343b"/></linearGradient></defs>
    <rect width="100" height="120" fill="url(#${id}b)"/>${body.join('')}<g transform="translate(50 50) scale(1.22) translate(-50 -54)">${parts.join('')}</g>
    ${dead ? '<rect width="100" height="120" fill="#000" opacity=".45"/><path d="M0 120 L100 0" stroke="#c0392b" stroke-width="3" opacity=".7"/>' : ''}</svg>`;
}
