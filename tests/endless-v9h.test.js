// v9h endless rows: within 5 rows of the end (focus by Tab / Enter / ↓ / Next bar / tap, through empty rows without typing)
// or when scrolled near the bottom, 10 more empty rows are added. Focus and row order stay; empty rows are never saved and
// never counted. 1280 + 390 touch.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ node /workspace/medbilling-logs/tests/endless-v9h.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-pick-return';
const PIN = '48203917', N = 25;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(400);
  // 25 entries today → 25 + 15 empty = 40 rows (the "rows end on 40" case)
  await p.evaluate(async n => {
    const now = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0); const start = Math.max(d0.getTime() + 60000, now - 10 * 3600000), span = Math.max(60000 * n, now - start - 120000);
    for (let i = 0; i < n; i++) { const s = start + Math.floor(i * span / n); await window.Vault.save({ id: 'e-' + i, kind: 'enc', name: 'Patient ' + (i + 1), mrn: String(200000000 + i), chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], notes: [], segs: [{ s, e: Math.min(now - 60000, s + 5 * 60000) }], status: 'done', photos: [], links: [], created: s, updated: s }); }
  }, N);
  await p.click('#lockNow'); await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn');
  await p.waitForFunction(n => document.querySelectorAll('#todayList tbody tr[data-id]').length === n, N); await p.waitForTimeout(400);
  return p;
}
const rows = p => p.evaluate(() => document.querySelectorAll('#todayList tbody tr').length);
const at = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tbody tr'); return tr ? [tr.sectionRowIndex + 1, a.dataset.c] : [0, a && a.tagName]; });
const foot = p => p.evaluate(() => document.querySelector('#todayList tfoot').textContent.replace(/\s+/g, ' ').trim());
const numbersOk = p => p.evaluate(() => [...document.querySelectorAll('#todayList tbody tr .rn')].every((th, i) => th.textContent.trim().replace(/\D/g, '') === String(i + 1)));
async function walkTo(p, target, key, touch) {
  // keyboard / phone return key: moves cell by cell; ↓ moves straight down
  let guard = 0, info = await at(p);
  while (info[0] < target && guard++ < 20000) { if (key === 'mix') await p.keyboard.press(info[0] % 2 ? 'Tab' : 'Enter'); else await p.keyboard.press(key); info = await at(p); }
  return info;
}
async function run(browser, o, label, touch) {
  const p = await setup(browser, o, label);
  const r0 = await rows(p), f0 = await foot(p);
  ok(r0 === 40, `${label}: starts with ${r0} rows (25 entries + 15 empty)`);
  const name1 = `${G} tbody tr:nth-child(1) .gc[data-c="name"]`;
  if (touch) await p.locator(name1).tap(); else await p.click(name1);
  // Tab / Enter (phone return key) cell by cell through filled rows and on into empty rows, typing nothing
  // v9q: at 1280 the squeezed headers take two lines (14 px taller), so row 33 sits within the scroll-near-the-end zone; row 32
  // is still more than 5 rows from the end and outside it
  let info = await walkTo(p, 32, 'mix', touch);
  ok(await rows(p) === 40, `${label}: at row ${info[0]} (more than 5 from the end) still 40 rows`);
  info = await walkTo(p, 36, 'mix', touch);
  const r36 = await rows(p);
  ok(r36 === 50 && info[0] === 36, `${label}: Tab/Enter to row ${info[0]} → ${r36} rows; cursor stays (${info[1]}@${info[0]})`);
  // keep going: ↓ on a computer (cursor arrived with Tab/Enter, not editing); Enter on the phone
  info = await walkTo(p, 101, touch ? 'Enter' : 'ArrowDown', touch);
  const r101 = await rows(p);
  ok(info[0] === 101 && r101 >= 106 && r101 % 10 === 0, `${label}: past row 100 (at ${info[0]}) → ${r101} rows`);
  if (!touch) info = await walkTo(p, 151, 'ArrowDown', touch);
  else { // phone: tap rows near the end, then the floating Next button
    for (let i = 0; i < 20 && (await at(p))[0] < 151; i++) { const r = await rows(p), sel = `${G} tbody tr:nth-child(${r - 3}) td.c-name`; await p.locator(sel).evaluate(el => el.scrollIntoView({ block: 'center' })); await p.waitForTimeout(60); await p.locator(sel).tap(); await p.waitForTimeout(60); }
    info = await at(p);
    const rb = await rows(p); const sel = `${G} tbody tr:nth-child(${rb - 6}) td.c-note`; await p.locator(sel).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })); await p.locator(sel).tap(); await p.waitForTimeout(100);
    await p.locator('#nedDone').tap(); await p.waitForTimeout(100);   // v9i: the note opens its editor; Done returns to the cell
    await p.locator('#gNextF').tap(); await p.waitForTimeout(150);
    const an = await at(p); ok(an[0] === rb - 5 && an[1] === 'name' && await rows(p) === rb + 10, `${label}: Next bar from row ${rb - 6} to ${an[0]} adds 10 rows (${rb} → ${await rows(p)})`);
  }
  const r151 = await rows(p);
  ok(info[0] >= 151 && r151 >= info[0] + 5, `${label}: past row 150 (at ${info[0]}) → ${r151} rows`);
  ok(await numbersOk(p), `${label}: row numbers continue 1…${r151} in order`);
  ok(await foot(p) === f0, `${label}: totals unchanged by empty rows ("${f0.slice(0, 60)}…")`);
  ok(await p.evaluate(() => document.querySelectorAll('#todayList tbody tr[data-id]').length) === N, `${label}: still ${N} entries; empty rows are not entries`);
  const light = await p.evaluate(() => document.querySelectorAll('#todayList tbody tr[data-light]').length);
  ok(light > 0, `${label}: rows far below are drawn light (${light} rows without editors until reached)`);
  // screenshot near row 60
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); const r = document.querySelector('#todayList tbody tr:nth-child(60)'), w = document.querySelector('#todayList .gwrap'); w.scrollTop = r.offsetTop - w.clientHeight / 2; w.scrollLeft = 0; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, `endless-${label}.png`) });
  // typing in a far empty row creates an entry there; the rows below stay
  const rBefore = await rows(p), far = `${G} tbody tr:nth-child(60) td.c-name`;
  if (touch) await p.locator(far).tap(); else await p.click(far);
  await p.keyboard.type('Row Sixty'); await p.keyboard.press('Tab'); await p.waitForTimeout(900);
  ok(await p.evaluate(() => { const r = document.querySelector('#todayList tbody tr:nth-child(60)'); return !!r.dataset.id && r.querySelector('.gc[data-c="name"]').value === 'Row Sixty'; }) && await rows(p) >= rBefore, `${label}: typing on row 60 saves it in place; grid keeps ${await rows(p)} rows`);
  ok(/^26 encounters/.test(await p.textContent(`${G} tfoot [data-tn]`)), `${label}: totals count the new entry only (${(await p.textContent(`${G} tfoot [data-tn]`)).trim()})`);
  // a redraw (focus leaves → re-sort) keeps the grown rows
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(800);
  ok(await rows(p) >= rBefore, `${label}: after the redraw the grid still has ${await rows(p)} rows`);
  // scrolling to the bottom grows
  const sr0 = await rows(p);
  for (let i = 0; i < 3; i++) { await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); w.scrollTop = w.scrollHeight; }); await p.waitForTimeout(250); }
  const sr1 = await rows(p);
  ok(sr1 >= sr0 + 30, `${label}: scrolling to the bottom 3 times adds rows (${sr0} → ${sr1})`);
  ok(await numbersOk(p), `${label}: row numbers still continuous after scrolling`);
  // nothing empty was saved: lock + unlock shows the same 26 entries
  await p.click('#lockNow'); await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500);
  const nAll = await p.evaluate(async () => (await window.Vault.loadAll()).length).catch(() => -1);
  ok(await p.evaluate(() => document.querySelectorAll('#todayList tbody tr[data-id]').length) === N + 1, `${label}: after lock/unlock ${N + 1} entries (empty rows never saved; vault holds ${nAll} records)`);
  await p.context().close();
}
(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();
  await run(browser, { viewport: { width: 1280, height: 860 } }, '1280', false);
  await run(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '390', true);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
