// v9f Today spreadsheet: dynamic column widths, wrapping cells, no automatic advance, explicit navigation (Tab / Enter /
// arrow buttons / phone return key), touch behaviour at 390px, and Nova Scotia code data withheld.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18791/ node /workspace/medbilling-logs/tests/grid-v9f.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18791/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-grid-v9f';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const LONG = { name: 'Maximiliano Fernández-Oyarzún de la Cruz', mrn: '123456789012345', fee: '03.03A, 13.99BA, 03.05JR, 03.08A', mod1: 'CMGP, BMI, TELES, SURC', mod2: 'ANE, 2ANU, LOCI, AGE', dx: '650, 644.21, V22.2, 626.2', note: 'Seen in L&D triage for reduced fetal movement; NST reactive, discharged home with kick-count instructions and follow-up in clinic.' };
async function open(browser, o) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', '48203917'); await p.fill('#sPass2', '48203917'); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(700);
  return p;
}
const where = p => p.evaluate(() => { const a = document.activeElement, tr = a.closest && a.closest('tr'); return a.dataset && a.dataset.c ? `${a.dataset.c}@${[...tr.parentNode.rows].indexOf(tr) + 1}` : a.tagName + (a.id ? '#' + a.id : ''); });
const colW = (p, k) => p.evaluate(k => { const h = document.querySelector(`#todayList thead [data-h="${k}"]`); return Math.round(h.getBoundingClientRect().width); }, k);
const aligned = p => p.evaluate(() => {
  const t = document.querySelector('#todayList table.grid'), hs = [...t.tHead.rows[0].cells], bad = [];
  for (const r of [...t.tBodies[0].rows].slice(0, 3)) [...r.cells].forEach((c, i) => { const a = hs[i].getBoundingClientRect(), b = c.getBoundingClientRect(); if (Math.abs(a.left - b.left) > 1 || Math.abs(a.width - b.width) > 1) bad.push(hs[i].dataset.h + ':' + Math.round(a.left) + '/' + Math.round(b.left)); });
  const f = t.tFoot.rows[0].cells; for (const i of [0, 1]) { const a = hs[i].getBoundingClientRect(), b = f[i].getBoundingClientRect(); if (Math.abs(a.left - b.left) > 1 || Math.abs(a.width - b.width) > 1) bad.push('foot' + i); }
  return bad;
});
const settle = p => p.waitForTimeout(1300);

(async () => {
  const browser = await chromium.launch();
  // ===================================================================== desktop 1280
  const p = await open(browser, { viewport: { width: 1280, height: 860 } });
  await p.screenshot({ path: path.join(OUT, 'narrow-content-1280.png') });
  ok((await aligned(p)).length === 0, '1280: header, body and totals columns aligned (empty grid)');
  // 1. widths grow while typing, wrap past the maximum, shrink back
  for (const k of ['name', 'mrn', 'fee', 'mod1', 'mod2', 'dx']) {   // v9k: + Modifier code 1 / 2; code columns start wider (~15 characters)
    const w0 = await colW(p, k); await p.click(cell(1, k)); await p.keyboard.type(LONG[k], { delay: 5 }); await p.waitForTimeout(120);
    const w1 = await colW(p, k); ok(w1 > w0, `1280: ${k} column grows while typing (${w0} → ${w1}px)`);
    ok(await where(p) === `${k}@1`, `1280: focus stays in ${k} while typing a long value (${await where(p)})`);
  }
  // v9i: Billing notes is a one-line preview; the long text lives in the notes editor (popover on a computer)
  await p.click(cell(1, 'note')); await p.waitForSelector('#noteEd:not([hidden])'); await p.keyboard.type(LONG.note, { delay: 2 }); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(150);
  const noteInfo = await p.evaluate(() => { const d = document.querySelector('#todayList tbody tr:nth-child(1) .gc[data-c="note"]'), cs = getComputedStyle(d); return { full: d.dataset.v, over: d.scrollWidth > d.clientWidth, wrap: cs.whiteSpace, ell: cs.textOverflow, w: Math.round(d.getBoundingClientRect().width) }; });
  ok(noteInfo.full === LONG.note && noteInfo.over && noteInfo.wrap === 'nowrap' && noteInfo.ell === 'ellipsis', `1280: long note: one-line preview with ellipsis (${noteInfo.w}px), full text kept for the editor`);
  const nameWrap = await p.evaluate(() => { const ta = document.querySelector('#todayList tbody tr:nth-child(1) .gc[data-c="name"]'); return [ta.scrollHeight <= ta.clientHeight + 1, Math.round(ta.closest('td').getBoundingClientRect().width)]; });
  ok(nameWrap[0], `1280: long name fully visible (column capped at ${nameWrap[1]}px, text wraps)`);
  await p.keyboard.press('Tab'); await settle(p);
  ok((await aligned(p)).length === 0, '1280: header, body and totals still aligned with wide content ' + JSON.stringify(await aligned(p)));
  const scrollW = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); return [w.scrollWidth, w.clientWidth]; });
  ok(scrollW[0] > scrollW[1], `1280: wide content scrolls sideways (${scrollW[0]} > ${scrollW[1]})`);
  await p.locator(`${G} tbody tr:nth-child(1) .gc[data-c="note"]`).scrollIntoViewIfNeeded();
  await p.evaluate(() => { document.querySelector('#todayList .gwrap').scrollLeft = 0; });
  await p.screenshot({ path: path.join(OUT, 'wide-content-1280.png') });
  // shrink back: clear the name
  const wBig = await colW(p, 'name'); await p.click(cell(1, 'name')); await p.keyboard.press('Control+A'); await p.keyboard.type('Ann Lee'); await p.waitForTimeout(150);
  const wSmall = await colW(p, 'name'); ok(wSmall < wBig, `1280: name column shrinks back when the text gets shorter (${wBig} → ${wSmall}px)`);
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  // 2. full values never advance on their own
  await p.click(cell(2, 'mrn')); await p.keyboard.type('123456789'); await settle(p); ok(await where(p) === 'mrn@2', 'full 9-digit PHN typed: focus stays in MRN/PHN');
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); ok(await where(p) === 'tin@2', 'Tab, Tab → In');
  await p.keyboard.type('0930'); await settle(p); ok(await where(p) === 'tin@2', 'time 0930 typed: focus stays in In');
  await p.keyboard.press('Control+A'); await p.keyboard.type('09:30'); await settle(p); ok(await where(p) === 'tin@2', 'time 09:30 (max length) typed: focus stays in In');
  await p.click(cell(2, 'fee')); await p.keyboard.type('03.03A'); await settle(p); ok(await where(p) === 'fee@2', 'fee code 03.03A typed: focus stays in Fee code(s)');
  // 3. explicit moves: exactly one cell each
  await p.click(cell(2, 'name')); await p.keyboard.type('Bea Ortiz');
  await p.keyboard.press('Tab'); ok(await where(p) === 'mrn@2', 'Tab → next cell (MRN)');
  await p.keyboard.press('Enter'); ok(await where(p) === 'hc@2', 'Enter → next cell to the right (H/C)');
  await p.click('#gNext'); ok(await where(p) === 'tin@2', 'toolbar → button → next cell (In), focus kept in the grid');
  await p.keyboard.press('Shift+Tab'); ok(await where(p) === 'hc@2', 'Shift+Tab → previous cell');
  await p.click('#gPrev'); ok(await where(p) === 'mrn@2', 'toolbar ← button → previous cell');
  await p.keyboard.press('Shift+Enter'); ok(await where(p) === 'name@2', 'Shift+Enter → previous cell');
  await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowLeft'); ok(await where(p) === 'name@2', '← → move the caret only, never the cell');
  const caret = await p.evaluate(() => [document.activeElement.selectionStart, document.activeElement.value.length]); ok(caret[0] === caret[1] - 1, `caret moved inside the text (${caret[0]}/${caret[1]})`);
  await p.click(cell(2, 'note')); await p.keyboard.type('line one'); await p.keyboard.press('Enter'); await p.keyboard.type('line two'); await p.keyboard.press('Control+Enter');
  ok(await where(p) === 'note@2' && (await p.getAttribute(cell(2, 'note'), 'data-v')).includes('\n'), 'computer: Enter makes a new line in the notes editor; Ctrl+Enter saves and keeps the cell');
  await p.keyboard.press('Enter'); ok(await where(p) === 'name@3', 'Enter in Billing notes → first cell of the next row');
  // 4. a typed In time does not move the row under the cursor while editing
  await p.click(cell(1, 'tin')); await p.keyboard.type('0700'); await p.keyboard.press('Tab'); await settle(p);
  await p.click(cell(2, 'tin')); await p.keyboard.press('Control+A'); await p.keyboard.type('0600'); await p.keyboard.press('Tab'); await settle(p);
  ok(await where(p) === 'tout@2' && (await p.inputValue(cell(2, 'name'))) === 'Bea Ortiz', 'row stays in place while you work in the grid (In 06:00 on row 2)');
  await p.click('#tabs [data-tab="today"]'); await p.focus('#dPick').catch(() => {}); await p.evaluate(() => document.activeElement.blur()); await settle(p);
  ok((await p.inputValue(cell(1, 'name'))) === 'Bea Ortiz', 're-sorted by time once focus leaves the grid');
  ok(errors.length === 0, '1280: no console errors so far');

  // ===================================================================== phone 390, touch
  const m = await open(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' });
  await m.screenshot({ path: path.join(OUT, 'narrow-content-390.png') });
  const attrs = await m.evaluate(() => [...document.querySelectorAll('#todayList tbody tr:nth-child(1) .gc')].filter(e => e.tagName !== 'BUTTON' && !e.classList.contains('fpv')).map(e => [e.dataset.c, e.getAttribute('enterkeyhint'), parseFloat(getComputedStyle(e).fontSize)]));
  ok(attrs.filter(a => a[0] !== 'note').every(a => a[1] === 'next'), 'every editor has enterkeyhint="next": ' + attrs.map(a => a[0]).join(','));
  // v9i: grid text follows Settings → Display (13 px default); iPhone focus zoom is off via the viewport instead (16 px+ in the notes editor)
  ok(attrs.every(a => a[2] >= 12.5 && a[2] <= 13), 'phone grid text follows the 13 px default: ' + attrs.map(a => a[0] + ' ' + a[2]).join(', '));
  ok(/maximum-scale=1/.test(await m.getAttribute('meta[name=viewport]', 'content')), 'iPhone: viewport stops the focus zoom (maximum-scale=1)');
  ok(await m.isHidden('#gNav'), 'floating Next bar hidden until a cell is active');
  await m.locator(cell(1, 'name')).tap(); ok(await where(m) === 'name@1', 'tap → that cell');
  ok(await m.isVisible('#gNav'), 'floating ← Next → bar shows while a cell is active');
  for (const ch of LONG.name) { await m.keyboard.type(ch); } await settle(m); ok(await where(m) === 'name@1', 'typing a long name on the phone never moves focus');
  const order = ['mrn', 'hc', 'tin', 'tout', 'fno', 'fcen', 'fee', 'mod1', 'mod2', 'dx', 'note'];   // v9k: Modifier code 1 / 2 after Fee code(s); v9o: Facility # / Functional centre before Fee code(s)
  for (const k of order) { await m.keyboard.press('Enter'); ok(await where(m) === `${k}@1`, `phone return key → ${k}`); if (k !== 'hc' && k !== 'tin' && k !== 'tout' && k !== 'note' && k !== 'fno' && k !== 'fcen') { await m.keyboard.type(LONG[k]); await m.waitForTimeout(500); ok(await where(m) === `${k}@1`, `typing in ${k} keeps focus`); } }
  await m.locator(cell(1, 'note')).tap(); await m.waitForSelector('#noteEd.sheet:not([hidden])'); await m.keyboard.type(LONG.note); await m.locator('#nedDone').tap(); await m.waitForTimeout(300);
  ok(await where(m) === 'note@1' && (await m.getAttribute(cell(1, 'note'), 'data-v')) === LONG.note, 'phone: tap Billing notes → bottom sheet; Done saves and returns to the cell');
  await m.keyboard.press('Enter'); ok(await where(m) === 'name@2', 'phone return key on Billing notes → next row');
  await settle(m);
  await m.locator(cell(2, 'dx')).tap(); await m.keyboard.type('650'); ok(await where(m) === 'dx@2' && (await m.inputValue(cell(2, 'dx'))) === '650', 'tap a cell next to a wrapped cell: typing lands in the tapped cell');
  await m.locator('#gNextF').tap(); ok(await where(m) === 'note@2', 'floating Next → moves exactly one cell and keeps the keyboard in the grid');
  await m.locator('#gPrevF').tap(); ok(await where(m) === 'dx@2', 'floating ← moves back one cell');
  // Android-style keyboards: a line break typed into a wrapping cell means "next cell"
  await m.locator(cell(2, 'dx')).tap();
  const moved = await m.evaluate(() => { const ta = document.activeElement, ev = new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }); ta.dispatchEvent(ev); return ev.defaultPrevented; });
  ok(moved && await where(m) === 'note@2', 'line-break input from the phone keyboard → next cell (Android IME path)');
  await m.locator(cell(2, 'tin')).tap(); ok(await where(m) === 'tin@2', 'tapping another cell moves there');
  await m.keyboard.type('0815'); await settle(m); ok(await where(m) === 'tin@2', 'full time typed on the phone: focus stays');
  ok((await aligned(m)).length === 0, '390: header, body and totals aligned ' + JSON.stringify(await aligned(m)));
  const ofl = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ofl <= 0, `390: page itself does not scroll sideways (${ofl})`);
  await m.locator(cell(1, 'name')).tap(); await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, 'wide-content-390.png') });
  await m.locator(cell(1, 'note')).tap(); await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, 'wide-content-notes-390.png') });
  await m.locator('#nedCancel').tap(); await m.waitForTimeout(200);

  // ===================================================================== Nova Scotia withheld
  const nErr = errors.length;
  const st = await p.evaluate(async () => [(await fetch('data/codes-NS.json')).status, JSON.stringify((await (await fetch('data/codes-index.json')).json()).list.find(x => x.id === 'NS'))]);
  ok(st[0] === 404, 'data/codes-NS.json is not served (' + st[0] + ')');
  await p.waitForTimeout(200); for (let i = errors.length - 1; i >= nErr; i--) if (/404/.test(errors[i])) errors.splice(i, 1);   // the expected 404 from that check
  ok(/"held":true/.test(st[1]), 'NS listed as held (no data): ' + st[1]);
  await p.click('#tabs [data-tab="data"]'); await p.selectOption('#defProv', 'NS'); await p.waitForTimeout(300);
  ok(/approval pending/.test(await p.textContent('#defProv option[value="NS"]')), 'Settings: "Nova Scotia (approval pending)"');
  await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(300);
  await p.click(cell(4, 'name')); await p.keyboard.type('NS patient'); await p.keyboard.press('Tab');
  await p.click(cell(4, 'fee')); await p.keyboard.type('03.03ns'); await p.keyboard.press('Tab'); await settle(p);
  ok((await p.inputValue(cell(4, 'fee'))) === '03.03NS', 'NS: a manually typed code is saved as typed');
  ok((await p.inputValue(cell(4, 'name'))) === 'NS patient' && (await p.inputValue(cell(3, 'name'))) === '', 'a row typed lower down stays on its line (no jump up past the empty row above it)');
  await p.dblclick(`${G} tbody tr:nth-child(4) .rn`); await p.waitForSelector('#editDlg[open]');
  ok((await p.inputValue('#eProv')) === 'NS', 'details editor uses NS');
  if (await p.isHidden('#eCodeQ')) await p.click('#eaEdit');
  await p.fill('#eCodeQ', '03.03'); await p.waitForTimeout(600);
  const res = await p.textContent('#eCodeRes');
  ok(/Nova Scotia \(approval pending\): code lookup unavailable, type the code manually/.test(res), 'NS search shows: ' + res.trim().slice(0, 90));
  ok(/Add as typed/.test(res), 'NS search still offers "Add as typed"');
  await p.screenshot({ path: path.join(OUT, 'ns-lookup-unavailable-1280.png') });
  await p.click('#eCodeRes [data-typed]'); await p.waitForTimeout(200);
  ok(/03\.03/.test(await p.textContent('#eCodes')), 'NS: typed code added in the details editor');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('#lockNow').catch(async () => { await p.click('#tabs [data-tab="data"]'); await p.click('#lockNow'); });
  await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', '48203917'); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600);
  for (let i = 0; i < 4 && await p.isVisible('#longDlg'); i++) { await p.click('#lgKeep'); await p.waitForTimeout(300); }   // the 06:00 / 07:00 test timers are long-running
  await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(300);
  const kept = await p.evaluate(() => [...document.querySelectorAll('#todayList tbody .gc[data-c="fee"]')].map(e => e.value).filter(Boolean));
  ok(kept.includes('03.03NS'), 'saved NS code still there after lock/unlock (user records untouched): ' + kept.join(' | '));

  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
