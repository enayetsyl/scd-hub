# Content authoring → app import workflow

## Constraint (this phase)
No AI API runs inside the app. Content is authored in **Claude Desktop** (curriculum Projects) and
enters the app by **manual import only**. (Requirements §8.) The app is a publisher, not an author or
a curation gate.

## The unit of transfer: the unified envelope
Everything enters through one envelope (requirements §4, schema at
`docs/import-contract.schema.json`): a stable OUTER contract + a `payload` selected by `doc_type` —
{chapter_plan, session_plan, question, question_set}.
- **Plan doc-types (chapter_plan / session_plan):** the payload is the WHOLE Project-03 plan artifact
  UNCHANGED, carried alongside its co-generated `rendered_markdown`. The app NEVER re-renders — it
  displays/PDFs the Markdown and uses the JSON only for structure/filter/analytics (ADR-006, Option B).
- **Question doc-types:** payload is envelope-native and PROVISIONAL pending Project 04 (R-IMP5).

## Authoring side (Claude Desktop / curriculum Projects)
1. Author/curate the plan or question set in the curriculum Project as today.
2. For plans: run the Project-03 renderer to produce Markdown, then wrap:
   `{ outer metadata (doc_type, subject, class_level, address, curation_tag, provenance, pinned_to,
   review_status), rendered_markdown, payload: <the plan JSON> }`.
   A small wrapper script can be added to the Project-03 toolchain to emit this shape directly.
3. For questions: author directly in the envelope-native question shape.
4. `review_status` is set on the authoring side per the Project-03 REVIEW pass (draft → reviewed → gold).

## Import side (this app, platform module)
5. Manual import of the envelope JSON.
6. Validate at the boundary with `server/import/validate_import.py` (executed checks, not self-graded):
   L1 envelope schema → L2 plan-schema (plan types) → L3 envelope↔payload consistency → ADV REF-21
   advisory scan (logs flags, NEVER blocks — curation authority stays upstream, D-#4).
7. On PASS: persist the artifact (envelope JSON + rendered_markdown + version + curation_tag +
   pinned_to + review_status), write an `import_batches` audit row, and emit a de-identified
   `content_imported` event. Versioning is supersede-not-overwrite (new version = new doc, `current`
   flips). On FAIL: reject and surface the failing checks; nothing is written.

## Coupling (how Project-03 JSON changes propagate here)
- Plan-body change (inside payload) → update the plan schema only; harness L2 follows; envelope unaffected.
- Mirrored-field enum add/rename → two-place edit (schema + shared/vocab.ts + harness) → see
  `/skills/contract-sync`.
- New plan kind → additive: doc_type enum value + allOf branch + marker gate; envelope_version stays 1.x.
- Outer-contract change → envelope_version bump + migration (Principal/design decision only).

## Known gap (procedural guard)
The import gate does NOT re-run Project-03's full Layer-2 (arithmetic/surface/cross-plan) conformance.
Authoritative full conformance is `validate_plan.py` at authoring time. Optional future upgrade: have
`validate_import.py` invoke `validate_plan.py` on the payload as an L2+ pass.
