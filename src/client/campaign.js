// Mercenary campaign screens: the company hub (contracts, hangar, market, hiring, record)
// and the deployment screen. The rules live in core/campaign.js; the company is saved on
// this device. Battles run through a local game; main.js settles them afterwards.
import { MISSIONS, THEMES, MAP_SIZES, AI_LEVELS, CLASS_NAMES } from '../core/data.js';
import { newCompany, mechState, repair, sellMech, buyMech, templateOf, designName, mechPrice, fmtC, DIFFICULTY, SALARY, hireCost, bankrupt, companyStrength } from '../core/campaign.js';
import { newPilot, randomName, randomPortrait, BACKGROUNDS, BACKGROUND_IDS, RANKS, ABILITIES } from '../core/pilots.js';
import { hashSeed, nextRand } from '../core/rng.js';
import { $, $$, html, esc, toast } from './ui.js';
import { attr } from './tips.js';
import { sfx, music } from './audio.js';
import { portraitSVG } from './portrait.js';
import { loadRoster, saveRoster, fitPilots, MAX_ROSTER } from './pilotstore.js';
import { statusOf } from './barracks.js';

const KEY = 'mechforce.campaign';
export function loadCompany() { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.v === 1 ? c : null; } catch { return null; } }
export function saveCompany(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch { return false; } }
export function dropCompany() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

const TABS = [['contracts', 'Contracts'], ['hangar', 'Hangar'], ['market', 'Market'], ['hire', 'Hire'], ['record', 'Record']];
const missionName = (id) => MISSIONS.find((m) => m.id === id)?.name || id;

// Recruits for hire: three fresh MechWarriors per contract, the same until the next one
function recruits(co) {
  const s = { rng: hashSeed('hire' + co.seed + ':' + co.contracts) };
  const rnd = () => nextRand(s);
  const taken = co.hired || [];
  return [0, 1, 2].map((i) => {
    const bg = BACKGROUND_IDS[Math.floor(rnd() * BACKGROUND_IDS.length)];
    const nm = randomName(rnd);
    const p = newPilot({ ...nm, bg, portrait: randomPortrait(rnd), id: `h${co.contracts}-${i}-${co.seed}` });
    // a bit of spread: some are better than their background, some worse
    const r = rnd();
    if (r < 0.25) p.gun = Math.min(6, p.gun + 1); else if (r > 0.8) p.gun = Math.max(2, p.gun - 1);
    return { p, cost: hireCost(p), taken: taken.includes(p.id) };
  });
}

export function showCampaign(app, { onExit, tab = 'contracts' } = {}) {
  let co = loadCompany();
  if (!co) { founding(app, onExit); return; }
  if (bankrupt(co)) { bust(app, co, onExit); return; }
  music('menu');
  let cur = tab, sel = 0;
  const save = () => { if (!saveCompany(co)) toast('Couldn\'t save — this device\'s storage is full or blocked'); };

  const render = () => {
    const el = html(`<div class="screen campaign">
      <div class="screen-head"><div><div class="eyebrow">Mercenary company · day ${co.day}</div><h2>${esc(co.name)}</h2></div><div class="spacer"></div>
        <div class="cp-stats"><span ${attr('C-bills', '<p>The company\'s money. Contracts and salvage pay it in; repairs, new mechs, hiring and MechWarriors\' pay ($SAL a contract each) take it out. Fall too far into debt and the company folds.</p>'.replace('$SAL', fmtC(SALARY)))}><b class="${co.cbills < 0 ? 'bad-t' : ''}">${fmtC(co.cbills)}</b></span>
          <span ${attr('Reputation', '<p>Wins raise it and losses lower it. Better reputation brings better-paid — and more dangerous — contracts.</p>')}>Reputation <b>${co.rep}</b></span>
          <span>${co.wins}/${co.contracts} won</span></div></div>
      <div class="tabs cp-tabs">${TABS.map(([k, n]) => `<div class="tab nav ${k === cur ? 'on' : ''}" data-key="tab-${k}" data-tab="${k}">${n}</div>`).join('')}</div>
      <div class="screen-body cp-body">${body()}</div></div>`);
    $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => { cur = b.dataset.tab; sel = 0; sfx('ui-move'); render(); }));
    wire(el);
    app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'lb', label: 'Tab' }, { a: 'back', label: 'Back' }]);
  };
  const body = () => {
    if (cur === 'contracts') {
      return `<div class="cp-cards">${co.board.map((c, i) => {
        const L = AI_LEVELS[c.aiLevel];
        return `<div class="panel pad cp-card ${c.diff >= 3 ? 'deadly' : ''}">
          <div class="eyebrow">${esc(c.employer)} · ${esc(c.world)}</div><h3>${esc(missionName(c.mission))}</h3><p class="dim">${esc(c.text)}</p>
          <div class="cp-facts"><span class="chip-sm ${c.diff >= 2 ? 'hot' : ''}" ${attr('Danger', `<p>Enemy lance about ${c.enemyTons} tons, flown by ${esc(L.name.toLowerCase())} pilots.</p>`)}>${DIFFICULTY[c.diff]}</span>
            <span>${esc(MAP_SIZES.find((z) => z.id === c.mapSize).name)} · ${esc(THEMES.find((t) => t.id === c.theme).name)}</span>
            ${c.fog ? '<span>Fog of war</span>' : ''}${c.forces !== 'none' ? '<span>Ground forces</span>' : ''}${c.defences !== 'none' ? '<span>Fortified</span>' : ''}</div>
          <div class="cp-pay"><div><b>${fmtC(c.pay)}</b><div class="faint sm">on success</div></div>
            <div><b>${fmtC(c.killBonus)}</b><div class="faint sm">per kill</div></div><div><b>${Math.round(c.salvage * 100)}%</b><div class="faint sm">salvage</div></div></div>
          <div class="btn primary nav" data-key="take-${i}" data-take="${i}">Take contract</div></div>`;
      }).join('')}</div>`;
    }
    if (cur === 'hangar') {
      return `<div class="panel scroll cp-list">${co.mechs.map((m, i) => {
        const s = mechState(m), t = templateOf(m.design);
        return `<div class="cp-row">
          <div class="grow"><b>${esc(designName(m.design))}</b> <span class="faint">${t ? `${t.t}t ${CLASS_NAMES[t.c].toLowerCase()}` : ''}${m.kills ? ` · ${m.kills} kill${m.kills > 1 ? 's' : ''}` : ''}</span>
            <div class="sm ${s.wrecked ? 'bad-t' : s.ok && !s.needs ? 'ok-t' : 'warn'}">${s.wrecked ? 'Wrecked — needs rebuilding' : s.destroyedLoc ? 'A section is destroyed — needs repair before it can fight' : s.needs ? `Damaged · ${s.armorPct}% armour and structure` : 'Ready'}</div>
            <div class="bar sm-bar"><span class="track"><span class="fill" style="width:${s.armorPct}%"></span></span></div></div>
          ${s.cost ? `<div class="btn nav sm" data-key="rep-${i}" data-repair="${m.uid}">${s.wrecked ? 'Rebuild' : 'Repair'} · ${fmtC(s.cost)}</div>` : ''}
          <div class="btn nav sm" data-key="sell-${i}" data-sell="${m.uid}">Sell</div></div>`;
      }).join('') || '<p class="faint">No mechs. Buy one at the market.</p>'}
      ${co.mechs.some((m) => mechState(m).cost) ? '<div class="btn nav" data-key="repall">Repair everything affordable</div>' : ''}</div>`;
    }
    if (cur === 'market') {
      return `<div class="panel scroll cp-list"><p class="dim">New stock arrives after every contract.</p>${co.market.map((o, i) => {
        const t = templateOf(o.design);
        return `<div class="cp-row"><div class="grow"><b>${esc(designName(o.design))}</b> <span class="faint">${t.t}t ${CLASS_NAMES[t.c].toLowerCase()} · walk ${t.w}${t.j ? ' · jump ' + t.j : ''}</span></div>
          <div class="btn nav sm ${co.cbills < o.price ? 'disabled' : ''}" data-key="buy-${i}" data-buy="${i}">Buy · ${fmtC(o.price)}</div></div>`;
      }).join('') || '<p class="faint">Sold out.</p>'}</div>`;
    }
    if (cur === 'hire') {
      const roster = loadRoster();
      const fit = fitPilots(roster).length;
      return `<div class="panel scroll cp-list"><p class="dim">Your company's MechWarriors are the Barracks roster: ${fit} fit for duty, ${roster.filter((p) => !p.dead).length - fit} recovering. Each is paid ${fmtC(SALARY)} for every contract they fight.</p>
        <div class="btn nav" data-key="barracks">Open the Barracks</div>
        ${recruits(co).map((r, i) => `<div class="cp-row">${portraitSVG(r.p.portrait, { size: 44 })}<div class="grow"><b>${esc(r.p.callsign)}</b> <span class="faint">${esc(r.p.name)} · ${esc(RANKS(r.p))} · ${esc(BACKGROUNDS[r.p.bg].name)}</span>
          <div class="dim sm">Gunnery ${r.p.gun} · Piloting ${r.p.pil}${r.p.abilities.length ? ' · ' + r.p.abilities.map((a) => esc(ABILITIES[a].name)).join(', ') : ''}</div></div>
          ${r.taken ? '<span class="ok-t sm">Hired</span>' : `<div class="btn nav sm ${co.cbills < r.cost ? 'disabled' : ''}" data-key="hire-${i}" data-hire="${i}">Hire · ${fmtC(r.cost)}</div>`}</div>`).join('')}</div>`;
    }
    return `<div class="panel scroll cp-list pad">${co.log.map((l) => `<div class="cp-log"><span class="faint">Day ${l.day}</span> ${esc(l.text)}</div>`).join('')}
      <div class="btn nav danger" data-key="disband">Disband the company</div></div>`;
  };
  const wire = (el) => {
    $$('[data-take]', el).forEach((b) => b.addEventListener('click', () => deploy(app, co, co.board[+b.dataset.take], () => showCampaign(app, { onExit, tab: 'contracts' }))));
    $$('[data-repair]', el).forEach((b) => b.addEventListener('click', () => { if (repair(co, b.dataset.repair)) { save(); sfx('ui-ok'); } else toast('Not enough C-bills'); render(); }));
    $$('[data-sell]', el).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = `Sell for ${fmtC(Math.round(mechPrice(co.mechs.find((m) => m.uid === b.dataset.sell).design) * 0.5 / 10000) * 10000)}? Press again`; return; }
      sellMech(co, b.dataset.sell); save(); sfx('ui-ok'); render();
    }));
    const ra = $('[data-key=repall]', el);
    if (ra) ra.addEventListener('click', () => { let n = 0; for (const m of co.mechs.slice().sort((a, b) => mechState(a).cost - mechState(b).cost)) if (mechState(m).cost && repair(co, m.uid)) n++; save(); toast(n ? `Repaired ${n} mech${n > 1 ? 's' : ''}` : 'Not enough C-bills'); render(); });
    $$('[data-buy]', el).forEach((b) => b.addEventListener('click', () => { if (buyMech(co, +b.dataset.buy)) { save(); sfx('ui-ok'); } else toast('Not enough C-bills'); render(); }));
    $$('[data-hire]', el).forEach((b) => b.addEventListener('click', () => {
      const r = recruits(co)[+b.dataset.hire];
      const roster = loadRoster();
      if (roster.filter((p) => !p.dead).length >= MAX_ROSTER) { toast(`The barracks hold ${MAX_ROSTER} MechWarriors.`); return; }
      if (co.cbills < r.cost) { toast('Not enough C-bills'); return; }
      co.cbills -= r.cost; co.hired = [...(co.hired || []), r.p.id].slice(-30);
      roster.unshift(r.p); saveRoster(roster);
      co.log.unshift({ day: co.day, text: `Hired ${r.p.name} “${r.p.callsign}” for ${fmtC(r.cost)}.` });
      save(); sfx('ui-ok'); render();
    }));
    const bk = $('[data-key=barracks]', el);
    if (bk) bk.addEventListener('click', () => app.showBarracksFrom(() => showCampaign(app, { onExit, tab: 'hire' })));
    const db = $('[data-key=disband]', el);
    if (db) db.addEventListener('click', () => { if (db.dataset.armed !== '1') { db.dataset.armed = '1'; db.textContent = 'Press again to disband — this deletes the company'; return; } dropCompany(); onExit(); });
  };
  const cycle = (d) => { const i = TABS.findIndex(([k]) => k === cur); cur = TABS[(i + d + TABS.length) % TABS.length][0]; sfx('ui-move'); render(); };
  app.setScreen('campaign', render, (a) => { if (a === 'lb') { cycle(-1); return true; } if (a === 'rb') { cycle(1); return true; } return false; }, onExit);
  void sel;
}

function founding(app, onExit) {
  const el = html(`<div class="screen campaign"><div class="panel pad stack cp-found">
    <div class="eyebrow">New campaign</div><h2>Found a mercenary company</h2>
    <p class="brief">Take contracts for pay and salvage. Your mechs keep their damage until you pay to repair them, wrecks must be rebuilt or scrapped, and your MechWarriors — the Barracks roster — earn experience, take wounds and draw pay. Win to build your reputation and land richer, deadlier contracts. Fall too far into debt and the company is finished.</p>
    <div class="field"><label for="coname">Company name</label><input id="coname" class="nav" data-key="name" maxlength="28" value="Grey Wolves" autocomplete="off"></div>
    <div class="row"><div class="btn primary nav" data-key="found">Found the company · ${fmtC(4000000)} and four mechs</div><div class="btn nav" data-key="back">Back</div></div></div></div>`);
  $('[data-key=found]', el).addEventListener('click', () => {
    const co = newCompany($('#coname', el).value.trim() || 'Grey Wolves', Date.now());
    // a company needs pilots: recruit enough to crew the starting lance
    const roster = loadRoster();
    const need = Math.max(0, 4 - fitPilots(roster).length);
    for (let i = 0; i < need; i++) {
      const bg = BACKGROUND_IDS[Math.floor(Math.random() * BACKGROUND_IDS.length)];
      roster.unshift(newPilot({ ...randomName(), bg, portrait: randomPortrait() }));
    }
    if (need) { saveRoster(roster); co.log.unshift({ day: 1, text: `Signed ${need} MechWarrior${need > 1 ? 's' : ''} to crew the lance.` }); }
    saveCompany(co); sfx('ui-ok');
    showCampaign(app, { onExit });
  });
  $('[data-key=back]', el).addEventListener('click', onExit);
  app.setScreen('campaign', () => app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }]), null, onExit);
}

function bust(app, co, onExit) {
  const el = html(`<div class="screen campaign"><div class="panel pad stack cp-found"><div class="eyebrow">Day ${co.day}</div><h2>${esc(co.name)} is finished</h2>
    <p class="brief">With ${fmtC(co.cbills)} in debt and no way to field a lance, the company's creditors seize what's left. ${co.wins} contract${co.wins === 1 ? '' : 's'} won out of ${co.contracts}.</p>
    <div class="btn primary nav" data-key="new">Start again</div><div class="btn nav" data-key="back">Back</div></div></div>`);
  $('[data-key=new]', el).addEventListener('click', () => { dropCompany(); showCampaign(app, { onExit }); });
  $('[data-key=back]', el).addEventListener('click', onExit);
  app.setScreen('campaign', () => app.mount(el, [{ a: 'confirm', label: 'Select' }]), null, onExit);
}

// ---- deployment: pick up to four ready mechs and a MechWarrior for each
function deploy(app, co, c, back) {
  const ready = co.mechs.filter((m) => mechState(m).ok);
  if (!ready.length) { toast('No mech is fit to fight — repair or buy one first.'); return; }
  const fit = fitPilots(loadRoster());
  if (!fit.length) { toast('No MechWarrior is fit for duty — hire one first.'); return; }
  // best-armoured mechs first, then the best pilots in the biggest mechs
  const picks = ready.slice().sort((a, b) => templateOf(b.design).t - templateOf(a.design).t).slice(0, Math.min(4, fit.length)).map((m) => m.uid);
  const pilots = {};
  const byQuality = fit.slice().sort((a, b) => a.gun + a.pil - (b.gun + b.pil));
  picks.forEach((uid, i) => { pilots[uid] = byQuality[i] ? byQuality[i].id : null; });
  const render = () => {
    const used = new Set(Object.entries(pilots).filter(([u]) => picks.includes(u)).map(([, p]) => p).filter(Boolean));
    const tons = picks.reduce((s, u) => s + templateOf(co.mechs.find((m) => m.uid === u).design).t, 0);
    const el = html(`<div class="screen campaign"><div class="screen-head"><div><div class="eyebrow">${esc(c.employer)} · ${esc(c.world)}</div><h2>Deploy: ${esc(missionName(c.mission))}</h2></div><div class="spacer"></div>
      <div class="dim">Your lance ${tons}t vs about ${c.enemyTons}t · ${DIFFICULTY[c.diff]}</div></div>
      <div class="screen-body"><div class="panel scroll cp-list">
        ${ready.map((m, i) => {
          const on = picks.includes(m.uid), s = mechState(m), t = templateOf(m.design);
          const p = fit.find((x) => x.id === pilots[m.uid]);
          return `<div class="cp-row ${on ? 'on' : ''}"><div class="btn nav sm ${on ? 'primary' : ''}" data-key="pick-${i}" data-pick="${m.uid}">${on ? '✓ In lance' : 'Add'}</div>
            <div class="grow"><b>${esc(designName(m.design))}</b> <span class="faint">${t.t}t</span><div class="sm ${s.needs ? 'warn' : 'ok-t'}">${s.needs ? `${s.armorPct}% armour and structure` : 'Fully repaired'}</div></div>
            ${on ? `<div class="btn nav sm pa-row" data-key="pil-${i}" data-pil="${m.uid}">${p ? portraitSVG(p.portrait, { size: 28 }) + `<span>${esc(p.callsign)} <span class="faint">G${p.gun}/P${p.pil}</span></span>` : '<span class="warn">No pilot — pick one</span>'}</div>` : ''}</div>`;
        }).join('')}
      </div></div>
      <div class="row"><div class="btn primary nav" data-key="launch">Launch · ${picks.length} mech${picks.length === 1 ? '' : 's'}</div><div class="btn nav" data-key="back">Back</div>
        <div class="faint sm">Pay: ${fmtC(c.pay)} on success · salaries ${fmtC(picks.length * SALARY)}</div></div></div>`);
    $$('[data-pick]', el).forEach((b) => b.addEventListener('click', () => {
      const u = b.dataset.pick;
      const i = picks.indexOf(u);
      if (i >= 0) picks.splice(i, 1);
      else if (picks.length >= 4) { toast('A lance is four mechs'); return; }
      else { picks.push(u); if (!pilots[u]) pilots[u] = (fit.find((p) => !used.has(p.id)) || {}).id || null; }
      sfx('ui-move'); render();
    }));
    $$('[data-pil]', el).forEach((b) => b.addEventListener('click', () => {
      const u = b.dataset.pil;
      const opts = [null, ...fit.filter((p) => !used.has(p.id) || p.id === pilots[u]).map((p) => p.id)];
      pilots[u] = opts[(opts.indexOf(pilots[u] ?? null) + 1) % opts.length];
      sfx('ui-move'); render();
    }));
    $('[data-key=launch]', el).addEventListener('click', () => {
      const lance = picks.filter((u) => pilots[u]);
      if (!lance.length) { toast('Pick at least one mech with a pilot'); return; }
      if (lance.length < picks.length) { toast('Every mech in the lance needs a MechWarrior'); return; }
      const roster = loadRoster();
      app.startCampaignBattle(co, c, lance.map((u) => ({ mech: co.mechs.find((m) => m.uid === u), pilot: roster.find((p) => p.id === pilots[u]) })));
    });
    $('[data-key=back]', el).addEventListener('click', back);
    app.mount(el, [{ a: 'confirm', label: 'Select' }, { a: 'back', label: 'Back' }]);
  };
  app.setScreen('campaign', render, null, back);
}

// After the battle: what the contract paid, what it cost, what was salvaged
export function campaignDebriefHTML(co, res) {
  const line = (k, v, cls = '') => `<tr><td>${esc(k)}</td><td class="num ${cls}">${fmtC(v)}</td></tr>`;
  return `<div class="eyebrow">${esc(co.name)}</div>
    <table class="results-table sm"><tr><th>Contract</th><th></th></tr>
      ${line(res.won ? 'Payment' : 'Payment — contract failed', res.pay)}${res.bonus ? line('Kill bonuses', res.bonus) : ''}${res.salvageC ? line('Salvaged parts', res.salvageC) : ''}
      ${line('MechWarriors\' pay', -res.salaries, 'bad-t')}<tr><td><b>Net</b></td><td class="num"><b>${fmtC(res.total)}</b></td></tr></table>
    ${res.salvage.length ? `<p class="ok-t">Salvaged: ${res.salvage.map(esc).join(', ')} (wrecked — rebuild in the hangar).</p>` : ''}
    ${res.wrecked.length ? `<p class="bad-t">Lost: ${res.wrecked.map(esc).join(', ')} — wrecked, can be rebuilt.</p>` : ''}
    ${res.damaged.length ? `<p class="warn">Damaged: ${res.damaged.map(esc).join(', ')} — repair in the hangar.</p>` : ''}
    <p class="dim">Reputation ${res.rep >= 0 ? '+' : ''}${res.rep} · company funds ${fmtC(co.cbills)} · lance strength ${companyStrength(co)}t</p>`;
}
void statusOf;
