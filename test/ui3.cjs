const { chromium } = require('playwright');
const OUT = process.env.OUT;
async function run(b, vp, mobile, tag) {
  const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html');
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish'); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'settings', settings: { mapSize: 'S', seed: 'close1', theme: 'desert' } }); s.send({ t: 'lance', side: 0, lance: ['Archer', 'Catapult'] }); });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(1200);
  // bring every enemy mech close, on open ground
  await p.evaluate(() => {
    const st = window.__mf.session.room.game;
    const me = st.mechs.filter((m) => m.side === 0);
    const en = st.mechs.filter((m) => m.side === 1);
    en.forEach((e, i) => { e.x = me[0].x + 4 + (i % 2); e.y = Math.max(0, Math.min(st.map.h - 1, me[0].y - 1 + i)); st.map.t[e.y * st.map.w + e.x] = 0; e.f = 3; });
    for (let x = me[0].x; x < me[0].x + 7; x++) for (let y = me[0].y - 2; y < me[0].y + 4; y++) if (y >= 0 && y < st.map.h) { st.map.e[y * st.map.w + x] = 0; st.map.t[y * st.map.w + x] = 0; }
    window.__mf.battle.r.buildMap(st.map); window.__mf.battle.r.syncMechs(st);
  });
  await p.keyboard.press('Enter');
  for (let i = 0; i < 40; i++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'move') break; if (m === 'briefing') await p.keyboard.press('Enter'); await p.waitForTimeout(500); }
  await p.keyboard.press('KeyF'); await p.waitForTimeout(200); await p.keyboard.press('Enter');
  for (let i = 0; i < 20; i++) { const m = await p.evaluate(() => window.__mf.battle.ix.mode); if (m === 'attack') break; await p.waitForTimeout(400); }
  await p.waitForTimeout(600);
  if (!mobile) { await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(500); }
  else { await p.waitForTimeout(700); }
  await p.screenshot({ path: `${OUT}/5${tag}-attack.png` });
  console.log(tag, 'errors', errs.slice(0, 3), await p.evaluate(() => window.__mf.battle.ix.noShots));
  await ctx.close();
}
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await run(b, { width: 1366, height: 820 }, false, 'a');
  await run(b, { width: 844, height: 390 }, true, 'b');
  await b.close();
})();
