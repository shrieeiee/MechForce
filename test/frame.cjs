const { chromium } = require('playwright');
const OUT = process.env.OUT;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript(() => localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', speed: 2 })));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/dist/web/index.html');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const app = window.__mf; app.stopAttract(); app.startLocal('skirmish');
    const r = app.renderer; window.__frames = [];
    window.__calls = [];
    const of = r.focusHex.bind(r); r.focusHex = (...a) => { window.__calls.push({ t: performance.now(), args: a.slice(0, 2), st: new Error().stack.split('\n').slice(2, 5).join(' | ') }); return of(...a); };
    const ofm = r.frameMechs.bind(r); r.frameMechs = (...a) => { window.__calls.push({ t: performance.now(), frame: a }); return ofm(...a); };
    const orig = r.animShot.bind(r);
    r.animShot = async (v, t, e, st, sp) => {
      const rect = r.canvas.getBoundingClientRect();
      const on = (m) => { const q = m.model.root.position.clone(); q.y += m.model.height * 0.6; const s = r.project(q); return !s.behind && s.x > rect.left + 20 && s.x < rect.right - 20 && s.y > rect.top + 20 && s.y < rect.bottom - 20; };
      const pr = (m) => { const q = m.model.root.position.clone(); q.y += m.model.height * 0.6; const s = r.project(q); return [Math.round(s.x), Math.round(s.y), s.behind]; }; window.__calls.push({ t: performance.now(), shot: e.id + ':' + e.target }); const W = r.cam.want, T = r.cam.target, A = v.model.root.position, B = t.model.root.position; window.__frames.push({ want: [W.x, W.z].map((n) => n.toFixed(1)), camT: [T.x, T.z].map((n) => n.toFixed(1)), A: [A.x, A.z].map((n) => n.toFixed(1)), B: [B.x, B.z].map((n) => n.toFixed(1)), bounds: r.bounds, a: on(v), t: on(t), pa: pr(v), pt: pr(t), key: r.framed, ids: e.id + ':' + e.target, dist: r.cam.dist.toFixed(1), want: r.cam.wantDist.toFixed(1), yawMoving: r.cam.wantYaw !== null && r.cam.wantYaw !== undefined });
      return orig(v, t, e, st, sp);
    };
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const s = window.__mf.session; s.send({ t: 'settings', settings: { mapSize: 'L', seed: 'framing2' } }); s.send({ t: 'slot', side: 0, ctrl: 'ai' }); });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__mf.session.send({ t: 'start' }));
  await p.waitForTimeout(1500); await p.keyboard.press('Enter');
  let shot = 0;
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000);
    const n = await p.evaluate(() => window.__frames.length);
    if (n > 0 && shot < 2 && n >= shot * 6 + 1) { await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/6${shot}-framed.png` }); shot++; }
    if (n >= 40) break;
  }
  const f = await p.evaluate(() => window.__frames);
  const both = f.filter((x) => x.a && x.t).length;
  console.log('shots', f.length, 'both on screen', both, 'attacker off', f.filter((x) => !x.a).length, 'target off', f.filter((x) => !x.t).length);
  console.log(JSON.stringify(f.filter((x) => !x.a || !x.t)));
  const calls = await p.evaluate(() => window.__calls);
  const bad = f.findIndex((x) => !x.a || !x.t);
  if (bad >= 0) { const shots = calls.map((c, i) => [c, i]).filter(([c]) => c.shot); const [, ci] = shots[bad]; console.log(JSON.stringify(calls.slice(Math.max(0, ci - 8), ci + 1), null, 0)); }
  console.log('errors', errs.slice(0, 3));
  await b.close();
})();
