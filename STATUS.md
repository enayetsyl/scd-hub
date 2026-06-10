# STATUS

_Updated: 2026-06-10_

## Now / next
- **LOADED to Atlas:** **real student roster** (91 students) — verified live: 91 students (all w/ phone, 88 w/ dob),
  7 classes (Nursery 21 / KG 12 / One 7 / Two 14 / Three 17 / Four 12 / Five 8), 10 populated sections,
  129 contact-only guardians (`loginEnabled:false`), 194 guardian links. Seed leftovers cleared first
  (6 `S-30x` students + `@scd.test` users + their grants + 3 empty seed sections) via `clear-seed.ts`.
  Model/contract work: roster class-level axis (`ROSTER_CLASS_LEVELS` −1..5, Nursery/KG below content's
  C1–C5; content `class_level` LOCKED 1..5 untouched, D-#30); `Student` + core operational fields;
  `Guardian` login-optional (D-#31). Pipeline: `extract-students.py` → gitignored `students.json` →
  `import-students.ts` (idempotent upsert by schoolId). Gates green (124/124, typecheck, vocab verifier).
  Source .xlsx + students.json are gitignored PII (ADR-005). **Next / not done:** **frontend doesn't surface
  the new Student fields yet** (roster screens read name/class/section only); a `users`/section-picker
  follow-up (Slice-4 list) would let staff browse the new classes. **Code changes uncommitted.**
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
