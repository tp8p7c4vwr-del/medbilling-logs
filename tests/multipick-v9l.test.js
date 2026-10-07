// v9l multi-code return from MedBilling Fee Desk (pick protocol 2, Fee Desk v36): up to 3 fee codes, 3 ICD-9 codes and 3 modifiers
// come back together into the row the pick started from. Covers: ↗ asks for pv=2; ＋ selections from search, ICD-9 and the
// modifier search → Send → Fee code(s) / Dx / Modifier code 1 filled, saved, cursor back, cells flash, confirmation with Undo;
// a favourite with linked codes (pre-selected set, Dx and modifier follow their fee code → Dx beside it, Modifier code 2 for the
// 2nd fee code); merge without duplicates (already in this row); Undo; Dx never overwritten (not added, said so); single tap still
// one code; modifier-only tap; locked vault on return (same tab) → "Unlock to add …" → applied after unlock; forged / replayed /
// malformed v2 links ignored; the old single-code link still works; persistence after lock/unlock; 1280 + 390 touch.
// v9m: pmax=10 sent; up to 10 of each per send (11 rejected); every ICD-9 kept (Dx beside fee codes, extras after them, never
// 'Not added'); I. 10 fee + 10 ICD-9 + 10 modifiers end to end through Fee Desk v37 at 1280 and 390 (screenshots → multipick10/).
// Run: cd /workspace/pwtest && BASE=http://127.0.0.1:18792/ node /workspace/medbilling-logs/tests/multipick-v9l.test.js [shots]
const path = require('path'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const BASE = (process.env.BASE || 'http://127.0.0.1:18792/').replace(/\/?$/, '/');
const LOGS = BASE + 'medbilling-logs/', FD = BASE + 'delara-medbilling/';
const OUT10 = process.env.OUT10 || '/workspace/artifacts/multipick10'; fs.mkdirSync(OUT10, { recursive: true });
const OUT = process.env.OUT || '/workspace/artifacts/multipick', SHOTS = process.argv[2] === 'shots'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const pickBtn = (r, k) => `${G} tbody tr:nth-child(${r}) .pickfd[data-kind="${k}"]:not(.fdmini)`;
function watch(p, label) {
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404/.test(m.text())) errors.push(label + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
}
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o));
  ctx.on('page', pg => watch(pg, label + ' fd'));
  const p = await ctx.newPage(); watch(p, label);
  // Fee Desk favourites: 03.04A linked to ICD-9 650 and to the modifier CMXV20 (same browser profile as Logs)
  await p.goto(FD); await p.evaluate(() => { localStorage.setItem('mb.favs', JSON.stringify(['H:03.04A', 'I:650'])); localStorage.setItem('mb.favlinks', JSON.stringify({ v: 1, pairs: [['H:03.04A', 'I:650']] })); localStorage.setItem('mb.favmodlinks', JSON.stringify({ v: 1, pairs: [['H:03.04A', 'M:CMXV20']] })); });
  await p.goto(LOGS); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600);
  return { ctx, p };
}
async function tapOrClick(pg, sel, touch) { const l = pg.locator(sel).first(); await l.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })); await pg.waitForTimeout(60); if (touch) await l.tap(); else await l.click(); }
async function openPick(p, sel, touch, cellSel) {
  await tapOrClick(p, cellSel, touch); await p.waitForTimeout(150);
  const [fd] = await Promise.all([p.context().waitForEvent('page'), p.locator(sel).first().evaluate(b => b.click())]);
  await fd.waitForLoadState('domcontentloaded'); await fd.waitForSelector('#pickbar', { timeout: 10000 });
  return fd;
}
const msgTxt = p => p.evaluate(() => { const t = document.querySelector('#toast'), s = document.querySelector('#snack'); return (t && t.classList.contains('show') ? t.textContent : '') + (s && !s.hidden ? ' | ' + document.querySelector('#snackTxt').textContent : ''); });
const focusOn = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tr'); return a && a.dataset && a.dataset.c ? `${a.dataset.c}@${[...tr.parentNode.rows].indexOf(tr) + 1}` : (a ? a.tagName : ''); });
async function waitVal(p, sel, re, ms) { const t = Date.now(); let v = ''; while (Date.now() - t < (ms || 8000)) { v = await p.inputValue(sel).catch(() => ''); if (re.test(v)) return v; await p.waitForTimeout(100); } return v; }
const fdReady = fd => fd.waitForFunction(() => document.querySelector('#results .savedh, #results .hit, #detail .codebig, .modrow, #icdresults'), null, { timeout: 20000 });
async function fdSearch(fd, q) { await fdReady(fd); await fd.fill('#q', q); await fd.press('#q', 'Enter'); await fd.waitForSelector('#results .hit[data-code]', { timeout: 10000 }); }
async function fdIcd(fd, q, code) { await fd.evaluate(() => { location.hash = '#/icd9'; }); await fd.waitForTimeout(200); await fd.fill('#iq', q); await fd.press('#iq', 'Enter'); await fd.waitForSelector(`#icdresults .icdrow[data-icd="${code}"]`, { timeout: 8000 }); }
async function fdMod(fd, code, touch) { await tapOrClick(fd, '#pickMods', touch); await fd.waitForSelector('.modrow'); await fd.fill('#mf', code); await fd.waitForTimeout(400); }
const vals = (p, r) => p.evaluate(rr => Object.fromEntries(['fee', 'mod1', 'mod2', 'dx'].map(c => [c, (document.querySelector(`#todayList table.grid tbody tr:nth-child(${rr}) .gc[data-c="${c}"]`) || {}).value || ''])), r);
async function sendTray(fd, touch) { const closed = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false); await tapOrClick(fd, '#ptSend', touch); return closed; }

async function suite(browser, o, label, touch) {
  const { ctx, p } = await setup(browser, o, label);
  await tapOrClick(p, cell(1, 'name'), touch); await p.keyboard.type('Multi Pick'); await p.keyboard.press('Tab');
  await p.waitForSelector(`${G} tbody tr:nth-child(1)[data-id]`); await p.waitForTimeout(500);

  // A. ＋ a fee code, an ICD-9 code and a modifier → one send fills Fee code(s), Dx and Modifier code 1
  let fdUrl = ''; ctx.on('request', r => { if (r.isNavigationRequest() && r.url().includes('/delara-medbilling/?')) fdUrl = r.url(); });
  let fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  ok(new URL(fdUrl || 'http://x/').searchParams.get('pv') === '2' && new URL(fdUrl || 'http://x/').searchParams.get('pmax') === '10', `${label}: ↗ asks Fee Desk for the multi-code return (pv=2, pmax=10)`);
  ok(/＋ to pick several/.test(await fd.textContent('#pickbar')), `${label}: Fee Desk shows the multi-code banner`);
  await fdSearch(fd, '03.03A'); await tapOrClick(fd, '#results .hit[data-code="03.03A"] .psel', touch);
  await fdIcd(fd, 'V22', 'V22.2'); await tapOrClick(fd, '#icdresults .icdrow[data-icd="V22.2"] .psel', touch);
  await fdMod(fd, 'CMGP', touch); await tapOrClick(fd, '.modrow[data-mod="CMGP"] .psel', touch);
  const tr = await fd.textContent('#picktray');
  ok(/03\.03A/.test(tr) && /V22\.2/.test(tr) && /CMGP/.test(tr) && /Send to MedBilling Logs \(3\)/.test(tr), `${label}: the tray lists the 3 codes`);
  if (SHOTS) await fd.screenshot({ path: path.join(OUT, `feedesk-tray-before-send-${label}.png`) });
  ok(await sendTray(fd, touch), `${label}: Send closes Fee Desk`);
  await waitVal(p, cell(1, 'mod1'), /CMGP/);
  let v = await vals(p, 1);
  ok(v.fee === '03.03A' && v.dx === 'V22.2' && v.mod1 === 'CMGP' && v.mod2 === '', `${label}: row filled ${JSON.stringify(v)}`);
  let m = await msgTxt(p);
  ok(/Added: Fee 03\.03A · Dx V22\.2 · Modifier 1 CMGP/.test(m), `${label}: confirmation "${m.trim()}"`);
  ok(await focusOn(p) === 'fee@1', `${label}: cursor back in the cell the pick started from (${await focusOn(p)})`);
  ok(await p.$$eval(`${G} tbody tr:nth-child(1) td.pickfill`, a => a.length) === 3, `${label}: the 3 filled cells flash`);

  // B. a favourite with linked codes pre-selects its set; plus a duplicate fee code → merge, no duplicates, Mod 2 for the 2nd fee code
  fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  await fdReady(fd); await fd.waitForSelector('#results .hit[data-fk="H:03.04A"]');
  await tapOrClick(fd, '#results .hit[data-fk="H:03.04A"] .cdesc', touch); await fd.waitForSelector('#picktray');
  await fdSearch(fd, '03.03A'); await tapOrClick(fd, '#results .hit[data-code="03.03A"] .hdesc', touch);   // with a selection, a tap adds
  const t2 = await fd.$$eval('#picktray .ptc', a => a.map(e => e.textContent.replace('×', '').trim()));
  ok(JSON.stringify(t2) === '["03.04A","03.03A","650for 03.04A","CMXV20for 03.04A"]', `${label}: favourite 03.04A pre-selected with 650 and CMXV20; 03.03A added (${t2.join(' | ')})`);
  await sendTray(fd, touch); await waitVal(p, cell(1, 'mod2'), /CMXV20/);
  v = await vals(p, 1);
  ok(v.fee === '03.03A, 03.04A' && v.dx === 'V22.2, 650' && v.mod1 === 'CMGP' && v.mod2 === 'CMXV20', `${label}: merged ${JSON.stringify(v)} (650 beside 03.04A, CMXV20 in Modifier code 2)`);
  m = await msgTxt(p);
  ok(/Added: Fee 03\.04A · Dx 650 · Modifier 2 CMXV20\. Already in this row: 03\.03A/.test(m) && /Undo/.test(await p.textContent('#snack')), `${label}: "${m.trim()}" with Undo`);
  if (SHOTS) { await p.locator(cell(1, 'mod2')).evaluate(e => e.scrollIntoView({ block: 'center', inline: 'center' })); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, `logs-row-after-multifill-${label}.png`) }); }
  const segs = await p.evaluate(() => null);
  // Undo puts the row back as it was before this send
  await tapOrClick(p, '#snackUndo', touch); await p.waitForTimeout(600);
  v = await vals(p, 1);
  ok(v.fee === '03.03A' && v.dx === 'V22.2' && v.mod1 === 'CMGP' && v.mod2 === '', `${label}: Undo restores the row ${JSON.stringify(v)}`);

  // C. Dx never overwritten and never refused (v9m): the only fee code already has a Dx → the new Dx is added after it
  fd = await openPick(p, pickBtn(1, 'dx'), touch, cell(1, 'dx'));
  await fdIcd(fd, '650', '650'); await tapOrClick(fd, '#icdresults .icdrow[data-icd="650"] .psel', touch);
  await fdMod(fd, 'TELES', touch); await tapOrClick(fd, '.modrow[data-mod="TELES"] .psel', touch);
  await sendTray(fd, touch); await waitVal(p, cell(1, 'mod1'), /TELES/);
  v = await vals(p, 1); m = await msgTxt(p);
  ok(v.dx === 'V22.2, 650' && v.mod1 === 'CMGP, TELES' && /Added: Dx 650 · Modifier 1 TELES/.test(m) && !/Not added/.test(m), `${label}: existing Dx kept, 650 added after it, TELES appended to Modifier code 1 (${JSON.stringify(v)}; "${m.trim()}")`);

  // D. single tap still sends one code, as before
  fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  await fdSearch(fd, '03.05JR'); const c4 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '#results .hit[data-code="03.05JR"] .hdesc', touch); await c4; await waitVal(p, cell(1, 'fee'), /03\.05JR/);
  v = await vals(p, 1); m = await msgTxt(p);
  ok(v.fee === '03.03A, 03.05JR' && /03\.05JR added/.test(m), `${label}: single tap → one code ("${v.fee}", "${m.trim()}")`);

  // E. a modifier tapped on its own (nothing selected) goes straight back; a duplicate across the two cells is not added
  fd = await openPick(p, pickBtn(1, 'dx'), touch, cell(1, 'dx'));
  await fdMod(fd, 'BMIPRO', touch); const c5 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '.modrow[data-mod="BMIPRO"] .mname', touch); await c5; await waitVal(p, cell(1, 'mod1'), /BMIPRO/);
  v = await vals(p, 1);
  ok(v.mod1 === 'CMGP, TELES, BMIPRO' && v.mod2 === '', `${label}: modifier-only tap → Modifier code 1 ("${v.mod1}")`);
  fd = await openPick(p, pickBtn(1, 'fee'), touch, cell(1, 'fee'));
  await fdMod(fd, 'CMGP', touch); const c6 = fd.waitForEvent('close', { timeout: 8000 }).then(() => true).catch(() => false);
  await tapOrClick(fd, '.modrow[data-mod="CMGP"] .mname', touch); await c6; await p.waitForTimeout(700);
  v = await vals(p, 1); m = await msgTxt(p);
  ok(v.mod1 === 'CMGP, TELES, BMIPRO' && /Nothing new added\. Already in this row: CMGP/.test(m), `${label}: a modifier already in the row is not added again ("${m.trim()}")`);

  if (label === '1280') {
    // F. locked vault on return (pop-up blocked → same tab) → waits for the unlock
    await tapOrClick(p, cell(2, 'name'), touch); await p.keyboard.type('Locked Multi'); await p.keyboard.press('Tab');
    await p.waitForSelector(`${G} tbody tr:nth-child(2)[data-id]`); await p.waitForTimeout(400);
    await p.evaluate(() => { window.open = () => null; });
    await tapOrClick(p, cell(2, 'fee'), touch); await p.waitForTimeout(150);
    await Promise.all([p.waitForURL(/delara-medbilling/), p.locator(pickBtn(2, 'fee')).evaluate(b => b.click())]);
    await p.waitForSelector('#pickbar'); await fdSearch(p, '03.03A'); await p.click('#results .hit[data-code="03.03A"] .psel');
    await fdIcd(p, '650', '650'); await p.click('#icdresults .icdrow[data-icd="650"] .psel');
    await fdMod(p, 'CMGP'); await p.click('.modrow[data-mod="CMGP"] .psel');
    await Promise.all([p.waitForURL(/medbilling-logs/), p.click('#ptSend')]);
    await p.waitForSelector('#unlockForm:not([hidden])');
    const lm = (await p.textContent('#lockMsg')).trim();
    ok(lm === 'Unlock to add 03.03A, 650, CMGP to the spreadsheet.', `locked on return: "${lm}"`);
    ok(!/pickv|fee=|ctx/.test(p.url()), `return parameters removed from the address bar (${p.url().replace(BASE, '/')})`);
    await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked'));
    await waitVal(p, cell(2, 'mod1'), /CMGP/); v = await vals(p, 2);
    ok(v.fee === '03.03A' && v.dx === '650' && v.mod1 === 'CMGP', `after unlock row 2 is filled ${JSON.stringify(v)}`);
    // G. forged / replayed / malformed v2 links do nothing; the old single-code link still works
    await p.goto(LOGS + `?pickv=2&ctx=${'b'.repeat(32)}&fee=99.99Z`); await p.waitForSelector('#unlockForm:not([hidden])');
    ok(!/99\.99Z/.test(await p.textContent('#lockMsg')) && !/pickv/.test(p.url()), 'a v2 link with an unknown token is ignored');
    await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(400);
    // a pending pick (↗ with window.open captured) to test against
    await p.evaluate(() => { window.__u = ''; window.open = u => { window.__u = u; return {}; }; });
    await tapOrClick(p, cell(2, 'fee'), false); await p.locator(pickBtn(2, 'fee')).evaluate(b => b.click()); await p.waitForTimeout(300);
    const tok = new URL(await p.evaluate(() => window.__u)).searchParams.get('ctx');
    const eleven = n => Array.from({ length: 11 }, (x, i) => n(i)).join(',');
    for (const bad of [`fee=${eleven(i => '03.0' + i + 'A')}`, `mod=CM GP`, `fee=<b>`, `dx=${eleven(i => 'V2' + Math.floor(i / 10) + '.' + (i % 10))}`, `mod=${eleven(i => 'M' + i)}`, ``]) {
      await p.goto(LOGS + `?pickv=2&ctx=${tok}&${bad}`); await p.waitForSelector('#unlockForm:not([hidden])');
      ok(!/Unlock to add/.test(await p.textContent('#lockMsg')) && await p.evaluate(() => !!localStorage.getItem('bl.pick.v1')), `malformed v2 link rejected, pick still pending (${bad || 'no codes'})`);
    }
    await p.goto(LOGS + `?picked=13.99BA&kind=hsc&ctx=${tok}`); await p.waitForSelector('#unlockForm:not([hidden])');
    ok(/Unlock to add 13\.99BA/.test(await p.textContent('#lockMsg')), 'the old single-code link still works with the same token');
    await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked'));
    v = await vals(p, 2); ok(await waitVal(p, cell(2, 'fee'), /13\.99BA/) === '03.03A, 13.99BA', `old link applied ("${(await vals(p, 2)).fee}")`);
    await p.goto(LOGS + `?pickv=2&ctx=${tok}&fee=03.04A`); await p.waitForSelector('#unlockForm:not([hidden])');
    ok(!/03\.04A/.test(await p.textContent('#lockMsg')), 'a used token cannot be replayed');
    await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500);
    // v9m: 10 ICD-9 into a row with 2 fee codes (one already has 650): one goes beside 13.99BA, the other 9 after them; none dropped
    await p.evaluate(() => { window.__u = ''; window.open = u => { window.__u = u; return {}; }; });
    await tapOrClick(p, cell(2, 'dx'), false); await p.locator(pickBtn(2, 'dx')).evaluate(b => b.click()); await p.waitForTimeout(300);
    const tok2 = new URL(await p.evaluate(() => window.__u)).searchParams.get('ctx');
    const dx10 = ['V22.0', 'V22.1', 'V22.2', 'V23.0', 'V23.1', 'V24.0', 'V24.1', 'V25.0', 'V27.0', '650'];
    await p.goto(LOGS + `?pickv=2&ctx=${tok2}&dx=${dx10.join(',')}`); await p.waitForSelector('#unlockForm:not([hidden])');
    await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked'));
    const dxAll = await waitVal(p, cell(2, 'dx'), /V27\.0/); m = await msgTxt(p);
    ok(dxAll === '650, V22.0, V22.1, V22.2, V23.0, V23.1, V24.0, V24.1, V25.0, V27.0' && /Already in this row: 650/.test(m) && !/Not added/.test(m), `10 ICD-9 on a 2-fee-code row: all kept, 650 not doubled ("${dxAll}"; "${m.trim()}")`);
    const det = await p.evaluate(async () => { const r = document.querySelector('#todayList table.grid tbody tr:nth-child(2) .gc[data-c="dx"]'); return r.scrollHeight <= r.clientHeight + 2; });
    ok(det, 'the Dx cell shows every code (wraps, row grows, nothing clipped)');
    // H. persisted (encrypted vault) after lock / unlock
    v = await vals(p, 1);
    ok(v.fee === '03.03A, 03.05JR' && v.dx === 'V22.2, 650' && v.mod1 === 'CMGP, TELES, BMIPRO', `persisted after lock/unlock ${JSON.stringify(v)}`);
  }
  // I. 10 fee codes + 10 ICD-9 + 10 modifiers through Fee Desk v37 in one send → all in the row (fee, Dx paired in order, Mod 1)
  const R10 = label === '1280' ? 3 : 2;
  await tapOrClick(p, cell(R10, 'name'), touch); await p.keyboard.type('Ten Codes'); await p.keyboard.press('Tab');
  await p.waitForSelector(`${G} tbody tr:nth-child(${R10})[data-id]`); await p.waitForTimeout(400);
  fd = await openPick(p, pickBtn(R10, 'fee'), touch, cell(R10, 'fee'));
  const add10 = async sel => { const ks = await fd.$$eval(sel, a => a.slice(0, 10).map(e => e.dataset.psel)); for (const k of ks) { const q = `[data-psel="${k}"].psel`; await fd.$eval(q, e => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); }); if (touch) await fd.tap(q); else await fd.click(q); } return ks.map(k => k.slice(2)); };
  await fdReady(fd); await fd.fill('#q', '03.0'); await fd.press('#q', 'Enter'); await fd.waitForSelector('#results .hit[data-code] .psel');
  const F10 = await add10('#results .hit[data-code] .psel');
  await fd.evaluate(() => { location.hash = '#/icd9'; }); await fd.waitForTimeout(250); await fd.fill('#iq', 'V2'); await fd.press('#iq', 'Enter'); await fd.waitForSelector('#icdresults .icdrow .psel');
  const D10 = await add10('#icdresults .icdrow .psel');
  await tapOrClick(fd, '#pickMods', touch); await fd.waitForSelector('.modrow .psel');
  const M10 = await add10('.modrow .psel');
  const tr10 = await fd.textContent('#picktray');
  ok(F10.length === 10 && D10.length === 10 && M10.length === 10 && /Send to MedBilling Logs \(30\)/.test(tr10) && (tr10.match(/10\/10/g) || []).length === 3, `${label}: Fee Desk tray holds 10 + 10 + 10 (counters 10/10)`);
  ok(await sendTray(fd, touch), `${label}: Send (30 codes) closes Fee Desk`);
  await waitVal(p, cell(R10, 'mod1'), new RegExp(M10[9])); await p.waitForTimeout(400);
  v = await vals(p, R10); m = await msgTxt(p);
  ok(v.fee === F10.join(', ') && v.dx === D10.join(', ') && v.mod1 === M10.join(', ') && v.mod2 === '', `${label}: row filled with all 30 codes ${JSON.stringify(v)}`);
  ok(/^Added: Fee /.test(m.replace(/^.*\| /, '')) && !/Not added/.test(m) && D10.every(d => m.includes(d)), `${label}: confirmation lists them ("${m.replace(/^.*\| /, '').slice(0, 90)}…")`);
  const clip = await p.evaluate(r => ['fee', 'dx', 'mod1'].map(c => { const el = document.querySelector(`#todayList table.grid tbody tr:nth-child(${r}) .gc[data-c="${c}"]`); return el.scrollHeight - el.clientHeight; }), R10);
  ok(clip.every(d => d <= 2), `${label}: Fee, Dx and Modifier 1 cells show every code (wrap, row grows; overflow ${clip.join('/')} px)`);
  if (SHOTS) {
    await p.locator(cell(R10, 'fee')).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'start' })); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT10, `logs-row-after-10-fill-${label}.png`) });
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await suite(browser, { viewport: { width: 1280, height: 860 } }, '1280', false);
  await suite(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '390', true);
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
