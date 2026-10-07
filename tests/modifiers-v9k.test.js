// v9k: Modifier code 1 / Modifier code 2 columns (after Fee code(s), before Dx), wider and taller code cells (Fee code(s),
// Modifiers, Dx fit ~15 code characters before wrapping; the cell being edited opens to 2+ lines; long lists wrap and the
// row grows, never clipped), old entries without modifier fields, persistence (lock / unlock), History, entry details and
// the edit form, every encrypted export (CSV / Excel / PDF / Word), and the encrypted backup export → import round trip.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ node /workspace/medbilling-logs/tests/modifiers-v9k.test.js
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9k';
const DL = path.join(OUT, 'scratch', 'downloads'); fs.mkdirSync(DL, { recursive: true });
const PIN = '48203917', PIN2 = '61839402', EXP_PASS = 'Velvet!Comet-39-Prairie';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const ORDER = ['rn', 'name', 'mrn', 'hc', 'tin', 'tout', 'min', 'u', 'fee', 'mod1', 'mod2', 'dx', 'note', 'act'];
const FEE = '03.03A, 13.99BA, 03.05JR, 03.08A, 03.04A, 03.07B';
const M1 = 'CMGP, BMI, TELES, SURC, LOCI, AGE, 2ANU', M2 = 'ANE, 2ANU, TEV';
const DX = '650, 644.21, V22.2, 626.2, 789.0, V27.0';
const NAMES = ['Ana Li', 'Robert Thompson-Whitaker', 'Chen Wei', "Sarah O'Neill"];
const settle = p => p.waitForTimeout(700);
const where = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tr'); return a && a.dataset && a.dataset.c ? `${a.dataset.c}@${tr ? tr.sectionRowIndex + 1 : '?'}` : (a ? a.id || a.tagName : ''); });
async function unlock(p, pin) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', pin || PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
// old-format entries (v9j and earlier: no mod1 / mod2 fields at all); row 4 (index 3) also carries modifiers when `withMods`
async function setup(browser, o, label, withMods, pin) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton', acceptDownloads: true }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', pin || PIN); await p.fill('#sPass2', pin || PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  if (withMods !== null) await p.evaluate(async ([names, withMods]) => {
    const now = Date.now();
    for (let i = 0; i < names.length; i++) { const s = now - (names.length - i) * 30 * 60000;
      const e = { id: 'e-' + i, kind: 'enc', name: names[i], mrn: String(1234567890 + i), chart: '', label: '', initials: '', billingNote: i === 2 ? 'Consult' : '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], notes: [], segs: [{ s, e: s + 20 * 60000 }], status: 'done', photos: [], links: [], created: s, updated: s };
      if (withMods && i === 3) { e.mod1 = 'CMGP, BMI'; e.mod2 = 'TELES'; }
      await window.Vault.save(e); }
  }, [NAMES, !!withMods]);
  await p.click('#lockNow'); await unlock(p, pin);
  if (withMods !== null) await p.waitForFunction(n => document.querySelectorAll('#todayList tbody tr[data-id]').length === n, NAMES.length);
  return p;
}
const heads = p => p.evaluate(() => [...document.querySelectorAll('#todayList table.grid thead th')].map(th => [th.dataset.h, th.textContent.trim()]));
// column widths, the text room inside each code editor (in '0' widths of the cell font) and heights
const geo = (p, r) => p.evaluate(r => {
  const t = document.querySelector('#todayList table.grid'), out = { w: {}, room: {}, colpx: {} }, tr = t.tBodies[0].rows[r - 1];
  t.querySelectorAll('thead th').forEach(th => { out.w[th.dataset.h] = Math.round(th.getBoundingClientRect().width); });
  t.querySelectorAll('colgroup col').forEach(c => { out.colpx[c.className.replace(/^c-/, '')] = c.style.width; });
  const cv = document.createElement('canvas').getContext('2d');
  for (const k of ['fee', 'mod1', 'mod2', 'dx']) { const el = tr.querySelector(`.gc[data-c="${k}"]`); if (!el) continue; const s = getComputedStyle(el); cv.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    out.room[k] = +((el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)) / cv.measureText('0').width).toFixed(1); }
  out.tw = t.style.width; out.sum = Math.round([...t.querySelectorAll('colgroup col')].reduce((a, x) => a + (parseFloat(x.style.width) || parseFloat(getComputedStyle(x).width) || 0), 0));
  out.fs = getComputedStyle(document.documentElement).getPropertyValue('--g-fs').trim();
  return out; }, r);
const cellBox = (p, r, k) => p.evaluate(([r, k]) => { const el = document.querySelector(`#todayList table.grid tbody tr:nth-child(${r}) .gc[data-c="${k}"]`), cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight);
  return { tag: el.tagName, v: el.value, h: el.clientHeight, sh: el.scrollHeight, lh, rowH: el.closest('tr').offsetHeight, lines: Math.round((el.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh), gh: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--g-h')) }; }, [r, k]);
const totals = p => p.evaluate(() => [document.querySelector('#todayList tfoot [data-tn]').textContent, document.querySelector('#todayList tfoot [data-tm]').textContent, document.querySelector('#todayList tfoot [data-tu]').textContent].join(' | '));
async function settings(p) { await p.click('#tabs [data-tab="data"]'); await p.waitForTimeout(200); await p.locator('#dispCard').scrollIntoViewIfNeeded(); }
async function today(p) { await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400); }
async function setSize(p, idx) { await p.locator('#dispSize').fill(String(idx)); await p.waitForTimeout(250); }
const shot = async (p, n) => { await p.evaluate(() => document.querySelectorAll('.toast, #toast, .snack').forEach(t => { t.style.visibility = 'hidden'; })); await p.screenshot({ path: path.join(OUT, n) }); await p.evaluate(() => document.querySelectorAll('.toast, #toast, .snack').forEach(t => { t.style.visibility = ''; })); };
// scroll the grid so the code columns (Fee … Dx) are in view
const showCodes = (p, k) => p.evaluate(k => { const w = document.querySelector('#todayList .gwrap'), th = w.querySelector(`thead th.h-${k || 'fee'}`); w.scrollLeft = Math.max(0, th.offsetLeft - 40); }, k);
async function exportFmt(p, fmt) {
  await p.click('#repToday'); await p.waitForSelector('#repDlg[open]');
  await p.click(`#repForm [data-fmt="${fmt}"]`); await p.click('#pMake'); await p.waitForSelector('#xpDlg[open]');
  if (!(await p.isChecked('#xpAck'))) await p.check('#xpAck');
  if (await p.isVisible('#xp1')) { await p.fill('#xp1', EXP_PASS); await p.fill('#xp2', EXP_PASS); await p.check('#xpKeep'); }
  await p.click('#xpOk'); await p.waitForSelector('#pReady:not([hidden])', { timeout: 30000 });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pDown')]);
  const dest = path.join(DL, `${fmt}-${dl.suggestedFilename()}`); await dl.saveAs(dest); await p.click('#pClose'); return dest;
}
const inner = (zip, ext) => { const d = fs.mkdtempSync('/tmp/mbl9k-'); execFileSync('7z', ['x', '-y', '-p' + EXP_PASS, '-o' + d, zip]); const f = fs.readdirSync(d).find(x => x.endsWith('.' + ext)); return path.join(d, f); };

async function desktop(browser) {
  const L = '1280';
  const p = await setup(browser, { viewport: { width: 1280, height: 860 } }, L, false);
  // ---- column order and headers
  const h = await heads(p);
  ok(JSON.stringify(h.map(x => x[0])) === JSON.stringify(ORDER), `${L}: column order ${h.map(x => x[0]).join(' · ')}`);
  ok(h.find(x => x[0] === 'mod1')[1] === 'Modifier code 1' && h.find(x => x[0] === 'mod2')[1] === 'Modifier code 2', `${L}: headers "Modifier code 1" / "Modifier code 2"`);
  ok(await p.evaluate(() => document.querySelectorAll('#todayList table.grid tfoot td.tdet[colspan="5"]').length === 1 && [...document.querySelector('#todayList table.grid tfoot tr').cells].reduce((a, c) => a + (+c.colSpan || 1), 0) === document.querySelectorAll('#todayList table.grid colgroup col').length), `${L}: totals row spans every column (details over Fee … Billing notes)`);
  // ---- old entries (no modifier fields) load fine
  const old = await p.evaluate(() => [...document.querySelectorAll('#todayList tbody tr[data-id]')].map(tr => [tr.querySelector('.gc[data-c="mod1"]').value, tr.querySelector('.gc[data-c="mod2"]').value, tr.querySelector('.gc[data-c="fee"]').value, tr.querySelector('.gc[data-c="dx"]').value]));
  ok(old.length === 4 && old.every(r => r[0] === '' && r[1] === '' && r[2] === '03.03A' && r[3] === '650'), `${L}: 4 older entries without modifier fields load, codes intact, Modifier cells empty`);
  const t0 = await totals(p);
  // ---- widths at the default text size
  let g = await geo(p, 1);
  ok(g.room.fee >= 15 && g.room.dx >= 15 && g.room.mod1 >= 15 && g.room.mod2 >= 15, `${L}: code cells fit 15+ characters before wrapping at ${g.fs} (fee ${g.room.fee}, mod1 ${g.room.mod1}, mod2 ${g.room.mod2}, dx ${g.room.dx} ch; px ${g.w.fee}/${g.w.mod1}/${g.w.mod2}/${g.w.dx})`);
  ok(/px$/.test(g.colpx.mod1) && /px$/.test(g.colpx.mod2) && /px$/.test(g.tw) && Math.abs(parseFloat(g.tw) - g.sum) <= 2, `${L}: Modifier columns and the table have explicit px widths (iOS WebKit) (${g.colpx.mod1}, ${g.colpx.mod2}, table ${g.tw} = Σ ${g.sum})`);
  ok(g.w.note >= g.w.dx, `${L}: Billing notes still at least as wide as Dx (${g.w.note} ≥ ${g.w.dx})`);
  // ---- Tab order: Fee → Modifier 1 → Modifier 2 → Dx
  await p.click(cell(1, 'fee')); await p.keyboard.press('Tab'); const a1 = await where(p); await p.keyboard.press('Tab'); const a2 = await where(p); await p.keyboard.press('Tab'); const a3 = await where(p);
  ok(a1 === 'mod1@1' && a2 === 'mod2@1' && a3 === 'dx@1', `${L}: Tab from Fee code(s) → ${a1} → ${a2} → ${a3}`);
  await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift'); ok(await where(p) === 'mod2@1', `${L}: Shift+Tab from Dx → Modifier code 2`);
  // ---- the cell being edited opens to at least two lines
  await p.click(cell(2, 'mod1')); await p.waitForTimeout(120);
  let b = await cellBox(p, 2, 'mod1');
  ok(b.tag === 'TEXTAREA' && b.h >= b.gh - 1 + b.lh - 1, `${L}: focused empty Modifier cell opens to 2 lines (${b.h}px ≥ row ${b.gh}px + line ${b.lh}px)`);
  await p.keyboard.press('Escape');
  // ---- typing several codes: normalised, saved, wraps and the row grows
  await p.click(cell(1, 'mod1')); await p.keyboard.type('cmgp bmi;teles,,surc  loci age 2anu cmgp', { delay: 4 }); await p.keyboard.press('Tab'); await settle(p);
  ok(await p.inputValue(cell(1, 'mod1')) === M1, `${L}: Modifier code 1 saved upper-case, comma-separated, no duplicates ("${await p.inputValue(cell(1, 'mod1'))}")`);
  ok(await where(p) === 'mod2@1', `${L}: Tab after Modifier code 1 → Modifier code 2`);
  await p.keyboard.type(M2.toLowerCase(), { delay: 4 }); await p.keyboard.press('Tab'); await settle(p);
  await p.click(cell(1, 'fee')); await p.keyboard.press('Control+A'); await p.keyboard.type(FEE, { delay: 3 }); await p.keyboard.press('Tab'); await settle(p);
  await p.click(cell(1, 'dx')); await p.keyboard.press('Control+A'); await p.keyboard.type(DX, { delay: 3 }); await p.keyboard.press('Tab'); await settle(p);
  await p.click(cell(2, 'mod1')); await p.keyboard.type('CMGP'); await p.keyboard.press('Tab'); await p.keyboard.type('BMI, TELES'); await p.keyboard.press('Tab'); await settle(p);
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await settle(p);
  const vals = { fee: await p.inputValue(cell(1, 'fee')), mod1: await p.inputValue(cell(1, 'mod1')), mod2: await p.inputValue(cell(1, 'mod2')), dx: await p.inputValue(cell(1, 'dx')) };
  ok(vals.fee === FEE && vals.mod2 === M2 && vals.dx === DX, `${L}: six fee codes, modifiers and six Dx saved (${JSON.stringify(vals)})`);
  const boxes = {}; for (const k of ['fee', 'mod1', 'mod2', 'dx']) boxes[k] = await cellBox(p, 1, k);
  const clipped = Object.entries(boxes).filter(([, x]) => x.sh > x.h + 1).map(([k]) => k);
  ok(!clipped.length, `${L}: no code cell is clipped (scrollHeight ≤ height) ${clipped.join(',')}`);
  ok(boxes.mod1.lines >= 2 && boxes.fee.lines >= 2 && boxes.mod1.rowH > boxes.mod1.gh + 4, `${L}: long code lists wrap onto ${boxes.fee.lines} / ${boxes.mod1.lines} lines and the row grows (${boxes.mod1.rowH}px vs ${boxes.mod1.gh}px)`);
  g = await geo(p, 1);
  ok(g.w.fee > 300 || g.w.mod1 > 200, `${L}: code columns widen with the content up to their maximum (fee ${g.w.fee}px, mod1 ${g.w.mod1}px, mod2 ${g.w.mod2}px, dx ${g.w.dx}px)`);
  ok(await totals(p) === t0, `${L}: totals unchanged by modifier edits (${t0})`);
  await showCodes(p, 'fee'); await p.waitForTimeout(150); await shot(p, 'modifiers-grid-1280.png');
  await p.click(cell(3, 'mod2')); await p.keyboard.type('TEV, ANE, '); await p.waitForTimeout(250); await shot(p, 'modifiers-editing-1280.png');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await settle(p);
  ok(await p.inputValue(cell(3, 'mod2')) === '', `${L}: Esc cancels a Modifier edit`);
  // ---- persists after lock / unlock (encrypted entry)
  await p.click('#lockNow'); await unlock(p);
  ok(await p.inputValue(cell(1, 'mod1')) === M1 && await p.inputValue(cell(1, 'mod2')) === M2 && await p.inputValue(cell(2, 'mod1')) === 'CMGP' && await p.inputValue(cell(2, 'mod2')) === 'BMI, TELES', `${L}: modifiers still there after lock / unlock`);
  // ---- larger text: widths scale
  await settings(p); await setSize(p, 6); await today(p); const gL = await geo(p, 3);
  ok(gL.w.mod1 > g.w.mod1 * 1.2 || gL.w.mod2 > 136 * 1.3, `${L}: Modifier columns grow with the text size (${g.fs} → ${gL.fs}: mod2 ${gL.w.mod2}px, room ${gL.room.mod2} ch)`);
  ok(gL.room.mod2 >= 15 && gL.room.fee >= 15, `${L}: still 15+ characters at ${gL.fs} (fee ${gL.room.fee}, mod2 ${gL.room.mod2})`);
  await showCodes(p, 'fee'); await shot(p, 'modifiers-large-text-1280.png');
  await settings(p); await setSize(p, 2); await today(p);
  // ---- History shows the same columns
  await p.click('#tabs [data-tab="history"]'); await p.waitForTimeout(800);
  const hist = await p.evaluate(() => { const tr = document.querySelector('#histList tr[data-id="e-0"]'); const t = tr && tr.closest('table'); return tr ? [tr.querySelector('.gc[data-c="mod1"]').value, tr.querySelector('.gc[data-c="mod2"]').value, [...t.querySelectorAll('thead th')].map(x => x.dataset.h).join(',')] : null; });
  ok(hist && hist[0] === M1 && hist[1] === M2 && hist[2] === ORDER.join(','), `${L}: History day grid has the Modifier columns with the values (${hist && hist[2]})`);
  await p.evaluate(() => { const w = document.querySelector('#histList .gwrap'); const th = w.querySelector('thead th.h-fee'); w.scrollLeft = th.offsetLeft - 40; w.scrollIntoView(); }); await p.waitForTimeout(150); await shot(p, 'modifiers-history-1280.png');
  await today(p);
  // ---- entry details and the edit form
  await p.dblclick(`${G} tbody tr:nth-child(1) .rn`); await p.waitForSelector('#editDlg[open]');
  const sum = await p.textContent('#eSummary');
  ok(/Modifiers/.test(sum) && sum.includes(M1) && sum.includes(M2), `${L}: entry details list the modifiers`);
  await p.click('#eaEdit'); ok(await p.inputValue('#eMod1') === M1 && await p.inputValue('#eMod2') === M2, `${L}: edit form shows Modifier code(s) 1 / 2`);
  await p.fill('#eMod2', 'tev  ane'); await p.click('#eSave'); await p.waitForFunction(() => !document.querySelector('#editDlg').open); await settle(p);
  ok(await p.inputValue(cell(1, 'mod2')) === 'TEV, ANE', `${L}: edit form saves Modifier code(s) 2 normalised ("${await p.inputValue(cell(1, 'mod2'))}")`);
  await p.click(cell(1, 'mod2')); await p.keyboard.press('Control+A'); await p.keyboard.type(M2); await p.keyboard.press('Tab'); await p.keyboard.press('Escape'); await settle(p);
  // ---- audit trail + report helpers
  const helpers = await p.evaluate(() => { const B = window.BLR; return [B.normMods(' cmgp,,bmi  cmgp ;tev'), B.diff({ mod1: 'CMGP' }, { mod1: 'CMGP, BMI' }).join('|'), B.table([{ id: 'x', kind: 'enc', name: 'Old', codes: [], segs: [{ s: Date.now() - 3600000, e: Date.now() - 1800000 }], status: 'done' }], '2000-01-01', '2100-01-01', Date.now()).rows[0].length, B.table([], '2000-01-01', '2100-01-01', Date.now()).head.join(',')]; });
  ok(helpers[0] === 'CMGP, BMI, TEV', `normMods: "${helpers[0]}"`);
  ok(/modifier 1: CMGP -> CMGP, BMI/.test(helpers[1]), `audit diff records modifier changes ("${helpers[1]}")`);
  ok(/codes,modifier_1,modifier_2,diagnostic_code/.test(helpers[3]) && helpers[2] === helpers[3].split(',').length, `CSV/Excel columns: …codes, modifier_1, modifier_2, diagnostic_code… (old entry row has ${helpers[2]} cells)`);
  // ---- every encrypted export carries the modifier columns
  for (const fmt of ['csv', 'xlsx', 'pdf', 'docx']) {
    const z = await exportFmt(p, fmt), j = JSON.parse(execFileSync('python3', [path.join(__dirname, 'inspect_zip.py'), z, EXP_PASS, ['CMGP', 'TELES', '2ANU', 'TEV', fmt === 'csv' || fmt === 'xlsx' ? 'modifier_1' : 'Mod', NAMES[0]].join('|')]).toString());
    ok(/AES-256/.test(j.methods.join()) && j.right_pw_ok && j.no_pw_fails && j['valid_' + fmt] && Object.values(j.needles_found).every(Boolean), `${fmt}: AES-256 zip opens, modifiers included ${JSON.stringify(j.needles_found)}`);
    if (fmt === 'csv') {
      const txt = fs.readFileSync(inner(z, 'csv'), 'utf8').replace(/^\ufeff/, ''), lines = txt.trim().split(/\r?\n/), head = lines[0].split(',');
      const i1 = head.indexOf('modifier_1'), i2 = head.indexOf('modifier_2'), ic = head.indexOf('codes');
      ok(i1 === ic + 1 && i2 === ic + 2 && head.indexOf('diagnostic_code') === ic + 3, `csv: modifier_1 / modifier_2 right after codes (columns ${ic + 1}–${ic + 3})`);
      ok(txt.includes(`"${M1}"`) && txt.includes(`"${M2}"`) && lines.length === 5, `csv: values quoted intact ("${M1}", "${M2}"), ${lines.length - 1} rows`);
    }
  }
  // ---- encrypted backup export → import into a fresh vault (another device / the app ↔ the web version)
  await p.click('#tabs [data-tab="data"]'); await p.click('#expAll'); await p.waitForSelector('#askDlg[open]'); await p.fill('#ask_p', PIN); await p.click('#askOk');
  await p.waitForFunction(() => /Backup ready/.test(document.querySelector('#askTitle').textContent)); 
  const [bdl] = await Promise.all([p.waitForEvent('download'), p.click('#askOk')]); const bk = path.join(DL, bdl.suggestedFilename()); await bdl.saveAs(bk);
  const raw = fs.readFileSync(bk, 'utf8');
  ok(/"encrypted-backup"/.test(raw) && !raw.includes('CMGP') && !raw.includes(NAMES[0]), `backup file is encrypted (no modifier or patient text in ${path.basename(bk)})`);
  const q = await setup(browser, { viewport: { width: 1280, height: 860 } }, L + '-import', null, PIN2);
  await q.click('#tabs [data-tab="data"]'); await q.setInputFiles('#impFile', bk); await q.waitForSelector('#askDlg[open]'); await q.fill('#ask_p', PIN); await q.click('#askOk');
  await q.waitForFunction(() => /Imported/.test(document.querySelector('#toast') ? document.querySelector('#toast').textContent : document.body.textContent), null, { timeout: 30000 }).catch(() => {});
  await today(q); await q.waitForFunction(() => document.querySelectorAll('#todayList tbody tr[data-id]').length === 4, null, { timeout: 15000 }).catch(() => {});
  const imp = await q.evaluate(() => Object.fromEntries([...document.querySelectorAll('#todayList tbody tr[data-id]')].map(tr => [tr.dataset.id, [tr.querySelector('.gc[data-c="mod1"]').value, tr.querySelector('.gc[data-c="mod2"]').value]])));
  ok(imp['e-0'] && imp['e-0'][0] === M1 && imp['e-0'][1] === M2 && imp['e-1'][0] === 'CMGP' && imp['e-1'][1] === 'BMI, TELES', `backup import: modifiers restored (${JSON.stringify(imp)})`);
  ok(imp['e-3'] && imp['e-3'][0] === '' && imp['e-3'][1] === '', 'backup import: entries without modifiers come through empty');
  await q.click('#lockNow'); await unlock(q, PIN2);
  ok(await q.inputValue(cell(1, 'mod1')) === M1, 'imported modifiers re-encrypted with the new passcode (still there after lock / unlock)');
  await q.context().close(); await p.context().close();
}

async function phone(browser) {
  const L = '390';
  const p = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, L, true);
  const h = await heads(p);
  ok(JSON.stringify(h.map(x => x[0])) === JSON.stringify(ORDER), `${L}: same column order on the phone`);
  ok(await p.inputValue(cell(4, 'mod1')) === 'CMGP, BMI' && await p.inputValue(cell(4, 'mod2')) === 'TELES' && await p.inputValue(cell(1, 'mod1')) === '', `${L}: new-format and old-format entries side by side`);
  let g = await geo(p, 4);
  ok(g.room.fee >= 15 && g.room.dx >= 15 && g.room.mod1 >= 15 && g.room.mod2 >= 15, `${L}: code cells fit 15+ characters at ${g.fs} (fee ${g.room.fee}, mod1 ${g.room.mod1}, mod2 ${g.room.mod2}, dx ${g.room.dx} ch; px ${g.w.fee}/${g.w.mod1}/${g.w.mod2}/${g.w.dx})`);
  ok(/px$/.test(g.colpx.mod1) && /px$/.test(g.tw) && Math.abs(parseFloat(g.tw) - g.sum) <= 2 && g.w.note >= g.w.dx, `${L}: explicit px widths (table ${g.tw} = Σ ${g.sum}); Billing notes ${g.w.note}px ≥ Dx ${g.w.dx}px`);
  // tap → roomy two-line editor in the cell; the phone's Next moves Fee → Mod 1 → Mod 2 → Dx
  await showCodes(p, 'fee'); await p.waitForTimeout(150);
  await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); w.scrollLeft += 120; }); await p.waitForTimeout(100);   // Modifier code 1 partly off the right edge
  await p.locator(cell(4, 'mod1')).tap(); await p.waitForTimeout(250);
  let b = await cellBox(p, 4, 'mod1');
  const vis = await p.evaluate(() => { const td = document.activeElement.closest('td').getBoundingClientRect(), w = document.querySelector('#todayList .gwrap').getBoundingClientRect(); return td.left >= w.left - 1 && td.right <= w.right + 1; });
  ok(vis, `${L}: the tapped Modifier cell is fully in view`);
  ok(await where(p) === 'mod1@4' && b.h >= b.gh - 1 + b.lh - 1 && b.rowH >= 40, `${L}: tap Modifier code 1 → editing in a 2-line cell (${b.h}px, row ${b.rowH}px)`);
  await p.keyboard.press('Control+End'); await p.keyboard.type(', surc loci age', { delay: 8 });   // a tap puts the caret where you tap (native); append at the end await p.waitForTimeout(300);
  b = await cellBox(p, 4, 'mod1'); ok(b.sh <= b.h + 1, `${L}: typing more codes: the cell grows, nothing hidden (${b.lines} lines, ${b.h}px)`);
  await shot(p, 'modifiers-editing-390.png');
  await p.locator('#gNextF').tap(); await p.waitForTimeout(300);
  ok(await where(p) === 'mod2@4', `${L}: floating Next → Modifier code 2`);
  ok(await p.inputValue(cell(4, 'mod1')) === 'CMGP, BMI, SURC, LOCI, AGE', `${L}: Modifier code 1 saved ("${await p.inputValue(cell(4, 'mod1'))}")`);
  await p.keyboard.press('Control+End'); await p.keyboard.type(' ane tev', { delay: 8 }); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok(await where(p) === 'dx@4' && await p.inputValue(cell(4, 'mod2')) === 'TELES, ANE, TEV', `${L}: return key → Dx; Modifier code 2 saved ("${await p.inputValue(cell(4, 'mod2'))}")`);
  await p.keyboard.type(', 644.21'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  // several codes on another row typed into a blank row (creates the entry)
  await p.locator(cell(5, 'fee')).tap(); await p.keyboard.type('03.04A, 13.99BA, 03.05JR'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  ok(await where(p) === 'mod1@5', `${L}: blank row → typing a fee code creates the entry; return → Modifier code 1 (${await where(p)})`);
  await p.keyboard.type('CMGP, TELES'); await p.keyboard.press('Enter'); await p.keyboard.type('BMI'); await p.keyboard.press('Enter'); await p.keyboard.type('V22.2, 650, 626.2'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => document.querySelectorAll('#todayList tbody tr[data-id]').length) === 5 && await p.inputValue(cell(5, 'mod1')) === 'CMGP, TELES' && await p.inputValue(cell(5, 'mod2')) === 'BMI', `${L}: new row saved with its modifiers`);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(500);
  const g5 = await geo(p, 5), b5 = await cellBox(p, 5, 'fee');
  ok(g5.w.fee <= 390 * 0.62 + 1 && b5.lines >= 2 && b5.sh <= b5.h + 1, `${L}: on the phone a code column stops at ~60 % of the screen (${g5.w.fee}px); a longer list wraps (${b5.lines} lines) and the row grows (${b5.rowH}px)`);
  const boxes = {}; for (const k of ['fee', 'mod1', 'mod2', 'dx']) boxes[k] = await cellBox(p, 4, k);
  ok(Object.values(boxes).every(x => x.sh <= x.h + 1), `${L}: nothing clipped after editing (${Object.entries(boxes).map(([k, x]) => k + ' ' + x.lines + 'L').join(', ')})`);
  await showCodes(p, 'fee'); await p.waitForTimeout(200); await shot(p, 'modifiers-grid-390.png');
  await showCodes(p, 'mod2'); await p.waitForTimeout(150); await shot(p, 'modifiers-grid-dx-390.png');
  // largest text size on the phone
  await settings(p); await setSize(p, 6); await today(p); const gL = await geo(p, 4);
  ok(gL.room.mod1 >= 15 && gL.room.fee >= 15 && gL.w.mod1 > g.w.mod1, `${L}: at ${gL.fs} the columns grow (mod1 ${g.w.mod1} → ${gL.w.mod1}px) and still fit 15+ characters (fee ${gL.room.fee}, mod1 ${gL.room.mod1})`);
  await showCodes(p, 'fee'); await shot(p, 'modifiers-large-text-390.png');
  await settings(p); await setSize(p, 2); await today(p);
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
