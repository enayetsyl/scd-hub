# Import contract (narrative)

The machine-readable contract is `docs/import-contract.schema.json` (JSON Schema, Draft 2020-12) —
that file is the source of truth. This page is the human-readable orientation; the operational flow
lives in `docs/import-workflow.md`.

> **Contract v1.1 — 2026-08-15.** Adds the `question_batch` doc-type (batch import). Ruled by the
> Principal on 2026-08-15. **Every v1.0 shape is unchanged and still accepted**: this release is
> purely additive, and a v1.0 envelope validates byte-identically before and after. `envelope_version`
> remains `"1.0"` (see Versioning). This file is vendored back into **scd-central**.

## Shape
One **unified envelope** carries everything into the app: a stable OUTER contract plus a `payload`
selected by `doc_type` ∈ {chapter_plan, session_plan, question, question_set, stimulus,
**question_batch**}. STATUS: **v1.1** (batch import, 2026-08-15); v1.0 LOCKED (Project-04, D-#19).
`envelope_version` stays `"1.0"` — question + stimulus were ADDITIVE (new doc_type + branch +
`tags.paper_role`), and `question_batch` is additive on the same rule.

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

## Batch import — `doc_type: "question_batch"` (v1.1)
A batch of 100+ question items needs **one upload**, so v1.1 adds a WRAPPER doc-type. The wrapper
carries no content of its own — no `subject`, `class_level`, `provenance`, `review_status` or
`payload` — only `batch` metadata and an `items` array:

```json
{
  "envelope_version": "1.0",
  "doc_type": "question_batch",
  "batch": { "bank_id": "...", "bank_version": "...", "item_count": 110, "digest": "..." },
  "items": [ /* N standard question envelopes, each exactly the shape single import accepts */ ]
}
```

`batch.digest` is optional; `bank_id`, `bank_version` and `item_count` are required.

**Whole-batch rejection** (nothing imported, no rows written) on exactly three conditions:
- `items` is absent, not an array, or empty;
- `batch.item_count` ≠ `items.length` — *the wrapper is self-describing or it is rejected*;
- `items.length` > **500** (the size guard; split the upload).

A **nested** `question_batch` inside `items` is also rejected whole — a batch is one level deep by
construction. Everything else about an element is deliberately left to the per-element pass.

**A batch carries whatever the bank produced — `stimulus` elements included** (D-#498). A Project-04
bank is a `{stimuli, questions}` collection, and `build_question_envelopes.py` fans out one envelope
per stimulus *and* per question; splitting the stimuli back out into separate uploads would defeat
the point of batching. The doc-type name is therefore narrower than its contents by design. Stimulus
elements take the same unchanged single-envelope path and supersede on `stimulus_id`, exactly as they
do when imported alone.

**Producing one:** `build_question_envelopes.py --batch [--bank-id ID] [--bank-version V]` wraps the
envelopes it already builds. `item_count` is computed by the builder (never author-supplied) and
`digest` is a real sha256 over the canonical `items` JSON; `bank_id` falls back to the source
filename stem. Without `--batch` the builder still emits a bare array, so the pre-v1.1 flow is
untouched.

**Per-element, NOT all-or-nothing.** Each element is handed to the *unchanged* single-envelope import
path — same schema gate, same payload closure, same L3/L4 passes, no new per-item validation logic.
A bad element fails **alone** with its reason; its siblings still import. The `items` element marker
in the schema is intentionally the loosest possible one for this reason: tightening it would silently
convert per-item failures into whole-batch rejections.

**One `batchId` per upload.** The wrapper gets a single `ImportBatch` row; that id is stamped on
every imported item's artifact (`importBatchId`) and on each element's own audit row
(`parentBatchId`), so an upload is traceable in both directions.

**Response**: per-element verdicts — `imported` / `skipped` / `failed(reason)` — keyed by `qid`, plus
the summary tallies (`itemsTotal` / `itemsPassed` / `itemsFailed`) and the `batchId`.

**Duplicate handling** is *not* new behaviour: a re-imported `qid` follows the existing single-import
rule exactly. That rule was read off the live import path (`persistEnvelope`, R-C7
supersede-not-overwrite), not assumed: the version key is
`{docType:"question", envelopeJson.payload.qid, current:true}`; a matching current row is flipped to
`current:false` and a **new** artifact is created with `priorVersionId` pointing at it. So a
re-imported item is a **version bump** — never an overwrite, never a second live row. Version history
grows; the count of `current:true` rows per qid stays at one. Such elements report `imported` with
`superseded: true`.

## Validation (the gate)
`server/import/validate_import.py` enforces the contract at the boundary:
- **L1 — envelope schema:** outer contract + `doc_type` discriminator + light payload marker.
- **L1b — `question_batch` wrapper (v1.1):** `batch.item_count` vs `items` length + the 500-item size
  guard. Batch doc-type only; both are whole-batch FAILs.
- **L2 — payload schema:** full closed validation, dispatched by `doc_type` — plan →
  `LOCKED_C5_PlanSchema_v1.json`, question → `LOCKED_QuestionPayload_Schema_v1.json`, stimulus →
  `LOCKED_StimulusPayload_Schema_v1.json` (all next to the harness; resolved by glob).
- **L3 — consistency:** envelope indexed copies must agree with the payload (plan: subject/class_level/
  curation_tag/address/pinned_to; question: `tags.{bloom_level,difficulty,topic_tag,paper_role}`).
- **L4 — question semantics:** marks sums (per-blank/pair/step); a `descriptive` item must carry a
  `rubric` or a `model_answer` (HARD fail — the payload schema gates it too, this restates it in
  actionable terms); `ref19_topic_id` must be in the REF-19 registry (HARD fail; override the default
  121-slug set via `--ref19-registry`); `stimulus_ref` form (WARN).

### Answer carriers (one per `question_type`, QDN-04 xor)
`mcq → options`, `true_false → tf_answer`, `fill_blank → blanks`, `matching → pairs`,
`short_answer → answer_key`, `descriptive → rubric and/or model_answer`. Every other carrier is
forbidden on each branch. **`descriptive` is the one branch with two legal carriers** (v1.1, D-#529):
a `rubric` for an open-ended REF-09 §5 task, a `model_answer` for an exam-bank বড় প্রশ্ন that has a
definite expected answer, or both. `model_answer` is teacher-facing marker guidance — it is never
machine-matched, and it is forbidden on all five other branches. When a rubric IS present its
mandatory `islamic_alignment` criterion row is unchanged; the amendment relaxed only *when* a rubric
is required, never *what* a rubric must contain.
- **ADV — REF-21 advisory scan:** plan surface only; NEVER blocks (D-#4 / Project-04 decision 5-B).

## Mirrored enums (two-/three-place rule)
The schema and `shared/vocab.ts` MIRROR each other for: Subject, DocType, CurationTag, BloomLevel,
Difficulty, QuestionType, **PaperRole**, ReviewStatus, SourceProject, AnchorWord. Fields surfaced in a
closed payload schema (e.g. `question_type`, `paper_role`) are a THREE-place edit (+ the payload schema).
Changing one place without the others is a bug — follow `/skills/contract-sync`.

## Versioning
- Outer-contract change → bump `envelope_version` + migration (a Principal/design decision).
- New plan kind → additive (doc_type value + schema branch); `envelope_version` stays 1.x.
- **Contract doc version vs `envelope_version`** — these are two different numbers, and v1.1 is the
  first release where they visibly differ. The *document/contract* revision is **v1.1**; the on-the-wire
  `envelope_version` field stays the string **`"1.0"`**, exactly as it did when `question` and
  `stimulus` were added, because `question_batch` is additive. Producers (scd-central) must keep
  emitting `"1.0"`; `"1.1"` is **not** accepted as an `envelope_version` value.

## Change log (this contract)
| Version | Date | Change |
|---|---|---|
| v1.0 | 2026-06-09 | LOCKED (D-PROJ04-005). Plan doc-types + ratified question/stimulus payloads. |
| v1.1 | 2026-08-15 | Additive: `doc_type: "question_batch"` — one upload wrapping N standard question envelopes. Principal ruling, 2026-08-15. v1.0 shapes unchanged and still accepted. |
| v1.1 | 2026-08-16 | Clarification (no wire change): a batch may carry `stimulus` elements alongside questions (D-#498), and `build_question_envelopes.py --batch` emits the wrapper. |
