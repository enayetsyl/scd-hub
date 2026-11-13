# PRD — Winter-task booklet review (D-#1620)

**Owner ask (13 Nov 2026):** put the winter booklets in the app and give one named reviewer the option to
suggest edits (and edit or delete her own suggestions). Print ~1 Dec, so small and fast. Ships behind
permissions only (no feature switch).

## Data (module `server/src/modules/winter-task/`)
- `WinterBooklet` — code (`C2-2026`), classLevel (−1..6), titleBn, version, status DRAFT | IN_REVIEW | APPROVED,
  pages `[{ n, kind COVER|DAY|TICKSHEET, dateKey?, subject?, week?, blocks: [{ id, kind heading|text|item|prompt|line, textBn, labelBn? }] }]`.
  Block ids are stable (page + position in the build's `content_<class>.py`). `line` blocks (writing space) are not editable.
- `WinterBookletChange` — bookletId, pageN, blockId (null = page note), before, after (`""` = remove the text), note, by,
  status OPEN | ACCEPTED | REJECTED | DELETED, stale, editedAt, decidedBy/At. One OPEN suggestion per person per block (a second tap edits it).
- Import: server script only, `server/scripts/import-winter-booklets.ts` (dry run by default, `APPLY=1` writes), from the
  JSON written by `_build/export_json.py`. The JSON stays out of the repo. A re-import keeps an OPEN/ACCEPTED suggestion whose
  block id and `before` text still match; the rest become `stale` (can't be edited or accepted, can be deleted/rejected).

## Permissions (`winter_task`, content_and_books; both off for TEACHER and OFFICE)
- `winter_task:review` — see every booklet; add / edit / delete OWN OPEN suggestions and page notes. Granted per person.
- `winter_task:manage` — Principal: accept / reject, mark APPROVED, copy the accepted text.

## Screens (Bangla first)
Drawer ☰ শীতের ছুটির খাতা → list of the six booklets (status, open / accepted counts) → one booklet page by page
(page chips with a dot on pages that hold open suggestions; tap a block to suggest; own suggestions with সম্পাদনা / মুছুন; page note box).
Principal: sees everyone's suggestions with names, গ্রহণ / বাতিল করুন, "show with accepted text", approve, copy accepted text.

## After merge (lead)
Promote + OTA with owner OK; on prod import the six booklets (dry run → apply → read back), grant `winter_task:review` to the
reviewer, tell the owner. After her review: copy the accepted text → rebuild the PDFs locally (`_build/build.py`) → owner final check → print.

## Not built
The booklet's PDF page image beside the text; a notice when a booklet is assigned.
