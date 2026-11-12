# PRD — Class-test weakness note names learning objectives (`CT-WLO`)

| | |
|---|---|
| **Status** | v1.0 — BUILT on branch `claude/dazzling-curie-pxsvx2` (2026-11-11, overnight cloud session; not merged) |
| **Owner** | Principal |
| **Decisions** | D-#1360 (the feature), D-#1361 (write rules), D-#1362 (publish / snapshot), D-#1363 (reads, guardian grain), D-#1364 (queries and gates). Builds on D-#925 (guardians see objectives only), D-#923 (level words), D-#761 (paging), D-#799 (permission catalogue), D-#943 (tagged rows) |
| **Plane** | Operational / identity (ADR-005): a student's class-test result. No corpus path |

## 1. What the owner wants

A teacher writes a free-text weakness on each child's class-test result (`ClassTestResult.weakness`,
beside `teacherAction` and `guardianAction`). The owner ruled: the teacher **also** picks the learning
objectives the child is weak in, **and the free text stays**.

## 2. Build

### 2.1 Data

`ClassTestResult.weakLoCodes: string[]` — optional, at most **5**. Each code must be a row of
`MasteryOutcome` with:

- the test's class × subject (`classToken` from the test's `classLevel`; `subject` = the test's subject),
- `status: "LOCKED"`,
- tagged (`tagged !== false`: a flat M-0 row with no `tagged` field reads as a tagged objective,
  the same rule as `treeShapeOf` / `untaggedRefusal`).

Anything else is refused with a Bangla sentence (level word from `masteryLevelLabels()`):
another class or subject, an unknown code, a grouping (untagged) row, a draft or retired row, a
sixth code. A group-anchored (subject-group) test takes no picks at all. Duplicates collapse.

Stored only on a PRESENT result. ABSENT clears it (and refuses picks), like the three comments.

### 2.2 Write — `enterClassTestResult`

One more optional argument `weakLoCodes: [String!]`.

| Sent | Effect |
|---|---|
| omitted / `null` | keeps what is stored (an older phone build never sends it) |
| `[]` | clears |
| a list | validated (§2.1), then stored |

All existing locks apply first: a submitted or published result cannot be edited at all, so its
codes cannot change. The AI comment check on the three text fields is unchanged (codes are not
checked text).

### 2.3 Publish / snapshot / version

The codes are part of the result **the way the weakness text is**: `publishedSnapshot` and the
marks-correction diff (D-#945) hold marks + status only, so neither the text nor the codes enter
them; `publishedVersion` bumps on every publish regardless. The guardian message (WhatsApp / in-app
body) and its kind (regular / excellent / absent) read the text **and, from D-#1430 (PR-L), the picks**: a
PRESENT result with at least one pick is the feedback (regular) message even when the weakness text is
empty, and the `{Weakness}` line gains "দুর্বল <objective word>: name، name" at objective grain
(`guardianObjectiveLabels`: sub shown as its parent, duplicates collapse, no code ever). No picks +
no text stays the excellent message; ABSENT stays the absent message and ignores picks. No new
template variable and no registry change, so nothing for an admin to do on prod (a customised
`class_test.result.regular.body` keeps working; its `{Weakness}` just carries the extra line). The
guardian card line (§2.5) is not behind the mastery switch (pinned by test). `ClassTestCorrectionService` and the snapshot are unchanged; only the message builder in `ClassTestPublishService` reads the picks.

### 2.4 Picker — class-test marks screen

`app/src/components/CtWeakObjectivePicker.tsx`, under the weakness field: title
"কোন শিখনফলে দুর্বল" (the level word from `useMasteryLevelLabels`), grouped by chapter (skill
strands in their own group), searchable by code or label, each row shows label + code (a
sub-objective is indented and named with the sub level word), multi-select up to the server's max.
It shows only where `classTestWeakObjectiveOptions.available` is true — a LOCKED catalogue for that
class × subject, not a group test. Elsewhere the screen is exactly as before and the mutation is
sent without the field.

### 2.5 Reads

- **Staff** — `ClassTestResult.weakLoCodes` and `ClassTestResult.weakObjectives { code labelBn }`.
  The teacher's results view (`ClassTestResultsViewScreen`) and the Office/Principal read-out on the
  marks screen show "দুর্বল <objective word>: label; label" under the weakness text.
- **Guardian** — `GuardianClassTestResult.weakObjectives: [String!]!` (labels) and
  `weakObjectivesWordBn` (the level word, null when none). **Objective grain only** (D-#925): a
  sub-objective is shown as its parent objective's label; duplicates collapse; no code and no
  sub-objective label is ever in the payload. The one helper is `objectiveGrain`
  (`MasteryGuardianService`), called through `guardianObjectiveLabels`.
- **For later reports** — `classTestWeakObjectivesPage(studentId, subject, page, pageSize)` →
  `{ rows { code labelBn testId ctId testNumber examDate published } total page pageSize }`, one row
  per picked code, newest exam first.

### 2.6 Gates (no new permission)

| Resolver | Gate |
|---|---|
| `classTestWeakObjectiveOptions(testId)` | `class_test:enter_results` + read scope on the test's unit (`assertAnchorRead`, `class_test:view_all` lifts it) |
| `classTestWeakObjectivesPage(...)` | `class_test:view` / `class_test:view_all`; without `view_all`, the student's section must be readable (`assertReportRead`, the `classTestStudentProfile` gate) |
| `enterClassTestResult(weakLoCodes)` | unchanged (`class_test:enter_results` + anchor write) |
| guardian fields | unchanged (`guardian:read_child` + guardian link) |

### 2.7 Not in this slice

This slice writes **no mastery evidence** and changes **no mastery state**: the picks are a
class-test record only. No diagnosis, roll-up, assignment or notification reads them yet. Hooking
them into mastery evidence is a separate owner decision.

## 3. Acceptance (tests: `server/src/__tests__/classTestWeakObjectives.test.ts`)

1. With no LOCKED catalogue for the class × subject, every class-test screen, mutation and test
   behaves as today (no picker; a save without the field stores no codes).
2. A code from another class or subject, an untagged (grouping) code, a draft code, or a sixth code
   is refused.
3. Saving a result without the field keeps the stored codes; saving an empty list clears them;
   setting ABSENT clears them.
4. A submitted or published result refuses a change to the codes.
5. The guardian payload contains objective labels only — no code and no sub-objective label.
6. `classTestWeakObjectivesPage` returns only that student's picks and respects the caller's scope.
7. (PR-L, D-#1430) Picks + empty text → the feedback message naming objectives (no code, sub shown as its parent); no picks + empty text → excellent; ABSENT → absent; the guardian card line shows with the mastery switch absent, off or on.
