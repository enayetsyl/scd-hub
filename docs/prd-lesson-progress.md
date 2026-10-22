# PRD — Lesson-plan progress (`lesson_progress` module · পাঠ পরিকল্পনার অগ্রগতি)

**Status:** LP-1 BUILT 2026-10-22 (branch `feat/lesson-progress-lp1`: `LessonDelivery` + roster snapshot, `lessonPlanForSlot`,
`lessonPlan` on `publishClassNote` / `updateClassNote`, picker on both class-note screens, mark-only correction);
LP-2 BUILT 2026-10-22 (branch `feat/lesson-progress-lp2`: `lesson_progress` catalogue feature, `lessonProgressOverview` /
`myLessonProgress` / `lessonSectionTracker`, drawer ক্লাস নোট → পাঠ পরিকল্পনার অগ্রগতি, overview + tracker screens; a row
needs session plans AND a live routine slot for that শাখা × subject); LP-3 not yet built.
**Decision block:** D-#820–#826, reserved against `origin/dev@009ec1fa` (2026-10-22, max D-#813; open PR #1138
holds D-#815/#816, so D-#814–#819 are left free).

**Owner ask (2026-10-22):** "after finishing each class teacher should mark which class he/she take so that we
the office can monitor progress with plan take corrective action also it should connected to student account so if
later student do bad in a topic we should be able to locate whether he/she was present in that class or not."
Owner rulings in the same conversation (AskUserQuestion):

| Question | Ruling |
|---|---|
| Where does the plan come from? | "Lesson plan, we can connect a tracker or something with it" — the imported session plans ARE the plan. |
| How is presence known? | "use existing attendance and map it with what taught in the same day from lesson plan" — day attendance, no per-period marking. |
| How detailed is "what was taught"? | "which session plan complete on that day" |
| Corrective action | "will decide later" — v1 shows; it does not act. |

## §0 — At a glance / build order

| Slice | What it is | Needs |
|---|---|---|
| LP-1 | The class note asks "which session plan(s) did you finish?" — picker in book order, next session pre-selected; stored as a `LessonDelivery` row with the section's roster that day | session plans imported for the class × subject |
| LP-2 | Tracker: one section × subject in book order (done / in progress / skipped / not yet, date, teacher) + the school-wide overview for the Office (progress, pace, lag behind the parallel শাখা, periods with no plan mark) | LP-1 |
| LP-3 | Student link: a student's lessons per subject with present / absent from the day's attendance, "missed lessons"; mastery shows, for a weak topic's chapter, which sessions the child sat and missed (student trail + extra-class proposal) | LP-1, mastery M-3/M-5 |
| Later | Corrective action (owner: decide later); a guardian "lessons missed" view; a date-based term pacing plan | owner |

## §1 — What exists (re-used, not rebuilt)

- **Session plans** — `ContentArtifact` `docType: "session_plan"` (Classes 1–5; BAN / ENG / MATH / SCI / BGS). The
  chapter is `address.number` (anchor word পাঠ / অধ্যায় / Unit / Lesson + title); the session is
  `payload.session_plan.period_index` of `period_of` (a `single_period_standalone` plan is session 1 of 1). A re-import
  makes a new version, so a session's **stable key** is (class level, subject, chapter, session index) — never the
  artifact id alone. Prod: ~531 session plans across 16 class × subject sets (2026-09-30 repair); dev has none.
- **Class note** — one per routine slot × date (`ClassNote`), written by the slot teacher or the cover, prompted at
  12/13/14 h and escalated (D-#52, D-#477). Teachers already open it after every period, so marking rides it — no new
  daily duty, no new prompt.
- **Attendance** — `StudentAttendanceDay`, one row per unit per day, absent-only; Class 1–5 is captured on the Quran
  subject group (D-#278). `studentAttendanceHistory` reads the right unit; leave applications mark an absence as covered.
- **Mastery** — `MasteryOutcome.chapterNumber` / `MasteryChapter.number` use the book's chapter numbers, the same
  numbers the session plans carry; that is the join.

## §2 — LP-1: marking on the class note

1. On a section period whose class level × subject has **at least one current session plan**, the class-note card gets
   a "পাঠ পরিকল্পনা" block (`MyClassNotesScreen`; the admin/cover `DailyNoteScreen` too).
2. The block lists the class × subject's sessions in book order, grouped by chapter: "অধ্যায় ৩ · সেশন ২/৪ · <title>".
   The **next session** for this শাখা (the first in book order not yet finished here) is pre-selected; the teacher can
   pick more than one (two short sessions in one period) or a different one (teaching out of order is allowed — LP-2 shows it).
3. Each picked session is **শেষ হয়েছে** (finished) or **চলমান** (started, continues next class). A session's
   teaching days = every period it was picked on, finished or not (§3 presence uses all of them).
4. If nothing from the plan was taught, the teacher picks a reason instead: রিভিশন / পরীক্ষা বা ক্লাস টেস্ট /
   পরিকল্পনার বাইরে অন্য কাজ (+ optional note). **An answer is required** to publish — sessions or a reason — exactly
   like the homework yes/no (D-#299): silence is not data. **The app enforces it; the server does not** — a phone on
   an older app build publishes without the field and must keep working, so such a note simply has no delivery row
   (the overview counts it as unanswered). A wrong answer that IS sent (unknown or duplicate session, no reason) is
   refused before the note is written.
5. The block pre-fills the "যা পড়ালাম" text with the picked session titles when that text is still empty (guardians
   keep reading the note as today).
6. **Correcting a mark** goes through `updateClassNote` (the author, or `class_note:edit_all`) and does **not**
   re-notify guardians; a re-publish keeps today's re-notify behaviour (D-#336).
7. Periods of a class × subject with no session plans (Nursery, KG, Class 6, Quran, Arabic, Islam, groups) show no
   block and need no answer.

**Stored as `LessonDelivery`** (one row per class note, upserted with it, deleted with it): note, slot, section, class
level, subject, date key, teacher (the publisher — a cover counts as the teacher of that day), `sessions[]` =
{chapter, sessionIndex, sessionOf, artifactId at marking, title snapshot, finished}, `noneReason` + `noneNote`,
and `rosterStudentIds` — the section's active students at marking time. The roster snapshot is what makes the
student link survive a section move (the 2026-10-01 C4/C5 gender split moved students with no history kept).

## §3 — LP-2: tracker and Office overview

**Section tracker** (one শাখা × subject): every session in book order with its state —
- **শেষ** finished (date, teacher; more than one date if it ran over), **চলমান** started not finished,
- **বাদ পড়েছে** skipped (not finished, but a later session is), **বাকি** not yet.
Header: finished / total (%), sessions finished in the last 4 school weeks (pace), projected finish at that pace,
last marked date, and this term's periods with a reason instead of a session (by reason).

**Office overview** (school-wide, `lesson_progress:view_all`): one row per শাখা × subject that has plans — finished /
total, pace, **lag behind the parallel শাখা** of the same class (boys vs girls: "২ সেশন পিছিয়ে"), days since the last
finished session, notes published without a plan answer (pre-launch history, or a non-plan teacher). Sorted with the
largest lag first; filter by class and subject. **No corrective action in v1** (owner: decide later) — the overview is
what the Office reads to decide; acting on it is a later slice.

## §4 — LP-3: the student link

**Presence of one student at one session** — from the session's teaching days (§2.3) × the student's day attendance
(`studentAttendanceHistory`), only for deliveries whose roster snapshot holds the student:
- **উপস্থিত** present on every teaching day; **আংশিক** present on some; **অনুপস্থিত** absent on all (leave-covered
  shown as ছুটিতে); **অজানা** attendance not taken on those days. The record never guesses "present".

**Where it shows**
- Student lessons (staff): per subject, the sessions the child's শাখা was taught with the presence state, and a
  "missed lessons" list first. Reached from the student profile and from the mastery student page.
- Mastery student / outcome trail: for the outcome's chapter — "অধ্যায় ৭ পড়ানো হয়েছে: সেশন ১ (১২ অক্টো, উপস্থিত),
  সেশন ২ (১৩ অক্টো, অনুপস্থিত) …", or "এই অধ্যায় এখনও পড়ানো হয়নি".
- Mastery extra-class proposal (M-5): "দুর্বল ৯ জনের ৪ জন এই অধ্যায়ের অন্তত একটি সেশনে অনুপস্থিত ছিল" with
  the names — missed-the-lesson suggests catch-up rather than re-teach. Information for the approver, not a new rule.

## §5 — Permissions (permission matrix, D-#790)

New feature `lesson_progress` in `shared/permissionCatalogue.ts`:

| Action | Who by default | Gates |
|---|---|---|
| `view` | teacher, office | section tracker + student lessons — row rule for a teacher: the routine gives them that শাখা × subject, or they are its class teacher |
| `view_all` | office (Principal inherits) | overview; any শাখা's tracker and any student's lessons |

Marking needs no new action — it rides `class_note:create` / `class_note:edit` / `class_note:edit_all`. Mastery views
keep their own gates and only add rows.

## §6 — Acceptance (feeds tests)

1. A section period of a class × subject with plans cannot publish **from the current app** without a session or a
   reason; one without plans publishes as before; an older app build (no field) still publishes.
2. The next session is the first in book order not finished in that শাখা; a later re-import of a plan keeps marks
   (stable key), and the tracker shows the current title.
3. A session picked চলমান on day 1 and শেষ on day 2 has two teaching days; a student absent on day 1 only is আংশিক.
4. A student moved to a new শাখা keeps the sessions their old শাখা was taught while they were on its roster, and does
   not inherit sessions taught in the new শাখা before they joined.
5. Attendance not taken that day → অজানা, never উপস্থিত.
6. A teacher cannot read a শাখা's tracker the routine does not give them (and is not class teacher of) without `view_all`.
7. Correcting a mark via `updateClassNote` re-writes the `LessonDelivery` row and sends no guardian notice; deleting the
   note deletes its row.
8. Overview lag is computed only between শাখা of the same class level and subject.
