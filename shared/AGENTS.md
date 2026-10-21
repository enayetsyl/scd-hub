# /shared — agent notes (two-place sync zone)

This package is a SOURCE OF TRUTH. `vocab.ts` (controlled-vocab enums + role→permission RBAC map)
MIRRORS the import-envelope JSON Schema (`/docs/import-contract.schema.json`).

HARD RULE: a mirrored enum never changes in one place. If you add/rename a value in any of
{Subject, DocType, CurationTag, BloomLevel, Difficulty, QuestionType, PaperRole, ReviewStatus,
SourceProject, AnchorWord}, edit BOTH `vocab.ts` AND the schema (AND the import harness consistency
check), then run the contract-sync procedure (`/skills/contract-sync`). The verifier fails CI on drift.

The question + stimulus payloads have their own CLOSED schemas (`server/import/LOCKED_QuestionPayload_Schema_v1.json`,
`LOCKED_StimulusPayload_Schema_v1.json`) — the harness L2 validates payloads against them. A change to a
mirrored field surfaced in those payloads (e.g. `question_type`, `paper_role`) is a THREE-place edit:
envelope schema + `vocab.ts` + the payload schema (+ the harness).

App-native vocab (SetType, TrackerKind, Role, Permission, default section) lives ONLY here.
RBAC here is GRANTS ONLY (default-deny). Row-scope and the PII-firewall plane boundary are enforced
in resolvers (architecture ADR-004/005), not in this file.

Permissions come from a per-feature catalogue (`docs/prd-permission-matrix.md`, D-#790–#801, #805):
`FEATURE_CATALOGUE` in `permissionCatalogue.ts` (the source of truth) → `CATALOGUE_PERMISSIONS`,
`CATALOGUE_ROLE_DEFAULTS`, labels; `vocab.ts` keeps the LEGACY names only to read per-user arrays
stored under them and to answer old app bundles. Code never names a legacy permission (the
source-scanning test fails CI). A new feature adds ALL its actions to the catalogue (D-#799).
