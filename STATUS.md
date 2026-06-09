# STATUS

_Updated: 2026-06-09_

## Now / next
- **Done:** repo bootstrap (migration + KB + skills); **PRD drafted** (`docs/prd.md`, first-priority slice).
- **Next:** build **Slice 0** — monorepo skeleton + auth + identity foundation + the scope-grant model
  (teaching/supervisory/proxy, D-#17/#18) wired into resolver authz, with the fail-closed firewall test green.

## In flight
- (none — awaiting go-ahead on Slice 0 scaffold)

## Blocked / waiting
- (none blocking) — open follow-ons from the Project-04 contract LOCK (D-#19), not blockers:
  - Wire the **authoritative REF-19 registry** via `--ref19-registry` (harness ships a 121-slug default).
  - Upgrade **`topic_tag`** from pattern-only to registry validation once the per-subject numbering lands.

## Foundation in place
- Requirements (DRAFT), Architecture/17 ADRs (DRAFT), **import contract LOCKED v1.0** (envelope +
  question + stimulus + plan payload schemas vendored at `server/import/`), import conformance harness
  v1.0 (L1→L4, working), worked plan example + **11 question/stimulus fixture instances pass the gate**,
  `/shared` vocab v1.0 + RBAC + paper_role mirror (verified).

## Recent decisions
- D-#17/#18: TEACHER scope overlays — supervisory (read-only) + proxy/cover (bounded write).
- D-#19: adopted Project-04 LOCKED question/stimulus contract (additive; mirror now includes PaperRole).

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
  lives in `docs/roadmap.md`. The content authoring → import flow is `docs/import-workflow.md`.
