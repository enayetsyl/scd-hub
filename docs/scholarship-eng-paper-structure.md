# Class 5 English — scholarship paper structure (owner-approved)

**Status: APPROVED by the owner, 2026-09-15 (D-#667/#669). This is the source of truth for
generating a Class 5 English scholarship question paper and for the `ENG` half of the
`ScholarshipTopic` catalogue. Do not re-derive it from the circular's prose.**

Source: NAPE approved প্রশ্নপত্র কাঠামো, প্রাথমিক বৃত্তি পরীক্ষা ২০২৬ — memo
38.04.0000.801.06.314.24, 08 July 2026. **The 2025 paper had 13 items and a different
shape; ignore it.** There is no multiple-choice question in the 2026 English paper.

Its machine-readable twin is the `ENG` array in
`server/scripts/seed-scholarship-topics.ts`. Change one and you change the other.

## The 14 items → 24 topic rows

| # | Part | Marks | Topic label | Seed key |
|---|---|---:|---|---|
| **1** | a | 5 | Match the given words with their meanings | `MATCH-MEANING` |
| | b | 5 | Indicate True/False | `TRUE-FALSE` |
| **2** | — | 5 | Make meaningful sentences with the given words | `SENTENCE-MAKING` |
| **3** | — | 18 | Answer the questions — textbook passage | `COMPREHENSION-SEEN` |
| **4** | — | 5 | Fill in the blanks from the box — unseen text | `UNSEEN-CLOZE` |
| **5** | — | 9 | Answer the questions — unseen text | `COMPREHENSION-UNSEEN` |
| **6** | a | 5 | Identify the parts of speech of the underlined words | `PARTS-OF-SPEECH` |
| | b | 5 | Change the tenses as directed | `TENSE` |
| **7** | a | 6 | Complete the text adding suffixes and prefixes | `AFFIX` |
| | b | 6 | Fill in the gaps with a, an or the | `ARTICLE` |
| **8** | — | 5 | Make WH questions from the given statements | `WH-QUESTION` |
| **9** | a | 7 | Rearrange the words to make meaningful sentences | `REARRANGE-WORDS` |
| | b | 7 | Rearrange the sentences to form a story | `REARRANGE-SENTENCES` |
| **10** | — | 5 | Rewrite using correct capitalization and punctuation | `PUNCTUATION` |
| **11** | a | 5 | Read the information and fill out the form | `FORM-FILL` |
| | b | 5 | Fill in the blanks with cardinal numbers | `CARDINAL-NUMBERS` |
| | c | 5 | Fill in the blanks with ordinal numbers | `ORDINAL-NUMBERS` |
| | d | 5 | Fill in the blanks using information related to time | `TIME-INFO` |
| **12** | — | 5 | Complete the sentences using the correct forms of verbs | `VERB-FORM` |
| **13** | a | 10 | Write a letter | `LETTER` |
| | b | 10 | Write an application | `APPLICATION` |
| | c | 10 | Write an email | `EMAIL` |
| **14** | a | 10 | Write a short composition (free) | `COMPOSITION` |
| | b | 10 | Write a guided composition by answering given questions | `COMPOSITION-GUIDED` |

**24 rows · 168 marks.** Any one printed paper — one part chosen per question — totals
**100**: 5 + 5 + 18 + 5 + 9 + 5 + 6 + 5 + 7 + 5 + 5 + 5 + 10 + 10. Time 2 hours 30 minutes.

## The two kinds of "part", and why only one of them makes a topic

**Form alternatives — items 1, 6, 7, 9, 11, 13, 14.** The blueprint permits either wording,
and the setter picks ONE per paper. Each alternative is a **different ability**, so each gets
its own topic row: a student's marks only ever land on one side, and merging them would
average a skill she was tested on with one she never saw — the exact false finding the
weakness analysis exists to prevent.

**Set A / Set B — items 2, 3, 4, 5, 8, 10, 12.** A model paper gives these an `.a`/`.b` too,
but both halves are the *same question* with different material (question 2 is "Make
meaningful sentences with the given words" both times, with five different words). It is a
device for printing two papers from one unit, **not** a choice of skill, so these stay one
topic row each. Splitting them would invent a distinction the blueprint does not make.

## Item notes the structure alone does not carry

- **Items 1–3 are set on a passage FROM the textbook.** Item 3 asks 6 questions.
- **Items 4–5 are set on a text or dialogue from OUTSIDE the textbook**, written for the
  paper, and it must be of **scholarship standard** — the same difficulty a real বৃত্তি
  paper would print, not an easier warm-up. Item 4 has 5 blanks (box of 7 words), item 5 asks 3
  questions. Different characters, place and situation from the unit, or the item is not
  unseen.
- **Item 11 covers four things**, which is why it has four parts: filling out a form, and
  filling blanks that need cardinal numbers, ordinal numbers, or information about time.
  A numbers item must make the student *work the number out* — never print the numeral
  beside the blank that asks for it.
- **Item 13 has three parts**, not two: letter, application, email.
- Items 6–14 are skill items and should draw their words, sentences and examples from the
  unit being examined, even though they are not bound to it.

## Marks are reference, not the paper's authority

`ScholarshipTopic.marks` records what the blueprint says an item carries, so the catalogue can
be read against the paper in front of you. A **declared** paper is still checked against the
marks the teacher types per item (`Σ(items) = totalMarks`). The catalogue's marks deliberately
do not sum to 100 — see the 168 above.

A topic may carry **no** marks: every hand-added topic, and every প্রাথমিক বিজ্ঞান /
বাংলাদেশ ও বিশ্বপরিচয় answer-form row, whose marks vary per paper. The UI shows nothing
rather than 0 in that case, because a 0 reads as a worthless item.

## Why English is labelled in English

Every other subject's catalogue is Bangla, per the house rule in `AGENTS.md`. English is the
exception the rule already implies: its items are *printed* in English on the paper, so a
Bangla label made the teacher translate backwards to find the row matching the question in
front of her. The stored field is still called `labelBn` — it is the one display label, and
renaming a stored field to carry a single subject's language would be a migration for nothing.

## Related

- `server/scripts/seed-scholarship-topics.ts` — the machine-readable twin of the table above.
  Re-seed with `--commit --prune` after any change here, or retired rows stay in the picker.
- `docs/prd-scholarship-practice.md` §5.2.3 — the decision record for this structure.
- `scholarship/PROMPT_C5_ENG_question_generator.md` — the question-generator prompt. **That
  folder is gitignored**, so it exists only on the machine that holds it; this file is the
  committed copy and wins on any disagreement.
