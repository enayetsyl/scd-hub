# Consult-via-human note → Project 04 — `model_answer` on descriptive questions

**From:** SCD Hub (software / system of record + runtime), via the Principal
**To:** Project 04 — Question Bank (spec/design; owner of the ratified question payload)
**Re:** `LOCKED_QuestionPayload_Schema_v1.json` · **the `descriptive` answer-carrier branch**
**Channel:** consult-via-human (neither side edits the other's governance)
**Status:** amendment in effect in SCD Hub, awaiting Project-04 confirmation or correction
**Date raised:** 2026-08-23 · **SCD Hub ref:** DECISIONS D-#528 (adoption was D-#19 / D-PROJ04-005)

---

## 1. What we adopted
SCD Hub adopted the Project-04 LOCKED question/stimulus data contract by ADR (D-#19) and runs it as the
harness L2-for-questions pass. It has gated every question import since. This note records **one
amendment** to the `descriptive` branch, made under the Principal's ruling and recorded here for
Project 04's ruling.

## 2. What we changed
v1.0 requires a `rubric` on every `descriptive` item and forbids `answer_key`:

```json
"if":   { "properties": { "question_type": { "const": "descriptive" } } },
"then": { "required": ["rubric"],
          "properties": { "options": false, "tf_answer": false,
                          "blanks": false, "pairs": false, "answer_key": false } }
```

SCD Hub now runs:

- a new optional payload property **`model_answer { text, key_points? }`** — teacher-facing marker
  guidance, never machine-matched; the open-item counterpart of `answer_key.model_note`;
- the descriptive branch relaxed from `required: ["rubric"]` to
  **`anyOf: [ {required:["rubric"]}, {required:["model_answer"]} ]`** — a rubric, a model answer, or both;
- `model_answer` **forbidden** on all five other `question_type` branches (the QDN-04 xor is preserved,
  not widened — `descriptive` is simply the one branch with two legal carriers);
- an added L4 harness message, because the raw schema `anyOf` error reads "not valid under any of the
  given schemas" and dumps the whole payload without naming a field.

`envelope_version` stays `1.0`. No mirrored enum changed, so this was not a vocab sync. v1.0 payloads
validate byte-identically — a rubric-only descriptive item still passes unchanged.

## 3. Why — what the contract met in practice
The C5_BAN_17 Bangla Class-5 question bank (482 items) exposed the gap. 18 items in paper slots 8 and 9
are **রচনামূলক / বড় প্রশ্ন** — broad questions on a comprehension text, each with a definite expected
answer that the teacher marks against. They failed L2 with:

```
payload[]: 'rubric' is a required property
payload['answer_key']: False schema does not allow {'accepted': [...]}
```

The model answer had nowhere to live: `answer_key` is forbidden on the branch, the payload is
`additionalProperties: false` with no `model_answer`/`exemplar`/`notes` field, and `rendered_markdown`
is explicitly not used for question doc-types.

Two things follow, and they are the substance of this note:

1. **v1.0 models `descriptive` as an open-ended REF-09 §5 task** — no single right answer, scored on
   criteria. That is correct for a writing task. But an **exam-bank বড় প্রশ্ন** is a different animal:
   it has an expected answer, and the school's answer key is the deliverable.
2. **Requiring a rubric per item puts non-per-item data in a per-item field.** A 4-band × 3-criteria
   matrix (with the mandatory `islamic_alignment` row) is largely identical across every broad question
   in a bank. Enforced per item across hundreds of items, it produces copy-pasted boilerplate rather
   than considered assessment design — which arguably weakens the standard it exists to uphold.

## 4. What we did NOT change
**The `islamic_alignment` criterion row remains mandatory whenever a rubric is present.** The amendment
relaxes *when* a rubric is required, never *what* a rubric must contain. `$defs.rubric` and
`$defs.criteriaRow` are untouched.

## 5. The open question for Project 04
The Principal's ruling (2026-08-23) was that relaxing the rubric requirement is acceptable. Project 04
may wish to rule on the modeling question underneath it:

- **(a) Accept as-is** — `descriptive` carries either shape, distinguished by which carrier is present.
- **(b) Split the type** — a separate `question_type` for exam-bank broad answers, leaving `descriptive`
  purely open-ended. This is a mirrored-enum change (three-place sync: envelope + `shared/vocab.ts` +
  payload schema) and SCD Hub would need a migration for items already imported under (a).
- **(c) Shared rubric by reference** — keep the rubric mandatory but let items reference a bank- or
  set-level rubric (`rubric_ref`), so the open-item standard survives without per-item duplication.
  This is the option that best preserves the original intent; it is also the most work.

SCD Hub runs (a) until told otherwise.

## 6. Related gap SCD Hub closed at the same time
The stored `rubric` object had **no renderer anywhere** — the answer-key PDF printed
`[বর্ণনামূলক — রুব্রিক দেখুন]` and the app's answer component returned nothing, so the contract pointed
teachers at something the software never showed. Descriptive answers now render in both surfaces. A
rubric-only item still shows the pointer line; rendering the rubric itself remains open work.

## 7. Verification (SCD Hub side, executed 2026-08-23)
11 harness conformance cases across the descriptive branch — model-answer-only, rubric-only (v1.0
regression), both, text-only, neither (rejected), `answer_key` on descriptive (rejected), an unknown
field inside `model_answer` (rejected), and `model_answer` on mcq / true_false / short_answer (all
rejected) — all gate as intended. Shared vocab/RBAC verifier PASS; server typecheck, server Jest suite,
and app typecheck green.
