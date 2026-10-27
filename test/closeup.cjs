const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low' })));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__mf.stopAttract(); window.__mf.showBay(null); });
  const list = process.argv.slice(2).map((x) => x.split(':'));
  let k = 0;
  for (const [cls, name, yaw, zoom, lookY] of list) {
    await p.evaluate(([c, n, y]) => { const app = window.__mf; document.querySelectorAll('.tab')[+c].click(); setTimeout(() => { const r = [...document.querySelectorAll('.mech-row')].find((x) => x.dataset.key === n); app.nav.set(r, true); const pv = app.preview; pv.spin = false; pv.yaw = +y; pv.autoDemo = false; pv.mode = 'idle'; pv.modeT = -99; }, 60); }, [cls, name, yaw]);
    await p.waitForTimeout(1200);
    await p.evaluate(([z, ly]) => { const pv = window.__mf.preview; const h = pv.model.height; pv.fit = () => {}; pv.camera.position.set(0.25, h * +ly + 0.1, pv.camDist * +z); pv.camera.lookAt(0, h * +ly, 0); pv.weapons.forEach((w, i) => pv.fire(i, false)); }, [zoom, lookY]);
    await p.waitForTimeout(260);
    await (await p.$('.viewer')).screenshot({ path: `${OUT}/c${k++}.png` });
    await p.evaluate(() => { location.reload(); });
    await p.waitForTimeout(1500);
    await p.evaluate(() => { window.__mf.stopAttract(); window.__mf.showBay(null); });
  }
  await b.close();
})();
