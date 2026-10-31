# PRD — Quran oral exam (sittings, examiners, marks, guardian schedule)

Owner ask, 2026-10-27/28. Decisions D-#873–#879. The Quran part of the 2026 annual exam
runs **Sun 15 – Wed 25 Nov 2026**, before the general + Arabic exam (1–10 Dec, the existing
`Exam` "Annual 2026"). Approved plan and mockup:
- Word schedule (owner-approved): `Quran-Final-Exam-2026-Schedule.docx` (owner's machine).
- Mockup (14 screens): https://claude.ai/artifact/JR1jwA56cg4ypCbRoJ192W

This is **not** the paper exam pipeline of `prd-exams.md` (EX-1…EX-10: custody, checkers,
report cards). The Quran exam is oral: one examiner listens to one student at a time. It
hangs off the same `Exam` row and its results can feed the report card later (EX-5), but it
is its own small module, `quran_exam`.

## 1. Goal
Office plans who examines whom and when; each examiner sees their own students on the Today
screen and enters marks question by question from the printed paper; Office watches progress,
chases missing marks and fixes absences and examiner changes; guardians see their own child's
exam day and time, and are told by pop-up when it is published or changes.

## 2. The 2026 plan (data the module must carry)
| Days | Level (SubjectGroup.level) | Students | Per student | Examiners |
|---|---|---|---|---|
| 1–3 (Sun 15 – Tue 17 Nov) | Hifz 3 | 5 | 3 sittings: 2 para (7:00–9:00), 1 para (7:00–8:00), 2 para (7:00–9:00) | 5, rotating daily |
| 4–6 (Wed 18, Thu 19, Sun 22) | Hifz 1 (boys + girls) | 12, 4 a day | 1 sitting, paras 29–30, 7:00–9:00 | 4 |
| 7–8 (Mon 23, Tue 24) | Najera (boys + girls), Ammapara, Qaida | 41 | 1 sitting, 30 min (7:00–9:00 slots) | 6 |
| Wed 25 | make-up | — | — | as Office assigns |

Examiners, rotations and every student's slot are in the Word schedule; QX-1 loads them.

## 3. Question papers and marking (D-#874)
One **paper per level** (shared by the boys' and girls' groups of that level). Office keeps
the paper's sections, questions and marks; the teacher's mark screen is built from it. Two
scoring schemes:

**ITEMS** — sections → questions, each with marks. The teacher taps marks per question; the
total is the sum. Owner papers 2026 (tajweed removed from Ammapara and Nazera — owner,
2026-10-28; the totals stay 90, nothing is redistributed):
| Level | Full | Sections (questions × marks) |
|---|---|---|
| Ammapara | 100 | হিফজ 20 (4 surahs × 5) · রিডিং 60 (4 × 15) · দোয়া 20 (5 × 4) — revised 2026-10-30 (D-#881) |
| Najera | 100 | নাযারা 70 (7 × 10) · হিফজ 30 (সুরা দ্বোহা–নাস, **marked by তানবীহ/ফাত্হ**) — revised 2026-10-30 (D-#881) |
| Qaida | 100 | হিফজ 20 (4 × 5) · বানান 30 (2 × 15) · রিডিং 30 (2 × 15) · দোয়া 20 (4 × 5) |
Questions within a section are equal shares unless Office sets otherwise.

**A section of an ITEMS paper can be marked the Hifz way (D-#881)** — e.g. Nazera's সুরা দ্বোহা–নাস. Such a section holds one question; the examiner counts তানবীহ and ফাত্হ and the app sets its mark to `max(0, marks − floor(T / tanbihPerMark) − fathCost × F)` (Nazera: 30, 4, 2). The counts are kept on the sitting; the rest of the paper is marked per question as usual.

**HIFZ_DEDUCTION** — Hifz 1 and Hifz 3, full marks **30**, no tajweed (owner, 2026-10-28).
The examiner records, per para, the number of **তানবীহ** and **ফাত্হ**. Mark =
`max(0, 30 − floor(T / 4) − 2 × F)` where T and F are the totals **over all paras of all the
student's sittings** (owner confirmed: 3 + 2 তানবীহ in two paras = 5 → −1). The app computes
it; nobody types it. Hifz 3 paras 1–5 over three sittings; Hifz 1 paras 29–30.

A paper cannot be changed once any mark has been entered against it (the stored marks are
positions in that paper).

## 4. Sittings and examiners (D-#875)
A **sitting** = one student × one date × one time window × one examiner (+ the paras for
Hifz). A Hifz 3 student has three sittings, everyone else one.

Office (`quran_exam:manage`), per exam day (mockup screen 12):
- **Move a student** to another examiner. The student keeps the same time if the new
  examiner is free then; otherwise they take that examiner's next free slot after their
  last sitting that day. **Nobody else's time changes.** A time past the day's planned end
  is allowed with a warning.
- **Add an examiner** — any teacher, including one who has a class at that time (warned:
  "the class needs a cover"). The owner explicitly allows Tabshir to be added (2026-10-28).
  A new examiner starts empty; Office moves students to them.
- **Remove an examiner** — their students are shared out to the remaining examiners,
  fewest-first, by the same keep-time-or-next-slot rule. The last examiner of a day cannot
  be removed.
- An examiner never has two sittings at once; a student never has two sittings at once.

## 5. Mark entry and absence (D-#876)
- The **examiner of a sitting** sees it on Today and in "আমার পরীক্ষার দায়িত্ব", and enters
  its marks (`quran_exam:examine`, SELF: only sittings where they are the examiner). This
  includes a teacher Office added on the day.
- Per sitting: **উপস্থিত** (present → marks) or **অনুপস্থিত** (absent → optional reason:
  জানা নেই / অসুস্থ / অভিভাবক আগে জানিয়েছেন / অন্যান্য). Absence can be marked before the
  day. **No guardian pop-up on absence** (owner, 2026-10-28).
- An absent sitting goes onto the **make-up list**. Office gives it a new date, time and
  examiner (default Wed 25 Nov); it becomes a normal sitting again and keeps its absence in
  history. That is a time change, so the guardian gets the §6 pop-up.
- Office (`quran_exam:edit_all`) can enter or correct marks on any sitting.
- **Lock** (`quran_exam:lock`): once every sitting has marks or is absent-without-make-up,
  Office locks the marks; after that nobody edits (Office can unlock, audited).

## 6. Guardians (D-#877)
- **Schedule** (guardian, through `guardian:read_child`): each child's sittings — date,
  weekday, time, portion (e.g. "২ পারা"). **Never the examiner's name** (owner, 2026-10-28),
  never marks.
- **Pop-ups**, blocking-until-acknowledged like the meeting outcome pop-up (D-#844), never a
  notification:
  1. when Office **publishes** the schedule: "কুরআন পরীক্ষার সময়সূচি" with the child's
     sittings (mockup screen 2);
  2. when a published sitting's **date or time changes** (move, examiner removed, make-up):
     "পরীক্ষার সময় বদলেছে" with the old time struck through and the new time (screen 14).
  One button, "ঠিক আছে, দেখেছি"; seen on one device = seen on all (server state). Siblings
  on one login get one pop-up each.
- **Today card** for the guardian from publish until the child's last sitting day ends.
- Nothing is shown to guardians before publish.

## 7. Office monitor (D-#878)
`quran_exam:view` (Office, Principal):
- per exam day: sat / absent / marks pending;
- **pending marks by examiner** (sittings whose time has passed with no marks and not
  absent), with **রিমাইন্ডার** per examiner and for all. A reminder is a staff pop-up the
  next time that teacher opens the app ("X জনের নম্বর বাকি"), not a notification;
- the make-up list; lock state; overall "N of M marked".

## 8. Permissions (`quran_exam`, D-#873)
| Action | Who (default) | What |
|---|---|---|
| `quran_exam:view` | Office | whole schedule, monitor |
| `quran_exam:manage` | Office | papers, sittings, move / add / remove examiner, make-up |
| `quran_exam:publish` | Office | publish the schedule (guardian pop-ups start) |
| `quran_exam:examine` | Teacher (SELF) | own sittings: see, present/absent, marks |
| `quran_exam:edit_all` | Office | enter / correct marks on any sitting |
| `quran_exam:lock` | Office | lock / unlock marks |
| `quran_exam:remind` | Office | send pending-marks reminders |
The Principal holds all. Guardians read through `guardian:read_child` (listed GUARDIAN path).

## 9. Data (identity plane, ADR-005)
- `QuranExamPlan` — one per `Exam`: `examId` (unique), `status` DRAFT | PUBLISHED,
  `publishedAt/By`, `marksLockedAt/By`, `makeUpDateKey`.
- `QuranExamPaper` — `examId`, `level` (SubjectGroup.level string), `scheme`
  ITEMS | HIFZ_DEDUCTION, `fullMarks`, `sections[{ title, items[{ label, marks }] }]`,
  `hifz { paras[], tanbihPerMark: 4, fathCost: 2 }`, `durationMin`.
- `QuranExamSitting` — `examId`, `studentId`, `groupId` + `level` (snapshot), `dateKey`,
  `start`/`end` ("HH:mm", Asia/Dhaka), `examinerId`, `paras[]` (Hifz), `portionLabel`,
  `status` SCHEDULED | DONE | ABSENT, `itemMarks[[…]]` or `hifzCounts[{ para, tanbih, fath }]`,
  `comment`, `absence { reason, at, by }`, `history[]` (moves / absences / make-up),
  `enteredBy/At`, `guardianVersion` (bumped when a published sitting's date/time changes).
- `QuranExamGuardianSeen` — `examId`, `studentId`, `seenVersion`, `seenAt`, `guardianId`.
- Literal unions are model-local (like `ParentMeeting.status`), not `shared/vocab.ts`.
- The student's total is **computed on read** (D-#85), never stored.

## 10. Slices
- **QX-1** — models, papers, sittings, permissions; Office day screen (move / add / remove
  examiner); load script for the 2026 plan (dry run, then apply on prod with the owner).
- **QX-2** — teacher: Today card, my duties, mark entry (ITEMS + HIFZ_DEDUCTION), absent.
- **QX-3** — guardians: publish, schedule screen + Today card, the two pop-ups.
- **QX-4** — Office monitor: pending marks by examiner + reminders, make-up, lock; paper
  editor screen.
Target: QX-1…QX-3 live and the schedule published by Thu 12 Nov; QX-4 live by Sun 15 Nov.

## 11. Journeys
- **J-QX1** Given the loaded plan, Office opens Mon 23 Nov and sees six examiners with
  23 students in 30-minute slots.
- **J-QX2** Office moves Ahsan Saeed from Kuddus (8:30–9:00) to Tabshir, added that day with
  no students → Ahsan gets 7:00–7:30; Kuddus's other students keep their times; Ahsan's
  guardian gets the time-change pop-up after publish.
- **J-QX3** Office removes Mahfuj on Day 7 → his 4 students go to the examiners with the
  fewest students; every moved student's guardian gets one pop-up.
- **J-QX4** Tabshir, added by Office, sees Ahsan on his Today card and enters marks; Kuddus
  no longer sees Ahsan.
- **J-QX5** Momin on Day 3 records paras 4–5 for Ibrahim; the screen shows paras 1–3 from
  Kuddus and Mahfuj read-only and the computed mark out of 30.
- **J-QX6** A teacher marks a student absent; the guardian gets nothing; Office sees the
  student on the make-up list, assigns Wed 25 Nov 7:00 → the guardian gets the time-change
  pop-up.
- **J-QX7** After publish, a guardian opens the app and sees one pop-up per child with their
  dates and times; after "ঠিক আছে, দেখেছি" it never returns on any device.
- **J-QX8** At 9:00 on Day 7 Office sees Mahfuj with 4 marks pending, taps রিমাইন্ডার; Mahfuj
  gets a pop-up on his next app open.
- **J-QX9** After lock, a teacher's mark save is refused ("নম্বর লক করা হয়েছে").

## 12. Out of scope (by design)
- **Routine changes for the exam days** — merged Quran classes, Arabic (P3) stopped, P3
  general covers, Tabshir's class work: Office makes them with the existing routine cover
  tools (and the covering teacher marks the group's attendance as today). The Word schedule
  lists them.
- Showing marks or results to guardians (report card is EX-9).
- Push / inbox notifications to guardians (owner ruling D-#844 applies here too).
- Printing the paper itself; question authoring.
