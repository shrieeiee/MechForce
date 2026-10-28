// Fog of war in the browser: skirmish view and hotseat perspective. OUT=dir node test/fog-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { fog: true, mapSize: 'L', seed: 'fogui', theme: 'temperate' } }); });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/f0-lobby.png` });
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2000); await p.keyboard.press('Enter');
  const info = () => p.evaluate(() => { const bt = window.__mf.battle; const s = bt.state; return { mode: bt.ix.mode, round: s.round, hidden: s.mechs.filter((m) => m.hidden).length, ghosts: s.mechs.filter((m) => m.hidden && m.ghost).length, enemies: s.mechs.filter((m) => m.side === 1).map((m) => `${m.design}@${m.x},${m.y}${m.hidden ? 'H' : ''}`).join(' ') }; });
  console.log('start', JSON.stringify(await info()));
  let shots = 0;
  for (let t = 0; t < 70; t++) {
    const s = await info();
    if (s.mode === 'move') { // walk towards the enemy side
      await p.evaluate(() => { const bt = window.__mf.battle; const m = bt.state.mechs[bt.ix.mechId]; const r = bt.ix.reach[bt.ix.moveMode]; let best = null; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) if (bt.hexReachable(x, y) && (!best || x > best.x)) best = { x, y }; if (best) { bt.cursor = best; bt.enterFacing(best.x, best.y); } else { bt.cursor = { x: m.x, y: m.y }; bt.enterFacing(m.x, m.y); } });
      await p.waitForTimeout(150); await p.keyboard.press('Enter');
    } else if (s.mode === 'facing') await p.keyboard.press('Enter');
    else if (s.mode === 'attack') { await p.keyboard.press('KeyF'); shots++; }
    else if (s.mode === 'briefing' || s.mode === 'pass') await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    if (t === 8) { console.log('t8', JSON.stringify(await info())); await p.screenshot({ path: `${OUT}/f1-early.png` }); }
    if (t === 30) { console.log('t30', JSON.stringify(await info())); await p.screenshot({ path: `${OUT}/f2-mid.png` }); }
  }
  console.log('end', JSON.stringify(await info()));
  await p.screenshot({ path: `${OUT}/f3-late.png` });
  const g = await p.evaluate(() => { const bt = window.__mf.battle; const m = bt.state.mechs.find((x) => x.hidden && x.ghost); if (!m) return null; window.__mf.renderer.focusHex(m.ghost.x, m.ghost.y); window.__mf.renderer.cam.wantDist = 9; return m.design + ' last seen ' + JSON.stringify(m.ghost); });
  console.log('ghost', g); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/f4-ghost.png` });
  // hotseat: each player's view hides the other's mechs
  await p.evaluate(() => { const app = window.__mf; app.endSession(); app.startLocal('hotseat'); app.session.send({ t: 'settings', settings: { fog: true, mapSize: 'L', seed: 'foghot' } }); });
  await p.waitForTimeout(700);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(1500); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  const persp = () => p.evaluate(() => { const bt = window.__mf.battle; const s = bt.state; const side = s.order[s.turnIdx]; return { mode: bt.ix.mode, active: side, hiddenSides: [...new Set(s.mechs.filter((m) => m.hidden).map((m) => m.side))] }; });
  const seenViews = [];
  for (let t = 0; t < 30; t++) {
    const s = await persp();
    if (s.mode === 'move' || s.mode === 'attack' || s.mode === 'facing') seenViews.push(`${s.active}:${s.hiddenSides.join('')}`);
    if (s.mode === 'move') { await p.keyboard.press('KeyF'); await p.waitForTimeout(100); await p.keyboard.press('Enter'); }
    else if (s.mode === 'facing') await p.keyboard.press('Enter');
    else if (s.mode === 'attack') await p.keyboard.press('KeyT');
    else if (s.mode === 'pass' || s.mode === 'briefing') await p.keyboard.press('Enter');
    await p.waitForTimeout(350);
  }
  console.log('hotseat views (active side : sides hidden from view)', [...new Set(seenViews)].join(' '));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
