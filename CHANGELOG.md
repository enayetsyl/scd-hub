# CHANGELOG

Append-only. One line per meaningful change. Add the short commit hash once committed.
Versioning is by git tag; this file is the human-readable "what shipped" ledger.

## Unreleased
- HR module: design handoff landed (`docs/hr-design.md`) + per-journey PRD (`docs/prd-hr.md`) — staff
  lifecycle pulled forward from roadmap "Deferred ops modules" into the active build (records → attendance
  & leave → payroll → performance/conduct/development → offboarding). Appended decisions D-#22–D-#29;
  updated STATUS (now/next + recent decisions) and roadmap. Design only — no code/contract change yet;
  operational/identity plane, no new corpus→identity path (ADR-005 firewall unaffected).
- Slice 4: connected frontend (Expo app) — all teacher/principal/office screens per PRD §8 (16 screens, role-gated bottom tabs over native-stacks): Login (J5.1); Content tree + Plan view + PDF (J1.5/J1.7/J1.8); Question bank multi-filter + Preview + Basket→createSet/addQuestionToSet (J2.2/J2.3/J3.1); Set list/detail + Assemble HW/AS/CT + PDF (J3.2/J3.3/J3.4); Tracker list/open/entry (CT score / AS submitted / HW complete) + Summary + wa.me copy-link (J4.1–J4.5, ADR-003); Admin import + user-create + proxy-grant assign/extend/revoke (J1.1/J5.1/J5.4/J5.7). urql + hand-typed TypedDocumentNodes (codegen deferred); JWT in SecureStore/localStorage; Bangla labels from shared/vocab (NFR-5), English codes on forms; write-scope ForbiddenError→Bangla message. tsc --noEmit clean; web bundle compiles green (expo export, 471 modules). NativeWind v4 present but transform disabled (Windows/Metro perf — re-enable steps inline). [45fe2eb 9210cd1 3e31a17]
- Slice 3: trackers (J4 end-to-end) — TrackerRecord model (open/closed, entries per student de-identified via sha256, CT score/AS submitted/HW complete fields); openTracker/recordEntry/closeTracker mutations (write-scope via assertCanWrite, J4.5); tracker/trackers/trackerSummary queries; waLink query (pure wa.me deep-link builder, J4.2, ADR-003); tracker_recorded CorpusEvent (de-identified, ADR-005); J4.1–J4.5 tests; 124/124 pass, tsc clean, vocab verifier green. [ca85ddc 4f5e828 c67454b]
- Slice 2: question bank + assembly (J2+J3 end-to-end) — AssessmentSet model (draft→assembled, basket items, CT/HW/AS metadata); questions/question/stimuli queries (tag-filter over ContentArtifact, subject/classLevel/topicTag/questionType/bloomLevel/difficulty/paperRole/marks filters); createSet/addQuestionToSet/assembleSet mutations (write-scope via assertCanWrite, J3.5); PDF route GET /pdf/set/:id (structured pdfkit renderer, NotoSansBengali); J2.1–J2.4 + J3.1–J3.2 + J3.5 tests; 92/92 pass, tsc clean, vocab verifier green. [e1db6d7]
- Slice 1: content import + view + PDF (J1 end-to-end) — CorpusEvent/ImportBatch/ContentArtifact models, ContentService (Python harness via child_process, version-flip), importEnvelope mutation + contentTree/contentArtifacts/artifact queries, PDF route GET /pdf/artifact/:id (pdfkit + NotoSansBengali), Bangla PDF smoke + J1.1–J1.4/J1.9/J1.5/J1.6 tests; 62/62 pass, tsc clean, vocab verifier green. [233e950]
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
