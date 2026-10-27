const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 3 })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' ' + e.stack)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + process.cwd() + '/dist/web/index.html');
  await p.waitForTimeout(2000);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); });
  await p.waitForTimeout(800);
  await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'settings', settings: { mapSize: 'S', theme: 'volcanic', mission: 'pepsi' } }); s.send({ t: 'slot', side: 0, ctrl: 'ai' }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(1500);
  await p.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) {
    await p.waitForTimeout(9000);
    await p.screenshot({ path: OUT + `/3${i}-anim.png` });
  }
  const st = await p.evaluate(() => { const s = window.__mf.battle.state; return { round: s.round, over: s.over, log: s.log.slice(-6) }; });
  console.log(JSON.stringify(st, null, 1));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
