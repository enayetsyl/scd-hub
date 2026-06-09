# Import contract (narrative)

The machine-readable contract is `docs/import-contract.schema.json` (JSON Schema, Draft 2020-12) —
that file is the source of truth. This page is the human-readable orientation; the operational flow
lives in `docs/import-workflow.md`.

## Shape
One **unified envelope** carries everything into the app: a stable OUTER contract plus a `payload`
selected by `doc_type` ∈ {chapter_plan, session_plan, question, question_set}.

- **Outer metadata** (indexed, app-owned): `envelope_version`, `doc_type`, `subject`, `class_level`,
  `address` (anchor_word/number/title), `curation_tag`, `pinned_to`, `provenance`
  (source_project/author/content_version/…), `review_status`, and the co-generated `rendered_markdown`.
- **Payload:** for plan doc-types it is the WHOLE Project-03 plan artifact, unchanged. For question
  doc-types it is envelope-native and PROVISIONAL pending Project 04 (R-IMP5).

## Validation (the gate)
`server/import/validate_import.py` enforces the contract at the boundary:
- **L1 — envelope schema:** outer contract + `doc_type` discriminator.
- **L2 — payload schema:** for plan doc-types, validate the payload against the Project-03 plan schema
  (pass `--plan-schema`; not stored in this repo — see `docs/import-workflow.md` "Known gap").
- **L3 — consistency:** the envelope's indexed copies must agree with the payload.
- **ADV — REF-21 advisory scan:** logs possible curation triggers; NEVER blocks (D-#4).

## Mirrored enums (two-place rule)
The schema and `shared/vocab.ts` MIRROR each other for: Subject, DocType, CurationTag, BloomLevel,
Difficulty, QuestionType, ReviewStatus, SourceProject, AnchorWord. Changing one without the other is
a bug — follow `/skills/contract-sync`.

## Versioning
- Outer-contract change → bump `envelope_version` + migration (a Principal/design decision).
- New plan kind → additive (doc_type value + schema branch); `envelope_version` stays 1.x.
