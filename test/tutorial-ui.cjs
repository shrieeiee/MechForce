// The tutorial in the browser: starts from the title menu, coaches each step, finishes.
// OUT=dir node test/tutorial-ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  await p.addInitScript(() => { if (!localStorage.getItem('mechforce.settings')) localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 8 })); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message + e.stack));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1500);
  const first = await p.evaluate(() => [...document.querySelectorAll('[data-key]')].map((e) => e.dataset.key));
  ok(first.indexOf('tutorial') >= 0 && first.indexOf('tutorial') < first.indexOf('skirmish'), 'new players see Tutorial above Skirmish');
  await p.click('[data-key=tutorial]'); await p.waitForTimeout(1500);
  const info = await p.evaluate(() => { const st = window.__mf.battle.state; return st && { mechs: st.mechs.map((m) => m.design + ':' + m.armor.reduce((a, c) => a + c, 0)), mode: window.__mf.battle.ix.mode }; });
  ok(info && info.mechs.length === 2 && info.mechs[0].startsWith('Warhammer') && info.mechs[1].startsWith('Shadow Hawk'), 'straight into a one-on-one: ' + JSON.stringify(info));
  await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const coach = () => p.evaluate(() => { const c = document.querySelector('.coach'); return c ? c.querySelector('b').textContent + ' | ' + c.querySelector('.eyebrow').textContent : null; });
  ok((await coach() || '').startsWith('Moving'), 'coach opens on moving: ' + await coach());
  if (OUT) await p.screenshot({ path: OUT + '/tutorial-1.png' });
  // play it through the game API: walk at the enemy, fire everything in range, hold otherwise
  const seen = new Set();
  for (let n = 0; n < 400; n++) {
    const c = await coach(); if (c) seen.add(c.split(' | ')[0]);
    const done = await p.evaluate(async () => {
      const app = window.__mf, bt = app.battle, st = bt.state, R = app.session.room, g = R.game;
      if (g.over) return true;
      if (g.order[g.turnIdx] !== 0 || bt.ix.mode === 'anim') return false;
      const { aiNextCommand } = window.__mfTest || {};
      void aiNextCommand;
      return null;
    });
    if (done) break;
    if (done === null) {
      await p.evaluate(() => {
        const bt = window.__mf.battle, st = bt.state, ix = bt.ix;
        if (ix.mode === 'pick') { bt.onAction('confirm'); return; }
        if (ix.mode === 'move') {
          const me = st.mechs[0], foe = st.mechs[1];
          let best = null, bd = 1e9;
          const reach = ix.reach[ix.moveMode], w = st.map.w, h = st.map.h;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            let can = false; for (let f = 0; f < 6; f++) if (isFinite(reach.cost[(y * w + x) * 6 + f])) can = true;
            if (!can || (x === me.x && y === me.y)) continue;
            const dx = x - foe.x, dy = y - foe.y, d = dx * dx + dy * dy; if (d < bd && d > 8) { bd = d; best = { x, y }; }
          }
          if (best) { bt.cursor = best; bt.enterFacing(best.x, best.y); } else bt.onAction('confirm');
          return;
        }
        if (ix.mode === 'facing') { bt.onAction('confirm'); return; }
        if (ix.mode === 'attack') { bt.onAction('x'); return; }
      });
    }
    await p.waitForTimeout(160);
    if (OUT && n === 12) await p.screenshot({ path: OUT + '/tutorial-2.png' });
  }
  await p.waitForTimeout(800);
  console.log('steps seen:', [...seen].join(', '));
  ok(seen.has('Opening fire') && seen.has('Watch your heat') && seen.has('Armour and angles'), 'the coach moves through firing, heat and damage');
  const over = await p.evaluate(() => { const g = window.__mf.session.room.game; return { over: g.over, round: g.round, w: g.winner }; });
  ok(over.over, 'the battle ends: ' + JSON.stringify(over));
  console.log(await p.evaluate(() => { const g = window.__mf.session.room.game; return JSON.stringify(g.mechs.map((m) => ({ d: m.design, dead: m.dead, heat: m.heat, sd: m.shutdown, armor: m.armor, int: m.internal, ko: m.pilot.ko, hits: m.pilot.hits, st: m.stats }))) + JSON.stringify(g.log ? g.log.slice(-12).map((l) => l.text || l) : ''); }));
  const txt = await p.evaluate(() => document.querySelector('.modal h2')?.textContent);
  ok(/Tutorial complete|Defeat|Victory/.test(txt || ''), 'results: ' + txt);
  if (OUT) await p.screenshot({ path: OUT + '/tutorial-3.png' });
  ok(!errs.length, 'no page errors ' + errs.join('\n').slice(0, 400));
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
})();
