# PRD — AI Workspace: Projects + chat on DeepSeek, shared with Claude through an MCP bridge

**Status:** PLANNED (build contract) · **Owner:** Principal (SCD) · **Audience:** Principal and assigned staff (coordinator, teachers); Claude (via the MCP bridge)
**Decisions:** D-#1200 … D-#1216 (owner rulings 2026-11-10, Claude Desktop planning; numbered against the live `DECISIONS.md`, whose highest row anywhere was D-#1189 at pre-flight).
**Builds on (do not rebuild):** `aiSend` router (`server/src/modules/platform/ai/aiRouter.ts`, AI-1); `AiUsage` ledger + caps (AI-2); `AiPolicy` versioned rules (AI-3); de-identification + fail-closed gate (AI-4); `AiAssistSession` / `AiAssistMessage` (AI-6); AI analytics (AI-7); the `AiExchange` request/reply log (D-#1179); `docxConvert` (docx → PDF via headless LibreOffice); `DriveStore` + `StoredFile` file storage; the support-book worker pattern (`BookBuildWorker`, separate process, Mongo-claimed jobs, log tailed over SSE).

> **Pre-flight against the live repo (2026-11-10).** Several reuse claims in the planning draft did not match the live code. Each place is corrected in its section below and marked **Pre-flight:**; §13 lists every finding and answers the two open questions (lesson-plan import path; tokenizer). The live repo wins.

## 0. One-screen summary
- [ ] **One workspace, two doors (D-#1200).** Principal and staff use it in the SCD Hub app. Claude uses it through an MCP connector. Both read and write the SAME projects, files, chats, drafts and jobs, so work started in one door can be reviewed in the other.
- [ ] **Projects like Claude Projects:** name, custom instructions (versioned, D-#1202), knowledge files, members, a default model.
- [ ] **Chat inside a project** on DeepSeek, streamed, with cache-friendly prompts (D-#1203).
  - The chat box has three pickers, like the model picker in Claude: **Model** (Flash / V4 Pro), **Thinking** (off / low / high), and **Run** (now / off-peak) (D-#1205).
  - The full history is always sent. Nothing is shortened automatically: quality comes before cost (D-#1204).
  - A price clock shows whether DeepSeek is in peak or off-peak hours right now.
- [ ] **Drafts:** any answer can be saved as a versioned draft, edited, approved (locked), exported to docx/PDF, or sent into an existing pipeline (support-book patch / lesson-plan / question-bank import) (D-#1210–#1212).
- [ ] **Batch jobs:** one template over a list of items (chapters, topics, lecture files), run by a background worker (D-#1213). Every job asks "now or off-peak (half price)", with no default (D-#1209).
- [ ] **MCP bridge:** about 10 tools for Claude (list/read projects, start drafts and batches, check status, read and revise drafts, update instructions, usage). OAuth through the Hub login, Principal only (D-#1214).
- [ ] **Metered and capped like AI Assist:** every call goes through `aiSend` → `AiUsage` with `projectId`; per-person, per-project and monthly caps; AI-7 analytics gains a per-project view.
- [ ] **Efficient by design (D-#1215):** no vector database, no embeddings, no Redis, no new server. Text in Mongo, originals in Drive, one small worker process.

## 1. Goal
Move day-to-day content production (lesson plans, class books, storybooks, question banks, one-off tasks) off claude.ai Projects onto the school's own VM, running on DeepSeek. Principal and staff can generate and review on their own without Claude. When the Principal works with Claude, Claude can hand routine work to the same workspace.

## 2. Build order (D-#1216)

| # | Slice | Depends on | Value on its own |
|---|---|---|---|
| W-1 | Projects, members, instructions, file ingest | AI-1..AI-3 | Projects exist; files become text with token counts |
| W-2 | Project chat | W-1, AI-2, AI-4 | Principal/staff can work with DeepSeek in the app (the main win) |
| W-3 | Drafts, approve, export, send-to-pipeline | W-2 | Output becomes a managed document, not chat text |
| W-4 | Batch jobs + worker | W-1, W-3 | Bulk production (20 storybooks, a chapter's session plans) |
| W-5 | MCP bridge + OAuth | W-1..W-4 | Claude can use the workspace |
| W-6 | Migration + pilot | W-1..W-3 | First real project moved from claude.ai and compared |
| W-7 | Analytics per project + help guides | W-2..W-5 | Spend and quality per project |

Each slice: own branch off `dev`, own PR, own D-# rows, help guide in the same PR (D-#973), growing lists paged (D-#761).

## 3. W-1 — Projects, members, instructions, files
- **`AiProject`:** `name, description, branch, ownerId, members[{userId, role: owner|editor|viewer}], defaultModel ("deepseek-flash" | "deepseek-v4-pro"), defaultThinking ("off"|"low"|"high"), nameProtection (bool), archived`.
  - The two model ids are exactly `DEEPSEEK_MODELS` in `platform/ai/deepseekProvider.ts`. Read them from there; do not list them a second time.
- **Defaults are layered (D-#1206):** a workspace-wide default (set by the Principal in AI settings) → a project default → a per-message choice in the chat pickers. The initial workspace-wide default is **thinking: high**, matching how the Principal works in Claude today. All three layers can be raised or lowered at any time.
- **Name protection switch (D-#1207)** (`nameProtection`): a visible toggle in project settings, chosen at creation and changeable by the project owner or Principal.
  - **ON:** the AI-4 de-identification and fail-closed roster gate run on every turn.
  - **OFF** (book, storybook, lesson-plan and other content projects): the gate is skipped entirely, so common names like Fatima or Umar never block a job. Only a soft warning remains if a phone number or a tracker-id pattern appears.
  - **Pre-flight:** the gate needs a `DeidScope`. The assistant builds one with `scopeForSections` (`DeidScopeService`) for a single class. A project is not tied to a class, so with the switch ON, W-1 builds the scope from the whole active roster (children, guardians and staff).
- **Instructions (D-#1202)** are a versioned document per project. Reuse the `AiPolicy` versioning (key `project:<id>`) rather than a second versioning system; every chat turn stamps the version hash (`policyHashOf`).
  - **Pre-flight:** `AiPolicy.key` is a closed enum (`AI_POLICY_KEYS`: `comment_standard`, `ct_comment_standard`, `assistant_rules`), checked in `AiPolicyService`.
    - W-1 widens it to allow the fixed keys plus the patterns `project:<ObjectId>` and `project:<ObjectId>:template:<slug>` (job templates, W-4). This is a schema + service change with its own test.
    - The three Principal rule documents stay listed and activated exactly as today.
    - For a project key, saving a version makes it the active one. There is no separate "switch on" step, because the project owner is the author.
- **`AiProjectFile`:** `projectId, name, mime, sizeBytes, driveFileId (original), text, tokenCount, tokenMethod, pinned (bool, default true), order, uploadedBy, at`.
  - **Originals** go to Drive through `DriveStore.uploadToDrive` with a `StoredFile` row, the same path the book worker files PDFs through.
  - **Ingest:**
    - md/txt/json/csv: as-is.
    - text PDFs: `pdftotext -layout -enc UTF-8`. This is already shelled out to in `activity-sheets/services/pdfTools.ts`; reuse that helper.
    - xlsx: one CSV block per sheet, read with `exceljs` (already a server dependency).
    - **Pre-flight, docx:** `docxConvert` only converts **docx → PDF**; it has no text output. W-1 adds a sibling `docxToText` in the same file, on the same isolated-profile `soffice --headless --convert-to txt:Text (encoded):UTF8` pattern (`jszip` reading of `word/document.xml` is the fallback). It does not reuse `docxToPdf` and then `pdftotext`, because that loses headings and table order.
  - Scanned (image-only) PDFs are refused in v1 with a clear Bangla message. OCR is a later slice.
  - **Token count:** see §13 (b). v1 uses the character estimate, stamps `tokenMethod: "estimate"`, and replaces it with the real count once the file has been sent once.
- **Context budget:** the project page shows instructions + pinned files in tokens, and the estimated cost per message on cache hit and on miss (`priceOf` from `aiPrices.ts`). Warn above 150k tokens; refuse above 400k.
  - **Pre-flight:** the model context windows are not recorded anywhere in the repo. W-1 adds them as config beside `AI_PRICES` and checks them against DeepSeek's model page. If a window is below 400k, the refuse line is that window minus the output limit.
- **Permissions (D-#1208):** new catalogue module `ai_workspace` with actions `use` (whoever the Principal grants) and `admin` (Principal). Project membership decides access within a project.
  - **Pre-flight:** both names are free. Add them in `shared/permissionCatalogue.ts`; the catalogue feeds `PERMISSIONS` in `shared/vocab.ts`.
    - `use`: `teacher: false, office: false, flags: []`. It starts as the Principal's only (PRINCIPAL holds every catalogue action), and the permission matrix can grant it to TEACHER / OFFICE or per person without code.
    - `admin`: `flags: ["LOCKED"]`. Then `skills/_tools/verify_shared_vocab.mjs` must be edited in the same PR: the pinned LOCKED list (currently sixteen) gains `ai_workspace:admin`. Run the verifier, then the server tests.
- **Storage:** not on the corpus/analytics plane, and no joins to identity beyond `userId` for authorship and membership (the ADR-005 firewall test stays green).

## 4. W-2 — Project chat
- **Reuse `AiAssistSession` / `AiAssistMessage` (D-#1201).** Add `projectId` (null for the teacher assistant), so one chat engine serves both. Do not create parallel collections.
  - **Pre-flight, required changes to the reused models:**
    - `AiAssistSession` requires `classLevel` and `subject` and is keyed on `teacherId`. With `projectId` set, those two become optional and `teacherId` means "the person who started the chat".
    - `AiAssistMessage` gains `thinking`, `runAt` and `status` (`queued | sent | answered | failed`), so an off-peak message can wait.
    - `allAssistSessionsPage` (the Principal's `ai_assist:read_all_chats` reader) and the teacher's list must filter `projectId: null`, so project chats do not appear in the assistant screens.
- **Prompt order (D-#1203)** (the cache is the cost control): `[project instructions] → [pinned files in fixed order] → [full history] → [new message]`. This maps onto the live `AiSendInput`: `stablePrefix` = instructions + pinned files, `context` = per-chat attachments, `history`, `variablePart`.
  - Blocks 1–2 must be byte-identical across turns: no dates, ids or user names in them.
  - Add a test that asserts this through `deepseekBody` (already exported for exactly this purpose).
- **No automatic shortening (D-#1204)** (owner ruling: quality first).
  - The whole conversation is re-sent every turn. Because each turn repeats the previous one exactly, nearly all of it is billed at the cache price (Flash: about $0.0012 per turn for 200k tokens of history, at the UNVERIFIED `aiPrices.ts` figures).
  - **Pre-flight:** the assistant keeps only the last 10 turns (`HISTORY_TURNS = 10` in `AiAssistService`). The project chat must not use that limit.
  - A **context meter** in the chat header shows tokens used out of the model's window.
  - At 80% of the window, the app suggests "start a new chat in this project" (the project files and instructions carry over). It never summarizes on its own.
- **Streaming:** stream the reply to the app over SSE, with a Stop button.
  - **Pre-flight, the live `aiSend` cannot stream:**
    - `aiSend` is request/response only: `deepseekBody` sends `stream: false`, the default deadline is 30 s, and the ledger row is written after the whole reply.
    - W-2 adds a streaming send to the provider and router that still writes the `AiUsage` row in the router (from the final usage chunk). This keeps "the ONE place the new features are metered" true. Long thinking replies need a longer deadline than 30 s.
    - SSE works on **web only**: React Native's fetch cannot stream a response body (`app/src/lib/liveEvents.ts`). On Android the reply appears when it is complete, by polling the message status.
    - Send a heartbeat comment on the stream so no proxy idle timeout (prod is behind Cloudflare) cuts a long thinking reply.
- **The three pickers (D-#1205)** (beside the send button, like Claude's model picker). The choice applies from that message on and is remembered per chat.
  - **Model:** DeepSeek Flash / DeepSeek V4 Pro, each showing its price per million tokens.
    - **Pre-flight:** today the model is fixed per FEATURE (`AiFeatureSetting` → `aiRouteFor`). W-2 adds an optional per-call model to `aiSend`, accepted only if it is in `DEEPSEEK_MODELS`.
  - **Thinking:** off / low / high. Starts at the project default.
    - **Pre-flight:** this already exists as `AiSendInput.reasoning`, which DeepSeek maps to `reasoning_effort` `none | low | high`. Nothing new is needed on the provider side.
  - **Run:** **Now** (current price) or **Off-peak** (half price; the message is queued and answered when the off-peak window opens, and the chat shows "queued until 4:00 PM").
- **Price clock** in the chat header and every job dialog:
  - "Peak — full price until 4:00 PM" or "Off-peak — half price until 7:00 AM tomorrow", in Bangladesh time.
  - Computed from DeepSeek's windows: weekday peak 01:00–04:00 and 06:00–10:00 UTC, which is 7–10 AM and 12–4 PM in Bangladesh; weekends are off-peak all day.
  - **Pre-flight:** the windows are already config in `aiPrices.ts` (`AI_PRICES.deepseek.peakUtcHours`, `offPeakFactor: 0.5`, `isPeak()`), and `costUsd` already prices by them. The clock reuses `isPeak()` and adds only a "next change at" helper. There is no second copy of the windows, and a DeepSeek change stays a one-line edit.
  - The prices in that file are still marked UNVERIFIED (owner switch-on step 4).
- **Attach per chat:** a file can be attached to one chat only (not pinned to the project). It sits after the pinned files.
- **Student data:** follows the project's `nameProtection` switch (W-1).
- **Ledger:** feature `workspace_chat`, `projectId`, `sessionId`, `userId` on every `AiUsage` row.
  - **Pre-flight:** `AiUsage` has no `projectId`; it has `refType` / `refId`, and the router stores the session in `refId`. W-1/W-2 add `projectId` (optional, indexed `{projectId, at}`), which `recordAiUsage` and the AI-7 aggregations read.
  - New feature keys join `AI_FEATURES` in `AiSettingService` in the slice that builds them (`workspace_chat` W-2, `workspace_draft` W-3, `workspace_job` W-4). Like every AI feature they default to OFF.
- **Request/reply log (D-#1179). Pre-flight:**
  - `AiExchange` copies the full history into every row (60k characters per turn), and `AiPromptText` keeps at most 200k characters of a prefix.
  - For a project chat that would grow the log quadratically and cut the instructions + files prefix.
  - Workspace rows therefore store the new message + reply and point at the session for the history. The prefix is stored by hash without the 200k cut (or by reference to the policy version + file ids).
  - A row from a project with name protection OFF is flagged `deidentified: false`, because D-#1179's "a row names nobody" only holds when the gate ran.
- **Fallback. Pre-flight:** `AiFeatureSetting.fallback` defaults to ON, which retries on Gemini. Proposed for the workspace features: fallback OFF by default. A chat picked as DeepSeek V4 Pro should not silently answer from another provider and model, and a Gemini answer does not hit DeepSeek's cache. Settle this in W-2's own D-# row.
- **Caps:** per person per day (turns + $), per project per month ($), and the school monthly cap. Refuse before sending.
  - **Pre-flight:**
    - `assertWithinCaps` has per-person-day, per-session, per-feature-month and school-budget caps. It has no per-project cap; W-2 adds one.
    - The per-session turn cap must be `null` for workspace features (the assistant's is 40).
    - **Conflict to settle with the owner:** the school-wide budget (`AiBudgetSetting`, default **$8/month**) covers every capped feature. If the workspace features are capped features, the $10 workspace cap (§11 ruling 2) can never be reached before the school budget stops everything. Either raise the school budget to cover both (e.g. $18), or keep the workspace cap as its own line outside the school budget. Recommended: raise the school budget when the workspace is switched on, so one total still bounds all AI spend.

## 5. W-3 — Drafts, approval, export, pipelines
- **`AiDraft` (D-#1211):** `projectId, title, kind (free | lesson_plan | question_bank | book_chapter | storybook | paper), body (markdown or JSON), version, status (draft | approved), sourceSessionId?, policyHash, createdBy, approvedBy, at`.
  - Editing creates a new version.
  - Approve locks the draft; later changes need a new draft version (the DRAFT → LOCKED convention).
- **Save as draft** from any assistant message. **Revise** sends the draft plus notes to DeepSeek and produces a new version.
- **Export (D-#1210):** docx and PDF with Bangla fonts (Noto Sans Bengali, the house font). **Export makes no AI call and costs no tokens.** It is a few seconds of CPU on the VM, run in the worker so a large export never slows the app.
  - **Pre-flight:** `docxConvert` only does docx → PDF; nothing in the repo turns markdown into docx. W-3 renders the draft to HTML with `markdown-it` (already a dependency), then uses the same isolated-profile `soffice` call with `--convert-to docx` and `--convert-to pdf`.
  - Confirm Noto Sans Bengali is installed for LibreOffice on the VM (`fc-list | grep -i bengali`) before relying on it. The support-book renderer uses Chromium, not LibreOffice, so its fonts prove nothing here.
- **Send to pipeline (D-#1212):**
  - `kind: book_chapter` → the existing support-book patch path: `MergeService.submitPatch({ patch, source, actorId })` (the validator decides).
  - `kind: question_bank` → the existing import contract and harness: `importContentFiles` with one bank JSON (`{stimuli, questions}`) + a curation tag. Permission `question_bank:import`.
  - `kind: lesson_plan` → **exists** (pre-flight, §13 (a)): `importContentFiles` with a plan JSON (`plan_type`) + its rendered Markdown under the same filename stem. This is auto-wrapped by `build_envelope.py` and gated by `validate_import.py`, the same path as the import screen. Permission `lesson_plans:import`.
    - So a `lesson_plan` draft must carry BOTH parts (the plan JSON and its Markdown), not one Markdown body. W-3 stores them as two fields of `body`.
  - Never write around a validator. A refusal is shown to the user (and returned to the job's retry loop, W-4) word for word.

## 6. W-4 — Batch jobs
- **`AiJob`:** `projectId, template (prompt text with {{item}} slots, stored as a versioned AiPolicy under project:<id>:template:<slug>), items[], model, thinking, runAt ("now" | "offpeak"), status, progress, costUsd, createdBy (user or "claude")`. Each item yields one `AiDraft`.
- **`runAt` has NO default (D-#1209)** (owner ruling). The job dialog shows the price clock and both prices side by side ("Now: ~$0.42 · Off-peak: ~$0.21, starts 4:00 PM"), and the user must pick one. The same picker as the chat's Run picker.
- **DeepSeek has no separate batch service.** Its discount comes from time of day, so "off-peak" here means the worker holds the job until the window opens.
- **Pre-flight estimate:** the token count × price table is shown for both run options; the job starts on confirmation.
- **Worker (D-#1213):** a separate process, like `BookBuildWorker`. Mongo-backed queue (no Redis), concurrency 2. Retries a failed item twice with backoff. Validator failures loop back with the error up to 2 times when the draft kind has a validator.
  - **Pre-flight:** follow the live pattern, not just its shape:
    - an entry file under `server/src/workers/`;
    - `worker:ai` / `worker:ai:prod` npm scripts beside `worker:book`;
    - an atomic claim (`findOneAndUpdate` on status, as `claimNextJob` does);
    - progress written to the job document for the app to read (and tailed over SSE on web).
  - Running it on the VM needs a new systemd unit next to the book worker's. That is a deploy change in W-4's PR, listed in its STATUS entry.
  - Exports (W-3) run here too.
- **Off-peak:** `runAt: "offpeak"` holds the job until DeepSeek's off-peak window (`isPeak()` false) for half price. An item that is still running when peak begins is billed at peak; `costUsd` prices each call by its start time.
- **Status:** per item (queued, running, done, failed) plus total cost, with notifications to the creator on finish.

## 7. W-5 — MCP bridge for Claude
- **Endpoint `/mcp` (D-#1214)** on the Hub server (Streamable HTTP, official MCP TypeScript SDK), behind the existing HTTPS host.
  - **Pre-flight:** neither the MCP SDK nor any OAuth server exists in `server/package.json` today. Both are new: `@modelcontextprotocol/sdk`, and the OAuth 2.1 endpoints below built on the Hub's own login and JWT.
  - The VM's Caddyfile serves the API by an explicit `@api` path allowlist. Anything else falls through to the web app's `index.html` with a 200. `/mcp*`, `/oauth*` and `/.well-known/oauth-*` must be added there in the W-5 deploy step, or the connector sees HTML.
- **Sign-in:** OAuth 2.1 (authorization code + PKCE, Dynamic Client Registration) with the Hub login as the identity, restricted to the Principal account. Claude's custom-connector dialog uses this.
- **Tools:** each returns in a few seconds; long work returns a job id.

| Tool | Does |
|---|---|
| `list_projects` | Projects the Principal can see, with token budgets |
| `read_project` | Instructions (current version) + file list with token counts |
| `read_file` | One file's text, by section or character range (keeps Claude's context small) |
| `update_instructions` | Writes a new instructions version |
| `ds_draft` | One DeepSeek draft in a project (prompt + optional file ids + model) → job id |
| `run_batch` | Template + items → job id, with the pre-flight estimate in the reply |
| `job_status` | Progress, failures, cost, cache-hit rate |
| `read_draft` | A draft by id, whole or by section |
| `revise_draft` | Draft + notes → new version (job id) |
| `usage_report` | Spend by project / feature / day |

- **`ds_draft`, `run_batch` and `revise_draft` require `runAt`, `model` and `thinking`, with no defaults (D-#1209).** Claude must ask the Principal which run option to use (now or off-peak) before starting anything long, and state the estimated cost of each.
- **Hub is the master copy of instructions.** Before a task for a project, Claude reads the current instructions with `read_project` and applies them. Claude writes a new version with `update_instructions` only when the Principal approves a change.
- **Tool replies stay small:** summaries and ids, with full text only through `read_draft` / `read_file` by section. Log the size of every reply sent to Claude.
- **Claude never receives the DeepSeek key.** Everything Claude starts is visible in the app under the same project, with `createdBy: "claude"`.
- **The same server works in Claude Code:** `claude mcp add --transport http scd-hub https://<host>/mcp`.

## 8. W-6 — Migration and pilot
- **Import script** from the `scd-central` repo: `canon/refs/*` and workstream files into a chosen project, as pinned files. Dry run first, then apply.
- **Manual upload** for claude.ai Project files not in the repo. The Principal downloads them from claude.ai and uploads them in the app.
- **Pilot project:** to be chosen by the owner later, possibly several at once (§11 ruling 6). Candidates: Project 09 (C1 Bangla lesson plans) or a storybook series.
  - Generate 3 items with DeepSeek in the workspace and compare them against Claude-made ones on the same instructions.
  - The Principal scores them: usable as-is / minor fixes / rewrite.
  - Move the next project only after a pass.

## 9. W-7 — Analytics and guides
- AI-7 gains a per-project view: spend, tokens, cache-hit rate, drafts created, approved and revised, and jobs.
- Help guides: `ai-workspace-projects`, `ai-workspace-chat`, `ai-workspace-drafts`, `ai-workspace-jobs`, and an ops guide for adding the Claude connector.
  - Per D-#973 each slice ships its own guide in its own PR; W-7 checks they are all present and captures the screenshots.

## 10. Efficiency rules (apply in every slice, D-#1215)
- **No new infrastructure:** same VM, same Mongo, same Drive storage. One extra worker process (expect under 200 MB RAM; the VM has about 22 GB free and no swap, so concurrency stays at 2).
- **Disk:** originals in Drive; Mongo holds extracted text only (expect under 1 GB for years). This holds only with the `AiExchange` change in §4. Without it, the log is the largest collection.
- **Cost (without trading away quality):**
  - Fixed prompt prefix and an exact repeat of history each turn, so cache hits stay above 80%.
  - Off-peak option for chats and jobs.
  - Pre-flight estimates before jobs.
  - Output limits per kind are generous and configurable (chat answers 8k, drafts 32k), there only to stop runaways. A reply that hits the limit is thrown as `truncated` by the provider (finish reason other than `stop`), so the UI must offer "continue" rather than show a cut-off draft.
- **Expected spend:** at the Principal + 2 staff and the planned lesson-plan load, about $5–15 a month (an 86k-token prefix costs about $0.0005 per message when cached on Flash; output is most of the cost). These figures use the UNVERIFIED prices in `aiPrices.ts`.

## 11. Owner rulings (2026-11-10)
1. **Access:** the Principal only at launch. `ai_workspace:use` is granted later from the permission matrix (Admin) to the coordinator and others; no code change is needed to widen it. (D-#1208)
2. **Monthly cap:** a workspace cap in the existing AI caps screen (default $10, configurable), with the existing 70% alert. Per-person daily caps exist but stay configurable. (See the §4 conflict with the $8 school budget.)
3. **Thinking:** a configurable default at workspace and project level, plus a per-message picker. Initial default: high. (D-#1206)
4. **Master copy:** Hub holds the master instructions and files; the scd-central repo becomes an archive. Claude reads through the connector and writes only with approval. (D-#1200, D-#1214)
5. **Run time:** no default. Every long task asks "now or off-peak" in the app, and Claude asks the Principal before choosing. (D-#1209)
6. **Pilot:** to be chosen by the owner later; possibly several projects at once.
7. **Model picker in chat:** like Claude's (Flash / V4 Pro), with the Thinking and Run pickers beside it. (D-#1205)
8. **No automatic history shortening.** A context meter and a manual "new chat" suggestion only. (D-#1204)
9. **Name protection:** a per-project switch, OFF for content projects. (D-#1207)

## 12. Gates per slice
Executed verification only:
- shared build, server and app typecheck, jest (`--maxWorkers=2` on the owner's laptop);
- GraphQL documents against the real schema;
- the vocab/permission verifiers when touched (W-1: `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json`);
- the ADR-005 firewall test green.

For W-5, also an end-to-end check: add the connector in Claude, call `list_projects`, and record the result in STATUS.

## 13. Pre-flight record (2026-11-10, against `origin/main` = `origin/dev` content)

**Confirmed as the draft said:**
- `aiSend` is the single metered entry point.
- `AiUsage` holds cache-hit / cache-miss / output / reasoning tokens and the cost.
- `AiPolicy` is versioned, with a policy hash.
- The de-id gate is `deidentify` / `assertDeidentified` (fail-closed).
- `AiAssistSession` / `AiAssistMessage` exist.
- DeepSeek is called on its OpenAI-format endpoint with `reasoning_effort`.
- The prompt order is already `stablePrefix → context → history → variablePart`.
- The peak windows and the half-price factor are already config in `aiPrices.ts`.
- `DriveStore` + `StoredFile` hold originals.
- `BookBuildWorker` is a separate process with Mongo-claimed jobs.
- `MergeService.submitPatch` is the support-book patch path.

**Differs from the draft (corrected above):**
1. `docxConvert` is docx → PDF only. Text ingest (W-1) and markdown → docx export (W-3) are new code on its `soffice` pattern.
2. `AiPolicy.key` is a closed three-value enum. Project and template keys need a widened key rule (W-1).
3. `AiAssistSession` requires `classLevel` / `subject`; the assistant keeps only 10 turns of history; the assistant list pages must filter out project chats (W-2).
4. `aiSend` does not stream (`stream: false`, 30 s deadline). Streaming is new router + provider work, and is web-only (React Native fetch cannot stream) (W-2).
5. The model is chosen per feature, not per call. The model picker needs a per-call override (W-2).
6. `AiUsage` has no `projectId`. It is a new indexed field (W-1/W-2).
7. The `AiExchange` log (D-#1179, which postdates the draft's "builds on" list) copies the full history into every row and cuts prefixes at 200k characters. Workspace rows must reference history instead (W-2).
8. `AiFeatureSetting.fallback` defaults to ON (Gemini). Proposed OFF for the workspace features (W-2).
9. **Cap conflict:** the school budget default is $8/month across all capped features, below the $10 workspace cap. Owner to choose (§4).
10. There is no MCP SDK or OAuth server in the repo. The Caddy `@api` allowlist must gain `/mcp*`, `/oauth*`, `/.well-known/oauth-*` (W-5).
11. The model context windows are not recorded in the repo (W-1 config).
12. Storage wording: "content plane only" was replaced with "not on the corpus/analytics plane". ADR-005's firewall is about the corpus plane; workspace models are platform models.

**(a) Is there a lesson-plan import path for W-3 "send to pipeline"?** **Yes.** `ContentService.importContentFiles` takes a plan JSON (with `plan_type`) + its rendered Markdown under the same filename stem. It auto-wraps them with `build_envelope.py` and runs the full `validate_import.py` gate (`importEnvelope`) before anything is stored. It is gated by `lesson_plans:import` (`importFilesKind` → `plan`). A built envelope on its own is also accepted. So `kind: lesson_plan` is a real pipeline in v1, not export-only. The draft must hold both the plan JSON and its Markdown.

**(b) Is there a JS-side DeepSeek tokenizer, or should W-1 use the character estimate?** **Use the estimate in v1.**
- No tokenizer is in the repo or its dependencies.
- DeepSeek's documented offline tokenizer is a Hugging Face `tokenizer.json` package meant for Python. A JS route would mean adding a Hugging Face tokenizers library and confirming the vocabulary matches the V4 models. That is new weight, and it is unverified, for a number that only drives a budget display.
- So W-1 stamps `tokenMethod: "estimate"`, with characters ÷ 2.6 for Bangla-heavy text and ÷ 4 for Latin text.
- It then corrects each file from the exact counts DeepSeek returns on every call (`prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`, already recorded on `AiUsage`): `tokenMethod: "measured"`.
- Calibrate the ÷ 2.6 ratio on one real Bangla file during the AI-8 bake-off or the W-6 pilot, and record the result in W-1's D-# row.

**Permissions:** `ai_workspace:use` / `ai_workspace:admin` are free. They are added in `shared/permissionCatalogue.ts`, which feeds `PERMISSIONS` / labels / build status in `shared/vocab.ts`. The `verify_shared_vocab.mjs` harness pins the LOCKED list (sixteen today) and the role defaults: a LOCKED `admin` means editing that pinned list in the same PR. Then run the verifier and the server tests.
