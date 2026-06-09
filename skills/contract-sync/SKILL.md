---
name: contract-sync
description: Use whenever a controlled-vocabulary enum or the import-envelope schema changes. Enforces the two-place edit (schema + shared/vocab.ts + harness) and runs the verifiers.
---
# Contract sync (two-place rule)

Mirrored enums: Subject, DocType, CurationTag, BloomLevel, Difficulty, QuestionType, ReviewStatus,
SourceProject, AnchorWord. Changing any of these in one place only is a bug.

Steps:
1. Edit `docs/import-contract.schema.json` (the enum).
2. Edit `shared/vocab.ts` (the matching `as const` array — and labels/maps if surfaced in UI).
3. Edit the harness consistency check in `server/import/validate_import.py` if the field is
   cross-checked there.
4. Run the verifier (adjust path per repo setup):
   `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json`
   It must print "RESULT: PASS — all checks green".
5. Re-run the import gate on the example:
   `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json`
   It must end "RESULT: PASS".
6. App-native vocab (SetType, TrackerKind, Role, Permission) has no schema twin — edit `vocab.ts` only,
   then still run the verifier (it checks RBAC invariants and label totality too).
