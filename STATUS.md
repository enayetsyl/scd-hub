# STATUS

_Updated: 2026-06-09_

## Now / next
- **Done:** repo bootstrap (migration + KB + skills); **PRD drafted** (`docs/prd.md`, first-priority slice).
- **Next:** build **Slice 0** — monorepo skeleton + auth + identity foundation + the scope-grant model
  (teaching/supervisory/proxy, D-#17/#18) wired into resolver authz, with the fail-closed firewall test green.

## In flight
- (none — awaiting go-ahead on Slice 0 scaffold)

## Recent decisions
- D-#17/#18: TEACHER scope overlays — supervisory (read-only oversight) + proxy/cover (bounded write).
  See `DECISIONS.md`, ADR-017, R-AC3.

## Blocked / waiting
- Tighten `questionPayload` to `additionalProperties:false` — waits on **Project 04** ratifying the
  question payload shape (external coordination).

## Foundation in place
- Requirements (DRAFT), Architecture/17 ADRs (DRAFT), import-envelope schema (DRAFT, valid),
  import conformance harness (working), Project-03 plan schema vendored at `server/import/`,
  worked example **passes the full L1→L2→L3 gate in-repo**, `/shared` vocab + RBAC (verified).

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
  lives in `docs/roadmap.md`. The content authoring → import flow is `docs/import-workflow.md`.
