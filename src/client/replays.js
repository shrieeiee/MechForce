// Replays: the list of saved battles, and a viewer that plays one back on the battlefield
// with pause, speed and skip controls. Everything is shown — there's no fog in a replay.
import { replayPlayer, validReplay } from '../core/replay.js';
import { MISSIONS } from '../core/data.js';
import { $, $$, html, esc, toast, banner } from './ui.js';
import { sfx, music } from './audio.js';
import { loadReplays, saveReplay, deleteReplay, MAX_REPLAYS } from './replaystore.js';
import { saveFile, openFile, toCode, fromCode, copyText } from './files.js';

const missionName = (id) => (MISSIONS.find((m) => m.id === id) || { name: id }).name;
const describe = (r) => {
  const st = r.start;
  const sides = st.sides.map((s, i) => `<span style="color:${s.color}">${esc(s.name)}${r.winner === i ? ' ★' : ''}</span>`).join(' vs ');
  return `<span class="rp-sides">${sides}</span><span class="val">${esc(missionName(st.mission))} · ${r.rounds} rounds · ${new Date(r.at).toLocaleString()}</span>`;
};

export function showReplays(app, { onExit } = {}) {
  let sel = 0;
  const render = () => {
    const list = loadReplays();
    const el = html(`<div class="screen replays">
      <div class="screen-head"><div><div class="eyebrow">Replays</div><h2>Watch your battles again</h2></div><div class="spacer"></div>
        <div class="dim">${list.length ? `${list.length} saved · ` : ''}your last ${MAX_REPLAYS} battles are kept on this device</div></div>
      <div class="panel pad stack rp-list">${list.length ? '' : '<div class="faint">No replays yet. Every battle you finish is saved here automatically.</div>'}</div>
      <div class="row wrap rp-actions">
        <div class="btn nav" data-key="open">Open replay file…</div>
        <div class="btn nav" data-key="paste">Paste replay code…</div>
        <div class="btn nav" data-key="back">Back</div></div></div>`);
    const box = $('.rp-list', el);
    list.forEach((r, i) => {
      const row = html(`<div class="row rp-row ${i === sel ? 'sel' : ''}">
        <div class="btn nav grow" data-key="watch-${i}">${describe(r)}</div>
        <div class="btn nav" data-key="file-${i}" title="Save as a file">Save</div>
        <div class="btn nav" data-key="code-${i}" title="Copy as a text code">Code</div>
        <div class="btn nav" data-key="del-${i}" title="Delete">Delete</div></div>`);
      $(`[data-key=watch-${i}]`, row).addEventListener('click', () => watchReplay(app, r, { onExit: () => showReplays(app, { onExit }) }));
      $(`[data-key=file-${i}]`, row).addEventListener('click', async () => {
        const res = await saveFile(`mechforce-replay-${new Date(r.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mfreplay`, r);
        toast(res === 'saved' ? 'Replay saved' : res === 'copied' ? 'Replay code copied — paste it on another device' : 'Couldn\'t save the replay', res !== 'failed');
      });
      $(`[data-key=code-${i}]`, row).addEventListener('click', async () => { toast((await copyText(await toCode(r))) ? 'Replay code copied' : 'Couldn\'t copy', true); });
      $(`[data-key=del-${i}]`, row).addEventListener('click', () => {
        if (row.dataset.arm) { deleteReplay(i); sel = 0; render(); return; }
        row.dataset.arm = '1'; toast('Press Delete again to remove this replay');
      });
      box.appendChild(row);
    });
    const add = (r) => {
      if (!validReplay(r)) { toast('That isn\'t a MechForce replay'); return; }
      saveReplay(r); sel = 0; render(); toast('Replay added', true);
    };
    $('[data-key=open]', el).addEventListener('click', async () => { try { const r = await openFile(); if (r) add(r); } catch (e) { toast(e.message); } });
    $('[data-key=paste]', el).addEventListener('click', () => pasteDialog(app, 'Paste a replay code', async (code) => add(await fromCode(code))));
    $('[data-key=back]', el).addEventListener('click', () => onExit());
    app.mount(el, [{ a: 'confirm', label: 'Watch' }, { a: 'back', label: 'Back' }]);
  };
  app.setScreen('replays', render, null, () => onExit());
}

// a small dialog with a text box for pasting codes
export function pasteDialog(app, title, onCode) {
  const el = html(`<div class="panel pad stack modal paste-dlg"><div class="eyebrow">${esc(title)}</div>
    <textarea class="code-in" rows="5" placeholder="MF1…" spellcheck="false"></textarea>
    <div class="row"><div class="btn primary nav" data-key="ok">Load</div><div class="btn nav" data-key="cancel">Cancel</div></div></div>`);
  const ta = $('textarea', el);
  $('[data-key=ok]', el).addEventListener('click', async () => {
    try { await onCode(ta.value); app.closeModal(); } catch (e) { toast(e.message || 'That code didn\'t work'); }
  });
  $('[data-key=cancel]', el).addEventListener('click', () => app.closeModal());
  app.openModal(el, { onBack: () => app.closeModal(), menuCloses: false, prompts: [{ a: 'back', label: 'Cancel' }] });
  setTimeout(() => ta.focus(), 50);
}

// ---- the viewer
const SPEEDS = [1, 2, 4, 8];
export function watchReplay(app, rep, { onExit } = {}) {
  const r = app.renderer;
  app.stopAttract();
  app.endSession && app.endSession();
  music('battle');
  let pl = replayPlayer(rep);
  let playing = true, speedI = 1, busy = false, stopped = false, skipTo = null;
  const oldSpeed = r.speed;
  const setup = () => {
    r.buildMap(pl.state.map);
    r.syncMechs(pl.state); r.syncStructures(pl.state); r.syncUnits(pl.state); r.setEnvironment(pl.state);
    const mm = pl.state.mechs.filter((m) => m.x >= 0);
    if (mm.length) r.focusHex(Math.round(mm.reduce((a, m) => a + m.x, 0) / mm.length), Math.round(mm.reduce((a, m) => a + m.y, 0) / mm.length));
    r.cam.wantDist = 24; r.cam.pitch = 0.75;
  };
  const hudHTML = () => {
    const st = pl.state;
    const lines = (st.log || []).slice(-5).map((l) => `<div>${esc(typeof l === 'string' ? l : l.text)}</div>`).join('');
    const sides = st.sides.map((s, i) => { const alive = st.mechs.filter((m) => m.side === i && !m.dead && !m.exited).length; return `<span style="color:${s.color}"><b>${esc(s.name)}</b> ${alive}</span>`; }).join(' · ');
    return `<div class="rp-top panel"><div class="eyebrow">Replay · ${esc(missionName(st.mission))}</div>
        <div class="rp-line">Round ${st.round} · move ${pl.index} / ${pl.length} · ${sides}</div>
        <div class="rp-bar"><span style="width:${(pl.index / Math.max(1, pl.length) * 100).toFixed(1)}%"></span></div>
        <div class="row rp-ctl">
          <div class="btn sm" data-act="restart">⟲ Restart</div>
          <div class="btn sm primary" data-act="play">${playing ? '❚❚ Pause' : '▶ Play'}</div>
          <div class="btn sm" data-act="step">Step</div>
          <div class="btn sm" data-act="round">Next round ⏭</div>
          <div class="btn sm" data-act="speed">${SPEEDS[speedI]}×</div>
          <div class="btn sm" data-act="exit">Exit</div></div>
        ${st.over && pl.done() ? `<div class="rp-end">${esc(st.winner ? st.winner.reason || 'Battle over' : 'Battle over')}</div>` : ''}</div>
      <div class="rp-log panel">${lines}</div>`;
  };
  let root = null;
  const render = () => {
    root = html(`<div class="replay-hud">${hudHTML()}</div>`);
    wire(root);
    app.mount(root, [{ a: 'confirm', label: playing ? 'Pause' : 'Play' }, { a: 'rb', label: 'Next round' }, { a: 'y', label: 'Speed' }, { a: 'lb', label: 'Restart' }, { a: 'back', label: 'Exit' }]);
  };
  const refresh = () => { if (!root) return; root.innerHTML = hudHTML(); wire(root); };
  const wire = (el) => {
    const act = { play: togglePlay, step: () => { playing = false; refresh(); advance(true); }, round: nextRound, speed: cycleSpeed, restart, exit };
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => { sfx('ui-ok'); act[b.dataset.act](); }));
  };
  const togglePlay = () => { playing = !playing; refresh(); if (playing) loop(); };
  const cycleSpeed = () => { speedI = (speedI + 1) % SPEEDS.length; r.speed = SPEEDS[speedI]; refresh(); };
  const nextRound = () => { skipTo = pl.state.round + 1; if (!playing) { playing = true; loop(); } refresh(); };
  const restart = () => { pl = replayPlayer(rep); skipTo = null; setup(); playing = true; refresh(); loop(); };
  const exit = () => { stopped = true; r.speed = oldSpeed; onExit ? onExit() : app.showTitle(); };
  // one command: animate its events (or apply silently while skipping ahead)
  const advance = async (single) => {
    if (busy || pl.done()) return;
    busy = true;
    const roundBefore = pl.state.round;
    const res = pl.step();
    const skipping = skipTo !== null && pl.state.round < skipTo;
    if (skipTo !== null && pl.state.round >= skipTo) skipTo = null;
    if (res) {
      const view = JSON.parse(JSON.stringify(pl.state));
      if (skipping) { r.syncMechs(view); r.syncStructures(view); r.syncUnits(view); r.setEnvironment(view); if (pl.state.round !== roundBefore) r.updateTerrain(view.map); }
      else {
        if (pl.state.round !== roundBefore) banner(`Round ${pl.state.round}`, 'Replay');
        await r.play(res.events, view, () => {});
      }
    }
    busy = false;
    if (!stopped) refresh();
    void single;
  };
  const loop = async () => {
    while (playing && !stopped && !pl.done()) {
      await advance(false);
      if (skipTo === null) await new Promise((ok) => setTimeout(ok, 120 / SPEEDS[speedI]));
    }
    if (pl.done() && !stopped) { playing = false; refresh(); }
  };
  const onAction = (a) => {
    if (a === 'confirm') { togglePlay(); return true; }
    if (a === 'rb') { nextRound(); return true; }
    if (a === 'y') { cycleSpeed(); return true; }
    if (a === 'lb') { restart(); return true; }
    if (a === 'x') { playing = false; refresh(); advance(true); return true; }
    return false;
  };
  r.speed = SPEEDS[speedI];
  setup();
  app.setScreen('replay', render, onAction, exit);
  loop();
}
