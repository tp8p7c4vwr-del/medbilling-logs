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
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  const DEF = { defSetting: 'H', autolock: 2, prov: 'AB', curFac: null, favFac: [], customFac: [], bkEvery: 30, lastBackup: 0, bkSnooze: 0,
    warnA: 60, warnR: 180, favSets: [], reviews: {}, revEdited: {}, holOff: [], holExtra: [] };   // v5: timer warnings, code sets, review marks, holidays
  const kindOf = R.kindOf, clone = o => JSON.parse(JSON.stringify(o));
  let FAC = null;
  let S = null;            // in-memory decrypted state while unlocked: {encs, settings}
  let tab = 'today', quickSet = 'H', lastAct = Date.now(), picking = 0;
  let blobUrls = [];
  let PROVS = [];          // codes-index list
  const codeCache = {};    // prov -> {meta, codes, index, byNorm}
  // MedBilling Fee Desk (companion app). Deep links carry only a code that exists in the bundled lists (never free text,
  // so no patient identifier can end up in a URL): #/code/<fee code> and #/medres/<ICD-9 code> are Fee Desk's own routes.
  const FD = 'https://tp8p7c4vwr-del.github.io/delara-medbilling/';
  let ICD = null;          // {meta, list, by, index} (Alberta Health ICD-9 list from Fee Desk, bundled)
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2200); }
  const fmtDur = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${R.pad(m)}:${R.pad(s % 60)}`; };
  const today = () => R.dayKey(Date.now());

  // ------------------------------------------------------------ lock / unlock
  const failKey = 'bl.fail';
  const fails = () => { try { return JSON.parse(localStorage.getItem(failKey)) || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } };
  async function showLock(msg) {
    document.body.classList.add('locked');
    const has = await V.exists();
    $('#setupForm').hidden = has; $('#unlockForm').hidden = !has;
    $('#lockMsg').textContent = msg || '';
    setTimeout(() => (has ? $('#uPass') : $('#sPass')).focus(), 50);
  }
  function lockNow(msg) {
    if (!S && document.body.classList.contains('locked')) return;
    if (cur && $('#editDlg').open) { try { V.saveDraft(editSnapshot()).catch(() => {}); } catch (e) { /* locked already */ } }
    hideSnack(); flushPhotoDel(); stopWake();
    V.lock(); S = null; cur = null;
    $$('dialog[open]').forEach(d => { if (d.id !== 'manDlg') d.close(); });   // the user manual holds no patient data; it stays open over the lock screen
    for (const u of blobUrls) URL.revokeObjectURL(u); blobUrls = [];
    ['#todayList', '#todayTotals', '#histList', '#ePhotos', '#eCodes', '#eCodeRes', '#eDxRes', '#credits', '#osList', '#deletedList', '#auditStatus', '#eLinks', '#facList', '#histBody', '#osInfo', '#lastBk', '#retInfo', '#eNotes', '#eSummary', '#rmSub'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
    $$('input:not([type=checkbox]):not([type=file]), textarea').forEach(i => { i.value = ''; });
    $('#pReady').hidden = true; repFile = null;
    showLock(msg || 'Locked.');
  }
  $('#setupForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const a = $('#sPass').value, b = $('#sPass2').value, err = $('#sErr');
    if (a.length < 6) return err.textContent = 'Use at least 6 characters.';
    if (a !== b) return err.textContent = 'The passcodes do not match.';
    if (!$('#sAck').checked) return err.textContent = 'Please confirm you understand the warning.';
    if (!$('#sResp').checked) return err.textContent = 'Please accept the records responsibility statement.';
    err.textContent = ''; $('#sBtn').disabled = true; $('#sBtn').textContent = 'Creating…';
    try { await V.create(a); $('#sPass').value = $('#sPass2').value = ''; await afterUnlock(true); }
    catch (e) { err.textContent = 'Could not create the vault: ' + e.message; }
    $('#sBtn').disabled = false; $('#sBtn').textContent = 'Create passcode';
  });
  $('#unlockForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const err = $('#uErr'), f = fails();
    if (f.until > Date.now()) return err.textContent = `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`;
    $('#uBtn').disabled = true; $('#uBtn').textContent = 'Unlocking…';
    const ok = await V.unlock($('#uPass').value).catch(() => false);
    $('#uBtn').disabled = false; $('#uBtn').textContent = 'Unlock';
    if (!ok) {
      f.n++; if (f.n >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, f.n - 5));
      localStorage.setItem(failKey, JSON.stringify(f));
      err.textContent = f.n >= 5 ? `Wrong passcode. Wait ${Math.round((f.until - Date.now()) / 1000)} s before trying again.` : 'Wrong passcode.';
      $('#uPass').select(); return;
    }
    localStorage.removeItem(failKey); err.textContent = ''; $('#uPass').value = '';
    await afterUnlock(false);
  });
  $('#forgot').addEventListener('click', () => ask({ title: 'Forgot passcode', text: "The passcode is never stored, so there is no way to recover it or decrypt your data. If you can't remember it, the only option is to delete all data on this device and start again (you can then import an encrypted backup if you remember that backup's passcode). Type DELETE to erase everything.", fields: [{ id: 'conf', label: 'Type DELETE', type: 'text' }], ok: 'Delete everything', danger: true,
    check: v => v.conf.trim().toUpperCase() === 'DELETE' ? '' : 'Type DELETE to confirm.' }).then(async v => { if (!v) return; await V.wipe(); localStorage.removeItem(failKey); showLock('All data deleted. Create a new passcode.'); }));
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
    fillProv($('#defProv'), settings.prov);
    renderCredits(); setQuick(); render(); renderRetention(); checkBackupDue(); renderPeriodSettings();
    if (first) toast('Passcode set. Your logs are encrypted on this device.', 3500);
    else { const d = await V.loadDraft().catch(() => null); if (d && d.cur) { await V.clearDraft(); restoreDraft(d); toast('Restored your unsaved entry', 3000); } else checkLongTimers(); }
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
  setInterval(() => { if (S && !picking && Date.now() - lastAct > (S.settings.autolock || 2) * 60000) lockNow('Locked after inactivity.'); }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S && !picking) lockNow('Locked because the app went to the background.'); });
  window.addEventListener('pagehide', () => { if (S && !picking) lockNow(); });
  // file pickers / share sheets briefly hide the page; don't lock for those
  function pickStart() { picking++; }
  function pickEnd() { setTimeout(() => { picking = Math.max(0, picking - 1); lastAct = Date.now(); }, 800); }
  window.addEventListener('focus', () => { if (picking) pickEnd(); });
  $('#lockNow').addEventListener('click', () => lockNow());
  $('#lockNow2').addEventListener('click', () => lockNow());

  // ------------------------------------------------------------ persistence
  async function saveEnc(e, action, note, quiet) {
    const i = S.encs.findIndex(x => x.id === e.id), before = i < 0 ? null : clone(S.encs[i]);
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
    await V.remove(e.id); S.encs = S.encs.filter(x => x.id !== e.id);
    await V.appendAudit({ action: 'delete', eid: e.id, kind: kindOf(e), before: before ? clone(before) : null, after: null, note: [note, ph.length ? `${ph.length} photo(s) removed with the entry` : ''].filter(Boolean).join('. ') || undefined });
    await reviewTouch([before], 'entry deleted after review');
    return ph;
  }
  async function saveSettings() { await V.saveSettings(S.settings); }

  // ------------------------------------------------------------ encounters
  function setQuick() { $$('#quick .seg button').forEach(b => { const on = b.dataset.set === quickSet; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  $$('#quick .seg button').forEach(b => b.addEventListener('click', () => { quickSet = b.dataset.set; setQuick(); }));
  $('#quick').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!S) return;
    const now = Date.now(), n = S.encs.filter(e => R.encDay(e) === today()).length + 1;
    const sh = activeShift(), fac = sh ? sh.facility : S.settings.curFac;
    const e = { id: uid(), kind: 'enc', label: $('#qLabel').value.trim() || `Encounter ${n}`, initials: '', chart: '', setting: quickSet, facility: fac || null, type: '', codes: [], notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    await saveEnc(e, 'create'); $('#qLabel').value = ''; tab = 'today'; showTab(); render(); toast(`Started ${e.label}`);
  });
  async function act(e, a, note) {
    const now = Date.now(), prev = clone(e);
    e = clone(e);
    const l2 = e.segs[e.segs.length - 1];
    if (a === 'pause' && l2 && l2.e == null) { l2.e = now; e.status = 'pause'; }
    else if (a === 'resume') { e.segs.push({ s: now, e: null }); e.status = 'run'; }
    else if (a === 'stop') { if (l2 && l2.e == null) l2.e = now; e.status = 'done'; }
    else return;
    await saveEnc(e, a, note); render();
    if (a === 'stop') snack(`Stopped ${e.label || R.KIND[kindOf(e)]}`, () => undoTo(prev, e, 'Stop undone'));
  }
  function card(e, compact) {
    const ms = R.msOf(e), m = Math.floor(ms / 60000), u = R.units(m), st = e.status;
    const k = kindOf(e);
    const meta = [k === 'cb' ? (R.CBT[e.cbType] || 'Call-back') + (e.called ? ' · called ' + R.hm(e.called) : '') : '', e.initials, e.chart && ('#' + e.chart), e.type, (e.codes || []).map(c => c.c).join(', '), R.dxShort(e) && 'Dx ' + R.dxShort(e).replace(/; /g, ', '), k !== 'shift' && e.facility && e.facility.n, `${R.hm(R.startOf(e))}${R.endOf(e) ? '–' + R.hm(R.endOf(e)) : ''}`, k === 'cb' && (e.links || []).length ? `${e.links.length} linked` : ''].filter(Boolean).join(' · ');
    const late = e.late ? `<span class="badge late" title="Entered later${e.edits && e.edits.length ? '; last edited ' + R.tsTxt(e.edits[e.edits.length - 1]) : ''}">Entered later</span>` : '';
    const fsb = `<button type="button" class="ghost fsbtn" data-a="full" aria-label="Full-screen procedure timer" title="Full-screen timer">⛶</button>`;
    const acts = st === 'run' ? `<button type="button" class="pausebtn" data-a="pause">Pause</button><button type="button" class="stopbtn" data-a="stop">Stop</button>${k === 'enc' ? '<button type="button" class="ghost swbtn" data-a="switch" title="Stop this encounter and start the next one">Next pt</button>' : ''}${fsb}`
      : st === 'pause' ? `<button type="button" class="resumebtn" data-a="resume">Resume</button><button type="button" class="stopbtn" data-a="stop">Stop</button>${fsb}`
      : `<button type="button" class="ghost" data-a="editf">Edit</button><button type="button" class="ghost" data-a="resume">Continue</button>`;
    const wl = warnLvl(e);
    return `<div class="enc ${st} ${k}${wl ? ' w' + wl : ''}" data-id="${esc(e.id)}">
      <div class="r1"><span class="lbl" data-a="edit">${esc(k === 'shift' ? (e.facility ? e.facility.n : 'On site') : (e.label || (k === 'cb' ? 'Call-back' : 'Encounter')))}</span>${(e.photos || []).length ? `<span class="pc">📷 ${e.photos.length}</span>` : ''}${late}${k === 'cb' ? '<span class="badge cb">Call-back</span>' : k === 'shift' ? '<span class="badge">On site</span>' : `<span class="badge ${e.setting}">${R.SET[e.setting]}</span>`}${st !== 'done' ? `<span class="badge st ${st}">${st === 'run' ? 'Running' : 'Paused'}</span>` : ''}</div>
      <p class="meta" data-a="edit">${esc(meta)}</p>${noteLine(e)}
      <div class="timer" data-t="${esc(e.id)}">${st === 'done' ? m + ' min' : fmtDur(ms)}</div>
      <div class="units" data-u="${esc(e.id)}" data-k="${k}">${unitsHtml(e, m)}</div>
      ${st === 'run' && k !== 'shift' ? `<p class="lwarn" data-w="${esc(e.id)}"${wl ? '' : ' hidden'}>${warnHtml(e)}</p>` : ''}
      ${compact ? '' : `<div class="acts">${acts}</div>`}</div>`;
  }
  function noteLine(e) { const ns = R.notesOf(e); if (!ns.length) return ''; const n = ns[ns.length - 1]; return `<p class="note" data-a="edit"><span class="nt">${R.hm(n.t)}</span> ${esc(n.x.length > 140 ? n.x.slice(0, 140) + '…' : n.x)}${ns.length > 1 ? ` <span class="nc">+${ns.length - 1} more</span>` : ''}</p>`; }
  const ptCount = e => e.pt && S ? S.encs.filter(x => x.pt === e.pt).length : 0;
  // compact one-line row: start time · duration · label/initials · billing code · diagnostic code (tap = details)
  const durTxt = (e, m) => kindOf(e) === 'shift' ? `${Math.floor(m / 60)}h${R.pad(m % 60)}` : `${m}m`;
  function rowHtml(e, cont, more) {
    const ms = R.msOf(e), m = Math.floor(ms / 60000), k = kindOf(e), st = e.status, cs = e.codes || [], dx = R.dxList(e);
    const who = k === 'shift' ? (e.facility ? e.facility.n : 'On site') : [e.label || (k === 'cb' ? 'Call-back' : 'Encounter'), e.initials].filter(Boolean).join(' · ');
    const badge = (st === 'run' ? '<i class="b run">Running</i>' : st === 'pause' ? '<i class="b pause">Paused</i>' : '') + (k === 'cb' ? '<i class="b cb">CB</i>' : k === 'shift' ? '<i class="b">On site</i>' : '') + (e.late ? '<i class="b late" title="Entered later">*</i>' : '') + ((e.photos || []).length ? `<i class="b">📷${e.photos.length}</i>` : '') + (ptCount(e) > 1 ? '<i class="b sp" title="Same patient as another encounter">↔</i>' : '') + (R.notesOf(e).length ? `<i class="b nb" title="${R.notesOf(e).length} note(s)">✎${R.notesOf(e).length > 1 ? R.notesOf(e).length : ''}</i>` : '');
    const wl = warnLvl(e), en = R.endOf(e), fac = k === 'shift' ? '' : [k === 'cb' ? (R.CBT[e.cbType] || 'Call-back') : R.SET[e.setting], e.facility && e.facility.n].filter(Boolean).join(' · ');
    const pp = k === 'shift' ? [] : R.periodSplit(e).parts;
    // v6: extra cells (.xw) are shown only on tablet/desktop widths (>= 768px); the phone row is unchanged
    return `<div class="erow ${st} rk-${k}${wl ? ' w' + wl : ''}" role="button" tabindex="0" data-id="${esc(e.id)}" aria-label="${esc(who)}, ${R.hm(R.startOf(e))}, open details">
      <span class="t">${R.hm(R.startOf(e))}${perTags(e)}</span><span class="xw xe">${en ? R.hm(en) : st === 'done' ? '' : '…'}</span><span class="du" data-rm="${esc(e.id)}" data-k="${k}">${durTxt(e, m)}</span><span class="xw xu">${k === 'shift' ? '' : R.units(m) + ' u'}</span>
      <span class="who">${esc(who)}${badge}</span><span class="xw xf" title="${esc(fac)}">${esc(fac)}</span>
      <span class="fc" title="${esc(cs.map(c => c.c).join(', '))}">${cs.length ? esc(cs[0].c) + (cs.length > 1 ? `<small>+${cs.length - 1}</small>` : '') : '<span class="nil">–</span>'}</span>
      <span class="dx" title="${esc(dx.join(', '))}">${dx.length ? esc(dx[0]) + (dx.length > 1 ? `<small>+${dx.length - 1}</small>` : '') : '<span class="nil">–</span>'}</span>
      <span class="xw xp" title="${esc(R.perTxt(pp))}">${pp.length ? esc(R.perTxt(pp, true).replace(/ min\//g, 'm/').replace(/ u/g, 'u')) : ''}</span>
      ${cont ? `<button type="button" class="cont" data-a="resume" aria-label="Continue ${esc(who)}" title="Continue">▶</button>` : more ? `<button type="button" class="rmore" data-a="more" aria-label="Actions for ${esc(who)}" title="Add time, add note, same patient, edit">⋯</button>` : ''}</div>`;
  }
  const rowsHead = '<div class="erowh" aria-hidden="true"><span>Start</span><span class="xw">End</span><span>Time</span><span class="xw">Units</span><span>Label · initials</span><span class="xw">Setting · facility</span><span>Billing</span><span>Dx</span><span class="xw">Time periods</span></div>';
  function bindCards(root) {
    root.querySelectorAll('.erow').forEach(el => {
      const go = ev => { if (el.dataset.lp) { delete el.dataset.lp; return; } const e = S && S.encs.find(x => x.id === el.dataset.id); if (!e) return; const a = ev.target.closest('[data-a]'); if (a && a.dataset.a === 'resume') { ev.stopPropagation(); return act(e, 'resume'); } if (a && a.dataset.a === 'more') { ev.stopPropagation(); return openRowMenu(e); } openEdit(e); };
      el.addEventListener('click', go); longPress(el); el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
    });
    root.querySelectorAll('.enc').forEach(el => el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-a]'); const e = S && S.encs.find(x => x.id === el.dataset.id); if (!e) return;
      if (!a || a.dataset.a === 'edit') return openEdit(e);
      if (a.dataset.a === 'editf') return openEdit(e, false, { edit: true });
      if (a.dataset.a === 'switch') return switchPatient(e);
      if (a.dataset.a === 'full') return openProc(e);
      if (a.dataset.a === 'stopat') return longPrompt(e, false);
      act(e, a.dataset.a);
    }));
  }
  // v7: long-press (or right-click) on a row opens the quick-action sheet
  function longPress(el) {
    let t = null, x0 = 0, y0 = 0;
    const clear = () => { clearTimeout(t); t = null; };
    el.addEventListener('pointerdown', ev => { if (ev.button > 0 || ev.target.closest('button')) return; x0 = ev.clientX; y0 = ev.clientY; clear(); t = setTimeout(() => { t = null; el.dataset.lp = '1'; setTimeout(() => { delete el.dataset.lp; }, 900); const e = S && S.encs.find(x => x.id === el.dataset.id); if (e) { if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) {} openRowMenu(e); } }, 500); });
    el.addEventListener('pointermove', ev => { if (t && (Math.abs(ev.clientX - x0) > 8 || Math.abs(ev.clientY - y0) > 8)) clear(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => el.addEventListener(n, clear));
    el.addEventListener('contextmenu', ev => { ev.preventDefault(); clear(); const e = S && S.encs.find(x => x.id === el.dataset.id); if (e) openRowMenu(e); });
  }
  function totHtml(list) {
    const t = R.totals(list);
    return ['H', 'C'].map(k => `<div class="tot"><b>${t[k].m} min</b><span>${R.SET[k]} · ${t[k].n} enc · ${t[k].u} units</span></div>`).join('');
  }
  function render() {
    if (!S) return;
    const td = today();
    renderOnsite();
    const list = S.encs.filter(e => kindOf(e) !== 'shift' && (R.encDay(e) === td || e.status !== 'done')).sort((a, b) => (a.status === 'done') - (b.status === 'done') || R.startOf(b) - R.startOf(a));
    renderStrip('today'); renderTrackAgain();
    const live = list.filter(e => e.status !== 'done'), done = list.filter(e => e.status === 'done');
    $('#todayList').innerHTML = list.length ? live.map(e => card(e)).join('') + (done.length ? `<div class="rows">${rowsHead}${done.map(e => rowHtml(e, true)).join('')}</div>` : '') : '<div class="empty">No encounters yet today. Enter a room or bed below and tap <b>Start</b>.</div>';
    bindCards($('#todayList'));
    $('#unitsNote').textContent = R.UNITS_NOTE;
    renderHistory(); renderRetention(); renderPbar(); renderPeriodSettings();
    if ($('#revDlg').open) renderReview(); if ($('#tlDlg').open) renderTimeline();
    $('#storeInfo').textContent = `${S.encs.length} entr${S.encs.length === 1 ? 'y' : 'ies'} and ${S.encs.reduce((a, e) => a + (e.photos || []).length, 0)} photo(s) stored encrypted on this device.`;
  }
  function weekStart(k) { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return R.dayKey(dt.getTime()); }
  function renderHistory() {
    renderStrip('hist');
    const days = R.byDay(S.encs.slice().sort((a, b) => R.startOf(b) - R.startOf(a)));
    if (!days.size) { $('#histList').innerHTML = '<div class="empty">No history yet.</div>'; return; }
    const rv = S.settings.reviews || {}, re = S.settings.revEdited || {};
    const weeks = new Map(); for (const k of days.keys()) { const w = weekStart(k); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(k); }
    let h = '';
    for (const [w, ks] of weeks) {
      const all = ks.flatMap(k => days.get(k)), t = R.totals(all);
      const wkRev = ks.every(k => rv[k]), wkEnd = (d => { d.setDate(d.getDate() + 6); return R.dayKey(d.getTime()); })(new Date(w + 'T12:00'));
      h += `<div class="week"><div class="weekh"><span class="wl">Week of ${esc(R.fmtDay(w))}${wkRev ? ' <i class="rvb">✎ Reviewed</i>' : ''}</span><span>H ${t.H.m} min/${t.H.u} u · C ${t.C.m} min/${t.C.u} u${t.cb.n ? ` · CB ${t.cb.m} min` : ''}${t.site.n ? ` · on site ${R.hmin(t.site.m)}` : ''} <button type="button" class="linkbtn sm" data-rvw="${w}|${wkEnd}">Review week</button></span></div>`;
      for (const k of ks) {
        const l = days.get(k), d = R.totals(l);
        const hol = R.holidayName(k);
        h += `<div class="dayg" id="d-${k}"><div class="dayh"><span class="d">${esc(R.fmtDay(k))}</span>${hol ? `<i class="holb" title="${esc(hol)}">Holiday</i>` : ''}${rv[k] ? '<i class="rvb" title="Reviewed">✎ Reviewed</i>' : re[k] ? '<i class="rve" title="An entry changed after this day was reviewed">Edited after review</i>' : ''}<span class="sp"></span><button type="button" class="linkbtn sm" data-tl="${k}">Timeline</button><button type="button" class="linkbtn sm" data-rv="${k}">Review</button><button type="button" class="linkbtn sm" data-rep="${k}" aria-label="Report or share ${esc(R.fmtDay(k))}">Report</button></div>
          <div class="dayt">${d.H.n + d.C.n} enc · H ${d.H.m}m/${d.H.u}u · C ${d.C.m}m/${d.C.u}u${d.cb.n ? ` · CB ${d.cb.n}/${d.cb.m}m` : ''}${d.site.n ? ` · on site ${R.hmin(d.site.m)}` : ''}${perShort(d)}</div>`;
        h += `<div class="rows">${l.sort((a, b) => R.startOf(a) - R.startOf(b)).map(e => rowHtml(e, false, true)).join('')}</div></div>`;
      }
      h += '</div>';
    }
    $('#histList').innerHTML = rowsHead + h;
    $$('#histList [data-rep]').forEach(b => b.addEventListener('click', () => openReport(b.dataset.rep, b.dataset.rep)));
    $$('#histList [data-rv]').forEach(b => b.addEventListener('click', () => openReview(b.dataset.rv, b.dataset.rv)));
    $$('#histList [data-rvw]').forEach(b => b.addEventListener('click', () => { const [f, t2] = b.dataset.rvw.split('|'); openReview(f, t2); }));
    $$('#histList [data-tl]').forEach(b => b.addEventListener('click', () => openTimeline(b.dataset.tl)));
    bindCards($('#histList'));
  }
  // live tick (display only; durations always computed from timestamps)
  setInterval(() => {
    const d = new Date(); $('#clock').textContent = `${R.pad(d.getHours())}:${R.pad(d.getMinutes())}`;
    if (!S) return;
    for (const e of S.encs) { if (e.status !== 'run') continue; const ms = R.msOf(e), m = Math.floor(ms / 60000), u = R.units(m);
      $$(`[data-rm="${CSS.escape(e.id)}"]`).forEach(el => { el.textContent = durTxt(e, m); });
      $$(`[data-t="${CSS.escape(e.id)}"]`).forEach(el => { el.textContent = fmtDur(ms); });
      $$(`[data-u="${CSS.escape(e.id)}"]`).forEach(el => { el.innerHTML = unitsHtml(e, m); });
      if (kindOf(e) !== 'shift') { const wl = warnLvl(e); $$(`.enc[data-id="${CSS.escape(e.id)}"], .erow[data-id="${CSS.escape(e.id)}"]`).forEach(el => { el.classList.toggle('wa', wl === 'a'); el.classList.toggle('wr', wl === 'r'); });
        $$(`[data-w="${CSS.escape(e.id)}"]`).forEach(el => { el.hidden = !wl; if (wl) el.innerHTML = warnHtml(e); }); } }
    renderPbar(); procTick();
    if (S && activeShift()) renderOnsiteInfo();
    if (tab === 'today' && render.day !== today()) { render.day = today(); render(); }
  }, 1000);

  // ------------------------------------------------------------ tabs
  function showTab() { $$('#tabs button').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); $$('main .panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; }); }
  $$('#tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; showTab(); if (tab === 'history' && !$('#rFrom').value) { $('#rTo').value = today(); const d = new Date(); d.setDate(d.getDate() - 6); $('#rFrom').value = R.dayKey(d.getTime()); } }));
  $('#homeLink').addEventListener('click', ev => { ev.preventDefault(); tab = 'today'; showTab(); window.scrollTo(0, 0); });

  // ------------------------------------------------------------ fee codes (Fee Desk data, bundled)
  async function loadProvs() { try { PROVS = (await (await fetch('data/codes-index.json')).json()).list; } catch (e) { PROVS = [{ id: 'AB', name: 'Alberta' }]; } }
  function fillProv(sel, v) { sel.innerHTML = PROVS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join(''); sel.value = PROVS.some(p => p.id === v) ? v : 'AB'; }
  function renderCredits() { $('#credits').innerHTML = PROVS.map(p => `<p><b>${esc(p.name)}</b>: ${esc(p.title || '')}${p.eff ? ' (' + esc(p.eff) + ')' : ''}. ${esc(p.credit || '')}</p>`).join(''); }
  async function codesFor(id) {
    if (!PROVS.some(p => p.id === id)) id = 'AB';
    if (codeCache[id]) return codeCache[id];
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
    const o = await codesFor(prov); q = q.trim(); if (!q) return [];
    const cq = norm(q);
    if (/\d/.test(cq) && /^[A-Z0-9.\-]{1,12}$/.test(cq) && !/^\d+(MIN|MINS|H)$/.test(cq)) {
      const pre = o.codes.filter(d => norm(d.c.c).startsWith(cq) || norm(d.c.k).startsWith(cq));
      if (pre.length) return pre.sort((a, b) => (norm(a.c.c) === cq ? -1 : 0) - (norm(b.c.c) === cq ? -1 : 0)).slice(0, 12).map(d => d.c);
    }
    return o.index.search(q, { limit: 12 }).hits.map(h => h.doc.c);
  }

  // ------------------------------------------------------------ edit dialog
  let cur = null, isNew = false, addedPhotos = [], removedPhotos = [];
  const dtLocal = ts => { if (ts == null) return ''; const d = new Date(ts); return `${R.dayKey(ts)}T${R.pad(d.getHours())}:${R.pad(d.getMinutes())}`; };
  const parseLocal = v => v ? new Date(v).getTime() : null;
  function segRow(s) { return `<div class="segrow"><label>Start<input type="datetime-local" class="ss" value="${dtLocal(s.s)}" required></label><label>End${s.e == null ? ' (running)' : ''}<input type="datetime-local" class="se" value="${dtLocal(s.e)}"></label><button type="button" class="x" aria-label="Remove segment">✕</button></div>`; }
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
  async function showCredit() { const p = PROVS.find(x => x.id === $('#eProv').value) || PROVS[0]; $('#eCredit').textContent = p ? `${p.name} codes: ${p.title}${p.eff ? ' (' + p.eff + ')' : ''}. ${p.credit} Data from MedBilling Fee Desk; confirm in the official schedule.` : ''; }
  let searchSeq = 0;
  async function runCodeSearch() {
    const q = $('#eCodeQ').value, seq = ++searchSeq, prov = $('#eProv').value;
    if (!q.trim()) { $('#eCodeRes').innerHTML = ''; syncCodeLink(); return; }
    const hits = await searchCodes(q, prov); if (seq !== searchSeq) return;
    syncCodeLink();
    let h = hits.map((c, i) => `<button type="button" class="chit" data-i="${i}"><span class="cc">${esc(c.c)}</span><span class="cd">${esc(c.d)}</span><span class="cf">${esc(c.f)}</span></button>`).join('');
    const typed = q.trim().toUpperCase();
    if (/^[A-Z0-9.\-]{2,12}$/.test(typed) && !hits.some(c => c.c.toUpperCase() === typed)) h += `<button type="button" class="chit" data-typed="1"><span class="cc">${esc(typed)}</span><span class="cd">Add as typed (not found in the ${esc(prov)} list)</span><span class="cf"></span></button>`;
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
    $('#eLabel').value = cur.label || ''; $('#eInit').value = cur.initials || ''; $('#eChart').value = cur.chart || '';
    $('#eSetting').value = cur.setting || 'H'; $('#eSetting2').value = cur.setting || 'H'; $('#eType').value = cur.type || '';
    $('#eCbType').value = cur.cbType || 'return'; $('#eCalled').value = dtLocal(cur.called);
    eFac = cur.facility || null; showFac($('#eFacName'), eFac);
    $('#eMinor').checked = !!cur.minor; $('#eObs').checked = !!cur.obstetric; $('#eAge').value = Number.isFinite(cur.minorAge) ? cur.minorAge : ''; showRet();
    fillProv($('#eProv'), S.settings.prov); showCredit(); $('#eCodeQ').value = ''; $('#eCodeRes').innerHTML = ''; $('#eDxRes').innerHTML = ''; $('#eDxQ').value = cur.dx || '';
    renderChips(); dxSync($('#eDxQ')); syncCodeLink();
    const jl = [...new Set([$('#eProv').value].concat(cur.codes.map(c => c.j || 'AB')))].map(j => codesFor(j).catch(() => null));
    Promise.all(jl.concat(cur.codes.some(c => c.dx) || cur.dx ? [loadIcd()] : [])).then(() => { if (cur) { renderChips(); dxSync($('#eDxQ')); syncCodeLink(); } }).catch(() => {});
    $('#eSegs').innerHTML = cur.segs.map(segRow).join(''); bindSegs(); sumSegs(); $('#eErr').textContent = ''; $('#eWarn').hidden = true; $('#eSave').textContent = 'Save';
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
    if (k === 'enc') rows.push(['Patient', [e.label && `<b>${esc(e.label)}</b>`, e.initials && esc(e.initials), e.chart && 'Chart ' + esc(e.chart)].filter(Boolean).join(' · ') || '<span class="muted">–</span>']);
    if (k === 'cb') rows.push(['Call-back', esc([R.CBT[e.cbType] || 'Call-back', e.called && 'called ' + R.hm(e.called)].filter(Boolean).join(' · '))]);
    rows.push(['Setting', esc([R.SET[e.setting], k === 'enc' && e.type, e.facility && e.facility.n].filter(Boolean).join(' · ')) || '<span class="muted">–</span>']);
    if (k !== 'shift') {
      const cs = e.codes || [];
      rows.push(['Codes', cs.length ? cs.map(c => `<span class="sc"><b>${esc(c.c)}</b>${c.dx ? ` <span class="dxc">Dx ${esc(c.dx)}</span>` : ''}${c.d ? ` <span class="muted">${esc(c.d.length > 60 ? c.d.slice(0, 60) + '…' : c.d)}</span>` : ''}</span>`).join('') + (e.dx ? `<span class="sc"><span class="dxc">Dx ${esc(e.dx)}</span></span>` : '') : (e.dx ? `<span class="dxc">Dx ${esc(e.dx)}</span>` : '<span class="muted">None yet. Tap Edit to add fee and diagnostic codes.</span>')]);
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
    const ne = { id: uid(), kind: 'enc', label: e.label && kindOf(e) === 'enc' ? e.label : (e.label && e.label !== 'Call-back' ? e.label : 'Encounter'), initials: e.initials || '', chart: e.chart || '', setting: e.setting || 'H', facility: e.facility || null, type: '', codes: [], notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], links: [], pt: group, ptFrom: e.id, created: now, updated: now };
    if (e.minor) { ne.minor = true; if (Number.isFinite(e.minorAge)) ne.minorAge = e.minorAge; }
    if (e.obstetric) ne.obstetric = true;
    await saveEnc(ne, 'create', `Same patient as ${e.label || R.KIND[kindOf(e)]} ${R.hm(R.startOf(e))} (linked). Room/label, initials and chart carried over; codes left blank.`);
    tab = 'today'; showTab(); render();
    snack(`Started ${ne.label} · same patient`, async () => {
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
  // ---- v7 row quick actions (History ⋯ button, or long-press / right-click on any row)
  let rmEnt = null;
  function openRowMenu(e) {
    rmEnt = e; const k = kindOf(e);
    $('#rmTitle').textContent = k === 'shift' ? (e.facility ? e.facility.n : 'On site') : (e.label || R.KIND[k]);
    $('#rmSub').textContent = [R.fmtDay(R.encDay(e)), R.hm(R.startOf(e)) + (R.endOf(e) ? '–' + R.hm(R.endOf(e)) : ''), e.initials, (e.codes || []).map(c => c.c).join(', ')].filter(Boolean).join(' · ');
    $('#rmSame').hidden = k === 'shift';
    const d = $('#rowMenu'); if (!d.open) d.showModal();
  }
  $('#rmClose').onclick = () => $('#rowMenu').close();
  $('#rowMenu').addEventListener('click', ev => { if (ev.target === $('#rowMenu')) $('#rowMenu').close(); });
  $$('#rowMenu [data-rmi]').forEach(b => b.onclick = async () => {
    const e = rmEnt && S && S.encs.find(x => x.id === rmEnt.id); $('#rowMenu').close(); if (!e) return;
    const a = b.dataset.rmi;
    if (a === 'same') return samePatient(e);
    openEdit(e, false, a === 'edit' ? { edit: true } : a === 'time' ? { panel: 'time' } : a === 'note' ? { panel: 'note' } : {});
  });
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
    const segs = sumSegs(), err = $('#eErr'), k = cur.kind; err.textContent = '';
    if (!segs || !segs.length) return err.textContent = 'Each time segment needs a start time.';
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
    if (k === 'enc') { cur.label = $('#eLabel').value.trim() || cur.label || 'Encounter'; cur.initials = $('#eInit').value.trim().toUpperCase(); cur.chart = $('#eChart').value.trim(); cur.setting = $('#eSetting').value; cur.type = $('#eType').value.trim(); }
    else { cur.setting = $('#eSetting2').value; }
    if (k === 'cb') { cur.cbType = $('#eCbType').value; cur.called = called; cur.links = $$('#eLinks input:checked').map(i => i.value); cur.label = cur.label || 'Call-back'; }
    if (k === 'shift') { cur.codes = []; cur.photos.forEach(p => removedPhotos.push(p)); cur.photos = []; cur.label = ''; delete cur.dx; }
    else applyPendingDx(cur);
    const open = segs[segs.length - 1].e == null;
    cur.status = open ? 'run' : (cur.status === 'run' ? 'pause' : (isNew ? 'done' : cur.status));
    if (k !== 'enc' && !open) cur.status = 'done';
    // honest audit trail: back-dated or edited times are marked "entered later"
    if (isNew) { cur.created = Date.now(); if (segs[0].s < Date.now() - 2 * 60000) cur.late = true; }
    else if (timesChanged) cur.late = true;
    if (!isNew) cur.edits = (cur.edits || []).concat(Date.now());
    for (const p of removedPhotos) await V.removePhoto(p);
    await saveEnc(cur, isNew ? 'create' : 'edit', isNew && cur.late ? 'Entered later (back-dated)' : (timesChanged && !isNew ? 'Times edited' : undefined));
    const lbl = k === 'shift' ? 'arrival / departure' : cur.label; await closeEdit(true); render(); toast(`Saved ${lbl}`);
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
    if (k === 'enc') { c.label = $('#eLabel').value; c.initials = $('#eInit').value; c.chart = $('#eChart').value; c.setting = $('#eSetting').value; c.type = $('#eType').value; } else c.setting = $('#eSetting2').value;
    if (k !== 'shift') { c.minor = $('#eMinor').checked; c.obstetric = $('#eObs').checked; const ag = parseInt($('#eAge').value, 10); c.minorAge = Number.isFinite(ag) ? ag : undefined; c.dx = $('#eDxQ').value; }
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
    snack(`Deleted ${gone.label || R.KIND[kindOf(gone)]} (kept in audit log)`, async () => { clearTimeout(tm); photoDel.delete(tm); if (S.encs.some(x => x.id === gone.id)) return; await saveEnc(gone, 'restore', 'Delete undone'); render(); toast('Restored'); });
  };
  const blank = (k, s, e) => ({ id: uid(), kind: k, label: '', initials: '', chart: '', setting: k === 'enc' ? S.settings.defSetting : 'H', facility: (activeShift() || {}).facility || S.settings.curFac || null, type: '', codes: [], notes: [], segs: [{ s, e }], status: e == null ? 'run' : 'done', photos: [], links: [], created: Date.now() });
  $('#manualBtn').onclick = () => { const s = Date.now() - 30 * 60000; const e = blank('enc', s, s + 30 * 60000); e.late = true; openEdit(e, true); };
  $('#cbBtn').onclick = () => { const now = Date.now(); const e = blank('cb', now, null); e.called = now; e.cbType = 'return'; e.setting = 'H'; openEdit(e, true); };
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
  function renderOnsiteInfo() {
    const sh = activeShift(), td = today(), t = R.totals(S.encs.filter(e => R.encDay(e) === td));
    $('#osInfo').textContent = (sh ? `On site since ${R.hm(R.startOf(sh))}${sh.late ? ' (entered later)' : ''}. ` : '') + `Time on site today: ${R.hmin(t.site.m)}${t.site.n ? ` (${t.site.n} period${t.site.n > 1 ? 's' : ''})` : ''}.`;
  }
  function renderOnsite() {
    const sh = activeShift(), f = sh ? sh.facility : S.settings.curFac;
    $('#osFacName').textContent = f ? f.n : 'Choose…';
    const b = $('#osBtn'); b.textContent = sh ? 'Depart' : 'Arrive'; b.classList.toggle('dep', !!sh); $('#osEdit').hidden = !sh;
    renderOnsiteInfo();
    const td = today(), list = S.encs.filter(e => kindOf(e) === 'shift' && R.encDay(e) === td).sort((a, b) => R.startOf(a) - R.startOf(b));
    let box = $('#osList'); if (!box) { box = document.createElement('div'); box.id = 'osList'; box.className = 'list'; $('#onsite').appendChild(box); }
    const dn = list.filter(e => e.status !== 'run'); box.innerHTML = dn.length ? `<div class="rows">${dn.map(e => rowHtml(e)).join('')}</div>` : ''; bindCards(box);
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
    $('#bkRemind').hidden = !due;
    if (due) $('#bkText').textContent = st.lastBackup ? `Your last encrypted backup was ${Math.floor((now - st.lastBackup) / 86400000)} days ago. Your data lives only on this device; make a backup and keep it somewhere safe.` : 'You have not made an encrypted backup yet. Your data lives only on this device; make a backup and keep it somewhere safe.';
  }
  $('#bkNow').onclick = () => $('#expAll').click();
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
      $('#askFields').innerHTML = (o.fields || []).map(f => `<label class="fld">${esc(f.label)}<input id="ask_${f.id}" type="${f.type || 'password'}" ${f.type === 'password' || !f.type ? 'autocomplete="off"' : ''} maxlength="64"></label>`).join('');
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
    $('#repForm .fmt [data-fmt=docx]').hidden = repMode === 'audit'; $('#pPhotosL').hidden = repMode === 'audit';
    if (repMode === 'audit' && fmt === 'docx') fmt = 'pdf';
    $('#pFrom').value = from; $('#pTo').value = to; $('#pReady').hidden = true; repFile = null; $('#pErr').textContent = ''; $('#pAck').checked = false; $('#pNotes').checked = false; $('#pNotesL').lastChild.textContent = repMode === 'audit' ? ' (off: note text is left out of the log export)' : ' (off by default for privacy)'; setFmt(fmt);
    $('#repDlg').showModal();
  }
  function setFmt(f) { fmt = f; $$('#repForm .fmt button').forEach(b => { const on = b.dataset.fmt === f; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); $('#pPhotos').disabled = f === 'csv'; repInfo(); $('#pReady').hidden = true; repFile = null; }
  async function repInfo() {
    if (!S) return; const f = $('#pFrom').value || '0', t = $('#pTo').value || '9';
    if (repMode === 'audit') { const n = (await V.loadAudit()).filter(r => { const k = R.dayKey(r.ts); return k >= f && k <= t; }).length; $('#pInfo').textContent = `${n} audit record${n === 1 ? '' : 's'} in this period. The export includes the integrity check result and each record's hashes.`; return; }
    const l = R.select(S.encs, f, t), np = l.reduce((a, e) => a + (e.photos || []).length, 0), nn = l.reduce((a, e) => a + R.notesOf(e).length, 0), n = k => l.filter(e => kindOf(e) === k).length;
    $('#pInfo').textContent = `${n('enc')} encounter${n('enc') === 1 ? '' : 's'}, ${n('cb')} call-back${n('cb') === 1 ? '' : 's'}, ${n('shift')} on-site period${n('shift') === 1 ? '' : 's'}${np ? `, ${np} photo${np === 1 ? '' : 's'}` : ''} in this period.` + (fmt === 'csv' ? ' CSV has no photos.' : '') + (nn ? ` ${nn} note${nn === 1 ? '' : 's'}: ${$('#pNotes').checked ? 'included' : 'not included'}.` : '');
  }
  $$('#repForm .fmt button').forEach(b => b.onclick = () => setFmt(b.dataset.fmt));
  ['#pFrom', '#pTo', '#pPhotos', '#pNotes'].forEach(s => $(s).addEventListener('change', () => { repInfo(); $('#pReady').hidden = true; repFile = null; }));
  $('#pClose').onclick = () => { $('#repDlg').close(); repFile = null; };
  $('#repToday').onclick = () => openReport(today(), today());
  $('#repRange').onclick = () => { const f = $('#rFrom').value, t = $('#rTo').value; if (!f || !t) return toast('Choose both dates'); openReport(f <= t ? f : t, f <= t ? t : f); };
  const credits = list => { const ids = new Set(); list.forEach(e => (e.codes || []).forEach(c => ids.add(c.j || 'AB'))); return PROVS.filter(p => ids.has(p.id)).map(p => `Fee codes (${p.name}): ${p.title}${p.eff ? ', ' + p.eff : ''}. ${p.credit} Code data via MedBilling Fee Desk.`); };
  $('#pMake').onclick = async () => {
    let from = $('#pFrom').value, to = $('#pTo').value; const err = $('#pErr'); err.textContent = '';
    if (!from || !to) return err.textContent = 'Choose both dates.'; if (from > to) [from, to] = [to, from];
    const btn = $('#pMake'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      let blob, name;
      if (repMode === 'audit') {
        const recs = await V.loadAudit(), chk = await V.verifyAudit();
        blob = fmt === 'csv' ? R.auditCsv(recs, from, to, { notes: $('#pNotes').checked }) : await R.auditPdf(recs, from, to, chk, { notes: $('#pNotes').checked });
        name = (from === to ? `audit-log-${from}` : `audit-log-${from}_to_${to}`) + '.' + (fmt === 'csv' ? 'csv' : 'pdf');
      } else {
        const list = R.select(S.encs, from, to), o = { photos: $('#pPhotos').checked, notes: $('#pNotes').checked, loadPhoto: id => V.loadPhoto(id), credits: credits(list), now: Date.now() };
        blob = fmt === 'csv' ? R.csv(S.encs, from, to, o.now, S.encs, o) : fmt === 'docx' ? await R.docx(S.encs, from, to, o) : await R.pdf(S.encs, from, to, o);
        name = R.fname(from, to, fmt);
      }
      repFile = new File([blob], name, { type: blob.type });
      $('#pName').textContent = repFile.name; $('#pSize').textContent = `(${Math.max(1, Math.round(repFile.size / 1024))} KB)`;
      $('#pReady').hidden = false; $('#pAck').checked = false; $('#pShare').disabled = $('#pDown').disabled = true;
      $('#pShare').hidden = !(navigator.canShare && navigator.canShare({ files: [repFile] }));
    } catch (e) { err.textContent = 'Could not create the file: ' + e.message; }
    btn.disabled = false; btn.textContent = 'Create file';
  };
  $('#pAck').onchange = () => { $('#pShare').disabled = $('#pDown').disabled = !$('#pAck').checked; };
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
  $('#pShare').onclick = async () => { if (!repFile || !$('#pAck').checked) return; const r = await shareFile(repFile, repFile.name); if (r !== 'cancelled') toast(r === 'shared' ? 'Shared' : 'Downloaded'); };
  $('#pDown').onclick = () => { if (!repFile || !$('#pAck').checked) return; download(repFile); toast('Downloaded'); };

  // ------------------------------------------------------------ settings / data
  $('#defSetting').onchange = () => { S.settings.defSetting = $('#defSetting').value; quickSet = S.settings.defSetting; setQuick(); saveSettings(); };
  $('#defProv').onchange = () => { S.settings.prov = $('#defProv').value; saveSettings(); };
  $('#warnA').onchange = () => { S.settings.warnA = +$('#warnA').value; saveSettings(); render(); };
  $('#warnR').onchange = () => { S.settings.warnR = +$('#warnR').value; saveSettings(); render(); };
  $('#autolock').onchange = () => { S.settings.autolock = +$('#autolock').value; saveSettings(); toast(`Auto-lock after ${S.settings.autolock} min`); };
  $('#chPass').onclick = async () => {
    const v = await ask({ title: 'Change passcode', text: 'All encounters and photos will be re-encrypted with the new passcode. A forgotten passcode means the data cannot be recovered.', ok: 'Change',
      fields: [{ id: 'old', label: 'Current passcode' }, { id: 'n1', label: 'New passcode (at least 6 characters)' }, { id: 'n2', label: 'Repeat new passcode' }],
      check: async v => { if (v.n1.length < 6) return 'Use at least 6 characters.'; if (v.n1 !== v.n2) return 'The new passcodes do not match.'; return (await V.rekey(v.old, v.n1)) ? '' : 'Current passcode is wrong.'; } });
    if (v) toast('Passcode changed');
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
    await migrateNotes(); render(); toast(`Imported: ${added} new, ${updated} updated, ${photos} photo(s)`, 3500);
  });
  $('#wipe').onclick = async () => {
    const v = await ask({ title: 'Delete all data', text: 'This erases every encounter, arrival/departure, call-back, photo, the whole audit log, all settings and the passcode from this device. It cannot be undone and the developer cannot recover anything. Check your retention obligations and make an encrypted backup first. Enter your passcode and type DELETE ALL to confirm.', ok: 'Delete everything', danger: true, fields: [{ id: 'p', label: 'Passcode' }, { id: 'c', label: 'Type DELETE ALL', type: 'text' }],
      check: async v => v.c.trim().toUpperCase() !== 'DELETE ALL' ? 'Type DELETE ALL to confirm.' : ((await V.verify(v.p)) ? '' : 'Wrong passcode.') });
    if (!v) return; S = null; await V.wipe(); localStorage.removeItem(failKey); lockNow('All data deleted.'); showLock('All data deleted. Create a new passcode to start again.');
  };

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
  function snack(text, fn) { $('#snackTxt').textContent = text; snackFn = fn; $('#snack').hidden = false; clearTimeout(snackT); snackT = setTimeout(hideSnack, 5000); }
  function hideSnack() { clearTimeout(snackT); snackFn = null; const n = $('#snack'); if (n) n.hidden = true; }
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
    const ne = { id: uid(), kind: 'enc', label: $('#qLabel').value.trim() || `Encounter ${n}`, initials: '', chart: '', setting: e.setting || 'H', facility: e.facility || null, type: '', codes: [], notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    await saveEnc(ne, 'create', 'Started by one-tap patient switch'); $('#qLabel').value = ''; render();
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
    if (!S) return; const now = Date.now(), a = R.periodAt(now), nx = R.periodAt(a.end + 1000), p = a.p;
    $('#pbName').textContent = p.name + (a.holiday ? ' · ' + a.holiday : '');
    $('#pbHrs').textContent = R.pHours(p);
    $('#pbLeft').textContent = `${leftTxt(a.end - now)} left → ${nx.p.name}`; $('#pbLeft').title = `Next: ${nx.p.name} from ${R.hm(a.end)}`;
    $('#pbFill').style.width = Math.min(100, Math.max(0, (now - a.start) / (a.end - a.start) * 100)).toFixed(1) + '%';
    let logged = 0;
    for (const e of S.encs) { if (kindOf(e) === 'shift' || !e.segs.some(s => s.s < a.end && (s.e == null ? now : s.e) > a.start)) continue; for (const b of R.periodSplit(e, now).blocks) if (b.t >= a.start && b.t < a.end) logged++; }
    $('#pbUnits').textContent = p.regular ? `no premium units · logged ${logged} u` : `${Math.min(p.units, Math.floor((now - a.start) / 900000))}/${p.units} u · logged ${logged} u`;
    $('#pbUnits').title = p.regular ? `Regular hours. Units logged in encounters this period: ${logged}` : `${p.units} units in this period; elapsed so far ${Math.min(p.units, Math.floor((now - a.start) / 900000))}; logged in encounters ${logged}`;
    $('#pbar').className = 'pbar p-' + p.id + (p.regular ? '' : ' prem');
  }
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
    let below = $('#tabs').getBoundingClientRect().bottom; const hd = $('#histList > .erowh');
    if (hd && getComputedStyle(hd).position === 'sticky') below += hd.offsetHeight;
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - below - 4), behavior: 'auto' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
  }
  function goDay(k) {
    if (!S.encs.some(e => R.encDay(e) === k)) return toast(`No entries on ${R.fmtDay(k)}`);
    tab = 'history'; showTab(); const el = document.getElementById('d-' + k); if (el) scrollToDay(el);
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
    const e = { id: uid(), kind: 'enc', label: $('#qLabel').value.trim() || `Encounter ${n}`, initials: '', chart: '', setting: c.set || 'H', facility: c.fac || (sh ? sh.facility : S.settings.curFac) || null, type: '', codes: clone(c.codes), notes: [], segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    await saveEnc(e, 'create', 'Started from a code set (track again)'); $('#qLabel').value = ''; tab = 'today'; showTab(); render(); toast(`Started ${e.label} · ${comboLbl(c)}`);
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
  $('#rvToday').onclick = () => openReview(today(), today());
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
  const shiftDay = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return R.dayKey(d.getTime()); };
  $('#tlPrev').onclick = () => { tlDay = shiftDay(tlDay, -1); renderTimeline(); };
  $('#tlNext').onclick = () => { tlDay = shiftDay(tlDay, 1); renderTimeline(); };
  $('#tlClose').onclick = () => $('#tlDlg').close();
  $('#tlToday').onclick = () => openTimeline(today());
  // ---- time periods and holidays in Settings (per user; verify against the current SOMB)
  function renderPeriodSettings() {
    if (!S) return; const C = R.PERIOD_CFG, y = new Date().getFullYear(), td = today(), off = new Set(S.settings.holOff || []);
    const tr = (lbl, ps) => `<tr><th colspan="3">${lbl}</th></tr>` + ps.map(p => `<tr><td>${esc(p.name)}</td><td>${R.pHours(p)}</td><td>${p.regular ? 'no premium units' : p.units + ' units'}</td></tr>`).join('');
    $('#perTable').innerHTML = `<table>${tr('Weekdays (Mon–Fri)', C.weekday)}${tr('Weekends and statutory holidays', C.weekend)}</table><p class="small muted">${esc(C.note)} Units = 15-minute blocks in each period. Encounters crossing a boundary are split by period. No fee codes are attached to periods.</p>`;
    const builtin = R.holidaysOf(y).find(h => h.date === td);
    $('#holToday').checked = (S.settings.holExtra || []).includes(td);
    $('#holTodayL').textContent = `Today (${R.fmtDay(td)}) is a statutory holiday (bill like a weekend)`;
    $('#holInfo').textContent = (builtin ? (off.has(builtin.id) ? `Today is ${builtin.name}, but you switched it off below. ` : `Today is ${builtin.name} (built in), already billed like a weekend. `) : '') + ((S.settings.holExtra || []).length ? `Days you marked: ${S.settings.holExtra.slice(-6).join(', ')}.` : '');
    $('#holYear').textContent = y;
    $('#holList').innerHTML = R.holidaysOf(y).map(h => `<label class="chk small"><input type="checkbox" data-hol="${h.id}"${off.has(h.id) ? '' : ' checked'}> <b>${esc(h.name)}</b> · ${esc(R.fmtDay(h.date))} <span class="muted">(${esc(h.rule)})</span></label>`).join('');
    $$('#holList [data-hol]').forEach(i => i.onchange = async () => {
      const s2 = new Set(S.settings.holOff || []), h = R.holidaysOf(y).find(x => x.id === i.dataset.hol); i.checked ? s2.delete(h.id) : s2.add(h.id); S.settings.holOff = [...s2];
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
  loadProvs().then(() => showLock(''));
  window.BLApp = { lockNow };
})();
