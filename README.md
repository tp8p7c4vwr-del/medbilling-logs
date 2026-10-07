# MedBilling Logs ("MB Logs")

Part of JFdeLara's Studio. A private, offline time and billing log for physicians: encounter timers,
arrival/departure (time on site), call-backs, fee codes, photos and reports. Live: https://tp8p7c4vwr-del.github.io/medbilling-logs/

**It is a personal time and billing log, not the patient's medical record.** Chart every encounter in the patient's chart.

## Privacy and security
- Passcode set on first launch (never stored). Auto-lock after inactivity (default 2 min) and whenever the app goes to the background.
- All entries, settings, photos and the audit log are encrypted at rest in IndexedDB with AES-GCM-256. The key is derived from the passcode with PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt) and is non-extractable and memory-only.
- No network calls with data, no analytics, no third-party scripts (CSP `default-src 'self'`). jsPDF 4.2.1 (MIT) and zip.js 2.23.0 (BSD-3-Clause, `zip.min.js`, no workers/wasm/eval; licence in `js/vendor/zip-LICENSE.txt`) are bundled in `public/js/vendor/`. The Word and Excel writers are our own (`public/js/docx.js`, `public/js/xlsx.js`).
- Photos are resized and re-encoded (which strips EXIF/GPS) and kept only inside the encrypted store, never in the camera roll.
- Encrypted backup export/import (`.mblbackup`), automatic backups (v8) and Delete all data (passcode + "DELETE ALL").
- **Encrypted exports (v9d).** Every report/audit export is an AES-256 password-protected .zip (zip.js, WinZip AES, strength 3) with a user-chosen export password (policy in `public/js/pwpolicy.js`: 12+ chars and 3 of 4 types or a 16+ passphrase; no common, sequential, repeated or patient-identifying content; different from the app passcode; never stored, optional in-memory session memory cleared on lock). A privacy notice (HIA, custodian/AHS policies, provincial commissioner e.g. Alberta OIPC) must be acknowledged before each export. File names carry no identifiers (`MedBillingLogs_YYYY-MM-DD.zip`). Opening: iZip (iPhone/iPad; Files can't open AES zips), The Unarchiver/Keka (Mac; Archive Utility can't), 7-Zip (Windows; File Explorer can't).
- **Login (v9d):** numeric passcode (6+ digits) or passphrase (12+ characters, spaces allowed), same KDF.
- **Spreadsheet (v9f):** columns fit their content (wrap past a maximum), the cursor moves only on Tab / Enter / the ← → buttons / the phone's Next key, rows never move under the cursor; Nova Scotia code data withheld (approval pending; codes typed manually).
- **Easy unlock (v9e):** optional Face ID / Touch ID / fingerprint (iOS/Android app, Keychain/Keystore via `@capgo/capacitor-native-biometric`), quick 4–6 digit PIN (app only, PBKDF2 600k + Keychain pepper, erased after 5 wrong tries) and passkey unlock on the web (WebAuthn PRF; hidden where unsupported). Each wraps the vault key; the passcode stays the fallback; changing the passcode turns easy unlock off; exports always need a typed password.

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

## Entry details, same patient and notes (v7)
Tapping an entry opens a details view with an action row at the top: **Add time** (+5/+15/+30 min applied immediately with Undo; on a running timer the start moves earlier, otherwise the end moves later, capped at now; or a new start/end segment), **Same patient, new encounter** (starts a new running encounter carrying room/label, initials, chart/MRN, setting, facility and the minor/obstetric flags, with codes, Dx, notes and photos blank; the source is stopped if running; both share a `pt` group id, `ptFrom` points to the source, the link shows in both details views, as ↔ on History rows and in the CSV `same_patient` column) and **Edit** (the full form: times/segments, label, initials, chart, codes, Dx, flags, setting, type, facility, call-back fields, links, photos). Entries hold several timestamped notes (`notes: [{id, t, u?, x}]`, up to 1000 characters each) that save immediately and can be edited or deleted. The v6 single `note` is migrated into the first note on unlock (and after a backup import). History rows have a ⋯ quick-action menu (also long-press or right-click on any row): Add time, Add note, Same patient, Edit, Open details. Reports include notes only when **Include notes** is ticked (off by default): PDF/Word list them under each day, CSV adds a `notes` column; the audit-log export replaces note text with "(note not exported)" unless the option is ticked. New audit actions: `addtime`, `link`, `note-add`, `note-edit`, `note-delete`, `migrate`. Everything stays inside the encrypted vault.

## Automatic backups (v8)
Settings → Backups: auto backup on/off (default off), frequency (1 h default, 2 h, 4 h, daily), **Choose backup location**, last backup time/status, keep last N (default 24; older `medbilling-logs-auto-<stamp>[-readable].<ext>` files are rotated out, nothing else in the folder is touched) and **Back up now**. Every settings change, manual backup, failure and recovery is audit-logged (`backup-settings`, `backup`, `backup-fail`); the backup password never is.
- **Files.** The encrypted `.mblbackup` (same format as Export: AES-GCM-256, PBKDF2-SHA-256 600k, the vault's own salt, so it opens with the current passcode via Import) is always written. Optional readable copies (PDF, Markdown, Word, Excel; off by default; notes only with "Include notes") go into an **AES-256 encrypted .zip** (WinZip AES format, zip.js) protected by the app passcode or a separate backup password (12+ characters, strength meter; kept only in the encrypted settings, stripped from every backup). Turning the zip off needs a strong confirmation and the UI then says the copies are NOT encrypted. jsPDF only offers RC4 PDF encryption, so there is no AES PDF; PDFs go inside the zip.
- **Explanation under every backup button** (Back up now, the reminder banner, Export): 2–3 small lines (AA contrast) with the encryption type, which password protects it, and that a lost password means no one, including the developer, can open or recover it.
- **Chrome/Edge (File System Access):** the folder handle from `showDirectoryPicker` is kept in a separate IndexedDB (`bl-backup-loc`, no patient data); permission is re-checked after unlock (a banner asks to Allow access when needed). Backups run every interval while open and unlocked (a 30 s tick; unchanged data is skipped, but at least one per day), on lock and on tab close (best effort).
- **iOS/Android app:** the `MBBackup` Capacitor plugin (Android: SAF `ACTION_OPEN_DOCUMENT_TREE` + persisted URI permission; iOS: folder picker + security-scoped bookmark, `beginBackgroundTask` when leaving). Backups run while the app is open and when it goes to the background; phones don't allow guaranteed background runs, and the UI says so.
- **Safari/Firefox (no folder access):** an hourly (or chosen interval) reminder banner on Today with Back up now (share sheet or downloads) and Later. No automatic rotation.
- **Never while locked**: the key exists only while unlocked. A backup started at lock uses a synchronous snapshot taken before the key is cleared. Failures show a non-blocking red banner (Try again / Backup settings) and are retried within min(interval, 15 min).
- **Opening the zip:** 7-Zip/WinRAR (Windows), Keka/The Unarchiver/BetterZip or `tar -xf FILE.zip --passphrase …` (macOS, tested on macOS 27 bsdtar 3.5.3). Finder/Archive Utility, `unzip` and Windows File Explorer can't open AES zips. Zip AES uses PBKDF2-SHA1 with 1,000 iterations, so use a long password; the `.mblbackup` is the stronger file.

## Audit log
Every create, start/pause/stop, edit, added time, same-patient link, note add/edit/delete, delete, arrival/departure, import and backup setting/run/failure is appended to an encrypted, SHA-256 hash-chained log. Each record holds the time, the action, and before/after values. Deleted entries stay in the log. "Check log" verifies the chain and the head record. The log exports as PDF or CSV.

## Retention
Records are kept for at least 10 years from the last entry. Minors: the longer of 10 years or 2 years after age 18 (CPSA). Obstetric: 10 years after the infant reaches majority (CMPA), counted as 29 years. Nothing is removed without the user's confirmation. Monthly backup reminders can be changed to weekly, every 3 months, or off.

## Data
- `public/data/codes-*.json` are built by `scripts/build-codes.py` from MedBilling Fee Desk's bundled data, using live provinces only. The build fails if any held jurisdiction (BC, ON, QC, PE, NB) would be bundled.
- `public/data/icd9-AB.json` (v2) is built by `scripts/build-icd9.py` from Fee Desk's bundled ICD-9 list (Alberta Health diagnostic codes, ICD-9 supplement, 2018-01-18; Open Government Licence – Alberta). It feeds the Diagnostic code (ICD-9) suggestions; any code can also be typed.
- Fee Desk links: "Look up in Fee Desk" deep-links (`#/code/<code>`, `#/medres/<ICD-9>`) only when the typed code is in the bundled lists; anything else opens Fee Desk's home page, so no free text or patient identifier goes into a URL. If the app locks while Fee Desk is open, an unsaved entry is kept as an encrypted draft and reopened after unlock.
- `public/data/facilities.json` lists Alberta hospitals by AHS zone. Sources and dates are inside the file. The Edmonton Zone list is complete per the AHS site list; the other zones are partial (see the note in the file).

## Deploy
Bump `const V` in `public/sw.js`. Then run `bash redeploy.sh` and commit the printed line as `.deploy/bundle.txt` on `main`. `.github/workflows/pages.yml` verifies the sha256 and publishes `site/` to the `gh-pages` branch.

## Spreadsheet Today (v9c)
Today is now a full-width spreadsheet (`table.grid`, shared with History's per-day view): gridlines, grey header and row numbers, sticky header, pinned totals row, at least 15 blank rows, and inline editing with Sheets-style keyboard navigation. Typing a name/MRN into a blank row creates an encrypted not-started encounter (`status: 'new'`, `segs: []`); In starts the clock and Out stops it. Everything else on Today sits in one slim toolbar (date navigator, facility, Arrive/Depart, week totals, + Call-back, Report / share, ⋯ More). On phones the grid scrolls sideways with # and Patient name pinned. See `CHANGELOG-v9.md`.
