# PRD — Nursery & KG oral exam (viva): papers, examiners, live marks

Owner ask, 2026-11-06. Decisions D-#1080–#1084. Mockup (9 screens, owner-reviewed):
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

## 2. The paper (D-#1081)
A flat list of questions, each with marks (halves allowed, D-#1082). The questions'
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
  *Superseded 2026-11-11 by question sets (§9): each child is marked on their own set.*

## 3. Examiners (D-#1083)
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

## 6. Permissions (`viva`, D-#1084)
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
- **VV-4** — server: question sets, the draw at the tap, letter questions (§9), tests.
- **VV-5** — app: set tabs + letter questions in the paper editor, tap-to-draw sheet with set
  badges and per-letter marking, per-set counts and averages on results; help guides.
- **VV-6** — load the 8 owner-approved sets (§9.4) into the Nursery বাংলা and ইংরেজি papers
  on prod (owner go-ahead).
Target: live before Thu 26 Nov (first oral).

## 9. Question sets (owner, 2026-11-11 — D-#1275–#1277)
The owner handed over the handwritten Nursery oral papers: 4 sets for বাংলা and 4 for ইংরেজি.
Plan + mockup (owner-reviewed, v4): https://claude.ai/artifact/SrGEEtYbbqonX1AUHZy5XH

### 9.1 Sets (D-#1275)
- A paper holds one question list (the VV-1 shape) or **two or more sets**. Each set has its
  own questions; **every set adds up to the same full marks** (save refused otherwise).
- Question keys are unique across the whole paper, so a stored mark always names one
  question. Set 1's questions are also kept in `items`, so an app from before sets still
  reads a sensible paper.
- The paper freezes at the first mark **or the first draw** (it cannot change once a child
  holds a set). Office edits it until then; "+ সেট" copies the open set.
- Arabic and Quran orals stay one-set papers and behave exactly as before.

### 9.2 Draw at the tap (D-#1276)
- On a paper with sets, the sheet shows a child's name only. When the child comes up, the
  examiner **taps the name**; the app then draws the child's set and shows its questions with a
  set badge. The teacher sees the set only at that moment.
- The draw is **random among the sets given to the fewest present children so far**, across
  every examiner of the paper, so the class splits evenly (22 → 6·6·5·5, 21 → 6·5·5·5).
  A child marked absent does not count; their drawn set stays recorded.
- **Final:** nobody changes a drawn set — not the examiner, not Office (owner: children wait
  in a separate room, so overhearing is not a reason to redraw).
- No marks can be entered for a child before their set is drawn.
- Concurrency: each draw writes the child's set, then bumps the paper's `drawSeq` from the
  value it counted at; the loser of a race undoes its write and counts again.
- Audited as `VIVA_SET_DRAWN` (child, set, the counts it saw).

### 9.3 Letter questions (D-#1277)
- A question may list **letters** with **marks per letter**; its marks are letters × per-letter.
  The examiner marks each letter on its own (stored as `<key>:<index>`); the question's mark
  is the sum, and it counts as marked once every letter is.
- Sheet: ½-mark letters are one chip each — tap = ✓ (½), again = ✗ (০), again = clear.
  Bigger letters get a ০ … max row beside the letter.

### 9.4 The 2026 Nursery sets (owner-approved)
বাংলা (10): Q1 = "নিচের বর্ণগুলো দিয়ে ১টি করে শব্দ বল", 4 letters × ½ = 2.
| সেট | Q1 বর্ণ | বাকি প্রশ্ন (২ করে, সেট ৪-এ ১২ মাস = ৪) |
|---|---|---|
| ১ | য, ধ, ড়, ঐ | ৪ দিকের নাম · ৪টি ফুলের নাম · ৪টি মাছের নাম · ৭ দিনের নাম |
| ২ | ট, ষ, ঈ, ব | ৬ ঋতুর নাম · ৪টি ফলের নাম · ৪টি পশুর নাম · ৪টি রংয়ের নাম |
| ৩ | ক, ম, প, শ | ৪টি সবজির নাম · ৭ দিনের নাম · ৪টি পাখির নাম · ৪ দিকের নাম |
| ৪ | ণ, ভ, ল, য | বাংলা ১২ মাসের নাম (৪) · ৪টি মাছের নাম · ৪টি পশুর নাম |
Set 3's ব্যঞ্জনবর্ণ (ক – ঁ) question was replaced by the letter question (owner).

English (15): Q1 = "2 words with each letter", 5 letters × 2 words × ½ = 1 per letter = 5.
| Set | Q1 letters | Other questions |
|---|---|---|
| 1 | E, O, W, Q, J | 7 days (3) · 4 flowers (2) · 6 animals (3) · 4 family members (2) |
| 2 | B, G, K, T, Z | 12 months (4) · 6 body parts (2) · 4 birds (2) · 4 colours (2) |
| 3 | Y, U, P, A, H | 6 fruits (3) · 7 days (3) · 4 animals (2) · 4 birds (2) |
| 4 | V, L, D, X, R | 12 months (4) · 4 family members (2) · 4 flowers (2) · 6 body parts (2) |
English Set 1's crossed-out questions (6 body parts, 4 birds) are left out.
