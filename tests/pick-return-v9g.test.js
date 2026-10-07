// v9g pick-and-return: ↗ in a Fee code(s) / Dx cell opens MedBilling Fee Desk in pick mode; tapping a code there puts it
// straight back into the same cell (append, no duplicates, one Dx per fee code), with the cursor in the cell and a toast.
// Covers: fee from a search result and from a code page, ICD-9 from a search and from the suggested list, append + no
// duplicate, Cancel, a locked vault on return (same-tab return), invalid return URLs rejected, 390 touch + 1280, NS held.
// Run: cd /workspace/pwtest && BASE=http://127.0.0.1:18792/ node /workspace/medbilling-logs/tests/pick-return-v9g.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const BASE = (process.env.BASE || 'http://127.0.0.1:18792/').replace(/\/?$/, '/');
const LOGS = BASE + 'medbilling-logs/', FD = BASE + 'delara-medbilling/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-pick-return';
const PIN = '48203917', BANNER = 'Picking a code for MedBilling Logs, tap a code to send it back';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const pickBtn = (r, k) => `${G} tbody tr:nth-child(${r}) .pickfd[data-kind="${k}"]:not(.fdmini)`;
const infoBtn = (r, k) => `${G} tbody tr:nth-child(${r}) .pickfd.fdmini[data-kind="${k}"]`;
const fdUrls = [];
function watch(p, label) {
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404/.test(m.text())) errors.push(label + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
}
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o));
  ctx.on('page', pg => watch(pg, label + ' fd'));
  ctx.on('request', r => { if (r.isNavigationRequest() && r.url().includes('/delara-medbilling/')) fdUrls.push(r.url()); });
  const p = await ctx.newPage(); watch(p, label);
  await p.goto(LOGS); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600);
  return { ctx, p };
}
async function tapOrClick(pg, sel, touch) { const l = pg.locator(sel).first(); await l.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })); await pg.waitForTimeout(60); if (touch) await l.tap(); else await l.click(); }
// select the cell, then ↗ (the button shows on the active row), and catch the Fee Desk window
async function openPick(p, sel, touch, cellSel) {
  await tapOrClick(p, cellSel, touch); await p.waitForTimeout(150);
  const [fd] = await Promise.all([p.context().waitForEvent('page'), p.locator(sel).first().evaluate(b => b.click())]);
  await fd.waitForLoadState('domcontentloaded'); await fd.waitForSelector('#pickbar', { timeout: 10000 });
  return fd;
}
const toastTxt = p => p.evaluate(() => { const t = document.querySelector('#toast'), s = document.querySelector('#snack'); return (t && t.classList.contains('show') ? t.textContent : '') + (s && !s.hidden ? ' | ' + document.querySelector('#snackTxt').textContent : ''); });
const focusOn = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tr'); return a && a.dataset && a.dataset.c ? `${a.dataset.c}@${[...tr.parentNode.rows].indexOf(tr) + 1}` : (a ? a.tagName : ''); });
async function waitVal(p, sel, re, ms) { const t = Date.now(); let v = ''; while (Date.now() - t < (ms || 8000)) { v = await p.inputValue(sel).catch(() => ''); if (re.test(v)) return v; await p.waitForTimeout(100); } return v; }
async function fdSearch(fd, q) { await fd.fill('#q', q); await fd.press('#q', 'Enter'); await fd.waitForSelector('#results .hit[data-code], #results .hit[data-icd]', { timeout: 10000 }); }

async function suite(browser, o, label, touch) {
  const { ctx, p } = await setup(browser, o, label);
  // a row with a patient (the code goes into this row)
  await tapOrClick(p, cell(1, 'name'), touch); await p.keyboard.type('Pick Test'); await p.keyboard.press('Tab');
  await p.waitForSelector(`${G} tbody tr:nth-child(1)[data-id]`); await p.waitForTimeout(500);

  // 1. fee code from a search result
  fdUrls.length = 0;
  let fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  const banner = (await fd.textContent('#pickbar')).replace(/\s+/g, ' ').trim();
  ok(banner === BANNER + ' · Cancel', `${label}: Fee Desk shows the pick banner ("${banner}")`);
  const u0 = new URL(fdUrls[0] || 'http://x/'), keys = [...u0.searchParams.keys()].sort().join(',');
  ok(keys === 'ctx,jur,pick,return' && u0.searchParams.get('pick') === 'hsc' && /^[a-f0-9]{32}$/.test(u0.searchParams.get('ctx')) && u0.searchParams.get('return') === LOGS && !/Pick|Test/i.test(u0.href.replace(/pick=|Pick/g, '')), `${label}: the link carries only pick/ctx/return/jur, no patient data (${u0.search})`);
  ok(!/[?&](pick|ctx|return)=/.test(fd.url()), `${label}: Fee Desk removes the pick parameters from its address bar (${fd.url().replace(BASE, '/')})`);
  if (label === '390') await fd.screenshot({ path: path.join(OUT, 'pick-banner-390.png') });
  await fdSearch(fd, '03.03A');
  const closed1 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '#results .hit[data-code="03.03A"]', touch);
  ok(await closed1, `${label}: Fee Desk closes itself after the tap`);
  let v = await waitVal(p, cell(1, 'fee'), /03\.03A/);
  ok(v === '03.03A', `${label}: fee code from a search result lands in the same cell ("${v}")`);
  ok(/03\.03A added/.test(await toastTxt(p)), `${label}: toast "${await toastTxt(p)}"`);
  ok(await focusOn(p) === 'fee@1', `${label}: cursor back in the Fee code(s) cell (${await focusOn(p)})`);
  const saved = await p.evaluate(() => window.Vault && window.Vault.load ? null : null);
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `logs-filled-toast-${label}.png`) });

  // 2. fee code from a code page (Details first, then "Use … in MedBilling Logs"): appended with ", "
  fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  await fdSearch(fd, '03.04A');
  await tapOrClick(fd, '#results .hit[data-code="03.04A"] .pdet', touch);
  await fd.waitForSelector('[data-pick="hsc"][data-code="03.04A"]', { timeout: 8000 });
  ok(!fd.isClosed() && await fd.isVisible('#pickbar'), `${label}: "Details" opens the code page without sending`);
  const closed2 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '[data-pick="hsc"][data-code="03.04A"]', touch); await closed2;
  v = await waitVal(p, cell(1, 'fee'), /03\.04A/);
  ok(v === '03.03A, 03.04A', `${label}: code from the code page is appended ("${v}")`);

  // 3. the same code again: not duplicated
  fd = await openPick(p, infoBtn(1, 'fee'), touch, cell(1, 'fee'));
  await fd.waitForSelector('#detail .codebig, .codebig', { timeout: 8000 });
  ok(/#\/code\/03\.04A/.test(fd.url()), `${label}: ⓘ opens Fee Desk on the last code (${fd.url().replace(BASE, '/')})`);
  const closed3 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '.codebig', touch); await closed3; await p.waitForTimeout(600);
  v = await p.inputValue(cell(1, 'fee'));
  ok(v === '03.03A, 03.04A' && /already in this row/.test(await toastTxt(p)), `${label}: picking a code already in the row adds nothing ("${v}", "${await toastTxt(p)}")`);

  // 4. ICD-9 from an ICD-9 search
  fd = await openPick(p, pickBtn(1, 'dx'), touch, cell(1, 'dx'));
  ok(/#\/icd9/.test(fd.url()), `${label}: Dx ↗ opens the ICD-9 search (${fd.url().replace(BASE, '/')})`);
  await fd.fill('#iq', 'V22'); await fd.press('#iq', 'Enter'); await fd.waitForSelector('#icdresults .icdrow[data-icd="V22.2"]', { timeout: 8000 });
  const closed4 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '#icdresults .icdrow[data-icd="V22.2"] .code', touch); await closed4;
  v = await waitVal(p, cell(1, 'dx'), /V22\.2/);
  ok(v === 'V22.2' && /V22\.2 added/.test(await toastTxt(p)), `${label}: ICD-9 from a search lands in the Dx cell ("${v}")`);
  ok(await focusOn(p) === 'dx@1', `${label}: cursor back in the Dx cell (${await focusOn(p)})`);

  // 5. ICD-9 from the suggested list on a code page (row has 2 fee codes → room for a 2nd Dx)
  fd = await openPick(p, pickBtn(1, 'dx'), touch, cell(1, 'dx'));
  await fd.evaluate(() => { location.hash = '#/code/03.03A'; });
  await fd.waitForSelector('#icdsug .icdrow[data-icd]', { timeout: 8000 });
  const sug = await fd.getAttribute('#icdsug .icdrow[data-icd]:not([data-icd="V22.2"])', 'data-icd');
  const closed5 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, `#icdsug .icdrow[data-icd="${sug}"] .code`, touch); await closed5;
  v = await waitVal(p, cell(1, 'dx'), new RegExp(sug.replace(/\./g, '\\.')));
  ok(v === 'V22.2, ' + sug, `${label}: suggested ICD-9 ${sug} is added as the 2nd Dx ("${v}")`);

  // 6. Cancel: back without changes
  fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  const closed6 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '#pickCancel', touch); ok(await closed6, `${label}: Cancel closes Fee Desk`);
  await p.waitForTimeout(500);
  ok(await p.inputValue(cell(1, 'fee')) === '03.03A, 03.04A', `${label}: Cancel changes nothing`);

  // 7. outside pick mode Fee Desk is unchanged (no banner, no "Use" buttons; a result opens the code)
  const plain = await ctx.newPage(); await plain.goto(FD + '#/code/03.03A'); await plain.waitForSelector('.codebig');
  ok(!(await plain.$('#pickbar')) && !(await plain.$('[data-pick]')), `${label}: plain Fee Desk has no pick banner or Use button`);

  // 8. invalid return URLs: no pick mode, parameters dropped
  const tok = 'a'.repeat(32);
  for (const bad of ['https://evil.example/medbilling-logs/', BASE + 'other-app/', LOGS + '?x=1', 'javascript:alert(1)', 'mblogs://evil', LOGS.replace('http://', 'http://user:pw@')]) {
    await plain.goto(FD + `?pick=hsc&ctx=${tok}&return=${encodeURIComponent(bad)}`); await plain.waitForTimeout(300);
    ok(!(await plain.$('#pickbar')) && !/return=/.test(plain.url()), `${label}: return "${bad}" rejected (no banner)`);
  }
  await plain.goto(FD + `?pick=hsc&ctx=nothex&return=${encodeURIComponent(LOGS)}`); await plain.waitForTimeout(300);
  ok(!(await plain.$('#pickbar')), `${label}: a malformed token is rejected`);
  await plain.close();

  // 9. locked vault on return (pop-up blocked → same tab → the code waits for the unlock)
  await tapOrClick(p, cell(2, 'name'), touch); await p.keyboard.type('Locked Return'); await p.keyboard.press('Tab');
  await p.waitForSelector(`${G} tbody tr:nth-child(2)[data-id]`); await p.waitForTimeout(400);
  await p.evaluate(() => { window.open = () => null; });
  await tapOrClick(p, cell(2, 'fee'), touch); await p.waitForTimeout(150);
  await Promise.all([p.waitForURL(/delara-medbilling/), p.locator(pickBtn(2, 'fee')).evaluate(b => b.click())]);
  await p.waitForSelector('#pickbar');
  await fdSearch(p, '03.05JR');
  await Promise.all([p.waitForURL(/medbilling-logs/), tapOrClick(p, '#results .hit[data-code="03.05JR"]', touch)]);
  await p.waitForSelector('#unlockForm:not([hidden])');
  const lm = await p.textContent('#lockMsg');
  ok(/Unlock to add 03\.05JR/.test(lm), `${label}: locked on return, says "${lm.trim()}"`);
  ok(!/picked|ctx/.test(p.url()), `${label}: return parameters removed from the address bar (${p.url().replace(BASE, '/')})`);
  await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked'));
  v = await waitVal(p, cell(2, 'fee'), /03\.05JR/);
  ok(v === '03.05JR', `${label}: after unlock the code is in row 2 ("${v}")`);
  ok(await focusOn(p) === 'fee@2' && /03\.05JR added/.test(await toastTxt(p)), `${label}: cursor in the cell + toast (${await focusOn(p)}, "${await toastTxt(p)}")`);
  // a forged / replayed return does nothing
  await p.goto(LOGS + `?picked=99.99Z&kind=hsc&ctx=${'b'.repeat(32)}`); await p.waitForSelector('#unlockForm:not([hidden])');
  ok(!/99\.99Z/.test(await p.textContent('#lockMsg')) && !/picked/.test(p.url()), `${label}: a return with an unknown token is ignored`);
  await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500);
  ok(!(await p.evaluate(() => document.querySelector('#todayList').textContent.includes('99.99Z'))), `${label}: the forged code is not in the grid`);
  // pending picks expire (30 min)
  const exp = await p.evaluate(() => { localStorage.setItem('bl.pick.v1', JSON.stringify({ tok: 'c'.repeat(32), id: 'x', col: 'fee', t: Date.now() - 31 * 60000 })); return 1; });
  await p.goto(LOGS + `?picked=03.03A&kind=hsc&ctx=${'c'.repeat(32)}`); await p.waitForSelector('#unlockForm:not([hidden])');
  ok(exp && !/03\.03A/.test(await p.textContent('#lockMsg')) && !(await p.evaluate(() => localStorage.getItem('bl.pick.v1'))), `${label}: a pick older than 30 minutes expires`);

  // 10. blank row: ↗ makes it an encounter and the code comes back into it
  await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500);
  const r3 = await p.evaluate(() => document.querySelectorAll('#todayList tbody tr[data-id]').length + 1);
  fd = await openPick(p, pickBtn(r3, 'dx'), touch, cell(r3, 'dx'));
  await fd.fill('#iq', '650'); await fd.press('#iq', 'Enter'); await fd.waitForSelector('#icdresults .icdrow[data-icd="650"]', { timeout: 8000 });
  const closed10 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '#icdresults .icdrow[data-icd="650"] .code', touch); await closed10;
  v = await waitVal(p, cell(r3, 'dx'), /650/);
  ok(v === '650', `${label}: ↗ on an empty row creates the encounter and fills its Dx ("${v}")`);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await suite(browser, { viewport: { width: 1280, height: 860 } }, '1280', false);
  await suite(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '390', true);
  // Nova Scotia stays held in both apps
  const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(LOGS);
  const ns = await p.evaluate(async ({ FD }) => {
    const a = (await fetch('data/codes-NS.json')).status, b = JSON.stringify(((await (await fetch('data/codes-index.json')).json()).list || []).find(x => x.id === 'NS'));
    const c = (await fetch(FD + 'data/prov/NS.json')).status, d = JSON.stringify(((await (await fetch(FD + 'data/prov/index.json')).json()).list || []).find(x => x.id === 'NS') || {});
    return { a, b, c, d };
  }, { FD });
  ok(ns.a === 404 && /"held":true/.test(ns.b), `Logs: NS code data not served (${ns.a}) and listed as held`);
  ok(ns.c === 404 && /"status":"soon"/.test(ns.d), `Fee Desk: NS data not served (${ns.c}), status "soon" (permission pending)`);
  await ctx.close();
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
