const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low' })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__mf.stopAttract(); window.__mf.showBay(null); });
  const list = process.argv.slice(2).map((x) => x.split(':'));
  let k = 0;
  for (const [cls, name, yaw] of list) {
    await p.evaluate(([c, n, y]) => { const app = window.__mf; document.querySelectorAll('.tab')[+c].click(); setTimeout(() => { const r = [...document.querySelectorAll('.mech-row')].find((x) => x.dataset.key === n); app.nav.set(r, true); const pv = app.preview; pv.spin = false; pv.yaw = +y; pv.autoDemo = false; pv.mode = 'idle'; pv.modeT = -99; }, 60); }, [cls, name, yaw]);
    await p.waitForTimeout(1300);
    await p.evaluate(() => { const pv = window.__mf.preview; pv.weapons.forEach((w, i) => pv.fire(i, false)); });
    await p.waitForTimeout(140);
    const el = await p.$('.viewer');
    await el.screenshot({ path: `${OUT}/m${k++}.png` });
  }
  console.log('errors', errs.slice(0, 3));
  await b.close();
})();
