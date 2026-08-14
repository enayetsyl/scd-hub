# PRD — Daily Entry (one screen for the teacher, one answer for the guardian, DE-1..DE-6)

**Status:** Draft for build — raised by owner 2026-08-14
**Owner:** Principal (SCD)
**Scope:** One optional input on an existing mutation (`publishClassNote`), ONE new model field
(`AssignmentItem.description`), and app rework of the class-note period card + the guardian home.
**No new model, no new tracker-kind, no new permission, no `/shared/vocab.ts` change, no envelope /
harness sync.**
**Traceability:** D-#476 (merge the surfaces, not the records), D-#477 (assignment description).
Builds on: R-5 class notes (D-#52), UX-8 teacher-first Class Notes (D-#266), HW-T1 declaration
(D-#33/#34), D-#317 (mandatory homework `description`), D-#299 (nil declaration), D-#336 (edit mode +
auto-link), AS-T2 delivery pass (D-#86/#87), D-#325 (attendance-backed roster prefill), D-#274/AS-T6
(weekly ceiling), GE-1..GE-3 (D-#464/#465 — the engagement numbers that motivate the guardian half).

---

## 0. Quick checklist (read this first)

- [ ] Six slices, built in this order: **DE-1 → DE-2 → DE-3 → DE-4 → DE-5 → DE-6**. One PR each, off `dev`.
      DE-1 and DE-2 answer the owner's live complaint and ship independently of everything after them.
- [ ] The three records **stay three records**. DE-3 composes existing services; it must NOT duplicate
      declare logic, skip the audit rows, or bypass `assertCanWrite`.
- [ ] The composite gates **both halves separately** — `publishClassNote` is `routine:read`,
      `declareHomeworkItem` is `tracker:write` + `assertCanWrite(section, subject)`. A caller with only
      the first must still be able to publish a note.
- [ ] `AssignmentItem.description` is required at the resolver, **optional on the schema** — pre-DE-2
      rows have none (the D-#317 posture, verbatim).
- [ ] The class-teacher daily reconciliation (`confirmHomeworkDay`, 120-min gate) is **untouched** and
      stays its own screen. It is a different role's job, once per section per day.
- [ ] Route names unchanged (house rule). `MyClassNotes` keeps its name; its content grows.
- [ ] All new user-facing strings → `STR` in `app/src/lib/labels.ts`, Bangla + English.
- [ ] Gate per slice: server slices = `npm run typecheck --workspace=server` + focused jest + full jest
      green + vocab verifier PASS (untouched); app slices = `tsc --noEmit` + `expo export --platform web`
      (check `$?`, never trust a piped tail) + the §5 manual checklist on phone-width AND ≥1024px web.

---

## 1. Goal

A subject teacher today enters one day's work in **three places**: what was taught (Class Notes),
the homework (Declare Homework), and on delivery day the weekly assignment (Assignments). Each asks
again for context the app already knows — class, section, subject, date — and the class note asks the
teacher to *link* a homework item they must first go and create somewhere else.

A guardian reads the same day in three places too, and worse: when a child is in **তাগাদা**, the row
says `HW-C1-ENG-0013` and a red badge, with no statement of what the work actually was. The parent has
to open the class note for the date it was given — which for a 4-day-old chase item they must first
find.

This PRD collapses **entry to one screen** and makes **every guardian row self-sufficient**.

## 2. Pre-flight findings (live files, 2026-08-14)

Checked before designing; two of these change what needs building:

| # | Finding | Consequence |
|---|---|---|
| P1 | `ClassNote.homeworkItemId` already exists ([ClassNote.ts:22](../server/src/modules/routine/models/ClassNote.ts)), and `MyClassNotesScreen` already auto-links the day's item when exactly one exists (D-#336). | The link is built. Only **creation** from the note card is missing. DE-3 is smaller than it looks. |
| P2 | `HomeworkItem.description` is mandatory at declare (D-#317) **and** `childHomework` already fetches it — `operations.ts` line 3142 sends `description qCount timeDecl ... questionFileId answerFileId attachmentIds`. `grep description` across all three guardian screens returns **nothing**. | The text the parent is missing is already in the database and already on the wire. DE-1 is pure rendering — no schema, no resolver, no contract. |
| P3 | `AssignmentItem` has **no description field at all** — `asId`, dates, `totalMarks`, `estMinutes`, `setId`, attachments only. `childAssignments` returns nothing describing the work. | For assignments there is nothing to render. The field must be added (DE-2). Unlike homework, the class note is no fallback either: assignments are weekly and link to no slot. |
| P4 | `publishClassNote` gates `routine:read`; `declareHomeworkItem` gates `tracker:write` + `assertCanWrite`. | The composite cannot inherit one gate for both halves. See §3.3. |
| P5 | `assignmentPrep` already returns `deliveryDateKey` + `cells { classLevel, subject, sectionId }` (consumed by `TodayScreen`). | DE-5 needs no new read. |
| P6 | Only 9 of 137 guardians have ever logged in (GE-3, `scdhub_local`). | The guardian half is an adoption problem, not a polish problem. Weight DE-1/DE-6 accordingly. |

## 3. Design

### 3.1 DE-1 — The guardian sees what the work is (app only)

Render, on every guardian homework row, what the server already sends: `description` (the teacher's
"কী করতে হবে"), and the 📎 প্রশ্নপত্র when `questionFileId`/`attachmentIds` exist.

- [GuardianHomeScreen.tsx:538-552](../app/src/screens/guardian/GuardianHomeScreen.tsx) — the open-homework
  row currently renders `subjectLabel` + `hwId` + badge. Add `description` under the subject, `hwId`
  demoted to `Muted`.
- [ChildHomeworkScreen.tsx](../app/src/screens/guardian/ChildHomeworkScreen.tsx) — same, on each record card.

Decision: the row shows **`description`, never the linked note's `taughtSummaryBn`**. A chase item is
often days old; making the parent reconstruct which lesson it belonged to is the exact friction being
removed. The note stays available in আজ কী পড়ানো হলো for parents who want it.

No server change. No new STR keys beyond a label for the attachment button if one is needed.

### 3.2 DE-2 — The assignment says what it is (server + app)

1. `AssignmentItem` gains `description?: string` (`trim: true`). Optional on the schema, **required by
   `deliverAssignment`** — pre-DE-2 rows keep none (D-#317 posture).
2. `deliverAssignmentItem` takes and stores it; `updateAssignmentItem` lets it be edited.
3. Exposed on the Layer-A GraphQL ref and added to `childAssignments`.
4. `DeliverAssignmentScreen` gains a required **কী করতে হবে** field above সময়/পূর্ণমান.
5. `ChildAssignmentsScreen` + the guardian-home assignment rows render it, exactly as DE-1 does for
   homework.

No index change (not queried by it). No vocab/contract sync — it is a free-text field, not vocabulary.

### 3.3 DE-3 — `publishClassNote` accepts the homework (server)

The mutation gains ONE optional argument:

```
publishClassNote(
  slotId: ID!, date: String!, taughtSummaryBn: String!,
  homeworkItemId: String,            # unchanged — link an EXISTING item
  attachmentIds: [String!],
  homework: ClassNoteHomeworkInput   # NEW, optional
)

input ClassNoteHomeworkInput {
  mode: String!            # "DECLARE" | "NIL"  (server-validated, no GraphQL enum — house pattern)
  # DECLARE:
  topTags: [String!], description: String, qCount: Int, timeDecl: Int,
  poolRef: String, revItem: Boolean, attachmentIds: [String!]
  # NIL:
  reason: String
}
```

**Resolve order (one service call):**

1. Gate the note half as today (`routine:read` + the service's existing slot/subject ownership +
   `canManage` check).
2. If `homework` is present, **independently** gate the homework half: `tracker:write` +
   `assertCanWrite(ctx, sectionId, subjectId)`. Deny surfaces the existing Bangla message. A caller who
   may write the note but not the homework gets a clear error naming the homework half — the note is
   not silently dropped, and the app hides the block for them anyway (§3.4).
3. Resolve `classId` / `sectionId` / `classLevel` / `academicYearId` **from the slot**, never from the
   client. A `subjectgroup` slot (Quran/Arabic) has no section homework: reject `homework` on one.
4. `mode: DECLARE` → call `declareHomeworkItem` verbatim (same `hwId` numbering, same `topTags`
   validation, same unique index, same `status: "declared"`). If the day's item already exists for that
   (class, section, subject, day), route to `updateHomeworkItem` instead of erroring — a re-publish is
   an edit, matching the note's own (slotId, date) upsert.
   `mode: NIL` → call `declareNoHomework`.
5. Upsert the `ClassNote` with `homeworkItemId` set to the item from step 4.
6. Emit `CLASS_NOTE_PUBLISHED` as today.

**Atomicity (D-#476):** homework first, note second, **both idempotent on retry** — rather than a
cross-collection transaction. If step 5 fails after step 4, the declared item is legitimate (it is
exactly what the old two-screen flow would have produced) and the teacher's next tap re-runs step 4 as
an update and step 5 as an upsert. A transaction would buy strictness at the cost of a replica-set
dependency in a path that is already upsert-shaped.

**Untouched:** `declareHomeworkItem` / `declareNoHomework` / `updateHomeworkItem` mutations stay in use
by `DeclareHomeworkScreen`; `confirmHomeworkDay`, the 120-min ceiling, `issueHomeworkItem`, Layer-B,
chase and all roll-ups see an ordinary declared item.

**Jest (`classNoteHomework.test.ts`):** DECLARE creates + links + returns the note; NIL creates the nil
row + leaves `homeworkItemId` null; re-publish updates rather than duplicating (unique index holds);
`tracker:write` denial with `routine:read` present still refuses the homework half; subjectgroup slot
rejects `homework`; ids are slot-derived (a forged client `sectionId` is ignored); the declared item is
indistinguishable from one made via `declareHomeworkItem`; audit rows written per underlying service.

### 3.4 DE-4 — The period card becomes the day's entry (app)

[MyClassNotesScreen](../app/src/screens/classnotes/MyClassNotesScreen.tsx) already lists the caller's own
periods from `myDay` — cover-overlaid and day-type filtered — so it never asks for class/subject/date.
`PeriodNoteCard` grows, in place (no navigation):

```
৩য় পিরিয়ড · ১০:৩০–১১:১০ · গণিত · ৭ম-ক                    [লিখুন]
  যা পড়ালাম     [__________________________]        (required)
  বাড়ির কাজ      ( ) নেই — কারণ chips    (•) আছে
      টপিক        [chips — prefilled from this subject's last item]
      কী করতে হবে [__________]  সময় [২০]  প্রশ্ন [৫]   (prefilled from last)
  📎 সংযুক্তি     [one picker — lands on the note; also on the item when আছে]
                                                  [প্রকাশ করুন]
```

- **Prefill rules:** topics, `timeDecl` and `qCount` seed from the caller's most recent item for that
  (subject, section); `timeDecl` falls back to 20 (the model default). Prefilled values are editable and
  are never submitted without the teacher pressing প্রকাশ করুন.
- **Gating:** the বাড়ির কাজ block renders only when `can('tracker:write')` — admins and cover teachers
  without it see the note form exactly as today. The server gates independently regardless (§3.3).
- **Subjectgroup periods** (Quran/Arabic) show no homework block — matching the existing
  no-section-homework rule, and D-#36 (Quran is out of the HW tracker).
- **Already-published** notes keep the D-#336 edit path; editing re-opens the same combined form with
  the linked item's values loaded, and submits update-shaped.
- **One attachment picker.** Files attach to the note; when homework is `আছে` the same ids also go to
  the item, so a worksheet uploaded once appears on both the diary and the homework card.

`DeclareHomeworkScreen` and `DailyNoteScreen` stay exactly as they are (admin, back-date, cover,
subject-group and Principal paths).

### 3.5 DE-5 — Assignment delivery on the same card (app)

When `assignmentPrep.deliveryDateKey` is today and a cell matches this period's `(sectionId, subject)`
with no item yet, the card grows a second block below homework:

```
── এই সপ্তাহের অ্যাসাইনমেন্ট ──
কী করতে হবে [__________]   সময় [__]  পূর্ণমান [__]  📎
রোস্টার: ২৮ উপস্থিত · ২ অনুপস্থিত   [দেখুন ▾]      [দিয়ে দিলাম]
```

The roster is the existing `deliverAssignment` payload, prefilled from attendance (D-#325) and folded;
a manual toggle still wins. On a day whose attendance is incomplete, the fold opens by default with the
existing `hwRosterAttendanceIncomplete` notice. `AssignmentHomeScreen` remains the planning grid and the
path for delivering a missed week.

### 3.6 DE-6 — Guardian home: two cards (app)

[GuardianHomeScreen](../app/src/screens/guardian/GuardianHomeScreen.tsx) currently shows the same homework
**twice** — nested under the class note (line 482) and again in the open-homework card — plus a third
card for assignments. Restructure the daily path to:

1. **করতে হবে** — open homework (DUE/CHASE) + pending assignments only, hidden when empty. Each row:
   subject · **description** · দেওয়া/জমা dates · minutes · 📎 · status badge. Self-sufficient by DE-1/DE-2.
2. **আজ কী পড়ানো হলো** — one row per subject: taught summary with that subject's homework nested
   underneath. The duplicate open-homework card is removed.
3. **এই সপ্তাহের অ্যাসাইনমেন্ট** — pinned until returned.

The three existing tabs stay as **history**, not the daily path. The badge-tone rules (CHASE danger /
DUE warn / else brand) and the day-load ceiling line are kept verbatim.

**Notification rider (optional, same slice):** `CLASS_NOTE_PUBLISHED` fires per note, so a family gets
5–6 pushes a day. One end-of-day digest — *"আজকের পাঠ ও বাড়ির কাজ প্রস্তুত"* — landing on card 2 is the
intended follow-up. Uses the existing kind; no `NOTIFICATION_KINDS` addition.

## 4. Journeys (Given/When/Then)

- Given a subject teacher who taught 5 periods, When they open আমার ক্লাস, Then all 5 periods are
  listed with no class/subject/date picker, And each day's note + homework is entered from that one
  screen without navigating away.
- Given a teacher fills যা পড়ালাম and বাড়ির কাজ · আছে and presses প্রকাশ করুন, Then one `HomeworkItem`
  is declared with a normal `hwId` and the note is published linked to it, And the reconcile screen
  counts it in DAY_TOTAL exactly as a `DeclareHomeworkScreen` item.
- Given a teacher selects বাড়ির কাজ · নেই with a reason, Then a nil declaration is written and the note
  publishes with no homework link.
- Given a teacher re-publishes the same period, Then the note upserts and the item updates — no
  duplicate item, no unique-index error.
- Given a cover teacher with `routine:read` but not `tracker:write`, When the card renders, Then no
  homework block is offered, And a forged homework payload is refused server-side with the existing
  Bangla message.
- Given a Quran/Arabic subject-group period, Then no homework block appears and the server rejects one.
- Given today is the delivery day for a subject's weekly assignment and attendance is marked, When the
  teacher opens that period's card, Then the assignment block appears prefilled, And delivering is one
  tap.
- Given a guardian opens the app and their child is in তাগাদা, When করতে হবে renders, Then the row states
  **what the work was**, when it was given, when it is due, and offers 📎 — with no navigation to a
  class note.
- Given an assignment delivered after DE-2, Then the guardian row states what the assignment is; Given
  one delivered before DE-2, Then the row renders without a description and nothing crashes.

## 5. Manual checklist (app slices)

Run on phone-width AND ≥1024px web:

1. Teacher with 5 periods: publish note-only, note+homework, note+nil — three cards, no navigation.
2. Re-publish a published period; confirm one item, updated (check `hwId` unchanged).
3. Reconcile screen shows the card-declared items in DAY_TOTAL; confirm-issue works.
4. Cover/admin without `tracker:write`: no homework block, note still publishes.
5. Quran period: no homework block.
6. Delivery-day period: assignment block appears; roster prefilled; deliver once, block disappears.
7. Guardian: chase row shows description + dates + 📎; no duplicate homework card; the tabs still work.
8. A pre-DE-2 assignment renders with no description and no blank-label artefact.

## 6. Out of scope

- Merging the three models, or any change to lifecycle states/edges, chase messaging, the 120-min
  ceiling, the weekly AS ceiling, reconciliation or roll-up formulas.
- Retiring `DeclareHomeworkScreen`, `DailyNoteScreen` or `AssignmentHomeScreen`.
- Moving `confirmHomeworkDay` (class-teacher daily reconciliation) onto the period card — it is a
  different role's job and needs the whole day's subjects in view.
- Quran/Arabic homework of any kind (D-#36).
- Offline/optimistic caching of the combined publish.
- Applying the same collapse to Class Test / Vocabulary / Saturday Revision — recorded as the intended
  follow-on, each in its own PRD.
