// The last few battle replays, kept on this device.
import { validReplay } from '../core/replay.js';

const KEY = 'mechforce.replays';
export const MAX_REPLAYS = 10;
export function loadReplays() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(validReplay) : []; } catch { return []; }
}
export function saveReplay(rep) {
  if (!validReplay(rep)) return false;
  let list = loadReplays().filter((r) => !(r.at === rep.at && r.title === rep.title));
  list.unshift(rep);
  list = list.slice(0, MAX_REPLAYS);
  // drop the oldest until it fits
  while (list.length) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { list.pop(); } }
  return false;
}
export function deleteReplay(i) { const list = loadReplays(); list.splice(i, 1); try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} }
