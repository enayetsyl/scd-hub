# Learning-outcome catalogues (mastery tracker)

One file per class × subject, named `<CLASS>_<SUBJ>.md` (`C3_MATH.md`, later `NUR_BAN.md`, `KG_ENG.md`,
`C6_SCI.md`). Contract: `docs/prd-mastery.md` §5.1 and D-#776/#777.

## Status of a file
1. **DRAFT** — generated from the 2027 book's teacher notes (`শিখনফল`) and mark distribution in
   `C:\Users\HP\Downloads\Book Review Material`. Every file ends with **Reviewer notes**: read those first.
2. **Owner review** — edit labels, merge/split outcomes, fix question types and marks directly in the
   file (keep the table columns). Codes may still change while DRAFT.
3. **LOCKED** — change the file's `Status:` line to `LOCKED (YYYY-MM-DD, by …)`. From then on a code is
   permanent: it may be RETIRED (add `RETIRED` in its Assess column), never deleted or re-coded.
4. **Imported** — `skills/_tools/mastery_catalogue_to_json.mjs` (built in M-0) turns the locked file
   into JSON; the Principal imports it in the app (dry-run diff first). Later edits are made in the app's
   catalogue screen; re-export is not required.

## Codes
- Outcome in a chapter: `LO-<CLASS>-<SUBJ>-<CC>-<NN>` — CC = 2-digit chapter/unit, NN = sequence.
- Skill that spans chapters: `LO-<CLASS>-<SUBJ>-SK-<STRAND>-<NN>` (HW handwriting, DICT dictation,
  READ reading aloud, VOC vocabulary, SPELL, GRAM, PUNC, WRITE, ANS answer statement, MENT mental math…).
- Question type: `QT-<SLUG>`, marks per class × subject from the book's mark distribution.
- CLASS ∈ NUR, KG, C1…C6; SUBJ ∈ BAN, ENG, MATH, SCI, BGS, ARABIC, ISLAM.

## Columns
- **Label** — short, plain words the guardian sees (English for the English subject).
- **Book wording** — verbatim from the book, kept for traceability.
- **Assess** — `প্রশ্ন` (written question) or `রুব্রিক` (4-step: ১ পারে না · ২ সাহায্যে পারে · ৩ প্রায় পারে · ৪ ভালো পারে).
- **Question types** — which `QT-` codes can assess the outcome.
- **Home tip** — one sentence shown to the guardian when the outcome is weak (draft; owner edits).

## Coverage (2026-10-20)
| Class | BAN | ENG | MATH | BGS | SCI | ISLAM | ARABIC |
|---|---|---|---|---|---|---|---|
| C1 | draft 106 + 12 SK | draft 38 + 6 SK | draft 29 + 5 SK | — | — | book pending | book pending |
| C2 | draft 161 + 13 SK | draft 49 + 10 SK | draft 56 + 4 SK | — | — | book pending | book pending |
| C3 | draft 80 + 12 SK | draft 31 + 26 SK | draft 42 + 6 SK | draft 68 + 3 SK | draft 63 + 4 SK | book pending | book pending |

(LO count + skill-strand count. C2 BAN is high because the book's outcomes are NCTB TG codes repeated per
lesson — its reviewer notes propose keeping the listening/speaking/reading codes as strands only.)
| C4, C5 | books in review (C5 v1 drafts; C4 Science missing) | | | | | | |
| NUR, KG, C6 | last (D-#784) | | | | | | |
