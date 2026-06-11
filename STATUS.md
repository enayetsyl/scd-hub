# STATUS

_Updated: 2026-06-11_

## Now / next
- **Built (Credential provisioning — phone logins for guardians + teachers, share via WhatsApp, D-#59/#60):**
  server + app. Principal/Office now generate logins and hand them out over WhatsApp. **Guardians:** ONE shared
  login per family keyed by `Student.phone` — auto-links every sibling on that phone, both parents use it
  (D-#59); idempotent re-provision (resets password, links new siblings, no dup links). **Staff:** teachers had
  **no `User` accounts** (StaffProfile data only) — `provisionStaffLogin` mints a **phone-login** `User`, role
  mapped from HR category (teacher/assistant_hifz→TEACHER, office_accounts→OFFICE; support/phoneless rejected,
  D-#25/#60). Model: `User.email`→optional sparse-unique + new sparse-unique `User.phone`; `staffLogin` accepts
  email **or** phone. New `credentials.ts` (ambiguity-free `generatePassword` + Bangla `buildCredentialShareLink`
  wa.me builder, ADR-003) + `ProvisioningService`; resolvers `guardian/staffCredentialCandidates` + `provision/
  reset` mutations (gated `guardian:link` / `user:manage`, **no new permission**); audit kind
  `CREDENTIAL_PROVISIONED`. App: Admin **Guardian logins** + **Teacher/staff logins** screens (generate/reset →
  password shown **once** + "Send on WhatsApp" + copy); login screen takes email-or-phone. **Gate GREEN:** server
  tsc + **jest 313/313** (24 new in `provisioning.test.ts`, firewall green), vocab verifier PASS; **app tsc clean
  + web bundle green** (495 modules). Committed [fc755c6]. **MIGRATION APPLIED to live Atlas** (`migrate-user-
  login-index.ts --commit`): the non-sparse `users.email_1` index was dropped + recreated **sparse** (phone-only
  staff can now be inserted). **VERIFIED LIVE** (`verify-provisioning.ts`): real roster groups into **60 guardian
  families** by phone (1 five-sibling family, 23 two-child; no phone groups ≥6 → no shared/default-number false
  joins); **23 staff all provisionable** (21 TEACHER / 2 OFFICE). End-to-end provisioned **1 guardian** (2-child
  family → password authenticates via `guardianLogin` ✓) + **1 teacher** (phone login authenticates via
  `staffLogin` ✓) — **two real active logins now exist on Atlas** (Fardhousi Jahan Shaly +8801409514518; Afia
  Loskor +8801706050753) — the Principal should reset/share their passwords (printed once at provision time).
- **Built (Class-teacher CT-1 — generalize the coordinator gate + support teacher + history, D-#42/#45/#53):**
  server + app. `assertIsClassTeacher` doc generalized to the **section daily-coordinator** gate (CT1.1, no
  behavior change — reused by future attendance/leave/report-card/comms). New `Section.supportTeacherIds`
  (support/assistant teachers — recorded, NOT the gate, D-#53) + append-only `ClassTeacherAssignment` log
  (every set/clear/add/remove + actor + timestamp, ADR-008). New `ClassTeacherService` (assign + support
  add/remove + history); `assignClassTeacher` refactored through it (now logs). Resolvers: `setSupportTeacher`
  + `mySectionsAsClassTeacher` (CT1.2 teacher self-view, query ready) + `classTeacherHistory`;
  `supportTeacherIds` on the Section type. App: **AssignClassTeacherScreen** enhanced — overview of **all
  sections** (unassigned flagged + per-teacher load badge, CT1.3/1.4) + support add/remove + assignment
  history. **Gate GREEN:** server tsc + **jest 289/289** (6 new in `classTeacherService.test.ts`, firewall
  green); **app tsc clean + web bundle green** (491 modules). Covers CT1.1–CT1.6. **Not verified live.**
  CT-2..5 duty gates land with their (unbuilt) attendance/leave/report-card/comms modules.
- **Built (Routine R-5 — triggers + class-note/daily-diary, D-#52/#54): ROUTINE MODULE COMPLETE (R-1→R-5).**
  Server: `ClassNote` (one per slot+date; what-was-taught + optional HW-T1 `homeworkItemId` link — no second
  homework path) + `BellDutyAssignment` (whole-day or per-period, D-#54). `RoutineTriggerService` + pure
  `trigger.ts` `buildBellSchedule` (per-period override → whole-day duty → null). Queries `bellSchedule`
  (period end times from the R-1 grid/window + the bell-duty admin), `classNotesForDate`,
  `myClassNotePrompts` (the teacher's slots still needing a note), `bellDutyForDate`; mutations
  `publishClassNote` (authorized to the slot's teacher / active cover / admin), `assignBellDuty`. **Delivery
  (push) rides the deferred messaging pipeline; R5.4 guardian notify + R5.5 push are pipeline.** App:
  `DailyNoteScreen` (per group+date — publish what-was-taught per slot + view notes), `BellScheduleScreen`
  (date+audience bell schedule + assign bell-duty, managers), MyRoutine **"notes to publish today"** prompt.
  **Gate GREEN:** server tsc + **jest 283/283** (8 new in `routineTrigger.test.ts`, firewall green); **app
  tsc clean + web bundle green** (491 modules). Covers R5.1–R5.3. **Not verified live.** **Routine module is
  feature-complete server+app (R-1 calendar/grids → R-2 slots/conflict/scope → R-3 views → R-4 cover/
  proxy-manage → R-5 triggers/class-note).** Next: live verification, or another module.
- **Built (Routine R-4 — substitution/cover + proxy-manage, D-#22/#46/#49):** server + app. New
  `RoutineSubstitution` model (one cover per slot per date). **Server:** `RoutineCoverService` — pure
  `rankAvailability` (free-first, lightest-load-next) + `teacherAvailability(date, period)` (who's free +
  each teacher's class count that day), `assignCover` (records the sub; for a **Section** slot backs it
  with a **time-bounded proxy `ScopeGrant`** via the existing `assignProxy`, D-#20/#22; a SubjectGroup
  cover is record-only — no content scope), `cancelCover` (deactivate + `revokeProxy`), `coversForDate`.
  `routineForDate` now **overlays covers** (each slot gains `coverTeacherId` for the date, R4.4).
  Resolvers `teacherAvailability`/`coversForDate` + `assignCover`/`cancelCover` (manage) +
  `coverTeacherId` on the slot type. **App:** `CoverManageScreen` (reachable per group from RoutineHome,
  managers only) — date + the day's slots; "Find cover" → ranked availability → assign; active-covers
  list with cancel. New cover operations + STR keys (BN/EN). **R4.5 (guardian read) is pipeline-deferred**
  (guardian portal). **Gate GREEN:** server tsc + **jest 275/275** (6 new in `routineCover.test.ts`,
  firewall green); **app tsc clean + web bundle green**. **Not verified live.** Covers R4.1–R4.4.
  **Next = R-5** (routine-driven triggers + class-note/daily-diary).
- **Built (Routine R-3 — app views, D-#46):** first routine **frontend** slice (Expo). New **Routine tab**
  (📅, gated `routine:read` → Principal/Teacher/Office), `RoutineStack` with 4 screens: `RoutineHome`
  (role-aware landing — My routine / section grid / Quran-Arabic group list; editor entries shown only to
  `routine:manage`), `GroupRoutineScreen` (R3.1 weekly grid for a Section/SubjectGroup, grouped by day via
  shared `SlotList`), `MyRoutineScreen` (R3.2 the teacher's own slots, today highlighted), `RoutineEditor`
  (R3.3 admin create/delete slots — day/period/subject/track/teacher/room chips+fields; **server conflict
  rejection shown inline + authority warnings surfaced as a notice**). One small server read added:
  `myRoutineSlots` (`routine:read`, scoped to the caller). App-native operations + `routineSubjectLabel`/
  `dayOfWeekLabel`/`periodTrackLabel` + STR keys (BN/EN). **Frontend-only beyond the one read; no
  contract/schema change.** **Gate GREEN:** server tsc + **jest 269/269** (firewall green); **app
  `tsc --noEmit` clean + web bundle green** (`expo export --platform web`, 488 modules). **Not verified
  against a live server.** Covers R3.1–R3.3. **Next = R-4** (substitution/cover + proxy-manage).
- **Built (Routine R-2 — slots + conflict engine + scope binding, D-#46/#49/#56):** server-side. New
  `RoutineSlot` model (`(group×day×period)→subject,teacher,room`; group = Section or SubjectGroup;
  effective-dated `[from,to)`; a Quran double = two adjacent slots, D-#56). **Conflict engine** (pure
  `conflicts.ts`): rejects teacher / group / room double-booking at the same (day, period) with
  overlapping effective windows. **Scope binding** (D-#49): a content-subject Section slot auto-upserts a
  teaching `ScopeGrant` tagged `source:"routine"` (new field on the model) — Quran/Arabic groups +
  non-content subjects bind nothing (no content scope); delete revokes **only** when no remaining slot
  maps to it (manual grants never touched). **Teacher-authority = warn, never blocks** (R2.6). Day rule
  (`weekdayBaseDayType`): Fri rejected, Sat only quran, Sun–Thu all. `RoutineSlotService` + resolvers
  `routineSlots`/`routineForDate` (read) + `createRoutineSlot` (→ `{slot, warnings}`)/`deleteRoutineSlot`
  (manage). **Gate GREEN:** vocab verifier PASS, shared+server tsc clean, **jest 269/269** (24 new in
  `routineSlots.test.ts`; firewall green). **Not verified live; not committed yet.** Covers R2.1–R2.8.
  **Next = R-3** (views: group grid + my-routine + admin editor — app).
- **Built (Routine R-1 — calendar + rooms + groups + grids + windows, D-#46–#58):** first routine slice,
  server-side. New app-native vocab in `/shared/vocab.ts`: `DAYS_OF_WEEK`/`DAY_TYPES`/`PERIOD_TRACKS`/
  `SEASONS`/`HOLIDAY_TYPES`/`GROUP_GENDERS`/`ROUTINE_SUBJECTS` (⊇ HW_SUBJECTS + QURAN) + BN/EN labels +
  `routine:read`/`routine:manage` perms (PRINCIPAL/OFFICE manage, TEACHER read). New `server/src/modules/
  routine/`: models `Room`, `SubjectGroup` + `SubjectGroupMembership` (cross-grade gender-split Quran/Arabic
  groups, ≤1-per-track), `PeriodGrid` (per-(audienceKey,season), per-period track tag + durationMin — D-#58),
  `ScheduleWindow` (admin date windows + `dayStartMinutes`), `HolidayException`. Pure helpers `calendar.ts`
  (`dayTypeFor`/`dayTypeAdmitsTrack`/`resolveDayType` — reuses trackers `isSchoolDay`, no second calendar)
  + `schedule.ts` (`computePeriodTimes` from a day-start, `windowFor`, `dateRangesOverlap`, HH:MM helpers).
  GraphQL resolvers: queries `rooms`/`subjectGroups`/`subjectGroupMembers`/`periodGrids`/`scheduleWindows`/
  `holidays`/`dayType`/`resolvedDay` (computes a day's clock times) gated `routine:read`; mutations
  `createRoom`/`setRoomActive`/`createSubjectGroup`/`add|removeGroupMember`/`upsertPeriodGrid`/
  `createScheduleWindow`/`createHolidayException` gated `routine:manage`. **Gate GREEN:** vocab verifier PASS
  (incl. new C.3 routine checks + OFFICE exact-list updated), shared+server tsc clean, **jest 245/245**
  (22 new in `routine.test.ts`; firewall green). **Not verified live; not committed yet.** Covers R1.1–R1.6.
  **Next = R-2** (routine slots + conflict engine + scope binding + RBAC).
- **Planned (Routine module + Class-teacher generalization — build contracts written, D-#45–#52):**
  two new build contracts authored, **no feature code yet**. (1) `docs/prd-routine.md` — full Routine/
  Timetable module, **scope-expanded after the Principal walkthrough** (D-#48–#52). Now owns: a **day-type
  calendar** (Sun–Thu full, Fri off, **Sat Quran-only**, + holiday exceptions that suspend routine+
  attendance, D-#50); **rooms**; **groupings** — general `Section` + new cross-grade **`SubjectGroup`** for
  Quran/Arabic (a Hifz year mixes class 2/3/4, with student membership, D-#48); **period grids** keyed by
  audience×track×season (Class 1–5: general 35-min / Arabic 40-min / Quran 90-min double, winter 60;
  Nursery/KG own grid: single-period Quran + first-2 periods 45/30-min, D-#51); **routine slots** +
  conflict engine (no teacher/group/room double-booking) + effective-dating; **scope binding** — a
  subject-teacher slot **auto-grants** teaching access (`source:"routine"` ScopeGrant; manual+supervisory
  coexist; proxy→time-bounded; D-#49); **substitution/cover** + an admin **proxy-manage** availability view
  (who's free + how loaded that day); section/teacher/guardian **views**; and a **routine-driven trigger
  schedule** (bell→duty-admin, attendance→teacher, class-note→subject-teacher, note-published→guardian)
  feeding a **class-note/daily-diary** (reuses HW-T1 declaration; push **delivery rides the deferred
  messaging/push pipeline**, D-#52). Slices **R-1** (calendar+rooms+groups+grids) → **R-2** (slots+conflict
  engine+scope binding+RBAC) → **R-3** (views) → **R-4** (cover+proxy-manage) → **R-5** (triggers+
  class-note). New app-native vocab `routine:read`/`routine:manage` + `DAYS_OF_WEEK`/`DAY_TYPES`/
  `PERIOD_TRACKS`/`SEASONS`/`ROUTINE_SUBJECTS` (no wire twin). (2) `docs/prd-class-teacher.md` — generalize
  `assertIsClassTeacher` (D-#42) into the section "daily coordinator" gate for attendance/leave/report-card/
  parent-comms; **CT-1** now also adds a **support/assistant teacher** on the section (Nursery has one;
  KG/others future) + an **append-only `ClassTeacherAssignment` history log** (both pulled INTO scope by
  Principal, D-#53 — reverses D-#45). Duty gates still land with their (unbuilt) modules. Decisions
  **D-#45–#54** appended; roadmap updated. **Routine open items resolved (D-#54):** `ROUTINE_SUBJECTS =
  [BAN,ENG,MATH,SCI,BGS,ARABIC,ISLAM,QURAN]` (BGS+Science class 3–5 only, rest all classes); bell-duty =
  per-day default + optional per-period; memberships year-stable (no mid-year class change); class-note =
  what-taught + link to declared homework. **Seasons = admin-set `ScheduleWindow`s (D-#55):** winter dates
  float yearly; day-start steps 07:00→07:15→07:30; `PeriodGrid` holds durations, absolute clock times
  computed from the window's `dayStartTime`. **Grounded in the live V3 routine (`Class Routine
  Teacher.xlsx`, D-#56):** double-period = two adjacent independently-staffed slots (not atomic);
  `SubjectGroup`s are leveled + gender-split (Quran: Qaida/Ammapara/Najera/Hifz 1–3; Arabic: Book 1/2/3),
  no separate group-lead; "Deen"→ISLAM label; sections gender-split (Boys/Girls) from ~Class 2/3; the
  sheet's bottom table gives current Lead(class-teacher)+Support assignments + the period grid, **seedable
  for CT-1/R-1**. **Period grids PINNED (D-#57):** Nursery/KG = 6 periods (single-period Quran, ends 10:50);
  Class 1–5 = 8 periods (Quran double + Arabic + 4 general, ends 12:00); winter compresses only P1/P2
  (45→30); exact minutes seed from V3. **All routine + class-teacher open items now resolved — contracts
  build-ready.** **Next = build R-1** (calendar+rooms+groups+grids) — or CT-1 first if class-teacher
  visibility is the priority.
- **Built (Homework Tracker — app screens, frontend for HW-T1→T4):** new Expo **Homework tab** (📒, gated
  `tracker:read`) — 4 screens over the existing server contract (no server/contract change): `HomeworkHome`
  (daily DAY_TOTAL vs 240 + declarations w/ band warnings + summary roll-up: chase list w/ §7.2 badges, open
  resubmissions, on-time %/chase volume/return latency, topic touches), `DeclareHomework` (subject-teacher
  declaration form, classLevel derived from the class), `HomeworkReconcile` (class-teacher trim ক/খ/গ +
  present/absent roster + confirm-issue, over-ceiling blocks), `CheckingQueue` (SUBMITTED → RESULT + optional
  Pool top-up). New homework labels/STR + `HomeworkTab` nav. Gate: **app tsc clean + web bundle green** (480
  modules). **Not verified against a live server.** **Principal roll-ups screen now also built**
  (`HomeworkRollupsScreen` — watch-list / trim-pattern / de-identified question-usage; reachable from
  HomeworkHome). **Assign-class-teacher UI built** too (`AssignClassTeacherScreen`, Admin tab, roster:manage)
  — D-#42 now has a UI. Homework feature complete server **and** app. Remaining = operational/governance only:
  Quran/§6.3→Project 06 (**note drafted** — `docs/project06-deviation-quran.md`, for the Principal to send);
  **run** the class-teacher assignments on the live roster (UI now exists); live golden-path verification.
- **Built (Homework Tracker HW-T4 — roll-ups + thresholds + question-usage feed, D-#44):** the homework build
  (HW-T1→T4) is now feature-complete server-side. `HomeworkSummaryService` + `tracker:read` queries:
  `homeworkSummary` (chase list + §7.2 attention/comms thresholds, open resubmissions, submitted-on-time % /
  chase volume / Given→Returned latency, touches-per-TOP-tag), `homeworkWatchList` (§7.3 ≥3 open/recent
  resubmissions per rolling 14 days), `homeworkTrimPattern` (§7.4 subject trimmed >30% of the month's
  reconciled days), `questionUsageFeed` (§8.4 **de-identified** per-qid usage — no identity, firewall green).
  Thresholds = A-01/D-#34. No new vocab/wire change. Gate green: server tsc clean, vocab verifier PASS,
  **jest 223/223** (5 new; firewall green). **Not committed yet; not verified live.** Covers handoff §12 #10.
  **Homework Tracker §12 acceptance now fully covered (#1–#11).** Remaining: optional app screens (handoff
  §8.1/§8.2 views) + the parked cross-feature items (Quran/§6.3 deviation to Project 06; assign class teachers
  live; live golden-path verification).
- **Built (Plan review/approval loop PR-3 — app screens, D-#38):** the loop is now usable end-to-end in
  the Expo app. New **Review tab** (📝, gated `content:review` OR `content:assign_review` → Teacher +
  Principal + Office). `ReviewHomeScreen` — role-aware: **Inbox** (admins: `planReviewInbox`, submitted
  rounds) + **My reviews** (teacher: `myReviewAssignments`); each query paused when the role lacks the perm.
  `ReviewSubmitScreen` (teacher) — renders the assigned plan (reviewer read-override) + verdict chips
  (অনুমোদন / পরিবর্তন প্রয়োজন) + feedback → `submitPlanReview`. `ReviewThreadScreen` (admin) — full round
  history with **copy-feedback to clipboard** (the Claude-Desktop text), **Assign next round** (reviewer id),
  and **Approve / sign-off** (Principal, enabled only when `reviewed`). `PlanViewScreen` gains the same
  assign + approve actions for the Principal (who browses content). New app-native vocab labels
  (`reviewVerdictLabel`/`reviewRoundStatusLabel` + STR). Re-upload uses the existing Import screen (R3.4).
  **Frontend-only, no server/contract change.** Gate: **app `tsc --noEmit` clean + web bundle green**
  (`expo export --platform web`, 476 modules). **Not verified against a live server.** Plan-review loop
  (PR-1→PR-3) is now feature-complete server+app.
- **Built (Homework Tracker HW-T3 — resubmission + Pool top-up, D-#43):** `HomeworkResubmissionService` —
  `checkRecord` records RESULT at SUBMITTED→CHECKED; WRONG auto-spawns a resubmission (NEW record, same
  HW_ID, `resubOf`, fresh GIVEN→…→RETURNED; original→RESUBMIT), PARTIAL spawns only on teacher judgment,
  CORRECT advances. All four §5 top-up boundaries enforced (selected-not-authored via the question store;
  reactive-only; time-counted in `getStudentDayLoad`; inside the resubmission/same HW_ID). GraphQL
  `checkHomeworkRecord` (subject-teacher write) + `studentDayLoad` (per-child base+top-up vs 240). Fixed an
  HW-T1 bug: dropped the unique `{hwItemId,studentId}` index (a resubmission is a legit 2nd record). No new
  vocab/wire change. Gate green: server tsc clean, vocab verifier PASS, **jest 218/218** (14 new; firewall
  green). **Not committed yet; not verified live.** Covers handoff §12 #6 (all four boundaries) + #3 (the
  resubmission's own 1→6 pass). **Next = HW-T4** (trackerSummary roll-ups + thresholds + question-usage feed).
- **Built (Plan review/approval loop PR-2 — D-#38):** closes the loop. `approvePlan` — Principal
  sign-off `reviewed→gold` (`content:promote_gold`, Principal-locked), closes the thread (supersedes
  any open round), audits `PLAN_APPROVED`; rejects sign-off unless the plan is `reviewed` (a teacher
  APPROVE must land first). `planReviewInbox` (Principal/Office — submitted rounds newest-first, the
  `feedback` is the Claude-Desktop text) + `planReviewThread` (full round history by any artifact
  version; Principal/Office see all, a teacher only threads they reviewed). **Re-import linkage
  (R2.2):** `persistEnvelope` now calls `supersedeOpenRoundsForAddress` when a revised plan version
  supersedes the prior — the open round flips `superseded`, the next round assigns on the new (`draft`)
  version. Shared supersede helper (reused by reassign + re-import + sign-off). **No wire-contract
  change.** Gates: vocab verifier green, server tsc clean, **205/205 tests** (incl. the merged D-#42
  class-teacher suite + new PR-2 cases), firewall green. **Merged (PR #3).** Closed out by PR-3 above.
- **Built (Plan review/approval loop PR-1 — D-#38–#40):** server core of the in-app plan-vetting loop.
  Build contract `docs/prd-plan-review.md`. App-native vocab: new perm `content:assign_review`
  (Principal/Office), `content:review` extended to TEACHER, `REVIEW_VERDICTS` enum (`APPROVE`/
  `CHANGES_REQUESTED`) + BN labels; verifier extended + green. New `ReviewAssignment` model
  (`content` module — address-keyed `{docType,subject,classLevel,anchorWord,addressNumber}` so the
  review thread spans re-imported versions; identity plane, behind ADR-005). `ReviewService`
  (`assignPlanReview`/`submitPlanReview`/`cancelPlanReview` + pure `advanceOnApprove`/`isPlanDocType`/
  `addressKeyOf` + `reviewerMayReadArtifact`). Resolvers `assignPlanReview`/`submitPlanReview`/
  `cancelPlanReview`/`myReviewAssignments`; **reviewer read-scope override** wired into the `artifact`
  query (an assigned teacher reads that exact version out-of-subject, read-only). `APPROVE` on a `draft`
  plan advances `reviewStatus`→`reviewed`; one open round per address (supersede on reassign, D-#40).
  Audit kinds `REVIEW_ASSIGNED`/`REVIEW_SUBMITTED`/`REVIEW_CANCELLED` (+`PLAN_APPROVED` reserved for PR-2).
  **No wire-contract change.** Gates: vocab verifier green, shared+server tsc clean, 188/188 tests
  (18 new in `review.test.ts`), firewall green. **Merged (PR #1).** Closed out by PR-2 above.
- **Built (Homework Tracker HW-T2 — daily 240-min reconciliation + trim log + cadence, D-#41):** the ceiling
  is now real. `HomeworkReconciliation` (Layer C, one per class/day, immutable ক/খ/গ trim log) +
  `HomeworkReconciliationService`: `tallyDay` (live DAY_TOTAL vs 240 + >40 band warnings), `getTrimCandidates`
  (pre-ranked ক→খ→গ), `applyTrim` (cut Q_COUNT → TIME_DECL follows proportionally, never extends time; logs an
  immutable row; rejected once reconciled), `confirmHomeworkDay` (BLOCKS if DAY_TOTAL>240, hard-blocks Fri/Sat,
  else issues every declared item w/ q>0 + reconciles). New vocab `RECON_STATES`/`TRIM_RANKS` + the LOCKED
  figures (240/120/40/20) + verifier checks. GraphQL: homeworkDayTally/homeworkTrimCandidates +
  trimHomeworkItem/confirmHomeworkDay. **Fixed HW-T1's over-strict TIME_DECL>40 reject → now allowed (band
  warns, never blocks; only the 240 sum blocks).** Gate green: vocab verifier PASS, shared+server tsc clean,
  **jest 170/170** (16 new tests; firewall green). **Not committed; not verified live.** Covers handoff §12
  #4 (240 block + trim by count not time + band-warn-not-block), #5 (immutable trim log w/ rank ক/খ/গ +
  from/to + minutes), #7 (Fri/Sat hard-block + Thursday light), #8 (one common sheet). **Class-teacher-only
  reconcile now ENFORCED (D-#42, resolves the D-#41 open item):** `Section.classTeacherId` (a TEACHER) +
  `assignClassTeacher` mutation (roster:manage); `trimHomeworkItem`/`confirmHomeworkDay` gate on
  `assertIsClassTeacher` (not any write-scoped teacher; Principal/Office assign, don't reconcile).
  **Next = HW-T3** (resubmission + Pool top-up, 4 boundaries).
- **Built (Homework Tracker HW-T1 — model + 6-stage lifecycle, D-#36/#37):** the daily HW machinery now has
  its foundation. App-native vocab `HW_SUBJECTS` (content-subject superset + Arabic/Islam, NOT Quran — D-#36, Quran→Quran Tracker),
  `LIFECYCLE_STATES` (8 atomic states for §3's 6 stages, D-#37), `HW_RESULTS` (+BN labels, verifier green).
  Shared lifecycle engine `server/.../trackers/lifecycle.ts` (transition graph + guards + stage map — built
  once, to be reused by the Assignment tracker) + `calendar.ts` (Sun–Thu school nights). Models `HomeworkItem`
  (Layer A — one common sheet/class+subject+day), `HomeworkStudentRecord` (Layer B — **identity-bearing**
  lifecycle carrier on the operational plane, ADR-005; corpus never imports it), `HomeworkSequence` (atomic
  year-continuous HW_ID). `HomeworkService` (declare/issue/transition) + GraphQL resolvers wired
  (declare/issue/transition mutations + homeworkItems/homeworkStudentRecords queries, tracker:read/write).
  Gate green: vocab verifier PASS, shared+server tsc clean, **jest 154/154** (27 new tests; firewall green).
  **Not verified live** (no running server/Atlas). **Not committed.** Acceptance covered: handoff §12 #2
  (HW_ID + ≥1 TOP tag), #3 (6-stage lifecycle, timestamped, shared-once), #8 (one common sheet — no
  per-student item variant), #9 (Bangla labels + English codes); partial #1 (no new tracker-kind/sync).
  **Next = HW-T2** (daily 240-min reconciliation + trim log + Fri/Sat cadence block).
- **Planned (Homework Tracker, Project-06 handoff adopted — D-#33–#35):** stored the LOCKED source verbatim
  (`docs/tracker-homework-handoff.md`, PRD v1.1 incl. Amendment A-01) and authored the repo build contract
  (`docs/prd-tracker-homework.md`). **Key finding:** the Slice-3 "homework tracker" is only the bare generic
  tracker (`TrackerRecord` = one `complete` boolean per de-identified student) — the handoff's HW machinery
  (§3 6-stage lifecycle, §4 240-min reconciliation+trim log, §5 resubmission+Pool top-up, §8 roll-ups) is
  **unbuilt**, so "ratifies and completes" is really a multi-slice build. Build order:
  **HW-T1** model + 6-stage lifecycle (FIRM, built once + shared w/ Assignment) → **HW-T2** daily budget
  reconciliation (240 ceiling block, trim by count not time, immutable ক/খ/গ trim log) + Sun–Thu cadence
  (Fri/Sat hard-block, Thursday light) → **HW-T3** resubmission + Pool top-up (4 boundaries) → **HW-T4**
  `trackerSummary` roll-ups + thresholds (chase 2/3, watch-list ≥3/2wk, trim >30%/mo) + de-identified
  question-usage feed; cross-cut RBAC (class-teacher-only reconcile/confirm) + plane split + firewall green.
  Rides the existing `homework` tracker-kind — **no new tracker-kind, no envelope-schema/harness sync**;
  only app-native `/shared/vocab.ts` additions (lifecycle states, RESULT scale). **Plan/docs only — no
  feature code yet; not committed.** Next = build HW-T1.
- **Built (question-bank import / fan-out, D-#32):** the app now imports a Project-04 **question bank**
  (a `{stimuli,questions}` collection) by **fanning it out** into N single-doc envelopes (one per stimulus
  + one per question) via new `server/import/build_question_envelopes.py` (question analog of
  `build_envelope.py`), each through the **unchanged** gate. subject/class/unit parsed from the qid/stimulus_id
  (mixed bank refused); `tags` copied from payload; `review_status=draft` + synthesized `address` injected;
  `curation_tag` picked in the UI; companion `.md`/register `.tsv` NOT imported (questions app-rendered).
  Import is **atomic** (validate all → persist only if all pass → else store nothing). `persistEnvelope`
  extracted from `importEnvelope`; `importQuestionBank` added; `importFiles` gains `curationTag`/`unitTitle`;
  `ImportResult` gains item tallies; Import screen detects a bank + shows a curation picker + "Imported X/Y".
  **Register stance (D-#32):** NOT stored — the live `questions()` filter + Question-bank screen ARE the
  register (never stale); the TSV stays an offline P04 deliverable. **No contract change.** Executed proof:
  real C5_ENG_U09 bank → 114 envelopes, **114/114 PASS** through `validate_import.py`; server **127/127**
  (3 new bank tests), shared+server+app tsc clean, vocab verifier green. **Not yet verified live** against a
  running server/Atlas (manual web golden path pending); not yet committed to git.
- **LOADED to Atlas (HR-1 staff records):** **real staff roster** (23: 21 teacher / 2 office_accounts) — verified
  live, all with phone + biometricId. First HR slice (prd-hr H1): new `StaffProfile` model (foundation/identity
  plane; bio+employment + sensitive NID/bank/biometric rows), app-native vocab `HR_CATEGORY`/`EMPLOYMENT_TYPE`/
  `EMPLOYMENT_STATUS` (+ BN labels, no wire twin), `staff:manage` perm (Principal/Office). `staff` query gated
  `staff:manage` (default-deny to TEACHER, H1.4) + read-only **StaffListScreen** (Admin tab, category filter).
  Pipeline: `extract-staff.py` (both .xlsx → gitignored `staff.json`) → `import-staff.ts` (idempotent upsert by
  schoolId, no clears). **Data-only — no `User` logins yet** (login optional/separate, H1.2). No new corpus path;
  firewall green (124/124, shared+server+app tsc clean, vocab verifier green). Not yet committed to git.
- **LOADED to Atlas:** **real student roster** (91 students) — verified live: 91 students (all w/ phone, 88 w/ dob),
  7 classes (Nursery 21 / KG 12 / One 7 / Two 14 / Three 17 / Four 12 / Five 8), 10 populated sections,
  129 contact-only guardians (`loginEnabled:false`), 194 guardian links. Seed leftovers cleared first
  (6 `S-30x` students + `@scd.test` users + their grants + 3 empty seed sections) via `clear-seed.ts`.
  Model/contract work: roster class-level axis (`ROSTER_CLASS_LEVELS` −1..5, Nursery/KG below content's
  C1–C5; content `class_level` LOCKED 1..5 untouched, D-#30); `Student` + core operational fields;
  `Guardian` login-optional (D-#31). Pipeline: `extract-students.py` → gitignored `students.json` →
  `import-students.ts` (idempotent upsert by schoolId). Gates green (124/124, typecheck, vocab verifier).
  Source .xlsx + students.json are gitignored PII (ADR-005). Model/script/contract layer committed [e4962a3].
- **Built (frontend roster view):** new read-only **RosterScreen** under the Admin tab (gated `roster:manage`,
  Office/Principal). `StudentRef` now exposes nameBn/gender/dob/phone/address/bloodGroup + a `guardians`
  field (GuardianLink→Guardian); app `ROSTER_QUERY` + `RosterScreen` render them per section (reuses the
  SectionPicker), with Bangla gender/relation/DOB labels and roster-aware `classLevelLabel` (Nursery/KG).
  app tsc + server tsc clean, 124/124 tests, vocab verifier green. **Verified live** on Expo web
  (localhost:8081): Admin → শিক্ষার্থী তালিকা lists real students with their fields + guardians.
  Committed [56a9c0a] (server `guardians` field + RosterScreen; operations.ts/labels.ts also swept in
  pre-existing import-screen WIP strings per operator choice).
- **Designed (not built):** **HR / staff lifecycle module** — all four build-steps + offboarding designed
  in `docs/hr-design.md`; per-journey PRD in `docs/prd-hr.md`; decisions **D-#22–D-#29** appended.
  Build-steps mirror the slice approach: (1) staff records, (2) attendance & leave, (3) payroll,
  (4) performance/conduct/development, + offboarding (cross-cutting). Operational/identity plane, behind
  the PII firewall (ADR-005) — **no new corpus→identity path**; the J5.6 fail-closed firewall test must
  stay green. **Remaining before build:** maternity legal check (D-#23) + parked numbers/specs (leave
  entitlements + Hajj reset; attendance times/grace + **biometric device model/SDK**; Eid bonus + day-rate
  basis; statutory deductions w/ accountant; payment-export target format; warning lapse periods + appraisal
  cadence; REF-11 rubric from curriculum Projects; offboarding clearance-list + notice periods).
  HR **pulled forward** from `docs/roadmap.md` "Deferred ops modules" into the active build (this is the
  STATUS/roadmap call the design flagged).
- **Done:** Slice 4 — connected frontend (Expo app). [45fe2eb 9210cd1 3e31a17]
  - All teacher/principal/office screens per `docs/prd.md` §8: Login; Content tree + Plan
    view + PDF; Question bank (multi-filter) + Preview + Basket; Set list/detail + Assemble
    (HW/AS/CT); Tracker list/open/entry/summary + wa.me copy link; Admin import + user
    create + proxy-grant assign/extend/revoke. 16 screens, role-gated bottom tabs.
  - urql + hand-typed TypedDocumentNodes (codegen deferred — PRD §8 step 8); JWT in
    SecureStore/localStorage; Bangla labels from `shared/vocab` (NFR-5), English codes on
    forms; write-scope ForbiddenError → Bangla message. **`tsc --noEmit` CLEAN; web bundle
    compiles green** (`expo export --platform web`, 471 modules, ~10 s).
  - **NativeWind v4 wired in package.json (ADR-010/014) but its Babel/Metro transform is
    left disabled:** on Windows (no watchman) the css-interop transformer hangs the cold
    Metro web bundle 30+ min. UI uses a themed StyleSheet system; re-enable steps are inline
    in `app/babel.config.js` / `app/metro.config.js` (do it on a watchman platform / CI).
  - **Not executed:** golden-path data flows (needs a running server + seeded Atlas +
    credentials) and native iOS/Android builds. PDF export + DocumentPicker are web-path
    only this slice.
- **Done:** Slice 3 — trackers (J4 end-to-end).
  - `TrackerRecord` model (`trackers` module) — open/closed lifecycle, per-student entries de-identified via sha256 pseudonym (ADR-005), CT score / AS submitted / HW complete fields.
  - `openTracker` / `recordEntry` / `closeTracker` mutations — write-scope via `assertCanWrite` (J4.5: supervisory-only teachers denied); `recordEntry` emits `tracker_recorded` CorpusEvent (de-identified, ADR-005).
  - `tracker` / `trackers` / `trackerSummary` queries — read-scope enforced; `trackers` supports filters: trackerKind / setId / status (J4.4).
  - `waLink` query — pure wa.me deep-link builder (J4.2, ADR-003); no server dispatch.
  - Tests: 124/124 pass (J4.1–J4.5 + all prior tests). `tsc --noEmit` clean. Vocab verifier PASS.
- **Done:** Slice 2 — question bank + assembly (J2 + J3 end-to-end). [e1db6d7]
- **Next:** verify the frontend golden path against a running server (seed Atlas + a staff
  login), then guardian portal screens (deferred; `docs/roadmap.md`) or the server follow-ons
  below.

## Slice 4 follow-ups (frontend was built to the existing contract; these would improve it)
- **`academicYears` query** + enrich **`myScopes`** to return classId/sectionId/subjectId, so
  the section picker is automatic instead of pasting an academic-year id. (Set/tracker
  journeys need a sectionId; only `classes(academicYearId)` exposes it today.)
- **`users` list query** + teacher/grant lookups, so UserList/ScopeGrant aren't manual-id forms.
- **CORS on the `/pdf` Express routes** (Yoga already sends permissive CORS; the PDF routes
  don't) for cross-origin web PDF; and native PDF via expo-file-system + expo-sharing.
- **Re-enable NativeWind** on a watchman platform / CI (see build-config notes above).
- **graphql-codegen client-preset** to replace the hand-typed operations (PRD §8 step 8).

## In flight
- (none — Slice 4 shipped)

## Blocked / waiting
- (none blocking)
  - Open follow-ons from the Project-04 contract LOCK (D-#19), non-blocking:
    - Wire the **authoritative REF-19 registry** via `--ref19-registry`.
    - Upgrade **`topic_tag`** from pattern-only to registry validation.

## Foundation in place
- Requirements (DRAFT), Architecture/17 ADRs (DRAFT), **import contract LOCKED v1.0**, conformance
  harness v1.0 (L1→L4, working), 11 fixture instances green.
- `/shared` vocab v1.0 + RBAC (verified).
- **Slice 0 shipped (2026-06-09):**
  - npm workspaces: `/shared` (built, .d.ts emitted), `/server` (Node + Yoga + Pothos + Envelop),
    `/app` (Expo skeleton, boots on web).
  - Foundation models: User, Guardian, Student, GuardianLink, Class (+ auto-Main section), Section,
    Subject, AcademicYear, ScopeGrant.
  - Audit model (append-only, ADR-008) + AuditService.
  - Staff auth (email+password, JWT) + Guardian auth (flexible identifier).
  - Scope-grant model (teaching/supervisory/proxy) + ScopeGrantService + resolver authz middleware.
  - Proxy auto-expiry: window-checked at request time; expiry audit stamped at first denied-after-expiry
    (D-#21). Early-revoke + extend supported.
  - **Fail-closed firewall test GREEN** (J5.6, ADR-005): corpus analytics path cannot resolve
    student/guardian identity — 7 firewall assertions pass.
  - tsc --noEmit: CLEAN. npm test: 31/31 PASS. vocab verifier: PASS.

## Recent decisions
- **HR module (D-#22–D-#29):** D-#22 cover proposal → admin approval; D-#23 maternity unpaid (accepted
  risk, legal check pending); D-#24 attendance live device sync (first live external dependency);
  D-#25 all staff incl. support attendance-tracked; D-#26 lateness no deduction by default (optional rule);
  D-#27 advances interest- & fee-free (*qard hasan*); D-#28 supervisor observation-write; D-#29 final
  settlement hard-held until clearance.
- D-#17/#18: TEACHER scope overlays — supervisory (read-only) + proxy/cover (bounded write).
- D-#19: adopted Project-04 LOCKED question/stimulus contract.
- D-#20: proxy grants duration-bounded in days; auto-expiry + audit.
- **D-#21:** proxy-expiry audit stamped at request time (first denied-after-expiry) — no cron.
- **Slice 1 design:** Python harness invoked via child_process (not re-ported to TS) — canonical gate stays single-source. pdfkit + NotoSansBengali font (not puppeteer) — no system Chromium dep on Oracle Always-Free.

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
  lives in `docs/roadmap.md`.
