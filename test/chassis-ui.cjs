// Screenshots of the new chassis in the Mech Bay, Mech Lab and in battle. OUT=dir node test/chassis-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { window.__mf.stopAttract(); window.__mf.showBay(null); });
  const pick = async (cls, name, shot, after, mode) => {
    await p.evaluate(([c, n]) => { const app = window.__mf; const tabs = document.querySelectorAll('.tab'); tabs[c].click(); setTimeout(() => { const r = [...document.querySelectorAll('.mech-row')].find((x) => x.dataset.key === n); app.nav.set(r, true); }, 50); }, [cls, name]);
    await p.waitForTimeout(300);
    if (mode) await p.evaluate((md) => window.__mf.preview.setMode(md), mode);
    await p.waitForTimeout(after || 2500);
    await p.screenshot({ path: `${OUT}/${shot}.png` });
  };
  await pick(2, 'Goliath', 'c1-goliath', 1500);
  await pick(2, 'Goliath', 'c1b-goliath-walk', 900, 'walk');
  await pick(1, 'Scorpion', 'c2-scorpion', 1500);
  await pick(2, 'Triskelion', 'c3-triskelion', 1500, 'walk');
  await pick(3, 'Ares', 'c4-ares', 1500);
  await pick(0, 'Arion', 'c5-arion', 400);
  const drive = async (shot) => { await p.evaluate(() => { const pv = window.__mf.preview; pv.setMode('drive'); pv.modeT = 1.6; pv.spin = false; pv.yaw = 0.9; }); await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${shot}.png` }); };
  await drive('c6-arion-vehicle');
  await pick(2, 'Harpagos', 'c7-harpagos', 300); await drive('c7-harpagos-vehicle');
  await pick(2, 'Brahma', 'c8-brahma', 1500); await drive('c9-brahma-tracks');
  // Mech Lab: tripod with tracks, quadvee
  await p.evaluate(() => { const { showLab } = window.__mfLab || {}; });
  console.log('errors', errs.slice(0, 5));
  await b.close();
})();
