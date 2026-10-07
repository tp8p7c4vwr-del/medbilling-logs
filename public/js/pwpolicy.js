/* MedBilling Logs - export password policy (v9d). Runs entirely on the device: no network calls, nothing stored.
   check(pw, {personal}) -> {ok, reasons[], bits, label, level 0-4}. `personal` = strings that must not appear in the
   password (patient names, MRN/PHN). The app separately rejects a password equal to the app passcode. */
(function (global) {
  'use strict';
  // small bundled list of the most common / breached-style passwords and base words (lower case, de-leeted)
  const COMMON = new Set(('password passcode passphrase passw0rd qwerty qwertyuiop asdfgh asdfghjkl zxcvbnm letmein welcome admin administrator '
    + 'iloveyou monkey dragon master sunshine princess football baseball basketball hockey soccer superman batman trustno1 shadow michael '
    + 'jennifer jordan hunter ranger buster thomas robert charlie daniel andrew joshua matthew jessica ashley amanda george summer winter '
    + 'spring autumn freedom whatever secret changeme default login access starwars pokemon computer internet samsung apple google '
    + 'microsoft facebook twitter instagram canada alberta calgary edmonton toronto vancouver ontario oilers flames maplelea maple '
    + 'doctor nurse hospital medical medicine health clinic patient billing medbilling medbillinglogs mblogs logs physician surgeon '
    + 'obgyn gynecology obstetrics pregnancy baby family mother father lovely loveme lover love hello hellothere goodbye happy '
    + 'flower purple orange yellow silver golden diamond cookie chocolate coffee banana cheese pepper ginger tigger killer killer1 '
    + 'mustang ferrari corvette harley yankees cowboys eagles lakers chelsea liverpool arsenal barcelona madrid juventus '
    + 'abc123 abcabc 123abc 1q2w3e4r 1qaz2wsx zaq12wsx qazwsx q1w2e3r4 aa123456 a1b2c3d4 qwe123 asd123 pass1234 test1234 '
    + 'testing tester test guest user username root toor temp temporary welcome1 password1 iloveyou1 sunshine1 princess1 '
    + 'blink182 letmein1 trustme nothing anything everything someone somebody friend friends forever heaven angel angels '
    + 'jesus christ blessed faith grace hope peace soccer1 hockey1 monkey1 dragon1 shadow1 master1 superstar rockstar '
    + 'starbucks walmart amazon netflix spotify youtube whatsapp telegram iphone android windows linux ubuntu '
    + 'january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday '
    + 'onetwothree onetwothreefour qwertyui asdfghjk zxcvbnm1 passwordpassword mypassword newpassword oldpassword yourpassword '
    + 'secure security protect protected private privacy encrypt encrypted export exports backup backups').split(/\s+/).filter(Boolean));
  const LEET = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '|': 'l' };
  const deleet = s => s.toLowerCase().replace(/[0134578@$!+9|]/g, c => LEET[c] || c);
  const alnum = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', '1qaz2wsx3edc4rfv5tgb', 'qazwsxedcrfvtgbyhnujmikolp'];
  function seqRun(s) {   // 4+ consecutive ascending/descending letters or digits (abcd, 4321)
    const t = s.toLowerCase();
    for (let i = 0; i + 3 < t.length; i++) {
      const c = [0, 1, 2, 3].map(k => t.charCodeAt(i + k)), an = c.every(x => (x >= 48 && x <= 57) || (x >= 97 && x <= 122));
      if (!an) continue;
      const d = c[1] - c[0]; if ((d === 1 || d === -1) && c[2] - c[1] === d && c[3] - c[2] === d) return t.slice(i, i + 4);
    }
    return '';
  }
  function kbRun(s) {
    const t = s.toLowerCase();
    for (const r of ROWS) for (const row of [r, r.split('').reverse().join('')]) for (let i = 0; i + 4 <= row.length; i++) if (t.includes(row.slice(i, i + 4))) return row.slice(i, i + 4);
    return '';
  }
  function commonHit(pw) {
    const raw = pw.toLowerCase(), de = deleet(pw), a = alnum(raw), da = alnum(de);
    const core = da.replace(/^[0-9]+|[0-9]+$/g, '');
    if (COMMON.has(raw) || COMMON.has(a) || COMMON.has(da) || COMMON.has(core)) return true;
    // a common word with only a little padding around it (Password2026!, Edmonton#1234)
    for (const w of COMMON) if (w.length >= 5 && (da.includes(w) || a.includes(w))) { const rest = (da.includes(w) ? da : a).replace(w, ''); if (rest.length < 6) return true; }
    return false;
  }
  function personalHit(pw, personal) {
    const a = alnum(pw), de = alnum(deleet(pw));
    for (const p of personal || []) {
      const s = String(p || ''); if (!s) continue;
      const toks = s.toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/).filter(t => t.length >= 4).concat(alnum(s).length >= 4 ? [alnum(s)] : []);
      const digits = s.replace(/\D/g, ''); if (digits.length >= 4) toks.push(digits);
      for (const t of toks) { const ta = alnum(t) || t; if (ta.length >= 4 && (a.includes(ta) || de.includes(ta) || pw.toLowerCase().includes(t))) return true; }
    }
    return false;
  }
  function classes(pw) { return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length; }
  function estimate(pw) {
    let cs = 0; if (/[a-z]/.test(pw)) cs += 26; if (/[A-Z]/.test(pw)) cs += 26; if (/[0-9]/.test(pw)) cs += 10; if (/[^A-Za-z0-9]/.test(pw)) cs += 33;
    return Math.round(Math.log2(Math.max(cs, 2)) * Math.min(pw.length, new Set(pw).size * 2.5));
  }
  function check(pw, o) {
    pw = String(pw || ''); o = o || {}; const reasons = [], len = [...pw].length;
    if (len < 12) reasons.push(`Use at least 12 characters (${len} so far).`);
    if (classes(pw) < 3 && len < 16) reasons.push('Use 3 of these 4: lowercase, UPPERCASE, numbers, symbols. Or use a passphrase of 16+ characters (several unrelated words).');
    if (/(.)\1\1/u.test(pw.toLowerCase())) reasons.push('Don\u2019t repeat a character 3 or more times in a row (like aaa or 111).');
    else if (len && (/^(.{1,6})\1+.{0,2}$/su.test(pw) || new Set(pw.toLowerCase()).size < Math.min(8, Math.ceil(len / 2)))) reasons.push('Too repetitive. Use more different characters.');
    const sq = seqRun(pw), kb = kbRun(pw);
    if (sq) reasons.push(`Avoid sequences like \u201c${sq}\u201d (abcd, 1234, 4321).`);
    else if (kb) reasons.push(`Avoid keyboard patterns like \u201c${kb}\u201d (qwerty, asdf).`);
    if (len && commonHit(pw)) reasons.push('Too close to a common or leaked password (like Password2026! or a city or team name). Pick something less predictable.');
    if (len && personalHit(pw, o.personal)) reasons.push('Don\u2019t use a patient\u2019s name, MRN or PHN in the password.');
    let bits = estimate(pw); if (reasons.length) bits = Math.min(bits, reasons.length > 1 ? 30 : 45);
    const level = !len ? 0 : reasons.length ? (bits < 30 ? 1 : 2) : bits < 80 ? 3 : 4;
    const label = ['', 'Weak', 'Weak', 'Strong', 'Very strong'][level] || 'Weak';
    return { ok: !reasons.length && len >= 12, reasons, bits, level, label };
  }
  global.PwPolicy = { check, COMMON_SIZE: COMMON.size };
})(window);
