const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
  await ctx.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html');
  await p.waitForTimeout(2000);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); });
  await p.waitForTimeout(600);
  await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'settings', settings: { mapSize: 'S', seed: 'uitest3' } }); s.send({ t: 'lance', side: 0, lance: ['Archer', 'Catapult', 'Rifleman'] }); });
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/40-brief.png' });
  await p.keyboard.press('Enter');
  // wait for my move mode
  for (let i = 0; i < 40; i++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'move') break; await p.waitForTimeout(800); }
  await p.keyboard.press('KeyD'); await p.keyboard.press('KeyD');
  await p.waitForTimeout(600);
  await p.hover('.tracker'); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/41-move-tracker.png' });
  // stand still & go to attack
  await p.keyboard.press('KeyF'); await p.waitForTimeout(300); await p.keyboard.press('Enter');
  for (let i = 0; i < 20; i++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'attack') break; await p.waitForTimeout(500); }
  await p.waitForTimeout(800);
  const rows = await p.$$('.wrow');
  if (rows.length) { await rows[0].hover(); await p.waitForTimeout(700); }
  await p.screenshot({ path: OUT + '/42-attack-hover.png' });
  await p.mouse.move(5, 5);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/43-attack-focus.png' });
  await p.keyboard.press('KeyH'); await p.waitForTimeout(500);
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/44-manual.png' });
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
