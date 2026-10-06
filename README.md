# MedBilling Logs ("MB Logs")

Part of JFdeLara's Studio. A private, offline time and billing log for physicians: encounter timers,
arrival/departure (time on site), call-backs, fee codes, photos and reports. Live: https://tp8p7c4vwr-del.github.io/medbilling-logs/

**It is a personal time and billing log, not the patient's medical record.** Chart every encounter in the patient's chart.

## Privacy and security
- Passcode set on first launch (never stored). Auto-lock after inactivity (default 2 min) and whenever the app goes to the background.
- All entries, settings, photos and the audit log are encrypted at rest in IndexedDB with AES-GCM-256. The key is derived from the passcode with PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt) and is non-extractable and memory-only.
- No network calls with data, no analytics, no third-party scripts (CSP `default-src 'self'`). jsPDF 4.2.1 (MIT) is bundled in `public/js/vendor/`, and the Word writer is our own (`public/js/docx.js`).
- Photos are resized and re-encoded (which strips EXIF/GPS) and kept only inside the encrypted store, never in the camera roll.
- Encrypted backup export/import (`.mblbackup`) and Delete all data (passcode + "DELETE ALL").

## User manual
Built into the app (v4): a full-screen page reachable from the lock screen, Settings → Help and the footer. It is part of `index.html`, so it works offline and holds no patient data.

## Time periods and holidays (v5)
The bar under the header shows the current Alberta billing time period (America/Edmonton time), the time left, and units elapsed/logged. Every encounter is tagged with its period(s); entries that cross a boundary are split by minutes and 15-minute units. The split appears in History totals, CSV (`time_periods` plus `<period>_min` / `<period>_units` columns), and a "Time periods" column with a legend in PDF/Word.

- Periods live in one config object, `PERIOD_CFG` in `public/js/report.js`. They are **per user, so verify against the current SOMB**. No fee codes are attached.
  - Weekday: overnight 00–07 (28 u), daytime 07–17 (regular), evening 17–22 (20 u), late evening 22–24 (8 u).
  - Weekend/holiday: overnight 00–07 (28 u), daytime 07–22 (60 u), late evening 22–24 (8 u).
- Statutory holidays bill like weekends. Alberta general holidays are calculated each year: New Year's Day, Family Day (3rd Mon Feb), Good Friday, Victoria Day, Canada Day, Heritage Day (1st Mon Aug, optional), Labour Day, National Day for Truth and Reconciliation (Sep 30), Thanksgiving, Remembrance Day, Christmas. Each one can be switched off in Settings, and "Today is a statutory holiday" covers any other day. Holiday changes are audit-logged.

## Other v5 features
Long-timer warnings (amber 60 min / red 3 h, configurable) with a Stop now / Stop at prompt on unlock; next-unit hint; week strip; Track again chips and favourite code sets (billing fields only); review checklist with a "Reviewed" mark that clears on edit; 5-second Undo; Last stop / ±5 min nudges; one-tap Next patient; day timeline; full-screen procedure timer (time only, wake lock). All in-app with no notifications, and every change is audit-logged.

## Desktop and tablet (v6)
Responsive layout. Phones (< 768px) are unchanged. At >= 768px the content is centred (max 1100px): Today shows the controls (arrival, week strip, Track again, actions) on the left and the day's entries on the right, History rows become a table (start, end, time, units, label, setting/facility, billing, Dx, time periods) with a sticky column header, and Settings/Resources flow into two columns. At >= 1200px (max 1360px): History puts the week strip and report form beside the table, Today's list gets the table columns too, and Settings/Resources use three columns. The week strip's **Today** button returns to the current week (and, in History, scrolls to today's entries) from any week.

## Audit log
Every create, start/pause/stop, edit, delete, arrival/departure and import is appended to an encrypted, SHA-256 hash-chained log. Each record holds the time, the action, and before/after values. Deleted entries stay in the log. "Check log" verifies the chain and the head record. The log exports as PDF or CSV.

## Retention
Records are kept for at least 10 years from the last entry. Minors: the longer of 10 years or 2 years after age 18 (CPSA). Obstetric: 10 years after the infant reaches majority (CMPA), counted as 29 years. Nothing is removed without the user's confirmation. Monthly backup reminders can be changed to weekly, every 3 months, or off.

## Data
- `public/data/codes-*.json` are built by `scripts/build-codes.py` from MedBilling Fee Desk's bundled data, using live provinces only. The build fails if any held jurisdiction (BC, ON, QC, PE, NB) would be bundled.
- `public/data/icd9-AB.json` (v2) is built by `scripts/build-icd9.py` from Fee Desk's bundled ICD-9 list (Alberta Health diagnostic codes, ICD-9 supplement, 2018-01-18; Open Government Licence – Alberta). It feeds the Diagnostic code (ICD-9) suggestions; any code can also be typed.
- Fee Desk links: "Look up in Fee Desk" deep-links (`#/code/<code>`, `#/medres/<ICD-9>`) only when the typed code is in the bundled lists; anything else opens Fee Desk's home page, so no free text or patient identifier goes into a URL. If the app locks while Fee Desk is open, an unsaved entry is kept as an encrypted draft and reopened after unlock.
- `public/data/facilities.json` lists Alberta hospitals by AHS zone. Sources and dates are inside the file. The Edmonton Zone list is complete per the AHS site list; the other zones are partial (see the note in the file).

## Deploy
Bump `const V` in `public/sw.js`. Then run `bash redeploy.sh` and commit the printed line as `.deploy/bundle.txt` on `main`. `.github/workflows/pages.yml` verifies the sha256 and publishes `site/` to the `gh-pages` branch.
