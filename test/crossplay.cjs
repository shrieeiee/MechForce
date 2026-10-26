const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mk = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 960, height: 600 } });
    await ctx.addInitScript((n) => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8, name: n })), name);
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', (e) => p.errs.push(e.message));
    return p;
  };
  const A = await mk('DeckPlayer'), B = await mk('PhonePlayer');
  await A.goto('http://localhost:7373/'); await A.waitForTimeout(2500);
  await B.goto('http://localhost:7373/'); await B.waitForTimeout(2500);
  const lobby = await A.evaluate(() => window.__mf.lobby);
  console.log('slots:', lobby.slots.map((s) => s.name + '=' + s.ctrl).join(', '), 'clients:', lobby.clients.map((c) => c.name).join(','));
  // B readies, A starts
  await B.evaluate(() => { const app = window.__mf; const side = app.lobby.slots.findIndex((s) => s.ctrl === app.session.myId); app.session.send({ t: 'ready', side, v: true }); });
  await A.waitForTimeout(600);
  await A.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await A.waitForTimeout(2500);
  for (const p of [A, B]) await p.keyboard.press('Enter'); // dismiss briefings
  const turns = [];
  for (let i = 0; i < 40; i++) {
    for (const [nm, p] of [['A', A], ['B', B]]) {
      const ix = await p.evaluate(() => window.__mf.battle.ix.mode);
      if (ix === 'move') { await p.keyboard.press('KeyD'); await p.keyboard.press('KeyD'); await p.keyboard.press('Enter'); await p.waitForTimeout(100); await p.keyboard.press('Enter'); turns.push(nm + ':move'); }
      else if (ix === 'facing') { await p.keyboard.press('Enter'); }
      else if (ix === 'attack') { await p.keyboard.press('KeyF'); turns.push(nm + ':fire'); }
      else if (ix === 'briefing' || ix === 'pass') await p.keyboard.press('Enter');
    }
    await A.waitForTimeout(700);
  }
  const sa = await A.evaluate(() => { const s = window.__mf.battle.state; return { seq: s.seq, round: s.round, hp: s.mechs.map((m) => m.armor.reduce((a, b) => a + b, 0)).join(',') }; });
  const sb = await B.evaluate(() => { const s = window.__mf.battle.state; return { seq: s.seq, round: s.round, hp: s.mechs.map((m) => m.armor.reduce((a, b) => a + b, 0)).join(',') }; });
  console.log('A', JSON.stringify(sa)); console.log('B', JSON.stringify(sb));
  console.log('in sync:', JSON.stringify(sa) === JSON.stringify(sb), 'turn actions:', turns.length, turns.slice(0, 12).join(' '));
  await A.screenshot({ path: OUT + '/10-xA.png' }); await B.screenshot({ path: OUT + '/11-xB.png' });
  console.log('errors A:', A.errs.slice(0, 5), 'B:', B.errs.slice(0, 5));
  await b.close();
})();
