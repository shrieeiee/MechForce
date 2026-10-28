// Peer-to-peer hosting test: needs `peerjs --port 9000 --path /` and dist/web served on :8090.
const { chromium } = require('playwright');
const OUT = process.env.OUT || '.';
const N = +(process.env.N || 2);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const mk = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 960, height: 600 } });
    await ctx.addInitScript((n) => { localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8, name: n })); localStorage.setItem('mechforce.signal', '127.0.0.1:9000'); }, name);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p;
  };
  const A = await mk('Host');
  await A.goto('http://127.0.0.1:8090/'); await A.waitForTimeout(2000);
  await A.evaluate(() => window.__mf.hostOnline());
  await A.waitForFunction(() => window.__mf.session && window.__mf.session.status === 'online', null, { timeout: 15000 });
  const code = await A.evaluate(() => window.__mf.session.code);
  await A.waitForTimeout(800);
  console.log('host code', code, 'share:', await A.evaluate(() => document.querySelector('#sharel') && document.querySelector('#sharel').value));
  if (N > 2) { await A.evaluate((n) => window.__mf.session.send({ t: 'settings', settings: { sides: n } }), N); await A.waitForTimeout(500); }
  const joiners = [];
  for (let i = 1; i < N; i++) { const p = await mk('Peer' + i); await p.goto('http://127.0.0.1:8090/?join=' + code); joiners.push(p); }
  await A.waitForFunction((n) => window.__mf.lobby && window.__mf.lobby.clients.length === n, N, { timeout: 30000 });
  let lobby = await A.evaluate(() => window.__mf.lobby);
  console.log('slots:', lobby.slots.map((s) => s.name + '=' + s.ctrl).join(', '), '| clients:', lobby.clients.map((c) => c.name).join(','));
  for (const p of joiners) await p.evaluate(() => { const app = window.__mf; const side = app.lobby.slots.findIndex((s) => s.ctrl === app.session.myId); if (side < 0) { const open = app.lobby.slots.findIndex((s) => s.ctrl === 'open' || s.ctrl === 'ai'); app.session.send({ t: 'slot', side: open, ctrl: 'me' }); } });
  await A.waitForTimeout(800);
  for (const p of joiners) await p.evaluate(() => { const app = window.__mf; const side = app.lobby.slots.findIndex((s) => s.ctrl === app.session.myId); app.session.send({ t: 'ready', side, v: true }); });
  await A.waitForTimeout(800);
  lobby = await A.evaluate(() => window.__mf.lobby);
  console.log('slots now:', lobby.slots.map((s) => s.name + '=' + s.ctrl + (s.ready ? '*' : '')).join(', '));
  if (process.env.CHASSIS) {
    await A.evaluate(() => window.__mf.session.send({ t: 'settings', settings: { tonnage: 400 } })); await A.waitForTimeout(300);
    const L = ['Arion', 'Goliath', 'Triskelion', 'Brahma'], R = ['Harpagos', 'Scorpion', 'Tarantula', 'Barghest'];
    await A.evaluate((l) => window.__mf.session.send({ t: 'lance', side: 0, lance: l }), L);
    for (const pp of joiners) await pp.evaluate((r) => { const app = window.__mf; const side = app.lobby.slots.findIndex((s) => s.ctrl === app.session.myId); app.session.send({ t: 'lance', side, lance: r }); app.session.send({ t: 'ready', side, v: true }); }, R);
    await A.waitForTimeout(800);
  }
  await A.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await A.waitForTimeout(2500);
  const all = [A, ...joiners];
  for (const p of all) await p.keyboard.press('Enter');
  if (process.env.RECON) { await joiners[0].evaluate(() => window.__mf.session.conn.close()); await A.waitForTimeout(6000); console.log('after drop: peer status', await joiners[0].evaluate(() => window.__mf.session.status), 'peer id', await joiners[0].evaluate(() => window.__mf.session.myId), 'clients', await A.evaluate(() => window.__mf.lobby.clients.map((c) => c.id + (c.connected ? '' : '(off)')).join(','))); }
  let acts = 0;
  for (let i = 0; i < 40; i++) {
    for (const p of all) {
      const ix = await p.evaluate(() => window.__mf.battle && window.__mf.battle.ix.mode);
      if (ix === 'move') {
        // drive/convert sometimes so the network carries the new modes
        const did = await p.evaluate((i) => { const bt = window.__mf.battle; const keys = Object.keys(bt.ix.reach || {}); const k = keys.find((x) => x.includes('+cv') || x === 'track' || x === 'cruise'); if (!k || i % 2) return false; bt.setMoveMode(k); const m = bt.state.mechs[bt.ix.mechId]; const r = bt.ix.reach[k]; for (let y = 0; y < bt.state.map.h; y++) for (let x = 0; x < bt.state.map.w; x++) if ((x !== m.x || y !== m.y) && bt.hexReachable(x, y)) { bt.cursor = { x, y }; bt.enterFacing(x, y); return true; } return false; }, acts);
        if (did) { await p.waitForTimeout(100); await p.keyboard.press('Enter'); } else { await p.keyboard.press('KeyF'); await p.waitForTimeout(100); await p.keyboard.press('Enter'); }
        acts++;
      }
      else if (ix === 'facing') await p.keyboard.press('Enter');
      else if (ix === 'attack') { await p.keyboard.press('KeyF'); acts++; }
      else if (ix === 'briefing' || ix === 'pass') await p.keyboard.press('Enter');
    }
    await A.waitForTimeout(600);
  }
  const snap = (p) => p.evaluate(() => { const s = window.__mf.battle.state; return JSON.stringify({ seq: s.seq, round: s.round, hp: s.mechs.map((m) => m.armor.reduce((a, b) => a + b, 0)).join(','), vm: s.mechs.map((m) => m.vmode[0]).join('') }); });
  const ss = []; for (const p of all) ss.push(await snap(p));
  ss.forEach((s, i) => console.log(i ? 'peer' + i : 'host ', s));
  console.log('in sync:', ss.every((s) => s === ss[0]), 'actions:', acts);
  await A.screenshot({ path: OUT + '/p2p-host.png' }); await joiners[0].screenshot({ path: OUT + '/p2p-peer.png' });
  console.log('errors:', all.map((p) => p.errs.slice(0, 3)));
  await b.close();
})();
