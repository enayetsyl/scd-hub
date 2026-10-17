# Parents' meeting comment chain + meeting brief (MC-1..MC-5)

Owner ask (2026-10-16): prepare real, shareable data for the parents' meeting. Every
teacher who takes a subject in a class comments on that class's students; the class
teacher summarises from all of them; the Office/Principal finalise. On the day, the
person meeting the guardian reads the Principal's word first and digs down only if
needed (class teacher → each subject teacher), next to the child's numbers since the
last meeting, each opening to its detail. Screen 7 (the brief) prints.

Mockup (approved with changes): https://claude.ai/artifact/6wkVrpNo797TboeRqgm6u5 — 8
screens. Owner changes folded in: **every layer is the same two boxes, Strengths and
Concerns** (a subject teacher's comment need not be about the subject); **the brief
prints**.

Builds on CM-3..CM-6 (`docs/prd-comments-meetings.md`) and D-#733 (names + breaks).

## 1. The chain (D-#752)

| Layer | Who writes | Stored in | Opens when | Locks when |
|---|---|---|---|---|
| 3 · Subject note | the teacher the routine names for (student × subject) | `MeetingSubjectNote` (new) | collection is open | the class teacher's summary exists |
| 2 · Class-teacher summary | the section's class teacher | `MeetingComment` (existing CM-5 row; `positiveText` = Strengths, `concernText` = Concerns) | every subject note of the child is written or skipped | the final comment exists |
| 1 · Final | Principal or Office (`roster:manage`) | `MeetingFinalComment` (new) | the class-teacher summary exists | never (last editor's name shown) |

- Final has three starts: **use as is** (copies the summary), **edit** (a copy, edited),
  **write my own**. `source` records which (`AS_IS` / `EDITED` / `OWN`). The class
  teacher's original is never overwritten, so the full chain is always readable.
- Every layer = **Strengths** + **Concerns**. At least one of the two must be non-empty.
- Office/Principal still cannot write the class-teacher layer (D-#124 stands).

## 2. Who comments on whom (D-#753)

- The Office/Principal **opens comment collection** on a meeting with two due dates
  (subject notes, class-teacher summaries). That builds the roster: one
  `MeetingSubjectNote` row per (student in the meeting's scope × subject) with the
  expected teacher, from the routine **in force today**:
  - section slots of the child's section give subject → teacher;
  - Quran/Arabic **subject-group** slots of the child's group override (the C1–5 Quran
    group is where those periods live);
  - several teachers on one subject → the one with the most periods.
- **Refresh teacher list** rebuilds it: written rows are kept as written, unwritten rows
  follow the new routine, rows no longer expected and not written are removed.
- **Skip** a subject for a section (teacher on leave / left / not taught) with a
  reason — skipped rows count as complete so the class teacher is not held up. Undo
  restores them.

## 3. The brief (D-#754)

One read, `meetingBrief(meetingId, studentId)`, for the class teacher's summary screen,
the final-comment screen, the meeting-day brief and the PDF:

- header (name, class/section, class teacher, the family slot time);
- the chain (final, class-teacher summary, subject notes with teacher names);
- **numbers since the last meeting** — window = the day after the previous meeting
  (latest meeting dated before this one, school-wide, as `meetingComparison` already
  does) → the meeting day or today, whichever is earlier; first meeting = academic
  year start. Reuses the student-profile services, unnarrowed (the brief gate is admin
  or class teacher):
  - attendance: marked / present / absent with leave / absent without leave + the dates;
  - class tests: held / sat / missed / average + per subject;
  - homework and assignments: received / submitted / not submitted + per subject + the
    not-submitted items;
  - **teacher notes**: concern / good counts + the list. The app has no
    guardian-filed complaint; "complaints" are the teachers' CONCERN comments (D-#400).

Gate: `roster:manage`, or the class teacher of the child's section.

## 4. Print (D-#755)

`GET /pdf/meeting-brief/:meetingId?students=<id,id>&subjects=1&details=0` — A4, one
child or the whole family slot; always the final + class-teacher layers and the
numbers; optionally the subject-note table and the details. Same gate as the brief,
re-asserted per child. Footer stamps who printed it and when (the student-profile
sheet rule). Streamed, never stored.

## 5. Today + reminders (D-#756)

- Subject teacher Today: **Parents' meeting comments** card — per class × subject, due
  students first, done ones folded, each opening the write screen with the child's
  subject numbers and last meeting's note.
- Class teacher Today: **Meeting summaries** card — ready / waiting (names the missing
  subject and teacher) / done.
- Both are self-contained and mounted outside Today's QueryGate.
- Notifications (new kinds): `MEETING_NOTE_REMINDER` (subject teacher: the Office's
  "Send reminder", and a 08:00 morning row from 3 days before the subject due date
  while notes are left) and `MEETING_SUMMARY_REMINDER` (class teacher: 08:00 from 3
  days before the summary due date while summaries are ready to write). One row per
  person per day.

## 6. Open questions answered by default (tell the owner)

1. Guardian visibility: **none in the app** (D-#124); the printed brief is what can be
   handed over.
2. Class teacher waits for all subject notes; the Office skips a subject to unblock.
3. Window: since the previous meeting (first meeting: year start).
4. Principal and Office have equal rights on the final; one per child; last editor shown.

## 7. Slices

- MC-1 server: models, roster, subject notes, class-teacher readiness/locks, final, brief.
- MC-2 server: PDF route, reminders (scheduler family), notification kinds.
- MC-3 app: Today cards + subject-note + summary screens.
- MC-4 app: Comments tab on the meeting (progress, skip, remind), final review, brief + Print.
- MC-5 tests + drive on in-memory Mongo.
