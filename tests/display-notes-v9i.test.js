// v9i: nothing pinned sideways (Patient name scrolls with the other columns; narrow one-line name on phones with the full
// name in a bubble on focus), readable phone grid (minimum widths in characters that follow the text size, 40 px+ rows,
// zebra rows, clear active cell / row), Settings → Display (text size slider 11–20 px in 7 steps, font style picker,
// both saved on the device), and the Billing notes editor (bottom sheet on the phone, popover on a computer; Done / Cancel,
// multi-line, autosize, 16 px+, saved encrypted like any cell, kept as an encrypted draft if the app locks). 390 touch + 1280.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ node /workspace/medbilling-logs/tests/display-notes-v9i.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9i';
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const NAMES = ['Maximiliano Fernández-Oyarzún de la Cruz', 'Ana Li', 'Robert Thompson-Whitaker', 'Chen Wei', "Sarah O'Neill", 'Priya Raman'];
const SECRET = 'Zebra-quartz note 7741';
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async names => {
    const now = Date.now();
    for (let i = 0; i < names.length; i++) { const s = now - (names.length - i) * 30 * 60000; await window.Vault.save({ id: 'e-' + i, kind: 'enc', name: names[i], mrn: String(1234567890 + i), chart: '', label: '', initials: '', billingNote: i === 2 ? 'Consult' : '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], notes: [], segs: [{ s, e: s + 20 * 60000 }], status: 'done', photos: [], links: [], created: s, updated: s }); }
  }, NAMES);
  await p.click('#lockNow'); await unlock(p);
  await p.waitForFunction(n => document.querySelectorAll('#todayList tbody tr[data-id]').length === n, NAMES.length);
  return p;
}
const geo = p => p.evaluate(() => {
  const t = document.querySelector('#todayList table.grid'), w = {}, cs = getComputedStyle(document.documentElement);
  t.querySelectorAll('thead th').forEach(th => { w[th.dataset.h] = th.getBoundingClientRect().width; });
  const c = document.createElement('canvas').getContext('2d'), f = el => { const s = getComputedStyle(el); return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; };
  const mono = t.querySelector('tbody .gc.mono'), sans = t.querySelector('tbody .gc[data-c="name"]');
  c.font = f(mono); const chM = c.measureText('0').width; c.font = f(sans); const chS = c.measureText('0').width;
  const r1 = t.tBodies[0].rows[0], r2 = t.tBodies[0].rows[1];
  return { w, chM, chS, fs: cs.getPropertyValue('--g-fs').trim(), rowH: Math.min(...[...t.tBodies[0].rows].slice(1, 6).map(r => r.offsetHeight)), vw: innerWidth,
    pos: [getComputedStyle(t.querySelector('tbody td.c-name')).position, getComputedStyle(t.querySelector('tbody .rn')).position, getComputedStyle(t.querySelector('thead th.h-name')).left],
    zebra: [getComputedStyle(r1.cells[2]).backgroundColor, getComputedStyle(r2.cells[2]).backgroundColor], nameFs: parseFloat(getComputedStyle(sans).fontSize), font: getComputedStyle(sans).fontFamily };
});
async function settings(p) { await p.click('#tabs [data-tab="data"]'); await p.waitForTimeout(200); await p.locator('#dispCard').scrollIntoViewIfNeeded(); }
async function today(p) { await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400); }
async function setSize(p, idx) { await p.locator('#dispSize').fill(String(idx)); await p.waitForTimeout(250); }
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n) });

async function phone(browser) {
  const L = '390';
  const p = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, L);
  let g = await geo(p);
  // ---- 1. nothing pinned, narrow name, readable widths and rows
  ok(g.fs === '13px' && Math.abs(g.nameFs - 13) < 0.6, `${L}: default grid text is 13 px on the phone (${g.fs}, name ${g.nameFs}px)`);
  ok(g.pos[0] === 'static' && g.pos[1] === 'static' && g.pos[2] === 'auto', `${L}: Patient name and # are not pinned (td ${g.pos[0]}, # ${g.pos[1]}, header left ${g.pos[2]})`);
  ok(await p.locator('#dispCard').count() === 1 && await p.locator('text=Pin patient column').count() === 0, `${L}: no "Pin patient column" setting`);
  ok(g.w.name <= g.vw * 0.32 + 1 && g.w.name >= 13 * g.chS - 1, `${L}: Patient name column ~30 % of the screen (${Math.round(g.w.name)}px of ${g.vw})`);
  ok(g.rowH >= 40, `${L}: rows are at least 40 px tall to tap (${g.rowH}px)`);
  const mins = { mrn: 10 * g.chM, fee: 6 * g.chM + 20, dx: 5 * g.chM + 20, tin: 5 * g.chM, tout: 5 * g.chM, min: 4 * g.chM, u: 4 * g.chM };
  const short = Object.keys(mins).filter(k => g.w[k] < mins[k]);
  ok(!short.length, `${L}: minimum widths fit typical content (MRN 10 digits ${Math.round(g.w.mrn)}, fee 6+↗ ${Math.round(g.w.fee)}, dx 5+↗ ${Math.round(g.w.dx)}, In/Out ${Math.round(g.w.tin)}, Min ${Math.round(g.w.min)}, Units ${Math.round(g.w.u)})${short.length ? ' short: ' + short : ''}`);
  ok(g.zebra[0] !== g.zebra[1], `${L}: zebra rows (${g.zebra.join(' / ')})`);
  const nm = await p.evaluate(() => { const el = document.querySelector('#todayList tbody tr:nth-child(1) .gc[data-c="name"]'), s = getComputedStyle(el); return [el.tagName, s.textOverflow, s.whiteSpace, el.scrollWidth > el.clientWidth]; });
  ok(nm[0] === 'INPUT' && nm[1] === 'ellipsis' && nm[3], `${L}: long name is one line with an ellipsis (${nm.join(', ')})`);
  await p.locator(cell(1, 'name')).tap(); await p.waitForTimeout(250);
  const tip = await p.evaluate(() => { const t = document.querySelector('#nTip'), c = document.querySelector('#todayList tbody tr:nth-child(1) td.c-name').getBoundingClientRect(), r = t.getBoundingClientRect(); return [t.hidden, t.textContent, r.bottom <= c.top + 1 || r.top >= c.bottom - 1]; });
  ok(!tip[0] && tip[1] === NAMES[0] && tip[2], `${L}: tap the name → the full name shows in a bubble next to the cell ("${tip[1]}")`);
  const act = await p.evaluate(() => { const td = document.querySelector('#todayList tbody tr:nth-child(1) td.c-name'), tr = td.parentNode; return [getComputedStyle(td).boxShadow, getComputedStyle(tr.cells[3]).backgroundColor, getComputedStyle(document.querySelector('#todayList tbody tr:nth-child(3)').cells[3]).backgroundColor]; });
  ok(/rgb\(26, 115, 232\)/.test(act[0]) && act[1] !== act[2], `${L}: active cell outlined in blue and its row tinted (${act[1]} vs ${act[2]})`);
  await shot(p, 'name-bubble-390.png');
  await p.locator(cell(2, 'name')).tap(); await p.waitForTimeout(200);
  ok(await p.isHidden('#nTip'), `${L}: a short name shows no bubble; the bubble goes away when you leave the long one`);
  await p.evaluate(() => document.activeElement.blur());
  // horizontal scroll: the name scrolls away with the other columns
  const sc = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); w.scrollLeft = 260; const wl = w.getBoundingClientRect().left, nr = document.querySelector('#todayList tbody tr:nth-child(1) td.c-name').getBoundingClientRect(); return [w.scrollLeft, Math.round(nr.right - wl)]; });
  ok(sc[0] > 0 && sc[1] < 0, `${L}: scrolled sideways ${sc[0]}px → the Patient name column scrolled out of view (right edge ${sc[1]}px from the frame)`);
  await p.waitForTimeout(150); await shot(p, 'unpinned-hscroll-390.png');
  await p.evaluate(() => { document.querySelector('#todayList .gwrap').scrollLeft = 0; });

  // ---- 2. Settings → Display: slider + font, saved on the device
  await settings(p);
  ok(await p.inputValue('#dispSize') === '2' && /13 px/.test(await p.textContent('#tsVal')), `${L}: slider starts at 13 px (step 3 of 7)`);
  ok(await p.getAttribute('#dispSize', 'min') === '0' && await p.getAttribute('#dispSize', 'max') === '6' && await p.isVisible('.tsA.sm') && await p.isVisible('.tsA.lg'), `${L}: slider has 7 steps with a small A and a large A`);
  await setSize(p, 0);
  const pv0 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#tsPrev')).fontSize));
  ok(pv0 === 11 && /11 px/.test(await p.textContent('#tsVal')), `${L}: slider to the small A → preview 11 px (live)`);
  await shot(p, 'textsize-small-settings-390.png');
  await today(p); const gS = await geo(p); await shot(p, 'textsize-small-390.png');
  await settings(p); await setSize(p, 6);
  const pv6 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#tsPrev')).fontSize));
  ok(pv6 === 20 && await p.getAttribute('#dispSize', 'aria-valuetext') === '20 px', `${L}: slider to the large A → preview 20 px, aria-valuetext "20 px"`);
  await shot(p, 'textsize-large-settings-390.png');
  await today(p); const gL = await geo(p); await shot(p, 'textsize-large-390.png');
  ok(gL.fs === '20px' && gL.rowH > gS.rowH && gL.w.fee > gS.w.fee && gL.w.mrn > gS.w.mrn && gL.w.tin > gS.w.tin, `${L}: rows and columns scale with the text (row ${gS.rowH} → ${gL.rowH}px, fee ${Math.round(gS.w.fee)} → ${Math.round(gL.w.fee)}px, MRN ${Math.round(gS.w.mrn)} → ${Math.round(gL.w.mrn)}px)`);
  const appK = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  ok(appK > 16, `${L}: the rest of the app scales too (root ${appK}px)`);
  await settings(p); await p.selectOption('#dispFont', 'serif'); await p.waitForTimeout(250);
  ok(/Georgia|serif/.test(await p.evaluate(() => getComputedStyle(document.querySelector('#tsPrev')).fontFamily)), `${L}: font picker → Serif applies to the preview`);
  await shot(p, 'font-picker-serif-390.png');
  await today(p); g = await geo(p);
  ok(/Georgia|ui-serif/.test(g.font), `${L}: Serif applies to the grid (${g.font.slice(0, 40)}…)`);
  // persisted locally, survives a reload (lock screen uses it too), no patient data in it
  const ls = await p.evaluate(() => localStorage.getItem('bl.display.v1'));
  ok(ls === '{"fs":20,"font":"serif"}', `${L}: saved on the device only: ${ls}`);
  await p.reload(); await p.waitForSelector('#unlockForm:not([hidden])');
  const lockFs = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g-fs').trim());
  ok(lockFs === '20px', `${L}: after reload the setting is applied before unlock (${lockFs})`);
  await unlock(p); await settings(p);
  ok(await p.inputValue('#dispSize') === '6' && await p.inputValue('#dispFont') === 'serif', `${L}: slider and font picker remember the choice after reload`);
  await p.click('#dispReset'); await p.waitForTimeout(200);
  ok(await p.inputValue('#dispSize') === '2' && await p.inputValue('#dispFont') === 'system' && await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g-fs').trim()) === '13px', `${L}: Reset to default → 13 px, System default`);
  await today(p);

  // ---- 3. notes editor (bottom sheet)
  await p.locator(cell(1, 'note')).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await p.locator(cell(1, 'note')).tap(); await p.waitForSelector('#noteEd:not([hidden])');
  const sh = await p.evaluate(() => { const b = document.querySelector('#nedBox').getBoundingClientRect(), ta = document.querySelector('#nedTa'); return { sheet: document.querySelector('#noteEd').classList.contains('sheet'), bottom: Math.round(innerHeight - b.bottom), w: Math.round(b.width), fs: parseFloat(getComputedStyle(ta).fontSize), focus: document.activeElement === ta, modal: document.querySelector('#nedBox').getAttribute('aria-modal'), h: ta.offsetHeight }; });
  ok(sh.sheet && sh.bottom <= 1 && sh.w >= 388 && sh.focus && sh.modal === 'true', `${L}: tap Billing notes → bottom sheet across the screen with the cursor in it`);
  ok(sh.fs >= 16, `${L}: notes editor text is ${sh.fs}px (≥ 16, no iPhone zoom)`);
  await p.keyboard.type('Should be cancelled'); await p.locator('#nedCancel').tap(); await p.waitForTimeout(200);
  ok(await p.getAttribute(cell(1, 'note'), 'data-v') === '' && await p.isHidden('#noteEd'), `${L}: Cancel closes and leaves the note unchanged`);
  await p.locator(cell(1, 'note')).tap(); await p.waitForSelector('#noteEd:not([hidden])');
  const h0 = await p.evaluate(() => document.querySelector('#nedTa').offsetHeight);
  await p.keyboard.type(SECRET); for (let i = 2; i <= 7; i++) { await p.keyboard.press('Enter'); await p.keyboard.type('Line ' + i + ' of the billing note'); }
  const h1 = await p.evaluate(() => document.querySelector('#nedTa').offsetHeight);
  ok(h1 > h0 && (await p.inputValue('#nedTa')).split('\n').length === 7, `${L}: multi-line (return = new line) and the editor grows with the text (${h0} → ${h1}px)`);
  await shot(p, 'notes-editor-390.png');
  await p.locator('#nedDone').tap(); await p.waitForTimeout(600);
  const pv = await p.evaluate(() => { const d = document.querySelector('#todayList tbody tr:nth-child(1) .gc[data-c="note"]'); return [d.dataset.v, d.textContent, d.scrollWidth > d.clientWidth, document.activeElement === d]; });
  ok(pv[0].split('\n').length === 7 && pv[1].startsWith(SECRET + ' ↵ Line 2') && pv[2] && pv[3], `${L}: Done saves; the cell shows a one-line preview with an ellipsis ("${pv[1].slice(0, 36)}…") and keeps the cursor`);
  // stored encrypted (no plaintext in IndexedDB), and still there after lock / unlock
  const raw = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('bl-vault'); r.onsuccess = () => { const tx = r.result.transaction('enc'), q = tx.objectStore('enc').getAll(); q.onsuccess = () => res(JSON.stringify(q.result.map(x => [x.iv, x.ct].map(v => v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder().decode(v) : v)))); }; }));
  ok(raw.length > 100 && !raw.includes('Zebra-quartz') && !raw.includes('billing note'), `${L}: the note is not readable in IndexedDB (encrypted vault)`);
  await p.click('#lockNow'); await unlock(p);
  ok((await p.getAttribute(cell(1, 'note'), 'data-v')).startsWith(SECRET + '\nLine 2'), `${L}: note still there after lock / unlock, line breaks kept`);
  // a blank row: the editor creates the encounter
  const n0 = await p.locator(`${G} tbody tr[data-id]`).count(), br = n0 + 1;
  await p.locator(cell(br, 'note')).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await p.locator(cell(br, 'note')).tap(); await p.waitForSelector('#noteEd:not([hidden])'); await p.keyboard.type('Note on a new row'); await p.locator('#nedDone').tap(); await p.waitForTimeout(700);
  ok(await p.locator(`${G} tbody tr[data-id]`).count() === n0 + 1, `${L}: a note typed on an empty row creates the encounter (${n0} → ${n0 + 1})`);
  // the app locks with the sheet open → encrypted draft → offered again after unlock
  await p.locator(cell(2, 'note')).tap(); await p.waitForSelector('#noteEd:not([hidden])'); await p.keyboard.type('Unsaved when it locked');
  await p.evaluate(() => document.querySelector('#lockNow').click()); await unlock(p); await p.waitForTimeout(300);
  ok(await p.isVisible('#noteEd') && await p.inputValue('#nedTa') === 'Unsaved when it locked' && /Restored your unsaved billing note/.test(await p.textContent('#toast')), `${L}: locked with the editor open → the note comes back after unlock`);
  await p.locator('#nedDone').tap(); await p.waitForTimeout(500);
  ok(await p.getAttribute(cell(2, 'note'), 'data-v') === 'Unsaved when it locked', `${L}: restored note saved with Done`);
  await p.context().close();
}

async function desktop(browser) {
  const L = '1280';
  const p = await setup(browser, { viewport: { width: 1280, height: 800 } }, L);
  const g = await geo(p);
  ok(g.fs === '13px' && g.pos[0] === 'static' && g.pos[1] === 'static', `${L}: 13 px default, nothing pinned (${g.pos.join(', ')})`);
  ok(g.rowH >= 28 && g.rowH <= 32, `${L}: rows stay compact on a computer (${g.rowH}px)`);
  ok(g.w.note >= 22 * g.chS, `${L}: Billing notes is wider by default (${Math.round(g.w.note)}px)`);
  ok(await p.evaluate(() => document.querySelector('#todayList tbody tr:nth-child(1) .gc[data-c="name"]').tagName) === 'TEXTAREA', `${L}: names still wrap on a wide screen`);
  // popover beside the cell; typing on a selected note replaces (like any cell); Esc cancels; Tab saves and moves on
  await p.click(cell(3, 'dx')); await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.dataset.c) === 'note', `${L}: Tab arrives on Billing notes without opening the editor`);
  await p.keyboard.type('Replaced');
  const pop = await p.evaluate(() => { const b = document.querySelector('#nedBox').getBoundingClientRect(), c = document.querySelector('#todayList tbody tr:nth-child(3) td.c-note').getBoundingClientRect(); return { pop: document.querySelector('#noteEd').classList.contains('pop'), near: b.top >= c.bottom - 1 || b.bottom <= c.top + 1, dx: Math.round(Math.abs(b.left - c.left)), w: Math.round(b.width), val: document.querySelector('#nedTa').value }; });
  ok(pop.pop && pop.near && pop.w <= 460 && pop.val === 'Replaced', `${L}: typing on the note opens a popover next to the cell (${pop.w}px wide) with the typed text ("${pop.val}")`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await p.isHidden('#noteEd') && await p.getAttribute(cell(3, 'note'), 'data-v') === 'Consult', `${L}: Esc cancels (note still "Consult")`);
  await p.click(cell(3, 'note')); await p.waitForSelector('#noteEd:not([hidden])');
  ok(await p.inputValue('#nedTa') === 'Consult', `${L}: click → editor with the full note`);
  await p.keyboard.press('End'); await p.keyboard.press('Enter'); await p.keyboard.type('Follow-up in 2 weeks');
  await shot(p, 'notes-editor-1280.png');
  await p.keyboard.press('Tab'); await p.waitForTimeout(500);
  ok(await p.getAttribute(cell(3, 'note'), 'data-v') === 'Consult\nFollow-up in 2 weeks' && await p.evaluate(() => { const a = document.activeElement, tr = a.closest('tr'); return a.dataset.c + '@' + (tr.sectionRowIndex + 1); }) === 'name@4', `${L}: Tab in the editor saves and moves to the next cell (name@4)`);
  await p.click(cell(1, 'note')); await p.keyboard.type('Saved by clicking outside'); await p.mouse.click(640, 120); await p.waitForTimeout(400);
  ok(await p.getAttribute(cell(1, 'note'), 'data-v') === 'Saved by clicking outside', `${L}: clicking outside the popover keeps what was typed (counts as Done)`);
  // horizontal scroll on a computer with a narrow window is not needed at 1280; screenshot the grid + settings
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
  await shot(p, 'grid-1280.png');
  await settings(p); await setSize(p, 0); await today(p); await shot(p, 'textsize-small-1280.png'); const gS = await geo(p);
  await settings(p); await setSize(p, 6); await shot(p, 'textsize-large-settings-1280.png'); await today(p); await shot(p, 'textsize-large-1280.png'); const gL = await geo(p);
  // at the largest text the grid is wider than 1280 → it scrolls sideways as a whole, nothing pinned
  const sc2 = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); const over = w.scrollWidth - w.clientWidth; w.scrollLeft = over; const wl = w.getBoundingClientRect().left, nr = document.querySelector('#todayList tbody tr:nth-child(1) td.c-name').getBoundingClientRect(); return [over, w.scrollLeft, Math.round(nr.right - wl)]; });
  ok(sc2[0] > 0 && sc2[1] > 0 && sc2[2] < 0, `${L}: at 20 px the grid scrolls sideways (${sc2[0]}px wider than the window); the Patient name scrolls away too (right edge ${sc2[2]}px)`);
  await p.waitForTimeout(150); await shot(p, 'unpinned-hscroll-1280.png');
  await p.evaluate(() => { document.querySelector('#todayList .gwrap').scrollLeft = 0; });
  ok(gS.fs === '11px' && gL.fs === '20px' && gL.rowH > gS.rowH && gL.w.mrn > gS.w.mrn, `${L}: slider 11 → 20 px: rows ${gS.rowH} → ${gL.rowH}px, MRN ${Math.round(gS.w.mrn)} → ${Math.round(gL.w.mrn)}px`);
  await settings(p); await setSize(p, 2); await p.selectOption('#dispFont', 'rounded'); await p.waitForTimeout(200); await shot(p, 'font-picker-rounded-1280.png');
  await p.selectOption('#dispFont', 'mono'); await p.waitForTimeout(200);
  ok(/monospace/.test(await p.evaluate(() => getComputedStyle(document.querySelector('#tsPrev')).fontFamily)), `${L}: Monospace applies`);
  await p.selectOption('#dispFont', 'system'); await today(p);
  // History grids use the same editor
  await p.click('#tabs [data-tab="history"]'); await p.waitForSelector('#histList table.grid');
  await p.click('#histList table.grid tbody tr:nth-child(2) .gc[data-c="note"]'); await p.waitForSelector('#noteEd:not([hidden])'); await p.keyboard.type('From History'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(500);
  ok(await p.getAttribute('#histList table.grid tbody tr:nth-child(2) .gc[data-c="note"]', 'data-v') === 'From History', `${L}: History rows use the same notes editor (Ctrl+Enter = Done)`);
  await p.context().close();
}

(async () => {
  const browser = await chromium.launch();
  await phone(browser);
  await desktop(browser);
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
