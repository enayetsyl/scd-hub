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
