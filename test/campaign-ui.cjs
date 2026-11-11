// Campaign in the browser: found a company, take a contract, fight it, settle, repair.
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.click('[data-key=campaign]'); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/c0-found.png` });
  await p.fill('#coname', 'Iron Jackals'); await p.click('[data-key=found]'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/c1-contracts.png` });
  for (const t of ['hangar', 'market', 'hire']) { await p.click(`[data-tab=${t}]`); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/c2-${t}.png` }); }
  await p.click('[data-tab=contracts]'); await p.click('[data-take="0"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/c3-deploy.png` });
  await p.click('[data-key=launch]');
  await p.waitForTimeout(2500);
  console.log('screen', await p.evaluate(() => window.__mf.screen), 'lance', await p.evaluate(() => window.__mf.battle.state && window.__mf.battle.state.mechs.map((m) => `${m.side}:${m.design}/${m.pilot.name}`).join(' ')));
  // concede to end the battle quickly, then settle
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  // let the AI play our side for a few turns so there's damage, then concede
  await p.evaluate(async () => {
    const app = window.__mf; const room = app.session.room; const g = room.game;
    const { aiNextCommand } = window.__mfAI || {};
    for (let i = 0; i < 4 && !g.over; i++) { await new Promise((r) => setTimeout(r, 50)); }
    app.session.send({ t: 'concede' });
  });
  await p.waitForSelector('[data-key=company]', { timeout: 30000 }); await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/c4-results.png` });
  const co = await p.evaluate(() => JSON.parse(localStorage.getItem('mechforce.campaign')));
  console.log('company', co.name, co.cbills, 'contracts', co.contracts, 'log', co.log[0].text);
  await p.click('[data-key=company]'); await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/c5-hangar.png` });
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
