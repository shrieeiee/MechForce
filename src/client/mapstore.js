// Battlefields made in the map editor, kept on this device.
import { sanitizeMap } from '../core/maps.js';

const KEY = 'mechforce.maps';
export function loadMaps() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.map(sanitizeMap).filter(Boolean) : []; } catch { return []; }
}
function store(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
export function saveMap(map) {
  const m = sanitizeMap(map);
  if (!m) return false;
  const list = loadMaps().filter((x) => x.name !== m.name);
  list.unshift(m);
  return store(list.slice(0, 50));
}
export function deleteMap(name) { return store(loadMaps().filter((x) => x.name !== name)); }
