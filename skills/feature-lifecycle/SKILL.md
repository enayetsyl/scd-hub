---
name: feature-lifecycle
description: Use when adding a new feature or changing an existing one in the school software repo. Covers the end-to-end flow from checking prior decisions through verified commit.
---
# Feature lifecycle

1. Read `STATUS.md` and `DECISIONS.md`. If the change touches a settled decision, STOP and flag it
   (state the decision, what's new, what it affects) — don't silently re-open it.
2. Locate the affected docs (`/docs`) and code. Read the live files before editing.
3. If the change is a real decision, append a row to `DECISIONS.md` (and an ADR to
   `docs/architecture.md` if architectural).
4. Implement with surgical edits (patch, don't regenerate).
5. If it touches the import contract or shared vocab/RBAC, run `/skills/contract-sync`.
6. Run `/skills/verify-before-commit`. Green output is the gate.
7. Update `STATUS.md`; append a `CHANGELOG.md` line. Commit (one change per commit); tag if a milestone.
