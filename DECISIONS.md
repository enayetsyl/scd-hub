# DECISIONS

Append-only log of repo/initiative-level decisions. Never rewrite a row; append. Out-of-order
numbering is acceptable.

The two pre-existing registers remain authoritative in their docs and are NOT duplicated here:
- Requirements decisions #1–#10  → docs/requirements.md §10
- Architecture decisions ADR-001…016 → docs/architecture.md

New decisions (this repo, post-migration):

| ID | Decision | Rationale |
|---|---|---|
| D-#11 | content:import granted to Principal + Office | Office handles operational data entry; import is an operational publisher action. |
| D-#12 | Repo KB = AGENTS.md (cross-tool) + CLAUDE.md shim + /docs + STATUS/CHANGELOG/DECISIONS + /skills | One source of truth, tool- and account-agnostic, lives with the code. |
| D-#13 | Docs layout Option A: /docs clean names; versioning via git tags + CHANGELOG, not filenames | Filename versions fight git (rename churn, duplicate version truth). |
| D-#14 | STATUS = one lean repo-level file | Small live cursor; "done" lives in CHANGELOG + git. |
| D-#15 | "Done" ledger = in-repo CHANGELOG now; defer Issues/PRs | Every agent reads it from the repo alone, offline, no host API. |
| D-#16 | Skills now = feature-lifecycle, contract-sync, verify-before-commit | Highest-value repeatable SOPs for this architecture. |
