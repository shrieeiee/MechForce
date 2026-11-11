// Replays in the browser: finish a quick battle, watch the replay, skip a round, list screen.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  // a computer-vs-computer battle, played to the end
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { mapSize: 'S', seed: 'repui', lanceSize: 2 } }); app.session.send({ t: 'slot', side: 0, ctrl: 'ai' }); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const room = window.__mf.session.room; room.aiDelay = 0; window.__mf.session.send({ t: 'start' }); });
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => !!window.__mf.lastReplay)) break; }
  const info = await p.evaluate(() => ({ cmds: window.__mf.lastReplay && window.__mf.lastReplay.cmds.length, stored: JSON.parse(localStorage.getItem('mechforce.replays') || '[]').length }));
  console.log('replay', JSON.stringify(info));
  // the results screen comes up once the last animations finish (the briefing waits first)
  await p.keyboard.press('Enter');
  let shown = false;
  for (let i = 0; i < 120 && !shown; i++) { await p.waitForTimeout(1000); shown = await p.evaluate(() => { const b2 = document.querySelector('[data-key=watch]'); return !!(b2 && !b2.classList.contains('hidden')); }); }
  console.log('results offers the replay', shown);
  await p.screenshot({ path: `${OUT}/r0-results.png` });
  await p.click('[data-key=watch]');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/r1-watching.png` });
  await p.click('[data-act=round]'); await p.waitForTimeout(2500);
  console.log('after skip', await p.evaluate(() => document.querySelector('.rp-line').textContent));
  await p.click('[data-act=speed]'); await p.click('[data-act=speed]');
  for (let i = 0; i < 90; i++) { await p.waitForTimeout(1000); if (await p.evaluate(() => !!document.querySelector('.rp-end'))) break; }
  console.log('end', await p.evaluate(() => (document.querySelector('.rp-end') || {}).textContent), await p.evaluate(() => document.querySelector('.rp-line').textContent));
  await p.screenshot({ path: `${OUT}/r2-end.png` });
  await p.click('[data-act=exit]'); await p.waitForTimeout(800);
  await p.click('[data-key=replays]'); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/r3-list.png` });
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
