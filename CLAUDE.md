# CLAUDE.md
This project's agent rules live in AGENTS.md. Read it first and follow it.

@AGENTS.md

Claude-Code-specific notes:
- Prefer `git mv` for moves so history follows.
- Run the verifiers in AGENTS.md's command table before claiming a contract change is done.

## Desktop handoff protocol
Planning artifacts arrive as a pasted pair: (1) a document block + (2) a
"Handoff from Claude Desktop" prompt. When you receive one:
- Treat it as a docs-only task; follow its numbered steps in order.
- Pre-flight against the LIVE files first (AGENTS.md rule 3) — the live
  repo always wins over the pasted D-# numbers or STATUS assumptions;
  renumber/adjust and report conflicts, never overwrite.
- Do not start building the feature in the same session; building begins
  separately per STATUS "Now / next".

## Model routing
Start build chats on **Opus** (the lead); see ~/.claude/CLAUDE.md "Model routing".
- Plans: `.claude/plans/<slug>.md` (git-ignored). Planning that must last goes to `docs/prd-*.md`.
- `coder` verifies with: `npm run build --workspace=shared`, `npm run typecheck --workspace=server`,
  and targeted jest (`--runInBand <pattern>`). The full suite uses `--maxWorkers=2` and the lead runs it.
- Lead-only steps: branch/commit/PR to `dev`, the `dev → main` promotion, `eas update` / OTA, VM SSH,
  any prod DB write, and contract files (`shared/vocab.ts`, the import schema).
- `doc-writer`: STATUS / CHANGELOG / DECISIONS rows on Haiku. Help guides and Bangla UI text go on `sonnet`.
- A Desktop handoff (a docs-only task) or a small 1–2 file fix can run start to finish in a **Sonnet** chat.
