// Accessibility: colour-blind palette and shapes, text size, rebound keys.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4, colorblind: true, textScale: 1.15, keys: { x: 'KeyG', menu: 'KeyM' } })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { mapSize: 'S', seed: 'access', sides: 3 } }); });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/a0-lobby.png` });
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2200); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  const cols = await p.evaluate(() => window.__mf.battle.state.sides.map((s) => s.color).join(' '));
  const shapes = await p.evaluate(() => [...document.querySelectorAll('.mlabel .shape')].map((e) => e.textContent).join(''));
  const zoom = await p.evaluate(() => document.getElementById('ui').style.zoom);
  console.log('colours', cols, '| label shapes', shapes, '| ui zoom', zoom);
  await p.evaluate(() => { window.__mf.renderer.cam.wantDist = 14; });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/a1-battle.png` });
  // rebound keys: M opens the menu, P no longer does; G fires
  await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
  const pOpen = await p.evaluate(() => !!window.__mf.modal);
  await p.keyboard.press('KeyM'); await p.waitForTimeout(300);
  const mOpen = await p.evaluate(() => !!window.__mf.modal);
  console.log('P opens menu', pOpen, '| M opens menu', mOpen);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // settings screen and the key dialog
  await p.evaluate(() => window.__mf.showSettings(() => window.__mf.showTitle()));
  await p.waitForTimeout(400);
  await p.click('[data-key=keys]'); await p.waitForTimeout(300);
  await p.click('[data-key=k-y]'); await p.keyboard.press('KeyV'); await p.waitForTimeout(200);
  console.log('y rebound to', await p.evaluate(() => JSON.parse(localStorage.getItem('mechforce.settings')).keys.y));
  await p.screenshot({ path: `${OUT}/a2-keys.png` });
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
