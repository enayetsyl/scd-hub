# PRD — Nursery & KG oral exam (viva): papers, examiners, live marks

Owner ask, 2026-11-06. Decisions D-#1070–#1074. Mockup (9 screens, owner-reviewed):
https://claude.ai/artifact/5GQFzrs2kHymJVFB2NkAmr

Like the Quran exam (`docs/prd-quran-exam.md`), the oral part of a subject is heard one
child at a time and marked in the app. Unlike it there are **no time slots, no guardian
schedule and no make-up**: the oral runs in the class's usual period on the day the exam
routine gives it, and a child who is not there is absent.

## 1. What is examined orally (owner, 2026-11-06)
Every **ORAL slot of the exam routine** (`ExamRoutine.slots[kind=ORAL]`, D-#883) is one
viva paper: one class × one subject × one date. Annual 2026 after the owner's corrections:

| Class | Date | Subject | Oral marks (Sylhet মানবণ্টন in the app) |
|---|---|---|---|
| Nursery | 26 Nov | বাংলা | 10 (of 100) |
| Nursery | 29 Nov | ইংরেজি | 15 (of 100) |
| Nursery | 1 Dec | আরবি | 10 (of 50) |
| Nursery | 2 Dec | কুরআন | 50 (all oral) |
| KG | 1 Dec | কুরআন | 100 (all oral) |

KG Bangla/English/Maths/Arabic and Nursery Maths have **no oral** (owner, 2026-11-06;
routine corrected and guardians told by pop-up the same day).

The paper's full marks are the sum of the syllabus mark rows that are oral (`itemType
"oral"`, or a row labelled মৌখিক / Oral when the type was left blank). A subject with no
written row is all oral.

## 2. The paper (D-#1071)
A flat list of questions, each with marks (halves allowed, D-#1072). The questions'
marks must add up to the paper's full marks.
- **Seeded** from the syllabus oral rows the first time Office opens the paper: a row of
  `count × marksEach` becomes `count` questions (`<row label> ১`, `… ২`); a single row
  becomes one question. Office then rewrites the labels into the real questions.
- **Office edits** it (`viva:manage`) until the first mark is entered against it, like the
  Quran exam (D-#874). Each question carries a stable key, so marks never shift if the
  order changes.
- Pictures are shown **from the book**, never in the app (owner, 2026-11-06). A question
  may carry a short reference such as "পৃ. ৩৪".
- **Deferred (owner, 2026-11-06):** a question not asked to a particular child, and
  changing questions for one child. Every child is marked on the whole paper for now.

## 3. Examiners (D-#1073)
- Default: the teacher who teaches that subject to that class in the live routine (most
  periods); if none, the section's class teacher.
- Office (`viva:manage`) sets one or more examiners per paper and which children each
  hears (by roll, or child by child). A child has exactly one examiner.
- Only the examiner enters that child's marks (`viva:examine`, SELF); Office with
  `viva:edit_all` may enter or correct any.

## 4. Marking (live)
The examiner's sheet lists **every child with every question under their name**; one tap
on a mark saves it at once (no save button). Halves are allowed (`০ ½ ১ … max`).
- **অনুপস্থিত** per child: no marks can be entered while absent; the oral counts **0**
  in the subject total (owner, 2026-11-06). No make-up day, no guardian pop-up.
- A child is DONE when every question has a mark.
- Office sees progress live (polled): done / absent / not yet, per paper and per examiner.

## 5. Results and lock
Per paper: each child's oral total (absent = 0, shown "অনু."). `viva:lock` locks a paper;
nobody edits a locked paper (Office can unlock; both audited). Joining the oral total with
the written marks waits for written-mark entry (prd-exams.md EX-2/EX-3).

## 6. Permissions (`viva`, D-#1074)
| Action | Default | What |
|---|---|---|
| `viva:view` | Office | every paper, examiner and mark; live progress |
| `viva:manage` | Office | papers (questions + marks) and examiners |
| `viva:examine` | Teacher (SELF) | own children only: marks and absent |
| `viva:edit_all` | Office | enter or correct any child's marks |
| `viva:lock` | Office | lock / unlock a paper's marks |
The Principal holds all.

## 7. Data (identity plane, ADR-005)
- `VivaPaper` — `examId`, `classId`, `subject`, `dateKey` (from the routine), `fullMarks`,
  `items[{ key, label, marks, ref }]`, `examiners[{ userId, studentIds[] }]`,
  `lockedAt/By`, `updatedBy`. Unique (examId, classId, subject).
- `VivaMark` — one row per child per paper: `paperId`, `studentId`, `absent`,
  `marks[{ key, value }]`, `enteredBy/At`. Unique (paperId, studentId). The total is
  computed on read (D-#85).

## 8. Slices
- **VV-1** — models, papers from the routine + syllabus, examiners, live marks, lock,
  permissions, tests.
- **VV-2** — app: teacher Today card + mark sheet; Office home (papers by date with live
  progress), paper editor, examiners, results.
- **VV-3** — help guides with screenshots; load the real question texts for the 2026
  papers on prod (owner go-ahead).
Target: live before Thu 26 Nov (first oral).
