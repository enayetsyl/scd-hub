# Handoff — YC-3: Class 6 + new subjects, teaching side (cloud brief 10)

Branch `claude/laughing-meitner-okhe37`, started from `dev` at 8d12011 (`git merge-base --is-ancestor
origin/dev HEAD` → true). Not merged, no PR. Contract: `docs/prd-year-change.md` §4 + §5 row "YC-3";
owner rulings of 12 Nov 2026 (brief §1). Decisions D-#1480–#1483.

## What was built

§4 table, row by row, checked against the live code first:

| §4 row | Found | Result |
|---|---|---|
| Roster level | −1..5, MAX 5 | **Built.** `ROSTER_CLASS_LEVELS` −1..6, `ROSTER_CLASS_LEVEL_MAX` 6; Class, HomeworkItem, Assignment*, ReferencePaper, ExamPaperDraft, ClassBook, TeachingNote, Vocab, ActivityBank, Storybook follow through the constant |
| Class labels | stop at 5 | **Built.** ষষ্ঠ শ্রেণি / Class 6 |
| Local label maps | profile sheet stops at 5; pop-up `LEVELS` −1..5; import script falls back | **Built.** Profile sheet + 6; pop-up `LEVELS` = `ROSTER_CLASS_LEVELS` (labels come from the typed record, so 6 resolves); import script needed no edit (typed record now has 6). Mastery review `CLASS_BN` already had C6 (**done before**) |
| Teaching subjects | HW / routine lists lack ICT, BAN2, ENG2 | **Built.** Added with BN/EN labels to `HW_SUBJECTS`, `ROUTINE_SUBJECTS`; every Mongoose enum built on them follows. `MASTERY_SUBJECTS` = `HW_SUBJECTS` (verifier updated) |
| Subject label by class | — | **Built.** `subjectLabel(code, level, lang)` + `subjectsForClassLevel` + `CLASS6_PLUS_SUBJECTS` in `shared/vocab.ts`. Server: guardian routine (both views). App: `hwSubjectLabel` / `routineSubjectLabel` take an optional level; used on Declare homework, Assignment schedule, class notes (slot title). **Left:** screens whose payload carries no class level (routine master grid, slot lists, my periods strip) still show the plain name |
| Grant subjects | literal list; Subject rows only for 6 codes | **Built.** `ROUTINE_GRANT_SUBJECTS` + ICT, BAN2, ENG2; `FOUNDATION_SUBJECTS` (Subject enum) + the three; rows on prod come from the data script |
| Letters-only id / code regexes | `HW_ID_RE`, generic topic, AI-assist | **Built** (`[A-Z][A-Z0-9]*`). Mastery LO / domain regexes, `MasteryAssignmentService`, `masteryReviewUi`, `masteryStateUi`: **done before** (PR-A, D-#1312) |
| Homework topics | `classLevel` max 5 | **Built.** Max = `ROSTER_CLASS_LEVEL_MAX`; generic C6 topics in the data script; `seed-homework-topics.ts` no longer writes ICT/BAN2/ENG2 rows for C1–C5 |
| Literal 1–5 checks | all listed sites | **Built:** exam-paper draft validator + `validate-drafts.mjs`; pop-up levels (server + app, app subjects too); observation default levels (service + `rota.ts` ×2); English Drive (model, service ×2, app upload list, file-name regex); print tag regexes (+ ICT / BAN2 / ENG2 subject words, tested before BAN/ENG); class-note `mayHavePlan` |
| App literal subject lists | reference papers, teaching-note order | **Built** |
| Period grid | C6 falls on `class_1_5` by key | Code: nothing to change (**done before**, `slotView.audienceForLevel`). **Data built:** the script adds 6 to every `class_1_5` grid's `classLevels` |
| "Senior" marks drivers | `level >= 4` includes 6 (**done before**) | **Built:** text "চতুর্থ–ষষ্ঠ" / "Class 4–6" |
| Unused `ROUTINE_SUBJECTS_CLASS3_PLUS` | read by nothing | **Left** as the PRD says; its comment now says so |
| Safe already | classToken, mastery tokens, scholarship, attendance | Confirmed, untouched |

Also: the syllabus board's "no routine yet" fallback lists the Class 6 subjects only for Class 6+.

**Prod data script** (not run): `npx tsx server/scripts/class6-onboarding-data.ts` (dry run) /
`--apply`. Logic in `server/src/modules/foundation/services/Class6OnboardingDataService.ts`.
Expected on prod: `Subject` ICT, BAN2, ENG2; `classLevels` + 6 on the `class_1_5` grids (regular,
and winter if present); 10 generic topics `TOP-{S}-C6-GEN`. A second run writes 0.

**Help guides updated:** `notes-routine-add`, `notes-routine-edit`, `teach-hw-declare` (Class 6
subject names), `content-ed-upload` (classes 1–6). Text only; the pictures are unchanged (no button
moved).

**Tests:** new `server/src/__tests__/class6Onboarding.test.ts` (the §3 acceptance). Assertions that
pinned the old range were moved to the new edge (7 instead of 6) or the widened list:
`homework`, `assignmentSchedule`, `englishDrive` (×2), `vocabWord`, `observationRota`,
`contentSubjects2027` (Subject list), `activityBanks` (a bank whose text says "Class 3 – 6" now
maps to 3–6 instead of being capped at 5: true on the next import of such a bank; stored banks are
unchanged until re-imported).

## Verified (commands + result tails)

Run in this session, from the repo root unless noted.

| Check | Result (tail) |
|---|---|
| `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` | `RESULT: PASS — all checks green` (new check: Class 6 teaching side) |
| `node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/lo-codes` | `RESULT: PASS — all 19 lo-codes cases gate as intended` |
| `node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/subjects-2027` | `RESULT: PASS — all 20 subjects-2027 cases gate as intended` |
| `node skills/_tools/verify_descriptive_carriers.mjs` | `RESULT: PASS — all 11 descriptive cases gate as intended` |
| `node skills/_tools/verify_objective_tree.mjs docs/mastery/objective-tree/C1_MATH.tree.json docs/mastery/objective-tree/domains/MATH.json` | `ALL CHECKS PASSED` |
| `npx tsx skills/_tools/mastery_catalogue_to_json.mjs --check docs/mastery/lo-catalogue` | `RESULT: PASS — 11 catalogue files valid` |
| `python3 server/import/validate_import.py docs/examples/envelope_C5_ENG_U09_S01.json --envelope-schema docs/import-contract.schema.json` | `RESULT: PASS (0 warn, 0 advisory) — importable` |
| `node skills/_tools/verify_help_guides.mjs` | `ALL CHECKS PASSED` (365 files) |
| `npm run build --workspace=shared` | exit 0 |
| `npm run typecheck --workspace=shared` | exit 0 |
| server `tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=6144`; the default 2 GB heap runs out here) | 0 errors |
| app `tsc --noEmit` (same heap flag) | 0 errors |
| `npx jest --runInBand src/__tests__/class6Onboarding.test.ts` (server) | `Tests: 9 passed, 9 total` |
| touched suites `--runInBand` (homework, assignmentSchedule, englishDrive, vocabWord, routineSlots, popupNotice, printRequest, examPapers, observationRota, aiAssist, homeworkSummary, examSyllabusRead, guardianPortal, marksDrivers ×2, classToken, contentSubjects2027, activityBanks, classTestWeakObjectives) | all PASS |
| `npx expo export --platform web` (app) | `App exported to: …/web-export`, exit 0 |
| full server suite `npx jest --maxWorkers=2` | FULLSUITE_PLACEHOLDER |

## Not done

- Level-aware subject names on screens whose data has no class level (routine master grid, routine
  slot lists, my-periods strip, guardian syllabus / exam routine). Needs a `classLevel` field on those
  payloads; a later small change.
- Routine editors (master grid and the per-group editor) offer ICT / BAN2 / ENG2 for every section;
  the server accepts them anywhere. Pickers that know the class (declare homework, assignment
  schedule) hide them below Class 6.
- No UI walk or screenshots (no prod data; no seed allowed). The data script was run only on the
  in-memory fixture.
- Class 6 classes / sections, the বালক/বালিকা names and the routine itself are YC-4 / YC-5 / YC-6.

## Decisions made (smallest safe option where the brief was silent)

- The server does not refuse ICT / BAN2 / ENG2 below Class 6 (no PRD rule; a refusal could break a
  real edge case). Recorded in D-#1480.
- The content labels "বাংলা ২য় পত্র" / "ইংরেজি ২য় পত্র" (D-#1310, also in `render_plan.py` and a help
  guide) are left; the teaching side uses the owner's Q33 names.
- The data script only adds; it never renames or reactivates an existing row and never creates a
  missing grid (reports it). Generic C6 topics are written as real rows (as for C1–C5) even though
  the code already falls back to a synthetic one; ARABIC is included, as for C1–C5.
- `HW_DECLARATION_EXPECTED_SUBJECTS` includes the three (it is routine-driven, so C1–C5 see no change).
- The chat sync will create the SUBJECT groups ICT / BAN2 / ENG2 (empty until Class 6 slots exist).
- Pop-up composer subjects and levels now read the shared lists instead of a copy.

## Questions for the owner

1. Should the content labels ("বাংলা ২য় পত্র") match the teaching names ("বাংলা দ্বিতীয় পত্র")?
2. Should the server refuse ICT / BAN2 / ENG2 on Classes 1–5 (homework, class tests, routine)?
3. Does Class 6 English use the English Drive material as Classes 1–5 do (Q16 asked; widened anyway)?
4. `ROUTINE_SUBJECTS_CLASS3_PLUS` is enforced nowhere: enforce it, or delete it?
