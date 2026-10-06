# MedBilling Logs v9 — Spreadsheet redesign (2026-10-06)

## Why
Encounters were hard to follow on phone and desktop. Jose asked for a spreadsheet-style view to see and enter patient name, MRN/PHN, time in/out, billing notes, and fee/dx codes, with Fee Desk handoff for codes.

## What changed (Logs)
- **Today + History** use a spreadsheet grid (`.rows.sheet` / `.erow` / `rowHtml` / `rowsHead`).
- Columns: Patient name, MRN/PHN, Time in, Time out, Duration/units, Billing notes, Fee code(s), Dx/ICD-9, Setting/facility (secondary), actions.
- **Inline-editable cells** save via `saveEnc` (name, mrn, times, billingNote, fee, dx). Paste a code into fee/dx cells.
- **↗ Pick in Fee Desk** writes a request to shared `localStorage` key `medbilling.handoff.v1` and opens Fee Desk (code-only deep links; **never** name/MRN in URLs).
- On focus/visibility (and after unlock), Logs reads a handoff **response** and applies the code to the encounter, then clears the key.
- Running encounters still show timer cards (Pause/Stop/Next pt) above the grid; the grid is the main path.
- **Quick-add** bar: patient name + MRN/PHN + setting + Start (not label-only).
- New encrypted fields: `name`, `mrn` (kept in sync with `chart`), `billingNote`. Older entries show label/initials/chart when name/mrn empty.
- Edit dialog kept for segments, photos, multi-code search, Add time, Same patient; adds Patient name + Billing note fields.
- **Exports** (CSV / XLSX / PDF / Word / Markdown): include `patient_name`, `mrn_phn`, and billing note.
- Help/manual updated for the spreadsheet and Fee Desk handoff.
- Service worker cache: **`bl-v9-2026-10-06`**.

## Fee Desk (companion)
- When a Logs handoff **request** is pending and the user opens a fee code or ICD-9 detail (or taps **Use in Logs**), Fee Desk writes a **response** to `medbilling.handoff.v1`.
- Existing `#/code/` and `#/medres/` lookup links unchanged.
- Service worker: **`mb-v27-2026-10-06`**.

## Privacy
- Name and MRN stay in the encrypted vault / DOM while unlocked only.
- Never placed in URLs, Fee Desk deep links, or console logs.
- Handoff payload carries only code, description, encounter id, and kind.

## Not done in this pass
- No `redeploy.sh` / GitHub push (prepare only until smoke-tested).
