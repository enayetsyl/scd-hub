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
- Running the import gate on the plan example needs the **Project-03 plan schema** (`*PlanSchema*.json`);
  it is not in this repo. Until present, `validate_import.py` can only be run with `--plan-schema`
  pointing at an external copy, or on a non-plan (question) envelope.

## Foundation in place
- Requirements (DRAFT), Architecture/16 ADRs (DRAFT), import-envelope schema (DRAFT, valid),
  import conformance harness (working), worked example (passes), `/shared` vocab + RBAC (verified).

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
  lives in `docs/roadmap.md`. The content authoring → import flow is `docs/import-workflow.md`.
