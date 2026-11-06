# PRD — Exam paper bank (D-#1030–#1034)

Status: BUILT 2026-11-06 (branch `feat/exam-paper-bank`). Owner ask, 2026-11-06:

> integrate [Mohammadpur's half-yearly and final papers, 2025 and 2026] in the app … so that office
> can see them if needed. Then generate Sylhet branch final questions using the Sylhet syllabus, mark
> distribution and Mohammadpur 2026 final as guide … these questions should also be added in the app and
> given Fida as reviewer. For each item of a question [the reviewer] should see a button to confirm
> syllabus match, should be able to give edit suggestion, delete suggestion, add new question suggestion.
> Only Nursery to Class 5.

## 1. Two parts

| Part | What | Who |
|---|---|---|
| **মোহাম্মদপুরের প্রশ্নপত্র** (reference shelf) | Mohammadpur's past papers, page by page, + the original file | Office (view + upload), Principal |
| **প্রশ্নপত্র রিভিউ** (draft papers) | Sylhet's draft papers, reviewed item by item by one assigned reviewer | reviewer (anyone, SELF), Office reads, Principal decides |

## 2. Permissions (`exam_papers`, group assessment_and_exams)

| action | T | O | flags | gates |
|---|---|---|---|---|
| `view_reference` | — | on | | shelf, pages, original file |
| `manage_reference` | — | on | | upload / edit / delete a reference paper |
| `view` | — | on | | every draft + every suggestion, read only |
| `manage` | — | — | PRINCIPAL-DEFAULT | import drafts, assign reviewer, accept/reject, final/reopen |
| `review` | on | on | SELF | the paper's reviewer: confirm items, suggest, submit (service-checked) |

## 3. Reference shelf (D-#1030)

- `ReferencePaper` {branch MOHAMMADPUR, term HALF_YEARLY|ANNUAL, year, classLevel (−1…5, null = Arabic level),
  subject, title, status PROCESSING→READY|FAILED, pageFileIds, pageAspect, sourceFileId, sourceName, sourceHash}.
- Upload: `POST /files/reference-paper` multipart `file` (PDF → page JPEGs, StoredFile `reference_paper_page`)
  + optional `source` (the .docx, StoredFile `reference_paper_source`; without it the PDF is the source).
- Read: `referencePapers(year, term, classLevel)`, `referencePaperPage(paperId, page)`, `GET /files/:id` for the
  original — one gate for both file kinds (view_reference/manage_reference + the file belongs to a paper).
- Bulk load from the laptop: `build-reference-manifest.mjs` (folders → manifest; class from the path, subject
  from path/name, docx+pdf twins = one paper, byte-identical files once, OVERRIDES for misfiled files) →
  `convert-docx-to-pdf.ps1` (Word) → `import-reference-papers.mjs` (API, idempotent by sha1).
- First load: 128 papers — Final 2025 (39 incl. 5 Arabic levels), HY 2025 (28; the "Half Yearly 2025" folder in
  `Mohammadpur Materials` is a byte copy of Final 2025, the real one is under `Sylhet Final Question 2026
  Material/…/Other/`), HY 2026 (35), Final 2026 (28). Skipped: 2 misfiled files and the Bijoy-font C3 BGS /80
  HY 2026 paper (renders as Latin without SutonnyMJ).

## 4. Draft papers (D-#1031–#1033)

- `ExamPaperDraft` {key (unique), term, year, examNameBn, classLevel, subject, titleBn, fullMarks, durationBn,
  syllabusRows[] (copy of the published মানবন্টন), sections[] {seq, syllabusRowSeq[], kind WRITTEN|ORAL,
  instructionBn, count, marksEach, total, choiceNoteBn, splitMarks, stimulusMd, matchRight[], items[] {key, text,
  options[], answer, marks, source, sourceRef, bookRef, needsPicture, note, removed, syllabusConfirmedBy/At,
  history[]}}, authorNotes, status, reviewerUserId, reviewSubmittedAt, reviewSummary, finalizedBy/At}.
- `ExamPaperSuggestion` {paperId, kind EDIT|DELETE|ADD, sectionSeq, itemKey, proposedText/Answer/Options,
  reason, status OPEN|ACCEPTED|REJECTED|WITHDRAWN, resolvedBy/At, resolutionNote, createdItemKey}.
- Import: `importExamPaperDraft(json)` re-validates (`validateDraftPayload`, twin of
  `server/scripts/exam-papers/validate-drafts.mjs`); a key is imported once — a review is never overwritten.
- Status: DRAFT → (assign) IN_REVIEW → (reviewer "রিভিউ শেষ") REVIEWED → (manager) FINAL; FINAL blocks every
  review action until reopened.
- Accepting: EDIT replaces text/answer/options (old wording → `history`, confirmation cleared); DELETE sets
  `removed` (never hard-deleted); ADD inserts a `REVIEWER` item after the anchor item (or at the section end).
  The manager may reword while accepting. The section shows a warning when its active items fall below `count`.
- Notification: one `REVIEW_ASSIGNED` per assignment call to the reviewer; `refs.examPaperId` = the paper, or
  `"list"` when the call covered several papers (deep-link: ExamPaperDraft / ExamPapersHome).

## 5. Screens (stack `ExamPapersTab`, drawer group পরীক্ষার সিলেবাস)

- **ExamPapersHome** — list (reviewer: own only; view/manage: all, "আমার রিভিউ" + class chips), progress
  (`confirmed/items · open suggestions`), status, reviewer; manager: tick papers → choose reviewer → বরাদ্দ;
  link card to the Mohammadpur shelf (view_reference).
- **ExamPaperDraft** — header (marks, time, status, progress, show answers, author notes); per section: row label,
  `count × each = total`, passage/word bank, right column, "এই অংশের সব প্রশ্ন মিলেছে", "নতুন প্রশ্নের প্রস্তাব";
  per item: text, options, answer (toggle), source badge + reference + note + book page, picture flag, and the
  buttons **✓ সিলেবাসের সাথে মিলেছে · সম্পাদনার প্রস্তাব · মুছে ফেলার প্রস্তাব · নতুন প্রশ্নের প্রস্তাব**;
  suggestions under their item with withdraw (author) / accept-reject (manager); footer: রিভিউ শেষ (reviewer),
  চূড়ান্ত করুন / আবার খুলুন (manager).
- **ReferencePapers** — chips by year / exam / class; upload card (manage_reference); open / original / delete.
- **ReferencePaperReader** — every page stacked, zoom, "মূল ফাইল খুলুন".

## 6. The Sylhet Annual 2026 drafts (D-#1034)

32 files in `server/assets/exam-papers/annual-2026/` (`L{level}-{SUBJECT}.json`, Nursery–C5 × BAN/ENG/MATH,
+ ISLAM C1–5, + SCI/BGS C3–5), generated per `docs/exam-paper-generation-brief.md` against the published
syllabus export of 2026-10-06 (still byte-identical on 2026-11-01). 2,234 items: MP2026 517, MP2026_ADAPTED 271,
MP_OTHER 621, MP_OTHER_ADAPTED 301, NEW 524. Nursery/KG have no MP 2026 final — their MP source is Final 2025
(+ HY 2025 for KG). Every file's `authorNotes` lists what was reused, dropped and doubted. Not drafted: Arabic
(picture-based, no book text) and Quran (oral, own module). Load with
`import-drafts.mjs --api … --reviewer "Fida"` (Principal login).

## 7. Open / owner-unconfirmed

- Paper time "৩ ঘণ্টা" where the syllabus gives none (some files copied Mohammadpur's time).
- The syllabus rows are 100 marks incl. oral rows; the printed written paper has been /80 before (see the 10-06 audit).
- Per-paper questions raised by the authoring agents are in the PR body and each file's `authorNotes`.
- Help guides `exam-ep-*` are drafts until screenshots are captured.
