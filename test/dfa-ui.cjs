// Death from above and a reactor blast in the browser. OUT=dir node test/dfa-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 1 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { mapSize: 'M', seed: 'dfaui', lanceSize: 1 } }); app.session.send({ t: 'lance', side: 0, lance: ['Grasshopper'] }); app.session.send({ t: 'lance', side: 1, lance: ['Griffin'] }); });
  await p.waitForTimeout(600);
  // put the two mechs near each other on open ground, our turn first
  await p.evaluate(() => {
    const room = window.__mf.session.room;
    room.handle(window.__mf.session.myId, { t: 'start' });
    const g = room.game;
    for (let i = 0; i < g.map.t.length; i++) { g.map.t[i] = 0; g.map.e[i] = 0; }
    g.structures = [];
    g.mechs[0].x = 7; g.mechs[0].y = 8; g.mechs[0].f = 0; g.mechs[1].x = 10; g.mechs[1].y = 8; g.mechs[1].f = 3;
    g.order = [0, 1]; g.turnIdx = 0; g.act = null;
    room.broadcastGame ? room.broadcastGame([]) : null;
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const app = window.__mf; app.battle.start(app.session.room.game); });
  await p.waitForTimeout(1200); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const mode = await p.evaluate(() => window.__mf.battle.ix.mode);
  console.log('mode', mode);
  // jump to the hex next to the Griffin
  await p.evaluate(() => { const bt = window.__mf.battle; while (bt.ix.moveMode !== 'jump') bt.onAction('y'); });
  await p.waitForTimeout(200);
  await p.evaluate(() => { const bt = window.__mf.battle; bt.cursor = { x: 9, y: 8 }; bt.enterFacing(9, 8); });
  await p.waitForTimeout(200); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  console.log('after jump', await p.evaluate(() => { const bt = window.__mf.battle; return bt.ix.mode + ' target ' + bt.ix.targetId; }));
  // pick death from above with the melee button
  await p.evaluate(() => { const bt = window.__mf.battle; while (bt.ix.melee !== 'dfa') { bt.onAction('y'); if (!bt.ix.melee && bt.__n > 5) break; bt.__n = (bt.__n || 0) + 1; } });
  await p.waitForTimeout(400);
  await p.hover('[data-key=melee-dfa]').catch(() => {});
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/d0-dfa-card.png` });
  console.log('melee', await p.evaluate(() => window.__mf.battle.ix.melee));
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${OUT}/d1-dfa-air.png` });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/d2-dfa-land.png` });
  await p.waitForTimeout(2500);
  const log = await p.evaluate(() => window.__mf.battle.state.log.slice(-8).map((l) => l.text || l).join('\n'));
  console.log(log);
  await p.screenshot({ path: `${OUT}/d3-after.png` });
  // reactor blast animation
  await p.evaluate(() => { const app = window.__mf; const s = app.battle.state; app.renderer.play([{ k: 'blast', id: 1, x: s.mechs[1].x, y: s.mechs[1].y, r: 2, dmg: 30 }, { k: 'blasthit', id: 0, dmg: 30 }], s); });
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/d4-blast.png` });
  await p.waitForTimeout(1500);
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
