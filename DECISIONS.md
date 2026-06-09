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
| D-#17 | Supervisory positions (Class Teacher / Coordinator / Subject Lead) are **read-only scope overlays** on the single TEACHER role, not new roles/permissions. Extent is configurable: whole-school, grade/class (all subjects), subject/department (all classes), or an explicit assigned set. | Refines R-AC3 "own classes only": supervisors must read content/questions/plans they don't teach. Same permission set, wider row-scope → no RBAC churn (ADR-004/017). |
| D-#18 | **Proxy / cover teacher** is a bounded **write** scope overlay: for the covered class only, read chapter+lesson plans, `set:assemble` (assign homework), and `tracker:write`. | Cover teachers must operate a class they aren't normally assigned. Write reach is limited to the covered class and is assignment/time-bounded; corpus-plane boundary still overrides (ADR-005/017). |
| D-#20 | **Proxy grants are duration-bounded in days, set at assignment.** The assigner (Principal/Admin) enters N days when creating a proxy/cover grant (matching the absent teacher's leave); the grant is active only within `[start_date, start_date + N days)` and **auto-expires** (window checked at request time, no cron). Early-revoke and extend supported; all assign/extend/revoke/expiry events are audit-logged (R-AC7). | Cover access must mirror a real, finite absence (e.g. 2-day leave → 2-day proxy) and never become standing access. Refines D-#18's "time-bounded"; modeled in `/server` foundation (Slice 0). |
| D-#19 | Adopt the **Project-04 LOCKED question/stimulus data-contract** (D-PROJ04-004/005/006). Additive, `envelope_version` stays `1.0`: `doc_type += stimulus`, `tags += paper_role`, question/stimulus payloads closed in external schemas, harness L2 dispatch + L3 tag-equality + L4 semantics. Mirror now includes **PaperRole** (three-place sync: envelope + vocab + payload schema). Verifier extended to check `paper_role` + `PAPER_ROLE_LABELS_BN`. | Project 04 ratified the question payload (R-IMP5). Applied via contract-sync; full gate green on 11 fixture instances + negative L3/L4 checks. Open follow-ons (non-blocking): authoritative REF-19 registry, `topic_tag` numbering registry. |
| D-#21 | **Proxy-expiry audit event is stamped at request time** (resolves the open detail in D-#20). When a covering teacher's first post-expiry write attempt is denied, the resolver stamps a `PROXY_EXPIRED` audit event with `event_at: now` (the time of the denied request) and `window_ended_at: start_date + duration_days` (the nominal window end). If the grant expires but the covering teacher never attempts access, no `PROXY_EXPIRED` event is written — acceptable because no access occurred. The resolver also marks the grant `proxyStatus: "expired"` at that moment to prevent redundant stamp events. This is consistent with D-#20's no-cron principle applied end-to-end (enforcement + audit both happen at request time). | A lightweight daily sweep for audit-trail-only purposes would add infrastructure complexity (cron, idempotency) for marginal gain: silent expiry (no access attempt) leaves nothing to audit. Request-time stamping is simpler and sufficient. |
