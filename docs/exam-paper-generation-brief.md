# Exam-paper generation brief — Sylhet Annual 2026 (Nursery – Class 5)

Written for the authoring agents that draft the Sylhet branch's Annual 2026 papers
(D-#1031, docs/prd-exam-paper-bank.md). The drafts are imported into the app as
`ExamPaperDraft` rows and reviewed item by item by the assigned reviewer.

## 1. Authority order (read this first)

1. **The published Sylhet syllabus** (one file per paper, `syllabus/L{level}-{SUBJECT}.md`
   in the source pack) is the authority for: which sections exist, their ORDER, the
   question TYPE, `count × marksEach = total`, the full marks, and the SCOPE (chapters,
   pages, lessons). Text in brackets inside a row label is a rule ("৩টি করে বিকল্প").
   For classes 1–5, also read that subject's section in
   `SCD_Sylhet_Syllabus_and_Marks_2026.md` — its "Rules to follow" digest is part of the
   authority.
2. **Mohammadpur Annual 2026** (the guide). For every section, first look for questions of
   the same type in the Mohammadpur 2026 final of the same class and subject. If the
   content is inside the Sylhet scope, REUSE it:
   - verbatim → `source: "MP2026"`;
   - changed (numbers, wording, count, option count, fitted to the Sylhet row) →
     `source: "MP2026_ADAPTED"`, and say what changed in `note`.
3. **Other Mohammadpur papers** (Final 2025, Half-yearly 2026, Half-yearly 2025) — same rule,
   `source: "MP_OTHER"` / `"MP_OTHER_ADAPTED"`.
4. **The textbook** — only when no Mohammadpur question fits, write a new one from the book
   (`source: "NEW"`, with `bookRef`).

An MP question is reusable only if what it asks is inside the Sylhet syllabus scope. Check
the chapter/page against the book before reusing. Never reuse a question from outside scope
just because its type matches.

## 2. Hard rules

- One section per syllabus row, same order, `syllabusRowSeq` = the row's `seq`.
  `count`, `marksEach`, `total` are copied from the row. Σ section totals = `fullMarks`.
- Exactly `count` items, unless the row/digest allows a choice ("যেকোনো", "অথবা") — then add
  the extra items and set `choiceNoteBn` (e.g. "যেকোনো ৫টির উত্তর দাও").
- A count-1 row worth 5+ marks (e.g. "নামতা লেখ 1 × 10", "অঙ্কে লেখ 1 × 10") may be split
  into reviewable parts: set `splitMarks: true` and give each item its `marks`
  (Σ item marks = section total).
- `kind: "ORAL"` for an oral (মৌখিক) row. Its items are the examiner's prompts (no answers
  needed). Every other row is `kind: "WRITTEN"`.
- Answer key: give `answer` for every objective item (MCQ, fill-in, true/false, matching,
  one-word, every Maths item). For descriptive items give short answer points.
- MCQ: put choices in `options` (3 or 4, as the row says; default 4 for classes 3–5, 3 for
  Nursery–2) and the correct one in `answer`.
- Matching: put the right-hand column (with any extra distractors the label asks for) in
  the section's `matchRight`; each item is one left-hand entry, `answer` = its match.
- A passage, word bank or table shared by several items goes in the section's `stimulusMd`.
- Pictures: write `[ছবি: …]` describing the picture in the item text and set
  `needsPicture: true`. The Office adds the picture at print time.
- Language: Bangla for everything except the English paper (English) and English-version
  rows the syllabus itself writes in English (KG/Nursery maths "Write in numbers").
  Use Bangla digits in Bangla text. Bangla Maths uses Bangla digits.
- Age level: the textbook chapter sets the level, not the Mohammadpur paper.
- No real student names.
- Keep `instructionBn` close to the published row label (it is what the child reads);
  drop bracketed rule-text that is a note to the setter, keep the marks out of it (the app
  prints marks itself).
- The MP 2026 files: C3 BGS/Science and C4 BGS are /50 papers, and the C5 BGS file is MP's
  অর্ধ-বার্ষিক (half-yearly) paper. Check the class/term printed in each file's header —
  some files are misnamed (C4 Bangla is "Class 3_ Bangla.docx", C4 English is
  "English_5.docx"); if a file is really another class's paper, say so in `authorNotes`
  and use it only as an MP_OTHER source for the class it actually belongs to.
- Bangla PDFs sometimes extract with scrambled vowel signs. When an extracted `.txt` reads
  badly, open the original PDF with the Read tool (it renders pages) instead.

## 3. Output format — `scd.exam-paper-draft/v1`

One JSON file per paper: `server/assets/exam-papers/annual-2026/L{level}-{SUBJECT}.json`
(level −1 = Nursery, 0 = KG, 1–5 = classes; subjects BAN ENG MATH ISLAM SCI BGS).

```json
{
  "schema": "scd.exam-paper-draft/v1",
  "key": "annual-2026-L3-BAN",
  "exam": { "term": "ANNUAL", "year": 2026, "nameBn": "বার্ষিক পরীক্ষা ২০২৬" },
  "classLevel": 3,
  "subject": "BAN",
  "titleBn": "বার্ষিক পরীক্ষা ২০২৬ · তৃতীয় শ্রেণি · বাংলা",
  "fullMarks": 100,
  "durationBn": "৩ ঘণ্টা",
  "syllabusRows": [ { "seq": 1, "label": "…", "itemType": "mcq", "component": null, "count": 5, "marksEach": 1, "total": 5 } ],
  "sections": [
    {
      "seq": 1,
      "syllabusRowSeq": 1,
      "kind": "WRITTEN",
      "instructionBn": "সঠিক উত্তরটি বেছে নিয়ে লেখ",
      "count": 5, "marksEach": 1, "total": 5,
      "choiceNoteBn": null,
      "splitMarks": false,
      "stimulusMd": null,
      "matchRight": null,
      "items": [
        {
          "key": "s1-1",
          "text": "‘খোকন’ কবিতাটি কার লেখা?",
          "options": ["…", "…", "…", "…"],
          "answer": "…",
          "marks": 1,
          "source": "MP2026_ADAPTED",
          "sourceRef": "মোহাম্মদপুর বার্ষিক ২০২৬ · প্রশ্ন ২(ক)",
          "bookRef": "পাঠ ৩, পৃষ্ঠা ১২",
          "needsPicture": false,
          "note": "বিকল্প ৩টি থেকে ৪টি করা হয়েছে"
        }
      ]
    }
  ],
  "authorNotes": "English, for the owner: what was reused, what had no MP match, any doubts."
}
```

`syllabusRows` is a verbatim copy of the paper's মানবন্টন table (seq, label, itemType,
component, count, marksEach, total). Item `key`s are unique in the paper (`s{section}-{n}`).
`sourceRef` (Bangla, short) is required for every MP-sourced item; `note` (Bangla, short)
explains any adaptation; both are shown to the reviewer.

## 4. Check before you finish

```
node server/scripts/exam-papers/validate-drafts.mjs server/assets/exam-papers/annual-2026/L3-BAN.json
```

Fix every `FAIL` line. Then re-read each section against its syllabus row once more:
type, count, marks, scope.
