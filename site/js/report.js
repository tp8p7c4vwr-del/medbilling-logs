/* MedBilling Logs - shared time helpers and report builders (CSV, PDF via bundled jsPDF, Word via DocxLite). */
(function (global) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const msOf = (e, now) => e.segs.reduce((a, s) => a + Math.max(0, (s.e == null ? (now || Date.now()) : s.e) - s.s), 0);
  const minsOf = (e, now) => Math.floor(msOf(e, now) / 60000);
  // 15-minute units: full 15-min blocks, plus one more if the remainder is 8 min or more (e.g. 38 min = 3 units).
  const units = m => m <= 0 ? 0 : Math.floor(m / 15) + (m % 15 >= 8 ? 1 : 0);
  const startOf = e => e.segs.length ? e.segs[0].s : e.created;
  const endOf = e => { const l = e.segs[e.segs.length - 1]; return l ? l.e : null; };
  const encDay = e => dayKey(startOf(e));
  const SET = { H: 'Hospital', C: 'Clinic' };
  const kindOf = e => e.kind || 'enc';
  const KIND = { enc: 'Encounter', cb: 'Call-back', shift: 'On site' };
  const CBT = { return: 'Return to hospital', phone: 'Phone call-back' };
  const facTxt = e => e.facility ? e.facility.n : '';
  const hmin = m => `${Math.floor(m / 60)} h ${R2(m % 60)} min`; function R2(n) { return String(n).padStart(2, '0'); }
  const lateMark = e => e.late ? '*' : '';
  const UNITS_NOTE = 'Units = full 15-minute blocks plus 1 if the remainder is 8 minutes or more (e.g. 38 min = 3 units). Confirm time-based billing rules in your own schedule (e.g. Alberta SOMB) before submitting claims.';
  const codesTxt = e => (e.codes || []).map(c => c.c).join('; ');
  // Diagnostic codes (v2): one per fee code (c.dx), plus an entry-level e.dx when no fee code was added. Older entries have none.
  const dxList = e => { const out = []; for (const c of (e && e.codes) || []) if (c.dx && !out.includes(c.dx)) out.push(c.dx); if (e && e.dx && !out.includes(e.dx)) out.push(e.dx); return out; };
  const dxShort = e => dxList(e).join('; ');
  // export form keeps the pairing with fee codes when an entry has more than one code
  const dxTxt = e => { const cs = (e.codes || []).filter(c => c.dx), multi = (e.codes || []).length > 1; return cs.map(c => multi ? `${c.c}: ${c.dx}` : c.dx).concat(e.dx && !cs.some(c => c.dx === e.dx) ? [e.dx] : []).join('; '); };
  const fmtDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); };

  // ---------- Alberta billing time periods (v5). PER USER: verify against the current Alberta SOMB before relying on them.
  // One config object. All times are America/Edmonton local time; each period runs from `from` (inclusive) to `to` (exclusive),
  // e.g. 17-22 = 17:00-21:59. `units` = number of 15-minute blocks in the period (premium units); weekday daytime has none.
  // Statutory holidays are treated like weekends: Alberta's general holidays are calculated each year (each can be switched
  // off in Settings), plus a manual "today is a holiday" toggle. No fee codes are attached to periods.
  const PERIOD_CFG = {
    tz: 'America/Edmonton',
    note: 'Time periods per user (Alberta, America/Edmonton local time). Statutory holidays are treated like weekends. Verify against the current SOMB.',
    weekday: [
      { id: 'wd_night', name: 'Weekday overnight', short: 'Night', from: 0, to: 7, units: 28 },
      { id: 'wd_day', name: 'Weekday daytime', short: 'Day', from: 7, to: 17, units: 0, regular: true },
      { id: 'wd_eve', name: 'Weekday evening', short: 'Eve', from: 17, to: 22, units: 20 },
      { id: 'wd_late', name: 'Weekday late evening', short: 'Late', from: 22, to: 24, units: 8 }],
    weekend: [
      { id: 'we_night', name: 'Weekend/holiday overnight', short: 'WE night', from: 0, to: 7, units: 28 },
      { id: 'we_day', name: 'Weekend/holiday daytime', short: 'WE day', from: 7, to: 22, units: 60 },
      { id: 'we_late', name: 'Weekend/holiday late evening', short: 'WE late', from: 22, to: 24, units: 8 }],
    holidays: [   // Alberta general holidays, calculated for any year: [id, name, rule]
      ['newyear', "New Year's Day", 'Jan 1'], ['family', 'Alberta Family Day', '3rd Monday of February'], ['goodfri', 'Good Friday', 'Friday before Easter Sunday'],
      ['victoria', 'Victoria Day', 'Monday before May 25'], ['canada', 'Canada Day', 'Jul 1'], ['heritage', 'Heritage Day (optional in Alberta)', '1st Monday of August'],
      ['labour', 'Labour Day', '1st Monday of September'], ['ndtr', 'National Day for Truth and Reconciliation', 'Sep 30'], ['thanks', 'Thanksgiving Day', '2nd Monday of October'],
      ['remem', 'Remembrance Day', 'Nov 11'], ['xmas', 'Christmas Day', 'Dec 25']]
  };
  const PERIODS = PERIOD_CFG.weekday.concat(PERIOD_CFG.weekend), PBY = {}; PERIODS.forEach(p => { PBY[p.id] = p; });
  const hh = h => pad(h % 24) + ':00', pHours = p => `${hh(p.from)}–${pad((p.to - 1) % 24)}:59`;
  let edmFmt = null; try { edmFmt = new Intl.DateTimeFormat('en-CA', { timeZone: PERIOD_CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }); } catch (e) { edmFmt = null; }
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function edm(t) {   // wall-clock parts in America/Edmonton (falls back to device time if the zone is unavailable)
    if (!edmFmt) { const d = new Date(t); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), wd: d.getDay(), key: dayKey(t) }; }
    const o = {}; for (const p of edmFmt.formatToParts(new Date(t))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: WD.indexOf(o.weekday), key: `${o.year}-${o.month}-${o.day}` };
  }
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`, dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nthMon = (y, m, n) => { let d = 1; while (dow(y, m, d) !== 1) d++; return ymd(y, m, d + 7 * (n - 1)); };
  function goodFriday(y) {   // anonymous Gregorian computus for Easter Sunday, minus 2 days
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1, t = new Date(Date.UTC(y, mo - 1, da - 2));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const HOL_RULE = { newyear: y => ymd(y, 1, 1), family: y => nthMon(y, 2, 3), goodfri: goodFriday, victoria: y => { let d = 24; while (dow(y, 5, d) !== 1) d--; return ymd(y, 5, d); }, canada: y => ymd(y, 7, 1),
    heritage: y => nthMon(y, 8, 1), labour: y => nthMon(y, 9, 1), ndtr: y => ymd(y, 9, 30), thanks: y => nthMon(y, 10, 2), remem: y => ymd(y, 11, 11), xmas: y => ymd(y, 12, 25) };
  function holidaysOf(y) { return PERIOD_CFG.holidays.map(([id, name, rule]) => ({ id, name, rule, date: HOL_RULE[id](y) })); }
  let HOL = { off: new Set(), extra: new Set(), ver: 0 }; const holCache = new Map();
  function setHolidays(o) { HOL = { off: new Set((o && o.off) || []), extra: new Set((o && o.extra) || []), ver: HOL.ver + 1 }; holCache.clear(); splitCache.clear(); }
  function holidayName(key) {   // name if this Edmonton day key is a holiday (built-in and switched on, or marked by the user)
    if (!holCache.has(key)) { const h = holidaysOf(+key.slice(0, 4)).find(x => x.date === key && !HOL.off.has(x.id)); holCache.set(key, h ? h.name : (HOL.extra.has(key) ? 'Holiday (marked by you)' : '')); }
    return holCache.get(key);
  }
  function periodAt(t) {   // the period instance containing t: {p, start, end, weekend, holiday}
    const w = edm(t), hol = holidayName(w.key), we = w.wd === 0 || w.wd === 6 || !!hol;
    const p = (we ? PERIOD_CFG.weekend : PERIOD_CFG.weekday).find(x => w.h >= x.from && w.h < x.to);
    const fix = (ts, hour) => { for (const adj of [0, -3600000, 3600000]) { const v = edm(ts + adj); if (v.h === hour % 24 && v.mi === 0) return ts + adj; } return ts; };   // DST
    const start = fix(t - (((w.h - p.from) * 60 + w.mi) * 60 + w.s) * 1000 - (t % 1000), p.from), end = fix(start + (p.to - p.from) * 3600000, p.to);
    return { p, start, end, weekend: we, holiday: hol };
  }
  // Split an entry's minutes and 15-minute units by period. Minutes follow the clock; each unit block (same rule as the
  // entry's units) is placed in the period that holds the middle of that block, so the parts always add up to the entry's total.
  const splitCache = new Map();
  function periodSplit(e, now) {
    if (!e || !e.segs || kindOf(e) === 'shift') return { parts: [], blocks: [] };
    const open = e.segs.some(s => s.e == null), ck = !open && `${e.id}|${e.updated || 0}|${JSON.stringify(e.segs)}`;
    if (ck && splitCache.has(ck)) return splitCache.get(ck);
    const T = now || Date.now(), iv = e.segs.map(s => [s.s, s.e == null ? T : s.e]).filter(x => x[1] > x[0]), by = new Map();
    const get = id => { if (!by.has(id)) by.set(id, { id, ms: 0, m: 0, u: 0 }); return by.get(id); };
    for (const [a, b] of iv) { let c = a; while (c < b) { const pa = periodAt(c), x = Math.min(b, pa.end > c ? pa.end : b); get(pa.p.id).ms += x - c; c = x; } }
    const m = Math.floor(iv.reduce((s2, x) => s2 + x[1] - x[0], 0) / 60000), parts = [...by.values()];
    // minutes: largest remainder, so the parts add up to the entry's whole minutes
    let left = m; parts.forEach(p => { p.m = Math.floor(p.ms / 60000); left -= p.m; });
    parts.slice().sort((x, y) => (y.ms % 60000) - (x.ms % 60000)).forEach(p => { if (left > 0 && p.ms % 60000) { p.m++; left--; } });
    const at = off => { let r = off * 60000; for (const [a, b] of iv) { if (r < b - a) return a + r; r -= b - a; } const l = iv[iv.length - 1]; return l ? l[1] - 1 : T; };
    const blocks = [], full = Math.floor(m / 15);
    for (let k = 0; k < full; k++) blocks.push(at(15 * k + 7.5));
    if (m % 15 >= 8) blocks.push(at((15 * full + m) / 2));
    const bl = blocks.map(t => { const id = periodAt(t).p.id; get(id).u++; return { t, id }; });
    const out = { parts: [...by.values()].filter(p => p.m || p.u), blocks: bl };
    if (ck) { if (splitCache.size > 4000) splitCache.clear(); splitCache.set(ck, out); }
    return out;
  }
  const perTxt = (parts, short) => parts.map(p => `${short ? PBY[p.id].short : PBY[p.id].name} ${p.m} min/${p.u} u`).join('; ');
  const perLegend = () => 'Time periods (per user; verify against the current SOMB; America/Edmonton time): ' + PERIODS.map(p => `${p.short} = ${p.name} ${pHours(p)}${p.regular ? ' (no premium units)' : ` (${p.units} units)`}`).join('; ') + '. Statutory holidays count as weekends.';
  function select(encs, from, to, kind) {
    return encs.filter(e => { const k = encDay(e); return k >= from && k <= to && (!kind || kindOf(e) === kind); }).sort((a, b) => startOf(a) - startOf(b));
  }
  function totals(list, now) {
    const t = { H: { m: 0, u: 0, n: 0 }, C: { m: 0, u: 0, n: 0 }, cb: { m: 0, u: 0, n: 0 }, site: { m: 0, n: 0 }, per: {} };
    for (const e of list) {
      const m = minsOf(e, now), k = kindOf(e);
      if (k === 'shift') { t.site.m += m; t.site.n++; continue; }
      const x = k === 'cb' ? t.cb : (t[e.setting] || t.H); x.m += m; x.u += units(m); x.n++;
      for (const p of periodSplit(e, now).parts) { const q = t.per[p.id] || (t.per[p.id] = { id: p.id, m: 0, u: 0 }); q.m += p.m; q.u += p.u; }
    }
    t.perList = PERIODS.map(p => t.per[p.id]).filter(Boolean);
    return t;
  }
  const totTxt = t => `Hospital ${t.H.n} enc, ${t.H.m} min, ${t.H.u} units · Clinic ${t.C.n} enc, ${t.C.m} min, ${t.C.u} units` + (t.cb.n ? ` · Call-backs ${t.cb.n}, ${t.cb.m} min` : '') + (t.site.n ? ` · On site ${hmin(t.site.m)}` : '') + (t.perList && t.perList.length ? ` · Time periods: ${perTxt(t.perList)}` : '');
  const byDay = list => { const m = new Map(); for (const e of list) { const k = encDay(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return m; };
  const title = (from, to) => from === to ? `Billing log ${from}` : `Billing log ${from} to ${to}`;
  const fname = (from, to, ext) => (from === to ? `billing-log-${from}` : `billing-log-${from}_to_${to}`) + '.' + ext;
  function row(e, now) {
    const m = minsOf(e, now), en = endOf(e);
    return { start: hm(startOf(e)) + lateMark(e), end: en == null ? (kindOf(e) === 'shift' ? 'on site' : 'running') : hm(en), min: String(m), units: String(units(m)), set: [SET[e.setting] || '', facTxt(e)].filter(Boolean).join(', '), room: e.label || '', init: e.initials || '', chart: e.chart || '', type: e.type || '',
      codes: (e.codes || []).map(c => c.c + (c.f ? ` (${c.f})` : '')).join('; '), dx: dxTxt(e), per: perTxt(periodSplit(e, now).parts, true), note: e.note || '', fac: facTxt(e), cbt: CBT[e.cbType] || '', called: e.called ? hm(e.called) : '', site: hmin(m) };
  }
  // ---------- CSV
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv(encs, from, to, now, all) {
    const head = ['date', 'kind', 'facility', 'zone', 'label', 'initials', 'chart', 'setting', 'type', 'callback_type', 'called', 'codes', 'diagnostic_code', 'start', 'end', 'minutes', 'units', 'time_periods'].concat(PERIODS.flatMap(p => [p.id + '_min', p.id + '_units']), ['linked', 'entered_later', 'last_edited', 'note']);
    const lines = [head.join(',')], iso = ts => { if (ts == null) return ''; const d = new Date(ts); return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const byId = new Map((all || encs).map(e => [e.id, e]));
    for (const e of select(encs, from, to)) {
      const m = minsOf(e, now), en = endOf(e), k = kindOf(e);
      const linked = (e.links || []).map(id => byId.get(id)).filter(Boolean).map(x => `${x.label} ${hm(startOf(x))}`).join('; ');
      const ps = periodSplit(e, now).parts, pv = PERIODS.flatMap(p => { const q = ps.find(x => x.id === p.id); return k === 'shift' ? ['', ''] : [q ? q.m : 0, q ? q.u : 0]; });
      lines.push([encDay(e), KIND[k], facTxt(e), e.facility ? e.facility.z : '', e.label, e.initials, e.chart, SET[e.setting], e.type, CBT[e.cbType] || '', iso(e.called), codesTxt(e), dxTxt(e), iso(startOf(e)), iso(en), m, k === 'shift' ? '' : units(m), perTxt(ps)].concat(pv, [linked, e.late ? 'yes' : 'no', e.edits && e.edits.length ? iso(e.edits[e.edits.length - 1]) : '', e.note]).map(csvCell).join(','));
    }
    return new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  }
  // ---------- photos helper
  async function photoList(e, loadPhoto) {
    const out = [];
    for (const id of e.photos || []) {
      const b = await loadPhoto(id); if (!b) continue;
      const dim = await new Promise(res => { const u = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); const im = new Image(); im.onload = () => { res([im.naturalWidth, im.naturalHeight]); URL.revokeObjectURL(u); }; im.onerror = () => { res([800, 600]); URL.revokeObjectURL(u); }; im.src = u; });
      out.push({ bytes: b, w: dim[0], h: dim[1] });
    }
    return out;
  }
  const encCap = e => [e.label, e.initials, e.chart, hm(startOf(e))].filter(Boolean).join(' · ');
  const CONF = 'CONFIDENTIAL: may contain patient information. Share only through secure, authorized channels.';
  const LATE_NOTE = '* Entered later (back-dated or times edited after the fact); see the audit log for the full history.';
  const linkTxt = (e, byId) => (e.links || []).map(id => byId.get(id)).filter(Boolean).map(x => `${x.label} ${hm(startOf(x))}`).join('; ');
  // ---------- DOCX
  async function docx(encs, from, to, o) {
    const list = select(encs, from, to), now = o.now || Date.now(), blocks = [];
    blocks.push({ t: 'h1', text: title(from, to) });
    blocks.push({ t: 'small', text: `Generated ${new Date(now).toLocaleString()} by MedBilling Logs. ${CONF}` });
    blocks.push({ t: 'p', bold: true, text: 'Totals: ' + totTxt(totals(list, now)) });
    const W = [640, 640, 500, 520, 700, 780, 600, 860, 700, 1200, 1000, 1100, 1060];
    const byId = new Map(encs.map(e => [e.id, e]));
    for (const [k, l] of byDay(list)) {
      blocks.push({ t: 'h2', text: fmtDay(k) });
      blocks.push({ t: 'small', text: totTxt(totals(l, now)) });
      const en = l.filter(e => kindOf(e) === 'enc'), cb = l.filter(e => kindOf(e) === 'cb'), sh = l.filter(e => kindOf(e) === 'shift');
      if (sh.length) { blocks.push({ t: 'p', bold: true, text: 'On site (arrival / departure)' }); blocks.push({ t: 'table', head: ['Facility', 'Setting', 'Arrival', 'Departure', 'Time on site', 'Note'], widths: [3000, 1000, 900, 900, 1300, 3140], rows: sh.map(e => { const r = row(e, now); return [r.fac, SET[e.setting] || '', r.start, r.end, r.site, r.note]; }) }); }
      if (en.length) { blocks.push({ t: 'p', bold: true, text: 'Encounters' }); blocks.push({ t: 'table', head: ['Start', 'End', 'Min', 'Units', 'Setting', 'Room/bed', 'Initials', 'Chart/MRN', 'Type', 'Codes', 'Diagnostic code', 'Time periods', 'Note'], widths: W, rows: en.map(e => { const r = row(e, now); return [r.start, r.end, r.min, r.units, r.set, r.room, r.init, r.chart, r.type, r.codes, r.dx, r.per, r.note]; }) }); }
      if (cb.length) { blocks.push({ t: 'p', bold: true, text: 'Call-backs' }); blocks.push({ t: 'table', head: ['Type', 'Called', 'Arrival', 'Departure', 'Min', 'Units', 'Facility', 'Codes', 'Diagnostic code', 'Time periods', 'Linked encounters', 'Note'], widths: [1000, 600, 650, 700, 480, 520, 1100, 1100, 1000, 1100, 1100, 1090], rows: cb.map(e => { const r = row(e, now); return [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.codes, r.dx, r.per, linkTxt(e, byId), r.note]; }) }); }
    }
    if (list.some(e => e.late)) blocks.push({ t: 'small', text: LATE_NOTE });
    if (!list.length) blocks.push({ t: 'p', text: 'No encounters in this period.' });
    if (o.photos) {
      const withP = list.filter(e => (e.photos || []).length);
      if (withP.length) blocks.push({ t: 'h2', text: 'Photos' });
      for (const e of withP) { const ps = await photoList(e, o.loadPhoto); ps.forEach((p, i) => blocks.push({ t: 'img', bytes: p.bytes, w: p.w, h: p.h, maxIn: 4, caption: `${encDay(e)} · ${encCap(e)} (${i + 1}/${ps.length})` })); }
    }
    blocks.push({ t: 'small', text: UNITS_NOTE });
    blocks.push({ t: 'small', text: perLegend() });
    for (const c of o.credits || []) blocks.push({ t: 'small', italic: true, text: c });
    return new Blob([global.DocxLite.build({ title: title(from, to), blocks })], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  // ---------- PDF (landscape letter)
  const latin = s => String(s == null ? '' : s).replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...').replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
  async function pdf(encs, from, to, o) {
    const { jsPDF } = global.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const list = select(encs, from, to), now = o.now || Date.now();
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 36; let y = M;
    const foot = () => { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(110); doc.text(latin(`${title(from, to)} · ${CONF} · Page ${i} of ${n}`), M, PH - 18); } };
    const need = h => { if (y + h > PH - M) { doc.addPage(); y = M; return true; } return false; };
    const text = (s, size, opt) => { opt = opt || {}; doc.setFont('helvetica', opt.bold ? 'bold' : (opt.italic ? 'italic' : 'normal')); doc.setFontSize(size); doc.setTextColor(...(opt.color || [31, 41, 51])); const ls = doc.splitTextToSize(latin(s), PW - 2 * M); const lh = size * 1.25; for (const l of ls) { need(lh); doc.text(l, M, y + size); y += lh; } y += opt.after || 2; };
    text(title(from, to), 18, { bold: true, color: [17, 94, 89], after: 2 });
    text(`Generated ${new Date(now).toLocaleString()} by MedBilling Logs. ${CONF}`, 8, { color: [100, 116, 139], after: 6 });
    text('Totals: ' + totTxt(totals(list, now)), 10, { bold: true, after: 6 });
    const fit = cs => { const used = cs.reduce((a, c) => a + c[1], 0); cs[cs.length - 1][1] = PW - 2 * M - used; return cs; };
    const C_ENC = fit([['Start', 40], ['End', 44], ['Min', 30], ['Units', 32], ['Setting', 66], ['Room/bed', 56], ['Initials', 40], ['Chart/MRN', 60], ['Type', 48], ['Codes', 94], ['Diagnostic code', 70], ['Time periods', 84], ['Note', 0]]);
    const C_CB = fit([['Type', 76], ['Called', 38], ['Arrival', 42], ['Departure', 50], ['Min', 30], ['Units', 32], ['Facility', 80], ['Codes', 84], ['Diagnostic code', 70], ['Time periods', 84], ['Linked', 80], ['Note', 0]]);
    const C_SH = fit([['Facility', 220], ['Setting', 60], ['Arrival', 60], ['Departure', 60], ['Time on site', 80], ['Note', 0]]);
    let cols = C_ENC;
    const drawRow = (cells, head) => {
      doc.setFont('helvetica', head ? 'bold' : 'normal'); doc.setFontSize(8);
      const wrapped = cells.map((c, i) => doc.splitTextToSize(latin(c), cols[i][1] - 6)); const h = Math.max(...wrapped.map(w => w.length)) * 10 + 6;
      if (need(h) && !head) drawRow(cols.map(c => c[0]), true);
      doc.setFont('helvetica', head ? 'bold' : 'normal'); doc.setFontSize(8);
      if (head) { doc.setFillColor(230, 243, 242); doc.rect(M, y, PW - 2 * M, h, 'F'); }
      doc.setDrawColor(217, 222, 229); doc.setTextColor(31, 41, 51); let x = M;
      wrapped.forEach((w, i) => { doc.rect(x, y, cols[i][1], h); doc.text(w, x + 3, y + 10); x += cols[i][1]; });
      y += h;
    };
    const byId = new Map(encs.map(e => [e.id, e]));
    const section = (label, cs, items, cells) => { if (!items.length) return; cols = cs; need(40); text(label, 9, { bold: true, after: 1 }); drawRow(cols.map(c => c[0]), true); for (const e of items) drawRow(cells(row(e, now), e)); y += 6; };
    for (const [k, l] of byDay(list)) {
      need(60); y += 6; text(fmtDay(k), 12, { bold: true, color: [17, 94, 89], after: 0 }); text(totTxt(totals(l, now)), 8, { color: [100, 116, 139], after: 3 });
      section('On site (arrival / departure)', C_SH, l.filter(e => kindOf(e) === 'shift'), (r, e) => [r.fac, SET[e.setting] || '', r.start, r.end, r.site, r.note]);
      section('Encounters', C_ENC, l.filter(e => kindOf(e) === 'enc'), r => [r.start, r.end, r.min, r.units, r.set, r.room, r.init, r.chart, r.type, r.codes, r.dx, r.per, r.note]);
      section('Call-backs', C_CB, l.filter(e => kindOf(e) === 'cb'), (r, e) => [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.codes, r.dx, r.per, linkTxt(e, byId), r.note]);
    }
    if (list.some(e => e.late)) text(LATE_NOTE, 7.5, { color: [100, 116, 139] });
    if (!list.length) text('No encounters in this period.', 10);
    if (o.photos) {
      const withP = list.filter(e => (e.photos || []).length);
      if (withP.length) { y += 8; text('Photos', 12, { bold: true, color: [17, 94, 89] }); }
      for (const e of withP) {
        const ps = await photoList(e, o.loadPhoto);
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i], maxW = 330, maxH = PH - 2 * M - 30; const s = Math.min(maxW / p.w, maxH / p.h, 1); const w = p.w * s, h = p.h * s;
          need(h + 20); doc.addImage(p.bytes, 'JPEG', M, y, w, h); y += h + 2; text(`${encDay(e)} · ${encCap(e)} (${i + 1}/${ps.length})`, 8, { color: [100, 116, 139], after: 8 });
        }
      }
    }
    y += 6; text(UNITS_NOTE, 7.5, { color: [100, 116, 139] }); text(perLegend(), 7.5, { color: [100, 116, 139] });
    for (const c of o.credits || []) text(c, 7, { italic: true, color: [100, 116, 139] });
    foot();
    return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
  }
  // ---------- audit log export
  const ACT = { create: 'Created', start: 'Started', pause: 'Paused', resume: 'Resumed', stop: 'Stopped', arrive: 'Arrived', depart: 'Departed', edit: 'Edited', delete: 'Deleted', import: 'Imported', purge: 'Removed (retention)', 'prune-log': 'Log trimmed (retention)', review: 'Reviewed', unreview: 'Review cleared', restore: 'Restored (undo)', undo: 'Undone', 'fav-add': 'Code set saved', 'fav-remove': 'Code set removed', holiday: 'Holiday settings changed' };
  const summ = o => o ? [KIND[kindOf(o)], o.label || facTxt(o), o.initials, o.chart, (o.segs || []).map(s => hm(s.s) + '-' + (s.e == null ? '…' : hm(s.e))).join(' '), codesTxt(o), dxTxt(o) && 'Dx ' + dxTxt(o)].filter(Boolean).join(' | ') : '';
  function diff(b, a) {
    if (!b || !a) return [];
    const keys = ['label', 'initials', 'chart', 'setting', 'type', 'note', 'cbType', 'called', 'status', 'minor', 'minorAge', 'obstetric', 'late'], out = [];
    const nv = v => (v == null || v === false) ? '' : v;
    for (const k of keys) if (JSON.stringify(nv(b[k])) !== JSON.stringify(nv(a[k]))) out.push(`${k}: ${k === 'called' ? (b[k] ? hm(b[k]) : '') : (b[k] ?? '')} -> ${k === 'called' ? (a[k] ? hm(a[k]) : '') : (a[k] ?? '')}`);
    const st = o => (o.segs || []).map(s => `${dayKey(s.s)} ${hm(s.s)}-${s.e == null ? 'open' : hm(s.e)}`).join(', ');
    if (st(b) !== st(a)) out.push(`times: ${st(b)} -> ${st(a)}`);
    if (codesTxt(b) !== codesTxt(a)) out.push(`codes: ${codesTxt(b)} -> ${codesTxt(a)}`);
    if (dxTxt(b) !== dxTxt(a)) out.push(`diagnostic codes: ${dxTxt(b)} -> ${dxTxt(a)}`);
    if (facTxt(b) !== facTxt(a)) out.push(`facility: ${facTxt(b)} -> ${facTxt(a)}`);
    if ((b.photos || []).length !== (a.photos || []).length) out.push(`photos: ${(b.photos || []).length} -> ${(a.photos || []).length}`);
    if (JSON.stringify(b.links || []) !== JSON.stringify(a.links || [])) out.push(`linked: ${(b.links || []).length} -> ${(a.links || []).length}`);
    return out;
  }
  const auditSel = (recs, from, to) => recs.filter(r => { const k = dayKey(r.ts); return k >= from && k <= to; });
  const tsTxt = ts => { const d = new Date(ts); return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  function auditCsv(recs, from, to) {
    const lines = [['seq', 'time', 'action', 'entry_id', 'kind', 'changes', 'before', 'after', 'prev_hash', 'hash'].join(',')];
    for (const r of auditSel(recs, from, to)) lines.push([r.seq, tsTxt(r.ts), ACT[r.action] || r.action, r.eid || '', KIND[r.kind] || '', diff(r.before, r.after).join('; ') || r.note || '', JSON.stringify(r.before || null), JSON.stringify(r.after || null), r.prev, r.hash].map(csvCell).join(','));
    return new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  }
  async function auditPdf(recs, from, to, check) {
    const { jsPDF } = global.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), M = 36; let y = M;
    const need = h => { if (y + h > PH - M) { doc.addPage(); y = M; } };
    const text = (s, size, opt) => { opt = opt || {}; doc.setFont('helvetica', opt.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(opt.color || [31, 41, 51])); for (const l of doc.splitTextToSize(latin(s), PW - 2 * M - (opt.indent || 0))) { need(size * 1.25); doc.text(l, M + (opt.indent || 0), y + size); y += size * 1.25; } y += opt.after || 2; };
    text(from === to ? `Audit log ${from}` : `Audit log ${from} to ${to}`, 16, { bold: true, color: [17, 94, 89] });
    text(`Generated ${new Date().toLocaleString()} by MedBilling Logs. ${CONF}`, 8, { color: [100, 116, 139] });
    text(check.ok ? `Log integrity: INTACT. ${check.count} records, hash chain verified (SHA-256). Last hash ${check.last || '-'}.` : `Log integrity: PROBLEMS FOUND: ${check.problems.join('; ')}`, 9, { bold: true, color: check.ok ? [17, 94, 89] : [185, 28, 28], after: 8 });
    const list = auditSel(recs, from, to);
    if (!list.length) text('No audit records in this period.', 10);
    for (const r of list) {
      need(40); text(`#${r.seq}  ${tsTxt(r.ts)}  ${ACT[r.action] || r.action}  ${KIND[r.kind] || ''}`, 9, { bold: true, after: 0 });
      const d = diff(r.before, r.after);
      if (r.action === 'create' || r.action === 'import') text('New: ' + summ(r.after), 8, { indent: 12, after: 0 });
      else if (r.action === 'delete') text('Deleted (kept in log): ' + summ(r.before), 8, { indent: 12, after: 0 });
      else if (d.length) d.forEach(x => text(x, 8, { indent: 12, after: 0 }));
      if (r.note) text(r.note, 8, { indent: 12, after: 0 });
      text(`prev ${r.prev}  hash ${r.hash}`, 6.5, { indent: 12, color: [100, 116, 139], after: 4 });
    }
    const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(110); doc.text(latin(`Audit log · ${CONF} · Page ${i} of ${n}`), M, PH - 18); }
    return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
  }
  // Retention (never automatic): adult 10 y from last entry (CPSA/CMPA); minor: longer of 10 y or 2 y after 18th birthday (CPSA);
  // obstetric: 10 y after the infant reaches majority (CMPA), counted conservatively as 1 + 18 + 10 = 29 y from the last entry.
  const addY = (ts, y) => { const d = new Date(ts); d.setFullYear(d.getFullYear() + y); return d.getTime(); };
  function retainUntil(e) {
    if (!e || !e.segs) return 0;
    const last = Math.max(...e.segs.map(s => s.e == null ? Date.now() : s.e), e.called || 0, e.updated || 0);
    let t = addY(last, 10);
    if (e.minor) { const age = Number.isFinite(e.minorAge) ? e.minorAge : 0; t = Math.max(t, addY(last, (18 - age) + 1 + 2)); }
    if (e.obstetric) t = Math.max(t, addY(last, 29));
    return t;
  }
  const RET_RULE = 'Retention: 10 years from the last entry; minors: the longer of 10 years or 2 years after age 18 (CPSA); obstetric: 10 years after the infant reaches majority (CMPA). Nothing is removed without your confirmation.';
  global.BLR = { PERIOD_CFG, PERIODS, PBY, pHours, edm, periodAt, periodSplit, perTxt, perLegend, holidaysOf, holidayName, setHolidays, dxList, dxShort, dxTxt, codesTxt, retainUntil, RET_RULE, addY, kindOf, KIND, CBT, ACT, diff, summ, auditCsv, auditPdf, hmin, tsTxt, pad, dayKey, hm, msOf, minsOf, units, startOf, endOf, encDay, SET, UNITS_NOTE, fmtDay, select, totals, byDay, title, fname, csv, docx, pdf, csvCell };
})(window);
