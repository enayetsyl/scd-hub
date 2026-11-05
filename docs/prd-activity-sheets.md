# Activity sheets (অ্যাক্টিভিটি শিট) — the 3,597-sheet activity bank (D-#988, #989, #991)

**Owner ask (2026-11-03/05):** the school has 25 activity banks (Downloads/Activity sheets: 23 sheet PDFs, 18
answer PDFs, 8 index CSVs; 3,597 one-page A4 sheets, each with an ID such as `SD-E-001` and Easy / Medium / Hard
levels mapped to classes Nursery–Class 6). Students choose pre-printed sheets at the office; guardians choose in
the app. Track who did how many, feed the all-rounder, deliver easily, report, and let Office add more. Plan +
mockups: https://claude.ai/artifact/UimqLqkkQJbnpUfoyLPq1e (Part B).

New module `activity-sheets` (identity plane, ADR-005). It shares the QR scanner, stickers, age-band idea and
alert seams with the storybook shelf.

## Settled (owner, 2026-11-05)
| # | Rule |
|---|---|
| Path 1 — child at the office | Sheets are **pre-printed** with a copy QR stamped by the app. The child picks one from a tray and **brings it to the office**; the desk scans the QR and types the child's **school ID** (numeric match, 103 = 0103), checks the name shown, saves. Name / roll search if the child doesn't know the ID. No child QR card. |
| Path 2 — guardian in the app | Guardian picks a bank + level; the app picks the next sheet the child has never had; it is **printed with the child's name**, class, date and QR in a morning batch (existing print queue); the class teacher hands it out by roster tap. |
| Return | Desk or class teacher scans the copy QR → সব ঠিক / কিছু ভুল / অসম্পূর্ণ → sticker unless অসম্পূর্ণ. Return box allowed (stickers owed list). Busy-time switch: take without a scan, record at return. |
| Repeats | Flagged on tray picks, not blocked; counted once toward the score. |
| Management | Add a new bank (sheet PDF + answer PDF + index CSV, same format as today); add sheets to an existing bank (PDF of pages → next IDs, level per page or all); replace / retire a sheet; attach pages to an indexed bank with no PDF (Mazes, Sudoku); edit the level → class table and skill area. |
| Skill areas | হাতের কাজ / ভাষা / গণিত / চিন্তা (one per bank, editable). |
| All-rounder | Activity area = sheets returned complete in 30 days ÷ monthly target (8), capped at 100 (D-#987). |

## Data
`ActivityBank`, `ActivitySheet`, `ActivityCopy` (one per printed page; serial in the QR), `ActivityIssue`
(student × sheet × copy, path TRAY / GUARDIAN / DESK_PRINT, status, result, sticker), `ActivityTray`
(bank × level stock estimate + rotation pointer), `ActivitySettings` (limits, cut-off, targets). Permissions:
new feature `activity_sheets` — view, issue, check, manage, settings; reports `reports:activity_*`.

## Slices
AS-1 import + bank manager · AS-2 activity corner (trays, restock PDF with copy QR, desk pick-up with school
ID, return box) · AS-3 guardian choose + personal print batch + class-teacher hand-out · AS-4 check &
follow-up (answers, level-up, stickers owed, not-returned) · AS-5 reports · AS-6 all-rounder area.

## Owner-unconfirmed defaults (D-#991)
Guardian requests 3 / week; max 3 open sheets across both paths; not returned after 14 days → dropped, no
reminder; answer page visible to the guardian only after return; level-up hint after 5 সব ঠিক; checked-sheet
alert = notification + Today card (no pop-up); corner hours before assembly, tiffin, after school.

## Data gaps (owner)
Mazes and Sudoku sheet PDFs are missing (indexed, no pages); `SCD_Bank_6_Tracing (1).pdf` is a byte-identical
duplicate.
