// The local battle in progress, saved so it can be resumed after closing the game.
const KEY = 'mechforce.resume';
export function loadResume() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.room && s.room.game ? s : null; } catch { return null; } }
export function saveResume(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function clearResume() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }
