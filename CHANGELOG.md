# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
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
