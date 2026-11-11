// Team colours as the viewer sees them. The game state carries the standard colours; with
// colour-blind mode on they're swapped, on this device only, for a palette that stays
// distinct with red-green colour blindness (after Okabe & Ito), and every side also gets
// its own shape — on its mechs' base rings and labels — so colour is never the only cue.
import { SIDE_COLORS } from '../core/data.js';

export const PALETTES = {
  standard: SIDE_COLORS,
  colorblind: ['#56b4e9', '#e69f00', '#f0e442', '#e07bc4'],
};
export const SHAPES = ['●', '▲', '■', '◆'];
export const RING_SEGMENTS = [6, 3, 4, 8];
export const view = { palette: 'standard', shapes: false };

const lookup = new Map();
for (const pal of Object.values(PALETTES)) pal.forEach((c, i) => lookup.set(c.toLowerCase(), i));
export function displayColor(c) {
  if (!c) return c;
  const i = lookup.get(String(c).toLowerCase());
  return i === undefined ? c : PALETTES[view.palette][i];
}
// recolour a game state (or lobby) for display; harmless to repeat
export function paint(st) {
  if (!st) return st;
  for (const s of st.sides || []) s.color = displayColor(s.color);
  for (const t of st.teams || []) if (t) t.color = displayColor(t.color);
  for (const s of st.slots || []) s.color = displayColor(s.color);
  return st;
}
export const shapeFor = (i) => (view.shapes && i >= 0 ? SHAPES[i % 4] : '');
