# PRD — Guardian Portal v1 (GP)

| | |
|---|---|
| **Status** | PLANNED — build contract adopted 2026-06-12; §5 storage ruled 2026-06-12 (Google Drive live store). If a prior version of this file exists, this version REPLACES it whole. |
| **Owner** | Principal (rulings 2026-06-12); planning: Claude Desktop; build: Claude Code |
| **Decisions** | D-#68 (scope + activation), D-#69 (no staffing/location detail), D-#70 (homework attachments + Drive-as-live-store ruling) |
| **Plane** | Operational/identity ONLY (ADR-005). No corpus→identity path. J5.6 fail-closed firewall must stay green. |
| **Wire contract** | UNCHANGED. No envelope/schema/harness sync. App-native vocab only (vocab verifier must pass). |

## §1 Goal

Give every provisioned guardian family (D-#59 shared phone login) a working in-app view of
their children: today's schedule (subject/period/time only), what was taught (class notes),
and every homework with its full lifecycle — including optional teacher-attached question
and checked-answer files stored in the school's Google Drive. Plus visible-but-inert
placeholders for the modules that ride in later (attendance, fees, notices, leave
application, push). This activates the `guardian:read_child` permission that has been
declared-but-pipeline-gated since Slice 0.

## §2 Gap table

| # | Need | Exists today | Gap |
|---|---|---|---|
| G1 | Guardian can log in | YES — `guardianLogin` (J5.2) + D-#59 family provisioning; 1 real login live | none |
| G2 | Guardian is linked to children | YES — `GuardianLink` many-to-many (J5.3, D-#8); 194 live links | none |
| G3 | Guardian can READ anything | NO — `guardian:read_child` = `pipeline` in `PERMISSION_BUILD_STATUS`; zero guardian-scoped resolvers | GP-1 |
| G4 | Child switcher + guardian screens | NO screens exist for the GUARDIAN role at all | GP-2 |
| G5 | Routine view per child | Server has `routineForDate` (staff-gated `routine:read`) | guardian-scoped narrow variant, GP-1 |
| G6 | Class notes per child | Server has `classNotesForDate` (staff-gated) | guardian-scoped variant, GP-1 |
| G7 | Homework per child | Server has Layer-B `HomeworkStudentRecord` + `getStudentDayLoad` (staff-gated `tracker:read`) | guardian-scoped variant, GP-1 |
| G8 | Question/answer files on homework | NO — the app stores NO uploaded files anywhere today | GP-A (first file capability; Drive live store) |
| G9 | Attendance / fees / notices / leave / push | Modules UNBUILT | stubs only (GP-2); real surfaces ride each module (GP-3+) |

## §3 Contract & vocab changes (Claude Code: read carefully)

1. `shared/vocab.ts`: flip `PERMISSION_BUILD_STATUS["guardian:read_child"]` from `"pipeline"`
   to `"build"` (in GP-1). App-native vocab — NO mirrored enum, NO import-envelope/harness
   sync. Vocab verifier must pass after the flip.
2. **No other vocab change.** No new permission (teacher attach rides `tracker:write` +
   `assertCanWrite`; guardian read rides `guardian:read_child`). No role change.
3. GP-A adds model FIELDS (attachment refs) to existing homework models + one small
   `StoredFile` metadata model — identity-plane, no wire twin.
4. GP-2 adds guardian-facing Bangla STR keys (app-native labels only).
5. **Secrets rule (repo is PUBLIC):** the Google credential (§5) lives ONLY in server env/
   secret config — never committed, never in docs, never in test fixtures.

## §4 Design — guardian read layer (GP-1)

**Authz helper.** `assertGuardianOfStudent(ctx, studentId)` in the foundation authz module:
resolves the calling `Guardian` from the JWT (role must be GUARDIAN), requires an ACTIVE
`GuardianLink` between that guardian and `studentId`; throws ForbiddenError (Bangla message,
NFR-5) otherwise. Uniform access — every linked guardian gets the same view (D-#8). All
GP queries below call it; default-deny.

**Queries** (all gated `guardian:read_child` + the helper; identity-plane reads only):

1. `myChildren` → the calling guardian's linked active students:
   `{ studentId, nameBn, gender, rosterClassLabel, sectionId, sectionName,
   quranGroup { id, name }, arabicGroup { id, name } }`. Resolved via GuardianLink →
   Student → Section + SubjectGroupMembership. Feeds the child switcher (J5.3).
2. `childRoutine(studentId, date)` → the child's resolved day:
   - Day-type via the single calendar source (`resolveDayType`, D-#50): OFF/holiday returns
     the day-type + holiday label and an empty slot list; Saturday returns Quran-group
     slots only.
   - Slots = union of the child's Section slots + their SubjectGroup slots for that date
     (effective-window filtered). **The guardian slot type carries ONLY: subject label,
     period number, computed clock times (D-#55/#58 window math). D-#69: NO teacher name,
     NO teacher id, NO room, NO cover/substitution data.** It must be a separate, narrower
     GraphQL type than the staff slot type — never share the staff type that carries
     `teacherId`/`room`/`coverTeacherId`. Do not read `RoutineSubstitution` at all.
3. `childClassNotes(studentId, date)` → published `ClassNote`s for the child's section +
   groups for that date: `{ slotRef (subject + period — no teacher), whatWasTaughtBn,
   homework? }` where `homework` resolves the linked HW-T1 declaration (subject, qCount,
   timeDecl) if `homeworkItemId` is set. Published notes only.
4. `childHomework(studentId, from, to)` → the child's Layer-B records in the date range,
   FULL lifecycle (Principal ruling 2026-06-12): per record —
   `{ hwId, subjectLabel, currentState + stateLabelBn, stage timestamps (given/due/
   submitted/checked/returned), chaseCount, result + resultLabelBn, resubOf,
   topUp { qCount, timeMin }?, questionFile?, answerFile? }` (file refs null until GP-A) —
   plus resubmission chaining (records sharing `hwId` grouped) and `dayLoad(date)` → the
   child's base+top-up minutes vs the LOCKED 240 (reuses `getStudentDayLoad`;
   guardian-gated wrapper, NOT the staff `tracker:read` query).
5. **No guardian-facing mutation exists in v1.** Guardians read only (leave application
   etc. come with their modules; attachments are teacher-uploaded, D-#70).

**Firewall.** Every resolver above reads Student/Section/SubjectGroup/RoutineSlot/ClassNote/
HomeworkItem/HomeworkStudentRecord — operational/identity plane. None touches the corpus
module or CorpusEvent. The J5.6 fail-closed test must stay green; add one new firewall-style
test asserting the guardian path cannot reach corpus resolvers.

**RBAC tests (minimum):** guardian reads own child PASS; guardian queries an unlinked
studentId DENY; staff role calling `myChildren` DENY (role gate); inactive link DENY;
Saturday returns Quran-only; holiday returns empty + label; a slot with an active R-4
cover in the fixture returns NO teacher field at all (assert the guardian slot type has
no such field, not merely a null).

## §5 Design — homework attachments (GP-A) — storage RULED

**Ruling (D-#70, Principal 2026-06-12):** a homework item may carry an attached QUESTION
file; a student's homework record may carry an attached checked-ANSWER file. **Teachers
attach both; guardians only view.** Both optional — homework without files behaves exactly
as today. **Physical storage = the school's Google Drive as the LIVE store** (option b2,
chosen over the recommended local-disk-plus-Drive-backup hybrid) — recorded as a knowing
trade-off: this is the app's **SECOND live external dependency** (after the D-#24
biometric sync). If Google is unreachable, file attach/view fails for that request;
homework declare/check itself NEVER blocks on a file operation.

**Storage shape.**
- A single school-controlled Google account; a private Drive folder tree
  `SCD-Hub-Files/<academicYear>/hw/` — **never shared, no link-sharing, ever**. Retention:
  academic year + 1 (a year's folder is deletable a year after the year closes).
- Server↔Drive auth via a Google credential (service account, or an OAuth refresh token
  on the school account — Claude Code picks the mechanically simpler that works on the
  Oracle host and documents the choice in the build session). The credential lives in
  server env/secrets ONLY (§3.5). **Setup prerequisite:** the credential must exist before
  GP-A is verified live; a setup note (steps for the Principal/Office, no secrets) goes in
  the server README section for ops.
- `StoredFile` (identity plane): `{ _id, kind: "hw_question"|"hw_answer", mime, sizeBytes,
  originalName, driveFileId, uploadedBy, uploadedAt }`. References:
  `HomeworkItem.questionFileId?` (Layer A — one per item, shared by the class) and
  `HomeworkStudentRecord.answerFileId?` (Layer B — per student, per record; a resubmission
  record may carry its own). Re-attach replaces the reference; the old Drive file is
  retained under the year's retention (no hard delete on replace).

**Transport — the server is ALWAYS in the middle; Drive is never exposed.**
- Upload: `POST /files/hw` (Express, beside the `/pdf` routes; JWT-authed, staff only) →
  validates mime ∈ {image/jpeg, image/png, application/pdf} + size ≤ 5 MB → streams to
  Drive → creates `StoredFile` → returns `fileId`. On Drive failure: Bangla error, nothing
  persisted, the declare/check flow is unaffected.
- Download: `GET /files/:id` (JWT-authed) → authz first, then the server fetches from
  Drive and streams to the client. **No Drive URL, file id, or redirect ever reaches any
  client** (`driveFileId` is server-internal; not in any GraphQL type or HTTP response).
  Staff pass via read scope on the item's class/subject; a GUARDIAN passes ONLY via
  `assertGuardianOfStudent` — for an answer file, against that record's student; for a
  question file, against a linked child enrolled in the item's class. Default-deny; no
  unauthenticated access ever (answer files are child PII, ADR-005 — never any corpus
  path, never a public URL).

**Mutations** (staff): `attachHomeworkQuestionFile(hwItemId, fileId)` and
`attachHomeworkAnswerFile(recordId, fileId)` — both gated `tracker:write` +
`assertCanWrite` on the section (the subject teacher), **no new permission**. Audit kind
`HW_FILE_ATTACHED` (append-only, ADR-008).

**Teacher app hooks** (small additions to existing screens, swept by UI-1 later):
`DeclareHomework` gains an optional "প্রশ্নপত্র সংযুক্ত করুন" (camera/file picker → upload →
attach); `CheckingQueue` gains an optional "উত্তরপত্র সংযুক্ত করুন" per student at checking.
Upload failure shows a Bangla notice and never blocks declare/check.

**Tests:** mime/size rejection; attach by non-write-scoped teacher DENY; guardian
downloads own child's answer PASS / unlinked child DENY; guardian downloads question file
for an enrolled child PASS / other class DENY; Drive-failure path leaves no `StoredFile`
and surfaces the Bangla error; assert no GraphQL type or route response carries
`driveFileId`; firewall unaffected. Drive itself is MOCKED in jest (no live Google in CI);
live verification happens in the golden-path session with the real credential.

## §6 Slices

**GP-1 — server read layer (BUILD NOW, before UI-1).**
Vocab flip (§3.1) + authz helper + the four queries (§4) + tests + firewall green.
Gate: vocab verifier PASS, shared+server tsc clean, full jest green incl. new suite
(`guardianPortal.test.ts`), J5.6 + new guardian-firewall assertion green. No app change.

**GP-A — homework attachments (server + small teacher-app hooks; Drive credential is a
live-verification prerequisite, not a build blocker).** Model + routes + Drive adapter +
mutations + teacher attach controls + guardian file fields/download gate. Gate: server
tsc + jest green (new `homeworkFiles.test.ts`, Drive mocked), app tsc + web bundle green,
vocab verifier PASS (no vocab change expected — assert). Live verification needs the
credential (§5 setup prerequisite).

**GP-2 — guardian app screens (AFTER UI-1; consumes the D-#61 token system; attachment
display requires GP-A).**
- New **Guardian tab set**: when role = GUARDIAN, the app shows ONLY guardian tabs
  (verify all staff tabs — Questions/Sets/Trackers/Admin/Review/Routine/Homework — are
  hidden for GUARDIAN).
- **Child switcher** (J5.3): persistent header control fed by `myChildren`; selection
  scopes every screen; single-child families skip the chooser but still show the name.
- **GuardianHomeScreen** ("আজ"): selected child → today's `childRoutine` (day-type aware:
  ছুটির দিন shows the holiday label; slots show subject + period + time only),
  `childClassNotes`, and homework due/open today with state chips + day-load vs 240.
- **ChildHomeworkScreen**: date-range list grouped by day; full lifecycle detail per
  record (stage timeline, chase count, resubmission chain, result, top-up); tappable
  প্রশ্নপত্র / উত্তরপত্র viewers when files exist (image inline, PDF via the platform
  viewer), streamed via `GET /files/:id`. Reuses existing HW state/result BN labels.
- **ChildRoutineScreen**: weekly grid (Section + group slots merged), guardian slot type
  (no teacher/room anywhere).
- **Placeholder cards** on GuardianHome, inert, labeled "শীঘ্রই আসছে": উপস্থিতি, ফি,
  নোটিশ, ছুটির আবেদন, নোটিফিকেশন. Tap shows a one-line Bangla notice; no navigation,
  no dead queries.
- New STR keys (BN/EN); English codes (HW_ID etc.) stay Latin (D-#61).
- Gate: app tsc clean + web bundle green; no server/contract change in GP-2.

**GP-3+ — module riders (NOT this contract).** Attendance view, fees view, notices,
leave-application mutation, push notifications: each lands WITH its module and replaces
its placeholder card. Push delivery rides the deferred messaging pipeline (D-#52).
This PRD reserves the surfaces only.

**Order: GP-1 → GP-A → UI-1 → GP-2.** (Credential setup can run in parallel; it gates
GP-A's LIVE verification only.)

## §7 Journeys (Given/When/Then)

- **GP-J1 (switcher):** Given the D-#59 family login linked to 2 children, When the
  guardian logs in, Then `myChildren` returns both, the switcher shows both names, and
  every subsequent query is scoped to the selected child.
- **GP-J2 (no staffing detail):** Given any school day, When the guardian opens
  childRoutine, Then each slot shows subject + period + time ONLY — no teacher, no room —
  including when an R-4 cover is active that day (D-#69).
- **GP-J3 (Saturday):** Given a child in Hifz-1 Boys, When childRoutine is queried for a
  Saturday, Then only Quran-group slots return (D-#50); a child with no Quran group gets
  an empty Saturday.
- **GP-J4 (homework chase):** Given the child's record reached CHASE twice, When the
  guardian opens ChildHomework, Then the record shows state তাগাদা, chaseCount 2, and the
  stage timeline; nothing about other students is visible.
- **GP-J5 (resubmission):** Given a ভুল result spawned a resubmission (D-#43), When the
  guardian views that HW_ID, Then the original and resubmission records render as one
  chained item with both passes visible.
- **GP-J6 (files):** Given the teacher attached a question PDF at declare and the child's
  checked answer photo at checking, When the guardian opens that homework, Then both open
  in-app (streamed through the server); Given no files attached, Then the homework renders
  normally with no file UI.
- **GP-J7 (file authz):** Given guardian A not linked to student S, When A requests S's
  answer file, Then DENY; an unauthenticated request to any `/files/:id` is DENY; and no
  response anywhere exposes a Google Drive id or URL.
- **GP-J8 (Drive down):** Given Google is unreachable, When a teacher tries to attach,
  Then a Bangla failure notice shows, nothing is persisted, and declare/check completes
  normally without the file; When a guardian opens an existing file, Then a Bangla
  "এই মুহূর্তে ফাইলটি খোলা যাচ্ছে না" notice shows and the rest of the screen still works.
- **GP-J9 (deny):** Given guardian A not linked to student S, When any GP query is called
  with S's id, Then ForbiddenError (Bangla) — and the same for a TEACHER token calling
  `myChildren`.
- **GP-J10 (firewall):** Given the guardian token, When the corpus/analytics resolver path
  is attempted, Then it fails closed (J5.6 pattern).
- **GP-J11 (placeholder):** Given GP-2 shipped, When the guardian taps উপস্থিতি, Then a
  "শীঘ্রই আসছে" notice shows and no query fires.

## §8 Out of scope (v1)

- Attendance, fees, notices, leave application, push — modules unbuilt; placeholders only
  (GP-3+ riders).
- Teacher names, rooms, and cover/substitution visibility to guardians — **permanently out
  per D-#69** (closes the R-4 PRD's deferred R4.5 guardian-read as "won't show").
- Guardian uploads of any kind (answers are teacher-attached, D-#70).
- Local-disk file storage / nightly-backup hybrid — considered and NOT chosen (D-#70
  ruling); revisitable only by a new decision row.
- **How-to-guide docs** (roadmap line): no guide doc_type exists in the LOCKED import
  contract; adding one is a contract change routed to the Principal separately. Not stubbed.
- Guardian-initiated messaging/chat; password self-reset for phone logins (office/Principal
  manual reset per J5.2 stands).
- Any corpus/content surface for guardians (plans, question bank): none.

## §9 Reused / unchanged

Guardian + GuardianLink models and guardianLogin (Slice 0, D-#31/#59); routine calendar/
window/slot services (R-1/R-2) and ClassNote (R-5) read paths; Homework Layer-A/B +
`getStudentDayLoad` (HW-T1..T3); the Express layer (the `/pdf` route pattern) for file
transport; vocab BN labels for HW states/results, routine subjects, roster classes; tab
role-gating pattern (Slice 4); audit pattern (ADR-008); D-#61 token system (GP-2). LOCKED
import contract, envelope schema, harness: untouched. ScopeGrant model: untouched
(guardian access is link-scoped, never grant-scoped).

## §10 Traceability

D-#8 (uniform guardian access) · D-#31 (login-optional guardians) · D-#59 (family
provisioning) · D-#50/#55/#56/#58 (calendar/window/slot semantics reused) · D-#52 (push
stays pipeline) · D-#43/#34 (lifecycle/result semantics surfaced) · D-#24 (precedent:
live external dependency as a knowing Principal ruling — Drive is the second) · D-#68
(this scope) · D-#69 (no staffing/location detail) · D-#70 (attachments + Drive live
store) · ADR-005 (plane split) · ADR-008 (audit) · J5.2/J5.3/J5.6 (auth, linkage,
firewall) · NFR-5 (Bangla-first). Build directive: **GP-1 now → GP-A → UI-1 → GP-2;
Drive credential setup in parallel, gating GP-A live verification.**
