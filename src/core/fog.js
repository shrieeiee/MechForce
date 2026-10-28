// Fog of war views. The host keeps the full game; each player is sent a copy with the enemy
// mechs their team can't see taken off the map (x = y = -1, hidden: true) and a "ghost" of
// where they were last seen, and the event list for that update is trimmed to what they
// could have watched. The same functions run on a hotseat device for whoever's turn it is.
import { visibleTo, hexSeenBy } from './rules.js';

// The teams a client looks through: one team, or none (spectator / hotseat across teams)
export function viewTeams(st, clientId) {
  const teams = new Set(st.sides.map((s, i) => (s.ctrl === clientId ? s.team ?? i : -1)).filter((t) => t >= 0));
  return [...teams];
}

const seenBy = (st, teams, m) => teams.some((t) => visibleTo(st, t, m));

export function fogView(st, teams) {
  if (!st || !st.fog || st.over || !teams || !teams.length) return st; // everything is revealed when the battle ends
  const v = JSON.parse(JSON.stringify(st));
  const hidden = new Set();
  for (const m of st.mechs) if (!seenBy(st, teams, m)) hidden.add(m.id);
  // memory: only the viewer's own team's sightings
  const seen = {};
  for (const t of teams) if (st.seen && st.seen[t]) seen[t] = st.seen[t];
  v.seen = seen;
  for (const m of v.mechs) {
    if (!hidden.has(m.id)) { delete m.ghost; continue; }
    let ghost = null;
    for (const t of teams) { const g = seen[t] && seen[t][m.id]; if (g && (!ghost || g.r > ghost.r)) ghost = g; }
    // if we can see that spot now and it's empty, the sighting is out of date
    if (ghost && teams.some((t) => hexSeenBy(st, t, ghost.x, ghost.y))) ghost = null;
    m.hidden = true;
    m.ghost = ghost;
    m.x = -1; m.y = -1;
    m.lastMove = { mode: 'stand', hexes: 0 };
  }
  // battle log: drop lines about mechs the viewer can't see now
  if (v.logIds && v.logIds.length === v.log.length) {
    const keep = v.logIds.map((id) => id < 0 || !hidden.has(id));
    v.log = v.log.filter((_, i) => keep[i]); v.logIds = v.logIds.filter((_, i) => keep[i]);
  }
  // an objective carried out of sight goes with its carrier
  if (v.item && v.item.carrier !== null && v.item.carrier !== undefined && hidden.has(v.item.carrier)) { v.item.x = -1; v.item.y = -1; v.item.hiddenCarrier = true; }
  return v;
}

// Trim an update's events to what the viewer saw. `st` is the full state after the update.
export function fogEvents(st, events, teams) {
  if (!st || !st.fog || !teams || !teams.length) return events;
  const vis = new Map(st.mechs.map((m) => [m.id, seenBy(st, teams, m)]));
  const ownTeam = (m) => teams.includes(m.team ?? m.side);
  const out = [];
  for (const e of events) {
    if (e.k === 'sshot') { const t = st.mechs[e.target]; if (!t || ownTeam(t) || vis.get(t.id)) out.push(e); continue; }
    const m = e.id !== undefined ? st.mechs[e.id] : null;
    if (!m || ownTeam(m)) { out.push(e); continue; }
    if (e.k === 'move') {
      // keep only the hexes of the move one of our mechs could see
      const path = e.path.filter((p) => teams.some((t) => hexSeenBy(st, t, p.x, p.y, m.id)));
      if (!path.length) continue;
      out.push({ ...e, path, appear: path[0] !== e.path[0], vanish: path[path.length - 1] !== e.path[e.path.length - 1] });
      continue;
    }
    if (e.k === 'destroyed' || e.k === 'win') { out.push(e); continue; }
    if (e.k === 'shot' && e.starget !== undefined) { if (vis.get(e.id)) out.push(e); continue; }
    if (e.k === 'shot' || e.k === 'melee') { const t = st.mechs[e.target]; if (vis.get(e.id) && t && vis.get(t.id)) out.push(e); continue; }
    if (vis.get(e.id)) out.push(e);
  }
  return out;
}
