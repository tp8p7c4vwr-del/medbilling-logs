/* Med Billing Logs - encrypted local vault.
   All encounter data, settings and photos are stored in IndexedDB encrypted with AES-GCM (256-bit).
   The key is derived from the passcode with PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt)
   and kept only in memory while unlocked (non-extractable CryptoKey). The passcode is never stored.
   A small "check" record (known text encrypted with the key) verifies the passcode on unlock. */
(function (global) {
  'use strict';
  const DB = 'bl-vault', VER = 2, ITER = 600000, CHECK = 'med-billing-logs:ok';
  const te = new TextEncoder(), td = new TextDecoder();
  let db = null, key = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['meta', 'enc', 'photo', 'audit']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (store, mode, fn) => open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  const get = (store, id) => tx(store, 'readonly', s => s.get(id));
  const all = (store) => tx(store, 'readonly', s => s.getAll());
  const put = (store, v) => tx(store, 'readwrite', s => s.put(v));
  const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));
  async function derive(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encBytes(k, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes); return { iv, ct }; }
  async function decBytes(k, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: o.iv }, k, o.ct)); }
  const encJSON = (k, obj) => encBytes(k, te.encode(JSON.stringify(obj)));
  const decJSON = async (k, o) => JSON.parse(td.decode(await decBytes(k, o)));
  async function exists() { return !!(await get('meta', 'vault')); }
  async function create(pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), k = await derive(pass, salt, ITER);
    await put('meta', { id: 'vault', salt, iter: ITER, check: await encBytes(k, te.encode(CHECK)), created: Date.now() });
    key = k; return true;
  }
  async function verify(pass) {
    const m = await get('meta', 'vault'); if (!m) return null;
    const k = await derive(pass, m.salt, m.iter);
    try { const t = td.decode(await decBytes(k, m.check)); return t === CHECK ? k : null; } catch (e) { return null; }
  }
  async function unlock(pass) { const k = await verify(pass); if (!k) return false; key = k; return true; }
  function lock() { key = null; }
  const unlocked = () => !!key;
  function need() { if (!key) throw new Error('locked'); return key; }
  // encounters
  async function loadAll() { const k = need(); const rows = await all('enc'); const out = []; for (const r of rows) { try { out.push(await decJSON(k, r)); } catch (e) { console.warn('skip record', r.id); } } return out; }
  async function save(e) { const k = need(); const o = await encJSON(k, e); return put('enc', { id: e.id, iv: o.iv, ct: o.ct }); }
  const remove = id => del('enc', id);
  // settings (encrypted)
  async function loadSettings() { const k = need(); const r = await get('meta', 'settings'); return r ? decJSON(k, r) : {}; }
  async function saveSettings(s) { const k = need(); const o = await encJSON(k, s); return put('meta', { id: 'settings', iv: o.iv, ct: o.ct }); }
  // unsaved entry draft (encrypted): kept when the app locks with the entry dialog open (e.g. after opening Fee Desk), restored on unlock
  function saveDraft(d) { const k = need(); return encJSON(k, d).then(o => put('meta', { id: 'draft', iv: o.iv, ct: o.ct })); }
  async function loadDraft() { const k = need(); const r = await get('meta', 'draft'); if (!r) return null; try { return await decJSON(k, r); } catch (e) { return null; } }
  const clearDraft = () => del('meta', 'draft');
  // photos (encrypted JPEG bytes)
  async function savePhoto(id, eid, bytes, meta) { const k = need(); const o = await encBytes(k, bytes); const mo = await encJSON(k, meta || {}); return put('photo', { id, eid, iv: o.iv, ct: o.ct, miv: mo.iv, mct: mo.ct }); }
  async function loadPhoto(id) { const k = need(); const r = await get('photo', id); if (!r) return null; return decBytes(k, r); }
  const removePhoto = id => del('photo', id);
  async function photoIds() { const rows = await all('photo'); return rows.map(r => ({ id: r.id, eid: r.eid })); }
  // append-only audit log, hash-chained (SHA-256 over the record incl. previous hash), stored encrypted.
  const canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => (a[x] = v[x], a), {}) : v);
  async function sha(str) { const h = await crypto.subtle.digest('SHA-256', te.encode(str)); return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''); }
  let auditQ = Promise.resolve();
  function appendAudit(entry) { // entry: {action, eid, kind, before, after, note}
    const run = async () => {
      const k = need(); const headRec = await get('meta', 'auditHead'); const head = headRec ? await decJSON(k, headRec) : { seq: 0, hash: '0'.repeat(64) };
      const rec = Object.assign({ seq: head.seq + 1, ts: Date.now(), prev: head.hash }, entry);
      rec.hash = await sha(canon(rec));
      const o = await encJSON(k, rec), ho = await encJSON(k, { seq: rec.seq, hash: rec.hash });
      await open();
      await new Promise((res, rej) => { const t = db.transaction(['audit', 'meta'], 'readwrite'); t.objectStore('audit').put({ id: String(rec.seq).padStart(10, '0'), iv: o.iv, ct: o.ct }); t.objectStore('meta').put({ id: 'auditHead', iv: ho.iv, ct: ho.ct }); t.oncomplete = res; t.onerror = () => rej(t.error); });
      return rec;
    };
    const p = auditQ.then(run, run); auditQ = p.catch(() => {}); return p;
  }
  async function loadAudit() { const k = need(); const rows = (await all('audit')).sort((a, b) => a.id < b.id ? -1 : 1); const out = []; for (const r of rows) { try { out.push(await decJSON(k, r)); } catch (e) { out.push({ seq: +r.id, broken: true }); } } return out; }
  async function verifyAudit() {
    const k = need(); const recs = await loadAudit(); const hr = await get('meta', 'auditHead'); const head = hr ? await decJSON(k, hr).catch(() => null) : null;
    const br = await get('meta', 'auditBase'); const base = br ? await decJSON(k, br).catch(() => null) : { seq: 0, hash: '0'.repeat(64) };
    let prev = base ? base.hash : '0'.repeat(64), problems = []; const b0 = base ? base.seq : 0;
    if (!base) problems.push('retention checkpoint cannot be decrypted (altered)');
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.broken) { problems.push(`record ${r.seq} cannot be decrypted (altered)`); continue; }
      if (r.seq !== b0 + i + 1) problems.push(`record ${b0 + i + 1} missing or out of order (found ${r.seq})`);
      if (r.prev !== prev) problems.push(`record ${r.seq}: previous-hash link broken`);
      const { hash, ...body } = r; if (await sha(canon(body)) !== hash) problems.push(`record ${r.seq}: contents do not match its hash`);
      prev = r.hash;
    }
    if (recs.length && !head) problems.push('log head record missing');
    if (head && (head.seq !== b0 + recs.length || head.hash !== prev)) problems.push(`log truncated or extended: head says ${head.seq} records, found ${b0 + recs.length}`);
    return { ok: !problems.length, count: recs.length, base: b0, last: recs.length ? recs[recs.length - 1].hash : null, problems };
  }
  // retention: drop audit records older than cutoff (only a contiguous run from the start), keeping a checkpoint
  async function pruneAudit(eligible, label) { // eligible(rec) -> true when the record is past its retention period
    const k = need(); const recs = await loadAudit(); let n = 0, last = null;
    for (const r of recs) { if (r.broken || !eligible(r)) break; last = r; n++; }
    if (!n) return 0;
    const bo = await encJSON(k, { seq: last.seq, hash: last.hash, at: Date.now() });
    await open();
    await new Promise((res, rej) => { const t = db.transaction(['audit', 'meta'], 'readwrite'); for (let i = 0; i < n; i++) t.objectStore('audit').delete(String(recs[i].seq).padStart(10, '0')); t.objectStore('meta').put({ id: 'auditBase', iv: bo.iv, ct: bo.ct }); t.oncomplete = res; t.onerror = () => rej(t.error); });
    await appendAudit({ action: 'prune-log', note: `Removed ${n} audit records (#1-#${last.seq} range start, up to ${new Date(last.ts).toISOString().slice(0, 10)}) past their retention period after user confirmation${label ? ' (' + label + ')' : ''}. Chain continues from checkpoint #${last.seq}.` });
    return n;
  }
  // change passcode: re-encrypt everything with a new salt/key
  async function rekey(oldPass, newPass) {
    const k0 = await verify(oldPass); if (!k0) return false;
    const encs = await all('enc'), photos = await all('photo'), st = await get('meta', 'settings'), aud = await all('audit'), ah = await get('meta', 'auditHead'), ab = await get('meta', 'auditBase');
    const salt = crypto.getRandomValues(new Uint8Array(16)), k1 = await derive(newPass, salt, ITER);
    const re = async o => { const b = await decBytes(k0, o); return encBytes(k1, b); };
    const nEnc = []; for (const r of encs) { const o = await re(r); nEnc.push({ id: r.id, iv: o.iv, ct: o.ct }); }
    const nPh = []; for (const r of photos) { const o = await re(r); const m = r.mct ? await re({ iv: r.miv, ct: r.mct }) : null; nPh.push({ id: r.id, eid: r.eid, iv: o.iv, ct: o.ct, miv: m && m.iv, mct: m && m.ct }); }
    const nSt = st ? await re(st) : null;
    const nAud = []; for (const r of aud) { const o = await re(r); nAud.push({ id: r.id, iv: o.iv, ct: o.ct }); } const nAh = ah ? await re(ah) : null; const nAb = ab ? await re(ab) : null;
    const chk = await encBytes(k1, te.encode(CHECK));
    await open();
    await new Promise((res, rej) => {
      const t = db.transaction(['meta', 'enc', 'photo', 'audit'], 'readwrite');
      t.objectStore('meta').put({ id: 'vault', salt, iter: ITER, check: chk, created: Date.now() });
      t.oncomplete = res; t.onerror = () => rej(t.error);
      for (const r of nEnc) t.objectStore('enc').put(r);
      for (const r of nPh) t.objectStore('photo').put(r);
      if (nSt) t.objectStore('meta').put({ id: 'settings', iv: nSt.iv, ct: nSt.ct });
      for (const r of nAud) t.objectStore('audit').put(r);
      if (nAh) t.objectStore('meta').put({ id: 'auditHead', iv: nAh.iv, ct: nAh.ct });
      if (nAb) t.objectStore('meta').put({ id: 'auditBase', iv: nAb.iv, ct: nAb.ct });
      t.objectStore('meta').delete('draft');
    });
    key = k1; return true;
  }
  // encrypted backup (portable): everything decrypted, then encrypted with a key from the given passcode
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function backup(pass) {
    const k0 = await verify(pass); if (!k0) return null;
    const encs = await loadAll(), settings = await loadSettings(), photos = [];
    for (const p of await all('photo')) { const b = await decBytes(k0, p); const m = p.mct ? await decJSON(k0, { iv: p.miv, ct: p.mct }) : {}; photos.push({ id: p.id, eid: p.eid, m, b: b64(b) }); }
    const salt = crypto.getRandomValues(new Uint8Array(16)), k = await derive(pass, salt, ITER);
    const audit = await loadAudit();
    const o = await encJSON(k, { encounters: encs, settings, photos, audit });
    return { app: 'Med Billing Logs', kind: 'encrypted-backup', version: 1, created: new Date().toISOString(), kdf: 'PBKDF2-SHA-256', iter: ITER, cipher: 'AES-GCM-256',
      salt: b64(salt), iv: b64(o.iv), ct: b64(new Uint8Array(o.ct)) };
  }
  async function openBackup(file, pass) {
    if (!file || file.kind !== 'encrypted-backup' || !file.ct) throw new Error('Not a Med Billing Logs encrypted backup');
    const k = await derive(pass, unb64(file.salt), file.iter || ITER);
    try { return await decJSON(k, { iv: unb64(file.iv), ct: unb64(file.ct) }); } catch (e) { return null; }
  }
  async function restorePhoto(p) { return savePhoto(p.id, p.eid, unb64(p.b), p.m); }
  async function wipe() {
    key = null; if (db) { db.close(); db = null; }
    await new Promise((res) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }
  global.Vault = { saveDraft, loadDraft, clearDraft, exists, create, unlock, verify, lock, unlocked, loadAll, save, remove, loadSettings, saveSettings, savePhoto, loadPhoto, removePhoto, photoIds, rekey, backup, openBackup, restorePhoto, wipe, appendAudit, loadAudit, verifyAudit, pruneAudit, sha, canon, ITER };
})(window);
