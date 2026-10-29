// Infantry and vehicles in the browser: editor, lobby, battle. OUT=dir node test/units-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 3 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  // editor: place troops
  await p.click('[data-key=editor]'); await p.waitForTimeout(1000);
  await p.click('[data-tool=troops]');
  const place = async (kind, owner) => { await p.click(`[data-ukind=${kind}]`); while ((await p.evaluate(() => document.querySelector('[data-act=uowner]').textContent.trim())) !== owner) await p.click('[data-act=uowner]'); await p.keyboard.press('Enter'); };
  for (const k of ['ArrowLeft', 'ArrowLeft']) await p.keyboard.press(k);
  await place('tank', 'West');
  await p.keyboard.press('ArrowUp'); await place('rifle', 'Local forces');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await place('hover', 'East');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await place('srm', 'Local forces');
  await p.keyboard.press('ArrowRight'); await place('carrier', 'East');
  await p.waitForTimeout(500);
  console.log('editor', await p.evaluate(() => document.querySelector('.ed-info').textContent));
  await p.evaluate(() => { const r = window.__mf.renderer; r.cam.wantDist = 11; });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/u0-editor.png` });
  // lobby with ground forces on a random map
  await p.evaluate(() => { const app = window.__mf; app.setScreen('blank', () => {}, null, null); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { forces: 'many', mapSize: 'M', seed: 'unitsui' } }); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/u1-lobby.png` });
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2200); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
  const st0 = await p.evaluate(() => window.__mf.battle.state.units.map((u) => `${u.kind}:${u.team}@${u.x},${u.y}`).join(' '));
  console.log('units', st0);
  // look at a vehicle close up
  await p.evaluate(() => { const s = window.__mf.battle.state; const u = s.units.find((x) => !x.inf) || s.units[0]; window.__mf.renderer.focusHex(u.x, u.y); window.__mf.renderer.cam.wantDist = 7; window.__mf.battle.cursor = { x: u.x, y: u.y }; window.__mf.battle.updateCursorOverlay(); window.__mf.battle.render(); });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/u2-vehicle.png` });
  await p.evaluate(() => { const s = window.__mf.battle.state; const u = s.units.find((x) => x.inf); window.__mf.renderer.focusHex(u.x, u.y); window.__mf.battle.cursor = { x: u.x, y: u.y }; window.__mf.battle.updateCursorOverlay(); window.__mf.battle.render(); });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/u3-infantry.png` });
  await p.evaluate(() => { window.__mf.renderer.cam.wantDist = 22; });
  // play a few rounds; shoot a unit when one is a target
  let shotUnit = false, ush = 0;
  for (let t = 0; t < 70; t++) {
    const s = await p.evaluate(() => { const bt = window.__mf.battle; return { mode: bt.ix.mode, targets: bt.ix.targets || [], round: bt.state.round }; });
    if (s.mode === 'move') {
      await p.evaluate(() => { const bt = window.__mf.battle; let best = null; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) if (bt.hexReachable(x, y) && (!best || x > best.x)) best = { x, y }; const m = bt.state.mechs[bt.ix.mechId]; best = best || { x: m.x, y: m.y }; bt.cursor = best; bt.enterFacing(best.x, best.y); });
      await p.waitForTimeout(100); await p.keyboard.press('Enter');
    } else if (s.mode === 'facing') await p.keyboard.press('Enter');
    else if (s.mode === 'attack') {
      const ut = s.targets.find((x) => x <= -1000);
      if (ut !== undefined && !shotUnit) { shotUnit = true; await p.evaluate((id) => window.__mf.battle.selectTarget(id), ut); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/u4-target-unit.png` }); }
      await p.keyboard.press('KeyF');
    } else if (s.mode === 'briefing' || s.mode === 'pass') await p.keyboard.press('Enter');
    await p.waitForTimeout(350);
    ush = await p.evaluate(() => window.__mf.battle.state.log.filter((l) => /fires at|wiped|destroyed!|immobilised/.test(l) && /platoon|tank|car|scout|carrier/i.test(l)).length);
    if (t === 40) await p.screenshot({ path: `${OUT}/u5-mid.png` });
  }
  console.log('unit log lines', ush, 'targeted a unit', shotUnit, 'round', await p.evaluate(() => window.__mf.battle.state.round));
  console.log(await p.evaluate(() => window.__mf.battle.state.log.filter((l) => /platoon|tank|car|scout|carrier|Ground/i.test(l)).slice(-6).join('\n')));
  await p.screenshot({ path: `${OUT}/u6-late.png` });
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
