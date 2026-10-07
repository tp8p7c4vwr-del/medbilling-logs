# MedBilling Logs v9i — Nothing pinned, text size and font, notes editor, readable phone cells (2026-10-06)

## Why
Jose tested TestFlight build 4 (v9h) on his iPhone: the pinned Patient column took too much room, the letters were too big, the notes cell was too small, and the cells were too narrow and hard to see.

## What changed (Logs v9i)
- **Nothing pinned:** the sticky # and Patient name columns are gone on every screen size (no setting); the grid scrolls sideways as a whole. Header (top) and totals (bottom) rows stay sticky.
- **Patient name on phones:** about 30% of the viewport, one line with an ellipsis; focusing/tapping it shows the full name in a bubble above the cell.
- **Settings → Display:** Text size slider like iOS (small A … large A, 7 steps 11/12/13/14/16/18/20 px, default 13 px, live preview line) and Font style picker (System default, Rounded, Serif, Monospace; system font stacks, no web fonts). Stored per device in localStorage `bl.display.v1` (no patient data), applied before unlock via CSS variables on the grid and the app. Row height scales (touch: max(40, 2.6×size) px).
- **Billing notes editor:** tapping/clicking the notes cell (or F2/Space, or typing on it) opens a multi-line, auto-growing editor: bottom sheet on phones (above the keyboard), popover next to the cell on desktop. Done/Cancel; Enter = new line, Ctrl/⌘-Enter = Done, Tab = Done + next cell, Esc = Cancel, tap outside = Done. Input ≥16 px. Saved through the same encrypted save queue; a dirty editor is kept as an encrypted draft if the app locks and restored after unlock. The cell shows a one-line preview (↵ for line breaks); the notes column is wider. While the editor is open the grid counts as "in use", so rows are not re-sorted under it.
- **Readable phone cells:** minimum column widths in characters that scale with the text size (MRN ~10 digits, Fee ~6, Dx ~5, In/Out ~5, Min/Units ~4), rows ≥40 px, darker gridlines, light zebra striping, tinted active row and a 2.5 px active-cell ring. iOS: viewport `maximum-scale=1` so focusing a sub-16 px cell never zooms (pinch zoom still works).
- Unchanged: pick-and-return, endless rows, 150-row performance (notes editor typing p95 ~21 ms at 1280, ~19 ms at 390), encrypted export, Face ID / easy unlock.
- Manual: section 4 (nothing pinned, Billing notes editor, Settings → Display), section 5 Billing notes; version 9i; PDF regenerated. Service-worker cache `bl-v9i-2026-10-06`.
- Tests: new `tests/display-notes-v9i.test.js` (390 touch + 1280: no sticky columns, horizontal scroll, slider steps/persistence/reload, font picker persistence, min widths, row height, zebra/active highlight, name bubble, notes editor open/Done/Cancel/Esc/Tab/multi-line on sheet and popover, saved after lock/unlock); grid-v9f, endless-v9h and perf-v9g updated for the notes editor. All 7 suites pass.

# MedBilling Logs v9h — Endless rows (2026-10-06)

## Why
Jose: "the rows end on 40, I need that to be endless and will add another 10 rows as you are 5 rows away from the end".

## What changed (Logs v9h)
- **Endless grid:** in Today (and any day shown in the grid), whenever the focused cell's row is within 5 rows of the last row, 10 blank rows are appended — however focus got there (Tab, Enter, ↑↓, the Next bar, a tap), with or without typing. Scrolling to within 5 rows of the bottom (grid or page) appends 10 more. Focus, caret, typed text and row order are untouched; row numbers continue. The grown size is kept per day across redraws (saves, ticks) until lock/reload.
- Blank rows stay HTML only: never saved, never in totals, reports or exports (entries are still created only when you type or pick into a row).
- **Performance:** rows far below the entries are drawn "light" (cells without editors) and get their editors when you move into, tap or hover over them, so hundreds of blank rows cost almost nothing. Measured (Chromium headless) with 150 entries + 305 blank rows (455 rows): typing p50 22 ms / p95 34 ms at 1280, p50 28 ms / p95 36 ms at 390 touch; scroll frames p95 28 / 19 ms; save 176 / 131 ms.
- Manual: section 4 "Rows never run out", FAQ; version 9h. PDF regenerated. Service-worker cache `bl-v9h-2026-10-06`.
- Tests: new `tests/endless-v9h.test.js` (1280 + 390 touch: Tab/Enter past row 36 → 50 rows, on past 100 and 150, Next bar, taps, scrolling grows, totals and entry count unchanged, typing in row 60 saves in place); `tests/perf-v9g.test.js` extended with the 455-row case. grid-v9f, encrypted-export, easy-unlock and pick-return-v9g still pass.

# MedBilling Logs v9g — Pick a code in Fee Desk and it comes back to the cell; fast with 150 rows; calmer tabs (2026-10-06)

## What changed (Logs v9g)
- **Pick and return:** ↗ / ⓘ in a Fee code(s) or Dx cell (also on an empty row, and in the row ⋯ menu) opens MedBilling Fee Desk in pick mode. Tapping a code there (search result, code page, price list, suggested ICD-9, ICD-9 search) returns to MedBilling Logs, writes it into the same row and column, saves, puts the cursor back in the cell and shows a toast ("03.03A added"). Fee codes are appended with ", " and never duplicated; Dx follows the one-Dx-per-fee-code rule (replaces the last Dx with Undo when there is no free place). Cancel returns without changes.
- Replaces the v9f "shared local handoff" (it failed between Safari and the Home Screen app and in the native in-app browser).
- Security: random 128-bit one-time token; code format checked; Fee Desk returns only to MedBilling Logs (same origin `/medbilling-logs/`) or `mblogs://pick`; parameters removed from the address bar; picks expire after 30 minutes; locked vault → code waits and is applied after unlock. Only the code and its kind travel, never patient data.
- Native app (not uploaded): `mblogs://pick` URL scheme + appUrlOpen/getLaunchUrl in `native/native.js`; Fee Desk opens in the in-app browser.
- **Performance:** typing latency with 150 rows went from ~100 ms to ~16 ms per key (Chromium, headless): compositing layer for the focused cell, cached/incremental column fitting, batched wrap heights; saving no longer redraws the hidden History; History draws the latest ~300 rows at once and older days as you scroll.
- **Tabs:** Today / History / Resources / Settings restyled (light bar with divider and shadow, icons, pill + underline for the active tab, 44 px+ targets, AA contrast).
- Manual: section 4 (Codes), section 8 (Pick a code in Fee Desk), FAQ; version 9g. PDF regenerated.
- Tests: `tests/pick-return-v9g.test.js` (1280 + 390 touch), `tests/perf-v9g.test.js`; grid-v9f, encrypted-export and easy-unlock still pass.

# MedBilling Logs v9f — Spreadsheet moves only when you say so; columns fit their content; Nova Scotia codes withheld (2026-10-06)

## Why
Jose: "The row width need to adapt how much information I enter on any of the column... It jumped in the next column when I was not ready. It should only jump if i click the forward arrow, enter or tab. On the mobile, i need to press with my finger on the cell or next column to type or press enter." Then: the phone's return key must move to the next cell in every column, including notes. And: no Nova Scotia code data until permission arrives.

## What was causing the "jump"
- **← → arrow keys left the cell** when it had been entered with Tab/Enter or the ▶ flow (cell selected, not "editing"): pressing → to get to the end of the text moved to the next column.
- **Enter moved down a row**, not to the next cell.
- **Rows moved under the cursor**: typing In re-sorted rows by time immediately, and a row typed lower down jumped up past the empty rows above it after the save.
- **Truncated narrow columns** (fixed widths) made long text scroll inside the cell, so it looked as if it ran into the next column.
- (Found while testing at 390px: tapping a cell next to a wrapped cell could leave the browser's caret in the neighbouring cell, so typing went nowhere. The tap now puts the caret back in the tapped cell.)

## What changed (Logs v9f)
- **Dynamic column widths** (`fitCols`): canvas measurement in the cells' own fonts (header + every cell, placeholder included), per-column min and max (name 34ch, MRN 26ch, fee 28ch, dx 24ch, notes 40ch; name ≤ 42% of the screen on phones). Grows/shrinks while typing (rAF), refits on render, tab switch and resize. Billing notes takes the remaining width. One table with a shared `<colgroup>`, so the sticky header and totals stay aligned; horizontal scroll unchanged.
- **Wrapping cells**: Patient name, Fee code(s), Dx and Billing notes are auto-growing `<textarea rows=1>` (no line breaks except in notes); the row grows instead of truncating. Notes maxlength 500.
- **Navigation only on Tab / Shift-Tab, Enter / Shift-Enter (right / left, wrapping to the next row), the new toolbar ← → buttons and a floating "← Next →" bar on touch**. ↑↓ change rows only before editing starts; ←→ never leave a text cell. Shift-Enter in notes = new line on a computer only. `beforeinput` line breaks (Android IMEs) also mean "next cell".
- Re-renders keep the focused cell, its value and caret; rows keep their place while you are in the grid and are re-sorted when focus leaves.
- Touch: 16px in every editor (mono columns were 15.5px → iOS zoom), `enterkeyhint="next"` everywhere, focused cell kept above the on-screen keyboard (visualViewport), caret repair after tap.
- **Nova Scotia withheld**: `data/codes-NS.json` removed from the web app, service worker and mobile www; `build-codes.py` now holds NS (listed with `held: true`, no data). Fee search for NS shows "Nova Scotia (approval pending): code lookup unavailable, type the code manually" and still offers "Add as typed"; typed codes and existing saved NS entries are untouched; reports credit typed NS codes as user-entered.
- Manual: section 4 (columns, moving between cells, phone/tablet), section 8 (Nova Scotia), version 9f.
- Test: `tests/grid-v9f.test.js` (1280 + 390 touch + NS): all pass; encrypted-export and easy-unlock suites still pass.
- Service worker cache: **`bl-v9f-2026-10-06`**.

---

# MedBilling Logs v9e — Easy unlock: Face ID / Touch ID / fingerprint, passkey, quick PIN (2026-10-06)

## Why
Jose: typing the login passcode every time is annoying; add easy unlock without weakening encryption at rest. Exports still need a typed password that differs from the passcode.

## What changed (Logs v9e)
- **`public/js/easyunlock.js` (new)** wraps the existing 256-bit vault key (PBKDF2-SHA-256 600k output, unchanged; no data migration) for each easy-unlock method and stores only the wrapped copy (AES-GCM, per-method AAD) in the vault meta record `easy`:
  - **App (iOS/Android): Face ID / Touch ID / fingerprint** via `@capgo/capacitor-native-biometric` 8.7.0 (Capacitor 8). A random wrap key is stored with `accessControl: BIOMETRY_CURRENT_SET` (iOS Keychain SecAccessControl `.biometryCurrentSet`; Android Keystore + BiometricPrompt). Auto-prompts on the lock screen. If enrolment changes the item is gone and easy unlock switches itself off.
  - **App only: quick PIN** (4–6 digits, no repeats/straight sequences): PBKDF2-SHA-256 600k over the PIN with a random salt plus a 256-bit pepper held in the Keychain/Keystore; 5 wrong PINs erase the PIN record and pepper. Not offered in the browser (a short PIN in browser storage could be brute-forced offline).
  - **Web/PWA: passkey** via WebAuthn PRF (`prf.eval.first` → HKDF-SHA-256 → AES-GCM wrap key; user verification required; rpId = site host). Shown only where `getClientCapabilities()['extension:prf']` is true (fallback: platform authenticator check; a passkey without PRF is refused with a clear message).
- `vault.js`: `rawKey`, `unlockRaw`, `getEasy/putEasy/delEasy`; `rekey` deletes the `easy` record, and the app calls `EasyUnlock.disableAll('passcode-change')`, so **changing the passcode turns easy unlock off** until re-enabled. Wipe / Forgot passcode also clear it.
- Settings → Lock → **Easy unlock**: "Unlock with Face ID / Touch ID / fingerprint" (app) or "Unlock with a passkey" (web), and "Quick PIN" (app). Turning one on needs the passcode or passphrase once. Audit log records on/off.
- Lock screen: Face ID / passkey button and quick-PIN box above the passcode field; the passcode always works.
- Exports are unaffected: the export password is always typed, policy-checked and compared with the passcode (vault check record). Easy unlock never opens exports.
- Manual: section 1 "Easy unlock" (what works where) + FAQ entries; version 9e. Manual PDF now generated by `scripts/make-manual-pdf.js` from the in-app manual.
- Native shell: plugin added to `/workspace/medbilling-logs-mobile` (package.json, cap sync for iOS SPM and Android), `NSFaceIDUsageDescription` in Info.plist.
- Test: `tests/easy-unlock.test.js` (Chromium virtual authenticator with PRF; mocked NativeBiometric plugin for the app paths): 24 checks, all pass. `tests/encrypted-export.test.js` still all pass.
- Service worker cache: **`bl-v9e-2026-10-06`**.

---

# MedBilling Logs v9d — Encrypted exports by default, privacy notice, passphrase login (2026-10-06)

## Why
Jose: "the export files from MedBilling Log should be encrypted, as it contains patient information. As a disclaimer, it should comply with laws of privacy and AHS or your Provincial privacy commissioner." Then: the export password must be user-chosen, strong, different from the app passcode and never stored; the login may be a numeric passcode or a passphrase.

## What changed (Logs v9d)
- **Every export is an AES-256 password-protected .zip** (zip.js 2.23.0, WinZip AE-2, `encryptionStrength: 3`): PDF, Word, **Excel (new in the report dialog)**, CSV and the audit-log export (PDF/CSV). There is no unencrypted export path. Backup readable copies are now always zipped (the "turn protection off" option was removed).
- **Export password dialog** (`#xpDlg`): password + repeat, Show/Hide, live strength meter and plain reasons. Policy in `public/js/pwpolicy.js` (bundled list, no network): 12+ characters with 3 of 4 character types, or a 16+ character passphrase; rejects common/breached-style passwords (incl. light leetspeak and padded words), sequences (abcd, 1234), keyboard runs (qwer), repeated characters, and anything containing a patient name or MRN/PHN from the vault. **Must differ from the app passcode** (compared with the in-memory session copy and verified against the vault check record, in memory). Never stored; optional "Remember for this session" keeps it in memory only and `lockNow()` clears it.
- **Privacy notice** before each export (checkbox, remembered until the app locks): health information; keep it encrypted; send the password separately; only as permitted by Alberta's HIA, custodian/AHS policies and the provincial/territorial privacy law and commissioner (e.g. Alberta OIPC); delete copies you no longer need.
- **File names**: `MedBillingLogs_YYYY-MM-DD.zip` / `MedBillingLogs_audit-log_YYYY-MM-DD.zip`; inner names `billing-log-<dates>.<ext>`. No patient identifiers, no password in names or share text.
- **Manual / Settings → Privacy**: section 12 rewritten (encrypted exports, password rules, how to open on iPhone/iPad (iZip), Mac (The Unarchiver, Keka, `tar --passphrase`), Windows (7-Zip)); section 16 "Privacy, the law and your responsibility" (custodian/affiliate responsibility; designed to support compliance; not certified or approved by AHS or any regulator; the app transmits nothing).
- **Login: passcode or passphrase.** Setup and Settings → Change passcode / passphrase offer *Passcode (numbers, 6+ digits, no repeats/straight sequences)* or *Passphrase (12+ characters, words and spaces)*. Same PBKDF2-SHA-256 600k KDF. The type is a non-secret hint in the vault meta record (numeric keyboard + label on the lock screen). Existing vaults keep working (label "Passcode or passphrase").
- Backup password (separate .zip password) now uses the same policy and must differ from the app passcode.
- Test: `tests/encrypted-export.test.js` (+ `tests/inspect_zip.py`): 65 checks, all pass.
- Service worker cache: **`bl-v9d-2026-10-06`**.

---

# MedBilling Logs v9c — Today is a real spreadsheet (2026-10-06)

## Why
Jose rejected v9/v9b twice: Today still read as an app screen with a grid inside it, not as a spreadsheet.

## What changed (Logs v9c)
- **The grid is the Today screen.** Full-width `table.grid` with gridlines on every cell, grey header row and grey row-number column, sticky header, ~30px rows (32px on touch), tabular monospace numbers, and a highlighted active cell, row and column header.
- **Columns:** # · Patient name · MRN / PHN · H/C · In · Out · Min · Units · Fee code(s) · Dx (ICD-9) · Billing notes · ⋯.
- **Blank rows:** always at least 15 (more to fill the screen). Typing a name or MRN in a blank row creates an encrypted encounter (status `new`, `segs: []`, not started). Typing **In** (24-hour, `930`, `09:30`, `21h05`, `n` = now) or tapping ▶ starts the clock; **Out** (or ■) stops it. An Out before In rolls over midnight. Running rows count up live in Min.
- **Keyboard like Sheets:** Tab/Shift-Tab, Enter moves down, Esc cancels, arrows move when not editing, F2 edits in place, typing replaces the selected cell. Cells patch in place, so focus and the iPhone keyboard survive saves.
- **Row menu (⋯, long-press or right-click the row number):** Start/Pause/Resume/Stop, Add time, Segments & photos, Add note, Same patient new encounter, Fee Desk pick for fee/dx, Full-screen timer, Open details, Delete (with Undo).
- **One slim toolbar** replaces the on-site card, week strip, totals panel and button rows: date navigator (‹ date › Today), facility, Arrive/Depart, on-site time, week totals, + Call-back, Report / share, and ⋯ More (Add past entry, Timeline, Review day, Edit arrival, Track again chips, Help).
- **Totals row** pinned to the bottom of the grid: encounters, minutes, units, H/C split and time periods.
- **Other days in Today:** the date control shows any day in the same grid; rows typed on a past day anchor to that day (`e.at`) and are marked entered later.
- **History** uses the same grid component per day (editable), with an "Open in Today" link. The week strip now lives only in History.
- **iPhone (390px):** horizontal scroll with # and Patient name pinned left; toolbar wraps to two or three short lines; 16px inputs (no zoom).
- Removed: "No encounters yet" panel, bottom quick-add/Start bar, Today week strip. Units footnote moved to the footer.
- **Compatibility:** no data migration. Older entries render unchanged. `report.js` handles not-started rows (`startOf` falls back to `at`/`created`; CSV end shows "not started"). Review flags rows with no In time. Encryption, exports (patient_name, mrn_phn, billing note), Fee Desk handoff (`medbilling.handoff.v1`, no patient data in URLs), Settings, holidays and backups unchanged.
- Service worker cache: **`bl-v9c-2026-10-06`**.

---

# MedBilling Logs v9b — Excel-like sheet polish (2026-10-06)

## Why
Jose opened MedBilling Logs v9 and said the Today/History view did not look like a spreadsheet (soft card rows, left accent bars, orphaned History header).

## What changed (Logs v9b)
- **Real `<table class="sheet">`** with `<thead>` / `<tbody>` for Today, each History day, and on-site history.
- **Excel-like visuals:** 1px `#c5cdd6` borders on every cell; sticky header `#e8ecef` with bold labels and thicker bottom border; dense ~34px rows; optional alternating `#f7f9fa` wash; **no** coloured left accent bars or soft card padding.
- **Live encounters** are first rows of the same sheet (In/Out/Time update in place). Pause/Stop are compact icon buttons in the last column — no separate timer cards above the grid.
- **Flush cell inputs** (no pill borders until focus). Horizontal scroll on narrow phones; desktop fills width.
- History: each day has its **own** table + header inside the scroll container (fixed orphaned `rowsHead` + nested `.rows.sheet`).
- **Times:** In/Out use plain 24-hour `HH:MM` text (not `<input type="time">`, which showed 12-hour on phones). Header clock and cells both use America/Edmonton via `R.hm` / `edm`.
- Encrypted fields, Fee Desk handoff, exports, name/mrn migration unchanged.
- Service worker cache: **`bl-v9b-2026-10-06`**.

## Prior (v9)
- Spreadsheet columns, inline edit, Fee Desk handoff, quick-add name/MRN, export columns — see earlier notes below.

---

# MedBilling Logs v9 — Spreadsheet redesign (2026-10-06)

## Why
Encounters were hard to follow on phone and desktop. Jose asked for a spreadsheet-style view to see and enter patient name, MRN/PHN, time in/out, billing notes, and fee/dx codes, with Fee Desk handoff for codes.

## What changed (Logs)
- **Today + History** use a spreadsheet grid (`.rows.sheet` / `.erow` / `rowHtml` / `rowsHead`).
- Columns: Patient name, MRN/PHN, Time in, Time out, Duration/units, Billing notes, Fee code(s), Dx/ICD-9, Setting/facility (secondary), actions.
- **Inline-editable cells** save via `saveEnc` (name, mrn, times, billingNote, fee, dx). Paste a code into fee/dx cells.
- **↗ Pick in Fee Desk** writes a request to shared `localStorage` key `medbilling.handoff.v1` and opens Fee Desk (code-only deep links; **never** name/MRN in URLs).
- On focus/visibility (and after unlock), Logs reads a handoff **response** and applies the code to the encounter, then clears the key.
- New encrypted fields: `name`, `mrn` (kept in sync with `chart`), `billingNote`. Older entries show label/initials/chart when name/mrn empty.
- Edit dialog kept for segments, photos, multi-code search, Add time, Same patient; adds Patient name + Billing note fields.
- **Exports** (CSV / XLSX / PDF / Word / Markdown): include `patient_name`, `mrn_phn`, and billing note.
- Help/manual updated for the spreadsheet and Fee Desk handoff.

## Fee Desk (companion)
- When a Logs handoff **request** is pending and the user opens a fee code or ICD-9 detail (or taps **Use in Logs**), Fee Desk writes a **response** to `medbilling.handoff.v1`.
- Existing `#/code/` and `#/medres/` lookup links unchanged.
- Service worker: **`mb-v27-2026-10-06`**.

## Privacy
- Name and MRN stay in the encrypted vault / DOM while unlocked only.
- Never placed in URLs, Fee Desk deep links, or console logs.
- Handoff payload carries only code, description, encounter id, and kind.
