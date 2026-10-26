const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message + e.stack));
  await p.goto('http://localhost:7373/');
  await p.waitForTimeout(2500);
  await p.keyboard.press('f'); // start
  await p.waitForTimeout(2500);
  await p.screenshot({ path: OUT + '/02-briefing.png' });
  await p.keyboard.press('Enter'); // deploy
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT + '/03-move.png' });
  // move cursor 3 steps right and confirm
  for (let i = 0; i < 3; i++) { await p.keyboard.press('d'); await p.waitForTimeout(120); }
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/04-path.png' });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/05-facing.png' });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);
  await p.screenshot({ path: OUT + '/06-attack.png' });
  await p.keyboard.press('f');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: OUT + '/07-after.png' });
  // play several more turns automatically: stand & fire / end
  for (let t = 0; t < 14; t++) {
    const mode = await p.evaluate(() => window.__mf.battle.ix.mode);
    if (mode === 'move') { await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); await p.keyboard.press('Enter'); }
    else if (mode === 'facing') await p.keyboard.press('Enter');
    else if (mode === 'attack') await p.keyboard.press('f');
    else if (mode === 'briefing') await p.keyboard.press('Enter');
    await p.waitForTimeout(2500);
  }
  await p.screenshot({ path: OUT + '/08-later.png' });
  const info = await p.evaluate(() => { const s = window.__mf.battle.state; return { round: s.round, log: s.log.slice(-8), mode: window.__mf.battle.ix.mode }; });
  console.log(JSON.stringify(info, null, 1));
  console.log('ERRORS:', errs.slice(0, 10).join('\n'));
  await b.close();
})();
