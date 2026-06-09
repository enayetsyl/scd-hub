---
name: verify-before-commit
description: The executed-verification gate. Use before committing or claiming any task done. An agent's claim of success is never the gate; only green tool output is.
---
# Verify before commit

Run the checks relevant to what changed and PASTE THE REAL OUTPUT:
- Shared vocab/RBAC changed → `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json`
- Import contract / harness changed → `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json`
- TypeScript changed → `npx tsc --noEmit`
- App/server code → the package tests (Jest; add Maestro e2e when present)

Rules:
- If a check can't be run, say so explicitly — do not assert success.
- Red output = not done. Fix, re-run, then commit.
- One change per commit; update STATUS.md + CHANGELOG.md as part of the commit.
