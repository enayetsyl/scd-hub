# PRD — Mark-submission guard (Sunday ladder + same-day correction record)

Owner ask, 2026-11-02. Decisions D-#889–#893. Builds on the assignment tracker
(`prd-tracker-assignment` / AS-T*), the roster passes (RP-1/RP-3, D-#355/#356), the gift
rule (`prd-assignment-gift.md`, D-#479–#483), system pop-ups (D-#871 slot) and the staff
file (HR-4).

## 1. Goal
Two problems, one feature:

1. **Thursday assignments go unmarked on Sunday.** The gift rule counts a submission only
   when the teacher marks it by the due date. An item whose submit pass never runs leaves
   every child at GIVEN/DUE, and the week silently scores LOST for the whole section.
2. **A wrong first mark sends guardians a false notice.** A child crossed in the submit pass
   is chased, and the guardian is told the work was not brought. When the teacher later
   flips that child to "brought" on the same day, the guardian has already read the false
   notice. Owner ruling (2026-11-02): a same-day flip is **always the teacher's mistake**:
   "there is no way" a child brings it later the same day.

## 2. The Sunday ladder (D-#889, D-#890)
"Sunday" means **the due day of a Thursday assignment**: an ISSUED `AssignmentItem` whose
`dueDate` is today (Asia/Dhaka). A holiday that rolls the due date (D-#86) moves the ladder
with it. Nothing fires on a day with no item due.

**Who is "the teacher" of an item** (owner, 2026-11-02): the person who gave it on Thursday
(`deliveredBy`) **and** the proxy covering that section for them on the due day, if any (an
active `RoutineSubstitution` dated the due day, on a slot of the item's section, whose
`absentTeacherId` is the deliverer or the item's `teacherId`). Both see the pop-ups; both are
named in the 9:30 list.

**An item is "unmarked"** while any of its student records is still GIVEN or DUE (the submit
pass moves every actionable record to SUBMITTED or CHASE; ABSENT_REDELIVER is not actionable
and does not count).

| When | Who | What |
|---|---|---|
| The teacher's **first app open** on the due day | Every teacher of an item due today, marked or not | Pop-up 1 (normal; closes with "ঠিক আছে"). Lists that day's items; explains that an unmarked child loses the week's gift and the 4-week streak. Shown once per person per day. |
| **09:00** | Teachers with at least one item still unmarked | Pop-up 2: the unmarked items. **No ✕, no back-button close, no auto-close**; only **"বুঝেছি"** closes it (unlocked after 3 s). Shown once per person per day; marking everything before opening it means it never shows. |
| **09:30** | Holders of `mark_submission:alerts` (Office + Principal by default) | A **push notification** (inbox row) **and** a pop-up (only "বুঝেছি" closes it) listing every teacher (and proxy) still unmarked: name, class/section, subject, AS_ID. Nothing unmarked = nothing sent. |

The 09:30 list is a snapshot taken at 09:30; the pop-up marks a row "এখন জমা হয়েছে" if it
was marked after the snapshot. Pop-ups refetch when the app comes back to the foreground and
every 5 minutes, so a teacher who opened the app at 07:30 still gets pop-up 2 at 09:00.

**Reopening the list (D-#1106).** After "বুঝেছি" the pop-up is gone for that day, so the
অ্যাসাইনমেন্ট page has a **⏰ ০৯:৩০-এর জমার হিসাব বাকি** button (same `mark_submission:alerts`
gate) that opens screen `MarkEscalationList`: a day picker over every saved snapshot (newest
first, each with how many are still unmarked) and the same rows as the pop-up. For a login that
also holds `assignment:view` (the workspace's gate; Office is off by default) a row opens that
section's অ্যাসাইনমেন্ট কাজ; otherwise it is a plain row. Opening it acknowledges nothing. The 09:30 inbox row opens this
screen on its own day (`refs.date`). Server: `markEscalation(dateKey)` /
`markEscalationDays(limit)`.

D-#890 is the first system pop-up that **also pushes**: the composed pop-up notices stay
pop-up-only (D-#858), but the owner asked for push here.

### Draft wording (Bangla, owner terms)
- Pop-up 1 title: **আজ অ্যাসাইনমেন্ট জমার দিন**. Body: "বৃহস্পতিবারে দেওয়া অ্যাসাইনমেন্টগুলো আজ
  জমা নেওয়ার দিন। কে জমা দিয়েছে আজই অ্যাপে চিহ্নিত করুন। চিহ্নিত না করলে শিক্ষার্থী জমা দিলেও
  তার এই সপ্তাহের উপহার বাতিল হবে এবং টানা চার সপ্তাহের হিসাব আবার শূন্য থেকে শুরু হবে।" + the list.
- Pop-up 2 title: **এখনো জমার হিসাব দেননি**. Body: "নিচের অ্যাসাইনমেন্টগুলোর জমার হিসাব এখনো
  দেওয়া হয়নি। সাড়ে ৯টায় প্রধান শিক্ষক ও অফিসকে জানানো হবে।" + list + button "বুঝেছি".
- 09:30 push: **অ্যাসাইনমেন্ট জমার হিসাব বাকি** — "{n} জন শিক্ষক {m}টি অ্যাসাইনমেন্টের জমার হিসাব
  এখনো দেননি।"

## 3. Assignment chase tells the guardian (D-#891)
Today only homework chases notify the guardian automatically (D-#260); an assignment guardian
notice is a teacher-sent follow-up step (AssignmentFollowUpService). From now on the **first
chase** of an assignment record (any path: submit pass, sibling sweep) sends the child's
login-enabled guardians an in-app notice (kind `ASSIGNMENT_CHASE`, the existing kind; deduped
per record per day), with the gift warning: "{child} আজ {subject} অ্যাসাইনমেন্ট ({AS_ID}) জমা
দেয়নি। জমা না দিলে এই সপ্তাহের উপহার পাবে না।" A record re-crossed while already CHASE stays a
no-op (§3.1). The teacher-sent follow-up ladder is unchanged.

## 4. Same-day correction = a recorded mistake (D-#892)
**The event.** A record whose latest CHASE stamp was made **by a person** (`by` set; system
sweeps carry no `by`) **today** (Dhaka day) leaves CHASE for SUBMITTED, or has that chase
undone (D-#338 revert), on the same day. Covers homework **and** assignments, every day, every
path (roster pass, single-record tap, undo, an accepted guardian work claim). A chase from an
earlier day flipped today is a late submission, not this event. The mistake belongs to **the
person who made the chase stamp**, even if someone else corrects it.

**Before the first submission** (every submit pass where none of the item's records has been
marked yet): a confirm dialog — "জমা দিন চাপলে যাদের 'জমা দেয়নি' চিহ্নিত করবেন, তাদের অভিভাবক
সাথে সাথে জানবেন যে কাজ আনা হয়নি — শিক্ষার্থী এনে থাকলেও। তাই প্রথমবারেই সাবধানে চিহ্নিত
করুন। পরে একই দিনে বদলালে তা ভুল হিসেবে আপনার ফাইলে লেখা থাকবে এবং প্রধান শিক্ষক ও অফিস জানবেন।"
Buttons: "আবার দেখি" / "জমা দিন".

**Before a correcting submission** (the pass flips a same-day person-made chase): a stronger
dialog naming the children — "{n} জন শিক্ষার্থীকে আজ 'জমা দেয়নি' চিহ্নিত করা হয়েছিল এবং তাদের
অভিভাবক সেই বার্তা পেয়েছেন। এখন বদলালে এটি আপনার ভুল হিসেবে কর্মী ফাইলে লেখা হবে এবং প্রধান
শিক্ষক ও অফিসকে জানানো হবে। অভিভাবককে দুঃখপ্রকাশসহ সংশোধনী পাঠানো হবে।" Buttons: "বাতিল" /
"বুঝেছি, বদলান". The same dialog guards a single-record flip and an undo of such a chase.

**After it lands** (D-#893):
1. **Staff file.** One `MarkCorrectionNote` per (person × item × day), the children added as
   they are flipped. A lighter record than the conduct ladder (owner, 2026-11-02): no stage,
   no hearing, no lapse; it never feeds `ConductRecord`. Shown in the staff member's file as
   **"নম্বর জমায় ভুল"** (Office/Principal: `mark_submission:view_notes`; the person: own).
2. **Principal + Office** (`mark_submission:alerts`): an inbox row + push "{teacher} আজ
   {class/section} {subject}-এ {n} জনের জমার হিসাব পরে বদলেছেন" (deduped per note per
   recipient; a second batch on the same note updates nothing new).
3. **Guardian correction** to each flipped child's login-enabled guardians: "দুঃখিত, আজ
   আপনার সন্তান {child}-এর {subject} {বাড়ির কাজ/অ্যাসাইনমেন্ট} জমা দেয়নি বলে যে বার্তা গিয়েছিল
   তা ভুল ছিল। সে জমা দিয়েছে।" (new kind `WORK_MARK_CORRECTED`; deduped per record per day).
4. **The teacher** sees an alert after the save: "ভুল হিসেবে আপনার ফাইলে লেখা হয়েছে; প্রধান
   শিক্ষক ও অফিসকে জানানো হয়েছে।"

## 5. Permissions (D-#893)
New catalogue feature **`mark_submission`** ("নম্বর জমা", group teaching_and_trackers):
- `alerts` — receive the 09:30 list and correction notices (teacher off, office on);
- `view_notes` — read anyone's "নম্বর জমায় ভুল" notes (teacher off, office on);
- `view_own` — own reminders and own notes (SELF).

## 6. Data (identity plane, ADR-005; no corpus path)
- `MarkReminderAck` — `{ userId, dateKey, stage: MORNING | NINE | ESCALATION }`, unique on
  all three. Written when a pop-up is closed.
- `MarkEscalation` — `{ dateKey, rows: [{ asItemId, asId, sectionId, subject, teacherIds }],
  createdAt }`, unique on `dateKey`. The 09:30 snapshot.
- `MarkCorrectionNote` — `{ staffUserId, staffProfileId?, tracker: HOMEWORK | ASSIGNMENT,
  itemId, itemCode, sectionId, subject, dateKey, students: [{ studentId, chasedAt,
  correctedAt, correctedBy, via: PASS | TAP | UNDO | CLAIM }] }`, unique on (tracker, itemId,
  staffUserId, dateKey).
- New notification kinds in `shared/vocab.ts` (two-place sync + verifier pin):
  `MARK_SUBMISSION_ESCALATION`, `MARK_CORRECTION`, `WORK_MARK_CORRECTED`.

## 7. Slices
- **MS-1 — correction guard** (§3, §4, §5): detection at the transition seam, the note,
  three notices, the two dialogs, the staff-file list.
- **MS-2 — Sunday ladder** (§2): reminder query + ack, 09:00 refresh, 09:30 scheduler family
  (with its `jest.mock` stub in the scheduler suite, or the DB-free suite hangs) + snapshot + Office/Principal pop-up.

## 8. Acceptance
1. A teacher who delivered a Thursday item opens the app on its due day → pop-up 1 once; a
   second open the same day → nothing.
2. At 09:00 an unmarked teacher sees pop-up 2; it has no ✕ and back does not close it; after
   "বুঝেছি" it never returns that day. A teacher who marked everything never sees it.
3. A proxy covering that section on the due day sees the same pop-ups.
4. At 09:30 Office + Principal get one push + one pop-up listing exactly the unmarked items
   and their teachers; nothing is sent when all are marked.
5. A holiday-rolled due date fires the ladder on the rolled day, not on Sunday.
6. First assignment chase → the guardian gets the gift-warning notice once.
7. Chase at 10:00 by the teacher, flip at 11:00 → warning dialog, a note in the chaser's
   file, Office + Principal notified, the guardian gets the correction. A system chase flipped
   the same day, or a chase from yesterday flipped today → none of that.
8. Undo of a same-day chase → the same as 7.
9. Teachers never see anyone else's notes; Office sees them under the staff file.

## 9. Out of scope
- Homework is not part of the Sunday ladder (it has its own 13:00–16:00 pending ladder).
- No salary or conduct effect from a note; the Principal decides any action.
