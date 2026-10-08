// v9o: Today grid scrolling on iPhone-sized screens (WebKit + Chromium touch). One vertical scroller (the grid): the page never
// stays scrolled, the header row stays pinned at the top of the grid (and aligned when scrolling sideways), rows 1–5 can always be
// reached again, endless rows still add 10 at a time, and entries survive a reload. Synthetic patients only.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9o node /workspace/medbilling-logs/tests/scroll-v9o.test.js
const path = require('path'), fs = require('fs');
const { webkit, chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9o'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const W = '#todayList .gwrap.main', G = '#todayList table.grid';
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/^Refused to apply a stylesheet/.test(m.text())) errors.push(label + ': ' + m.text()); });   // Playwright WebKit's screenshot injects a stylesheet that the app's CSP refuses (test-only)
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async () => { const now = Date.now(); for (let i = 0; i < 5; i++) { const s = now - (6 - i) * 3600e3; await window.Vault.save({ id: 's' + i, kind: 'enc', name: 'Test Patient ' + 'ABCDE'[i], mrn: '00000000' + i, chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '' }], notes: [], segs: [{ s, e: s + 20 * 60e3 }], status: 'done', photos: [], links: [], created: s, updated: s }); } });
  await p.click('#lockNow'); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(500);
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 8000 }).catch(() => {});
  return p;
}
// which row numbers are actually visible (not under the pinned header row, not under the app bar / tabs)
const state = p => p.evaluate(([W, G]) => {
  const w = document.querySelector(W), t = w.querySelector('table.grid'), th = t.tHead.rows[0].cells[1], wr = w.getBoundingClientRect(), hr = th.getBoundingClientRect(), tabs = document.querySelector('#tabs').getBoundingClientRect();
  const x = wr.left + 12, vis = []; for (const tr of t.tBodies[0].rows) { const r = tr.getBoundingClientRect(); if (r.bottom <= hr.bottom + 2 || r.top >= wr.bottom - 30) continue; const el = document.elementFromPoint(x, Math.min(r.bottom - 3, wr.bottom - 31)); if (el && tr.contains(el)) vis.push(tr.sectionRowIndex + 1); }
  const hx = document.elementFromPoint(wr.left + wr.width / 2, hr.top + hr.height / 2);
  return { sy: Math.round(scrollY), st: Math.round(w.scrollTop), first: vis[0] || 0, last: vis[vis.length - 1] || 0, rows: t.tBodies[0].rows.length,
    headTop: Math.round(hr.top - wr.top), headShown: !!(hx && t.tHead.rows[0].contains(hx)), gridBelowTabs: wr.top >= tabs.bottom - 1, docFits: document.documentElement.scrollHeight <= innerHeight + 1 };
}, [W, G]);
const scrollRowTop = (p, n) => p.evaluate(([W, n]) => { const w = document.querySelector(W), tr = w.querySelector(`tbody tr:nth-child(${n})`), th = w.querySelector('thead tr'); w.scrollTop = tr.offsetTop - th.offsetHeight; }, [W, n]);
async function run(browser, engine, label, o) {
  const L = `${engine} ${label}`, p = await setup(browser, o, L);
  let s = await state(p); const rStart = s.rows;
  ok(s.first === 1 && s.headShown && s.gridBelowTabs && s.docFits, `${L}: start: header row + row 1 visible, grid starts below the tabs, page fits the screen (rows ${s.first}–${s.last})`);
  // the v9n trap: something scrolls the page (keyboard / scrollIntoView) — v9o puts it back and keeps the grid top in view
  await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(400); s = await state(p);
  ok(s.sy === 0 && s.first === 1 && s.headShown, `${L}: a page scroll (what trapped v9n) snaps back: scrollY ${s.sy}, header shown, row ${s.first} first`);
  // scroll the grid down so row 18 is at the top, then wheel back up to row 1
  await scrollRowTop(p, 18); await p.waitForTimeout(250); s = await state(p);
  ok(s.first >= 17 && s.first <= 19 && s.headShown && s.headTop <= 1, `${L}: scrolled to row ${s.first}: header row still pinned at the top of the grid (offset ${s.headTop}px)`);
  await p.screenshot({ path: path.join(OUT, `scroll-${engine}-${label}-row18.png`), caret: 'initial' });   // caret:'initial' — Playwright's caret-hiding style is (rightly) refused by the app's CSP
  const b = await p.locator(W).boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  // mobile WebKit has no wheel / touch-scroll driver in Playwright: scroll the grid up in finger-sized steps
  const up = async dy => engine === 'webkit' ? p.evaluate(([W, dy]) => document.querySelector(W).scrollBy(0, dy), [W, dy]) : p.mouse.wheel(0, dy);
  for (let i = 0; i < 12 && (await state(p)).first !== 1; i++) { await up(-250); await p.waitForTimeout(150); const m = await state(p); if (!m.headShown) { s = m; break; } }
  s = await state(p);
  ok(s.first === 1 && s.st === 0 && s.sy === 0 && s.headShown, `${L}: scrolling up from row 18 reaches row 1 again, header shown all the way (scrollTop ${s.st}, page ${s.sy})`);
  // touch drags (Chromium: real touch scroll gestures through CDP)
  if (engine === 'chromium') {
    const cdp = await p.context().newCDPSession(p);
    // real touch drags (finger moves dy px; negative = finger up = scroll down)
    const drag = async (dx, dy) => { const x0 = Math.round(b.x + b.width / 2), y0 = Math.round(b.y + b.height / 2), n = 15, T = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await T('touchStart', x0, y0); for (let i = 1; i <= n; i++) await T('touchMove', Math.round(x0 + dx * i / n), Math.round(y0 + dy * i / n)); await T('touchEnd'); await p.waitForTimeout(300); };
    const swipe = dy => drag(0, dy);
    for (let i = 0; i < 6 && (await state(p)).first < 18; i++) await swipe(-300);
    const down = await state(p);
    for (let i = 0; i < 12 && (await state(p)).first !== 1; i++) await swipe(300);
    s = await state(p);
    ok(down.first >= 18 && s.first === 1 && s.sy === 0 && s.headShown, `${L}: touch: dragged down to row ${down.first} (header shown ${down.headShown}), dragged back up to row ${s.first} (page ${s.sy})`);
    // horizontal touch drag: header cells stay over their columns
    await drag(-150, 0);
  } else {
    await p.evaluate(([W]) => document.querySelector(W).scrollBy(300, 0), [W]); await p.waitForTimeout(250);
  }
  const al = await p.evaluate(([W]) => { const w = document.querySelector(W), ths = [...w.querySelectorAll('thead th')], tds = [...w.querySelector('tbody tr').children]; return { sl: Math.round(w.scrollLeft), worst: Math.max(...ths.map((h, i) => tds[i] ? Math.abs(h.getBoundingClientRect().left - tds[i].getBoundingClientRect().left) : 0)) }; }, [W]);
  s = await state(p);
  ok(al.sl > 0 && al.worst <= 1 && s.headShown, `${L}: scrolled sideways ${al.sl}px: header cells stay aligned with their columns (worst ${al.worst.toFixed ? al.worst.toFixed(1) : al.worst}px)`);
  await p.evaluate(([W]) => { document.querySelector(W).scrollLeft = 0; }, [W]);
  // endless rows: scrolling near the end adds 10 rows; past the footer, wheel adds 10 more
  const r0 = s.rows; await p.evaluate(([W]) => { const w = document.querySelector(W); w.scrollTop = w.scrollHeight; }, [W]); await p.waitForTimeout(400); s = await state(p);
  ok((s.rows >= r0 + 10 || s.rows === rStart + 30) && (s.rows - rStart) % 10 === 0, `${L}: scrolling down adds empty rows 10 at a time, up to 30 by scrolling alone (${rStart} → ${r0} → ${s.rows})`);
  for (let i = 0; i < 6; i++) { await p.evaluate(([W]) => { const w = document.querySelector(W); w.scrollTop = w.scrollHeight; }, [W]); await p.waitForTimeout(250); }
  const r1 = (await state(p)).rows; await p.waitForTimeout(400);
  if (engine === 'webkit') await p.evaluate(([W]) => { const w = document.querySelector(W), r = w.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (type, yy) => { const e = new Event(type, { bubbles: true }); Object.defineProperty(e, 'touches', { value: yy == null ? [] : [{ identifier: 1, target: w, clientX: x, clientY: yy }] }); return e; };   // WebKit here has no Touch constructor
      w.dispatchEvent(ev('touchstart', y)); w.dispatchEvent(ev('touchmove', y - 80)); w.dispatchEvent(ev('touchend')); }, [W]);
  else { const cdp = await p.context().newCDPSession(p), x0 = Math.round(b.x + b.width / 2), y0 = Math.round(b.y + b.height / 2), T = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: x0, y }] });
    await T('touchStart', y0); for (let i = 1; i <= 10; i++) await T('touchMove', y0 - i * 12); await T('touchEnd'); }
  await p.waitForTimeout(400); s = await state(p);
  ok(s.rows === r1 + 10, `${L}: at the footer, dragging on adds 10 more rows (${r1} → ${s.rows})`);
  // back to the top after all that
  await p.evaluate(([W]) => { document.querySelector(W).scrollTop = 0; }, [W]); await p.waitForTimeout(200); s = await state(p);
  ok(s.first === 1 && s.headShown && s.sy === 0, `${L}: back at row 1 with the header after growing to ${s.rows} rows`);
  // add a 6th entry by typing (tap on a phone), reload, unlock: nothing lost
  const nm = `${G} tbody tr:nth-child(6) td.c-name`;
  if (o.hasTouch) await p.locator(nm).tap(); else await p.locator(nm).click(); await p.waitForTimeout(200);
  await p.keyboard.type('Test Patient F'); await p.keyboard.press('Tab'); await p.keyboard.type('000000009'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(300);
  s = await state(p); ok(s.sy === 0 && s.headShown, `${L}: after typing a row the page is not left scrolled (scrollY ${s.sy}) and the header shows`);
  await p.screenshot({ path: path.join(OUT, `scroll-${engine}-${label}-row1.png`), caret: 'initial' });
  await p.reload(); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(500);
  const names = await p.evaluate(([G]) => [...document.querySelectorAll(`${G} tbody tr[data-id]`)].map(tr => { const c = tr.querySelector('td.c-name'), i = c.querySelector('input,textarea,.gc'); return ((i && (i.value != null ? i.value : i.textContent)) || c.textContent).trim(); }), [G]);
  ok(['A', 'B', 'C', 'D', 'E', 'F'].every(x => names.includes('Test Patient ' + x)) && names.length === 6, `${L}: after reload + unlock all 6 entries are there (${names.join(', ')})`);
  await p.context().close();
}
(async () => {
  const wk = await webkit.launch(), cr = await chromium.launch();
  for (const [engine, br] of [['webkit', wk], ['chromium', cr]]) {
    await run(br, engine, '402x874', { viewport: { width: 402, height: 874 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await run(br, engine, '375x667', { viewport: { width: 375, height: 667 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  }
  await wk.close(); await cr.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
