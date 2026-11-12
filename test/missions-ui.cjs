// New missions and physical attacks in the browser. OUT=dir node test/missions-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8, tutorialDone: true })));
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  for (const mission of ['base', 'convoy']) {
    await p.evaluate((mission) => { const app = window.__mf; app.stopAttract(); app.startLocal('skirmish', { mission, mapSize: 'M', seed: 'mui-' + mission, lanceSize: 2 }); }, mission);
    await p.waitForTimeout(500);
    await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'lance', side: 0, lance: ['Hatchetman', 'Atlas'] }); s.send({ t: 'lance', side: 1, lance: ['Griffin', 'Wolverine'] }); s.send({ t: 'start' }); });
    await p.waitForTimeout(1800);
    const st = await p.evaluate(() => { const g = window.__mf.battle.state; return { mission: g.mission, hq: (g.structures || []).filter((s) => s.kind === 'hq').length, trucks: (g.units || []).filter((u) => u.convoy).length, clock: document.querySelector('.mission-card .clock')?.textContent }; });
    console.log(JSON.stringify(st));
    ok(mission === 'base' ? st.hq === 1 : st.trucks === 3, `${mission}: objective on the field`);
    if (OUT) await p.screenshot({ path: `${OUT}/mission-${mission}.png` });
  }
  // melee rows: Hatchetman next to a Griffin straight ahead
  await p.evaluate(() => {
    const app = window.__mf, R = app.session.room, g = R.game;
    for (let i = 0; i < g.map.t.length; i++) { g.map.t[i] = 0; g.map.e[i] = 0; }
    g.structures = []; g.units = [];
    g.mechs[0].x = 7; g.mechs[0].y = 8; g.mechs[0].f = 0; g.mechs[2].x = 9; g.mechs[2].y = 8; g.mechs[2].f = 3;
    g.mechs[1].x = 2; g.mechs[1].y = 2; g.mechs[3].x = 14; g.mechs[3].y = 2;
    g.order = [0, 1, 0, 1]; g.turnIdx = 0; g.act = null;
    app.battle.start(g);
  });
  await p.waitForTimeout(1200); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await p.evaluate(() => { const bt = window.__mf.battle; bt.onAction('confirm'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const bt = window.__mf.battle; bt.cursor = { x: 8, y: 8 }; bt.enterFacing(8, 8); });
  await p.waitForTimeout(200); await p.keyboard.press('Enter'); await p.waitForTimeout(1500);
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-key^=melee-]')].map((e) => e.dataset.key));
  console.log('melee rows', rows.join(' '));
  ok(rows.includes('melee-hatchet') && rows.includes('melee-charge') && rows.includes('melee-push'), 'Hatchetman gets hatchet, charge and push');
  await p.hover('[data-key=melee-charge]').catch(() => {}); await p.waitForTimeout(500);
  if (OUT) await p.screenshot({ path: `${OUT}/melee-rows.png` });
  await p.evaluate(() => { const bt = window.__mf.battle; for (let i = 0; i < 8 && bt.ix.melee !== 'charge'; i++) bt.onAction('y'); bt.onAction('x'); });
  await p.waitForTimeout(2500);
  const log = await p.evaluate(() => window.__mf.session.room.game.log.slice(-6).map((l) => l.text || l).join(' / '));
  console.log(log);
  ok(/charges/i.test(log), 'the charge goes through');
  ok(!errs.length, 'no page errors ' + errs.join('\n').slice(0, 400));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
})();
