# PRD — Scholarship practice papers & topic-wise weakness analysis (`scholarship` module)

**Status:** SC-0..SC-4 BUILT and in production (2026-09-14); **SC-7 BUILT 2026-09-21**;
**SC-8 BUILT 2026-09-22**. SC-5/SC-6 contracted, unbuilt.
**Decision block:** D-#656–#665, reserved against `origin/dev@929596d3` (2026-09-14, max D-#655).
**Owner ask (2026-09-14):** "I will prepare scholarship-exam-style questions for each subject and
give them to students on different days. I want to declare a question which may have different
topics of a subject — mcq, fill in the blank, etc — and may cover one or more chapters. Their marks
should be recorded topic-wise. The main aim is to get analysis about which student is weak in which
topic or in which chapter."

## §0 — At a glance / build order (read first)

| Slice | What it is | Blocks |
|---|---|---|
| SC-0 | `ScholarshipTopic` catalogue + the five-subject skill seed | everything |
| SC-1 | Declare a paper: header + its items (topic × chapters × type × marks) | SC-2 |
| SC-2 | Mark entry: roster × item grid, one number per cell | SC-3 |
| SC-3 | Per-student analysis: topic + chapter weakness | SC-4 |
| SC-4 | Class analysis: heat-map, trend across papers | — |
| SC-5 | Guardian release (publish gate) | SC-3 |
| SC-6 | Analysis PDF / print | SC-3 |
| SC-7 | The second door through the floor, per-topic trend, class position, paper-by-paper list | — |
| SC-8 | Class-five-only picker; one student × one subject as Markdown, for generating practice | — |

**SC-0..SC-3 is the minimum that answers the owner's question.** SC-4..SC-6 are additive and each
stands alone.

## §1 — Goal

Seven Class-5 students sit practice papers modelled on the প্রাথমিক বৃত্তি পরীক্ষা ২০২৬ structure,
one subject at a time, over the months before the exam. The school needs to know, per student, **which
skill they keep losing marks on** — not their total. A total of 74/100 says nothing actionable; "loses
70% of the article marks, every paper, across three chapters" names the next tutorial.

Papers are authored **outside the app** (see `scholarship/` at the repo root — the NAPE 2026 structure,
the unit source files, the generator prompt). This module does not author questions. It records a
paper's **structure**, records **per-item marks**, and derives the analysis.

## §2 — Gap table

| Need | Today | Verdict |
|---|---|---|
| A paper's item structure (label, type, marks, Σ=100) | `ExamSyllabus.marks[]` does exactly this for a syllabus | **shape reused, not the model** — a syllabus is a published promise to guardians; a practice paper is a private record |
| Per-item marks per student | Nothing. `ClassTestResult.marks` and `ExamMark.rawMark` are both **one number per paper** | **the gap.** The whole module exists for this row |
| Topic axis | `HomeworkTopic` is chapter-shaped (পাঠ ১–৩), seeded from lesson plans | insufficient — grammar skills (article, tense) do not map onto chapter groups (D-#657) |
| Chapter axis | `ContentArtifact.address.number` on bank questions | not reusable — these papers are not assembled from the bank |
| Item-type vocabulary | `SYLLABUS_ITEM_TYPES` (10 codes, app-native, not mirrored to the import contract) | **reused verbatim** (D-#658) |
| Roster of a section | `Student` + `Section`, the CT-1 roster read | reused |
| Guardian delivery with an approval gate | `ClassTestResult` CT-8 (submit → approve/send-back → publish) | **shape reused** at SC-5 |

## §3 — Reused / unchanged (do not rebuild)

- `SYLLABUS_ITEM_TYPES` + `SYLLABUS_ITEM_TYPE_LABELS_BN` (`shared/vocab.ts`) — mcq, short_answer,
  true_false, fill_blank, matching, descriptive, creative, oral, practical, other.
- `HW_SUBJECTS` — `BAN ENG MATH SCI BGS` cover all five scholarship subjects exactly; no new subject
  vocabulary.
- The roster read and the section anchor (`sectionId` + derived `classId`/`classLevel`/`academicYearId`),
  server-derived exactly as `ClassTest` does it (D-#143) — never client-supplied.
- `StoredFile` for the optional attached paper (.docx / .pdf).
- The routine-derived subject-teacher gate (SY-1 / D-#521) — the only source that reaches subjects
  with no `Subject` row.
- The CT-8 submit → approve → publish chain shape, at SC-5 only.

## §4 — New vocabulary (app-native, `shared/vocab.ts`)

**Not mirrored to the import contract**, so `/skills/contract-sync` does NOT apply — but the shared
vocab verifier does, and every addition needs its BN + EN permission label and its RBAC rows.

```
SCHOLARSHIP_PAPER_STATUSES      = ["DRAFT", "DECLARED", "SCORED", "PUBLISHED"]
SCHOLARSHIP_ATTENDANCE_STATUSES = ["PRESENT", "ABSENT"]   // mirrors CLASS_TEST_ATTENDANCE_STATUSES
SCHOLARSHIP_TOPIC_AXES          = ["skill", "content"]    // D-#665/#666
SCHOLARSHIP_MIN_MARKS_FOR_VERDICT = 15                    // the reliability floor, D-#662
SCHOLARSHIP_BAND_WEAK_BELOW = 50 · SCHOLARSHIP_BAND_GOOD_AT_OR_ABOVE = 70 · SCHOLARSHIP_CLASS_GAP_FLAG = -15
"scholarship:manage"  → declare a paper, maintain topics, enter marks  (Principal, Office, TEACHER)
"scholarship:read"    → read papers + analysis, row-scoped             (Principal, Office, TEACHER)
```

Both are **build** permissions, beside `exam:manage`.

**There is deliberately no `scholarship:publish`.** Releasing a student's analysis to their guardian
rides the **PRINCIPAL role inside the resolver**, the `exam:manage` / D-#397 posture — so authoring
and scoring can be delegated to the Office or a senior teacher without also handing over the release.
A permission would have made the two inseparable. Pinned by a verifier check that refuses any third
`scholarship:*` permission.

**`scholarship:manage` on TEACHER is a base permission, so it is not the scope.** A teacher may only
touch a paper whose class × subject she holds in the **routine**, checked in the service (the CT-1 /
D-#521 posture). Unscoped it would be a write on every class's papers — the QR-9 lesson, where
`content:review` as a teacher base permission nearly handed every teacher a write on 6,900 documents.

Guardians gain **no** new permission: a released analysis is read under the existing
`guardian:read_child`, exactly as `exam:read` notes for syllabuses.

## §5 — The model

Three collections plus a catalogue. All four sit in the **operational / identity plane** — they name
`studentId`, so per ADR-005 there is **no corpus path and no analytics/export resolver** that could
join this to the corpus plane. The firewall test must keep passing untouched.

### 5.1 `ScholarshipTopic` — the skill catalogue (SC-0, D-#657)

```
{ subject: HwSubject, classLevel: number,
  code: "TOP-SCH-ENG-C5-ARTICLE", labelBn: "Fill in the gaps with a, an or the",
  axis: "skill" | "content",        // D-#665/#666 — every seeded topic is a skill today
  marks?: number,                   // D-#672 — what the blueprint says the item carries
  order: number, active: boolean }
```

Unique on `(subject, classLevel, code)`. Curriculum-stable, **not** academic-year scoped.

Deliberately a **new catalogue, not `HomeworkTopic`** (D-#657): `HomeworkTopic` groups chapters
(`পাঠ ১–৩`) because homework is declared against chapters. The scholarship question is the opposite —
"which *skill* does she lose marks on" — and article, tense and suffix-prefix are spread across every
chapter. Overloading the homework catalogue would either pollute the homework picker with skills that
are not homework topics, or force the analysis onto an axis that cannot answer the question.

Seed for English: its 14 printed items expanded to **24 topics**, in English, each carrying the
marks the blueprint fixes (D-#670/#672, §5.2.3). **The approved table lives in
`docs/scholarship-eng-paper-structure.md`** — that file and the `ENG` array in the seed are the
two halves of one source of truth, and neither is re-derived from the circular's prose.

বাংলা follows the same ruling on its own table — 15 printed items → **21 topics**, in Bangla, with
marks (D-#677, `docs/scholarship-ban-paper-structure.md`).

**All five subjects are seeded in the same slice** (owner ask, 2026-09-14): বাংলা 21, English 24,
গণিত 11 from their own item tables, and প্রাথমিক বিজ্ঞান / বাংলাদেশ ও বিশ্বপরিচয় 6 each — their
ANSWER FORMS, per the owner ruling in §5.2.2 (D-#666). **68 topics** in all — 24 + 21 + 11 + 6 + 6.
**Confirm it against the seed's own printed count on the next run**, never against this arithmetic.

> This line read **69** from D-#665 until that run, and the number was wrong from D-#666 onward.
> 69 was right while SCI/BGS held **29 chapter rows** read out of the question bank; D-#666 replaced
> those with six answer forms each and never corrected the total, so every later edit (75, then 79)
> added a delta to a stale base. Trust the seed's printed count, not an arithmetic in prose.

`content` remains a legal axis and nothing seeds it today; it exists for a subject whose topics are
genuinely chapters, and the analysis reads the field rather than branching on subject either way.

### 5.2 `ScholarshipPaper` — the declared paper (SC-1)

```
{ paperId: "SP-C5-ENG-0001",        // unique, year-continuous, atomic (the ClassTest ctId pattern)
  academicYearId, classId, classLevel, sectionId,   // all derived server-side from sectionId
  subjects: HwSubject[],            // usually one; [SCI, BGS] for the combined paper (D-#664)
  name: "Unit 1 — At the Library · Model 1",
  paperDate: Date,
  totalMarks: number,               // 100 for a full paper; a short practice may be any total
  durationMinutes?: number,
  sourceNote?: string,              // e.g. "NAPE 2026 structure, generated from C5_ENG_Source_01"
  questionFileId?: ObjectId,        // StoredFile — the .docx/.pdf actually handed out
  status: ScholarshipPaperStatus,
  items: ScholarshipItem[],
  declaredBy, declaredAt, createdAt, updatedAt }
```

`ScholarshipItem` (subdocument — it has no life outside its paper):

```
{ itemNo: number,                   // 1..N, the number printed on the paper
  label: "Suffix-prefix / articles",
  subject: HwSubject,               // ALWAYS set; must be one of the paper's `subjects` (D-#664)
  topicCode: string,                // EXACTLY ONE (D-#659)
  chapters: number[],               // ZERO OR MORE (D-#659)
  itemType: SyllabusItemType,
  marks: number }
```

**One topic, many chapters (D-#659).** The owner's ask allows an item to "cover one or more chapters",
and item 3 of the English paper genuinely does. But a *second* topic on one item would make the topic
percentage unattributable — 4 marks lost across two topics cannot be split without inventing a
weighting. If an item truly spans two skills, it is two items on the declaration, even if the paper
prints it as one; that is a declaration decision the teacher makes once, not a computation the app
guesses every time.

**Guard:** `Σ items[].marks === totalMarks`, enforced on declare, one universal check — the
`validateMarkRows` posture from `ExamSyllabus` (D-#532). Refuse the declaration, never silently store
a paper whose parts do not add up.

### 5.2.1 One paper may span two subjects (D-#664)

The NAPE 2026 circular sets **প্রাথমিক বিজ্ঞান এবং বাংলাদেশ ও বিশ্বপরিচয় as a single paper** —
`পূর্ণমান: ৫০+৫০=১০০`, one 2½-hour sitting, two signed 5-item tables under one heading. Bangla,
English and গণিত are each their own paper (15, 14 and 11 items).

So `subject` cannot live on the paper alone:

- **Not two papers.** The two halves share one date, one roster and one absence. A student who
  misses that morning misses both halves; two records could disagree about whether she sat it, and
  the teacher would declare and score the same sitting twice.
- **Not one paper-level subject.** Every roll-up is `(subject, topic)`. A single `subject: SCI`
  would file every BGS topic under Science and make the বাংলাদেশ ও বিশ্বপরিচয় analysis unreadable.

Hence `subjects: HwSubject[]` on the paper and a required `subject` on every item, validated to be
one of the paper's. A single-subject paper is the same shape with a one-element list — no special
case anywhere in the analysis.

**The Σ guard stays global.** `Σ items[].marks === totalMarks` (100). The 50/50 split is a NAPE
convention, not an invariant: the per-subject subtotal is *shown* while declaring so a mistake is
visible, but it is not enforced — a 20-mark practice drill covering only Science must stay legal.

### 5.2.2 The topic axis is not the same shape in every subject (D-#665)

In English and বাংলা the printed items **are** skills — article, tense, WH-question, যতিচিহ্ন,
যুক্তবর্ণ বিভাজন. Tagging them with a skill topic is the whole point.

In প্রাথমিক বিজ্ঞান and বাংলাদেশ ও বিশ্বপরিচয় the five items are **answer forms**: MCQ,
শূন্যস্থান, সত্য-মিথ্যা, মিলকরণ, সংক্ষিপ্ত উত্তর, বিস্তৃত উত্তর — each repeated over whatever
content the setter chose.

**The first cut made those the CHAPTER, and the owner overruled it (D-#666, 2026-09-14).** The
reasoning here had been that a format is not actionable. The paper says otherwise: in a 50-mark
half, বিস্তৃত উত্তর alone is **24 marks** and সংক্ষিপ্ত another **12**, so "she loses most of her
marks on বিস্তৃত" is a finding about long-form writing that can be taught, and মিলকরণ against
বহুনির্বাচনি separates recognition from recall. The owner's own objection was also the decisive
one structurally: with chapters as the topic, the টপিক view and the অধ্যায় view showed **identical
rows**, so one of the two axes was doing no work.

So for those two subjects the topic axis is the **answer form**, `axis: "skill"`. Chapters are not
lost — every declared item still carries its own `chapters`, so the chapter axis keeps working and
the two views now say different things.

This does not contradict D-#657 — it is one catalogue, and only its contents differ per subject.
`ScholarshipTopic.axis: "skill" | "content"` records which, so the picker and the analysis heading
read correctly (`দুর্বল টপিক` vs `দুর্বল অধ্যায়`) without the analysis code branching on subject.

**Every topic now comes from the circular's own signed tables** — including SCI/BGS, whose six
answer-form skills are read straight off their five-row table. The seed carries an explicit ASCII
`key` per topic rather than deriving the code from the array position: the code is what every item
ever tagged with a topic points at, so it must survive both reordering (a position-derived code
silently re-points existing items the first time a row is inserted) and renaming (a label-derived
one would move on exactly the edit `labelBn` exists to allow).

### 5.2.3 English is labelled in English, an "or" item is one topic per alternative, and the catalogue carries marks (D-#670/#672)

Owner, reading the seeded catalogue on prod: *"the english topic list recorded in bangla but it
should be in english"*, and *"there are 14 questions but some questions as variation ... so for topic
list for question 1 should be 1. Match the given words with their meanings / 2. Indicate true/false"*.
The final structure was then settled item by item with the owner and **approved on 2026-09-15** — it
lives in `docs/scholarship-eng-paper-structure.md`, whose table is the twin of the seed's `ENG` array.

**Language.** AGENTS.md asks for Bangla in teacher-facing content and every other subject keeps it.
English is the exception the rule already implies: its items are *printed* in English, so
`ব্যাকরণ — article` forced the teacher to translate backwards to find the row matching the question in
front of her. The stored field stays `labelBn` — it is the one display label, and renaming a stored
field to carry a single subject's language would be a migration bought for nothing.

**Seven items offer alternatives, and each alternative is its own topic** — 1, 6, 7, 9, 11, 13, 14.
The setter picks ONE per paper, so a student's marks only ever land on one side; a merged row would
average a skill she was tested on with one she never saw — which is exactly the false finding this
module exists to prevent. Item 11 has **four** parts (form · cardinal · ordinal · time) and item 13
**three** (letter · application · email). 14 printed items → **24 topics**.

**The other seven items are NOT split** (2, 3, 4, 5, 8, 10, 12), and this is the distinction that
took a round of review to get right. A model paper gives these an `.a`/`.b` as well, but both halves
are the *same question* with different material — question 2 is "Make meaningful sentences with the
given words" both times, with five different words. That is a device for printing two papers from one
unit, **not** a choice of skill. Splitting them would invent a distinction the blueprint does not make
and scatter one ability's marks over two rows.

**Marks are on the catalogue, and deliberately do not sum to 100** (D-#672). `ScholarshipTopic.marks`
records what the blueprint says an item carries, so the list can be read against the paper in front of
you. An item contributes its marks once *per alternative*, so English totals **168 across 24 rows**
while any one printed paper is 100. It is reference only: a declared paper is still checked against the
marks the teacher types per item (`Σ(items) = totalMarks`), which is the authority and stays so. The
field is **optional** — a hand-added topic and every SCI/BGS answer-form row have no fixed mark — and
the UI shows nothing rather than 0, because a 0 reads as a worthless item.

**Nine of the fourteen original codes are REUSED** (`PARTS-OF-SPEECH`, `TENSE`, `ARTICLE`, `AFFIX`,
`WH-QUESTION`, `PUNCTUATION`, `VERB-FORM`, `LETTER`, `COMPOSITION`) so any paper already tagged with
one keeps its marks and simply reads in English from now on. The five whose meaning genuinely changed
(`VOCAB`, `COMPREHENSION`, `UNSEEN`, `REARRANGE`, `FORM-NUMBERS`) are soft-retired by `--prune`, never
deleted — a hard delete would strand a tagged item's marks (the D-#548 posture).

**Numbering is positional, not `order`.** The catalogue screen numbers rows 1..n by their place in
the rendered list. `order` is per-subject and goes gappy the moment a topic is retired, and the
number a teacher matches against her question paper is "the nth row I can see".

### 5.3 `ScholarshipScore` — the missing row (SC-2)

```
{ paperId, studentId,
  status: PRESENT | ABSENT,
  itemMarks: [{ itemNo: number, marks: number }],   // only when PRESENT
  note?: string,
  enteredBy, enteredAt,
  submittedAt?, submittedBy?, sendBackReason?, publishedAt?, publishedVersion }   // SC-5 only
```

Unique on `(paperId, studentId)` — the upsert key, the `ClassTestResult` invariant.

- Total is **derived, never stored** (D-#85's posture): `Σ itemMarks[].marks`. A stored total is a
  second source of truth that drifts the first time a cell is corrected.
- `0 ≤ marks ≤ the item's declared marks`, per cell, checked against the paper's own items.
- ABSENT carries **no** itemMarks and is excluded from every denominator, class and personal
  (the CT §4 rule). Khadiza is simply never scored — see §5.4.
- Half marks are legal (`0.5` steps) — the English paper's item 10 is `0.5 × 10`.

### 5.4 Who sits the paper (D-#660)

**Participation is per paper, never a student flag.** The entry grid lists the section's full roster
and defaults every student to PRESENT; the teacher marks anyone who did not sit as ABSENT. Khadiza is
excluded by being marked ABSENT on each paper — she is *not* removed from the roster, given a flag, or
filtered out of the class.

Any other shape ages badly: a "scholarship candidate" flag has to be maintained, and it silently
decides months of analysis. A student who starts attending again is then just a PRESENT row, with no
migration and no lost history.

## §6 — The analysis (SC-3 / SC-4) — this is the substance

### 6.1 The one computation

For a student, an axis value (a topic code, or a chapter number), and a window of papers:

```
earned    = Σ marks obtained on every item whose topicCode (or chapters[]) matches
available = Σ declared marks of those same items
percent   = earned / available × 100
```

Only PRESENT rows contribute. A paper the student was ABSENT for adds nothing to either side.

**A multi-chapter item counts in full toward every chapter it lists (D-#661).** Item 3 tagged
`chapters: [1, 2]` puts its whole 18 marks into both chapter denominators. The chapter axis therefore
does **not** sum to the paper total, by design — it answers "how does she do on questions that touch
chapter 2", which is the question actually asked. The topic axis, with exactly one topic per item,
*does* sum to the total, and is the axis that reconciles.

### 6.2 The reliability floor (D-#662, amended by D-#691 — read §6.5) — the rule that stops the feature lying

**No topic is called weak on fewer than 15 available marks.** Below that it reports
`যথেষ্ট তথ্য নেই` — not a percentage, not a colour, not a rank.

Without this the first paper produces the strongest-looking signal it will ever produce: one 5-mark
article item, 1 mark earned, "20% — সবচেয়ে দুর্বল", on a sample of one question. A teacher acts on
that, and the app has manufactured a weakness out of a single bad guess. This is the same refusal as
EX-3's "a student with no tracker results pulls **blank, never 0**" — and, like it, the floor is shown
in the UI rather than hidden, so the way to make a topic report is to set another paper covering it.

### 6.3 What "weak" means (D-#663)

Two bands, both shown, because they answer different questions:

- **Absolute** — `< 50%` দুর্বল, `50–69%` মোটামুটি, `≥ 70%` ভালো. Against the scholarship bar, not
  the class.
- **Relative** — this student's percent minus the class mean on that topic (PRESENT rows only).
  `−15` points or worse is flagged.

A student can be weak on both, either, or neither, and the two disagreeing is information: below 50%
on a topic where the whole class is below 50% is a *teaching* problem, not a student problem. The
per-student screen leads with absolute; the class heat-map is relative.

### 6.4 Screens

**SC-3 — per student.** Topic table (percent, earned/available, band, trend arrow vs the previous
paper), then the same on the chapter axis, then a paper-by-paper list. Weakest three topics pinned at
the top.

**SC-4 — class.** Topic × student heat-map, one cell per pair, `যথেষ্ট তথ্য নেই` cells rendered
distinctly from weak cells (grey, not red) — a floor breach must never look like a failure. Plus a
per-topic class mean row, which is what identifies a re-teach.

### 6.5 SC-7 — the second door, the trend, and the place (D-#691/#692, 2026-09-21)

Two English papers were scored and the owner opened the payoff screen. It ranked correctly and
told him nothing he could act on: **17 of 24 topic rows sat under the floor**, and the three worst
results in the whole profile were among them — cardinal numbers 0/10, time-information 0/10,
rearrange-sentences 0/14. Each is a 5-mark item, so the 15-mark floor would have gone on hiding
them until a third paper.

**The second door (D-#691).** `hasVerdict(available, papers)` opens on `available >= 15` **OR**
`papers >= SCHOLARSHIP_MIN_PAPERS_FOR_VERDICT` (2). §6.2 stands unchanged for the case it argued —
one sitting, however lopsided, is still refused — and the mark floor itself is untouched. What is
added is the case §6.2 did not consider: the same small item asked twice is two independent
readings, and two readings agreeing is evidence of a kind the mark count cannot represent. Sample
SIZE remains the mark count; this is sample INDEPENDENCE.

Who asks which gate:

| surface | gate | why |
|---|---|---|
| student topic/chapter row | marks **or** papers | the child's own evidence on that topic |
| heat-map cell | marks **or** papers | same child, same topic — the two screens must agree |
| class mean row | marks only | the cohort's marks pooled clear 15 long before any one child's do, so the second door would never fire; and a paper count taken from one student is the wrong number for a figure about everybody |
| trend point | neither | a point is not a verdict (below) |

**The trend (D-#692).** Every axis row carries `series` — one point per sitting, oldest first,
each the **raw unfloored** percent of that paper alone. A point is a reading, not a judgement, and
the row above it already carries the judgement; blanking the points would leave a row that says
দুর্বল with nothing to show for it. The line is drawn from the second sitting only: one dot is not
a direction. `loadScope` sorts papers by `paperDate` so the series never runs backwards.

**The place (D-#692).** `rankAxis` gives every student a `{rank, of}` per axis value and
`paperResults` does the same per paper.

- **`of` counts the students who SAT it**, not the section. Four of eight sat Unit 2; "৫ম of 8"
  would describe a race four of them never entered. A child with no marks on a topic is absent
  from its ranking, not last — not sitting is not losing.
- **Ties share a place and the next is skipped** (1, 2, 2, 4). Separating equal percents by an
  arbitrary tiebreak states a fact the marks do not contain.
- **An `insufficient` row gets no rank.** A rank is a comparison of percentages; printing one on a
  row that has just refused its percentage would put the hidden number back on screen and undo
  D-#662 through the side door.

**The paper-by-paper list**, promised in §6.4 and missing from SC-3, now opens the screen: her
total and her place on each sitting, oldest first. A paper she did not sit is absent rather than
present as a zero (D-#660), and a paper whose items are all still unmarked is absent too — an
unfinished marking pass is not a result.

### 6.6 SC-8 — class-five only, and the Markdown export (D-#696/#695, 2026-09-22)

**The picker (D-#696).** `SCHOLARSHIP_CLASS_LEVELS = [5]`. The papers screen flattened every
section the caller could reach, so it offered নার্সারি through class five — six chips leading to a
screen that could never hold anything, with the working one sorted last-but-one and needing a tap
every visit. The constant is a domain fact (the primary scholarship examination is sat in class
five), not a cache of what the catalogue happens to contain, which is why it is not a query: a
query fails open on an empty catalogue and offers everything again. Widening the module to another
class means adding a level here and nothing else.

**The export (D-#695).**

```
GET /export/scholarship-analysis?sectionId=…&classLevel=5&studentId=…&subject=ENG  →  text/markdown
```

Streamed, never stored; `studentAnalysis()` reused unchanged so the file and the screen cannot
disagree. `scholarship:read` is re-asserted in the route — a route is a second front door, and a
permission that lives only in the GraphQL layer is not a permission. The student's section is
checked to be her own, because exporting her against another section would rank her against
children she never sat with and every position in the file would be a fiction.

**It is written for a model, not for a person**, and three sections exist only because of that:

| in the file | why it is there |
|---|---|
| "How to read this", before any number | A model handed a table of percentages treats every row as equally meaningful. It states that ABSENT and unmarked items count toward **neither** side (D-#660), and that the floor's rule is 15 marks **or** 2 papers (D-#691). |
| "Not enough evidence yet", a separate section | An under-floor row is an **unknown, not a weakness**. Left in the main table it is the most likely way this output goes wrong — practice drilled on a topic that was simply never tested enough. It says "do not treat these as weaknesses" in as many words. |
| "The shape of a real paper" — the catalogue with each item's marks | Knowing a child is weak at rearranging sentences does not say the item is seven marks and seven strips. Without the blueprint the generated practice is the right topic at the wrong size. |

**The child is NAMED** (owner ruling, 2026-09-22), unlike the de-identified monthly-comment pack
(D-#415). One file per child goes into a chat window and the owner keeps them apart by name; this
is the operational plane, where a paper's scores name students already; and the reader on the other
end teaches her. Audited as `SCHOLARSHIP_ANALYSIS_EXPORTED` with the student as target — a named
performance record leaving the building is what ADR-008 exists to log.

**One subject at a time**, and the button waits for a subject chip. With no subject the screen
pools every subject into one ranking, which is a reasonable thing to look at and a useless thing to
generate practice from; it would also lose the combined Science + BGS narrowing (D-#664).

Web-only, like every other export — `downloadFile` drives an anchor, which does not exist in React
Native. Hidden on a phone rather than shown and failing.

## §7 — Journeys

**Declare.** Principal or the Class-5 English teacher opens বৃত্তি অনুশীলন → নতুন প্রশ্ন, picks
শ্রেণি ৫ · ইংরেজি, names the paper, attaches the .docx, and adds 14 item rows — each with its topic
(picker), chapters (multi-select, may be empty), type and marks. Σ must reach 100 or the declare
button refuses with the row that is wrong. → `DECLARED`.

**Score.** After marking the scripts she opens the paper → নম্বর এন্ট্রি: a 7-row grid, one column per
item, item marks in the header. She types 14 numbers per student, marks Khadiza অনুপস্থিত, and saves.
→ `SCORED`. Editable afterwards, freely, with no lifecycle (the `ClassTestResult` D-#121 posture).

**Read.** She opens বিশ্লেষণ → আফরা: `ব্যাকরণ — article 31% · দুর্বল · ক্লাস গড় ৫২% · −২১`, and
`WH-question — যথেষ্ট তথ্য নেই (৫/১০০ নম্বর)`.

**Release (SC-5).** She submits a student's analysis; the Principal approves or sends it back; on
approval the guardian sees their own child's topic table — absolute band only, never the class
comparison, never another child's number.

## §8 — Out of scope

- Authoring or generating questions — that is `scholarship/` at the repo root, outside the app.
- Assembling a paper from the question bank. These papers are authored externally; a later slice could
  pre-fill items from an `AssessmentSet`, and the item shape is compatible, but it is not built.
- Any path from a practice mark to a report card, the CT component, or an `Exam` row. A practice paper
  is **not** an assessment of record (D-#656). If that is ever wanted it is a deliberate later slice,
  not a side effect.
- Per-question detail below the declared item, and an "attempted / not attempted" distinction —
  considered and dropped for entry speed; revisit only if the analysis proves ambiguous.
- Student-facing login. Guardians only, at SC-5.

## §9 — Open (owner to settle before SC-1)

1. **Other classes.** Built general (any class, any subject) but seeded and tested for Class 5 English
   only. Confirm nothing else is expected on day one.
2. **Short practice papers.** `totalMarks` is free, so a 20-mark grammar drill is a legal paper. Confirm
   those should feed the same analysis as full papers — the reliability floor assumes they do.
3. **Whether guardians see it at all before the exam.** SC-5 is contracted but sequenced last; the
   analysis is candid in a way a mark sheet is not.
4. **One printed figure in the circular does not add up.** In BOTH the Science and the BGS tables,
   item 3 (মিলকরণ, ৪টি) reads `১×৪=০৮`, which is internally contradictory. The half only totals the
   signed ৫০ if it is `১×৪=০৪` (৫+৫+৪+১২+২৪), so that is the reading assumed. **This blocks
   nothing** — marks are typed per paper and never seeded — but confirm it against the paper copy
   before the first Science/BGS paper is declared.

## §10 — Traceability

| D-# | Decision |
|---|---|
| D-#656 | Standalone `scholarship` module; a practice paper is never an assessment of record |
| D-#657 | A new skill catalogue, not `HomeworkTopic` — the topic axis is skill-shaped, not chapter-shaped |
| D-#658 | Item types reuse `SYLLABUS_ITEM_TYPES` verbatim; no import-contract sync |
| D-#659 | Exactly one topic per item; zero or more chapters |
| D-#660 | Participation is per paper (ABSENT), never a student flag |
| D-#661 | A multi-chapter item counts in full toward each chapter; the chapter axis does not sum |
| D-#662 | Reliability floor — no weakness call under 15 available marks |
| D-#663 | Two bands: absolute against the scholarship bar, relative against the class mean |
| D-#664 | A paper carries `subjects[]` and every item carries its own subject — Science + BGS is one 50+50 paper |
| D-#665 | The topic axis is skill-shaped for ENG/BAN and content-shaped for SCI/BGS; `axis` records which |
