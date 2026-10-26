const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mk = async (name) => { const ctx = await b.newContext({ viewport: { width: 800, height: 500 } }); await ctx.addInitScript((n) => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8, name: n })), name); const p = await ctx.newPage(); p.on('console', (m) => console.log(name, m.type(), m.text())); return p; };
  const A = await mk('A'), B = await mk('B');
  await A.goto('http://localhost:7373/'); await A.waitForTimeout(2000);
  await B.goto('http://localhost:7373/'); await B.waitForTimeout(2000);
  await B.evaluate(() => { const app = window.__mf; const side = app.lobby.slots.findIndex((s) => s.ctrl === app.session.myId); app.session.send({ t: 'ready', side, v: true }); });
  await A.waitForTimeout(500);
  await A.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await A.waitForTimeout(2000);
  for (const p of [A, B]) await p.keyboard.press('Enter');
  await A.waitForTimeout(1500);
  for (const p of [A, B]) await p.evaluate(() => { const orig = window.__mf.onMsg.bind(window.__mf); window.__mf.onMsg = (m) => { if (m.t === 'error') console.log('ERR', m.msg); orig(m); }; window.__mf.session.handlers.clear(); window.__mf.session.on((m) => window.__mf.onMsg(m)); });
  for (let i = 0; i < 6; i++) {
    for (const [nm, p] of [['A', A], ['B', B]]) {
      const info = await p.evaluate(() => { const bt = window.__mf.battle; const s = bt.state; return { mode: bt.ix.mode, active: s.order[s.turnIdx], my: bt.mySides(), act: s.act, myId: window.__mf.session.myId, ctrls: s.sides.map((x) => x.ctrl) }; });
      console.log(nm, JSON.stringify(info));
      if (info.mode === 'move') { await p.keyboard.press('Enter'); await p.waitForTimeout(100); await p.keyboard.press('Enter'); }
      else if (info.mode === 'attack') await p.keyboard.press('KeyT');
      await p.waitForTimeout(1500);
    }
  }
  await b.close();
})();
