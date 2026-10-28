// Map editor, lobby defences and structures in battle. OUT=dir node test/editor-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 4 })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  // open the editor from the title menu
  await p.click('[data-key=editor]'); await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/e0-editor.png` });
  const r = await p.evaluate(() => window.__mf.screen);
  console.log('screen', r);
  // paint woods with the mouse along a stroke
  const box = { w: 1366, h: 820 };
  await p.mouse.move(700, 400); await p.mouse.down(); for (let i = 0; i < 8; i++) await p.mouse.move(700 + i * 20, 400 + i * 6); await p.mouse.up();
  await p.waitForTimeout(300);
  // raise hills with the keyboard tool cycle
  await p.keyboard.press('Tab'); await p.waitForTimeout(100); // height
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Enter'); }
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  // build: turret, mirror rotate, bunker
  await p.click('[data-tool=build]'); await p.click('[data-act=mirror]');
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Enter');
  await p.click('[data-kind=bunker]'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Enter');
  await p.click('[data-kind=building]'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.click('[data-kind=wall]'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const st = await p.evaluate(() => document.querySelector('.ed-info').textContent);
  console.log('info', st);
  await p.screenshot({ path: `${OUT}/e1-built.png` });
  // menu: name it, save & play
  await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/e2-menu.png` });
  await p.fill('#mname', 'Ridge Fort'); await p.click('[data-key=play]');
  await p.waitForTimeout(1200);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('mechforce.maps') || '[]').map((m) => m.name + ':' + m.s.length));
  console.log('saved', saved, 'screen', await p.evaluate(() => window.__mf.screen));
  await p.screenshot({ path: `${OUT}/e3-lobby.png` });
  const lob = await p.evaluate(() => window.__mf.lobby.settings.customMap && window.__mf.lobby.settings.customMap.name);
  console.log('lobby map', lob);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2200); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const g = await p.evaluate(() => { const s = window.__mf.battle.state; return { structs: s.structures.length, wind: s.wind, map: s.map.name }; });
  console.log('battle', JSON.stringify(g));
  await p.screenshot({ path: `${OUT}/e4-battle.png` });
  // a few turns, firing at whatever (including structures)
  let sAtk = 0;
  for (let t = 0; t < 60; t++) {
    const s = await p.evaluate(() => { const bt = window.__mf.battle; return { mode: bt.ix.mode, tgt: bt.ix.targetId }; });
    if (s.mode === 'move') {
      await p.evaluate(() => { const bt = window.__mf.battle; let best = null; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) if (bt.hexReachable(x, y) && (!best || x > best.x)) best = { x, y }; const m = bt.state.mechs[bt.ix.mechId]; best = best || { x: m.x, y: m.y }; bt.cursor = best; bt.enterFacing(best.x, best.y); });
      await p.waitForTimeout(120); await p.keyboard.press('Enter');
    } else if (s.mode === 'facing') await p.keyboard.press('Enter');
    else if (s.mode === 'attack') {
      if (s.tgt < 0 && !sAtk) { sAtk++; await p.screenshot({ path: `${OUT}/e5-target-structure.png` }); }
      await p.keyboard.press('KeyF');
    } else if (s.mode === 'briefing' || s.mode === 'pass') await p.keyboard.press('Enter');
    await p.waitForTimeout(350);
  }
  const end = await p.evaluate(() => { const s = window.__mf.battle.state; return { round: s.round, structs: s.structures.map((x) => x.kind + ':' + x.cf + (x.dead ? 'X' : '')).join(' '), fire: Object.keys(s.fire || {}).length }; });
  console.log('end', JSON.stringify(end), 'structure targeted', sAtk);
  await p.screenshot({ path: `${OUT}/e6-late.png` });
  // lobby: random map with heavy defences
  await p.evaluate(() => { const app = window.__mf; app.endSession(); app.startLocal('skirmish'); app.session.send({ t: 'settings', settings: { defences: 'heavy', seed: 'defui', theme: 'desert' } }); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/e7-lobby-defences.png` });
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(2200); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = window.__mf.battle.state; const S = s.structures[0]; window.__mf.battle.cursor = { x: S.x, y: S.y }; window.__mf.battle.updateCursorOverlay(); window.__mf.battle.render(); window.__mf.renderer.focusHex(S.x, S.y); window.__mf.renderer.cam.wantDist = 10; });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/e8-defences.png` });
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
