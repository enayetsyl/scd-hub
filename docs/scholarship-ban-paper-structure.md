# Class 5 বাংলা — scholarship paper structure (owner-approved)

**Status: APPROVED by the owner, 2026-09-15 (D-#677). This is the source of truth for the `BAN`
half of the `ScholarshipTopic` catalogue. Do not re-derive it from the circular's prose.**

Source: NAPE approved প্রশ্নপত্র কাঠামো, প্রাথমিক বৃত্তি পরীক্ষা ২০২৬ — memo
38.04.0000.801.06.314.24, 08 July 2026, the বাংলা table (15 items, পূর্ণমান ১০০, সময় ২ ঘণ্টা ৩০ মিনিট).

Its machine-readable twin is the `BAN` array in `server/scripts/seed-scholarship-topics.ts`.
Change one and you change the other. The English twin is `docs/scholarship-eng-paper-structure.md`.

## The 15 items → 21 topic rows

| # | Part | Marks | Topic label | Seed key |
|---|---|---:|---|---|
| **১** | — | 10 | কবিতা মুখস্থ লিখন | `POEM-RECALL` |
| **২** | — | 5 | শব্দার্থ লিখন | `WORD-MEANING` |
| **৩** | — | 5 | বাক্য গঠন | `SENTENCE` |
| **৪** | — | 5 | শূন্যস্থান পূরণ | `FILL-BLANK` |
| **৫** | — | 5 | বহুনির্বাচনি | `MCQ` |
| **৬** | ক | 5 | বিপরীত শব্দ লিখন | `ANTONYM` |
| | খ | 5 | সমার্থক শব্দ লিখন | `SYNONYM` |
| **৭** | — | 8 | সংক্ষিপ্ত-উত্তর প্রশ্ন | `SHORT-ANSWER` |
| **৮** | — | 15 | বিস্তৃত-উত্তর প্রশ্ন | `LONG-ANSWER` |
| **৯** | ক | 5 | কবিতার মূলভাব লিখন | `MAIN-IDEA-POEM` |
| | খ | 5 | গদ্যাংশের মূলভাব লিখন | `MAIN-IDEA-PROSE` |
| **১০** | ক | 5 | ভাষারীতি পরিবর্তন | `LANGUAGE-STYLE` |
| | খ | 5 | পদ নির্ণয় | `PARTS-OF-SPEECH` |
| | গ | 5 | ক্রিয়ার কাল | `VERB-TENSE` |
| **১১** | — | 5 | প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন প্রয়োগ | `QUESTION-MAKING` |
| **১২** | — | 5 | যুক্তবর্ণ বিভাজন ও শব্দ গঠন | `CONJUNCT` |
| **১৩** | — | 5 | এককথায় প্রকাশ | `ONE-WORD` |
| **১৪** | ক | 5 | ফরম পূরণ | `FORM-FILL` |
| | খ | 5 | আবেদনপত্র লিখন | `APPLICATION` |
| **১৫** | ক | 12 | রচনা লিখন (সূত্রসহ) | `COMPOSITION-GUIDED` |
| | খ | 12 | রচনা লিখন (উন্মুক্ত) | `COMPOSITION` |

**21 rows · 137 marks.** Any one printed paper — one part chosen per item — totals **100**:
10 + 5 + 5 + 5 + 5 + 5 + 8 + 15 + 5 + 5 + 5 + 5 + 5 + 5 + 12.

## Which items have parts, and why

**Five items offer a choice of wording: ৬, ৯, ১০, ১৪, ১৫.** Each alternative is a **different
ability**, so each gets its own topic row — the setter prints one, a student's marks land on that
side alone, and merging them would average a skill she was tested on with one she never saw.

The other ten items have no alternative and are one row each.

**This is the same ruling as English (D-#672), applied to the বাংলা table by the owner** on
2026-09-15: *"in bangla question 6 should have a and b, 9 should have a and b, 10 should have
a,b,c, 14 should be a and b and 15 should be a and b."*

## The open question — item ১১

Item ১১ prints **প্রশ্ন তৈরিকরণ / প্রদত্ত অনুচ্ছেদে বিরামচিহ্ন প্রয়োগ**, which is a slash joining
two arguably different abilities: making questions from a passage, and applying punctuation to
one. **The owner did not list it among the items to split**, so it stays a single row.

It is recorded here because the same thing happened on the English table: items 11 and 14 were
first left merged and the owner later split them (D-#672). Splitting this one is a one-line change
plus a re-seed with `--prune`.

## The labels stay Bangla

English is labelled in English only because the English paper prints its items in English
(D-#670). বাংলা prints its own, so the house rule in `AGENTS.md` applies unchanged.

## Marks are reference, not the paper's authority

`ScholarshipTopic.marks` records what the blueprint says an item carries. A **declared** paper is
checked against the marks the teacher types per item; since D-#675 the items need not total the
full marks at all, because a paper listing every alternative sums to 137 while the sitting is 100.

## Codes reused and retired

Nine keys survive unchanged (`POEM-RECALL`, `WORD-MEANING`, `SENTENCE`, `FILL-BLANK`, `MCQ`,
`SHORT-ANSWER`, `LONG-ANSWER`, `QUESTION-MAKING`, `CONJUNCT`, `ONE-WORD`, `COMPOSITION`), so a
paper already tagged with one keeps its marks. Four are soft-retired by `--prune` because the item
they stood for was split: `ANTONYM-SYNONYM`, `MAIN-IDEA`, `GRAMMAR-FORMS`, `FORM-APPLICATION`.
Never hard-deleted — that would strand a tagged item's marks (the D-#548 posture).

## Related

- `server/scripts/seed-scholarship-topics.ts` — the machine-readable twin. Re-seed with
  `--commit --prune` after any change here, or the retired rows stay in the picker.
- `docs/scholarship-eng-paper-structure.md` — the English table and the ruling this follows.
- `docs/prd-scholarship-practice.md` §5.2.3 — the decision record.
