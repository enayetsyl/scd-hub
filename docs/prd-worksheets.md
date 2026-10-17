# PRD — Worksheet generator (Nursery/KG papers in final-exam style)

Decisions: D-#744 (engine), D-#745 (plan), D-#746 (picture bank), D-#747 (print + answer key).
Status: WS-1 built (BAN/ENG/MATH, Nursery + KG). WS-2 (Arabic) waits for a clean scan of রওযাতুল আতফাল ১.

## 1. Why

Nursery teachers hand-build their weekly assignments and class tests in Google Docs. Prod had 65
Nursery print requests from July to October 2026, and one Bangla doc was reprinted five times.
Those sheets use exactly the item kinds of the final paper: write the alphabet, fill the
blanks, letter before/after, picture → first letter, match a picture to a letter.

The final paper's shape is already in the app as the published মানবন্টন (`ExamSyllabus.marks`).
The 2026 Nursery rows match the 2025 Mohammadpur papers row for row. So the generator turns
those rows into papers:
- a **final** uses every row;
- an **assignment** or **class test** uses a preset subset of the same rows, limited to what has
  been taught so far.

## 2. Shape

| Layer | Where | Changed by |
|---|---|---|
| Sequences | `engine/sequences.ts`: স্বরবর্ণ 11 + ব্যঞ্জনবর্ণ 39 (one line, book order), A–Z, 1–100 in Bangla and English digits | code |
| Item kinds (15) | `engine/generate.ts`: one seeded rule each (WRITE_SEQUENCE, FILL_MISSING, REARRANGE, BEFORE/AFTER/BEFORE_AFTER, PICTURE_FIRST_LETTER, MATCH_PICTURE_LETTER, MATCH_PICTURE_WORD, MATCH_CASE, MATCH_NUMERAL, COUNT_PICTURES, MATCH_COUNT, ORAL, MANUAL) | code |
| Plan | `WorksheetPlan` keyed by (class level × subject): how each syllabus row is generated, plus the Assignment and Class-test presets. Counts and marks always come from the LIVE syllabus. | Office (plan screen) |
| Picture bank | `WorksheetPicture`: pictures taken from the school's own Nursery books 2026, bytes stored in Mongo (`image` ≤600 px, `thumb` ≤240 px) | Office (bank screen); importer |
| Paper | `WorksheetDoc` JSON → drawn natively in the app (`WorksheetPaper`) and by pdfkit (`render/worksheetPdf.ts`) | — |

- **Deterministic.** The same inputs and seed give the same paper. A preview stores nothing, and
  "send" regenerates from the seed, so the print is the preview. Each row has its own seed, so
  changing one row's count re-rolls only that row.
- **Scope.** "Taught up to" a consonant (Bangla), a letter (English) or a number (maths). Vowels
  are always in scope. A final covers the whole book.
- **Pictures.**
  - An assignment or class test never draws a picture marked "keep for the final".
  - A picture printed in the last 28 days is used only when the fresh pool runs short.
  - Matching rows use distinct answers.
  - A row that cannot be filled prints what it can, and its marks and a Bangla warning say so.
- **Auto-mapping.** `engine/autoMap.ts` guesses a row's kind from its wording. It maps every
  published Nursery 2026 BAN/ENG/MATH row correctly (tests pin them). A saved choice applies only
  while the row's wording is unchanged; a changed row is flagged on the plan screen.

**Ranges (D-#748).** For a paper, the teacher may bound each PART of a letter question by its first and last letter: fill-the-gaps (the cells shown), the alphabet row (স্বরবর্ণ and ব্যঞ্জনবর্ণ are two sub-questions, one range each), each jumbled line, and each of the two before/after columns (listed top to bottom). An explicit range overrides "taught up to"; empty = automatic. Bangla writing boxes carry two handwriting guide lines.

## 3. Roles (no new permission)

- **Generate / preview / send / read the bank:** `tracker:write` (teachers) OR `roster:manage`
  (Office/Principal). The Office may name the routine teacher a paper is for.
- **Save the plan, tag/hide/reserve a picture:** `roster:manage`.
- **Answer key** (`GET /pdf/worksheet/:id?answers=1`): the creator, the teacher it was made for,
  or `roster:manage`.
- **PDF of the paper on screen** (`POST /pdf/worksheet/preview[?answers=1]`, body = the preview's
  own arguments): the generate gate. Rendered by the print renderer, nothing stored, no picture
  use stamped — only sending to print counts as a use. Web only, like every PDF in the app.

## 4. Print path

`sendWorksheetToPrint` renders the PDF, stores it as a `print_upload` owned by the caller, and
files it through the existing `createPrintRequest` (UPLOAD). This is the English Drive ED-2
precedent: no new source type and no Office-queue change.
- **Purposes:** an assignment files as ASSIGNMENT (one-section classes get their section filled
  in), a class test as CLASS_TEST, a final as OTHER.
- **Snapshot:** the `Worksheet` row keeps the full doc and header, so the answer key matches the
  printed sheet even after later plan or tag edits.

## 5. Picture import (ops)

```
python -I server/scripts/worksheet-pictures/extract.py --book BAN    "<Nursery (Bengali) … .pdf>" --out <dir>
python -I server/scripts/worksheet-pictures/extract.py --book ENG    "<Nursery (English) … .pdf>" --out <dir>
python -I server/scripts/worksheet-pictures/extract.py --book MATH_B "<Nursery - Math [B] … .pdf>" --out <dir>
python -I server/scripts/worksheet-pictures/extract.py --book MATH_E "<Math (E) Nursery … .pdf>"  --out <dir>
node server/scripts/worksheet-pictures/import.cjs <dir>/bundle.json          # dry run, prints the DB name
APPLY=1 node server/scripts/worksheet-pictures/import.cjs <dir>/bundle.json  # writes
```

**Extraction** needs poppler's `pdfimages`, and copy a path with `[brackets]` first. The
extractor:
- applies each image's soft mask onto white;
- drops fragments;
- de-duplicates by average hash;
- applies `tags/<book>.json` (curated `page:index` → word, letter, pageLetter, uses, active);
- takes a picture the book splits into tiles from the rendered page (`render`) or butts its tiles
  together (`tiles`), and a tag whose key names no embedded image (`14:9001`) plus `render` is a
  page-region crop of its own — the numerals the book draws as vector art (এক ১, পঞ্চম ৫, ষাট ৬০).

**Book letter (D-#757).** A Bangla picture carries two letters: `letter`, the word's first letter
(what "ছবি দেখে সঠিক বর্ণ লেখ" asks for), and `pageLetter`, the letter page it sits on (ব্যাঙ → ঙ,
বাঁশ → ঁ, চিংড়ি → ং). Picture–letter matching pairs a picture with its `pageLetter` (falling back to
`letter`), as the book and the 2025 finals do, and the scope filter for matching uses the same
letter. The bank's card badge shows the book letter, with the first letter beside it when they
differ. The Bangla book's 50 letter pages carry 100 pictures, two per letter, all in the bank.

**Defaults:** an untagged Bangla/English picture starts hidden; a maths picture starts as a
counting picture. **Re-runs** refresh the image bytes only and never touch tags.

The 2026 books give 470 pictures, 330 of them active:
- Bangla: 109 usable for first-letter questions, covering 38 letters;
- English: 80, covering 25 letters (the book has no X picture);
- maths: 99 counting pictures.

The bundle holds the books' pictures and is never committed.

## 6. Out of scope / next

- **WS-2 Arabic:** needs a clean, unwatermarked scan of the full book. The excerpt on file carries
  the publisher's watermark across about a third of its pictures. Pictures are cropped by hand
  (one image per scanned page), and pdfkit needs an Arabic font.
- **Classes 1–5:** their rows are mostly authored questions, so the generator would print MANUAL
  rows. That work belongs to the question bank, not here.
- **A worksheet ↔ AssignmentItem link:** today the print request is tagged with class, section and
  subject, which is what the assignment print-gap report (D-#459) reads.
