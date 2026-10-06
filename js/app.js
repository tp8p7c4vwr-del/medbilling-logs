/* Med Billing Logs - app. Encounter timers use wall-clock timestamps (not intervals), so they stay
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
  const DEF = { defSetting: 'H', autolock: 2, prov: 'AB', curFac: null, favFac: [], customFac: [], bkEvery: 30, lastBackup: 0, bkSnooze: 0 };
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
    V.lock(); S = null; cur = null;
    $$('dialog[open]').forEach(d => d.close());
    for (const u of blobUrls) URL.revokeObjectURL(u); blobUrls = [];
    ['#todayList', '#todayTotals', '#histList', '#ePhotos', '#eCodes', '#eCodeRes', '#eDxRes', '#credits', '#osList', '#deletedList', '#auditStatus', '#eLinks', '#facList', '#histBody', '#osInfo', '#lastBk', '#retInfo'].forEach(s => { const el = $(s); if (el) el.innerHTML = ''; });
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
  async function afterUnlock(first) {
    const settings = Object.assign({}, DEF, await V.loadSettings());
    const encs = await V.loadAll();
    S = { encs, settings };
    if (first) { settings.created = Date.now(); settings.respAccepted = Date.now(); await V.saveSettings(settings); }
    quickSet = settings.defSetting; lastAct = Date.now();
    document.body.classList.remove('locked'); window.scrollTo(0, 0);
    $('#defSetting').value = settings.defSetting; $('#autolock').value = String(settings.autolock);
    fillProv($('#defProv'), settings.prov);
    renderCredits(); setQuick(); render(); renderRetention(); checkBackupDue();
    if (first) toast('Passcode set. Your logs are encrypted on this device.', 3500);
    else { const d = await V.loadDraft().catch(() => null); if (d && d.cur) { await V.clearDraft(); restoreDraft(d); toast('Restored your unsaved entry', 3000); } }
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
  async function saveEnc(e, action, note) {
    const i = S.encs.findIndex(x => x.id === e.id), before = i < 0 ? null : clone(S.encs[i]);
    e.kind = kindOf(e); e.updated = Date.now();
    if (i < 0) S.encs.push(e); else S.encs[i] = e;
    await V.save(e);
    await V.appendAudit({ action: action || (before ? 'edit' : 'create'), eid: e.id, kind: e.kind, before, after: clone(e), note: note || undefined });
  }
  async function deleteEnc(e) {
    const before = S.encs.find(x => x.id === e.id);
    for (const p of (before && before.photos) || []) await V.removePhoto(p);
    await V.remove(e.id); S.encs = S.encs.filter(x => x.id !== e.id);
    await V.appendAudit({ action: 'delete', eid: e.id, kind: kindOf(e), before: before ? clone(before) : null, after: null, note: (before && (before.photos || []).length) ? `${before.photos.length} photo(s) removed with the entry` : undefined });
  }
  async function saveSettings() { await V.saveSettings(S.settings); }

  // ------------------------------------------------------------ encounters
  function setQuick() { $$('#quick .seg button').forEach(b => { const on = b.dataset.set === quickSet; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
  $$('#quick .seg button').forEach(b => b.addEventListener('click', () => { quickSet = b.dataset.set; setQuick(); }));
  $('#quick').addEventListener('submit', async ev => {
    ev.preventDefault(); if (!S) return;
    const now = Date.now(), n = S.encs.filter(e => R.encDay(e) === today()).length + 1;
    const sh = activeShift(), fac = sh ? sh.facility : S.settings.curFac;
    const e = { id: uid(), kind: 'enc', label: $('#qLabel').value.trim() || `Encounter ${n}`, initials: '', chart: '', setting: quickSet, facility: fac || null, type: '', codes: [], note: '', segs: [{ s: now, e: null }], status: 'run', photos: [], created: now, updated: now };
    await saveEnc(e, 'create'); $('#qLabel').value = ''; tab = 'today'; showTab(); render(); toast(`Started ${e.label}`);
  });
  async function act(e, a) {
    const now = Date.now();
    e = clone(e);
    const l2 = e.segs[e.segs.length - 1];
    if (a === 'pause' && l2 && l2.e == null) { l2.e = now; e.status = 'pause'; }
    else if (a === 'resume') { e.segs.push({ s: now, e: null }); e.status = 'run'; }
    else if (a === 'stop') { if (l2 && l2.e == null) l2.e = now; e.status = 'done'; }
    else return;
    await saveEnc(e, a); render();
  }
  function card(e, compact) {
    const ms = R.msOf(e), m = Math.floor(ms / 60000), u = R.units(m), st = e.status;
    const k = kindOf(e);
    const meta = [k === 'cb' ? (R.CBT[e.cbType] || 'Call-back') + (e.called ? ' · called ' + R.hm(e.called) : '') : '', e.initials, e.chart && ('#' + e.chart), e.type, (e.codes || []).map(c => c.c).join(', '), R.dxShort(e) && 'Dx ' + R.dxShort(e).replace(/; /g, ', '), k !== 'shift' && e.facility && e.facility.n, `${R.hm(R.startOf(e))}${R.endOf(e) ? '–' + R.hm(R.endOf(e)) : ''}`, k === 'cb' && (e.links || []).length ? `${e.links.length} linked` : ''].filter(Boolean).join(' · ');
    const late = e.late ? `<span class="badge late" title="Entered later${e.edits && e.edits.length ? '; last edited ' + R.tsTxt(e.edits[e.edits.length - 1]) : ''}">Entered later</span>` : '';
    const acts = st === 'run' ? `<button type="button" class="pausebtn" data-a="pause">Pause</button><button type="button" class="stopbtn" data-a="stop">Stop</button>`
      : st === 'pause' ? `<button type="button" class="resumebtn" data-a="resume">Resume</button><button type="button" class="stopbtn" data-a="stop">Stop</button>`
      : `<button type="button" class="ghost" data-a="edit">Edit</button><button type="button" class="ghost" data-a="resume">Continue</button>`;
    return `<div class="enc ${st} ${k}" data-id="${esc(e.id)}">
      <div class="r1"><span class="lbl" data-a="edit">${esc(k === 'shift' ? (e.facility ? e.facility.n : 'On site') : (e.label || (k === 'cb' ? 'Call-back' : 'Encounter')))}</span>${(e.photos || []).length ? `<span class="pc">📷 ${e.photos.length}</span>` : ''}${late}${k === 'cb' ? '<span class="badge cb">Call-back</span>' : k === 'shift' ? '<span class="badge">On site</span>' : `<span class="badge ${e.setting}">${R.SET[e.setting]}</span>`}${st !== 'done' ? `<span class="badge st ${st}">${st === 'run' ? 'Running' : 'Paused'}</span>` : ''}</div>
      <p class="meta" data-a="edit">${esc(meta)}</p>${e.note ? `<p class="note" data-a="edit">${esc(e.note)}</p>` : ''}
      <div class="timer" data-t="${esc(e.id)}">${st === 'done' ? m + ' min' : fmtDur(ms)}</div>
      <div class="units" data-u="${esc(e.id)}" data-k="${k}">${k === 'shift' ? R.hmin(m) + ' on site' : `${m} min · ${u} unit${u === 1 ? '' : 's'}`}</div>
      ${compact ? '' : `<div class="acts">${acts}</div>`}</div>`;
  }
  // compact one-line row: start time · duration · label/initials · billing code · diagnostic code (tap = details)
  const durTxt = (e, m) => kindOf(e) === 'shift' ? `${Math.floor(m / 60)}h${R.pad(m % 60)}` : `${m}m`;
  function rowHtml(e, cont) {
    const ms = R.msOf(e), m = Math.floor(ms / 60000), k = kindOf(e), st = e.status, cs = e.codes || [], dx = R.dxList(e);
    const who = k === 'shift' ? (e.facility ? e.facility.n : 'On site') : [e.label || (k === 'cb' ? 'Call-back' : 'Encounter'), e.initials].filter(Boolean).join(' · ');
    const badge = (st === 'run' ? '<i class="b run">Running</i>' : st === 'pause' ? '<i class="b pause">Paused</i>' : '') + (k === 'cb' ? '<i class="b cb">CB</i>' : k === 'shift' ? '<i class="b">On site</i>' : '') + (e.late ? '<i class="b late" title="Entered later">*</i>' : '') + ((e.photos || []).length ? `<i class="b">📷${e.photos.length}</i>` : '');
    return `<div class="erow ${st} rk-${k}" role="button" tabindex="0" data-id="${esc(e.id)}" aria-label="${esc(who)}, ${R.hm(R.startOf(e))}, open details">
      <span class="t">${R.hm(R.startOf(e))}</span><span class="du" data-rm="${esc(e.id)}" data-k="${k}">${durTxt(e, m)}</span>
      <span class="who">${esc(who)}${badge}</span>
      <span class="fc" title="${esc(cs.map(c => c.c).join(', '))}">${cs.length ? esc(cs[0].c) + (cs.length > 1 ? `<small>+${cs.length - 1}</small>` : '') : '<span class="nil">–</span>'}</span>
      <span class="dx" title="${esc(dx.join(', '))}">${dx.length ? esc(dx[0]) + (dx.length > 1 ? `<small>+${dx.length - 1}</small>` : '') : '<span class="nil">–</span>'}</span>
      ${cont ? `<button type="button" class="cont" data-a="resume" aria-label="Continue ${esc(who)}" title="Continue">▶</button>` : ''}</div>`;
  }
  const rowsHead = '<div class="erowh" aria-hidden="true"><span>Start</span><span>Time</span><span>Label · initials</span><span>Billing</span><span>Dx</span></div>';
  function bindCards(root) {
    root.querySelectorAll('.erow').forEach(el => {
      const go = ev => { const e = S && S.encs.find(x => x.id === el.dataset.id); if (!e) return; const a = ev.target.closest('[data-a]'); if (a && a.dataset.a === 'resume') { ev.stopPropagation(); return act(e, 'resume'); } openEdit(e); };
      el.addEventListener('click', go); el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(ev); } });
    });
    root.querySelectorAll('.enc').forEach(el => el.addEventListener('click', ev => {
      const a = ev.target.closest('[data-a]'); const e = S && S.encs.find(x => x.id === el.dataset.id); if (!e) return;
      if (!a || a.dataset.a === 'edit') return openEdit(e);
      act(e, a.dataset.a);
    }));
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
    $('#todayTotals').innerHTML = totHtml(S.encs.filter(e => R.encDay(e) === td));
    const live = list.filter(e => e.status !== 'done'), done = list.filter(e => e.status === 'done');
    $('#todayList').innerHTML = list.length ? live.map(e => card(e)).join('') + (done.length ? `<div class="rows">${rowsHead}${done.map(e => rowHtml(e, true)).join('')}</div>` : '') : '<div class="empty">No encounters yet today. Enter a room or bed below and tap <b>Start</b>.</div>';
    bindCards($('#todayList'));
    $('#unitsNote').textContent = R.UNITS_NOTE;
    renderHistory(); renderRetention();
    $('#storeInfo').textContent = `${S.encs.length} entr${S.encs.length === 1 ? 'y' : 'ies'} and ${S.encs.reduce((a, e) => a + (e.photos || []).length, 0)} photo(s) stored encrypted on this device.`;
  }
  function weekStart(k) { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); return R.dayKey(dt.getTime()); }
  function renderHistory() {
    const days = R.byDay(S.encs.slice().sort((a, b) => R.startOf(b) - R.startOf(a)));
    if (!days.size) { $('#histList').innerHTML = '<div class="empty">No history yet.</div>'; return; }
    const weeks = new Map(); for (const k of days.keys()) { const w = weekStart(k); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(k); }
    let h = '';
    for (const [w, ks] of weeks) {
      const all = ks.flatMap(k => days.get(k)), t = R.totals(all);
      h += `<div class="week"><div class="weekh">Week of ${esc(R.fmtDay(w))}<span>H ${t.H.m} min/${t.H.u} u · C ${t.C.m} min/${t.C.u} u${t.cb.n ? ` · CB ${t.cb.m} min` : ''}${t.site.n ? ` · on site ${R.hmin(t.site.m)}` : ''}</span></div>`;
      for (const k of ks) {
        const l = days.get(k), d = R.totals(l);
        h += `<div class="dayg"><div class="dayh"><span class="d">${esc(R.fmtDay(k))}</span><span class="t">${d.H.n + d.C.n} enc · H ${d.H.m}m/${d.H.u}u · C ${d.C.m}m/${d.C.u}u${d.cb.n ? ` · CB ${d.cb.n}/${d.cb.m}m` : ''}${d.site.n ? ` · on site ${R.hmin(d.site.m)}` : ''}</span><button type="button" class="linkbtn sm" data-rep="${k}" aria-label="Report or share ${esc(R.fmtDay(k))}">Report</button></div>`;
        h += `<div class="rows">${l.sort((a, b) => R.startOf(a) - R.startOf(b)).map(e => rowHtml(e)).join('')}</div></div>`;
      }
      h += '</div>';
    }
    $('#histList').innerHTML = rowsHead + h;
    $$('#histList [data-rep]').forEach(b => b.addEventListener('click', () => openReport(b.dataset.rep, b.dataset.rep)));
    bindCards($('#histList'));
  }
  // live tick (display only; durations always computed from timestamps)
  setInterval(() => {
    const d = new Date(); $('#clock').textContent = `${R.pad(d.getHours())}:${R.pad(d.getMinutes())}`;
    if (!S) return;
    for (const e of S.encs) { if (e.status !== 'run') continue; const ms = R.msOf(e), m = Math.floor(ms / 60000), u = R.units(m);
      $$(`[data-rm="${CSS.escape(e.id)}"]`).forEach(el => { el.textContent = durTxt(e, m); });
      $$(`[data-t="${CSS.escape(e.id)}"]`).forEach(el => { el.textContent = fmtDur(ms); });
      $$(`[data-u="${CSS.escape(e.id)}"]`).forEach(el => { el.textContent = el.dataset.k === 'shift' ? R.hmin(m) + ' on site' : `${m} min · ${u} unit${u === 1 ? '' : 's'}`; }); }
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
  $$('#editDlg .quick button').forEach(b => b.onclick = () => {
    const rows = $$('#eSegs .segrow'); if (!rows.length) return;
    if (b.dataset.end) { const r = rows[rows.length - 1]; r.querySelector('.se').value = dtLocal(Date.now()); sumSegs(); return; }
    const t = Date.now() - (+b.dataset.ago) * 60000; rows[0].querySelector('.ss').value = dtLocal(t);
    const se = rows[0].querySelector('.se'); if (se.value && parseLocal(se.value) <= t) se.value = '';
    sumSegs(); if (cur.kind === 'cb') { syncCalled(); renderLinks(); }
  });
  let calledTouched = false;
  $('#eCalled').addEventListener('input', () => { calledTouched = true; });
  function syncCalled() { if (calledTouched || !cur || cur.kind !== 'cb') return; const r = $('#eSegs .segrow .ss'); const st = r && parseLocal(r.value), c = parseLocal($('#eCalled').value); if (st && (!c || c > st)) $('#eCalled').value = dtLocal(st); }
  $('#eSegs').addEventListener('input', () => syncCalled());
  function lateText(e) { return e.late ? `Entered later${e.edits && e.edits.length ? ' · last edited ' + R.tsTxt(e.edits[e.edits.length - 1]) : ''}${e.created ? ' · created ' + R.tsTxt(e.created) : ''}` : ''; }
  function openEdit(e, fresh) {
    isNew = !!fresh; calledTouched = !fresh; cur = clone(e); cur.kind = kindOf(cur); cur.codes = cur.codes || []; cur.photos = cur.photos || []; cur.links = cur.links || []; addedPhotos = []; removedPhotos = []; overlapOk = false;
    $('#eKind').hidden = !fresh;
    $('#eLabel').value = cur.label || ''; $('#eInit').value = cur.initials || ''; $('#eChart').value = cur.chart || '';
    $('#eSetting').value = cur.setting || 'H'; $('#eSetting2').value = cur.setting || 'H'; $('#eType').value = cur.type || ''; $('#eNote').value = cur.note || '';
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
    setKind(cur.kind);
    $('#editDlg').showModal();
  }
  async function closeEdit(saved) {
    if (!saved) for (const p of addedPhotos) await V.removePhoto(p);
    cur = null; addedPhotos = []; removedPhotos = []; $('#editDlg').close();
  }
  function showRet() {
    $('.minorage').hidden = !$('#eMinor').checked;
    if (!cur) return; const age = parseInt($('#eAge').value, 10);
    const t = R.retainUntil(Object.assign({}, cur, { minor: $('#eMinor').checked, obstetric: $('#eObs').checked, minorAge: Number.isFinite(age) ? age : undefined }));
    $('#eRet').textContent = `Keep until at least ${new Date(t).toLocaleDateString()}. Nothing is deleted without your confirmation.`;
  }
  ['#eMinor', '#eObs', '#eAge'].forEach(s2 => $(s2).addEventListener('input', showRet));
  $('#eCancel').onclick = () => closeEdit(false);
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
    cur.segs = segs; cur.facility = eFac; cur.note = $('#eNote').value.trim();
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
    c.facility = eFac; c.note = $('#eNote').value;
    if (k === 'enc') { c.label = $('#eLabel').value; c.initials = $('#eInit').value; c.chart = $('#eChart').value; c.setting = $('#eSetting').value; c.type = $('#eType').value; } else c.setting = $('#eSetting2').value;
    if (k !== 'shift') { c.minor = $('#eMinor').checked; c.obstetric = $('#eObs').checked; const ag = parseInt($('#eAge').value, 10); c.minorAge = Number.isFinite(ag) ? ag : undefined; c.dx = $('#eDxQ').value; }
    if (k === 'cb') { c.cbType = $('#eCbType').value; c.called = parseLocal($('#eCalled').value); c.links = $$('#eLinks input:checked').map(i => i.value); }
    return { cur: c, isNew, addedPhotos, removedPhotos, at: Date.now() };
  }
  function restoreDraft(d) {
    const c = d.cur, dx = c.dx; delete c.dx;
    const orig = S.encs.find(x => x.id === c.id);
    if (!d.isNew && !orig) return;   // entry no longer exists
    openEdit(c, d.isNew);
    if (dx) { $('#eDxQ').value = dx; dxSync($('#eDxQ')); }
    addedPhotos = d.addedPhotos || []; removedPhotos = d.removedPhotos || [];
  }
  $('#eDelete').onclick = async () => {
    if (!cur) return; const v = await ask({ title: 'Delete entry', text: `Delete "${cur.label || 'this entry'}"${cur.photos.length ? ' and its photos' : ''}? It disappears from your logs and reports, but a full copy stays in the encrypted audit log.`, ok: 'Delete', danger: true }); if (!v || !cur) return;
    for (const p of addedPhotos) await V.removePhoto(p);
    await deleteEnc(cur); addedPhotos = []; await closeEdit(true); render(); toast('Deleted (kept in audit log)');
  };
  const blank = (k, s, e) => ({ id: uid(), kind: k, label: '', initials: '', chart: '', setting: k === 'enc' ? S.settings.defSetting : 'H', facility: (activeShift() || {}).facility || S.settings.curFac || null, type: '', codes: [], note: '', segs: [{ s, e }], status: e == null ? 'run' : 'done', photos: [], links: [], created: Date.now() });
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
    const e = { id: uid(), kind: 'shift', label: '', facility: f, setting: (f && f.set) || 'H', segs: [{ s: now, e: null }], status: 'run', note: '', codes: [], photos: [], created: now };
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
    $('#pFrom').value = from; $('#pTo').value = to; $('#pReady').hidden = true; repFile = null; $('#pErr').textContent = ''; $('#pAck').checked = false; setFmt(fmt);
    $('#repDlg').showModal();
  }
  function setFmt(f) { fmt = f; $$('#repForm .fmt button').forEach(b => { const on = b.dataset.fmt === f; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); $('#pPhotos').disabled = f === 'csv'; repInfo(); $('#pReady').hidden = true; repFile = null; }
  async function repInfo() {
    if (!S) return; const f = $('#pFrom').value || '0', t = $('#pTo').value || '9';
    if (repMode === 'audit') { const n = (await V.loadAudit()).filter(r => { const k = R.dayKey(r.ts); return k >= f && k <= t; }).length; $('#pInfo').textContent = `${n} audit record${n === 1 ? '' : 's'} in this period. The export includes the integrity check result and each record's hashes.`; return; }
    const l = R.select(S.encs, f, t), np = l.reduce((a, e) => a + (e.photos || []).length, 0), n = k => l.filter(e => kindOf(e) === k).length;
    $('#pInfo').textContent = `${n('enc')} encounter${n('enc') === 1 ? '' : 's'}, ${n('cb')} call-back${n('cb') === 1 ? '' : 's'}, ${n('shift')} on-site period${n('shift') === 1 ? '' : 's'}${np ? `, ${np} photo${np === 1 ? '' : 's'}` : ''} in this period.` + (fmt === 'csv' ? ' CSV has no photos.' : '');
  }
  $$('#repForm .fmt button').forEach(b => b.onclick = () => setFmt(b.dataset.fmt));
  ['#pFrom', '#pTo', '#pPhotos'].forEach(s => $(s).addEventListener('change', () => { repInfo(); $('#pReady').hidden = true; repFile = null; }));
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
        blob = fmt === 'csv' ? R.auditCsv(recs, from, to) : await R.auditPdf(recs, from, to, chk);
        name = (from === to ? `audit-log-${from}` : `audit-log-${from}_to_${to}`) + '.' + (fmt === 'csv' ? 'csv' : 'pdf');
      } else {
        const list = R.select(S.encs, from, to), o = { photos: $('#pPhotos').checked, loadPhoto: id => V.loadPhoto(id), credits: credits(list), now: Date.now() };
        blob = fmt === 'csv' ? R.csv(S.encs, from, to, o.now) : fmt === 'docx' ? await R.docx(S.encs, from, to, o) : await R.pdf(S.encs, from, to, o);
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
    const file = new File([JSON.stringify(b)], `med-billing-logs-backup-${today()}.mblbackup`, { type: 'application/octet-stream' });
    const go = await ask({ title: 'Backup ready', text: `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB) is encrypted with your passcode. Save it to Files or send it to yourself; without the passcode it cannot be opened.`, ok: 'Share / save' });
    if (!go) return;
    const r = await shareFile(file, file.name);
    if (r !== 'cancelled' && S) { S.settings.lastBackup = Date.now(); S.settings.bkSnooze = 0; await saveSettings(); renderRetention(); checkBackupDue(); toast(r === 'shared' ? 'Backup shared' : 'Backup downloaded'); }
  };
  $('#impAll').onclick = () => { pickStart(); $('#impFile').click(); };
  $('#impFile').addEventListener('cancel', pickEnd);
  $('#impFile').addEventListener('change', async () => {
    pickEnd(); const f = $('#impFile').files[0]; $('#impFile').value = ''; if (!f || !S) return;
    let file; try { file = JSON.parse(await f.text()); } catch (e) { return toast('That file is not a Med Billing Logs backup'); }
    if (!file || file.kind !== 'encrypted-backup') return toast('That file is not a Med Billing Logs encrypted backup');
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
    render(); toast(`Imported: ${added} new, ${updated} updated, ${photos} photo(s)`, 3500);
  });
  $('#wipe').onclick = async () => {
    const v = await ask({ title: 'Delete all data', text: 'This erases every encounter, arrival/departure, call-back, photo, the whole audit log, all settings and the passcode from this device. It cannot be undone and the developer cannot recover anything. Check your retention obligations and make an encrypted backup first. Enter your passcode and type DELETE ALL to confirm.', ok: 'Delete everything', danger: true, fields: [{ id: 'p', label: 'Passcode' }, { id: 'c', label: 'Type DELETE ALL', type: 'text' }],
      check: async v => v.c.trim().toUpperCase() !== 'DELETE ALL' ? 'Type DELETE ALL to confirm.' : ((await V.verify(v.p)) ? '' : 'Wrong passcode.') });
    if (!v) return; S = null; await V.wipe(); localStorage.removeItem(failKey); lockNow('All data deleted.'); showLock('All data deleted. Create a new passcode to start again.');
  };

  // ------------------------------------------------------------ boot
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  loadProvs().then(() => showLock(''));
  window.BLApp = { lockNow };
})();
