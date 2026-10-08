/* MedBilling Logs - easy unlock (v9e; default from v9p). The passcode/passphrase always works and stays the root secret.
   - Web / PWA: a passkey with the WebAuthn PRF extension (Safari 18+, Chrome/Edge 116+ with a PRF-capable authenticator).
     The PRF output -> HKDF-SHA-256 -> AES-GCM key that wraps the vault key. Hidden where PRF is unsupported.
   - iOS / Android app: Face ID / Touch ID / fingerprint via @capgo/capacitor-native-biometric: a random wrap key lives in
     the Keychain / Android Keystore with biometric access control (BIOMETRY_CURRENT_SET: invalidated if biometrics change).
   - Quick PIN (4-6 digits, app only): PBKDF2-SHA-256 600,000 over the PIN + a 32-byte pepper kept in the Keychain/Keystore,
     so a copy of the app storage alone can't be brute-forced; wiped after 5 wrong tries. Not offered in browsers, where a
     short PIN could be attacked offline from a copy of the browser storage.
   Only ciphertext is stored (IndexedDB meta 'easy'); all of it is removed on passcode change and Delete all data.
   Easy unlock never opens exports: export passwords are always typed. */
(function (global) {
  'use strict';
  const V = global.Vault, te = new TextEncoder();
  const CAP = global.Capacitor, NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
  const NB = () => { if (!NATIVE) return null; try { return (CAP.Plugins && CAP.Plugins.NativeBiometric) || (CAP.registerPlugin ? CAP.registerPlugin('NativeBiometric') : null); } catch (e) { return null; } };
  const K_BIO = 'mbl.easy.bio.v1', K_PEP = 'mbl.easy.pinpepper.v1', MAX_PIN_TRIES = 5, ITER = 600000;
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const aad = m => te.encode('MedBilling Logs easy unlock v1:' + m);
  async function aesKey(bytes) { return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  async function wrap(k, raw, m) { const iv = rnd(12); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(m) }, k, raw)); return { iv: b64(iv), ct: b64(ct) }; }
  async function unwrap(k, o, m) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv), additionalData: aad(m) }, k, unb64(o.ct))); }
  async function hkdfKey(ikm, salt) {
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('MedBilling Logs passkey PRF wrap v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const err = (code, msg) => Object.assign(new Error(msg), { code });

  // ---------- capabilities
  let capCache = null;
  async function caps() {
    if (capCache) return capCache;
    const out = { native: NATIVE, passkey: false, platform: false, bio: false, bioName: '', pin: false };
    if (NATIVE) {
      const nb = NB();
      if (nb) {
        out.pin = true;
        try { const r = await nb.isAvailable({ useFallback: false }); out.bio = !!r.isAvailable; out.bioName = ({ 1: 'Touch ID', 2: 'Face ID', 3: 'fingerprint', 4: 'face unlock', 5: 'iris', 6: 'biometrics' })[r.biometryType] || 'biometrics'; } catch (e) { out.bio = false; }
      }
    } else if (global.PublicKeyCredential && global.isSecureContext && navigator.credentials) {
      try {
        // explicit "no PRF" -> hidden; unknown -> shown when a platform authenticator exists (turning it on checks PRF and says so if missing)
        const c = typeof PublicKeyCredential.getClientCapabilities === 'function' ? await PublicKeyCredential.getClientCapabilities().catch(() => ({})) : {};
        if (c['extension:prf'] === true) out.passkey = true;
        else if (c['extension:prf'] === false) out.passkey = false;
        else out.passkey = typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
      } catch (e) { out.passkey = false; }
      // v9p: a built-in authenticator (Touch ID / Face ID / Windows Hello) is what makes a passkey the default unlock on the web
      try { out.platform = out.passkey && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false); } catch (e) { out.platform = false; }
    }
    return (capCache = out);
  }
  async function status() { const r = await V.getEasy(); return { passkey: !!r.passkey, bio: !!r.bio, pin: !!r.pin, pinTriesLeft: r.pin ? MAX_PIN_TRIES - (r.pin.fails || 0) : 0 }; }
  async function save(patch) { const r = await V.getEasy(); for (const k of Object.keys(patch)) { if (patch[k] == null) delete r[k]; else r[k] = patch[k]; } if (!r.passkey && !r.bio && !r.pin) return V.delEasy(); return V.putEasy(r); }

  // ---------- passkey (WebAuthn PRF)
  async function prfOut(credId, salt, create) {
    if (create) return create;
    const a = await navigator.credentials.get({ publicKey: { challenge: rnd(32), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: credId }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
    const x = a && a.getClientExtensionResults && a.getClientExtensionResults().prf;
    if (!x || !x.results || !x.results.first) throw err('noprf', 'This passkey or browser does not support the PRF extension, so it can\u2019t unlock the app.');
    return new Uint8Array(x.results.first);
  }
  async function enablePasskey(raw) {
    const salt = rnd(32);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'MedBilling Logs', id: location.hostname }, user: { id: rnd(16), name: 'MedBilling Logs unlock', displayName: 'MedBilling Logs (this device)' },
      challenge: rnd(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, timeout: 60000, attestation: 'none',
      extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    if (!ext.prf || ext.prf.enabled === false) throw err('noprf', 'This passkey doesn\u2019t support the PRF extension needed to unlock the app. Try the device\u2019s built-in passkey (iCloud Keychain, Google Password Manager or Windows Hello).');
    const credId = new Uint8Array(cred.rawId);
    const out = await prfOut(credId, salt, ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null);
    const k = await hkdfKey(out, salt); out.fill(0);
    await save({ passkey: Object.assign({ v: 1, credId: b64(credId), salt: b64(salt), at: Date.now() }, await wrap(k, raw, 'passkey')) });
  }
  async function unlockPasskey() {
    const r = (await V.getEasy()).passkey; if (!r) throw err('off', 'Passkey unlock is off.');
    const salt = unb64(r.salt), out = await prfOut(unb64(r.credId), salt, null), k = await hkdfKey(out, salt); out.fill(0);
    try { return await unwrap(k, r, 'passkey'); } catch (e) { throw err('bad', 'That passkey can\u2019t unlock this app. Use your passcode.'); }
  }

  // ---------- Face ID / Touch ID / fingerprint (native)
  async function enableBio(raw) {
    const nb = NB(); if (!nb) throw err('unavail', 'Biometric unlock is not available.');
    const wk = rnd(32), c = await caps();
    await nb.setData({ key: K_BIO, value: b64(wk), accessControl: 1, title: `Turn on ${c.bioName} unlock`, negativeButtonText: 'Cancel' });
    const k = await aesKey(wk); wk.fill(0);
    await save({ bio: Object.assign({ v: 1, at: Date.now() }, await wrap(k, raw, 'bio')) });
  }
  async function unlockBio() {
    const r = (await V.getEasy()).bio; if (!r) throw err('off', 'Biometric unlock is off.');
    const nb = NB(); if (!nb) throw err('unavail', 'Biometric unlock is not available.');
    let v;
    try { v = (await nb.getSecureData({ key: K_BIO, reason: 'Unlock MedBilling Logs', title: 'Unlock MedBilling Logs', negativeButtonText: 'Use passcode', fallbackTitle: '' })).value; }
    catch (e) {
      const code = e && (e.code || (e.data && e.data.code)), msg = String(e && e.message || e);
      if (code == 21 || /No protected data/i.test(msg)) { await save({ bio: null }); throw err('gone', 'Your Face ID / fingerprint settings changed, so biometric unlock was turned off. Unlock with your passcode and turn it on again in Settings.'); }
      throw err('cancel', /cancel/i.test(msg) || code == 16 ? '' : 'Biometric unlock didn\u2019t work. Use your passcode.');
    }
    const wk = unb64(v), k = await aesKey(wk); wk.fill(0);
    try { return await unwrap(k, r, 'bio'); } catch (e) { throw err('bad', 'Biometric unlock didn\u2019t work. Use your passcode.'); }
  }

  // ---------- quick PIN (native only; pepper in Keychain/Keystore; 5 tries)
  async function pinKey(pin, salt, pepper) {
    const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
    const s = new Uint8Array(salt.length + pepper.length); s.set(salt); s.set(pepper, salt.length);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: s, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const pinOk = pin => /^\d{4,6}$/.test(pin) && !/^(\d)\1+$/.test(pin) && !'0123456789'.includes(pin) && !'9876543210'.includes(pin);
  async function enablePin(raw, pin) {
    if (!pinOk(pin)) throw err('weak', 'Use 4 to 6 digits, not all the same and not a straight sequence (1234).');
    const nb = NB(); if (!nb) throw err('unavail', 'Quick PIN is only available in the iPhone / Android app.');
    const pepper = rnd(32), salt = rnd(16);
    await nb.setData({ key: K_PEP, value: b64(pepper) });
    const k = await pinKey(pin, salt, pepper); pepper.fill(0);
    await save({ pin: Object.assign({ v: 1, salt: b64(salt), fails: 0, len: pin.length, at: Date.now() }, await wrap(k, raw, 'pin')) });
  }
  async function unlockPin(pin) {
    const e0 = await V.getEasy(), r = e0.pin; if (!r) throw err('off', 'Quick PIN is off.');
    const nb = NB(); if (!nb) throw err('unavail', 'Quick PIN is not available.');
    let pepper; try { pepper = unb64((await nb.getData({ key: K_PEP })).value); } catch (e) { await forgetPin(); throw err('gone', 'Quick PIN was reset. Use your passcode.'); }
    const k = await pinKey(pin, unb64(r.salt), pepper); pepper.fill(0);
    try { const raw = await unwrap(k, r, 'pin'); r.fails = 0; await save({ pin: r }); return raw; }
    catch (e) {
      r.fails = (r.fails || 0) + 1;
      if (r.fails >= MAX_PIN_TRIES) { await forgetPin(); throw err('wiped', 'Too many wrong PINs. Quick PIN was erased; unlock with your full passcode or passphrase.'); }
      await save({ pin: r }); throw err('wrong', `Wrong PIN. ${MAX_PIN_TRIES - r.fails} ${MAX_PIN_TRIES - r.fails === 1 ? 'try' : 'tries'} left before the quick PIN is erased.`);
    }
  }
  async function forgetPin() { await save({ pin: null }); const nb = NB(); if (nb) await nb.deleteData({ key: K_PEP }).catch(() => {}); }

  async function disable(m) {
    if (m === 'pin') return forgetPin();
    await save({ [m]: null });
    if (m === 'bio') { const nb = NB(); if (nb) await nb.deleteData({ key: K_BIO }).catch(() => {}); }
  }
  async function disableAll() { await V.delEasy().catch(() => {}); const nb = NB(); if (nb) { await nb.deleteData({ key: K_BIO }).catch(() => {}); await nb.deleteData({ key: K_PEP }).catch(() => {}); } }
  global.EasyUnlock = { caps, status, enablePasskey, unlockPasskey, enableBio, unlockBio, enablePin, unlockPin, pinOk, disable, disableAll, NATIVE, MAX_PIN_TRIES };
})(window);
