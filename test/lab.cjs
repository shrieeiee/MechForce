const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + ' ' + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => window.__mf.stopAttract());
  await p.click('[data-key=lab]'); await p.waitForTimeout(1200);
  // tweak: tonnage up twice, add a PPC and an LRM10, max armour
  await p.click('[data-setting=tons]'); await p.click('[data-setting=tons]');
  await p.click('[data-add="16"]'); await p.click('[data-add="6"]');
  await p.fill('#dname', 'Shrike'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/80-lab.png' });
  await p.click('[data-key=save]'); await p.waitForTimeout(500);
  await p.click('[data-key=exit]'); await p.waitForTimeout(800);
  // skirmish: choose mechs -> custom tab -> add Shrike
  await p.click('[data-key=skirmish]'); await p.waitForTimeout(800);
  await p.click('[data-key="lance-0"]'); await p.waitForTimeout(800);
  for (let i = 0; i < 4; i++) await p.keyboard.press('KeyF');
  await p.click('.tab[data-c="4"]'); await p.waitForTimeout(800);
  await p.click('.mech-row[data-key="__c0"]'); await p.waitForTimeout(1500);
  await p.screenshot({ path: OUT + '/81-bay-custom.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  const lance = await p.evaluate(() => window.__mf.lobby.slots[0].lance);
  console.log('lobby lance:', JSON.stringify(lance).slice(0, 160));
  await p.screenshot({ path: OUT + '/82-lobby.png' });
  await p.click('[data-key=start]'); await p.waitForTimeout(2500);
  const mechs = await p.evaluate(() => window.__mf.battle.state.mechs.filter((m) => m.side === 0).map((m) => m.design + (m.custom ? '*' : '')));
  console.log('in battle:', mechs, 'errors', errs.slice(0, 3));
  await b.close();
})();
