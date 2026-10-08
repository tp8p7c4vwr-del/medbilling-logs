// v9o: Facility # and Functional centre columns (before Fee code(s)): order and Tab / Next flow, the Functional centre list
// (Med Access style: search, Select Favourite…, Edit/Search…, CLNC / D/N / EMRG / MED / SURG), the Facility # picker over the
// official Alberta Health facility listing (search by number / name / city, favourites first, recent, typed numbers that are
// not in the listing), Delete + Undo, carry-down to new rows, the H/C tie-in, older entries (no fields), persistence, History,
// entry details and the edit form, Settings, every encrypted export (CSV / Excel / PDF / Word) and backup export → import.
// 1280 (popover) and 390 (bottom sheet), text size slider.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9o node /workspace/medbilling-logs/tests/facility-v9o.test.js
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9o';
const DL = path.join(OUT, 'scratch', 'downloads'); fs.mkdirSync(DL, { recursive: true });
const PIN = '48203917', PIN2 = '61839402', EXP_PASS = 'Velvet!Comet-39-Prairie';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const ORDER = ['rn', 'name', 'mrn', 'hc', 'tin', 'tout', 'min', 'u', 'fno', 'fcen', 'fee', 'mod1', 'mod2', 'dx', 'note', 'act'];
const FC5 = ['Select Favourite…', 'Edit/Search…', 'CLNC - Clinic', 'D/N - Day/Night Care', 'EMRG - Emergency', 'MED - Medical', 'SURG - Surgical'];
const NAMES = ['Ana Li', 'Robert Thompson-Whitaker', 'Chen Wei', "Sarah O'Neill"];
const UAH = 'University Of Alberta Hospital';
const settle = p => p.waitForTimeout(700);
const where = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tr'); return a && a.dataset && a.dataset.c ? `${a.dataset.c}@${tr ? tr.sectionRowIndex + 1 : '?'}` : (a ? a.id || a.tagName : ''); });
const val = (p, r, c) => p.evaluate(s => { const el = document.querySelector(s); return el ? (el.dataset.v != null && el.classList.contains('fpv') ? el.dataset.v : el.value) : null; }, cell(r, c));
const txt = (p, r, c) => p.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent : null; }, cell(r, c));
const hc = (p, r) => p.evaluate(s => document.querySelector(s).textContent.trim(), cell(r, 'hc'));
async function unlock(p, pin) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', pin || PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
async function setup(browser, o, label, seed, pin) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton', acceptDownloads: true }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', pin || PIN); await p.fill('#sPass2', pin || PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  if (seed) await p.evaluate(async names => {   // v9n-format entries: no facNo / facNm / fcen fields at all
    const now = Date.now();
    for (let i = 0; i < names.length; i++) { const s = now - (names.length - i) * 30 * 60000;
      await window.Vault.save({ id: 'e-' + i, kind: 'enc', name: names[i], mrn: String(1234567890 + i), chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], mod1: i === 1 ? 'CMGP' : undefined, notes: [], segs: [{ s, e: s + 20 * 60000 }], status: 'done', photos: [], links: [], created: s, updated: s }); }
  }, NAMES);
  await p.click('#lockNow'); await unlock(p, pin);
  if (seed) await p.waitForFunction(n => document.querySelectorAll('#todayList tbody tr[data-id]').length === n, NAMES.length);
  return p;
}
const heads = p => p.evaluate(() => [...document.querySelectorAll('#todayList table.grid thead th')].map(th => [th.dataset.h, th.textContent.trim()]));
const geo = p => p.evaluate(() => { const t = document.querySelector('#todayList table.grid'), o = { w: {}, colpx: {} };
  t.querySelectorAll('thead th').forEach(th => { o.w[th.dataset.h] = Math.round(th.getBoundingClientRect().width); });
  t.querySelectorAll('colgroup col').forEach(c => { o.colpx[c.className.replace(/^c-/, '')] = c.style.width; });
  o.tw = t.style.width; o.sum = Math.round([...t.querySelectorAll('colgroup col')].reduce((a, x) => a + (parseFloat(x.style.width) || parseFloat(getComputedStyle(x).width) || 0), 0));
  o.fs = getComputedStyle(document.documentElement).getPropertyValue('--g-fs').trim(); return o; });
// is the code / number (the <b>) fully visible inside the cell?
const codeVis = (p, r, c) => p.evaluate(s => { const el = document.querySelector(s), b = el && el.querySelector('b'); if (!b) return null; const er = el.getBoundingClientRect(), br = b.getBoundingClientRect(); return { full: br.right <= er.right - 2 && br.left >= er.left, code: b.textContent, cw: Math.round(er.width), bw: Math.round(br.width) }; }, cell(r, c));
const totals = p => p.evaluate(() => [document.querySelector('#todayList tfoot [data-tn]').textContent, document.querySelector('#todayList tfoot [data-tm]').textContent, document.querySelector('#todayList tfoot [data-tu]').textContent].join(' | '));
const totDet = p => p.evaluate(() => document.querySelector('#todayList tfoot [data-td]').textContent);
async function settingsTab(p) { await p.click('#tabs [data-tab="data"]'); await p.waitForTimeout(250); }
async function today(p) { await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400); }
async function setSize(p, idx) { await settingsTab(p); await p.locator('#dispSize').fill(String(idx)); await p.waitForTimeout(250); await today(p); }
const shot = async (p, n) => { await p.evaluate(() => document.querySelectorAll('.toast, #toast, .snack').forEach(t => { t.style.visibility = 'hidden'; })); await p.screenshot({ path: path.join(OUT, n) }); await p.evaluate(() => document.querySelectorAll('.toast, #toast, .snack').forEach(t => { t.style.visibility = ''; })); };
const showCols = (p, k) => p.evaluate(k => { const w = document.querySelector('#todayList .gwrap'), th = w.querySelector(`thead th.h-${k || 'fno'}`); w.scrollLeft = Math.max(0, th.offsetLeft - (innerWidth < 500 ? 70 : 260)); }, k);
const items = p => p.evaluate(() => [...document.querySelectorAll('#fpkList .fpo .pk')].map(b => b.innerText.replace(/\s+/g, ' ').replace(/ ?✓$/, '').trim()));
const fpkOpen = p => p.waitForSelector('#fpk[open]');
const fpkShut = p => p.waitForFunction(() => !document.querySelector('#fpk').open);
const pickItem = async (p, re, tap) => { const i = await p.evaluate(src => { const re = new RegExp(src); return [...document.querySelectorAll('#fpkList .fpo .pk')].findIndex(b => re.test(b.innerText.replace(/\s+/g, ' '))); }, re.source); if (i < 0) throw new Error('no item ' + re); const l = p.locator('#fpkList .fpo .pk').nth(i); if (tap) await l.tap(); else await l.click(); };
async function exportFmt(p, fmt) {
  await p.click('#repToday'); await p.waitForSelector('#repDlg[open]');
  await p.click(`#repForm [data-fmt="${fmt}"]`); await p.click('#pMake'); await p.waitForSelector('#xpDlg[open]');
  if (!(await p.isChecked('#xpAck'))) await p.check('#xpAck');
  if (await p.isVisible('#xp1')) { await p.fill('#xp1', EXP_PASS); await p.fill('#xp2', EXP_PASS); await p.check('#xpKeep'); }
  await p.click('#xpOk'); await p.waitForSelector('#pReady:not([hidden])', { timeout: 30000 });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pDown')]);
  const dest = path.join(DL, `${fmt}-${dl.suggestedFilename()}`); await dl.saveAs(dest); await p.click('#pClose'); return dest;
}
const inner = (zip, ext) => { const d = fs.mkdtempSync('/tmp/mbl9o-'); execFileSync('7z', ['x', '-y', '-p' + EXP_PASS, '-o' + d, zip]); const f = fs.readdirSync(d).find(x => x.endsWith('.' + ext)); return path.join(d, f); };

async function desktop(browser) {
  const L = '1280';
  const p = await setup(browser, { viewport: { width: 1280, height: 860 } }, L, true);
  const h = await heads(p);
  ok(JSON.stringify(h.map(x => x[0])) === JSON.stringify(ORDER), `${L}: column order ${h.map(x => x[1] || x[0]).join(' · ')}`);
  ok(h.find(x => x[0] === 'fno')[1] === 'Facility #' && h.find(x => x[0] === 'fcen')[1] === 'Functional centre', `${L}: headers "Facility #" / "Functional centre"`);
  ok(await p.evaluate(() => document.querySelectorAll('#todayList table.grid tfoot td.tdet[colspan="7"]').length === 1 && [...document.querySelector('#todayList table.grid tfoot tr').cells].reduce((a, c) => a + (+c.colSpan || 1), 0) === document.querySelectorAll('#todayList table.grid colgroup col').length), `${L}: totals row still spans every column`);
  const old = await p.evaluate(() => [...document.querySelectorAll('#todayList tbody tr[data-id]')].map(tr => [tr.querySelector('.gc[data-c="fno"]').dataset.v, tr.querySelector('.gc[data-c="fcen"]').dataset.v, tr.querySelector('.gc[data-c="fee"]').value, tr.querySelector('.gc[data-c="mod1"]').value]));
  ok(old.length === 4 && old.every(r => r[0] === '' && r[1] === '' && r[2] === '03.03A') && old[1][3] === 'CMGP', `${L}: 4 older entries (no new fields) load with blank Facility # / Functional centre, codes intact`);
  const t0 = await totals(p), d0 = await totDet(p);
  // ---- Tab / Shift+Tab: Out → Facility # → Functional centre → Fee code(s)
  await p.click(cell(1, 'tout')); await p.keyboard.press('Tab'); const a1 = await where(p); await p.keyboard.press('Tab'); const a2 = await where(p); await p.keyboard.press('Tab'); const a3 = await where(p);
  ok(a1 === 'fno@1' && a2 === 'fcen@1' && a3 === 'fee@1', `${L}: Tab from Out → ${a1} → ${a2} → ${a3}`);
  await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift'); ok(await where(p) === 'fcen@1', `${L}: Shift+Tab from Fee code(s) → Functional centre`);
  ok(!(await p.evaluate(() => document.querySelector('#fpk').open)), `${L}: arriving with Tab does not open the list`);
  // ---- Functional centre: Med Access style list
  await p.keyboard.press(' '); await fpkOpen(p);
  ok(await p.evaluate(() => document.querySelector('#fpk').classList.contains('pop')), `${L}: Space opens the list as a popover beside the cell`);
  ok(await p.getAttribute('#fpkQ', 'placeholder') === 'Type something to search...', `${L}: search box "Type something to search..."`);
  const fl = await items(p); ok(JSON.stringify(fl.map(s => s.replace(/\s*-\s*/, ' - '))) === JSON.stringify(FC5), `${L}: Functional centre options exactly: ${fl.join(' | ')}`);
  ok(await p.evaluate(() => document.activeElement.id === 'fpkQ'), `${L}: on a computer the search box has the cursor`);
  await p.keyboard.press('Escape'); await fpkShut(p); ok(await val(p, 1, 'fcen') === '' && await where(p) === 'fcen@1', `${L}: Esc closes without a change, cursor back on the cell`);
  await p.keyboard.type('em'); await fpkOpen(p); ok(await p.inputValue('#fpkQ') === 'em', `${L}: typing on the cell opens the list and searches ("em")`);
  await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  ok(await val(p, 1, 'fcen') === 'EMRG' && (await txt(p, 1, 'fcen')).includes('Emergency') && await where(p) === 'fcen@1', `${L}: Enter picks EMRG, cell shows "${await txt(p, 1, 'fcen')}", cursor stays`);
  await p.keyboard.press('Tab'); ok(await where(p) === 'fee@1', `${L}: Tab moves on to Fee code(s)`);
  await p.click(cell(2, 'fcen')); await fpkOpen(p); await p.keyboard.type('dn'); await p.keyboard.press('Tab'); await fpkShut(p); await settle(p);
  ok(await val(p, 2, 'fcen') === 'D/N' && await where(p) === 'fee@2', `${L}: "dn" + Tab picks D/N and moves to Fee code(s) (${await val(p, 2, 'fcen')}, ${await where(p)})`);
  await p.click(cell(3, 'fcen')); await fpkOpen(p); await pickItem(p, /^Edit\/Search/); await p.waitForTimeout(150);
  const all = await items(p); ok(all.length >= 26 && all.some(s => /^PEMG/.test(s)) && all.some(s => /^UCC/.test(s)) && all.some(s => /^ICU1/.test(s)), `${L}: Edit/Search… lists every functional centre code in the listing (${all.length - 2})`);
  await p.keyboard.type('pediatric'); await p.waitForTimeout(100); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  ok(await val(p, 3, 'fcen') === 'PEMG', `${L}: search "pediatric" → PEMG (${await val(p, 3, 'fcen')})`);
  // favourites
  await p.click(cell(4, 'fcen')); await fpkOpen(p); await p.click('#fpkList .fpo:has-text("MED") .star'); await p.waitForTimeout(150);
  await pickItem(p, /^Select Favourite/); await p.waitForTimeout(150); const fav = await items(p);
  ok(fav.filter(s => !/…$/.test(s)).length === 1 && /^MED/.test(fav.filter(s => !/…$/.test(s))[0]), `${L}: ☆ MED, then Select Favourite… shows only favourites (${fav.join(' | ')})`);
  await pickItem(p, /^MED/); await fpkShut(p); await settle(p); ok(await val(p, 4, 'fcen') === 'MED', `${L}: favourite picked (MED)`);
  // ---- Facility #: official listing, search by number / name / city
  await p.click(cell(1, 'fno')); await fpkOpen(p); await p.waitForFunction(() => document.querySelectorAll('#fpkList .fpo').length > 5);
  const src = await p.textContent('#fpkSrc');
  ok(/Alberta Health/.test(src) && /July 2026/.test(src) && /effective 2026-07-01/.test(src) && /411 facilities/.test(src), `${L}: source footnote in the picker ("${src}")`);
  await p.keyboard.type('44'); await p.waitForTimeout(150); const r44 = await items(p);
  ok(r44[0].startsWith('44 ' + UAH), `${L}: number search: "44" → ${r44[0]}`);
  await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  ok(await val(p, 1, 'fno') === '44' && (await txt(p, 1, 'fno')) === '44 · ' + UAH, `${L}: Facility # saved: "${await txt(p, 1, 'fno')}"`);
  await p.click(cell(2, 'fno')); await fpkOpen(p); await p.keyboard.type('misericordia'); await p.waitForTimeout(150); const rm = await items(p);
  ok(rm.some(s => /Misericordia Community Hosp/.test(s) && /Edmonton/.test(s)), `${L}: name search finds Misericordia (${rm[0]})`);
  await p.fill('#fpkQ', 'lethbridge'); await p.waitForTimeout(150); const rl = await items(p);
  ok(rl.filter(s => /Lethbridge/.test(s)).length >= 5, `${L}: city search "lethbridge" → ${rl.filter(s => /Lethbridge/.test(s)).length} facilities`);
  await p.fill('#fpkQ', 'chinook'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  const chin = await val(p, 2, 'fno'); ok(/^\d+$/.test(chin) && (await txt(p, 2, 'fno')).includes('Chinook Regional Hospital'), `${L}: picked Chinook Regional Hospital (${await txt(p, 2, 'fno')})`);
  // favourites first, recent next
  await p.click(cell(3, 'fno')); await fpkOpen(p); await p.waitForFunction(() => document.querySelectorAll('#fpkList .fpo').length > 5);
  let secs = await p.evaluate(() => [...document.querySelectorAll('#fpkList .fpsec')].map(x => x.textContent));
  ok(secs[0] === 'Recent', `${L}: no favourites yet: Recent first (${secs.slice(0, 2).join(' | ')})`);
  await p.click('#fpkList .fpo:has-text("University Of Alberta") .star'); await p.waitForTimeout(150);
  secs = await p.evaluate(() => [...document.querySelectorAll('#fpkList .fpsec')].map(x => x.textContent)); const first = await items(p);
  ok(secs[0] === 'Favourites' && first[0].startsWith('44 ' + UAH) && secs[1] === 'Recent', `${L}: ☆ 44 → Favourites first (${first[0]}), then Recent`);
  // a number that is not in the listing
  await p.keyboard.type('99999'); await p.waitForTimeout(150); const man = await items(p);
  ok(/^Use 99999 \(not in the Alberta Health listing\)/.test(man[0]), `${L}: an unlisted number offers "${man[0]}"`);
  await p.keyboard.press('Enter'); await p.waitForSelector('#fpkMan:not([hidden])'); await p.fill('#fpkManNm', 'Test Clinic'); await p.click('#fpkManUse'); await fpkShut(p); await settle(p);
  ok(await val(p, 3, 'fno') === '99999' && (await txt(p, 3, 'fno')) === '99999 · Test Clinic', `${L}: typed number saved with its name (${await txt(p, 3, 'fno')})`);
  await p.click(cell(4, 'fno')); await fpkOpen(p); await pickItem(p, /^Enter a number not in the list/); await p.fill('#fpkManNo', '12a'); await p.click('#fpkManUse');
  ok(await p.evaluate(() => document.querySelector('#fpk').open), `${L}: a non-numeric facility number is refused`);
  await p.fill('#fpkManNo', '44'); await p.click('#fpkManUse'); await fpkShut(p); await settle(p);
  ok((await txt(p, 4, 'fno')) === '44 · ' + UAH, `${L}: typing a listed number uses the official name (${await txt(p, 4, 'fno')})`);
  ok(await totals(p) === t0 && await totDet(p) === d0, `${L}: totals unchanged by Facility # / Functional centre (${t0}; ${d0})`);
  // ---- Delete clears, Undo brings it back
  await p.focus(cell(4, 'fno')); await p.keyboard.press('Delete'); await settle(p);
  ok(await val(p, 4, 'fno') === '', `${L}: Delete clears Facility #`);
  await p.click('#snackUndo'); await settle(p); ok(await val(p, 4, 'fno') === '44', `${L}: Undo restores it (${await val(p, 4, 'fno')})`);
  // ---- carry-down to a new row (same day) and the H/C tie-in
  await p.click(cell(4, 'fcen')); await fpkOpen(p); await pickItem(p, /^SURG/); await fpkShut(p); await settle(p);
  await p.click(cell(5, 'name')); await p.keyboard.type('Dana Park'); await p.keyboard.press('Tab'); await settle(p); await p.waitForTimeout(500);
  ok(await val(p, 5, 'fno') === '44' && await val(p, 5, 'fcen') === 'SURG', `${L}: a new row starts with the last Facility # / Functional centre picked today (${await val(p, 5, 'fno')} / ${await val(p, 5, 'fcen')})`);
  await p.click(cell(6, 'fno')); await fpkOpen(p); await p.keyboard.type('394'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p); await p.waitForTimeout(400);
  ok(await val(p, 6, 'fno') === '394' && await hc(p, 6) === 'C', `${L}: picking a community ambulatory centre (394 Sheldon M Chumir) on a new row sets its untouched H/C to C (${await hc(p, 6)})`);
  await p.click(cell(1, 'fno')); await fpkOpen(p); await p.keyboard.type('394'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await p.waitForTimeout(400);
  const off = await p.evaluate(() => !document.querySelector('#snack').hidden && document.querySelector('#snackTxt').textContent + ' [' + document.querySelector('#snackUndo').textContent + ']');
  ok(off && /community clinic/.test(off) && /\[Set C\]/.test(off) && await hc(p, 1) === 'H', `${L}: an existing H row is only offered H/C = C ("${off}"), not changed`);
  await p.click('#snackUndo'); await settle(p); ok(await hc(p, 1) === 'C', `${L}: one tap on "Set C" changes the row to C`);
  await p.click(cell(1, 'hc')); await settle(p);
  await p.click(cell(1, 'fno')); await fpkOpen(p); await p.keyboard.type('44'); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  ok(await hc(p, 1) === 'H' && await val(p, 1, 'fno') === '44', `${L}: row 1 back to 44 / H`);
  await settingsTab(p); await p.locator('#fpCard').scrollIntoViewIfNeeded(); await p.uncheck('#fcCarry'); await p.waitForTimeout(200); await today(p);
  await p.click(cell(7, 'name')); await p.keyboard.type('No Carry'); await p.keyboard.press('Tab'); await settle(p); await p.waitForTimeout(400);
  ok(await val(p, 7, 'fno') === '' && await val(p, 7, 'fcen') === '', `${L}: with carry-down off in Settings, a new row starts blank`);
  await settingsTab(p); await p.check('#fcCarry'); await today(p);
  // ---- persists after lock / unlock
  await p.click('#lockNow'); await unlock(p);
  ok(await val(p, 1, 'fno') === '44' && await val(p, 1, 'fcen') === 'EMRG' && await val(p, 3, 'fno') === '99999' && (await txt(p, 3, 'fno')).includes('Test Clinic') && await val(p, 3, 'fcen') === 'PEMG', `${L}: values still there after lock / unlock (encrypted entries)`);
  const g = await geo(p);
  ok(/px$/.test(g.colpx.fno) && /px$/.test(g.colpx.fcen) && Math.abs(parseFloat(g.tw) - g.sum) <= 2, `${L}: explicit px widths (Facility # ${g.colpx.fno}, Functional centre ${g.colpx.fcen}; table ${g.tw} = Σ ${g.sum})`);
  const v1 = await codeVis(p, 1, 'fno'), v2 = await codeVis(p, 1, 'fcen');
  ok(v1 && v1.full && v2 && v2.full, `${L}: number and code fully readable (Facility # ${v1 && v1.cw}px, Functional centre ${v2 && v2.cw}px)`);
  await showCols(p); await p.waitForTimeout(150); await shot(p, 'facility-grid-1280.png');
  // ---- larger text: the columns grow
  await setSize(p, 6); const gL = await geo(p);
  // v9q: on a computer the columns share the window (all on screen from 1280 px), so at a bigger text size a column may get a
  // little less of the spare width; what matters is that the number / code stays fully readable at the bigger size
  const wv1 = await codeVis(p, 1, 'fno'), wv2 = await codeVis(p, 1, 'fcen');
  ok(wv1 && wv1.full && wv2 && wv2.full && gL.w.fno >= g.w.fno * 0.9 && gL.w.fcen > g.w.fcen, `${L}: bigger text keeps the number / code readable (${g.fs} → ${gL.fs}: Facility # ${g.w.fno} → ${gL.w.fno}px, Functional centre ${g.w.fcen} → ${gL.w.fcen}px)`);
  await p.click(cell(2, 'fno')); await fpkOpen(p); const pf = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#fpkList .pk')).fontSize)); await p.keyboard.press('Escape'); await fpkShut(p);
  ok(pf >= 21, `${L}: the list text follows the text size (${pf}px at ${gL.fs})`);
  await setSize(p, 2);
  // ---- History
  await p.click('#tabs [data-tab="history"]'); await p.waitForTimeout(800);
  const hist = await p.evaluate(() => { const tr = document.querySelector('#histList tr[data-id="e-0"]'); const t = tr && tr.closest('table'); return tr ? [tr.querySelector('.gc[data-c="fno"]').textContent, tr.querySelector('.gc[data-c="fcen"]').dataset.v, [...t.querySelectorAll('thead th')].map(x => x.dataset.h).join(',')] : null; });
  ok(hist && hist[0] === '44 · ' + UAH && hist[1] === 'EMRG' && hist[2] === ORDER.join(','), `${L}: History day grid has both columns with the values`);
  await today(p);
  // ---- entry details and the edit form (the picker opens on top of the form)
  await p.dblclick(`${G} tbody tr:nth-child(1) .rn`); await p.waitForSelector('#editDlg[open]');
  const sum = await p.textContent('#eSummary');
  ok(/Facility # · Functional centre/.test(sum) && sum.includes('44') && sum.includes(UAH) && sum.includes('EMRG') && sum.includes('Emergency'), `${L}: entry details show Facility # and Functional centre`);
  await p.click('#eaEdit'); ok(/44 · University Of Alberta Hospital/.test(await p.textContent('#eFno')) && /EMRG - Emergency/.test(await p.textContent('#eFcen')), `${L}: edit form shows both fields`);
  await p.click('#eFcen'); await fpkOpen(p); await p.keyboard.type('clin'); await p.keyboard.press('Enter'); await fpkShut(p);
  ok(await p.evaluate(() => document.querySelector('#editDlg').open) && /CLNC - Clinic/.test(await p.textContent('#eFcen')), `${L}: picker over the edit form; form shows CLNC`);
  await p.click('#eSave'); await p.waitForFunction(() => !document.querySelector('#editDlg').open); await settle(p);
  ok(await val(p, 1, 'fcen') === 'CLNC', `${L}: edit form saves Functional centre (${await val(p, 1, 'fcen')})`);
  await p.click(cell(1, 'fcen')); await fpkOpen(p); await p.keyboard.type('emrg'); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
  // ---- audit + report helpers
  const hp = await p.evaluate(() => { const B = window.BLR; return [B.diff({ facNo: '44', facNm: 'A' }, { facNo: '43', facNm: 'B', fcen: 'EMRG' }).join('|'), B.summ({ kind: 'enc', facNo: '44', fcen: 'MED', segs: [] }), B.table([], '2000-01-01', '2100-01-01', Date.now()).head.join(','), B.table([{ id: 'x', kind: 'enc', name: 'Old', codes: [], segs: [{ s: Date.now() - 3600000, e: Date.now() - 1800000 }], status: 'done' }], '2000-01-01', '2100-01-01', Date.now()).rows[0].length]; });
  ok(/facility #: 44 A -> 43 B/.test(hp[0]) && /functional centre:  -> EMRG/.test(hp[0]), `audit diff records both fields ("${hp[0]}")`);
  ok(/Fac# 44/.test(hp[1]) && /FC MED/.test(hp[1]), `audit summary lists them ("${hp[1]}")`);
  ok(/called,facility_number,facility_name,functional_centre,codes,modifier_1/.test(hp[2]) && hp[3] === hp[2].split(',').length, `CSV/Excel columns …facility_number, facility_name, functional_centre, codes… (old entry row has ${hp[3]} cells)`);
  const aud = await p.evaluate(async () => (await window.Vault.loadAudit()).map(r => r.note || '').filter(n => /Facility #|Functional centre/.test(n)).slice(-3).join(' | '));
  ok(/Facility # \d+/.test(aud) && /Functional centre [A-Z/]+ set/.test(aud), `audit log has the spreadsheet edits ("${aud.slice(0, 160)}")`);
  // ---- Settings: favourites, recent, functional centre favourites
  await settingsTab(p); await p.locator('#fpCard').scrollIntoViewIfNeeded();
  const st = await p.evaluate(() => [document.querySelector('#fnoFavList').textContent, document.querySelector('#fnoRecList').textContent, [...document.querySelectorAll('#fcenFavList .chipbtn.on')].map(b => b.textContent).join(','), document.querySelector('#fpSrc').textContent]);
  ok(/44/.test(st[0]) && /University Of Alberta Hospital/.test(st[0]) && /394|99999|Chinook/.test(st[1]) && /MED/.test(st[2]) && /411 facilities/.test(st[3]), `Settings: favourite facilities (${st[0].slice(0, 50)}…), recent, ★ MED, source`);
  await p.click('#fnoFavAdd'); await fpkOpen(p); await p.keyboard.type('royal alex'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await p.waitForTimeout(300);
  ok(/Royal Alexandra Hospital/.test(await p.textContent('#fnoFavList')), 'Settings: Add… puts a facility in the favourites');
  await p.click('#fnoFavList [data-unfav="43"]'); await p.waitForTimeout(200); ok(!/Royal Alexandra/.test(await p.textContent('#fnoFavList')), 'Settings: Remove takes it out again');
  await today(p);
  // ---- every encrypted export carries both columns
  for (const fmt of ['csv', 'xlsx', 'pdf', 'docx']) {
    const nd = fmt === 'pdf' ? ['Fac #', 'EMRG', 'PEMG', '99999', NAMES[0]] : fmt === 'docx' ? ['Facility #', 'Functional centre', UAH, 'Test Clinic', 'PEMG'] : ['facility_number', 'functional_centre', UAH, '99999', 'PEMG'];
    const z = await exportFmt(p, fmt), j = JSON.parse(execFileSync('python3', [path.join(__dirname, 'inspect_zip.py'), z, EXP_PASS, nd.join('|')]).toString());
    ok(/AES-256/.test(j.methods.join()) && j.right_pw_ok && j.no_pw_fails && j['valid_' + fmt] && Object.values(j.needles_found).every(Boolean), `${fmt}: AES-256 zip opens, Facility # / Functional centre included ${JSON.stringify(j.needles_found)}`);
    if (fmt === 'csv') {
      const t = fs.readFileSync(inner(z, 'csv'), 'utf8').replace(/^\ufeff/, ''), lines = t.trim().split(/\r?\n/), head = lines[0].split(','), ic = head.indexOf('codes');
      ok(head.indexOf('facility_number') === ic - 3 && head.indexOf('facility_name') === ic - 2 && head.indexOf('functional_centre') === ic - 1, `csv: facility_number, facility_name, functional_centre right before codes`);
      const r = lines.find(l => l.includes(NAMES[0])).split(','); ok(r[head.indexOf('facility_number')] === '44' && r[head.indexOf('facility_name')] === UAH && r[head.indexOf('functional_centre')] === 'EMRG', `csv: row values 44 / ${UAH} / EMRG`);
    }
  }
  // ---- encrypted backup export → import into a fresh vault
  await p.click('#tabs [data-tab="data"]'); await p.click('#expAll'); await p.waitForSelector('#askDlg[open]'); await p.fill('#ask_p', PIN); await p.click('#askOk');
  await p.waitForFunction(() => /Backup ready/.test(document.querySelector('#askTitle').textContent));
  const [bdl] = await Promise.all([p.waitForEvent('download'), p.click('#askOk')]); const bk = path.join(DL, bdl.suggestedFilename()); await bdl.saveAs(bk);
  const raw = fs.readFileSync(bk, 'utf8');
  ok(/"encrypted-backup"/.test(raw) && !raw.includes(UAH) && !raw.includes('Test Clinic'), `backup file is encrypted (no facility text in ${path.basename(bk)})`);
  const q = await setup(browser, { viewport: { width: 1280, height: 860 } }, L + '-import', false, PIN2);
  await q.click('#tabs [data-tab="data"]'); await q.setInputFiles('#impFile', bk); await q.waitForSelector('#askDlg[open]'); await q.fill('#ask_p', PIN); await q.click('#askOk');
  await q.waitForFunction(() => /Imported/.test(document.querySelector('#toast') ? document.querySelector('#toast').textContent : document.body.textContent), null, { timeout: 30000 }).catch(() => {});
  await today(q); await q.waitForFunction(() => document.querySelectorAll('#todayList tbody tr[data-id]').length >= 7, null, { timeout: 15000 }).catch(() => {});
  const imp = await q.evaluate(() => Object.fromEntries([...document.querySelectorAll('#todayList tbody tr[data-id]')].map(tr => [tr.dataset.id, [tr.querySelector('.gc[data-c="fno"]').textContent, tr.querySelector('.gc[data-c="fcen"]').dataset.v]])));
  ok(imp['e-0'] && imp['e-0'][0] === '44 · ' + UAH && imp['e-0'][1] === 'EMRG' && imp['e-2'][0] === '99999 · Test Clinic' && imp['e-2'][1] === 'PEMG', `backup import: Facility # / Functional centre restored (${JSON.stringify(imp['e-0'])}, ${JSON.stringify(imp['e-2'])})`);
  await q.click('#lockNow'); await unlock(q, PIN2);
  ok(await val(q, 1, 'fno') === '44', 'imported values re-encrypted with the new passcode (still there after lock / unlock)');
  await q.context().close(); await p.context().close();
}

async function phone(browser) {
  const L = '390';
  const p = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, L, true);
  const h = await heads(p); ok(JSON.stringify(h.map(x => x[0])) === JSON.stringify(ORDER), `${L}: same column order on the phone`);
  // two favourites already starred (as in Settings)
  await p.evaluate(() => 0);
  await showCols(p); await p.waitForTimeout(150);
  // ---- Functional centre: a roomy bottom sheet
  await p.locator(cell(1, 'fcen')).tap(); await fpkOpen(p); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => { const d = document.querySelector('#fpk'), r = d.getBoundingClientRect(), b = [...document.querySelectorAll('#fpkList .pk')].map(x => x.getBoundingClientRect().height); return { sheet: d.classList.contains('sheet'), w: Math.round(r.width), bottom: Math.round(r.bottom), vh: innerHeight, minH: Math.round(Math.min(...b)), focus: document.activeElement.id, fs: parseFloat(getComputedStyle(document.querySelector('#fpkList .pk')).fontSize) }; });
  ok(sh.sheet && sh.w >= 388 && Math.abs(sh.bottom - sh.vh) <= 2, `${L}: Functional centre opens as a bottom sheet (${sh.w}px wide, bottom ${sh.bottom}/${sh.vh})`);
  ok(sh.minH >= 44 && sh.fs >= 15, `${L}: options are roomy (≥44px tall: ${sh.minH}px, text ${sh.fs}px)`);
  ok(sh.focus !== 'fpkQ', `${L}: the search box does not grab focus on a phone (no keyboard over the list)`);
  const fl = await items(p); ok(JSON.stringify(fl.map(s => s.replace(/\s*-\s*/, ' - '))) === JSON.stringify(FC5), `${L}: same five options + Select Favourite… / Edit/Search…`);
  await shot(p, 'functional-centre-picker-390.png');
  await pickItem(p, /^EMRG/, true); await fpkShut(p); await settle(p);
  ok(await val(p, 1, 'fcen') === 'EMRG' && await where(p) === 'fcen@1', `${L}: tap EMRG → saved, the cell keeps the cursor`);
  // floating Next: Facility # → Functional centre → Fee code(s)
  await p.locator(cell(2, 'tout')).tap(); await p.waitForTimeout(250); await p.locator('#gNextF').tap(); await p.waitForTimeout(250); const n1 = await where(p);
  await p.locator('#gNextF').tap(); await p.waitForTimeout(250); const n2 = await where(p); await p.locator('#gNextF').tap(); await p.waitForTimeout(250); const n3 = await where(p);
  ok(n1 === 'fno@2' && n2 === 'fcen@2' && n3 === 'fee@2', `${L}: Next from Out → ${n1} → ${n2} → ${n3}`);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(300);
  // ---- Facility #: favourites first, search
  await showCols(p); await p.locator(cell(1, 'fno')).tap(); await fpkOpen(p); await p.waitForFunction(() => document.querySelectorAll('#fpkList .fpo').length > 5);
  for (const nm of ['Royal Alexandra Hospital', 'University Of Alberta Hospital']) { await p.locator('#fpkQ').fill(nm); await p.waitForTimeout(150); await p.locator(`#fpkList .fpo:has-text("${nm}") .star`).first().tap(); await p.waitForTimeout(150); }
  await p.locator('#fpkQ').fill(''); await p.waitForTimeout(150); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(250);
  const fv = await p.evaluate(() => [[...document.querySelectorAll('#fpkList .fpsec')].map(x => x.textContent)[0], [...document.querySelectorAll('#fpkList .fpo .pk')].slice(0, 2).map(x => x.innerText.replace(/\s+/g, ' ').trim())]);
  ok(fv[0] === 'Favourites' && /^43 Royal Alexandra/.test(fv[1][0]) && /^44 University Of Alberta/.test(fv[1][1]), `${L}: favourites listed first (${fv[1].join(' | ')})`);
  await shot(p, 'facility-picker-favourites-390.png');
  await pickItem(p, /^44 University/, true); await fpkShut(p); await settle(p);
  ok(await val(p, 1, 'fno') === '44', `${L}: one tap on a favourite → Facility # 44`);
  await p.locator(cell(2, 'fno')).tap(); await fpkOpen(p); await p.locator('#fpkQ').tap(); await p.keyboard.type('medicine hat'); await p.waitForTimeout(200);
  const mh = await items(p); ok(mh.some(s => /Medicine Hat Regional Hospital/.test(s)), `${L}: typing a city in the sheet searches (${mh.filter(s => /Medicine Hat/.test(s)).length} in Medicine Hat)`);
  const kb = await p.evaluate(() => { const d = document.querySelector('#fpk').getBoundingClientRect(); return d.top >= 0; }); ok(kb, `${L}: the sheet stays on screen while searching`);
  await pickItem(p, /Medicine Hat Regional Hospital/, true); await fpkShut(p); await settle(p);
  ok((await txt(p, 2, 'fno')).includes('Medicine Hat Regional Hospital'), `${L}: picked from the search (${await txt(p, 2, 'fno')})`);
  await p.locator(cell(2, 'fcen')).tap(); await fpkOpen(p); await pickItem(p, /^MED/, true); await fpkShut(p); await settle(p);
  // ---- widths: the code / number always readable
  const g = await geo(p), v1 = await codeVis(p, 1, 'fno'), v2 = await codeVis(p, 1, 'fcen');
  ok(v1 && v1.full && v2 && v2.full, `${L}: number and code fully readable (Facility # ${g.w.fno}px, Functional centre ${g.w.fcen}px)`);
  ok(g.w.fno <= 390 * 0.42 + 1 && g.w.fcen <= Math.max(390 * 0.36 + 1, 140), `${L}: neither column takes over the phone screen (Facility # ${g.w.fno}px, Functional centre ${g.w.fcen}px)`);
  ok(Math.abs(parseFloat(g.tw) - g.sum) <= 2, `${L}: explicit px widths (table ${g.tw} = Σ ${g.sum})`);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(300);
  await showCols(p); await p.waitForTimeout(200); await shot(p, 'facility-grid-390.png');
  // ---- text size
  await setSize(p, 6); const gL = await geo(p), v3 = await codeVis(p, 2, 'fcen');
  ok(gL.w.fno >= g.w.fno && gL.w.fcen >= g.w.fcen && (gL.w.fno > g.w.fno || gL.w.fno >= 390 * 0.4) && v3 && v3.full, `${L}: at ${gL.fs} the columns grow (or stay at the phone cap) (Facility # ${g.w.fno} → ${gL.w.fno}px) and the code still shows (${v3 && v3.code})`);
  await showCols(p); await p.locator(cell(3, 'fcen')).tap(); await fpkOpen(p); const fs2 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#fpkList .pk')).fontSize));
  ok(fs2 >= 21, `${L}: sheet text follows the text size (${fs2}px)`);
  await p.locator('#fpkCancel').tap(); await fpkShut(p); await setSize(p, 2);
  await p.context().close();
}

(async () => {
  const browser = await chromium.launch();
  try { await desktop(browser); await phone(browser); }
  catch (e) { ok(false, 'exception: ' + (e && e.stack || e)); }
  console.log('console errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  if (errors.length) fails++;
  await browser.close();
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
