# Class 5 বাংলা — scholarship paper structure (owner-approved)

**Status: APPROVED by the owner, 2026-09-15 (D-#677). This is the source of truth for the `BAN`
half of the `ScholarshipTopic` catalogue. Do not re-derive it from the circular's prose.**

Source: NAPE approved প্রশ্নপত্র কাঠামো, প্রাথমিক বৃত্তি পরীক্ষা ২০২৬ — memo
38.04.0000.801.06.314.24, 08 July 2026, the বাংলা table (15 items, পূর্ণমান ১০০, সময় ২ ঘণ্টা ৩০ মিনিট).

Its machine-readable twin is the `BAN` array in `server/scripts/seed-scholarship-topics.ts`.
Change one and you change the other. The English twin is `docs/scholarship-eng-paper-structure.md`.

## The 15 items → 22 topic rows

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
| **১১** | ক | 5 | প্রশ্ন তৈরিকরণ | `QUESTION-MAKING` |
| | খ | 5 | বিরামচিহ্ন প্রয়োগ | `PUNCTUATION-BN` |
| **১২** | — | 5 | যুক্তবর্ণ বিভাজন ও শব্দ গঠন | `CONJUNCT` |
| **১৩** | — | 5 | এককথায় প্রকাশ | `ONE-WORD` |
| **১৪** | ক | 5 | ফরম পূরণ | `FORM-FILL` |
| | খ | 5 | আবেদনপত্র লিখন | `APPLICATION` |
| **১৫** | ক | 12 | রচনা লিখন (সূত্রসহ) | `COMPOSITION-GUIDED` |
| | খ | 12 | রচনা লিখন (উন্মুক্ত) | `COMPOSITION` |

**22 rows · 142 marks.** Any one printed paper — one part chosen per item — totals **100**:
10 + 5 + 5 + 5 + 5 + 5 + 8 + 15 + 5 + 5 + 5 + 5 + 5 + 5 + 12.

## Which items have parts, and why

**SIX items offer a choice of wording: ৬, ৯, ১০, ১১, ১৪, ১৫.** Each alternative is a **different
ability**, so each gets its own topic row — the setter prints one, a student's marks land on that
side alone, and merging them would average a skill she was tested on with one she never saw.

The other nine items have no alternative and are one row each.

**This is the same ruling as English (D-#672), applied to the বাংলা table by the owner** on
2026-09-15: *"in bangla question 6 should have a and b, 9 should have a and b, 10 should have
a,b,c, 14 should be a and b and 15 should be a and b."* — five items — and extended to item ১১ on
2026-09-20: *"only make প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন প্রয়োগ two parts."*

## Item ১১ is split; item ১২ is not — and the source says why

These two look alike on the page. They are not alike, and the difference is printed in the
কাঠামো itself (`Class5_Bangla_Template_v2_Scholarship2026.md`, §১০–১২):

| item | as the কাঠামো prints it | its note | ruling |
|---|---|---|---|
| **১১** | প্রশ্ন তৈরিকরণ **/** প্রদত্ত অনুচ্ছেদে বিরামচিহ্ন প্রয়োগ | **"দুইটির যেকোনো একটি"** | **two rows** |
| **১২** | যুক্তবর্ণ বিভাজন **ও** শব্দ গঠন | *no note* | **one row** |

**১১ is a slash with an either/or annotation** — the setter prints one branch, the student sits
one, and a combined row would have averaged two different lessons into a single percentage. A weak
row is supposed to tell a teacher what to re-teach on Sunday; *"প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন
প্রয়োগ — ৪০%"* names two lessons and points at neither.

**১২ is an "ও", and carries no either/or note at all.** Both tasks are printed inside one 5-mark
item (৫টি থাকবে, ৫টির উত্তর দিতে হবে), so the student sits both and the two are not alternatives.
Splitting it would mean dividing the item's 5 marks between two rows — which both slows every row
past the 15-mark reliability floor and invents a division the paper does not make. **One row
measures what the paper actually tests.**

**The template's own summary line settles the count:** *"**six slots became either/or slots**"* —
৬, ৯, ১০, ১১, ১৪, ১৫. The list this table was first built from named five and missed ১১; that is
the whole of the error, and it is now fixed.

## Codes: nothing retired by the ১১ split

`QUESTION-MAKING` is **reused with a narrowed label** (প্রশ্ন তৈরিকরণ ও বিরামচিহ্ন প্রয়োগ →
প্রশ্ন তৈরিকরণ) and `PUNCTUATION-BN` is new, so `--prune` deactivates nothing on this run.

Narrowing a live code is normally the wrong move — a বিরামচিহ্ন mark already stored under the
combined code would silently start reading as প্রশ্ন তৈরিকরণ. **This was checked against prod on
2026-09-20, not assumed: all six score rows belong to the English paper and no `BAN` topic carries
a mark at all**, so there is no such mark to mislabel.

**That fact has a short shelf life.** Prod held *zero* score rows on 2026-09-17 and six on
2026-09-20 — marks are being entered now. Before any further narrowing of a live বাংলা code,
re-run the check; once a বাংলা paper is scored, mint a **new** code for both halves instead of
re-pointing an old one.

## The labels stay Bangla

English is labelled in English only because the English paper prints its items in English
(D-#670). বাংলা prints its own, so the house rule in `AGENTS.md` applies unchanged.

## Marks are reference, not the paper's authority

`ScholarshipTopic.marks` records what the blueprint says an item carries. A **declared** paper is
checked against the marks the teacher types per item; since D-#675 the items need not total the
full marks at all, because a paper listing every alternative sums to 142 while the sitting is 100.

## Codes reused and retired

Eleven keys survive unchanged (`POEM-RECALL`, `WORD-MEANING`, `SENTENCE`, `FILL-BLANK`, `MCQ`,
`SHORT-ANSWER`, `LONG-ANSWER`, `QUESTION-MAKING`, `CONJUNCT`, `ONE-WORD`, `COMPOSITION`), so a
paper already tagged with one keeps its marks. Four are soft-retired by `--prune` because the item
they stood for was split: `ANTONYM-SYNONYM`, `MAIN-IDEA`, `GRAMMAR-FORMS`, `FORM-APPLICATION`.
Never hard-deleted — that would strand a tagged item's marks (the D-#548 posture).

**One key is new: `PUNCTUATION-BN`** (item ১১.খ, 2026-09-20). It is *not* `PUNCTUATION` — that
code is already taken by the English item 10, and a topic code is unique per subject **and**
per class level, so reusing the bare name would have been legal but unreadable in a picker
listing both subjects. `QUESTION-MAKING` keeps its code with a narrowed label; see the section
above for why that is safe exactly once.

## Three owner rulings on how items are set (2026-09-20)

**1. Item ১০ (ক্রিয়ার কাল) uses only the three main tenses.** The direction printed beside each
sentence is **অতীত কাল · বর্তমান কাল · ভবিষ্যৎ কাল** — never the sub-divisions (ঘটমান বর্তমান,
পুরাঘটিত বর্তমান, নিত্যবৃত্ত অতীত). Five sentences across three tenses, so two of them repeat;
that is expected, not a fault.

**2. Item ১১.ক (প্রশ্ন তৈরিকরণ) prints an অনুচ্ছেদ.** The কাঠামো's own wording is
*"অনুচ্ছেদ (পাঠ্যবই / সমমানের) পড়ে প্রদত্ত নির্দেশনা অনুসারে প্রশ্ন তৈরিকরণ"* — the passage is
part of the item, not optional. **সমমানের** means it need not come from the lesson, and in practice
it should not: a lesson passage here collides with whatever else the paper tests. Use a short
neutral passage of the same standard, and let the answer-leak checker confirm it.

**3. In a কবিতা lesson, the first 8 lines never appear on the question paper.** Item ১ asks the
student to write them from memory, so any other item that reproduces them — or their distinctive
wording — hands over the answer.

The third rule is sharper than it sounds, and the পাঠ ৩ paper needed four fixes to satisfy it:

| what it was | why it broke the rule |
|---|---|
| ৪(খ) *"পাড়জুড়ে ঝোপঝাড় আর ____-জঞ্জাল।"* | near-verbatim line 6 |
| ৪(ঙ) *"মাঝিরা চৌপর দিনভর ____-পাল্লা দিচ্ছে।"* | near-verbatim lines 3–4 |
| ৮(খ) *"শৈবালকে কেন **‘পান্নার টাঁকশাল’** বলা হয়েছে?"* | quotes the whole of line 8 |
| ৫(খ) *"নদীর সারা পাড় জুড়ে কী রয়েছে?"* → ঝোপঝাড় | hands over two of line 5's three words |

**What stays allowed:** isolated glossary words (চৌপর, টাঁকশাল, মাল্লা) in items ২, ৩ and ১৭.
They come from the poem and always will; a single word out of context gives no line order and no
phrasing, which is what item ১ actually marks. **The line is between a word and a line.**

## No item may answer another item (D-#682)

**A skill item may borrow the unit's names and setting. It may never restate a fact that a
passage item tests.**

This is the defect that got past three finished papers at once. The skill items (6–14) need a
sentence to work on, and the passage is the nearest source of sentences — so the WH-question item
ended up printing *"Rupa could not borrow a book because she had no library card"* while question
3(c) asked *"Why has Rupa not borrowed any book today?"*, and the true/false item asked whether
she had borrowed two storybooks. Four of five true/false answers, and one of the 18-mark
comprehension answers, were readable off other questions without opening the passage.

It is easy to miss by eye because each item looks correct on its own. Run the checker:

```
node skills/_tools/check_answer_leak.mjs <paper.md>
```

It reports the distinctive words any fact item shares with any carrier sentence. **A shared NAME is
expected and fine** — skill items are supposed to use the unit's characters. A shared name **plus a
shared predicate** is the leak. It is a flag, not a verdict: read every pair.

Three consequences worth stating, because each one bit:

- **The জুম্বল/rearrange item counts as a carrier too.** "The students clean the garden" handed over
  one of the three things question 3(d) asks for.
- **A printed passage answers everything in it.** The বাংলা মূলভাব item prints a paragraph; nothing
  else on that paper may test a fact from *that* paragraph. The occupations paragraph and the
  এককথায় প্রকাশ item could not coexist, so the latter moved off the lesson entirely — it is a skill
  item and never had to come from the lesson.
- **Two items must not test the same fact.** The বাংলা fill-in and the MCQ both asked which
  community lives in ময়মনসিংহ, and the fill-in's word box contained the answer.

## Related

- `server/scripts/seed-scholarship-topics.ts` — the machine-readable twin. Re-seed with
  `--commit --prune` after any change here, or the retired rows stay in the picker.
- `docs/scholarship-eng-paper-structure.md` — the English table and the ruling this follows.
- `docs/prd-scholarship-practice.md` §5.2.3 — the decision record.
