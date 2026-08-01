# PRD — Support-Book production module (সহায়িকা authoring → review → assembly)

**Status:** DRAFT (build contract) — planning 2026-07-31
**Owner:** Principal
**Module:** `support-book` (standalone; **its own MongoDB connection**, D-#404 — no identity plane, no corpus plane)
**Decisions:** D-#403–#413, #417–#423 (this contract)
**Second book type:** [prd-storybook.md](prd-storybook.md) — storybooks ride this same engine as a second `bookType` (D-#421). Type-specific schema, validator set, render profiles and policy set live there; nothing else branches on type.
**Informed by (proven, not vendored):** the **Storybook Workbench** (`workbench/`, July 2026) — a working internal production app over the same renderer, five books assembled through it. Its stage machine, lineage invalidation, human review gates, SSE log streaming and per-slot image workspace are adopted here as design (D-#417/#418); its code is not imported. See §10.
**Implements (external, LOCKED):** the Support-Book Programme governance — `README v2.2`, `SCHEMA_support-book_v1` (v1.3), `REF-1 Curation Policy v1`, `REF-2 Content Register v1`, `ASSEMBLY v1.0-draft`, `PROJECT-INSTRUCTIONS-Production v2.0`. Adopted as cross-Project **coordination, not imported curriculum governance** (AGENTS scope boundary; the D-#33 / REF-11 pattern). **The app stores these documents as DATA, never as repo files** (D-#403).
**Vendors (unmodified):** `studybook-pipeline` — `validate-studybook.js`, `build-book.js`, `src/lib/{geometry,profiles,compose,fonts,font-audit}.js`, `src/tools/*`, the 4 Noto TTFs. Copied into `/book-pipeline/` and **spawned, never ported** (D-#407).

---

## §0 — At a glance / build order (read first)

- **What:** the team workflow that turns an NCTB textbook into a school সহায়িকা — an author writes a chapter's JSON (with Claude), an illustrator generates its images outside the app, a reviewer checks text + image, a senior reviewer answers escalations, an assembler renders the two print editions, and every reason anyone gave is retrievable afterwards.
- **The first book was one person's job.** C1-BAN exists: 54 lessons, 493 blocks, 201 image slots, both PDFs rendered. This module is about the **second book onwards, done by a team** — so the unit of design is the handoff between people, not the generation itself.
- **The nine-step chapter loop is the spine** (README §3.2). Steps 1–3+7 = author, 4–6 = illustrator, the §7 checklist = reviewer, the Principal gate = senior reviewer, steps 8–9 + ASSEMBLY = assembler. The app does not invent a new process; it makes the existing one multi-person and auditable.
- **Two authoring paths, one contract.** Claude Desktop (patch file uploaded) and the in-app chat (API) both emit the **same §5 patch object** and pass the **same validator** before merge (D-#408). The validator is the gate; the prompt is not.
- **Plane:** a **third plane.** Not identity (no student/guardian/staff row is referenced except `userId` for attribution), not corpus. It gets its own Mongo connection so the isolation is structural rather than remembered (D-#404). ADR-005 is unaffected and untouched.
- **Contract surface:** app-native `/shared/vocab.ts` additions only — book subject rides `ROUTINE_SUBJECTS`, class rides `ROSTER_CLASS_LEVELS`, so there is **no envelope/schema twin and no harness sync** (D-#405). Vocab verifier stays green.
- **Build order:** **SB-1** foundations (policy store, book/lesson models, patch upload + validator + merge) → **SB-2** image pipeline → **SB-3** review + escalation chain → **SB-4** assembly (render worker + assembler workspace) → **SB-5** rationale dashboard → **SB-6** in-app LLM authoring chat → **SB-7** in-app image generation via API (D-#419; the external-upload path built in SB-2 remains permanently). **The LLM chat is deliberately LAST** (D-#412) — the Claude Desktop path already works today, so it is a convenience with the highest cost and risk, not a dependency of anything above it.

---

## §1 — Goal

Let five people build a সহায়িকা together at the quality one person achieved alone: nothing reaches print that has not passed the validator, no image is used that a reviewer has not seen against its manifest, no disputed point is settled without a senior reviewer's written answer, and any sentence in a finished book can be traced back — years later — to the policy version, the conversation, and the ruling that produced it.

## §2 — Gap table

| Area | Current (scd-hub `main`) | Desired |
|---|---|---|
| Book authoring | Nothing. Lives on one laptop as `content/C1-BAN/book.json`. | `SupportBook` + per-lesson docs; wholesale-by-lesson merge (SB-1). |
| The policy the LLM needs | Nothing. Lives as Claude Project knowledge. | Versioned `PolicyDoc` rows; hashed into every generation (SB-1, D-#403). |
| Validator | A local CommonJS CLI, run by hand. | Server-side gate on every merge, both paths (SB-1). |
| Image handoff | Filenames typed into JSON by the same person who made them. | Prompt surface → upload → Drive with tags → reviewer sees it (SB-2). |
| Reviewer / senior-reviewer chain | Nothing. `ReviewAssignment` reviews *lesson plans*, not book lessons. | Item-anchored, multi-round escalation with attachments (SB-3). |
| Assembly | `node src/build-book.js …` on the laptop. | Queued build job on a worker; PDFs land in Drive (SB-4). |
| "Why does this read this way?" | A closed Claude chat. | Rationale timeline per lesson / block / slot (SB-5). |
| Chapter generation without Claude Desktop | Not possible. | In-app streaming chat that emits a schema-valid patch (SB-6). |

## §3 — Reused / unchanged (do not rebuild)

- **Google Drive store** — `DriveStore` + `StoredFile` + `GET /files/:id` (GP-A, D-#70). New `book_*` file kinds and a `books/<BOOK_ID>/…` subtree; the server-in-the-middle rule is absolute — `driveFileId` never reaches a client.
- **Access Control AC-1** — role-as-template + per-user grants/revokes (D-#193/#212). The five production roles are **grants**, not new `ROLES` entries (D-#405).
- **Audit log** — `writeAudit` / `Audit` (ADR-008) keeps answering "who did what". The editorial "why" is a separate book-plane log (D-#411).
- **`ReviewAssignment` shape** — copied as a *pattern* (address key, round numbering, one-open-round guard), not extended. It is keyed to `ContentArtifact` and stays there.
- **`docxConvert` precedent** — shelling out to a heavy binary with per-call temp dirs, `shell:false`, best-effort failure. The render worker is the same pattern at larger scale.
- **Notifications** — in-app notify on assignment / escalation / build result rides the existing pipeline; push later.
- **`PrintRequest`** — a finished edition can be filed to the office print queue (PQ, D-#281) rather than growing a second print path. Deferred; see §7.

## §4 — New vocabulary (app-native; `/shared/vocab.ts`; BN labels + English codes)

> App-native only; **no envelope/schema twin, no harness sync** (D-#405). Verifier asserts presence + BN/EN label coverage over `PERMISSIONS`.

**Book shape (mirrors `SCHEMA_support-book_v1`, verbatim values — do not rename):**
- `BOOK_MODES = [R, C]` — প্রতিস্থাপন-মোড / পরীক্ষা-নির্ভর মোড.
- `LESSON_ACTIONS = [retain, retain-curated, replace]`; `LESSON_SEVERITIES = [S1, S2, S3, S4]` — S4 is the "fits no C-code" escalation flag (README §3.2), not a severity band; Mode-C books admit S1 only.
- `BW_TREATMENTS = [native_safe, redesigned, print_only_omit]`.
- `BLOCK_TYPES = [heading, instruction, oral_text, decodable_text, poem, rhyme, story, dialogue, word_list, exercise, fill_blank, matching, writing_line, tracing_ref, table]`.
- `BLOCK_SOURCES = [nctb, school]`.
- `IMAGE_CLASSES = [object, narrative_figure, animal_story, diagram, photo_replace, tracing_asset]`.
- `IMAGE_SLOT_ACTIONS = [substitute_objects, generate_stripe, redraw_schematic, keep_nctb, omit, vector_asset]`.
- `RENDER_PROFILES = [print-colour, bw-photocopy]` — both always rendered (D-016 upstream).

**App-native workflow vocab:**
- `LESSON_STATES = [COMPLIANCE_MAP, RULED, CONTENT_DRAFT, CONTENT_APPROVED, IMAGES_APPROVED, COMPLIANCE_DONE, ASSEMBLED, QA_PASSED]` — the README §7 status flow, per পাঠ.
- `IMAGE_SLOT_STATES = [DRAFT, PROMPT_READY, GENERATED, APPROVED, COMPLIANT, REJECTED]`.
- `PATCH_SOURCES = [DESKTOP_UPLOAD, IN_APP_CHAT]`; `IMAGE_SOURCES = [EXTERNAL_UPLOAD, IN_APP_API]` — both permanent, neither a migration away from the other (D-#419).
- `ARTIFACT_STAGES = [APPROVED, CROPPED, UPSCALED, COMPLIANT]` — the per-slot lineage chain; each records a fingerprint of its input and output so a re-approval upstream can mark everything downstream stale (D-#417).
- `LINEAGE_STATES = [FRESH, STALE, MISSING]` — per slot per stage; **any STALE anywhere locks assembly**.
- `REVIEW_GATES = [IMAGE_GRID_REVIEWED, CROP_GRID_REVIEWED, UPSCALE_TEXTURE_REVIEWED, STRIP_GRID_REVIEWED, RENDER_SPOT_CHECKED]` — human eyeball gates that the system may never satisfy on a person's behalf; each stores `{by, at}` (D-#418).
- `ESCALATION_STATES = [OPEN, ANSWERED, RESOLVED, WITHDRAWN]`; `ESCALATION_TARGETS = [LESSON, BLOCK, IMAGE_SLOT]`.
- `BUILD_STATES = [QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED]`; `BUILD_SCOPES = [LESSON, RANGE, FULL]`.
- `POLICY_DOC_KEYS = [README, DECISIONS, SCHEMA, REF1_CURATION, REF2_REGISTER, ASSEMBLY, PROJECT_INSTRUCTIONS, LETTER_INVENTORY]` — `LETTER_INVENTORY` is per-book; the rest are programme-wide.
- `VALIDATOR_CHECKS = [C1_JSON_VERSION, C2_INVENTORY_FLAGS, C3_CODES, C4_LETTER_AUDIT, C5_GENRE, C6_SLOT_BOOLEANS, C7_SOURCE_NOTE, C8_SCRIPT_GUARD, C9_NO_STRIPE_LANGUAGE, C10_MAP_DERIVABLE, C11_BW_COMPLETE]` with `severity ∈ [RED, GREY, INFO]` per README §6.

**Permissions (default-deny; granted per user via AC-1, not by role template — D-#405):**
- `book:read` — read books, lessons, prompts, images, threads (every production role holds it).
- `book:author` — upload a patch, run the authoring chat, merge on a green validator.
- `book:illustrate` — read prompts, upload generated images, mark a slot GENERATED.
- `book:review` — reviewer verdicts, raise an escalation.
- `book:review_senior` — answer escalations, content sign-off (`reviewer_signoff`).
- `book:assemble` — queue a build, release an edition.
- `book:manage` — create books, upload policy versions, assign people, read everything (grantable to OFFICE).

> **The PRINCIPAL holds all seven by template (D-#424).** Owner ruling: the Principal can author, illustrate, review, sign off and assemble. Permissions were never the constraint — the constraints in this contract are **row-level separations** (a reviewer is not the author of *that* book; SB-3's checklist sign-off is a second pair of eyes), and holding every grant does not by itself dissolve them. How they resolve for a one-person operation is D-#424: **the separation becomes a stamp, not a wall.** The Principal may occupy both sides; the system records that it happened rather than refusing it, because in a school where no second person exists, blocking the work is useless and pretending a second person reviewed it is worse. `selfReviewed: true` is stamped automatically, shown on the book, and carried in the rationale timeline. No typed reason is required — for a solo Principal it would read "nobody else available" every time, which the flag already says.

> Contract chores that ride with this: add all seven to `PERMISSIONS`, `PERMISSION_BUILD_STATUS` (`build`), `PERMISSION_LABELS_BN`, `PERMISSION_LABELS_EN`. **None is RESERVED** — reserved perms are ungrantable and these must be grantable. Grant `book:manage` to `PRINCIPAL` in `ROLE_PERMISSIONS`; grant nothing else by template.

---

## §5 — Slices

### SB-1 — Foundations: policy store, book + lesson models, patch → validate → merge
**The book plane's connection.** `server/src/bookDb.ts` — `mongoose.createConnection(process.env.BOOK_MONGODB_URI)`; every model in this module registers on it (`bookConn.model(...)`). No `populate` or `$lookup` crosses the boundary: a `userId` is a bare ObjectId resolved in the resolver against the main connection. `connectDb()` is untouched (D-#404).

> **Ops, non-optional (D-#413):** the book database is a **self-hosted `mongod` on the existing VM**, and its `storage.wiredTigerEngineConfig.cacheSizeGB` **must be pinned to 1**. WiredTiger's default cache is 50 % of (RAM − 1 GB) — on a 23 GB host that is ~11 GB claimed for a database holding under 100 MB of JSON, which would sit in contention with the SB-4 renderer for no benefit. Back it up with the existing nightly cron (`/opt/scdhub/backup.log`), not a second mechanism.

**`PolicyDoc`** — `{ docKey ∈ POLICY_DOC_KEYS, bookId?, version, body, sha256, uploadedBy, uploadedAt, activeFrom, active }`. Upload + activate is `book:manage`. The **active set** for a book is: every programme-wide doc's active version + that book's `LETTER_INVENTORY`; its ordered concatenation has a `policySetHash`. A superseded version is never deleted (D-#403).

**`SupportBook`** — `{ bookId, classLevel ∈ ROSTER_CLASS_LEVELS, subject ∈ ROUTINE_SUBJECTS, mode, titleBn, baseNctbPrintYear, hasTextEn, status, frontMatter, layoutPresets, versionLog[], createdBy }`.

**`SupportBookLesson`** — one document per পাঠ (**not** one 764 KB blob — per-lesson docs are what make parallel chapters safe and mirror the wholesale-by-lesson merge rule): `{ bookId, lessonNo, nctbTitleBn, nctbPages[], genre, competencyCodes[], outcomeCodes[], action, cCodes[], severity, state, blocks[], imageSlots[], nctbOmitted[], bwTreatment, reviewerSignoff, notes, layout[], currentPatchId, policySetHash }`. Unique index `(bookId, lessonNo)`.

**`LessonPatch`** — `{ bookId, lessonNo, patchId, task, source ∈ PATCH_SOURCES, payload, validatorReport, policySetHash, chatSessionId?, escalationIds[], submittedBy, mergedAt?, mergedBy?, supersedes? }`. Append-only; a merge replaces the lesson **wholesale by `lesson_no`** — no field-level merging, per SCHEMA §5.

**The validator** — ported to `server/src/modules/support-book/services/validator/` as TypeScript, check-for-check against the real sources, which are in **two places and two languages** (surveyed 2026-08-01, D-#427):
- **`studybook-pipeline/src/validate-studybook.js`** implements six checks — `checkTopLevel`, `checkInventory`, `checkScriptGuard`, `checkImages`, `checkBwTreatment`, `checkLayout`. It contains **no letter audit**.
- **`SB-Governance/validator_letter_audit.py`** is the letter audit, a separate executable with its rule documented in its header, driven by **`SB-Governance/letter_inventory_C1-BAN.json`** (43 KB). Both exist; neither is in the pipeline folder, which is why a survey of `studybook-pipeline` alone reports the audit as missing.
- **The inventory's real shape is NOT the one `SCHEMA_support-book_v1.md` §6 documents.** The file carries `{schema_version, inventory_id, book_id, class, subject, source, audit_rule, sequence_summary, open_items, lessons}` — per-lesson — where the schema describes `cumulative_after_lesson` / `kar_after_lesson` / `conjunct_whitelist_by_lesson` maps. **Port against the Python file and the real JSON; the schema doc is stale.** Read `open_items` before trusting a clean run.

The port covers both, plus the shared script-guard allowlist. Letter audit runs for C1–C2 বাংলা only and is skipped otherwise. **A RED result refuses the merge**; GREY merges with a warning. Proven by the upstream **seeded-error test** (README §6): ≥3 planted violations — one letter-audit, one missing flag, one banned glyph — must all be caught before the module counts as pipeline-proven.

**Acceptance:**
- [ ] Book models live on a second connection; a deliberate `populate("User")` from a book model fails loudly in a test (isolation is structural, not conventional).
- [ ] A patch uploaded as a `.json` file merges into exactly one lesson, wholesale, with the prior lesson recoverable from the patch chain.
- [ ] A patch failing any RED check does **not** merge and returns the offending lesson/block/unit, matching the CLI's report for the same input.
- [ ] Seeded-error test: all three planted violations caught.
- [ ] `policySetHash` is stamped on every merged lesson and every patch.
- [ ] Vocab verifier + shared build + server tsc + jest green.

### SB-2 — Image pipeline: prompt out, artwork in, Drive as the store
**Slot surface.** The illustrator's workspace lists books → lessons → slots needing work, and shows each slot's `scene_description`, `image_class`, `action`, `contains_living_being`, `aspect`, `refs[]` (cast reference sheets), and the **prompt** — copyable in one tap. `compliance_note` is shown as guidance; **stripe language is never shown to the illustrator and never enters a prompt** (README §5).

**Two image paths, both permanent (D-#419 — amends D-#409).** `EXTERNAL_UPLOAD` is v1 and stays forever: the illustrator copies the prompt, generates in ChatGPT/Gemini outside the app, uploads the result. `IN_APP_API` lands in a later slice (SB-7) and calls an image model directly with the cast refs attached. This mirrors D-#408's two authoring paths exactly, and for the same reason — **downstream of the upload there is one code path**: same `BookImageAsset`, same slot states, same lineage, same reviewer view. Which path produced a file is recorded in `IMAGE_SOURCES` for the timeline, and nothing else in the module branches on it. The external path is not a stepping stone to be retired; a person with a better result from a tool the app does not call must always be able to bring it in.

**`BookImageAsset`** — `{ bookId, lessonNo, slotId, stage ∈ [RAW, APPROVED, COMPLIANT], storedFileId, generatorTool, generatorNote, promptSha256, uploadedBy, uploadedAt, supersedes? }`. Bytes ride `StoredFile` + `DriveStore` with new kinds `book_image_raw|book_image_approved|book_image_compliant`.

**Drive tagging** (the "store it so it can be found later" requirement): path `SCD-Hub-Files/<year>/books/<BOOK_ID>/<stage>/<lessonNo>-<slotId>-<n>.png`, plus Drive `appProperties` `{ bookId, lessonNo, slotId, stage, promptSha256 }` so a file found from the Drive side identifies itself. Mongo is the index; Drive is the store. `DriveStore.ensureYearSubfolder` currently takes one subfolder name — extend it to a nested path (small, additive).

**Deliberately out of the app for v1:** crop → upscale → strip. It needs `placements.json` and the interactive `preview.js` placement editor, and it is the least valuable part to move. The illustrator (or the assembler) runs it locally and uploads the COMPLIANT file; the app records lineage (D-#409).

**Lineage + staleness — the anti-"easy to forget" system (D-#417).** Adopted wholesale from the storybook workbench, where it is proven over five completed books. Each slot carries `lineage: { approved, cropped, upscaled, compliant }`, each a fingerprint (size + mtime, or sha256) of that stage's output. **Re-approving a slot's image marks every downstream artifact for that slot STALE**, and any STALE artifact anywhere **locks SB-4 assembly** until it is cleared or re-run. The UI names exactly which files are stale rather than reporting a generic "out of date".

This is the difference between a pipeline one person can hold in their head and one a five-person team can run. With 201 image slots across 54 lessons, a re-approved image whose compliant version was never regenerated is not an unlikely mistake — it is the default outcome of a busy week, and it reaches print silently because the PDF still builds.

**Acceptance:**
- [ ] Re-approving one slot flips only that slot's downstream artifacts to STALE, and the build refuses while any STALE remains.
- [ ] The stale list names files, not stages.
- [ ] An illustrator with only `book:illustrate` + `book:read` can see prompts and upload, and cannot edit any text block.
- [ ] A file arriving by `EXTERNAL_UPLOAD` and one by `IN_APP_API` are identical downstream except for the recorded source.
- [ ] Upload of a non-image MIME or an over-cap file is refused in Bangla; the slot state does not move.
- [ ] `driveFileId` appears in no GraphQL type and no HTTP response; images stream through `GET /files/:id` behind a book-plane read gate.
- [ ] A re-upload supersedes rather than overwrites; the prior asset stays readable from the timeline.
- [ ] A slot reaching COMPLIANT records the exact filename that will appear in `book.json`.

### SB-3 — Review + senior-reviewer escalation
**`BookReviewRound`** — anchored to `(bookId, lessonNo)`, one open round at a time, `{ reviewerId, assignedBy, roundNumber, status, verdict, feedback, checklist{} }`. The checklist is README §7 verbatim: genre ✓ · letter audit passed ✓ · শিখনফল coverage ✓ · source note checked ✓ · register vs NCTB (side-by-side) ✓ · images match manifest ✓ · photocopy check ✓.

**The reviewer's screen** shows text and image **together** — blocks in order with their `source`/`edited`/`oral` provenance, each image slot rendered inline at its recorded stage, and the NCTB page reference — because the checklist asks a question ("does this image match its manifest?") that cannot be answered on two screens.

**`BookEscalation`** — `{ bookId, lessonNo, target ∈ ESCALATION_TARGETS, targetId, raisedBy, assignedSeniorId, subject, state, messages[], resolution?, resolvedBy?, resolvedAt? }` with `BookEscalationMessage { authorId, body, attachments[storedFileId], createdAt }`. Multi-round by construction: a senior's reply moves OPEN → ANSWERED; a further reply moves it back to OPEN; either side may add attachments (a screenshot, a source scan, an alternative image).

**The load-bearing rule: an escalation resolution never mutates content** (D-#410). The senior reviewer writes an answer; the *author* then submits a patch that cites `escalationIds[]`, and that patch passes the same validator as any other. This keeps one write path into a lesson and makes the ruling and its application separately visible.

**Acceptance:**
- [ ] Reviewer sees text + images on one screen; cannot edit a block or a slot.
- [ ] An escalation carries the item it is about; a senior reviewer's inbox lists open ones oldest-first.
- [ ] Three or more back-and-forth messages on one item are preserved in order with their attachments.
- [ ] A resolution alone changes no lesson field; the following patch links back to it.
- [ ] `reviewer_signoff.checklist_passed` can only be set true by `book:review_senior` with every checklist item ticked.
- [ ] A non-Principal cannot review a lesson they authored (refused at assignment). **A Principal can**, and the round is stamped `selfReviewed: true` and surfaced wherever the sign-off is shown (D-#424).

### SB-4 — Assembly: the render worker and the assembler's workspace
**`/book-pipeline/`** — the vendored CLI, an npm workspace of its own (`commonjs`, puppeteer + sharp, the 4 Noto TTFs). **Not ported, not modified** (D-#407): ASSEMBLY §1's whole discipline is that the frozen renderer core is never edited for support-book needs, and a TypeScript port would fork it silently.

**`BookBuildJob`** — `{ bookId, scope ∈ BUILD_SCOPES, lessonNos[], profiles[], state, queuedBy, startedAt?, finishedAt?, validatorReport?, geometryReport?, fitGuardReport?, fontAuditReport?, outputs[{profile, storedFileId}], log }`.

**The worker** is a **separate process** from the school API (D-#407) **on the same VM** (D-#413): Chromium is hundreds of MB per render and a 54-lesson book is minutes of work; an OOM there must not take down attendance and homework. It claims a QUEUED job, materializes a temp book folder (`book.json` written from the lesson docs + `images-compliant/` pulled from Drive), runs `validate-studybook.js`, then `build-book.js` for **both** profiles via `execFile` with `shell:false`, captures the geometry assert / fit guard / `pdffonts` audit output into the job, uploads both PDFs to Drive as `book_pdf`, and marks the job SUCCEEDED. **Any failure in either profile fails the whole job** — a single-edition success is not a pass (ASSEMBLY §5).

**The assembler's workspace** offers per-chapter, range and full builds, so a reviewer can be shown chapter 7 alone or chapters 1–7 cumulatively — which is what "other users should be able to see individual and cumulative chapters" needs. Every build's PDFs stay downloadable from the job row, so an older render is never lost.

**Live logs over SSE (D-#418).** The worker streams the spawned script's stdout/stderr to the browser as `text/event-stream`, and writes the full log beside the job. One-directional streaming, no WebSocket, the workbench's proven choice. A build that fails on lesson 31's fit guard should say so **while it is failing**, not in a report after a four-minute wait — the person watching is the one who can fix it.

**Human review gates are real gates (D-#418).** `REVIEW_GATES` are eyeball checks the system may never satisfy on someone's behalf: the strip grid was looked at, the render was spot-checked. Each stores `{by, at}`. The app **never auto-advances past one**, and it never infers a human judgement from a green exit code — the workbench's rule that "the app never sets `anchor.verified`" is the same principle, and here it protects `reviewer_signoff.checklist_passed` (SB-3) the same way. **Backward is always allowed** (re-open images, re-pick a placement); forward past an unmet gate never is.

**Host constraints, measured 2026-07-31 (D-#413) — pin these before SB-4 starts:**
- **The VM is `aarch64`, and Puppeteer publishes no bundled Chromium for linux-arm64.** Install the OS Chromium (`chromium-browser`, a 200 MB snap — the only form Ubuntu 24.04 ARM offers) and set **`PUPPETEER_EXECUTABLE_PATH`**. That is an env var, so the vendored renderer stays byte-identical and D-#407 holds. Verify the browser launches under the systemd unit, not just an interactive shell — snap confinement is the one place this can surprise.
- **Already present on the host:** `pdffonts` (poppler-utils, `/usr/bin/pdffonts`) for the post-render font audit, and `soffice` for the docxConvert precedent. `sharp` has proper linux-arm64 prebuilds. Python 3.12.3 is present.
- **To install (D-#423):** Chromium (above) and **`python3-pil` (Pillow)** — the Python image tools (`crop_edges`, `apply_strips`, `make_strips`) need it and the host does not have it. Verified absent 2026-08-01.
- **One Chromium serves BOTH renderers** (`studybook-pipeline` + `storybook-pipeline`), and builds stay serialized, so adding the second book type raises no memory peak and installs no second browser.
- **Upscaling is sharp everywhere (D-#422)** — the storybook's Upscayl step is dropped; see [prd-storybook.md](prd-storybook.md) ST-4.
- **Concurrency = 1.** The worker claims one job at a time. Two simultaneous Chromiums are the only realistic way to pressure this host, and **the VM has no swap** — under real pressure the kernel OOM-kills rather than degrades.

**Export escape hatch** (D-#406): one action writes the complete book folder — `book.json`, `images-compliant/`, `placements.json`, `layout.json` — as a zip, so the CLI remains runnable on a laptop and the app can never become the only way to build a book.

**Acceptance:**
- [ ] A build produces `out/<BOOK_ID>/<BOOK_ID>-bn-print-colour.pdf` and `-bw-photocopy.pdf`, byte-comparable to a local CLI run over the same inputs.
- [ ] A text overflow fails the job with the offending lesson number and renders nothing.
- [ ] A missing TTF or a non-allowlisted embedded face fails the job (the font audit is not advisory).
- [ ] Killing the worker mid-job leaves the job re-claimable, not wedged in RUNNING forever.
- [ ] Exported folder builds successfully with the standalone CLI.

### SB-5 — Rationale dashboard
**`BookEvent`** (book plane, append-only) — `{ bookId, lessonNo?, targetType?, targetId?, kind, actorId, at, summary, reason?, refs{patchId?, escalationId?, buildJobId?, assetId?, policySetHash?} }`. Written from SB-1 onward, so by the time this slice builds the read surface the history already exists.

**Two logs, different jobs** (D-#411): the main-plane `Audit` keeps answering *who did what* for security; `BookEvent` answers *why does this sentence read this way* for editorial. Neither is derivable from the other, and merging them would put editorial prose in the security log.

**The read surface** is a timeline per book / per lesson / per item: compliance ruling → content patch (with the chat turn or uploaded file behind it) → prompt → image versions → reviewer verdict → escalation thread → senior ruling → the patch that applied it → build result. Every entry names the `policySetHash` in force, and the exact policy text of that version is one click away.

**Acceptance:**
- [ ] For any block in the finished C1-BAN-style book, the timeline answers "why is it worded this way" without opening a chat log outside the app.
- [ ] A superseded policy version is still readable from an old entry.
- [ ] The dashboard is `book:read`; it exposes no student, guardian or staff record beyond the actor's display name.

### SB-6 — In-app LLM authoring chat (the API path)
A streaming chat where the author works a chapter through the nine steps without Claude Desktop. **Built last on purpose** (D-#412).

**Prompt assembly** — ordered and byte-stable so it caches: the active `PolicyDoc` set (~20k tokens: README §4 writing rules, REF-1 C-codes, REF-2 name bank + per-class cast, SCHEMA, the book's letter inventory), then book context, then lesson context, then the turn. `cache_control` breakpoint at the end of the policy block. At Opus 5 rates that prefix costs ≈ $0.10/turn uncached and ≈ $0.01/turn on a cache read; the cache write is 1.25× (5-min TTL) or 2× (1-hour). A policy edit busts the cache — correct, and rare.

**Output** — the model emits the patch through **structured outputs** (`output_config.format` with the §5 patch JSON Schema), not prose the author copies. Assistant prefill is not available on current models, and a schema-constrained object is what makes "the chat emits a patch" real rather than aspirational.

**`BookAuthorChatSession` / `BookAuthorChatMessage`** — one session per chapter attempt; every turn stores model id, `policySetHash`, prompt version, and token usage. The emitted patch links its session, which is what SB-5 renders.

**Guardrails:** the emitted patch goes through the **same validator and the same merge** as an uploaded one (D-#408); a RED result returns to the chat as the model's next input rather than merging; a per-book monthly token ceiling with a Bangla refusal when exceeded; `ANTHROPIC_API_KEY` in server env only.

**Acceptance:**
- [ ] A chapter can be taken from compliance map to merged lesson entirely in-app.
- [ ] Two consecutive turns show `cache_read_input_tokens > 0` — the policy prefix is actually caching.
- [ ] The model's output is schema-valid or rejected; no free-text patch path exists.
- [ ] A merged in-app patch is indistinguishable at the lesson level from a Desktop-uploaded one.
- [ ] Token ceiling refuses in Bangla and logs the refusal.

---

### SB-7 — In-app image generation (the API path)
The second image path (D-#419). A slot workspace that calls an image model directly with the cast reference sheets attached, keeps a per-slot conversation thread so "same scene, the child slightly smaller" works as an edit rather than a re-roll, and lets the illustrator approve one candidate. Proven shape: the workbench does exactly this over five books (`server/images.js` + `server/gemini.js` + `server/keys.js`), including multi-key rotation with 429 cooldown handling and daily-quota resets — read it before designing this slice.

**Non-negotiable carry-overs:** the cast reference sheet is attached to every generation of a canon character — **never generated from text alone** (README §3.4 / SOP 5.2, the drift-prevention rule); every attempt is retained, not just the winner; and **no stripe language ever enters a prompt** (README §5) — the strip stays programmatic and post-generation.

**Acceptance:** [ ] a slot can be generated, iterated and approved in-app; [ ] the approved file is indistinguishable downstream from an uploaded one except for `IMAGE_SOURCES`; [ ] refs are attached on every canon generation; [ ] API keys live in server env, never in a client or a committed file.

---

## §6 — Given/When/Then journeys

1. **Author (Desktop path).** *Given* a chapter written in Claude Desktop, *when* the author uploads `patch_C2-BAN_L012_CONTENT_v1.json`, *then* the validator runs, a RED failure is shown per offending unit with nothing merged, and a green run replaces lesson 12 wholesale and stamps the policy hash.
2. **Illustrator.** *Given* lesson 12 has three PROMPT_READY slots, *when* the illustrator copies each prompt, generates outside the app and uploads the results, *then* each slot moves to GENERATED, each file lands in `books/C2-BAN/raw/` tagged with its slot, and the reviewer's queue shows the lesson as ready for image review.
3. **Reviewer.** *Given* lesson 12's text and images, *when* the reviewer works the seven-item checklist and doubts whether a narration is well-known enough, *then* they escalate that specific block with a message and a screenshot, and the lesson cannot reach CONTENT_APPROVED while an escalation is OPEN.
4. **Senior reviewer.** *Given* an open escalation, *when* they answer — possibly over three exchanges — and mark it RESOLVED, *then* no lesson field changes; the author submits a patch citing the escalation, and the timeline shows ruling → application as two linked events.
5. **Assembler.** *Given* lessons 1–12 at COMPLIANCE_DONE, *when* they queue a cumulative build, *then* a worker renders both editions or fails the whole job with the offending lesson, and both PDFs are downloadable from the job row.
6. **Principal.** *Given* a question about a sentence in a printed book, *when* they open that block's timeline, *then* they see the compliance ruling, the conversation, the reviewer's verdict, the senior's answer, and the policy text as it stood that day.

## §7 — Out of scope (v1)

- **Image processing in-app** — crop, upscale and the compliance-strip placement stay on the local PC (D-#409).
- **Curriculum policy authoring** — policy is *stored and versioned* here; it is *written and decided* upstream. No policy editor beyond upload + activate.
- **The print queue link** — filing a finished edition into `PrintRequest` (PQ) is the obvious next step and is deliberately deferred until SB-4 has run on a real book.
- **Guardian or student visibility** — this module has no guardian surface at all.
- **A second render engine** — no in-app HTML preview that could disagree with the CLI. The preview is the built PDF.
- **Auto-assignment** — who authors, illustrates and reviews which chapter is assigned by a person (`book:manage`); no scheduler.

## §8 — Open questions for the owner

1. **First wave.** Which book after C1-BAN — C1-ENG, C1-MATH, or straight to C2? It sets whether the letter-audit path (C1–C2 বাংলা only) is exercised again immediately.
2. ~~Where the book database lives~~ — **ANSWERED 2026-07-31 (owner): a self-hosted `mongod` on the existing VM** (D-#413). Cap its cache at 1 GB (SB-1) and ride the existing nightly backup cron.
3. ~~VM headroom~~ — **ANSWERED 2026-07-31 by measurement: the worker runs on the same VM** (D-#413). The host is 4 OCPU / 23 GB with **1.4 GB in use, load 0.00, 86 GB of 96 GB disk free** after 48 days uptime; both app servers together hold ~300 MB. Steady-state addition ≈ 350 MB (mongod capped + worker); render peak ≈ 2–4 GB for a few minutes against 22 GB available. **No second VM** — this instance already consumes the entire Always Free ARM allocation (4 OCPU / 24 GB), so a second one would bill on the PAYG account while this one sits 94 % idle. Block storage is 96 GB of the 200 GB free ceiling; the module adds ~1.5 GB. Constraints that ride with the ruling are pinned in SB-1 (Mongo cache) and SB-4 (ARM Chromium, concurrency 1, no swap).
4. **Senior reviewer identity.** Is that the Principal, or a distinct আলিম/senior-teacher account? It decides whether `book:review_senior` ever sits on a non-Principal login.
5. **LLM spend ceiling.** A per-book or per-month cap, and whose key.
6. **Drive retention.** Does the book subtree follow the existing year+1 retention, or is a finished book kept indefinitely?
7. **Image chain.** Confirm crop/upscale/strip stays local for v1 (recommended), or say now if it must move in.

## §9 — Traceability

| Source | Consumed as |
|---|---|
| `README v2.2` §3.2 nine-step loop | The lesson state machine (§4 `LESSON_STATES`) and the SB-1..SB-4 slice boundaries |
| `README` §5 image doctrine + §6 validator profile | `IMAGE_CLASSES`/`IMAGE_SLOT_ACTIONS`, `VALIDATOR_CHECKS` |
| `README` §7 roles + per-পাঠ checklist | The seven permissions (§4) and SB-3's checklist |
| `SCHEMA_support-book_v1` §1–§6 | `SupportBook` / `SupportBookLesson` / `LessonPatch` / `PolicyDoc(LETTER_INVENTORY)` field-for-field |
| `SCHEMA` §5 patch + wholesale-by-lesson merge | SB-1's merge rule; the shared contract between both authoring paths (D-#408) |
| `ASSEMBLY v1.0-draft` §2–§5 | SB-4: the four frozen invariants (font embedding, geometry assert, fit guard, post-render audit), both profiles always rendered, the render-proof gate |
| `PROJECT-INSTRUCTIONS-Production v2.0` | "The filesystem is the database" → superseded here by D-#406 (Mongo authoritative, folder materialized), with the export escape hatch preserving the original posture |
| scd-hub D-#70 (Drive), D-#193/#212 (AC-1), ADR-005 (planes), ADR-008 (audit) | §3 reuse list |
| Storybook Workbench PRD §0/§6/§6.1, `workbench/server/{images,gemini,keys,runner}.js` | D-#417 lineage, D-#418 gates + SSE, SB-7's slot workspace |

---

## §10 — The second book type: storybooks

> **SUPERSEDED IN PART, 2026-08-01 (D-#421):** the closing "explicitly NOT decided" clause below is now decided — **the storybook IS hosted in this system, as a first-class second `bookType`, on the same engine as the সহায়িকা** (owner ruling). Its build contract is **[prd-storybook.md](prd-storybook.md)**, slices ST-1..ST-5. The rest of this section stands as the scope note that led there. Still not decided: the workbench **cutover** (prd-storybook §8), and anything commercial — that exclusion is permanent until its own PRD and its own ruling.

**Owner ruling, 2026-08-01: the storybook line is now school-first** (D-#420). It was designed as a commercial product — 40 books across 8 series, ৳5–20, subscriptions, a streaming reader — and that framing is **demoted, not deleted**: nothing here forecloses selling later, but the school is the primary audience now, which is what makes it eligible to live beside the সহায়িকা at all. The upstream "product separation is absolute" rule (README §7) existed to keep an internal free book out of a sales catalog; with both lines school-first, the rule's purpose is satisfied rather than violated.

**What already exists (do not rebuild, do not move yet):**
- **`workbench/`** — Express + vanilla-JS SPA on `127.0.0.1:4321`. Eight-stage machine (Import → Images → Crop → Upscale → Placements → Strips → Assembly → Done) with entry/completion gates, in-app Gemini image generation with per-slot threads and reference attachment, multi-key rotation, SSE logs, lineage invalidation. **Five S1 books fully assembled through it**; `GB-B01` mid-flight; `S4-B01` importing.
- **`storybook-pipeline/`** — a *different* renderer from `studybook-pipeline`: 8×8 square trim, fixed 24-page spine, 3 profiles × 2 languages = 6 PDFs, cream palette. A `chapter-book-48` format was specified 2026-08-01 and must land **additively** — `S1-B01` has to build byte-identically after it.
- **`pipeline-tools/`** — the Python image chain (`crop_edges`, `apply_strips`, `make_strips`, `pick_placements`) shared in spirit with the সহায়িকা flow.
- Governance: `islamic-series-master-guide.md` (series canon, 6-beat arc, image system, stage prompts), `book-production-sop.md` (11 steps), `writing style.md`, `storybook-business-master-plan.md`.

**What differs from the সহায়িকা and therefore cannot be assumed:** the unit of work is a **slot/book**, not a পাঠ; there is no NCTB fidelity, no compliance C-codes, no letter audit; instead there is **series canon + character consistency** enforced by reference images. Anchor verification is a **fresh-eyes rule** — a different chat/model than the one that wrote the story, then a human hadith check (SOP 2.3: *"an LLM 'verified' is a lead, not a verdict"*). Output is six PDFs, not two. Quality control upstream is *"the chat itself"*, which is a single-founder posture that does **not** survive contact with a team — a storybook slice set would need SB-3's review/escalation chain, which the workbench has no equivalent of.

**Consequence for this contract:** the SB-1..SB-7 core is to be built **book-type-agnostic** — `SupportBook` becomes one `bookType` among others; the stage machine, lineage, review gates, job runner, escalation chain and rationale timeline carry no সহায়িকা-specific assumptions. Type-specific pieces (schema, validator checks, render profiles, policy doc set) sit behind a per-type adapter, which is the same shape ASSEMBLY §1 already uses to keep a shared renderer neutral. **This is a design constraint on SB-1, not extra work in SB-1.**

**Explicitly NOT decided here:** whether the workbench is migrated into scd-hub, rewritten, or left running on the laptop; the storybook's own slice set; and anything about a storefront, reader app, pricing or payments — **no commercial surface enters this repo without its own PRD and its own ruling.** The workbench is producing books today; nothing in this module should stop it.
