# PRD — Class-test unusual-mark recheck + script hand-in reminder (CT-RC)

Status: built 2026-11-10 (branch `feat/ct-mark-recheck`), D-#1265–#1268.
Planning doc (owner-facing): https://claude.ai/artifact/Q4CtooHDykMkMyHVLFuwmS ·
mockup: https://claude.ai/artifact/P1twdkGqRQjpjVEAGXiHHK

## 1. Why

A teacher gave a student full marks without checking the script properly; the guardian
later found many mistakes. Nothing compared a mark with the student's own history, and
the scripts reached the Office only after the result was public.

## 2. The rules (D-#1265)

Everything is in **percentage points of the test's total**; on the usual 20-mark test
1 mark = 5%. The student's average is **cumulative for the subject this academic year**
(every published, present result; this test left out).

| Rule | Flag when | On 20 marks |
| --- | --- | --- |
| R1 far above | ≥ 20% above the average | ≥ 4 marks |
| R2 far below | ≥ 20% below the average | ≥ 4 marks |
| R3 full marks | 100% while the average is under 85% | 20/20 under a 17/20 average |
| R4 whole class | class average ≥ 15% above the unit's usual average in the subject | ≥ 3 marks |

- Fewer than 3 earlier tests in the subject → the all-subject average; none at all → only R3.
- R4 needs ≥ 3 present students and ≥ 3 earlier tests of the same section/group.
- Flags are derived on every read, never stored (D-#85).
- The numbers live in one singleton (`ClassTestRecheckSettings`, read-time defaults,
  never seeded). Class test → "অস্বাভাবিক নম্বরের নিয়ম", `class_test:publish`, audited
  (`CLASS_TEST_RECHECK_RULES_CHANGED`). A switch turns the whole check off.

## 3. Teacher (D-#1266)

- Publish screen → "অস্বাভাবিক নম্বর": each flagged mark with its average, the tick
  "আমি খাতা দ্বিতীয়বার দেখেছি, নম্বর ঠিক আছে" and an optional note; R4 has one class tick.
- `submitExam` refuses while any flagged, unpublished mark lacks a valid tick (server,
  so an old app cannot skip it). A tick stores the mark; a changed mark voids it.
  The class tick stores a fingerprint of every row's marks. Under R4 it also covers every
  mark that is only high / full (one tick, not one per child); a low mark still needs its own.
- The marks screen shows a warning while ticks are owed.

## 4. Approver (D-#1267)

- Same panel in approver mode: the teacher's stamp + note ("শিক্ষক নিশ্চিত করেননি" for a
  submission made before this shipped).
- Approve needs `flagsReviewed: true` when the submission carries flags; a missing tick
  is a Bangla refusal, not a schema error. Audited `CLASS_TEST_RECHECK_REVIEWED`.
- **Option B:** "খাতা দেখব · এই ফল আটকে রাখুন" holds one submitted row; `publishExam`
  skips held rows. The held row shows on the approver's Today ("আটকে রাখা ফল"): release
  (`publishResult`, clears the hold) or correct (new mark → publish → a quiet tier-2
  `CT_RECHECK_WRONG` note to the teacher who ticked; no warning pop-up, D-#1150).
- A mark changed AFTER publication keeps the existing D-#945 `CLASS_TEST_MARKS` note;
  no second note.

## 5. Script hand-in reminder (D-#1268)

- At result **submit** (not at question submission), a pop-up the teacher must
  acknowledge: approval → scripts to the Office (not the students) → Office scans and
  returns → then the students. Sent as `scriptReminderAck`, audited.
- The teacher's "published" notice gains "এখন খাতা অফিসে জমা দিন — শিক্ষার্থীদের নয়।"
- The tracking after that is unchanged (D-#715–#719).

## 6. Not done / follow-ups

- Help guides `exam-ct-recheck-confirm`, `-approve`, `-rules` are published with pictures
  (capture: `scripts/help/fixtures/ct-recheck.ts` + `specs/ct-recheck.cjs`).
- The older `exam-ct-submit` pictures predate the pop-up (text updated; re-shoot with the
  `exam-ct` spec when convenient).
