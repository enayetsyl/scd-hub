---
name: contract-sync
description: Use whenever a controlled-vocabulary enum or the import-envelope schema changes. Enforces the two-place edit (schema + shared/vocab.ts + harness) and runs the verifiers.
---
# Contract sync (two-/three-place rule)

Mirrored enums: Subject, DocType, CurationTag, BloomLevel, Difficulty, QuestionType, PaperRole,
ReviewStatus, SourceProject, AnchorWord. Changing any of these in one place only is a bug.

Steps:
1. Edit `docs/import-contract.schema.json` (the enum).
2. Edit `shared/vocab.ts` (the matching `as const` array — and labels/maps if surfaced in UI).
3. If the field appears in a CLOSED payload schema, edit it there too (THREE-place sync):
   question fields → `server/import/LOCKED_QuestionPayload_Schema_v1.json`;
   stimulus fields → `server/import/LOCKED_StimulusPayload_Schema_v1.json`.
4. Edit the harness consistency/semantics check in `server/import/validate_import.py` if the field is
   cross-checked there (L3 tags equality; L4 question semantics).
5. Run the verifier (adjust path per repo setup):
   `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json`
   It must print "RESULT: PASS — all checks green".
6. Re-run the import gate on the example(s):
   `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json`
   It must end "RESULT: PASS". For question/stimulus changes, also wrap an instance from
   `docs/examples/LOCKED_QuestionBank_Examples_v1.json` in an envelope and run it.
7. App-native vocab (SetType, TrackerKind, Role, Permission) has no schema twin — edit `vocab.ts` only,
   then still run the verifier (it checks RBAC invariants and label totality too).
