// Battle screenshots with quads, a QuadVee, a tripod and a tracked mech. OUT=dir node test/chassis-battle.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8, tonnage: 400 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const app = window.__mf; app.stopAttract(); app.startLocal('skirmish');
    const s = app.session;
    s.send({ t: 'settings', settings: { tonnage: 400, mapSize: 'M', seed: 'quads2' } });
    setTimeout(() => { s.send({ t: 'lance', side: 0, lance: ['Scorpion', 'Arion', 'Triskelion', 'Brahma'] }); s.send({ t: 'lance', side: 1, lance: ['Goliath', 'Harpagos', 'Tarantula', 'Locust'] }); }, 100);
    setTimeout(() => s.send({ t: 'start' }), 400);
  });
  await p.waitForTimeout(2500);
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); };
  const ix = () => p.evaluate(() => { const bt = window.__mf.battle; return { mode: bt.ix.mode, id: bt.ix.mechId, mm: bt.ix.moveMode, keys: bt.ix.reach ? Object.keys(bt.ix.reach) : [] }; });
  const select = async (name) => p.evaluate((n) => { const bt = window.__mf.battle; const m = bt.state.mechs.find((x) => x.design === n && x.side === 0); if (m && !m.activated) bt.enterMove(m.id); return m && m.id; }, name);
  // wait for our turn
  for (let i = 0; i < 40; i++) { const s = await ix(); if (s.mode === 'move') break; if (s.mode === 'pass' || s.mode === 'briefing') await p.keyboard.press('Enter'); await p.waitForTimeout(400); }
  await select('Scorpion'); await p.waitForTimeout(800);
  console.log('scorpion', JSON.stringify(await ix()));
  await shot('b1-scorpion-move');
  await select('Arion'); await p.waitForTimeout(500);
  console.log('arion', JSON.stringify(await ix()));
  await p.evaluate(() => window.__mf.battle.setMoveMode('walk+cv')); await p.waitForTimeout(600);
  await shot('b2-arion-convert');
  // move the Arion 1 hex forward with conversion
  await p.evaluate(() => { const bt = window.__mf.battle; const m = bt.state.mechs[bt.ix.mechId]; const r = bt.ix.reach[bt.ix.moveMode]; let best = null; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) for (let f = 0; f < 6; f++) { const c = r.cost[(y * r.w + x) * 6 + f]; if (isFinite(c) && (x !== m.x || y !== m.y) && bt.hexReachable(x, y) && (!best || c > best.c)) best = { x, y, f, c }; } bt.cursor = { x: best.x, y: best.y }; bt.enterFacing(best.x, best.y); });
  await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(3500);
  await shot('b3-arion-after');
  console.log('after', JSON.stringify(await p.evaluate(() => { const m = window.__mf.battle.state.mechs.find((x) => x.design === 'Arion'); return { vmode: m.vmode, heat: m.heat }; })));
  // play out a few rounds: hold fire / end, letting the AI move
  for (let t = 0; t < 60; t++) {
    const s = await ix();
    if (s.mode === 'move') { await p.keyboard.press('KeyF'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); }
    else if (s.mode === 'facing') await p.keyboard.press('Enter');
    else if (s.mode === 'attack') await p.keyboard.press('KeyF');
    else if (s.mode === 'briefing' || s.mode === 'pass') await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
    if (t === 20) await shot('b4-midgame');
  }
  const st = await p.evaluate(() => { const s = window.__mf.battle.state; return { round: s.round, log: s.log.slice(-6), mechs: s.mechs.map((m) => `${m.design}:${m.vmode}${m.dead ? ':dead' : ''}${m.prone ? ':prone' : ''}`) }; });
  console.log(JSON.stringify(st, null, 1));
  await shot('b5-later');
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
