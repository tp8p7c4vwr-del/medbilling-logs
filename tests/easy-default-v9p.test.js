// v9p: Face ID (app) / platform passkey (web) is the DEFAULT unlock. Mocked Capacitor NativeBiometric plugin (Keychain store
// kept in localStorage so it survives reloads, like the real Keychain) and a Chromium virtual platform authenticator.
// Run: cd /workspace/pwtest && URL=http://localhost:18792/medbilling-logs/ OUT=/workspace/artifacts/mbl-v9p node /workspace/medbilling-logs/tests/easy-default-v9p.test.js
const path = require('path'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://localhost:18792/medbilling-logs/';
const OUT = process.env.OUT || '/workspace/artifacts/mbl-v9p'; fs.mkdirSync(OUT, { recursive: true });
const PIN = '48203917';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const isLocked = p => p.evaluate(() => document.body.classList.contains('locked'));
const unlocked = p => p.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 15000 });
const prompts = p => p.evaluate(() => +localStorage.getItem('nb.prompts') || 0);
const nbSet = (p, k, v) => p.evaluate(([k, v]) => localStorage.setItem(k, v), [k, v]);
const resume = async p => { await p.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(200); await p.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }); };
const focusId = p => p.evaluate(() => document.activeElement && document.activeElement.id);
const audit = p => p.evaluate(async () => (await Vault.loadAudit ? await Vault.loadAudit() : []).map(a => a.note || '').join(' | ')).catch(() => '');
async function appCtx(browser, label, init) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Edmonton' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(label + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  await p.addInitScript(init => {
    if (init && !localStorage.getItem('nb.init')) { for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v); localStorage.setItem('nb.init', '1'); }
    const L = localStorage, store = () => JSON.parse(L.getItem('nb.store') || '{}'), put = s => L.setItem('nb.store', JSON.stringify(s));
    const NativeBiometric = {
      isAvailable: async () => ({ isAvailable: L.getItem('nb.avail') !== '0', biometryType: 2 }),
      setData: async ({ key, value, accessControl }) => { const s = store(); s[key] = { value, ac: accessControl || 0 }; put(s); },
      getSecureData: async ({ key }) => { L.setItem('nb.prompts', String((+L.getItem('nb.prompts') || 0) + 1)); await new Promise(r => setTimeout(r, 150));
        if (L.getItem('nb.cancel') === '1') throw Object.assign(new Error('User canceled'), { code: 16 }); const r = store()[key]; if (!r || !r.ac) throw Object.assign(new Error('No protected data found for key'), { code: 21 }); return { value: r.value }; },
      getData: async ({ key }) => { const r = store()[key]; if (!r || r.ac) throw new Error('No data found'); return { value: r.value }; },
      deleteData: async ({ key }) => { const s = store(); delete s[key]; put(s); }
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { NativeBiometric } };
    Object.defineProperty(document, 'visibilityState', { get: () => window.__vis || 'visible' }); Object.defineProperty(document, 'hidden', { get: () => window.__vis === 'hidden' });
  }, init || null);
  return p;
}
async function setup(p) {
  await p.goto(URL); await p.waitForSelector('#setupForm:not([hidden])');
  await p.check('input[name=sKind][value=pin]'); await p.fill('#sPass', PIN); await p.fill('#sPass2', PIN); await p.check('#sAck'); await p.check('#sResp'); await p.click('#sBtn');
  await unlocked(p);
}
async function passUnlock(p) { await p.fill('#uPass', PIN); await p.click('#uBtn'); await unlocked(p); }

(async () => {
  const browser = await chromium.launch();
  // ---------- A. new setup in the app: Face ID on by default, confirmed with one scan; auto-prompt on open and on return
  {
    const p = await appCtx(browser, 'A');
    await setup(p);
    await p.waitForFunction(() => /unlock is on/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 }).catch(() => {});
    const toastA = await p.textContent('#toast');
    const st = await p.evaluate(async () => ({ s: await EasyUnlock.status(), easy: JSON.stringify(await Vault.getEasy()), store: localStorage.getItem('nb.store') }));
    ok(st.s.bio && (await prompts(p)) === 1 && !(await p.isVisible('#askDlg')), `A: new setup → Face ID turned on by default with one confirming scan, no extra question (prompts ${await prompts(p)}; toast "${toastA}")`);
    ok(!/48203917/.test(st.easy + st.store) && /"ct"/.test(st.easy) && /"ac":1/.test(st.store), 'A: same key wrapping: vault key wrapped (ciphertext only), wrap key stored with biometric access control (BIOMETRY_CURRENT_SET)');
    await p.click('#tabs [data-tab="data"]'); await p.waitForTimeout(300);
    ok(await p.isChecked('#euBioOn') && /default/.test(await p.textContent('#euInfo')), 'A: Settings → Lock shows Face ID on, and says it is the default');
    await p.locator('#euCard').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(OUT, 'faceid-settings-402.png') });
    // open the app again (reload): Face ID asks by itself, the passcode keyboard is not raised under it
    await p.waitForTimeout(1000); await p.reload();
    await p.waitForSelector('#unlockForm:not([hidden])'); await p.waitForTimeout(120);
    const f0 = await focusId(p);
    await unlocked(p);
    ok((await prompts(p)) === 2 && f0 !== 'uPass', `A: opening the app → Face ID prompts automatically and unlocks without a tap (prompts 2; passcode field not focused: ${f0 || 'none'})`);
    // back from the background
    await p.waitForTimeout(1000); await resume(p); await unlocked(p);
    ok((await prompts(p)) === 3, 'A: back from the background (locked there) → Face ID prompts automatically and unlocks');
    // manual Lock: no automatic prompt (it would unlock again at once); Face ID button is first, one tap
    await p.click('#lockNow'); await p.waitForTimeout(900);
    ok(await isLocked(p) && (await prompts(p)) === 3 && await p.isVisible('#euBio') && /Face ID/.test(await p.textContent('#euBio')), 'A: after tapping Lock: stays locked (no instant re-unlock), "Unlock with Face ID" button shown');
    await p.screenshot({ path: path.join(OUT, 'faceid-lock-screen-402.png') });
    await p.click('#euBio'); await unlocked(p); ok((await prompts(p)) === 4, 'A: one tap on "Unlock with Face ID" unlocks');
    // cancel → passcode fallback, no re-prompt loop (also when iOS reports the app active again right after the sheet)
    await nbSet(p, 'nb.cancel', '1'); await p.waitForTimeout(1000); await resume(p); await p.waitForTimeout(250);
    await p.evaluate(() => window.__mblForeground && window.__mblForeground()); await p.waitForTimeout(1500);
    const fc = await focusId(p);
    ok(await isLocked(p) && (await prompts(p)) === 5 && fc === 'uPass' && await p.isVisible('#uPass'), `A: Face ID cancelled → one prompt only, passcode field focused as the fallback (prompts ${await prompts(p)}, focus ${fc})`);
    await p.screenshot({ path: path.join(OUT, 'faceid-cancelled-passcode-402.png') });
    await nbSet(p, 'nb.cancel', '0'); await passUnlock(p); ok(true, 'A: passcode unlocks after Face ID was cancelled');
    ok(!(await p.isVisible('#askDlg')), 'A: no "Use Face ID?" question for a user who already has it on');
    await p.context().close();
  }
  // ---------- B. new setup, Face ID scan cancelled / permission denied → off, Settings can retry; not asked again
  {
    const p = await appCtx(browser, 'B', { 'nb.cancel': '1' });
    await setup(p); await p.waitForTimeout(3500);
    const st = await p.evaluate(() => EasyUnlock.status());
    ok(!st.bio && /unlock is off/.test(await p.textContent('#toast')) && !/mbl\.easy\.bio/.test(await p.evaluate(() => localStorage.getItem('nb.store') || '')), `B: setup scan cancelled → Face ID left off and its Keychain item removed; toast "${await p.textContent('#toast')}"`);
    await nbSet(p, 'nb.cancel', '0'); await p.click('#lockNow'); await p.waitForTimeout(600); await passUnlock(p); await p.waitForTimeout(2500);
    ok(!(await p.isVisible('#askDlg')), 'B: not asked again at the next passcode unlock (asked once)');
    await p.context().close();
  }
  // ---------- C. no biometrics (not enrolled / unavailable): passcode only, focused, nothing offered
  {
    const p = await appCtx(browser, 'C', { 'nb.avail': '0' });
    await setup(p); await p.waitForTimeout(3000);
    ok((await prompts(p)) === 0 && !(await p.isVisible('#askDlg')) && !(await p.evaluate(() => EasyUnlock.status())).bio, 'C: biometrics unavailable → no prompt, no question, passcode only');
    await p.reload(); await p.waitForSelector('#unlockForm:not([hidden])'); await p.waitForTimeout(400);
    ok((await focusId(p)) === 'uPass' && await p.isHidden('#euLock'), 'C: lock screen = passcode field, focused');
    await p.context().close();
  }
  // ---------- D. existing user (passcode, Face ID never turned on): one-time "Use Face ID to unlock?" at the next passcode unlock
  for (const accept of [true, false]) {
    const L = accept ? 'D-yes' : 'D-no';
    const p = await appCtx(browser, L, { 'nb.avail': '0' });
    await setup(p); await p.waitForTimeout(2500);
    await p.evaluate(async () => { const s = await Vault.loadSettings(); delete s.euAsked; await Vault.saveSettings(s); });   // a pre-v9p vault: never asked
    await nbSet(p, 'nb.avail', '1'); await p.reload(); await p.waitForSelector('#unlockForm:not([hidden])'); await p.waitForTimeout(500);
    ok(await p.isHidden('#euLock') && (await prompts(p)) === 0, `${L}: lock screen before: passcode only (Face ID not on yet)`);
    await passUnlock(p);
    await p.waitForSelector('#askDlg[open]', { timeout: 8000 });
    const t = await p.textContent('#askTitle'), okT = await p.textContent('#askOk'), cT = await p.textContent('#askCancel'), cls = await p.getAttribute('#askOk', 'class');
    ok(t === 'Use Face ID to unlock?' && okT === 'Use Face ID' && cT === 'Not now' && /primary/.test(cls), `${L}: one-time question "${t}" [${okT}] (default) / [${cT}]`);
    if (accept) await p.screenshot({ path: path.join(OUT, 'faceid-offer-existing-402.png') });
    await p.click(accept ? '#askOk' : '#askCancel'); await p.waitForTimeout(2500);
    const on = (await p.evaluate(() => EasyUnlock.status())).bio;
    ok(on === accept && (await prompts(p)) === (accept ? 1 : 0), `${L}: ${accept ? 'Use Face ID → turned on after one confirming scan' : 'Not now → stays off, no scan'}`);
    await p.waitForTimeout(1000); await p.reload(); await p.waitForSelector('#unlockForm:not([hidden])');
    if (accept) { await unlocked(p); ok((await prompts(p)) === 2, `${L}: next open → Face ID prompts automatically and unlocks`); }
    else { await p.waitForTimeout(500); await passUnlock(p); await p.waitForTimeout(2500); ok(!(await p.isVisible('#askDlg')), `${L}: not asked again (Settings → Lock can turn it on)`); }
    await p.context().close();
  }
  // ---------- E. web with a platform authenticator (Touch ID / Face ID / Windows Hello passkey with PRF)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Edmonton' }); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('E: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('E: ' + m.text()); });
    const cdp = await ctx.newCDPSession(p); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
    await setup(p);
    await p.waitForSelector('#askDlg[open]', { timeout: 8000 });
    ok(/Use Face ID \/ Touch ID to unlock\?/.test(await p.textContent('#askTitle')) && (await p.textContent('#askOk')) === 'Use a passkey', 'E: web new setup → "Use Face ID / Touch ID to unlock?" [Use a passkey] (a tap is needed to create a passkey)');
    await p.click('#askOk'); await p.waitForTimeout(2500);
    ok((await p.evaluate(() => EasyUnlock.status())).passkey, 'E: passkey turned on (PRF wrap)');
    await p.reload(); await p.waitForSelector('#unlockForm:not([hidden])'); await unlocked(p);
    ok(true, 'E: opening the web app → the passkey prompt runs by itself and unlocks (no tap)');
    await p.click('#lockNow'); await p.waitForTimeout(900); ok(await isLocked(p) && await p.isVisible('#euKey'), 'E: after Lock: stays locked, "Unlock with passkey" shown');
    await ctx.close();
  }
  // ---------- F. web without a platform authenticator: no question (passcode only, as before)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errors.push('F: ' + e.message));
    await setup(p); await p.waitForTimeout(3000);
    ok(!(await p.isVisible('#askDlg')), 'F: browser without Touch ID / Windows Hello → no question after setup');
    await ctx.close();
  }
  await browser.close();
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log(fails ? `${fails} FAIL` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
