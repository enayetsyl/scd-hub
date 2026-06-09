# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
- Slice 1: content import + view + PDF (J1 end-to-end) — CorpusEvent/ImportBatch/ContentArtifact models, ContentService (Python harness via child_process, version-flip), importEnvelope mutation + contentTree/contentArtifacts/artifact queries, PDF route GET /pdf/artifact/:id (pdfkit + NotoSansBengali), Bangla PDF smoke + J1.1–J1.4/J1.9/J1.5/J1.6 tests; 62/62 pass, tsc clean, vocab verifier green. [TBD]
- Slice 0: monorepo scaffold — npm workspaces (/shared /server /app), root tsconfig, .env.example. [3c8e8ca]
- Slice 0: server — Express+Yoga+Pothos, foundation models (User/Guardian/Student/GuardianLink/Class/Section/Subject/ScopeGrant), auth, scope-grant model+service+authz middleware, fail-closed firewall test GREEN (31/31 pass). [7fefc27]
- Slice 0: app — Expo skeleton boots on web, urql client wired. [0044840]
- Slice 0 docs: D-#21 (proxy-expiry audit at request time), STATUS/CHANGELOG/AGENTS updated. [4cb2187]
- PRD/Access: proxy grants are duration-bounded in days, set by the assigner; auto-expiry + audit (D-#20). [87bad65]
- Contract: adopt Project-04 LOCKED question/stimulus data-contract (D-#19) — envelope v1.0 (additive), vocab v1.0 (+PaperRole, +stimulus), harness v1.0 (L1→L4); verifier extended to check paper_role; 11 fixture instances + negative L3/L4 checks green. [c954ffd]
- Import gate: vendored Project-03 plan schema (server/import/LOCKED_C5_PlanSchema_v1.json); example now passes full L1→L2→L3. [eb877c8]
- PRD: drafted first-priority slice (per-role journeys + acceptance criteria) in docs/prd.md. [d7dc561]
- Access model: TEACHER scope overlays — supervisory read + proxy write (D-#17/#18, ADR-017). [4cefaff]
- Bootstrap: migrated docs/code to /docs, /shared, /server, /skills layout (Option A). [19618c5]
- Added cross-tool KB: AGENTS.md, CLAUDE.md, /shared/AGENTS.md, STATUS, CHANGELOG, DECISIONS. [4f15702]
- Added skills: feature-lifecycle, contract-sync, verify-before-commit. [9715c45]
- RBAC: granted content:import to Office in addition to Principal (D-#11). [19618c5]
