/* MedBilling Logs - shared time helpers and report builders (CSV, PDF via bundled jsPDF, Word via DocxLite). */
(function (global) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  // dayKey/hm use America/Edmonton once edm() is defined below; provisional device-local until then
  let dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  let hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const msOf = (e, now) => e.segs.reduce((a, s) => a + Math.max(0, (s.e == null ? (now || Date.now()) : s.e) - s.s), 0);
  const minsOf = (e, now) => Math.floor(msOf(e, now) / 60000);
  // 15-minute units: full 15-min blocks, plus one more if the remainder is 8 min or more (e.g. 38 min = 3 units).
  const units = m => m <= 0 ? 0 : Math.floor(m / 15) + (m % 15 >= 8 ? 1 : 0);
  // v9c: a spreadsheet row can exist before its clock starts (no segments yet); it sorts/dates by e.at (rows added on an earlier day) or e.created
  const startOf = e => e.segs.length ? e.segs[0].s : (e.at || e.created);
  const started = e => !!(e && e.segs && e.segs.length);
  const endOf = e => { const l = e.segs[e.segs.length - 1]; return l ? l.e : null; };
  const encDay = e => dayKey(startOf(e));
  const SET = { H: 'Hospital', C: 'Clinic' };
  const kindOf = e => e.kind || 'enc';
  const KIND = { enc: 'Encounter', cb: 'Call-back', shift: 'On site' };
  const CBT = { return: 'Return to hospital', phone: 'Phone call-back' };
  const facTxt = e => e.facility ? e.facility.n : '';
  const hmin = m => `${Math.floor(m / 60)} h ${R2(m % 60)} min`; function R2(n) { return String(n).padStart(2, '0'); }
  // v9p: time totals in plain words: "17 min", "1 h", "8 h 52 min"; the Min column total "8 h 52"; CSV "8:52"; "1 unit" / "36 units"
  const hmTxt = m => { m = Math.max(0, Math.round(m || 0)); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; };
  const hmCol = m => { m = Math.max(0, Math.round(m || 0)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${R2(m % 60)}`; };
  const hmm = m => { m = Math.max(0, Math.round(m || 0)); return `${Math.floor(m / 60)}:${R2(m % 60)}`; };
  const uTxt = u => `${u} unit${u === 1 ? '' : 's'}`;
  const lateMark = e => e.late ? '*' : '';
  const UNITS_NOTE = 'Units = full 15-minute blocks plus 1 if the remainder is 8 minutes or more (e.g. 38 min = 3 units). Confirm time-based billing rules in your own schedule (e.g. Alberta SOMB) before submitting claims.';
  const codesTxt = e => (e.codes || []).map(c => c.c).join('; ');
  // Diagnostic codes (v2): one per fee code (c.dx), plus an entry-level e.dx when no fee code was added. Older entries have none.
  // v9m: e.dxx = more diagnostic codes than fee codes (e.g. up to 10 ICD-9 from one Fee Desk pick), kept in order after the paired ones.
  const dxExtra = e => (e && Array.isArray(e.dxx) ? e.dxx : []).filter(x => typeof x === 'string' && x);
  const dxList = e => { const out = []; for (const c of (e && e.codes) || []) if (c.dx && !out.includes(c.dx)) out.push(c.dx); if (e && e.dx && !out.includes(e.dx)) out.push(e.dx); for (const x of dxExtra(e)) if (!out.includes(x)) out.push(x); return out; };
  const dxShort = e => dxList(e).join('; ');
  // export form keeps the pairing with fee codes when an entry has more than one code
  const dxTxt = e => { const cs = (e.codes || []).filter(c => c.dx), multi = (e.codes || []).length > 1, seen = cs.map(c => c.dx).concat(e.dx ? [e.dx] : []);
    return cs.map(c => multi ? `${c.c}: ${c.dx}` : c.dx).concat(e.dx && !cs.some(c => c.dx === e.dx) ? [e.dx] : []).concat(dxExtra(e).filter((x, i, a) => !seen.includes(x) && a.indexOf(x) === i)).join('; '); };
  // v9k: modifier codes, two free-text columns per entry (e.mod1, e.mod2), each may hold several codes. Older entries have none.
  const normMods = v => String(v == null ? '' : v).split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
  const modTxt = (e, n) => normMods(e && e['mod' + n]);
  // v9o: time-unit modifiers carry a unit count 01–20 per code per row (e.modU = { TEV: 4 }); one unit = 15 minutes (SURT: "payable
  // in 15 minute blocks", GR 15.13.4; a further unit needs at least half of 15 minutes, GR 2.3.2 / 2.3.5). The 03.01AA after-hours
  // codes (SURT) and the matching unscheduled-service surcharge names (SURC EV / NTPM / NTAM / WK) take units.
  const MU_CODES = ['TEV', 'TNTP', 'TNTA', 'TWK', 'TST', 'TDES', 'EV', 'NTPM', 'NTAM', 'WK'];
  const isMu = c => MU_CODES.includes(String(c || '').toUpperCase());
  const p2 = n => String(n).padStart(2, '0');
  const muOf = (e, c) => { const v = e && e.modU && e.modU[c]; return Number.isInteger(v) && v >= 1 && v <= 20 ? v : 0; };
  const muCodes = (e, n) => modTxt(e, n).split(', ').filter(isMu);
  const modUTxt = (e, n) => muCodes(e, n).filter(c => muOf(e, c)).map(c => `${c} ${p2(muOf(e, c))}`).join('; ');
  const modFull = (e, n) => modTxt(e, n).split(', ').filter(Boolean).map(c => muOf(e, c) ? `${c} ×${p2(muOf(e, c))}` : c).join(', ');
  const muMin = n => n * 15;   // minutes for n units (15 each)
  const muFrom = n => n <= 0 ? 0 : (n - 1) * 15 + 8;   // least time logged that supports n units (remainder of at least half a unit, rounded up to whole minutes)
  const modsTxt = e => [modTxt(e, 1) && 'Mod 1: ' + modFull(e, 1), modTxt(e, 2) && 'Mod 2: ' + modFull(e, 2)].filter(Boolean).join('; ');
  // v9o: AHCIP Facility # (e.facNo, digits; e.facNm the facility name from the Alberta Health listing or typed by the doctor)
  // and Functional centre (e.fcen, a code such as EMRG). Older entries have neither. Codes and names as in the Alberta Health
  // "Facility and Functional Centre Definitions and Facility Listing" (July 2026): the five Med Access shows first, then the rest.
  const FCEN = [['CLNC', 'Clinic'], ['D/N', 'Day/Night Care'], ['EMRG', 'Emergency'], ['MED', 'Medical'], ['SURG', 'Surgical']];
  const FCEN_MORE = [['AACC', 'Advanced Ambulatory Care Ctr'], ['CLAB', 'Clinical Laboratory'], ['DIMG', 'Diagnostic Imaging'], ['ELEC', 'Electrodiagnosis'], ['EXRM', 'Examination Room'], ['HBOC', 'Hyperbaric Oxygen Chamber'], ['ICN1', 'ICU Neonatal - Level 1'], ['ICN2', 'ICU Neonatal - Level 2'], ['ICN3', 'ICU Neonatal - Level 3'], ['ICO2', 'ICU Obstetrics - Level 2'], ['ICO3', 'ICU Obstetrics - Level 3'], ['ICU1', 'Intensive Care Unit - Level 1'], ['ICU2', 'Intensive Care Unit - Level 2'], ['ICU3', 'Intensive Care Unit - Level 3'], ['LTC', 'Long Term Care'], ['OLAB', 'Other Diagnostic Laboratory'], ['PEMG', 'Pediatric Emergency'], ['PHYS', 'Physical Therapy'], ['PRGR', 'Patient Room/Group Room'], ['RDON', 'Radiation Oncology'], ['UCC', 'Urgent Care Center']];
  const FCEN_ALL = FCEN.concat(FCEN_MORE), fcenName = c => { const x = FCEN_ALL.find(f => f[0] === c); return x ? x[1] : ''; };
  const normFcen = v => { const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ''); if (!s) return ''; const x = FCEN_ALL.find(f => f[0] === s || f[0].replace('/', '') === s.replace('/', '')); return x ? x[0] : s.slice(0, 8); };
  const facNoTxt = e => (e && e.facNo != null ? String(e.facNo).trim() : '');
  const facNmTxt = e => (facNoTxt(e) && e.facNm ? String(e.facNm).trim() : '');
  const facNoFull = e => [facNoTxt(e), facNmTxt(e)].filter(Boolean).join(' ');
  const fcenTxt = e => (e && e.fcen ? String(e.fcen) : '');
  const fcenFull = e => fcenTxt(e) ? fcenTxt(e) + (fcenName(fcenTxt(e)) ? ' - ' + fcenName(fcenTxt(e)) : '') : '';
  const fmtDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); };

  // ---------- Alberta billing time periods (v5). PER USER: verify against the current Alberta SOMB before relying on them.
  // One config object. All times are America/Edmonton local time; each period runs from `from` (inclusive) to `to` (exclusive),
  // e.g. 17-22 = 17:00-21:59. `units` = number of 15-minute blocks in the period (premium units); weekday daytime has none.
  // Statutory holidays are treated like weekends: Alberta's general holidays are calculated each year (each can be switched
  // off in Settings), plus a manual "today is a holiday" toggle. No fee codes are attached to periods.
  const PERIOD_CFG = {
    tz: 'America/Edmonton',
    note: 'Alberta after-hours periods (America/Edmonton local time), as in the SOMB after-hours time premium (HSC 03.01AA, modifier SURT). Statutory holidays (GR 1.2) and the days designated in their place (GR 1.3) are treated like weekends.',
    weekday: [
      { id: 'wd_night', name: 'Weekday overnight', short: 'Night', from: 0, to: 7, units: 28 },
      { id: 'wd_day', name: 'Weekday daytime', short: 'Day', from: 7, to: 17, units: 0, regular: true },
      { id: 'wd_eve', name: 'Weekday evening', short: 'Eve', from: 17, to: 22, units: 20 },
      { id: 'wd_late', name: 'Weekday late evening', short: 'Late', from: 22, to: 24, units: 8 }],
    weekend: [
      { id: 'we_night', name: 'Weekend/holiday overnight', short: 'WE night', from: 0, to: 7, units: 28 },
      { id: 'we_day', name: 'Weekend/holiday daytime', short: 'WE day', from: 7, to: 22, units: 60 },
      { id: 'we_late', name: 'Weekend/holiday late evening', short: 'WE late', from: 22, to: 24, units: 8 }],
    // v9o: the AHCIP list for premium purposes, SOMB Medical Governing Rules (01 April 2026) GR 1.2: New Year's Day, Family Day,
    // Good Friday, Victoria Day, Canada Day, Alberta Heritage Day, Labour Day, Thanksgiving Day, Remembrance Day, Christmas Day,
    // Boxing Day. (Easter Monday and the National Day for Truth and Reconciliation are not on it; mark a day yourself if needed.)
    // GR 1.3: when one falls on a Saturday or Sunday the Minister designates another day (see designated() below).
    holidays: [   // [id, name, rule]
      ['newyear', "New Year's Day", 'Jan 1'], ['family', 'Family Day', '3rd Monday of February'], ['goodfri', 'Good Friday', 'Friday before Easter Sunday'],
      ['victoria', 'Victoria Day', 'Monday before May 25'], ['canada', 'Canada Day', 'Jul 1'], ['heritage', 'Alberta Heritage Day', '1st Monday of August'],
      ['labour', 'Labour Day', '1st Monday of September'], ['thanks', 'Thanksgiving Day', '2nd Monday of October'],
      ['remem', 'Remembrance Day', 'Nov 11'], ['xmas', 'Christmas Day', 'Dec 25'], ['boxing', 'Boxing Day', 'Dec 26']]
  };
  const PERIODS = PERIOD_CFG.weekday.concat(PERIOD_CFG.weekend), PBY = {}; PERIODS.forEach(p => { PBY[p.id] = p; });
  const hh = h => pad(h % 24) + ':00', pHours = p => `${hh(p.from)}–${pad((p.to - 1) % 24)}:59`;
  let edmFmt = null; try { edmFmt = new Intl.DateTimeFormat('en-CA', { timeZone: PERIOD_CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }); } catch (e) { edmFmt = null; }
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function edm(t) {   // wall-clock parts in America/Edmonton (falls back to device time if the zone is unavailable)
    if (!edmFmt) { const d = new Date(t); return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), wd: d.getDay(), key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }; }
    const o = {}; for (const p of edmFmt.formatToParts(new Date(t))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: WD.indexOf(o.weekday), key: `${o.year}-${o.month}-${o.day}` };
  }
  // Display times always as America/Edmonton 24h HH:MM (matches header clock; avoids <input type=time> 12h UI)
  const hmEdm = ts => { const w = edm(ts); return `${pad(w.h)}:${pad(w.mi)}`; };
  dayKey = ts => edm(ts).key;
  hm = hmEdm;

  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`, dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nthMon = (y, m, n) => { let d = 1; while (dow(y, m, d) !== 1) d++; return ymd(y, m, d + 7 * (n - 1)); };
  function goodFriday(y) {   // anonymous Gregorian computus for Easter Sunday, minus 2 days
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1, t = new Date(Date.UTC(y, mo - 1, da - 2));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const HOL_RULE = { newyear: y => ymd(y, 1, 1), family: y => nthMon(y, 2, 3), goodfri: goodFriday, victoria: y => { let d = 24; while (dow(y, 5, d) !== 1) d--; return ymd(y, 5, d); }, canada: y => ymd(y, 7, 1),
    heritage: y => nthMon(y, 8, 1), labour: y => nthMon(y, 9, 1), thanks: y => nthMon(y, 10, 2), remem: y => ymd(y, 11, 11), xmas: y => ymd(y, 12, 25), boxing: y => ymd(y, 12, 26) };
  // GR 1.3 designated days. Alberta Health announces them in AHCIP bulletins; the pattern it has used (GEN 80, 2011: Christmas on a
  // Sunday → Tuesday Dec 27 because Monday was Boxing Day; New Year's Day on a Sunday → Monday Jan 2) is the next weekday that is
  // not already a holiday or a designated day. DES_SEEN lists the designations seen in a published table; the others are expected
  // dates (shown as such in Settings, each can be switched off there).
  const DES_SEEN = { '2026-12-28': 'AMA “Claiming for after-hours work, December 2025 – December 2026” (GR 1.3): Monday, December 28, 2026, designated holiday for Boxing Day', '2011-12-27': 'Alberta Health AHCIP bulletin GEN 80 (Dec 2011)', '2012-01-02': 'Alberta Health AHCIP bulletin GEN 80 (Dec 2011)' };
  const addD = (k, n) => { const t = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)); return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const wdOf = k => dow(+k.slice(0, 4), +k.slice(5, 7), +k.slice(8, 10));
  function designated(y, base) {
    const taken = new Set(base.map(h => h.date)), out = [];
    for (const h of base.slice().sort((a, b) => a.date < b.date ? -1 : 1)) {
      const w = wdOf(h.date); if (w !== 0 && w !== 6) continue;
      let d = addD(h.date, 1); while (wdOf(d) === 0 || wdOf(d) === 6 || taken.has(d)) d = addD(d, 1);
      taken.add(d); out.push({ id: 'des_' + h.id, name: `Designated holiday for ${h.name}`, rule: `GR 1.3: ${h.name} falls on a ${w ? 'Saturday' : 'Sunday'}`, date: d, des: true, of: h.id, seen: DES_SEEN[d] || '' });
    }
    return out;
  }
  const holYr = new Map();
  function holidaysOf(y) {   // statutory holidays (GR 1.2) plus the GR 1.3 designated days, in date order
    if (!holYr.has(y)) { const base = PERIOD_CFG.holidays.map(([id, name, rule]) => ({ id, name, rule, date: HOL_RULE[id](y) })); holYr.set(y, base.concat(designated(y, base)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); }
    return holYr.get(y);
  }
  let HOL = { off: new Set(), extra: new Set(), ver: 0 }; const holCache = new Map();
  function setHolidays(o) { HOL = { off: new Set((o && o.off) || []), extra: new Set((o && o.extra) || []), ver: HOL.ver + 1 }; holCache.clear(); splitCache.clear(); }
  function holInfo(key) {   // {name, kind: 'stat' | 'des' | 'mine'} or null
    if (!holCache.has(key)) { const h = holidaysOf(+key.slice(0, 4)).find(x => x.date === key && !HOL.off.has(x.id));
      holCache.set(key, h ? { name: h.name, kind: h.des ? 'des' : 'stat' } : HOL.extra.has(key) ? { name: 'Holiday (marked by you)', kind: 'mine' } : null); }
    return holCache.get(key);
  }
  function holidayName(key) { const h = holInfo(key); return h ? h.name : ''; }   // name if this Edmonton day key is a holiday (built-in and switched on, or marked by the user)
  const holidayKind = key => { const h = holInfo(key); return h ? h.kind : ''; };
  // ---- v9o: after-hours time premium (HSC 03.01AA, modifier type SURT). Codes, hours and maximum units per day per physician from
  // the Alberta Health Medical Price List as of 01 April 2026 (03.01AA: SURT TEV 1-20, TNTP 1-8, TNTA 1-28, TWK 1-60, TST 1-60,
  // TDES 1-60 calls) and the Fee Modifier Definitions as of 01 April 2026 (SURT; payable in 15-minute blocks, maximum 4 per hour per
  // physician, a block spanning two periods goes to the period holding most of it = GR 15.13.6). The unscheduled-service surcharges
  // (SURC EV / NTPM / NTAM / WK) cover the same hours but are per service, without units, so they carry no unit limit.
  const PREM = {
    TNTA: { name: 'Night morning', when: 'any day 00:00–06:59', max: 28, surc: 'NTAM', calls: '1-28' },
    TEV: { name: 'Weekday evening', when: 'Mon–Fri 17:00–21:59', max: 20, surc: 'EV', calls: '1-20' },
    TNTP: { name: 'Night evening', when: 'any day 22:00–23:59', max: 8, surc: 'NTPM', calls: '1-8' },
    TWK: { name: 'Weekend', when: 'Sat–Sun 07:00–21:59', max: 60, surc: 'WK', calls: '1-60' },
    TST: { name: 'Statutory holiday', when: 'statutory holidays 07:00–21:59', max: 60, surc: 'WK', calls: '1-60' },
    TDES: { name: 'Designated holiday', when: 'designated holidays 07:00–21:59', max: 60, surc: 'WK', calls: '1-60' } };
  const PREM_SRC = 'Alberta Health, Medical Price List as of 01 April 2026 (HSC 03.01AA, modifiers TDES / TEV / TNTA / TNTP / TST / TWK), Fee Modifier Definitions as of 01 April 2026 (SURT) and Medical Governing Rules as of 01 April 2026 (GR 1.2, 1.3, 15.13). open.alberta.ca';
  function premCode(t) {   // 03.01AA modifier for the 15-minute block whose middle is at t (null in weekday daytime)
    const a = periodAt(t), id = a.p.id;
    if (id === 'wd_night' || id === 'we_night') return 'TNTA';
    if (id === 'wd_late' || id === 'we_late') return 'TNTP';
    if (id === 'wd_eve') return 'TEV';
    if (id === 'we_day') { const k = holidayKind(edm(t).key); return k === 'des' ? 'TDES' : k ? 'TST' : 'TWK'; }
    return null;
  }
  function premDayCodes(key) {   // the three premium windows of an Edmonton day, in clock order
    const w = wdOf(key), k = holidayKind(key), day = k === 'des' ? 'TDES' : k ? 'TST' : (w === 0 || w === 6) ? 'TWK' : 'TEV';
    return ['TNTA', day, 'TNTP'];
  }
  function premBucket(code, key) {   // the 03.01AA maximum a modifier's units count toward on Edmonton day `key`
    const c = String(code || '').toUpperCase();
    if (c === 'TEV' || c === 'EV') return 'TEV'; if (c === 'TNTP' || c === 'NTPM') return 'TNTP'; if (c === 'TNTA' || c === 'NTAM') return 'TNTA';
    if (c === 'TWK' || c === 'TST' || c === 'TDES') return c;
    if (c === 'WK') { const k = holidayKind(key); return k === 'des' ? 'TDES' : k ? 'TST' : 'TWK'; }
    return null;
  }
  function premUnits(encs) {   // Map 'YYYY-MM-DD|BUCKET' → units ENTERED on the modifiers (per entry day), { n, rows }
    const out = new Map();
    for (const e of encs) { if (!e || kindOf(e) === 'shift' || !e.modU) continue; const d = encDay(e); const seen = new Set();
      for (const n of [1, 2]) for (const c of muCodes(e, n)) { const u = muOf(e, c); if (!u || seen.has(c)) continue; seen.add(c); const b = premBucket(c, d); if (!b) continue; const k = d + '|' + b; out.set(k, (out.get(k) || 0) + u); } }
    return out;
  }
  function muSuggest(e, code, now) {   // units of this entry's logged time that fall in the code's window (a suggestion only)
    if (!e || !e.segs || kindOf(e) === 'shift' || !isMu(code)) return 0; let n = 0;
    for (const x of periodSplit(e, now).blocks) { const c = premCode(x.t); if (c && c === premBucket(code, edm(x.t).key)) n++; }
    return Math.min(20, n);
  }
  function premCounts(encs, now) {   // Map 'YYYY-MM-DD|CODE' → units: every 15-minute unit logged (by time, same blocks as the units column)
    const out = new Map();
    for (const e of encs) { if (!e || kindOf(e) === 'shift') continue;
      for (const b of periodSplit(e, now).blocks) { const c = premCode(b.t); if (!c) continue; const k = edm(b.t).key + '|' + c; out.set(k, (out.get(k) || 0) + 1); } }
    return out;
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
  const PLAIN = { wd_night: 'Night', wd_day: 'Day', wd_eve: 'Evening', wd_late: 'Late evening', we_night: 'Weekend/holiday night', we_day: 'Weekend/holiday day', we_late: 'Weekend/holiday late evening' };
  // plain period name; on a known single day, "Weekend …" or "Holiday …" instead of "Weekend/holiday …"
  const perName = (id, day) => { const n = PLAIN[id] || (PBY[id] && PBY[id].name) || id; if (!day || !/^we_/.test(id)) return n; return n.replace('Weekend/holiday', holidayName(day) ? 'Holiday' : 'Weekend'); };
  const perTxt = (parts, short, day) => parts.map(p => `${perName(p.id, day)} ${hmTxt(p.m)} · ${uTxt(p.u)}`).join('; ');
  // the day / week totals as separate plain lines: setting totals, call-backs, on site, then each time period
  const totLines = (t, day) => [t.H.n && `Hospital ${hmTxt(t.H.m)} · ${uTxt(t.H.u)}`, t.C.n && `Clinic ${hmTxt(t.C.m)} · ${uTxt(t.C.u)}`, t.cb.n && `Call-backs (${t.cb.n}) ${hmTxt(t.cb.m)} · ${uTxt(t.cb.u)}`, t.site && t.site.n && `On site ${hmTxt(t.site.m)}`]
    .filter(Boolean).concat((t.perList || []).map(p => `${perName(p.id, day)} ${hmTxt(p.m)} · ${uTxt(p.u)}`));
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
  const totTxt = t => `Hospital ${t.H.n} encounter${t.H.n === 1 ? '' : 's'}, ${hmTxt(t.H.m)}, ${uTxt(t.H.u)} · Clinic ${t.C.n} encounter${t.C.n === 1 ? '' : 's'}, ${hmTxt(t.C.m)}, ${uTxt(t.C.u)}` + (t.cb.n ? ` · Call-backs ${t.cb.n}, ${hmTxt(t.cb.m)}, ${uTxt(t.cb.u)}` : '') + (t.site.n ? ` · On site ${hmin(t.site.m)}` : '') + (t.perList && t.perList.length ? ` · Time periods: ${perTxt(t.perList)}` : '');
  const byDay = list => { const m = new Map(); for (const e of list) { const k = encDay(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return m; };
  const title = (from, to) => from === to ? `Billing log ${from}` : `Billing log ${from} to ${to}`;
  const fname = (from, to, ext) => (from === to ? `billing-log-${from}` : `billing-log-${from}_to_${to}`) + '.' + ext;
  // v7 notes: [{id, t, u?, x}]; older entries had a single e.note string
  const notesOf = e => { if (!e) return []; if (Array.isArray(e.notes)) return e.notes; return e.note ? [{ id: 'n0', t: e.created || startOf(e), x: String(e.note) }] : []; };
  const noteStamp = n => `${dayKey(n.t)} ${hm(n.t)}` + (n.u ? ` (edited ${dayKey(n.u) === dayKey(n.t) ? '' : dayKey(n.u) + ' '}${hm(n.u)})` : '');
  const notesTxt = e => notesOf(e).map(n => `[${noteStamp(n)}] ${n.x}`).join(' | ');
  // v9: patient name + MRN/PHN (mrn maps to older chart); billingNote is the spreadsheet note (falls back to first timestamped note)
  const ptName = e => (e && (e.name || '').trim()) || '';
  const ptMrn = e => (e && ((e.mrn || '').trim() || (e.chart || '').trim())) || '';
  const billingNoteOf = e => { if (!e) return ''; if ((e.billingNote || '').trim()) return e.billingNote.trim(); const ns = notesOf(e); return ns.length ? ns[0].x : ''; };
  const ptWho = e => { const n = ptName(e); if (n) return n; return [e && e.label, e && e.initials].filter(Boolean).join(' · '); };
  const samePt = (e, all) => !e || !e.pt ? [] : (all || []).filter(x => x.pt === e.pt && x.id !== e.id).sort((a, b) => startOf(a) - startOf(b));
  const samePtTxt = (e, all) => samePt(e, all).map(x => `${x.label || KIND[kindOf(x)]} ${encDay(x)} ${hm(startOf(x))}`).join('; ');
  function row(e, now) {
    const m = minsOf(e, now), en = endOf(e);
    return { start: started(e) ? hm(startOf(e)) + lateMark(e) : '', end: !started(e) ? 'not started' : en == null ? (kindOf(e) === 'shift' ? 'on site' : 'running') : hm(en), min: String(m), units: String(units(m)), set: [SET[e.setting] || '', facTxt(e)].filter(Boolean).join(', '), name: ptName(e) || ptWho(e), mrn: ptMrn(e), room: e.label || '', init: e.initials || '', chart: ptMrn(e), type: e.type || '',
      codes: (e.codes || []).map(c => c.c + (c.f ? ` (${c.f})` : '')).join('; '), mod1: modFull(e, 1), mod2: modFull(e, 2), fno: facNoTxt(e), fnoFull: facNoFull(e), fcen: fcenTxt(e), dx: dxTxt(e), note: billingNoteOf(e), per: perTxt(periodSplit(e, now).parts, true), fac: facTxt(e), cbt: CBT[e.cbType] || '', called: e.called ? hm(e.called) : '', site: hmin(m) };
  }
  // ---------- CSV
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // one row per entry (CSV and the Excel "Entries" sheet share it)
  function table(encs, from, to, now, all, o) {
    o = o || {};
    const head = ['date', 'kind', 'facility', 'zone', 'patient_name', 'mrn_phn', 'label', 'initials', 'chart', 'setting', 'type', 'callback_type', 'called', 'facility_number', 'facility_name', 'functional_centre', 'codes', 'modifier_1', 'modifier_1_units', 'modifier_2', 'modifier_2_units', 'diagnostic_code', 'billing_note', 'start', 'end', 'minutes', 'hours_minutes', 'units', 'time_periods'].concat(PERIODS.flatMap(p => [p.id + '_min', p.id + '_units']), ['linked', 'same_patient', 'entered_later', 'last_edited']).concat(o.notes ? ['notes'] : []);
    const rows = [], iso = ts => { if (ts == null) return ''; const d = new Date(ts); return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const byId = new Map((all || encs).map(e => [e.id, e]));
    for (const e of select(encs, from, to)) {
      const m = minsOf(e, now), en = endOf(e), k = kindOf(e);
      const linked = (e.links || []).map(id => byId.get(id)).filter(Boolean).map(x => `${x.label} ${hm(startOf(x))}`).join('; ');
      const ps = periodSplit(e, now).parts, pv = PERIODS.flatMap(p => { const q = ps.find(x => x.id === p.id); return k === 'shift' ? ['', ''] : [q ? q.m : 0, q ? q.u : 0]; });
      rows.push([encDay(e), KIND[k], facTxt(e), e.facility ? e.facility.z : '', ptName(e) || ptWho(e), ptMrn(e), e.label, e.initials, e.chart || e.mrn || '', SET[e.setting], e.type, CBT[e.cbType] || '', iso(e.called), facNoTxt(e), facNmTxt(e), fcenTxt(e), codesTxt(e), modTxt(e, 1), modUTxt(e, 1), modTxt(e, 2), modUTxt(e, 2), dxTxt(e), billingNoteOf(e), started(e) ? iso(startOf(e)) : '', iso(en), m, hmm(m), k === 'shift' ? '' : units(m), perTxt(ps)].concat(pv, [linked, samePtTxt(e, all || encs), e.late ? 'yes' : 'no', e.edits && e.edits.length ? iso(e.edits[e.edits.length - 1]) : '']).concat(o.notes ? [notesTxt(e)] : []));
    }
    return { head, rows };
  }
  function csv(encs, from, to, now, all, o) {
    const t = table(encs, from, to, now, all, o), lines = [t.head.join(',')].concat(t.rows.map(r => r.map(csvCell).join(',')));
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
  const encCap = e => [ptName(e) || e.label, e.initials, ptMrn(e), hm(startOf(e))].filter(Boolean).join(' · ');
  const CONF = 'CONFIDENTIAL: may contain patient information. Share only through secure, authorized channels.';
  const NOTES_OFF = 'Notes are not included in this file (export option "Include notes" was off).';
  const LATE_NOTE = '* Entered later (back-dated or times edited after the fact); see the audit log for the full history.';
  const linkTxt = (e, byId) => (e.links || []).map(id => byId.get(id)).filter(Boolean).map(x => `${x.label} ${hm(startOf(x))}`).join('; ');
  // ---------- DOCX
  async function docx(encs, from, to, o) {
    const list = select(encs, from, to), now = o.now || Date.now(), blocks = [];
    blocks.push({ t: 'h1', text: title(from, to) });
    blocks.push({ t: 'small', text: `Generated ${new Date(now).toLocaleString()} by MedBilling Logs. ${CONF}` });
    blocks.push({ t: 'p', bold: true, text: 'Totals: ' + totTxt(totals(list, now)) });
    const W = [540, 540, 420, 440, 560, 820, 520, 520, 700, 520, 900, 560, 560, 900, 840, 700];   // v9o: Facility # and Functional centre (same total width)
    const byId = new Map(encs.map(e => [e.id, e]));
    for (const [k, l] of byDay(list)) {
      blocks.push({ t: 'h2', text: fmtDay(k) });
      blocks.push({ t: 'small', text: totTxt(totals(l, now)) });
      const en = l.filter(e => kindOf(e) === 'enc'), cb = l.filter(e => kindOf(e) === 'cb'), sh = l.filter(e => kindOf(e) === 'shift');
      if (sh.length) { blocks.push({ t: 'p', bold: true, text: 'On site (arrival / departure)' }); blocks.push({ t: 'table', head: ['Facility', 'Setting', 'Arrival', 'Departure', 'Time on site'], widths: [5000, 1200, 1100, 1100, 1840], rows: sh.map(e => { const r = row(e, now); return [r.fac, SET[e.setting] || '', r.start, r.end, r.site]; }) }); }
      if (en.length) { blocks.push({ t: 'p', bold: true, text: 'Encounters' }); blocks.push({ t: 'table', head: ['Start', 'End', 'Min', 'Units', 'Setting', 'Patient', 'MRN/PHN', 'Type', 'Facility #', 'Functional centre', 'Codes', 'Modifier 1', 'Modifier 2', 'Diagnostic code', 'Billing note', 'Time periods'], widths: W, rows: en.map(e => { const r = row(e, now); return [r.start, r.end, r.min, r.units, r.set, r.name, r.mrn, r.type, r.fnoFull, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.note, r.per]; }) }); }
      if (cb.length) { blocks.push({ t: 'p', bold: true, text: 'Call-backs' }); blocks.push({ t: 'table', head: ['Type', 'Called', 'Arrival', 'Departure', 'Min', 'Units', 'Facility', 'Facility #', 'Functional centre', 'Codes', 'Modifier 1', 'Modifier 2', 'Diagnostic code', 'Time periods', 'Linked encounters'], widths: [760, 560, 600, 650, 440, 480, 860, 640, 480, 880, 600, 600, 800, 880, 1010], rows: cb.map(e => { const r = row(e, now); return [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.fnoFull, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.per, linkTxt(e, byId)]; }) }); }
      const sp = l.filter(e => samePt(e, encs).length);
      if (sp.length) blocks.push({ t: 'small', text: 'Same patient: ' + sp.map(e => `${encCap(e)} ↔ ${samePtTxt(e, encs)}`).join(' · ') });
      if (o.notes) { const wn = l.filter(e => notesOf(e).length); if (wn.length) { blocks.push({ t: 'p', bold: true, text: 'Notes' }); for (const e of wn) for (const n of notesOf(e)) blocks.push({ t: 'small', text: `${encCap(e) || KIND[kindOf(e)]} · [${noteStamp(n)}] ${n.x}` }); } }
    }
    if (!o.notes && list.some(e => notesOf(e).length)) blocks.push({ t: 'small', text: NOTES_OFF });
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
    const C_ENC = fit([['Start', 34], ['End', 38], ['Min', 24], ['Units', 28], ['Setting', 50], ['Patient', 64], ['MRN/PHN', 52], ['Type', 32], ['Fac #', 34], ['FC', 30], ['Codes', 62], ['Mod 1', 40], ['Mod 2', 40], ['Dx', 48], ['Note', 56], ['Time periods', 0]]);   // v9o: Fac # / FC
    const C_CB = fit([['Type', 58], ['Called', 36], ['Arrival', 40], ['Departure', 48], ['Min', 28], ['Units', 30], ['Facility', 62], ['Fac #', 34], ['FC', 30], ['Codes', 62], ['Mod 1', 40], ['Mod 2', 40], ['Diagnostic code', 56], ['Time periods', 70], ['Linked', 0]]);
    const C_SH = fit([['Facility', 220], ['Setting', 60], ['Arrival', 60], ['Departure', 60], ['Time on site', 0]]);
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
      section('On site (arrival / departure)', C_SH, l.filter(e => kindOf(e) === 'shift'), (r, e) => [r.fac, SET[e.setting] || '', r.start, r.end, r.site]);
      section('Encounters', C_ENC, l.filter(e => kindOf(e) === 'enc'), r => [r.start, r.end, r.min, r.units, r.set, r.name, r.mrn, r.type, r.fno, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.note, r.per]);
      section('Call-backs', C_CB, l.filter(e => kindOf(e) === 'cb'), (r, e) => [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.fno, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.per, linkTxt(e, byId)]);
      const sp = l.filter(e => samePt(e, encs).length);
      if (sp.length) text('Same patient: ' + sp.map(e => `${encCap(e)} <-> ${samePtTxt(e, encs)}`).join(' · '), 7.5, { color: [100, 116, 139], after: 3 });
      if (o.notes) { const wn = l.filter(e => notesOf(e).length); if (wn.length) { need(30); text('Notes', 9, { bold: true, after: 1 }); for (const e of wn) for (const n of notesOf(e)) text(`${encCap(e) || KIND[kindOf(e)]} · [${noteStamp(n)}] ${n.x}`, 8, { after: 1 }); y += 4; } }
    }
    if (!o.notes && list.some(e => notesOf(e).length)) text(NOTES_OFF, 7.5, { color: [100, 116, 139] });
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
  // ---------- Markdown (v8 readable backup copy)
  const mdc = v => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
  const mdTable = (head, rows) => [`| ${head.map(mdc).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`].concat(rows.map(r => `| ${r.map(mdc).join(' | ')} |`)).join('\n');
  function md(encs, from, to, o) {
    o = o || {}; const list = select(encs, from, to), now = o.now || Date.now(), out = [], byId = new Map(encs.map(e => [e.id, e]));
    out.push(`# ${title(from, to)}`, '', `> **${CONF}**`, '', `Generated ${new Date(now).toLocaleString()} by MedBilling Logs.`, '', `**Totals:** ${totTxt(totals(list, now))}`);
    for (const [k, l] of byDay(list)) {
      out.push('', `## ${fmtDay(k)}`, '', `_${totTxt(totals(l, now))}_`);
      const sh = l.filter(e => kindOf(e) === 'shift'), en = l.filter(e => kindOf(e) === 'enc'), cb = l.filter(e => kindOf(e) === 'cb');
      if (sh.length) out.push('', '### On site (arrival / departure)', '', mdTable(['Facility', 'Setting', 'Arrival', 'Departure', 'Time on site'], sh.map(e => { const r = row(e, now); return [r.fac, SET[e.setting] || '', r.start, r.end, r.site]; })));
      if (en.length) out.push('', '### Encounters', '', mdTable(['Start', 'End', 'Min', 'Units', 'Setting', 'Patient', 'MRN/PHN', 'Type', 'Facility #', 'Functional centre', 'Codes', 'Modifier 1', 'Modifier 2', 'Diagnostic code', 'Billing note', 'Time periods'], en.map(e => { const r = row(e, now); return [r.start, r.end, r.min, r.units, r.set, r.name, r.mrn, r.type, r.fnoFull, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.note, r.per]; })));
      if (cb.length) out.push('', '### Call-backs', '', mdTable(['Type', 'Called', 'Arrival', 'Departure', 'Min', 'Units', 'Facility', 'Facility #', 'Functional centre', 'Codes', 'Modifier 1', 'Modifier 2', 'Diagnostic code', 'Time periods', 'Linked encounters'], cb.map(e => { const r = row(e, now); return [r.cbt, r.called, r.start, r.end, r.min, r.units, r.fac, r.fnoFull, r.fcen, r.codes, r.mod1, r.mod2, r.dx, r.per, linkTxt(e, byId)]; })));
      const sp = l.filter(e => samePt(e, encs).length);
      if (sp.length) out.push('', 'Same patient: ' + mdc(sp.map(e => `${encCap(e)} <-> ${samePtTxt(e, encs)}`).join(' · ')));
      if (o.notes) { const wn = l.filter(e => notesOf(e).length); if (wn.length) { out.push('', '### Notes', ''); for (const e of wn) for (const n of notesOf(e)) out.push(`- ${mdc(encCap(e) || KIND[kindOf(e)])} · [${noteStamp(n)}] ${mdc(n.x)}`); } }
    }
    if (!list.length) out.push('', 'No encounters in this period.');
    if (!o.notes && list.some(e => notesOf(e).length)) out.push('', `_${NOTES_OFF}_`);
    if (list.some(e => e.late)) out.push('', `_${LATE_NOTE}_`);
    out.push('', `_${UNITS_NOTE}_`, '', `_${perLegend()}_`);
    for (const c of o.credits || []) out.push('', `_${c}_`);
    return new Blob([out.join('\n') + '\n'], { type: 'text/markdown;charset=utf-8' });
  }
  // ---------- Excel (v8 readable backup copy): Entries, Daily totals, About
  function xlsx(encs, from, to, o) {
    o = o || {}; const list = select(encs, from, to), now = o.now || Date.now();
    const t = table(encs, from, to, now, encs, o), num = v => (typeof v === 'number' || (/^\d+$/.test(String(v)) && String(v).length < 10)) ? Number(v) : v;
    const daily = [['date', 'hospital_encounters', 'hospital_min', 'hospital_units', 'clinic_encounters', 'clinic_min', 'clinic_units', 'callbacks', 'callback_min', 'callback_units', 'on_site_min', 'time_periods', 'total_hours_minutes']];
    for (const [k, l] of byDay(list)) { const x = totals(l, now); daily.push([k, x.H.n, x.H.m, x.H.u, x.C.n, x.C.m, x.C.u, x.cb.n, x.cb.m, x.cb.u, x.site.m, perTxt(x.perList || [], false, k), hmm(x.H.m + x.C.m + x.cb.m)]); }
    const tt = totals(list, now); daily.push(['TOTAL', tt.H.n, tt.H.m, tt.H.u, tt.C.n, tt.C.m, tt.C.u, tt.cb.n, tt.cb.m, tt.cb.u, tt.site.m, perTxt(tt.perList || []), hmm(tt.H.m + tt.C.m + tt.cb.m)]);
    const about = [['MedBilling Logs'], [title(from, to)], [`Generated ${new Date(now).toLocaleString()}`], [CONF], [o.notes ? 'Notes are included (column "notes" on the Entries sheet).' : NOTES_OFF], [UNITS_NOTE], [perLegend()]].concat((o.credits || []).map(c => [c]));
    const bytes = global.XlsxLite.build({ title: title(from, to), sheets: [
      { name: 'Entries', rows: [t.head].concat(t.rows.map(r => r.map(num))), widths: t.head.map(h => h === 'notes' ? 60 : h === 'codes' || h === 'facility_name' || h === 'modifier_1' || h === 'modifier_2' || h === 'modifier_1_units' || h === 'modifier_2_units' || h === 'facility' || h === 'time_periods' || h === 'linked' || h === 'same_patient' ? 28 : 12) },
      { name: 'Daily totals', rows: daily, widths: [12, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 40, 12] },
      { name: 'About', rows: about, widths: [120], header: false, wrap: true }] });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  // ---------- audit log export
  const ACT = { create: 'Created', start: 'Started', pause: 'Paused', resume: 'Resumed', stop: 'Stopped', arrive: 'Arrived', depart: 'Departed', edit: 'Edited', delete: 'Deleted', import: 'Imported', purge: 'Removed (retention)', 'prune-log': 'Log trimmed (retention)', review: 'Reviewed', unreview: 'Review cleared', restore: 'Restored (undo)', undo: 'Undone', 'fav-add': 'Code set saved', 'fav-remove': 'Code set removed', holiday: 'Holiday settings changed', addtime: 'Time added', 'note-add': 'Note added', 'note-edit': 'Note edited', 'note-delete': 'Note deleted', link: 'Linked (same patient)', migrate: 'Upgraded (notes)', 'backup-settings': 'Backup settings changed', backup: 'Backup', 'backup-fail': 'Backup failed' };
  const summ = o => o ? [KIND[kindOf(o)], ptName(o) || o.label || facTxt(o), o.initials, ptMrn(o), (o.segs || []).map(s => hm(s.s) + '-' + (s.e == null ? '…' : hm(s.e))).join(' '), facNoTxt(o) && 'Fac# ' + facNoTxt(o), fcenTxt(o) && 'FC ' + fcenTxt(o), codesTxt(o), modsTxt(o), dxTxt(o) && 'Dx ' + dxTxt(o), (o.billingNote || notesOf(o).length) && 'note', o.pt && 'same-patient group'].filter(Boolean).join(' | ') : '';
  function diff(b, a, hideNotes) {
    if (!b || !a) return [];
    const keys = ['name', 'mrn', 'label', 'initials', 'chart', 'billingNote', 'setting', 'type', 'cbType', 'called', 'status', 'minor', 'minorAge', 'obstetric', 'late'], out = [];
    const nv = v => (v == null || v === false) ? '' : v;
    for (const k of keys) if (JSON.stringify(nv(b[k])) !== JSON.stringify(nv(a[k]))) out.push(`${k}: ${k === 'called' ? (b[k] ? hm(b[k]) : '') : (b[k] ?? '')} -> ${k === 'called' ? (a[k] ? hm(a[k]) : '') : (a[k] ?? '')}`);
    const st = o => (o.segs || []).map(s => `${dayKey(s.s)} ${hm(s.s)}-${s.e == null ? 'open' : hm(s.e)}`).join(', ');
    if (st(b) !== st(a)) out.push(`times: ${st(b)} -> ${st(a)}`);
    if (codesTxt(b) !== codesTxt(a)) out.push(`codes: ${codesTxt(b)} -> ${codesTxt(a)}`);
    if (facNoFull(b) !== facNoFull(a)) out.push(`facility #: ${facNoFull(b)} -> ${facNoFull(a)}`);   // v9o
    if (fcenTxt(b) !== fcenTxt(a)) out.push(`functional centre: ${fcenTxt(b)} -> ${fcenTxt(a)}`);
    for (const n of [1, 2]) if (modTxt(b, n) !== modTxt(a, n)) out.push(`modifier ${n}: ${modTxt(b, n)} -> ${modTxt(a, n)}`);
    for (const n of [1, 2]) if (modUTxt(b, n) !== modUTxt(a, n)) out.push(`modifier ${n} units: ${modUTxt(b, n)} -> ${modUTxt(a, n)}`);   // v9o
    if (dxTxt(b) !== dxTxt(a)) out.push(`diagnostic codes: ${dxTxt(b)} -> ${dxTxt(a)}`);
    if (facTxt(b) !== facTxt(a)) out.push(`facility: ${facTxt(b)} -> ${facTxt(a)}`);
    if ((b.photos || []).length !== (a.photos || []).length) out.push(`photos: ${(b.photos || []).length} -> ${(a.photos || []).length}`);
    if (JSON.stringify(b.links || []) !== JSON.stringify(a.links || [])) out.push(`linked: ${(b.links || []).length} -> ${(a.links || []).length}`);
    if ((b.pt || '') !== (a.pt || '')) out.push(a.pt ? 'same-patient link added' : 'same-patient link removed');
    const nb = notesOf(b), na = notesOf(a), sh = x => hideNotes ? '(text not exported)' : (x.length > 90 ? x.slice(0, 90) + '…' : x);
    for (const n of na) { const o = nb.find(x => x.id === n.id); if (!o) out.push(`note added: ${sh(n.x)}`); else if (o.x !== n.x) out.push(`note edited: ${sh(o.x)} -> ${sh(n.x)}`); }
    for (const o of nb) if (!na.some(x => x.id === o.id)) out.push(`note deleted: ${sh(o.x)}`);
    return out;
  }
  const auditSel = (recs, from, to) => recs.filter(r => { const k = dayKey(r.ts); return k >= from && k <= to; });
  const tsTxt = ts => { const d = new Date(ts); return `${dayKey(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const redact = o => { if (!o || typeof o !== 'object') return o || null; const c = Object.assign({}, o); if (c.note) c.note = '(note not exported)'; if (Array.isArray(c.notes)) c.notes = c.notes.map(n => Object.assign({}, n, { x: '(note not exported)' })); return c; };
  function auditCsv(recs, from, to, o) {
    const show = !!(o && o.notes), J = v => JSON.stringify(show ? (v || null) : redact(v));
    const lines = [['seq', 'time', 'action', 'entry_id', 'kind', 'changes', 'before', 'after', 'prev_hash', 'hash'].join(',')];
    for (const r of auditSel(recs, from, to)) lines.push([r.seq, tsTxt(r.ts), ACT[r.action] || r.action, r.eid || '', KIND[r.kind] || '', diff(r.before, r.after, !show).join('; ') || r.note || '', J(r.before), J(r.after), r.prev, r.hash].map(csvCell).join(','));
    return new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  }
  async function auditPdf(recs, from, to, check, o) {
    const show = !!(o && o.notes);
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
      const d = diff(r.before, r.after, !show);
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
  global.BLR = { hmTxt, hmCol, hmm, uTxt, perName, totLines, md, xlsx, table, notesOf, noteStamp, notesTxt, ptName, ptMrn, billingNoteOf, ptWho, samePt, samePtTxt, PERIOD_CFG, PERIODS, PBY, pHours, edm, periodAt, periodSplit, perTxt, perLegend, holidaysOf, holidayName, holidayKind, setHolidays, PREM, PREM_SRC, premCode, premDayCodes, premCounts, premUnits, premBucket, muSuggest, MU_CODES, isMu, muOf, muCodes, modUTxt, modFull, muMin, muFrom, p2, dxList, dxExtra, dxShort, dxTxt, codesTxt, normMods, modTxt, modsTxt, FCEN, FCEN_MORE, FCEN_ALL, fcenName, normFcen, facNoTxt, facNmTxt, facNoFull, fcenTxt, fcenFull, retainUntil, RET_RULE, addY, kindOf, KIND, CBT, ACT, diff, summ, auditCsv, auditPdf, hmin, tsTxt, pad, dayKey, hm, hmEdm, msOf, minsOf, units, startOf, endOf, encDay, SET, UNITS_NOTE, fmtDay, select, totals, byDay, title, fname, csv, docx, pdf, csvCell };
})(window);
