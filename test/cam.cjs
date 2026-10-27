const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const a = window.__mf; a.stopAttract(); a.startLocal('skirmish'); });
  await p.waitForTimeout(500); await p.evaluate(() => window.__mf.session.send({ t: 'start' })); await p.waitForTimeout(1500);
  await p.keyboard.press('Enter');
  for (let i = 0; i < 40; i++) { if ((await p.evaluate(() => window.__mf.battle.ix.mode)) === 'move') break; await p.waitForTimeout(500); }
  const yaw = () => p.evaluate(() => (window.__mf.renderer.cam.wantYaw ?? window.__mf.renderer.cam.yaw));
  const y0 = await yaw(); await p.click('[data-cam=r]'); const y1 = await yaw();
  console.log('button rotate deg', ((y1 - y0) * 180 / Math.PI).toFixed(0));
  const z0 = await p.evaluate(() => window.__mf.renderer.cam.wantDist); await p.click('[data-cam=out]'); console.log('zoom out', z0, '->', await p.evaluate(() => window.__mf.renderer.cam.wantDist));
  const ya = await p.evaluate(() => window.__mf.renderer.cam.yaw);
  await p.mouse.move(640, 400); await p.mouse.down({ button: 'right' }); for (let i = 1; i <= 10; i++) await p.mouse.move(640 + i * 15, 400); await p.mouse.up({ button: 'right' });
  const yb = await p.evaluate(() => window.__mf.renderer.cam.yaw);
  console.log('right-drag changed yaw:', Math.abs(yb - ya) > 0.1, 'mode after drag:', await p.evaluate(() => window.__mf.battle.ix.mode));
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  console.log('mode before right-click', await p.evaluate(() => window.__mf.battle.ix.mode));
  await p.mouse.click(640, 400, { button: 'right' }); await p.waitForTimeout(300);
  console.log('mode after right-click', await p.evaluate(() => window.__mf.battle.ix.mode));
  await b.close();
})();
