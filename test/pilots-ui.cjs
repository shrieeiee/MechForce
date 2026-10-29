// Barracks, character generator, lobby assignment, eject/self-destruct and debrief. OUT=dir node test/pilots-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  await p.click('[data-key=barracks]'); await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/p0-empty.png` });
  await p.click('[data-key=recruit]'); await p.waitForTimeout(400);
  await p.click('[data-key=bg-militia]'); await p.waitForTimeout(200);
  await p.fill('#gcall', 'Kestrel'); await p.fill('#gname', 'Mira Okafor');
  for (let i = 0; i < 3; i++) await p.click('[data-key=part-hair]');
  await p.click('[data-key=part-helmet]');
  await p.screenshot({ path: `${OUT}/p1-generator.png` });
  await p.click('[data-key=enlist]'); await p.waitForTimeout(400);
  // two more random recruits
  for (let k = 0; k < 3; k++) { await p.click('[data-key=recruit]'); await p.waitForTimeout(250); await p.click('[data-key=roll-look]'); await p.click('[data-key=enlist]'); await p.waitForTimeout(250); }
  const roster = await p.evaluate(() => JSON.parse(localStorage.getItem('mechforce.pilots')).map((x) => `${x.callsign}:${x.bg}:${x.gun}/${x.pil}:${x.xp}`));
  console.log('roster', roster);
  // select Kestrel and learn an ability with the militia's 12 XP
  await p.evaluate(() => { const r = [...document.querySelectorAll('.bk-row')].find((x) => x.textContent.includes('Kestrel')); r.click(); });
  await p.waitForTimeout(300);
  await p.click('[data-key=learn-cluster]'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/p2-barracks.png` });
  console.log('kestrel', await p.evaluate(() => { const k = JSON.parse(localStorage.getItem('mechforce.pilots')).find((x) => x.callsign === 'Kestrel'); return k.abilities.join(',') + ' xp ' + k.xp; }));
  // skirmish lobby: pilots auto-assigned
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { mapSize: 'S', seed: 'pilui', lanceSize: 4 } }); });
  await p.waitForTimeout(900);
  console.log('lobby pilots', await p.evaluate(() => JSON.stringify(window.__mf.lobby.slots[0].pilots.map((x) => x && x.name))));
  await p.screenshot({ path: `${OUT}/p3-lobby.png` });
  await p.click('[data-key=pilots-0]'); await p.waitForTimeout(300);
  await p.click('[data-key=pa-0]'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/p4-assign.png` });
  await p.click('.modal [data-key=done]'); await p.waitForTimeout(400);
  console.log('after assign', await p.evaluate(() => JSON.stringify(window.__mf.lobby.slots[0].pilots.map((x) => x && x.name))));
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2200); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  // wait for our turn, then open the menu and eject
  for (let t = 0; t < 30; t++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'move' || m === 'select') break; if (m === 'pass' || m === 'briefing') await p.keyboard.press('Enter'); await p.waitForTimeout(400); }
  await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/p5-menu.png` });
  const hasEject = await p.$('[data-key=eject]');
  console.log('menu has eject', !!hasEject);
  if (hasEject) { await p.click('[data-key=eject]'); await p.click('[data-key=eject]'); }
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/p6-eject.png` });
  await p.waitForTimeout(1500);
  // self-destruct the next one
  for (let t = 0; t < 30; t++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'move') break; if (m === 'pass' || m === 'briefing') await p.keyboard.press('Enter'); await p.waitForTimeout(400); }
  await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
  if (await p.$('[data-key=sd]')) { await p.click('[data-key=sd]'); await p.click('[data-key=sd]'); }
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/p7-sd.png` });
  // concede to end it and see the debrief
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.__mf.session.send({ t: 'concede' }));
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${OUT}/p8-debrief.png` });
  console.log('log tail', await p.evaluate(() => window.__mf.battle.state.log.filter((l) => /eject|override|reactor|SELF/i.test(l)).join(' | ')));
  console.log('after', await p.evaluate(() => JSON.parse(localStorage.getItem('mechforce.pilots')).map((x) => `${x.callsign}: xp ${x.xp} battles ${x.battles} rest ${x.rest} dead ${x.dead} ej ${x.ejections || 0}`).join(' | ')));
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
