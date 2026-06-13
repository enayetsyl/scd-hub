# PRD — Student Comments + Parents' Meeting module

**Status:** Planned (build contract) · **Owner:** Principal (SCD) · **Plane:** operational / identity (ADR-005) · **Channel prefix:** CM
**Replaces:** the *Student Complain Form (Responses)* Google Form→Sheet (daily teacher observations to guardians) **and** the parents-meeting spreadsheets (*Parents Meeting Schedule*, *PARENTS MEETING LIST*, *Comments*) — twice-yearly meeting schedule + per-child meeting comments + cross-meeting comparison.
**Decisions:** D-#114, D-#115, D-#123, D-#124.

## 0. One-screen summary (checklist)
- [ ] **Two stores, one timeline.** `StudentComment` = the daily typed observation log (sent to guardians); `MeetingComment` = one consolidated Positive+Concern note per child per meeting. Both feed the in-meeting comparison view.
- [ ] **Daily comment** = type (5 values) + sentiment (concern/positive) + text + optional attachment; authored by the logged-in teacher; **subject-free** (about the whole child). Delivered **per comment**: wa.me for all + `emit()` inbox/push for login-enabled guardians.
- [ ] **Parents' Meeting** = admin creates a meeting (year + instance + date + slot length + day-start) → system generates **per-family** slots (siblings combined; "On Call" supported) → per-guardian timing notification (wa.me + emit()/push). Office captures present/absent.
- [ ] **Meeting comment** authored by the **class teacher** (lands the D-#45 parent-comms coordinator duty); Positive + Concern fields.
- [ ] **Comparison view** (in-meeting, school reps): this meeting's comment + all prior meetings' comments chronologically + a rollup of daily comments by type since the last meeting.
- [ ] **Guardian portal:** delivered daily comments + their meeting slot only. The meeting comment is for in-meeting/printed use, not shown in-portal.
- [ ] **RBAC composes existing permissions — NO new role/permission** (D-#17). App-native vocab only; **no wire/import-envelope/harness sync**. Identity plane; no corpus path; J5.6 firewall stays green.

## 1. Goal
Move the daily complaint/observation workflow off a fragile Google Form (per-row WhatsApp, #REF! formula columns, no permanent store) into one Mongo source of truth, and turn the parents-meeting spreadsheets into a scheduled, notified, comparable module so that at each twice-yearly meeting a school representative can see a child's full comment history at a glance.

## 2. Gap table
| Today (sheets/forms) | Gap | This module |
|---|---|---|
| Google Form → Sheet, per-row manual WhatsApp, `#REF!` columns | No permanent, queryable store; delivery is manual and lossy | `StudentComment` store + `emit()`/wa.me delivery per comment |
| Free-text "ustaz/ustaza name" column | Author not authenticated; unverifiable | Author = auth user (teacher), section-verified |
| Comment type in a spreadsheet column (often blank → warning) | Type optional, drifts | `COMMENT_TYPES` enum, required |
| `Comments.xlsx` Positive/Negative columns, re-typed each meeting | One-off, not linked to the child over time | `MeetingComment` per (student × meeting), part of the timeline |
| `Parents Meeting Schedule` — hand-typed slots, siblings merged by hand ("KG, Two") | No generation, no per-guardian notice | Per-family slot generation + `emit()`/wa.me timing notice |
| `Office Copy` present/absent counts typed per row | Aggregates recomputed by hand | `attended` per slot → derived present/absent totals |
| Comparison across meetings done by opening old files | No history view | `studentCommentTimeline` cross-meeting + daily rollup |

## 3. Data model (identity plane, ADR-005; no corpus path)
**`StudentComment`** — `{ studentId, sectionId, authorUserId, type ∈ COMMENT_TYPES, sentiment ∈ COMMENT_SENTIMENTS, text, attachmentIds[], createdAt, deliveredAt?, deliveryChannels[] }`. Editable by the author **until delivered**, then immutable (a correction is a new comment). Permanent — never deleted; the comparison timeline depends on history.

**`ParentMeeting`** — `{ academicYear, instanceLabel (e.g. "2026 — 1st"), meetingDate, slotMinutes, dayStartMinutes, status ∈ {draft, scheduled, closed}, includeScope }`. `includeScope` = which sections/classes the meeting covers (default: all active).

**`ParentMeetingSlot`** — one per **family** (family key = `Student.phone`, the D-#31/#59 reality): `{ meetingId, familyKey, studentIds[], classLabels[], order, slotTime?, onCall:boolean, dispatchedAt?, attended?:boolean, attendanceRemark? }`. `slotTime` null + `onCall=true` ⇒ "On Call" (no fixed time). Siblings on one phone collapse into one slot with combined `studentIds`/`classLabels` (matches the sheet's "Asila…, Arham | KG, Two").

**`MeetingComment`** — `{ meetingId, studentId, authorUserId, positiveText, concernText, createdAt, updatedAt }`. One per (student × meeting); class-teacher authored.

**Audit kinds** (`platform/models/Audit.ts`, ADR-008, NOT vocab): `STUDENT_COMMENT_RECORDED`, `STUDENT_COMMENT_DELIVERED`, `PARENT_MEETING_CREATED`, `PARENT_MEETING_SCHEDULED`, `MEETING_SLOT_ATTENDANCE_SET`, `MEETING_COMMENT_SAVED`.

## 4. Vocabulary (app-native; `/shared/vocab.ts`; verifier extends — NO wire sync)
- `COMMENT_TYPES = [GENERAL, ATTENDANCE, STUDY_HOMEWORK, BEHAVIOUR, SERIOUS_MATTER]` + `COMMENT_TYPE_LABELS_BN/EN` (carried verbatim from the live form's M-column taxonomy).
- `COMMENT_SENTIMENTS = [CONCERN, POSITIVE]` + `*_LABELS_BN/EN`.
- `NOTIFICATION_KINDS += STUDENT_COMMENT, MEETING_SCHEDULE` (+ BN/EN labels). **The verifier §C.5 asserts the EXACT `NOTIFICATION_KINDS` list — it must be extended by the same edit; OFFICE exact-list is UNCHANGED (no new permission).** A new verifier check (§C.x) asserts `COMMENT_TYPES`/`COMMENT_SENTIMENTS` label totality.
- **No new permission** — verifier permission/pipeline sets unchanged.

### 4.1 Vocab-serialization requirement (AGENTS rule 5 + the D-#94 precedent — write into the build)
`/shared/vocab.ts` is contended across parallel sessions (VC-* / CLASS_TEST_* / HR). At build time:
- If this session **owns** vocab: add the enums + the two `NOTIFICATION_KINDS` values + the verifier checks in one serialized edit.
- If vocab is **frozen** by a parallel session: ship `STUDENT_COMMENT` / `MEETING_SCHEDULE` as **kind-gated no-op emitters** (the emitter logs `SKIPPED` and the delivery falls through to wa.me only — exactly the D-#94 `ASSIGNMENT_CHASE` posture); `COMMENT_TYPES`/`COMMENT_SENTIMENTS` are required by CM-1, so CM-1 must run in a vocab-owning slot. Activation when vocab unfreezes = add the two kinds + labels + extend verifier §C.5; **no CM-module code change**.

## 5. Delivery & contact (reused seams)
- **Family contact = `Student.phone`** (D-#31/#59 — the same number the guardian login is keyed to; mirrors LibraryChase / attendance / M-6 notices). One wa.me link per comment/slot; phone-less students surface as `unreachableCount`.
- **wa.me** (ADR-003) for **all** guardians — permanent fallback. **`emit()`** (D-#72) writes the inbox row for **login-enabled** guardians; the N-4 Expo **push** channel fans out behind the seam (D-#75/#99 — `PushDevice` optional-guardian owner) to registered native devices; web/contact-only = inbox/wa.me only. The inbox row is the source of truth; push/wa.me never block it.
- **Attachments** reuse `platform/services/DriveStore` + `platform/models/StoredFile` (D-#70/#71, the M-4 `subfolder` generalization → `SCD-Hub-Files/<year>/comments/`): four `comment_*` kinds on the existing enum + optional `studentCommentId`. `POST /files/comment` (multipart, `tracker:write` + section verify; MIME image jpeg/png/gif/webp · application/pdf · video mp4/webm/quicktime · audio; **10 MB hard cap** — chat parity, D-#108; Drive-first ⇒ 503 + nothing persisted). `GET /files/:id` dispatches by the file's own kind to a comment read gate (author or `assertGuardianOfStudent` for the child's delivered comment). No twin store.

## 6. Slices (server-then-app cadence; build order)
- **CM-1 (server)** — `StudentComment` model; `COMMENT_TYPES`/`COMMENT_SENTIMENTS` vocab; `recordComment` / `editComment` (author-only, pre-delivery) / `listSectionComments` / `studentComments`; RBAC = `tracker:write` + `assertCanWrite` with the comment's **real section verified server-side**; audit `STUDENT_COMMENT_RECORDED`. No delivery yet.
- **CM-2 (server)** — daily delivery: `deliverComment` emits `STUDENT_COMMENT` via the `emit()` seam (kind-gated no-op fallback, §4.1) → inbox + push behind the seam; `commentWaLink` builds the per-comment Bangla wa.me message; `deliveredAt`/`deliveryChannels` stamped; audit `STUDENT_COMMENT_DELIVERED`. Attachments: `DriveStore` `/comments/` + `POST /files/comment` + `GET /files/:id` dispatch (§5).
- **CM-3 (server)** — `ParentMeeting` + `ParentMeetingSlot`; `createParentMeeting` / `generateSlots` (per-family by `Student.phone`, configurable `slotMinutes`/`dayStartMinutes`, sequential timed slots + an On-Call bucket; `order` admin-reorderable; default order class→section→name) / `setSlotOnCall` / admin reads; RBAC = `roster:manage` (the D-#94 admin gate); audit `PARENT_MEETING_CREATED`.
- **CM-4 (server)** — `dispatchMeetingSchedule` per slot: `emit()` `MEETING_SCHEDULE` (kind-gated fallback) + push + `meetingSlotWaLink` (Bangla, slot time or "On Call"); meeting → `scheduled`; `setSlotAttendance(slotId, attended, remark?)` + derived present/absent/total aggregates (replaces the Office-Copy counts); audit `PARENT_MEETING_SCHEDULED` / `MEETING_SLOT_ATTENDANCE_SET`.
- **CM-5 (server)** — `MeetingComment` (`saveMeetingComment`, positive + concern), RBAC = `assertIsClassTeacher` for the child's section (**lands the D-#45 parent-comms coordinator duty**); the comparison reads: `studentCommentTimeline(studentId)` = prior `MeetingComment`s chronological + daily `StudentComment` rollup by type since the previous meeting (D-#44 read-aggregate posture), and `meetingComparison(meetingId, studentId)`; guardian reads `childComments` (delivered daily comments only) + `childMeetingSlot(meetingId)` (their slot), gated `guardian:read_child` + `assertGuardianOfStudent` (D-#68); audit `MEETING_COMMENT_SAVED`.
- **CM-6 (app)** — Expo screens only, over the CM-1..CM-5 resolvers (no server change): teacher **comment entry** (type/sentiment/text/attachment + send) on the section worklist; Office **meeting admin** (create + generate/reorder slots + dispatch + present/absent); **meeting comparison** screen (per child: this meeting's editable comment + prior comments + daily rollup) for class teacher / reps; guardian portal **riders** (delivered-comments card + meeting-slot card). BN labels; existing token system (D-#61).

## 7. Journeys (Given/When/Then)
- **J-CM1 (record + deliver).** *Given* a teacher with write-scope on a section, *when* they record a `BEHAVIOUR`/`CONCERN` comment with text and tap send, *then* a `StudentComment` is stored, a wa.me link is generated for the family phone, and (if the family is login-enabled) an inbox row + push are emitted; the comment becomes immutable once `deliveredAt` is set.
- **J-CM2 (no phone).** *Given* a student with no `Student.phone`, *when* a comment is delivered, *then* it is stored and counted in `unreachableCount` and no wa.me link is offered.
- **J-CM3 (siblings, one slot).** *Given* two siblings sharing a phone, *when* the Office generates meeting slots, *then* one `ParentMeetingSlot` lists both children + both class labels and one slot time.
- **J-CM4 (On Call).** *Given* a family flagged On-Call, *when* slots are generated, *then* their slot has `onCall=true`, no time, and the dispatch message reads "ডাকা হলে আসবেন" (On Call).
- **J-CM5 (timing notice).** *Given* a scheduled meeting, *when* the Office dispatches, *then* each family gets a wa.me message with their slot time and login-enabled families also get an inbox row + push.
- **J-CM6 (meeting comment authorship).** *Given* a teacher who is NOT the section's class teacher, *when* they try to save a `MeetingComment`, *then* it is rejected in Bangla; only the class teacher (or Office/Principal? — **no**, class-teacher only) may save it.
- **J-CM7 (comparison).** *Given* a child with comments across two prior meetings + 6 daily comments since the last one, *when* a rep opens the comparison view, *then* they see both prior meeting comments chronologically and a by-type rollup (e.g. Study/Homework ×4, Behaviour ×2).
- **J-CM8 (guardian read).** *Given* a guardian, *when* they open the portal, *then* they see their child's **delivered daily comments** and their **meeting slot**, but **not** the meeting comment.
- **J-CM9 (firewall).** *Given* the corpus analytics plane, *when* it runs, *then* it cannot resolve any CM model — the J5.6 fail-closed firewall test stays green (a new CM block asserts corpus ⇄ CM both ways).

## 8. RBAC (composes existing permissions — D-#17, no new role/permission)
| Action | Gate |
|---|---|
| Record/edit/deliver daily comment | `tracker:write` + `assertCanWrite` (section verified server-side) |
| Upload comment attachment | `tracker:write` + section verify |
| Create meeting / generate slots / dispatch / set attendance | `roster:manage` (Principal/Office) |
| Save meeting comment | `assertIsClassTeacher` (the child's section) — D-#42/#45 parent-comms duty |
| Comparison timeline (reps) | `tracker:read` OR `roster:manage` |
| Guardian read (`childComments`, `childMeetingSlot`) | `guardian:read_child` + `assertGuardianOfStudent` |

## 9. Out of scope (v1)
- Approval/workflow on comments (record-then-deliver only; no review loop).
- Guardian replies / two-way thread (that is the messaging module's plane; comments are one-way like notices).
- Multi-author meeting comments (one consolidated class-teacher note; subject-teacher contribution is a future rider).
- Auto-dispatch of daily comments on a schedule (delivery is teacher-triggered per comment, like the form's per-row send).
- Folding into the messaging guardian-notice composer (kept a distinct per-student typed log — see the cross-cutting flag).
- Hard caps / SMS for the 129 contact-only families beyond wa.me (the standing D-#31/#72 limitation).

## 10. Reused / unchanged
`emit()` seam (D-#72), Expo push channel + `PushDevice` (D-#75/#99), `DriveStore`/`StoredFile` (D-#70/#71, M-4 D-#108 subfolder generalization), `assertCanWrite` / `assertIsClassTeacher` (D-#42/#45), `assertGuardianOfStudent` (D-#68), `Student.phone` family contact (D-#31/#59), wa.me builder (ADR-003), append-only audit (ADR-008), the D-#50 calendar (meeting day is a plain date; no routine interaction), guardian portal read pattern (D-#68/#69). No envelope/harness change; no permission/role change; no corpus path.

## 11. Acceptance gate (build verifies)
1. `COMMENT_TYPES`/`COMMENT_SENTIMENTS` present + label-total; verifier §C.x green; `NOTIFICATION_KINDS` extended OR kind-gated no-op proven (§4.1).
2. Daily comment record → immutable-after-deliver; per-comment wa.me + emit()/push for login-enabled; `unreachableCount` for phone-less.
3. Attachment ≤10 MB, MIME-whitelisted, Drive-first 503 posture; read gate dispatch by kind; deleted/foreign-file access blocked.
4. Per-family slot generation: siblings collapsed, On-Call honoured, configurable length/start, reorderable; present/absent aggregates derived.
5. Meeting comment is class-teacher-only (J-CM6 deny tested).
6. Comparison timeline returns prior meeting comments + daily by-type rollup since last meeting.
7. Guardian sees delivered daily comments + slot, never the meeting comment (J-CM8).
8. J5.6 firewall extended both ways (corpus ⇄ CM), green. Full gate: vocab verifier PASS, shared+server tsc clean, jest all-green (+ new CM suites), app tsc + expo web export green.
