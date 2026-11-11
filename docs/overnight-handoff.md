# Overnight handoff — objective chain, slices PR-A … PR-D (2026-11-11)

Branch `claude/charming-cori-ksozdn` (started from `origin/dev` 4f957df; `git merge-base --is-ancestor origin/dev HEAD` passed).
One branch; commits are labelled `[PR-A]` … `[PR-D]` and are contiguous per slice, so the morning session
can cut one pull request per label. **Delete this file before merging.**

Environment notes (all slices):
- In-memory Mongo downloaded fine here, so every jest suite ran (none skipped).
- Server `tsc --noEmit` needs more than node's default 2 GB heap on this machine; it was run with
  `NODE_OPTIONS=--max-old-space-size=6144` (CI already gives it more; STATUS notes ~3.4 GB).
- The full server suite and `expo export --platform web` were run in a second git worktree checked out at
  the slice's commit (node_modules symlinked), so later edits could not leak into a slice's gate.
- One full-suite run had a jest worker killed by SIGTERM (machine pressure, not a test failure); that suite
  was re-run alone and passed. Noted where it happened.

---

## PR-A — the content pipeline accepts the 2027 subjects and Class 6

**Commits:** first `10affdb` · last `fa46e2a`.

### What was built
- Import envelope v1.2 (additive): `subject` += ISLAM, ICT, BAN2, ENG2; `class_level` 1–6 — envelope
  schema, `LOCKED_C5_PlanSchema_v1.json`, `plan-tools/LOCKED_SCD_PlanSchema_v2.json` (ISL kept, ISLAM added),
  question / stimulus payload schemas, `validate_import.py`, `validate_plan.py`, `render_plan.py`,
  `build_envelope.py`, `build_question_envelopes.py`, `shared/vocab.ts` (`SUBJECTS`, `CLASS_LEVELS`, labels,
  question-time rows) and `verify_shared_vocab.mjs`.
- `NCTB_GENERAL_SUBJECTS` keeps the old five; the foundation `Subject` collection is pinned to it + ISLAM.
- Question id `QP-BAN2-C6-U03-Q012` accepted; stimulus / plan topic-tag / rc-id patterns widened the same way.
  The bank's legacy `TOP-` pattern is unchanged.
- `ref19_topic_id`: out of the payload schema's `required`; harness L4 requires it for BAN ENG MATH SCI BGS
  BAN2 ENG2, optional and unchecked for ISLAM / ICT (`REF19_OPTIONAL_SUBJECTS`).
- Objective codes: `MASTERY_LO_CODE_RE` / `MASTERY_DOMAIN_CODE_RE` (+ payload `topic_tag` / `lo_codes`,
  envelope `lo_codes`) accept ICT / BAN2 / ENG2, longer alternatives first; `MASTERY_SUBJECTS` is its own
  list (homework subjects + ICT, BAN2, ENG2) with `MASTERY_SUBJECT_LABELS_BN/EN`; the shared tree / domains
  reader refuses an unknown subject (used by the verifier and the import). Model enums follow the list.
- App: content screens read `SUBJECTS` / `CLASS_LEVELS` so show the new values; `hwSubjectLabel` falls back
  to the content labels (ICT / BAN2 / ENG2 on mastery screens); LO short-code helpers accept a digit in the
  subject; the mastery work home keeps the homework subjects as chips; the English-drive upload keeps 1–5.
- The class-note lesson-plan picker finds an ISLAM session plan for an ISLAM routine slot (test).
- 15 harness cases `server/import/cases/subjects-2027/`, jest `contentSubjects2027.test.ts`, C6 ICT tree
  fixture `server/src/__tests__/fixtures/objective-tree/`, reading guide `content-import-subjects-2027`,
  AGENTS.md command row, docs/prd-content-subjects-2027.md.

### Verified (executed in this session)
```
verify_shared_vocab                → RESULT: PASS — all checks green
descriptive cases                  → RESULT: PASS — all 11 descriptive cases gate as intended
lo-codes cases                     → RESULT: PASS — all 13 lo-codes cases gate as intended
subjects-2027 cases (new)          → RESULT: PASS — all 15 subjects-2027 cases gate as intended
mastery_catalogue_to_json --check  → RESULT: PASS — 11 catalogue files valid
verify_objective_tree C1_MATH      → ALL CHECKS PASSED
verify_objective_tree C6_ICT (new) → ALL CHECKS PASSED
verify_help_guides                 → ALL CHECKS PASSED (356 files)
validate_import example C5 ENG     → RESULT: PASS (0 warn, 0 advisory) — importable
npm run build --workspace=shared   → exit 0
typecheck shared / server / app    → exit 0 / 0 / 0
jest --runInBand (14 new+touched suites: contentSubjects2027, content, questionBatch, questions,
  questionTime, masteryObjectiveTree, masteryObjectiveTreeBank, masteryCatalogue, masteryBank,
  lessonDelivery, aiWorkspacePlanTools, teachingNotes, helpGuides, routineSlots)
                                   → Test Suites: 14 passed, 14 total · Tests: 299 passed, 299 total
full server suite --maxWorkers=2   → Test Suites: 1 failed, 409 passed, 410 total · Tests: 6737 passed
  (the 1 "failed" = objectiveLessons.test.ts: "A jest worker process was terminated by another process:
   signal=SIGTERM" — re-run alone: Test Suites: 1 passed · Tests: 12 passed)
expo export --platform web         → App exported … EXPO_EXIT=0
```
The follow-up commit (LO short-code regex in two app helpers + the assignment PDF) was gated with app
typecheck exit 0 and `masteryAssignment.test.ts` PASS in the gate worktree.

### Not done
- Out of scope by the brief: ICT / BAN2 / ENG2 as routine, homework or class-test subjects (Class 6
  onboarding); Nursery / KG content; Classes 7–8.
- CI does not yet run the new case set. I did not edit `.github/workflows/ci.yml` (a workflow push may need
  a token scope this session may not have). Suggested step:
  `node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/subjects-2027`.
- The C2–C5 objective-tree files report `PREREQ_RESOLVES` when verified on their own (they name earlier-class
  prerequisites). Pre-existing: same output before this change; CI only verifies C1_MATH.

### Decisions made
D-#1310 (subjects + Class 6, envelope v1.2, ISL = ISLAM, borrowed question-time rows), D-#1311 (REF-19
optional for ISLAM / ICT, moved to the harness), D-#1312 (`MASTERY_SUBJECTS` own list, code patterns, tree
reader subject check, work-home chips), D-#1313 (id patterns, incl. stimulus / plan topic-tag / rc-id beyond
the brief).

### Questions for the owner
1. P09 plan tools say `ISL`; the app code is `ISLAM`. The import gate (v1 plan schema) accepts only `ISLAM`.
   Should P09 switch to `ISLAM`, or should the gate also accept `ISL`?
2. ENG2 / BAN2 anchor words: no anchor-word rule was added for them (any of পাঠ / অধ্যায় / Unit / Lesson
   passes). Confirm the Class 6 2nd-paper books' division word.
3. Question-time rates for ISLAM / ICT / BAN2 / ENG2 are borrowed (BGS / BGS / BAN / ENG). Real numbers?

---

## PR-B — a work sheet can carry an earlier class's objectives

**Commits:** first `320ccf6` · last: the `[PR-B] docs: overnight handoff` commit right after it.

### What was built
- `createPaper` (HW / CT / RUBRIC) accepts a same-subject code of the section's class or any earlier class
  (NUR < KG < C1 … C6); a later class is refused ("… পরের শ্রেণির …"). LOCKED + tagged as before; question
  type and marks from the code's own class table; bank question must carry the code (existing check).
  A sheet of only earlier-class codes defaults to the title "ভিত্তি যাচাই".
- Evidence written as today (paper's section / class). `liveSectionRows` without a `loCode` keeps only the
  section's own class codes (`includeEarlierClasses` opt-in), so heat-map, student view, roll-up, guardian
  view, weekly assignment builder and the section trigger ignore the extra rows.
- `resolveEarlierSteps` needed no change — it already read the student's own evidence on the prerequisite
  code from any section with the earlier class's policy; with the rows now written it shows the real state.
- New paged read `masteryEarlierClassSummary(sectionId, subject, page?, pageSize?)` (`mastery:view` + row
  rule): label, class, assessed, weak count, weak students. Heat-map section "আগের শ্রেণির ধাপ" (hidden
  when empty). New-sheet switch "আগের শ্রেণির {objective} যোগ করুন" → class chips → same picker; item
  chips show the class. Reading guide `mastery-earlier-class`; permission-catalogue doc row.

### Verified (executed; gate worktree at `320ccf6`)
```
verifiers (vocab, descriptive 11, lo-codes 13, subjects-2027 15, catalogue 11, tree C1_MATH, help guides,
  example envelope)               → all PASS / ALL CHECKS PASSED, exit 0
shared build / typecheck shared / server / app → exit 0 ×4
jest --runInBand touched (masteryEarlierClass [new], masteryWork, masteryDiagnosis, masteryAssignment,
  masteryAction, masteryGuardian, masteryRollup, masteryObjectiveTree, masteryObjectiveTreeBank,
  masteryNotify, graphqlDocuments, permissionCatalogueGates, expectedErrorRegistry, helpGuides)
                                  → Test Suites: 14 passed, 14 total · Tests: 173 passed, 173 total
full server suite --maxWorkers=2  → Test Suites: 411 passed, 411 total · Tests: 6752 passed · JEST_EXIT=0
expo export --platform web        → App exported … EXPO_EXIT=0
```

### Not done
- No screenshot guide (the guide is a reading guide; a step guide with pictures needs prod).
- The weekly assignment builder was verified through the rows it reads (`liveSectionRows`), not by running
  a full build with earlier-class evidence present.

### Decisions made
D-#1314 (earlier-class rule, marks from the code's class, default title, one filter in `liveSectionRows`),
D-#1315 (the summary read is paged from the start), D-#1316 (new-sheet switch, chips, guide).

### Questions for the owner
1. Should an earlier-class row also appear on the student's own page (not only as the "earlier step" of a
   weak row), e.g. a short "ভিত্তি যাচাই" list? Not built.
2. A baseline sheet uses the section class's switch only. Should the earlier class × subject also have to be
   switched on (its tree locked) — it must be LOCKED already, so this only matters for the switch itself?
