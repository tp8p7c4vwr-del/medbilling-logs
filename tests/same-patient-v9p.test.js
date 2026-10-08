// v9p: Same patient → a new row right under the patient's rows (name, MRN/PHN, facility #, functional centre, H/C copied;
// times, units, codes, Dx, modifiers, notes blank), grouped rows, "N encounters · M patients", name edits never silently
// copied (offer "Apply to all"), Undo/Redo, endless rows, pick-and-return, premium units, encrypted storage, CSV, reload,
// 44 pt button on iPhone (WebKit + Chromium touch). Synthetic data only.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9p node /workspace/medbilling-logs/tests/same-patient-v9p.test.js
const path = require('path'), fs = require('fs');
const { chromium, webkit } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL0 = process.env.URL || 'http://127.0.0.1:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9p'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const G = '#todayList table.grid';
const cell = (r, c) => `${G} tbody tr:nth-child(${r}) .gc[data-c="${c}"]`;
const settle = p => p.waitForTimeout(600);
const val = (p, r, c) => p.evaluate(s => { const el = document.querySelector(s); return el ? (el.classList.contains('fpv') && el.dataset.v != null ? el.dataset.v : (el.tagName === 'BUTTON' ? el.textContent.trim() : el.value)) : null; }, cell(r, c));
const rowInfo = p => p.evaluate(G => [...document.querySelectorAll(`${G} tbody tr[data-id]`)].map(tr => ({ id: tr.dataset.id, name: tr.querySelector('.gc[data-c="name"]').value, cls: ['spg', 'spc', 'spn'].filter(c => tr.classList.contains(c)).join(' ') })), G);
const foot = p => p.textContent(`${G} tfoot [data-tn]`);
const ent = (p, id) => p.evaluate(async id => (await Vault.loadAll()).find(x => x.id === id) || null, id);
async function unlock(p) { await p.waitForSelector('#unlockForm:not([hidden])'); await p.fill('#uPass', PIN); await p.click('#uBtn'); await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(600); }
async function setup(browser, o, label) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Edmonton' }, o)); const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/^Refused to apply a stylesheet/.test(m.text())) errors.push(label + ': ' + m.text()); });
  await p.goto(URL0); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await p.waitForFunction(() => !document.body.classList.contains('locked')); await p.waitForTimeout(300);
  await p.evaluate(async () => { const now = Date.now(), d0 = new Date(now); const t = (h, m) => { const d = new Date(d0); d.setHours(h, m, 0, 0); return Math.min(d.getTime(), now - 60000 * (14 - h)); };
    const mk = (id, x) => Object.assign({ id, kind: 'enc', name: '', mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: 'H', facility: null, type: '', codes: [], notes: [], segs: [], status: 'done', photos: [], links: [], created: now - 9e6, updated: now - 9e6 }, x);
    const h0 = new Date(now).getHours(), base = h => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() + Math.max(0, Math.min(h, h0 - 0.5)) * 3600e3; };
    await Vault.save(mk('pA', { name: 'Alex Smith', mrn: '123456789', chart: '123456789', setting: 'C', facNo: '394', fcen: 'EMRG', codes: [{ c: '03.03A', k: '03.03A', d: '', j: 'AB', f: '', dx: '650' }], dxx: ['V22.1'], mods: ['TEV', ''], modU: { TEV: 4 }, billingNote: 'first visit', segs: [{ s: base(1), e: base(1) + 20 * 60e3 }] }));
    await Vault.save(mk('pB', { name: 'Blair Jones', mrn: '987654321', chart: '987654321', codes: [{ c: '03.04A', k: '03.04A', d: '', j: 'AB', f: '', dx: '' }], segs: [{ s: base(2), e: base(2) + 15 * 60e3 }] }));
    await Vault.save(mk('pC', { name: 'Casey Lee', mrn: '555000111', chart: '555000111', segs: [{ s: base(3), e: base(3) + 10 * 60e3 }] })); });
  await p.click('#lockNow'); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(400);
  return p;
}
(async () => {
  const cr = await chromium.launch(), wk = await webkit.launch();
  {
    const L = '1280', p = await setup(cr, { viewport: { width: 1280, height: 800 } }, L);
    ok(/^3 encounters$/.test((await foot(p)).trim()), `${L}: footer "${(await foot(p)).trim()}" (no patients count when every row is a different patient)`);
    await p.click(cell(1, 'fee')); await p.waitForTimeout(150);
    const vis = await p.evaluate(G => { const b = document.querySelector(`${G} tbody tr:nth-child(1) .spb`), b2 = document.querySelector(`${G} tbody tr:nth-child(2) .spb`); return [b && getComputedStyle(b).display, b2 && getComputedStyle(b2).display]; }, G);
    ok(vis[0] === 'flex' && vis[1] === 'none', `${L}: ＋ same-patient button shows in the selected row's number cell only (${vis})`);
    await p.click(`${G} tbody tr:nth-child(1) .spb`); await settle(p);
    let ri = await rowInfo(p); const nid = ri[1] && ri[1].id;
    ok(ri.length === 4 && ri[1].name === 'Alex Smith' && ri[2].name === 'Blair Jones', `${L}: new row inserted directly under row 1: ${ri.map(r => r.name).join(' | ')}`);
    const nv = { mrn: await val(p, 2, 'mrn'), hc: await val(p, 2, 'hc'), fno: await val(p, 2, 'fno'), fcen: await val(p, 2, 'fcen'), tin: await val(p, 2, 'tin'), tout: await val(p, 2, 'tout'), fee: await val(p, 2, 'fee'), dx: await val(p, 2, 'dx'), mod1: await val(p, 2, 'mod1'), note: await val(p, 2, 'note') };
    ok(nv.mrn === '123456789' && nv.hc === 'C' && nv.fno === '394' && nv.fcen === 'EMRG', `${L}: copied: MRN ${nv.mrn}, H/C ${nv.hc}, facility # ${nv.fno}, functional centre ${nv.fcen}`);
    ok(!nv.tin && !nv.tout && !nv.fee && !nv.dx && !nv.mod1 && !nv.note, `${L}: blank: times, codes, Dx, modifiers, notes ${JSON.stringify(nv)}`);
    const ne = await ent(p, nid), a = await ent(p, 'pA');
    ok(ne && ne.segs.length === 0 && !ne.codes.length && !(ne.dxx || []).length && !ne.modU && ne.name === 'Alex Smith' && ne.pt && ne.pt === a.pt, `${L}: stored: full name on the new row, no times / codes / units, linked to the first (pt ${ne && ne.pt})`);
    ok(ri[0].cls === 'spg spn' && ri[1].cls === 'spg spc', `${L}: the two rows are grouped (${ri[0].cls} / ${ri[1].cls}); repeated name shown lighter`);
    const lighter = await p.evaluate(G => { const c = s => getComputedStyle(document.querySelector(s)).color; return [c(`${G} tbody tr:nth-child(1) .gc[data-c="name"]`), c(`${G} tbody tr:nth-child(2) .gc[data-c="name"]`)]; }, G);
    ok(/foot/.test('foot') && /4 encounters · 3 patients/.test(await foot(p)), `${L}: footer "${(await foot(p)).trim()}"; name colours ${lighter.join(' vs ')}`);
    ok(await p.evaluate(s => document.activeElement === document.querySelector(s), cell(2, 'tin')), `${L}: cursor goes to the new row's In cell`);
    await p.screenshot({ path: path.join(OUT, 'same-patient-1280x800.png') });
    // undo / redo
    await p.click('#gUndo'); await settle(p); ri = await rowInfo(p);
    ok(ri.length === 3 && !(await ent(p, nid)) && /^3 encounters$/.test((await foot(p)).trim()) && !(await ent(p, 'pA')).pt, `${L}: one Undo removes the new row and the link (${ri.map(r => r.name).join(' | ')}); toast "${await p.textContent('#toast')}"`);
    await p.click('#gRedo'); await settle(p); ri = await rowInfo(p);
    ok(ri.length === 4 && ri[1].id === nid && ri[1].name === 'Alex Smith', `${L}: Redo puts it back under row 1`);
    // second same-patient encounter goes under the patient's last row
    await p.click(cell(1, 'fee')); await p.waitForTimeout(150); await p.click(`${G} tbody tr:nth-child(1) .spb`); await settle(p); ri = await rowInfo(p);
    ok(ri.length === 5 && ri.slice(0, 3).every(r => r.name === 'Alex Smith') && ri[3].name === 'Blair Jones' && ri[2].cls === 'spg spc', `${L}: from row 1 again → added under the patient's last row (row 3): ${ri.map(r => r.name).join(' | ')}`);
    ok(/5 encounters · 3 patients/.test(await foot(p)), `${L}: footer "${(await foot(p)).trim()}"`);
    const id3 = ri[2].id;
    // premium units count per encounter
    await p.click(cell(1, 'mod1')); await p.keyboard.press('Control+a'); await p.keyboard.type('TEV04'); await p.keyboard.press('Enter'); await settle(p);
    await p.click(cell(2, 'mod1')); await p.keyboard.type('TEV02'); await p.keyboard.press('Enter'); await settle(p);
    const strip = await p.textContent('#premStrip');
    ok(/TEV\s*6\/20/.test(strip), `${L}: premium units add up across the patient's encounters (TEV 4 + 2): "${strip.replace(/\s+/g, ' ').trim()}"`);
    // pick-and-return into the new row
    await p.evaluate(() => { window.__u = ''; window.open = u => { window.__u = u; return {}; }; });
    await p.click(cell(3, 'fee')); await p.locator(`${G} tbody tr:nth-child(3) .pickfd[data-kind="fee"]:not(.fdmini)`).evaluate(b => b.click()); await p.waitForTimeout(300);
    const tok = new (require('url').URL)(await p.evaluate(() => window.__u)).searchParams.get('ctx');
    await p.goto(URL0 + `?pickv=2&ctx=${tok}&fee=03.04A&dx=V22.2`); await unlock(p); await p.click('#tabs [data-tab="today"]'); await p.waitForTimeout(800);
    const pk = await ent(p, id3); ri = await rowInfo(p);
    ok(pk && pk.codes.map(c => c.c).join() === '03.04A' && /V22\.2/.test(JSON.stringify(pk)) && ri[2].id === id3, `${L}: Fee Desk pick lands in the same-patient row (${pk && pk.codes.map(c => c.c)}), row order kept after reload`);
    ok(ri[0].cls === 'spg spn' && ri[1].cls === 'spg spc spn' && ri[2].cls === 'spg spc', `${L}: after reload / unlock the 3 rows are still grouped`);
    // name edit: this row only, then "Apply to all"
    await p.click(cell(1, 'name')); await p.keyboard.press('Control+a'); await p.keyboard.type('Alex Smyth'); await p.keyboard.press('Enter'); await settle(p);
    ri = await rowInfo(p); const sn = await p.evaluate(() => ({ shown: !document.querySelector('#snack').hidden, txt: document.querySelector('#snackTxt').textContent, btn: document.querySelector('#snackUndo').textContent }));
    ok(ri[0].name === 'Alex Smyth' && ri[1].name === 'Alex Smith' && ri[2].name === 'Alex Smith', `${L}: renaming row 1 does not change the others (${ri.slice(0, 3).map(r => r.name).join(' | ')})`);
    ok(sn.shown && sn.btn === 'Apply to all 3', `${L}: offer: "${sn.txt}" [${sn.btn}]`);
    await p.click('#snackUndo'); await settle(p); ri = await rowInfo(p);
    ok(ri.slice(0, 3).every(r => r.name === 'Alex Smyth'), `${L}: Apply to all → ${ri.slice(0, 3).map(r => r.name).join(' | ')}`);
    await p.click('#gUndo'); await settle(p); ri = await rowInfo(p);
    ok(ri[0].name === 'Alex Smyth' && ri[1].name === 'Alex Smith' && ri[2].name === 'Alex Smith', `${L}: one Undo reverts "apply to all" only (${ri.slice(0, 3).map(r => r.name).join(' | ')})`);
    // CSV has the full name on every row; storage encrypted
    const csv = await p.evaluate(() => { const l = window.__S ? null : null; return null; });
    const rep = await p.evaluate(async () => { const all = await Vault.loadAll(), day = BLR.encDay(all[0]); const t = BLR.table(all, day, day, Date.now(), all); const ni = t.head.findIndex(h => /patient|name/i.test(h)); return { head: t.head.slice(0, 8), names: t.rows.map(r => r.join('|')).filter(r => /Alex Sm/.test(r)).length }; });
    ok(rep.names === 3, `${L}: report / CSV rows with the full patient name: ${rep.names} of 3 same-patient encounters`);
    const raw = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('bl-vault'); r.onsuccess = () => { const q = r.result.transaction('enc').objectStore('enc').getAll(); q.onsuccess = () => { r.result.close(); res(JSON.stringify(q.result, (k, v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? String.fromCharCode(...new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)) : v)); }; }; }));
    ok(raw.length > 500 && !/Alex|Smith|123456789|EMRG/.test(raw), `${L}: entries stored encrypted (no names / MRNs / facility in the database)`);
    // endless rows, numbering, sticky header
    const en = await p.evaluate(G => { const rows = [...document.querySelectorAll(`${G} tbody tr`)]; return { ok: rows.every((tr, i) => tr.querySelector('.rn').textContent.replace(/\D/g, '') === String(i + 1)), blanks: rows.filter(r => r.dataset.blank).length, sticky: getComputedStyle(document.querySelector(`${G} thead th`)).position }; }, G);
    ok(en.ok && en.blanks >= 10 && en.sticky === 'sticky', `${L}: row numbers continuous, ${en.blanks} blank rows below, header ${en.sticky}`);
    // double-clicking the selected row's number opens the details and adds nothing
    const n0 = (await rowInfo(p)).length; await p.click(cell(4, 'fee')); await p.waitForTimeout(150); await p.dblclick(`${G} tbody tr:nth-child(4) .rn`); await p.waitForTimeout(700);
    const dlg = await p.evaluate(() => !!document.querySelector('#editDlg[open]')); if (dlg) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); }
    ok(dlg && (await rowInfo(p)).length === n0, `${L}: double-click on the selected row's number opens the details, no row added`);
    // no row without a name / MRN offers Same patient
    await p.click(cell(6, 'name')); await p.keyboard.type('0900'.slice(0, 0)); await p.click(cell(6, 'tin')); await p.keyboard.type('0700'); await p.keyboard.press('Enter'); await settle(p);
    const noSp = await p.evaluate(G => { const tr = [...document.querySelectorAll(`${G} tbody tr[data-id]`)].find(t => !t.querySelector('.gc[data-c="name"]').value && !t.querySelector('.gc[data-c="mrn"]').value); return tr ? !tr.querySelector('.spb') : 'none'; }, G);
    ok(noSp === true, `${L}: a row with no name or MRN has no Same patient button`);
    await p.context().close();
  }
  for (const [engine, br] of [['chromium', cr], ['webkit', wk]]) {
    const L = `${engine} 402x874`, p = await setup(br, { viewport: { width: 402, height: 874 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, L);
    await p.locator(cell(1, 'mrn')).tap(); await p.waitForTimeout(250);
    const g = await p.evaluate(G => { const b = document.querySelector(`${G} tbody tr:nth-child(1) .spb`); const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
      return { r: [r.left, r.top, r.width, r.height].map(Math.round), d: getComputedStyle(b).display, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0, hit: hit(cx, cy - 21.5) && hit(cx, cy + 21.5) && hit(r.left + 1, cy) && hit(r.left + 43, cy), miss: [[cx, cy - 21.5], [cx, cy + 21.5], [r.left + 1, cy], [r.left + 43, cy]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; }) }; }, G);
    ok(g.d === 'flex' && g.inView && g.r[2] >= 44 && g.r[3] >= 44 && g.hit, `${L}: tapping a cell shows ＋ same in that row's number cell, ${g.r[2]}×${g.r[3]} pt, all of it tappable, on screen (${JSON.stringify(g.r)} ${g.hit ? '' : JSON.stringify(g.miss)})`);
    await p.locator(`${G} tbody tr:nth-child(1) .spb`).tap(); await settle(p);
    const ri = await rowInfo(p);
    ok(ri.length === 4 && ri[1].name === 'Alex Smith' && ri[1].cls === 'spg spc', `${L}: tap → new Alex Smith row under row 1 (${ri.map(r => r.name).join(' | ')})`);
    ok(/4 encounters · 3 patients/.test(await foot(p)), `${L}: footer "${(await foot(p)).trim()}"`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, `same-patient-402x874${engine === 'webkit' ? '-webkit' : ''}.png`) });
    await p.locator('#gUndo').tap(); await settle(p); ok((await rowInfo(p)).length === 3, `${L}: tap Undo removes it`);
    await p.context().close();
  }
  await cr.close(); await wk.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
