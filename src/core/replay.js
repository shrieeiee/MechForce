// Battle replays. A battle is fully decided by its starting state (which carries the dice
// seed) and the list of commands each side gave, so a replay is just those two things.
// Played back, the same rules produce the same events and the same states, move for move.
import { applyCommand } from './rules.js';

const jclone = (o) => JSON.parse(JSON.stringify(o));
export const REPLAY_VERSION = 1;

export function startReplay(game) { return { v: REPLAY_VERSION, start: jclone(game), cmds: [] }; }
export function recordCmd(rep, side, cmd) { if (rep) rep.cmds.push([side, jclone(cmd)]); }

export function replayTitle(st) {
  const sides = st.sides.map((s) => s.name).join(' vs ');
  return `${sides} · ${st.mission}`;
}
export function finishReplay(rep, game, meta = {}) {
  const w = game.winner;
  return { ...rep, title: meta.title || replayTitle(game), at: Date.now(), rounds: game.round, winner: w ? (w.side ?? w.team ?? -1) : -1, reason: w ? w.reason : '', version: meta.version || '' };
}

// a light check of a replay file someone loaded
export function validReplay(r) {
  return !!(r && r.v === REPLAY_VERSION && r.start && Array.isArray(r.start.mechs) && Array.isArray(r.cmds) && r.cmds.every((c) => Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && c[1] && typeof c[1] === 'object'));
}

// Step through a replay: player.step() applies the next command and returns its events
export function replayPlayer(rep) {
  const st = jclone(rep.start);
  let i = 0;
  return {
    state: st,
    get index() { return i; },
    get length() { return rep.cmds.length; },
    done() { return i >= rep.cmds.length || st.over; },
    step() {
      if (this.done()) return null;
      const [side, cmd] = rep.cmds[i++];
      const r = applyCommand(st, side, jclone(cmd));
      return { events: r.ok ? r.events : [], ok: r.ok, error: r.error };
    },
  };
}
