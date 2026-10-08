// v9p: Undo / Redo on the Today grid. Every change type, keyboard shortcuts (without breaking text-field undo), per-day
// history, 50+ steps, encrypted persistence across lock / reload, deleted rows restored whole (dxx, units, facility) in place,
// no data loss (entries + audit chain), and the buttons reachable on iPhone sizes (Chromium touch + WebKit). Synthetic data only.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9p node /workspace/medbilling-logs/tests/undo-v9p.test.js
const path = require('path'), fs = require('fs');
const { chromium, webkit } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9p'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const settle = p => p.waitForTimeout(600);
const val = (p, r, c) => p.evaluate(s => { const el = document.querySelector(s); return el ? (el.dataset.v != null && el.classList.contains('fpv') ? el.dataset.v : el.value) : null; }, cell(r, c));
const chip = (p, r) => p.evaluate(s => { const b = document.querySelector(s); return b ? b.textContent.trim() : ''; }, `${G} tbody tr:nth-child(${r}) td.c-mod1 .mub`);
const toastTxt = p => p.textContent('#toast');
const names = p => p.evaluate(G => [...document.querySelectorAll(`${G} tbody tr[data-id]`)].map(tr => tr.querySelector('.gc[data-c="name"]').value), G);
const fpkOpen = p => p.waitForSelector('#fpk[open]');
const fpkShut = p => p.waitForFunction(() => !document.querySelector('#fpk').open);
const btn = (p, id) => p.evaluate(id => { const b = document.getElementById(id); return { dis: b.disabled, title: b.title }; }, id);
const undoBtn = async p => { await p.click('#gUndo'); await settle(p); };
const redoBtn = async p => { await p.click('#gRedo'); await settle(p); };
const ent = (p, id) => p.evaluate(async id => { const e = (await Vault.loadAll()).find(x => x.id === id); if (!e) return null; const c = JSON.parse(JSON.stringify(e)); delete c.updated; return c; }, id);
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600); }
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/^Refused to apply a stylesheet/.test(m.text())) errors.push(label + ': ' + m.text()); });
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async () => { const now = Date.now(); const mk = (i, x) => Object.assign({ id: 'u' + i, kind: 'enc', name: 'Patient ' + 'ABC'[i], mrn: '00000000' + i, chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], notes: [], segs: [{ s: now - (4 - i) * 3600e3, e: now - (4 - i) * 3600e3 + 20 * 60e3 }], status: 'done', photos: [], links: [], created: now - 5 * 3600e3, updated: now - 5 * 3600e3 }, x);
    await Vault.save(mk(0)); await Vault.save(mk(1, { billingNote: 'Seen in triage', dxx: ['V22.1', 'V22.2'], mods: ['TEV', ''], modU: { TEV: 4 } })); await Vault.save(mk(2)); });
  await p.click('#lockNow'); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400);
  return p;
}
(async () => {
  const cr = await chromium.launch(), wk = await webkit.launch();
  // ================= desktop 1280x800: every action type
  {
    const L = '1280', p = await setup(cr, { viewport: { width: 1280, height: 800 } }, L);
    ok((await btn(p, 'gUndo')).dis && (await btn(p, 'gRedo')).dis, `${L}: Undo / Redo start disabled (nothing done yet today)`);
    // 1. typing over a cell
    await p.click(cell(1, 'name')); await p.keyboard.press('Control+a'); await p.keyboard.type('Changed Name'); await p.keyboard.press('Enter'); await settle(p);
    ok(await val(p, 1, 'name') === 'Changed Name' && /Undo: Patient name/.test((await btn(p, 'gUndo')).title), `${L}: typed over Patient name; Undo title "${(await btn(p, 'gUndo')).title}"`);
    await undoBtn(p);
    ok(await val(p, 1, 'name') === 'Patient A' && /^Undone: Patient name/.test(await toastTxt(p)), `${L}: Undo button → name back; toast "${await toastTxt(p)}"`);
    await redoBtn(p); ok(await val(p, 1, 'name') === 'Changed Name' && /^Redone: /.test(await toastTxt(p)), `${L}: Redo → "Changed Name" again; toast "${await toastTxt(p)}"`);
    await p.screenshot({ path: path.join(OUT, 'undo-redo-1280x800.png') });
    // 2. clearing a cell, undone with Ctrl+Z (cell selected, not being typed in)
    await p.click(cell(1, 'fee')); await p.keyboard.press('Control+a'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter'); await settle(p);
    const feeCleared = await val(p, 1, 'fee');
    await p.click(cell(1, 'mrn')); await p.waitForTimeout(100); await p.keyboard.press('Control+z'); await settle(p);
    ok(feeCleared === '' && await val(p, 1, 'fee') === '03.03A', `${L}: cleared Fee code(s) ("${feeCleared}") → Ctrl+Z brings back "${await val(p, 1, 'fee')}"`);
    await p.keyboard.press('Control+Shift+z'); await settle(p); ok(await val(p, 1, 'fee') === '', `${L}: Shift+Ctrl+Z redoes the clear`);
    await p.keyboard.press('Control+y'); await settle(p); ok(/Nothing to redo/.test(await toastTxt(p)), `${L}: Ctrl+Y with nothing left: "${await toastTxt(p)}"`);
    await p.keyboard.press('Control+z'); await settle(p); ok(await val(p, 1, 'fee') === '03.03A', `${L}: Ctrl+Z again → fee back`);
    // 3. typing inside a cell: Ctrl+Z is the text field's own undo, not the app's
    const before3 = (await btn(p, 'gUndo')).title;
    await p.click(cell(3, 'mrn')); await p.keyboard.press('End'); await p.keyboard.type('77'); await p.keyboard.press('Control+z'); await p.waitForTimeout(400);
    const mid = await p.evaluate(s => document.activeElement === document.querySelector(s), cell(3, 'mrn'));
    ok(mid && (await btn(p, 'gUndo')).title === before3 && await val(p, 1, 'fee') === '03.03A', `${L}: Ctrl+Z while typing in a cell stays in the text field (app history untouched, cursor still in the cell)`);
    await p.keyboard.press('Escape'); await settle(p);
    // 4. facility pick
    await p.click(cell(1, 'fno')); await fpkOpen(p); await p.keyboard.type('394'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
    const fno = await val(p, 1, 'fno'); await undoBtn(p); const fno0 = await val(p, 1, 'fno'); await redoBtn(p);
    ok(fno === '394' && fno0 === '' && await val(p, 1, 'fno') === '394', `${L}: facility pick 394 → Undo "${fno0}" → Redo "${await val(p, 1, 'fno')}"`);
    // 5. functional centre pick
    await p.click(cell(1, 'fcen')); await fpkOpen(p); await p.keyboard.type('emrg'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
    const fc = await val(p, 1, 'fcen'); await undoBtn(p); const fc0 = await val(p, 1, 'fcen'); await redoBtn(p);
    ok(fc === 'EMRG' && fc0 === '' && await val(p, 1, 'fcen') === 'EMRG', `${L}: functional centre EMRG → Undo "${fc0}" → Redo "${await val(p, 1, 'fcen')}"`);
    // 6. time-unit modifier with units (typed TEV04), then a units change in the 01–20 picker
    await p.click(cell(1, 'mod1')); await p.keyboard.type('TEV04'); await p.keyboard.press('Enter'); await settle(p);
    const m1 = [await val(p, 1, 'mod1'), await chip(p, 1)];
    await p.click(`${G} tbody tr:nth-child(1) td.c-mod1 .mub`); await fpkOpen(p); await p.keyboard.type('6'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await fpkShut(p); await settle(p);
    const m2 = await chip(p, 1); await undoBtn(p); const m3 = await chip(p, 1); await undoBtn(p); const m4 = [await val(p, 1, 'mod1'), await chip(p, 1)];
    ok(m1[0] === 'TEV' && m1[1] === '×04' && m2 === '×06' && m3 === '×04' && m4[0] === '' && !/×/.test(m4[1]), `${L}: units: TEV ×04 → picker ×06 → Undo ×04 → Undo removes TEV (${JSON.stringify([m1, m2, m3, m4])})`);
    await redoBtn(p); await redoBtn(p); ok(await chip(p, 1) === '×06', `${L}: Redo ×2 → TEV ×06 again`);
    // 7. row delete → Undo restores it whole, in its place
    const snapB = await ent(p, 'u1'), order0 = await names(p);
    await p.click(`${G} tbody tr:nth-child(2) .rmore`); await p.waitForSelector('#rowMenu[open]'); await p.click('#rowMenu [data-rmi="del"]'); await p.waitForSelector('#askDlg[open]'); await p.click('#askOk'); await settle(p);
    const order1 = await names(p);
    await p.evaluate(() => { const s = document.querySelector('#snackUndo'); if (s) document.querySelector('#snack').classList.remove('show'); });
    await undoBtn(p);
    const order2 = await names(p), back = await ent(p, 'u1');
    ok(order1.length === order0.length - 1 && JSON.stringify(order2) === JSON.stringify(order0), `${L}: deleted row 2 (${order1.join(', ')}) → Undo puts it back in place (${order2.join(', ')}); toast "${await toastTxt(p)}"`);
    ok(JSON.stringify(back) === JSON.stringify(snapB) && back.dxx && back.dxx.length === 2 && back.modU && back.modU.TEV === 4, `${L}: the restored row is identical to before (billing note, Dx extras ${JSON.stringify(back && back.dxx)}, units ${JSON.stringify(back && back.modU)})`);
    await redoBtn(p); ok((await names(p)).length === order0.length - 1 && !(await ent(p, 'u1')), `${L}: Redo deletes it again`);
    await undoBtn(p); ok((await names(p)).length === order0.length, `${L}: Undo brings it back again`);
    // 8. per-day history: another day has its own (empty) history
    await p.click('#dPrev'); await p.waitForTimeout(500);
    const yd = await btn(p, 'gUndo');
    await p.click('#dToday').catch(async () => { await p.click('#dNext'); }); await p.waitForTimeout(500);
    ok(yd.dis && !(await btn(p, 'gUndo')).dis, `${L}: yesterday's sheet has its own history (Undo off there), today's is kept`);
    // 9. persistence: encrypted at rest, survives lock / unlock and a reload
    const rec = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('bl-vault'); r.onsuccess = () => { try { const t = r.result.transaction('meta').objectStore('meta').get('undo'); const b2s = v => v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? String.fromCharCode(...new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)) : v; t.onsuccess = () => { r.result.close(); res(t.result ? JSON.stringify(t.result, (k, v) => b2s(v)) : null); }; t.onerror = () => res('ERR'); } catch (e) { res('ERR ' + e.message); } }; r.onerror = () => res('ERR'); }));
    ok(rec && !/Patient|Changed Name|Seen in triage|TEV/.test(rec) && /"ct"/.test(rec), `${L}: history stored encrypted in the vault (${rec ? rec.length : 0} bytes, no plain text)`);
    const t0 = (await btn(p, 'gUndo')).title;
    await p.click('#lockNow'); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(300);
    ok((await btn(p, 'gUndo')).title === t0 && !(await btn(p, 'gUndo')).dis, `${L}: after lock / unlock the history is still there ("${t0}")`);
    await p.reload(); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(300);
    await undoBtn(p); ok(await chip(p, 1) === '×04', `${L}: after a reload (app relaunch) Undo still works (units back to ${await chip(p, 1)})`);
    await redoBtn(p); ok(await chip(p, 1) === '×06', `${L}: and Redo (${await chip(p, 1)})`);
    // 10. Fee Desk pick-and-return (fee + Dx + modifier in one go) is one step
    await p.evaluate(() => { window.__u = ''; window.open = u => { window.__u = u; return {}; }; });
    await p.click(cell(3, 'fee')); await p.locator(`${G} tbody tr:nth-child(3) .pickfd[data-kind="fee"]:not(.fdmini)`).evaluate(b => b.click()); await p.waitForTimeout(300);
    const tok = new (require('url').URL)(await p.evaluate(() => window.__u)).searchParams.get('ctx');
    await p.goto(URL + `?pickv=2&ctx=${tok}&fee=03.04A&dx=V22.2&mod=CMGP`); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(800);
    const pk = [await val(p, 3, 'fee'), await val(p, 3, 'dx'), await val(p, 3, 'mod2') + '|' + await val(p, 3, 'mod1')];
    await undoBtn(p); const pk0 = [await val(p, 3, 'fee'), await val(p, 3, 'dx'), await val(p, 3, 'mod2') + '|' + await val(p, 3, 'mod1')];
    await redoBtn(p); const pk1 = [await val(p, 3, 'fee'), await val(p, 3, 'dx')];
    ok(/03\.04A/.test(pk[0]) && /V22\.2/.test(pk[1]) && /CMGP/.test(pk[2]) && pk0[0] === '03.03A' && pk0[1] === '650' && !/CMGP/.test(pk0[2]) && /03\.04A/.test(pk1[0]), `${L}: Fee Desk pick ${JSON.stringify(pk)} → one Undo ${JSON.stringify(pk0)} → Redo ${JSON.stringify(pk1)}`);
    // 11. 50+ steps
    for (let i = 1; i <= 55; i++) { await p.click(cell(3, 'name')); await p.keyboard.press('Control+a'); await p.keyboard.type('Step ' + i); await p.keyboard.press('Enter'); await p.waitForTimeout(220); }
    await p.waitForTimeout(500); const s55 = await val(p, 3, 'name');
    await p.click(cell(2, 'mrn')); for (let i = 0; i < 50; i++) { await p.keyboard.press('Control+z'); await p.waitForTimeout(90); }
    await p.waitForTimeout(1500);
    ok(s55 === 'Step 55' && await val(p, 3, 'name') === 'Step 5', `${L}: 55 edits, 50 × Ctrl+Z → "${await val(p, 3, 'name')}" (expected "Step 5")`);
    for (let i = 0; i < 50; i++) { await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(90); } await p.waitForTimeout(1500);
    ok(await val(p, 3, 'name') === 'Step 55', `${L}: 50 × redo → "${await val(p, 3, 'name')}"`);
    // 11b. passcode change keeps the (re-encrypted) history
    const rk = await p.evaluate(async pin => { const before = JSON.stringify(await Vault.loadUndo()); const okk = await Vault.rekey(pin, '59183746', 'pin'); const after = JSON.stringify(await Vault.loadUndo()); await Vault.rekey('59183746', pin, 'pin'); return { okk, same: before === after && before.length > 100 }; }, PIN);
    ok(rk.okk && rk.same, `${L}: changing the passcode re-encrypts the undo history (still readable, unchanged)`);
    // 12. no data loss: entries all there, audit chain intact
    const fin = await p.evaluate(async () => ({ n: (await Vault.loadAll()).length, audit: await Vault.verifyAudit().catch(e => ({ ok: false, err: e.message })) }));
    ok(fin.n === 3 && fin.audit && (fin.audit.ok !== false), `${L}: no data lost: ${fin.n} entries; audit chain ${JSON.stringify(fin.audit).slice(0, 80)}`);
    await p.context().close();
  }
  // ================= iPhone sizes: buttons on screen, 44 pt tap target, grid not shorter, tap undo works
  for (const [engine, br] of [['chromium', cr], ['webkit', wk]]) for (const [w, h] of [[402, 874], [375, 667]]) {
    const L = `${engine} ${w}x${h}`, p = await setup(br, { viewport: { width: w, height: h }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, L);
    const g = await p.evaluate(() => { const u = document.querySelector('#gUndo').getBoundingClientRect(), r = document.querySelector('#gRedo').getBoundingClientRect(), tabs = document.querySelector('#tabs').getBoundingClientRect(), grid = document.querySelector('#todayList .gwrap').getBoundingClientRect();
      const hit = (b, x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el === b || b.contains(el)); }, U = document.querySelector('#gUndo'), Rr = document.querySelector('#gRedo');
      const cx = u.left + u.width / 2, cy = u.top + u.height / 2, rx = r.left + r.width / 2;
      return { u: [u.left, u.top, u.width, u.height].map(Math.round), r: [r.left, r.top, r.width, r.height].map(Math.round), inView: u.top >= tabs.bottom && u.bottom <= innerHeight && r.right <= innerWidth, gridTop: Math.round(grid.top),
        tap44: hit(U, cx, cy - 21.5) && hit(U, cx, cy + 21.5) && hit(U, cx - 21.5, cy) && hit(Rr, rx, cy - 21.5) && hit(Rr, rx, cy + 21.5) && hit(Rr, rx + 21.5, cy), miss: [[cx, cy - 21.5], [cx, cy + 21.5], [cx - 21.5, cy], [rx, cy - 21.5], [rx + 21.5, cy]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; }), docFits: document.documentElement.scrollHeight <= innerHeight + 1 }; });
    const want = w === 402 ? 244 : 281;
    ok(g.inView && g.docFits, `${L}: Undo ${JSON.stringify(g.u)} / Redo ${JSON.stringify(g.r)} on screen below the tabs, no scrolling needed`);
    ok(g.tap44, `${L}: each button answers taps across a 44 × 44 pt area` + (g.tap44 ? '' : ' ' + JSON.stringify(g.miss)));
    ok(g.gridTop === want, `${L}: grid still starts at ${g.gridTop}px (v9o: ${want}px) — no grid space taken`);
    await p.locator(cell(1, 'name')).tap(); await p.waitForTimeout(150); await p.keyboard.press('End'); await p.keyboard.type(' X'); await p.keyboard.press('Enter'); await settle(p);
    await p.evaluate(() => document.activeElement && document.activeElement.blur()); await settle(p);
    const v1 = await val(p, 1, 'name'); await p.locator('#gUndo').tap(); await settle(p);
    ok(v1 === 'Patient A X' && await val(p, 1, 'name') === 'Patient A' && /^Undone/.test(await toastTxt(p)), `${L}: tap Undo → "${await val(p, 1, 'name')}" (was "${v1}"); toast "${await toastTxt(p)}"`);
    if (w === 402 && engine === 'chromium') await p.screenshot({ path: path.join(OUT, 'undo-redo-402x874.png') });
    if (w === 402 && engine === 'webkit') await p.screenshot({ path: path.join(OUT, 'undo-redo-402x874-webkit.png'), caret: 'initial' });
    await p.locator('#gRedo').tap(); await settle(p); ok(await val(p, 1, 'name') === 'Patient A X', `${L}: tap Redo → "${await val(p, 1, 'name')}"`);
    await p.context().close();
  }
  await cr.close(); await wk.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
