# Overnight handoff — exams module (PR #424) brought onto `dev`

Session branch: `claude/jolly-heisenberg-uzaoyj` (started from `origin/dev` 8d9e5a2e — checked with
`git merge-base --is-ancestor origin/dev HEAD`). Date: 2026-11-11 (night). No PR opened, nothing
pushed to `main`, `dev` or `feat/exams`. No production access, no seed script, no secrets used.

## What was done

- `git merge origin/feat/exams` on the session branch (history kept; one merge commit). The branch
  was 2,655 commits behind `dev` (merge base 78149e6f). The clone was shallow, so it was unshallowed
  first (`git fetch --unshallow`) to get the real merge base.
- **One exam record.** `server/src/modules/exams/models/Exam.ts` is the `dev` (SY-1) model extended
  with every EX field — `status`, `gradeScale`, `failRule`, `ctAggregation`, the EX-9 submit / approve
  / send-back / publish stamps, `publishedVersion`, `source` — each with a default, so an SY-1 row
  (no status, no grade scale) loads with no migration. Read-side defaults for `.lean()` readers live
  in the new pure `server/src/modules/exams/examDefaults.ts`. The `dev` unique index
  (academic year × term) is kept. There is one GraphQL `Exam` type (in `resolvers/exams.ts`), one
  `exams` list and one `createExam` (the SY-1 ones, still gated on `exam_syllabus:settings`);
  `createExam` gained optional `ctAggregationMode` / `ctAggregationBestN` and now validates the
  grade scale and refuses a malformed year id.
- **Permission catalogue (D-#799).** The July branch's legacy `exam:manage / exam:custody /
  exam:mark / exam:read` were replaced by two catalogue features in `shared/permissionCatalogue.ts`
  and `docs/permission-catalogue/` (README + content-questions-exams.md §(l)):
  `exam_results` (view, settings, assign, enter_marks, edit_all, reopen, comment, submit, publish)
  and `exam_custody` (view, hand_over, acknowledge). Every exam resolver and the report-card PDF
  route now names its action; every app control uses `can(...)`. Defaults reproduce the July access
  (TEACHER: view, enter_marks, submit + the three custody actions; OFFICE: everything but
  enter_marks). The verifier's ship-day lists were extended to match.
- **Recipients** are `holdersOf(...)` (D-#796), not role lists: dispute → `exam_results:settings`,
  results submitted → `exam_results:publish`, the custody receiver picker → `exam_custody:acknowledge`.
- **Error registry:** `ExamError` registered in `EXPECTED_ERROR_NAMES` (`observability/sentry.ts`).
- **Paging (D-#761):** new `examCustodyEventsPage` (the custody screen now pages its log with
  `<Pager>`) and `myExamDutiesPage`; the old list queries stay for older bundles. The other exam
  lists are bounded by one exam / one paper / one class.
- **Notifications:** the four exam kinds stay registered in `shared/vocab.ts`, the verifier's exact
  list was extended, and each kind now deep-links in `app/src/lib/notificationNav.ts`
  (custody → ExamCustody for that exam; results → ExamHome; guardian → none).
- **Audit kinds:** 18 new labels in `server/src/modules/platform/auditLabels.ts` (the map is
  exhaustive by type).
- **Navigation:** `ExamsTab` opens on any `exam_results:*` / `exam_custody:*` action (dev's `any(...)`
  shape); the drawer leaf "পরীক্ষা" sits in the exam/syllabus group (not trackers), gated on
  `exam_results:view` / `exam_custody:view`.
- **Screens:** the five exam screens moved to `<Screen scroll>` (no hand-rolled ScrollView).
- **Help guides:** six drafts (no pictures) in `server/assets/help/guides/exam-ex-*.json` — home,
  marks, recheck, custody, report card, submit/publish.
- **Vocab:** branch vocab moved to the END of `shared/vocab.ts`; `EXAM_TERMS` and
  `EXAM_COMPONENTS` (+ labels) are NOT redeclared — the SY-1 ones are reused.
- **Test pinning acceptance 3:** new `server/src/__tests__/examRowCompat.test.ts` (8 tests): an
  SY-1-shaped row validates, hydrates with the EX defaults, reads the same defaults lean, keeps
  identity paths/requiredness/enum, keeps the single (year, term) unique index, and the `exams` list
  answers its SY-1 fields unchanged.
- Docs: a port note at the top of `docs/prd-exams.md`; a Bangla note at the top of
  `docs/test-plan-exams-bn.md` (its RBAC rows still name the July permissions).

## Every conflict and how it was resolved

Text conflicts reported by `git merge` (13):

| File | Resolution |
|---|---|
| `CHANGELOG.md` | Kept both sides' rows (append-only). |
| `STATUS.md` | Kept both sides' rows; the three July exam entries sit in date order under dev's newest. |
| `app/src/graphql/operations.ts` | The 3-way merge interleaved unrelated hunks, so dev's file was taken whole and the branch's entire exam block (its only change to the file) appended at the end. Plus the new `EXAM_CUSTODY_EVENTS_PAGE_QUERY`. |
| `app/src/lib/labels.ts` | Kept both. Then removed the branch's duplicate imports (`EXAM_TERM_*`, `EXAM_COMPONENT_*`, `ExamTerm`, `ExamComponent`) and its duplicate `examTermLabel` / `examComponentLabel` — dev's are used. |
| `app/src/navigation/AppTabs.tsx` | Dev's catalogue `can()` block kept; the branch's legacy `roleHasPermission` block dropped; `canExams` re-added as `any(...featureActions("exam_results"), ...featureActions("exam_custody"))`. Stack + drawer screen auto-merged. |
| `app/src/navigation/DrawerContent.tsx` | Dev's trackers group kept (with its StudentProgress leaf); the Exams leaf moved into the exam/syllabus group with `perms`. |
| `server/src/__tests__/navInitialRoute.test.ts` | Union of both param-requiring screen lists. |
| `server/src/index.ts` | Dev's `import "./registerResolvers"` kept; the branch's 7 resolver imports moved into `registerResolvers.ts`; both sides' PDF routers kept (`/pdf/report-card`). |
| `server/src/modules/exams/models/Exam.ts` (add/add) | One model — see above. Dev's (year, term) unique index wins over the July (year, term, name). |
| `server/src/modules/exams/services/ExamService.ts` (add/add) | Dev's `createExam(ctx, input)` / `updateExam` kept and extended; the branch's `createExam(input, actorId)` folded into it (no second create path); the branch's grade-scale, paper and status functions kept below. |
| `server/src/modules/platform/models/Audit.ts` | Kept both; dropped the branch's duplicate `EXAM_CREATED`. |
| `shared/vocab.ts` | Notification kinds + BN/EN labels: both. Legacy `PERMISSIONS` / `PERMISSION_BUILD_STATUS` / `ROLE_PERMISSIONS` / legacy labels (7 hunks): dev's kept, the branch's `exam:custody` / `exam:mark` NOT added (the catalogue replaces them). |
| `skills/_tools/verify_shared_vocab.mjs` | Dev's OFFICE check kept; exact NOTIFICATION_KINDS list extended with the four exam kinds; the branch's exam-kind check and its C.20 section kept; its "ADAB prints as Performance" check replaced (see decisions); the auto-merged legacy `exam:*` role check rewritten for the catalogue actions; ship-day lists extended. |

Conflicts that git did not flag (found by typecheck / tests / reading):

| Where | Problem | Resolution |
|---|---|---|
| `shared/vocab.ts` (auto-merged) | The branch block re-declared `EXAM_TERMS`, `EXAM_COMPONENTS` and their label maps. | Removed from the branch block; block moved to the end of the file. |
| GraphQL schema | `Exam` type, `exams` query and `createExam` mutation defined by both `exams.ts` (dev) and `exam.ts` (branch). | One of each (dev's), extended with the EX fields; `exam.ts` imports `ExamRef` / `toShape`. |
| `Notification.ts` (auto-merged) | Duplicate `examId` / `examPaperId` refs; on dev `examPaperId` means a paper-bank DRAFT. | Dev's kept; the branch never set `examPaperId`. |
| `Audit.ts` | Both used `EXAM_PAPER_REOPENED` — dev for the paper bank (D-#1033), the branch for re-opening a tabulated paper. | Branch's renamed `EXAM_PAPER_TABULATION_REOPENED` (service + its test). |
| `auditLabels.ts` | Exhaustive map missing 18 branch kinds. | Labels added (group EXAM). |
| `EXAM_COMPONENT_LABELS_EN` | Dev says "Class Test" / "Adab"; the printed transcript says "CT" / "Performance". | Dev's shared labels kept; the report-card renderer uses its own local column map, so the PDF still prints "Performance". |
| `notificationNavCoverage.test.ts` | Four exam kinds had no deep link. | Mapped in `notificationNav.ts`. |
| `expectedErrorRegistry.test.ts` | `ExamError` unclassified. | Registered as expected. |
| `permissionCatalogueGates.test.ts` | ~40 exam fields open to any login; legacy names. | All gated on catalogue actions. |
| Tests mocking `User` | `holdersOf` needs `.select().sort().lean()`. | `examCustody` / `examPublish` tests mock `holders` with a real `callerHasPermission` over the same users. |
| `exams.test.ts` | Called the July `createExam(input, actorId)`. | Calls `createExam(CTX, input)`; "duplicate (year, term, name)" became "duplicate (year, term)"; "unknown year" became "malformed year id" (ForbiddenError, dev's error type). |

## Verified (commands + result tails)

All run in this session on this container (Linux, Node from the repo's lockfile, 15 GB RAM).
Heap: server `tsc` and the schema-building Jest suites need more than Node's default heap here
(they died with "JavaScript heap out of memory" at the default); CI sets
`NODE_OPTIONS=--max-old-space-size=4096`, and the runs below used 4096 (Jest, export) or 6144
(server `tsc`, `--runInBand` exam suites).

| Check | Command | Result tail |
|---|---|---|
| Shared vocab / RBAC verifier | `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` | `RESULT: PASS — all checks green` |
| Descriptive answer carriers | `node skills/_tools/verify_descriptive_carriers.mjs` | `RESULT: PASS — all 11 descriptive cases gate as intended` |
| LO-code conformance | `node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/lo-codes` | `RESULT: PASS — all 13 lo-codes cases gate as intended` |
| Objective tree | `node skills/_tools/verify_objective_tree.mjs docs/mastery/objective-tree/C1_MATH.tree.json docs/mastery/objective-tree/domains/MATH.json` | `coverage: 164 / 164 exercises mapped, 0 unmapped` · `ALL CHECKS PASSED` |
| Mastery catalogue | `npx tsx skills/_tools/mastery_catalogue_to_json.mjs --check docs/mastery/lo-catalogue` | `RESULT: PASS — 11 catalogue files valid` |
| Import envelope | `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json` | `RESULT: PASS (0 warn, 0 advisory) — importable` |
| Help guides | `node skills/_tools/verify_help_guides.mjs` | `help guides: 361 file(s), 20 draft(s), 16 categories` · `ALL CHECKS PASSED` (6 of the drafts are the new exam guides) |
| Build shared | `npm run build --workspace=shared` | exit 0 |
| Typecheck shared | `npm run typecheck --workspace=shared` | exit 0 |
| Typecheck server | `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck --workspace=server` | exit 0, 0 `error TS` |
| Typecheck app | `cd app && npm run typecheck` | exit 0, 0 `error TS` |
| Exam suites + gates (`--runInBand`) | `npx jest --runInBand` exams, examAssignment, examMark, examRecheck, examCustody, examPublish, reportCard, navInitialRoute, examRowCompat, exam, examSyllabus, examSyllabusRead, examRoutine, examPapers, quranExam, permissionCatalogueGates, graphqlDocuments, helpGuides, notificationNavCoverage, expectedErrorRegistry | `Test Suites: 20 passed, 20 total` · `Tests: 398 passed, 398 total`; plus `viva` + `worksheetService`: `Tests: 37 passed, 37 total` |
| Full server suite | `npx jest --maxWorkers=2` | `Test Suites: 417 passed, 417 total` · `Tests: 6936 passed, 6936 total` · `Time: 387.147 s` · `EXIT 0` — this run started before the last two edits (guardian-null EX fields in `resolvers/exams.ts`, screen indentation); the suites those touch were re-run after (row above). A rerun on the final tree is noted below if it finished. |
| Web export | `cd app && npx expo export --platform web` (to a scratch output dir) | `Web Bundled 73027ms index.js (4278 modules)` · `App exported to: …/webdist` · real exit code `EXIT 0` |

Not run: Lint (the AGENTS table lists it as _TBD_); the Python envelope auto-wrap
(`build_envelope.py`) — no plan pair was changed, so there was nothing to wrap.

## Not done

- **Not run against a live app or database.** The brief forbids seed scripts and production access,
  and this machine has no MongoDB; the July branch's Playwright drive was not repeated. Everything
  above is typecheck + DB-free Jest + the verifiers + the web export.
- **Help guide pictures:** all six guides are `"draft": true` (hidden) until screenshots are taken.
- **No app screen** (unchanged from July — the server mutations exist, the screens do not) for: paper
  composition set-up, duty assignment, re-open a tabulated paper, send back / unpublish, the class
  bundle PDF. On the July branch these were done by API only too.
- EX-10 (half-yearly backfill) — not built (owner ruling).
- Follow-ups from the brief §4, not started: marks per question + learning-objective codes on exam
  questions; pre-filling a paper's composition from the published syllabus; feeding oral-exam (viva)
  marks into a paper; anything in mastery; any class-test change beyond what the branch already reads.

## Decisions made (smallest safe option where the brief was silent)

1. **D-#1380 — one exam row.** Dev's model extended; every EX field defaulted; unique per
   (year, term) as on dev (stricter than July's (year, term, name): one half-yearly and one annual
   per year); created only by the SY-1 `createExam` (`exam_syllabus:settings`).
2. **D-#1381 — catalogue registration.** `exam_results` (9) + `exam_custody` (3); defaults mirror
   the July access exactly, including the Office's duty bypass (`edit_all`) and approve/publish.
   Creating the exam stays `exam_syllabus:settings` — not duplicated.
3. Transcript column names ("CT" / "Performance" / "Semester Final") live in the renderer, not in
   the shared labels (dev's "Adab" label wins in the app).
4. Dispute notices go to `exam_results:settings` holders (the people running the exam); results
   submitted go to `exam_results:publish` holders.
5. Audit kind for re-opening a tabulated paper renamed to `EXAM_PAPER_TABULATION_REOPENED`.
6. The drawer leaf moved from "trackers" to the exam/syllabus group (where every other exam leaf is).
7. **Guardians see none of the EX fields.** The `exams` list is also a guardian's syllabus picker
   (SY-1), so on the shared `Exam` type the EX fields (status, grade scale, fail rule, CT rule,
   `publishedAt`, `publishedVersion`) resolve to null unless the caller holds an `exam_results:*`
   view or `exam_custody:view` action (a permission check, not a role check). The SY-1 fields are
   untouched for everyone. The only guardian path is the July branch's own: the published card's PDF.

## Questions for the owner

1. Should the Office keep **approve & publish** (`exam_results:publish`) and the **duty bypass**
   (`exam_results:edit_all`) by default, as on the July branch — or should either be
   Principal-only (`PRINCIPAL_DEFAULT`)? One-line change in the catalogue + verifier list.
2. The exam picker (`exams`, dev) is still gated on `exam_syllabus:view`. A person given
   `exam_results:view` but with syllabus view switched off cannot pick an exam. Widen it?
3. Only one exam per (year, term) — so no second "half-yearly" with a different name. Confirm.
