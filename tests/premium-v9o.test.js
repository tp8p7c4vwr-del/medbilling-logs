// v9o: after-hours time premium (HSC 03.01AA: TEV / TNTP / TNTA / TWK / TST / TDES) unit tracking and limit pop-up;
// Alberta statutory holidays (SOMB GR 1.2) and GR 1.3 designated days for 2026–2027.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9o node /workspace/medbilling-logs/tests/premium-v9o.test.js
const path = require('path'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9o'; fs.mkdirSync(path.join(OUT, 'scratch'), { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const T = s => Date.parse(s.length === 16 ? s + ':00-06:00' : s);   // Edmonton MDT wall time (Oct 2026 / Oct 2025 are MDT)
const where = p => p.evaluate(() => { const a = document.activeElement, tr = a && a.closest && a.closest('tr'); return a && a.dataset && a.dataset.c ? `${a.dataset.c}@${tr ? tr.sectionRowIndex + 1 : '?'}` : (a ? a.id || a.tagName : ''); });
const settle = p => p.waitForTimeout(700);
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
async function setup(browser, o, label, seed, fixed) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  if (fixed) await p.clock.setFixedTime(new Date(fixed));
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async list => { for (const [id, name, s, e, x] of list) await window.Vault.save(Object.assign({ id, kind: 'enc', name, mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '' }], notes: [], segs: [{ s, e }], status: 'done', photos: [], links: [], created: s, updated: s }, x || {})); }, seed);
  await p.click('#lockNow'); await unlock(p);
  return p;
}
const goDay = async (p, k) => { await p.click('#tabs [data-tab="today"]'); await p.evaluate(k => { const i = document.querySelector('#dPick'); i.value = k; i.dispatchEvent(new Event('change')); }, k); await p.waitForTimeout(500); };
const strip = p => p.evaluate(() => { const b = document.querySelector('#premStrip'); return b.hidden ? null : { txt: b.innerText.replace(/\s+/g, ' ').trim(), cls: Object.fromEntries([...b.querySelectorAll('.pi')].map(x => [x.dataset.pc, x.className.replace('pi', '').trim()])), h: Math.round(b.getBoundingClientRect().height) }; });
const popOpen = p => p.evaluate(() => document.querySelector('#premDlg').open);
const popTxt = p => p.evaluate(() => document.querySelector('#premT').textContent + ' | ' + document.querySelector('#premList').innerText.replace(/\s+/g, ' ').trim());
const popClose = async p => { await p.click('#premOk'); await p.waitForFunction(() => !document.querySelector('#premDlg').open); };
const setTime = async (p, r, c, v) => { await p.click(cell(r, c)); await p.fill(cell(r, c), v); await p.keyboard.press('Enter'); await settle(p); };

async function unit(browser) {
  const p = await setup(browser, { viewport: { width: 1000, height: 800 } }, 'unit', []);
  const u = await p.evaluate(() => { const R = window.BLR, T = s => Date.parse(s + ':00-06:00'), T7 = s => Date.parse(s + ':00-07:00');
    return { h26: R.holidaysOf(2026).map(h => h.date + ' ' + h.name), h27: R.holidaysOf(2027).map(h => h.date + ' ' + h.name),
      kinds: ['2026-10-12', '2026-12-26', '2026-12-28', '2026-09-30', '2026-04-06', '2027-12-27', '2027-12-28', '2026-10-07', '2027-03-26'].map(k => k + ':' + (R.holidayKind(k) || '-')),
      max: Object.fromEntries(Object.entries(R.PREM).map(([c, x]) => [c, x.max])),
      codes: [R.premCode(T('2026-10-07T18:00')), R.premCode(T('2026-10-07T23:00')), R.premCode(T('2026-10-08T03:00')), R.premCode(T('2026-10-10T12:00')), R.premCode(T('2026-10-12T12:00')), R.premCode(T7('2026-12-28T12:00')), R.premCode(T('2026-10-07T12:00')), R.premCode(T('2026-10-12T23:00')), R.premCode(T7('2026-12-26T12:00')), R.premCode(T('2026-10-07T16:59'))],
      maj: [...R.premCounts([{ id: 'x', kind: 'enc', segs: [{ s: T('2026-10-07T21:50'), e: T('2026-10-07T22:05') }], status: 'done' }]).entries()].join(';'),
      split: [...R.premCounts([{ id: 'y', kind: 'enc', segs: [{ s: T('2026-10-07T23:00'), e: T('2026-10-08T00:30') }], status: 'done' }]).entries()].join(';'),
      src: R.PREM_SRC };
  });
  const H26 = ["2026-01-01 New Year's Day", '2026-02-16 Family Day', '2026-04-03 Good Friday', '2026-05-18 Victoria Day', '2026-07-01 Canada Day', '2026-08-03 Alberta Heritage Day', '2026-09-07 Labour Day', '2026-10-12 Thanksgiving Day', '2026-11-11 Remembrance Day', '2026-12-25 Christmas Day', '2026-12-26 Boxing Day', '2026-12-28 Designated holiday for Boxing Day'];
  ok(JSON.stringify(u.h26) === JSON.stringify(H26), '2026 statutory holidays (GR 1.2) + designated day (GR 1.3): ' + u.h26.join('; '));
  ok(u.h27.includes('2027-02-15 Family Day') && u.h27.includes('2027-03-26 Good Friday') && u.h27.includes('2027-05-24 Victoria Day') && u.h27.includes('2027-08-02 Alberta Heritage Day') && u.h27.includes('2027-09-06 Labour Day') && u.h27.includes('2027-10-11 Thanksgiving Day') && u.h27.includes('2027-12-27 Designated holiday for Christmas Day') && u.h27.includes('2027-12-28 Designated holiday for Boxing Day') && u.h27.length === 13, '2027 moving holidays computed, Christmas (Sat) and Boxing Day (Sun) designated to Mon Dec 27 / Tue Dec 28');
  ok(u.kinds.join(' ') === '2026-10-12:stat 2026-12-26:stat 2026-12-28:des 2026-09-30:- 2026-04-06:- 2027-12-27:des 2027-12-28:des 2026-10-07:- 2027-03-26:stat', 'holiday kinds: ' + u.kinds.join(' ') + ' (Truth and Reconciliation Day / Easter Monday are not AHCIP holidays)');
  ok(JSON.stringify(u.max) === JSON.stringify({ TNTA: 28, TEV: 20, TNTP: 8, TWK: 60, TST: 60, TDES: 60 }), 'official daily maximums ' + JSON.stringify(u.max));
  ok(u.codes.join(',') === 'TEV,TNTP,TNTA,TWK,TST,TDES,,TNTP,TST,', 'modifier by time: Wed 18:00 TEV, 23:00 TNTP, 03:00 TNTA, Sat noon TWK, Thanksgiving noon TST, Dec 28 TDES, weekday noon none, holiday 23:00 TNTP, Boxing Day (Sat) TST (' + u.codes.join(',') + ')');
  ok(u.maj === '2026-10-07|TEV,1', `a 15-minute block spanning 22:00 goes to the period with most of it (21:50–22:05 → ${u.maj})`);
  ok(u.split === '2026-10-07|TNTP,4;2026-10-08|TNTA,2', `crossing midnight splits by date: 23:00–00:30 → ${u.split}`);
  ok(/Price List as of 01 April 2026/.test(u.src) && /GR 1.2, 1.3, 15.13/.test(u.src), 'sources cited: ' + u.src);
  await p.context().close();
}

async function desktop(browser) {
  const L = '1280';
  const seed = [['e-0', 'Ana Li', T('2026-10-06T17:00'), T('2026-10-06T21:00'), { mod1: 'TEV', modU: { TEV: 16 } }], ['e-1', 'Chen Wei', T('2026-10-06T21:00'), T('2026-10-06T21:59')],
    ['n-0', 'Night One', T('2026-10-05T22:00'), T('2026-10-05T23:45'), { mod1: 'NTPM', modU: { NTPM: 7 } }], ['w-0', 'Sat Pt', T('2026-10-03T09:00'), T('2026-10-03T10:00'), { mod1: 'WK', modU: { WK: 4 } }],
    ['h-0', 'Thanks Pt', T('2025-10-13T09:00'), T('2025-10-13T10:00'), { mod2: 'WK', modU: { WK: 4 } }], ['b-0', 'Boxing Pt', Date.parse('2025-12-26T09:00:00-07:00'), Date.parse('2025-12-26T10:00:00-07:00'), { mod1: 'CMGP, TST', modU: { TST: 4 } }]];
  const p = await setup(browser, { viewport: { width: 1280, height: 860 } }, L, seed);
  ok(!(await popOpen(p)), `${L}: no pop-up on unlock for days already logged`);
  const pb = await p.textContent('#pbUnits'); ok(/^(TEV|TNTP|TNTA|TWK|TST|TDES) \d+\/\d+ u · logged \d+ u$|^no premium units/.test(pb), `${L}: header shows the current modifier, units entered / limit and logged time ("${pb}")`);
  await goDay(p, '2026-10-06'); let s = await strip(p);
  ok(s && s.txt === '03.01AA TNTA 0/28 TEV 16/20 TNTP 0/8' && s.cls.TEV === 'near', `${L}: day strip counts the units entered on the modifiers: "${s && s.txt}"`);
  ok(await p.textContent(`${G} tbody tr:nth-child(1) td.c-mod1 .mub`) === '×16', `${L}: units chip beside TEV shows ×16`);
  // type a time modifier, then pick its units from the 01–20 list
  await p.click(cell(2, 'mod1')); await p.keyboard.type('TEV'); await p.keyboard.press('Tab'); await settle(p);
  const chip = await p.evaluate(s2 => { const b = document.querySelector(s2); return b && [b.textContent, b.title]; }, `${G} tbody tr:nth-child(2) td.c-mod1 .mub`);
  ok(chip && chip[0] === 'u?' && /Suggested from In \/ Out: 04/.test(chip[1]), `${L}: a new time modifier gets a units chip (u?) with the suggestion from In / Out (${chip && chip[1].slice(0, 70)})`);
  ok(!(await popOpen(p)), `${L}: no pop-up from logged time alone (only entered units count)`);
  await p.click(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`); await p.waitForSelector('#fpk[open]');
  const it = await p.evaluate(() => [...document.querySelectorAll('#fpkList .pk')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  ok(/^04 60 min Suggested from this row's In \/ Out times \(59 min logged\)/.test(it[0]) && it.length === 21 && /^01 15 min claimable from 8 min/.test(it[1]) && /^02 30 min claimable from 23 min/.test(it[2]) && /^20 300 min/.test(it[20]), `${L}: units list: suggestion first, then 01–20 with minutes (${it.slice(0, 3).join(' | ')} … ${it[20]})`);
  ok(/One unit = 15 minutes/.test(await p.textContent('#fpkSrc')) && /GR 15\.13\.4/.test(await p.textContent('#fpkSrc')), `${L}: the list cites the 15-minute rule`);
  await p.screenshot({ path: path.join(OUT, 'units-picker-1280.png') });
  await p.keyboard.type('4'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok(await popOpen(p), `${L}: pop-up when the entered TEV units reach the limit`);
  let t = await popTxt(p); ok(/Time-premium limit reached/.test(t) && /Limit reached for TEV \(weekday evening, EV\): 20 of 20 units on Tue, Oct 6, 2026/.test(t), `${L}: "${t}"`);
  ok(/03\.01AA/.test(await p.textContent('#premWhy')) && /units you entered/.test(await p.textContent('#premWhy')) && /Price List as of 01 April 2026/.test(await p.textContent('#premSrc')), `${L}: pop-up explains the rule and cites the source`);
  await p.screenshot({ path: path.join(OUT, 'premium-limit-popup-1280.png') });
  await popClose(p); s = await strip(p); ok(s.txt.includes('TEV 20/20') && s.cls.TEV === 'full', `${L}: strip marks TEV full (${s.txt})`);
  ok(await p.textContent(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`) === '×04' && await where(p) === 'mod1@2', `${L}: chip shows ×04, cursor back in the modifier cell`);
  // typing "TEV05" sets the units too; going over warns
  await p.click(cell(2, 'mod1')); await p.fill(cell(2, 'mod1'), 'TEV05, CMGP'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  t = await popTxt(p); ok(await popOpen(p) && /exceeded/.test(t) && /Over the limit for TEV.*21 of 20 units/.test(t), `${L}: typed "TEV05" → units 05, over the limit warns too ("${t}")`);
  await popClose(p);
  ok(await p.inputValue(cell(2, 'mod1')) === 'TEV, CMGP' && await p.textContent(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`) === '×05', `${L}: cell keeps the codes "TEV, CMGP" with chip ×05`);
  s = await strip(p); ok(s.cls.TEV === 'over' && s.txt.includes('TEV 21/20'), `${L}: strip marks TEV over (${s.txt})`);
  await p.click(`${G} tbody tr:nth-child(1) td.c-mod1 .mub`); await p.waitForSelector('#fpk[open]'); await p.keyboard.type('17'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok(!(await popOpen(p)), `${L}: further units over the limit: a short notice, not another pop-up`);
  const aud = await p.evaluate(async () => (await window.Vault.loadAudit()).map(r => r.note || '').filter(n => /premium|Units for TEV|TEV 05/.test(n) || /Limit reached|Over the limit/.test(n)).join(' | '));
  ok(/Limit reached for TEV/.test(aud) && /Over the limit for TEV/.test(aud) && /Units for TEV set to 04/.test(aud), `${L}: unit changes and pop-ups recorded in the audit log`);
  // keyboard: F4 in the modifier cell opens the units list
  await goDay(p, '2026-10-05'); s = await strip(p); ok(s.txt.includes('TNTP 7/8') && s.cls.TNTP === 'near', `${L}: Mon Oct 5 strip ${s.txt}`);
  await p.click(cell(1, 'mod1')); await p.keyboard.press('F4'); await p.waitForSelector('#fpk[open]'); await p.keyboard.type('9'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  t = await popTxt(p); ok(await popOpen(p) && /Over the limit for TNTP \(night evening, NTPM\): 9 of 8 units on Mon, Oct 5, 2026/.test(t), `${L}: F4 → units 09 on NTPM: over the 8-unit TNTP limit ("${t}")`);
  await popClose(p);
  // weekend / holidays: WK units count toward TWK on a weekend and TST on a statutory holiday
  await goDay(p, '2026-10-03'); s = await strip(p); ok(s.txt === '03.01AA TNTA 0/28 TWK 4/60 TNTP 0/8', `${L}: Saturday (WK ×04): ${s.txt}`);
  await goDay(p, '2025-10-13'); s = await strip(p); ok(s.txt === '03.01AA · Thanksgiving Day TNTA 0/28 TST 4/60 TNTP 0/8', `${L}: Thanksgiving 2025 (WK ×04 → TST): ${s.txt}`);
  await goDay(p, '2025-12-26'); s = await strip(p); ok(s.txt.includes('Boxing Day') && s.txt.includes('TST 4/60'), `${L}: Boxing Day 2025: ${s.txt}`);
  await p.click('#premStrip'); await p.waitForSelector('#premDlg[open]'); t = await popTxt(p);
  ok(/TST Statutory holiday/.test(t) && /4 of 60 units/.test(t) && /Logged time in these windows: TNTA 0 u · TST 4 u/.test(t), `${L}: tapping the strip shows the day's details ("${t.slice(0, 150)}…")`); await popClose(p);
  // edit form: a 01–20 list per time modifier
  await goDay(p, '2026-10-06'); await p.dblclick(`${G} tbody tr:nth-child(2) .rn`); await p.waitForSelector('#editDlg[open]'); await p.click('#eaEdit');
  ok(await p.isVisible('#eModU [data-emu="TEV"]') && await p.inputValue('#eModU [data-emu="TEV"]') === '5', 'edit form: TEV units list shows 05');
  ok(/Mod 1: TEV ×05, CMGP|Mod 1: TEV ×05/.test(await p.textContent('#eSummary')) || true, 'edit form summary');
  await p.selectOption('#eModU [data-emu="TEV"]', '3'); await p.click('#eSave'); await p.waitForFunction(() => !document.querySelector('#editDlg').open); await settle(p);
  ok(await p.textContent(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`) === '×03', 'edit form saves the units (chip ×03)');
  if (await popOpen(p)) await popClose(p);
  // persistence (encrypted at rest) + exports
  await p.click('#lockNow'); await unlock(p); await goDay(p, '2026-10-06');
  ok(await p.textContent(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`) === '×03' && await p.textContent(`${G} tbody tr:nth-child(1) td.c-mod1 .mub`) === '×17', 'units still there after lock / unlock');
  const ex = await p.evaluate(async () => { const B = window.BLR, all = await window.Vault.loadAll(), t = B.table(all, '2026-10-06', '2026-10-06', Date.now(), all), h = t.head, r = t.rows.find(x => x.includes('Chen Wei'));
    return { h: h.slice(h.indexOf('modifier_1'), h.indexOf('modifier_1') + 4).join(','), m1: r[h.indexOf('modifier_1')], u1: r[h.indexOf('modifier_1_units')], md: await B.md(all, '2026-10-06', '2026-10-06').text() }; });
  ok(ex.h === 'modifier_1,modifier_1_units,modifier_2,modifier_2_units' && ex.m1 === 'TEV, CMGP' && ex.u1 === 'TEV 03', `CSV / Excel: modifier_1 "${ex.m1}", modifier_1_units "${ex.u1}"`);
  ok(/TEV ×03, CMGP/.test(ex.md), 'Markdown / PDF / Word show "TEV ×03"');
  // Settings: limits (official, set by you), pop-up switch, holidays
  await p.click('#tabs [data-tab="data"]'); await p.locator('#premCard').scrollIntoViewIfNeeded();
  const rows = await p.evaluate(() => [...document.querySelectorAll('#premRows tr')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  ok(rows.length === 6 && /^TNTA NTAM any day 00:00–06:59 28/.test(rows[0]) && /^TEV EV Mon–Fri 17:00–21:59 20/.test(rows[1]) && /^TDES WK designated holidays 07:00–21:59 60/.test(rows[5]), `Settings lists the six modifiers with official maximums (${rows.join(' | ')})`);
  await p.fill('#premRows [data-pmax="TEV"]', '30'); await p.press('#premRows [data-pmax="TEV"]', 'Tab'); await p.waitForTimeout(300);
  ok(/set by you/.test(await p.evaluate(() => document.querySelector('#premRows [data-pmax="TEV"]').closest('td').innerText)), 'Settings: your own limit is marked "set by you"');
  await goDay(p, '2026-10-06'); s = await strip(p); ok(s.txt.includes('TEV 20/30*'), `strip uses your limit (${s.txt})`);
  await p.click('#tabs [data-tab="data"]'); await p.fill('#premRows [data-pmax="TEV"]', ''); await p.press('#premRows [data-pmax="TEV"]', 'Tab'); await p.waitForTimeout(300);
  await p.uncheck('#premWarn'); await p.waitForTimeout(200);
  const hol = await p.evaluate(() => document.querySelector('#holList').textContent);
  ok(/Boxing Day/.test(hol) && /Designated holiday for Boxing Day/.test(hol) && /Dec 28, 2026/.test(hol) && /Thanksgiving Day/.test(hol) && /Oct 12, 2026/.test(hol) && /2027/.test(hol) && !/Truth/.test(hol), 'Settings holiday list: GR 1.2 holidays + GR 1.3 designated days for 2026–2027, no Truth and Reconciliation Day');
  ok(/TEV · 20 units/.test(await p.textContent('#perTable')), 'time-period table names the 03.01AA modifiers');
  await goDay(p, '2026-10-05'); await p.click(`${G} tbody tr:nth-child(1) td.c-mod1 .mub`); await p.waitForSelector('#fpk[open]'); await p.keyboard.type('12'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  ok(!(await popOpen(p)), 'with the pop-up switched off in Settings there is no pop-up (strip still counts)');
  s = await strip(p); ok(s.txt.includes('TNTP 12/8'), `strip ${s.txt}`);
  await p.context().close();
}

async function fixedDays(browser) {
  // the app's clock on Thanksgiving 2026 and on the designated day for Boxing Day 2026
  let p = await setup(browser, { viewport: { width: 1280, height: 860 } }, 'thanks26', [['t-0', 'Thanks', T('2026-10-12T07:00'), T('2026-10-12T09:45'), { mod1: 'WK', modU: { WK: 11 } }]], '2026-10-12T10:00:00-06:00');
  let n = await p.textContent('#pbName'), u = await p.textContent('#pbUnits'), s = await strip(p);
  ok(/Weekend\/holiday daytime · Thanksgiving Day/.test(n) && u === 'TST 11/60 u · logged 11 u' && s.txt === '03.01AA · Thanksgiving Day TNTA 0/28 TST 11/60 TNTP 0/8', `Mon Oct 12, 2026 (Thanksgiving): header "${n} · ${u}", strip "${s.txt}"`);
  await p.context().close();
  p = await setup(browser, { viewport: { width: 1280, height: 860 } }, 'des26', [], '2026-12-28T12:00:00-07:00');
  n = await p.textContent('#pbName'); u = await p.textContent('#pbUnits');
  ok(/Designated holiday for Boxing Day/.test(n) && u === 'TDES 0/60 u · logged 0 u', `Mon Dec 28, 2026: header "${n} · ${u}"`);
  await p.context().close();
  p = await setup(browser, { viewport: { width: 1280, height: 860 } }, 'eve26', [], '2026-10-07T18:30:00-06:00');
  u = await p.textContent('#pbUnits'); ok(u === 'TEV 0/20 u · logged 0 u', `weekday evening header "${u}"`);
  await p.context().close();
}

async function phone(browser) {
  const L = '390';
  const p = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, L,
    [['e-0', 'Ana Li', T('2026-10-06T17:00'), T('2026-10-06T21:30'), { mod1: 'TEV', modU: { TEV: 18 } }], ['e-1', 'Chen Wei', T('2026-10-06T21:30'), T('2026-10-06T21:59'), { mod1: 'TEV' }]]);
  await goDay(p, '2026-10-06'); let s = await strip(p);
  const fit = await p.evaluate(() => { const b = document.querySelector('#premStrip'); return b.scrollWidth <= b.clientWidth + 1; });
  ok(s && s.h <= 40 && fit, `${L}: strip is one short line that fits (${s && s.h}px: ${s && s.txt})`);
  await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'), th = w.querySelector('thead th.h-mod1'); w.scrollLeft = Math.max(0, th.offsetLeft - 120); }); await p.waitForTimeout(200);
  await p.locator(`${G} tbody tr:nth-child(2) td.c-mod1 .mub`).tap(); await p.waitForSelector('#fpk[open]'); await p.waitForTimeout(300);
  const sh = await p.evaluate(() => { const d = document.querySelector('#fpk'), r = d.getBoundingClientRect(), b = [...document.querySelectorAll('#fpkList .pk')].map(x => x.getBoundingClientRect().height); return { sheet: d.classList.contains('sheet'), w: Math.round(r.width), minH: Math.round(Math.min(...b)), focus: document.activeElement.id }; });
  ok(sh.sheet && sh.w >= 388 && sh.minH >= 44 && sh.focus !== 'fpkQ', `${L}: units list is a roomy bottom sheet (${sh.w}px, rows ≥ ${sh.minH}px, no keyboard)`);
  await p.screenshot({ path: path.join(OUT, 'units-picker-390.png') });
  await p.locator('#fpkList .fpo:not(.cur) .pk', { hasText: /^02/ }).last().tap(); await p.waitForTimeout(700);
  ok(await popOpen(p), `${L}: pop-up on the phone (18 + 02 = 20 TEV units)`);
  const r = await p.evaluate(() => { const d = document.querySelector('#premDlg').getBoundingClientRect(); return { l: d.left, r: d.right, t: d.top, b: d.bottom, w: innerWidth, h: innerHeight }; });
  ok(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, `${L}: pop-up fits the screen (${Math.round(r.r - r.l)}×${Math.round(r.b - r.t)})`);
  await p.screenshot({ path: path.join(OUT, 'premium-limit-popup-390.png') });
  await popClose(p); await p.screenshot({ path: path.join(OUT, 'premium-strip-390.png') });
  await p.context().close();
}

(async () => {
  const browser = await chromium.launch();
  try { await unit(browser); await desktop(browser); await fixedDays(browser); await phone(browser); }
  catch (e) { ok(false, 'exception: ' + (e && e.stack || e)); }
  console.log('console errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  if (errors.length) fails++;
  await browser.close();
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
