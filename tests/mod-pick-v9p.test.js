// v9p: Modifier code 1 / 2 cells link to MedBilling Fee Desk like Fee code(s) and Dx: ↗ opens Fee Desk (local copy = live v38)
// in pick mode (pick=hsc, pv=2, pmax=10, one-time ctx) directly on its Modifiers tab (#/modifiers); a tapped modifier (or ＋ several
// + Send) comes back into the cell the pick started from (Mod 1 → Modifier code 1, Mod 2 → Modifier code 2), appended, no
// duplicates across the two cells; blank rows; the iOS app path (mblogs://pick?pickv=2&…&mod=…); fee and Dx picks unchanged.
// Run: cd /workspace/pwtest && BASE=http://127.0.0.1:18792/ OUT=/workspace/artifacts/mbl-v9p node /workspace/medbilling-logs/tests/mod-pick-v9p.test.js
const path = require('path'), fs = require('fs');
const { chromium, webkit } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const BASE = (process.env.BASE || 'http://127.0.0.1:18792/').replace(/\/?$/, '/');
const LOGS = BASE + 'medbilling-logs/', FD = BASE + 'delara-medbilling/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9p'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const pickBtn = (r, k) => `${G} tbody tr:nth-child(${r}) .pickfd[data-kind="${k}"]:not(.fdmini)`;
function watch(p, label) { p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404|Refused to apply a stylesheet/.test(m.text())) errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message)); }
async function tapOrClick(pg, sel, touch) { const l = pg.locator(sel).first(); await l.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })); await pg.waitForTimeout(60); if (touch) await l.tap(); else await l.click(); }
const vals = (p, r) => p.evaluate(rr => Object.fromEntries(['fee', 'mod1', 'mod2', 'dx'].map(c => [c, (document.querySelector(`#todayList table.grid tbody tr:nth-child(${rr}) .gc[data-c="${c}"]`) || {}).value || ''])), r);
async function waitFor(fn, ms) { const t = Date.now(); let v; while (Date.now() - t < (ms || 8000)) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } return v; }
const msgTxt = p => p.evaluate(() => { const t = document.querySelector('#toast'), s = document.querySelector('#snack'); return (t && t.classList.contains('show') ? t.textContent : '') + (s && !s.hidden ? ' | ' + document.querySelector('#snackTxt').textContent : ''); });
async function openPick(p, r, kind, touch) {
  await tapOrClick(p, cell(r, kind === 'fee' || kind === 'dx' ? kind : kind), touch); await p.waitForTimeout(150);
  const [fd] = await Promise.all([p.context().waitForEvent('page'), p.locator(pickBtn(r, kind)).first().evaluate(b => b.click())]);
  await fd.waitForLoadState('domcontentloaded'); await fd.waitForSelector('#pickbar', { timeout: 10000 }); const url = await p.evaluate(() => window.__lastOpen || '');
  return { fd, url };
}
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); ctx.on('page', pg => watch(pg, label + ' fd'));
  const p = await ctx.newPage(); watch(p, label);
  await p.addInitScript(() => { const o = window.open; window.open = function (u, ...a) { window.__lastOpen = String(u); return o.call(this, u, ...a); }; });
  await p.goto(LOGS); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600);
  return { ctx, p };
}
async function suite(browser, o, label, touch, shots) {
  const { ctx, p } = await setup(browser, o, label);
  await tapOrClick(p, cell(1, 'name'), touch); await p.keyboard.type('Mod Pick'); await p.keyboard.press('Tab');
  await tapOrClick(p, cell(1, 'fee'), touch); await p.keyboard.type('03.03A'); await p.keyboard.press('Tab'); await p.waitForTimeout(600);
  // the ↗ shows in the active modifier cell, like fee / Dx
  await tapOrClick(p, cell(1, 'mod1'), touch); await p.waitForTimeout(200);
  const vis = await p.evaluate(s => { const b = document.querySelector(s); return !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0; }, pickBtn(1, 'mod1'));
  ok(vis, `${label}: ↗ Fee Desk button in the active Modifier code 1 cell`);
  if (shots) await p.screenshot({ path: path.join(OUT, `modpick-cell-${label}.png`) });
  // A. Mod 1: Fee Desk opens on Modifiers, a plain tap sends one modifier → Modifier code 1
  let { fd, url } = await openPick(p, 1, 'mod1', touch); const U = new URL(url || 'http://x/');
  ok(U.searchParams.get('pick') === 'hsc' && U.searchParams.get('pv') === '2' && U.searchParams.get('pmax') === '10' && /^[A-Za-z0-9_-]{16,}$/.test(U.searchParams.get('ctx') || '') && U.hash === '#/modifiers', `${label}: Fee Desk link: pick=hsc, pv=2, pmax=10, one-time ctx, #/modifiers (${U.search.replace(/ctx=[^&]+/, 'ctx=…').slice(0, 90)}${U.hash})`);
  await fd.waitForSelector('.modrow[data-mx]', { timeout: 15000 });
  ok(await fd.evaluate(() => location.hash.startsWith('#/modifiers') && !!document.querySelector('.modrow[data-mx]') && !!document.querySelector('#pickbar')), `${L(label)}Fee Desk opened straight on its Modifiers tab, in pick mode`);
  await fd.fill('#mf', 'CMGP'); await fd.waitForTimeout(400);
  if (shots) await fd.screenshot({ path: path.join(OUT, `modpick-feedesk-${label}.png`) });
  let closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '.modrow[data-mod="CMGP"]', touch); await closed;
  let v = await waitFor(async () => { const x = await vals(p, 1); return x.mod1 === 'CMGP' ? x : null; });
  ok(v && v.mod1 === 'CMGP' && v.mod2 === '' && v.fee === '03.03A', `${label}: tapped CMGP came back into Modifier code 1 (${JSON.stringify(v || await vals(p, 1))})`);
  // B. Mod 2: ＋ two modifiers + Send → both appended to Modifier code 2
  ({ fd, url } = await openPick(p, 1, 'mod2', touch)); await fd.waitForSelector('.modrow[data-mx]', { timeout: 15000 });
  for (const m of ['CMXV20', 'DIFF']) { await fd.fill('#mf', m); await fd.waitForTimeout(350); await tapOrClick(fd, `.modrow[data-mod="${m}"] .psel`, touch); }
  closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await tapOrClick(fd, '#ptSend', touch); await closed;
  v = await waitFor(async () => { const x = await vals(p, 1); return /CMXV20/.test(x.mod2) ? x : null; });
  ok(v && v.mod2 === 'CMXV20, DIFF' && v.mod1 === 'CMGP', `${label}: ＋ CMXV20 + DIFF from Mod 2 → Modifier code 2 "${v && v.mod2}", Modifier code 1 kept "${v && v.mod1}"`);
  if (shots) await p.screenshot({ path: path.join(OUT, `modpick-returned-${label}.png`) });
  // C. from Mod 2 again: CMGP (already in Mod 1) is not duplicated; TEV appended to Mod 2
  ({ fd } = await openPick(p, 1, 'mod2', touch)); await fd.waitForSelector('.modrow[data-mx]', { timeout: 15000 });
  for (const m of ['CMGP', 'TEV']) { await fd.fill('#mf', m); await fd.waitForTimeout(350); await tapOrClick(fd, `.modrow[data-mod="${m}"] .psel`, touch); }
  closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await tapOrClick(fd, '#ptSend', touch); await closed;
  v = await waitFor(async () => { const x = await vals(p, 1); return /TEV/.test(x.mod2) ? x : null; }); const m1 = await msgTxt(p);
  ok(v && v.mod2 === 'CMXV20, DIFF, TEV' && v.mod1 === 'CMGP' && /Already in this row: CMGP/.test(m1), `${label}: no duplicate across cells: "${v && v.mod1}" / "${v && v.mod2}"; message "${m1.trim()}"`);
  // D. iOS app path: mblogs://pick?pickv=2&ctx=…&mod=… into the cell the pick was opened from (Mod 1)
  await p.evaluate(() => { window.__u = ''; window.__open0 = window.open; window.open = u => { window.__u = u; return {}; }; });
  await tapOrClick(p, cell(1, 'mod1'), touch); await p.locator(pickBtn(1, 'mod1')).evaluate(b => b.click()); await p.waitForTimeout(300);
  const tok = new URL(await p.evaluate(() => window.__u)).searchParams.get('ctx');
  await p.evaluate(t => window.__mblPick(`mblogs://pick?pickv=2&ctx=${t}&mod=CMXC30,CMGP`), tok); await p.waitForTimeout(900);
  v = await vals(p, 1);
  ok(v.mod1 === 'CMGP, CMXC30' && v.mod2 === 'CMXV20, DIFF, TEV', `${label}: native return mblogs://pick?…&mod=CMXC30,CMGP from Mod 1 → "${v.mod1}" (CMGP not doubled)`);
  await p.evaluate(() => { window.open = window.__open0; });
  // E. blank row: Mod 2 ↗ on an empty row makes it an encounter and fills its Modifier code 2
  ({ fd } = await openPick(p, 2, 'mod2', touch)); await fd.waitForSelector('.modrow[data-mx]', { timeout: 15000 });
  await fd.fill('#mf', 'CMGP'); await fd.waitForTimeout(350); closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await tapOrClick(fd, '.modrow[data-mod="CMGP"]', touch); await closed;
  v = await waitFor(async () => { const x = await vals(p, 2); return x.mod2 === 'CMGP' ? x : null; });
  ok(v && v.mod2 === 'CMGP' && v.mod1 === '' && await p.evaluate(s => !!document.querySelector(s).closest('tr').dataset.id, cell(2, 'mod2')), `${label}: empty row → encounter with Modifier code 2 "CMGP"`);
  // F. fee and Dx picks still work
  ({ fd } = await openPick(p, 1, 'fee', touch));
  await fd.waitForFunction(() => document.querySelector('#q'), null, { timeout: 15000 }); await fd.fill('#q', '03.04A'); await fd.press('#q', 'Enter'); await fd.waitForSelector('#results .hit[data-code="03.04A"]', { timeout: 10000 });
  closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await tapOrClick(fd, '#results .hit[data-code="03.04A"]', touch); await closed;
  v = await waitFor(async () => { const x = await vals(p, 1); return /03\.04A/.test(x.fee) ? x : null; });
  ok(v && v.fee === '03.03A, 03.04A' && v.mod1 === 'CMGP, CMXC30', `${label}: fee pick still appends to Fee code(s) ("${v && v.fee}"), modifiers untouched`);
  ({ fd, url } = await openPick(p, 1, 'dx', touch)); ok(new URL(url).hash === '#/icd9' && new URL(url).searchParams.get('pick') === 'dx', `${label}: Dx ↗ still opens ICD-9 (pick=dx, #/icd9)`);
  await fd.waitForSelector('#iq', { timeout: 15000 }); await fd.fill('#iq', 'V22'); await fd.press('#iq', 'Enter'); await fd.waitForSelector('#icdresults .icdrow[data-icd="V22.2"]', { timeout: 8000 });
  closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await fd.waitForTimeout(300);
  // Playwright's WebKit iPhone emulation fires no click for a tap on a Fee Desk ICD-9 row (Chromium does; Fee Desk page, not Logs) → there a DOM click
  if (label.startsWith('webkit')) await fd.locator('#icdresults .icdrow[data-icd="V22.2"] .code').evaluate(el => el.click()); else await tapOrClick(fd, '#icdresults .icdrow[data-icd="V22.2"] .code', touch);
  await closed;
  v = await waitFor(async () => { const x = await vals(p, 1); return /V22\.2/.test(x.dx) ? x : null; });
  const dm = v ? '' : JSON.stringify(await vals(p, 1)) + ' ' + (await msgTxt(p)) + ' closed=' + (await closed);
  ok(v && /V22\.2/.test(v.dx), `${label}: Dx pick still fills Dx ("${v && v.dx}") ${dm}`);
  // stored and audited
  const st = await p.evaluate(async () => { const e = (await Vault.loadAll()).find(x => x.name === 'Mod Pick'); const a = await Vault.loadAudit(); return { m1: e.mod1, m2: e.mod2, aud: a.filter(r => /modifier 2 \+/.test(r.note || '')).length }; }).catch(er => ({ err: er.message }));
  ok(st.m1 === 'CMGP, CMXC30' && st.m2 === 'CMXV20, DIFF, TEV' && st.aud >= 2, `${label}: saved encrypted (${st.m1} / ${st.m2}); audit "Codes picked in Fee Desk: modifier 2 +…" ×${st.aud}${st.err ? ' ' + st.err : ''}`);
  await ctx.close();
}
const L = l => l + ': ';
(async () => {
  const cr = await chromium.launch(), wk = await webkit.launch();
  await suite(cr, { viewport: { width: 1280, height: 800 } }, '1280', false, true);
  await suite(cr, { viewport: { width: 402, height: 874 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, '402', true, true);
  await suite(wk, { viewport: { width: 402, height: 874 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, 'webkit-402', true, false);
  await cr.close(); await wk.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
