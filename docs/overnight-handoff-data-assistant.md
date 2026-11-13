# Overnight handoff — data assistant (Brief 14, docs/prd-data-assistant-mcp.md)

Cloud session, branch `claude/new-session-4qatxq` (started from `dev` e7440467, PR #1519 merged —
the PRD is on dev). No PR opened (the brief forbids it). One section per slice.

Conventions used throughout: every tool lives in `server/src/modules/data-assistant/`; the
pipeline is `runTool.ts`; permission helpers are `gates.ts` (kept apart from `runTool.ts` so tool
files never import the registry — a cycle); the PRD's single `needs` per tool became `gates[]` (one
per mode, each naming the resolver it mirrors), because most tools have modes with different
gates.

---

## DA-1 — tool layer, RBAC, contact stripping, untrusted text, limits, `AiDataCall` audit

- **Commits:** see `git log --grep "\[DA-1\]"` (one commit; hash in the CHANGELOG line's commit).

### Built
- **24 tools** (PRD §7), registry order fixed: `my_access, daily_report, find_students,
  student_overview, attendance_day, student_attendance_history, attendance_ranking,
  homework_status, assignment_status, class_test_status, class_test_marks, exam_results,
  mastery_overview, lesson_progress, routine_lookup, find_staff, staff_attendance, staff_leave,
  payroll_summary, finance_summary, fee_dues, notices, question_bank_stats, monthly_report_status`.
  Each calls the screen's service after the screen's gate; every output is built field by field.
- **`runTool`**: fresh auth (User row re-read every call) → `data_assistant` AI feature switch
  (`off`) → door (`data_assistant:use` in-app / `:connect` Claude; GUARDIAN never) → rate limit →
  zod validation (strict: unknown keys refused) → visible check → slot (2/person, 6/server) →
  run with 15 s timeout → `redact()` → 60 KB cap → one `AiDataCall` row (always, even on refusal).
- **Contacts (§6)**: allow-listed output in each tool; `redact.ts` key deny-list (+ suffixes
  Phone/Email/Address, + father/mother/spouse/bloodGroup); value sweep reusing the de-identifier's
  `PHONE_PATTERN` (now exported) plus a "+880 1XXX…" rule, digit-bounded, ids untouched.
- **`untrusted_text`** envelope (`untrusted.ts`): comments (student_overview `include_comments`),
  leave reasons (staff_leave), notice bodies (notices); control chars and role markers stripped,
  swept before the cut, 500 / 300 chars.
- **Catalogue**: feature `data_assistant` (`use`, `connect` off for Teacher/Office; `audit` LOCKED);
  verifier's pinned LOCKED list + docs/permission-catalogue updated.
- **AI feature** `data_assistant` in `AI_FEATURES` ($5/month, 300/day, Claude Sonnet 5.5, OFF).
- **Audit kinds** `DATA_MCP_AUTHORIZED`, `DATA_MCP_REVOKED` + labels (used from DA-3).
- **GraphQL** `dataToolCallsPage` (`data_assistant:audit`) and `myDataToolCallsPage` (own rows).
- **Move-only exports** for gate reuse: `assertCanViewHomeworkDay` (homework.ts),
  `assertDashboardAdmin`, `assertChaseAdmin`, `filterFromArgs` (classTestSummary.ts),
  `assertReadTest` (classTestResult.ts), `assertExamReader` (examReportCard.ts),
  `assertSectionReportAccess` (studentAttendance.ts); the `monthlyClassRollups` resolver body moved
  unchanged into `MonthlyReportService.monthlyClassRollups` (resolver now calls it). Each diff is
  the word `export` or a pure move — please check.
- **Help guide** `data-assistant-access` (reading guide, `draft: true`, Principal): the three
  switches, the feature card, what Office can/cannot ask, what goes to the provider.

### Build-time confirmations (PRD §13.1)
- **OPEN-1 individual-pay permission:** there is none separate. `staffPayslips` and
  `payslipsForRun` (per-person pay lines) are gated `payroll:view`, so `payroll_summary` `person`
  = `payroll:view`. **Office holds `payroll:view` by default** → an Office person with
  `data_assistant:use` will see individual pay. (D-#1544)
- **OPEN-2 student-comments gate:** the profile's comments tab is `studentProfileComments`,
  `student_profile:view` + `assertStudentProfileRead` (same as the profile). Office holds it.
- **OPEN-3 "View as":** no existing gate applies the impersonator's permissions; the data
  assistant adds one rule only at the door (D-#1570). Implemented and logged (`impersonatorId`).
- **OPEN-4 support-profile module:** not built. Planned path `server/src/modules/support-profile/`
  (+ `platform/safeguarding/`), eight models; it adds **no** daily-report part. The no-import test
  checks the planned path/names; the runtime test seeds the planned collections.
- **PRD §7.1 drift found:** Office has **no `reports:daily_*`** by default, so `daily_report` is
  "no permission" for Office (PRD assumed ok). `fee_dues` gate is not `fee_support:view` (that
  switch shows no dues) — mirrors the finance dashboard / `studentFeeHistory` (D-#1567).
  `student_attendance_history`'s screen lets only the section's **class teacher** (or view_all)
  read — narrower than `assertCanRead`; kept.

### Verified (executed in this session)
```
npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json → RESULT: PASS — all checks green
node skills/_tools/verify_help_guides.mjs → help guides: 373 file(s), 25 draft(s) … ALL CHECKS PASSED
node skills/_tools/verify_descriptive_carriers.mjs → RESULT: PASS — all 11 descriptive cases gate as intended
npm run build --workspace=shared → exit 0;  npm run typecheck --workspace=shared → exit 0
server tsc --noEmit (--extendedDiagnostics) → exit 0; Instantiations 8,626,600; Memory used 3,672,484K
  (baseline without the module, same session: 8,595,381 / 3,668,346K — the module adds ~0.4%;
   NOTE the baseline itself is already ~3.67 GB, above the PRD's 3.46 GB figure)
app tsc --noEmit → exit 0
expo export --platform web → "App exported to: …" EXPO_EXIT 0
New suites (--runInBand), all green: dataAssistantTools 16, Redaction 6, FreeText 7, Payroll 7,
  SupportExcluded 3, ReadOnly 2, Audit 5, Limits 7, GateParity (one per mirrored mode) + 1, firewall +1 case
Touched suites: aiFeatureSettings 16/16 (list now includes data_assistant), permissionCatalogueGates green
Full server suite (--maxWorkers=2): Test Suites 2 failed, 456 passed; Tests 1 failed, 7409 passed
  - aiWorkspaceW1 "budget screen" expected capsTotalUsd 18 → now 23 (the new $5 cap): test updated,
    rerun green.
  - yearChangeScreens: "jest worker … terminated (SIGTERM)" (heap pressure while tsc + expo ran in
    parallel). Rerun alone: Tests 25 passed, 25 total.
```

### Not done in DA-1
- No model, no chat, no MCP endpoint (DA-2/DA-3 by design).
- Mongo `maxTimeMS` is not threaded into the services; the 15 s limit abandons the reply instead.
- `exam_results` was only exercised with a missing exam (no exam fixture): it returns `invalid`
  ("পরীক্ষা পাওয়া যায়নি"). `assignment_status` summary likewise needs an AssignmentSchedule.

### Decisions
D-#1531, #1532, #1533, #1534, #1537, #1538, #1539, #1542, #1543, #1544, #1545 (PRD rows, as built),
D-#1567 fee_dues gates, D-#1568 daily_report (no seen-mark, part allow-list, Office finding),
D-#1569 sweep details, D-#1570 View-as door rule, D-#1571 small build choices.

### Questions for the owner
1. Office + `data_assistant:use` ⇒ individual pay (they hold `payroll:view`). OK, or should
   Office's `payroll:view` be split first?
2. Should Office get any `reports:daily_*` so the daily report works in the assistant?
