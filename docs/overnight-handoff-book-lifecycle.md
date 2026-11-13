# Overnight handoff — book lifecycle (Cloud Brief 16)

Contract: `docs/prd-book-lifecycle.md` **Revision 2** (pre-flight passed: on `origin/dev` 82187534 with the
§0.1 "R2" row and §1.3 owner answers). Branch: `claude/new-session-6juppd` (started from `origin/dev`
82187534, rebased onto 2a7ba3ea before the first push — no force-push; `git merge-base --is-ancestor origin/dev HEAD` OK). No PR opened (blocked here; the lead opens it).

Decisions used: D-#1590–#1616 recorded as written in PRD §22; build-time D-#1617, D-#1618 (BL-1), D-#1619
(later slices). `origin/dev:DECISIONS.md` re-read before each commit: highest there D-#1576 (no clash; D-#1582/#1583
exist on another remote branch, outside this block).

Drift from the PRD pre-flight (live code wins on patterns):

- **P5:** the old support-book drawer group is already `hidden: true` in `DrawerContent.tsx` on dev. The new list
  (S1) has the footer link; `SupportBookTab` stays registered so the link opens the same stack (D-#1618).
- **P15 / VR-10:** `scriptGuard` refuses Arabic and typographic quotes (it was built for the lesson renderer's
  fonts). VR-10 imports it and widens it on changed text only (D-#1618 (1)).
- **§5.13 "uploads stream to a temp file":** the routes use multer disk storage; `DriveStore.uploadToDrive` still
  takes a Buffer (as every upload route does today). Not changed — a streaming Drive upload is its own change.
- **`book_` prefix invariant** (`supportBookFiles.test.ts`): the `book_lc_*` kinds are listed in
  `BOOK_STORED_FILE_KINDS` and dispatch to their own gate first, so the old test stays green unchanged.
- **Server typecheck / ts-jest need the CI heap** (`NODE_OPTIONS=--max-old-space-size=4096`, as `ci.yml` sets);
  without it `tsc --noEmit` OOMs at the 2 GB default on this machine — baseline, not caused by this work.

---

## BL-1 — books, versions, upload, reader + diff, paper review rounds, feedback triage (no AI)

**Commits:** first `[BL-1]` … last `[BL-1]` — see `git log --oneline origin/dev..HEAD`.

### Built

- **Contract:** `shared/bookLifecycle.ts` (enums, `BOOK_EDIT_REASONS`, version helpers), `shared/bookDiff.ts` (Myers
  line diff + word diff, Bangla word boundaries); catalogue feature `book_lifecycle` (view, manage, finalize LOCKED,
  release, ai_edit PRINCIPAL_DEFAULT, teacher_view, report — all off for TEACHER/OFFICE) + `docs/permission-catalogue/`;
  verifier LOCKED list + `NOTIFICATION_KINDS` (+5 `BOOK_*`, labels BN/EN); Audit kinds `BOOK_LC_*` + labels;
  StoredFile kinds `book_lc_*`; `BookEvent` gains `flow`, `origin`, `dedupeKey`, lifecycle kinds and refs (old rows valid).
- **Server module** `server/src/modules/book-lifecycle/`: models (SchoolBook, BookVersion + immutability guard,
  BookChapterText, BookMediaAsset, BookMemoRound, BookFeedback, BookInstruction, BookDecision, BookRuleSet,
  BookEditDraft), services (access, markdown §6, store, versionService, roundService, memo, packet, feedbackService,
  events, files, notify, charGuard, names, hooks), GraphQL resolvers, REST routes `/files/book-lc/*`
  (import, upload-version, version-file, round-scan, history, master.md, memo.md) and the `GET /files/:id` gate.
- **Paper review (owner Q1):** generated memo (deterministic, offline shape, codes + quotes, page column from the
  page map); print packet (`pdftotext -layout` page map confirmed by a person; memo PDF by pdfkit with header/footer
  and closing verdict page; book PDF whole or changed chapters by pdf-lib, original page numbers kept, divider pages);
  "sent on paper" (no notification); returned copy: scans (≥ 1), marks + new points with scan evidence, MCP/bundle
  proposals arrive unchecked (`proposeTranscription`, used by BL-3/BL-4), "checked against scan" ticks, verdict and
  rulings by `finalize` only, stamped `recordedFromPaper`, corrections keep history; approval basis round / inherited /
  imported; final refused without a basis.
- **Feedback:** one inbox, triage (needs_reviewer / direct_fix / verbal_errata / reject with reason / duplicate),
  sacred_text never a direct fix; `BOOK_FEEDBACK_FILED` (one per book per Dhaka day) and `BOOK_FEEDBACK_ANSWERED`.
- **App:** S1 list (+ archive footer link), import, S2 book page (tabs), S3 version (files + stale flags, change list,
  reader, word diff, direct-fix approve, mark final), S4+S7 round (memo, page map, packet, sent, scans, marks, points,
  checks, verdict), S5 triage, basic S11 draft (diff, accept/drop per chapter, change rows, re-key + protected
  confirmations, bump + summary), S13 rule sets; drawer item বই ও সংস্করণ; notification deep links.
- **Help guides (drafts, no pictures):** `book-lifecycle-overview`, `book-paper-review`.

### Verified (executed in this session)

```
npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json   → RESULT: PASS — all checks green
node skills/_tools/verify_help_guides.mjs                                         → ALL CHECKS PASSED (379 files, 31 drafts)
npm run build --workspace=shared                                                  → ok
npm run typecheck --workspace=shared                                              → ok
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit (server)                  → ok (no output)
app: npx tsc --noEmit                                                             → exit 0
app: npx expo export --platform web                                               → "App exported to …", EXPO_EXIT 0
new suites --runInBand: bookLcUpload 12 · bookLcVersionMachine 10 · bookLcPrintPacket 7 · bookLcRecordReturn 8 ·
  bookLcMemo 3 · bookLcFeedback 4 · bookLcEvents 2 · bookLcRegions 4 · bookLcDiff 4 · bookLcPermissions + firewall 97
touched suites --runInBand: permissionCatalogueGates, supportBook* (13 files), bookPlane, helpGuides → 256 passed;
  graphqlDocuments → 3 passed
full server suite --maxWorkers=2 (NODE_OPTIONS 4 GB, as CI) →
  Test Suites: 1 failed, 473 passed, 474 total · Tests: 1 failed, 7613 passed, 7614 total (472 s)
  the one failure: expectedErrorRegistry (the new PopplerMissingError unclassified) — registered in
  EXPECTED_ERROR_NAMES, then expectedErrorRegistry + homeworkFiles --runInBand → 41 passed
```

poppler (`pdftotext`) **is** installed on this cloud machine, so the packet's page-map case ran (not skipped). If the
CI runner lacks it, that case skips with the named reason "poppler-utils (pdftotext) is not installed on this runner".

**After rebasing onto `origin/dev` 2a7ba3ea (CSP-1 merged meanwhile; conflicts in DECISIONS/CHANGELOG/STATUS
kept both sides; vocab NOTIFICATION_KINDS, the verifier's kinds + LOCKED lists, the catalogue README, firewall and
permissionCatalogueGates merged as a union), re-run:**

```
verify_shared_vocab → RESULT: PASS · verify_help_guides → ALL CHECKS PASSED
shared build + typecheck ok · server tsc (4 GB) exit 0 · app tsc exit 0 · expo export --platform web → EXPO_EXIT 0
full server suite --maxWorkers=2 → Test Suites: 484 passed, 484 total · Tests: 7735 passed, 7735 total (564 s)
```

### Not done in BL-1 (by design or deferred)

- The correction UI for a recorded return (server `correctBookLcReturn` exists; S7 shows the recorded result only).
- Teacher-report attachments / photos (BL-2 report form).
- Pictures for the help guides (drafts; BL-6).

### Decisions

D-#1590–#1616 (PRD §22, recorded), D-#1617 (markdown/version build details), D-#1618 (contract/app details).

### Questions for the owner / lead

- None blocking. PRD §21 open items followed as recommended (Q3 minor default, Q6 notification only, Q8
  open/download, Q10 DeepSeek with a warning — BL-5, Q13 later, Q14 Office `release` by grant, Q15 nothing
  auto-deleted, Q16 memo printed from the packet PDF, no .docx, Q17 packet uses the uploaded master PDF).

---

## BL-2 — final, editions, print releases, errata, teacher surfaces

**Commits:** the `[BL-2]` commit(s) after BL-1 — see `git log --oneline`.

### Built

- Mark final (BL-1 service) now covered end to end: approval basis required (round / inherited / imported), every
  required edition present and every file of it fresh, no open needs_reviewer item on the version, finalize only.
- `BookPrintRelease` + `BookErratum` models; `releaseService` (create from a final version, files per edition as
  `book_lc_print`, record once the Student IDML zip + preview PDF are there → version print_released + book's current
  release, statuses prepared → sent_to_press → printed with dates, newer printed supersedes older, শিক্ষকদের জানান →
  BOOK_RELEASED to readers, class-books publish behind the per-book switch, pageplan.json → chapter suggestion);
  `errataService` (verbal_errata triage → erratum draft on the current release, edit, announce by finalize →
  BOOK_ERRATUM to readers only, ack per reader, carried into the version that applies the item; the release rule);
  `teacherScope.bookTeachersNow` (routine teachers of class+subject + class teachers of the level, active staff);
  `teacherService` (আমার বই, my reports, the report form with an optional page photo, the file read rule).
- GraphQL `bookLifecycleRelease.ts`; REST `/files/book-lc/release-file`, `/files/book-lc/report-photo`.
- App: S6 ছাপা ও ভুল-সংশোধনী (from the book page), S8 আমার বই and S9 ভুল জানান in a teacher tab (drawer আমার বই),
  notification deep links. Guides (drafts): `book-teacher-errata`, `book-teacher-report`, `book-print-release`.
- `permissionCatalogueGates`: release / teacher_view / report are now gated (only ai_edit stays declared ahead).

### Verified

```
new suites --runInBand: bookLcFinal 6 · bookLcRelease 5 · bookLcTeacherScope 3 · bookLcErrata 2 · bookLcClassBooks 2 → 18 passed
touched --runInBand: graphqlDocuments, permissionCatalogueGates, bookLcPermissions, firewall, helpGuides, supportBookFiles → 167 passed
verify_shared_vocab → PASS · verify_help_guides → ALL CHECKS PASSED · server tsc (4 GB) 0 · app tsc 0 · expo export web → EXPO_EXIT 0
full server suite --maxWorkers=2 →
  Test Suites: 489 passed, 489 total
  Tests:       7768 passed, 7768 total
  Time:        448.588 s
  EXIT 0
```

### Not done / notes

- Errata pop-up (Q6 optional): not built — notification + the আমার বই list only (the existing pop-up composer can
  still be used by hand).
- Teacher edition opens through `GET /files/:id` (Q8: open/download for scoped teachers).
- `origin/dev` moved on (CSP-2, PR #1528) after BL-1 was pushed. Bringing it in would need a merge into this branch or a
  rebase + force-push, both outside this session's rules, so the branch stays on its BL-1 base; a trial merge result
  is reported at the end of this file.

### Decisions

D-#1619 (BL-2 build details).

## BL-3 — edit pipeline, validator, editing method, bundle, return-transcription pack

**Commits:** the `[BL-3]` commit after BL-2 — see `git log --oneline`.

### Built

- `editOps` — the `book-chapter-edit/v1` engine (§12.2, normative): exact NFC quotes, each found once, no overlap,
  `after ≠ before`, ≤ 300 ops, every op cites F-n / I-n / D-n; strict zod schemas (unknown field → VR-2).
- `validator` — VR-1…VR-15 (§12.3): draft level (base fresh, coverage, accept) and chapter level (schema, refs, ops,
  scope, markers, explained, pictures, regions, characters, size, sacred text, lexicon), Bangla messages with codes.
- `method` + `server/assets/book-lifecycle/edit_method_v1.md` — the one method file (M-0…M-8), read byte for byte;
  drafts record version + SHA-256 (`bookMethodParity` pins API / MCP / bundle parity).
- `draftService` — open (latest base only, F/I refs, optional scope), `applyChapterEdit`, `putChapter` (whole chapter +
  change list), `submitDraft` (ready / refused; never a version), the finalize "আমি দেখেছি" tick, the accept guard.
- `bundle` — Path B zip (METHOD.md, master with markers, outline, de-identified items — an item naming a child or
  guardian is left out and listed — instructions, rule sets, decisions, OUTPUT.md), streamed, never stored; result
  upload as edit JSON or a whole master + changes.json; the return-transcription pack and its upload (unchecked marks).
- REST `POST /files/book-lc/bundle`, `/bundle-whole`, `GET /files/book-lc/round/:id/transcription-pack.zip`;
  GraphQL `bookLifecycleEdit.ts` (submit, ack, bundle-result upload, transcription upload).
- App: S12 bundle screen (from the book page), S11 submit button + validator summary + unexplained list with the
  finalize tick + ops/whole badge, round screen transcription pack download/upload.

### Verified

```
new suites --runInBand: bookEditOps · bookEditValidator · bookEditCoverage · bookEditAccept · bookBundle · bookReturnPack · bookMethodParity → 33 passed
all book suites + touched (graphqlDocuments, permissionCatalogueGates, firewall, helpGuides, supportBookFiles, expectedErrorRegistry) → 28 suites, 281 passed
verify_shared_vocab → RESULT: PASS · verify_help_guides → ALL CHECKS PASSED · shared build ok · shared tsc 0 · server tsc (4 GB) 0 · app tsc 0
expo export --platform web → EXPO_EXIT 0
full server suite --maxWorkers=2 →
  Test Suites: 496 passed, 496 total
  Tests:       7805 passed, 7805 total
  Time:        496.435 s
  EXIT 0
```

### Fixed while testing

- VR-7 at line level let a second edit on the same line hide behind the first row → word-level change runs (D-#1620).
- The accept check read `!u.ack` — a Mongoose nested `{}` is truthy → `!u.ack?.at`.
- Submitting a stale draft threw "closed" → answers `refused` with VR-1.

### Not done / notes

- No new help guide in BL-3 (the Claude/bundle guide comes with BL-4, the AI guide with BL-5).
- **D-#1620 is past the reserved D-#1590–#1619.** origin/dev ends at D-#1588 today; renumber at merge if taken.

### Decisions

D-#1620 (BL-3 build details).

## BL-4 — MCP book tools (Path B MCP) + single-use upload links

**Commits:** the `[BL-4]` commit after BL-3 — see `git log --oneline`.

### Built

- `book-lifecycle/mcp/bookTools.ts` — the eleven tools of §15.1 (`list_books`, `get_book_version`, `start_book_edit`,
  `edit_chapter`, `put_chapter`, `submit_book_version`, `add_feedback_items`, `list_round_scans`, `get_scan_page`,
  `propose_decision`, `request_upload_url`) and the instructions block, registered from `registerWorkspaceTools` with the
  existing non-generic helper (+ a raw-content variant for the scan image). Each tool re-checks its own
  `book_lifecycle:*` action; the token user is rebuilt from the User row on every request.
- The tools exist only when the book plane is open (always on the server): a W-5-only setup keeps exactly its ten
  tools and its instructions, so `aiWorkspaceW5` is unchanged and green.
- `services/uploadUrl.ts` + `POST /files/book-lc/upload/:token` — hashed, single-use, 10-minute, size-bound (±1 %)
  links; no session on the POST (the token is the credential), the user re-read and must hold `manage`; audited.
- `services/scanPages.ts` — a scan page as a JPEG ≤ 2,000 px (`pdftoppm`), 300 pages per user per day.
- `names.ts` `activeAuthOf` (the caller rebuilt from the User row, for session-less doors).
- Help guide `book-claude-edit` (draft, no pictures).

### Verified

```
new suites --runInBand: bookMcpTools 6 · bookUploadUrl 4 → 10 passed
touched --runInBand: aiWorkspaceW5, dataAssistantMcp, firewall, helpGuides, permissionCatalogueGates, all bookLc*, expectedErrorRegistry, graphqlDocuments → 24 suites, 274 passed
verify_shared_vocab → RESULT: PASS · verify_help_guides → ALL CHECKS PASSED · shared build 0 · shared tsc 0 · server tsc (4 GB) 0 · app tsc 0
expo export --platform web → EXPO_EXIT 0
full server suite --maxWorkers=2 →
  Test Suites: 498 passed, 498 total
  Tests:       7815 passed, 7815 total
  Time:        446.475 s
```

### tsc memory (`npx tsc --noEmit --extendedDiagnostics`, server, 4 GB heap)

| | Files | Types | Instantiations | Memory used | Check time |
|---|---|---|---|---|---|
| before BL-4 (BL-3 tree) | 2,845 | 2,171,158 | 9,205,148 | 3,874,593K | 90.15 s |
| after BL-4 | 2,850 | 2,175,970 | 9,222,118 | 3,891,513K | 90.09 s |

BL-4 adds about 17 MB. **Flag for the lead:** the server was already at ~3.87 GB of CI's 4 GB heap before this slice —
little margin is left for any feature, not caused by the book tools (the non-generic registration kept them small).

### Not done / notes

- No app screen in BL-4 (the connector is the existing W-5 one). The help guide explains both MCP and the bundle.

### Decisions

D-#1621 (BL-4 build details).

## BL-5 — the AI edit job (Path A)

**Commits:** the `[BL-5]` commit after BL-4 — see `git log --oneline`.

### Built

- `book_edit` in `AI_FEATURES` (OFF, anthropic, `claude-opus-5-5`, no fallback, $10/month, 400/day) and in
  `LOGGED_AI_FEATURES`.
- `BookEditJob` (book plane; pinned `provider` + `modelName`, per-chapter tokens/cost, `leftOut`).
- `services/editJob.ts` — `previewEditJob` (S10 estimate, writes nothing), `startEditJob` (confirm when over cap /
  > 60 parts; opens the `ai_job` draft, pins the model), `runEditJob` (chapters one at a time in reading order; prompt
  cache-ordered from the method; ≤ 2 fix rounds; same-provider retries; cap → partial before the call; feature off →
  stopped; new version → stale_base; BOOK_EDIT_READY), `bookEditWorkerTick` (20-minute re-queue, one job at a time).
- `workers/aiWorkerPlanes.ts` — the AI worker opens the book plane too (optional) and runs book jobs without holding
  up workspace items; `aiJobWorker.ts` uses it.
- GraphQL `bookLifecycleJob.ts` (estimate, start, stop, re-run failed chapters, job, jobs page). App: S10 এআই সংশোধন (from the book page,
  `ai_edit` + `manage`), job progress + earlier jobs (paged), → S11. Guide `book-ai-edit` (draft).
- `permissionCatalogueGates`: `ai_edit` left `DECLARED_AHEAD` (now gated).
- Touched pinned tests: `aiFeatureSettings` (feature list + the book_edit defaults), `aiWorkspaceW1` (caps total 23 →
  33; the "under budget" step now sets $35).

### Verified

```
new suites --runInBand: bookEditJob 8 · bookEditJobWorker 3 → 11 passed
touched --runInBand: aiFeatureSettings, aiWorkspaceW1/W4/W5, aiUsage, aiExchange, permissionCatalogueGates, graphqlDocuments, firewall, helpGuides, all book*, expectedErrorRegistry, notification* → 37 suites, 491 passed
verify_shared_vocab → RESULT: PASS · verify_help_guides → ALL CHECKS PASSED · shared build 0 · shared tsc 0 · server tsc (4 GB) 0 · app tsc 0
expo export --platform web → EXPO_EXIT 0
full server suite --maxWorkers=2, run 1 → 499/500 suites: aiWorkspaceW5 "every reply's size is logged" saw 5 of ≥ 6 AiMcpCall rows
  (the W-5 helper writes those rows fire-and-forget; no ai-workspace file changed in BL-5; W5 alone 3 × 10/10 green)
full server suite --maxWorkers=2, run 2 →
  Test Suites: 500 passed, 500 total
  Tests:       7832 passed, 7832 total
  Time:        409.561 s
  EXIT 0
```

### Not done / notes

- **Flake to know about:** `aiWorkspaceW5` counts `AiMcpCall` rows written with `void …create()` right after the
  calls; under full-suite load one can land late (seen once, run 1 above). Pre-existing W-5 code, left unchanged as the
  brief requires; awaiting the write in `logged()` would fix it.

- **VM:** the AI worker reads the same `.env` as the API — it needs `BOOK_MONGODB_URI` there to run book jobs
  (without it the worker logs "book plane not configured" and runs workspace items only).
- Failed chapters re-run as a new job on the same draft (§14.1 step 5), once per job (`rerunBookLcEditJobFailed`).

### Decisions

D-#1622 (BL-5 build details).
