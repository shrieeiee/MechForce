const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'medium', speed: 8 })));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const a = window.__mf; a.stopAttract(); a.startLocal('skirmish'); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'settings', settings: { mapSize: 'M', seed: 'terr1', theme: 'temperate' } }); });
  await p.waitForTimeout(300); await p.evaluate(() => window.__mf.session.send({ t: 'start' })); await p.waitForTimeout(1500);
  await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  const shots = [[0.5, 0.95, 12], [2.2, 0.5, 9], [4.0, 0.45, 7], [1.0, 1.3, 20], [5.5, 0.6, 6]];
  // find a water hex and an elevation cliff to look at
  const spots = await p.evaluate(() => {
    const st = window.__mf.battle.state, m = st.map; const out = [];
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) { const t = m.t[y * m.w + x]; if (t >= 4 && out.length < 1) out.push([x, y]); }
    for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) { if (m.e[y * m.w + x] === 3 && out.length < 2) out.push([x, y]); }
    return out;
  });
  let k = 0;
  for (const [x, y] of spots) for (const [yaw, pitch, dist] of shots) {
    await p.evaluate(([x, y, yaw, pitch, dist]) => { const r = window.__mf.renderer; r.focusHex(x, y, true); r.cam.yaw = yaw; r.cam.pitch = pitch; r.cam.dist = r.cam.wantDist = dist; r.cam.wantYaw = null; }, [x, y, yaw, pitch, dist]);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/t${k++}.png` });
  }
  await b.close();
})();
