# Import contract (narrative)

The machine-readable contract is `docs/import-contract.schema.json` (JSON Schema, Draft 2020-12) —
that file is the source of truth. This page is the human-readable orientation; the operational flow
lives in `docs/import-workflow.md`.

## Shape
One **unified envelope** carries everything into the app: a stable OUTER contract plus a `payload`
selected by `doc_type` ∈ {chapter_plan, session_plan, question, question_set, stimulus}. STATUS:
**LOCKED v1.0** (Project-04, D-#19). `envelope_version` stays `"1.0"` — question + stimulus were
ADDITIVE (new doc_type + branch + `tags.paper_role`), per the outer-contract stability rule.

- **Outer metadata** (indexed, app-owned): `envelope_version`, `doc_type`, `subject`, `class_level`,
  `address` (anchor_word/number/title), `curation_tag`, `pinned_to`, `provenance`
  (source_project/author/content_version/…), `review_status`, `tags`
  (bloom_level/difficulty/topic_tag/**paper_role**/…), and the co-generated `rendered_markdown`.
- **Payload:** for plan doc-types it is the WHOLE Project-03 plan artifact, unchanged. For question and
  stimulus doc-types it is envelope-native and **RATIFIED + LOCKED** (R-IMP5, Project 04) — the closed
  (`additionalProperties:false`) contracts live in `server/import/LOCKED_QuestionPayload_Schema_v1.json`
  and `LOCKED_StimulusPayload_Schema_v1.json`. The envelope's `$defs.{questionPayload,stimulusPayload}`
  are LIGHT marker-gates; full closure is enforced by the harness L2 pass. Questions/stimuli are
  app-rendered (no `rendered_markdown`).

## Validation (the gate)
`server/import/validate_import.py` enforces the contract at the boundary:
- **L1 — envelope schema:** outer contract + `doc_type` discriminator + light payload marker.
- **L2 — payload schema:** full closed validation, dispatched by `doc_type` — plan →
  `LOCKED_C5_PlanSchema_v1.json`, question → `LOCKED_QuestionPayload_Schema_v1.json`, stimulus →
  `LOCKED_StimulusPayload_Schema_v1.json` (all next to the harness; resolved by glob).
- **L3 — consistency:** envelope indexed copies must agree with the payload (plan: subject/class_level/
  curation_tag/address/pinned_to; question: `tags.{bloom_level,difficulty,topic_tag,paper_role}`).
- **L4 — question semantics:** marks sums (per-blank/pair/step); `ref19_topic_id` must be in the REF-19
  registry (HARD fail; override the default 121-slug set via `--ref19-registry`); `stimulus_ref` form (WARN).
- **ADV — REF-21 advisory scan:** plan surface only; NEVER blocks (D-#4 / Project-04 decision 5-B).

## Mirrored enums (two-/three-place rule)
The schema and `shared/vocab.ts` MIRROR each other for: Subject, DocType, CurationTag, BloomLevel,
Difficulty, QuestionType, **PaperRole**, ReviewStatus, SourceProject, AnchorWord. Fields surfaced in a
closed payload schema (e.g. `question_type`, `paper_role`) are a THREE-place edit (+ the payload schema).
Changing one place without the others is a bug — follow `/skills/contract-sync`.

## Versioning
- Outer-contract change → bump `envelope_version` + migration (a Principal/design decision).
- New plan kind → additive (doc_type value + schema branch); `envelope_version` stays 1.x.
