# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
- HR step 2 — staff LEAVE source + the staff-attendance leave reconciliation (server, prd-hr §3/H2,
  D-#22/#23; build rulings D-#102/#103). New `modules/hr/`: `StaffLeaveEntitlement` (per staff/year/type
  allowance — admin DATA, numbers parked, no seed), `StaffLeaveApplication` (parent record + paid/unpaid
  split; exceed WARNS, never blocks, §3.3; maternity/hajj wholly unpaid, D-#23), `StaffCoverSlot` (fans out
  one slot per class the absent teacher teaches → on approval mints a D-#20 proxy grant via assignProxy;
  cancel/reject revoke it — D-#22 propose-then-approve). Services: LeaveEntitlementService (balance/proration/
  day-count pure math), StaffLeaveService (apply/decide + the `loadApprovedLeaves`/`staffLeaveCovers` overlay
  helpers), CoverService (fan-out/propose/approve/revoke), staffMatch (the phone-only User↔StaffProfile join,
  no FK/migration added). **Closed the AT-1 ✘-resolution seam**: a biometric ✘ now reads LEAVE when an
  APPROVED staff leave covers that staff/date — a READ-TIME overlay in `TeacherAttendanceService`
  (forDate + summary), correct even when leave is approved after the snapshot import. Vocab (app-native, NO
  wire sync): `LEAVE_TYPES`/`LEAVE_STATUSES`/`COVER_SLOT_STATUSES` + BN/EN + `LEAVE_TYPE_RULES` (the settled
  §3.2 table) + `leave:manage` perm (PRINCIPAL/OFFICE, build); teacher own-row self-apply needs NO permission;
  verifier §C.8 added + OFFICE exact-list updated. New audit kinds STAFF_LEAVE_ENTITLEMENT_SET/SUBMITTED/
  DECIDED + STAFF_COVER_PROPOSED/DECIDED. Firewall test extended both ways (corpus ⇄ hr). **Scope boundary
  (D-#102):** the §3a punch/schedule/grace/working-days attendance model is NOT rebuilt — the live
  symbol-snapshot importer already is HR-2b's internal record + manual transport; punch-level §3a presupposes
  the parked live-device sync (D-#24/H7.6). Gate GREEN (executed): vocab verifier PASS, shared+server tsc
  clean, jest 690/690 (27 new in staffLeave + 2 firewall; firewall green). Server-only (no app screens, the
  Messaging-M-1/M-2 precedent); not verified live.
- Messaging M-3 — rich messaging: reply/forward/reactions/edit/delete (server, D-#77/#101). Wires the
  inert M-1 ChatMessage fields. **forward** (`forwardMessage`): sender must be a member of BOTH source +
  target; sets `forwardOfId`, carries attachment refs forward, honours the target's ANNOUNCEMENT posting
  policy (M-2 gate reused); a deleted source is rejected. **reactions** (new `Reaction` model + `toggleReaction`):
  ONE per user per message — same emoji toggles OFF, a different emoji SWITCHES (no controlled reaction-set
  enum, so vocab stays untouched); allowed in ANNOUNCEMENT groups, rejected on a deleted message;
  batched per page next to receipts (no N+1). **edit** (`editMessage`): own messages only; prior body written
  to the append-only audit (`MESSAGE_EDITED`) FIRST, then `editedAt` stamped; empty/deleted rejected; no time
  limit (Principal's choice). **delete** (`deleteMessage`): own only, hide-not-erase — original body +
  attachment refs retained in the audit (`MESSAGE_DELETED`), the row then masked behind a Bangla
  removed-placeholder for every reader (`listMessages`/`getChatMessage` mask; hard delete never occurs);
  re-delete is idempotent. All four reuse `assertChatMember` + `ChatError` + `writeAudit` (no twins).
  Resolvers `forwardMessage`/`editMessage`/`deleteMessage`/`toggleReaction` (chat:write + membership);
  ChatMessage type gains `deletedAt` + `reactions`. Two new audit kinds in `platform/models/Audit.ts`
  (NOT vocab — a parallel HR session owns shared/vocab.ts this cycle). Firewall test extended (corpus ↛
  `models/Reaction`). Gate GREEN (executed): vocab verifier PASS (untouched), shared+server tsc clean,
  **jest 683/683** (42 suites; 20 new in `chatRich.test.ts`; firewall green), app tsc clean + expo web
  export green. Not verified live. Next = M-4 attachments.
- Messaging M-3 coordinator-review fix — bound the free-form reaction emoji length (D-#101 keeps it
  enum-free, but it was UNbounded: a client could store an arbitrary multi-KB string as a "reaction").
  `Reaction.emoji` now `maxlength: 64` + a service-side guard in `toggleReaction` (rejects > 64 chars
  with a clean Bangla error before any DB write); 64 comfortably fits any single-emoji ZWJ grapheme.
  Other review findings judged not worth changing at this scale: the toggle's read-then-write (2 round-trips)
  and a not-yet-needed `(conversationId,userId)` Reaction index — left as-is; the "edit leaks deleted body"
  and ObjectId/string-cast flags were REFUTED (edit rejects deleted messages; Mongoose casts filters).
  Gate GREEN (executed): vocab verifier PASS, shared+server tsc clean, **jest 684/684** (+1 bound test),
  app tsc + expo web export green. [worktree-messaging-m3]
- Guardian portal app — surface already-existing guardian reads the app didn't render + polish (FRONTEND
  ONLY; no server/vocab/contract change). GuardianHome gains a **child-info card** (section + Quran/Arabic
  group memberships from `myChildren` — fetched by the provider but never shown; D-#48/#56) and a day-load
  **base+top-up breakdown** (fields already in `childDayLoad`). New **ChildClassNotesScreen** (lesson
  history — last 7 days of `childClassNotes`, the date-parameterized read the Home tab only used for today),
  reachable via a "আগের পাঠ দেখুন" link on the Home class-notes card (GuardianHome stack gains the
  `ChildClassNotes` route). Attendance/leave/results stay placeholdered — no guardian server read exists for
  them yet (would be a server change this session must not make). Gate: app tsc clean + expo web export
  green (698 modules); no-drift confirmed — vocab verifier PASS + jest 643/643 untouched.
- Messaging M-2 — auto-provisioned groups + manual groups + posting policy (server, D-#78/#98/#100). Flipped
  `chat:manage` pipeline→build in `PERMISSION_BUILD_STATUS` (D-#98's planned M-2 flip) + updated the vocab
  verifier's exact pipeline-set check to `{chat:oversee}` only (+ a §C.7 build-status assertion). New
  `ChatGroupService`: idempotent source-tagged auto-provision (the D-#49 pattern) of SECTION (class teacher +
  support + routine-slot/teaching-grant teachers), SUBJECT (per ROUTINE_SUBJECTS slot teachers, incl.
  Quran/Arabic via SubjectGroup slots), and SCHOOL (all active non-guardian staff) groups — the reconcile
  writes/removes ONLY `source:"auto"` rows, never a manual one; `resyncAllChatGroups` (chat:manage) + best-effort
  hooks wired into RoutineSlotService (slot create/delete) and ClassTeacherService (class-teacher/support change).
  Manual CUSTOM groups (`createGroupConversation`/`addConversationMember`/`removeConversationMember`/
  `archiveConversation`) + `setPostingPolicy`, all `chat:manage` (teachers cannot create groups). ANNOUNCEMENT
  enforcement wired into `ChatService.sendMessage` (non-managers blocked; OPEN/DIRECT unrestricted). Audit kinds
  CHAT_GROUP_CREATED/CHAT_MEMBERSHIP_CHANGED. Firewall test covers the new file (corpus⇄chat both ways). Gate
  GREEN: vocab verifier PASS, shared+server tsc clean, **jest 663/663** (41 suites; chatGroups 19 new), app tsc
  clean + expo web export green. Not verified live. Next = M-3 (reply/forward/reactions/edit/delete).
- Section merge/split — Principal/Office combine a class's gender sections (Boys+Girls) into one and split
  back, per class, reversibly (D-#62). New `SectionMerge` model (move snapshot) + `SectionMergeService`
  (mergeSections/splitSections/activeSectionMerges + pure `deriveGenderToSource`); merge moves students into
  a combined section (code `ALL`) and deactivates sources, split restores originals exactly and places
  post-merge newcomers by gender. Resolvers gated `roster:manage`; `Section.studentCount`; audit kinds
  SECTIONS_MERGED/SPLIT. App: **SectionConfigScreen** (Admin tab) — year→class list with per-class merge/
  split + student counts. Gate: server tsc + jest 320/320 (7 new) + vocab verifier; app tsc + web export green.
- UI: replace raw-id text inputs with name dropdowns app-wide + header full-name tooltip. New server
  `academicYears` query; `teachers` relaxed to authenticated (picker data; assign actions stay gated).
  Reusable TeacherSelect/RoomSelect/AcademicYearSelect over <Select>; ScopeGrant (covering/absent teacher +
  year→class→section cascade), RoutineEditor (teacher/room), AssignClassTeacher (class-teacher/support +
  name displays), BellSchedule (duty admin), SectionPicker (academic year) no longer paste ids. Header name
  truncates with a web `title` hover tooltip. Gate: server tsc + jest 313/313 + vocab; app tsc + web export. [f287d91]
- UI: show the logged-in user's name in the stack header (HeaderName, left of language/logout). Re-applied
  onto the post-UI-1 theme after the original feat/header-username branch was never merged. [8225d5c]
- Reviewer assignment — teacher-name dropdown replaces pasting a User _id. New server `teachers` query
  (active TEACHER accounts, gated content:assign_review) + a reusable `Select` dropdown primitive (ui.tsx);
  PlanViewScreen + ReviewThreadScreen pick a reviewer by name (phone hint) instead of a raw id. BN/EN labels
  added. Gate: server tsc + jest 313/313 + vocab verifier; app tsc + web export green. [5903010]
- Plan render fix — proper Markdown in the app + grid tables in the PDF; strip the internal footer comment.
  App: new hand-rolled Markdown component (headings, bold/italic/code, ordered & bullet lists incl. GFM task
  items, GFM tables as a grid, blockquotes, hr) — PlanViewScreen rendered raw markdown before. PDF: tables
  now a real bordered grid (weighted columns, measured rows, page-break aware) instead of joined " | " text
  that wrapped and overlapped (the Chapter-Overview collision); doc.x reset after a table; emoji stripped and
  unsupported math/arrow glyphs transliterated (≈→~) since the embedded fonts lack them. Both surfaces now
  strip authored <!-- … --> comments. Gate: server tsc + jest 292/292 (3 new, firewall green); app tsc clean
  + web export green. [7354ddd] (line restored — dropped in the PR #22 append-only merge)
- UI-1: app adopts UI guidelines v1 — deep-green/gold token palette light+dark (OS-followed), Noto Sans
  Bengali app-wide (expo-font, splash-held), 48dp targets, container/on-container badges, web layout capped
  at 720dp; `app/src/theme` is the single token source (`palette.json` shared with `tailwind.config.js`)
  (D-#61).
- docs: UI guidelines v1 — color tokens (light+dark), Bangla typography, layout/touch/accessibility/dark-mode rules (`docs/ui-guidelines.md`, D-#61).
- Credential provisioning — Principal/Office generate phone logins for guardians + teachers and share via
  WhatsApp (D-#59/#60). Server: `User.email` now optional sparse-unique + new sparse-unique `User.phone`;
  `staffLogin` accepts email **or** phone; new `credentials.ts` (`generatePassword` ambiguity-free + Bangla
  `buildCredentialShareLink` wa.me builder, ADR-003) + `ProvisioningService` — guardian login is one shared
  per-family credential keyed by `Student.phone` (auto-links every sibling, idempotent), staff login minted
  from `StaffProfile` with role mapped from HR category (teacher/assistant_hifz→TEACHER, office_accounts→
  OFFICE; support/phoneless rejected, D-#25). Resolvers `guardian/staffCredentialCandidates` + `provision/
  reset` mutations (gated `guardian:link` / `user:manage`, no new permission). New audit kind
  `CREDENTIAL_PROVISIONED`. App: Admin **Guardian logins** + **Teacher/staff logins** screens (generate/reset
  → password shown once + "Send on WhatsApp" + copy); login screen accepts email-or-phone. Gate: server tsc
  + **jest 313/313** (24 new in `provisioning.test.ts`, firewall green), vocab verifier PASS; app tsc clean +
  web bundle green (495 modules). **MIGRATION (live Atlas):** drop the old non-sparse `email_1` index on
  `users` once so the sparse index replaces it (lets phone-only staff have no email). [fc755c6]
- Credential provisioning — ops scripts + live verification. `migrate-user-login-index.ts` (idempotent: drops
  non-sparse `users.email_1`, recreates sparse via syncIndexes) **APPLIED to live Atlas**. `verify-provisioning.ts`
  (read-only candidate report + optional `--provision`/`--staff` end-to-end check). Live: real roster → 60
  guardian families (no phone groups ≥6); 23 staff all provisionable; provisioned 1 guardian + 1 teacher, both
  generated passwords authenticate (`guardianLogin`/`staffLogin` ✓).
- Plan render fix — proper Markdown in the app + grid tables in the PDF; strip the internal footer comment.
  App: new hand-rolled Markdown component (headings, bold/italic/code, ordered & bullet lists incl. GFM task
  items, GFM tables as a grid, blockquotes, hr) — PlanViewScreen rendered raw markdown before. PDF: tables
  now a real bordered grid (weighted columns, measured rows, page-break aware) instead of joined " | " text
  that wrapped and overlapped (the Chapter-Overview collision); doc.x reset after a table; emoji stripped and
  unsupported math/arrow glyphs transliterated (≈→~) since the embedded fonts lack them. Both surfaces now
  strip authored <!-- … --> comments. Gate: server tsc + jest 292/292 (3 new, firewall green); app tsc clean
  + web export green. [7354ddd]
- Class-teacher CT-1 — generalize the coordinator gate + support teacher + assignment history (D-#42/#45/#53).
  assertIsClassTeacher doc generalized to the section daily-coordinator gate (no behavior change). New
  Section.supportTeacherIds (recorded helpers, not the gate) + append-only ClassTeacherAssignment log;
  ClassTeacherService (assign + support add/remove + history append); assignClassTeacher now logs. Resolvers
  setSupportTeacher / mySectionsAsClassTeacher / classTeacherHistory; supportTeacherIds on the Section type.
  App: AssignClassTeacherScreen enhanced — all-sections overview (unassigned flagged + per-teacher load) +
  support add/remove + history. Gate: server tsc + jest 289/289 (6 new, firewall green); app tsc clean +
  web bundle green (491 modules). Covers CT1.1–CT1.6. [2bb1ad6]
- Routine R-5 — triggers + class-note/daily-diary (D-#52/#54); completes the routine module (R-1→R-5).
  New ClassNote (one per slot+date; what-was-taught + optional HW-T1 homeworkItemId link) + BellDutyAssignment
  models; pure trigger.ts buildBellSchedule + RoutineTriggerService (bellSchedule from the grid/window,
  publishClassNote authorized to teacher/cover/admin, classNotesForDate, myClassNotePrompts, assignBellDuty).
  Push delivery + guardian notify ride the deferred pipeline. App: DailyNoteScreen (publish/view per
  group+date), BellScheduleScreen (schedule + assign bell-duty), MyRoutine "notes to publish today" prompt;
  ops + STR keys (BN/EN). Gate: server tsc + jest 283/283 (8 new, firewall green); app tsc clean + web
  bundle green (491 modules). Covers R5.1–R5.3. [2022a6f]
- Routine R-4 — substitution/cover + proxy-manage (D-#22/#46/#49). New RoutineSubstitution model;
  RoutineCoverService (pure rankAvailability + teacherAvailability / assignCover / cancelCover /
  coversForDate); a Section cover is backed by a time-bounded proxy ScopeGrant (assignProxy/revokeProxy),
  a SubjectGroup cover is record-only. routineForDate now overlays covers (coverTeacherId per date).
  Resolvers teacherAvailability/coversForDate + assignCover/cancelCover; coverTeacherId on the slot type.
  App: CoverManageScreen (per-group, managers) — availability view + assign/cancel; cover operations +
  STR keys (BN/EN). R4.5 guardian read deferred (pipeline). Gate: server tsc + jest 275/275 (6 new,
  firewall green); app tsc clean + web bundle green. Covers R4.1–R4.4. [a2b25b6]
- Routine R-3 — app views (Expo). New Routine tab (routine:read) + RoutineStack: RoutineHome (role-aware
  landing), GroupRoutine (weekly grid for a Section/SubjectGroup, shared SlotList), MyRoutine (caller's
  slots, today highlighted), RoutineEditor (admin create/delete slots; server conflict rejection inline +
  authority warnings). Added one server read `myRoutineSlots` (routine:read, caller-scoped). App routine
  operations + routineSubjectLabel/dayOfWeekLabel/periodTrackLabel + STR keys (BN/EN). Gate: server tsc +
  jest 269/269 (firewall green); app tsc clean + web bundle green (488 modules). Covers R3.1–R3.3. [a47db8c]
- Routine R-2 — routine slots + conflict engine + scope binding (D-#46/#49/#56). New `RoutineSlot` model
  (group×day×period→subject/teacher/room, effective-dated; Quran double = two adjacent slots); pure
  `conflicts.ts` (teacher/group/room double-booking with effective-window overlap) + `binding.ts` (grant
  plan); `RoutineSlotService` (create/delete + `routineForDate`). Scope binding: a content-subject Section
  slot auto-syncs a `source:"routine"` teaching ScopeGrant (new `source` field; Quran/Arabic groups bind
  nothing; orphan-only revoke; manual grants untouched); teacher-authority warns, never blocks. Resolvers
  `routineSlots`/`routineForDate` (read), `createRoutineSlot`/`deleteRoutineSlot` (manage). Gate: verifier
  PASS, shared+server tsc clean, jest 269/269 (24 new), firewall green. Covers R2.1–R2.8. [551945e]
- Routine R-1 — calendar/day-types + holidays + rooms + cross-grade Quran/Arabic SubjectGroups +
  membership + per-(audience,season) period grids + schedule windows (D-#46–#58). New `/shared/vocab.ts`
  routine enums + BN/EN labels + `routine:read`/`routine:manage` perms (verifier extended: new C.3 checks
  + OFFICE exact-list). New `server/src/modules/routine/` (6 models, pure `calendar.ts`/`schedule.ts`
  helpers reusing the trackers calendar, GraphQL CRUD + `dayType`/`resolvedDay` computed-clock queries).
  Gate: vocab verifier PASS, shared+server tsc clean, jest 245/245 (22 new), firewall green. App-native —
  no wire-contract/schema change. Covers R1.1–R1.6. [45aab9d]
- Docs — Routine/Timetable + Class-teacher build contracts (D-#45–#57; no feature code yet). New
  `docs/prd-routine.md` (full module: day-type calendar incl. Sat Quran-only + holidays, rooms, general
  Sections + cross-grade gender-split SubjectGroups, audience×track×season period grids with admin
  ScheduleWindows + computed clock times, routine slots + conflict engine, routine→ScopeGrant binding,
  substitution/cover + proxy-manage, routine-driven triggers + class-note via the deferred push pipeline;
  slices R-1..R-5; grids pinned from the live V3 routine, D-#57) and `docs/prd-class-teacher.md`
  (generalize `assertIsClassTeacher` into the section daily-coordinator gate + support-teacher list +
  append-only assignment history, D-#53). DECISIONS D-#45–#57 appended; roadmap + STATUS + AGENTS updated.
  Docs-only — no vocab/schema/code change, no verifier gate at this stage. [22d4f22]
- App i18n — bilingual UI (Bangla + English); Bangla stays the default. Added `*_LABELS_EN` maps to
  `/shared/vocab.ts` mirroring every `*_LABELS_BN`; `app/src/lib/labels.ts` now resolves `STR` (a Proxy)
  and all label fns + `bnNum` by a module-level active language; new `LanguageProvider` persists the choice
  and keys only the nav subtree (auth/basket/section survive a switch); BN/EN toggle in the stack header +
  Login screen; routed 5 hardcoded Bangla strings through `STR`. Vocab verifier extended with EN-totality
  checks. Gates: verifier PASS, shared/server/app tsc clean, jest 223/223, web bundle green (483 modules).
- Homework Tracker — drafted the consult-via-human deviation note to Project 06 re the Quran exclusion
  (`docs/project06-deviation-quran.md`): D-#36 excludes Quran from `HW_SUBJECTS`, which deviates from handoff
  §6.2/§6.3 (Quran-homework rows were meant to live here + count in the 240-min weekday budget). The note
  states the conflict, asks the substantive questions (ceiling math, double-log guard, roster), notes the
  reversibility, and requests confirm-or-amend back through the Principal. Doc only; for the Principal to
  forward.
- Homework Tracker — assign-class-teacher screen (D-#42 UI): new `AssignClassTeacherScreen` in the Admin tab
  (`roster:manage`, Principal/Office) — pick a section, enter a TEACHER user id, assign (or clear) the
  section's class teacher (the daily coordinator who runs reconciliation/confirm, handoff §9). Shows the
  current class teacher. Adds the `assignClassTeacher` app op + exposes `Section.classTeacherId` on
  `CLASSES_QUERY`. Frontend-only, no server/contract change. Gate: app `tsc --noEmit` clean + web bundle
  green (482 modules). This closes the "no UI for class-teacher assignment" gap; the actual live assignment
  is still an operational step on a running deployment.
- Homework Tracker — principal roll-ups screen (frontend for §7.3/§7.4/§8.4): new `HomeworkRollupsScreen` in
  the Homework tab (reachable from HomeworkHome) — resubmission watch-list (≥3 in a rolling 2 weeks),
  per-subject trim-pattern flags for a month (>30% of reconciled days; month picker → first/last-day range),
  and the de-identified question-usage feed. Adds the `homeworkWatchList` / `homeworkTrimPattern` /
  `questionUsageFeed` app operations + STR strings. Frontend-only, no server/contract change. Gate: app
  `tsc --noEmit` clean + web bundle green (`expo export --platform web`). Not verified against a live server.
- Homework Tracker — app screens (frontend for HW-T1→T4): new Expo **Homework tab** (📒, gated `tracker:read`)
  with a native-stack of 4 screens consuming the existing server contract (no server/contract change).
  `HomeworkHomeScreen` — section + date aware daily dashboard: live DAY_TOTAL vs the 240 ceiling, per-subject
  declarations with >40 band warnings, and the summary roll-up (chase list with §7.2 attention/comms badges,
  open resubmissions, on-time % / chase volume / return latency, topic touches). `DeclareHomeworkScreen` —
  subject-teacher declaration form (subject chips, TOP-tags, TIME_DECL, Q_COUNT, Pool ref, revision flag;
  classLevel derived from the selected class). `HomeworkReconcileScreen` — class-teacher trim (Q_COUNT → time
  follows; rank ক/খ/গ auto-chosen) + present/absent roster + confirm-issue (over-ceiling blocks the button;
  server also enforces). `CheckingQueueScreen` — pick an item → SUBMITTED records → record RESULT (WRONG
  auto-spawns; PARTIAL on judgment) with optional Pool top-up (qids + minutes). New homework label helpers +
  STR strings; `HomeworkStackParamList` + `HomeworkTab` nav. Gate: **app `tsc --noEmit` clean + web bundle
  green** (`expo export --platform web`, 480 modules). **Not verified against a live server.**
- Homework Tracker HW-T4 (roll-ups + thresholds + question-usage feed, D-#44): new `HomeworkSummaryService`
  + GraphQL (all `tracker:read`): `homeworkSummary` (chase list + §7.2 attention/comms thresholds at
  CHASE_COUNT≥2/≥3, open resubmissions, submitted-on-time % / chase volume / Given→Returned latency,
  touches-per-TOP-tag), `homeworkWatchList` (§7.3 — students with ≥3 open/recent resubmissions in a rolling
  14-day window), `homeworkTrimPattern` (§7.4 — subjects trimmed on >30% of the month's reconciled days),
  `questionUsageFeed` (§8.4 — **de-identified** per-qid Pool usage counts across `selectedQids` + top-ups; no
  student identity, ADR-005 firewall untouched). Thresholds are the A-01/D-#34 figures; time inputs passed as
  epoch millis for deterministic math. No new vocab, no wire-contract change. Gate green: server tsc clean,
  vocab verifier PASS, **jest 223/223** (5 new in homeworkSummary.test; firewall green). Closes the homework
  build (HW-T1→T4); covers handoff §12 #10.
- Plan review/approval loop PR-3 (app screens, D-#38): new Expo **Review tab** (gated `content:review`
  OR `content:assign_review`). `ReviewHomeScreen` (role-aware inbox + my-reviews, each query paused per
  perm), `ReviewSubmitScreen` (teacher: plan render + verdict chips + feedback → `submitPlanReview`),
  `ReviewThreadScreen` (admin: round history + copy-feedback-to-clipboard + assign-next-round + approve).
  `PlanViewScreen` gains Principal assign + approve actions. New label helpers `reviewVerdictLabel`/
  `reviewRoundStatusLabel` + STR strings; nav `ReviewStackParamList` + `ReviewTab`. Frontend-only, no
  server/contract change. Gate: app `tsc --noEmit` clean + web bundle green (476 modules).
- Homework Tracker HW-T3 (resubmission + Pool top-up, D-#43): new `HomeworkResubmissionService` —
  `checkRecord` records RESULT at SUBMITTED→CHECKED; **WRONG auto-spawns** a resubmission (a NEW record,
  same `HW_ID`, `resubOf` set, fresh GIVEN→…→RETURNED pass; original → RESUBMIT), **PARTIAL** spawns only
  on the teacher's `resubmit` judgment, **CORRECT** advances with no spawn. Four §5 top-up boundaries
  enforced: (1) selected-not-authored — `TOPUP_QIDS` must resolve to existing CURRENT question artifacts in
  the same subject+class (reads the Slice-2 question store; no corpus/identity path); (2) reactive-only — a
  top-up attaches only to a spawned resubmission; (3) time-counted — `TOPUP_TIME` summed in
  `getStudentDayLoad`; (4) inside the resubmission — same `HW_ID`, `TOPUP_FLAG`. GraphQL: `checkHomeworkRecord`
  mutation (subject-teacher write-scope) + `studentDayLoad` query (per-child base+top-up minutes vs 240).
  **Fix:** dropped the HW-T1 unique index on `HomeworkStudentRecord {hwItemId, studentId}` (a resubmission is
  a legitimate 2nd record for the same student+item). No new vocab, no wire-contract change. Gate green:
  server tsc clean, vocab verifier PASS, **jest 218/218** (14 new in homeworkResubmission.test; firewall green).
- Plan review/approval loop PR-2 (D-#38): `approvePlan` — Principal sign-off `reviewed→gold`
  (`content:promote_gold`), closes the thread (supersedes any open round), audits `PLAN_APPROVED`;
  rejects unless the plan is `reviewed`. `planReviewInbox` (Principal/Office — submitted rounds, the
  `feedback` is the Claude-Desktop text) + `planReviewThread` (full round history by any artifact
  version; admins see all, a teacher only threads they reviewed). Re-import linkage: `persistEnvelope`
  supersedes the open round when a revised plan version supersedes the prior (`supersedeOpenRoundsForAddress`,
  shared by reassign/re-import/sign-off). No wire-contract change. Gate: server tsc clean, vocab verifier
  PASS, **jest 205/205** (firewall green).
- Plan review/approval loop PR-1 (D-#38/#39/#40): in-app vetting of imported plans. App-native vocab
  `content:assign_review` perm (Principal/Office), `content:review` extended to TEACHER, `REVIEW_VERDICTS`
  enum + BN labels (+ verifier checks). New `ReviewAssignment` model (address-keyed so the thread spans
  re-imported versions; identity plane, ADR-005). `ReviewService` (assign/submit/cancel + `reviewerMayReadArtifact`);
  resolvers `assignPlanReview`/`submitPlanReview`/`cancelPlanReview`/`myReviewAssignments`; reviewer
  read-scope override in the `artifact` query. APPROVE drives `draft→reviewed`; one open round per address.
  Audit `REVIEW_ASSIGNED`/`SUBMITTED`/`CANCELLED`. No wire-contract change. [0383da3]
- Homework Tracker — class-teacher designation (D-#42, resolves the D-#41 open item): added
  `Section.classTeacherId` (a TEACHER User — the daily coordinator) + `assignClassTeacher(sectionId, userId)`
  mutation (roster:manage, Principal/Office; pass null to clear, assignee must be a TEACHER). New
  `assertIsClassTeacher` guard + pure `isClassTeacher`; `trimHomeworkItem`/`confirmHomeworkDay` now gate on
  class-teacher-only (handoff §9) instead of any write-scoped teacher — Principal/Office assign rather than
  reconcile. SectionRef exposes `classTeacherId`. No new permission, no wire-contract change. Gate green:
  server tsc clean, vocab verifier PASS, **jest 195/195** (7 new in classTeacher.test; firewall green).
- Homework Tracker HW-T2 (daily 240-min reconciliation + trim log + cadence, D-#41): new app-native vocab
  `RECON_STATES` (within_ceiling/over_ceiling/reconciled), `TRIM_RANKS` (a/b/c → ক/খ/গ) + BN labels, and the
  LOCKED figures `HW_DAILY_CEILING_MIN=240`/`FLOOR=120`/`SUBJECT_BAND_MAX=40`/`DEFAULT_TIME_DECL=20` (+ verifier
  checks). New `HomeworkReconciliation` model (Layer C — one per class/day, immutable trim log: trimHw/rank/
  from/to/min). New `HomeworkReconciliationService`: `tallyDay` (live DAY_TOTAL vs 240, band warnings),
  `getTrimCandidates` (pre-ranked ক→খ→গ), `applyTrim` (cut by Q_COUNT → TIME_DECL follows proportionally,
  never extends time; rank guards; logs an immutable row; rejected once reconciled), `confirmHomeworkDay`
  (the gate: blocks if DAY_TOTAL>240, hard-blocks Fri/Sat, else issues every declared item with q>0 +
  finalises reconciled). GraphQL: homeworkDayTally/homeworkTrimCandidates queries + trimHomeworkItem/
  confirmHomeworkDay mutations (tracker:read/write). **Corrected HW-T1 over-strict TIME_DECL>40 reject →
  now allowed (band warns at tally, never blocks; only the 240 day-sum blocks), per handoff §2.1.** RBAC:
  reconcile/confirm uses tracker:write+assertCanWrite (interim); class-teacher-only narrowing deferred + routed
  to Principal (D-#41). Gate green: vocab verifier PASS, shared+server tsc clean, **jest 170/170** (16 new
  HW-T2 tests; firewall J5.6 green). Not yet committed.
- Homework Tracker HW-T1 (model + 6-stage lifecycle, D-#36/#37): app-native vocab `HW_SUBJECTS`
  (content `SUBJECTS` superset + Arabic/Islam, NOT Quran — D-#36, Quran→Quran Tracker), `LIFECYCLE_STATES` (8 atomic states for the
  §3 6 stages, D-#37), `HW_RESULTS` (সঠিক/আংশিক/ভুল) + BN labels + verifier checks. New shared lifecycle
  engine (`trackers/lifecycle.ts` — legal transition graph + guards + stage map, built once, shared with the
  future Assignment tracker) and school-day calendar (`trackers/calendar.ts` — Sun–Thu). Models: `HomeworkItem`
  (Layer A, one common sheet/class+subject+day), `HomeworkStudentRecord` (Layer B, identity-bearing lifecycle
  carrier — operational plane, ADR-005), `HomeworkSequence` (atomic year-continuous HW_ID counter).
  `HomeworkService`: HW_ID gen (HW-C{class}-{SUBJECT}-{nnnn}), declareHomeworkItem (validates §2.1 — ≥1 TOP
  tag, 0–40 TIME_DECL band, C1–5, school-night, POOL_REF), issueHomeworkItem (present→GIVEN/absent→
  ABSENT_REDELIVER), transitionRecord (one timestamped legal move, CHASE_COUNT++, →CHECKED requires RESULT,
  re-delivery shifts due date). GraphQL: declare/issue/transition mutations + homeworkItems/homeworkStudentRecords
  queries (tracker:read/write, assertCanRead/Write). Rides the existing `homework` tracker-kind — no new
  tracker-kind, no envelope/harness sync. Gate green: vocab verifier PASS, shared+server tsc clean,
  **jest 154/154** (27 new HW-T1 tests; firewall J5.6 still green). Not yet committed.
- Homework Tracker (Project-06 handoff adopted by ADR, D-#33–#35): stored the LOCKED source verbatim
  (`docs/tracker-homework-handoff.md`, PRD v1.1 incl. Amendment A-01) and authored the repo build
  contract (`docs/prd-tracker-homework.md`) — gap table vs the bare Slice-3 generic tracker, per-role
  journeys with the handoff §12 checklist as acceptance criteria, and a slice-by-slice build order
  (HW-T1 model+6-stage lifecycle → HW-T2 budget reconciliation+trim log+cadence → HW-T3 resubmission+Pool
  top-up → HW-T4 roll-ups+thresholds+question-usage feed, + cross-cut RBAC/plane/firewall). Settled the
  handoff §11 open items per A-01 (HW_ID numbering, 3-value RESULT, thresholds). Rides the existing
  `homework` tracker-kind — no new tracker-kind, no envelope-schema/harness sync. **Plan/docs only — no
  feature code yet.** Appended D-#33–#35; updated STATUS + AGENTS repo map.
- Set-assembly class guard (J3): the basket carries each question's `classLevel`, and BasketScreen now
  blocks "create set" + shows a danger Notice when the basket's question class differs from the selected
  section's class (the Question-bank class filter and the set's section are decoupled, so a Class-5 basket
  could silently land on a Class-3 section). Offers a "change section" shortcut to the Section picker.
- Question-bank import (fan-out, D-#32): a Project-04 bank JSON (a `{stimuli,questions}` collection) now imports by
  fanning out into N single-doc envelopes (one per stimulus + one per question) via new
  `server/import/build_question_envelopes.py` (the question analog of `build_envelope.py`), each run through the
  unchanged gate. subject/class_level/unit parsed from the qid/stimulus_id (mixed bank refused); `tags` copied from the
  payload; `review_status=draft` + a synthesized `address` injected; `curation_tag` supplied by the importer; the
  companion `.md`/register `.tsv` are not imported (questions are app-rendered). Supersede-not-overwrite keys on the
  item IDENTITY — **qid (questions) / stimulus_id (stimuli)**, not the shared unit address — so all 100 items coexist
  as `current` rather than collapsing onto the last one. Import is **atomic** — validate all,
  persist only if all pass, else store nothing and return the failing refs (`importQuestionBank` in `ContentService`;
  `persistEnvelope` extracted from `importEnvelope`). `importFiles` mutation gains `curationTag`/`unitTitle` args and the
  `ImportResult` gains `itemsTotal/Passed/Failed`; the app Import screen detects a bank and shows a curation picker +
  "Imported X/Y". The **register is not stored** — the live `questions()` filter + Question-bank screen are the register
  (never stale). No contract change. Executed proof: builder fanned the real C5_ENG_U09 bank into 114 envelopes,
  **114/114 PASS** through `validate_import.py`; server 127/127 (3 new bank tests), shared+server+app tsc clean,
  vocab verifier green.
- HR-1 staff records (first HR slice — prd-hr H1): added `StaffProfile` model (foundation/identity plane;
  identity+bio+employment fields; sensitive NID/bankAccount/biometricId rows). New app-native vocab
  `HR_CATEGORY`/`EMPLOYMENT_TYPE`/`EMPLOYMENT_STATUS` (+ `*_LABELS_BN`, no wire-contract twin) and a
  `staff:manage` permission granted to PRINCIPAL+OFFICE (updated the vocab verifier's OFFICE-set + HR label
  checks). Added the `staff` GraphQL query gated on `staff:manage` (default-deny to TEACHER — H1.4 row-scope)
  + `StaffRef`. Import pipeline `extract-staff.py` (both source .xlsx → gitignored staff.json) +
  `import-staff.ts` (idempotent upsert by schoolId; vocab-validates; no clears; dry-run default). Frontend:
  read-only `StaffListScreen` under the Admin tab (gated `staff:manage`) with a category filter; `STAFF_QUERY`
  + Bangla labels. Data-only (no `User` logins this slice — login optional/separate, H1.2). Identity plane only —
  no new corpus→identity path; firewall test green (124/124, shared+server+app tsc clean, vocab verifier green).
  **Loaded to Atlas + verified live:** 23 staff (21 teacher / 2 office_accounts), all with phone + biometricId.
- Roster import (real students): added a roster class-level axis (`ROSTER_CLASS_LEVELS` −1..5 = Nursery/KG/One..Five
  + `ROSTER_CLASS_LABELS_BN`) separate from the LOCKED content `class_level` (1..5, unchanged — verifier stays green);
  relaxed `Class.level` bounds to the roster range. Extended `Student` with optional operational fields
  (nameBn/gender/dob/phone/address/bloodGroup); made `Guardian.passwordHash` optional + added `loginEnabled`
  (default false) for contact-only guardians (guardianLogin now rejects login-disabled). Added the import pipeline
  `server/scripts/extract-students.py` (xlsx→gitignored students.json) + `import-students.ts` (idempotent upsert by
  schoolId; no clears; dry-run default, --commit to write); gitignored the source .xlsx + students.json (live PII,
  ADR-005). Decisions D-#30/#31. Identity-plane only — no new corpus→identity path; firewall test green (124/124,
  typecheck + vocab verifier green). **Loaded to Atlas + verified live:** 91 students / 7 classes / 10 sections /
  129 contact-only guardians / 194 links; seed leftovers cleared first via `clear-seed.ts` (6 fake students +
  `@scd.test` users + grants + 3 empty seed sections). [e4962a3]
- Roster view (frontend): read-only `RosterScreen` under the Admin tab (gated `roster:manage`). `StudentRef`
  exposes nameBn/gender/dob/phone/address/bloodGroup + a `guardians` field (GuardianLink→Guardian); app
  `ROSTER_QUERY` + screen render per section (reuses SectionPicker); Bangla gender/relation/DOB labels +
  roster-aware `classLevelLabel` (Nursery/KG). app tsc + server tsc clean, 124/124 tests, vocab verifier green.
- HR module: design handoff landed (`docs/hr-design.md`) + per-journey PRD (`docs/prd-hr.md`) — staff
  lifecycle pulled forward from roadmap "Deferred ops modules" into the active build (records → attendance
  & leave → payroll → performance/conduct/development → offboarding). Appended decisions D-#22–D-#29;
  updated STATUS (now/next + recent decisions) and roadmap. Design only — no code/contract change yet;
  operational/identity plane, no new corpus→identity path (ADR-005 firewall unaffected).
- Slice 4: connected frontend (Expo app) — all teacher/principal/office screens per PRD §8 (16 screens, role-gated bottom tabs over native-stacks): Login (J5.1); Content tree + Plan view + PDF (J1.5/J1.7/J1.8); Question bank multi-filter + Preview + Basket→createSet/addQuestionToSet (J2.2/J2.3/J3.1); Set list/detail + Assemble HW/AS/CT + PDF (J3.2/J3.3/J3.4); Tracker list/open/entry (CT score / AS submitted / HW complete) + Summary + wa.me copy-link (J4.1–J4.5, ADR-003); Admin import + user-create + proxy-grant assign/extend/revoke (J1.1/J5.1/J5.4/J5.7). urql + hand-typed TypedDocumentNodes (codegen deferred); JWT in SecureStore/localStorage; Bangla labels from shared/vocab (NFR-5), English codes on forms; write-scope ForbiddenError→Bangla message. tsc --noEmit clean; web bundle compiles green (expo export, 471 modules). NativeWind v4 present but transform disabled (Windows/Metro perf — re-enable steps inline). [45fe2eb 9210cd1 3e31a17]
- Slice 3: trackers (J4 end-to-end) — TrackerRecord model (open/closed, entries per student de-identified via sha256, CT score/AS submitted/HW complete fields); openTracker/recordEntry/closeTracker mutations (write-scope via assertCanWrite, J4.5); tracker/trackers/trackerSummary queries; waLink query (pure wa.me deep-link builder, J4.2, ADR-003); tracker_recorded CorpusEvent (de-identified, ADR-005); J4.1–J4.5 tests; 124/124 pass, tsc clean, vocab verifier green. [ca85ddc 4f5e828 c67454b]
- Slice 2: question bank + assembly (J2+J3 end-to-end) — AssessmentSet model (draft→assembled, basket items, CT/HW/AS metadata); questions/question/stimuli queries (tag-filter over ContentArtifact, subject/classLevel/topicTag/questionType/bloomLevel/difficulty/paperRole/marks filters); createSet/addQuestionToSet/assembleSet mutations (write-scope via assertCanWrite, J3.5); PDF route GET /pdf/set/:id (structured pdfkit renderer, NotoSansBengali); J2.1–J2.4 + J3.1–J3.2 + J3.5 tests; 92/92 pass, tsc clean, vocab verifier green. [e1db6d7]
- Slice 1: content import + view + PDF (J1 end-to-end) — CorpusEvent/ImportBatch/ContentArtifact models, ContentService (Python harness via child_process, version-flip), importEnvelope mutation + contentTree/contentArtifacts/artifact queries, PDF route GET /pdf/artifact/:id (pdfkit + NotoSansBengali), Bangla PDF smoke + J1.1–J1.4/J1.9/J1.5/J1.6 tests; 62/62 pass, tsc clean, vocab verifier green. [233e950]
- Slice 0: monorepo scaffold — npm workspaces (/shared /server /app), root tsconfig, .env.example. [3c8e8ca]
- Slice 0: server — Express+Yoga+Pothos, foundation models (User/Guardian/Student/GuardianLink/Class/Section/Subject/ScopeGrant), auth, scope-grant model+service+authz middleware, fail-closed firewall test GREEN (31/31 pass). [7fefc27]
- Slice 0: app — Expo skeleton boots on web, urql client wired. [0044840]
- Slice 0 docs: D-#21 (proxy-expiry audit at request time), STATUS/CHANGELOG/AGENTS updated. [4cb2187]
- PRD/Access: proxy grants are duration-bounded in days, set by the assigner; auto-expiry + audit (D-#20). [87bad65]
- Contract: adopt Project-04 LOCKED question/stimulus data-contract (D-#19) — envelope v1.0 (additive), vocab v1.0 (+PaperRole, +stimulus), harness v1.0 (L1→L4); verifier extended to check paper_role; 11 fixture instances + negative L3/L4 checks green. [c954ffd]
- Import gate: vendored Project-03 plan schema (server/import/LOCKED_C5_PlanSchema_v1.json); example now passes full L1→L2→L3. [eb877c8]
- PRD: drafted first-priority slice (per-role journeys + acceptance criteria) in docs/prd.md. [d7dc561]
- Access model: TEACHER scope overlays — supervisory read + proxy write (D-#17/#18, ADR-017). [4cefaff]
- Bootstrap: migrated docs/code to /docs, /shared, /server, /skills layout (Option A). [19618c5]
- Added cross-tool KB: AGENTS.md, CLAUDE.md, /shared/AGENTS.md, STATUS, CHANGELOG, DECISIONS. [4f15702]
- Added skills: feature-lifecycle, contract-sync, verify-before-commit. [9715c45]
- RBAC: granted content:import to Office in addition to Principal (D-#11). [19618c5]
- PRD: drafted Attendance build contract (docs/prd-attendance.md) — teacher Excel ingest + in-app student capture, marker assignment (CT-2), external-scheduler reminder/escalation, recorded-only student leave (D-#63–#67). [pending-commit]
- 2026-06-12 — docs: Guardian Portal v1 build contract (docs/prd-guardian-portal.md); D-#68/#69/#70 appended (incl. Google Drive live-store ruling); R4.5 closed as won't-show; next build = GP-1 (server), then GP-A, GP-2 after UI-1. (handoff proposed D-#62/#63/#64 — renumbered, those are taken by Section merge + Attendance). [pending-commit]
- 2026-06-12 — docs: notifications phase-1 build contract (prd-notifications.md, D-#72–#75) — inbox + emit seam + first scheduler (Principal's 12:00 sweep + escalation ladder) + Expo push; WA/SMS stay deferred; roadmap patched. (handoff proposed D-#59–#62 — renumbered, taken by credential provisioning / UI / section merge; D-#71 held by guardian-portal build). [pending-commit]
- 2026-06-12 — Planned: Messaging module (staff-only chat + guardian notices via wa.me + push transport) — docs/prd-messaging.md authored; D-#76–#79 recorded. Docs-only, no feature code. (handoff proposed D-#59–#62 — renumbered, taken through D-#75). [pending-commit]
- 2026-06-12 — feat: Attendance AT-1..AT-3 + AT-5 server (teacher Excel snapshot import w/ name reconciliation; once-daily absent-only student capture behind the CT-2 marker gate; recorded-only leave applications; absentee/unmarked/no-application/staff-summary reports; perms attendance:mark/manage; Student.rollNumber; exceljs). Verifier + tsc + jest 363/363 green; parser verified on the real export. [feat/attendance]
- 2026-06-12 — feat: Attendance app screens — new 🙋 tab: marking worklist + absent-only capture, teacher-Excel upload (preview→map/ignore→commit), absentee/unmarked/no-application/staff-summary report surface, marker assign/revoke. App tsc + web export green. [feat/attendance]
- 2026-06-12 — feat: Guardian portal GP-1 server read layer (D-#68/#69) — guardian:read_child flipped pipeline→build (verifier updated, green); assertGuardianOfStudent link-scoped gate (+ GuardianLink.active); myChildren/childRoutine/childClassNotes/childHomework/childDayLoad with the NARROW guardian slot type (no teacher/room/cover; substitution-free slotsForDate); guardianPortal.test.ts + guardian-firewall assertions; jest 346/346. [abe7ed3]
- 2026-06-12 — feat: Guardian portal GP-A homework attachments on the Drive live store (D-#70/#71) — StoredFile + DriveStore (OAuth refresh token, D-#71); POST /files/hw + GET /files/:id (server-in-the-middle, driveFileId never client-visible, Bangla mime/size/Drive-fail errors); attachHomeworkQuestionFile/attachHomeworkAnswerFile (tracker:write, audit HW_FILE_ATTACHED); HomeworkItem.questionFileId + HomeworkStudentRecord.answerFileId; teacher attach hooks in DeclareHomework/CheckingQueue; ops note server/README.md; homeworkFiles.test.ts (Drive mocked); jest 371/371. [4556696]
- 2026-06-12 — feat: Guardian portal GP-2 guardian app screens (D-#68/#69) — guardian-only tab set (আজ/বাড়ির কাজ/রুটিন) + child switcher (J5.3); GuardianHome (day-type routine, class notes, open homework, day-load vs 240, inert শীঘ্রই-আসছে placeholders); ChildHomework (full lifecycle + প্রশ্নপত্র/উত্তরপত্র viewers); ChildRoutine weekly grid; guardianLogin fallback in app login + guardian-aware `me`; app tsc + web bundle green. [56624d9]
- 2026-06-12 — merge: integrated Attendance (PR #30, D-#63–#67) + Guardian Portal (PR #31, D-#68–#71) into main. Resolved cross-feature conflicts so BOTH survive: shared/vocab.ts (attendance:mark/manage + guardian:read_child pipeline→build) auto-merged, verifier green; Audit.ts kinds + index.ts resolver imports + navigation/types.ts + ledgers unioned; package-lock reconciled (exceljs/multer). Integrated gate GREEN: vocab verifier PASS, shared+server tsc clean, jest 414/414 (25 suites, firewall green), app tsc + expo web export green. [e3c8493]
- 2026-06-12 — verify(live): Guardian Portal golden path against Atlas — guardianLogin (role GUARDIAN), myChildren=2 (Fardhousi family), childRoutine day-type aware, D-#69 confirmed structurally (schema rejects GuardianSlot.teacherId), childDayLoad 0/240, unlinked studentId → Bangla ForbiddenError. Frontend tab/switcher pass + GP-A Drive file test still pending (Drive credential not configured).
- 2026-06-12 — feat: Attendance AT-4 reminder + escalation engine (D-#65) — completes attendance AT-1..AT-5. New PushDevice + AttendanceReminderDispatch (idempotency ledger) models; platform ExpoPush transport (plain-fetch, best-effort, dead-token pruning); AttendanceReminderService (FULL-day gate via resolveDayType, reuses unmarkedSections, tier routing T1210→marker+class-teacher / T1245→Office / T1400→Principal, idempotent per date×tier×section, audited ATTENDANCE_REMINDER_SENT). POST /triggers/attendance-reminder (Express, shared-secret x-trigger-secret, fail-closed) driven by external cron (12:10/12:45/14:00 Asia/Dhaka — README ops note). registerPushDevice/unregisterPushDevice mutations (own-row); app Expo-token registration on auth (web/sim safe); AT4.7 Office manual wa.me guardian-chase button (guardianChaseLink, attendance:manage; teachers never chase, O3). No vocab/contract change. Gate: vocab verifier PASS, shared+server tsc clean, jest 423/423 (9 new, firewall green); app tsc + web export green. [feat/attendance-at4]
- 2026-06-12 — feat: roll number = ID (D-#80, resolves attendance O1; reverses D-#67 roll≠ID). Roster has no separate roll (xlsx carries only the ID + a global serial), so no roll-import script; absentee reports now surface rollNumber ?? schoolId so the Roll column shows the ID. Student.rollNumber kept (unset, forward-safe). Server tsc + jest green. [feat/roll-equals-id]
- 2026-06-12 — chore: parallel-session infrastructure for multi-feature work in concurrent Claude Code worktrees. New `.worktreeinclude` (copies `.env` into fresh worktrees); AGENTS.md "Parallel sessions (worktrees)" section (fresh-worktree setup, one-feature-per-session, shared-Atlas/no-seed rule, port + contract-file serialization, append-only merge guidance); harness-enforced SessionStart/CwdChanged hook in `.claude/settings.json` (auto `npm install` + shared build when a session lands in `.claude/worktrees/*`, idempotent); `.gitignore` now tracks `.claude/settings.json` only (local settings + worktrees stay ignored). Docs/config only — no code change.
- 2026-06-12 — docs: Library module build contract docs/prd-library.md (slices LB-1..LB-5, D-#81–#84 — handoff proposed D-#80–#83, renumbered: D-#80 taken by roll-number=ID); roadmap patched — library pulled forward, asset register stays deferred.
- 2026-06-12 — docs: Assignment Tracker build contract (docs/prd-tracker-assignment.md, D-#85–#89 — handoff proposed D-#59–#63, renumbered: taken through D-#84) — per-student weekly AS channel replacing the Google Sheet tracker; docs only.
- 2026-06-12 — docs: deployment plan + dev pipeline contract (docs/deployment.md, DEP-1..6, D-#90–#93 — handoff proposed D-#59–#62, renumbered: taken through D-#89) — plan only, nothing executed.
- 2026-06-12 — feat: Notifications N-1 (D-#72) — `Notification` model (per-recipient, exactly one of User/Guardian, unique `dedupeKey`, append+markRead only, identity-plane) + the single `NotificationService.emit()` seam (idempotent by dedupeKey incl. the unique-index race; channel registry fans out behind it — inbox row always, channels best-effort and never block the row; push registers in N-4) + own-row inbox API (myNotifications/myUnreadNotificationCount/markNotificationRead/markAllNotificationsRead, NO new permissions) + four event emitters wired best-effort into existing mutations (class-note publish → login-enabled guardians [R5.4 partial; contact-only guardians excluded, D-#31/D-#72 recorded limitation]; HW chase≥3 → class teacher [§7.2, deduped per student+item]; review assigned → reviewer; cover assigned → covering teacher, cancel emits nothing). New app-native NOTIFICATION_KINDS (8 kinds + BN/EN labels; verifier §C.5 added — no wire-contract sync, vocab additive only). Firewall test extended both ways (corpus ⇄ notifications). Gate: vocab verifier PASS, shared+server tsc clean, jest 452/452 (29 new; firewall green). [worktree-notifications-n1]
- 2026-06-12 — feat: Slice-4 follow-up server reads — `myScopes` now returns classId/sectionId/subjectId (+ proxy detail: coveringTeacherId/absentTeacherId/startDate/durationDays/proxyStatus) via a pure `grantView` mapper; new `proxyGrants` (admin grant list, newest-first, activeOnly default) and `users` (full staff-account list) queries, both gated by the EXISTING `user:manage` (Principal — same as createUser/assignProxy; no vocab/permission/contract change). adminLookups.test.ts (7 new); jest 430/430 (firewall green), shared+server tsc clean. [worktree-slice4-followups]
- 2026-06-12 — feat: Slice-4 follow-up app wiring — SectionPicker surfaces the teacher's own granted sections ("আমার শাখা" one-tap shortcuts from enriched myScopes) above the year→class→section cascade; UserList renders the real `users` list (user:manage) instead of "current user only"; ScopeGrant screen lists active proxy grants with per-row extend/revoke (teacher names resolved via `teachers`) — no more pasted GRANT_IDs. App tsc --noEmit clean + expo web export green. NOTE: the third STATUS follow-up (/pdf CORS) was already closed by GP-A [4556696] — corsForRest in server/src/index.ts covers /pdf (incl. /pdf/set) + /files; no change needed. [worktree-slice4-followups]
- 2026-06-13 — feat: Assignment Tracker AS-T1..AS-T5 (D-#85–#89 + D-#94) — the weekly AS-… channel replacing the Google Sheet tracker, server+app. Server: AssignmentSchedule (term anchor + Thu/Sun cadence + 4-week rotation) / AssignmentItem (§4 server-rolled deliveryDate/dueDate, unique per week×section×subject) / AssignmentStudentRecord (shared D-#37 lifecycle engine — second consumer; marks ≤ totalMarks + feedback, D-#87) / AssignmentFollowUp (append-only ladder, outcome-stamp only) / AssignmentSequence (AS-C{class}-{SUBJ}-{nnnn}, D-#34); pure cadence calendar (previous-open delivery roll / next-open due roll / vacation-week suspension, single D-#50 source); deliver/redeliver/collect/chase-sweep with all counts DERIVED; teacher-explicit resubmission (no auto-spawn); Office chase list + escalation ladder (in-app ×2 via the D-#72 emit() seam, KIND-GATED until ASSIGNMENT_CHASE lands in vocab → WhatsApp wa.me manual path with §7 generated Bangla message); assignmentSummary (delivery/submission rates excl. suspended weeks, D-#34 thresholds, latency) + childAssignments guardian read. RBAC per D-#94 (existing perms only — vocab untouched). App: 📋 Assignment tab (7 screens: Home/Schedule/Deliver/Collect/Checking/Chase/Rollups) + guardian অ্যাসাইনমেন্ট tab (ChildAssignments). Firewall test extended (corpus ↛ assignment models). Gate: vocab verifier PASS, shared+server tsc clean, jest 514/514 (55 new), app tsc + web export green. [worktree-assignment-tracker]
- 2026-06-13 — feat: Library module LB-1..LB-5 (D-#81–#84; build rulings D-#96/#97) — full catalog + circulation + reservations + overdue chasing, server+app. **Vocab (app-native, no wire sync):** `library:read`/`library:manage` perms (P/T/O read; P/O manage) + BORROWER_TYPES/COPY_STATUSES/LOAN_STATUSES/RESERVATION_STATUSES/BOOK_LANGUAGES (+BN/EN labels) + NOTIFICATION_KINDS += LIBRARY_DUE_SOON/LIBRARY_OVERDUE; verifier §C.6 added, §C.5 kinds list updated, OFFICE exact-list updated. **Server (`modules/library/`):** models BookTitle/BookCopy (unique accessionNo)/LibraryPolicy/LibrarianAssignment (append-only duty log)/BookLoan (exactly-one-of borrower, NO money fields, D-#27)/BookReservation (title-level FIFO); `assertIsLibrarian` desk gate (library:manage OR latest duty row = assign — D-#42/#64 pattern, no new role); catalog/policy/circulation/reservation services — issue (ON_HOLD only to its READY borrower) / return (queue → hold w/ holdDays window) / renew (blocked at maxRenewals or any QUEUED/READY reservation) / markLost (replacement note only); LAZY request-time hold expiry as the ONE truth (`expireLapsedHolds`, D-#21/#83); policy = admin data w/ read-time PRD defaults (D-#97, no seed write); chase list w/ ADR-003 wa.me Bangla links (staff chased in-app); LIBRARY_DUE_SOON/LIBRARY_OVERDUE emitters over the D-#72 emit() seam, school-day rung ladder, dispatched via POST /triggers/library-reminder (D-#96); guardian rider `childLibraryLoans` (assertGuardianOfStudent, narrow read-only type); 8 audit kinds; firewall test extended both ways (corpus ⇄ library). **App:** new 📖 Library tab (`library:read`) — LibraryHome (browse/search + my loans/reservations + librarian chase list + gated desk/manage entries), TitleDetail (copies + self-reserve + queue), LibraryDesk (borrower search picker + issue-by-accession + return/renew/lost + desk reservations), CatalogManage, LibraryAdmin (policy editor + librarian assign/revoke + history); GuardianHome gains the read-only child library-loans card (J-L9). **Gate GREEN (executed):** vocab verifier PASS, shared+server tsc clean, jest 532/532 (73 new across library/libraryCirculation/libraryReservation/libraryChase + firewall; 32 suites), app tsc clean + expo web export green. Not verified live. [worktree-library]
- 2026-06-13 — merge: integrated Assignment Tracker (PR #39, D-#85–#89 + D-#94) + Library (PR #40, D-#81–#84 + D-#96/#97) into main. Cross-feature conflicts resolved so BOTH survive: ledgers unioned (no decision-ID collision thanks to the D-#96/#97 renumbering); firewall.test.ts + app operations.ts both-sides kept; AppTabs/labels/types/index.ts/Audit/triggers/vocab auto-merged. Integrated gate GREEN (executed on the identical tree pre-merge AND re-run on merged main): vocab verifier PASS, shared+server tsc clean, jest 587/587 (37 suites, all four firewall suites green), app tsc + expo web export green. Both features remain not-verified-live (rides DEP-3). [887468c]
- 2026-06-13 — chore: committed permission allowlist in `.claude/settings.json` — gate/git/npm/jest/tsc/expo/gh-pr commands pre-approved for every session (incl. parallel worktree sessions, which block on unattended prompts); explicit DENY on `npx tsx server/scripts/seed.ts` (live-Atlas guard, structural backstop for the AGENTS.md rule). Config only — no code change.
- 2026-06-13 — feat: Messaging M-1 (D-#76/#77) — core staff chat models + 1:1 + read receipts, server-side. **Vocab (app-native, no wire sync):** `chat:read`/`chat:write` (PRINCIPAL/TEACHER/OFFICE; build) + `chat:manage` (P/O; pipeline → M-2) + `chat:oversee` (PRINCIPAL only; pipeline → M-6) + CONVERSATION_KINDS/POSTING_POLICIES/ATTACHMENT_KINDS/NOTICE_SCOPES (+BN/EN labels); verifier §C.7 added, OFFICE exact-list + pipeline-set checks updated. **Server (`modules/chat/`):** models Conversation (kind/refId/postingPolicy/active + sparse-unique `directKey` = sorted pair key — ONE DIRECT thread per pair, race-safe like dedupeKey) / ConversationMember (source `auto|manual` per the D-#49 pattern, unique per user×conversation) / ChatMessage (body + forward-compatible replyToId/forwardOfId/attachmentIds/editedAt/deletedAt fields — mutations land M-3/M-4) / MessageReceipt (one per reader×message, first-seen wins via $setOnInsert); ChatService — openDirectConversation (idempotent; staff-only counterpart, guardians rejected per D-#76; self-DM rejected), sendMessage (member-gated, same-conversation replyTo validated, lastMessageAt stamped), listMessages (newest-first, _id-cursor pagination, limit clamped), myConversations, markConversationSeen (sweeps only others' messages); every read/write through `assertChatMember` (Bangla deny, no existence leak). Resolvers myConversations/conversation/messages (chat:read) + openDirectConversation/sendMessage/markSeen (chat:write); per-message seenBy list + seenCount. Firewall test extended both ways (corpus ⇄ chat). **Gate GREEN (executed):** vocab verifier PASS (§C.7 15 new checks), shared build + shared/server tsc clean, jest 610/610 (21 chat + 2 firewall new; 38 suites), app tsc clean + expo web export green (693 modules). Not verified live. [worktree-messaging-m1]
- 2026-06-13 — perf: Messaging M-1 coordinator-review fixes (4 confirmed efficiency findings, no contract/behavior change). (1) `messages` resolver pre-batches receipts for the whole page via new `receiptsForMessages` ($in) so `seenBy`/`seenCount` no longer fire one (or two) queries per message — a 50-message thread open drops from ~100 round-trips to 1. (2) `myConversations` resolver pre-batches members + names via new `membersForConversations` (two $in queries total) so the per-conversation `members` field is no longer an N+1. (3) `markConversationSeen` now bounds its sweep to messages newer than the caller's latest receipt (`messageId` $gt) — a re-open re-scans/re-upserts nothing already seen instead of rescanning the full conversation every time. (4) `assertChatMember` runs its conversation + membership reads in one `Promise.all` instead of sequentially (saves a round-trip on every chat op). Field resolvers fall back to single-row fetch when a list resolver didn't pre-attach, so `conversation`/`sendMessage` paths are unchanged. Refuted in review (not changed): a claimed bulkWrite string-vs-ObjectId cast bug — Mongoose 8.24 casts bulkWrite filters. **Gate GREEN (executed in worktree):** vocab verifier PASS, shared+server tsc clean, jest 611/611 (+1 new bound test; 38 suites, firewall green), app tsc clean + expo web export green. [worktree-messaging-m1]
- 2026-06-13 — feat: Notifications N-2+N-3+N-4 (D-#73/#74/#75; build reconciliations D-#99) — the notifications module is COMPLETE server+app. **N-2 (scheduler):** the app's first internal scheduler — a 60s in-process ticker (`SchedulerService`, started with the server; single-instance, D-#73) — school-day aware via `resolveDayType` (OFF/HOLIDAY silent; Saturday = quran-track bell only), stale-skip 30 min, restart-safe by dedupeKey. Fires: BELL_REMINDER ~5 min before each period end per active grid → bell-duty admin; CLASS_NOTE_PROMPT ladder 12/13/14 (one combined row per teacher, recomputed per rung via new `unwrittenClassNoteSlots`) + CLASS_NOTE_ESCALATION 15:00→Office / 16:00→Principal (combined teacher+group+period list); attendance tiers by CALLING AT-4's `dispatchAttendanceReminders` (12:10/12:45/14:00 — conditional engine supersedes the PRD's interim 12:00 sweep) and the library sweep by CALLING `dispatchLibraryReminders` (D-#96) hourly — ONE dispatch truth; `/triggers/*` endpoints remain as redundant ops path. AT-4 delivery moved onto the emit() seam (ATTENDANCE_REMINDER inbox rows; push via the channel — no double transport, D-#99). **N-3 (app):** 🔔 + unread badge in every stack header (staff AND guardian; shared 60s poll of myUnreadNotificationCount) opening a root-level NotificationCenter modal — newest-first/unread-first, Bangla title/body + kind chips, markRead-on-tap + per-kind deep links (lib/notificationNav), mark-all-read. **N-4 (push):** Expo push channel registered behind emit() at server start, riding AT-4's `PushDevice` + platform `sendExpoPush` (D-#75 DeviceToken reconciled onto PushDevice: optional guardian owner, exactly-one invariant, role-derived registration; dead tokens pruned); app: foreground display handler, logout unregisters the device token, push-tap opens the NotificationCenter. NotificationRefs extended (audienceKey/periodNumber/tier/hour; loanId/rung now exposed in GraphQL). NO vocab/contract change (scheduler kinds existed since N-1; verifier untouched-PASS). Gate GREEN (executed): shared build + shared/server tsc clean, vocab verifier PASS, jest 616/616 (39 suites; 29 new across notificationsScheduler/pushChannel + attendanceReminder reworked; firewall green), app tsc clean + expo web export green. Not verified live (rides DEP-3). [worktree-notifications-n2-n4]
- 2026-06-13 — fix: Notifications N-2/N-4 coordinator-review fixes (1 confirmed security gap + 1 ops hardening). **SECURITY:** `unregisterPushDevice` was owner-unscoped — the resolver ignored the auth context and the service ran `PushDevice.updateMany({expoPushToken}, {active:false})` with no owner filter, so any authenticated user could deactivate another user's/guardian's push device by token (cross-user push silencing; register already scoped by owner — the asymmetry was the gap). Now the resolver derives the owner from `ctx.auth` (same GUARDIAN/staff split as register) and the service scopes the deactivation `{expoPushToken, ...ownerFilter}` (zero/two owners rejected). Server-side dead-token pruning is unaffected (it takes the channel's own unscoped path on Expo "DeviceNotRegistered"). **OPS:** `startNotificationTicker` now logs a loud startup WARNING if the host timezone isn't Asia/Dhaka — the tick reads server-local wall-clock, so a UTC VM would fire bell/attendance/class-note triggers ~6h off silently; the warning makes a misconfigured host obvious in logs. 3 new owner-scope tests. Two findings REFUTED in review (not changed): a claimed ObjectId-vs-string idempotency/class-teacher mismatch in AttendanceReminderService (unmarkedSections returns string sectionIds — tests prove the guard + lookup work). **Gate GREEN (executed in worktree):** vocab verifier PASS, shared+server tsc clean, jest 619/619 (+3; 39 suites, firewall green), app tsc + expo web export green. [worktree-notifications-n2-n4]
- docs: add Vocabulary Tracker build contract (prd-vocabulary-tracker.md, VC-1..VC-5); decisions D-#104–#107 (planned D-#100–#103, renumbered — taken on main by M-2/M-3/HR-2) — replaces the two-phase Google-Sheet vocab system; trilingual data-driven model; no Old/New.
