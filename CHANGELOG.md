# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
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
- 2026-06-12 — feat: Attendance AT-1..AT-3 + AT-5 server (teacher Excel snapshot import w/ name reconciliation; once-daily absent-only student capture behind the CT-2 marker gate; recorded-only leave applications; absentee/unmarked/no-application/staff-summary reports; perms attendance:mark/manage; Student.rollNumber; exceljs). Verifier + tsc + jest 363/363 green; parser verified on the real export. [feat/attendance]
- 2026-06-12 — feat: Attendance app screens — new 🙋 tab: marking worklist + absent-only capture, teacher-Excel upload (preview→map/ignore→commit), absentee/unmarked/no-application/staff-summary report surface, marker assign/revoke. App tsc + web export green. [feat/attendance]
