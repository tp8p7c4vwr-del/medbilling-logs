/* MedBilling Logs - app. Encounter timers use wall-clock timestamps (not intervals), so they stay
   correct across reloads, locking and backgrounding. All data lives in the encrypted Vault. */
(function () {
  'use strict';
  // v1's service worker served the cached page for navigations, so the first open after an update can pair the old page with
  // this script. Wait for the new service worker to take over, then reload once (no data is touched).
  if (!document.getElementById('eDxQ')) {
    const msg = document.getElementById('lockMsg'); if (msg) msg.textContent = 'Updating to the new version…';
    const go = () => { if (!sessionStorage.getItem('bl.upd')) { sessionStorage.setItem('bl.upd', '1'); location.reload(); } else if (msg) msg.textContent = 'Update ready. Close and reopen the app.'; };
    if ('serviceWorker' in navigator) { navigator.serviceWorker.addEventListener('controllerchange', go); navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {}); }
    setTimeout(go, 8000);
    return;
  }
  try { sessionStorage.removeItem('bl.upd'); } catch (e) { /* storage unavailable */ }
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const R = window.BLR, V = window.Vault;
  // ---- v9i Display (Settings → Display): text size slider (7 steps) and font style. Device-only preference in localStorage
  // (no patient data), applied through CSS variables before unlock, so the lock screen and the grid use it too.
  const DISP_KEY = 'bl.display.v1', TS = [11, 12, 13, 14, 16, 18, 20], TS_DEF = 13;
  const FONTS = { system: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Comfortaa,Manjari,"Arial Rounded MT Bold","Trebuchet MS",sans-serif',
    serif: 'ui-serif,"New York",Georgia,Cambria,"Times New Roman",Times,serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace' };
  const TOUCHQ = matchMedia('(max-width:767px),(pointer:coarse)'), NARROWQ = matchMedia('(max-width:699px)');
  function dispLoad() {
    let d = null; try { d = JSON.parse(localStorage.getItem(DISP_KEY) || 'null'); } catch (e) { d = null; }
    d = d && typeof d === 'object' ? d : {};
    return { fs: TS.includes(d.fs) ? d.fs : TS_DEF, font: Object.prototype.hasOwnProperty.call(FONTS, d.font) ? d.font : 'system' };
  }
  // row height follows the text (phones and touch: at least 40 px to tap comfortably); columns use the same scale (em / ch)
  function dispApply(d) {
    d = d || dispLoad(); const r = document.documentElement, st = r.style, fs = d.fs, touch = TOUCHQ.matches;
    const h = touch ? Math.max(40, Math.round(fs * 2.6)) : Math.max(28, Math.round(fs * 2.3));
    st.setProperty('--g-fs', fs + 'px'); st.setProperty('--g-h', h + 'px'); st.setProperty('--g-lh', Math.round(fs * 1.3) + 'px');
    st.setProperty('--app-k', String(Math.round((1 + (fs - TS_DEF) * 0.035) * 1000) / 1000)); st.setProperty('--app-font', FONTS[d.font]);
    r.dataset.fs = String(fs); r.dataset.font = d.font;
  }
  dispApply();
  // iPhone / iPad: grid text can be smaller than 16 px, so stop Safari's focus zoom (pinch-zoom still works on iOS)
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (IOS) { const vm = document.querySelector('meta[name=viewport]'); if (vm && !/maximum-scale/.test(vm.content)) vm.content += ', maximum-scale=1'; }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  const DEF = { defSetting: 'H', autolock: 2, prov: 'AB', curFac: null, favFac: [], customFac: [], bkEvery: 30, lastBackup: 0, bkSnooze: 0, abOn: false, abEvery: 60, abKeep: 24, abFmts: [], abZip: true, abPwMode: 'passcode', abNotes: false, abLoc: '',
    warnA: 60, warnR: 180, favSets: [], reviews: {}, revEdited: {}, holOff: [], holExtra: [],
    favFno: [], recFno: [], customFno: [], favFcen: [], fcCarry: true, fcLast: null, premWarn: true, premMax: {} };   // v9o: Facility # / Functional centre favourites, recent, carry-down   // v5: timer warnings, code sets, review marks, holidays
  const kindOf = R.kindOf, clone = o => JSON.parse(JSON.stringify(o));
  let FAC = null;
  let S = null;            // in-memory decrypted state while unlocked: {encs, settings}
  let tab = 'today', quickSet = 'H', lastAct = Date.now(), picking = 0;
  let blobUrls = [];
  let PROVS = [];          // codes-index list
  const codeCache = {};    // prov -> {meta, codes, index, byNorm}
  // MedBilling Fee Desk (companion app). Deep links carry only a code that exists in the bundled lists (never free text,
  // so no patient identifier can end up in a URL): #/code/<fee code> and #/medres/<ICD-9 code> are Fee Desk's own routes.
  const FD_ABS = 'https://tp8p7c4vwr-del.github.io/delara-medbilling/';
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  // the web app and Fee Desk share one origin (GitHub Pages): resolve Fee Desk next to this app, so a local copy pairs with a local Fee Desk
  const FD = !NATIVE && /^https?:$/.test(location.protocol) && /\/medbilling-logs\//.test(location.pathname) ? new URL('../delara-medbilling/', location.origin + location.pathname.replace(/[^/]*$/, '')).href : FD_ABS;
  let ICD = null;          // {meta, list, by, index} (Alberta Health ICD-9 list from Fee Desk, bundled)
  // v9 patient fields (encrypted with the entry). Never put name/MRN in URLs or console logs.
  const ptName = e => R.ptName(e);
  const ptMrn = e => R.ptMrn(e);
  const billingNoteOf = e => R.billingNoteOf(e);
  const displayWho = e => { const k = kindOf(e); if (k === 'shift') return (e.facility && e.facility.n) || 'On site'; return R.ptWho(e) || (k === 'cb' ? 'Call-back' : 'Encounter'); };
  const setMrn = (e, v) => { e.mrn = (v || '').trim(); e.chart = e.mrn; };   // keep chart mapped for older backups/exports
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2200); }
  const fmtDur = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${R.pad(m)}:${R.pad(s % 60)}`; };
  const today = () => R.dayKey(Date.now());

  // ------------------------------------------------------------ lock / unlock
  const failKey = 'bl.fail';
  const fails = () => { try { return JSON.parse(localStorage.getItem(failKey)) || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } };
  async function showLock(msg) {
    document.body.classList.add('locked');
    const has = await V.exists();
    $('#setupForm').hidden = has; $('#unlockForm').hidden = !has; if (has) { unlockUi(); euLockUi(true); } else kindUi();
    $('#lockMsg').textContent = msg || '';
    setTimeout(() => (has ? $('#uPass') : $('#sPass')).focus(), 50);
  }
  function lockNow(msg) {
    if (!S && document.body.classList.contains('locked')) return;
    if (cur && $('#editDlg').open) { try { V.saveDraft(editSnapshot()).catch(() => {}); } catch (e) { /* locked already */ } }
    else { const nd = nedDraft(); if (nd && S) { try { V.saveDraft({ note: nd }).catch(() => {}); } catch (e) { /* locked already */ } } }
    nedDraft(); nTipShow(null); if (fpk) { fpk.onPick = null; fpk.onDone = null; fpkClose(); }
    hideSnack(); flushPhotoDel(); stopWake();
    if (S && S.settings.abOn && abLocOk && abMode() !== 'manual' && V.unlocked()) { try { runBackup('lock', abSnapshot()); } catch (e) { /* never block locking */ } }
    V.lock(); S = null; premBase = null; premSeen.clear(); cur = null; sessPass = null; xpPw = null; xpAckSess = false; xpJob = null; gCell = null; viewDay = null;
    $$('dialog[open]').forEach(d => { if (d.id !== 'manDlg') d.close(); });   // the user manual holds no patient data; it stays open over the lock screen
    for (const u of blobUrls) URL.revokeObjectURL(u); blobUrls = [];
    ['#todayList', '#todayTotals', '#histList', '#ePhotos', '#eCodes', '#eCodeRes', '#eDxRes', '#credits', '#osList', '#deletedList', '#auditStatus', '#eLinks', '#facList', '#histBody', '#osInfo', '#lastBk', '#retInfo', '#eNotes', '#eSummary', '#rmSub'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    $$('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), textarea').forEach(i => { i.value = ''; });
    $('#pReady').hidden = true; repFile = null;
    placeFoot(); showLock(msg || 'Locked.');
  }
  $('#setupForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const a = $('#sPass').value, b = $('#sPass2').value, err = $('#sErr'), kind = sKind();
    const bad = loginCheck(kind, a); if (bad) return err.textContent = bad;
    if (a !== b) return err.textContent = kind === 'pin' ? 'The passcodes do not match.' : 'The passphrases do not match.';
    if (!$('#sAck').checked) return err.textContent = 'Please confirm you understand the warning.';
    if (!$('#sResp').checked) return err.textContent = 'Please accept the records responsibility statement.';
    err.textContent = ''; $('#sBtn').disabled = true; $('#sBtn').textContent = 'Creating…';
    try { await V.create(a, kind); sessPass = a; $('#sPass').value = $('#sPass2').value = ''; await afterUnlock(true); }
    catch (e) { err.textContent = 'Could not create the vault: ' + e.message; }
    $('#sBtn').disabled = false; $('#sBtn').textContent = 'Create passcode';
  });
  // v9d: login secret is a numeric passcode (6+ digits) or a passphrase (12+ characters, words and spaces allowed); same KDF either way
  const sKind = () => (($$('input[name=sKind]').find(r => r.checked) || {}).value) || 'pin';
  function loginCheck(kind, v) {
    if (kind === 'pin') {
      if (!/^\d+$/.test(v)) return 'A passcode uses digits only. For letters or words, choose Passphrase.';
      if (v.length < 6) return 'Use at least 6 digits.';
      if (/^(\d)\1+$/.test(v)) return 'Don\u2019t use the same digit repeated.';
      if ('01234567890123456789'.includes(v) || '98765432109876543210'.includes(v)) return 'Don\u2019t use a straight sequence like 123456.';
      return '';
    }
    if ([...v].length < 12) return `Use at least 12 characters for a passphrase (${[...v].length} so far). Several words with spaces work well.`;
    if (/^\s|\s$/.test(v)) return 'Remove the space at the start or end of the passphrase.';
    if (new Set(v.toLowerCase().replace(/\s/g, '')).size < 5) return 'Too repetitive. Use a few different words.';
    return '';
  }
  function kindUi() {
    const k = sKind(), pin = k === 'pin';
    $('#sLbl1').textContent = pin ? 'New passcode' : 'New passphrase'; $('#sLbl2').textContent = pin ? 'Repeat passcode' : 'Repeat passphrase';
    ['#sPass', '#sPass2'].forEach(s => { const i = $(s); if (pin) i.setAttribute('inputmode', 'numeric'); else i.removeAttribute('inputmode'); i.removeAttribute('minlength'); });
    $('#sKindHint').textContent = pin ? 'At least 6 digits. 8 or more is safer.' : 'At least 12 characters; words and spaces allowed (e.g. four unrelated words). Longer is safer and easier to remember.';
    $('#sBtn').textContent = pin ? 'Create passcode' : 'Create passphrase';
  }
  $$('input[name=sKind]').forEach(r => r.addEventListener('change', kindUi));
  async function unlockUi() {
    const k = await V.kind().catch(() => ''), i = $('#uPass');
    if (k === 'pin') i.setAttribute('inputmode', 'numeric'); else i.removeAttribute('inputmode');
    $('#uLbl').textContent = k === 'pin' ? 'Passcode' : k === 'phrase' ? 'Passphrase' : 'Passcode or passphrase';
  }
  // ---- v9e easy unlock (Face ID / Touch ID / fingerprint in the app, passkey PRF on the web, quick PIN in the app)
  const EU = window.EasyUnlock;
  const bioLbl = n => n === 'Face ID' || n === 'Touch ID' ? n : n === 'fingerprint' ? 'fingerprint' : n ? n : 'biometrics';
  let euAutoPending = false, euBusy = false;
  async function euLockUi(auto, keepMsg) {
    const box = $('#euLock'); if (!keepMsg) $('#euErr').textContent = '';
    if (!EU) { box.hidden = true; return {}; }
    let st, c; try { [st, c] = await Promise.all([EU.status(), EU.caps()]); } catch (e) { box.hidden = true; return {}; }
    const bio = st.bio && c.bio, key = st.passkey && c.passkey, pin = st.pin && c.pin;
    $('#euBio').hidden = !bio; $('#euBio').textContent = `Unlock with ${bioLbl(c.bioName)}`;
    $('#euKey').hidden = !key; $('#euPinBox').hidden = !pin; box.hidden = !(bio || key || pin);
    if (auto && bio) { euAutoPending = true; if (document.visibilityState === 'visible') setTimeout(euAuto, 350); }
    return { bio, key, pin };
  }
  function euAuto() { if (!euAutoPending || S || !document.body.classList.contains('locked') || $('#euBio').hidden || document.visibilityState !== 'visible') return; euAutoPending = false; $('#euBio').click(); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(euAuto, 350); });
  async function euDone(raw) {
    const ok = await V.unlockRaw(raw).catch(() => false); raw.fill(0);
    if (!ok) throw new Error('That didn\u2019t unlock the app. Use your passcode or passphrase.');
    localStorage.removeItem(failKey); $('#uErr').textContent = ''; $('#euErr').textContent = ''; $('#uPass').value = ''; $('#euPin').value = '';
    sessPass = null; await afterUnlock(false);
  }
  async function euTry(fn) {
    if (euBusy) return; euBusy = true; $('#euErr').textContent = '';
    try { await euDone(await fn()); }
    catch (e) { const m = e && e.name === 'NotAllowedError' ? '' : (e && e.message) || ''; $('#euErr').textContent = m; if (e && (e.code === 'gone' || e.code === 'wiped')) euLockUi(false, true); }
    euBusy = false;
  }
  $('#euBio').onclick = () => euTry(() => EU.unlockBio());
  $('#euKey').onclick = () => euTry(() => EU.unlockPasskey());
  $('#euPinBtn').onclick = () => { const p = $('#euPin').value; if (!/^\d{4,6}$/.test(p)) { $('#euErr').textContent = 'Enter your 4 to 6 digit PIN.'; return; } euTry(async () => { try { return await EU.unlockPin(p); } finally { $('#euPin').value = ''; } }); };
  $('#euPin').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#euPinBtn').click(); } });
  async function euRender() {
    if (!EU || !S) return;
    let c, st; try { [c, st] = await Promise.all([EU.caps(), EU.status()]); } catch (e) { $('#euCard').hidden = true; return; }
    const showBio = c.native ? c.bio : c.passkey;
    $('#euBioL').hidden = !showBio; $('#euPinL').hidden = !c.pin; $('#euCard').hidden = !(showBio || c.pin);
    $('#euBioLbl').textContent = c.native ? `Unlock with ${bioLbl(c.bioName)}` : 'Unlock with a passkey (Face ID / Touch ID / Windows Hello)';
    $('#euBioOn').checked = c.native ? st.bio : st.passkey; $('#euPinOn').checked = st.pin;
    $('#euInfo').textContent = (c.native ? `${bioLbl(c.bioName)} unlocks with a key kept in this device's ${/Android/i.test(navigator.userAgent) ? 'Android Keystore' : 'Keychain'}; it stops working if your ${bioLbl(c.bioName)} enrolment changes.` : 'A passkey on this device (or synced in your password manager) unlocks the app through the WebAuthn PRF extension.')
      + ' Your passcode or passphrase always works and is never replaced. Easy unlock turns off when you change the passcode, and it never opens exports: export passwords are always typed.';
  }
  async function euEnable(kind) {
    const pin = kind === 'pin';
    const fields = [{ id: 'p', label: 'Current passcode or passphrase' }].concat(pin ? [{ id: 'n1', label: 'New quick PIN (4–6 digits)' }, { id: 'n2', label: 'Repeat the PIN' }] : []);
    let raw = null;
    const v = await ask({ title: pin ? 'Turn on quick PIN' : 'Turn on easy unlock', text: pin ? 'Enter your passcode or passphrase once, then choose a 4–6 digit PIN. After 5 wrong PINs the quick PIN is erased and you need the full passcode.' : 'Enter your passcode or passphrase once to turn it on. It stays your fallback.', ok: 'Turn on', fields,
      check: async v => { if (pin && !EU.pinOk(v.n1)) return 'Use 4 to 6 digits, not all the same and not a straight sequence (1234).'; if (pin && v.n1 !== v.n2) return 'The PINs do not match.'; raw = await V.rawKey(v.p).catch(() => null); return raw ? '' : 'Wrong passcode or passphrase.'; } });
    if (!v || !raw) return false;
    const c = await EU.caps();
    try {
      if (pin) await EU.enablePin(raw, v.n1); else if (c.native) await EU.enableBio(raw); else await EU.enablePasskey(raw);
      const what = pin ? 'Quick PIN' : c.native ? bioLbl(c.bioName) : 'Passkey';
      await V.appendAudit({ action: 'easy-unlock', note: `${what} unlock turned on` }).catch(() => {}); toast(`${what} unlock is on`); return true;
    } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Cancelled' : 'Could not turn it on: ' + ((e && e.message) || e), 4500); return false; }
    finally { raw.fill(0); }
  }
  async function euToggle(kind, on) {
    if (!S) return;
    if (on) await euEnable(kind);
    else { const c = await EU.caps(), m = kind === 'pin' ? 'pin' : c.native ? 'bio' : 'passkey'; await EU.disable(m); await V.appendAudit({ action: 'easy-unlock', note: `${m === 'pin' ? 'Quick PIN' : m === 'bio' ? bioLbl(c.bioName) : 'Passkey'} unlock turned off` }).catch(() => {}); toast('Turned off'); }
    euRender();
  }
  $('#euBioOn').onchange = () => euToggle('bio', $('#euBioOn').checked);
  $('#euPinOn').onchange = () => euToggle('pin', $('#euPinOn').checked);
  $('#unlockForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const err = $('#uErr'), f = fails();
    if (f.until > Date.now()) return err.textContent = `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`;
    $('#uBtn').disabled = true; $('#uBtn').textContent = 'Unlocking…';
    const ok = await V.unlock($('#uPass').value).catch(() => false);
    $('#uBtn').disabled = false; $('#uBtn').textContent = 'Unlock';
    if (!ok) {
      f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, f.n - 5));
      localStorage.setItem(failKey, JSON.stringify(f));
      err.textContent = f.n >= 5 ? `Wrong passcode or passphrase. Wait ${Math.round((f.until - Date.now()) / 1000)} s before trying again.` : 'Wrong passcode or passphrase.';
      $('#uPass').select(); return;
    }
    localStorage.removeItem(failKey); err.textContent = ''; sessPass = $('#uPass').value; $('#uPass').value = '';
    await afterUnlock(false);
  });
  $('#forgot').addEventListener('click', () => ask({ title: 'Forgot passcode', text: "The passcode is never stored, so there is no way to recover it or decrypt your data. If you can't remember it, the only option is to delete all data on this device and start again (you can then import an encrypted backup if you remember that backup's passcode). Type DELETE to erase everything.", fields: [{ id: 'conf', label: 'Type DELETE', type: 'text' }], ok: 'Delete everything', danger: true,
    check: v => v.conf.trim().toUpperCase() === 'DELETE' ? '' : 'Type DELETE to confirm.' }).then(async v => { if (!v) return; if (window.EasyUnlock) await EasyUnlock.disableAll().catch(() => {}); await V.wipe(); await abForget(); localStorage.removeItem(failKey); showLock('All data deleted. Create a new passcode.'); }));
  // built-in user manual (static, offline; no patient data). Reachable from the lock screen, Settings and the footer.
  const manDlg = $('#manDlg');
  $$('.manlink').forEach(b => b.addEventListener('click', () => { if (!manDlg.open) { manDlg.showModal(); $('#manBody').scrollTop = 0; manDlg.scrollTop = 0; } }));
  $('#manClose').addEventListener('click', () => manDlg.close());
  $$('#manBody [data-go]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); const t = document.getElementById(a.dataset.go); if (t) t.scrollIntoView({ block: 'start' }); }));
  async function afterUnlock(first) {
    const settings = Object.assign({}, DEF, await V.loadSettings());
    const encs = await V.loadAll();
    S = { encs, settings };
    await migrateNotes();
    if (first) { settings.created = Date.now(); settings.respAccepted = Date.now(); await V.saveSettings(settings); }
    quickSet = settings.defSetting; lastAct = Date.now();
    document.body.classList.remove('locked'); window.scrollTo(0, 0);
    R.setHolidays({ off: settings.holOff, extra: settings.holExtra });
    $('#defSetting').value = settings.defSetting; $('#autolock').value = String(settings.autolock); $('#warnA').value = String(settings.warnA); $('#warnR').value = String(settings.warnR);
    fillProv($('#defProv'), settings.prov); euRender();
    renderCredits(); setQuick(); render(); renderRetention(); fpSetUi(); premSetUi(); checkBackupDue(); renderPeriodSettings(); abInit().catch(() => {});
    if (first) toast('Passcode set. Your logs are encrypted on this device.', 3500);
    else { const d = await V.loadDraft().catch(() => null); if (d && d.cur) { await V.clearDraft(); restoreDraft(d); toast('Restored your unsaved entry', 3000); } else if (d && d.note) { await V.clearDraft(); nedRestore(d.note); } else checkLongTimers(); }
    await pickApply();
  }
  // v7: the single 280-character note of older versions becomes the first timestamped note (audit-logged, stays encrypted)
  async function migrateNotes() {
    for (let i = 0; i < S.encs.length; i++) {
      const e = S.encs[i]; if (Array.isArray(e.notes) || !('note' in e)) continue;
      const before = clone(e), x = clone(e), txt = String(e.note || '').trim();
      x.notes = txt ? [{ id: 'n0', t: e.created || R.startOf(e), x: txt }] : []; delete x.note;
      S.encs[i] = x; await V.save(x);
      if (txt) await V.appendAudit({ action: 'migrate', eid: x.id, kind: kindOf(x), before, after: clone(x), note: 'Note moved into the new notes list (v7)' });
    }
  }
  // inactivity + background auto-lock
  ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'].forEach(t => document.addEventListener(t, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (S && fdSince && picking && Date.now() - fdSince > FD_GRACE) { picking = 0; fdSince = 0; lockNow('Locked after 10 minutes in Fee Desk.'); return; }   // v9g: the pick grace has a limit
    if (S && !picking && Date.now() - lastAct > (S.settings.autolock || 2) * 60000) lockNow('Locked after inactivity.');
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S && !picking) lockNow('Locked because the app went to the background.'); });
  window.addEventListener('pagehide', () => { if (S && !picking) lockNow(); });
  // file pickers / share sheets briefly hide the page; don't lock for those
  function pickStart() { picking++; }
  function pickEnd() { setTimeout(() => { picking = Math.max(0, picking - 1); lastAct = Date.now(); }, 800); }
  window.addEventListener('focus', () => { if (picking) pickEnd(); if (fdSince) fdBack(); });
  $('#lockNow').addEventListener('click', () => lockNow());
  $('#lockNow2').addEventListener('click', () => lockNow());

  // ------------------------------------------------------------ persistence
  async function saveEnc(e, action, note, quiet) {
    const i = S.encs.findIndex(x => x.id === e.id), before = i < 0 ? null : clone(S.encs[i]);
    premDirty(before); premDirty(e);   // v9o: time-premium counts to re-check
    e.kind = kindOf(e); e.updated = Date.now();
    if (i < 0) S.encs.push(e); else S.encs[i] = e;
    await V.save(e);
    await V.appendAudit({ action: action || (before ? 'edit' : 'create'), eid: e.id, kind: e.kind, before, after: clone(e), note: note || undefined });
    if (!quiet) await reviewTouch([before, e], `${R.KIND[e.kind] || 'entry'} ${action || 'edit'} after review`);
  }
  // defer: keep the photos for a few seconds so Undo can bring the entry back whole (removed on timeout or lock)
  async function deleteEnc(e, note, defer) {
    const before = S.encs.find(x => x.id === e.id), ph = (before && before.photos) || [];
    if (!defer) for (const p of ph) await V.removePhoto(p);
    premDirty(before || e); await V.remove(e.id); S.encs = S.encs.filter(x => x.id !== e.id);
    await V.appendAudit({ action: 'delete', eid: e.id, kind: kindOf(e), before: before ? clone(before) : null, after: null, note: [note, ph.length ? `${ph.length} photo(s) removed with the entry` : ''].filter(Boolean).join('. ') || undefined });
    await reviewTouch([before], 'entry deleted after review');
    return ph;
  }
  async function saveSettings() { await V.saveSettings(S.settings); }

  // ------------------------------------------------------------ encounters
  function setQuick() { /* v9c: the blank rows show the default setting (quickSet); nothing else to sync */ }
  async function act(e, a, note) {
    const now = Date.now(), prev = clone(e);
    e = clone(e);
    const l2 = e.segs[e.segs.length - 1]; if (!l2 && a !== 'resume') return;
    if (a === 'pause' && l2 && l2.e == null) { l2.e = now; e.status = 'pause'; }
    else if (a === 'resume') { e.segs.push({ s: now, e: null }); e.status = 'run'; }
    else if (a === 'stop') { if (l2 && l2.e == null) l2.e = now; e.status = 'done'; }
    else return;
    await saveEnc(e, a, note); render();
    if (a === 'stop') snack(`Stopped ${displayWho(e)}`, () => undoTo(prev, e, 'Stop undone'));
  }
  // ============================================================ v9c spreadsheet grid (Today screen + each History day)
  // One component: a real <table class="grid"> with a grey header row, grey row numbers, gridlines on every cell, blank rows
  // below the real ones (typing in one creates the encounter), a totals row, and Sheets-style keyboard navigation.
  // Name / MRN / notes / codes are encrypted with the entry (saveEnc). Never put them in URLs or console logs.
  const COLS = [['rn', '#'], ['name', 'Patient name'], ['mrn', 'MRN / PHN'], ['hc', 'H/C'], ['tin', 'In'], ['tout', 'Out'], ['min', 'Min'], ['u', 'Units'], ['fno', 'Facility #'], ['fcen', 'Functional centre'], ['fee', 'Fee code(s)'], ['mod1', 'Modifier code 1'], ['mod2', 'Modifier code 2'], ['dx', 'Dx (ICD-9)'], ['note', 'Billing notes'], ['act', '']];
  const NAV = ['name', 'mrn', 'hc', 'tin', 'tout', 'fno', 'fcen', 'fee', 'mod1', 'mod2', 'dx', 'note'];   // v9o: Facility #, Functional centre before Fee code(s)
  const FPC = { fno: 1, fcen: 1 };   // v9o picker cells (Facility #, Functional centre)
  // v9k: two modifier-code columns after Fee code(s); each cell may hold several codes (stored normalised: "CMGP, BMI")
  const modOf = (e, n) => R.modTxt(e, n), MOD_MAX = 200, CODE_MAX = 200;   // v9m: room for 10+ codes with separators (was 80 / 60)
  const MIN_BLANK = 15;
  // v9h endless rows: when the cursor (or the scroll) gets within GROW_NEAR rows of the end, GROW_BY more empty rows are added.
  // rowsMin remembers how many rows a day's grid has grown to (memory only), so a redraw never takes rows away.
  // Empty rows are only HTML: never saved, never in totals, reports or exports.
  const GROW_NEAR = 5, GROW_BY = 10, rowsMin = {};
  let viewDay = null;                       // null = follow today
  const curDay = () => viewDay || today();
  const blankSet = {};                      // H/C chosen on a still-empty row (row key -> 'H'|'C')
  let gCell = null, gEdit = false, gMouse = null, histDirty = false, histStale = false, gQ = Promise.resolve(), todayResort = false, gShiftEnter = false;
  const durTxt = (e, m) => kindOf(e) === 'shift' ? `${Math.floor(m / 60)}:${R.pad(m % 60)}` : String(m);
  const uerr = m => Object.assign(new Error(m), { user: true });
  const shiftDay = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return R.dayKey(d.getTime()); };
  // wall-clock HH:MM on an Edmonton calendar day -> timestamp (DST-safe; falls back to device time)
  function edmAt(k, h, mi) {
    const [y, mo, d] = k.split('-').map(Number), base = Date.UTC(y, mo - 1, d, h, mi);
    for (const off of [6, 7, 5, 8]) { const t = base + off * 3600000, w = R.edm(t); if (w.key === k && w.h === h && w.mi === mi) return t; }
    return new Date(y, mo - 1, d, h, mi).getTime();
  }
  // "9:30", "0930", "930", "9", "21h05", "now" / "n"
  function parseHm(v) {
    v = String(v || '').trim().toLowerCase(); if (v === 'n' || v === 'now' || v === '.') return 'now';
    const m = v.match(/^(\d{1,2})[:h.\s]?(\d{2})$/) || v.match(/^(\d{1,2})$/); if (!m) return null;
    const h = +m[1], mi = m[2] ? +m[2] : 0; return h > 23 || mi > 59 ? null : [h, mi];
  }
  const gColgroup = '<colgroup>' + COLS.map(c => `<col class="c-${c[0]}">`).join('') + '</colgroup>';
  const gHead = '<thead><tr>' + COLS.map(c => `<th scope="col" class="h-${c[0]}" data-h="${c[0]}"${c[0] === 'act' ? ' aria-label="Row actions"' : ''}${/^mod/.test(c[0]) ? ' title="Modifier code(s); separate several with a comma or space"' : c[0] === 'fno' ? ' title="AHCIP facility number (Alberta Health facility listing). Tap to pick; favourites first"' : c[0] === 'fcen' ? ' title="Functional centre (CLNC, D/N, EMRG, MED, SURG…). Tap to pick"' : ''}>${esc(c[1])}</th>`).join('') + '</tr></thead>';
  // v9f: name, fee, dx and notes wrap (auto-growing textarea, height set by autoH after the widths are fitted), the rest stay one line.
  // Every editor has enterkeyhint="next": the phone's return key moves to the next cell, exactly like Tab / Enter.
  const WRAP = { name: 1, fee: 1, mod1: 1, mod2: 1, dx: 1 };   // v9i: Billing notes is a preview + notes editor; v9k: modifiers wrap too
  const gAttrs = (c, o) => `class="gc${o.mono ? ' mono' : ''}" data-c="${c}" maxlength="${o.max || 80}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''} aria-label="${esc(o.lbl)}"${o.title ? ` title="${esc(o.title)}"` : ''} autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next"${o.im ? ` inputmode="${o.im}"` : ''}${o.cap ? ` autocapitalize="${o.cap}"` : ''}`;
  // v9i: Billing notes shows a one-line preview; tapping / clicking it (or typing on it) opens the notes editor.
  // On narrow screens Patient name is a one-line field (ellipsis); the full name shows in a bubble while it has focus.
  const notePrev = v => String(v || '').replace(/\s*\n+\s*/g, ' ↵ ');
  const gInp = (c, val, o) => FPC[c] ? fpCell(c, o.e || null, o.lbl) : c === 'note' ? `<div class="gc nprev" data-c="note" tabindex="0" role="button" aria-label="${esc(o.lbl)}. Opens the notes editor" data-v="${esc(val)}">${esc(notePrev(val))}</div>`
    : WRAP[c] && !(c === 'name' && NARROWQ.matches) ? `<textarea rows="1" ${gAttrs(c, o)}>${esc(val)}</textarea>`
    : `<input ${gAttrs(c, o)} value="${esc(val)}">`;
  const hcBtn = (v, lbl) => `<button type="button" class="gc hc" data-c="hc" aria-label="${esc(lbl)}: ${R.SET[v]}. Tap to switch" title="${R.SET[v]} (tap, or type H / C)">${v}</button>`;
  function gridRow(e, i) {
    const k = kindOf(e), st = e.status, ms = R.msOf(e), m = Math.floor(ms / 60000), cs = e.codes || [], dx = R.dxList(e);
    const started = e.segs.length > 0, en = R.endOf(e), open = started && en == null, ed = k !== 'shift', id = esc(e.id);
    const nameVal = ptName(e), mrnVal = ptMrn(e), feeVal = cs.map(c => c.c).join(', '), dxVal = dx.join(', ');
    const tags = (k === 'cb' ? '<i class="tag cb" title="Call-back">CB</i>' : '') + (e.pt && S.encs.some(x => x.pt === e.pt && x.id !== e.id) ? '<i class="tag" title="Same patient as another encounter">↔</i>' : '') + ((e.photos || []).length ? `<i class="tag" title="${e.photos.length} photo(s)">📷${e.photos.length}</i>` : '') + (R.notesOf(e).length ? `<i class="tag" title="${R.notesOf(e).length} note(s) in details">✎</i>` : '');
    const name = ed ? gInp('name', nameVal, { lbl: 'Patient name', ph: nameVal ? '' : (e.label || e.initials || ''), title: !nameVal && (e.label || e.initials) ? [e.label, e.initials].filter(Boolean).join(' · ') : '' })
      : `<span class="gtxt">On site${e.facility ? ' · ' + esc(e.facility.n) : ''}</span>`;
    const multi = e.segs.length > 1 ? ` (${e.segs.length} segments)` : '';
    const tin = gInp('tin', started ? R.hm(R.startOf(e)) : '', { lbl: 'Time in (24-hour HH:MM)', mono: 1, max: 5, im: 'numeric', title: started ? 'In' + multi + (perTxtOf(e) ? ' · ' + perTxtOf(e) : '') : 'Type a time, or tap ▶ to start now' })
      + (started ? (e.late ? '<i class="tag lt" title="Entered later (typed or corrected after the fact)">*</i>' : '') : `<button type="button" class="cbtn now soft" data-a="now" tabindex="-1" title="Start the clock now" aria-label="Start now">▶</button>`);
    const tout = open ? gInp('tout', '', { lbl: 'Time out (24-hour HH:MM). Running', mono: 1, max: 5, im: 'numeric', title: 'Running. Type the end time, or tap ■ to stop now' }) + '<button type="button" class="cbtn stop" data-a="stop" tabindex="-1" title="Stop now" aria-label="Stop now">■</button>'
      : gInp('tout', started ? R.hm(en) : '', { lbl: 'Time out (24-hour HH:MM)', mono: 1, max: 5, im: 'numeric', title: st === 'pause' ? 'Paused (⋯ to resume)' : 'Out' + multi });
    const fee = ed ? gInp('fee', feeVal, { lbl: 'Fee code(s)', mono: 1, max: CODE_MAX, cap: 'characters', title: cs.map(c => c.c + (c.d ? ' ' + c.d : '')).join('; ') })
      + `<button type="button" class="cbtn hov pickfd" data-kind="fee" tabindex="-1" title="Pick a fee code in Fee Desk (tap a code there and it comes back to this cell)" aria-label="Pick fee code in Fee Desk">↗</button>${feeVal ? `<button type="button" class="cbtn hov fdmini pickfd" data-kind="fee" data-at="${esc((cs[cs.length - 1] && (cs[cs.length - 1].k || cs[cs.length - 1].c)) || '')}" tabindex="-1" title="Open ${esc(cs[cs.length - 1] && cs[cs.length - 1].c)} in Fee Desk (pick another code there to add it)" aria-label="Open fee code in Fee Desk">ⓘ</button>` : ''}` : '';
    const dxc = ed ? gInp('dx', dxVal, { lbl: 'Diagnostic code(s), ICD-9', mono: 1, max: CODE_MAX, cap: 'characters', title: dx.map(v => v + (dxDesc(v) ? ' ' + dxDesc(v) : '')).join('; ') })
      + `<button type="button" class="cbtn hov pickfd" data-kind="dx" tabindex="-1" title="Pick an ICD-9 code in Fee Desk (tap a code there and it comes back to this cell)" aria-label="Pick diagnostic code in Fee Desk">↗</button>${dxVal ? `<button type="button" class="cbtn hov fdmini pickfd" data-kind="dx" data-at="${esc(dx[dx.length - 1])}" tabindex="-1" title="Open ${esc(dx[dx.length - 1])} in Fee Desk (pick another code there to add it)" aria-label="Open diagnostic code in Fee Desk">ⓘ</button>` : ''}` : '';
    const modc = n => { if (!ed) return ''; const inp = gInp('mod' + n, modOf(e, n), { lbl: 'Modifier code(s) ' + n, mono: 1, max: MOD_MAX, cap: 'characters' }), ch = muChips(e, n); return `<div class="cw mucw">${inp}${ch}</div>`; };   // v9o: always wrapped, so a units chip can appear beside a focused cell
    const wl = warnLvl(e);
    return `<tr class="gr ${st} k-${k}${wl ? ' w' + wl : ''}" data-key="${id}" data-id="${id}">`
      + `<th scope="row" class="rn" title="Row ${i}. Right-click or press and hold for actions">${st === 'run' || st === 'pause' ? `<i class="dot ${st}" aria-label="${st === 'run' ? 'Running' : 'Paused'}"></i>` : ''}${i}</th>`
      + `<td class="c-name"><div class="cw">${name}${tags}</div></td>`
      + `<td class="c-mrn">${ed ? gInp('mrn', mrnVal, { lbl: 'MRN or PHN', mono: 1, max: 24 }) : ''}</td>`
      + `<td class="c-hc">${ed ? hcBtn(e.setting === 'C' ? 'C' : 'H', 'Hospital or clinic') : '<span class="gtxt mid">–</span>'}</td>`
      + `<td class="c-tin"><div class="cw">${tin}</div></td>`
      + `<td class="c-tout"><div class="cw">${tout}</div></td>`
      + `<td class="num c-min${open ? ' live' : ''}" data-rm="${id}" title="${started ? (k === 'shift' ? 'Hours on site' : m + ' min') : 'Not started'}">${started ? (open ? fmtDur(ms) : durTxt(e, m)) : ''}</td>`
      + `<td class="num c-u" data-ru="${id}">${started && ed ? R.units(m) : ''}</td>`
      + `<td class="c-fno">${ed ? gInp('fno', '', { e, lbl: 'Facility #' }) : ''}</td><td class="c-fcen">${ed ? gInp('fcen', '', { e, lbl: 'Functional centre' }) : ''}</td>`
      + `<td class="c-fee"><div class="cw">${fee}</div></td>`
      + `<td class="c-mod1">${modc(1)}</td><td class="c-mod2">${modc(2)}</td>`
      + `<td class="c-dx"><div class="cw">${dxc}</div></td>`
      + `<td class="c-note">${ed ? gInp('note', billingNoteOf(e), { lbl: 'Billing notes', max: 500 }) : ''}</td>`
      + `<td class="c-act"><button type="button" class="rmore" data-a="more" tabindex="-1" aria-label="Row actions" title="Timer, add time, segments and photos, same patient, delete">⋯</button></td></tr>`;
  }
  // v9o: unit count chip(s) beside a time-unit modifier (TEV, TNTP, TNTA, TWK, TST, TDES, EV, NTPM, NTAM, WK)
  function muChips(e, n) {
    const cs = R.muCodes(e, n); if (!cs.length) return '';
    return cs.map(c => { const u = R.muOf(e, c), sg = R.muSuggest(e, c), hi = u && R.muFrom(u) > R.minsOf(e);
      const tt = (u ? `${c}: ${R.p2(u)} unit${u === 1 ? '' : 's'} = ${R.muMin(u)} min` : `${c}: no units yet`) + (sg ? `. Suggested from In / Out: ${R.p2(sg)}` : '') + (hi ? `. More units than the ${R.minsOf(e)} min logged` : '') + '. Tap to pick 01–20 (or F4 / Alt+↓ in the cell)';
      return `<button type="button" class="cbtn mub${u ? ' set' : ' need'}${hi ? ' hiu' : ''}" data-mu="${c}" data-mn="${n}" tabindex="-1" title="${esc(tt)}" aria-label="${esc(tt)}">${cs.length > 1 ? c + ' ' : ''}${u ? '×' + R.p2(u) : 'u?'}</button>`; }).join('');
  }
  const perTxtOf = e => { const p = R.periodSplit(e).parts.filter(x => !R.PBY[x.id].regular); return p.length ? R.perTxt(p, true) : ''; };
  // v9h: rows far below the work area are "light": the same cells without editors (hundreds of empty textareas would slow
  // every keystroke). A light row gets its editors the moment the cursor moves to it or it is tapped (lightUp).
  const lightRow = i => `<tr class="gr blank light" data-key="r${i}" data-blank="1" data-light="1"><th scope="row" class="rn">${i}</th><td class="c-name"></td><td class="c-mrn"></td><td class="c-hc dim"></td><td class="c-tin"></td><td class="c-tout"></td><td class="num c-min"></td><td class="num c-u"></td><td class="c-fno"></td><td class="c-fcen"></td><td class="c-fee"></td><td class="c-mod1"></td><td class="c-mod2"></td><td class="c-dx"></td><td class="c-note"></td><td class="c-act"></td></tr>`;
  function lightUp(tr) {
    if (!tr || !tr.dataset.light) return tr;
    const tpl = document.createElement('template'); tpl.innerHTML = '<table><tbody>' + blankRow(tr.sectionRowIndex + 1, false) + '</tbody></table>';
    const nr = tpl.content.querySelector('tr'), nc = [...nr.cells];
    [...tr.cells].forEach((c, k) => { if (nc[k] && !c.querySelector('.gc, button')) c.replaceWith(nc[k]); });
    delete tr.dataset.light; tr.classList.remove('light');
    return tr;
  }
  function blankRow(i, first, light) {
    if (light) return lightRow(i);
    const key = 'r' + i, set = blankSet[key] || quickSet;
    return `<tr class="gr blank" data-key="${key}" data-blank="1"><th scope="row" class="rn">${i}</th>`
      + `<td class="c-name"><div class="cw">${gInp('name', '', { lbl: 'Patient name (new row)', ph: first ? 'Patient name…' : '' })}</div></td>`
      + `<td class="c-mrn">${gInp('mrn', '', { lbl: 'MRN or PHN (new row)', mono: 1, max: 24, ph: first ? 'MRN / PHN' : '' })}</td>`
      + `<td class="c-hc dim${blankSet[key] ? ' set' : ''}">${hcBtn(set, 'Hospital or clinic for a new row')}</td>`
      + `<td class="c-tin"><div class="cw">${gInp('tin', '', { lbl: 'Time in (new row)', mono: 1, max: 5, im: 'numeric', ph: first ? 'HH:MM' : '' })}<button type="button" class="cbtn now${first ? '' : ' hov'}" data-a="now" tabindex="-1" title="New row, start the clock now" aria-label="New row, start now">▶</button></div></td>`
      + `<td class="c-tout">${gInp('tout', '', { lbl: 'Time out (new row)', mono: 1, max: 5, im: 'numeric' })}</td>`
      + '<td class="num c-min"></td><td class="num c-u"></td>'
      + `<td class="c-fno">${gInp('fno', '', { lbl: 'Facility # (new row)' })}</td><td class="c-fcen">${gInp('fcen', '', { lbl: 'Functional centre (new row)' })}</td>`
      + `<td class="c-fee"><div class="cw">${gInp('fee', '', { lbl: 'Fee code(s) (new row)', mono: 1, max: CODE_MAX, cap: 'characters' })}<button type="button" class="cbtn hov pickfd" data-kind="fee" tabindex="-1" title="New row: pick a fee code in Fee Desk (it comes back to this cell)" aria-label="New row, pick fee code in Fee Desk">↗</button></div></td>`
      + `<td class="c-mod1"><div class="cw mucw">${gInp('mod1', '', { lbl: 'Modifier code(s) 1 (new row)', mono: 1, max: MOD_MAX, cap: 'characters' })}</div></td>`
      + `<td class="c-mod2"><div class="cw mucw">${gInp('mod2', '', { lbl: 'Modifier code(s) 2 (new row)', mono: 1, max: MOD_MAX, cap: 'characters' })}</div></td>`
      + `<td class="c-dx"><div class="cw">${gInp('dx', '', { lbl: 'Diagnostic code(s) (new row)', mono: 1, max: CODE_MAX, cap: 'characters' })}<button type="button" class="cbtn hov pickfd" data-kind="dx" tabindex="-1" title="New row: pick an ICD-9 code in Fee Desk (it comes back to this cell)" aria-label="New row, pick diagnostic code in Fee Desk">↗</button></div></td>`
      + `<td class="c-note">${gInp('note', '', { lbl: 'Billing notes (new row)', max: 500 })}</td><td class="c-act"></td></tr>`;
  }
  function gTotals(list) {
    const enc = list.filter(e => kindOf(e) !== 'shift'), t = R.totals(enc), site = R.totals(list.filter(e => kindOf(e) === 'shift')).site;
    return { n: enc.length, m: t.H.m + t.C.m + t.cb.m, u: t.H.u + t.C.u + t.cb.u, det: [t.H.n && `H ${t.H.m} min / ${t.H.u} u`, t.C.n && `C ${t.C.m} min / ${t.C.u} u`, t.cb.n && `CB ${t.cb.n} · ${t.cb.m} min`, site.n && `on site ${R.hmin(site.m)}`].concat(t.perList.map(p => `${R.PBY[p.id].short} ${p.m}m/${p.u}u`)).filter(Boolean).join(' · ') };
  }
  function gFoot(list) {
    const t = gTotals(list);
    return `<tfoot><tr class="gt"><th scope="row" class="rn" aria-label="Totals">Σ</th><td class="c-name"><span class="gtxt" data-tn>${t.n} encounter${t.n === 1 ? '' : 's'}</span></td><td></td><td></td><td></td><td class="tl"><span class="gtxt">Total</span></td><td class="num" data-tm title="Total minutes">${t.m}</td><td class="num" data-tu title="Total units">${t.u}</td><td colspan="7" class="tdet"><span class="gtxt" data-td>${esc(t.det)}</span></td><td></td></tr></tfoot>`;
  }
  function sheetHtml(list, o) {
    let rows = '';
    const lf = o.lightFrom || Infinity, lt = i => i >= lf && 'r' + i !== o.keepKey;   // v9h: light rows (no editors) from row lightFrom on
    if (o.seq) { const fb = o.seq.indexOf(null); o.seq.forEach((e, i) => { rows += e ? gridRow(e, i + 1) : blankRow(i + 1, i === fb, lt(i + 1)); }); }   // v9f: rows kept where they are while editing
    else { rows = list.map((e, i) => gridRow(e, i + 1)).join(''); for (let j = 0; j < (o.blank || 0); j++) rows += blankRow(list.length + j + 1, j === 0, lt(list.length + j + 1)); }
    return `<table class="grid${o.main ? ' main' : ''}" data-day="${esc(o.day)}" aria-label="${esc((o.main ? 'Spreadsheet for ' : '') + R.fmtDay(o.day))}">${gColgroup}${gHead}<tbody>${rows}</tbody>${gFoot(list)}</table>`;
  }
  // rows shown for a day: Today also keeps running / paused entries from earlier days at the top
  function dayList(day, main) {
    const td = today();
    return S.encs.filter(e => main ? kindOf(e) !== 'shift' && (R.encDay(e) === day || (day === td && R.encDay(e) < td && (e.status === 'run' || e.status === 'pause'))) : R.encDay(e) === day)
      .sort((a, b) => R.startOf(a) - R.startOf(b) || (a.created || 0) - (b.created || 0));
  }
  // ---- DOM patching: never replace the focused cell (keeps the iPhone keyboard up and the caret where it is)
  function syncKids(o, n, act) {
    const oc = [...o.children], nc = [...n.children];
    nc.forEach((x, i) => {
      const y = oc[i]; if (!y) return o.appendChild(x);
      if (y === act) { for (const a of [...x.attributes]) if (a.name !== 'value' && a.name !== 'class' && y.getAttribute(a.name) !== a.value) y.setAttribute(a.name, a.value);
        if (act.tagName === 'DIV') { if (act.textContent !== x.textContent) act.textContent = x.textContent; return; }   // v9i note preview
        if (act.tagName === 'BUTTON') { if (act.className !== x.className) act.className = x.className; if (act.innerHTML !== x.innerHTML) act.innerHTML = x.innerHTML; return; }   // v9o: a units chip that has focus
        const nv = x.tagName === 'TEXTAREA' ? x.defaultValue : (x.getAttribute('value') || ''); if (act.value === act.defaultValue && nv !== act.defaultValue) { const s0 = act.selectionStart, e0 = act.selectionEnd, all = s0 === 0 && e0 === act.value.length; act.defaultValue = nv; act.value = nv; if (all && act.select) act.select(); else if (act.setSelectionRange) { const n = Math.min(nv.length, e0 || 0); act.setSelectionRange(n, n); } } return; }
      if (y.contains(act)) { syncKids(y, x, act); for (const a of [...x.attributes]) if (y.getAttribute(a.name) !== a.value) y.setAttribute(a.name, a.value); return; }
      if (!sameEl(y, x)) y.replaceWith(x);
    });
    oc.slice(nc.length).forEach(y => { if (!y.contains(act)) y.remove(); });
  }
  // rows are compared as HTML, ignoring the heights autoH() sets on wrapping cells (new HTML never has a style attribute)
  const sameEl = (o, n) => o.outerHTML.replace(/ style="[^"]*"/g, '') === n.outerHTML;
  function patchGrid(table, html) {
    const tpl = document.createElement('template'); tpl.innerHTML = html; const nt = tpl.content.firstElementChild, act = document.activeElement;
    const otb = table.tBodies[0], ntb = nt.tBodies[0], old = new Map([...otb.rows].map(r => [r.dataset.key, r]));
    const want = [...ntb.rows].map(nr => {
      const o = old.get(nr.dataset.key); if (!o) return nr;
      if (o.contains(act)) { syncKids(o, nr, act); [...o.attributes].forEach(a => { if (!nr.hasAttribute(a.name)) o.removeAttribute(a.name); }); [...nr.attributes].forEach(a => o.setAttribute(a.name, a.value)); return o; }
      return sameEl(o, nr) ? o : nr;
    });
    [...otb.rows].forEach(r => { if (!want.includes(r)) r.remove(); });
    const keep = want.find(r => r.contains(act));
    if (!keep) otb.replaceChildren(...want);
    else {
      const ai = want.indexOf(keep); let ref = keep;
      for (let i = ai - 1; i >= 0; i--) { if (ref.previousElementSibling !== want[i]) otb.insertBefore(want[i], ref); ref = want[i]; }
      ref = keep; for (let i = ai + 1; i < want.length; i++) { if (ref.nextElementSibling !== want[i]) otb.insertBefore(want[i], ref.nextElementSibling); ref = want[i]; }
    }
    const of = table.tFoot, nf = nt.tFoot; if (of && nf) { if (of.outerHTML !== nf.outerHTML) of.replaceWith(nf); } else if (nf) table.appendChild(nf);
    table.dataset.day = nt.dataset.day; table.setAttribute('aria-label', nt.getAttribute('aria-label') || '');
  }
  function setActive(c) {
    $$('table.grid .act').forEach(x => x.classList.remove('act'));
    if (!c || !document.contains(c)) return;
    const td = c.closest('td'), tr = c.closest('tr'), t = c.closest('table'); if (!td || !tr || !t) return;
    td.classList.add('act'); tr.classList.add('act'); const h = t.querySelector(`thead [data-h="${c.dataset.c}"]`); if (h) h.classList.add('act');
  }
  function ensureVisible(el) {
    const w = el.closest('.gwrap'), td = el.closest('td'); if (!w || !td) return;
    const t = w.querySelector('table'), hh = (t.tHead && t.tHead.offsetHeight) || 0, fh = (t.tFoot && w.classList.contains('main') && t.tFoot.offsetHeight) || 0;
    const rn = t.querySelector('tbody .rn'), nm = t.querySelector('tbody .c-name'), pin = el => el && getComputedStyle(el).position === 'sticky';
    const lw = (pin(rn) ? rn.offsetWidth : 0) + (nm && !td.classList.contains('c-name') && pin(nm) ? nm.offsetWidth : 0);   // v9i: nothing pinned → 0
    const wr = w.getBoundingClientRect(), r = td.getBoundingClientRect();
    if (r.top < wr.top + hh) w.scrollTop -= wr.top + hh - r.top; else if (r.bottom > wr.bottom - fh) w.scrollTop += r.bottom - (wr.bottom - fh);
    const isName = td.classList.contains('c-name');
    if (!isName) { if (r.left < wr.left + lw) w.scrollLeft -= wr.left + lw - r.left; else if (r.right > wr.right) w.scrollLeft += Math.min(r.right - wr.right, r.left - (wr.left + lw)); }
    else if (w.scrollLeft && r.left < wr.left + (rn ? rn.offsetWidth : 0)) w.scrollLeft = 0;   // back to the patient name: show the start of the row again
    // v9o: never scroll the page here (v9n called td.scrollIntoView, which also scrolled the window and slid the top of the
    // grid, header row and rows 1–5 under the pinned app bar / tabs, where a drag inside the grid could not bring them back)
    if (w.classList.contains('main')) pagePin();
  }
  const COARSE = () => matchMedia('(pointer:coarse)').matches, FINE = () => matchMedia('(pointer:fine)').matches;
  // keyboard / Next-button arrival: select the cell on a computer (type to replace, like Sheets); caret at the end on touch
  function focusCell(el) {
    if (!el) return; el.focus({ preventScroll: true }); gEdit = false;
    if (el.select) { if (COARSE()) { const n = el.value.length; el.setSelectionRange(n, n); gEdit = true; } else el.select(); }
    ensureVisible(el); kbSoon();
  }
  function cellAt(tr, ci) {
    for (let d = 0; d < NAV.length; d++) for (const x of [ci + d, ci - d]) { if (x < 0 || x >= NAV.length) continue; const el = tr.querySelector(`.gc[data-c="${NAV[x]}"]`); if (el) return el; }
    return null;
  }
  function gMove(c, dr, dc, wrap) {
    const tr = c.closest('tr'), rows = [...tr.parentNode.rows]; let r = rows.indexOf(tr), ci = NAV.indexOf(c.dataset.c);
    if (dc) { ci += dc; if (ci >= NAV.length) { if (!wrap) return; ci = 0; r++; } else if (ci < 0) { if (!wrap) return; ci = NAV.length - 1; r--; } }
    r += dr; if (r < 0 || r >= rows.length) return;
    focusCell(cellAt(lightUp(rows[r]), ci));
  }
  // saves run one at a time; the grid re-renders once the queue is empty, so fast typing never sees a half-saved (stale) grid
  let gPendN = 0;
  const gEnq = fn => { gPendN++; return (gQ = gQ.then(fn).catch(er => { toast('Could not save: ' + (er && er.message || er)); }).then(() => { if (--gPendN === 0) render(true); })); };
  // apply one cell's value to a (cloned) entry; returns an audit note, null when nothing changed, throws uerr() for bad input
  let eMU = {};
  function eMuShow() {   // v9o: edit form: a 01–20 list for each time-unit modifier typed in Modifier code 1 / 2
    const box = $('#eModU'); if (!box) return; const codes = [...new Set([1, 2].flatMap(n => R.normMods($('#eMod' + n).value).split(', ').filter(R.isMu)))];
    box.hidden = !codes.length;
    box.innerHTML = codes.map(c => `<label class="fld mu">${c} units<select data-emu="${c}"><option value="">–</option>${Array.from({ length: 20 }, (_, i) => i + 1).map(n => `<option value="${n}"${eMU[c] === n ? ' selected' : ''}>${R.p2(n)} · ${R.muMin(n)} min</option>`).join('')}</select></label>`).join('') + (codes.length ? '<p class="small muted mun">1 unit = 15 min with the patient (GR 15.13.4); a further unit needs at least half of 15 min.</p>' : '');
    $$('#eModU [data-emu]').forEach(sl => sl.onchange = () => { const v = parseInt(sl.value, 10); if (v) eMU[sl.dataset.emu] = v; else delete eMU[sl.dataset.emu]; });
  }
  ['#eMod1', '#eMod2'].forEach(id => { const el = document.querySelector(id); if (el) el.addEventListener('input', () => eMuShow()); });
  function pruneMu(e) {   // keep units only for time-unit modifiers still in Modifier code 1 / 2
    if (!e.modU) return; const keep = new Set([1, 2].flatMap(n => R.muCodes(e, n))), m = {};
    for (const [c, u] of Object.entries(e.modU)) if (keep.has(c) && Number.isInteger(u) && u >= 1 && u <= 20) m[c] = u;
    if (Object.keys(m).length) e.modU = m; else delete e.modU;
  }
  function applyMu(e, o) {
    if (!o || !R.isMu(o.code)) return null; const c = String(o.code).toUpperCase(), n = o.n == null ? 0 : Math.max(0, Math.min(20, parseInt(o.n, 10) || 0));
    if (R.muOf(e, c) === n) return null; const m = Object.assign({}, e.modU || {}); if (n) m[c] = n; else delete m[c];
    if (Object.keys(m).length) e.modU = m; else delete e.modU;
    return n ? `Units for ${c} set to ${R.p2(n)} (${R.muMin(n)} min) in spreadsheet` : `Units for ${c} cleared in spreadsheet`;
  }
  async function applyCell(e, f, raw, day) {
    if (f === 'fno') return applyFno(e, raw);     // v9o: {no, n} from the picker, or a typed number; null / '' clears
    if (f === 'fcen') return applyFcen(e, raw);
    if (f === 'mu') return applyMu(e, raw);       // v9o: { code, n } units for a time-unit modifier (n null / 0 clears)
    const v = String(raw == null ? '' : raw).trim();
    if (f === 'name') { if ((e.name || '') === v) return null; e.name = v; return 'Patient name edited in spreadsheet'; }
    if (f === 'mrn') { if (ptMrn(e) === v) return null; setMrn(e, v); return 'MRN/PHN edited in spreadsheet'; }
    if (f === 'note') { if ((e.billingNote || '') === v) return null; e.billingNote = v; return 'Billing note edited in spreadsheet'; }
    if (f === 'hc') { const nv = v === 'C' ? 'C' : 'H'; if (e.setting === nv) return null; e.setting = nv; return `Setting changed to ${R.SET[nv]} in spreadsheet`; }
    if (f === 'tin' || f === 'tout') return applyTime(e, f, v, day);
    if (f === 'mod1' || f === 'mod2') {   // v9k: several codes per cell, separated by commas or spaces; saved upper-case, no duplicates
      // v9o: "TEV04", "TEV:4" or "TEV ×04" also sets the units (01–20) of a time-unit modifier
      const typedU = {}, toks = v.replace(/[×x*](?=\d)/gi, '').split(/[,;\s]+/).filter(Boolean).map(t => { const m = /^([A-Za-z]+):?(\d{1,2})$/.exec(t); if (m && R.isMu(m[1]) && +m[2] >= 1 && +m[2] <= 20) { typedU[m[1].toUpperCase()] = +m[2]; return m[1]; } return t; });
      const mm = /^([A-Za-z]+)$/; for (let i = 1; i < toks.length; i++) if (/^\d{1,2}$/.test(toks[i]) && mm.test(toks[i - 1]) && R.isMu(toks[i - 1]) && +toks[i] >= 1 && +toks[i] <= 20) { typedU[toks[i - 1].toUpperCase()] = +toks[i]; toks[i] = ''; }
      const nv = R.normMods(toks.join(' ')).slice(0, MOD_MAX), beforeU = JSON.stringify(e.modU || {}), beforeM = modOf(e, f.slice(3));
      if (nv) e[f] = nv; else delete e[f];
      for (const [c, u] of Object.entries(typedU)) e.modU = Object.assign({}, e.modU || {}, { [c]: u });
      pruneMu(e);
      if (beforeM === nv && beforeU === JSON.stringify(e.modU || {})) return null;
      return `Modifier code(s) ${f.slice(3)} edited in spreadsheet` + (Object.keys(typedU).length ? ' (' + Object.entries(typedU).map(([c, u]) => `${c} ${R.p2(u)} units`).join(', ') + ')' : '');
    }
    if (f === 'fee') {
      const parts = v.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean), prev = (e.codes || []).map(c => c.c).join(', ');
      if (parts.join(', ').toUpperCase() === prev.toUpperCase()) return null;
      const prov = S.settings.prov || 'AB'; await codesFor(prov).catch(() => null); const o = codeCache[prov];
      const old = e.codes || [];
      e.codes = parts.map((c, i) => { const was = old[i] || {}, hit = o && o.byNorm.get(norm(c));
        return hit ? Object.assign({}, was, { c: hit.c || hit.k || c, k: hit.k || c, d: hit.d || '', j: prov, f: hit.f || '' }) : Object.assign({}, was, { c: c.toUpperCase(), k: c.toUpperCase(), d: '', j: prov, f: '' }); });
      if (!e.codes.length && old.some(c => c.dx)) e.dx = old.find(c => c.dx).dx;   // keep the diagnostic code when the fee code is cleared
      return 'Fee code(s) edited in spreadsheet';
    }
    if (f === 'dx') {
      const parts = v.split(/[,;\s]+/).map(s => dxCode(s) || s.trim().toUpperCase()).filter(Boolean);
      if (parts.join(', ') === R.dxList(e).join(', ')) return null;
      await loadIcd().catch(() => null);
      const uniq = parts.filter((x, i, a) => a.indexOf(x) === i);
      // v9m: one Dx beside each fee code in order; more Dx than fee codes are kept too (e.dxx), never dropped
      if (!(e.codes || []).length) { e.dx = uniq[0] || ''; if (!e.dx) delete e.dx; setDxx(e, uniq.slice(1)); }
      else {
        e.codes = e.codes.map((c, i) => { const x = Object.assign({}, c); if (uniq[i]) { x.dx = uniq[i]; x.dxd = dxDesc(uniq[i]); } else if (i >= uniq.length) { delete x.dx; delete x.dxd; } return x; });
        setDxx(e, uniq.slice(e.codes.length));
        delete e.dx;
      }
      return 'Diagnostic code(s) edited in spreadsheet';
    }
    return null;
  }
  const dxxHtml = e => R.dxExtra(e).map(x => `<span class="sc"><span class="dxc">Dx ${esc(x)}</span></span>`).join('');   // v9m: more Dx than fee codes
  function setDxx(e, list) { const l = (list || []).filter(Boolean); if (l.length) e.dxx = l; else delete e.dxx; }
  function applyTime(e, f, v, day) {
    const segs = clone(e.segs || []), now = Date.now(), stamp = () => { e.edits = (e.edits || []).concat(now); };
    if (!v) {
      if (f === 'tout') { const l = segs[segs.length - 1]; if (!l || l.e == null) return null; l.e = null; e.status = 'run'; e.segs = segs; e.late = true; stamp(); return 'Time out cleared (running again)'; }
      if (!segs.length) return null; throw uerr('To clear the times, open ⋯ → Segments & photos');
    }
    const p = parseHm(v); if (!p) throw uerr('Type a 24-hour time such as 09:30 or 930, or "now"');
    if (f === 'tin') {
      let t = now;
      if (p !== 'now') { const base = segs.length ? R.encDay(e) : day; t = edmAt(base, p[0], p[1]); if (!segs.length && t > now + 60000 && base === today()) t = edmAt(shiftDay(base, -1), p[0], p[1]); }
      if (t > now + 60000) throw uerr('In cannot be in the future');
      if (!segs.length) { e.segs = [{ s: t, e: null }]; e.status = 'run'; if (t < now - 120000) e.late = true; delete e.at; return `Started in spreadsheet (In ${R.hm(t)})`; }
      if (Math.floor(t / 60000) === Math.floor(segs[0].s / 60000)) return null;
      if (segs[0].e != null && t >= segs[0].e) throw uerr('In must be before Out');
      segs[0].s = t; e.segs = segs; e.late = true; stamp(); return 'Time in edited in spreadsheet';
    }
    if (!segs.length) throw uerr('Type In first (or tap ▶ to start now)');
    const last = segs[segs.length - 1]; let t = now;
    if (p !== 'now') { const k = R.dayKey(last.s); t = edmAt(k, p[0], p[1]); if (t <= last.s) { const t2 = edmAt(shiftDay(k, 1), p[0], p[1]); if (t2 > now + 60000) throw uerr('Out must be after In'); t = t2; } }
    if (t <= last.s) throw uerr('Out must be after In');
    if (t > now + 60000) throw uerr('Out cannot be in the future');
    if (last.e != null && Math.floor(t / 60000) === Math.floor(last.e / 60000)) return null;
    const wasOpen = last.e == null; last.e = t; e.segs = segs;
    if (e.status === 'run' || e.status === 'new') e.status = 'done';
    if (!(p === 'now' && wasOpen)) { e.late = true; stamp(); }
    return wasOpen ? `Stopped in spreadsheet (Out ${R.hm(t)})` : 'Time out edited in spreadsheet';
  }
  const actOf = n => /^Started/.test(n) ? 'start' : /^Stopped/.test(n) ? 'stop' : 'edit';
  function gridSave(id, f, v) {
    return gEnq(async () => {
      const e0 = S && S.encs.find(x => x.id === id); if (!e0) return;
      const e = clone(e0); let note;
      try { note = await applyCell(e, f, v, R.encDay(e0)); } catch (er) { if (!er.user) throw er; toast(er.message, 3500); return; }
      if (!note) return;
      await saveEnc(e, actOf(note), note);
    });
  }
  function createFromBlank(tr, f, v) {
    if (!S || !String(v || '').trim()) return;
    const key = tr.dataset.key, day = tr.closest('table').dataset.day, id = uid(), set = blankSet[key] || quickSet;
    if ((f === 'tin' || f === 'tout') && !parseHm(v)) { toast('Type a 24-hour time such as 09:30 or 930, or "now"', 3500); const c = tr.querySelector(`[data-c="${f}"]`); if (c) { c.value = ''; c.defaultValue = ''; } return; }
    if (f === 'tout') { toast('Type In first (or tap ▶ to start now)', 3500); const c = tr.querySelector('[data-c="tout"]'); if (c) { c.value = ''; c.defaultValue = ''; } return; }
    delete tr.dataset.blank; tr.dataset.id = id; tr.dataset.key = id; tr.classList.remove('blank');
    for (const k of Object.keys(blankSet)) delete blankSet[k];
    gEnq(async () => {
      const now = Date.now(), sh = activeShift(), n = S.encs.filter(x => R.encDay(x) === day && kindOf(x) === 'enc').length + 1;
      const e = { id, kind: 'enc', name: '', mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: set, facility: (sh ? sh.facility : S.settings.curFac) || null, type: '', codes: [], notes: [], segs: [], status: 'new', photos: [], links: [], created: now, updated: now };
      if (day !== today()) { e.at = edmAt(day, 12, 0); e.late = true; }
      let note;
      try { note = await applyCell(e, f, v, day); } catch (er) { if (!er.user) throw er; toast(er.message, 3500); tr.dataset.blank = '1'; tr.dataset.key = key; delete tr.dataset.id; return; }
      if (!ptName(e) && !ptMrn(e)) e.label = `Encounter ${n}`;
      const cn = carryFac(e, day);
      await saveEnc(e, 'create', ['Created in the spreadsheet', note, cn].filter(Boolean).join('. '));
    });
    // keep at least MIN_BLANK blank rows below, even before the save lands
    const tb = tr.parentNode, nb = tb.querySelectorAll('tr[data-blank]').length;
    if (nb < MIN_BLANK) { const t = document.createElement('template'); let h = ''; for (let j = 0; j < MIN_BLANK - nb; j++) h += blankRow(tb.rows.length + j + 1, false); t.innerHTML = '<table><tbody>' + h + '</tbody></table>'; tb.append(...t.content.querySelector('tbody').rows); }
  }
  // ↗ on an empty row: the row becomes an encounter first (as if something was typed), so the picked code has a home
  function blankForPick(tr) {
    if (!S) return null;
    const key = tr.dataset.key, day = tr.closest('table').dataset.day, id = uid(), set = blankSet[key] || quickSet;
    const act = document.activeElement; if (act && act.classList && act.classList.contains('gc') && !tr.contains(act)) commitCell(act);
    const vals = {}; tr.querySelectorAll('.gc[data-c]').forEach(c => { if ((c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') && c.value.trim()) { vals[c.dataset.c] = c.value; c.defaultValue = c.value; } });
    delete tr.dataset.blank; tr.dataset.id = id; tr.dataset.key = id; tr.classList.remove('blank');
    for (const k of Object.keys(blankSet)) delete blankSet[k];
    const now = Date.now(), sh = activeShift(), n = S.encs.filter(x => R.encDay(x) === day && kindOf(x) === 'enc').length + 1;
    const e = { id, kind: 'enc', name: '', mrn: '', chart: '', label: '', initials: '', billingNote: '', setting: set, facility: (sh ? sh.facility : S.settings.curFac) || null, type: '', codes: [], notes: [], segs: [], status: 'new', photos: [], links: [], created: now, updated: now };
    if (day !== today()) { e.at = edmAt(day, 12, 0); e.late = true; }
    gEnq(async () => {
      for (const [f, v] of Object.entries(vals)) { try { await applyCell(e, f, v, day); } catch (er) { if (!er.user) throw er; } }
      if (!ptName(e) && !ptMrn(e)) e.label = `Encounter ${n}`;
      const cn = carryFac(e, day);
      await saveEnc(e, 'create', ['Created in the spreadsheet to pick a code in Fee Desk', cn].filter(Boolean).join('. '));
    });
    return e;
  }
  function commitCell(c) {
    if (!c || (c.tagName !== 'INPUT' && c.tagName !== 'TEXTAREA') || !S || c.value === c.defaultValue) return;
    if (c.dataset.c !== 'note' && /[\r\n]/.test(c.value)) c.value = c.value.replace(/[\r\n]+/g, ' ');
    const v = c.value, tr = c.closest('tr'); c.defaultValue = v;
    if (!tr) return; if (tr.dataset.blank) return createFromBlank(tr, c.dataset.c, v);
    gridSave(tr.dataset.id, c.dataset.c, v);
  }
  function hcToggle(b, val) {
    const tr = b.closest('tr'), nv = val || (b.textContent.trim() === 'C' ? 'H' : 'C'); if (!tr) return;
    if (tr.dataset.blank) { blankSet[tr.dataset.key] = nv; b.textContent = nv; b.parentNode.classList.add('set'); b.title = R.SET[nv] + ' (tap, or type H / C)'; return; }
    if (b.textContent.trim() === nv) return; b.textContent = nv; gridSave(tr.dataset.id, 'hc', nv);
  }
  const entryOf = el => { const tr = el && el.closest('tr[data-id]'); return tr && S ? S.encs.find(x => x.id === tr.dataset.id) : null; };
  // v9h: add GROW_BY empty rows at the end (row numbers continue); focus, caret and the rows above are untouched
  function growGrid(t) {
    const tb = t && t.tBodies[0]; if (!tb || !tb.querySelector('tr[data-blank]')) return false;
    const n = tb.rows.length; let h = ''; for (let j = 0; j < GROW_BY; j++) h += lightRow(n + j + 1);
    const tpl = document.createElement('template'); tpl.innerHTML = '<table><tbody>' + h + '</tbody></table>';
    tb.append(...tpl.content.querySelector('tbody').rows);
    if (t.dataset.day) rowsMin[t.dataset.day] = Math.max(rowsMin[t.dataset.day] || 0, tb.rows.length);
    return true;
  }
  function growNear(c) {
    const tr = c && c.closest && c.closest('tbody tr'), t = tr && tr.closest('table.grid'); if (!t) return;
    if (tr.parentNode.rows.length - 1 - tr.sectionRowIndex <= GROW_NEAR) { growGrid(t); scrollCap.set(t, tr.parentNode.rows.length); }
  }
  const scrollCap = new WeakMap(), SCROLL_MORE = 30;
  // scrolled near the bottom of a grid that has empty rows (the Today grid scrolls inside its frame; the page may scroll too)
  let growRaf = 0;
  function growOnScroll() {
    if (growRaf) return;
    growRaf = requestAnimationFrame(() => { growRaf = 0;
      for (const t of $$('#todayList table.grid')) {
        const tb = t.tBodies[0], last = tb && tb.rows[tb.rows.length - 1]; if (!last || !tb.querySelector('tr[data-blank]') || !t.offsetParent) continue;
        const w = t.closest('.gwrap'), rh = last.offsetHeight || 30, bottom = Math.min(innerHeight, w ? w.getBoundingClientRect().bottom : innerHeight);
        // v9o: scrolling alone adds up to SCROLL_MORE empty rows past those already there, then the footer shows after the last
        // row; the cursor (Tab / Enter / Next near the end) keeps adding rows without limit and the footer moves down with them
        if (!scrollCap.has(t)) scrollCap.set(t, tb.rows.length); const cap = scrollCap.get(t) + SCROLL_MORE;
        let guard = 0; while (guard++ < 5 && tb.rows.length < cap && tb.rows[tb.rows.length - 1].getBoundingClientRect().top < bottom + GROW_NEAR * rh) growGrid(t);
      }
    });
  }
  function bindGrid(root) {
    let lpT = null;
    root.addEventListener('pointerdown', ev => {
      const c = ev.target.closest('.gc'); gMouse = c || null;
      const rn = ev.target.closest('tbody .rn'); clearTimeout(lpT);
      if (rn) lpT = setTimeout(() => { const e = entryOf(rn); if (e) openRowMenu(e); }, 550);
    }, true);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => root.addEventListener(n, () => clearTimeout(lpT)));
    // v9h: a mouse over a light empty row gives it its editors, so the hover buttons (▶, ↗) show as on any row
    root.addEventListener('pointerover', ev => { if (ev.pointerType !== 'mouse') return; const tr = ev.target.closest && ev.target.closest('tr[data-light]'); if (tr) lightUp(tr); });
    root.addEventListener('focusin', ev => {
      const c = ev.target.closest && ev.target.closest('.gc'); if (!c) return;
      gCell = c; setActive(c); gNavShow(true); growNear(c); nTipShow(c);
      if (CODEC[c.dataset.c] && COARSE() && gMouse === c) requestAnimationFrame(() => { if (document.activeElement === c) ensureVisible(c); });   // v9k: a tapped, partly hidden code cell slides fully into view
      if (gMouse === c) gEdit = true;
      else if (c.select && !COARSE()) { gEdit = false; if (document.activeElement === c && !(c.selectionStart === 0 && c.selectionEnd === c.value.length)) c.select(); }
      else gEdit = true;
      gMouse = null; kbSoon();
    });
    root.addEventListener('focusout', ev => {
      const c = ev.target.closest && ev.target.closest('.gc'); if (c) { commitCell(c); if (c === nTipFor) nTipShow(null); }
      setTimeout(() => { if (!root.contains(document.activeElement) && !ned && !fpk) { setActive(null); gNavShow(false); if (root.id === 'histList' && histDirty) { histDirty = false; renderHistory(); } if (root.id === 'todayList' && todayResort) { todayResort = false; render(true); } } }, 0);
    });
    root.addEventListener('input', ev => {
      const c = ev.target.closest('.gc'); if (!c || c.tagName === 'BUTTON' || c.tagName === 'DIV') return; gEdit = true; if (c === nTipFor) nTipShow(c);
      if (c.tagName === 'TEXTAREA') {
        if (c.dataset.c !== 'note' && /[\r\n]/.test(c.value)) { const p = c.selectionStart; c.value = c.value.replace(/[\r\n]+/g, ' '); c.setSelectionRange(p, p); }
      }
      fitSoon(c.closest('table.grid'), c);
    });
    // phone keyboards that send no usable Enter keydown (Android IMEs): a line break typed into a wrapping cell means "next cell"
    root.addEventListener('beforeinput', ev => {
      const c = ev.target.closest && ev.target.closest('textarea.gc'); if (!c) return;
      if (ev.inputType !== 'insertLineBreak' && ev.inputType !== 'insertParagraph') return;
      if (c.dataset.c === 'note' && FINE() && gShiftEnter) return;          // computer: Shift+Enter = new line in Billing notes
      ev.preventDefault(); commitCell(c); gMove(c, 0, 1, true);
    });
    root.addEventListener('keydown', ev => {
      const c = ev.target.closest && ev.target.closest('.gc'); if (!c || ev.isComposing) return;
      const isIn = c.tagName === 'INPUT' || c.tagName === 'TEXTAREA', k = ev.key; gShiftEnter = k === 'Enter' && ev.shiftKey;
      if (k === 'Tab') { ev.preventDefault(); commitCell(c); return gMove(c, 0, ev.shiftKey ? -1 : 1, true); }
      if (k === 'Enter') {
        ev.preventDefault(); commitCell(c); return gMove(c, 0, ev.shiftKey ? -1 : 1, true);   // Enter = next cell to the right (Shift+Enter = left)
      }
      if (k === 'Escape') { if (isIn && (c.value !== c.defaultValue || gEdit)) { ev.preventDefault(); ev.stopPropagation(); c.value = c.defaultValue; gEdit = false; c.select(); fitSoon(c.closest('table.grid')); } return; }
      if ((k === 'F4' || (k === 'ArrowDown' && ev.altKey)) && (c.dataset.c === 'mod1' || c.dataset.c === 'mod2')) {   // v9o: units picker
        ev.preventDefault(); const tr = c.closest('tr'), id = tr && tr.dataset.id, root2 = c.closest('#todayList, #histList'), n = c.dataset.c.slice(3);
        const go = () => { const r2 = id && root2 && [...root2.querySelectorAll('tbody tr')].find(x => x.dataset.id === id), b = r2 && r2.querySelector(`td.c-mod${n} .mub`); if (b) muCell(b); else toast('Units are for time-unit modifiers (TEV, TNTP, TNTA, TWK, TST, TDES, EV, NTPM, NTAM, WK)'); };
        if (isIn && c.value !== c.defaultValue) { commitCell(c); setTimeout(go, 450); } else go(); return;
      }
      // ↑ ↓ change rows only before you start editing (just arrived with Tab / Enter); while editing they stay in the text
      if ((k === 'ArrowUp' || k === 'ArrowDown') && (!isIn || !gEdit)) { ev.preventDefault(); commitCell(c); return gMove(c, k === 'ArrowUp' ? -1 : 1, 0); }
      // ← → always move the cursor inside the text and never leave the cell (only the H/C button uses them to move)
      if (k === 'ArrowLeft' || k === 'ArrowRight') { if (!isIn) { ev.preventDefault(); return gMove(c, 0, k === 'ArrowLeft' ? -1 : 1, false); } gEdit = true; return; }
      if (c.classList.contains('fpv')) {   // v9o: Facility # / Functional centre: Space, F2 or Alt+↓ opens the list; typing searches it; Delete clears
        if (k === 'F2' || k === ' ' || (k === 'ArrowDown' && ev.altKey)) { ev.preventDefault(); return fpkCell(c); }
        if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); return fpkClearCell(c); }
        if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); return fpkCell(c, k); }
        return;
      }
      if (c.classList.contains('nprev')) {   // v9i: the notes preview (typing replaces, like any cell; Cancel puts it back)
        if (k === 'F2' || k === ' ') { ev.preventDefault(); return nedOpen(c); }
        if (k === 'Backspace' || k === 'Delete') { ev.preventDefault(); return nedOpen(c, ''); }
        if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); return nedOpen(c, k); }
      }
      if (k === 'F2' && isIn) { ev.preventDefault(); gEdit = true; const n = c.value.length; c.setSelectionRange(n, n); return; }
      if (!isIn) { if (/^[hHcC]$/.test(k)) { ev.preventDefault(); hcToggle(c, k.toUpperCase()); } return; }
      if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) gEdit = true;
      if (k === 'Backspace' || k === 'Delete') gEdit = true;
    });
    // v9o: leaving an edited cell can redraw the rows between mouse-down and mouse-up, so the click lands on the table
    // instead of the Facility # / Functional centre cell; remember where the press started and open that cell's list.
    let fpDown = null;
    root.addEventListener('pointerdown', ev => { const td = ev.target.closest && ev.target.closest('td.c-fno, td.c-fcen'), tr = td && td.closest('tr'); fpDown = td && tr ? { key: tr.dataset.key || '', id: tr.dataset.id || '', c: td.classList.contains('c-fno') ? 'fno' : 'fcen', t: Date.now() } : null; });
    root.addEventListener('click', ev => {
      const t = ev.target;
      if (fpDown && Date.now() - fpDown.t < 1500 && !(t.closest && t.closest('td'))) { const d = fpDown; fpDown = null; const tr = [...root.querySelectorAll('tbody tr')].find(x => (d.id && x.dataset.id === d.id) || (d.key && x.dataset.key === d.key)), c = tr && tr.querySelector(`.gc[data-c="${d.c}"]`); if (c) return fpkCell(c); }
      fpDown = null;
      // touch: the browser's tap targeting can leave the text caret in the neighbouring cell while focus is in this one,
      // so typing would go nowhere. Put the caret back inside the tapped cell (at the end).
      const ed = t.closest && t.closest('input.gc, textarea.gc');
      if (ed && document.activeElement === ed) { const s = getSelection(), td = ed.closest('td'); if (s && s.anchorNode && td && !td.contains(s.anchorNode)) { const n = ed.value.length; ed.setSelectionRange(n, n); } }
      const hc = t.closest('.gc.hc'); if (hc) return hcToggle(hc);
      const np = t.closest('.gc.nprev'); if (np) return nedOpen(np);
      const mb = t.closest('.mub'); if (mb) return muCell(mb);   // v9o: units 01–20 of a time-unit modifier
      const fp = t.closest('.gc.fpv'); if (fp) return fpkCell(fp);
      const pk = t.closest('.pickfd'); if (pk) { const tr = pk.closest('tr'), e = tr && tr.dataset.blank ? blankForPick(tr) : entryOf(pk); if (e) pickInFeeDesk(e, pk.dataset.kind, pk.dataset.at); return; }
      const a = t.closest('[data-a]');
      if (a) {
        const tr = a.closest('tr'), e = entryOf(a);
        if (a.dataset.a === 'now') { if (tr.dataset.blank) createFromBlank(tr, 'tin', 'now'); else if (e) gridSave(e.id, 'tin', 'now'); return; }
        if (a.dataset.a === 'stop' && e) return act(e, 'stop');
        if (a.dataset.a === 'more' && e) return openRowMenu(e);
        return;
      }
      if (t.closest('a, input, textarea, button')) return;
      const td0 = t.closest('td, th.rn'); if (!td0) return;
      const ltr = td0.closest('tr'), ci = [...ltr.cells].indexOf(td0); if (ltr.dataset.light) lightUp(ltr);
      const td = ltr.cells[ci] || td0;
      if (td.classList.contains('c-note') && !td.classList.contains('rn')) { const np2 = td.querySelector('.gc.nprev'); if (np2) return nedOpen(np2); }
      if ((td.classList.contains('c-fno') || td.classList.contains('c-fcen')) && !td.classList.contains('rn')) { const fp2 = td.querySelector('.gc.fpv'); if (fp2) return fpkCell(fp2); }
      const c = td.querySelector('.gc') || (td.classList.contains('rn') && td.parentNode.querySelector('.gc')); if (c) { gMouse = (c.tagName === 'INPUT' || c.tagName === 'TEXTAREA') && !td.classList.contains('rn') ? c : null; c.focus(); if (!gMouse && c.select) c.select(); }
    });
    root.addEventListener('dblclick', ev => { const rn = ev.target.closest('tbody .rn'); if (rn) { const e = entryOf(rn); if (e) openEdit(e); } });
    root.addEventListener('contextmenu', ev => { if (ev.target.closest('input')) return; const e = entryOf(ev.target); if (!e) return; ev.preventDefault(); openRowMenu(e); });
  }
  bindGrid($('#todayList')); bindGrid($('#histList'));

  // ---- v9i notes editor: a bottom sheet on phones, a popover beside the cell on a computer. Multi-line, grows with the
  // text, 16 px+ (no iPhone zoom). Done / Ctrl+Enter / Tab save like any cell (encrypted entry, audit-logged); Cancel / Esc
  // put the note back. Tapping outside counts as Done (nothing typed is lost).
  let ned = null;
  const nedIn = t => [ned, fpk && fpk.grid].some(o => !!(o && t && o.root.contains(t) && t.dataset.day === o.day));   // the editor (or v9o picker) counts as working in that grid
  const SHEET = () => matchMedia('(max-width:767px)').matches;
  function nedFind(o) {
    let tr = o.id ? o.root.querySelector(`tr[data-id="${CSS.escape(o.id)}"]`) : null;
    if (!tr) { const t = o.root.querySelector(`table.grid[data-day="${CSS.escape(o.day)}"]`); tr = t && t.querySelector(`tbody tr[data-key="${CSS.escape(o.key)}"]`); }
    return tr;
  }
  function nedOpen(cell, init) {
    if (!S || !cell) return; let tr = cell.closest('tr'); if (!tr) return;
    if (tr.dataset.light) { lightUp(tr); cell = tr.querySelector('.gc[data-c="note"]'); if (!cell) return; }
    if (ned) nedClose(true);
    const root = cell.closest('#todayList, #histList'), t = cell.closest('table.grid');
    ned = { root, day: t ? t.dataset.day : '', key: tr.dataset.key, id: tr.dataset.id || '', orig: cell.dataset.v || '' };
    const ta = $('#nedTa'), e = entryOf(cell);
    ta.value = init != null ? init : ned.orig;
    $('#nedSub').textContent = 'Row ' + (tr.sectionRowIndex + 1) + (e && ptName(e) ? ' · ' + ptName(e) : '');
    const box = $('#noteEd'), sheet = SHEET(); box.classList.toggle('sheet', sheet); box.classList.toggle('pop', !sheet); box.hidden = false;
    gCell = cell; setActive(cell); gNavShow(false); nTipShow(null);
    nedSize(); ta.focus({ preventScroll: true }); const n = ta.value.length; ta.setSelectionRange(n, n); nedCount();
    document.body.classList.add('nedopen');
  }
  function nedCount() { const n = $('#nedTa').value.length; $('#nedCnt').textContent = n > 400 ? `${n} / 500` : ''; }
  // the sheet sits on the keyboard (visualViewport); the popover goes under the cell (or above it when there is no room)
  function nedSize() {
    if (!ned) return; const box = $('#nedBox'), ta = $('#nedTa'), vv = window.visualViewport;
    const vh = vv ? vv.height : innerHeight, vt = vv ? vv.offsetTop : 0, sheet = $('#noteEd').classList.contains('sheet');
    const tr = nedFind(ned), cell = tr && tr.querySelector('td.c-note'), cr = cell ? cell.getBoundingClientRect() : null;
    if (sheet) { box.style.top = ''; box.style.left = ''; box.style.bottom = Math.max(0, Math.round(innerHeight - (vt + vh))) + 'px'; }
    let room = sheet ? vh * 0.55 : Math.max(160, Math.min(innerHeight * 0.6, 420));
    if (!sheet && cr) { const below = innerHeight - cr.bottom - 12, above = cr.top - 12; room = Math.max(140, Math.min(room, Math.max(below, above) - 70)); }
    ta.style.height = 'auto'; const fixed = box.offsetHeight - ta.offsetHeight;
    ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 96), Math.max(96, room - (sheet ? fixed : 0))) + 'px';
    if (!sheet) {
      const bw = box.offsetWidth, bh = box.offsetHeight, r = cr || { left: (innerWidth - bw) / 2, right: (innerWidth + bw) / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
      const left = Math.max(8, Math.min(r.right - bw, innerWidth - bw - 8)), top = r.bottom + 4 + bh <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - bh);
      box.style.bottom = ''; box.style.left = Math.round(Math.max(8, Math.min(left, r.left))) + 'px'; box.style.top = Math.round(top) + 'px';
    }
  }
  function nedClose(save, move) {
    if (!ned) return; const o = ned; ned = null; document.body.classList.remove('nedopen');
    const ta = $('#nedTa'), v = ta.value.replace(/\r\n?/g, '\n'); $('#noteEd').hidden = true; ta.value = ''; ta.style.height = '';
    const tr = nedFind(o), cell = tr && tr.querySelector('.gc[data-c="note"]');
    if (save && v.trim() !== o.orig.trim() && S) {
      if (cell) { cell.dataset.v = v; cell.textContent = notePrev(v); }
      if (tr && tr.dataset.blank) createFromBlank(tr, 'note', v); else if (tr && tr.dataset.id) gridSave(tr.dataset.id, 'note', v); else if (o.id) gridSave(o.id, 'note', v);
      if (cell) fitSoon(cell.closest('table.grid'));
    }
    if (cell && S) { if (move) gMove(cell, 0, move, true); else focusCell(cell); }
  }
  $('#nedTa').addEventListener('input', () => { nedSize(); nedCount(); });
  $('#nedTa').addEventListener('keydown', ev => {
    if (ev.isComposing) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); return nedClose(false); }
    if (ev.key === 'Tab') { ev.preventDefault(); return nedClose(true, ev.shiftKey ? -1 : 1); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); return nedClose(true); }
  });
  $('#nedDone').addEventListener('click', () => nedClose(true));
  $('#nedCancel').addEventListener('click', () => nedClose(false));
  $('#nedBg').addEventListener('pointerdown', ev => { ev.preventDefault(); nedClose(true); });
  [$('#nedDone'), $('#nedCancel')].forEach(b => b.addEventListener('pointerdown', ev => ev.preventDefault()));   // keep the keyboard up until closed
  window.addEventListener('resize', () => { if (ned) { const sheet = SHEET(); $('#noteEd').classList.toggle('sheet', sheet); $('#noteEd').classList.toggle('pop', !sheet); nedSize(); } });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (ned) nedSize(); });
  // the app locks with the editor open: the unsaved note is kept as an encrypted draft and offered again after unlock
  function nedDraft() {
    if (!ned) return null; const v = $('#nedTa').value, o = ned; ned = null; $('#noteEd').hidden = true; document.body.classList.remove('nedopen');
    return v.trim() !== o.orig.trim() ? { root: o.root.id, day: o.day, key: o.key, id: o.id, v } : null;
  }
  function nedRestore(d) {
    const root = $('#' + (d.root === 'histList' ? 'histList' : 'todayList'));
    if (d.root === 'histList') { if (tab !== 'history') { tab = 'history'; showTab(); } if (d.day) histDay(d.day); }
    let tr = d.id ? root.querySelector(`tr[data-id="${CSS.escape(d.id)}"]`) : null;
    if (!tr && !d.id) tr = $('#todayList tbody tr[data-blank]');
    const cell = tr && tr.querySelector('.gc[data-c="note"]'); if (!cell) return;
    cell.scrollIntoView({ block: 'center', inline: 'nearest' }); nedOpen(cell, d.v);
    toast('Restored your unsaved billing note. Tap Done to save it.', 4000);
  }
  // ============================================================ v9o Facility # and Functional centre
  // Facility #: the AHCIP facility number of the hospital / clinic. Official numbers and names only, from Alberta Health's
  // "Facility and Functional Centre Definitions and Facility Listing" (data/ahcip-facilities.json: number, name as printed,
  // city, facility type, functional centres; source, version and date inside the file). Favourites first, then recent, then
  // search by number, name or city. A number that is not in the listing can be typed (optional name) and is marked as yours.
  // Functional centre: like Med Access: "Type something to search...", "Select Favourite...", "Edit/Search...", then
  // CLNC - Clinic, D/N - Day/Night Care, EMRG - Emergency, MED - Medical, SURG - Surgical (Edit/Search... lists every code in
  // the listing). Stored encrypted with the entry: e.facNo ('44'), e.facNm (name), e.fcen ('EMRG'); older entries have none.
  // A bottom sheet on phones (like the notes editor), a popover beside the cell on a computer; text follows Settings → Display.
  let AHF = null, AHF_BY = new Map(), fpk = null;
  async function loadAhf() {
    if (AHF) return AHF;
    try { const r = await fetch('data/ahcip-facilities.json'); if (!r.ok) throw new Error(r.status); AHF = await r.json(); } catch (e) { AHF = { f: [], source: null, count: 0, types: {}, failed: true }; }
    AHF_BY = new Map(AHF.f.map(x => [x[0], x])); return AHF;
  }
  const facNoOf = e => R.facNoTxt(e), fcenOf = e => R.fcenTxt(e);
  const ahfSrc = () => { const s = AHF && AHF.source; return s ? `Source: Alberta Health, ${s.title.replace(/ - .*$/, '')} (${s.version}; effective ${s.effective}, published ${s.published}), open.alberta.ca. ${AHF.count} facilities, numbers and names as listed.` : 'The Alberta Health facility listing could not be loaded; you can still type a facility number.'; };
  const fpView = (c, e) => { const v = c === 'fno' ? facNoOf(e) : fcenOf(e); if (!v) return ''; const nm = c === 'fno' ? R.facNmTxt(e) : R.fcenName(v); return `<b>${esc(v)}</b>${nm ? `<span class="fpn"> · ${esc(nm)}</span>` : ''}`; };
  function fpCell(c, e, lbl) {
    const v = c === 'fno' ? facNoOf(e) : fcenOf(e), full = c === 'fno' ? R.facNoFull(e) : R.fcenFull(e);
    return `<div class="gc mono fpv${v ? '' : ' fpe'}" data-c="${c}" tabindex="0" role="button" aria-haspopup="dialog" data-v="${esc(v)}" aria-label="${esc(lbl + ': ' + (full || 'empty') + '. Opens the list')}"${full ? ` title="${esc(full)}"` : ''}>${fpView(c, e)}</div>`;
  }
  function applyFno(e, x) {
    let no = '', nm = '';
    if (x && typeof x === 'object') { no = String(x.no || '').trim(); nm = String(x.n || '').trim(); } else no = String(x == null ? '' : x).trim();
    if (no && !/^\d{1,8}$/.test(no)) throw uerr('A facility number is digits only (up to 8)');
    if (no && AHF_BY.has(no) && !(x && x.mine)) nm = AHF_BY.get(no)[1];
    nm = nm.slice(0, 80);
    if (facNoOf(e) === no && R.facNmTxt(e) === (no ? nm : '')) return null;
    if (no) { e.facNo = no; if (nm) e.facNm = nm; else delete e.facNm; } else { delete e.facNo; delete e.facNm; }
    return no ? `Facility # ${no}${nm ? ' (' + nm + ')' : ''} set in spreadsheet` : 'Facility # cleared in spreadsheet';
  }
  function applyFcen(e, x) {
    const c = R.normFcen(x);
    if (c && !R.FCEN_ALL.some(f => f[0] === c)) throw uerr('Pick a functional centre from the list (CLNC, D/N, EMRG, MED, SURG…)');
    if (fcenOf(e) === c) return null;
    if (c) e.fcen = c; else delete e.fcen;
    return c ? `Functional centre ${c} set in spreadsheet` : 'Functional centre cleared in spreadsheet';
  }
  // carry-down: a new row starts with the Facility # / Functional centre picked last on that day (Settings can turn it off)
  function fcLastFor(day) {
    const l = S.settings.fcLast, out = l && l.day === day ? { no: l.no || '', n: l.n || '', fcen: l.fcen || '' } : { no: '', n: '', fcen: '' };
    if (!out.no || !out.fcen) {   // nothing picked yet today on this device: the row of that day changed last that has them
      const src = S.encs.filter(x => kindOf(x) !== 'shift' && R.encDay(x) === day).sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
      if (!out.no) { const x = src.find(y => facNoOf(y)); if (x) { out.no = facNoOf(x); out.n = R.facNmTxt(x); } }
      if (!out.fcen) { const x = src.find(y => fcenOf(y)); if (x) out.fcen = fcenOf(x); }
    }
    return out;
  }
  function carryFac(e, day) {
    if (!S || S.settings.fcCarry === false || kindOf(e) === 'shift') return '';
    const l = fcLastFor(day), got = [];
    if (!facNoOf(e) && l.no) { e.facNo = l.no; if (l.n) e.facNm = l.n; else delete e.facNm; got.push('Facility # ' + l.no); }
    if (!fcenOf(e) && l.fcen) { e.fcen = l.fcen; got.push('Functional centre ' + l.fcen); }
    return got.length ? got.join(' and ') + ' carried down from the last pick that day' : '';
  }
  async function fcRemember(day, kind, v) {
    const st = S.settings; let l = st.fcLast && st.fcLast.day === day ? Object.assign({}, st.fcLast) : { day };
    if (kind === 'fno') { if (v) { l.no = v.no; l.n = v.n || ''; st.recFno = [v.no].concat((st.recFno || []).filter(x => x !== v.no)).slice(0, 8); if (v.mine) st.customFno = [{ no: v.no, n: v.n || '' }].concat((st.customFno || []).filter(x => x.no !== v.no)).slice(0, 20); } else { delete l.no; delete l.n; } }
    else if (v) l.fcen = v; else delete l.fcen;
    st.fcLast = l; await saveSettings(); fpSetUi();
  }
  // H/C tie-in: H/C is the two-way Hospital / Clinic switch (never empty, used for the H and C totals), so it is never
  // overwritten with a name. A new row whose H/C was not chosen takes it from the official facility type (hospital → H,
  // community clinic → C); on an existing row a different H/C is only offered (one tap), never changed by itself.
  const ahfSet = no => { const x = AHF_BY.get(no); return !x ? '' : (x[3] === 'A' || x[3] === 'X') ? 'H' : (x[3] === 'C' || x[3] === 'M') ? 'C' : ''; };
  const facInfo = no => { const x = AHF_BY.get(no); return x ? { no: x[0], n: x[1], city: x[2], type: (AHF.types || {})[x[3]] || '', fc: x[4] || [] } : null; };
  const customNm = no => { const c = (S.settings.customFno || []).find(x => x.no === no); return c ? c.n : ''; };

  // ---- the picker (one <dialog>, so it also works on top of the edit form)
  const FPK_T = { fno: 'Facility #', fcen: 'Functional centre', mu: 'Units' };
  const MU_SRC = 'One unit = 15 minutes with the patient (after-hours time premium, modifier SURT: payable in 15-minute blocks, maximum 4 per hour; GR 15.13.4). A further unit needs at least half of 15 minutes (GR 2.3.2 / 2.3.5), so 02 = 30 min, claimable from 23 min. Alberta Health Fee Modifier Definitions and Medical Governing Rules as of 01 April 2026.';
  function fpkOpen(o) {
    if (fpk) fpkClose();
    fpk = Object.assign({ view: 'main', hi: -1, items: [] }, o);
    const d = $('#fpk'), sheet = SHEET(); d.classList.toggle('sheet', sheet); d.classList.toggle('pop', !sheet); d.dataset.kind = o.kind;
    $('#fpkT').textContent = FPK_T[o.kind]; $('#fpkSub').textContent = o.sub || '';
    const q = $('#fpkQ'); q.value = o.q || ''; q.placeholder = o.kind === 'fno' ? 'Type a number, name or city…' : o.kind === 'mu' ? 'Type 1–20…' : 'Type something to search...';
    q.setAttribute('inputmode', 'search'); $('#fpkMan').hidden = true; $('#fpkManNo').value = ''; $('#fpkManNm').value = '';
    $('#fpkSrc').textContent = o.kind === 'fno' ? ahfSrc() : o.kind === 'mu' ? MU_SRC : 'Functional centre codes: Alberta Health facility listing (definitions and codes). The codes valid for a facility are listed with it.';
    $('#fpkClear').hidden = !o.cur || o.manage;
    if (!d.open) d.showModal();
    document.body.classList.add('fpkopen');
    fpkRender(); fpkSize();
    // a computer (or a typed first letter) goes straight to the search box; on a phone the list stays in view (no keyboard)
    if (o.q || FINE() || !COARSE()) { q.focus({ preventScroll: true }); const n = q.value.length; q.setSelectionRange(n, n); }
    else { const b = $('#fpkList .fpo.cur .pk') || $('#fpkList .pk'); (b || $('#fpkCancel')).focus({ preventScroll: true }); }
    if (o.kind === 'fno' && !AHF) loadAhf().then(() => { if (fpk && fpk.kind === 'fno') { $('#fpkSrc').textContent = ahfSrc(); fpkRender(); } });
  }
  function fpkClose(v, move) {   // v === undefined: cancelled
    if (!fpk) return; const o = fpk; fpk = null; document.body.classList.remove('fpkopen');
    const d = $('#fpk'); if (d.open) d.close(); d.style.top = ''; d.style.left = ''; d.style.bottom = ''; d.style.maxHeight = '';
    if (v !== undefined && o.onPick) o.onPick(v);
    if (o.onDone) o.onDone(v, move);
  }
  const fold = s => MBSearch.fold(String(s || ''));
  function fpkItems() {
    const o = fpk, q = $('#fpkQ').value.trim(), fq = fold(q), st = S.settings, out = [];
    if (o.kind === 'mu') {   // v9o: 01–20 units
      const qn = q.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (o.sugg && !qn) out.push({ v: o.sugg, code: R.p2(o.sugg), name: `${R.muMin(o.sugg)} min`, sub: `Suggested from this row's In / Out times (${o.mins} min logged)`, sec: 'Suggestion' });
      for (let n = 1; n <= 20; n++) { if (qn && !String(n).startsWith(qn)) continue; out.push({ v: n, code: R.p2(n), name: `${R.muMin(n)} min`, sub: `claimable from ${R.muFrom(n)} min with the patient`, sec: 'Units (1 unit = 15 min)' }); }
      if (!out.length) out.push({ note: 'Type a number from 1 to 20.' });
      return out;
    }
    if (o.kind === 'fcen') {
      const fav = new Set(st.favFcen || []), m = f => !fq || fold(f[0] + ' ' + f[1]).includes(fq) || fold(f[0].replace('/', '')).startsWith(fq.replace('/', ''));
      const add = (f, sec) => out.push({ v: f[0], code: f[0], name: f[1], fav: fav.has(f[0]), sec });
      if (!o.manage) { out.push({ meta: 'fav', label: 'Select Favourite…' }); out.push({ meta: 'all', label: 'Edit/Search…' }); }
      if (o.view === 'fav') { R.FCEN_ALL.filter(f => fav.has(f[0]) && m(f)).forEach(f => add(f, 'Favourites')); if (!out.some(x => !x.meta)) out.push({ note: fav.size ? 'No favourite matches.' : 'No favourites yet. Tap ☆ beside a functional centre to add it.' }); }
      else if (o.view === 'all') { R.FCEN_ALL.filter(m).forEach(f => add(f, 'All functional centre codes (Alberta Health listing)')); if (!out.some(x => !x.meta)) out.push({ note: 'No functional centre matches.' }); }
      else {
        const main = R.FCEN.filter(m); main.forEach(f => add(f, '')); const cur = o.cur && !R.FCEN.some(f => f[0] === o.cur) ? R.FCEN_ALL.find(f => f[0] === o.cur) : null;
        if (cur && !fq) add(cur, 'Current');
        if (fq) R.FCEN_MORE.filter(m).forEach(f => add(f, 'More codes'));
        if (!out.some(x => !x.meta)) out.push({ note: 'No match. Tap Edit/Search… to see every code.' });
      }
      return out;
    }
    // Facility #
    const fav = st.favFno || [], favS = new Set(fav), rec = (st.recFno || []).filter(n => !favS.has(n)), list = AHF ? AHF.f : [];
    const it = (no, sec) => { const x = facInfo(no); return x ? { v: { no: x.no, n: x.n }, code: x.no, name: x.n, city: x.city, type: x.type, fav: favS.has(no), sec } : { v: { no, n: customNm(no), mine: true }, code: no, name: customNm(no), city: '', type: 'Not in the Alberta Health listing (typed by you)', mine: true, fav: favS.has(no), sec }; };
    const mt = x => !fq || x.code.startsWith(q) || fold(x.name + ' ' + x.city + ' ' + (x.mine ? 'mine' : x.type)).includes(fq);
    fav.map(n => it(n, 'Favourites')).filter(mt).forEach(x => out.push(x));
    if (!o.manage) rec.map(n => it(n, 'Recent')).filter(mt).forEach(x => out.push(x));
    const seen = new Set(out.map(x => x.code));
    if (!fq) {
      if (!out.length) out.push({ note: 'Tap ☆ on a facility to keep it at the top. Type a number, name or city to search the Alberta Health listing.' });
      list.slice(0, 60).forEach(f => { if (!seen.has(f[0])) out.push(it(f[0], `All facilities, A–Z by city (first 60 of ${list.length}; type to search)`)); });
    } else {
      const digits = /^\d+$/.test(q), hits = [];
      for (const f of list) { if (seen.has(f[0])) continue; const ex = digits && f[0] === q, pre = digits && f[0].startsWith(q), tx = !digits && fold(f[1] + ' ' + f[2] + ' ' + ((AHF.types || {})[f[3]] || '')).includes(fq);
        if (ex || pre || tx) hits.push([ex ? 0 : pre ? 1 : fold(f[1]).startsWith(fq) ? 2 : 3, f]); }
      hits.sort((a, b) => a[0] - b[0] || (a[0] === 1 ? a[1][0].length - b[1][0].length : 0) || a[1][1].localeCompare(b[1][1]));
      hits.slice(0, 60).forEach(h => out.push(it(h[1][0], 'Alberta Health listing')));
      for (const c of st.customFno || []) if (!seen.has(c.no) && !out.some(x => x.code === c.no) && (c.no.startsWith(q) || fold(c.n).includes(fq))) out.push(it(c.no, 'Typed by you'));
      if (digits && q.length <= 8 && !AHF_BY.has(q) && !out.some(x => x.code === q && !x.meta)) out.unshift({ meta: 'man', label: `Use ${q} (not in the Alberta Health listing)…`, no: q });
      if (!out.some(x => !x.meta && !x.note)) out.push({ note: digits ? 'No facility with that number in the listing.' : 'No facility matches. Check the spelling, or type the number.' });
    }
    if (!o.manage) out.push({ meta: 'man', label: 'Enter a number not in the list…', no: '' });
    return out;
  }
  function fpkRender() {
    if (!fpk) return; const o = fpk, items = fpkItems(); o.items = items;
    const pickable = items.map((x, i) => (x.note ? -1 : i)).filter(i => i >= 0);
    if (!pickable.includes(o.hi)) { const q = $('#fpkQ').value.trim(); const firstReal = pickable.find(i => !items[i].meta); o.hi = q && firstReal != null ? firstReal : pickable.find(i => !items[i].meta && items[i].code === o.cur) ?? (firstReal ?? pickable[0] ?? 0); }
    const facHint = o.kind === 'fcen' && o.rowFac && AHF_BY.has(o.rowFac) ? AHF_BY.get(o.rowFac)[4] || [] : null;
    let h = '', sec = null;
    items.forEach((x, i) => {
      if (x.sec !== undefined && x.sec !== sec && !x.meta && !x.note) { sec = x.sec; if (sec) h += `<div class="fpsec" role="presentation">${esc(sec)}</div>`; }
      if (x.note) { h += `<p class="fpnote">${esc(x.note)}</p>`; return; }
      if (x.meta) { h += `<div class="fpo meta${i === o.hi ? ' hi' : ''}${x.meta === o.view ? ' on' : ''}" data-i="${i}"><button type="button" class="pk" role="option" aria-selected="${i === o.hi}" data-i="${i}">${esc(x.label)}</button></div>`; return; }
      const cur = x.code === o.cur, warn = facHint && !facHint.includes(x.code) ? ' <small class="fpw">not listed for facility ' + esc(o.rowFac) + '</small>' : '';
      const sub = o.kind === 'fno' ? [x.city, x.type].filter(Boolean).join(' · ') : o.kind === 'mu' ? x.sub || '' : '';
      h += `<div class="fpo${cur ? ' cur' : ''}${i === o.hi ? ' hi' : ''}${x.mine ? ' mine' : ''}" data-i="${i}"><button type="button" class="pk" role="option" aria-selected="${i === o.hi}" data-i="${i}"><span class="fpc">${esc(x.code)}</span><span class="fpd"><span class="fpnm">${o.kind === 'fcen' ? '- ' : ''}${esc(x.name || (x.mine ? '(no name)' : ''))}${warn}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${cur ? '<span class="fpck" aria-label="current">✓</span>' : ''}</button>` + (o.kind === 'mu' ? '</div>' : '')
        + (o.kind === 'mu' ? '' : `<button type="button" class="star${x.fav ? ' on' : ''}" data-star="${i}" aria-pressed="${!!x.fav}" aria-label="${x.fav ? 'Remove ' + esc(x.code) + ' from' : 'Add ' + esc(x.code) + ' to'} favourites" title="${x.fav ? 'Remove from favourites' : 'Add to favourites'}">${x.fav ? '★' : '☆'}</button></div>`);
    });
    const L = $('#fpkList'); L.innerHTML = h;
    const hi = L.querySelector('.fpo.hi'); if (hi && $('#fpkQ').value) hi.scrollIntoView({ block: 'nearest' });
  }
  async function fpkStar(i) {
    const x = fpk && fpk.items[i]; if (!x || x.meta || fpk.kind === 'mu') return; const st = S.settings, key = fpk.kind === 'fno' ? 'favFno' : 'favFcen', l = st[key] || [];
    st[key] = l.includes(x.code) ? l.filter(c => c !== x.code) : l.concat(x.code);
    if (fpk.kind === 'fno' && x.mine && !l.includes(x.code)) st.customFno = [{ no: x.code, n: x.name || '' }].concat((st.customFno || []).filter(c => c.no !== x.code)).slice(0, 20);
    await saveSettings(); fpkRender(); fpSetUi();
    if (fpk && (FINE() || !COARSE())) $('#fpkQ').focus({ preventScroll: true });   // keep typing into the search after starring
    toast(l.includes(x.code) ? `${x.code} removed from favourites` : `${x.code} added to favourites`);
  }
  function fpkChoose(i, move) {
    const x = fpk && fpk.items[i]; if (!x || x.note) return;
    if (x.meta === 'fav' || x.meta === 'all') { fpk.view = fpk.view === x.meta ? 'main' : x.meta; fpk.hi = -1; fpkRender(); if (x.meta === 'all') $('#fpkQ').focus(); return; }
    if (x.meta === 'man') { $('#fpkMan').hidden = false; $('#fpkManNo').value = x.no || ''; $('#fpkManNm').value = ''; fpkSize(); (x.no ? $('#fpkManNm') : $('#fpkManNo')).focus(); return; }
    fpkClose(x.v, move);
  }
  function fpkManUse() {
    const no = $('#fpkManNo').value.trim(), nm = $('#fpkManNm').value.trim().slice(0, 80);
    if (!/^\d{1,8}$/.test(no)) { toast('Type the facility number (digits only, up to 8)'); return $('#fpkManNo').focus(); }
    if (AHF_BY.has(no)) { toast(`${no} is in the Alberta Health listing: ${AHF_BY.get(no)[1]}`); return fpkClose({ no, n: AHF_BY.get(no)[1] }); }
    fpkClose({ no, n: nm, mine: true });
  }
  function fpkSize() {
    if (!fpk) return; const d = $('#fpk'), vv = window.visualViewport, vh = vv ? vv.height : innerHeight, vt = vv ? vv.offsetTop : 0;
    if (d.classList.contains('sheet')) { d.style.top = ''; d.style.left = ''; d.style.bottom = Math.max(0, Math.round(innerHeight - (vt + vh))) + 'px'; d.style.maxHeight = Math.round(vh * (vh < 500 ? 0.94 : 0.8)) + 'px'; return; }
    const a = fpk.anchor && fpk.anchor.isConnected ? fpk.anchor.getBoundingClientRect() : null, w = d.offsetWidth;
    const below = a ? innerHeight - a.bottom - 12 : innerHeight * 0.7, above = a ? a.top - 12 : 0, room = Math.max(below, above), mh = Math.max(240, Math.min(innerHeight * 0.7, room, 560));
    d.style.maxHeight = Math.round(mh) + 'px'; const h = Math.min(d.offsetHeight, mh);
    const top = !a ? (innerHeight - h) / 3 : below >= h || below >= above ? a.bottom + 4 : Math.max(8, a.top - 4 - h);
    d.style.bottom = ''; d.style.top = Math.round(Math.max(8, Math.min(top, innerHeight - h - 8))) + 'px';
    d.style.left = Math.round(Math.max(8, Math.min(a ? a.left : (innerWidth - w) / 2, innerWidth - w - 8))) + 'px';
  }
  $('#fpkQ').addEventListener('input', () => { if (!fpk) return; fpk.hi = -1; fpkRender(); });
  $('#fpkQ').addEventListener('keydown', ev => {
    if (!fpk || ev.isComposing) return; const it = fpk.items, k = ev.key;
    const step = dir => { let i = fpk.hi; for (let n = 0; n < it.length; n++) { i = (i + dir + it.length) % it.length; if (!it[i].note) break; } fpk.hi = i; fpkRender(); };
    if (k === 'ArrowDown') { ev.preventDefault(); return step(1); }
    if (k === 'ArrowUp') { ev.preventDefault(); return step(-1); }
    if (k === 'Enter') { ev.preventDefault(); return fpkChoose(fpk.hi); }
    if (k === 'Tab') { ev.preventDefault(); const x = it[fpk.hi]; if ($('#fpkQ').value.trim() && x && !x.meta && !x.note) return fpkChoose(fpk.hi, ev.shiftKey ? -1 : 1); return fpkClose(undefined, ev.shiftKey ? -1 : 1); }
  });
  $('#fpkList').addEventListener('click', ev => { const st = ev.target.closest('[data-star]'); if (st) return fpkStar(+st.dataset.star); const b = ev.target.closest('.pk'); if (b) fpkChoose(+b.dataset.i); });
  $('#fpkManUse').addEventListener('click', fpkManUse);
  [$('#fpkManNo'), $('#fpkManNm')].forEach(el => el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); fpkManUse(); } }));
  $('#fpkCancel').addEventListener('click', () => fpkClose());
  $('#fpkClose').addEventListener('click', () => fpkClose());
  $('#fpkClear').addEventListener('click', () => fpkClose(null));
  $('#fpk').addEventListener('cancel', ev => { ev.preventDefault(); fpkClose(); });
  $('#fpk').addEventListener('click', ev => { if (ev.target === $('#fpk')) fpkClose(); });   // the backdrop
  window.addEventListener('resize', () => { if (fpk) { const sh = SHEET(), d = $('#fpk'); d.classList.toggle('sheet', sh); d.classList.toggle('pop', !sh); fpkSize(); } });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (fpk) fpkSize(); });

  // ---- grid cells
  function fpkFind(g) { return nedFind(g); }
  function fpkCell(cell, q) {
    if (!S || !cell) return; let tr = cell.closest('tr'); if (!tr) return; const kind = cell.dataset.c;
    if (tr.dataset.light) { lightUp(tr); cell = tr.querySelector(`.gc[data-c="${kind}"]`); if (!cell) return; }
    if (ned) nedClose(true);
    const root = cell.closest('#todayList, #histList'), t = cell.closest('table.grid'), e = entryOf(cell);
    gCell = cell; setActive(cell); gNavShow(false); nTipShow(null);
    const grid = { root, day: t ? t.dataset.day : today(), key: tr.dataset.key, id: tr.dataset.id || '' };
    const open = () => fpkOpen({ kind, q, cur: cell.dataset.v || '', sub: 'Row ' + (tr.sectionRowIndex + 1) + (e && ptName(e) ? ' · ' + ptName(e) : ''), anchor: cell.closest('td'), grid, rowFac: e ? facNoOf(e) : '',
      onPick: v => fpkGridPick(grid, kind, v), onDone: (v, move) => { const tr2 = fpkFind(grid), c2 = tr2 && tr2.querySelector(`.gc[data-c="${kind}"]`); if (c2 && S) { if (move) gMove(c2, 0, move, true); else focusCell(c2); } } });
    if (kind === 'fno' && !AHF) loadAhf().then(() => { if (!fpk) open(); }); else open();
  }
  function muCell(btn) {   // v9o: the 01–20 units picker for one time-unit modifier on a row
    if (!S || !btn) return; const tr = btn.closest('tr'), e = entryOf(btn); if (!tr || !e) return; const code = btn.dataset.mu, n = btn.dataset.mn;
    if (ned) nedClose(true); gNavShow(false); nTipShow(null);
    const mc = tr.querySelector(`.gc[data-c="mod${n}"]`); if (mc && document.activeElement !== mc) { gCell = mc; mc.focus({ preventScroll: true }); setActive(mc); }   // the picker hands focus back to the cell, not the chip
    const grid = { root: btn.closest('#todayList, #histList'), key: tr.dataset.key, id: tr.dataset.id || '' }, u = R.muOf(e, code);
    fpkOpen({ kind: 'mu', code, cur: u ? R.p2(u) : '', sugg: R.muSuggest(e, code), mins: R.minsOf(e), sub: `${code} · Row ${tr.sectionRowIndex + 1}${ptName(e) ? ' · ' + ptName(e) : ''}`, anchor: btn.closest('td'), grid,
      onPick: v => gridSave(e.id, 'mu', { code, n: v }),
      onDone: () => { setTimeout(() => { const tr2 = fpkFind(grid), c2 = tr2 && tr2.querySelector(`.gc[data-c="mod${n}"]`); if (c2 && S) focusCell(c2); }, 60); } });
  }
  function fpkPaint(cell, kind, v) {
    if (!cell) return; const e = kind === 'fno' ? (v ? { facNo: v.no, facNm: v.n } : {}) : (v ? { fcen: v } : {});
    const lbl = (cell.getAttribute('aria-label') || '').split(':')[0] || FPK_T[kind];
    const tpl = document.createElement('template'); tpl.innerHTML = fpCell(kind, e, lbl); const n = tpl.content.firstElementChild;
    cell.innerHTML = n.innerHTML; for (const a of ['data-v', 'aria-label', 'title', 'class']) { if (n.hasAttribute(a)) cell.setAttribute(a, n.getAttribute(a)); else cell.removeAttribute(a); }
    fitSoon(cell.closest('table.grid'));
  }
  function fpkGridPick(g, kind, v) {
    if (!S) return; const tr = fpkFind(g), cell = tr && tr.querySelector(`.gc[data-c="${kind}"]`);
    if (v && kind === 'fno') { const nm = AHF_BY.has(v.no) ? AHF_BY.get(v.no)[1] : v.n; v = Object.assign({}, v, { n: nm || '' }); }
    if (!tr) { if (g.id) gridSave(g.id, kind, v); return; }
    if (tr.dataset.blank) {
      if (v == null) return;
      let setMsg = '';
      if (kind === 'fno' && !blankSet[tr.dataset.key]) { const s2 = ahfSet(v.no); if (s2 && s2 !== quickSet) { blankSet[tr.dataset.key] = s2; const hb = tr.querySelector('.gc.hc'); if (hb) hb.textContent = s2; setMsg = ` H/C set to ${s2} (${R.SET[s2]}) from the facility type.`; } }
      fpkPaint(cell, kind, v); createFromBlank(tr, kind, v); g.id = tr.dataset.id || g.id; g.key = tr.dataset.key; fcRemember(g.day, kind, v);
      toast(`${FPK_T[kind]} ${kind === 'fno' ? v.no : v} added.${setMsg}`, setMsg ? 3800 : 2200);
      return;
    }
    fpkPaint(cell, kind, v); gridSave(tr.dataset.id, kind, v); fcRemember(g.day, kind, v);
    if (kind === 'fno' && v) {   // offer (never force) the H/C that matches the official facility type
      const e = S.encs.find(x => x.id === tr.dataset.id), s2 = ahfSet(v.no);
      if (e && s2 && (e.setting === 'C' ? 'C' : 'H') !== s2) snack(`${v.no} is listed as ${s2 === 'H' ? 'a hospital' : 'a community clinic'}. Row is ${e.setting === 'C' ? 'C' : 'H'}.`, async () => { const b = tr.isConnected && tr.querySelector('.gc.hc'); if (b) hcToggle(b, s2); else gridSave(e.id, 'hc', s2); toast(`H/C set to ${s2}`); }, 7000, false, `Set ${s2}`);
    }
  }
  function fpkClearCell(cell) {
    const tr = cell.closest('tr'); if (!tr || tr.dataset.blank || !cell.dataset.v) return; const kind = cell.dataset.c, prev = cell.dataset.v, e0 = entryOf(cell);
    const pv = kind === 'fno' && e0 ? { no: facNoOf(e0), n: R.facNmTxt(e0), mine: !AHF_BY.has(facNoOf(e0)) } : prev;
    fpkPaint(cell, kind, null); gridSave(tr.dataset.id, kind, null);
    snack(`${FPK_T[kind]} cleared`, async () => { const id = tr.dataset.id; gridSave(id, kind, pv); if (tr.isConnected) fpkPaint(tr.querySelector(`.gc[data-c="${kind}"]`), kind, pv); });
  }

  // ---- edit form fields and Settings
  let eFno = null, eFcen = '';
  function eFpShow() {
    const a = $('#eFno'), b = $('#eFcen');
    a.innerHTML = eFno ? `<b>${esc(eFno.no)}</b>${eFno.n ? ' · ' + esc(eFno.n) : ''}${eFno.mine ? ' <small class="muted">(not in listing)</small>' : ''}` : '<span class="muted">Choose…</span>';
    b.innerHTML = eFcen ? `<b>${esc(eFcen)}</b>${R.fcenName(eFcen) ? ' - ' + esc(R.fcenName(eFcen)) : ''}` : '<span class="muted">Choose…</span>';
  }
  function eFpOpen(kind) {
    const go = () => fpkOpen({ kind, cur: kind === 'fno' ? (eFno ? eFno.no : '') : eFcen, sub: 'This entry', anchor: kind === 'fno' ? $('#eFno') : $('#eFcen'), rowFac: eFno ? eFno.no : '',
      onPick: v => { if (kind === 'fno') eFno = v ? { no: v.no, n: AHF_BY.has(v.no) ? AHF_BY.get(v.no)[1] : (v.n || ''), mine: !AHF_BY.has(v.no) } : null; else eFcen = v || ''; eFpShow(); if (v && cur) fcRemember(R.encDay(cur), kind, kind === 'fno' ? eFno : v); },
      onDone: () => { const b = kind === 'fno' ? $('#eFno') : $('#eFcen'); if (b && $('#editDlg').open) b.focus(); } });
    if (kind === 'fno' && !AHF) loadAhf().then(go); else go();
  }
  $('#eFno').addEventListener('click', () => eFpOpen('fno'));
  $('#eFcen').addEventListener('click', () => eFpOpen('fcen'));
  function fpSetUi() {
    if (!S || !$('#fpCard')) return; const st = S.settings;
    $('#fcCarry').checked = st.fcCarry !== false;
    const fRow = (no, sec) => { const x = facInfo(no), nm = x ? x.n : customNm(no); return `<div class="fpsrow"><span><b>${esc(no)}</b> ${esc(nm || '')}${x ? ` <small class="muted">${esc(x.city)}</small>` : ' <small class="muted">not in listing</small>'}</span><button type="button" class="linkbtn sm" data-${sec}="${esc(no)}">${sec === 'unfav' ? 'Remove' : '☆ Favourite'}</button></div>`; };
    const fav = st.favFno || [], rec = (st.recFno || []).filter(n => !fav.includes(n));
    $('#fnoFavList').innerHTML = fav.length ? fav.map(n => fRow(n, 'unfav')).join('') : '<p class="small muted">None yet. Tap ☆ beside a facility in the Facility # list, or Add….</p>';
    $('#fnoRecList').innerHTML = rec.length ? rec.map(n => fRow(n, 'fav')).join('') : '<p class="small muted">Facilities you pick show here.</p>';
    const ff = new Set(st.favFcen || []);
    $('#fcenFavList').innerHTML = R.FCEN.concat(R.FCEN_MORE.filter(f => ff.has(f[0]))).map(f => `<button type="button" class="chipbtn${ff.has(f[0]) ? ' on' : ''}" data-fcen="${esc(f[0])}" aria-pressed="${ff.has(f[0])}">${ff.has(f[0]) ? '★' : '☆'} ${esc(f[0])} - ${esc(f[1])}</button>`).join('');
    $('#fpSrc').textContent = AHF ? ahfSrc() : 'Facility numbers and names: Alberta Health facility listing (loads when first used).';
  }
  $('#fcCarry').addEventListener('change', async () => { S.settings.fcCarry = $('#fcCarry').checked; await saveSettings(); });
  $('#fpCard').addEventListener('click', async ev => {
    const t = ev.target, st = S && S.settings; if (!st) return;
    if (t.dataset.unfav) { st.favFno = (st.favFno || []).filter(n => n !== t.dataset.unfav); await saveSettings(); return fpSetUi(); }
    if (t.dataset.fav) { st.favFno = (st.favFno || []).filter(n => n !== t.dataset.fav).concat(t.dataset.fav); await saveSettings(); return fpSetUi(); }
    const fc = t.closest('[data-fcen]'); if (fc) { const c = fc.dataset.fcen, l = st.favFcen || []; st.favFcen = l.includes(c) ? l.filter(x => x !== c) : l.concat(c); await saveSettings(); return fpSetUi(); }
    if (t.id === 'fnoRecClear') { st.recFno = []; await saveSettings(); return fpSetUi(); }
    if (t.id === 'fnoFavAdd') { await loadAhf(); fpkOpen({ kind: 'fno', manage: false, cur: '', sub: 'Add a favourite', anchor: t, onPick: async v => { if (!v) return; st.favFno = (st.favFno || []).filter(n => n !== v.no).concat(v.no); if (v.mine) st.customFno = [{ no: v.no, n: v.n || '' }].concat((st.customFno || []).filter(c => c.no !== v.no)).slice(0, 20); await saveSettings(); fpSetUi(); toast(`${v.no} added to favourites`); }, onDone: () => { if ($('#fnoFavAdd')) $('#fnoFavAdd').focus(); } }); }
  });

  // ---- v9i: full patient name in a small bubble while a narrow (one-line, ellipsis) name cell has focus
  let nTipFor = null;
  function nTipShow(c) {
    const tip = $('#nTip'); if (!tip) return;
    const on = c && c.dataset && c.dataset.c === 'name' && c.tagName === 'INPUT' && NARROWQ.matches && c.value && c.scrollWidth > c.clientWidth + 1;
    if (!on) { nTipFor = c && c.dataset && c.dataset.c === 'name' ? c : null; tip.hidden = true; tip.textContent = ''; return; }
    nTipFor = c; tip.textContent = c.value; tip.hidden = false;
    const r = c.closest('td').getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.round(Math.max(6, Math.min(r.left, innerWidth - tw - 6))) + 'px';
    tip.style.top = Math.round(r.top - th - 4 >= 4 ? r.top - th - 4 : r.bottom + 4) + 'px';
  }
  $('#todayList').addEventListener('scroll', () => { if (nTipFor && !$('#nTip').hidden) nTipShow(nTipFor); }, { capture: true, passive: true });
  // ---- v9i Settings → Display
  function dispUi() {
    const d = dispLoad(), i = TS.indexOf(d.fs), r = $('#dispSize');
    r.value = String(i); r.setAttribute('aria-valuetext', d.fs + ' px'); $('#dispFont').value = d.font;
    $('#tsVal').textContent = d.fs + ' px' + (d.fs === TS_DEF ? ' (default)' : '');
  }
  let dispT = 0;
  function dispSet(d) {
    try { localStorage.setItem(DISP_KEY, JSON.stringify({ fs: d.fs, font: d.font })); } catch (e) { /* storage blocked: applies until reload */ }
    dispApply(d); dispUi();
    cancelAnimationFrame(dispT); dispT = requestAnimationFrame(() => { if (!S) return; if (fillRows() !== fillRows.last) render(true); else fitAll(); sizeGrid(); });
  }
  $('#dispSize').addEventListener('input', () => { const d = dispLoad(); d.fs = TS[Math.max(0, Math.min(TS.length - 1, +$('#dispSize').value || 0))]; dispSet(d); });
  $('#dispFont').addEventListener('change', () => { const d = dispLoad(); d.font = $('#dispFont').value; dispSet(d); });
  $('#dispReset').addEventListener('click', () => dispSet({ fs: TS_DEF, font: 'system' }));
  dispUi();
  TOUCHQ.addEventListener('change', () => { dispApply(); if (S) fitAll(); });
  NARROWQ.addEventListener('change', () => { if (S) render(true); });
  $('#todayList').addEventListener('scroll', growOnScroll, { capture: true, passive: true });
  window.addEventListener('scroll', () => { if (tab === 'today') { growOnScroll(); pagePinSoon(); } }, { passive: true });
  // v9o: on Today the page itself never stays scrolled: the grid is the only vertical scroller (header row pinned at its top,
  // footer after its last row). iOS may pan the page while the keyboard is up to show the cell; once it closes, back to the top.
  function kbUp() { return !!(window.visualViewport && visualViewport.height < innerHeight - 120); }
  function pagePin() { if (tab === 'today' && document.body.classList.contains('footin') && window.scrollY > 0 && !kbUp()) window.scrollTo(0, 0); }
  function pagePinSoon() { clearTimeout(pagePinSoon.t); pagePinSoon.t = setTimeout(pagePin, 120); }
  if (window.visualViewport) visualViewport.addEventListener('resize', pagePinSoon);
  document.addEventListener('focusout', pagePinSoon);
  // v9o: at the very end of the Today grid (footer in view), keep scrolling — mouse wheel / trackpad, or drag up on a phone —
  // and GROW_BY more empty rows are added each time, without limit; the footer moves down after the new last row.
  const gEnd = w => w.scrollTop + w.clientHeight >= w.scrollHeight - 2;
  let gEndSince = 0, gTouch = null;
  $('#todayList').addEventListener('scroll', ev => { const w = ev.target; if (!w.classList || !w.classList.contains('main')) return; if (gEnd(w)) { if (!gEndSince) gEndSince = Date.now(); } else gEndSince = 0; }, { capture: true, passive: true });
  function growPast(w) {
    const t = w.querySelector('table.grid'); if (!t || !gEndSince || Date.now() - gEndSince < 350) return;
    gEndSince = 0; growGrid(t);   // the scroll-alone cap is not raised, so the footer stays reachable
  }
  $('#todayList').addEventListener('wheel', ev => { const w = ev.target.closest && ev.target.closest('.gwrap.main'); if (w && ev.deltaY > 0 && gEnd(w)) growPast(w); }, { passive: true });
  $('#todayList').addEventListener('touchstart', ev => { const w = ev.target.closest && ev.target.closest('.gwrap.main'); gTouch = w && gEnd(w) && ev.touches.length === 1 ? { w, y: ev.touches[0].clientY } : null; }, { passive: true });
  $('#todayList').addEventListener('touchmove', ev => { if (gTouch && ev.touches.length === 1 && gTouch.y - ev.touches[0].clientY > 40) { const w = gTouch.w; gTouch = null; if (gEnd(w)) growPast(w); } }, { passive: true });
  // the Today grid fills the window below the toolbar (it scrolls inside, like Sheets, with the header and totals pinned)
  // v9o: the grid reaches the bottom of the screen (above the iPhone home indicator); the footer (units rule, disclaimers,
  // links, manual) lives inside the grid's scroll area after the last row, so it shows only when you scroll past the rows.
  const SAB = () => { let p = $('#sabProbe'); if (!p) { p = document.createElement('div'); p.id = 'sabProbe'; p.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none'; document.body.appendChild(p); } return p.offsetHeight || 0; };
  function sizeGrid() {
    const w = $('#todayList .gwrap'); if (!w || tab !== 'today' || document.body.classList.contains('locked')) return;
    const top = w.getBoundingClientRect().top + window.scrollY, h = Math.max(300, Math.floor(window.innerHeight - top - 4 - SAB()));
    if (w.style.height !== h + 'px') w.style.height = h + 'px';
    const g = w.querySelector(':scope > .gfoot'); if (g && g.style.width !== w.clientWidth + 'px') g.style.width = w.clientWidth + 'px';
  }
  function placeFoot() {
    const FOOT = placeFoot.f || (placeFoot.f = document.querySelector('footer.foot')); if (!FOOT) return; const w = S && tab === 'today' && !document.body.classList.contains('locked') ? $('#todayList .gwrap.main') : null;
    if (w) {
      let g = w.querySelector(':scope > .gfoot'); if (!g) { g = document.createElement('div'); g.className = 'gfoot'; }
      if (w.lastElementChild !== g) w.appendChild(g); if (FOOT.parentNode !== g) g.appendChild(FOOT);
      g.style.width = w.clientWidth + 'px'; document.body.classList.add('footin');
    } else { const m = $('#main'); if (m && FOOT.previousElementSibling !== m) m.after(FOOT); document.body.classList.remove('footin'); }
  }
  window.addEventListener('resize', () => { sizeGrid(); placeFoot(); if (S && tab === 'today' && fillRows() !== fillRows.last) render(true); else if (S) fitAll(); });
  function fillRows() {
    const w = $('#todayList .gwrap'), r = w && w.querySelector('tbody tr'), rh = (r && r.offsetHeight) || 30;
    const h = w ? (parseFloat(w.style.height) || w.clientHeight) : window.innerHeight - 200;
    return Math.max(0, Math.floor((h - 2 * rh - 4) / rh));
  }
  function renderToday() {
    const day = curDay(), box = $('#todayList'); let list = dayList(day, true);
    const fill = fillRows(); fillRows.last = fill;
    let w = box.querySelector('.gwrap');
    const old = w && w.querySelector('table.grid'), editing = old && (old.contains(document.activeElement) || nedIn(old)) && old.dataset.day === day;
    // v9f: while you are working in the grid, rows keep their place (a typed In time never moves the row under your cursor);
    // they are re-sorted by time once focus leaves the grid
    // (and a row typed into lower down stays on that line instead of jumping up past the empty rows above it)
    let seq = null, lightFrom = list.length + 1 + Math.max(MIN_BLANK, fill - list.length);
    if (editing) {
      const byId = new Map(list.map(e => [e.id, e])), used = new Set(); seq = [];
      for (const r of old.tBodies[0].rows) { const k = r.dataset.key; if (byId.has(k)) { seq.push(byId.get(k)); used.add(k); } else if (r.dataset.blank) seq.push(null); }
      const extra = list.filter(e => !used.has(e.id)), lastE = seq.reduce((m, x, i) => x ? i : m, -1); seq.splice(lastE + 1, 0, ...extra);
      const lastE2 = seq.reduce((m, x, i) => x ? i : m, -1), T = Math.max(lastE2 + 1 + Math.max(MIN_BLANK, fill - list.length), rowsMin[day] || 0);
      seq.length = Math.min(seq.length, T); while (seq.length < T) seq.push(null);
      lightFrom = lastE2 + 2 + Math.max(MIN_BLANK, fill - list.length);
      const nat = list.map(e => e.id), now = seq.filter(Boolean).map(e => e.id);
      if (now.some((id, i) => id !== nat[i]) || seq.slice(0, lastE2 + 1).includes(null)) todayResort = true;
    }
    const ar = editing && document.activeElement.closest('tr');
    const html = sheetHtml(list, { day, blank: Math.max(MIN_BLANK, fill - list.length, (rowsMin[day] || 0) - list.length), main: true, seq, lightFrom, keepKey: ar ? ar.dataset.key : '' });
    if (editing) { patchGrid(old, html); setActive(gCell); }
    else if (w) { const st = w.scrollTop, sl = w.scrollLeft, same = old && old.dataset.day === day; w.innerHTML = html; if (same) { w.scrollTop = st; w.scrollLeft = sl; } }
    else { box.innerHTML = `<div class="gwrap main">${html}</div>`; w = box.firstElementChild; }
    fitCols(w.querySelector('table.grid'));
    sizeGrid(); placeFoot();
  }
  // ---- v9f dynamic column widths: each column fits its longest content (header and cells) between a minimum and a maximum;
  // past the maximum, name / codes / notes wrap and the row grows. Measured with a canvas in the cells' own fonts.
  // v9i: [min desktop, min touch, max] in characters ('0' widths of the column's font, cell padding included), so the
  // minimums scale with Settings → Display → Text size: MRN/PHN 10 digits, Fee code 6 + ↗, Dx 5 + ↗, Billing notes wider.
  // Patient name on a narrow screen: at most ~30 % of the width (one line, ellipsis; the full name shows on focus).
  // v9k (Jose: several codes per patient; narrow / shallow code cells were hard to fill): Fee code(s) and Dx fit ~15 code
  // characters next to their ↗ ⓘ buttons, the two Modifier columns ~15 characters, before anything wraps; the cell being
  // edited is at least two lines tall (CSS) and every code cell wraps and grows the row instead of clipping.
  const CODEC = { fee: 1, mod1: 1, mod2: 1, dx: 1 };
  const FIT = { name: [22, 13, 34], mrn: [12.5, 12.5, 26], fno: [10, 10, 30], fcen: [8.5, 8.5, 22], fee: [24.5, 25.5, 46], mod1: [18, 18, 38], mod2: [18, 18, 38], dx: [24.5, 25.5, 46], note: [30, 28, 44] };
  function fitPx(key, need, ch, ww, touch) {
    const cfg = FIT[key], mn = cfg[touch ? 1 : 0] * ch; let max = cfg[2] * ch;
    if (key === 'name' && ww < 700) max = Math.min(max, Math.max(mn, ww * 0.30));
    else if (CODEC[key] && ww < 700) max = Math.min(max, Math.max(mn, ww * 0.62));
    else if (FPC[key] && ww < 700) max = Math.min(max, Math.max(mn, ww * (key === 'fno' ? 0.42 : 0.36)));   // v9o phone: the code / number always shows, the name where room   // v9k phone: a code column never takes the whole screen; long lists wrap
    return Math.ceil(Math.min(Math.max(need, mn), Math.max(max, mn)));
  }
  const txtOf = el => el.tagName === 'DIV' ? el.textContent : (el.value || el.placeholder || '');
  let fitBtn = 25;
  // v9g perf (100–150 rows a day): measurements are cached (per text+font, and per cell), all layout reads happen before
  // the writes, wrapping heights are set in one batch, and while you type only the edited cell is re-measured: the whole
  // table is refitted only when that cell actually changes a column's width.
  let fitCtx = null, fitFont = ''; const fitQ = new Map(), fitMC = new Map(), fitEC = new WeakMap();
  const fontOf = el => { const s = getComputedStyle(el); return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; };
  function fitMw(s, f) {
    const k = f + '\u0001' + s; let v = fitMC.get(k);
    if (v === undefined) { if (fitMC.size > 6000) fitMC.clear(); if (fitFont !== f) { fitCtx.font = f; fitFont = f; } v = fitCtx.measureText(s).width; fitMC.set(k, v); }
    return v;
  }
  // one cell's text width (cached on the element until its text, font or buttons change)
  function fitRec(el, f, txt) {
    const cw = el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('cw') ? el.parentNode : el.closest('.cw');
    const ck = f + '\u0001' + (cw ? cw.childElementCount : 0) + '\u0001' + txt;
    let rec = fitEC.get(el);
    if (!rec || rec.k !== ck) {
      const line = txt.split('\n').reduce((m, x) => x.length > m.length ? x : m, '');
      const extra = cw ? cw.querySelectorAll('.cbtn, .tag').length * fitBtn : 0;
      rec = { k: ck, tw: fitMw(line, f) + 18 + extra, multi: line !== txt }; fitEC.set(el, rec);
    }
    return rec;
  }
  // typing: grow the cell while the text grows; shrink (a full re-measure) only when text was removed
  function autoHType(ta) {
    const n = ta.value.length, grew = n >= (ta._fitLen || 0); ta._fitLen = n;
    if (grew && ta.scrollHeight <= ta.clientHeight + 1) return;
    if (grew) { ta.style.height = ta.scrollHeight + 'px'; return; }
    autoH(ta);
  }
  function fitCols(t, only) {
    if (!t || !t.isConnected || !t.offsetParent) return;
    if (!fitCtx) fitCtx = document.createElement('canvas').getContext('2d');
    const w = t.closest('.gwrap'), ww = (w && w.clientWidth) || innerWidth, touch = matchMedia('(max-width:767px),(pointer:coarse)').matches;
    // fast path while typing: re-measure only the edited column; if its width stays the same, nothing else can change
    const st = t._fit, okey = only && only.dataset && only.dataset.c;
    if (only && st && st.ww === ww && st.touch === touch && FIT[okey] && st.px[okey] != null) {
      const f = okey !== 'name' && okey !== 'note' ? st.fM : st.fS;
      let need = st.head[okey] || 0;
      for (const el of t.querySelectorAll(`tbody .gc[data-c="${okey}"]`)) { const txt = txtOf(el); if (txt) need = Math.max(need, fitRec(el, f, txt).tw); }
      const px = fitPx(okey, need, st.ch[okey], ww, touch);
      if (px === st.px[okey]) {
        if (only.tagName === 'TEXTAREA') { const txt = only.value; const r = txt ? fitRec(only, f, txt) : null;
          if (r && (r.multi || r.tw > px + 1)) autoHType(only); else if (only.style.height) only.style.height = ''; }
        return;
      }
    }
    const sans = t.querySelector('tbody .gc[data-c="name"]'), mono = t.querySelector('tbody .gc.mono'), th = t.querySelector('thead th.h-name');
    const fS = sans ? fontOf(sans) : '13px sans-serif', fM = mono ? fontOf(mono) : fS, fH = th ? fontOf(th) : fS;
    const memo = { ww, touch, fS, fM, px: {}, head: {}, ch: {} };
    { const fsx = parseFloat(getComputedStyle(t).fontSize) || 13; fitBtn = Math.round(touch ? Math.max(30, fsx * 1.9 + 4) : Math.max(25, fsx * 1.55 + 6)); }   // ↗ / ▶ / tags
    const cols = [...t.querySelectorAll('colgroup col')], keys = cols.map(c => c.className.replace(/^c-/, ''));
    const fixed = cols.map((c, i) => FIT[keys[i]] ? 0 : (parseFloat(getComputedStyle(c).width) || 0));   // reads first
    let sum = 0, noteW = 0, noteCol = null, changed = false, onlyRec = null; const longs = [], widths = {};
    cols.forEach((col, i) => {
      const key = keys[i], cfg = FIT[key];
      if (!cfg) { sum += fixed[i]; return; }
      const h = t.querySelector(`thead [data-h="${key}"]`), isM = key !== 'name' && key !== 'note', f = isM ? fM : fS, ch = fitMw('0', f);
      let need = h ? fitMw(h.textContent, fH) + 18 : 0; memo.head[key] = need; memo.ch[key] = ch;
      for (const el of t.querySelectorAll(`tbody .gc[data-c="${key}"]`)) {
        const txt = txtOf(el); if (!txt) continue;
        const rec = fitRec(el, f, txt);
        need = Math.max(need, rec.tw);
        if (el.tagName === 'TEXTAREA' && el.value) longs.push([el, key, rec.tw, rec.multi]);
        if (el === only) onlyRec = [el, key, rec.tw, rec.multi];
      }
      const px = fitPx(key, need, ch, ww, touch);
      widths[key] = px; memo.px[key] = px;
      if (key === 'note') { noteW = px; noteCol = col; return; }
      if (col.style.width !== px + 'px') { col.style.width = px + 'px'; changed = true; }
      if (key === 'name') { const v = px + 'px'; if (t.style.getPropertyValue('--g-name-w') !== v) t.style.setProperty('--g-name-w', v); }
      sum += px;
    });
    // Billing notes takes the rest of the screen (at least its own fitted width); the table never truncates a column.
    // v9j: explicit pixel widths for the notes column AND the table. iOS WebKit ignores min-width on a table-layout:fixed
    // table, so with only min-width the table stayed 100 % of the phone and the auto-width Billing notes column got 0 px
    // (the skinny "⋯" column Jose saw on build 5). Chromium hid the bug.
    const total = Math.ceil(Math.max(ww, sum + noteW)), nPx = Math.max(noteW, total - Math.ceil(sum));
    if (noteCol && noteCol.style.width !== nPx + 'px') { noteCol.style.width = nPx + 'px'; changed = true; }
    const tw = (Math.ceil(sum) + nPx) + 'px';
    if (t.style.minWidth !== tw) { t.style.minWidth = tw; changed = true; }
    if (t.style.width !== tw) { t.style.width = tw; changed = true; }
    memo.px.note = nPx;
    t._fit = memo;
    const wraps = l => l[3] || l[2] > widths[l[1]] + 1;
    // typing: no column changed → only the edited cell can need a new height
    if (only && !changed) {
      if (onlyRec && only.tagName === 'TEXTAREA') { if (wraps(onlyRec)) autoHType(only); else if (only.style.height) only.style.height = ''; }
      else if (only.tagName === 'TEXTAREA' && only.style.height && !only.value) only.style.height = '';
      return;
    }
    // wrapping cells: only those wider than their column (or with a line break) get a measured height; the rest go back to one line
    const tall = longs.filter(wraps).map(l => l[0]), tallSet = new Set(tall);
    for (const ta of t.querySelectorAll('tbody textarea.gc[style]')) if (!tallSet.has(ta) && ta.style.height) ta.style.height = '';
    for (const ta of tall) ta.style.height = '';                                       // writes
    const hs = tall.map(ta => [ta.scrollHeight, ta.clientHeight]);                     // one layout
    tall.forEach((ta, i) => { if (hs[i][0] > hs[i][1] + 1) ta.style.height = hs[i][0] + 'px'; });   // writes
  }
  function autoH(ta) { ta.style.height = ''; const h = ta.scrollHeight; if (h > ta.clientHeight + 1) ta.style.height = h + 'px'; }
  // one refit per frame per table; `only` = the cell being typed in (a full refit wins if one was asked for)
  function fitSoon(t, only) {
    if (!t) return; const had = fitQ.has(t), prev = fitQ.get(t);
    fitQ.set(t, !had ? (only || null) : (prev && prev === only ? prev : null));
    if (fitQ.size === 1 && !had) requestAnimationFrame(() => { const l = [...fitQ]; fitQ.clear(); l.forEach(([tb, o]) => fitCols(tb, o)); });
  }
  function fitAll(root) { (root || document).querySelectorAll('table.grid').forEach(fitCols); }
  // ---- v9f touch helpers: keep the cell above the on-screen keyboard; a floating ← Next → bar while a cell is active
  let kbT = null;
  function kbSoon() { clearTimeout(kbT); kbT = setTimeout(kbKeep, 320); }
  function kbKeep() {
    const c = document.activeElement; if (!c || !c.closest || !c.closest('table.grid') || !c.classList.contains('gc')) return;
    const vv = window.visualViewport, top = (vv ? vv.offsetTop : 0) + 34, bot = (vv ? vv.offsetTop + vv.height : innerHeight) - (COARSE() ? 58 : 6);
    const fix = () => { const r = c.getBoundingClientRect(); return r.bottom > bot ? r.bottom - bot : r.top < top ? r.top - top : 0; };
    let d = fix(); if (!d) return; const w = c.closest('.gwrap'); if (w) w.scrollTop += d; d = fix(); if (d) window.scrollBy(0, d);
    gNavPos();
  }
  function gNavPos() { const n = $('#gNav'), vv = window.visualViewport; if (!n || n.hidden) return; n.style.top = Math.round((vv ? vv.offsetTop + vv.height : innerHeight) - n.offsetHeight - 8) + 'px'; snackAvoidNav(); }
  function gNavShow(on) { const n = $('#gNav'); if (!n) return; n.hidden = !(on && COARSE()); gNavPos(); if (n.hidden) snackAvoidNav(); }
  if (window.visualViewport) { visualViewport.addEventListener('resize', () => { gNavPos(); kbSoon(); }); visualViewport.addEventListener('scroll', gNavPos); }
  // the explicit arrow buttons (toolbar ← → and the floating touch bar): same as Shift+Tab / Tab
  function gStep(dir) {
    const c = gCell && document.contains(gCell) ? gCell : null;
    if (!c) { const f = $('#todayList tbody .gc[data-c="name"]'); if (f) focusCell(f); return; }
    commitCell(c); gMove(c, 0, dir, true);
  }
  [['#gPrev', -1], ['#gNext', 1], ['#gPrevF', -1], ['#gNextF', 1]].forEach(([s, d]) => { const b = $(s); if (!b) return;
    ['pointerdown', 'mousedown'].forEach(n => b.addEventListener(n, ev => ev.preventDefault()));   // keep focus (and the phone keyboard) in the cell
    b.addEventListener('click', () => gStep(d)); });
  function renderToolbar() {
    const day = curDay(), td = today(), isT = day === td, d = new Date(day + 'T12:00');
    $('#dLbl').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) + (isT ? ' · Today' : '');
    $('#dPick').value = day; $('#dToday').disabled = isT; $('#dToday').classList.toggle('on', !isT); $('#dNext').disabled = day >= td;
    $('#tbar').classList.toggle('past', !isT);
    const ws = weekStart(day), we = shiftDay(ws, 6), wl = S.encs.filter(e => { const k = R.encDay(e); return k >= ws && k <= we && kindOf(e) !== 'shift'; }), wt = R.totals(wl);
    $('#wkTot').innerHTML = `Week <b>${wt.H.m + wt.C.m + wt.cb.m}</b> min · <b>${wt.H.u + wt.C.u + wt.cb.u}</b> u`;
    $('#wkTot').title = `Week of ${R.fmtDay(ws)} (Mon–Sun): ${wl.length} entr${wl.length === 1 ? 'y' : 'ies'}. Hospital ${wt.H.m} min / ${wt.H.u} u, Clinic ${wt.C.m} min / ${wt.C.u} u${wt.cb.n ? `, call-backs ${wt.cb.m} min` : ''}`;
  }
  // ============================================================ v9g pick-and-return with MedBilling Fee Desk
  // ↗ / ⓘ in a Fee code(s) or Dx cell opens Fee Desk in "pick mode". Tapping a code there sends it straight back into the
  // same cell. Only the code, its kind and a random one-time token travel (URL / same-origin messages); never patient data.
  // The pending pick (entry id, column, token, time: no patient data) lives in localStorage because the vault is encrypted
  // and may be locked when the code comes back: then the code waits and is applied right after unlock.
  const PICK_KEY = 'bl.pick.v1', PICK_MSG = 'medbilling.pick.v1', PICK_TTL = 30 * 60000, FD_GRACE = 10 * 60000;
  const PICK_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/, TOK_RE = /^[a-f0-9]{32}$/;
  let fdSince = 0, pickBusy = false;
  const pickBC = (() => { try { return 'BroadcastChannel' in window ? new BroadcastChannel('medbilling-pick') : null; } catch (e) { return null; } })();
  function pickLoad() {
    try { const p = JSON.parse(localStorage.getItem(PICK_KEY) || 'null'); if (!p || !TOK_RE.test(p.tok || '') || typeof p.id !== 'string') return null;
      if (Date.now() - (p.pt || p.t) > PICK_TTL) { localStorage.removeItem(PICK_KEY); return null; } return p; } catch (e) { return null; }
  }
  function pickSave(p) { try { localStorage.setItem(PICK_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }
  function pickClear() { try { localStorage.removeItem(PICK_KEY); } catch (e) { /* ignore */ } }
  const pickTok = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  function fdBack() { fdSince = 0; }
  function pickInFeeDesk(e, kind, at) {
    if (!e || !kind) return;
    const col = kind === 'dx' ? 'dx' : 'fee', tok = pickTok();
    const act = document.activeElement; if (act && act.classList && act.classList.contains('gc')) commitCell(act);   // save what was typed first
    pickSave({ tok, id: e.id, col, day: R.encDay(e), tab, t: Date.now() });
    const u = new URL(FD);
    u.searchParams.set('pick', col === 'dx' ? 'dx' : 'hsc'); u.searchParams.set('ctx', tok);
    u.searchParams.set('pv', '2');   // v9l: Logs takes several codes at once (pick protocol 2); older Fee Desk versions ignore it
    u.searchParams.set('pmax', String(PICK_MAX));   // v9m: up to 10 per kind (Fee Desk v37+; v36 keeps 3, which is still accepted)
    u.searchParams.set('return', NATIVE ? 'mblogs://pick' : location.origin + location.pathname);
    const cs = e.codes || [], j = (cs[cs.length - 1] && cs[cs.length - 1].j) || (S && S.settings.prov) || 'AB';
    if (/^[A-Z]{2}$/.test(j)) u.searchParams.set('jur', j);
    // deep link only to a code that is in the bundled lists (never free text)
    if (at) { const h = col === 'dx' ? fdDxHref(at) : fdCodeHref(at, j); u.hash = h.includes('#') ? h.slice(h.indexOf('#')) : ''; }
    else if (col === 'dx') u.hash = '#/icd9';
    fdSince = Date.now(); pickStart();
    const hint = (col === 'dx' ? 'Tap an ICD-9 code in Fee Desk to bring it back' : 'Tap a fee code in Fee Desk to bring it back') + ' (＋ picks several)';
    if (NATIVE) { window.open(u.href, '_blank'); toast(hint, 3000); return; }
    // a named window keeps the opener, so Fee Desk can hand the code back to this tab and close itself
    let w = null; try { w = window.open(u.href, 'mbfeedesk'); } catch (er) { w = null; }
    if (w) { toast(hint, 3000); return; }
    // pop-up blocked: go there in this tab once the save is done (the code comes back in the return link)
    picking = Math.max(0, picking - 1); fdSince = 0;
    gQ.then(() => location.assign(u.href));
  }
  // a code arrived (return link, BroadcastChannel, storage event or a message left in localStorage)
  function pickInbound(code, kind, tok) {
    code = String(code || '').trim().toUpperCase(); kind = kind === 'dx' ? 'dx' : kind === 'hsc' ? 'hsc' : '';
    if (!TOK_RE.test(tok || '') || !kind || !PICK_RE.test(code)) return 'bad';
    const p = pickLoad(); if (!p || p.tok !== tok) return 'stale';
    if (p.picked) return 'held';
    p.picked = { code, kind }; p.pt = Date.now(); pickSave(p);
    picking = 0; fdSince = 0;
    if (S) { pickApply(); return 'applied'; }
    $('#lockMsg').textContent = `Unlock to add ${code} to the spreadsheet.`;
    return 'held';
  }
  // ---- v9l multi-code return (pick protocol 2). Logs asks for it with pv=2 (v9m: and pmax=10); Fee Desk may then send up to 10
  // fee codes, 10 ICD-9 codes and 10 modifiers at once (3 each from Fee Desk v36): ?pickv=2&ctx=<token>&fee=A,B&dx=X&dxfor=A&mod=M1,M2&modfor=A, (return link / mblogs://pick)
  // or {type:'pick', v:2, ctx, fee:[], dx:[], dxFor:[], mod:[], modFor:[]} (same-browser message). "dxfor"/"modfor" are
  // positional: the fee code (from the same send) each Dx / modifier belongs to, or empty. One code per pick (?picked=…&kind=…)
  // still works exactly as before. Same one-time token, same checks: codes only, never patient data.
  const MODC_RE = /^[A-Z0-9]{1,8}$/, PICK_MAX = 10;
  function pickParse2(o) {
    const arr = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(',')).map(x => String(x == null ? '' : x).trim().toUpperCase());
    const raw = { fee: arr(o.fee), dx: arr(o.dx), mod: arr(o.mod) };
    if (raw.fee.length > PICK_MAX || raw.dx.length > PICK_MAX || raw.mod.length > PICK_MAX) return null;
    if (!raw.fee.every(c => PICK_RE.test(c)) || !raw.dx.every(c => PICK_RE.test(c)) || !raw.mod.every(c => MODC_RE.test(c))) return null;
    const fee = raw.fee.filter((c, i, a) => a.indexOf(c) === i);
    const withFor = (list, fr) => { const f = arr(fr), out = [], forOut = [];
      list.forEach((c, i) => { if (out.includes(c)) return; out.push(c); forOut.push(fee.includes(f[i]) ? f[i] : ''); }); return [out, forOut]; };
    const [dx, dxFor] = withFor(raw.dx, o.dxFor != null ? o.dxFor : o.dxfor), [mod, modFor] = withFor(raw.mod, o.modFor != null ? o.modFor : o.modfor);
    if (!(fee.length + dx.length + mod.length)) return null;
    return { v: 2, fee, dx, dxFor, mod, modFor };
  }
  function pickInbound2(o, tok) {
    if (!TOK_RE.test(tok || '')) return 'bad';
    const v = pickParse2(o || {}); if (!v) return 'bad';
    const p = pickLoad(); if (!p || p.tok !== tok) return 'stale';
    if (p.picked) return 'held';
    p.picked = v; p.pt = Date.now(); pickSave(p);
    picking = 0; fdSince = 0;
    if (S) { pickApply(); return 'applied'; }
    $('#lockMsg').textContent = pickLockMsg();
    return 'held';
  }
  const pickCodesTxt = v => { const all = [].concat(v.fee, v.dx, v.mod); return all.length <= 3 ? all.join(', ') : all.length + ' codes'; };
  // merge the codes into the row (a clone): Fee code(s) append without duplicates; Dx: beside the fee code it came with, else on fee
  // codes that have none (new ones first), never replacing one; v9m: any more are appended after them (e.dxx), never refused; modifiers: Modifier code 1 for the row's first fee
  // code, Modifier code 2 for its second or later fee code; a modifier linked to (or sent with only) one fee code follows that fee
  // code, others go to Modifier code 1; never a duplicate across the two cells. Returns what happened, for the confirmation.
  async function pickMerge(e, v) {
    const nc = s => norm(s), out = { fee: [], dx: [], m1: [], m2: [], have: [], skipped: [] };
    const list0 = (e.codes || []).map(c => c.c), newFee = [];
    v.fee.forEach(c => { if (list0.concat(newFee).some(x => nc(x) === nc(c))) out.have.push(c); else newFee.push(c); });
    if (newFee.length) {
      await applyCell(e, 'fee', list0.concat(newFee).join(', '), R.encDay(e));
      out.fee = (e.codes || []).slice(list0.length).map(c => c.c);
      // a Dx typed before there was any fee code moves onto the first fee code without one (as when typing in the Dx cell)
      if (e.dx && e.codes.length) { const j = e.codes.findIndex(c => !c.dx); if (j >= 0 && !e.codes.some(c => c.dx && nc(c.dx) === nc(e.dx))) { e.codes[j] = Object.assign({}, e.codes[j], { dx: e.dx, dxd: dxDesc(e.dx) }); delete e.dx; } }
    }
    const codes = e.codes || [], posOf = f => f ? codes.findIndex(c => nc(c.c) === nc(f) || nc(c.k || '') === nc(f)) : -1;
    if (v.dx.length) {
      await loadIcd().catch(() => null);
      const dl = R.dxList(e);
      v.dx.forEach((d, i) => {
        if (dl.some(x => nc(x) === nc(d))) { out.have.push(d); return; }
        const extra = () => { e.dxx = (Array.isArray(e.dxx) ? e.dxx : []).concat(d); dl.push(d); out.dx.push(d); };
        if (!codes.length) { if (!e.dx) { e.dx = d; dl.push(d); out.dx.push(d); } else extra(); return; }
        let at = posOf(v.dxFor[i]); if (at >= 0 && codes[at].dx) at = -1;
        if (at < 0) { const order = codes.map((c, j) => j).sort((a, b) => ((b >= list0.length) - (a >= list0.length)) || a - b); const f = order.find(j => !codes[j].dx); at = f == null ? -1 : f; }
        if (at < 0) { extra(); return; }
        codes[at] = Object.assign({}, codes[at], { dx: d, dxd: dxDesc(d) }); dl.push(d); out.dx.push(d);
      });
      e.codes = codes; if (codes.length && e.dx && codes.some(c => c.dx && nc(c.dx) === nc(e.dx))) delete e.dx;
      if (codes.length && e.dx) { e.dxx = [e.dx].concat(Array.isArray(e.dxx) ? e.dxx : []); delete e.dx; }   // an entry-level Dx stays, as an extra
    }
    if (v.mod.length) {
      const m = { 1: R.normMods(e.mod1).split(', ').filter(Boolean), 2: R.normMods(e.mod2).split(', ').filter(Boolean) };
      v.mod.forEach((x, i) => {
        if (m[1].includes(x) || m[2].includes(x)) { out.have.push(x); return; }
        const f = v.modFor[i] || (v.fee.length === 1 ? v.fee[0] : ''), n = posOf(f) > 0 ? 2 : 1;
        if (m[n].concat(x).join(', ').length > MOD_MAX) { out.skipped.push(x); return; }
        m[n].push(x); out['m' + n].push(x);
      });
      [1, 2].forEach(n => { const s = m[n].join(', '); if (s) e['mod' + n] = s; else delete e['mod' + n]; });
    }
    out.noFee = !codes.length;
    out.changed = !!(out.fee.length || out.dx.length || out.m1.length || out.m2.length);
    return out;
  }
  async function pickApply2(p) {
    const v = p.picked;
    if (!S.encs.find(x => x.id === p.id)) { toast(`That row no longer exists, so ${pickCodesTxt(v)} ${[].concat(v.fee, v.dx, v.mod).length === 1 ? 'was' : 'were'} not added`, 4000); return; }
    const act = document.activeElement; if (act && act.classList && act.classList.contains('gc')) commitCell(act);
    let r = null, before = null, after = null;
    await gEnq(async () => {
      const cur = S.encs.find(x => x.id === p.id); if (!cur) return;
      const e = clone(cur); before = clone(cur);
      r = await pickMerge(e, v); if (!r.changed) return;
      const aud = [r.fee.length && 'fee +' + r.fee.join(', '), r.dx.length && 'Dx +' + r.dx.join(', '), r.m1.length && 'modifier 1 +' + r.m1.join(', '), r.m2.length && 'modifier 2 +' + r.m2.join(', ')].filter(Boolean).join('; ');
      await saveEnc(e, 'edit', 'Codes picked in Fee Desk: ' + aud); after = e;
    });
    pickFocus(p, p.col);
    if (!r) return;
    const parts = [r.fee.length && 'Fee ' + r.fee.join(', '), r.dx.length && 'Dx ' + r.dx.join(', '), r.m1.length && 'Modifier 1 ' + r.m1.join(', '), r.m2.length && 'Modifier 2 ' + r.m2.join(', ')].filter(Boolean);
    const msg = (parts.length ? 'Added: ' + parts.join(' · ') : 'Nothing new added') + (r.have.length ? `. Already in this row: ${r.have.join(', ')}` : '') +
      (r.skipped.length ? `. Not added: ${r.skipped.join(', ')} (cell full)` : '');
    pickConfirm(p, r);
    if (after) snack(msg, () => undoTo(before, after, 'Codes from Fee Desk removed'), 9000, true); else toast(msg, 4500);
  }
  // a brief highlight on the cells that were filled, so it is clear where the codes went
  function pickConfirm(p, r) {
    const cols = [r.fee.length && 'fee', r.m1.length && 'mod1', r.m2.length && 'mod2', r.dx.length && 'dx'].filter(Boolean);
    requestAnimationFrame(() => cols.forEach(c => { const el = $(`${tab === 'history' ? '#histList' : '#todayList'} tr[data-id="${CSS.escape(p.id)}"] .gc[data-c="${c}"]`); const td = el && el.closest('td');
      if (td) { td.classList.remove('pickfill'); void td.offsetWidth; td.classList.add('pickfill'); setTimeout(() => td.classList.remove('pickfill'), 2600); } }));
  }
  function pickCancelled(tok) { const p = pickLoad(); if (p && p.tok === tok && !p.picked) { pickClear(); picking = 0; fdSince = 0; if (S) pickFocus(p, null); } }
  function pickReadMsg() {
    let m = null; try { m = JSON.parse(localStorage.getItem(PICK_MSG) || 'null'); } catch (e) { m = null; }
    if (!m || typeof m !== 'object') return;
    try { localStorage.removeItem(PICK_MSG); } catch (e) { /* ignore */ }
    if (Date.now() - (m.t || 0) > PICK_TTL) return;
    if (m.type === 'cancel') pickCancelled(m.ctx); else if (m.v === 2) pickInbound2(m, m.ctx); else pickInbound(m.code, m.kind, m.ctx);
  }
  if (pickBC) pickBC.onmessage = ev => {
    const m = ev.data || {}; if (typeof m !== 'object') return;
    if (m.type === 'pick') { const st = m.v === 2 ? pickInbound2(m, m.ctx) : pickInbound(m.code, m.kind, m.ctx); if (st !== 'bad' && st !== 'stale') { pickBC.postMessage({ type: 'ack', ctx: m.ctx, status: st }); try { localStorage.removeItem(PICK_MSG); } catch (e) { /* ignore */ } } }
    else if (m.type === 'cancel') { const p = pickLoad(); if (p && p.tok === m.ctx) { pickCancelled(m.ctx); pickBC.postMessage({ type: 'ack', ctx: m.ctx, status: 'cancelled' }); } }
  };
  window.addEventListener('storage', ev => { if (ev.key === PICK_MSG && ev.newValue) pickReadMsg(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pickReadMsg(); if (fdSince) fdBack(); } });
  // the return link: ?picked=<code>&kind=hsc|dx&ctx=<token>, v9l ?pickv=2&ctx=<token>&fee=…&dx=…&dxfor=…&mod=…&modfor=…
  // (or ?pickcancel=1&ctx=<token>); read once, then removed from the address bar
  function pickFromUrl(href) {
    let u; try { u = new URL(href); } catch (e) { return; }
    const sp = u.searchParams; if (!sp.has('picked') && !sp.has('pickcancel') && !sp.has('pickv')) return false;
    const tok = sp.get('ctx') || '';
    if (sp.has('pickcancel')) pickCancelled(tok);
    else if (sp.get('pickv') === '2') pickInbound2({ fee: sp.get('fee'), dx: sp.get('dx'), dxFor: sp.get('dxfor'), mod: sp.get('mod'), modFor: sp.get('modfor') }, tok);
    else if (sp.has('picked')) pickInbound(sp.get('picked'), sp.get('kind'), tok);
    return true;
  }
  if (pickFromUrl(location.href)) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } }
  pickReadMsg();
  // native app: Fee Desk returns with mblogs://pick?picked=…&kind=…&ctx=… (native.js passes it here; same validation)
  window.__mblPick = href => { let u; try { u = new URL(href); } catch (e) { return; } if (u.protocol !== 'mblogs:' || u.hostname !== 'pick') return; pickFromUrl(u.href); };
  window.__mblPickEnd = () => { if (fdSince) { picking = Math.max(0, picking - 1); fdSince = 0; lastAct = Date.now(); } };
  // put the code into the cell it was picked for (Fee code(s): append, no duplicates; Dx: one per fee code, as when typing)
  async function pickApply() {
    if (!S || pickBusy) return;
    const p = pickLoad(); if (!p || !p.picked) return;
    pickBusy = true; pickClear();
    try {
      if (p.picked.v === 2) { await pickApply2(p); return; }
      const { code, kind } = p.picked, col = kind === 'dx' ? 'dx' : 'fee';
      const e0 = S.encs.find(x => x.id === p.id);
      if (!e0) { toast(`That row no longer exists, so ${code} was not added`, 4000); return; }
      const act = document.activeElement; if (act && act.classList && act.classList.contains('gc')) commitCell(act);
      let msg = '', undo = null;
      await gEnq(async () => {
        const cur = S.encs.find(x => x.id === p.id); if (!cur) return;
        const e = clone(cur), before = clone(cur), nc = s => norm(s);
        if (col === 'fee') {
          const list = (e.codes || []).map(c => c.c);
          if (list.some(c => nc(c) === nc(code))) { msg = `${code} is already in this row`; return; }
          await applyCell(e, 'fee', list.concat(code).join(', '), R.encDay(e)); msg = `${code} added`;
          await saveEnc(e, 'edit', `Fee code ${code} picked in Fee Desk`);
        } else {
          // v9n: same placement as the multi-code pick: beside the first fee code without a Dx, else added after the others (extra
          // Dx); an existing Dx is never replaced; a code already in the row is not added twice
          if (R.dxList(e).some(c => nc(c) === nc(code))) { msg = `${code} is already in this row`; return; }
          const r = await pickMerge(e, { v: 2, fee: [], dx: [code], dxFor: [''], mod: [], modFor: [] });
          if (!r.changed) { msg = `${code} is already in this row`; return; }
          await saveEnc(e, 'edit', `Diagnostic code ${code} picked in Fee Desk`);
          const by = (e.codes || []).find(c => c.dx && nc(c.dx) === nc(code));
          msg = by && (e.codes || []).length > 1 ? `${code} added beside ${by.c}` : `${code} added`;
          undo = () => undoTo(before, e, `${code} removed`);
        }
      });
      pickFocus(p, col);
      if (undo) snack(msg, undo); else { hideSnack(); toast(msg, 2600); }   // v9n: an older Undo never lingers beside a new message
    } catch (er) { toast('Could not add the code: ' + ((er && er.message) || er), 4000); }
    finally { pickBusy = false; }
  }
  // cursor back in the cell the pick started from (same row, same column); shows that day if it is not on screen
  function pickFocus(p, col) {
    col = col || p.col;
    const sel = `tr[data-id="${CSS.escape(p.id)}"] .gc[data-c="${col}"]`;
    let el = $((tab === 'history' ? '#histList ' : '#todayList ') + sel) || $('#todayList ' + sel);
    if (!el && p.tab !== 'history') { const e = S.encs.find(x => x.id === p.id); if (e) { setDay(R.encDay(e)); el = $('#todayList ' + sel); } }
    if (!el) { const e2 = S.encs.find(x => x.id === p.id); if (e2) histDay(R.encDay(e2)); else histNow(); el = $('#histList ' + sel); }
    if (!el) return;
    if (el.closest('#histList') && tab !== 'history') { tab = 'history'; showTab(); }
    focusCell(el); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* not a text field */ }
  }
  function pickLockMsg() { const p = pickLoad(); return p && p.picked ? `Unlock to add ${p.picked.v === 2 ? pickCodesTxt(p.picked) : p.picked.code} to the spreadsheet.` : ''; }

  function render() {
    if (!S) return;
    renderOnsite(); renderToolbar(); renderTrackAgain();
    renderToday();
    $('#unitsNote').textContent = R.UNITS_NOTE;
    if (tab === 'history') { histStale = false; renderHistory(); } else histStale = true;   // v9g: History (1,000s of rows) is drawn when shown
    renderRetention(); renderPbar(); renderPeriodSettings(); renderPrem(); premCheck();
    if ($('#revDlg').open) renderReview(); if ($('#tlDlg').open) renderTimeline();
    $('#storeInfo').textContent = `${S.encs.length} entr${S.encs.length === 1 ? 'y' : 'ies'} and ${S.encs.reduce((a, e) => a + (e.photos || []).length, 0)} photo(s) stored encrypted on this device.`;
  }
  function weekStart(k) { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return R.dayKey(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12).getTime()); }
  const histSort = l => l.slice().sort((a, b) => R.startOf(a) - R.startOf(b) || (a.created || 0) - (b.created || 0));
  const HIST_EAGER = 300; let histDays = null, histIO = null;
  function histLazy(hl) {
    const lz = hl.querySelectorAll('.gwrap[data-lazy]'); if (histIO) histIO.disconnect(); if (!lz.length) return;
    const r = hl.querySelector('table.grid tbody tr'), rh = (r && r.offsetHeight) || 31;
    lz.forEach(el => { el.style.height = Math.round((+el.dataset.n + 2) * rh + 4) + 'px'; });   // CSSOM (CSP allows it), keeps the scroll length right
    if (!('IntersectionObserver' in window)) { lz.forEach(histFill); return; }
    histIO = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) histFill(en.target); }), { rootMargin: '1500px 0px' });
    lz.forEach(el => histIO.observe(el));
  }
  function histFill(el) {
    const k = el && el.dataset.lazy; if (!k) return; if (histIO) histIO.unobserve(el);
    const l = (histDays && histDays.get(k)) || [];
    el.innerHTML = sheetHtml(histSort(l), { day: k }); el.removeAttribute('data-lazy'); el.removeAttribute('aria-busy'); el.classList.remove('hlazy'); el.style.height = '';
    fitCols(el.querySelector('table.grid'));
  }
  function histDay(k) { histNow(); const el = document.querySelector(`#histList .gwrap[data-lazy="${CSS.escape(k)}"]`); if (el) histFill(el); }
  function histNow() { if (S && histStale) { histStale = false; renderHistory(); } }
  function renderHistory() {
    renderStrip('hist');
    const days = R.byDay(S.encs.slice().sort((a, b) => R.startOf(b) - R.startOf(a)));
    const hl = $('#histList'), ae = document.activeElement;
    // editing a History cell: patch the day tables in place (focus and keyboard stay); full redraw when focus leaves
    if ((hl.contains(ae) && ae.closest('table.grid')) || (ned && ned.root === hl)) {
      histDays = days;
      for (const t of $$('#histList table.grid')) { const l = days.get(t.dataset.day); if (l) { patchGrid(t, sheetHtml(histSort(l), { day: t.dataset.day })); fitCols(t); } }
      histDirty = true; setActive(gCell); return;
    }
    if (!days.size) { hl.innerHTML = '<div class="empty">No history yet.</div>'; return; }
    const rv = S.settings.reviews || {}, re = S.settings.revEdited || {};
    const weeks = new Map(); for (const k of days.keys()) { const w = weekStart(k); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(k); }
    let h = '', eager = 0; histDays = days;
    for (const [w, ks] of weeks) {
      const all = ks.flatMap(k => days.get(k)), t = R.totals(all);
      const wkRev = ks.every(k => rv[k]), wkEnd = shiftDay(w, 6);
      h += `<div class="week"><div class="weekh"><span class="wl">Week of ${esc(R.fmtDay(w))}${wkRev ? ' <i class="rvb">✎ Reviewed</i>' : ''}</span><span>H ${t.H.m} min/${t.H.u} u · C ${t.C.m} min/${t.C.u} u${t.cb.n ? ` · CB ${t.cb.m} min` : ''}${t.site.n ? ` · on site ${R.hmin(t.site.m)}` : ''} <button type="button" class="linkbtn sm" data-rvw="${w}|${wkEnd}">Review week</button></span></div>`;
      for (const k of ks) {
        const l = days.get(k), hol = R.holidayName(k);
        h += `<div class="dayg" id="d-${k}"><div class="dayh"><span class="d">${esc(R.fmtDay(k))}</span>${hol ? `<i class="holb" title="${esc(hol)}">Holiday</i>` : ''}${rv[k] ? '<i class="rvb" title="Reviewed">✎ Reviewed</i>' : re[k] ? '<i class="rve" title="An entry changed after this day was reviewed">Edited after review</i>' : ''}<span class="sp"></span><button type="button" class="linkbtn sm" data-open-day="${k}">Open in Today</button><button type="button" class="linkbtn sm" data-tl="${k}">Timeline</button><button type="button" class="linkbtn sm" data-rv="${k}">Review</button><button type="button" class="linkbtn sm" data-rep="${k}" aria-label="Report or share ${esc(R.fmtDay(k))}">Report</button></div>`;
        // v9g: the most recent ~300 rows are drawn now; older days are drawn as they scroll near (fast with 100 patients a day)
        if (eager < HIST_EAGER) { eager += l.length; h += `<div class="gwrap">${sheetHtml(histSort(l), { day: k })}</div></div>`; }
        else h += `<div class="gwrap hlazy" data-lazy="${k}" data-n="${l.length}" aria-busy="true"></div></div>`;
      }
      h += '</div>';
    }
    hl.innerHTML = h; fitAll(hl); histLazy(hl);
    $$('#histList [data-rep]').forEach(b => b.addEventListener('click', () => openReport(b.dataset.rep, b.dataset.rep)));
    $$('#histList [data-rv]').forEach(b => b.addEventListener('click', () => openReview(b.dataset.rv, b.dataset.rv)));
    $$('#histList [data-rvw]').forEach(b => b.addEventListener('click', () => { const [f, t2] = b.dataset.rvw.split('|'); openReview(f, t2); }));
    $$('#histList [data-tl]').forEach(b => b.addEventListener('click', () => openTimeline(b.dataset.tl)));
    $$('#histList [data-open-day]').forEach(b => b.addEventListener('click', () => setDay(b.dataset.openDay)));
  }
  // live tick (display only; durations always computed from timestamps)
  setInterval(() => {
    $('#clock').textContent = R.hm(Date.now());  // America/Edmonton 24h, same source as In/Out cells
    if (!S) return;
    let live = false;
    for (const e of S.encs) { if (e.status !== 'run') continue; live = true; const ms = R.msOf(e), m = Math.floor(ms / 60000), id = CSS.escape(e.id);
      $$(`[data-rm="${id}"]`).forEach(el => { el.textContent = fmtDur(ms); el.title = m + ' min'; });
      if (kindOf(e) !== 'shift') $$(`[data-ru="${id}"]`).forEach(el => { const u = String(R.units(m)); if (el.textContent !== u) el.textContent = u; const n = e.status === 'run' ? nextUnit(m) : null, tt = n ? `+1 unit at ${n} min` : ''; if (el.title !== tt) el.title = tt; });
      if (kindOf(e) !== 'shift') { const wl = warnLvl(e); $$(`.gr[data-id="${id}"]`).forEach(el => { el.classList.toggle('wa', wl === 'a'); el.classList.toggle('wr', wl === 'r'); }); } }
    if (live) $$('table.grid').forEach(t => { const f = t.tFoot; if (!f) return; const g = gTotals(dayList(t.dataset.day, t.classList.contains('main'))), tm = f.querySelector('[data-tm]'), tu = f.querySelector('[data-tu]'), tdd = f.querySelector('[data-td]');
      if (tm && tm.textContent !== String(g.m)) tm.textContent = g.m; if (tu && tu.textContent !== String(g.u)) tu.textContent = g.u; if (tdd && tdd.textContent !== g.det) tdd.textContent = g.det; });
    renderPbar(); procTick();
    if (live && Date.now() - premTick > 5000) { premTick = Date.now(); renderPrem(); premCheck(); }
    if (S && activeShift()) renderOnsiteInfo();
    if (render.day !== today()) { const was = render.day; render.day = today(); if (was && viewDay === was) viewDay = null; if (tab === 'today' && !$('#todayList').contains(document.activeElement)) render(); }
  }, 1000);

  // ------------------------------------------------------------ tabs
  function showTab() { $$('#tabs button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); $$('main .panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; }); document.body.dataset.tab = tab; placeFoot();
    if (tab === 'history') histNow();
    if (S) requestAnimationFrame(() => { if (tab === 'today') { sizeGrid(); if (fillRows() !== fillRows.last) renderToday(); } fitAll($('#tab-' + tab) || document); }); }
  $$('#tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; showTab(); if (tab === 'history' && !$('#rFrom').value) { $('#rTo').value = today(); const d = new Date(); d.setDate(d.getDate() - 6); $('#rFrom').value = R.dayKey(d.getTime()); } }));
  $('#homeLink').addEventListener('click', ev => { ev.preventDefault(); tab = 'today'; showTab(); window.scrollTo(0, 0); });
  // ---- v9c toolbar: date navigator, More menu
  function setDay(k) {
    if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    if (k > today()) k = today();
    viewDay = k === today() ? null : k; tab = 'today'; showTab();
    const w = $('#todayList .gwrap'); if (w) { w.scrollTop = 0; w.scrollLeft = 0; }
    render(); window.scrollTo({ top: 0, behavior: 'auto' });
  }
  $('#dPrev').onclick = () => setDay(shiftDay(curDay(), -1));
  $('#dNext').onclick = () => setDay(shiftDay(curDay(), 1));
  $('#dToday').onclick = () => setDay(today());
  $('#dPick').addEventListener('change', () => setDay($('#dPick').value));
  $('#dPick').addEventListener('click', ev => { try { ev.target.showPicker(); } catch (e) { /* older browsers open their own picker */ } });
  const moreMenu = $('#moreMenu');
  function moreOpen(on) { moreMenu.hidden = !on; $('#moreBtn').setAttribute('aria-expanded', String(on)); if (on) { const f = moreMenu.querySelector('button:not([hidden])'); if (f) f.focus(); } }
  $('#moreBtn').onclick = ev => { ev.stopPropagation(); moreOpen(moreMenu.hidden); };
  moreMenu.addEventListener('click', ev => { if (ev.target.closest('button')) setTimeout(() => moreOpen(false), 0); });
  document.addEventListener('click', ev => { if (!moreMenu.hidden && !ev.target.closest('#moreMenu, #moreBtn')) moreOpen(false); });
  moreMenu.addEventListener('keydown', ev => {
    const items = [...moreMenu.querySelectorAll('button:not([hidden])')], i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); moreOpen(false); $('#moreBtn').focus(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
  });

  // ------------------------------------------------------------ fee codes (Fee Desk data, bundled)
  async function loadProvs() { try { PROVS = (await (await fetch('data/codes-index.json')).json()).list; } catch (e) { PROVS = [{ id: 'AB', name: 'Alberta' }]; } }
  const provLbl = p => p.held ? `${p.name} (approval pending)` : p.name;
  const HELD_MSG = p => `${p.name} (approval pending): code lookup unavailable, type the code manually.`;
  function fillProv(sel, v) { sel.innerHTML = PROVS.map(p => `<option value="${p.id}">${esc(provLbl(p))}</option>`).join(''); sel.value = PROVS.some(p => p.id === v) ? v : 'AB'; }
  function renderCredits() { $('#credits').innerHTML = PROVS.map(p => p.held ? `<p><b>${esc(p.name)}</b>: approval pending. No code data is included; ${esc(p.credit || '')}</p>` : `<p><b>${esc(p.name)}</b>: ${esc(p.title || '')}${p.eff ? ' (' + esc(p.eff) + ')' : ''}. ${esc(p.credit || '')}</p>`).join(''); }
  async function codesFor(id) {
    if (!PROVS.some(p => p.id === id)) id = 'AB';
    if (codeCache[id]) return codeCache[id];
    const pv = PROVS.find(p => p.id === id);
    if (pv && pv.held) return (codeCache[id] = { meta: { id, name: pv.name, held: true }, codes: [], index: null, byNorm: new Map(), held: true });   // v9f: no data shipped for held jurisdictions
    const d = await (await fetch(`data/codes-${id}.json`)).json();
    const docs = d.codes.map(c => ({ id: c[3], c: { c: c[0], d: c[1], f: c[2], k: c[3] }, fields: { desc: c[1], code: c[0] } }));
    const o = { meta: d.meta, codes: docs, index: new MBSearch.Index(docs, { desc: 3, code: 0.5 }, { phraseField: 'desc' }), byNorm: new Map() };
    for (const x of docs) { o.byNorm.set(norm(x.c.c), x.c); o.byNorm.set(norm(x.c.k), x.c); }
    return (codeCache[id] = o);
  }
  const norm = s => String(s || '').toUpperCase().replace(/[\s]+/g, '');
  // Fee Desk link for a fee code: deep link only when the code is in the bundled list, else Fee Desk's home page
  function fdCodeHref(code, prov) { const o = codeCache[PROVS.some(p => p.id === prov) ? prov : 'AB'], c = o && code && o.byNorm.get(norm(code)); return c ? FD + '#/code/' + encodeURIComponent(c.k) : FD; }
  async function loadIcd() {
    if (ICD) return ICD;
    try {
      const d = await (await fetch('data/icd9-AB.json')).json();
      const list = d.codes.map(c => ({ id: c[0], c: { c: c[0], d: c[1] }, fields: { desc: c[1], code: c[0] } }));
      ICD = { meta: d.meta, list, by: new Map(d.codes.map(c => [c[0], c[1]])), index: new MBSearch.Index(list, { desc: 3, code: 0.5 }, { phraseField: 'desc' }) };
    } catch (e) { ICD = { meta: {}, list: [], by: new Map(), index: null }; }
    return ICD;
  }
  const dxCode = v => { v = norm(v); return /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(v) ? v : ''; };   // stored value: a code only (free text allowed, words are search only)
  const dxDesc = v => (ICD && v && ICD.by.get(v)) || '';
  function fdDxHref(v) { v = dxCode(v); return v && ICD && ICD.by.has(v) ? FD + '#/medres/' + encodeURIComponent(v) : FD + '#/icd9'; }
  async function searchDx(q) {
    const o = await loadIcd(); q = q.trim(); if (!q) return [];
    const cq = norm(q), cd = cq.replace(/\./g, '');
    if (/\d/.test(cq) && /^[A-Z0-9.\-]{1,10}$/.test(cq)) {
      const pre = o.list.filter(d => d.c.c.startsWith(cq) || d.c.c.replace(/\./g, '').startsWith(cd));
      if (pre.length) return pre.sort((a, b) => (a.c.c === cq ? -1 : 0) - (b.c.c === cq ? -1 : 0) || a.c.c.length - b.c.c.length).slice(0, 8).map(d => d.c);
    }
    return o.index ? o.index.search(q, { limit: 8 }).hits.map(h => h.doc.c) : [];
  }
  async function searchCodes(q, prov) {
    const o = await codesFor(prov); q = q.trim(); if (!q || o.held) return [];
    const cq = norm(q);
    if (/\d/.test(cq) && /^[A-Z0-9.\-]{1,12}$/.test(cq) && !/^\d+(MIN|MINS|H)$/.test(cq)) {
      const pre = o.codes.filter(d => norm(d.c.c).startsWith(cq) || norm(d.c.k).startsWith(cq));
      if (pre.length) return pre.sort((a, b) => (norm(a.c.c) === cq ? -1 : 0) - (norm(b.c.c) === cq ? -1 : 0)).slice(0, 12).map(d => d.c);
    }
    return o.index.search(q, { limit: 12 }).hits.map(h => h.doc.c);
  }

  // ------------------------------------------------------------ edit dialog
  let cur = null, isNew = false, addedPhotos = [], removedPhotos = [];
  const dtLocal = ts => { if (ts == null) return ''; return `${R.dayKey(ts)}T${R.hm(ts)}`; };
  const parseLocal = v => v ? new Date(v).getTime() : null;
  function segRow(s) { return `<div class="segrow"><label>Start<input type="datetime-local" class="ss" value="${dtLocal(s.s)}"${s.s == null ? '' : ' required'}></label><label>End${s.e == null ? ' (running)' : ''}<input type="datetime-local" class="se" value="${dtLocal(s.e)}"></label><button type="button" class="x" aria-label="Remove segment">✕</button></div>`; }
  function bindSegs() { $$('#eSegs .x').forEach(b => b.onclick = () => { if ($$('#eSegs .segrow').length > 1) { b.closest('.segrow').remove(); sumSegs(); } }); $$('#eSegs input').forEach(i => i.oninput = sumSegs); }
  function readSegs() { return $$('#eSegs .segrow').map(r => { const s = parseLocal(r.querySelector('.ss').value), e = parseLocal(r.querySelector('.se').value); return { s, e }; }); }
  function sumSegs() {
    const segs = readSegs(), keep = cur ? cur.segs : [];
    // keep seconds precision for unchanged segments
    const merged = segs.map((s, i) => keep[i] && dtLocal(keep[i].s) === dtLocal(s.s) && (keep[i].e == null ? s.e == null : dtLocal(keep[i].e) === dtLocal(s.e)) ? keep[i] : s);
    if (merged.some(s => s.s == null)) { $('#eSum').textContent = ''; return; }
    const m = R.minsOf({ segs: merged }); $('#eSum').textContent = `Total ${m} min · ${R.units(m)} units`;
    const ps = cur && cur.kind !== 'shift' ? R.periodSplit({ id: 'edit', kind: cur.kind, segs: merged }).parts : [];
    $('#ePer').textContent = ps.length ? 'Time periods: ' + R.perTxt(ps) : ''; $('#ePer').hidden = !ps.length;
    return merged;
  }
  const fdA = (href, label, cls) => `<a class="${cls || 'fdl'}" href="${esc(href)}" target="_blank" rel="noopener noreferrer external" referrerpolicy="no-referrer" aria-label="${esc(label)}">Look up in Fee Desk</a>`;
  function renderChips() {
    const box = $('#eDxRes'); if ($('#eCodes').contains(box)) $('#eCodeRes').after(box);   // keep the suggestion box out of the list being redrawn
    $('#eCodes').innerHTML = cur.codes.map((c, i) => `<div class="cdpair" data-i="${i}">
      <div class="chip"><div class="cl1"><b>${esc(c.c)}</b><span class="cf">${esc(c.f || '')}</span></div><span class="cd" title="${esc(c.d)}">${esc(c.d || '')}</span>${fdA(fdCodeHref(c.k || c.c, c.j), `Look up ${c.c} in MedBilling Fee Desk (opens in a new tab)`)}<button type="button" class="x" data-i="${i}" aria-label="Remove code ${esc(c.c)}">✕</button></div>
      <div class="dxcell"><input class="dxin" data-i="${i}" type="search" maxlength="40" value="${esc(c.dx || '')}" placeholder="ICD-9 code or words" aria-label="Diagnostic code (ICD-9) for ${esc(c.c)}" autocomplete="off" autocapitalize="characters" enterkeyhint="done"><span class="dxd" title="${esc(c.dxd || '')}">${esc(c.dxd || '')}</span>${fdA(fdDxHref(c.dx), `Look up diagnostic code ${c.dx || ''} in MedBilling Fee Desk (opens in a new tab)`)}</div></div>`).join('');
    $$('#eCodes .x').forEach(b => b.onclick = () => { cur.codes.splice(+b.dataset.i, 1); $('#eDxRes').innerHTML = ''; renderChips(); });
    $$('#eCodes .dxin').forEach(inp => bindDx(inp));
  }
  // diagnostic code inputs (per fee code, and the one next to the code search): suggestions from the bundled ICD-9 list
  let dxSeq = 0;
  function dxTarget(inp) { return inp.id === 'eDxQ' ? null : cur.codes[+inp.dataset.i]; }
  function dxSync(inp) {
    const v = dxCode(inp.value), c = dxTarget(inp), cell = inp.closest('.dxcell, .cdcol'), a = cell && cell.querySelector('.fdl');
    if (a) { a.href = fdDxHref(inp.value); a.setAttribute('aria-label', `Look up diagnostic code ${v} in MedBilling Fee Desk (opens in a new tab)`); }
    if (c) { if (v) { c.dx = v; c.dxd = dxDesc(v); } else { delete c.dx; delete c.dxd; } const d = cell.querySelector('.dxd'); if (d) { d.textContent = c.dxd || ''; d.title = c.dxd || ''; } }
  }
  async function runDx(inp) {
    const q = inp.value, seq = ++dxSeq, box = $('#eDxRes');
    const anchor = inp.id === 'eDxQ' ? $('#eCodeRes') : inp.closest('.cdpair'); if (box.previousElementSibling !== anchor) anchor.after(box);
    if (!q.trim()) { box.innerHTML = ''; return; }
    const hits = await searchDx(q); if (seq !== dxSeq || !cur) return;
    const typed = dxCode(q);
    let h = hits.map((c, i) => `<button type="button" class="chit" data-i="${i}"><span class="cc">${esc(c.c)}</span><span class="cd">${esc(c.d)}</span><span class="cf"></span></button>`).join('');
    if (typed && !hits.some(c => c.c === typed)) h += `<button type="button" class="chit" data-typed="1"><span class="cc">${esc(typed)}</span><span class="cd">Use as typed (not in the Alberta ICD-9 list)</span><span class="cf"></span></button>`;
    if (!h) h = '<p class="small muted">No matching ICD-9 codes. Type the code, or use Look up in Fee Desk.</p>';
    box.innerHTML = `<p class="dxh small muted">ICD-9 suggestions (Alberta Health list, via Fee Desk)</p>` + h;
    box.querySelectorAll('.chit').forEach(b => b.onclick = () => {
      const v = b.dataset.typed ? typed : hits[+b.dataset.i].c; inp.value = v; dxSync(inp); box.innerHTML = '';
      if (inp.id !== 'eDxQ') renderChips(); toast(`Diagnostic code ${v}`);
    });
  }
  function bindDx(inp) {
    inp.addEventListener('input', () => { dxSync(inp); clearTimeout(runDx.t); runDx.t = setTimeout(() => runDx(inp), 160); });
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); runDx(inp); } });
    inp.addEventListener('focus', () => { loadIcd(); });
    inp.addEventListener('blur', () => { const v = dxCode(inp.value); if (inp.value && v !== inp.value && v) { inp.value = v; dxSync(inp); } });
  }
  bindDx($('#eDxQ'));
  function syncCodeLink() { const a = $('#eCodeFD'), q = $('#eCodeQ').value.trim(), href = fdCodeHref(q, $('#eProv').value); a.href = href; a.setAttribute('aria-label', href === FD ? 'Open MedBilling Fee Desk (opens in a new tab)' : `Look up ${q.toUpperCase()} in MedBilling Fee Desk (opens in a new tab)`); }
  async function showCredit() { const p = PROVS.find(x => x.id === $('#eProv').value) || PROVS[0]; $('#eCredit').textContent = p && p.held ? HELD_MSG(p) + ' Confirm codes in the official schedule.' : p ? `${p.name} codes: ${p.title}${p.eff ? ' (' + p.eff + ')' : ''}. ${p.credit} Data from MedBilling Fee Desk; confirm in the official schedule.` : ''; }
  let searchSeq = 0;
  async function runCodeSearch() {
    const q = $('#eCodeQ').value, seq = ++searchSeq, prov = $('#eProv').value;
    if (!q.trim()) { $('#eCodeRes').innerHTML = ''; syncCodeLink(); return; }
    const hits = await searchCodes(q, prov); if (seq !== searchSeq) return;
    syncCodeLink();
    let h = hits.map((c, i) => `<button type="button" class="chit" data-i="${i}"><span class="cc">${esc(c.c)}</span><span class="cd">${esc(c.d)}</span><span class="cf">${esc(c.f)}</span></button>`).join('');
    const typed = q.trim().toUpperCase(), pv = PROVS.find(p => p.id === prov);
    if (/^[A-Z0-9.\-]{2,12}$/.test(typed) && !hits.some(c => c.c.toUpperCase() === typed)) h += `<button type="button" class="chit" data-typed="1"><span class="cc">${esc(typed)}</span><span class="cd">${pv && pv.held ? 'Add as typed' : `Add as typed (not found in the ${esc(prov)} list)`}</span><span class="cf"></span></button>`;
    if (pv && pv.held) h = `<p class="small muted heldmsg">${esc(HELD_MSG(pv))}</p>` + h;
    if (!h) h = '<p class="small muted">No matching codes. Try other words or a code.</p>';
    $('#eCodeRes').innerHTML = h;
    $$('#eCodeRes .chit').forEach(b => b.onclick = () => {
      const c = b.dataset.typed ? { j: prov, c: typed, d: '', f: '' } : (x => ({ j: prov, c: x.c, d: x.d, f: x.f }))(hits[+b.dataset.i]);
      const pdx = dxCode($('#eDxQ').value); if (pdx) { c.dx = pdx; c.dxd = dxDesc(pdx); }   // diagnostic code typed next to the search goes with the new code
      if (!cur.codes.some(x => x.c === c.c && x.j === c.j)) { cur.codes.push(c); if (pdx) { $('#eDxQ').value = ''; dxSync($('#eDxQ')); } }
      renderChips(); $('#eCodeQ').value = ''; $('#eCodeRes').innerHTML = ''; $('#eDxRes').innerHTML = ''; syncCodeLink(); toast(`Added ${c.c}`);
    });
  }
  $('#eCodeQ').addEventListener('input', () => { clearTimeout(runCodeSearch.t); runCodeSearch.t = setTimeout(runCodeSearch, 180); });
  $('#eCodeQ').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); runCodeSearch(); } });
  $('#eProv').addEventListener('change', async () => { showCredit(); runCodeSearch(); codesFor($('#eProv').value).then(syncCodeLink); if (S && S.settings.prov !== $('#eProv').value) { S.settings.prov = $('#eProv').value; $('#defProv').value = S.settings.prov; saveSettings(); } });
  // photos
  async function thumbs() {
    const box = $('#ePhotos'); box.innerHTML = '';
    for (const id of cur.photos) {
      const b = await V.loadPhoto(id); if (!b || !cur) continue;
      const u = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); blobUrls.push(u);
      const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.pid = id; btn.setAttribute('aria-label', 'View photo');
      btn.innerHTML = `<img src="${u}" alt="">`; btn.onclick = () => viewPhoto(id, u); box.appendChild(btn);
    }
  }
  let viewing = null;
  function viewPhoto(id, u) { viewing = id; $('#pvImg').src = u; $('#photoDlg').showModal(); }
  $('#pvClose').onclick = () => { $('#photoDlg').close(); $('#pvImg').removeAttribute('src'); };
  $('#pvDel').onclick = () => { if (!cur || !viewing) return; cur.photos = cur.photos.filter(p => p !== viewing); if (addedPhotos.includes(viewing)) { V.removePhoto(viewing); addedPhotos = addedPhotos.filter(p => p !== viewing); } else removedPhotos.push(viewing); $('#photoDlg').close(); thumbs(); };
  async function toJpeg(file) {
    const u = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Not an image')); im.src = u; });
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.8)); cv.width = cv.height = 0;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    } finally { URL.revokeObjectURL(u); }
  }
  async function addFiles(files) {
    pickEnd();
    if (!cur || !files || !files.length) return;
    for (const f of files) {
      try { const j = await toJpeg(f); const id = uid(); await V.savePhoto(id, cur.id, j.bytes, { w: j.w, h: j.h, t: Date.now() }); cur.photos.push(id); addedPhotos.push(id); }
      catch (e) { toast('Could not add photo: ' + e.message); }
    }
    thumbs();
  }
  ['#eCamIn', '#eFileIn'].forEach(s => { const i = $(s); i.addEventListener('change', () => { const f = Array.from(i.files || []); i.value = ''; addFiles(f); }); i.addEventListener('cancel', pickEnd); });
  $('#eCam').onclick = () => { pickStart(); $('#eCamIn').click(); };
  $('#eAttach').onclick = () => { pickStart(); $('#eFileIn').click(); };

  let eFac = null, overlapOk = false;
  const KLBL = { enc: ['Started', 'Start', 'End'], cb: ['Arrived', 'Arrival', 'Departure'], shift: ['Arrived', 'Arrival', 'Departure'] };
  function setKind(k) {
    cur.kind = k; $('#editDlg').dataset.kind = k;
    $$('#eKind button').forEach(b => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('#eQLbl').textContent = KLBL[k][0];
    $$('#eSegs .segrow').forEach(r => { const l = r.querySelectorAll('label'); l[0].firstChild.textContent = KLBL[k][1]; l[1].firstChild.textContent = KLBL[k][2]; });
    $('#editTitle').textContent = (isNew ? (cur.late ? 'Add past ' : 'New ') : 'Edit ') + ({ enc: 'encounter', cb: 'call-back', shift: 'arrival / departure' })[k];
    if (k === 'cb') renderLinks();
  }
  $$('#eKind button').forEach(b => b.onclick = () => { if (isNew) setKind(b.dataset.k); });
  function showFac(el, f) { el.textContent = f ? f.n + (f.z ? ` (${f.z} Zone)` : '') : 'None'; }
  $('#eFac').onclick = async () => { const f = await pickFacility(); if (f === undefined) return; eFac = f; showFac($('#eFacName'), eFac); if (f && f.set) { $('#eSetting').value = f.set; $('#eSetting2').value = f.set; } };
  function renderLinks() {
    const segs = sumSegs() || cur.segs, day = segs[0] && segs[0].s ? R.dayKey(segs[0].s) : today();
    const list = S.encs.filter(e => kindOf(e) === 'enc' && R.encDay(e) === day).sort((a, b) => R.startOf(a) - R.startOf(b));
    $('#eLinks').innerHTML = list.length ? list.map(e => `<label><input type="checkbox" value="${esc(e.id)}" ${(cur.links || []).includes(e.id) ? 'checked' : ''}> ${esc(e.label)} · ${R.hm(R.startOf(e))}${e.initials ? ' · ' + esc(e.initials) : ''}</label>`).join('') : '<p class="small muted">No encounters on this day yet.</p>';
  }
  // quick back-dating buttons
  $$('#editDlg .quick button').forEach(b => b.onclick = () => {   // v5: also Last stop, ±5 nudges and +15/+30
    const rows = $$('#eSegs .segrow'); if (!rows.length) return;
    if (b.dataset.end) { const r = rows[rows.length - 1]; r.querySelector('.se').value = dtLocal(Date.now()); sumSegs(); return; }
    if (b.dataset.nudge || b.dataset.dur) return nudge(b, rows);
    let t = Date.now() - (+b.dataset.ago || 0) * 60000;
    if (b.dataset.last) { const ls = lastStop(); if (!ls) return toast('No earlier stop today'); t = ls; } rows[0].querySelector('.ss').value = dtLocal(t);
    const se = rows[0].querySelector('.se'); if (se.value && parseLocal(se.value) <= t) se.value = '';
    sumSegs(); if (cur.kind === 'cb') { syncCalled(); renderLinks(); }
  });
  let calledTouched = false;
  $('#eCalled').addEventListener('input', () => { calledTouched = true; });
  function syncCalled() { if (calledTouched || !cur || cur.kind !== 'cb') return; const r = $('#eSegs .segrow .ss'); const st = r && parseLocal(r.value), c = parseLocal($('#eCalled').value); if (st && (!c || c > st)) $('#eCalled').value = dtLocal(st); }
  $('#eSegs').addEventListener('input', () => syncCalled());
  function lateText(e) { return e.late ? `Entered later${e.edits && e.edits.length ? ' · last edited ' + R.tsTxt(e.edits[e.edits.length - 1]) : ''}${e.created ? ' · created ' + R.tsTxt(e.created) : ''}` : ''; }
  function openEdit(e, fresh, opt) {
    opt = opt || {};
    isNew = !!fresh; calledTouched = !fresh; cur = clone(e); cur.kind = kindOf(cur); cur.codes = cur.codes || []; cur.photos = cur.photos || []; cur.links = cur.links || []; cur.notes = clone(R.notesOf(cur)); delete cur.note; addedPhotos = []; removedPhotos = []; overlapOk = false;
    $('#eKind').hidden = !fresh;
    $('#eName').value = cur.name || ''; $('#eLabel').value = cur.label || ''; $('#eInit').value = cur.initials || ''; $('#eChart').value = ptMrn(cur); $('#eBillNote').value = cur.billingNote || ''; $('#eMod1').value = modOf(cur, 1); $('#eMod2').value = modOf(cur, 2); eMU = Object.assign({}, cur.modU || {}); eMuShow();
    eFno = facNoOf(cur) ? { no: facNoOf(cur), n: R.facNmTxt(cur), mine: !AHF_BY.has(facNoOf(cur)) } : null; eFcen = fcenOf(cur); eFpShow(); if (!AHF && eFno) loadAhf().then(() => { if (cur && eFno) { eFno.mine = !AHF_BY.has(eFno.no); eFpShow(); } });   // v9o
    $('#eSetting').value = cur.setting || 'H'; $('#eSetting2').value = cur.setting || 'H'; $('#eType').value = cur.type || '';
    $('#eCbType').value = cur.cbType || 'return'; $('#eCalled').value = dtLocal(cur.called);
    eFac = cur.facility || null; showFac($('#eFacName'), eFac);
    $('#eMinor').checked = !!cur.minor; $('#eObs').checked = !!cur.obstetric; $('#eAge').value = Number.isFinite(cur.minorAge) ? cur.minorAge : ''; showRet();
    fillProv($('#eProv'), S.settings.prov); showCredit(); $('#eCodeQ').value = ''; $('#eCodeRes').innerHTML = ''; $('#eDxRes').innerHTML = ''; $('#eDxQ').value = cur.dx || '';
    renderChips(); dxSync($('#eDxQ')); syncCodeLink();
    const jl = [...new Set([$('#eProv').value].concat(cur.codes.map(c => c.j || 'AB')))].map(j => codesFor(j).catch(() => null));
    Promise.all(jl.concat(cur.codes.some(c => c.dx) || cur.dx ? [loadIcd()] : [])).then(() => { if (cur) { renderChips(); dxSync($('#eDxQ')); syncCodeLink(); } }).catch(() => {});
    $('#eSegs').innerHTML = (cur.segs.length ? cur.segs : [{ s: null, e: null }]).map(segRow).join(''); bindSegs(); sumSegs(); $('#eErr').textContent = ''; $('#eWarn').hidden = true; $('#eSave').textContent = 'Save';
    const lt = lateText(cur); $('#eLate').hidden = !lt; $('#eLate').textContent = lt;
    $('#eDelete').hidden = !!fresh; $('#eHist').hidden = !!fresh; $('#ePhotos').innerHTML = ''; thumbs();
    $('#eRepRow').hidden = !!fresh || cur.kind === 'shift'; syncFavBtn();
    setKind(cur.kind);
    noteEdit = null; $('#eNoteNew').hidden = true; $('#eNoteText').value = ''; renderNotes();
    $('#eAddTime').hidden = true; $('#eaTime').setAttribute('aria-expanded', 'false'); $('#eaTime').classList.remove('on'); $('#eAddInfo').textContent = '';
    setMode(fresh || opt.edit ? 'edit' : 'view');
    if (!$('#editDlg').open) $('#editDlg').showModal();
    if (opt.panel === 'time') toggleAddTime(true);
    if (opt.panel === 'note') openNoteNew();
    if (!opt.panel) { const d = $('#editDlg'); d.scrollTop = 0; $('#editForm').scrollTop = 0; }
  }
  // ---- v7 entry details: view mode (summary + action row) and edit mode (the full form)
  let noteEdit = null;
  function setMode(m) {
    const d = $('#editDlg'); d.dataset.mode = m;
    const view = m === 'view';
    $('#eView').hidden = !view; $('#eEditBox').hidden = view;
    $('#eSave').hidden = view; $('#eCancel').textContent = view ? 'Close' : 'Cancel';
    const box = $('#eNotesBox');
    if (view) $('#eView').after(box); else $('#eNotesSlot').appendChild(box);
    const k = cur ? cur.kind : 'enc';
    $('#editTitle').textContent = isNew ? (k === 'cb' ? 'New call-back' : k === 'shift' ? 'Arrival / departure' : 'New encounter') : (view ? (k === 'shift' ? 'On site' : k === 'cb' ? 'Call-back' : 'Encounter') + ' details' : 'Edit ' + (k === 'shift' ? 'arrival / departure' : k === 'cb' ? 'call-back' : 'encounter'));
    if (view) renderSummary();
  }
  function stored() { return cur && S.encs.find(x => x.id === cur.id); }
  function renderSummary() {
    const e = stored() || cur; if (!e) return; const k = kindOf(e), m = Math.floor(R.msOf(e) / 60000), st = e.status;
    const segs = (e.segs || []).map(x => `${R.hm(x.s)}–${x.e == null ? (k === 'shift' ? 'on site' : 'running') : R.hm(x.e)}`).join(', ');
    const pp = k === 'shift' ? [] : R.periodSplit(e).parts;
    const rows = [];
    rows.push(['When', `${R.fmtDay(R.encDay(e))}<br>${esc(segs)}${(e.segs || []).length > 1 ? ` <span class="muted">(${e.segs.length} segments)</span>` : ''}`]);
    rows.push(['Time', k === 'shift' ? esc(R.hmin(m)) + ' on site' : `<b>${m} min · ${R.units(m)} unit${R.units(m) === 1 ? '' : 's'}</b>${st === 'run' ? ' <span class="badge st run">Running</span>' : st === 'pause' ? ' <span class="badge st pause">Paused</span>' : ''}${pp.length ? `<br><span class="muted">${esc(R.perTxt(pp))}</span>` : ''}`]);
    if (k === 'enc') rows.push(['Patient', [ptName(e) && `<b>${esc(ptName(e))}</b>`, e.label && esc(e.label), e.initials && esc(e.initials), ptMrn(e) && 'MRN ' + esc(ptMrn(e))].filter(Boolean).join(' · ') || '<span class="muted">–</span>']);
    if (k === 'cb') rows.push(['Call-back', esc([R.CBT[e.cbType] || 'Call-back', e.called && 'called ' + R.hm(e.called)].filter(Boolean).join(' · '))]);
    rows.push(['Setting', esc([R.SET[e.setting], k === 'enc' && e.type, e.facility && e.facility.n].filter(Boolean).join(' · ')) || '<span class="muted">–</span>']);
    if (k !== 'shift') {
      const cs = e.codes || [];
      rows.push(['Codes', cs.length ? cs.map(c => `<span class="sc"><b>${esc(c.c)}</b>${c.dx ? ` <span class="dxc">Dx ${esc(c.dx)}</span>` : ''}${c.d ? ` <span class="muted">${esc(c.d.length > 60 ? c.d.slice(0, 60) + '…' : c.d)}</span>` : ''}</span>`).join('') + (e.dx ? `<span class="sc"><span class="dxc">Dx ${esc(e.dx)}</span></span>` : '') + dxxHtml(e) : (e.dx || R.dxExtra(e).length ? (e.dx ? `<span class="dxc">Dx ${esc(e.dx)}</span>` : '') + dxxHtml(e) : '<span class="muted">None yet. Tap Edit to add fee and diagnostic codes.</span>')]);
      if (facNoOf(e) || fcenOf(e)) rows.push(['Facility # · Functional centre', [facNoOf(e) && `<span class="sc"><b>${esc(facNoOf(e))}</b>${R.facNmTxt(e) ? ` <span class="muted">${esc(R.facNmTxt(e))}</span>` : ''}</span>`, fcenOf(e) && `<span class="sc"><b>${esc(fcenOf(e))}</b>${R.fcenName(fcenOf(e)) ? ` <span class="muted">${esc(R.fcenName(fcenOf(e)))}</span>` : ''}</span>`].filter(Boolean).join('')]);   // v9o
      if (modOf(e, 1) || modOf(e, 2)) rows.push(['Modifiers', [1, 2].filter(n => modOf(e, n)).map(n => `<span class="sc"><span class="muted">${n}:</span> <b>${esc(modOf(e, n))}</b></span>`).join('')]);
      if (k === 'cb' && (e.links || []).length) rows.push(['Linked', (e.links || []).map(id => S.encs.find(x => x.id === id)).filter(Boolean).map(x => `<button type="button" class="linkbtn sm" data-open="${esc(x.id)}">${esc(x.label || 'Encounter')} ${R.hm(R.startOf(x))}</button>`).join(' ')]);
      const fl = [e.minor && ('Minor' + (Number.isFinite(e.minorAge) ? ` (age ${e.minorAge})` : '')), e.obstetric && 'Obstetric'].filter(Boolean);
      rows.push(['Retention', esc((fl.length ? fl.join(' · ') + ' · ' : '') + 'keep until ' + new Date(R.retainUntil(e)).toLocaleDateString())]);
    }
    const same = R.samePt(e, S.encs);
    if (same.length) rows.push(['Same patient', same.map(x => `<button type="button" class="linkbtn sm splink" data-open="${esc(x.id)}">↔ ${esc(x.label || R.KIND[kindOf(x)])} · ${R.encDay(x) === R.encDay(e) ? '' : esc(R.encDay(x)) + ' '}${R.hm(R.startOf(x))}${(x.codes || []).length ? ' · ' + esc(x.codes.map(c => c.c).join(', ')) : ''}</button>`).join('')]);
    if ((e.photos || []).length) rows.push(['Photos', `📷 ${e.photos.length} (tap Edit to view)`]);
    if (e.late) rows.push(['Status', esc(lateText(e))]);
    $('#eSummary').innerHTML = rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
    $$('#eSummary [data-open]').forEach(b => b.onclick = () => { const x = S.encs.find(y => y.id === b.dataset.open); if (x) openEdit(x); });
    $('#eaSame').hidden = k === 'shift';
    $('#eAddLbl').textContent = st === 'run' ? 'Add time (running: the start moves earlier)' : 'Add time to the end of this entry';
  }
  function toggleAddTime(on) {
    const p = $('#eAddTime'); on = on == null ? p.hidden : on; p.hidden = !on; $('#eaTime').setAttribute('aria-expanded', String(on)); $('#eaTime').classList.toggle('on', on);
    if (on) p.scrollIntoView({ block: 'nearest' });
  }
  $('#eaTime').onclick = () => toggleAddTime();
  $('#eaEdit').onclick = () => { if (cur) { setMode('edit'); $('#editForm').scrollTop = 0; $('#editDlg').scrollTop = 0; } };
  $('#eaSame').onclick = async () => { const e = stored(); if (!e) return; await closeEdit(false); await samePatient(e); };
  $$('#eAddTime [data-add]').forEach(b => b.onclick = async () => {
    const e = stored(); if (!e) return; const r = await addTime(e, +b.dataset.add); if (!r) return;
    openEdit(r.x); toggleAddTime(true);
    $('#eAddInfo').innerHTML = `${esc(r.msg)} <button type="button" class="linkbtn sm" id="eAddUndo">Undo</button>`;
    $('#eAddUndo').onclick = async () => { await r.undo(); const y = S && S.encs.find(z => z.id === r.x.id); if (y) { openEdit(y); toggleAddTime(true); $('#eAddInfo').textContent = 'Undone.'; } };
  });
  $('#eaSeg').onclick = () => { if (!cur) return; setMode('edit'); $('#eAddSeg').click(); const rows = $$('#eSegs .segrow'); const last = rows[rows.length - 1]; if (last) { last.scrollIntoView({ block: 'center' }); last.querySelector('.ss').focus(); } };
  // quick add: running = start earlier; finished/paused = later end (capped at now, the rest goes before the start)
  async function addTime(e, min) {
    if (!(e.segs || []).length) { toast('Start the timer first (type In, or ⋯ → Start timer now)'); return null; }
    const now = Date.now(), prev = clone(e), x = clone(e), sg = x.segs, ms = min * 60000, last = sg[sg.length - 1];
    let how;
    if (last.e == null) { sg[0].s -= ms; how = `start ${R.hm(prev.segs[0].s)} → ${R.hm(sg[0].s)}`; }
    else {
      const room = Math.max(0, Math.min(ms, now - last.e)), rest = ms - room;
      const pe = last.e; last.e += room; if (rest > 0) sg[0].s -= rest;
      how = [room > 0 && `end ${R.hm(pe)} → ${R.hm(last.e)}`, rest > 0 && `start ${R.hm(prev.segs[0].s)} → ${R.hm(sg[0].s)}`].filter(Boolean).join(', ');
    }
    x.late = true; x.edits = (x.edits || []).concat(now);
    await saveEnc(x, 'addtime', `Added ${min} min (${how})`); render();
    const ov = S.encs.filter(y => y.id !== x.id && kindOf(y) === kindOf(x) && ovl(x.segs, y.segs)).length;
    const undo = () => undoTo(prev, x, 'Add time undone');
    snack(`Added ${min} min to ${x.label || R.KIND[kindOf(x)]}`, undo);
    return { x, undo, msg: `Added ${min} min: ${how}.${ov ? ` Overlaps ${ov} other ${kindOf(x) === 'cb' ? 'call-back' : 'encounter'}${ov > 1 ? 's' : ''} (allowed).` : ''}` };
  }
  // same patient, new encounter: room/label, initials and chart carried over; codes left blank; both entries linked
  async function samePatient(e) {
    if (!S || kindOf(e) === 'shift') return;
    const now = Date.now(), prev = clone(e), src = clone(e), group = e.pt || e.id;
    const stop = src.status !== 'done', linkNew = !src.pt;
    if (stop) { const l = src.segs[src.segs.length - 1]; if (l && l.e == null) l.e = now; src.status = 'done'; }
    src.pt = group;
    if (stop || linkNew) await saveEnc(src, stop ? 'stop' : 'link', stop ? 'Stopped to start a new encounter for the same patient' : 'Linked: same patient, new encounter');
    const ne = { id: uid(), kind: 'enc', name: e.name || '', mrn: ptMrn(e), chart: ptMrn(e), billingNote: '', label: e.label && kindOf(e) === 'enc' ? e.label : (e.label && e.label !== 'Call-back' ? e.label : ''), initials: e.initials || '', setting: e.setting || 'H', facility: e.facility || null, type: '', codes: [], notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], links: [], pt: group, ptFrom: e.id, created: now, updated: now };
    if (e.minor) { ne.minor = true; if (Number.isFinite(e.minorAge)) ne.minorAge = e.minorAge; }
    if (e.obstetric) ne.obstetric = true;
    if (facNoOf(e)) { ne.facNo = facNoOf(e); if (R.facNmTxt(e)) ne.facNm = R.facNmTxt(e); } if (fcenOf(e)) ne.fcen = fcenOf(e); carryFac(ne, R.encDay(ne));   // v9o: same place as the prior encounter
    await saveEnc(ne, 'create', `Same patient as prior encounter ${R.hm(R.startOf(e))} (linked). Name, MRN, label and initials carried over; codes left blank.`);
    tab = 'today'; showTab(); render();
    snack(`Started same patient`, async () => {
      const a = S.encs.find(x => x.id === src.id), b = S.encs.find(x => x.id === ne.id);
      if (!a || ((stop || linkNew) && a.updated !== src.updated) || (b && b.updated !== ne.updated)) return toast('Not undone: an entry changed');
      if (b) await deleteEnc(b, 'Same-patient encounter undone'); if (stop || linkNew) await saveEnc(clone(prev), 'undo', 'Same-patient encounter undone'); render(); toast('Undone');
    });
  }
  // ---- notes: several timestamped notes per entry, each up to 1000 characters, encrypted with the entry
  function renderNotes() {
    if (!cur) return; const ns = cur.notes || [];
    $('#eNoteCount').textContent = ns.length ? `(${ns.length})` : '';
    $('#eNotes').innerHTML = ns.length ? ns.slice().reverse().map(n => noteEdit === n.id
      ? `<div class="note editing" data-n="${esc(n.id)}"><textarea class="ned" maxlength="1000" rows="3" aria-label="Edit note">${esc(n.x)}</textarea><div class="notebtns"><span class="small muted nlen">${n.x.length} / 1000</span><button type="button" class="ghost sm" data-nc>Cancel</button><button type="button" class="primary sm" data-ns>Save</button></div></div>`
      : `<div class="note" data-n="${esc(n.id)}"><div class="nmeta"><span>${esc(R.noteStamp(n))}</span><span class="nacts"><button type="button" class="linkbtn sm" data-ne aria-label="Edit note">Edit</button><button type="button" class="linkbtn sm dl" data-nd aria-label="Delete note">Delete</button></span></div><div class="ntext">${esc(n.x)}</div></div>`).join('')
      : `<p class="small muted nonotes">No notes yet.${isNew ? '' : ' Notes save right away and are encrypted on this device.'}</p>`;
    $$('#eNotes [data-ne]').forEach(b => b.onclick = () => { noteEdit = b.closest('.note').dataset.n; renderNotes(); const t = $('#eNotes .ned'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } });
    $$('#eNotes [data-nc]').forEach(b => b.onclick = () => { noteEdit = null; renderNotes(); });
    $$('#eNotes .ned').forEach(t => t.oninput = () => { t.closest('.note').querySelector('.nlen').textContent = `${t.value.length} / 1000`; });
    $$('#eNotes [data-ns]').forEach(b => b.onclick = async () => { const id = b.closest('.note').dataset.n, v = b.closest('.note').querySelector('.ned').value.trim(); if (!v) return toast('A note cannot be empty. Use Delete instead.'); const n = cur.notes.find(x => x.id === id); if (!n || n.x === v) { noteEdit = null; return renderNotes(); } await noteOp('note-edit', l => l.map(x => x.id === id ? Object.assign({}, x, { x: v.slice(0, 1000), u: Date.now() }) : x), `Note from ${R.noteStamp(n)} edited`); noteEdit = null; renderNotes(); toast('Note updated'); });
    $$('#eNotes [data-nd]').forEach(b => b.onclick = async () => { const id = b.closest('.note').dataset.n, n = cur.notes.find(x => x.id === id); if (!n) return; const ok = await ask({ title: 'Delete note', text: `Delete the note from ${R.noteStamp(n)}? A copy stays in the encrypted audit log.`, ok: 'Delete', danger: true }); if (!ok || !cur) return; await noteOp('note-delete', l => l.filter(x => x.id !== id), `Note from ${R.noteStamp(n)} deleted`); renderNotes(); toast('Note deleted'); });
  }
  async function noteOp(action, fn, label) {
    cur.notes = fn(clone(cur.notes || []));
    if (isNew) return;                 // a new entry saves its notes with the form
    const st = stored(); if (!st) return;
    const x = clone(st); x.notes = clone(cur.notes); delete x.note;
    await saveEnc(x, action, label, true); render();
    if ($('#editDlg').dataset.mode === 'view') renderSummary();
  }
  function openNoteNew() { $('#eNoteNew').hidden = false; $('#eNoteAdd').hidden = true; const t = $('#eNoteText'); $('#eNoteLen').textContent = `${t.value.length} / 1000`; t.scrollIntoView({ block: 'center' }); t.focus(); }
  function closeNoteNew() { $('#eNoteNew').hidden = true; $('#eNoteAdd').hidden = false; $('#eNoteText').value = ''; }
  $('#eNoteAdd').onclick = openNoteNew;
  $('#eNoteCancel').onclick = closeNoteNew;
  $('#eNoteText').addEventListener('input', () => { $('#eNoteLen').textContent = `${$('#eNoteText').value.length} / 1000`; });
  $('#eNoteSave').onclick = async () => {
    if (!cur) return; const v = $('#eNoteText').value.trim(); if (!v) return toast('Type a note first');
    const n = { id: uid(), t: Date.now(), x: v.slice(0, 1000) };
    await noteOp('note-add', l => l.concat(n), `Note added (${v.length} characters)`); closeNoteNew(); renderNotes(); toast(isNew ? 'Note added. It saves with the entry.' : 'Note saved');
  };
  // ---- row actions (⋯ in the last column, right-click a row, or press and hold its row number)
  let rmEnt = null;
  function openRowMenu(e) {
    rmEnt = e; const k = kindOf(e), st = e.status, started = (e.segs || []).length > 0;
    $('#rmTitle').textContent = k === 'shift' ? (e.facility ? e.facility.n : 'On site') : displayWho(e);
    $('#rmSub').textContent = [R.fmtDay(R.encDay(e)), started ? R.hm(R.startOf(e)) + (R.endOf(e) ? '–' + R.hm(R.endOf(e)) : ' (running)') : 'not started', ptMrn(e), (e.codes || []).map(c => c.c).join(', ')].filter(Boolean).join(' · ');
    const ed = k !== 'shift', show = { start: !started && ed, pause: st === 'run' && ed, resume: started && ed && (st === 'pause' || st === 'done'), stop: st === 'run' || st === 'pause', time: started, same: ed, fee: ed, dx: ed, full: st === 'run' && ed };
    $$('#rowMenu [data-rmi]').forEach(b => { if (b.dataset.rmi in show) b.hidden = !show[b.dataset.rmi]; });
    $('#rmResumeL').textContent = st === 'done' ? 'Continue timing (new segment)' : 'Resume';
    const d = $('#rowMenu'); if (!d.open) d.showModal();
  }
  $('#rmClose').onclick = () => $('#rowMenu').close();
  $('#rowMenu').addEventListener('click', ev => { if (ev.target === $('#rowMenu')) $('#rowMenu').close(); });
  $$('#rowMenu [data-rmi]').forEach(b => b.onclick = async () => {
    const e = rmEnt && S && S.encs.find(x => x.id === rmEnt.id); $('#rowMenu').close(); if (!e) return;
    const a = b.dataset.rmi;
    if (a === 'start') return gridSave(e.id, 'tin', 'now');
    if (a === 'pause' || a === 'resume' || a === 'stop') return act(e, a);
    if (a === 'same') return samePatient(e);
    if (a === 'fee' || a === 'dx') return pickInFeeDesk(e, a);
    if (a === 'full') return openProc(e);
    if (a === 'del') return delEntry(e);
    openEdit(e, false, a === 'segs' ? { edit: true } : a === 'time' ? { panel: 'time' } : a === 'note' ? { panel: 'note' } : {});
  });
  async function delEntry(e) {
    const ok = await ask({ title: 'Delete row', text: `Delete "${displayWho(e) || 'this entry'}"${(e.photos || []).length ? ' and its photos' : ''}? It disappears from your logs and reports, but a full copy stays in the encrypted audit log.`, ok: 'Delete', danger: true });
    const cur0 = ok && S && S.encs.find(x => x.id === e.id); if (!cur0) return;
    const gone = clone(cur0), ph = await deleteEnc(cur0, 'Deleted from the spreadsheet row menu', true); render();
    const tm = setTimeout(() => { photoDel.delete(tm); ph.forEach(p => V.removePhoto(p)); }, 6000); photoDel.set(tm, ph);
    snack(`Deleted ${R.KIND[kindOf(gone)]} (kept in audit log)`, async () => { clearTimeout(tm); photoDel.delete(tm); if (S.encs.some(x => x.id === gone.id)) return; await saveEnc(gone, 'restore', 'Delete undone'); render(); toast('Restored'); });
  }
  async function closeEdit(saved) {
    if (!saved) for (const p of addedPhotos) await V.removePhoto(p);
    cur = null; addedPhotos = []; removedPhotos = []; noteEdit = null; closeNoteNew(); $('#editDlg').close();
  }
  function showRet() {
    $('.minorage').hidden = !$('#eMinor').checked;
    if (!cur) return; const age = parseInt($('#eAge').value, 10);
    const t = R.retainUntil(Object.assign({}, cur, { minor: $('#eMinor').checked, obstetric: $('#eObs').checked, minorAge: Number.isFinite(age) ? age : undefined }));
    $('#eRet').textContent = `Keep until at least ${new Date(t).toLocaleDateString()}. Nothing is deleted without your confirmation.`;
  }
  ['#eMinor', '#eObs', '#eAge'].forEach(s2 => $(s2).addEventListener('input', showRet));
  $('#eCancel').onclick = async () => {
    if (cur && !isNew && $('#editDlg').dataset.mode === 'edit' && stored()) { for (const p of addedPhotos) await V.removePhoto(p); addedPhotos = []; removedPhotos = []; return openEdit(stored()); }
    closeEdit(false);
  };
  $('#editDlg').addEventListener('cancel', ev => { ev.preventDefault(); closeEdit(false); });
  $('#eAddSeg').onclick = () => { const segs = readSegs(), last = segs[segs.length - 1]; const s = last && last.e ? last.e + 60000 : Date.now(); $('#eSegs').insertAdjacentHTML('beforeend', segRow({ s, e: s + 15 * 60000 })); bindSegs(); sumSegs(); setKind(cur.kind); };
  const ovl = (a, b) => a.some(x => b.some(y => x.s < (y.e == null ? Date.now() : y.e) && y.s < (x.e == null ? Date.now() : x.e)));
  $('#eSegs').addEventListener('input', () => { overlapOk = false; $('#eWarn').hidden = true; $('#eSave').textContent = 'Save'; });
  $('#editForm').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!cur) return;
    const err = $('#eErr'), k = cur.kind, rawSegs = readSegs(); err.textContent = '';
    // v9c: an encounter made in the spreadsheet may not be started yet (no In time); it can stay that way
    const notStarted = k === 'enc' && rawSegs.length === 1 && rawSegs[0].s == null && rawSegs[0].e == null && !(cur.segs || []).length;
    const segs = notStarted ? [] : sumSegs();
    if (!segs || (!segs.length && !notStarted)) return err.textContent = 'Each time segment needs a start time.';
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.e == null && i !== segs.length - 1) return err.textContent = 'Only the last segment can be open (still running).';
      if (s.e != null && s.e <= s.s) return err.textContent = `End must be after start (segment ${i + 1}).`;
      if (i && segs[i - 1].e != null && s.s < segs[i - 1].e) return err.textContent = 'Segments of this entry overlap each other. Check the times.';
      if (s.s > Date.now() + 60000 || (s.e != null && s.e > Date.now() + 60000)) return err.textContent = 'Times cannot be in the future.';
    }
    const called = k === 'cb' ? parseLocal($('#eCalled').value) : null;
    if (k === 'cb' && called && called > segs[0].s) return err.textContent = 'The time called must be before the arrival time.';
    if (!overlapOk) {
      const others = S.encs.filter(x => x.id !== cur.id && kindOf(x) === (k === 'shift' ? 'shift' : k) && ovl(segs, x.segs));
      if (others.length) {
        $('#eWarn').hidden = false; $('#eWarn').textContent = `Overlaps with ${others.length} other ${k === 'shift' ? 'on-site period' : k === 'cb' ? 'call-back' : 'encounter'}${others.length > 1 ? 's' : ''}: ${others.slice(0, 3).map(x => (x.label || (x.facility && x.facility.n) || '') + ' ' + R.hm(R.startOf(x))).join(', ')}. Concurrent entries are allowed; tap "Save anyway" if this is correct.`;
        overlapOk = true; $('#eSave').textContent = 'Save anyway'; return;
      }
    }
    const prev = S.encs.find(x => x.id === cur.id);
    const st = o => JSON.stringify((o.segs || []).map(x => [Math.floor(x.s / 60000), x.e == null ? null : Math.floor(x.e / 60000)]));
    const timesChanged = prev ? st(prev) !== st({ segs }) : true;
    cur.segs = segs; cur.facility = eFac; cur.notes = clone((stored() && !isNew ? R.notesOf(stored()) : cur.notes) || []); delete cur.note;
    if (k !== 'shift') { cur.minor = $('#eMinor').checked; cur.obstetric = $('#eObs').checked; const ag = parseInt($('#eAge').value, 10); cur.minorAge = cur.minor && Number.isFinite(ag) && ag >= 0 && ag < 18 ? ag : undefined; }
    if (k === 'enc') { cur.name = ($('#eName') && $('#eName').value || '').trim(); cur.label = $('#eLabel').value.trim(); cur.initials = $('#eInit').value.trim().toUpperCase(); setMrn(cur, $('#eChart').value); cur.billingNote = ($('#eBillNote') && $('#eBillNote').value || '').trim(); cur.setting = $('#eSetting').value; cur.type = $('#eType').value.trim(); if (!cur.name && !cur.label) cur.label = 'Encounter'; }
    else { cur.setting = $('#eSetting2').value; }
    if (k === 'cb') { cur.cbType = $('#eCbType').value; cur.called = called; cur.links = $$('#eLinks input:checked').map(i => i.value); cur.label = cur.label || 'Call-back'; }
    if (k !== 'shift') for (const n of [1, 2]) { const v = R.normMods($('#eMod' + n).value).slice(0, MOD_MAX); if (v) cur['mod' + n] = v; else delete cur['mod' + n]; }   // v9k
    if (k !== 'shift') { const m = {}; for (const c of [1, 2].flatMap(n => R.muCodes(cur, n))) if (eMU[c]) m[c] = eMU[c]; if (Object.keys(m).length) cur.modU = m; else delete cur.modU; } else delete cur.modU;   // v9o units
    if (k !== 'shift') { if (eFno && eFno.no) { cur.facNo = eFno.no; if (eFno.n) cur.facNm = eFno.n; else delete cur.facNm; } else { delete cur.facNo; delete cur.facNm; } if (eFcen) cur.fcen = eFcen; else delete cur.fcen; }   // v9o
    if (k === 'shift') { cur.codes = []; cur.photos.forEach(p => removedPhotos.push(p)); cur.photos = []; cur.label = ''; delete cur.dx; delete cur.dxx; delete cur.mod1; delete cur.mod2; delete cur.facNo; delete cur.facNm; delete cur.fcen; }
    else applyPendingDx(cur);
    const open = segs.length > 0 && segs[segs.length - 1].e == null;
    cur.status = !segs.length ? 'new' : open ? 'run' : (cur.status === 'run' ? 'pause' : (isNew || cur.status === 'new' ? 'done' : cur.status));
    if (k !== 'enc' && !open && segs.length) cur.status = 'done';
    if (segs.length) delete cur.at;
    // honest audit trail: back-dated or edited times are marked "entered later"
    if (isNew) { cur.created = Date.now(); if (segs.length && segs[0].s < Date.now() - 2 * 60000) cur.late = true; }
    else if (timesChanged) cur.late = true;
    if (!isNew) cur.edits = (cur.edits || []).concat(Date.now());
    for (const p of removedPhotos) await V.removePhoto(p);
    await saveEnc(cur, isNew ? 'create' : 'edit', isNew && cur.late ? 'Entered later (back-dated)' : (timesChanged && !isNew ? 'Times edited' : undefined));
    const lbl = k === 'shift' ? 'arrival / departure' : 'entry'; await closeEdit(true); render(); toast(`Saved ${lbl}`);
  });
  // a diagnostic code left in the field next to the code search: goes to the first fee code without one, else to the entry
  function applyPendingDx(c) {
    const v = dxCode($('#eDxQ').value), free = v && c.codes.find(x => !x.dx);
    if (free) { free.dx = v; free.dxd = dxDesc(v); delete c.dx; } else if (v) c.dx = v; else delete c.dx;
  }
  // encrypted draft of an open entry, so a lock (e.g. after opening Fee Desk in a new tab) does not lose it
  function editSnapshot() {
    const c = clone(cur), segs = readSegs(), k = c.kind;
    if (segs.length && segs.every(x => x.s != null)) c.segs = sumSegs() || segs;
    c.facility = eFac; c.notes = clone(cur.notes || []); if ($('#eNoteText').value.trim()) c.noteDraft = $('#eNoteText').value;
    if (k === 'enc') { c.name = $('#eName') ? $('#eName').value : ''; c.label = $('#eLabel').value; c.initials = $('#eInit').value; c.mrn = $('#eChart').value; c.chart = $('#eChart').value; c.billingNote = $('#eBillNote') ? $('#eBillNote').value : ''; c.setting = $('#eSetting').value; c.type = $('#eType').value; } else c.setting = $('#eSetting2').value;
    if (k !== 'shift') { c.minor = $('#eMinor').checked; c.obstetric = $('#eObs').checked; const ag = parseInt($('#eAge').value, 10); c.minorAge = Number.isFinite(ag) ? ag : undefined; c.dx = $('#eDxQ').value; c.mod1 = $('#eMod1').value; c.mod2 = $('#eMod2').value; if (Object.keys(eMU).length) c.modU = Object.assign({}, eMU); else delete c.modU; if (eFno) { c.facNo = eFno.no; c.facNm = eFno.n || ''; } else { delete c.facNo; delete c.facNm; } if (eFcen) c.fcen = eFcen; else delete c.fcen; }
    if (k === 'cb') { c.cbType = $('#eCbType').value; c.called = parseLocal($('#eCalled').value); c.links = $$('#eLinks input:checked').map(i => i.value); }
    return { cur: c, isNew, addedPhotos, removedPhotos, at: Date.now(), mode: $('#editDlg').dataset.mode };
  }
  function restoreDraft(d) {
    const c = d.cur, dx = c.dx, nd = c.noteDraft; delete c.dx; delete c.noteDraft;
    const orig = S.encs.find(x => x.id === c.id);
    if (!d.isNew && !orig) return;   // entry no longer exists
    if (!d.isNew) c.notes = clone(R.notesOf(orig));   // notes were saved as they were made
    openEdit(c, d.isNew, { edit: d.mode !== 'view' });
    if (nd) { $('#eNoteText').value = nd; openNoteNew(); }
    if (dx) { $('#eDxQ').value = dx; dxSync($('#eDxQ')); }
    addedPhotos = d.addedPhotos || []; removedPhotos = d.removedPhotos || [];
  }
  $('#eDelete').onclick = async () => {
    if (!cur) return; const v = await ask({ title: 'Delete entry', text: `Delete "${cur.label || 'this entry'}"${cur.photos.length ? ' and its photos' : ''}? It disappears from your logs and reports, but a full copy stays in the encrypted audit log.`, ok: 'Delete', danger: true }); if (!v || !cur) return;
    for (const p of addedPhotos) await V.removePhoto(p);
    const gone = clone(S.encs.find(x => x.id === cur.id) || cur), ph = await deleteEnc(cur, '', true); addedPhotos = []; await closeEdit(true); render();
    const tm = setTimeout(() => { photoDel.delete(tm); ph.forEach(p => V.removePhoto(p)); }, 6000); photoDel.set(tm, ph);
    snack(`Deleted ${R.KIND[kindOf(gone)]} (kept in audit log)`, async () => { clearTimeout(tm); photoDel.delete(tm); if (S.encs.some(x => x.id === gone.id)) return; await saveEnc(gone, 'restore', 'Delete undone'); render(); toast('Restored'); });
  };
  const blank = (k, s, e) => ({ id: uid(), kind: k, name: '', mrn: '', billingNote: '', label: '', initials: '', chart: '', setting: k === 'enc' ? S.settings.defSetting : 'H', facility: (activeShift() || {}).facility || S.settings.curFac || null, type: '', codes: [], notes: [], segs: [{ s, e }], status: e == null ? 'run' : 'done', photos: [], links: [], created: Date.now() });
  $('#manualBtn').onclick = () => { const d = curDay(), s = d === today() ? Date.now() - 30 * 60000 : edmAt(d, 12, 0); const e = blank('enc', s, s + 30 * 60000); e.late = true; carryFac(e, d); openEdit(e, true); };
  $('#cbBtn').onclick = () => { const now = Date.now(); const e = blank('cb', now, null); e.called = now; e.cbType = 'return'; e.setting = 'H'; carryFac(e, today()); openEdit(e, true); };
  // entry history (from the audit log)
  async function showHistory(eid, title) {
    const recs = (await V.loadAudit()).filter(r => r.eid === eid);
    $('#histTitle').textContent = title || 'History';
    $('#histBody').innerHTML = recs.length ? recs.map(r => { const d = R.diff(r.before, r.after); return `<div class="hrec ${r.action}"><b>${esc(R.tsTxt(r.ts))} · ${esc(R.ACT[r.action] || r.action)}</b>${r.action === 'create' || r.action === 'import' ? `<div>${esc(R.summ(r.after))}</div>` : ''}${r.action === 'delete' ? `<div>Deleted: ${esc(R.summ(r.before))}</div>` : ''}${d.length ? '<ul>' + d.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}<div class="muted tiny">#${r.seq} · hash ${esc(r.hash.slice(0, 12))}…</div></div>`; }).join('') : '<p class="small muted">No history recorded.</p>';
    $('#histDlg').showModal();
  }
  $('#eHist').onclick = () => cur && showHistory(cur.id, 'History: ' + (cur.label || 'entry'));
  $('#histClose').onclick = () => $('#histDlg').close();

  // ------------------------------------------------------------ on site (arrival / departure)
  const activeShift = () => S && S.encs.find(e => kindOf(e) === 'shift' && e.status === 'run');
  const hShort = m => `${Math.floor(m / 60)}h ${R.pad(m % 60)}m`;
  function renderOnsiteInfo() {
    const sh = activeShift(), day = curDay(), t = R.totals(S.encs.filter(e => R.encDay(e) === day && kindOf(e) === 'shift'));
    const el = $('#osInfo');
    el.innerHTML = sh ? `On site since <b>${R.hm(R.startOf(sh))}</b>${sh.late ? '*' : ''} · ${hShort(t.site.m)}` : t.site.n ? `On site <b>${hShort(t.site.m)}</b>` : '';
    el.title = sh ? `Arrived ${R.hm(R.startOf(sh))}${sh.late ? ' (entered later)' : ''}. Time on site ${day === today() ? 'today' : R.fmtDay(day)}: ${R.hmin(t.site.m)}${t.site.n > 1 ? ` (${t.site.n} periods)` : ''}` : t.site.n ? `Time on site: ${R.hmin(t.site.m)} (${t.site.n} period${t.site.n > 1 ? 's' : ''})` : '';
  }
  function renderOnsite() {
    const sh = activeShift(), f = sh ? sh.facility : S.settings.curFac;
    $('#osFacName').textContent = f ? f.n : 'Choose…'; $('#osFac').title = f ? `Facility: ${f.n}${f.z ? ` (${f.z} Zone)` : ''}` : 'Choose a facility';
    const b = $('#osBtn'); b.textContent = sh ? 'Depart' : 'Arrive'; b.classList.toggle('dep', !!sh); $('#osEdit').hidden = !sh;
    renderOnsiteInfo();
  }
  $('#osEdit').onclick = () => { const sh = activeShift(); if (sh) openEdit(sh); };
  $('#osFac').onclick = async () => {
    const f = await pickFacility(); if (f === undefined) return;
    const sh = activeShift();
    if (sh) { const e = clone(sh); e.facility = f; e.edits = (e.edits || []).concat(Date.now()); await saveEnc(e, 'edit', 'Facility changed'); }
    S.settings.curFac = f; if (f && f.set) { quickSet = f.set; setQuick(); } await saveSettings(); render();
  };
  $('#osBtn').onclick = async () => {
    const sh = activeShift(), now = Date.now();
    if (sh) { const e = clone(sh); e.segs[e.segs.length - 1].e = now; e.status = 'done'; await saveEnc(e, 'depart'); render(); return toast(`Departed ${e.facility ? e.facility.n : ''}`); }
    let f = S.settings.curFac; if (!f) { f = await pickFacility(); if (f === undefined) return; S.settings.curFac = f; await saveSettings(); }
    const e = { id: uid(), kind: 'shift', label: '', facility: f, setting: (f && f.set) || 'H', segs: [{ s: now, e: null }], status: 'run', notes: [], codes: [], photos: [], created: now };
    await saveEnc(e, 'arrive'); render(); toast(`Arrived${f ? ' at ' + f.n : ''}`);
  };

  // ------------------------------------------------------------ facility picker (AHS hospitals by zone)
  async function loadFac() { if (FAC) return FAC; try { FAC = await (await fetch('data/facilities.json')).json(); } catch (e) { FAC = { zones: [], sources: [] }; } return FAC; }
  let facRes = null;
  async function pickFacility() {
    await loadFac();
    $('#facQ').value = ''; $('#facOther').value = ''; renderFac();
    $('#facSrc').textContent = 'Source: ' + FAC.sources.map(x => `${x.t} (${x.u}, ${x.d})`).join('; ') + '. ' + (FAC.note || '');
    $('#facDlg').showModal();
    return new Promise(res => { facRes = res; });
  }
  function facDone(v) { $('#facDlg').close(); const r = facRes; facRes = null; if (r) r(v); }
  $('#facClose').onclick = () => facDone(undefined);
  $('#facDlg').addEventListener('cancel', ev => { ev.preventDefault(); facDone(undefined); });
  $('#facNone').onclick = () => facDone(null);
  $('#facOtherOk').onclick = async () => {
    const n = $('#facOther').value.trim(); if (!n) return $('#facOther').focus();
    const f = { n, z: '', set: $('#facOtherSet').value, custom: true };
    S.settings.customFac = [f].concat((S.settings.customFac || []).filter(x => x.n !== n)).slice(0, 12); await saveSettings(); facDone(f);
  };
  $('#facQ').addEventListener('input', renderFac);
  function renderFac() {
    const q = MBSearch.fold($('#facQ').value.trim()), fav = new Set(S.settings.favFac || []);
    const m = (n, t) => !q || MBSearch.fold(n + ' ' + (t || '')).includes(q);
    const all = []; FAC.zones.forEach(z => z.h.forEach(h => all.push({ n: h[0], t: h[1], z: z.z, set: 'H' })));
    (S.settings.customFac || []).forEach(c => all.push({ n: c.n, t: c.set === 'C' ? 'Clinic' : 'Hospital', z: '', set: c.set, custom: true }));
    const row = f => `<div class="frow"><button type="button" class="pick" data-n="${esc(f.n)}">${esc(f.n)} <small>${esc(f.t || '')}</small></button><button type="button" class="fav${fav.has(f.n) ? ' on' : ''}" data-fav="${esc(f.n)}" aria-label="${fav.has(f.n) ? 'Remove from' : 'Add to'} favourites">${fav.has(f.n) ? '★' : '☆'}</button></div>`;
    let h = '';
    const favs = all.filter(f => fav.has(f.n) && m(f.n, f.t)); if (favs.length) h += `<h4>Favourites</h4>` + favs.map(row).join('');
    const cus = all.filter(f => f.custom && m(f.n, f.t)); if (cus.length) h += `<h4>Other / clinic (your names)</h4>` + cus.map(row).join('');
    for (const z of FAC.zones) { const l = all.filter(f => f.z === z.z && m(f.n, f.t)); if (l.length) h += `<h4>${esc(z.z)} Zone${z.complete ? '' : ' <span>(partial list)</span>'}</h4>` + l.map(row).join(''); }
    $('#facList').innerHTML = h || '<p class="small muted padd">No match. Use "Other / clinic" below.</p>';
    $$('#facList .pick').forEach(b => b.onclick = () => { const f = all.find(x => x.n === b.dataset.n); facDone({ n: f.n, z: f.z, set: f.set, custom: !!f.custom }); });
    $$('#facList .fav').forEach(b => b.onclick = async () => { const n = b.dataset.fav, s2 = new Set(S.settings.favFac || []); s2.has(n) ? s2.delete(n) : s2.add(n); S.settings.favFac = [...s2]; await saveSettings(); renderFac(); });
  }

  // ------------------------------------------------------------ audit log UI
  $('#auditCheck').onclick = async () => {
    const r = await V.verifyAudit();
    $('#auditStatus').innerHTML = r.ok ? `<span class="ok">✓ Log intact</span>: ${r.count} record${r.count === 1 ? '' : 's'}${r.base ? ` (continuing from retention checkpoint #${r.base})` : ''}, hash chain verified. Last hash ${esc((r.last || '-').slice(0, 16))}…` : `<span class="err">✗ Problems found:</span> ${esc(r.problems.join('; '))}`;
  };
  $('#auditDeleted').onclick = async () => {
    const recs = await V.loadAudit(), live = new Set(S.encs.map(e => e.id));
    const del = recs.filter(r => r.action === 'delete' && !live.has(r.eid));
    $('#deletedList').innerHTML = del.length ? del.reverse().map(r => `<div class="drow"><span>${esc(R.tsTxt(r.ts))}: ${esc(R.summ(r.before))}</span><button type="button" class="linkbtn" data-h="${esc(r.eid)}">History</button></div>`).join('') : '<p class="small muted">No deleted entries.</p>';
    $$('#deletedList [data-h]').forEach(b => b.onclick = () => showHistory(b.dataset.h, 'History of a deleted entry'));
  };
  $('#auditExport').onclick = () => { const t = today(), d = new Date(); d.setDate(d.getDate() - 30); openReport(R.dayKey(d.getTime()), t, 'audit'); };

  // ------------------------------------------------------------ retention (10 years minimum, longer for minors/obstetric; never automatic) + backup reminders
  const pastRet = e => R.retainUntil(e) < Date.now();
  function renderRetention() {
    if (!S) return; const st = S.settings;
    $('#lastBk').textContent = st.lastBackup ? new Date(st.lastBackup).toLocaleString() : 'never';
    $('#respAt').textContent = st.respAccepted ? `· Disclaimer and responsibility statement accepted ${new Date(st.respAccepted).toLocaleDateString()}` : '';
    $('#bkEvery').value = String(st.bkEvery == null ? 30 : st.bkEvery);
    const old = S.encs.filter(pastRet).length;
    $('#retInfo').textContent = old ? `${old} entr${old === 1 ? 'y is' : 'ies are'} past the retention period and eligible for removal (only if you confirm).` : 'No records are past the retention period.';
  }
  $('#bkEvery').onchange = async () => { S.settings.bkEvery = +$('#bkEvery').value; await saveSettings(); checkBackupDue(); };
  function checkBackupDue() {
    if (!S) return; const st = S.settings, days = st.bkEvery == null ? 30 : st.bkEvery, now = Date.now();
    const base = st.lastBackup || st.created || now, due = days > 0 && now - base > days * 86400000 && now > (st.bkSnooze || 0) && S.encs.length > 0;
    $('#bkRemind').hidden = !due || !!(st.abOn && !$('#abRemind').hidden);
    if (due) $('#bkText').textContent = st.lastBackup ? `Your last encrypted backup was ${Math.floor((now - st.lastBackup) / 86400000)} days ago. Your data lives only on this device; make a backup and keep it somewhere safe.` : 'You have not made an encrypted backup yet. Your data lives only on this device; make a backup and keep it somewhere safe.';
  }
  $('#bkNow').onclick = () => abNow();
  $('#bkLater').onclick = async () => { S.settings.bkSnooze = Date.now() + 3 * 86400000; await saveSettings(); checkBackupDue(); };
  $('#retReview').onclick = async () => {
    const old = S.encs.filter(pastRet), live = new Map(S.encs.map(e => [e.id, e]));
    // an audit record is eligible when the entry it belongs to is past retention (deleted entries: judged from their last snapshot)
    const snap = new Map(); for (const r of await V.loadAudit()) if (r.eid) snap.set(r.eid, r.after || r.before);
    const eligible = r => { if (!r.eid) return R.addY(r.ts, 10) < Date.now(); const e = live.get(r.eid) || snap.get(r.eid); return e ? pastRet(e) : R.addY(r.ts, 10) < Date.now(); };
    const recs = (await V.loadAudit()).filter(eligible);
    if (!old.length && !recs.length) return ask({ title: 'Retention', text: 'No records are past the retention period. Nothing to remove. ' + R.RET_RULE, ok: 'OK' });
    const v = await ask({ title: 'Remove records past retention', text: `${old.length} entr${old.length === 1 ? 'y' : 'ies'} and up to ${recs.length} audit record(s) are past the retention period. ${R.RET_RULE} Check whether a longer legal or College requirement applies to you, and make an encrypted backup first. Removal cannot be undone. Type REMOVE to confirm.`, ok: 'Remove', danger: true, fields: [{ id: 'c', label: 'Type REMOVE', type: 'text' }],
      check: v => v.c.trim().toUpperCase() === 'REMOVE' ? '' : 'Type REMOVE to confirm.' });
    if (!v) return;
    for (const e of old) { for (const p of e.photos || []) await V.removePhoto(p); await V.remove(e.id); }
    S.encs = S.encs.filter(e => !old.includes(e));
    if (old.length) await V.appendAudit({ action: 'purge', note: `Removed ${old.length} entries past their retention period after user confirmation.`, after: { ids: old.map(e => e.id) } });
    const n = await V.pruneAudit(r => r.action !== 'purge' && r.action !== 'prune-log' && eligible(r), 'retention');
    render(); renderRetention(); toast(`Removed ${old.length} entries and ${n} old audit records`, 3500);
  };

  // ------------------------------------------------------------ generic ask dialog
  function ask(o) {
    return new Promise(res => {
      const d = $('#askDlg'); $('#askTitle').textContent = o.title; $('#askText').textContent = o.text || ''; $('#askErr').textContent = '';
      $('#askFields').innerHTML = (o.fields || []).map(f => f.type === 'select' ? `<label class="fld">${esc(f.label)}<select id="ask_${f.id}">${f.options.map(([v, l]) => `<option value="${esc(v)}"${v === f.value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
        : `<label class="fld">${esc(f.label)}<input id="ask_${f.id}" type="${f.type || 'password'}" ${f.type === 'password' || !f.type ? 'autocomplete="off" autocapitalize="off" spellcheck="false"' : ''} maxlength="128"></label>`).join('');
      const ok = $('#askOk'); ok.textContent = o.ok || 'OK'; ok.className = o.danger ? 'dangerbtn' : 'primary';
      const done = v => { d.close(); $('#askForm').onsubmit = null; $('#askCancel').onclick = null; d.oncancel = null; res(v); };
      $('#askForm').onsubmit = async ev => {
        ev.preventDefault(); const v = {}; (o.fields || []).forEach(f => { v[f.id] = $('#ask_' + f.id).value; });
        if (o.check) { ok.disabled = true; let m; try { m = await o.check(v); } catch (e) { m = 'Something went wrong: ' + e.message; } ok.disabled = false; if (m) { $('#askErr').textContent = m; return; } }
        done(v);
      };
      $('#askCancel').onclick = () => done(null); d.oncancel = ev => { ev.preventDefault(); done(null); };
      d.showModal(); const first = d.querySelector('#askFields input'); if (first) first.focus();
    });
  }

  // ------------------------------------------------------------ reports + share
  let fmt = 'pdf', repFile = null, repMode = 'log';
  function openReport(from, to, mode) {
    repMode = mode || 'log';
    $('#pTitle').textContent = repMode === 'audit' ? 'Export audit log' : 'Report';
    $('#repForm .fmt [data-fmt=docx]').hidden = $('#repForm .fmt [data-fmt=xlsx]').hidden = repMode === 'audit'; $('#pPhotosL').hidden = repMode === 'audit';
    if (repMode === 'audit' && (fmt === 'docx' || fmt === 'xlsx')) fmt = 'pdf';
    $('#pFrom').value = from; $('#pTo').value = to; $('#pReady').hidden = true; repFile = null; $('#pErr').textContent = ''; $('#pNotes').checked = false; $('#pNotesL').lastChild.textContent = repMode === 'audit' ? ' (off: note text is left out of the log export)' : ' (off by default for privacy)'; setFmt(fmt);
    $('#repDlg').showModal();
  }
  function setFmt(f) { fmt = f; $$('#repForm .fmt button').forEach(b => { const on = b.dataset.fmt === f; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); $('#pPhotos').disabled = f === 'csv' || f === 'xlsx'; repInfo(); $('#pReady').hidden = true; repFile = null; }
  async function repInfo() {
    if (!S) return; const f = $('#pFrom').value || '0', t = $('#pTo').value || '9';
    if (repMode === 'audit') { const n = (await V.loadAudit()).filter(r => { const k = R.dayKey(r.ts); return k >= f && k <= t; }).length; $('#pInfo').textContent = `${n} audit record${n === 1 ? '' : 's'} in this period. The export includes the integrity check result and each record's hashes.`; return; }
    const l = R.select(S.encs, f, t), np = l.reduce((a, e) => a + (e.photos || []).length, 0), nn = l.reduce((a, e) => a + R.notesOf(e).length, 0), n = k => l.filter(e => kindOf(e) === k).length;
    $('#pInfo').textContent = `${n('enc')} encounter${n('enc') === 1 ? '' : 's'}, ${n('cb')} call-back${n('cb') === 1 ? '' : 's'}, ${n('shift')} on-site period${n('shift') === 1 ? '' : 's'}${np ? `, ${np} photo${np === 1 ? '' : 's'}` : ''} in this period.` + (fmt === 'csv' || fmt === 'xlsx' ? ` ${fmt === 'csv' ? 'CSV' : 'Excel'} has no photos.` : '') + (nn ? ` ${nn} note${nn === 1 ? '' : 's'}: ${$('#pNotes').checked ? 'included' : 'not included'}.` : '');
  }
  $$('#repForm .fmt button').forEach(b => b.onclick = () => setFmt(b.dataset.fmt));
  ['#pFrom', '#pTo', '#pPhotos', '#pNotes'].forEach(s => $(s).addEventListener('change', () => { repInfo(); $('#pReady').hidden = true; repFile = null; }));
  $('#pClose').onclick = () => { $('#repDlg').close(); repFile = null; };
  $('#repToday').onclick = () => openReport(curDay(), curDay());
  $('#repToday2').onclick = () => openReport(curDay(), curDay());
  $('#repRange').onclick = () => { const f = $('#rFrom').value, t = $('#rTo').value; if (!f || !t) return toast('Choose both dates'); openReport(f <= t ? f : t, f <= t ? t : f); };
  const credits = list => { const ids = new Set(); list.forEach(e => (e.codes || []).forEach(c => ids.add(c.j || 'AB'))); return PROVS.filter(p => ids.has(p.id)).map(p => p.held ? `Fee codes (${p.name}): typed by the user; code lookup unavailable (approval pending).` : `Fee codes (${p.name}): ${p.title}${p.eff ? ', ' + p.eff : ''}. ${p.credit} Code data via MedBilling Fee Desk.`); };
  // v9d: every export is an AES-256 password-protected .zip (zip.js, WinZip AE-2, encryptionStrength 3). The export password is
  // typed by the user, checked by PwPolicy (12+ chars, 3 of 4 classes or a 16+ passphrase, no common/sequential/repeated
  // patterns, no patient names or MRN/PHN) and must differ from the app passcode. It is never stored: at most it stays in
  // memory for the session when "Remember" is ticked, and lockNow() clears it. File names carry no patient identifiers.
  let xpPw = null, xpAckSess = false, xpJob = null;
  const EXT = { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', csv: 'csv' };
  const xpName = kind => `MedBillingLogs_${kind === 'audit' ? 'audit-log_' : ''}${today()}.zip`;
  function xpPersonal() { const out = []; for (const e of (S && S.encs) || []) { const n = R.ptName(e), m = R.ptMrn(e); if (n) out.push(n); if (m) out.push(m); if (e.initials && e.initials.length >= 4) out.push(e.initials); } return out; }
  function xpMeter() {
    const v = $('#xp1').value, r = PwPolicy.check(v, { personal: xpPersonal() }), bar = $('#xpBar');
    const same = v && sessPass && v === sessPass;
    bar.style.width = (v ? [0, 22, 45, 75, 100][r.level] : 0) + '%'; bar.className = r.level >= 4 ? 'vs' : r.level === 3 ? 'g' : r.level === 2 ? 'f' : 'w';
    $('#xpStr').textContent = v ? `Strength: ${same ? 'Not allowed' : r.label}` : 'At least 12 characters. A few unrelated words with a number or symbol work well.';
    const why = (same ? ['Use a different password from your app passcode.'] : []).concat(v ? r.reasons : []);
    $('#xpWhy').innerHTML = why.map(t => `<li>${esc(t)}</li>`).join('');
    return r;
  }
  $('#xp1').addEventListener('input', () => { xpMeter(); $('#xpErr').textContent = ''; });
  $('#xp2').addEventListener('input', () => { $('#xpErr').textContent = ''; });
  $$('.pwshow').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.for), on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', on); });
  function xpReset() { ['#xp1', '#xp2'].forEach(s => { $(s).value = ''; $(s).type = 'password'; }); $$('.pwshow').forEach(b => { b.textContent = 'Show'; b.setAttribute('aria-pressed', 'false'); }); $('#xpKeep').checked = false; $('#xpErr').textContent = ''; }
  function xpOpen(job) {
    xpJob = job; xpReset(); $('#xpAck').checked = xpAckSess;
    const rem = !!xpPw; $('#xpRemembered').hidden = !rem; $('#xpFields').hidden = rem; xpMeter();
    $('#xpDlg').showModal(); setTimeout(() => (xpAckSess ? (rem ? $('#xpOk') : $('#xp1')) : $('#xpAck')).focus(), 50);
  }
  $('#xpNew').onclick = () => { xpPw = null; $('#xpRemembered').hidden = true; $('#xpFields').hidden = false; xpMeter(); $('#xp1').focus(); };
  $('#xpCancel').onclick = () => { xpReset(); $('#xpDlg').close(); xpJob = null; };
  $('#xpDlg').addEventListener('close', () => { $('#xp1').value = $('#xp2').value = ''; });
  $('#xpForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const err = $('#xpErr'); err.textContent = '';
    if (!S || !xpJob) return $('#xpDlg').close();
    if (!$('#xpAck').checked) return err.textContent = 'Please read the privacy notice and tick the box to continue.';
    let pw = xpPw;
    if (!pw) {
      pw = $('#xp1').value; const r = xpMeter();
      if (!r.ok) return err.textContent = 'This password can\u2019t be used: ' + r.reasons[0];
      if (pw !== $('#xp2').value) return err.textContent = 'The two passwords don\u2019t match.';
    } else { const r = PwPolicy.check(pw, { personal: xpPersonal() }); if (!r.ok) { xpPw = null; $('#xpNew').click(); return err.textContent = 'Please choose a new password: ' + r.reasons[0]; } }
    const ok = $('#xpOk'); ok.disabled = true; ok.textContent = 'Checking…';
    // must differ from the app passcode: compare with the in-memory session copy, and verify against the vault check record (in memory only)
    let same = !!(sessPass && pw === sessPass); if (!same) { try { same = !!(await V.verify(pw)); } catch (e) { same = false; } }
    if (same) { ok.disabled = false; ok.textContent = 'Encrypt file'; if (xpPw) { xpPw = null; $('#xpNew').click(); } return err.textContent = 'Use a different password from your app passcode.'; }
    ok.textContent = 'Encrypting…';
    try {
      const job = xpJob, doc = await job.make();
      const zf = await zipFiles([doc], pw, xpName(job.kind));
      xpAckSess = true; xpPw = $('#xpKeep').checked || xpPw ? pw : null;
      repFile = zf; xpReset(); $('#xpDlg').close(); xpJob = null; job.done(zf);
    } catch (e) { err.textContent = 'Could not create the encrypted file: ' + (e && e.message || e); }
    pw = null; ok.disabled = false; ok.textContent = 'Encrypt file';
  });
  $('#pMake').onclick = () => {
    let from = $('#pFrom').value, to = $('#pTo').value; const err = $('#pErr'); err.textContent = '';
    if (!from || !to) return err.textContent = 'Choose both dates.'; if (from > to) [from, to] = [to, from];
    const f = fmt, mode = repMode, notes = $('#pNotes').checked, photos = $('#pPhotos').checked;
    xpOpen({ kind: mode, make: async () => {
      let blob, name;
      if (mode === 'audit') {
        const recs = await V.loadAudit(), chk = await V.verifyAudit();
        blob = f === 'csv' ? R.auditCsv(recs, from, to, { notes }) : await R.auditPdf(recs, from, to, chk, { notes });
        name = (from === to ? `audit-log-${from}` : `audit-log-${from}_to_${to}`) + '.' + (f === 'csv' ? 'csv' : 'pdf');
      } else {
        const list = R.select(S.encs, from, to), o = { photos, notes, loadPhoto: id => V.loadPhoto(id), credits: credits(list), now: Date.now() };
        blob = f === 'csv' ? R.csv(S.encs, from, to, o.now, S.encs, o) : f === 'docx' ? await R.docx(S.encs, from, to, o) : f === 'xlsx' ? R.xlsx(S.encs, from, to, o) : await R.pdf(S.encs, from, to, o);
        name = R.fname(from, to, EXT[f] || 'pdf');
      }
      return { name, blob };
    }, done: zf => {
      $('#pName').textContent = zf.name; $('#pSize').textContent = `(${Math.max(1, Math.round(zf.size / 1024))} KB, encrypted)`;
      $('#pReady').hidden = false; $('#pShare').hidden = !(navigator.canShare && navigator.canShare({ files: [zf] }));
      toast('Encrypted file ready');
    } });
  };
  async function shareFile(file, title) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      pickStart();
      try { await navigator.share({ files: [file], title }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; download(file); return 'downloaded'; }
      finally { pickEnd(); }
    }
    download(file); return 'downloaded';
  }
  function download(file) { const u = URL.createObjectURL(file), a = document.createElement('a'); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000); }
  // only encrypted .zip files reach the share sheet / downloads from the report dialog
  const isZip = f => f && /\.zip$/.test(f.name) && f.type === 'application/zip';
  $('#pShare').onclick = async () => { if (!isZip(repFile)) return; const r = await shareFile(repFile, 'MedBilling Logs export (encrypted)'); if (r !== 'cancelled') toast(r === 'shared' ? 'Shared' : 'Downloaded'); };
  $('#pDown').onclick = () => { if (!isZip(repFile)) return; download(repFile); toast('Downloaded'); };
  $$('[data-man]').forEach(b => b.addEventListener('click', () => { const m = $('#manDlg'); if (!m.open) m.showModal(); const t = document.getElementById(b.dataset.man); if (t) setTimeout(() => t.scrollIntoView({ block: 'start' }), 30); }));

  // ------------------------------------------------------------ settings / data
  $('#defSetting').onchange = () => { S.settings.defSetting = $('#defSetting').value; quickSet = S.settings.defSetting; setQuick(); saveSettings(); };
  $('#defProv').onchange = () => { S.settings.prov = $('#defProv').value; saveSettings(); };
  $('#warnA').onchange = () => { S.settings.warnA = +$('#warnA').value; saveSettings(); render(); };
  $('#warnR').onchange = () => { S.settings.warnR = +$('#warnR').value; saveSettings(); render(); };
  $('#autolock').onchange = () => { S.settings.autolock = +$('#autolock').value; saveSettings(); toast(`Auto-lock after ${S.settings.autolock} min`); };
  $('#chPass').onclick = async () => {
    const cur0 = await V.kind().catch(() => '');
    const v = await ask({ title: 'Change passcode / passphrase', text: 'All encounters and photos will be re-encrypted with the new one. A numeric passcode needs 6+ digits; a passphrase needs 12+ characters (words and spaces allowed). A forgotten passcode or passphrase means the data cannot be recovered. Face ID / Touch ID / passkey / quick PIN unlock is turned off and must be set up again.', ok: 'Change',
      fields: [{ id: 'old', label: 'Current passcode or passphrase' }, { id: 'k', label: 'New type', type: 'select', value: cur0 || 'pin', options: [['pin', 'Passcode (numbers, 6+ digits)'], ['phrase', 'Passphrase (12+ characters, words and spaces)']] }, { id: 'n1', label: 'New passcode or passphrase' }, { id: 'n2', label: 'Repeat it' }],
      check: async v => { const bad = loginCheck(v.k, v.n1); if (bad) return bad; if (v.n1 !== v.n2) return 'The new entries do not match.'; return (await V.rekey(v.old, v.n1, v.k)) ? ((sessPass = v.n1), '') : 'Current passcode or passphrase is wrong.'; } });
    if (v) { if (window.EasyUnlock) await EasyUnlock.disableAll('passcode-change').catch(() => {}); toast(v.k === 'pin' ? 'Passcode changed' : 'Passphrase changed'); if (typeof euRender === 'function') euRender(); }
  };
  $('#expAll').onclick = async () => {
    const v = await ask({ title: 'Encrypted backup', text: 'Enter your passcode. The backup is encrypted with it; you will need the same passcode to import it. Keep the file somewhere safe.', ok: 'Create backup', fields: [{ id: 'p', label: 'Passcode' }],
      check: async v => (await V.verify(v.p)) ? '' : 'Wrong passcode.' });
    if (!v) return;
    const b = await V.backup(v.p); if (!b) return toast('Wrong passcode');
    const file = new File([JSON.stringify(b)], `medbilling-logs-backup-${today()}.mblbackup`, { type: 'application/octet-stream' });
    const go = await ask({ title: 'Backup ready', text: `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB) is encrypted with your passcode. Save it to Files or send it to yourself; without the passcode it cannot be opened.`, ok: 'Share / save' });
    if (!go) return;
    const r = await shareFile(file, file.name);
    if (r !== 'cancelled' && S) { S.settings.lastBackup = Date.now(); S.settings.bkSnooze = 0; await saveSettings(); renderRetention(); checkBackupDue(); toast(r === 'shared' ? 'Backup shared' : 'Backup downloaded'); }
  };
  $('#impAll').onclick = () => { pickStart(); $('#impFile').click(); };
  $('#impFile').addEventListener('cancel', pickEnd);
  $('#impFile').addEventListener('change', async () => {
    pickEnd(); const f = $('#impFile').files[0]; $('#impFile').value = ''; if (!f || !S) return;
    let file; try { file = JSON.parse(await f.text()); } catch (e) { return toast('That file is not a MedBilling Logs backup'); }
    if (!file || file.kind !== 'encrypted-backup') return toast('That file is not a MedBilling Logs encrypted backup');
    let data = null;
    const v = await ask({ title: 'Import backup', text: 'Enter the passcode the backup was made with. Its encounters and photos will be added here and re-encrypted with your current passcode.', ok: 'Import', fields: [{ id: 'p', label: 'Backup passcode' }],
      check: async v => { data = await V.openBackup(file, v.p).catch(() => null); return data ? '' : 'Wrong passcode for this backup.'; } });
    if (!v || !data || !S) return;
    let added = 0, updated = 0, photos = 0;
    for (const e of data.encounters || []) {
      const ex = S.encs.find(x => x.id === e.id);
      if (!ex) { await saveEnc(e, 'import', 'Added from an encrypted backup'); added++; } else if ((e.updated || 0) > (ex.updated || 0)) { await saveEnc(e, 'import', 'Updated from a newer copy in an encrypted backup'); updated++; }
    }
    const have = new Set((await V.photoIds()).map(p => p.id));
    for (const p of data.photos || []) if (!have.has(p.id)) { await V.restorePhoto(p); photos++; }
    await migrateNotes(); premBase = null; render(); toast(`Imported: ${added} new, ${updated} updated, ${photos} photo(s)`, 3500);
  });
  $('#wipe').onclick = async () => {
    const v = await ask({ title: 'Delete all data', text: 'This erases every encounter, arrival/departure, call-back, photo, the whole audit log, all settings and the passcode from this device. It cannot be undone and the developer cannot recover anything. Check your retention obligations and make an encrypted backup first. Enter your passcode and type DELETE ALL to confirm.', ok: 'Delete everything', danger: true, fields: [{ id: 'p', label: 'Passcode' }, { id: 'c', label: 'Type DELETE ALL', type: 'text' }],
      check: async v => v.c.trim().toUpperCase() !== 'DELETE ALL' ? 'Type DELETE ALL to confirm.' : ((await V.verify(v.p)) ? '' : 'Wrong passcode.') });
    if (!v) return; S = null; if (EU) await EU.disableAll().catch(() => {}); await V.wipe(); await abForget(); localStorage.removeItem(failKey); lockNow('All data deleted.'); showLock('All data deleted. Create a new passcode to start again.');
  };

  // ============================================================ v8 backups: automatic (folder / native) or reminder + share
  // The .mblbackup is always written (AES-256-GCM, current passcode). Optional readable copies (PDF / Markdown / Word / Excel)
  // go into an AES-256 password-protected .zip by default. Nothing runs while locked: the key is needed and is only in memory.
  const AB_PRE = 'medbilling-logs-auto-', AB_RX = /^medbilling-logs-auto-(\d{4}-\d{2}-\d{2}_\d{6})(?:-readable)?\.(?:mblbackup|zip|pdf|md|docx|xlsx)$/;
  const FMTS = { pdf: 'PDF', md: 'Markdown', docx: 'Word', xlsx: 'Excel' };
  const EVERY = { 60: 'every hour', 120: 'every 2 hours', 240: 'every 4 hours', 1440: 'daily' };
  const CAPN = window.Capacitor;   // NATIVE is defined at the top
  let mbb, sessPass = null, abBusy = null, abLocOk = false, abStatusCache = {};
  function MBB() { if (mbb !== undefined) return mbb; mbb = null; if (NATIVE) { try { mbb = (CAPN.Plugins && CAPN.Plugins.MBBackup) || (CAPN.registerPlugin ? CAPN.registerPlugin('MBBackup') : null); } catch (e) { mbb = null; } } return mbb; }
  function abMode() { if (NATIVE) return MBB() ? 'native' : 'manual'; return typeof window.showDirectoryPicker === 'function' && window.isSecureContext ? 'fsa' : 'manual'; }
  const platform = () => NATIVE ? CAPN.getPlatform() : 'web';
  // folder handle + last status live in a small separate IndexedDB store (no patient data: a folder handle, times, file names)
  const KV = (() => {
    let db = null;
    const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => { const r = indexedDB.open('bl-backup-loc', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; res(db); }; r.onerror = () => rej(r.error); });
    const run = (mode, fn) => open().then(d => new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error); }));
    return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k)), drop: () => new Promise(res => { if (db) { db.close(); db = null; } const r = indexedDB.deleteDatabase('bl-backup-loc'); r.onsuccess = r.onerror = r.onblocked = () => res(); }) };
  })();
  const abGet = async () => (abStatusCache = (await KV.get('st').catch(() => null)) || {});
  const abPut = async o => { const st = Object.assign(await abGet(), o); await KV.set('st', st).catch(() => {}); abStatusCache = st; return st; };
  async function abForget() { try { if (MBB()) await MBB().clearFolder(); } catch (e) { /* ignore */ } await KV.drop(); abStatusCache = {}; }
  const errMsg = e => {
    const n = (e && e.name) || '', m = String((e && (e.message || e.errorMessage)) || e || 'unknown error');
    if (n === 'NotFoundError' || /could not be found|not found|no such file/i.test(m)) return 'The backup folder can\'t be found (moved, renamed or deleted?). Choose the location again.';
    if (n === 'NotAllowedError' || n === 'SecurityError' || /permission/i.test(m)) return 'This device needs your OK to save in the backup folder. Choose the location again or allow access.';
    if (n === 'QuotaExceededError' || /no space|quota|full/i.test(m)) return 'The backup location is full. Free up space or choose another location.';
    return m.slice(0, 200);
  };
  const abErr = (code, m) => Object.assign(new Error(m), { code });
  const stampOf = ts => { const d = new Date(ts); return `${R.dayKey(ts)}_${R.pad(d.getHours())}${R.pad(d.getMinutes())}${R.pad(d.getSeconds())}`; };
  const blobB64 = async b => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  // password strength (rough entropy estimate): 12+ characters and about 60 bits or more counts as strong enough
  function pwStrength(p) {
    p = p || ''; if (!p) return { bits: 0, label: 'Empty', ok: false };
    let cs = 0; if (/[a-z]/.test(p)) cs += 26; if (/[A-Z]/.test(p)) cs += 26; if (/\d/.test(p)) cs += 10; if (/[^A-Za-z0-9]/.test(p)) cs += 33;
    let bits = Math.log2(Math.max(cs, 2)) * Math.min(p.length, new Set(p).size * 2);
    if (/^(.)\1*$/.test(p) || /(password|passcode|passw0rd|qwerty|123456|abcdef|letmein|medbilling|welcome|admin|iloveyou)/i.test(p)) bits = Math.min(bits, 20);
    bits = Math.round(bits); const label = bits < 40 ? 'Weak' : bits < 60 ? 'Fair' : bits < 80 ? 'Strong' : 'Very strong';
    return { bits, label, ok: p.length >= 12 && bits >= 60 };
  }
  const readable = st => (st.abFmts || []).filter(f => FMTS[f]);
  // the always-visible lines under every backup button: encryption, which password, and that a lost password can't be recovered
  function bkExplain(kind) {
    const st = (S && S.settings) || DEF, fm = readable(st), zipOn = true, custom = st.abPwMode === 'custom';
    const L3 = 'If the password is lost, no one can open or recover the backup, including the developer.';
    if (kind === 'export') return `Encrypted with AES-256 (.mblbackup).<br>Password: your app passcode.<br>${L3}`;
    const l1 = 'Encrypted with AES-256 (.mblbackup)' + (fm.length ? (zipOn ? '; readable copies in an AES-256 password-protected .zip.' : '; <b>readable copies are NOT encrypted</b>.') : '.');
    const l2 = fm.length && zipOn && custom ? 'Passwords: app passcode (.mblbackup), backup password (.zip).' : 'Password: your app passcode.';
    return `${l1}<br>${l2}<br>${L3}`;
  }
  function renderExplain() { $$('.bkx').forEach(p => { p.innerHTML = bkExplain(p.dataset.k); }); }
  // writer for the chosen location
  async function abTarget(interactive) {
    const m = abMode();
    if (m === 'fsa') {
      const h = await KV.get('dir'); if (!h) throw abErr('nolocation', 'No backup location chosen yet.');
      let p = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
      if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
      if (p !== 'granted') throw abErr('permission', `This browser needs your OK to keep saving to the folder "${h.name}".`);
      return { name: h.name,
        write: async (name, blob) => { const fh = await h.getFileHandle(name, { create: true }); const w = await fh.createWritable(); try { await w.write(blob); await w.close(); } catch (e) { try { await w.abort(); } catch (x) { /* ignore */ } throw e; } },
        list: async () => { const out = []; for await (const [n, x] of h.entries()) if (x.kind === 'file') out.push(n); return out; },
        remove: n => h.removeEntry(n) };
    }
    if (m === 'native') {
      const P = MBB(), st = await P.status();
      if (!st.hasFolder) throw abErr('nolocation', 'No backup location chosen yet.');
      if (st.ok === false) throw abErr('permission', st.message || 'The app no longer has access to the backup folder. Choose it again.');
      return { name: st.name, write: async (name, blob) => { await P.writeFile({ name, data: await blobB64(blob), mime: blob.type || 'application/octet-stream' }); }, list: async () => (await P.listFiles()).files || [], remove: name => P.deleteFile({ name }) };
    }
    throw abErr('manual', 'This browser can\'t save to a folder automatically.');
  }
  async function abHasLocation() { try { const m = abMode(); if (m === 'fsa') return !!(await KV.get('dir')); if (m === 'native') return !!(await MBB().status()).hasFolder; } catch (e) { /* ignore */ } return false; }
  // synchronous snapshot: captures the key (inside Vault), the decrypted entries and the zip password before a lock clears them
  function abSnapshot() {
    const st = clone(S.settings), encP = V.autoBackup(), seqP = V.headSeq(); encP.catch(() => {}); seqP.catch(() => {});
    return { encP, seqP, encs: S.encs, st, at: Date.now(), credits: credits(S.encs), pw: st.abPwMode === 'custom' ? (st.abPw || '') : sessPass };
  }
  async function zipFiles(docs, pw, name) {
    const Z = window.zip; if (!Z || !Z.ZipWriter) throw abErr('zip', 'The encryption library did not load. Reload the app.');
    Z.configure({ useWebWorkers: false });
    const w = new Z.ZipWriter(new Z.BlobWriter('application/zip'), { password: pw, encryptionStrength: 3, zipCrypto: false, level: typeof CompressionStream === 'function' ? 6 : 0 });
    for (const d of docs) await w.add(d.name, new Z.BlobReader(d.blob));
    return new File([await w.close()], name, { type: 'application/zip' });
  }
  async function abFiles(snap, stamp, prefix) {
    const st = snap.st, files = [new File([JSON.stringify(await snap.encP)], `${prefix}${stamp}.mblbackup`, { type: 'application/octet-stream' })];
    const fm = readable(st); if (!fm.length) return files;
    const list = snap.encs, now = snap.at, days = list.map(e => R.encDay(e)).sort(), td = R.dayKey(now);
    const from = days[0] || td, to = days.length && days[days.length - 1] > td ? days[days.length - 1] : td, o = { photos: false, notes: !!st.abNotes, credits: snap.credits, now };
    const docs = [];
    for (const f of fm) docs.push({ name: `billing-log-${stamp}.${f}`, blob: f === 'pdf' ? await R.pdf(list, from, to, o) : f === 'docx' ? await R.docx(list, from, to, o) : f === 'md' ? R.md(list, from, to, o) : R.xlsx(list, from, to, o) });
    {   // v9d: readable copies are always inside the AES-256 .zip (the unencrypted option was removed)
      if (!snap.pw) throw abErr('password', st.abPwMode === 'custom' ? 'Set a backup password in Settings → Backups (needed for the protected copies).' : 'The protected copies need your app passcode: lock the app and unlock it once with the passcode (not Face ID, passkey or PIN).');
      files.push(await zipFiles(docs, snap.pw, `${prefix}${stamp}-readable.zip`));
    }
    return files;
  }
  async function abRotate(tg, keep) {
    const by = new Map();
    for (const n of await tg.list()) { const m = AB_RX.exec(n); if (m) { if (!by.has(m[1])) by.set(m[1], []); by.get(m[1]).push(n); } }
    let n = 0; for (const s of [...by.keys()].sort().reverse().slice(keep)) for (const f of by.get(s)) { await tg.remove(f); n++; }
    return n;
  }
  const kb = n => n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  // reason: interval | lock | now | unlock. Never interrupts: failures only update the status and the warning banner.
  async function runBackup(reason, snap) {
    if (abBusy) return abBusy;
    abBusy = (async () => {
      const kv = await abGet(), now = snap.at, wasOk = kv.ok !== false;
      try {
        if (reason !== 'now' && reason !== 'pick') {
          const seq = await snap.seqP;
          if (seq === kv.seq && wasOk && (reason === 'lock' || now - (kv.last || 0) < 86400000)) { if (reason !== 'lock') await abPut({ lastTry: now, checked: now }); return 'nochange'; }
        }
        const tg = await abTarget(reason === 'now' || reason === 'pick');
        const files = await abFiles(snap, stampOf(now), AB_PRE);
        for (const f of files) await tg.write(f.name, f);
        let rotMsg = '', removed = 0;
        try { removed = await abRotate(tg, snap.st.abKeep || 24); } catch (e) { rotMsg = 'Saved, but older backups could not be removed: ' + errMsg(e); }
        await abPut({ last: now, lastTry: now, checked: now, ok: true, msg: rotMsg, code: '', files: files.map(f => f.name), size: files.reduce((a, f) => a + f.size, 0), removed, seq: await snap.seqP, where: tg.name });
        abLocOk = true;
        if (S && V.unlocked()) {
          S.settings.lastBackup = now; S.settings.bkSnooze = 0; await saveSettings();
          if (reason === 'now' || reason === 'pick' || !wasOk) { await V.appendAudit({ action: 'backup', note: `${reason === 'now' ? 'Backup made (Back up now)' : reason === 'pick' ? 'First backup to the new location' : 'Automatic backups working again'}: ${files.length} file(s) saved to "${tg.name}"` + (removed ? `; ${removed} older file(s) rotated out` : '') }); await abPut({ seq: await V.headSeq() }); }
          checkBackupDue();
        }
        return 'ok';
      } catch (e) {
        await abPut({ lastTry: now, ok: false, msg: errMsg(e), code: e.code || '' });
        if (e.code === 'permission' || e.code === 'nolocation') abLocOk = false;
        if (S && V.unlocked() && wasOk && reason !== 'lock') { try { await V.appendAudit({ action: 'backup-fail', note: `${reason === 'now' ? 'Back up now' : 'Automatic backup'} failed: ${errMsg(e)}` }); } catch (x) { /* ignore */ } }
        return 'fail';
      } finally { if (S) abRender(); }
    })();
    try { return await abBusy; } finally { abBusy = null; if (reason === 'lock' && MBB() && MBB().backgroundDone) MBB().backgroundDone().catch(() => {}); }
  }
  // share sheet / download (Safari and other browsers without folder access, or no location chosen yet)
  async function abShare() {
    const snap = abSnapshot(); let files;
    try { files = await abFiles(snap, stampOf(snap.at), 'medbilling-logs-backup-'); } catch (e) { await abPut({ lastTry: snap.at, ok: false, msg: errMsg(e), code: e.code || '' }); abRender(); return toast('Backup not made: ' + errMsg(e), 4000); }
    let r = 'downloaded';
    if (navigator.canShare && navigator.canShare({ files })) {
      pickStart();
      try { await navigator.share({ files, title: 'MedBilling Logs backup' }); r = 'shared'; }
      catch (e) { if (e.name === 'AbortError') r = 'cancelled'; else files.forEach((f, i) => setTimeout(() => download(f), i * 500)); }
      finally { pickEnd(); }
    } else files.forEach((f, i) => setTimeout(() => download(f), i * 500));
    if (r === 'cancelled' || !S) return;
    S.settings.lastBackup = snap.at; S.settings.bkSnooze = 0; await saveSettings();
    await V.appendAudit({ action: 'backup', note: `Backup ${r} (${files.length} file(s): ${files.map(f => f.name.split('.').pop()).join(', ')})` });
    await abPut({ last: snap.at, lastTry: snap.at, ok: true, msg: '', code: '', files: files.map(f => f.name), size: files.reduce((a, f) => a + f.size, 0), seq: await V.headSeq(), where: r === 'shared' ? 'share sheet' : 'Downloads', snooze: 0 });
    checkBackupDue(); abRender(); toast(r === 'shared' ? 'Backup shared' : 'Backup downloaded');
  }
  async function abNow() {
    if (!S) return;
    if (abMode() !== 'manual' && await abHasLocation()) {
      $('#abNow').disabled = true; $('#abStat').textContent = 'Backing up…';
      const r = await runBackup('now', abSnapshot()); $('#abNow').disabled = false;
      toast(r === 'ok' ? `Backup saved to "${abStatusCache.where}"` : 'Backup failed. See Settings → Backups.', 3000);
    } else await abShare();
  }
  async function abTick() {
    if (!S) return; const st = S.settings, kv = await abGet(), now = Date.now(), every = (st.abEvery || 60) * 60000;
    if (!st.abOn) return abRender();
    if (abMode() === 'manual') return abRender();
    if (abBusy || now - (kv.lastTry || 0) < (kv.ok === false ? Math.min(every, 15 * 60000) : every)) return;
    if (!(await abHasLocation())) return abRender();
    await runBackup('interval', abSnapshot());
  }
  setInterval(() => { abTick().catch(() => {}); }, 30000);
  // after unlock: check folder access (asks again when the browser requires it), then catch up if a backup is due
  async function abInit() {
    const kv = await abGet(); if (kv.last && kv.last > (S.settings.lastBackup || 0)) { S.settings.lastBackup = kv.last; await saveSettings(); }
    abLocOk = false;
    if (abMode() === 'fsa') { const h = await KV.get('dir').catch(() => null); if (h) { let p = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied'); if (p === 'prompt' && S.settings.abOn) p = await h.requestPermission({ mode: 'readwrite' }).catch(() => 'prompt'); abLocOk = p === 'granted'; } }
    else if (abMode() === 'native') { try { const s = await MBB().status(); abLocOk = !!(s.hasFolder && s.ok !== false); } catch (e) { abLocOk = false; } }
    abRender(); setTimeout(() => { abTick().catch(() => {}); }, 4000);
  }
  async function abSet(changes, note) { Object.assign(S.settings, changes); await saveSettings(); await V.appendAudit({ action: 'backup-settings', note }); abRender(); }
  function modeText() {
    const m = abMode(), pl = platform();
    if (m === 'fsa') return { short: 'This browser can save backups straight to a folder you choose.', how: '<p>Choose a folder once (for example a folder in Documents, or a synced OneDrive / Google Drive / iCloud Drive folder on this computer). While the app is open and unlocked, a backup is saved there at the interval you pick, and again when the app locks or the tab is closed (if the browser allows the time). Nothing runs while the app is closed or locked, because the key that decrypts your data exists only while unlocked.</p><p>If there were no changes since the last backup, the app skips that interval (it still writes one at least daily). After you restart the browser, Chrome or Edge may ask you once to allow access to the folder again.</p>' };
    if (m === 'native') return { short: (pl === 'ios' ? 'Choose a folder in Files (iCloud Drive or On My iPhone/iPad).' : 'Choose a folder on this phone or in a cloud drive (for example Google Drive).') + ' Backups run while the app is open; phones don\'t allow guaranteed background runs.',
      how: `<p>While the app is open and unlocked, a backup is saved at the interval you pick, and again when the app goes to the background.</p><p><b>Phones don't allow guaranteed background runs.</b> ${pl === 'ios' ? 'iOS' : 'Android'} pauses the app soon after you leave it, so if the app stays closed, no backups happen until you open and unlock it again. A backup started as the app goes to the background usually finishes, but it is not guaranteed.</p><p>${pl === 'ios' ? 'iCloud Drive uploads the files when iOS decides to; check the Files app to confirm they arrived.' : 'Cloud folders (Google Drive and others) upload the files when the provider\'s app syncs.'}</p>` };
    return { short: 'This browser can\'t save to a folder automatically (Safari and some others don\'t allow it).', how: '<p>With automatic backups on, a reminder appears at the top of Today at the interval you pick (hourly by default). <b>Back up now</b> opens the share sheet (Save to Files, AirDrop…) or downloads the files. Old copies aren\'t removed automatically here; delete them yourself. For fully automatic backups, use Chrome or Edge on a computer, or the iPhone / Android app.</p>' };
  }
  async function abRender() {
    if (!S) return; const st = S.settings, kv = await abGet(), m = abMode(), fm = readable(st), mt = modeText(), loc = m === 'manual' ? '' : (st.abLoc || '');
    if (!S) return;
    $('#abOn').checked = !!st.abOn; $('#abOnHint').textContent = st.abOn ? `(on, ${EVERY[st.abEvery || 60]})` : '(off)';
    $('#abEvery').value = String(st.abEvery || 60); $('#abKeep').value = String(st.abKeep || 24);
    $('#abMode').textContent = mt.short; $('#abHow').innerHTML = mt.how;
    $('#abLocRow').hidden = m === 'manual'; $('#abKeep').closest('label').hidden = m === 'manual';
    $('#abLocName').textContent = loc || 'Not chosen'; $('#abLocName').classList.toggle('muted', !loc);
    $('#abPick').textContent = loc ? 'Change location' : 'Choose backup location';
    $('#abLast').textContent = kv.last ? `${new Date(kv.last).toLocaleString()}${kv.where ? ` · ${kv.where}` : ''}${kv.files ? ` · ${kv.files.length} file(s), ${kb(kv.size || 0)}` : ''}` : (st.lastBackup ? new Date(st.lastBackup).toLocaleString() : 'never');
    let stat = '', bad = false;
    if (kv.ok === false) { bad = true; stat = `Last attempt failed (${new Date(kv.lastTry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}): ${kv.msg}`; }
    else if (st.abOn && m !== 'manual' && !loc) { bad = true; stat = 'Choose a backup location to start automatic backups.'; }
    else if (st.abOn && m !== 'manual') stat = `OK. Next backup ${kv.lastTry ? 'around ' + new Date(kv.lastTry + (st.abEvery || 60) * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'shortly'}${kv.checked && kv.checked > (kv.last || 0) ? ' (no changes at the last check)' : ''}.${kv.msg ? ' ' + kv.msg : ''}`;
    else if (st.abOn) stat = 'Reminder mode: you\'ll be reminded at the interval you picked.';
    else stat = 'Automatic backups are off.';
    $('#abStat').textContent = stat; $('#abStat').classList.toggle('bad', bad);
    $$('#bkCard .abf').forEach(c => { c.checked = fm.includes(c.value); });
    $('#abReadBox').hidden = !fm.length;
    const zipOn = true; $('#abZip').checked = true; $('#abPwBox').hidden = !zipOn;
    $('#abFmtWarn').classList.toggle('danger', !zipOn);
    $('#abFmtWarn').innerHTML = zipOn ? '<b>Readable copies contain patient details</b> (room, initials, chart/MRN, codes' + (st.abNotes ? ', notes' : '') + '). They are inside an AES-256 password-protected .zip, but once someone unzips them they are <b>not encrypted</b>. Save backups only to a secure location you control.'
      : '<b>Warning: readable copies are NOT encrypted.</b> PDF, Markdown, Word and Excel files contain patient details (room, initials, chart/MRN, codes' + (st.abNotes ? ', notes' : '') + ') that anyone with access to the folder can read. Only use this for a secure, private location, and turn password protection back on if you can.';
    $$('input[name=abPwMode]').forEach(r => { r.checked = r.value === (st.abPwMode || 'passcode'); });
    const custom = st.abPwMode === 'custom'; $('#abPwSet').hidden = !custom; $('#abPwSet').textContent = st.abPw ? 'Change backup password…' : 'Set backup password…';
    const ps = pwStrength(custom ? st.abPw : sessPass);
    $('#abPwInfo').innerHTML = custom ? (st.abPw ? `Separate backup password set (${esc(ps.label.toLowerCase())}). It is kept only in the app's encrypted storage.` : '<b>No backup password set yet.</b> Protected copies can\'t be made until you set one.')
      : (ps.ok ? 'The .zip opens with your app passcode.' : '<b>Your app passcode is short for files that leave this device.</b> A .zip password can be guessed much faster than your passcode, so a separate backup password of 12+ characters is safer.');
    $('#abPwInfo').classList.toggle('bad', custom ? !st.abPw : !ps.ok);
    renderExplain();
    // banners on Today (never block anything)
    const w = $('#abWarn');
    if (st.abOn && m !== 'manual' && kv.ok === false) { w.hidden = false; $('#abWarnTxt').innerHTML = `<b>Automatic backup didn't work</b> (${new Date(kv.lastTry).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}): ${esc(kv.msg)} Your entries are safe on this device.`; $('#abWarnAllow').hidden = kv.code !== 'permission' || m !== 'fsa'; }
    else if (st.abOn && m === 'fsa' && loc && !abLocOk && (await KV.get('dir').catch(() => null))) { w.hidden = false; $('#abWarnTxt').innerHTML = `<b>Automatic backups are paused.</b> This browser needs your OK to keep saving to "${esc(loc)}".`; $('#abWarnAllow').hidden = false; }
    else w.hidden = true;
    const every = (st.abEvery || 60) * 60000, due = st.abOn && m === 'manual' && Date.now() - Math.max(kv.last || 0, kv.snooze || 0) >= every;
    $('#abRemind').hidden = !due;
    if (due) $('#abRemindTxt').innerHTML = `<b>Backup reminder.</b> ${kv.last ? `Your last backup was ${new Date(kv.last).toLocaleString()}.` : 'You haven\'t made a backup here yet.'} This browser can't save backups automatically, so tap Back up now to share or download them.`;
    if (due) $('#bkRemind').hidden = true;
  }
  // ---- settings handlers (every change is audit-logged; passwords never appear in the log)
  $('#abOn').onchange = async () => { const on = $('#abOn').checked; await abSet({ abOn: on }, on ? `Automatic backups turned on (${EVERY[S.settings.abEvery || 60]}, keep ${S.settings.abKeep || 24}; ${abMode() === 'manual' ? 'reminder mode in this browser' : 'location: ' + (S.settings.abLoc || 'not chosen')})` : 'Automatic backups turned off'); if (on) { await abPut({ snooze: 0 }); abTick(); } };
  $('#abEvery').onchange = () => abSet({ abEvery: +$('#abEvery').value }, `Backup frequency: ${EVERY[$('#abEvery').value]}`);
  $('#abKeep').onchange = () => abSet({ abKeep: +$('#abKeep').value }, `Keep the last ${$('#abKeep').value} automatic backups (older ones are rotated out)`);
  $$('#bkCard .abf').forEach(c => c.onchange = () => { const l = $$('#bkCard .abf').filter(x => x.checked).map(x => x.value); abSet({ abFmts: l }, l.length ? `Readable backup copies: ${l.map(f => FMTS[f]).join(', ')} (plus the encrypted .mblbackup)` : 'Readable backup copies: none (encrypted .mblbackup only)'); });
  $('#abNotes').onchange = () => abSet({ abNotes: $('#abNotes').checked }, $('#abNotes').checked ? 'Readable backup copies: notes included' : 'Readable backup copies: notes left out');
  // v9d: no way to turn off the readable-copy encryption any more
  $$('input[name=abPwMode]').forEach(r => r.onchange = async () => { if (!r.checked) return; await abSet({ abPwMode: r.value }, r.value === 'custom' ? 'Readable-copy password: separate backup password' : 'Readable-copy password: app passcode'); if (r.value === 'custom' && !S.settings.abPw) openPwDlg(); });
  $('#abPick').onclick = async () => {
    if (!S) return; const m = abMode(); let name;
    if (m === 'fsa') {
      let h; try { h = await window.showDirectoryPicker({ id: 'mbl-backups', mode: 'readwrite', startIn: 'documents' }); } catch (e) { if (e.name !== 'AbortError') toast('Could not open the folder picker: ' + errMsg(e), 4000); return; }
      const p = await h.requestPermission({ mode: 'readwrite' }).catch(() => 'denied'); if (p !== 'granted') return toast('Permission to save in that folder was not given', 3500);
      await KV.set('dir', h); name = h.name;
    } else if (m === 'native') {
      pickStart(); try { name = (await MBB().pickFolder()).name; } catch (e) { if (!/cancel/i.test(errMsg(e))) toast('Could not use that folder: ' + errMsg(e), 4000); return; } finally { pickEnd(); }
    } else return;
    if (!S) return; abLocOk = true; await abPut({ ok: true, msg: '', code: '' });
    await abSet({ abLoc: name }, `Backup location chosen: "${name}"`); toast(`Backups will be saved to "${name}"`, 3000);
    if (S.settings.abOn) runBackup('pick', abSnapshot());
  };
  $('#abNow').onclick = abNow;
  $('#abRemindNow').onclick = abNow;
  $('#abRemindLater').onclick = async () => { await abPut({ snooze: Date.now() }); abRender(); };
  $('#abWarnRetry').onclick = () => { if (S) abNow(); };
  $('#abWarnAllow').onclick = async () => { const h = await KV.get('dir').catch(() => null); if (!h) return; const p = await h.requestPermission({ mode: 'readwrite' }).catch(() => 'denied'); abLocOk = p === 'granted'; if (abLocOk) { await abPut({ ok: true, msg: '', code: '' }); toast('Access allowed'); runBackup('now', abSnapshot()); } else toast('Access not allowed'); abRender(); };
  $('#abWarnSet').onclick = () => { tab = 'data'; showTab(); setTimeout(() => $('#bkCard').scrollIntoView({ block: 'start' }), 50); };
  // ---- separate backup password (strength check; kept only inside the encrypted settings)
  function openPwDlg() { $('#bp1').value = $('#bp2').value = ''; $('#bpErr').textContent = ''; pwMeter(); $('#bpDlg').showModal(); setTimeout(() => $('#bp1').focus(), 50); }
  function pwMeter() { const v = $('#bp1').value, s = PwPolicy.check(v, { personal: xpPersonal() }), bar = $('#bpBar'); bar.style.width = (v ? [0, 22, 45, 75, 100][s.level] : 0) + '%'; bar.className = s.level >= 4 ? 'vs' : s.level === 3 ? 'g' : s.level === 2 ? 'f' : 'w'; $('#bpStr').textContent = v ? `Strength: ${s.label}${s.ok ? '' : ' · ' + s.reasons[0]}` : 'At least 12 characters, different from your app passcode.'; }
  $('#bp1').addEventListener('input', pwMeter);
  $('#abPwSet').onclick = openPwDlg;
  $('#bpCancel').onclick = () => $('#bpDlg').close();
  $('#bpForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const a = $('#bp1').value, b = $('#bp2').value, s = PwPolicy.check(a, { personal: xpPersonal() });
    if (!s.ok) return $('#bpErr').textContent = 'This password can\u2019t be used: ' + s.reasons[0];
    if (a !== b) return $('#bpErr').textContent = 'The passwords do not match.';
    if ((sessPass && a === sessPass) || await V.verify(a).catch(() => null)) return $('#bpErr').textContent = 'Use a different password from your app passcode.';
    const had = !!S.settings.abPw; $('#bp1').value = $('#bp2').value = ''; $('#bpDlg').close();
    await abSet({ abPw: a, abPwMode: 'custom' }, had ? 'Separate backup password changed' : 'Separate backup password set'); toast('Backup password saved');
  });

  // ============================================================ v5 features (all on-device; every data change goes through saveEnc/deleteEnc and the audit log)
  // ---- 1. forgotten-timer warning (amber, then red) + unlock prompt. In-app only; no notifications.
  function runMs(e) { const l = e.segs[e.segs.length - 1]; return e.status === 'run' && l && l.e == null ? Date.now() - l.s : 0; }
  function warnLvl(e) { if (!S || kindOf(e) === 'shift' || e.status !== 'run') return ''; const m = runMs(e) / 60000; return m >= (S.settings.warnR || 180) ? 'r' : m >= (S.settings.warnA || 60) ? 'a' : ''; }
  function warnHtml(e) { const m = Math.floor(runMs(e) / 60000); return `${warnLvl(e) === 'r' ? 'Long timer' : 'Running a while'}: ${R.hmin(m)} since ${R.hm(e.segs[e.segs.length - 1].s)}. Still with this patient? <button type="button" class="linkbtn sm" data-a="stopat">Stop at…</button>`; }
  async function checkLongTimers() {
    if (!S) return;
    for (const e of S.encs.filter(x => warnLvl(x) === 'r').sort((a, b) => R.startOf(a) - R.startOf(b))) { if (!S) return; await longPrompt(S.encs.find(x => x.id === e.id) || e, true); }
  }
  function longPrompt(e, onUnlock) {
    return new Promise(res => {
      if (!S || !e || e.status !== 'run') return res();
      const d = $('#longDlg'), l = e.segs[e.segs.length - 1], who = kindOf(e) === 'cb' ? 'this call-back' : (e.label || 'this patient');
      $('#lgTitle').textContent = onUnlock ? 'Timer still running' : 'Stop at an earlier time';
      $('#lgText').textContent = `Still with ${who}? This timer has been running since ${R.hm(l.s)} (${R.hmin(Math.floor(runMs(e) / 60000))}). Stop it now, or set the real end time. A corrected time is saved as "entered later" and noted in the audit log.`;
      $('#lgAt').value = dtLocal(Math.min(Date.now(), l.s + Math.min(60, Math.max(15, Math.floor(runMs(e) / 60000))) * 60000)); $('#lgErr').textContent = '';
      $('#lgKeep').textContent = onUnlock ? 'Keep running' : 'Cancel';
      const done = () => { d.close(); $('#lgKeep').onclick = $('#lgNow').onclick = $('#lgAtBtn').onclick = d.oncancel = null; res(); };
      $('#lgKeep').onclick = done; d.oncancel = ev => { ev.preventDefault(); done(); };
      $('#lgNow').onclick = async () => { const x = S && S.encs.find(y => y.id === e.id); done(); if (x) await act(x, 'stop', 'Stopped from the long-timer prompt'); };
      $('#lgAtBtn').onclick = async () => {
        const t = parseLocal($('#lgAt').value), x = S && S.encs.find(y => y.id === e.id); if (!x) return done();
        const ls = x.segs[x.segs.length - 1];
        if (!t || t <= ls.s) return $('#lgErr').textContent = `The end must be after ${R.hm(ls.s)}.`;
        if (t > Date.now()) return $('#lgErr').textContent = 'The end cannot be in the future.';
        const prev = clone(x), y = clone(x); y.segs[y.segs.length - 1].e = t; y.status = 'done'; y.late = true; y.edits = (y.edits || []).concat(Date.now());
        done(); await saveEnc(y, 'stop', `End time corrected to ${R.hm(t)} from the long-timer prompt (entered later)`); render();
        snack(`Stopped at ${R.hm(t)}`, () => undoTo(prev, y, 'Corrected stop undone'));
      };
      d.showModal();
    });
  }
  // ---- 3. next-unit hint (display only; recorded minutes stay as actual minutes, nothing is rounded)
  function nextUnit(m) { const u = R.units(m); for (let t = m + 1; t <= m + 16; t++) if (R.units(t) > u) return t; return null; }
  function unitsHtml(e, m) {
    const k = kindOf(e); if (k === 'shift') return R.hmin(m) + ' on site';
    const u = R.units(m); let h = `${m} min · ${u} unit${u === 1 ? '' : 's'}`;
    if (e.status === 'run') { const n = nextUnit(m); if (n) h += ` · <span class="nu${n - m <= 2 ? ' soon' : ''}">+1 unit at ${n} min</span>`; }
    return h;
  }
  // time-period tags and short breakdowns (Alberta periods per user; see R.PERIOD_CFG)
  function perTags(e) {   // compact tag under the start time: premium period(s) only, full breakdown in the tooltip and details
    if (kindOf(e) === 'shift') return ''; const ps = R.periodSplit(e).parts.filter(p => !R.PBY[p.id].regular); if (!ps.length) return '';
    return `<small class="pt" title="${esc(R.perTxt(R.periodSplit(e).parts))}">${esc(R.PBY[ps[0].id].short)}${ps.length > 1 ? '+' : ''}</small>`;
  }
  const perShort = t => t.perList && t.perList.length ? `<br><span class="pert">${t.perList.map(p => `${esc(R.PBY[p.id].short)} ${p.m}m/${p.u}u`).join(' · ')}</span>` : '';
  // ---- 6. undo snackbar (5 s) for delete and stop
  let snackT = null, snackFn = null; const photoDel = new Map();
  function snack(text, fn, ms, wrap, label) { $('#snackTxt').textContent = text; $('#snackUndo').textContent = label || 'Undo'; snackFn = fn; const n = $('#snack'); if (wrap) $('#toast').classList.remove('show'); n.classList.toggle('wrap', !!wrap); n.hidden = false; snackAvoidNav(); clearTimeout(snackT); snackT = setTimeout(hideSnack, ms || 5000); }
  function hideSnack() { clearTimeout(snackT); snackFn = null; const n = $('#snack'); if (n) { n.hidden = true; n.style.bottom = ''; } }
  // v9l: on a phone the cell Next/Done bar sits at the bottom while a cell has the cursor; keep the snackbar (and its Undo) above it
  function snackAvoidNav() { const n = $('#snack'), g = $('#gNav'); if (!n || n.hidden) return; n.style.bottom = '';
    if (g && !g.hidden) { const gr = g.getBoundingClientRect(), sr = n.getBoundingClientRect(); if (sr.bottom > gr.top - 6 && sr.top < gr.bottom) n.style.bottom = Math.round(innerHeight - gr.top + 8) + 'px'; } }
  $('#snackUndo').onclick = async () => { const f = snackFn; hideSnack(); if (f && S) { try { await f(); } catch (e) { toast('Could not undo: ' + e.message); } } };
  function flushPhotoDel() { for (const [tm, ph] of photoDel) { clearTimeout(tm); ph.forEach(p => V.removePhoto(p)); } photoDel.clear(); }
  async function undoTo(prev, after, note) {   // only if nothing changed the entry since
    const now = S.encs.find(x => x.id === prev.id); if (!now || now.updated !== after.updated) return toast('Not undone: the entry changed');
    await saveEnc(clone(prev), 'undo', note); render(); toast('Undone');
  }
  // ---- 8. one-tap patient switch: stop the running encounter and start the next (same setting and facility only)
  async function switchPatient(e) {
    if (!S || e.status !== 'run') return;
    const now = Date.now(), prev = clone(e), st = clone(e), l = st.segs[st.segs.length - 1]; if (l && l.e == null) l.e = now; st.status = 'done';
    await saveEnc(st, 'stop', 'Stopped by one-tap patient switch');
    const n = S.encs.filter(x => R.encDay(x) === today() && kindOf(x) === 'enc').length + 1;
    const qn = ($('#qName') && $('#qName').value || '').trim(), qm = ($('#qMrn') && $('#qMrn').value || '').trim();
    const ne = { id: uid(), kind: 'enc', name: qn, mrn: qm, chart: qm, billingNote: '', label: (!qn && !qm) ? `Encounter ${n}` : '', initials: '', setting: e.setting || 'H', facility: e.facility || null, type: '', codes: [], notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    if (facNoOf(e)) { ne.facNo = facNoOf(e); if (R.facNmTxt(e)) ne.facNm = R.facNmTxt(e); } if (fcenOf(e)) ne.fcen = fcenOf(e); carryFac(ne, today());   // v9o
    await saveEnc(ne, 'create', 'Started by one-tap patient switch'); if ($('#qName')) $('#qName').value = ''; if ($('#qMrn')) $('#qMrn').value = ''; render();
    snack(`Switched to ${ne.label}`, async () => {
      const a = S.encs.find(x => x.id === st.id), b = S.encs.find(x => x.id === ne.id);
      if (!a || a.updated !== st.updated || (b && b.updated !== ne.updated)) return toast('Not undone: an entry changed');
      if (b) await deleteEnc(b, 'Patient switch undone'); await saveEnc(clone(prev), 'undo', 'Patient switch undone'); render(); toast('Undone');
    });
  }
  // ---- 10. full-screen procedure timer: time only (bystanders can see it), screen kept on, auto-lock unchanged
  let procId = null, wake = null;
  async function keepAwake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
  function stopWake() { if (wake) { wake.release().catch(() => {}); wake = null; } }
  function openProc(e) { procId = e.id; procTick(); $('#pcNote').textContent = 'Time only. ' + ('wakeLock' in navigator ? 'The screen stays on' : 'This browser cannot keep the screen on') + `; auto-lock still applies (${S.settings.autolock || 2} min without a touch).`; $('#procDlg').showModal(); keepAwake(); }
  function procTick() {
    if (!procId || !$('#procDlg').open) return; const e = S && S.encs.find(x => x.id === procId); if (!e) { $('#procDlg').close(); return; }
    $('#pcTime').textContent = fmtDur(R.msOf(e)); $('#pcState').textContent = e.status === 'run' ? 'Running' : e.status === 'pause' ? 'Paused' : 'Stopped';
    $('#pcPause').textContent = e.status === 'pause' ? 'Resume' : 'Pause'; $('#pcPause').className = e.status === 'pause' ? 'resumebtn' : 'pausebtn'; $('#pcPause').disabled = $('#pcStop').disabled = e.status === 'done';
  }
  $('#pcPause').onclick = async () => { const e = S && S.encs.find(x => x.id === procId); if (e) { await act(e, e.status === 'pause' ? 'resume' : 'pause'); procTick(); } };
  $('#pcStop').onclick = async () => { const e = S && S.encs.find(x => x.id === procId); if (e) { $('#procDlg').close(); await act(e, 'stop'); } };
  $('#pcExit').onclick = () => $('#procDlg').close();
  $('#procDlg').addEventListener('close', () => { procId = null; stopWake(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#procDlg').open) keepAwake(); });
  // ---- time period tracker bar (Alberta periods per user, America/Edmonton time)
  const leftTxt = ms => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${R.pad(m % 60)}m` : `${m} min`; };
  function renderPbar() {
    if (!S) return; const now = Date.now(), a = R.periodAt(now), nx = R.periodAt(a.end + 1000), p = a.p; a.key0 = R.dayKey(now);
    $('#pbName').textContent = p.name + (a.holiday ? ' · ' + a.holiday : '');
    $('#pbHrs').textContent = R.pHours(p);
    $('#pbLeft').textContent = `${leftTxt(a.end - now)} left → ${nx.p.name}`; $('#pbLeft').title = `Next: ${nx.p.name} from ${R.hm(a.end)}`;
    $('#pbFill').style.width = Math.min(100, Math.max(0, (now - a.start) / (a.end - a.start) * 100)).toFixed(1) + '%';
    let logged = 0;
    for (const e of S.encs) { if (kindOf(e) === 'shift' || !e.segs.some(s => s.s < a.end && (s.e == null ? now : s.e) > a.start)) continue; for (const b of R.periodSplit(e, now).blocks) if (b.t >= a.start && b.t < a.end) logged++; }
    // v9o: premium periods show the 03.01AA modifier and the units logged against its daily maximum (e.g. "TEV 6/20 u")
    const pc = p.regular ? null : R.premCode(now), mx = pc ? premMax(pc) : 0, el = Math.min(p.units, Math.floor((now - a.start) / 900000));
    const ent = pc ? (R.premUnits(S.encs.filter(e => R.encDay(e) === a.key0)).get(a.key0 + '|' + pc) || 0) : 0;
    $('#pbUnits').textContent = p.regular ? `no premium units · logged ${logged} u` : `${pc} ${ent}/${mx} u · logged ${logged} u`;
    $('#pbUnits').title = p.regular ? `Regular hours. Units logged in encounters this period: ${logged}` : `${R.PREM[pc].name} (${pc}; surcharge ${R.PREM[pc].surc}). ${ent} units entered on ${pc} modifiers today (daily maximum ${mx}); ${logged} units of logged time in this period. 03.01AA ${pc}${premMine(pc) ? ' (limit set by you)' : ''}. ${el} of the period's ${p.units} 15-minute blocks have passed.`;
    $('#pbar').className = 'pbar p-' + p.id + (p.regular ? '' : ' prem') + (pc && ent > mx ? ' pover' : pc && ent >= mx ? ' pfull' : '');
  }
  // ---- v9o: after-hours time premium (HSC 03.01AA, SURT modifiers) running counts and the limit pop-up.
  // Units are counted by time, exactly like the units column and the header: every 15-minute unit of every encounter / call-back
  // goes to the period holding the middle of that block (= GR 15.13.6, majority of the block), per Edmonton calendar day. The
  // limits are the Alberta Health Price List maximums per day (TEV 20, TNTP 8, TNTA 28, TWK / TST / TDES 60); a limit can be
  // changed in Settings (shown as "set by you"). Warnings only: nothing is ever blocked.
  let premBase = null, premTick = 0; const premDays = new Set(), premSeen = new Map();
  function premDirty(e) { if (!e || !e.segs || !e.segs.length) return; const k = R.encDay(e); premDays.add(k); premDays.add(shiftDay(k, 1)); }
  const premOver = c => { const v = ((S && S.settings.premMax) || {})[c]; return v != null && v !== '' && +v > 0 ? Math.floor(+v) : null; };
  const premMax = c => premOver(c) || R.PREM[c].max;
  const premMine = c => premOver(c) != null && premOver(c) !== R.PREM[c].max;
  function premFor(days) {
    const ks = new Set(days), near = new Set(); days.forEach(k => { near.add(k); near.add(shiftDay(k, -1)); });
    const m = R.premUnits(S.encs.filter(e => ks.has(R.encDay(e)))), out = new Map();   // units ENTERED on the modifiers
    for (const [k, v] of m) if (ks.has(k.slice(0, 10))) out.set(k, v);
    return out;
  }
  function premTime(d) {   // units of logged time per window (for the tooltip and suggestions)
    const near = new Set([d, shiftDay(d, -1)]), m = R.premCounts(S.encs.filter(e => near.has(R.encDay(e))), Date.now()), out = new Map();
    for (const [k, v] of m) if (k.startsWith(d + '|')) out.set(k, v); return out;
  }
  const premLvl = (n, mx) => n > mx ? 'over' : n >= mx ? 'full' : n >= mx * 0.8 ? 'near' : n ? 'some' : '';
  function renderPrem() {
    const box = $('#premStrip'); if (!box) return; if (!S) { box.hidden = true; return; }
    const d = curDay(), cnt = premFor([d]), hol = R.holidayName(d), tc = premTime(d);
    box.hidden = false;
    box.innerHTML = `<span class="pl">03.01AA${hol ? ' · ' + esc(hol) : ''}</span>` + R.premDayCodes(d).map(c => { const n = cnt.get(d + '|' + c) || 0, mx = premMax(c);
      return `<span class="pi ${premLvl(n, mx)}" data-pc="${c}" title="${esc(`${R.PREM[c].name}, ${R.PREM[c].when} (surcharge ${R.PREM[c].surc}): ${n} of ${mx} units entered${premMine(c) ? ' (limit set by you)' : ''}; ${tc.get(d + '|' + c) || 0} units of logged time in this window`)}">${c} <b>${n}</b>/${mx}${premMine(c) ? '*' : ''}</span>`; }).join('');
    box.setAttribute('aria-label', `After-hours time premium, ${R.fmtDay(d)}: ` + R.premDayCodes(d).map(c => `${c} ${cnt.get(d + '|' + c) || 0} of ${premMax(c)} units`).join(', ') + '. Opens the details');
  }
  function premCheck() {
    if (!S) return;
    if (!premBase) { premBase = R.premUnits(S.encs); premDays.clear(); return; }   // after unlock / import: today's state is the baseline, no pop-up
    const days = new Set(premDays); premDays.clear(); days.add(today());
    for (const e of S.encs) if (e.status === 'run') { const k = R.encDay(e); days.add(k); days.add(shiftDay(k, 1)); }
    const cur = premFor([...days]), hits = [];
    for (const d of days) {
      const codes = new Set(R.premDayCodes(d)); for (const k of cur.keys()) if (k.startsWith(d + '|')) codes.add(k.slice(11)); for (const k of premBase.keys()) if (k.startsWith(d + '|')) codes.add(k.slice(11));
      for (const c of codes) { const k = d + '|' + c, a = premBase.get(k) || 0, b = cur.get(k) || 0, mx = premMax(c);
        if (b) premBase.set(k, b); else premBase.delete(k);
        if (b <= a || b < mx || S.settings.premWarn === false) continue;
        const lvl = b > mx ? 'over' : 'full', was = premSeen.get(k);
        if (lvl === 'full' || (lvl === 'over' && was !== 'over')) { premSeen.set(k, lvl); hits.push({ d, c, n: b, mx }); }
        else toast(`${c}: ${b} of ${mx} units on ${R.fmtDay(d)}. Over the limit.`, 3500);
      }
    }
    if (hits.length) premPop(hits);
  }
  function premLine(h) { const p = R.PREM[h.c], when = h.d === today() ? 'today' : 'on ' + R.fmtDay(h.d);
    return h.n > h.mx ? `Over the limit for ${h.c} (${p.name.toLowerCase()}, ${p.surc}): ${h.n} of ${h.mx} units ${when}.` : `Limit reached for ${h.c} (${p.name.toLowerCase()}, ${p.surc}): ${h.n} of ${h.mx} units ${when}.`; }
  let premQ = [];
  function premPop(hits) {
    const d = $('#premDlg'); premQ = (d.open ? premQ : []).concat(hits);
    const over = premQ.some(h => h.n > h.mx);
    $('#premT').textContent = over ? 'Time-premium limit exceeded' : 'Time-premium limit reached';
    $('#premList').innerHTML = premQ.map(h => `<li class="${h.n > h.mx ? 'over' : 'full'}">${esc(premLine(h))}</li>`).join('');
    $('#premWhy').textContent = `Alberta Health pays HSC 03.01AA (after-hours time premium) up to ${[...new Set(premQ.map(h => `${h.mx} ${h.c}`))].join(', ')} units per day per physician${premQ.some(h => premMine(h.c)) ? ' (a limit marked * is set by you)' : ''}, and no more than 4 units per hour. Counted from the units you entered on the modifiers (EV, NTPM, NTAM and WK count toward TEV, TNTP, TNTA and TWK / TST / TDES). Nothing was blocked: check the units and claim only direct patient-care time.`;
    $('#premSrc').textContent = 'Source: ' + R.PREM_SRC + '.';
    if (!d.open) d.showModal();
    V.appendAudit({ action: 'premium-limit', note: premQ.map(premLine).join(' ') }).catch(() => {});
  }
  $('#premOk').onclick = () => { $('#premDlg').close(); premQ = []; };
  $('#premSet').onclick = () => { $('#premDlg').close(); premQ = []; $('#tabs [data-tab="data"]').click(); setTimeout(() => { const c = $('#premCard'); if (c) c.scrollIntoView({ block: 'start' }); }, 50); };
  $('#premDlg').addEventListener('close', () => { premQ = []; });
  $('#premStrip').addEventListener('click', () => {   // details for the day shown
    if (!S) return; const d = curDay(), cnt = premFor([d]);
    $('#premT').textContent = `After-hours time premium · ${R.fmtDay(d)}`; premQ = [];
    $('#premList').innerHTML = R.premDayCodes(d).map(c => { const n = cnt.get(d + '|' + c) || 0, mx = premMax(c); return `<li class="${premLvl(n, mx)}"><b>${c}</b> ${esc(R.PREM[c].name)} · ${esc(R.PREM[c].when)} · <b>${n}</b> of ${mx} units${premMine(c) ? ' (limit set by you)' : ''}</li>`; }).join('');
    const tc = premTime(d); $('#premList').insertAdjacentHTML('beforeend', `<li class="muted">Logged time in these windows: ${R.premDayCodes(d).map(c => `${c} ${tc.get(d + '|' + c) || 0} u`).join(' · ')}</li>`);
    $('#premWhy').textContent = `Units entered on Modifier code 1 / 2 (01–20 per modifier per row), per day. Daily maximums for HSC 03.01AA per physician; also no more than 4 units per hour. ${R.holidayName(d) ? R.holidayName(d) + ': daytime is billed with ' + R.premDayCodes(d)[1] + '. ' : ''}A pop-up appears when a day reaches a limit; entry is never blocked.`;
    $('#premSrc').textContent = 'Source: ' + R.PREM_SRC + '.';
    $('#premDlg').showModal();
  });
  function premSetUi() {
    if (!S || !$('#premRows')) return; const st = S.settings; $('#premWarn').checked = st.premWarn !== false;
    $('#premRows').innerHTML = Object.keys(R.PREM).map(c => { const p = R.PREM[c], o = premOver(c);
      return `<tr><td><b>${c}</b><br><span class="muted">${p.surc}</span></td><td>${esc(p.when)}</td><td>${p.max}</td><td><input type="number" min="1" max="96" step="1" inputmode="numeric" data-pmax="${c}" value="${o != null ? o : ''}" placeholder="${p.max}" aria-label="Your limit for ${c} (blank = official ${p.max})">${premMine(c) ? '<small class="mine">set by you</small>' : ''}</td></tr>`; }).join('');
    $('#premSrcS').textContent = 'Official maximums: ' + R.PREM_SRC + '. Leave “Your limit” blank to use the official number.';
    $$('#premRows [data-pmax]').forEach(i => i.onchange = async () => {
      const c = i.dataset.pmax, v = i.value.trim(), m = Object.assign({}, st.premMax || {});
      if (v === '' || !(+v > 0)) delete m[c]; else m[c] = Math.min(96, Math.floor(+v));
      st.premMax = m; await saveSettings(); await V.appendAudit({ action: 'settings', note: `Time-premium limit for ${c}: ${m[c] ? m[c] + ' (set by you)' : 'official ' + R.PREM[c].max}` });
      premBase = null; premSetUi(); render();
    });
  }
  $('#premWarn').onchange = async () => { S.settings.premWarn = $('#premWarn').checked; await saveSettings(); };
  // ---- 4. week strip with daily totals + Today / This week
  const wsOff = { today: 0, hist: 0 };
  const wkRange = (f, t) => { const o = { month: 'short', day: 'numeric' }, a = new Date(f + 'T12:00'), b = new Date(t + 'T12:00'); return a.getMonth() === b.getMonth() ? `${a.toLocaleDateString(undefined, o)}–${b.getDate()}` : `${a.toLocaleDateString(undefined, o)}–${b.toLocaleDateString(undefined, o)}`; };
  function renderStrip(which) {
    const box = which === 'today' ? $('#todayTotals') : $('#wsHist'); if (!S || !box) return;
    const td = today(), base = new Date(td + 'T12:00'); base.setDate(base.getDate() - ((base.getDay() + 6) % 7) + 7 * wsOff[which]);
    const days = [...Array(7)].map((_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return R.dayKey(d.getTime()); });
    const byd = R.byDay(S.encs.filter(e => { const k = R.encDay(e); return k >= days[0] && k <= days[6]; }));
    const sum = t => ({ m: t.H.m + t.C.m + t.cb.m, u: t.H.u + t.C.u + t.cb.u });
    const tw = sum(R.totals(days.flatMap(k => byd.get(k) || []))), ttl = R.totals(S.encs.filter(e => R.encDay(e) === td)), tt = sum(ttl), rv = S.settings.reviews || {};
    const cells = days.map((k, i) => { const l = byd.get(k) || [], t = sum(R.totals(l)), hol = R.holidayName(k), d = +k.slice(8);
      return `<button type="button" class="wd${k === td ? ' today' : ''}${l.length ? '' : ' empty'}${hol ? ' hol' : ''}${i > 4 ? ' we' : ''}" data-day="${k}" title="${esc(R.fmtDay(k) + (hol ? ' · ' + hol : ''))}" aria-label="${esc(R.fmtDay(k))}: ${t.m} minutes, ${t.u} units"><span class="wn">${'MTWTFSS'[i]}${d}</span><b>${t.m ? t.m + 'm' : '–'}</b><small>${t.m ? t.u + 'u' : ''}${rv[k] ? ' ✓' : ''}</small></button>`; }).join('');
    const lbl = wsOff[which] === 0 ? 'This week' : 'Week';
    box.innerHTML = `<div class="wsh"><button type="button" class="wsnav" data-nav="-1" aria-label="Previous week">‹</button><span class="wsl">${esc(wkRange(days[0], days[6]))}</span><button type="button" class="wsnav" data-nav="1" aria-label="Next week">›</button><span class="wst"><button type="button" class="wstoday${wsOff[which] ? ' off' : ''}" data-today="1" title="Back to today and the current week" aria-label="Today: go back to today and the current week">Today</button> ${tt.m}m·${tt.u}u <b>${lbl}</b> ${tw.m}m·${tw.u}u</span></div><div class="wdays">${cells}</div>` +
      (which === 'today' ? `<div class="wsx">H ${ttl.H.m} min · ${ttl.H.n} enc · ${ttl.H.u} u <span>|</span> C ${ttl.C.m} min · ${ttl.C.n} enc · ${ttl.C.u} u${ttl.cb.n ? ` <span>|</span> CB ${ttl.cb.n} · ${ttl.cb.m} min` : ''}${ttl.perList.length ? `<br>${ttl.perList.map(p => `${esc(R.PBY[p.id].short)} ${p.m}m/${p.u}u`).join(' · ')}` : ''}</div>` : '');
    box.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => { wsOff[which] += +b.dataset.nav; renderStrip(which); });
    box.querySelectorAll('[data-day]').forEach(b => b.onclick = () => goDay(b.dataset.day));
    box.querySelector('[data-today]').onclick = () => goToday(which);
    if (!box.dataset.sw) { box.dataset.sw = '1'; let x0 = null; box.addEventListener('touchstart', ev => { x0 = ev.touches[0].clientX; }, { passive: true }); box.addEventListener('touchend', ev => { if (x0 == null) return; const dx = ev.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { wsOff[which] += dx < 0 ? 1 : -1; renderStrip(which); } }, { passive: true }); }
  }
  // scroll a History day into view just below the sticky bars (header, period bar, tabs and, on wide screens, the column header)
  function scrollToDay(el) {
    let below = $('#tabs').getBoundingClientRect().bottom; const hd = el.querySelector('thead th') || el.querySelector('.erowh');
    if (hd && getComputedStyle(hd).position === 'sticky') below += hd.offsetHeight;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - below - 4), behavior: 'auto' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
  }
  function goDay(k) {
    if (!S.encs.some(e => R.encDay(e) === k)) return toast(`No entries on ${R.fmtDay(k)}`);
    tab = 'history'; showTab(); histDay(k); const el = document.getElementById('d-' + k); if (el) scrollToDay(el);
  }
  // "Today" in the week strip: back to the current week and today's date, from wherever you navigated
  function goToday(which) {
    wsOff[which] = 0; renderStrip(which);
    if (which === 'today') { window.scrollTo({ top: 0, behavior: 'auto' }); return; }
    const td = today(), el = document.getElementById('d-' + td);
    if (el) scrollToDay(el); else { window.scrollTo({ top: 0, behavior: 'auto' }); toast(`No entries yet today (${R.fmtDay(td)})`); }
  }
  // ---- 2. track again + favourite code sets: copies setting, facility, fee codes and ICD-9 only (never label, initials, chart, notes or photos)
  const comboOf = e => ({ set: e.setting || e.set || 'H', fac: e.facility || e.fac ? (f => ({ n: f.n, z: f.z || '', set: f.set, custom: !!f.custom }))(e.facility || e.fac) : null, codes: (e.codes || []).map(c => ({ j: c.j, c: c.c, d: c.d, f: c.f, k: c.k, dx: c.dx, dxd: c.dxd })) });
  const comboKey = c => [c.set, c.fac ? c.fac.n : '', c.codes.map(x => x.c + '|' + (x.dx || '')).join(',')].join('#');
  const comboLbl = c => { const f = c.codes[0]; return f ? f.c + (f.dx ? ' · ' + f.dx : '') + (c.codes.length > 1 ? ` +${c.codes.length - 1}` : '') : '(no code)'; };
  function suggestions() {
    const favs = (S.settings.favSets || []).map(f => ({ fav: true, c: f })), fk = new Set(favs.map(f => comboKey(f.c))), since = Date.now() - 60 * 86400000, m = new Map();
    for (const e of S.encs) { if (kindOf(e) !== 'enc' || !(e.codes || []).length || R.startOf(e) < since) continue; const c = comboOf(e), k = comboKey(c); if (fk.has(k)) continue; const x = m.get(k) || { n: 0, last: 0, c }; x.n++; x.last = Math.max(x.last, R.startOf(e)); m.set(k, x); }
    const rec = [...m.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, Math.max(2, 6 - favs.length)).map(x => ({ fav: false, c: x.c }));
    return favs.concat(rec).slice(0, 8);
  }
  function renderTrackAgain() {
    const box = $('#trackAgain'), list = suggestions(); box.hidden = !list.length; if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<span class="tal">Track again</span>` + list.map((x, i) => `<span class="tchip${x.fav ? ' fav' : ''}"><button type="button" class="tgo" data-i="${i}" title="Start a timer with ${esc(x.c.codes.map(c => c.c + (c.dx ? ' (' + c.dx + ')' : '')).join(', '))}${x.c.fac ? ' at ' + esc(x.c.fac.n) : ''}">${esc(comboLbl(x.c))}<small>${x.c.set}</small></button><button type="button" class="tstar" data-i="${i}" aria-label="${x.fav ? 'Remove from' : 'Save to'} favourite code sets">${x.fav ? '★' : '☆'}</button></span>`).join('');
    box.querySelectorAll('.tgo').forEach(b => b.onclick = () => startFrom(list[+b.dataset.i].c));
    box.querySelectorAll('.tstar').forEach(b => b.onclick = () => toggleFav(list[+b.dataset.i].c));
  }
  async function startFrom(c) {
    const now = Date.now(), n = S.encs.filter(x => R.encDay(x) === today() && kindOf(x) === 'enc').length + 1, sh = activeShift();
    const qn = ($('#qName') && $('#qName').value || '').trim(), qm = ($('#qMrn') && $('#qMrn').value || '').trim();
    const e = { id: uid(), kind: 'enc', name: qn, mrn: qm, chart: qm, billingNote: '', label: (!qn && !qm) ? `Encounter ${n}` : '', initials: '', setting: c.set || 'H', facility: c.fac || (sh ? sh.facility : S.settings.curFac) || null, type: '', codes: clone(c.codes), notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    const cn = carryFac(e, today());   // v9o
    await saveEnc(e, 'create', ['Started from a code set (track again)', cn].filter(Boolean).join('. ')); if ($('#qName')) $('#qName').value = ''; if ($('#qMrn')) $('#qMrn').value = ''; tab = 'today'; showTab(); render(); toast(`Started · ${comboLbl(c)}`);
  }
  async function toggleFav(c) {
    const k = comboKey(c), l = S.settings.favSets || [], i = l.findIndex(f => comboKey(f) === k), txt = c.codes.map(x => x.c + (x.dx ? ' (' + x.dx + ')' : '')).join(', ');
    if (i >= 0) l.splice(i, 1); else l.unshift(Object.assign({ id: uid() }, clone(c)));
    S.settings.favSets = l.slice(0, 12); await saveSettings();
    await V.appendAudit({ action: i >= 0 ? 'fav-remove' : 'fav-add', note: `${i >= 0 ? 'Removed' : 'Saved'} favourite code set: ${txt} · ${R.SET[c.set] || ''}${c.fac ? ' · ' + c.fac.n : ''}` });
    render(); syncFavBtn(); toast(i >= 0 ? 'Code set removed from favourites' : 'Code set saved to favourites');
  }
  function formCombo() { return comboOf({ setting: cur.kind === 'enc' ? $('#eSetting').value : $('#eSetting2').value, facility: eFac, codes: cur.codes }); }
  function syncFavBtn() { if (!cur) return; const c = formCombo(), on = (S.settings.favSets || []).some(f => comboKey(f) === comboKey(c)); $('#eFavSet').textContent = on ? '★ Saved code set' : '☆ Save code set'; $('#eFavSet').disabled = !c.codes.length; $('#eRepeat').disabled = !c.codes.length && !eFac; }
  $('#eRepeat').onclick = async () => { if (!cur) return; const c = formCombo(); await closeEdit(false); await startFrom(c); };
  $('#eFavSet').onclick = () => { if (cur && cur.codes.length) toggleFav(formCombo()); };
  $('#eCodes').addEventListener('click', () => setTimeout(syncFavBtn, 0)); $('#eCodeRes').addEventListener('click', () => setTimeout(syncFavBtn, 0));
  // ---- 7. gap-free entry: Last stop, ±5 nudges, +15 / +30
  function lastStop() { const now = Date.now(); let best = 0; for (const e of S.encs) { if (cur && e.id === cur.id) continue; if (kindOf(e) === 'shift') continue; for (const s of e.segs) if (s.e != null && s.e <= now && s.e > best && R.dayKey(s.e) === today()) best = s.e; } return best || null; }
  function nudge(b, rows) {
    const now = Date.now(), clamp = t => Math.min(t, now);
    if (b.dataset.nudge === 's') { const i = rows[0].querySelector('.ss'), t = parseLocal(i.value); if (t) i.value = dtLocal(clamp(t + (+b.dataset.d) * 60000)); }
    else { const r = rows[rows.length - 1], se = r.querySelector('.se'), ss = parseLocal(r.querySelector('.ss').value), t = parseLocal(se.value);
      if (b.dataset.dur) { const base = t || ss; if (base) se.value = dtLocal(clamp(base + (+b.dataset.dur) * 60000)); }
      else if (t) se.value = dtLocal(clamp(t + (+b.dataset.d) * 60000)); else return toast('Set an end time first'); }
    overlapOk = false; $('#eWarn').hidden = true; $('#eSave').textContent = 'Save'; sumSegs(); if (cur.kind === 'cb') { syncCalled(); renderLinks(); }
  }
  // ---- 5. day / week review checklist; the mark clears on any later change (audit-logged both ways)
  async function reviewTouch(list, why) {
    const rv = S.settings.reviews || {}, days = [...new Set(list.filter(Boolean).map(x => R.encDay(x)))].filter(d => rv[d]);
    if (!days.length) return;
    S.settings.revEdited = S.settings.revEdited || {}; for (const d of days) { delete rv[d]; S.settings.revEdited[d] = Date.now(); }
    S.settings.reviews = rv; await saveSettings();
    await V.appendAudit({ action: 'unreview', note: `Review mark cleared for ${days.join(', ')}: ${why}.`, after: { days } });
  }
  let rvRange = null;
  function openReview(from, to) { rvRange = [from, to]; renderReview(); $('#revDlg').showModal(); }
  function reviewIssues(list) {
    const out = [], encs = list.filter(e => kindOf(e) !== 'shift');
    for (const e of list) {
      const k = kindOf(e);
      if (k === 'shift' && e.status !== 'done') out.push({ lvl: 'block', e, t: 'No departure recorded' });
      if (k !== 'shift' && e.status === 'run') out.push({ lvl: 'block', e, t: 'Timer still running' });
      if (k !== 'shift' && e.status === 'pause') out.push({ lvl: 'block', e, t: 'Paused, not stopped' });
      if (k !== 'shift' && !(e.segs || []).length) out.push({ lvl: 'block', e, t: 'Not started: no In time' });
      if (k !== 'shift' && !(e.codes || []).length) out.push({ lvl: 'warn', e, t: 'No fee code' });
      if (k !== 'shift' && !R.dxList(e).length) out.push({ lvl: 'warn', e, t: 'No diagnostic code' });
      else if (k !== 'shift' && (e.codes || []).length > 1 && e.codes.some(c => !c.dx) && !e.dx) out.push({ lvl: 'warn', e, t: 'A fee code has no diagnostic code' });
      if (e.late) out.push({ lvl: 'info', e, t: 'Entered later' });
    }
    for (let i = 0; i < encs.length; i++) for (let j = i + 1; j < encs.length; j++) { const a = encs[i], b = encs[j]; if (kindOf(a) === kindOf(b) && ovl(a.segs, b.segs)) out.push({ lvl: 'warn', e: b, t: `Overlaps ${a.label || R.KIND[kindOf(a)]} ${R.hm(R.startOf(a))}` }); }
    // one row per entry: its most serious level, all its issues listed
    const L = ['block', 'warn', 'info'], by = new Map();
    for (const x of out) { const g = by.get(x.e.id); if (!g) by.set(x.e.id, { lvl: x.lvl, e: x.e, t: [x.t] }); else { g.t.push(x.t); if (L.indexOf(x.lvl) < L.indexOf(g.lvl)) g.lvl = x.lvl; } }
    return [...by.values()].map(g => ({ lvl: g.lvl, e: g.e, t: g.t.join(' · ') })).sort((x, y) => L.indexOf(x.lvl) - L.indexOf(y.lvl) || R.startOf(x.e) - R.startOf(y.e));
  }
  function renderReview() {
    if (!S || !rvRange) return; const [from, to] = rvRange, list = R.select(S.encs, from, to), iss = reviewIssues(list), rv = S.settings.reviews || {};
    const days = [...new Set(list.map(e => R.encDay(e)))], nb = iss.filter(x => x.lvl === 'block').length, nw = iss.filter(x => x.lvl === 'warn').length;
    $('#rvTitle').textContent = from === to ? `Review ${R.fmtDay(from)}` : `Review week ${R.fmtDay(from)} – ${R.fmtDay(to)}`;
    $('#rvSub').textContent = `${list.length} entr${list.length === 1 ? 'y' : 'ies'} on ${days.length} day${days.length === 1 ? '' : 's'}. Tap an item to fix it.`;
    $('#rvList').innerHTML = !list.length ? '<p class="small muted">No entries in this period.</p>' : iss.length ? iss.map((x, i) => `<button type="button" class="rvrow ${x.lvl}" data-i="${i}"><span class="rvt">${x.lvl === 'block' ? 'Fix' : x.lvl === 'warn' ? 'Check' : 'Info'}</span><span class="rvw">${esc(R.encDay(x.e).slice(5))} ${R.hm(R.startOf(x.e))} · ${esc(kindOf(x.e) === 'shift' ? (x.e.facility ? x.e.facility.n : 'On site') : x.e.label || R.KIND[kindOf(x.e)])}</span><span class="rvi">${esc(x.t)}</span></button>`).join('') : '<p class="small ok">✓ Nothing to fix: no running timers, missing codes, overlaps or missing departures.</p>';
    $$('#rvList .rvrow').forEach(b => b.onclick = () => openEdit(iss[+b.dataset.i].e, false, { edit: true }));
    const all = days.length && days.every(d => rv[d]);
    $('#rvState').textContent = all ? `✎ Reviewed ${new Date(Math.max(...days.map(d => rv[d].at))).toLocaleString()}. Any change to these entries removes the mark.` : nb ? 'Stop running timers and record departures before marking this reviewed.' : '';
    const b = $('#rvMark'); b.disabled = !list.length || nb > 0 || all; b.textContent = all ? 'Reviewed' : nw ? `Mark reviewed (${nw} flagged)` : 'Mark reviewed';
  }
  $('#rvClose').onclick = () => $('#revDlg').close();
  $('#rvMark').onclick = async () => {
    const [from, to] = rvRange, list = R.select(S.encs, from, to), iss = reviewIssues(list); if (!list.length || iss.some(x => x.lvl === 'block')) return;
    const nw = iss.filter(x => x.lvl === 'warn').length, days = [...new Set(list.map(e => R.encDay(e)))], at = Date.now();
    S.settings.reviews = S.settings.reviews || {}; S.settings.revEdited = S.settings.revEdited || {};
    for (const d of days) { S.settings.reviews[d] = { at, n: list.filter(e => R.encDay(e) === d).length, w: nw }; delete S.settings.revEdited[d]; }
    await saveSettings();
    await V.appendAudit({ action: 'review', note: `Marked reviewed: ${from === to ? from : from + ' to ' + to} (${list.length} entries${nw ? `, ${nw} item(s) checked and accepted` : ''}).`, after: { days, ids: list.map(e => e.id) } });
    render(); renderReview(); toast('Marked reviewed');
  };
  $('#rvToday').onclick = () => openReview(curDay(), curDay());
  // ---- 9. day timeline: blocks between arrival and departure
  let tlDay = null; const PX = 1.1;
  function openTimeline(k) { tlDay = k; renderTimeline(); $('#tlDlg').showModal(); }
  function renderTimeline() {
    if (!S || !tlDay) return; const k = tlDay, now = Date.now(), list = S.encs.filter(e => R.encDay(e) === k);
    $('#tlTitle').textContent = R.fmtDay(k);
    const segs = []; list.forEach(e => e.segs.forEach((s, i) => segs.push({ e, s: s.s, en: s.e == null ? now : s.e, first: i === 0 })));
    const d0 = new Date(k + 'T00:00').getTime(); let t0 = segs.length ? Math.min(...segs.map(x => x.s)) : d0 + 8 * 3600000, t1 = segs.length ? Math.max(...segs.map(x => x.en)) : d0 + 17 * 3600000;
    t0 = Math.floor(t0 / 3600000) * 3600000; t1 = Math.max(t0 + 3 * 3600000, Math.ceil(t1 / 3600000) * 3600000);
    const y = t => ((t - t0) / 60000) * PX, H = y(t1);
    let h = '';
    for (let t = t0; t <= t1; t += 3600000) h += `<div class="tlh" data-css="top:${y(t).toFixed(1)}px"><span>${R.hm(t)}</span></div>`;
    for (const x of segs.filter(x => kindOf(x.e) === 'shift')) h += `<div class="tlsite" data-css="top:${y(x.s).toFixed(1)}px;height:${Math.max(2, y(x.en) - y(x.s)).toFixed(1)}px" title="On site ${R.hm(x.s)}–${R.hm(x.en)}"></div>`;
    const blocks = segs.filter(x => kindOf(x.e) !== 'shift').sort((a, b) => a.s - b.s);
    // lanes per cluster of overlapping blocks, so a busy hour doesn't squeeze the rest of the day
    let cl = [], clEnd = -1; const flush = () => { const lanes = []; for (const b of cl) { let i = lanes.findIndex(end => end <= b.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = b.en; b.lane = i; } cl.forEach(b => { b.n = lanes.length; }); cl = []; };
    for (const b of blocks) { if (cl.length && b.s >= clEnd) flush(); cl.push(b); clEnd = Math.max(clEnd, b.en); } flush();
    for (const b of blocks) { const e = b.e, kk = kindOf(e), top = y(b.s), ht = Math.max(14, y(b.en) - top), n = b.n;
      h += `<button type="button" class="tlb ${kk === 'cb' ? 'cb' : e.setting === 'C' ? 'C' : 'H'}${e.status !== 'done' ? ' live' : ''}" data-id="${esc(e.id)}" data-css="top:${top.toFixed(1)}px;height:${ht.toFixed(1)}px;left:calc(56px + (100% - 60px) * ${b.lane} / ${n});width:calc((100% - 60px) / ${n} - 3px)" title="${esc((e.label || R.KIND[kk]) + ' ' + R.hm(b.s) + '–' + R.hm(b.en))}">${b.first ? `<b>${R.hm(b.s)}</b> ${esc(e.label || R.KIND[kk])}${(e.codes || []).length ? ' · ' + esc(e.codes[0].c) : ''}` : ''}</button>`; }
    $('#tlBody').innerHTML = `<div class="tlgrid" data-css="height:${(H + 8).toFixed(0)}px" data-t0="${t0}">${h}</div>` + (segs.length ? '' : '<p class="small muted">No entries on this day. Tap the grid to add one.</p>');
    $$('#tlBody [data-css]').forEach(el => { el.style.cssText = el.dataset.css; });   // CSSOM (CSP forbids inline style attributes)
    $$('#tlBody .tlb').forEach(b => b.onclick = ev => { ev.stopPropagation(); const e = S.encs.find(x => x.id === b.dataset.id); if (e) openEdit(e); });
    $('#tlBody .tlgrid').onclick = ev => {
      const g = ev.currentTarget, r = g.getBoundingClientRect(), t = t0 + Math.round(((ev.clientY - r.top) / PX) / 5) * 5 * 60000;
      if (t > Date.now() - 60000) return toast('That time is in the future');
      const e = blank('enc', t, Math.min(Date.now(), t + 15 * 60000)); e.late = true; e.status = 'done'; openEdit(e, true);
    };
  }
  $('#tlPrev').onclick = () => { tlDay = shiftDay(tlDay, -1); renderTimeline(); };
  $('#tlNext').onclick = () => { tlDay = shiftDay(tlDay, 1); renderTimeline(); };
  $('#tlClose').onclick = () => $('#tlDlg').close();
  $('#tlToday').onclick = () => openTimeline(curDay());
  // ---- time periods and holidays in Settings (per user; verify against the current SOMB)
  function renderPeriodSettings() {
    if (!S) return; const C = R.PERIOD_CFG, y = new Date().getFullYear(), td = today(), off = new Set(S.settings.holOff || []);
    const PC = { wd_night: 'TNTA', wd_eve: 'TEV', wd_late: 'TNTP', we_night: 'TNTA', we_day: 'TWK / TST / TDES', we_late: 'TNTP' };
    const tr = (lbl, ps) => `<tr><th colspan="3">${lbl}</th></tr>` + ps.map(p => `<tr><td>${esc(p.name)}</td><td>${R.pHours(p)}</td><td>${p.regular ? 'no premium units' : `${PC[p.id]} · ${p.units} units`}</td></tr>`).join('');
    $('#perTable').innerHTML = `<table>${tr('Weekdays (Mon–Fri)', C.weekday)}${tr('Weekends and statutory holidays', C.weekend)}</table><p class="small muted">${esc(C.note)} Units = 15-minute blocks in each period. Encounters crossing a boundary are split by period. No fee codes are attached to periods.</p>`;
    const builtin = R.holidaysOf(y).find(h => h.date === td);
    $('#holToday').checked = (S.settings.holExtra || []).includes(td);
    $('#holTodayL').textContent = `Today (${R.fmtDay(td)}) is a statutory holiday (bill like a weekend)`;
    $('#holInfo').textContent = (builtin ? (off.has(builtin.id) ? `Today is ${builtin.name}, but you switched it off below. ` : `Today is ${builtin.name} (built in), already billed like a weekend. `) : '') + ((S.settings.holExtra || []).length ? `Days you marked: ${S.settings.holExtra.slice(-6).join(', ')}.` : '');
    $('#holYear').textContent = `${y}–${y + 1}`;
    const hl = R.holidaysOf(y).concat(R.holidaysOf(y + 1));
    $('#holList').innerHTML = hl.map(h => `<label class="chk small${h.des ? ' des' : ''}"><input type="checkbox" data-hol="${h.id}"${off.has(h.id) ? '' : ' checked'}> <b>${esc(h.name)}</b> · ${esc(R.fmtDay(h.date))} <span class="muted">(${esc(h.rule)}${h.des ? (h.seen ? '; listed in a published table' : '; expected, confirm with Alberta Health') : ''})</span></label>`).join('');
    $$('#holList [data-hol]').forEach(i => i.onchange = async () => {
      const s2 = new Set(S.settings.holOff || []), h = hl.find(x => x.id === i.dataset.hol); i.checked ? s2.delete(h.id) : s2.add(h.id); S.settings.holOff = [...s2];
      await holChanged(`${h.name} ${i.checked ? 'switched on' : 'switched off'} (billed ${i.checked ? 'like a weekend' : 'as a regular day'})`);
    });
  }
  async function holChanged(note) { R.setHolidays({ off: S.settings.holOff, extra: S.settings.holExtra }); await saveSettings(); await V.appendAudit({ action: 'holiday', note }); renderPeriodSettings(); render(); }
  $('#holToday').onchange = async () => {
    const td = today(), s2 = new Set(S.settings.holExtra || []); $('#holToday').checked ? s2.add(td) : s2.delete(td); S.settings.holExtra = [...s2].sort();
    await holChanged(`${td} ${$('#holToday').checked ? 'marked as a statutory holiday' : 'no longer marked as a holiday'}`);
  };
  // ------------------------------------------------------------ boot
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  loadProvs().then(() => showLock(pickLockMsg()));
  window.BLApp = { lockNow };
})();
