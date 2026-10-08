// Headless test for v9e easy unlock: passkey (WebAuthn PRF, Chromium virtual authenticator) and the app's
// Face ID / quick PIN paths (Capacitor NativeBiometric plugin mocked in the page). Run like encrypted-export.test.js.
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/workspace/pwtest'] }));
const URL = process.env.URL || 'http://localhost:18791/'; // WebAuthn needs a domain name, not an IP
const OUT = process.env.OUT || '/workspace/artifacts/mbl-encrypted-export';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const unlocked = p => p.waitForFunction(() => !document.body.classList.contains('locked'), null, { timeout: 30000 });
async function setup(page, pass) {
  await page.goto(URL); await page.waitForSelector('#setupForm:not([hidden])');
  await page.check('input[name=sKind][value=pin]'); await page.fill('#sPass', pass); await page.fill('#sPass2', pass); await page.check('#sAck'); await page.check('#sResp'); await page.click('#sBtn');
  await unlocked(page); await page.waitForTimeout(400);
}
async function askFill(page, vals) { await page.waitForSelector('#askDlg[open]'); for (const [id, v] of Object.entries(vals)) await page.fill('#ask_' + id, v); await page.click('#askOk'); }
async function lock(page) { await page.click('#lockNow'); await page.waitForSelector('#unlockForm:not([hidden])'); await page.waitForTimeout(400); }
(async () => {
  const browser = await chromium.launch(); const errors = [];
  // ---------- web: passkey with PRF
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Edmonton' });
  const page = await ctx.newPage(); page.on('console', m => { if (m.type() === 'error') errors.push('[web] ' + m.text()); }); page.on('pageerror', e => errors.push('[web] ' + e.message));
  const cdp = await ctx.newCDPSession(page); await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true } });
  await setup(page, '48203917');
  // v9p: a platform passkey is offered right after setup ("Use Face ID / Touch ID to unlock?"); say Not now here (accepting is
  // covered by easy-default-v9p.test.js) so the Settings toggle path is still tested
  await page.waitForSelector('#askDlg[open]', { timeout: 8000 }); ok(/Use Face ID \/ Touch ID to unlock\?/.test(await page.textContent('#askTitle')) && (await page.textContent('#askCancel')) === 'Not now', 'v9p: passkey offered after setup (Not now)');
  await page.click('#askCancel'); await page.waitForTimeout(300);
  await page.click('#tabs [data-tab="data"]'); await page.waitForTimeout(300);
  ok(await page.isVisible('#euCard') && await page.isVisible('#euBioL') && /passkey/.test(await page.textContent('#euBioLbl')), 'web: passkey option shown (PRF-capable authenticator)');
  ok(await page.isHidden('#euPinL'), 'web: quick PIN not offered in the browser');
  await page.check('#euBioOn'); await askFill(page, { p: '11111111' }); await page.waitForTimeout(2500); ok(/Wrong passcode/.test(await page.textContent('#askErr')), 'enabling needs the correct passcode');
  await page.fill('#ask_p', '48203917'); await page.click('#askOk'); await page.waitForTimeout(1500);
  ok(await page.isChecked('#euBioOn'), 'passkey unlock turned on; toast: ' + await page.textContent('#toast'));
  const raw = await page.evaluate(async () => { const r = await Vault.getEasy(); return JSON.stringify(r); });
  ok(/"passkey"/.test(raw) && !/48203917/.test(raw), 'stored record is wrapped (no passcode, ciphertext only)');
  await page.screenshot({ path: path.join(OUT, 'easy-unlock-settings-web-1280.png') });
  await lock(page);
  ok(await page.isVisible('#euKey'), 'lock screen: "Unlock with passkey" button');
  await page.screenshot({ path: path.join(OUT, 'easy-unlock-lock-web-1280.png') });
  await page.click('#euKey'); await unlocked(page); ok(true, 'unlocked with the passkey (PRF -> HKDF -> AES-GCM unwrap -> vault key)');
  // exports still need a typed password
  await page.click('#tabs [data-tab="today"]'); await page.click('#repToday'); await page.waitForSelector('#repDlg[open]'); await page.click('#pMake'); await page.waitForSelector('#xpDlg[open]');
  ok(await page.isVisible('#xp1'), 'after passkey unlock: export still asks for a typed password');
  await page.check('#xpAck'); await page.fill('#xp1', '48203917'); await page.fill('#xp2', '48203917'); await page.click('#xpOk'); await page.waitForTimeout(300);
  ok(/./.test(await page.textContent('#xpErr')), 'export password policy still enforced');
  await page.click('#xpCancel'); await page.click('#pClose');
  // passcode change disables it
  await page.click('#tabs [data-tab="data"]'); await page.click('#chPass'); await askFill(page, { old: '48203917', n1: '59302816', n2: '59302816' }); await page.waitForTimeout(2500);
  ok(!(await page.isChecked('#euBioOn')), 'passcode change turns easy unlock off');
  await lock(page); ok(await page.isHidden('#euKey') && await page.isHidden('#euLock'), 'lock screen: no passkey button after passcode change');
  await page.fill('#uPass', '59302816'); await page.click('#uBtn'); await unlocked(page); ok(true, 'new passcode unlocks');
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  // ---------- browser without PRF: option hidden
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage(); await p2.addInitScript(() => { if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false }); });
  p2.on('pageerror', e => errors.push('[noprf] ' + e.message));
  await setup(p2, '48203917'); await p2.click('#tabs [data-tab="data"]'); await p2.waitForTimeout(300);
  ok(await p2.isHidden('#euCard'), 'browser without PRF: easy unlock hidden');
  // ---------- app (Capacitor) with a mocked NativeBiometric plugin
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Edmonton' });
  const p3 = await ctx3.newPage(); p3.on('console', m => { if (m.type() === 'error') errors.push('[app] ' + m.text()); }); p3.on('pageerror', e => errors.push('[app] ' + e.message));
  await p3.addInitScript(() => {
    const store = new Map(); window.__nb = { store, cancel: false, prompts: 0 };
    const NativeBiometric = {
      isAvailable: async () => ({ isAvailable: true, biometryType: 2 }),
      setData: async ({ key, value, accessControl }) => { store.set(key, { value, ac: accessControl || 0 }); },
      getSecureData: async ({ key }) => { window.__nb.prompts++; if (window.__nb.cancel) throw Object.assign(new Error('User canceled'), { code: 16 }); const r = store.get(key); if (!r || !r.ac) throw Object.assign(new Error('No protected data found for key'), { code: 21 }); return { value: r.value }; },
      getData: async ({ key }) => { const r = store.get(key); if (!r || r.ac) throw new Error('No data found'); return { value: r.value }; },
      deleteData: async ({ key }) => { store.delete(key); }
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { NativeBiometric } };
    Object.defineProperty(document, 'visibilityState', { get: () => window.__vis || 'visible' }); Object.defineProperty(document, 'hidden', { get: () => window.__vis === 'hidden' });
  });
  const resume = async p => { await p.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(150); await p.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }); };
  await setup(p3, '48203917'); await p3.click('#tabs [data-tab="data"]'); await p3.waitForTimeout(300);
  ok(/Face ID/.test(await p3.textContent('#euBioLbl')) && await p3.isVisible('#euPinL'), 'app: "Unlock with Face ID" + quick PIN offered');
  await p3.waitForFunction(() => document.querySelector('#euBioOn').checked, null, { timeout: 8000 });   // v9p: on by default after setup (one confirming scan)
  const st = await p3.evaluate(() => [...window.__nb.store.entries()].map(([k, v]) => k + ':' + v.ac).join(','));
  ok(await p3.isChecked('#euBioOn') && /mbl\.easy\.bio\.v1:1/.test(st), 'Face ID on by default after setup: wrap key stored with biometric access control (' + st + ')');
  await p3.locator('#euCard').scrollIntoViewIfNeeded(); await p3.screenshot({ path: path.join(OUT, 'easy-unlock-settings-app-390.png') });
  await p3.waitForTimeout(1200);   // the setup scan holds the background lock for 0.8 s after it ends
  const pr0 = await p3.evaluate(() => window.__nb.prompts);
  await resume(p3); await unlocked(p3); ok(await p3.evaluate(() => window.__nb.prompts) === pr0 + 1, `app: back from the background, Face ID prompts automatically and unlocks (prompts ${pr0} → ${await p3.evaluate(() => window.__nb.prompts)})`);
  // quick PIN
  await p3.click('#tabs [data-tab="data"]'); await p3.check('#euPinOn'); await askFill(p3, { p: '48203917', n1: '1234', n2: '1234' });
  ok(/straight sequence/.test(await p3.textContent('#askErr')), 'weak PIN 1234 refused');
  await p3.fill('#ask_n1', '2580'); await p3.fill('#ask_n2', '2580'); await p3.click('#askOk'); await p3.waitForTimeout(3000);
  ok(await p3.isChecked('#euPinOn'), 'quick PIN on');
  await p3.evaluate(() => { window.__nb.cancel = true; }); await lock(p3); await p3.waitForTimeout(600);
  ok(await p3.isVisible('#euPinBox') && await p3.isVisible('#euBio'), 'lock screen: PIN box + Face ID button (Face ID cancelled)');
  await p3.screenshot({ path: path.join(OUT, 'easy-unlock-lock-app-390.png') });
  await p3.fill('#euPin', '1111'); await p3.click('#euPinBtn'); await p3.waitForTimeout(2500); ok(/4 tries left/.test(await p3.textContent('#euErr')), 'wrong PIN: ' + await p3.textContent('#euErr'));
  await p3.fill('#euPin', '2580'); await p3.click('#euPinBtn'); await unlocked(p3); ok(true, 'right PIN unlocks (counter reset)');
  await lock(p3);
  for (let i = 0; i < 5; i++) { await p3.fill('#euPin', '9999'); await p3.click('#euPinBtn'); await p3.waitForTimeout(2500); }
  ok(/erased/.test(await p3.textContent('#euErr')) && await p3.isHidden('#euPinBox'), '5 wrong PINs erase the quick PIN: ' + await p3.textContent('#euErr'));
  const st2 = await p3.evaluate(async () => [JSON.stringify(Object.keys(await Vault.getEasy())), [...window.__nb.store.keys()].join(',')]);
  ok(!/pin/.test(st2[0]) && !/pinpepper/.test(st2[1]), 'PIN record and pepper deleted (' + st2.join(' / ') + ')');
  await p3.fill('#uPass', '48203917'); await p3.click('#uBtn'); await unlocked(p3); ok(true, 'full passcode still unlocks');
  console.log('console errors:', errors.length ? errors.join(' | ') : 'none'); if (errors.length) fails++;
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS'); await browser.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
