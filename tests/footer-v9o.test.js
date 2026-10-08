// v9o: on Today the grid reaches the bottom of the screen; the footer (units note, disclaimers, links, manual, studio line)
// sits inside the grid's scroll area after the last row, so it shows only after scrolling past the rows. Endless rows keep working.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9o node /workspace/medbilling-logs/tests/footer-v9o.test.js
const path = require('path'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9o'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(500); }
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); }); p.on('pageerror', e => errors.push(label + ': ' + e.message));
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async () => { const now = Date.now(); for (let i = 0; i < 4; i++) { const s = now - (5 - i) * 3600e3; await window.Vault.save({ id: 'f' + i, kind: 'enc', name: 'Patient ' + (i + 1), mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '' }], notes: [], segs: [{ s, e: s + 20 * 60e3 }], status: 'done', photos: [], links: [], created: s, updated: s }); } });
  await p.click('#lockNow'); await unlock(p);
  return p;
}
const geo = p => p.evaluate(() => {
  const w = document.querySelector('#todayList .gwrap.main'), f = document.querySelector('footer.foot'), tabs = document.querySelector('#tabs'), tb = w.querySelector('table.grid tbody');
  const wr = w.getBoundingClientRect(), fr = f.getBoundingClientRect(), last = tb.rows[tb.rows.length - 1].getBoundingClientRect();
  return { ih: innerHeight, docH: document.documentElement.scrollHeight, sy: scrollY, wTop: Math.round(wr.top), wBot: Math.round(wr.bottom), tabsBot: Math.round(tabs.getBoundingClientRect().bottom),
    inGrid: !!f.closest('#todayList .gwrap.main'), fTop: Math.round(fr.top), fBot: Math.round(fr.bottom), lastBot: Math.round(last.bottom), rows: tb.rows.length,
    fVisibleInGrid: fr.top < wr.bottom - 20 && fr.bottom > wr.top, txt: f.innerText, fW: Math.round(fr.width), wW: Math.round(w.clientWidth), st: w.scrollTop, sh: w.scrollHeight, ch: w.clientHeight };
});
async function run(browser, label, o) {
  const p = await setup(browser, o, label);
  await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(600);
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 8000 }).catch(() => {});
  let g = await geo(p);
  ok(g.inGrid, `${label}: footer lives inside the Today grid's scroll area`);
  ok(g.wBot >= g.ih - 40 && g.wBot <= g.ih, `${label}: grid fills to the bottom of the screen (grid bottom ${g.wBot} of ${g.ih}px)`);
  ok(g.docH <= g.ih + 1, `${label}: the page itself does not scroll (page ${g.docH}px, screen ${g.ih}px), so nothing sits below the grid`);
  ok(!g.fVisibleInGrid && g.fTop >= g.wBot, `${label}: footer not visible before scrolling (footer top ${g.fTop}, grid bottom ${g.wBot})`);
  await p.screenshot({ path: path.join(OUT, `footer-${label}-top.png`) });
  // scroll down the grid: scroll alone adds at most 30 rows, then the footer shows after the last row
  const r0 = g.rows; let r1 = r0;
  for (let i = 0; i < 8; i++) { await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main'); w.scrollTop = w.scrollHeight; }); await p.waitForTimeout(250); }
  g = await geo(p); r1 = g.rows;
  ok(r1 >= r0 + 30 && r1 <= r0 + 30, `${label}: scrolling still adds empty rows (${r0} → ${r1}), then stops so the footer can be reached`);
  ok(g.fVisibleInGrid && g.fTop >= g.lastBot - 1, `${label}: after scrolling past the last row the footer shows below it (last row bottom ${g.lastBot}, footer ${g.fTop}–${g.fBot})`);
  ok(g.fBot <= g.wBot + 1, `${label}: the whole footer can be scrolled into view (footer bottom ${g.fBot}, grid bottom ${g.wBot})`);
  const need = ['Time log only', 'Passcode-locked and encrypted', 'MedBilling Fee Desk', 'Help / User manual', "Part of JFdeLara's Studio", '© 2026 MedBilling Logs', 'unit'];
  ok(need.every(s => g.txt.includes(s)), `${label}: all footer text kept (${need.filter(s => !g.txt.includes(s)).join(', ') || 'all present'})`);
  ok(Math.abs(g.fW - Math.min(g.wW, 760)) <= 24 || g.fW <= g.wW, `${label}: footer fits the visible grid width (${g.fW} / ${g.wW}px)`);
  await p.screenshot({ path: path.join(OUT, `footer-${label}-scrolled.png`) });
  // keep scrolling past the footer (wheel / drag): 10 more rows each time, footer follows
  { const b = await p.locator('#todayList .gwrap.main').boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 3); }
  await p.waitForTimeout(400); await p.mouse.wheel(0, 300); await p.waitForTimeout(300);
  let g2 = await geo(p);
  ok(g2.rows === r1 + 10 && g2.inGrid, `${label}: scrolling on past the footer adds 10 more rows (${r1} → ${g2.rows}), footer after them`);
  if (o.hasTouch) {
    await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main'); w.scrollTop = w.scrollHeight; }); await p.waitForTimeout(450);
    const n0 = (await geo(p)).rows;
    await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main'), r = w.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const T = yy => new Touch({ identifier: 1, target: w, clientX: x, clientY: yy });
      w.dispatchEvent(new TouchEvent('touchstart', { touches: [T(y)], bubbles: true })); w.dispatchEvent(new TouchEvent('touchmove', { touches: [T(y - 80)], bubbles: true })); w.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true })); });
    await p.waitForTimeout(200); g2 = await geo(p); if (process.env.DBG) console.log(await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main'); return [w.scrollTop, w.clientHeight, w.scrollHeight, typeof Touch]; }));
    ok(g2.rows === n0 + 10, `${label}: dragging up at the end on a phone adds 10 more rows (${n0} → ${g2.rows})`);
  }
  r1 = g2.rows;
  // horizontal scroll: the footer stays in view (sticky left)
  await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main'); w.scrollLeft = w.scrollWidth; }); await p.waitForTimeout(150);
  const fx = await p.evaluate(() => { const w = document.querySelector('#todayList .gwrap.main').getBoundingClientRect(), f = document.querySelector('.gfoot').getBoundingClientRect(); return [Math.round(f.left - w.left), Math.round(f.right - w.right)]; });
  ok(Math.abs(fx[0]) <= 2 && fx[1] <= 2, `${label}: footer stays put when the grid scrolls sideways (left offset ${fx[0]}, right ${fx[1]})`);
  await p.evaluate(() => { document.querySelector('#todayList .gwrap.main').scrollLeft = 0; });
  // the cursor near the end keeps adding rows; the footer moves down with them
  const lastName = `${G} tbody tr:nth-child(${r1 - 1}) td.c-name`;
  await p.locator(lastName).scrollIntoViewIfNeeded(); await p.locator(lastName).click(); await p.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(120); }
  g = await geo(p);
  ok(g.rows > r1 && g.fTop >= g.lastBot - 1 && g.inGrid, `${label}: Enter near the end still adds rows (${r1} → ${g.rows}); footer stays after the last row`);
  await p.keyboard.press('Escape');
  // other tabs: footer back under the page; Today again: inside the grid
  await p.click('#tabs [data-tab="history"]'); await p.waitForTimeout(300);
  const hist = await p.evaluate(() => { const f = document.querySelector('footer.foot'); return { home: f.previousElementSibling && f.previousElementSibling.id === 'main', vis: f.offsetParent !== null }; });
  ok(hist.home && hist.vis, `${label}: on History the footer is at the end of the page as before`);
  await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400);
  ok((await geo(p)).inGrid, `${label}: back on Today the footer is inside the grid again`);
  await p.click('#lockNow'); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400);
  g = await geo(p);
  ok(g.inGrid && g.txt.includes('Time log only') && g.docH <= g.ih + 1, `${label}: after lock / unlock the footer is still there and the page still fits the screen`);
  await p.context().close();
}
(async () => {
  const browser = await chromium.launch();
  await run(browser, '402x874', { viewport: { width: 402, height: 874 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await run(browser, '375x667', { viewport: { width: 375, height: 667 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await run(browser, '1280x800', { viewport: { width: 1280, height: 800 } });
  await browser.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
