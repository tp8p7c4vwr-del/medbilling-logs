// Headless test for v9d encrypted exports + passphrase/passcode login.
// Run: cd /workspace/pwtest && URL=http://127.0.0.1:18791/ node /workspace/medbilling-logs/tests/encrypted-export.test.js
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const fs = require('fs'), { execFileSync } = require('child_process');
const URL = process.env.URL || 'http://127.0.0.1:18791/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-encrypted-export';
const DL = path.join(OUT, 'downloads'); fs.mkdirSync(DL, { recursive: true });
const APP_PASS = 'Quiet harbor seventy lantern';          // app passphrase (also passes the export policy, to test the "different from passcode" rule)
const EXP_PASS = 'Velvet!Comet-39-Prairie';
const PATIENTS = [['Sample, Maria', '100234567'], ['Doe, Jane', '100987654'], ['Testova, Olga', 'PHN 98765-4321']];
const pad = n => String(n).padStart(2, '0'), hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function setup(page, kind, pass) {
  await page.goto(URL); await page.waitForSelector('#setupForm:not([hidden])');
  await page.check(`input[name=sKind][value=${kind}]`);
  await page.fill('#sPass', pass); await page.fill('#sPass2', pass); await page.check('#sAck'); await page.check('#sResp'); await page.click('#sBtn');
  await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 30000 }); await page.waitForTimeout(400);
}
async function typeRow(page, r, cells) {
  await page.click(`#todayList table.grid tbody tr:nth-child(${r}) .gc[data-c="name"]`);
  for (const [c, v] of cells) { if (v !== null) await page.keyboard.type(v, { delay: 3 }); await page.keyboard.press('Tab'); await page.waitForTimeout(200); }
  await page.keyboard.press('Escape');
}
async function exportFmt(page, fmt, pass, opts = {}) {
  await page.click('#repToday'); await page.waitForSelector('#repDlg[open]');
  await page.click(`#repForm [data-fmt="${fmt}"]`); await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  if (!(await page.isChecked('#xpAck'))) await page.check('#xpAck');
  if (await page.isVisible('#xp1')) { await page.fill('#xp1', pass); await page.fill('#xp2', pass); if (opts.keep) await page.check('#xpKeep'); }
  await page.click('#xpOk'); await page.waitForSelector('#pReady:not([hidden])', { timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pDown')]);
  const name = dl.suggestedFilename(), dest = path.join(DL, `${fmt}-${name}`); await dl.saveAs(dest);
  await page.click('#pClose'); return { name, dest };
}
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Edmonton', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('[1280] ' + m.text()); }); page.on('pageerror', e => errors.push('[1280] pageerror ' + e.message));
  const logs = []; page.on('console', m => logs.push(m.text()));
  // passphrase setup: validation first
  await page.goto(URL); await page.waitForSelector('#setupForm:not([hidden])');
  await page.check('input[name=sKind][value=pin]'); await page.fill('#sPass', 'abc12345'); await page.fill('#sPass2', 'abc12345'); await page.check('#sAck'); await page.check('#sResp'); await page.click('#sBtn');
  ok(/digits only/.test(await page.textContent('#sErr')), 'numeric passcode rejects letters');
  await page.fill('#sPass', '123456'); await page.fill('#sPass2', '123456'); await page.click('#sBtn'); ok(/sequence/.test(await page.textContent('#sErr')), 'numeric passcode rejects 123456');
  await page.check('input[name=sKind][value=phrase]'); await page.fill('#sPass', 'short words'); await page.fill('#sPass2', 'short words'); await page.click('#sBtn'); ok(/12 characters/.test(await page.textContent('#sErr')), 'passphrase needs 12+ chars');
  await setup(page, 'phrase', APP_PASS); ok(true, 'passphrase with spaces accepted at setup');
  const now = Date.now();
  await typeRow(page, 1, [['name', PATIENTS[0][0]], ['mrn', PATIENTS[0][1]], ['hc', null], ['tin', hm(now - 200 * 60000)], ['tout', hm(now - 160 * 60000)], ['fee', '03.04A'], ['dx', 'V22.1'], ['note', 'Prenatal visit']]);
  await typeRow(page, 2, [['name', PATIENTS[1][0]], ['mrn', PATIENTS[1][1]], ['hc', null], ['tin', hm(now - 150 * 60000)], ['tout', hm(now - 120 * 60000)], ['fee', '03.08A'], ['dx', '626.2'], ['note', 'Consult']]);
  await typeRow(page, 3, [['name', PATIENTS[2][0]], ['mrn', PATIENTS[2][1]], ['hc', null], ['tin', hm(now - 100 * 60000)], ['tout', hm(now - 85 * 60000)], ['fee', '13.99A'], ['dx', '650'], ['note', 'Follow-up']]);
  ok(await page.locator('#todayList tbody tr[data-id]').count() === 3, '3 sample encounters with fake patient data');
  // dialog validation
  await page.click('#repToday'); await page.waitForSelector('#repDlg[open]');
  ok(await page.locator('#repForm .fmt [data-fmt]').evaluateAll(b => b.filter(x => !x.hidden).map(x => x.dataset.fmt).join(',')) === 'pdf,docx,xlsx,csv', 'report formats: PDF, Word, Excel, CSV');
  await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  ok(/Health Information Act/.test(await page.textContent('#xpNote')) && /AHS/.test(await page.textContent('#xpNote')) && /OIPC/.test(await page.textContent('#xpNote')), 'privacy notice mentions HIA, AHS, OIPC');
  await page.screenshot({ path: path.join(OUT, 'privacy-notice-1280.png') });
  await page.fill('#xp1', EXP_PASS); await page.fill('#xp2', EXP_PASS); await page.click('#xpOk');
  ok(/privacy notice/i.test(await page.textContent('#xpErr')), 'export blocked until the privacy notice is acknowledged');
  await page.check('#xpAck');
  const tryPw = async (pw, rx, label) => { await page.fill('#xp1', pw); await page.fill('#xp2', pw); await page.click('#xpOk'); await page.waitForTimeout(pw === APP_PASS ? 2500 : 300); const e = await page.textContent('#xpErr'), why = await page.textContent('#xpWhy'); ok(rx.test(e + ' ' + why), `${label}: "${(e || why).slice(0, 110)}"`); };
  await tryPw('Short1!', /12 characters/, 'too short rejected');
  await tryPw('Password2026!', /common or leaked/, 'common password rejected');
  await tryPw('Abcd!efgh5678', /sequences/, 'sequence rejected');
  await tryPw('Qwerty!Zebra82', /keyboard/, 'keyboard pattern rejected');
  await tryPw('Zzz!Mountain44', /repeat/, 'repeated chars rejected');
  await tryPw('lowercaseonly', /3 of these 4/, 'needs 3 classes or 16+');
  await tryPw('Maria#Sample-77x', /patient/, 'patient name rejected');
  await tryPw('Kx!100234567qq', /patient/, 'patient MRN rejected');
  await tryPw(APP_PASS, /different password from your app passcode/, 'app passcode rejected');
  await page.fill('#xp1', EXP_PASS); await page.fill('#xp2', EXP_PASS + 'x'); await page.click('#xpOk'); ok(/match/.test(await page.textContent('#xpErr')), 'confirm mismatch rejected');
  await page.fill('#xp1', 'Kx!Sample'); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, 'password-dialog-weak-1280.png') });
  await page.fill('#xp1', EXP_PASS); await page.fill('#xp2', EXP_PASS); await page.click('.pwshow[data-for="xp1"]'); await page.waitForTimeout(150);
  ok(await page.getAttribute('#xp1', 'type') === 'text', 'Show reveals the password'); 
  ok(/Very strong|Strong/.test(await page.textContent('#xpStr')), 'strength meter: ' + await page.textContent('#xpStr'));
  await page.screenshot({ path: path.join(OUT, 'password-dialog-strong-1280.png') });
  await page.click('#xpCancel'); await page.click('#pClose');
  // each format
  const needles = PATIENTS.map(p => p[0]).concat(['100234567', '100987654']);
  for (const fmt of ['pdf', 'docx', 'xlsx', 'csv']) {
    const r = await exportFmt(page, fmt, EXP_PASS);
    const bad = PATIENTS.some(([n, m]) => r.name.includes(n.split(',')[0]) || r.name.includes(m)) || /\s/.test(r.name);
    ok(/^MedBillingLogs_\d{4}-\d{2}-\d{2}\.zip$/.test(r.name) && !bad, `${fmt}: file name has no identifiers (${r.name})`);
    const j = JSON.parse(execFileSync('python3', [path.join(__dirname, 'inspect_zip.py'), r.dest, EXP_PASS, needles.join('|')]).toString());
    ok(j.methods.length === 1 && /AES-256/.test(j.methods[0]), `${fmt}: 7z -slt Method = ${j.methods.join(',')}`);
    ok(j.encrypted_flags.join() === '+', `${fmt}: every entry Encrypted = +`);
    ok(j.wrong_pw_fails && j.no_pw_fails, `${fmt}: extraction fails without / with a wrong password`);
    ok(j.right_pw_ok, `${fmt}: extraction succeeds with the password`);
    ok(j['valid_' + fmt] === true, `${fmt}: inner file is a valid ${fmt.toUpperCase()} (${j.entries.join(', ')})${j.sheets ? ' sheets ' + j.sheets.join('/') : ''}${j.csv_rows ? ' rows ' + j.csv_rows : ''}`);
    ok(Object.values(j.needles_found).every(Boolean), `${fmt}: contains all rows (${JSON.stringify(j.needles_found)})`);
    ok(j.entries.every(e => !PATIENTS.some(([n, m]) => e.includes(n.split(',')[0]) || e.includes(m))), `${fmt}: inner entry names have no identifiers`);
  }
  // audit log export (also encrypted)
  await page.click('#tabs [data-tab="data"]'); await page.click('#auditExport'); await page.waitForSelector('#repDlg[open]');
  ok(await page.isHidden('#repForm [data-fmt="docx"]') && await page.isHidden('#repForm [data-fmt="xlsx"]'), 'audit export: PDF/CSV only');
  await page.click('#repForm [data-fmt="csv"]'); await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  ok(await page.isChecked('#xpAck'), 'privacy acknowledgement remembered within the session');
  await page.fill('#xp1', EXP_PASS); await page.fill('#xp2', EXP_PASS); await page.check('#xpKeep'); await page.click('#xpOk'); await page.waitForSelector('#pReady:not([hidden])', { timeout: 30000 });
  const [adl] = await Promise.all([page.waitForEvent('download'), page.click('#pDown')]); const aname = adl.suggestedFilename(), apath = path.join(DL, 'audit-' + aname); await adl.saveAs(apath); await page.click('#pClose');
  const aj = JSON.parse(execFileSync('python3', [path.join(__dirname, 'inspect_zip.py'), apath, EXP_PASS, 'Sample, Maria']).toString());
  ok(/^MedBillingLogs_audit-log_\d{4}-\d{2}-\d{2}\.zip$/.test(aname) && /AES-256/.test(aj.methods.join()) && aj.no_pw_fails && aj.right_pw_ok && aj.valid_csv, `audit log export is an AES-256 zip (${aname})`);
  // remembered password: next export skips the fields; lock clears it
  await page.click('#tabs [data-tab="today"]'); await page.click('#repToday'); await page.waitForSelector('#repDlg[open]'); await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  ok(await page.isVisible('#xpRemembered') && await page.isHidden('#xpFields'), '"Remember for this session" skips re-typing');
  await page.click('#xpCancel'); await page.click('#pClose');
  await page.click('#lockNow'); await page.waitForSelector('#unlockForm:not([hidden])');
  ok(await page.textContent('#uLbl') === 'Passphrase', 'lock screen labels the field "Passphrase"');
  await page.fill('#uPass', APP_PASS); await page.click('#uBtn'); await page.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 30000 }); await page.waitForTimeout(300);
  await page.click('#repToday'); await page.waitForSelector('#repDlg[open]'); await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  ok(await page.isHidden('#xpRemembered') && await page.isVisible('#xpFields') && !(await page.isChecked('#xpAck')), 'after lock: password and acknowledgement cleared');
  await page.click('#xpCancel'); await page.click('#pClose');
  // backups: unencrypted readable copies can no longer be chosen
  await page.click('#tabs [data-tab="data"]'); ok(await page.isDisabled('#abZip') && await page.isChecked('#abZip'), 'backup readable copies: encryption always on (toggle disabled)');
  // no patient data in console output, URL or localStorage
  const ls = await page.evaluate(() => JSON.stringify(localStorage)); const pageUrl = page.url();
  ok(!PATIENTS.some(([n, m]) => ls.includes(n) || ls.includes(m) || pageUrl.includes(n) || logs.join('\n').includes(n) || logs.join('\n').includes(m) || logs.join('\n').includes(EXP_PASS)), 'no patient data / password in console, URL or localStorage');
  // manual + privacy text
  await page.click('.helpcard .manlink'); await page.waitForSelector('#manDlg[open]');
  const man = await page.textContent('#manBody');
  ok(/iZip/.test(man) && /7-Zip/.test(man) && /The Unarchiver/.test(man) && /Keka/.test(man) && /designed to support compliance/.test(man) && !/HIA certified|AHS approved/i.test(man), 'manual: opening help + responsibility disclaimer, no certification claims');
  await page.evaluate(() => document.getElementById('m-exp').scrollIntoView()); await page.waitForTimeout(200); await page.screenshot({ path: path.join(OUT, 'manual-encrypted-exports-1280.png') });
  await page.click('#manClose');
  // 390px: numeric passcode, dialog screenshots
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Edmonton', acceptDownloads: true });
  const mp = await m.newPage(); mp.on('console', x => { if (x.type() === 'error') errors.push('[390] ' + x.text()); }); mp.on('pageerror', e => errors.push('[390] pageerror ' + e.message));
  await setup(mp, 'pin', '73915428'); ok(true, 'numeric passcode setup (390px)');
  await mp.click('#lockNow').catch(async () => { await mp.click('#tabs [data-tab="data"]'); await mp.click('#lockNow2'); });
  await mp.waitForSelector('#unlockForm:not([hidden])'); ok(await mp.getAttribute('#uPass', 'inputmode') === 'numeric' && await mp.textContent('#uLbl') === 'Passcode', 'numeric keyboard + "Passcode" label on lock screen');
  await mp.fill('#uPass', '73915428'); await mp.click('#uBtn'); await mp.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 30000 }); await mp.waitForTimeout(300);
  if (await mp.isVisible('#repToday')) await mp.click('#repToday'); else { await mp.click('#moreBtn'); await mp.click('#repToday2'); } await mp.waitForSelector('#repDlg[open]'); await mp.click('#pMake'); await mp.waitForSelector('#xpDlg[open]');
  await mp.screenshot({ path: path.join(OUT, 'privacy-notice-390.png') });
  await mp.check('#xpAck'); await mp.fill('#xp1', 'Kettle-Plum'); await mp.waitForTimeout(150);
  await mp.locator('#xp1').scrollIntoViewIfNeeded(); await mp.screenshot({ path: path.join(OUT, 'password-dialog-weak-390.png') });
  await mp.fill('#xp1', EXP_PASS); await mp.fill('#xp2', EXP_PASS); await mp.waitForTimeout(150);
  await mp.locator('#xpOk').scrollIntoViewIfNeeded(); await mp.screenshot({ path: path.join(OUT, 'password-dialog-strong-390.png') });
  const ow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ow <= 0, '390px: no horizontal overflow (' + ow + ')');
  const dlgw = await mp.evaluate(() => { const r = document.querySelector('#xpDlg').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }); ok(dlgw, '390px: password dialog fits the screen');
  await mp.click('#xpOk'); await mp.waitForSelector('#pReady:not([hidden])', { timeout: 30000 });
  await mp.screenshot({ path: path.join(OUT, 'export-ready-390.png') });
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
