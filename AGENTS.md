# AGENTS.md — School Management Software

Cross-tool agent context. Every agent (Claude Code, Codex/GPT, Gemini, Cursor, Copilot)
reads this file first. `CLAUDE.md` imports it. Keep this file **lean** — it loads on every
request. Detail lives in `/docs` and `/skills`; this is the map and the hard rules.

## What this is
A standalone school management app (MERN / Expo: iOS + Android + Web from one codebase).
It is the **publisher + system of record + delivery + tracking** layer for curriculum content
authored elsewhere. It is **NOT** curriculum governance — do not fold curriculum-Project rules,
policy, or decisions into this repo.

## Start here (before any non-trivial work)
1. Read `STATUS.md` — current state, what's in flight, what's blocked.
2. Read `DECISIONS.md` — settled decisions (append-only ADR log). Do not re-open one without flagging.
3. **Read the live file before editing it.** Never trust a remembered version, a path from an old
   message, or a summary. Open the file, then edit.
4. For a known procedure (new/changed feature, contract sync, pre-commit), load the matching skill
   under `/skills` (see Map).

## Hard rules (non-negotiable)
- **Executed verification is the only gate.** "Done" means a validator/test printed green output in
  this session. An agent's claim that it followed the steps is never the gate. If you can't run the
  check, say so — don't assert success.
- **Patch, don't regenerate.** For existing files, make surgical edits. Full regeneration is only for
  a structural rebuild, and only when asked.
- **Append-only logs.** `DECISIONS.md` and `CHANGELOG.md` are never rewritten — append rows. Out-of-
  order numbering is fine.
- **Two-place contract sync.** A mirrored enum or the import-envelope schema never changes alone:
  edit the schema **and** `/shared/vocab.ts` **and** the harness, then run the verifiers. See
  `/shared/AGENTS.md` and `/skills/contract-sync`.
- **Versioning lives in git**, via tags + `CHANGELOG.md`. Do **not** put version numbers in filenames
  and do not rename files to bump a version.
- **Never commit secrets.** Atlas URIs, tokens, keys → `.env` (gitignored) / secret manager. Context
  files and `/docs` are committed and read by every agent; nothing sensitive goes in them.
- **PII firewall is structural (ADR-005).** The corpus/analytics plane has no path to identity
  (students/guardians/users). Never add an analytics/export permission or resolver that can join back
  to identity. The fail-closed firewall test must keep passing.
- **Language:** English for code, schemas, docs, decisions. Bangla for student-/teacher-facing content,
  with English codes on trackers/forms (see `/docs/glossary.md`).
- **One change at a time.** Don't blend unrelated edits into one batch/commit; each meaningful change
  gets its own `CHANGELOG.md` line.

## Commands
> Fill the app/server rows when those packages are scaffolded; the two verifiers below are live now.

| Purpose | Command |
|---|---|
| Shared vocab/RBAC verifier | `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` |
| Import-envelope conformance | `python server/import/validate_import.py <envelope.json> --envelope-schema docs/import-contract.schema.json [--plan-schema <plan-schema.json>]` |
| Auto-wrap a plan → envelope | `python server/import/build_envelope.py --json <plan.json> --md <plan.md> --envelope-schema docs/import-contract.schema.json --out <envelope.json>` (then run the conformance check above) |
| Typecheck (server) | `npm run typecheck --workspace=server` |
| Typecheck (shared) | `npm run typecheck --workspace=shared` |
| Build shared | `npm run build --workspace=shared` (required before server typecheck if dist/ is stale) |
| Tests (server) | `npm run test --workspace=server` — Jest + Supertest; 31 tests |
| Dev server | `npm run dev:server` (tsx watch) |
| Lint | _TBD_ |

## Repo map ("before doing Y, read X")
```
/AGENTS.md            ← this file (hard rules + map)
/CLAUDE.md            ← thin shim: imports AGENTS.md
/STATUS.md            ← live cursor (small; updated at session end)
/CHANGELOG.md         ← what shipped (append-only; one line per change + commit hash)
/DECISIONS.md         ← why (append-only ADR log)
/docs/
  requirements.md     ← what/why (the REQ)
  prd.md              ← first-priority slice: per-role journeys + acceptance criteria (feeds e2e)
  prd-hr.md           ← HR/staff-lifecycle module: per-role journeys + acceptance criteria (D-#22–#29)
  hr-design.md        ← HR module design handoff (LOCKED source for prd-hr.md)
  prd-tracker-homework.md      ← Homework Tracker build contract: slices HW-T1..T4 + §12 acceptance (D-#33–#35)
  tracker-homework-handoff.md  ← Project-06 Homework-Tracker PRD v1.1 (LOCKED source for prd-tracker-homework.md)
  prd-plan-review.md  ← Plan review/approval loop: assign→review→re-import→sign-off, slices PR-1..3 (D-#38–#40)
  architecture.md     ← how (modules, data planes, the ADRs)
  glossary.md         ← canonical terminology (read before naming anything)
  import-contract.md  ← the envelope contract narrative
  import-workflow.md  ← how content is authored (Claude Desktop) and imported into the app
  roadmap.md          ← deferred pipeline / backlog (build-later work; not the live cursor)
  import-contract.schema.json  ← the wire-contract JSON Schema (a source of truth)
  adr/                ← long-form ADRs if/when they outgrow DECISIONS.md
/shared/              ← cross-cutting source of truth; see /shared/AGENTS.md
  vocab.ts            ← controlled-vocab enums + role→permission map (mirrors the schema)
  index.ts            ← re-exports vocab.ts; built to dist/ for server type resolution
/server/              ← Node/Express + GraphQL Yoga + Pothos + Envelop (Slice 0+)
  src/
    index.ts          ← Express + Yoga entry; /healthz /readyz
    db.ts             ← MongoDB Atlas connection
    schema.ts         ← Pothos builder (RBAC auth-scopes via @pothos/plugin-scope-auth)
    context.ts        ← request context (JWT → AuthPayload)
    modules/
      foundation/     ← auth, roles, org, student roster, guardian, scope grants
        models/       ← User Guardian Student GuardianLink Class Section Subject AcademicYear ScopeGrant
        services/     ← AuthService ScopeGrantService
        resolvers/    ← auth users classes students guardians scopeGrants
      platform/       ← audit log (append-only, ADR-008)
      corpus/         ← analytics plane (NO identity imports — firewall boundary, ADR-005)
    middleware/authz.ts ← assertCanRead / assertCanWrite (RBAC + proxy window + expiry stamp)
    __tests__/        ← firewall.test auth.test scopeGrant.test (31 tests)
/app/                 ← Expo RN (iOS/Android/Web) — Slice 0 skeleton, boots on web
  App.tsx             ← entry point
  src/graphql/client.ts ← urql client
/skills/              ← repeatable SOPs, loaded on demand:
  feature-lifecycle/  ← add or change a feature, end to end
  contract-sync/      ← the two-place enum/schema sync procedure
  verify-before-commit/ ← the executed-verification gate
```

## Session-end ritual
1. Update `STATUS.md` (what changed, what's next, what's blocked).
2. Append a `CHANGELOG.md` line (+ a `DECISIONS.md` row if a real decision was made).
3. Run the relevant verifier/tests — green before commit.
4. Commit with a clear message; tag if it's a version milestone.

## Scope boundary
This repo is the software. Curriculum authoring, policy, and the REF library live in the curriculum
Projects and are **out of scope here**. Cross-Project alignment (e.g. Project 04 question payload) is
coordination, not governance to import.
