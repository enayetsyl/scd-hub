# STATUS

_Updated: 2026-06-09_

## Now / next
- Repo bootstrap: migrate files to the §5 layout, scaffold KB + skills (this handoff).
- After bootstrap: write the **lightweight PRD** (first-priority slice: per-role journeys +
  acceptance criteria) — feeds the NFR-11 e2e tests.

## In flight
- (none — bootstrap is the active task)

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
