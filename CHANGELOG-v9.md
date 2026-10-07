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
