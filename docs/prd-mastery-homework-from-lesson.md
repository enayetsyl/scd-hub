# PRD — Homework from the lesson taught, and extra homework for weak children (PR-D of the objective chain)

**Status:** BUILT 2026-11-11 (overnight session, branch `claude/charming-cori-ksozdn`, slice label PR-D).
**Decisions:** D-#1321–#1326. Behind the mastery switch; no new permission (`mastery:create` / `mastery:view`).

**Owner rulings (brief):** every day one class-wide homework; a child weak in a topic also gets an additional
tailored homework; the app picks, the teacher reviews. The homework tracker (`HomeworkItem`, its records,
the daily-minutes tally) is not changed.

## Policy (flat keys, like every other policy value — D-#1321)
| Key | Default | Meaning |
|---|---|---|
| `homeworkDraftQuestionsPerObjective` | 1 | bank questions per taught code in the draft |
| `homeworkDraftMaxItems` | 6 | most items in the draft; the rest are `leftOut` |
| `extraHomeworkMaxQuestions` | 3 | most questions per child on the extra homework |
| `extraHomeworkIncludeImproving` | false | IMPROVING rows count as well as WEAK |

The brief wrote `homeworkDraft { … }` / `extraHomework { … }` as nested objects; the live policy model is a
flat key map validated per key and rendered field by field on the policy screen, so the keys are flat.

## 5.1 Draft of the class homework — `masteryHomeworkDraft(sectionId, subject, dateKey)` (no write)
- Codes = the sessions marked taught that day (`LessonDelivery` for that section × subject × date), each through
  `deliveredCodes` (the marking snapshot, else the current plan), in plan order. A grouping code expands to its
  tagged children; only LOCKED tagged rows of this class × subject are kept. RUBRIC codes → `rubricCodes`.
- Per QUESTION code: `homeworkDraftQuestionsPerObjective` gold bank questions that NO student of the section has
  seen (`pickQuestion`, least-used first), type from `typeFor`. No bank question → a TEACHER item naming the
  book exercises (`bookRef.exercises`), `fromBook: true`. No exercises either (or no usable question type) → `gaps`.
- Stop at `homeworkDraftMaxItems`; the rest → `leftOut`. `reason` = NO_LESSON_MARKED / NO_CODES_ON_PLAN.
- `hwItemId` = that day's tracker homework of the section × subject, pre-selected as the link.
- App: "আজকের পাঠ থেকে খসড়া" on the new-sheet screen (HW) fills the item list; the teacher edits and saves
  through `createMasteryPaper`. Both class-note screens show "এই পাঠের বাড়ির কাজ তৈরি করুন" on a published note
  with a lesson marked, only where mastery is on (`masterySectionSwitch`, `mastery:view`, no student data).

## 5.2 Extra homework for weak children
- `masteryExtraHomeworkPreview(sectionId, subject)`: every roster child with a WEAK tagged QUESTION row (plus
  IMPROVING by policy) gets up to `extraHomeworkMaxQuestions` gold questions: one per weak row first (oldest
  evidence first), then round again; never a question that child has seen; a one-line reason per item. Children
  with nothing to give carry `NOT_WEAK` or `NO_UNSEEN_QUESTION`. One section's roster (not a growing list).
- `createMasteryExtraHomework({ sectionId, subject, date, sheets })`: re-checks every item (gold, tagged with that
  code, unseen by that child, the row still WEAK or IMPROVING, within the cap, child on the roster) and creates ONE
  OPEN `MasteryPaper` — source HW, `extra: true`, title "বাড়তি বাড়ির কাজ", `perStudentItems` — one per section ×
  subject × date (unique partial index). No `HomeworkItem`, not in the daily minutes.
- `studentItemsOf` treats an `extra` sheet like an assignment sheet: a child answers only their own items; an item
  not given is never counted as wrong. Entry, confirmation and evidence reuse the existing paths. Deleting an OPEN
  extra sheet with no results also removes its record rows.
- Record (D-#1324): `EXTRA_HOMEWORK` appended to `MASTERY_ACTION_KINDS`; one CLOSED action row per child
  (`plan.studentIds` = the child, `plan.note` = "<paperId>: codes") so the child's record ("school did") shows it.
  The weekly assignment does NOT write `TAILORED_ASSIGNMENT` rows in the live code (the record counts sent
  assignment sheets instead), so the brief's "follow how the weekly assignment writes it" had nothing to follow;
  these rows are kept off the leader dashboard (`actionsPage` excludes the kind; `actionCounts` never counted
  CLOSED rows without `closedAt`).
- Guardian notification (D-#1325): `MASTERY_EXTRA_HOMEWORK` "বাড়তি বাড়ির কাজ দেওয়া হয়েছে" to each given child's
  guardians; dedupe key `MSXH:<paperId>:<studentId>:<guardianId>` (carries the recipient).
- Not built (D-#1326): the per-student PDF (the assignment renderer is bound to `MasteryAssignment`; reusing it
  means a refactor of that renderer, not done unattended).
- App: "দুর্বলদের বাড়তি বাড়ির কাজ" on the mastery work home → preview (child, items, reasons, tick boxes) → send;
  the sheet then appears in the normal sheet list with a "বাড়তি" badge; the guardian progress page names it.

## Acceptance (`server/src/__tests__/masteryHomework.test.ts`)
1. A lesson whose plan names a code with bank questions, one with only book exercises, one with neither →
   a BANK item, a `fromBook` item and one gap.
2. No lesson marked → NO_LESSON_MARKED (and a session with no codes → NO_CODES_ON_PLAN).
3. The draft never offers a question any student of the section has seen.
4. The preview gives a weak child at most `maxQuestions` items, none seen before; a child with no weak row is NOT_WEAK.
5. A tampered `createMasteryExtraHomework` (seen question, or a row that is not weak) is refused.
6. On the extra sheet a child's evidence covers only their own items; the tracker homework is untouched.

Help: reading guide `mastery-homework-from-lesson`; `notes-lesson-mark` intro updated.
