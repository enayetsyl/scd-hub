# STATUS

_Updated: 2026-06-10_

## Now / next
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
