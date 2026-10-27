const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low' })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__mf.stopAttract(); window.__mf.showBay(null); });
  const pick = async (cls, name, shot, after) => {
    await p.evaluate(([c, n]) => { const app = window.__mf; const tabs = document.querySelectorAll('.tab'); tabs[c].click(); setTimeout(() => { const r = [...document.querySelectorAll('.mech-row')].find((x) => x.dataset.key === n); app.nav.set(r, true); }, 50); }, [cls, name]);
    await p.waitForTimeout(after || 2500);
    await p.screenshot({ path: `${OUT}/${shot}.png` });
  };
  await pick(1, 'Hunchback', '70-hunchback', 2600);
  await pick(2, 'Catapult', '71-catapult', 3300);
  await pick(3, 'Atlas', '72-atlas', 1800);
  await p.hover('.wr[data-wi="0"]'); await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/73-atlas-ac20.png` });
  console.log('errors', errs.slice(0, 3));
  await b.close();
})();
