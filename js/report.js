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
  function select(encs, from, to, kind) {
    return encs.filter(e => { const k = encDay(e); return k >= from && k <= to && (!kind || kindOf(e) === kind); }).sort((a, b) => startOf(a) - startOf(b));
  }
  function totals(list, now) {
    const t = { H: { m: 0, u: 0, n: 0 }, C: { m: 0, u: 0, n: 0 }, cb: { m: 0, u: 0, n: 0 }, site: { m: 0, n: 0 } };
    for (const e of list) {
      const m = minsOf(e, now), k = kindOf(e);
      if (k === 'shift') { t.site.m += m; t.site.n++; continue; }
      const x = k === 'cb' ? t.cb : (t[e.setting] || t.H); x.m += m; x.u += units(m); x.n++;
    }
    return t;
  }
  const totTxt = t => `Hospital ${t.H.n} enc, ${t.H.m} min, ${t.H.u} units · Clinic ${t.C.n} enc, ${t.C.m} min, ${t.C.u} units` + (t.cb.n ? ` · Call-backs ${t.cb.n}, ${t.cb.m} min` : '') + (t.site.n ? ` · On site ${hmin(t.site.m)}` : '');
  const byDay = list => { const m = new Map(); for (const e of list) { const k = encDay(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return m; };
  const title = (from, to) => from === to ? `Billing log ${from}` : `Billing log ${from} to ${to}`;
  const fname = (from, to, ext) => (from === to ? `billing-log-${from}` : `billing-log-${from}_to_${to}`) + '.' + ext;
  function row(e, now) {
    const m = minsOf(e, now), en = endOf(e);
    return { start: hm(startOf(e)) + lateMark(e), end: en == null ? (kindOf(e) === 'shift' ? 'on site' : 'running') : hm(en), min: String(m), units: String(units(m)), set: [SET[e.setting] || '', facTxt(e)].filter(Boolean).join(', '), room: e.label || '', init: e.initials || '', chart: e.chart || '', type: e.type || '',
      codes: (e.codes || []).map(c => c.c + (c.f ? ` (${c.f})` : '')).join('; '), dx: dxTxt(e), note: e.note || '', fac: facTxt(e), cbt: CBT[e.cbType] || '', called: e.called ? hm(e.called) : '', site: hmin(m) };
  }
  // ---------- CSV
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv(encs, from, to, now, all) {
    const head = ['date', 'kind', 'facility', 'zone', 'label', 'initials', 'chart', 'setting', 'type', 'callback_type', 'called', 'codes', 'diagnostic_code', 'start', 'end', 'minutes', 'units', 'linked', 'entered_later', 'last_edited', 'note'];
    const lines = [head.join(',')], iso = ts => { if (ts == null) return ''; const d = new Date(ts); return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const byId = new Map((all || encs).map(e => [e.id, e]));
    for (const e of select(encs, from, to)) {
      const m = minsOf(e, now), en = endOf(e), k = kindOf(e);
      const linked = (e.links || []).map(id => byId.get(id)).filter(Boolean).map(x => `${x.label} ${hm(startOf(x))}`).join('; ');
      lines.push([encDay(e), KIND[k], facTxt(e), e.facility ? e.facility.z : '', e.label, e.initials, e.chart, SET[e.setting], e.type, CBT[e.cbType] || '', iso(e.called), codesTxt(e), dxTxt(e), iso(startOf(e)), iso(en), m, k === 'shift' ? '' : units(m), linked, e.late ? 'yes' : 'no', e.edits && e.edits.length ? iso(e.edits[e.edits.length - 1]) : '', e.note].map(csvCell).join(','));
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
    const W = [640, 640, 500, 520, 860, 900, 600, 1000, 860, 1300, 1000, 1420];
    const byId = new Map(encs.map(e => [e.id, e]));
    for (const [k, l] of byDay(list)) {
      blocks.push({ t: 'h2', text: fmtDay(k) });
      blocks.push({ t: 'small', text: totTxt(totals(l, now)) });
      const en = l.filter(e => kindOf(e) === 'enc'), cb = l.filter(e => kindOf(e) === 'cb'), sh = l.filter(e => kindOf(e) === 'shift');
      if (sh.length) { blocks.push({ t: 'p', bold: true, text: 'On site (arrival / departure)' }); blocks.push({ t: 'table', head: ['Facility', 'Setting', 'Arrival', 'Departure', 'Time on site', 'Note'], widths: [3000, 1000, 900, 900, 1300, 3140], rows: sh.map(e => { const r = row(e, now); return [r.fac, SET[e.setting] || '', r.start, r.end, r.site, r.note]; }) }); }
      if (en.length) { blocks.push({ t: 'p', bold: true, text: 'Encounters' }); blocks.push({ t: 'table', head: ['Start', 'End', 'Min', 'Units', 'Setting', 'Room/bed', 'Initials', 'Chart/MRN', 'Type', 'Codes', 'Diagnostic code', 'Note'], widths: W, rows: en.map(e => { const r = row(e, now); return [r.start, r.end, r.min, r.units, r.set, r.room, r.init, r.chart, r.type, r.codes, r.dx, r.note]; }) }); }
      if (cb.length) { blocks.push({ t: 'p', bold: true, text: 'Call-backs' }); blocks.push({ t: 'table', head: ['Type', 'Called', 'Arrival', 'Departure', 'Min', 'Units', 'Facility', 'Codes', 'Diagnostic code', 'Linked encounters', 'Note'], widths: [1000, 600, 650, 700, 480, 520, 1300, 1300, 1000, 1300, 1390], rows: cb.map(e => { const r = row(e, now); return [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.codes, r.dx, linkTxt(e, byId), r.note]; }) }); }
    }
    if (list.some(e => e.late)) blocks.push({ t: 'small', text: LATE_NOTE });
    if (!list.length) blocks.push({ t: 'p', text: 'No encounters in this period.' });
    if (o.photos) {
      const withP = list.filter(e => (e.photos || []).length);
      if (withP.length) blocks.push({ t: 'h2', text: 'Photos' });
      for (const e of withP) { const ps = await photoList(e, o.loadPhoto); ps.forEach((p, i) => blocks.push({ t: 'img', bytes: p.bytes, w: p.w, h: p.h, maxIn: 4, caption: `${encDay(e)} · ${encCap(e)} (${i + 1}/${ps.length})` })); }
    }
    blocks.push({ t: 'small', text: UNITS_NOTE });
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
    const C_ENC = fit([['Start', 40], ['End', 44], ['Min', 30], ['Units', 32], ['Setting', 80], ['Room/bed', 58], ['Initials', 42], ['Chart/MRN', 64], ['Type', 56], ['Codes', 110], ['Diagnostic code', 72], ['Note', 0]]);
    const C_CB = fit([['Type', 80], ['Called', 40], ['Arrival', 44], ['Departure', 52], ['Min', 30], ['Units', 32], ['Facility', 100], ['Codes', 100], ['Diagnostic code', 72], ['Linked', 100], ['Note', 0]]);
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
      section('Encounters', C_ENC, l.filter(e => kindOf(e) === 'enc'), r => [r.start, r.end, r.min, r.units, r.set, r.room, r.init, r.chart, r.type, r.codes, r.dx, r.note]);
      section('Call-backs', C_CB, l.filter(e => kindOf(e) === 'cb'), (r, e) => [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.codes, r.dx, linkTxt(e, byId), r.note]);
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
    y += 6; text(UNITS_NOTE, 7.5, { color: [100, 116, 139] });
    for (const c of o.credits || []) text(c, 7, { italic: true, color: [100, 116, 139] });
    foot();
    return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
  }
  // ---------- audit log export
  const ACT = { create: 'Created', start: 'Started', pause: 'Paused', resume: 'Resumed', stop: 'Stopped', arrive: 'Arrived', depart: 'Departed', edit: 'Edited', delete: 'Deleted', import: 'Imported', purge: 'Removed (retention)', 'prune-log': 'Log trimmed (retention)' };
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
  global.BLR = { dxList, dxShort, dxTxt, codesTxt, retainUntil, RET_RULE, addY, kindOf, KIND, CBT, ACT, diff, summ, auditCsv, auditPdf, hmin, tsTxt, pad, dayKey, hm, msOf, minsOf, units, startOf, endOf, encDay, SET, UNITS_NOTE, fmtDay, select, totals, byDay, title, fname, csv, docx, pdf, csvCell };
})(window);
