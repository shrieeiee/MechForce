const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => window.__mf.stopAttract());
  await p.click('[data-key=hotseat]'); await p.waitForTimeout(800);
  await p.evaluate(() => window.__mf.session.send({ t: 'settings', settings: { mission: 'pepsi', sides: 4, lanceSize: 2, tonnage: 120 } }));
  await p.waitForTimeout(500);
  for (const i of [2, 3]) { const b2 = await p.$(`[data-key="take-${i}"]`); if (b2) { await b2.click(); await p.waitForTimeout(300); } }
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/a0-lobby4.png' });
  await p.click('[data-key=start]'); await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/a1-brief4.png' });
  await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'pass' || m === 'move') break; await p.waitForTimeout(600); }
  await p.screenshot({ path: OUT + '/a2-pass4.png' });
  await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  await p.screenshot({ path: OUT + '/a3-battle4.png' });
  console.log('errors', errs.slice(0, 3));
  await b.close();
})();
