# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
- Slice 0: monorepo scaffold — npm workspaces (/shared /server /app), Express + GraphQL Yoga + Pothos + Envelop, Expo web skeleton, urql client. []
- Slice 0: foundation models — User, Guardian, Student, GuardianLink, Class (+auto-Main section), Section, Subject, AcademicYear, ScopeGrant. []
- Slice 0: auth — staff email+password + guardian flexible-identifier (D-#5/#9), JWT, bcrypt, audit-logged login events. []
- Slice 0: scope-grant model + service + authz middleware — teaching/supervisory/proxy grants; canRead/canWrite predicates; proxy window enforced at request time (D-#20). []
- Slice 0: proxy auto-expiry + audit at request time (D-#21); early-revoke + extend supported; all events audit-logged (R-AC7). []
- Slice 0: fail-closed firewall test GREEN — 7 assertions; corpus resolver has no identity imports; 31/31 server tests pass (J5.6, ADR-005). []
- PRD/Access: proxy grants are duration-bounded in days, set by the assigner; auto-expiry + audit (D-#20). [87bad65]
- Contract: adopt Project-04 LOCKED question/stimulus data-contract (D-#19) — envelope v1.0 (additive), vocab v1.0 (+PaperRole, +stimulus), harness v1.0 (L1→L4); verifier extended to check paper_role; 11 fixture instances + negative L3/L4 checks green. [c954ffd]
- Import gate: vendored Project-03 plan schema (server/import/LOCKED_C5_PlanSchema_v1.json); example now passes full L1→L2→L3. [eb877c8]
- PRD: drafted first-priority slice (per-role journeys + acceptance criteria) in docs/prd.md. [d7dc561]
- Access model: TEACHER scope overlays — supervisory read + proxy write (D-#17/#18, ADR-017). [4cefaff]
- Bootstrap: migrated docs/code to /docs, /shared, /server, /skills layout (Option A). [19618c5]
- Added cross-tool KB: AGENTS.md, CLAUDE.md, /shared/AGENTS.md, STATUS, CHANGELOG, DECISIONS. [4f15702]
- Added skills: feature-lifecycle, contract-sync, verify-before-commit. [9715c45]
- RBAC: granted content:import to Office in addition to Principal (D-#11). [19618c5]
