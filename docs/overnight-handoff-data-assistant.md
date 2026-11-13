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

- **Commits:** first 44bfa828, last = the `[DA-1] fix(test)` commit after it.

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
  - aiWorkspaceW1 "budget screen" expected capsTotalUsd 18 → now 23 (the new $5 cap). **Correction:**
    the first fix in commit 44bfa828 broke the test (a sed replaced the `const b = …` line) and the
    rerun's "1 failed" was this file, misread at the time. Fixed in the follow-up `[DA-1] fix(test)`
    commit (also raises the test's budget 20 → 25 so it still exceeds the caps):
    `jest aiWorkspaceW1` → Tests 25 passed, 25 total.
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

---

## DA-2 — in-app data chat with provider tool calling

- **Commits:** one `[DA-2]` commit after 9fa09176 (see `git log --grep "\[DA-2\]"`).

### Built
- **Provider seam** (`platform/ai/provider.ts`): `tools`, `toolChoice` ("auto" | "none" — never a
  forced choice), `toolRounds`; results carry `finishReason: "tool_calls"`, `toolCalls`,
  `assistantRaw`. **Claude**: tools + `tool_choice` in the body (tools render before the cached
  system prefix), assistant content echoed unchanged (thinking blocks included), ALL results in
  ONE user message with `is_error` on failures, tool inputs `JSON.stringify`'d and parsed with
  `JSON.parse`. **DeepSeek**: OpenAI-format tools, never streamed with tools, the assistant message
  echoed as returned (incl. `reasoning_content`) then one `tool` message per call. **Gemini** refuses
  tools before sending.
- **`DataChatService`**: placeholder answer → loop (≤ 6 rounds / 12 calls, the last round
  `toolChoice: "none"`), every tool call through `runTool` (surface `in_app`, session + message ids),
  history = earlier questions + final answers only, rules-only stable prefix + permission-filtered
  tool list in registry order (byte-identical for equal permissions — tested), date + swept question
  in the variable part, Stop, orphan clean-up at boot, one AI request-log row per question
  (question, answer, tool calls with names + swept args + AiDataCall ids, `impersonatorId`,
  `deidentified: false`; no tool results). Costs from the ledger.
- **Own collections** `DataChatSession` / `DataChatMessage` (D-#1572) instead of
  `AiAssistSession.kind` — so data chats never appear in the teacher assistant's lists.
- **GraphQL** `dataChatModels`, `dataChatDeepseekWarning`, `dataChatsPage`, `dataChat`,
  `dataChatMessagesPage`, `dataChatMessage`, `startDataChat`, `setDataChatModel`,
  `askDataAssistant`, `stopDataAnswer`.
- **App**: drawer item "তথ্য সহকারী" (`data_assistant:use`, or while "View as" — the server decides),
  home (paged chats, new chat) and chat (paged turns, polling, Stop, model picker defaulting to
  Claude Sonnet 5.5, DeepSeek warning + confirm every time it is picked, tool chips, "অনুমতি নেই"
  chip, cost per answer, View-as banner). Help guide `data-assistant-chat` (draft, no pictures).
- `DataChatError` registered in `EXPECTED_ERROR_NAMES`; `data_assistant` added to the logged AI
  features; AiExchange gains `toolCalls` + `impersonatorId`.

### Verified (executed)
```
verify_shared_vocab → RESULT: PASS — all checks green
verify_help_guides → help guides: 374 file(s), 26 draft(s) … ALL CHECKS PASSED
verify_descriptive_carriers → RESULT: PASS — all 11 descriptive cases gate as intended
shared build 0; shared typecheck 0; server tsc 0 (Instantiations 8,672,972; Memory used 3,714,946K
  — up ~42 MB from DA-1: CI's 4 GB heap is getting close, see risk R2); app tsc 0
Targeted (--runInBand), 25 suites: Test Suites 25 passed; Tests 311 passed (dataAssistant* incl.
  Chat 9/9, aiProviderTools 9/9, aiClaudeProvider, aiProviders, aiWorkspaceW1–W7, aiAssist,
  graphqlDocuments, helpGuides, permissionCatalogueGates, firewall)
Full suite (--maxWorkers=2): Test Suites 1 failed, 459 passed; Tests 1 failed, 7451 passed —
  expectedErrorRegistry: DataChatError unregistered → registered; rerun Tests 5 passed, 5 total
expo export --platform web → App exported … EXPO_EXIT 0
```

### Not done
- No live call to Claude or DeepSeek (no keys here). DeepSeek's thinking-mode tool round-trip and
  `tool_choice: "none"` could not be checked against api-docs.deepseek.com (host not allowed from
  this session) — confirm on the dev site before offering DeepSeek.
- `strict: true` tools left off (D-#1573) — try on dev with the 24 tools, then switch on.
- No SSE streaming for the data chat (polling only, D-#1574); no per-answer "price now" clock.
- The local UI walk / screenshots were not done (draft guides).

### Decisions
D-#1540, D-#1541 (PRD rows as built), D-#1572 separate chat collections, D-#1573 tool schemas
without `strict`, D-#1574 chat details (polling, `my_account:view` scope + service door, one log
row per question, DeepSeek unconfirmed).

### Questions
3. Is it fine that data chats live in their own collections (not in "read every assistant
   conversation")? The Principal still sees every question + answer in the AI request log.

---

## DA-3 — `/mcp/data` + OAuth resource binding + the Claude connector

- **Commits:** one `[DA-3]` commit after 899c566f.

### Built
- **Resource binding** (`ai-workspace/models/AiOAuth.ts`, `mcp/oauth.ts`): `resource: "workspace" | "data"`
  on codes and tokens (default workspace, no migration), `grantedAt` on tokens. RFC 8707
  `resource` (…/mcp/data) or `scope=data.read` picks data. `verifyAccessToken(raw, resource)`
  refuses a token of the other resource; `/mcp` now passes "workspace" explicitly.
- **Metadata**: `GET /.well-known/oauth-protected-resource/mcp/data`; AS metadata scopes
  `["mcp", "data.read"]`.
- **Sign-in**: same Hub page (email/phone + password, lockout), data text in Bangla + English;
  data needs an active staff login with `data_assistant:connect` (permission, not role) —
  refusal "এই সংযোগের অনুমতি আপনার নেই / You don't have permission to connect."
  `DATA_MCP_AUTHORIZED` audit row.
- **Lifetimes**: access 1 h, refresh 30 d rotated, 90-day absolute cap from `grantedAt` (kept across
  rotations; both expiries capped at it; past it access → 401, refresh → invalid_grant).
- **Revocation**: Disconnect (own; anyone's with `data_assistant:audit`); automatic at the next call
  when `data_assistant:connect` is gone or the login is inactive; on `resetUserPassword` /
  `resetStaffPassword`; at offboarding (fire-and-forget). `DATA_MCP_REVOKED` + `meta.reason`.
- **`POST /mcp/data`** (`data-assistant/mcp/dataMcpRoute.ts`): stateless, 64 KB body limit, only the
  person's visible tools, `readOnlyHint: true`, `openWorldHint: false`, instructions = PRD §4.6 text,
  every call through `runTool` (surface `claude`, client name + id). Mounted before `/mcp`.
- **GraphQL**: `myDataConnections` (own), `allDataConnectionsPage` (`data_assistant:audit`, paged),
  `revokeDataConnection(clientId, userId?)`.

### Deploy notes
- No Caddy change (`/mcp*` covers `/mcp/data`). If Cloudflare challenges Anthropic's calls, add the
  skip rule for `/mcp*`, `/oauth/*`, `/.well-known/oauth-*` (DA-0, owner). Probe from outside:
  `curl -i https://<host>/.well-known/oauth-protected-resource/mcp/data` → JSON, not HTML.
- Feature `data_assistant` must be ON for the tools to answer (otherwise every call says `off`).

### Verified (executed)
```
verify_shared_vocab → RESULT: PASS — all checks green
verify_help_guides → ALL CHECKS PASSED
verify_descriptive_carriers → RESULT: PASS — all 11 descriptive cases gate as intended
shared build 0; shared typecheck 0; server tsc 0 (Instantiations 8,680,052; Memory used 3,728,297K); app tsc 0
Targeted (--runInBand), 34 suites incl. dataAssistantMcp 13/13 and aiWorkspaceW5 10/10 (unchanged):
  first run 1 failed (offboarding: the awaited token cut hit a DB-less test) → made fire-and-forget;
  offboarding rerun Tests 25 passed, 25 total
Full suite (--maxWorkers=2), run on the tree of 9133bb01: Test Suites 461 passed, 461 total;
  Tests 7465 passed, 7465 total (EXIT 0). expo export --platform web → App exported … EXPO_EXIT 0
```

### Not done
- Owner checks on the dev site / prod (DA-0 and the manual connector test) — owner steps.
- Argument errors at the Claude door are answered by the MCP SDK and not logged as `invalid`
  (D-#1575).

### Decisions
D-#1535, D-#1536 (PRD rows as built), D-#1575 build details.

---

## DA-4 — screens + help guides

- **Commits:** one `[DA-4]` commit after 9133bb01.

### Built
- **Home** (`app/src/screens/dataAssistant/DataAssistantHomeScreen.tsx`): chat list + new chat
  (needs `use` or View-as), then `DataAssistantLinks`: **Claude-এর সঙ্গে সংযোগ** (steps 1–4 in Bangla,
  the `…/mcp/data` address, the 90-day / plan / other-connectors note; `data_assistant:connect`),
  **সংযুক্ত অ্যাপ** (own connections, last used, calls in 30 days, end date, Disconnect with
  confirm), and for `data_assistant:audit` links to the two Principal screens.
- **তথ্য সহকারীর লগ** (`DataAssistantLogScreen.tsx`): `dataToolCallsPage`, filters tool / outcome /
  door / from / to (Dhaka keys), paged 50, View-as rows marked.
- **সব সংযোগ** (`DataConnectionsScreen.tsx`): `allDataConnectionsPage`, paged, Disconnect anyone.
- Drawer item and tab open for `use`, `connect` or `audit` (or View-as).
- Help guides (all `draft: true`, no pictures): `data-assistant-claude` (connect), `-apps`
  (connect), `-log` (audit), with `-chat` (use) and `-access` (audit) from DA-1/DA-2. Every
  `data_assistant:*` action now has a guide (coverage 315 of 467).

### Verified (executed)
```
verify_shared_vocab → RESULT: PASS — all checks green
verify_help_guides → help guides: 377 file(s), 29 draft(s) … ALL CHECKS PASSED (coverage 315 of 467)
verify_descriptive_carriers → RESULT: PASS — all 11 descriptive cases gate as intended
shared build 0; shared typecheck 0; server tsc 0 (Instantiations 8,680,216; Memory used 3,711,589K); app tsc 0
Targeted: dataAssistantConnections, graphqlDocuments, helpGuides, permissionCatalogueGates,
  notificationNavCoverage → Test Suites 5 passed; Tests 53 passed
Full suite (--maxWorkers=2) on 963004f4: Test Suites 462 passed, 462 total; Tests 7468 passed,
  7468 total (EXIT 0). expo export --platform web → App exported … EXPO_EXIT 0
```

### Not done
- One local UI walk (Expo + Mongo) and the guide pictures: not done in the cloud session (no
  `.env` / DB to sign in against); the guides stay drafts until a walk.
- CSV export of the log filter (web) — not built (D-#1576).
- My-account placement of "connected apps" (PRD §11) — on the assistant home instead (D-#1576).

### Decisions
D-#1576.

### Questions
4. Keep "connected apps" on the assistant home, or also show it on My account?
5. Is a CSV of the log needed in v1?
