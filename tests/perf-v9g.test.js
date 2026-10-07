// v9g performance: the Today grid with 150 filled rows (plus blanks) and ~1,500 earlier entries in History (about 15 busy
// days at 100 patients) must stay smooth: typing latency, column auto-width, totals, saving, scrolling. 390 touch + 1280.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ node /workspace/medbilling-logs/tests/perf-v9g.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-perf-v9g';
const N_TODAY = +(process.env.N_TODAY || 150), N_PAST_DAYS = +(process.env.N_PAST_DAYS || 15), PER_DAY = 100;
// budgets (headless Chromium on the box is slower than an iPhone 13+ or a desktop; these are generous ceilings)
const KEY_P95 = +(process.env.KEY_P95 || 50), KEY_MAX = +(process.env.KEY_MAX || 120), SAVE_MS = +(process.env.SAVE_MS || 600), FRAME_P95 = +(process.env.FRAME_P95 || 34);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const pct = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', '48203917'); await p.fill('#sPass2', '48203917'); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500);
  // seed straight into the encrypted vault (same records the grid creates), then lock and unlock so the app loads them
  const t0 = Date.now();
  await p.evaluate(async ({ nT, nD, per }) => {
    const V = window.Vault, now = Date.now(), day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const codes = ['03.03A', '03.04A', '03.05JR', '13.99BA', '03.08A', '87.98A', '03.03B'], dxs = ['650', '644.21', 'V22.2', '626.2', '618.1', '642.4'];
    const mk = (i, s, e) => ({ id: 'seed-' + i, kind: 'enc', name: 'Patient ' + i + (i % 7 === 0 ? ' Fernández-Oyarzún de la Cruz' : ''), mrn: String(100000000 + i), chart: String(100000000 + i), label: '', initials: '', billingNote: i % 5 === 0 ? 'Seen in triage; NST reactive; follow-up in clinic next week.' : '', setting: i % 3 ? 'H' : 'C', facility: null, type: '',
      codes: [{ c: codes[i % codes.length], k: codes[i % codes.length], d: '', j: 'AB', f: '', dx: dxs[i % dxs.length] }].concat(i % 4 === 0 ? [{ c: '03.01AA', k: '03.01AA', d: '', j: 'AB', f: '' }] : []), notes: [], segs: [{ s, e }], status: 'done', photos: [], links: [], created: s, updated: s });
    const list = [];
    const start = Math.max(day0.getTime() + 60000, now - 14 * 3600000), span = Math.max(60000 * nT, now - start - 120000);
    for (let i = 0; i < nT; i++) { const s = start + Math.floor(i * span / nT); list.push(mk(i, s, Math.min(now - 60000, s + 4 * 60000))); }
    for (let d = 1; d <= nD; d++) for (let j = 0; j < per; j++) { const s = day0.getTime() - d * 86400000 + 7 * 3600000 + j * 5 * 60000; list.push(mk(100000 + d * 1000 + j, s, s + 4 * 60000)); }
    for (let i = 0; i < list.length; i += 50) await Promise.all(list.slice(i, i + 50).map(e => V.save(e)));
  }, { nT: N_TODAY, nD: N_PAST_DAYS, per: PER_DAY });
  await p.click('#lockNow'); await p.waitForSelector('#unlockForm:not([hidden])');
  await p.fill('#uPass', '48203917'); const tu = Date.now(); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked'));
  await p.waitForFunction(n => document.querySelectorAll('#todayList tbody tr[data-id]').length >= n, N_TODAY);
  const unlockMs = Date.now() - tu;
  console.log(`${label}: seeded ${N_TODAY} today + ${N_PAST_DAYS * PER_DAY} earlier in ${Date.now() - t0} ms; unlock → grid ready ${unlockMs} ms`);
  ok(unlockMs < 6000, `${label}: unlock with ${N_TODAY + N_PAST_DAYS * PER_DAY} entries shows the grid in ${unlockMs} ms (< 6000)`);
  await p.waitForTimeout(600);
  // Event Timing (input delay + handlers + next paint) and long tasks, collected in the page
  await p.evaluate(() => {
    window.__perf = { ev: [], lt: [] };
    try { new PerformanceObserver(l => l.getEntries().forEach(e => { if (/^(keydown|keypress|keyup|input|beforeinput|pointerdown|pointerup|click|touchstart|touchend)$/.test(e.name)) window.__perf.ev.push([e.name, e.duration]); })).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch (e) { /* not supported */ }
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__perf.lt.push(e.duration))).observe({ type: 'longtask' }); } catch (e) { /* not supported */ }
  });
  return p;
}
// latency per keystroke measured in the page: keydown → after the next frame is produced
async function typeLatency(p, text) {
  await p.evaluate(() => { window.__kl = []; window.__klOn = ev => { const t = performance.now(); requestAnimationFrame(() => setTimeout(() => window.__kl.push(performance.now() - t), 0)); }; document.addEventListener('keydown', window.__klOn, true); });
  for (const ch of text) { await p.keyboard.type(ch); await p.waitForTimeout(25); }
  await p.waitForTimeout(250);
  return p.evaluate(() => { document.removeEventListener('keydown', window.__klOn, true); return window.__kl; });
}
async function scrollJank(p, sel, dist, steps) {
  return p.evaluate(async ({ sel, dist, steps }) => {
    const w = document.querySelector(sel), gaps = []; let last = performance.now();
    for (let i = 0; i < steps; i++) { await new Promise(r => requestAnimationFrame(r)); const t = performance.now(); gaps.push(t - last); last = t; w.scrollTop += dist / steps; }
    return gaps.slice(1);
  }, { sel, dist, steps });
}
async function hit(p, sel, touch) {
  // scroll the cell to the middle of the grid, then tap a point of it that is not covered by the pinned header
  // or totals row
  const pt = await p.evaluate(sel => {
    const el = document.querySelector(sel); el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    for (const fy of [0.5, 0.3, 0.7]) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy, h = document.elementFromPoint(x, y); if (h && (h === el || el.contains(h))) return { x, y };
    }
    return null;
  }, sel);
  await p.waitForTimeout(80);
  if (!pt) { await p.focus(sel); return; }
  if (touch) await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y);
}
async function run(p, label, touch) {
  const rows = await p.evaluate(() => [document.querySelectorAll('#todayList tbody tr[data-id]').length, document.querySelectorAll('#todayList tbody tr[data-blank]').length]);
  ok(rows[0] === N_TODAY && rows[1] >= 15, `${label}: grid shows ${rows[0]} filled rows + ${rows[1]} blank rows`);
  const tm = await p.textContent(`${G} tfoot [data-tn]`); ok(new RegExp(`^${N_TODAY} encounters`).test(tm.trim()), `${label}: totals row counts ${tm.trim()}`);
  // 1. typing in a row near the bottom (long text → the name column grows and wraps)
  const r = Math.max(1, N_TODAY - 5);
  await hit(p, cell(r, 'note'), touch);
  let kl = await typeLatency(p, ' added more words for the billing note so it wraps');
  ok(pct(kl, 0.95) < KEY_P95 && Math.max(...kl) < KEY_MAX, `${label}: typing in the Billing notes editor on row ${r}: p50 ${pct(kl, 0.5).toFixed(1)} / p95 ${pct(kl, 0.95).toFixed(1)} / max ${Math.max(...kl).toFixed(1)} ms per key (budget p95 < ${KEY_P95}, max < ${KEY_MAX})`);
  const nt = await p.evaluate(() => performance.now()); await p.keyboard.press('Control+Enter');
  const noteMs = await p.evaluate(async ({ r, t }) => { const d = () => document.querySelector(`#todayList tbody tr:nth-child(${r}) .gc[data-c="note"]`); while (!/so it wraps$/.test(d().dataset.v) && performance.now() - t < 5000) await new Promise(x => setTimeout(x, 5)); return performance.now() - t; }, { r, t: nt });
  ok(noteMs < SAVE_MS && await p.isHidden('#noteEd'), `${label}: notes editor Done → cell updated in ${noteMs.toFixed(0)} ms`);
  await hit(p, cell(r, 'name'), touch);
  const w0 = await p.evaluate(() => Math.round(document.querySelector('#todayList thead [data-h="name"]').getBoundingClientRect().width));
  kl = await typeLatency(p, ' Maximiliano Fernández-Oyarzún de la Cruz y Mendoza');
  const w1 = await p.evaluate(() => Math.round(document.querySelector('#todayList thead [data-h="name"]').getBoundingClientRect().width));
  ok(pct(kl, 0.95) < KEY_P95 && Math.max(...kl) < KEY_MAX, `${label}: typing a long name (auto-width recalculation): p50 ${pct(kl, 0.5).toFixed(1)} / p95 ${pct(kl, 0.95).toFixed(1)} / max ${Math.max(...kl).toFixed(1)} ms per key`);
  ok(w1 >= w0, `${label}: name column width follows the text (${w0} → ${w1}px)`);
  // 2. save: Tab commits; the save lands and the totals row updates
  const ts = await p.evaluate(() => performance.now()); await p.keyboard.press('Tab');
  await p.waitForFunction(() => !document.querySelector('#todayList').dataset.busy, null, { timeout: 5000 }).catch(() => {});
  await hit(p, cell(2, 'tout'), touch);
  await p.keyboard.press('Control+A'); await p.keyboard.type('now');
  const before = await p.textContent(`${G} tfoot [data-tm]`);
  const t1 = await p.evaluate(() => performance.now()); await p.keyboard.press('Tab');
  const saveMs = await p.evaluate(async ({ before, t1 }) => { const tm = () => document.querySelector('#todayList tfoot [data-tm]').textContent; while (tm() === before && performance.now() - t1 < 5000) await new Promise(r => setTimeout(r, 5)); return performance.now() - t1; }, { before, t1 });
  ok(saveMs < SAVE_MS, `${label}: edit Out on row 2 → saved and totals updated in ${saveMs.toFixed(0)} ms (< ${SAVE_MS}); totals ${before} → ${await p.textContent(`${G} tfoot [data-tm]`)} min`);
  // 3. Tab through 20 cells: each move is instant
  const moves = []; for (let i = 0; i < 20; i++) { const a = await p.evaluate(() => performance.now()); await p.keyboard.press('Tab'); moves.push(await p.evaluate(a => new Promise(r => requestAnimationFrame(() => r(performance.now() - a))), a)); }
  ok(pct(moves, 0.95) < KEY_P95 * 2, `${label}: Tab moves p95 ${pct(moves, 0.95).toFixed(1)} ms`);
  await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(700);
  // 4. scrolling the grid
  await p.evaluate(() => { document.querySelector('#todayList .gwrap').scrollTop = 0; });
  const gaps = await scrollJank(p, '#todayList .gwrap', 150 * 32, 90);
  ok(pct(gaps, 0.95) < FRAME_P95, `${label}: scrolling 150 rows: frame p95 ${pct(gaps, 0.95).toFixed(1)} ms, max ${Math.max(...gaps).toFixed(1)} ms (budget p95 < ${FRAME_P95})`);
  const perf = await p.evaluate(() => window.__perf);
  const evd = perf.ev.map(e => e[1]);
  console.log(`${label}: Event Timing entries ≥16 ms: ${evd.length}${evd.length ? ` (p95 ${pct(evd, 0.95)} ms, max ${Math.max(...evd)} ms)` : ''}; long tasks: ${perf.lt.length}${perf.lt.length ? ` (max ${Math.max(...perf.lt).toFixed(0)} ms)` : ''}`);
  const bigLt = perf.lt.filter(d => d > 200); ok(bigLt.length === 0, `${label}: no long task over 200 ms while typing, saving and scrolling (${bigLt.map(d => d.toFixed(0)).join(', ') || 'none'})`);
  await p.screenshot({ path: path.join(OUT, `grid-150-${label}.png`) });
  // 5. History with ~1,500 entries opens and is usable
  const th = await p.evaluate(() => performance.now()); await p.click('#tabs [data-tab="history"]');
  await p.waitForSelector('#histList table.grid'); const hMs = await p.evaluate(t => new Promise(r => requestAnimationFrame(() => r(performance.now() - t))), th);
  ok(hMs < 2500, `${label}: History tab with ${N_PAST_DAYS * PER_DAY + N_TODAY} entries renders in ${hMs.toFixed(0)} ms (< 2500)`);
  // older days are drawn as they scroll near: scroll to the end and every day has its grid
  const lazy0 = await p.$$eval('#histList .gwrap[data-lazy]', l => l.length);
  const hj = await p.evaluate(async () => { const gaps = []; let last = performance.now(); for (let i = 0; i < 600; i++) { await new Promise(r => requestAnimationFrame(r)); const t = performance.now(); gaps.push(t - last); last = t; if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2 && !document.querySelector('#histList .gwrap[data-lazy]')) break; window.scrollBy(0, 250); } return gaps.slice(1); });
  await p.waitForTimeout(400);
  const hs = await p.evaluate(() => [document.querySelectorAll('#histList table.grid').length, document.querySelectorAll('#histList .gwrap[data-lazy]').length, document.querySelectorAll('#histList tbody tr[data-id]').length]);
  ok(hs[0] === N_PAST_DAYS + 1 && hs[1] === 0 && hs[2] === N_PAST_DAYS * PER_DAY + N_TODAY, `${label}: History draws older days as you scroll (${lazy0} waiting at first → ${hs[0]} day grids, ${hs[2]} rows; scroll frame p95 ${pct(hj, 0.95).toFixed(1)} ms)`);
  await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(300);
  // 6. v9h endless rows: grow the grid to 150 entries + 300 empty rows by scrolling, then type and save again
  for (let i = 0; i < 60 && (await p.evaluate(() => document.querySelectorAll('#todayList tbody tr').length)) < N_TODAY + 300; i++) { await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap'); w.scrollTop = w.scrollHeight; }); await p.waitForTimeout(40); }
  const big = await p.evaluate(() => [document.querySelectorAll('#todayList tbody tr').length, document.querySelectorAll('#todayList tbody tr[data-blank]').length]);
  ok(big[1] >= 300, `${label}: endless rows: grid grown to ${big[0]} rows (${big[1]} empty) by scrolling`);
  const gaps2 = await scrollJank(p, '#todayList .gwrap', -300 * 32, 90);
  ok(pct(gaps2, 0.95) < FRAME_P95, `${label}: scrolling ${big[0]} rows: frame p95 ${pct(gaps2, 0.95).toFixed(1)} ms`);
  await hit(p, cell(N_TODAY - 5, 'note'), touch);
  kl = await typeLatency(p, ' more words with hundreds of empty rows below'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(150);
  ok(pct(kl, 0.95) < KEY_P95 && Math.max(...kl) < KEY_MAX, `${label}: typing with ${big[0]} rows: p50 ${pct(kl, 0.5).toFixed(1)} / p95 ${pct(kl, 0.95).toFixed(1)} / max ${Math.max(...kl).toFixed(1)} ms per key`);
  const b2 = await p.textContent(`${G} tfoot [data-tn]`);
  await hit(p, cell(3, 'tout'), touch); await p.keyboard.press('Control+A'); await p.keyboard.type('now');
  const bm = await p.textContent(`${G} tfoot [data-tm]`), t2 = await p.evaluate(() => performance.now()); await p.keyboard.press('Tab');
  const save2 = await p.evaluate(async ({ bm, t2 }) => { const tm = () => document.querySelector('#todayList tfoot [data-tm]').textContent; while (tm() === bm && performance.now() - t2 < 5000) await new Promise(r => setTimeout(r, 5)); return performance.now() - t2; }, { bm, t2 });
  const after = await p.evaluate(() => [document.querySelectorAll('#todayList tbody tr').length, document.querySelector('#todayList tfoot [data-tn]').textContent]);
  ok(save2 < SAVE_MS && after[0] >= big[0] && after[1] === b2, `${label}: save with ${big[0]} rows → totals updated in ${save2.toFixed(0)} ms (< ${SAVE_MS}); rows kept (${after[0]}); count "${after[1].trim()}"`);
}
(async () => {
  const browser = await chromium.launch();
  const d = await setup(browser, { viewport: { width: 1280, height: 860 } }, '1280');
  await run(d, '1280', false);
  const m = await setup(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '390');
  await run(m, '390', true);
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
