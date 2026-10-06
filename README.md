# Med Billing Logs ("Billing Logs")

Part of JFdeLara's Studio. A private, offline time and billing log for physicians: encounter timers,
arrival/departure (time on site), call-backs, fee codes, photos and reports. Live: https://tp8p7c4vwr-del.github.io/medbilling-logs/

**It is a personal time and billing log, not the patient's medical record.** Chart every encounter in the patient's chart.

## Privacy and security
- Passcode set on first launch (never stored). Auto-lock after inactivity (default 2 min) and whenever the app goes to the background.
- All entries, settings, photos and the audit log are encrypted at rest in IndexedDB with AES-GCM-256. The key is derived from the passcode with PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt) and is non-extractable and memory-only.
- No network calls with data, no analytics, no third-party scripts (CSP `default-src 'self'`). jsPDF 4.2.1 (MIT) is bundled in `public/js/vendor/`, and the Word writer is our own (`public/js/docx.js`).
- Photos are resized and re-encoded (which strips EXIF/GPS) and kept only inside the encrypted store, never in the camera roll.
- Encrypted backup export/import (`.mblbackup`) and Delete all data (passcode + "DELETE ALL").

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
