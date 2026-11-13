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
