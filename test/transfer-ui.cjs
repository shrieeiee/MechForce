// Moving pilots, maps and settings to another device with a backup code; map share codes.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  const mk = async (seed) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((sd) => { if (sd && !localStorage.getItem('mechforce.pilots')) { localStorage.setItem('mechforce.settings', JSON.stringify({ quality: 'low', colorblind: true })); localStorage.setItem('mechforce.pilots', JSON.stringify([{ id: 'p1', name: 'Mira Okafor', callsign: 'Kestrel', bg: 'academy', gun: 3, pil: 4, abilities: ['sniper'], xp: 5, xpTotal: 40, battles: 6, kills: 3, wins: 4, dmg: 300, rest: 0, dead: false, portrait: {}, log: [] }])); } }, seed);
    await p.goto('file://' + process.cwd() + '/dist/web/index.html'); await p.waitForTimeout(1300);
    return p;
  };
  const a = await mk(true);
  // device A: a saved map too
  await p0(a);
  async function p0(p) {
    await p.click('[data-key=editor]'); await p.waitForTimeout(800);
    await p.keyboard.press('KeyP'); await p.waitForTimeout(200); await p.fill('#mname', 'Shared Ridge'); await p.click('[data-key=save]'); await p.waitForTimeout(300);
    await p.keyboard.press('KeyP'); await p.waitForTimeout(200); await p.click('[data-key=share]'); await p.waitForTimeout(400);
  }
  const mapCode = await a.evaluate(() => navigator.clipboard.readText());
  console.log('map code', mapCode.slice(0, 12) + '…', mapCode.length, 'chars');
  await a.evaluate(() => window.__mf.showTitle()); await a.waitForTimeout(500);
  await a.evaluate(() => window.__mf.showSettings(() => window.__mf.showTitle())); await a.waitForTimeout(300);
  await a.click('[data-key=transfer]'); await a.waitForTimeout(300);
  await a.click('[data-key=x-settings]'); // include settings
  await a.click('[data-key=code]'); await a.waitForTimeout(600);
  const code = await a.evaluate(() => navigator.clipboard.readText());
  console.log('backup code', code.slice(0, 12) + '…', code.length, 'chars');
  await a.context().close();
  // device B: empty; paste the backup code
  const bp = await mk(false);
  await bp.evaluate(() => window.__mf.showSettings(() => window.__mf.showTitle())); await bp.waitForTimeout(300);
  await bp.click('[data-key=transfer]'); await bp.waitForTimeout(300);
  await bp.click('[data-key=paste]'); await bp.waitForTimeout(300);
  await bp.fill('.paste-dlg textarea', code); await bp.click('.paste-dlg [data-key=ok]'); await bp.waitForTimeout(600);
  const got = await bp.evaluate(() => ({ pilots: JSON.parse(localStorage.getItem('mechforce.pilots') || '[]').map((p) => p.callsign), maps: JSON.parse(localStorage.getItem('mechforce.maps') || '[]').map((m) => m.name), colorblind: JSON.parse(localStorage.getItem('mechforce.settings')).colorblind, toast: (document.querySelector('.toast') || {}).textContent }));
  console.log('device B now has', JSON.stringify(got));
  // map code pasted into B's editor
  await bp.evaluate(() => window.__mf.showTitle()); await bp.waitForTimeout(400);
  await bp.click('[data-key=editor]'); await bp.waitForTimeout(800);
  await bp.keyboard.press('KeyP'); await bp.waitForTimeout(200); await bp.click('[data-key=load]'); await bp.waitForTimeout(200);
  await bp.click('[data-key=paste-code]'); await bp.waitForTimeout(200);
  await bp.fill('.paste-dlg textarea', mapCode); await bp.click('.paste-dlg [data-key=ok]'); await bp.waitForTimeout(800);
  console.log('editor map', await bp.evaluate(() => document.querySelector('.ed-name').textContent));
  console.log('errors', errs.length ? errs : 'none');
  await b.close();
})();
