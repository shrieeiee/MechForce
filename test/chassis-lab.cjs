// Mech Lab with each chassis. OUT=dir node test/chassis-lab.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => { localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low' })); localStorage.removeItem('mechforce.custom'); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.openBayLab(null, null, {}); });
  await p.waitForTimeout(1200);
  const set = async (k, n) => { for (let i = 0; i < n; i++) { await p.click(`[data-setting=${k}]`); await p.waitForTimeout(150); } };
  await set('body', 1); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/l1-quad.png` });
  await set('mot', 2); await p.evaluate(() => { const pv = window.__mf.preview; pv.setMode('drive'); pv.modeT = 1.6; pv.spin = false; pv.yaw = 0.8; }); await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}/l2-quadvee.png` });
  console.log(await p.evaluate(() => [...document.querySelectorAll('.msgs div')].map((d) => d.textContent).join(' | ')));
  await set('body', 1); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/l3-tripod-tracks.png` });
  console.log(await p.evaluate(() => [...document.querySelectorAll('.msgs div')].map((d) => d.textContent).join(' | ')));
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
