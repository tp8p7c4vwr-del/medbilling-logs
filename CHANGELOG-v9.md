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
