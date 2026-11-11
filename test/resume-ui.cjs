// Save and resume: play a few moves, reload the page, resume, carry on.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { if (!localStorage.getItem('mechforce.settings')) localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  if (process.env.TRACE) { p.on('console', (m) => { if (m.text().startsWith('LS')) console.log(m.text().slice(0, 300)); }); await p.addInitScript(() => { const rm = Storage.prototype.removeItem, si = Storage.prototype.setItem; Storage.prototype.removeItem = function (k) { if (k === 'mechforce.resume') console.log('LS remove ' + new Error().stack.split('\n').slice(1, 5).join(' | ')); return rm.call(this, k); }; Storage.prototype.setItem = function (k, v) { try { return si.call(this, k, v); } catch (e) { console.log('LS set failed ' + k + ' ' + e.message); throw e; } }; }); }
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { mapSize: 'S', seed: 'resume', forces: 'few' } }); });
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2000); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  for (let t = 0; t < 14; t++) {
    const mode = await p.evaluate(() => window.__mf.battle.ix.mode);
    if (mode === 'move') { await p.evaluate(() => { const bt = window.__mf.battle; let best = null; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) if (bt.hexReachable(x, y) && (!best || x > best.x)) best = { x, y }; const m = bt.state.mechs[bt.ix.mechId]; best = best || { x: m.x, y: m.y }; bt.cursor = best; bt.enterFacing(best.x, best.y); }); await p.waitForTimeout(80); await p.keyboard.press('Enter'); }
    else if (mode === 'facing') await p.keyboard.press('Enter');
    else if (mode === 'attack') await p.keyboard.press('KeyF');
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(800);
  const before = await p.evaluate(() => { const g = window.__mf.session.room.game; return JSON.stringify({ round: g.round, seq: g.seq, pos: g.mechs.map((m) => [m.x, m.y, m.armor.reduce((a, b) => a + b, 0)]), units: g.units.map((u) => [u.x, u.y]) }); });
  const saved = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mechforce.resume')); return s && JSON.stringify({ round: s.room.game.round, seq: s.room.game.seq, pos: s.room.game.mechs.map((m) => [m.x, m.y, m.armor.reduce((a, b) => a + b, 0)]), units: s.room.game.units.map((u) => [u.x, u.y]) }); });
  console.log('saved matches live game', saved === before, JSON.parse(before).round, 'seq', JSON.parse(before).seq);
  console.log('key before reload', await p.evaluate(() => (localStorage.getItem('mechforce.resume') || '').length));
  console.log('key now', await p.evaluate(() => (localStorage.getItem('mechforce.resume') || '').length), await p.evaluate(() => window.__mf.battle.state.over));
  // close and reopen
  await p.reload(); await p.waitForTimeout(1500);
  console.log('key after reload', await p.evaluate(() => (localStorage.getItem('mechforce.resume') || '').length), 'screen', await p.evaluate(() => window.__mf.screen));
  const hasResume = await p.$('[data-key=resume]');
  console.log('title offers resume:', !!hasResume, hasResume ? await hasResume.textContent() : '');
  await p.screenshot({ path: `${OUT}/r0-title.png` });
  await p.click('[data-key=resume]'); await p.waitForTimeout(2500);
  const after = await p.evaluate(() => { const g = window.__mf.battle.state; return JSON.stringify({ round: g.round, seq: g.seq, pos: g.mechs.map((m) => [m.x, m.y, m.armor.reduce((a, b) => a + b, 0)]), units: g.units.map((u) => [u.x, u.y]) }); });
  console.log('resumed state matches', after === saved);
  await p.screenshot({ path: `${OUT}/r1-resumed.png` });
  // keep playing
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  for (let t = 0; t < 8; t++) {
    const mode = await p.evaluate(() => window.__mf.battle.ix.mode);
    if (mode === 'move') { await p.evaluate(() => { const bt = window.__mf.battle; const m = bt.state.mechs[bt.ix.mechId]; bt.cursor = { x: m.x, y: m.y }; bt.enterFacing(m.x, m.y); }); await p.waitForTimeout(80); await p.keyboard.press('Enter'); }
    else if (mode === 'facing') await p.keyboard.press('Enter');
    else if (mode === 'attack') await p.keyboard.press('KeyF');
    await p.waitForTimeout(400);
  }
  console.log('carried on to seq', await p.evaluate(() => window.__mf.session.room.game.seq));
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
