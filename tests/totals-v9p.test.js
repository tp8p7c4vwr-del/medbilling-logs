// v9p: plain-words totals. Totals row: time as "6 h 11", "6 h 11 min · 25 units"; lines under it ("Hospital 5 h 41 min · 23 units",
// "Day 17 min · 1 unit", "Evening …") one per line on iPhone, pinned on Today, readable at scrollLeft 0; History footer / week
// header / week strip; period bar wording and its consistency with the totals; CSV keeps minutes + adds hours_minutes; reports.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9p node /workspace/medbilling-logs/tests/totals-v9p.test.js
const path = require('path'), fs = require('fs');
const { chromium, webkit } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL0 = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9p'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917', DAY = '2026-10-06';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600); }
const goDay = async (p, k) => { await p.click('#tabs [data-tab="today"]'); await p.evaluate(k => { const i = document.querySelector('#dPick'); i.value = k; i.dispatchEvent(new Event('change')); }, k); await p.waitForTimeout(600); };
const foot = (p, root) => p.evaluate(r => { const f = document.querySelector(`${r} table.grid tfoot`); return { tn: f.querySelector('[data-tn]').textContent, tm: f.querySelector('[data-tm]').textContent, tu: f.querySelector('[data-tu]').textContent, td: f.querySelector('[data-td]').textContent, lines: [...f.querySelectorAll('[data-tl] span')].map(s => s.textContent) }; }, root);
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/^Refused to apply a stylesheet/.test(m.text())) errors.push(label + ': ' + m.text()); });
  await p.goto(URL0); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async DAY => { const T = hm => new Date(`${DAY}T${hm}:00`).getTime(), now = Date.now();
    const mk = (id, a, b, x) => Object.assign({ id, kind: 'enc', name: 'Patient ' + id, mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [], notes: [], segs: [{ s: T(a), e: T(b) }], status: 'done', photos: [], links: [], created: T(a), updated: T(a) }, x);
    await Vault.save(mk('e1', '16:40', '16:57')); await Vault.save(mk('e2', '17:00', '20:00')); await Vault.save(mk('e3', '20:05', '21:59'));
    await Vault.save(mk('e4', '18:00', '18:30', { setting: 'C' })); await Vault.save(mk('e5', '22:10', '22:40'));
    // today: one row inside the current time period (for the period bar ↔ totals check)
    const a = BLR.periodAt(now), s = Math.max(a.start, now - 40 * 60000), e = now - 60000;
    if (e - s > 60000) await Vault.save({ id: 't1', kind: 'enc', name: 'Patient T', mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [], notes: [], segs: [{ s, e }], status: 'done', photos: [], links: [], created: s, updated: s });
  }, DAY);
  await p.click('#lockNow'); await unlock(p);
  return p;
}
(async () => {
  const cr = await chromium.launch(), wk = await webkit.launch();
  for (const [engine, br, vp, mob] of [['chromium', cr, { width: 1280, height: 800 }, false], ['chromium', cr, { width: 402, height: 874 }, true], ['webkit', wk, { width: 402, height: 874 }, true], ['webkit', wk, { width: 375, height: 667 }, true]]) {
    const L = `${engine} ${vp.width}x${vp.height}`, p = await setup(br, Object.assign({ viewport: vp }, mob ? { userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}), L);
    await goDay(p, DAY);
    const f = await foot(p, '#todayList');
    ok(f.tm === '6 h 11' && f.tu === '25' && f.td === '6 h 11 min · 25 units', `${L}: totals row: time "${f.tm}", units "${f.tu}", "${f.td}"`);
    ok(f.lines[0] === 'Hospital 5 h 41 min · 23 units' && f.lines[1] === 'Clinic 30 min · 2 units' && f.lines.includes('Day 17 min · 1 unit') && f.lines.some(l => /^Evening 5 h 24 min · \d+ units$/.test(l)) && f.lines.some(l => /^Late evening 30 min · 2 units$/.test(l)), `${L}: lines: ${f.lines.join(' / ')}`);
    const lay = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'), wr = w.getBoundingClientRect(), sp = [...w.querySelectorAll('tfoot [data-tl] span')].map(s => s.getBoundingClientRect()), gt = w.querySelector('tfoot tr.gt td[data-tm]').getBoundingClientRect(), gts = w.querySelector('tfoot tr.gts td.tsum').getBoundingClientRect();
      return { tops: sp.map(r => Math.round(r.top)), inView: sp.every(r => r.left >= wr.left - 1 && r.right <= wr.right + 1 && r.bottom <= wr.bottom + 1 && r.top >= wr.top), cut: [...w.querySelectorAll('tfoot [data-tl] span')].some(s => s.scrollWidth > s.clientWidth + 1), pinned: Math.abs(gts.bottom - (wr.top + w.clientHeight)) < 3 && Math.abs(gt.bottom - gts.top) < 2, h: Math.round(gts.height), dbg: [sp.map(r => [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]).slice(0, 2), Math.round(wr.top), Math.round(wr.bottom), w.clientHeight, Math.round(gt.bottom), Math.round(gts.top), Math.round(gts.bottom)] }; });
    const own = new Set(lay.tops).size === lay.tops.length;
    ok(lay.inView && !lay.cut && lay.pinned, `${L}: lines fully visible at the bottom of the grid, totals row right above them (pinned; lines block ${lay.h}px)` + (lay.inView && !lay.cut && lay.pinned ? '' : ' ' + JSON.stringify(lay.dbg) + ' ' + [lay.inView, lay.cut, lay.pinned]));
    ok(mob ? own : new Set(lay.tops).size < lay.tops.length, `${L}: ${mob ? 'each line on its own line' : 'wide screen: lines side by side'} (tops ${lay.tops.join(',')})`);
    // still readable after scrolling sideways
    await p.evaluate(() => { document.querySelector('#todayList .gwrap').scrollLeft = 400; }); await p.waitForTimeout(200);
    const side = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'), wr = w.getBoundingClientRect(); return [...w.querySelectorAll('tfoot [data-tl] span')].every(s => { const r = s.getBoundingClientRect(); return r.left >= wr.left - 1 && r.right <= wr.right + 1; }); });
    ok(side, `${L}: lines stay in view when the grid is scrolled sideways`);
    await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); w.scrollLeft = 0; w.scrollTop = 0; }); await p.waitForTimeout(200);
    const pb = await p.evaluate(() => ({ u: document.querySelector('#pbUnits').textContent, l: document.querySelector('#pbLeft').textContent, fit: [document.querySelector('#pbUnits'), document.querySelector('#pbLeft'), document.querySelector('#pbName')].every(el => el.scrollWidth <= el.clientWidth + 1) }));
    ok(/^(TEV|TNTP|TNTA|TWK|TST|TDES) \d+ of \d+ units$|^No premium units$/.test(pb.u) && /^[A-Z][\w/ ]+ time logged: \d+ units? · .+ left/.test(pb.l) && pb.fit, `${L}: period bar "${pb.u}" / "${pb.l}" (not cut off: ${pb.fit})`);
    await p.evaluate(() => { document.querySelectorAll('#toast, .toast').forEach(t => { t.style.visibility = 'hidden'; }); }); await p.waitForTimeout(300);
    if (engine === 'chromium' && vp.width === 1280) await p.screenshot({ path: path.join(OUT, 'totals-1280x800.png') });
    if (vp.width === 402) await p.screenshot({ path: path.join(OUT, `totals-402x874${engine === 'webkit' ? '-webkit' : ''}.png`) });
    if (vp.width === 1280) {
      // period bar vs totals for today (same period, same units)
      await goDay(p, await p.evaluate(() => BLR.dayKey(Date.now())));
      const cmp = await p.evaluate(() => { const now = Date.now(), a = BLR.periodAt(now), d = BLR.dayKey(now); const m = document.querySelector('#pbLeft').textContent.match(/time logged: (\d+)/); const lines = [...document.querySelectorAll('#todayList tfoot [data-tl] span')].map(s => s.textContent); const nm = BLR.perName(a.p.id, d); const ln = lines.find(l => l.startsWith(nm + ' ')); return { bar: m && +m[1], line: ln || '(none)', nm, start: a.start }; });
      const lu = (cmp.line.match(/· (\d+) units?$/) || [])[1];
      ok(cmp.bar != null && (cmp.bar === 0 ? !lu || +lu === 0 : +lu === cmp.bar), `${L}: period bar "${cmp.nm} time logged: ${cmp.bar}" matches the totals line "${cmp.line}"`);
      // History
      await p.click('#tabs [data-tab="history"]'); await p.waitForTimeout(800);
      const h = await p.evaluate(DAY => { const t = document.querySelector(`#histList table.grid[data-day="${DAY}"]`); const wk = [...document.querySelectorAll('#histList .weekh')].map(x => x.textContent).join(' | '); const cell = document.querySelector(`#wsHist [data-day="${DAY}"]`); return { tm: t && t.tFoot.querySelector('[data-tm]').textContent, lines: t ? [...t.tFoot.querySelectorAll('[data-tl] span')].map(s => s.textContent) : [], wk, cell: cell && cell.textContent, wst: (document.querySelector('#wsHist .wst') || {}).textContent }; }, DAY);
      ok(h.tm === '6 h 11' && h.lines[0] === 'Hospital 5 h 41 min · 23 units', `${L}: History day footer "${h.tm}" / ${h.lines.slice(0, 3).join(' / ')}`);
      ok(/Hospital \d+ h( \d+ min)? · \d+ units/.test(h.wk) && !/\bmin\/|\bCB\b| u ·/.test(h.wk), `${L}: History week header "${h.wk.slice(0, 90)}"`);
      ok(/6h11/.test(h.cell || '') && /\d+ h|\d+ min/.test(h.wst || ''), `${L}: week strip cell "${h.cell}" · "${(h.wst || '').trim()}"`);
      await p.screenshot({ path: path.join(OUT, 'totals-history-1280x800.png') });
      // CSV / Excel / reports
      const ex = await p.evaluate(DAY => { return Vault.loadAll().then(async all => { const t = BLR.table(all, DAY, DAY, Date.now(), all), mi = t.head.indexOf('minutes'), hi = t.head.indexOf('hours_minutes'); const r2 = t.rows.find(r => r[4] === 'Patient e2'); const md = await BLR.md(all, DAY, DAY, {}).text(); return { mi, hi, m: r2 && r2[mi], hm: r2 && r2[hi], md: (md.match(/\*\*Totals:\*\*[^\n]*/) || [''])[0], per: (r2 && r2[t.head.indexOf('time_periods')]) || '' }; }); }, DAY);
      ok(ex.hi === ex.mi + 1 && ex.m === 180 && ex.hm === '3:00', `${L}: CSV keeps minutes (${ex.m}) and adds hours_minutes (${ex.hm}) right after it`);
      ok(/Hospital 4 encounters, 5 h 41 min, 23 units · Clinic 1 encounter, 30 min, 2 units/.test(ex.md) && /^Evening 3 h · 12 units$/.test(ex.per), `${L}: report summary "${ex.md.slice(0, 120)}"; row periods "${ex.per}"`);
    }
    await p.context().close();
  }
  await cr.close(); await wk.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
