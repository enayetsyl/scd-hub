# PRD — AI Assist: DeepSeek provider, metered usage, comment checker, teacher assistant, Principal analytics

**Status:** DRAFT (build contract) · **Owner:** Principal (SCD) · **Audience:** teachers (checker, assistant), Principal (rules, analytics)
**Decisions:** D-#1090 – D-#1105 (planning placeholders D-#AI-1 … D-#AI-9 renumbered against the live `DECISIONS.md` on 2026-11-08; dev's highest was D-#1084, and D-#1085–#1089 are left free for parallel sessions).
**Plane:** operational. Every prompt is DE-IDENTIFIED before it leaves the VM (extends D-#399; D-#1094). No corpus path; the ADR-005 firewall test stays green.

| D-# | Decision (short) | Section |
|---|---|---|
| D-#1090 | One provider interface; DeepSeek via the OpenAI-format endpoint; Gemini stays as fallback | §3 |
| D-#1091 | One usage ledger, written only by the provider wrapper | §4 |
| D-#1092 | Caps refuse BEFORE sending | §4 |
| D-#1093 | Versioned AI rule documents; every result stamps the hash | §5 |
| D-#1094 | De-identify before any prompt leaves the VM | §6 |
| D-#1095 | The checker never changes what guardians receive without the teacher's choice | §7 |
| D-#1096 | `ai-assist` is separate from the human `chat` module | §8 |
| D-#1097 | Build order | §2 |
| D-#1098 | Model choice by bake-off on real comments | §2 (AI-8) |
| D-#1099 | Check runs on both the button and Save | §10.1 |
| D-#1100 | Fail-open: a teacher can always submit unchecked | §10.2 |
| D-#1101 | Sylhet only, behind a switch (this deployment = Sylhet; see pre-flight P2) | §10.3 |
| D-#1102 | Seed standard proposed by Claude Code from de-identified data, approved by the owner | §5.1, §10.4 |
| D-#1103 | Monthly caps $3 / $5 / $8, 70 % alert, daily defaults, all editable | §10.5 |
| D-#1104 | Teacher sees own assistant chats; Principal sees all | §10.6 |
| D-#1105 | Chats kept indefinitely; a Principal delete option comes later | §10.7 |

## Pre-flight against the live repo (2026-11-08, origin/dev `2d9d9350`)
Where the planning document and the live repo disagreed, the live repo wins; the sections below are already adjusted.

- **P1 — Class-test performance comments ALREADY EXIST (answers the §10 open item).** They are three free-text fields on `ClassTestResult` (`server/src/modules/trackers/models/ClassTestResult.ts`), entered per child on `ClassTestResultsScreen` (`app/src/screens/classtest/ClassTestResultsScreen.tsx`) through `enterClassTestResult` (`ClassTestResultService`):
  - `weakness`: guardian-facing ("what was weak");
  - `guardianAction`: guardian-facing ("what the guardian should do");
  - `teacherAction`: INTERNAL, never shown to a guardian (J7/D-#68, D-#161).
  The mark percentage is derived at read time from `marks / totalMarks` (D-#85), so the checker can send the percentage without the name. An ABSENT row carries no marks and no comments (`enterResult` refuses them, #1373). Guardians see a result only after the CT-8 gate (teacher submits; Office/Principal release, D-#277), so a second human already stands between the checker and the guardian. **Still open for the owner:** check all three fields (recommended: `teacherAction` too, since the "no নিয়মিত in teacher-action sentences" rule is about it) or only the two guardian-facing ones.
- **P2 — The repo has no "branch".** This is a single-school deployment (the Sylhet school); no model carries a `schoolId` or `branchId` (D-#140, D-#145). So "per-branch switch" becomes **one on/off switch per AI feature on this deployment**, default OFF, switched on by the Principal. `AiUsage.branch` is filled from a server config value (`SCHOOL_BRANCH`, default `"sylhet"`), so a future multi-branch deployment can split costs without a migration. No `schoolId` is added anywhere.
- **P3 — Permissions: nothing in the catalogue fits AI analytics.** The only AI action is `system_health:ai_key` (LOCKED, Principal-only: the Gemini key and model, D-#967). Two live rules override the planning text's "reuse an existing permission if one fits": D-#799 (every new feature registers ALL its actions; a CI source scan enforces it) and D-#861 (every report is a `reports:*` switch in the Reports hub). Proposed, to be fixed at each slice's build:
  - AI-1: **extend** `system_health:ai_key` to cover every provider's key, the per-feature model choice, the feature switches and the caps (relabel "এআই কী ও মডেল"; it stays LOCKED);
  - AI-3: `ai_assist:edit_rules` (Principal-only); reading the active standard rides the teacher's use permission;
  - AI-5: `ai_assist:check_comment` (teacher default ON);
  - AI-6: `ai_assist:chat` (teacher default ON) and `ai_assist:read_all_chats` (Principal-only, LOCKED, per D-#1104);
  - AI-7: **one new report switch `reports:ai_usage`** (Principal-only by default, Office OFF, because it names teachers and spend).
  Each lands with the catalogue, `shared/vocab.ts` mirror, verifier and README updates (contract-sync).
- **P4 — Four Gemini callers, not two.** Besides `CommentProvider` (monthly comments, `MonthlyCommentService`) and `AuthorProvider` (book author, SB-6, `BookAuthorChatService`), the live repo has `RotaProvider` (observation rota, `ObservationRotaService`) and the voice-task call (`VoiceTaskService`, audio sent as `inline_data`). All four read the key through `AiSettingService` (D-#967). "Nothing ships unmetered" (AI-2) therefore means adapting all four onto the wrapper. Voice tasks send audio, so they stay Gemini-only (no DeepSeek path) but are still metered.
- **P5 — `AiSetting` today** is ONE row (`name: "gemini"`: encrypted key, last 4, model), held in memory, reloaded on save and refreshed after 60 s; the key is tested against Google on save. AI-1's "one row per provider" fits this shape: add rows keyed by provider and keep the `gemini` row as it is.
- **P6 — De-identification today is STRUCTURED, not free text.** D-#399's `assertDeidentified(facts)` (`MonthlyCommentService`) guards a facts object that never contained a name. AI-4 is new: a free-text token swap. It must still end in the same fail-closed style: after the swap, if any roster name in scope is still found in the outbound text, the call is refused, not sent.
- **P7 — The SB-6 prefix precedent is live.** `AuthorProvider.send({ policyPrefix, variablePart, … })` already splits the stable prefix from the variable part, and `supportBookAuthorChat.test.ts` ("the policy prefix — cacheability is the feature") asserts prefix stability. AI-1's interface mirrors that split.
- **P8 — `AiPolicy` vs support-book `PolicyDoc` (D-#403).** `PolicyDoc` is the support-book programme's governance store with its own `POLICY_DOC_KEYS`. AI-3 uses a separate `AiPolicy` collection (different readers, editors and keys); it may copy `PolicyDoc`'s versioning pattern.
- **P9 — Comment shapes.** A new field on `StudentComment` must also appear on the GraphQL shapes `StudentCommentShape` / `AuthoredCommentShape` (`StudentCommentService`); the D-#886 lesson was that adding it to one but not the other breaks part of the app.
- **P10 — Unverified vendor facts.** The DeepSeek model ids (`deepseek-flash`, `deepseek-v4-pro`), the cache-token field names and the peak/off-peak prices are from the planning session and were NOT checked against DeepSeek's live documentation here. AI-1 confirms them before writing the price table.

## 0. One-screen summary (checklist)
- [ ] **AI-1 Provider foundation (D-#1090):** add DeepSeek next to Gemini behind ONE provider interface; keys and model are set by the Principal in the app (extends D-#967). Gemini stays as the fallback.
- [ ] **AI-2 Usage ledger and caps (D-#1091, D-#1092):** every AI call in the app writes one `AiUsage` row (who, feature, model, tokens, cost). Caps are per teacher per day, per feature per month, and global per month. Nothing ships unmetered, including the four existing Gemini callers (P4).
- [ ] **AI-3 AI rules store (D-#1093):** versioned Principal-edited rule documents ("comment standard", "assistant rules"). Every AI result stamps the version hash.
- [ ] **AI-4 De-identification (D-#1094):** one helper that swaps roster names, phones and roll numbers for tokens before sending and restores them after.
- [ ] **AI-5 Comment checker (D-#1095):** a "Check" step on the daily `StudentComment` (complaints = `sentiment: CONCERN`, D-#400) and on the class-test comment fields on `ClassTestResult` (P1). DeepSeek returns issues plus a corrected version; the teacher accepts or edits.
- [ ] **AI-6 Teacher assistant chat (D-#1096):** a new `ai-assist` module, separate from the human `chat` module. Teachers pick class, subject and chapter, then ask; answers are grounded in that chapter's session plan and source text.
- [ ] **AI-7 Principal analytics:** usage and cost by teacher, feature, day and model; cache-hit rate; cap hits; comment-quality trends per teacher.
- [ ] **AI-8 Bake-off and switch-on (D-#1098):** 50 real past comments through DeepSeek Flash vs Gemini Flash; pick per feature by issues caught per dollar, then enable.
- [ ] Every slice: help guide in the same PR (D-#973); growing lists paged from v1 (D-#761); permissions registered (D-#799, P3); one CHANGELOG line per change.

## 1. Goal
Give teachers two AI aids, a comment checker and a lesson-planning assistant, at low and predictable cost. The Principal must see exactly who used how much, and what it cost. Comments reach guardians only after a human has seen the AI's suggestions.

## 2. Build order and why (D-#1097)

| # | Slice | Depends on | Why this position |
|---|---|---|---|
| AI-1 | Provider foundation | — | Everything calls models through it |
| AI-2 | Usage ledger + caps | AI-1 | Metering must exist before any feature can spend |
| AI-3 | AI rules store | — (parallel with AI-2) | Checker and assistant both need versioned rules |
| AI-4 | De-identification helper | — (parallel) | Required before any prompt with a child in it |
| AI-3s | Seed standard proposal (§5.1) | AI-3, AI-4 | Owner approves a standard built from real comments and marks |
| AI-5 | Comment checker | AI-1..AI-4, AI-3s approved | Smallest, highest-value feature; structured input |
| AI-8 | Bake-off, then switch-on of AI-5 (D-#1098) | AI-5 | Choose model on real data before teachers use it |
| AI-6 | Teacher assistant chat | AI-1..AI-4 | Larger UI; reuses everything above |
| AI-7 | Principal analytics | AI-2 (data), AI-5/6 (features) | Reads the ledger; most useful once features run |

Each slice is its own branch off `dev`, its own PR, and its own D-# rows. AI-7's read model can start right after AI-2, but its screens land last.

## 3. AI-1 — Provider foundation (D-#1090)
- **One interface** for chat-style calls: `send({ stablePrefix, variablePart, history?, json?, maxOutputTokens, reasoning: "off"|"low"|"high" }) → { text, json?, usage, resolvedModel, finishReason }`. Keep the existing `CommentProvider`, `AuthorProvider` and `RotaProvider` callers working (P4); adapt them onto it, or wrap it, without breaking their tests. The voice-task call (audio) stays a Gemini-only path but goes through the same metering (AI-2).
- **DeepSeek** through the OpenAI-format endpoint `https://api.deepseek.com`, models `deepseek-flash` (default) and `deepseek-v4-pro` (ids to be confirmed, P10). The OpenAI format is used because it reports `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
- **Prompt order is the cache:** stable prefix first and byte-identical (rules, samples; no dates, ids or names), then context, then history, then the new input. Add a test that asserts the prefix is byte-identical across calls (the SB-6 precedent, P7).
- **Settings:** `AiSetting` grows from one `gemini` row to one row per provider, plus a per-feature choice (feature → provider + model) and the feature switches (P2). Test the key and model on save (D-#967 behaviour). Keys live only in the DB (encrypted as today) or `.env`, never in the repo. Edited under the extended `system_health:ai_key` (P3).
- **Fallback:** if the chosen provider errors or times out, try the fallback provider once, and record both attempts in the ledger.
- **Reject truncated output:** any finish other than a normal stop is an error (the CommentProvider lesson).

## 4. AI-2 — Usage ledger and caps (D-#1091, D-#1092)
- **`AiUsage` collection, one row per provider call:** `at, userId, role, branch (from SCHOOL_BRANCH, P2), feature ("comment_check" | "assistant" | "monthly_comment" | "book_author" | "observation_rota" | "voice_task" | …), refType + refId (the comment or session), provider, model, resolvedModel, policyHash, cacheHitTokens, cacheMissTokens, outputTokens, reasoningTokens (if reported), costUsd, latencyMs, outcome ("ok" | "error" | "fallback" | "capped")`.
- **Written in ONE place** (the provider wrapper), so no caller can skip it (D-#1091).
- **Cost:** from a price table in config (USD per 1M tokens, peak and off-peak; DeepSeek's off-peak is half price, with peak on weekdays 01:00–04:00 and 06:00–10:00 UTC, to be confirmed, P10). Gemini rows use their own price table.
- **Caps (values in §10.5):** per teacher per day per feature, per feature per month, and global per month. A capped call refuses BEFORE sending, with a Bangla message, and writes an `outcome: "capped"` row (D-#1092).
- **Monthly reconciliation script:** sums `costUsd` per provider for a month, to compare against the DeepSeek console.
- **Indexes:** `(userId, at)`, `(feature, at)`, `(at)`.

## 5. AI-3 — AI rules store (D-#1093)
- **`AiPolicy` versioned documents:** `key ("comment_standard" | "assistant_rules" | "ct_comment_standard"), version, body (markdown), examples[], createdBy, createdAt, active`. Edits create a new version; old versions stay readable. Separate from the support-book `PolicyDoc` (P8).
- **Principal-only edit screen** (`ai_assist:edit_rules`, P3); teachers can read the active standard (it doubles as a training sheet).
- **Every AI result stores `policyHash`** (key + version), so "why did it say this" stays answerable later.
- **Known rules to include:** honorific verb forms (পেরেছেন, করেছেন); weaknesses written softly; no "নিয়মিত" in teacher-action sentences (allowed in closing lines); punctuation; structure; the comment must match the marks (no "excellent" on a 40% result).

### 5.1 Seed standard: proposed from real data, approved by the owner (runs after AI-4; D-#1102)
1. **Export.** A read-only script (separate read-only DB user, this deployment only) exports a sample: about 200 recent `StudentComment` rows (both sentiments, spread across teachers and classes) and class-test comments (`ClassTestResult.weakness` / `guardianAction` / `teacherAction`, P1) with each student's mark percentage. Every text passes through AI-4 `deidentify` before it is written to the export file.
2. **Analyse.** Claude Code reads the de-identified export and lists the common problems with counts: missing punctuation, harsh wording, missing honorifics, comments that contradict the marks, missing structure, and so on.
3. **Propose.** Claude Code writes the proposed `comment_standard` and `ct_comment_standard`: rules plus 10 example comments (rewritten, with no real names), each tied to a mark band where it applies. These are saved as INACTIVE `AiPolicy` versions, together with a short memo (`docs/ai-assist/seed-standard-memo.md`): what was found, with counts, and why each rule exists.
4. **Approve.** The owner reviews, edits, and activates the versions in the app. No AI check runs until a standard is active.
5. **Clean up.** The export file stays on the VM or the local machine, is never committed, and is deleted after approval.

## 6. AI-4 — De-identification (D-#1094)
- **`deidentify(text, scope)`** replaces roster names (student, guardian, staff, including known spelling variants), phone numbers, roll numbers and tracker ids with stable tokens (`[S1]`, `[G1]`, `[T1]`). It returns `{ text, map }`. `reidentify(text, map)` restores them.
- **Fail-closed (P6):** after the swap, a final check looks for any in-scope roster name left in the outbound text; if one is found, the call is refused, not sent.
- **Scope** comes from the record being checked (that student and that section) or, in the assistant, the teacher's sections.
- **The map never leaves the server and is never logged with the prompt.**
- **Tests:** Bangla and English names, ব/ভ and ী/ি spelling variants, phone formats, and a name inside a longer word that must NOT be replaced.

## 7. AI-5 — Comment checker (D-#1095)
- **Where:**
  - the daily `StudentComment` composer (complaint = `sentiment: CONCERN`, D-#400; positive comments too);
  - the class-test result entry on `ClassTestResultsScreen`: the `weakness`, `guardianAction` and (owner to confirm, P1) `teacherAction` fields of `ClassTestResult`. This was the planning document's open question; pre-flight found the fields, so nothing new is invented.
- **Flow:** the teacher writes → taps **Check**, or presses **Save** on unchecked text (both trigger the check, D-#1099) → the server de-identifies and sends the comment with the active standard. For class-test comments it also sends the mark percentage (derived, D-#85), never the name, so mismatches are caught → the result returns as `{ issues: [{ type: "punctuation"|"tone"|"honorific"|"structure"|"standard", quote, suggestion }], corrected }` → the screen highlights each issue → the teacher accepts all, accepts some, or keeps their own text → the comment is saved and delivered as before.
- **Settings:** reasoning off, `maxOutputTokens` about 800, JSON mode.
- **Stored on the comment:** `aiCheck: { policyHash, model, issuesFound, issuesAccepted, teacherOverrode, checkedAt }` on `StudentComment` (and its GraphQL shapes, P9) and on `ClassTestResult`. Never store the de-identified prompt.
- **AI down, capped, or skipped:** the teacher can always send (fail-open, D-#1100). The comment is marked "not checked".
- **Delivery is unchanged:** guardians receive exactly the text the teacher saved. Class-test comments still pass the CT-8 release gate (D-#277) as today.

## 8. AI-6 — Teacher assistant chat (D-#1096)
- **New module `ai-assist`.** Not the human `chat` module: different storage, permissions and retention.
- **Session:** a teacher picks class, subject and chapter (and optionally a session). The server loads the chapter's session plan or plans and source text as context. Optional free questions without a chapter use the rules only.
- **Prompt order:** assistant rules (stable) → chapter context (stable within the session) → history → the new question. Each turn re-sends history, so most of it is a cache hit.
- **Guards:** de-identify before sending. On Islamic rulings, hadith or sources, the assistant answers only from approved material and says "আলেমের সাথে মিলিয়ে নিন"; it never invents a reference. Answers are capped at about 1,000 output tokens, with reasoning low.
- **Storage:** `AiAssistSession` and `AiAssistMessage`, paged from v1 (D-#761), kept indefinitely (D-#1105). Teachers see their own sessions; the Principal can read all (D-#1104; teachers are told this on first use).
- **Usage:** each turn writes its `AiUsage` row with `refId` set to the session.

## 9. AI-7 — Principal analytics
- **Usage:** spend and tokens by day, teacher, feature and model; cache-hit rate; average cost per check and per chat turn; cap hits; errors and fallbacks; the count of comments sent "not checked" (D-#1100). Range filter, CSV export, and jump links into the underlying record (the D-#1055 pattern).
- **Comment quality:** per teacher, checks run, issues found by type, acceptance rate, and override rate, over time. This shows where training is needed.
- **Budget view:** month-to-date vs the monthly cap, with a projection to month end.
- **Gate:** one new report switch `reports:ai_usage` in the Reports hub, Principal-only by default (P3; D-#861 rule). No existing permission fits.

## 10. Owner rulings (2026-11-08) and the items still open
**Ruled:**
1. **Check trigger: both (D-#1099).** A **Check** button the teacher can tap at any time, and an automatic check on **Save** when the current text has not been checked yet. Suggestions appear with **Accept** and **Send as written**.
2. **Fail-open (D-#1100).** A teacher can always submit without an AI check: if the AI is down, capped, or the teacher chooses not to wait. The comment is marked "not checked", and the Principal sees that count in AI-7.
3. **Sylhet only (D-#1101).** Every AI feature sits behind a switch, ON for Sylhet and OFF elsewhere. This deployment IS the Sylhet school and the repo has no branch model (P2), so in practice it is one switch per feature on this deployment, default OFF until the Principal turns it on. Usage rows carry `branch` from `SCHOOL_BRANCH`.
4. **Seed standard proposed by Claude Code, approved by the owner (D-#1102)** (see §5.1).
5. **Monthly caps (Sylhet) (D-#1103):** comment checker **$3**, assistant **$5**, global **$8** (the sum of the two). The Principal gets an in-app alert at 70% of any monthly cap.
   - **Daily caps (defaults):** 80 comment checks per teacher per day; 30 assistant turns per teacher per day; 40 turns per assistant session.
   - Every cap is a config value the Principal can change in the app, not a constant.
6. **Who sees assistant chats (D-#1104):** each teacher sees only their own sessions; the Principal can read all; nobody else. Teachers are told this once, on first use.
7. **Retention: keep everything indefinitely for now (D-#1105).** Build NO automatic deletion. A later, separate slice (not part of this build) gives the Principal an in-app delete option: by month, by teacher, or by date range. Design the `AiAssistMessage` storage with `at` and `teacherId` indexed so that later deletion is a simple filtered delete. `AiUsage` rows hold no text and are never deleted.

**Still open:**
- ~~AI-5: where teachers write class-test performance comments today.~~ **ANSWERED by pre-flight (P1):** `ClassTestResult.weakness` / `guardianAction` / `teacherAction`, entered on `ClassTestResultsScreen`. **Remaining owner question:** does the checker cover all three fields, or only the two guardian-facing ones? (Recommended: all three.)
- P3's proposed permission set is a proposal; each slice confirms its actions at build.
- P10: confirm DeepSeek model ids, cache-token fields and prices at AI-1.

## 11. Cost expectation (DeepSeek Flash, peak prices; planning estimates, P10)
- **Comment check:** about 5,500 input tokens (mostly cached) plus about 500 output, roughly $0.0007 each.
- **Assistant turn:** about 22,000 input tokens (mostly cached) plus about 1,500 output, roughly $0.0024 each.
- **Totals:** about $6 a month at 20 teachers; about $35 a month at 60 teachers across three branches. Output is about 80% of cost, so the output caps above are the main control.

## 12. Gates per slice (AGENTS hard rules)
- Executed verification only: shared build, server and app typecheck, jest, the GraphQL documents validated against the real schema, and the vocab/permission verifiers wherever vocab or permissions change.
- The ADR-005 firewall test must stay green: no AI resolver may join the corpus to identity.
- A help guide in the same PR for every new screen (D-#973).
- New permissions registered in the catalogue with default roles and BN/EN labels; the gate scan stays green (D-#799).
