// The player's MechWarriors, kept on this device.
const KEY = 'mechforce.pilots';
const DONE = 'mechforce.pilots.battles';
export const MAX_ROSTER = 24;
export function loadRoster() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((p) => p && p.id) : []; } catch { return []; }
}
export function saveRoster(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
export const fitPilots = (list = loadRoster()) => list.filter((p) => !p.dead && !(p.rest > 0));
// battles already applied to the roster (so a reload or a second viewer can't count one twice)
export function battleDone(gid) { try { return JSON.parse(localStorage.getItem(DONE) || '[]').includes(gid); } catch { return false; } }
export function markBattle(gid) { try { const a = JSON.parse(localStorage.getItem(DONE) || '[]'); a.unshift(gid); localStorage.setItem(DONE, JSON.stringify(a.slice(0, 60))); } catch { /* storage unavailable */ } }
