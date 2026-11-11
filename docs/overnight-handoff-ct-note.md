# Overnight handoff — class-test weakness note names learning objectives (brief 4)

Branch `claude/dazzling-curie-pxsvx2` (started from `origin/dev` 8d9e5a2; `git merge-base --is-ancestor origin/dev HEAD` passed). Not merged, no PR opened (not allowed from this session). Contract: `docs/prd-ct-weak-objectives.md`; decisions D-#1360–#1364.

## What was built

- **Model** — `ClassTestResult.weakLoCodes?: string[]` (`server/src/modules/trackers/models/ClassTestResult.ts`). No new index (the per-student read is bounded like `childTestResults`).
- **Service** — new `server/src/modules/trackers/services/ClassTestWeakObjectiveService.ts`: `weakLoScope`, `weakLoOptions` (picker list), `validateWeakLoCodes` (≤ 5; tagged LOCKED row of the test's class × subject; Bangla refusals with `masteryLevelLabels()`), `weakLoLabels` (staff), `guardianObjectiveLabels` (guardian, through `objectiveGrain`), `classTestWeakObjectivesPage`.
- **enterResult** (`ClassTestResultService.ts`, additive lines only): new optional input `weakLoCodes` — omitted/null keeps, `[]` clears, ABSENT `$unset`s and refuses picks; validated after the existing published/submitted locks. `ClassTestResultShape.weakLoCodes`; guardian shape gains `weakObjectives` + `weakObjectivesWordBn`, filled after the existing loop with one objective-grain read.
- **GraphQL** — `enterClassTestResult(weakLoCodes: [String!])`; `ClassTestResult.weakLoCodes`, `ClassTestResult.weakObjectives { code labelBn }`; `GuardianClassTestResult.weakObjectives`, `.weakObjectivesWordBn`; new file `resolvers/classTestWeakObjectives.ts` with `classTestWeakObjectiveOptions(testId)` and `classTestWeakObjectivesPage(studentId, subject, page, pageSize)`; registered in `registerResolvers.ts`.
- **App** — new `app/src/components/CtWeakObjectivePicker.tsx` (picker, `useCtWeakLoAvailable`, `CtWeakObjectivesShown`); `ClassTestResultsScreen` (picker under the weakness field + the Office/Principal read-out), `ClassTestResultsViewScreen` (teacher view), `ChildClassTestCards` (guardian line); `graphql/classTest.ts`; five BN/EN labels in `lib/labels.ts` (level word always substituted).
- **Docs** — PRD, DECISIONS D-#1360–#1364, CHANGELOG line, STATUS entry, permission-catalogue table rows (`docs/permission-catalogue/trackers-classtest.md`), help guide `exam-ct-enter-marks` step text + keyword.
- **Tests** — new `server/src/__tests__/classTestWeakObjectives.test.ts` (in-memory Mongo + the real schema; 17 tests covering acceptance 1–6). One existing assertion updated: `classTestResult.test.ts` pins the ABSENT `$unset` document, which now also names `weakLoCodes` (a no-op on rows with no picks).

## Verified (commands + result tails, this session)

| Check | Result |
|---|---|
| `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` | `RESULT: PASS — all checks green` |
| `node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/lo-codes` | `RESULT: PASS — all 13 lo-codes cases gate as intended` |
| `node skills/_tools/verify_objective_tree.mjs docs/mastery/objective-tree/C1_MATH.tree.json docs/mastery/objective-tree/domains/MATH.json` | `ALL CHECKS PASSED` |
| `npx tsx skills/_tools/mastery_catalogue_to_json.mjs --check docs/mastery/lo-catalogue` | `RESULT: PASS — 11 catalogue files valid` |
| `node skills/_tools/verify_descriptive_carriers.mjs` | `RESULT: PASS — all 11 descriptive cases gate as intended` |
| `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json` | `RESULT: PASS (0 warn, 0 advisory) — importable` |
| `node skills/_tools/verify_help_guides.mjs` | `help guides: 355 file(s), 14 draft(s) … ALL CHECKS PASSED` |
| `npm run build --workspace=shared` | exit 0 |
| `npm run typecheck --workspace=shared` / `server` / `app` | exit 0 / 0 / 0 (server + app run with `NODE_OPTIONS=--max-old-space-size=6144`; the default 2 GB heap runs out on the server) |
| `jest --runInBand` class-test suites + childClassTests + graphqlDocuments + permissionCatalogueGates + helpGuides (`NODE_OPTIONS=--max-old-space-size=4096`, as CI) | `Test Suites: 16 passed, 16 total · Tests: 363 passed, 363 total` |
| Full server suite `jest --maxWorkers=2` (4 GB heap) | `Test Suites: 410 passed, 410 total · Tests: 6755 passed, 6755 total` (exit 0) |
| `npx expo export --platform web` (output to the scratchpad) | exit 0 — `App exported to: …/web-dist` |

## Not done

- The help guide's picture does not show the picker: no LOCKED catalogue or prod data in this session. The step text is updated; re-shoot row 4 of `exam-ct-enter-marks` on a LOCKED class × subject (C1 MATH / C1 ENG are locked on prod).
- No click-through of the picker in a running app (no seeded server here); covered by typecheck, the GraphQL-documents test and the server tests only.
- `ClassTestStudentProfileScreen` (per-student class-test profile) does not show the picks yet; the brief named only the teacher result view and the approval view.
- `shared/permissionCatalogue.ts` is unchanged: it holds actions, not a per-resolver list, and no action was added. The resolvers are listed in `docs/permission-catalogue/trackers-classtest.md` and gated (permissionCatalogueGates test green).

## Decisions made (where the brief was silent)

1. Pickable = `status: "LOCKED"` and `tagged !== false` (not literally `tagged: true`): flat M-0 LOCKED rows carry no `tagged` field and the live code (`treeShapeOf`, `untaggedRefusal`) reads them as tagged objectives. Grouping rows (`tagged: false`) are refused. (D-#1360)
2. `null` for `weakLoCodes` means "not sent" (keeps), like omitted; only `[]` clears. Duplicates collapse before the count of 5. (D-#1361)
3. Picks on an ABSENT save are refused (not silently dropped), matching the comment rule. (D-#1361)
4. Publish: codes are outside `publishedSnapshot` and the correction diff, like the weakness text; the guardian WhatsApp/in-app message and its regular/excellent kind are unchanged. (D-#1362)
5. Guardians see the objective labels on a published result regardless of the mastery add-on switch. (D-#1363)
6. The report read is named `classTestWeakObjectivesPage` (D-#761 naming), with the `classTestStudentProfile` scope rule; the picker read needs `class_test:enter_results`. (D-#1364)
7. Refusals are plain `Error`s (the house convention for a shown, unpaged denial) so no new error class needs registering.
8. Picker title builds the Bangla locative from the level word ("শিখনফল" → "শিখনফলে"); a renamed word that does not end in a consonant gets "-এ".

## Questions for the owner

1. When a teacher picks objectives but leaves the weakness text empty, the guardian message is still the "excellent" template. Should picks alone make it the "regular" (feedback) message, and should the WhatsApp text list the objective labels?
2. Should the guardian line be hidden when the mastery add-on is switched off for that class × subject (D-#783 style), or always shown as now?
3. Should the picks later feed mastery evidence (e.g. as a light signal)? This slice deliberately writes none.
4. Merge order with the parallel enterResult question-sheet lock: this branch only adds lines; expect at most a trivial conflict in `ClassTestResultService.ts` / `ClassTestResultsScreen.tsx` if the other branch edits the same neighbouring lines.
