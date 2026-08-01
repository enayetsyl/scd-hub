# PRD — Storybook production (the second book type)

**Status:** DRAFT (build contract) — planning 2026-08-01
**Owner:** Principal
**Module:** `support-book` — **the same module, a second `bookType`** (D-#420/#421). Not a new module, not a new plane, not a second database.
**Decisions:** D-#421–#423 (this contract); rides the engine decisions D-#403–#420
**Companion:** [prd-support-book.md](prd-support-book.md) — the engine contract. **Read it first.** Everything about the policy store, the book plane's Mongo connection, permissions, lineage, review gates, escalation, the rationale timeline and the render worker is defined there and is NOT repeated here.
**Implements (external, LOCKED — stored as `PolicyDoc` DATA, never repo files, D-#403):** `islamic-series-master-guide.md` (series canon, 6-beat arc, image system, stage prompts, JSON schema), `book-production-sop.md` (the 11 steps), `writing style.md`, `Category Research.md`. The commercial plan (`storybook-business-master-plan.md`) is imported **for its production rules only** — §H distribution/pricing is out of scope here (§7).
**Vendors (unmodified, spawned — D-#407):** `storybook-pipeline/` (its own renderer: 8×8 square trim, `standard-24` spine, `chapter-book-48` in flight) and `pipeline-tools/` (`crop_edges.py`, `apply_strips.py`, `make_strips.py`, `pick_placements.py`).
**Informed by (proven, not migrated):** `workbench/` — five S1 books assembled through it. Its ideas are already adopted into the engine (D-#417/#418); its code stays where it is and keeps running (§8).

---

## §0 — At a glance / build order (read first)

- **What:** the same team workflow as the সহায়িকা — author, illustrator, reviewer, senior reviewer, assembler — applied to original Bengali/English children's storybooks, on the same engine, in the same app.
- **Why it is a second `bookType` and not a second module:** they differ in *content rules*, not in *process shape*. Both are: author a JSON → generate images against reference sheets → apply a compliance strip → review → render PDFs → log why. D-#420 already made the engine book-type-agnostic; this contract is what fills in the adapter.
- **School-first (D-#420).** The line was designed commercially and is now primarily for the school's own children. **No storefront, reader, pricing or payment surface is in scope** (§7) — that would need its own PRD and its own ruling.
- **Where it stands today:** five S1 titles fully assembled, `GB-B01` (chapter-book-48, গুবলেট বিজ্ঞান) mid-flight at crop, `S4-B01` importing. The workbench that produced them keeps running until this replaces it, function by function.
- **Build order:** **ST-1** book type + import + validator → **ST-2** images on the shared engine → **ST-3** the anchor-verification gate → **ST-4** assembly (6 PDFs) → **ST-5** catalog + school release. ST-1 cannot start before SB-1..SB-2 exist — this contract has no engine of its own.

---

## §1 — Goal

Produce original storybooks with a team, at the quality one person reached alone, on one engine shared with the সহায়িকা: no unverified narration reaches print, no canon character drifts across a book, no stale image ships, and every editorial decision is retrievable years later.

## §2 — Gap table

| Area | Today | Desired |
|---|---|---|
| Where production lives | `workbench/`, one laptop, localhost, no auth, single user | The app: multi-user, permissioned, audited (ST-1..ST-5) |
| Who may work on a book | Whoever is at the laptop | Named holders of `book:author` / `illustrate` / `review` / `assemble` (ST-1) |
| Anchor verification | SOP rule: a fresh chat, then a human hadith check | A **gate** — verifier ≠ author, human tick, blocks assembly (ST-3) |
| Quality control | *"QC is the chat itself"* — a single-founder posture | The engine's review + escalation chain (SB-3), unchanged |
| Upscale | Upscayl — a Windows GPU binary | **sharp** on the server (D-#422) |
| Rationale | A closed chat | The engine's rationale timeline (SB-5), unchanged |
| Catalog | `catalog.json` on the laptop | A school library entry (ST-5) |

## §3 — Reused from the engine (do not rebuild, do not fork)

Everything in [prd-support-book.md §5](prd-support-book.md) applies unchanged: the `PolicyDoc` store and `policySetHash` stamping (D-#403); the book plane's own Mongo connection (D-#404); **the same seven `book:*` permissions — no new permission is needed for storybooks** (D-#405); patch → validator → wholesale merge (D-#408); the two image paths (D-#419); per-slot lineage and staleness (D-#417); human review gates and SSE logs (D-#418); the item-anchored escalation chain (D-#410); the two logs (D-#411); the vendored-and-spawned renderer rule (D-#407); the export escape hatch (D-#406).

**What the adapter supplies per type:** the JSON schema, the validator's check set, the render profiles, the policy doc set, and the stage list. Nothing else may branch on `bookType`.

## §4 — New vocabulary (app-native; `/shared/vocab.ts`)

- `BOOK_TYPES = [SUPPORT_BOOK, STORYBOOK]` — সহায়িকা / গল্পের বই.
- `STORYBOOK_FORMATS = [mini-8, standard-24, chapter-book-48]` — the interior shapes. `standard-24` is the proven one; `chapter-book-48` is text-forward with interspersed illustrations and **no anchor page**; `mini-8` is the short form.
- `STORYBOOK_PROFILES = [screen, print-archive, a4-home]` × `BOOK_LANGUAGES = [bn, en]` = **six outputs per book** (the সহায়িকা renders two — the adapter, not the engine, knows this).
- `STORYBOOK_STATES = [STORY_DRAFT, STORY_APPROVED, ANCHOR_VERIFIED, TRANSLATED, IMAGES_APPROVED, COMPLIANCE_DONE, ASSEMBLED, QA_PASSED]` — the SOP status flow.
- `ANCHOR_STATES = [NOT_APPLICABLE, UNVERIFIED, LLM_CHECKED, HUMAN_VERIFIED, UNVERIFIABLE]` — `LLM_CHECKED` is **not** a pass, because *"an LLM 'verified' is a lead, not a verdict"* (SOP 2.3). **`NOT_APPLICABLE` is DERIVED, never selectable** — a book that declares no anchor has nothing to verify (D-#426).
- `STORY_PAGE_TYPES = [title, story, anchor, guardian, back]`.
- `SERIES_CODES` — the eight locked series + `GB` (গুবলেট বিজ্ঞান), each with its canon cast.

> No new permissions. No wire-contract twin. Verifier asserts BN/EN label coverage as usual.

---

## §5 — Slices

### ST-1 — The storybook type: models, import, validator
`SupportBook` gains `bookType`; a `StorybookPage` model mirrors `SupportBookLesson` as the per-unit document (`{ bookId, pageNo, pageType, textBn, textEn, imageSlot, layout, containsLivingBeing }`). Import accepts the two files the authoring chat produces — `book.json` (schema 1.2) and `prompts.json` — and **cross-validates them** before anything is stored.

**The validator is `storybook-pipeline/src/validate.js`, spawned** (D-#407) — never re-derived in app code. The app adds exactly one check of its own, as a **warning at import rather than a failure at assembly**: the master guide's floor that **≥30 % of slots contain no living being**. `validate.js` remains the enforcing gate; surfacing it early stops a book being fully illustrated before anyone learns it is non-compliant.

**Acceptance:** [ ] a book imports only when `book.json` and `prompts.json` agree on the slot list; [ ] the app never re-implements a `validate.js` check; [ ] the living-being ratio warns at import and still hard-fails at assembly; [ ] a `SUPPORT_BOOK` and a `STORYBOOK` sit in the same collections with no engine code branching on type outside the adapter.

### ST-2 — Images on the shared engine
No new image machinery. Slots ride `BookImageAsset`, both paths (D-#419), the same Drive tree at `books/<BOOK_ID>/`, and the same lineage chain — which for storybooks runs `approved → cropped → upscaled → compliant`, exactly the workbench's four stages.

**Series canon is the storybook's equivalent of the সহায়িকা's per-class cast**, and the drift rule is identical and non-negotiable: **a canon character is never generated from text alone — the approved reference sheet is attached to every generation** (SOP 5.2). Every attempt is retained. The strip stays programmatic and post-generation; **no stripe language ever enters a prompt**.

**Acceptance:** [ ] a canon generation without its refs attached is refused; [ ] re-approving a slot marks its cropped/upscaled/compliant artifacts stale and locks assembly (D-#417); [ ] `refs/` is read-only and never processed as a slot.

### ST-3 — The anchor-verification gate (the one genuinely new gate)
The SOP's most important rule is a *separation* rule, and today it is honoured by discipline: verification happens in a **different chat and preferably a different model** than the one that wrote the story, and then **a human confirms the hadith reference and grading personally**. In the app it becomes a gate:

- `anchor: { type, reference, textBnMeaning, state ∈ ANCHOR_STATES, checkedBy, verifiedBy, verifiedAt, note }`.
- **The verifier may not be the author** of that book — refused at assignment, the same shape as the classroom-observation conflict guard (observer ≠ observed). **Except the Principal, who may self-verify (D-#424):** the round is stamped `selfVerified: true` and that flag is shown on the book and in the timeline. The rule's purpose is that a reader can tell whether a second pair of eyes saw the narration — which the stamp answers honestly, and which a refusal would not answer at all in a school with one qualified person.
- **The app never sets `HUMAN_VERIFIED`** from any automated or model output. A model result records `LLM_CHECKED` and nothing more. This is the workbench's "the app never sets `anchor.verified`" rule (D-#418) at its origin point.
- **Assembly is locked unless `HUMAN_VERIFIED` — or `NOT_APPLICABLE`** (D-#426), with the reason in words: *guide §5 forbids shipping an unverified narration*.
- **`NOT_APPLICABLE` is derived from the book's declared shape, never hand-set.** A book with no `anchor` and no anchor page has no narration to verify. **Proven by GB-B01 in the field**: `chapter-book-48`, 45 pages of `chapter-opener`/`prose-plate`/`prose`, no `anchor` key at all — and the workbench's gate (`!!(book.anchor && book.anchor.verified === true)`) collapsed its absence to `false`, treating "nothing to verify" exactly like "unverified narration" and locking assembly permanently. The book was only built by bypassing the app. **Derivation, not a checkbox, is the whole point** — a selectable "n/a" is a one-click way to skip verification on a book that genuinely needs it, which is the failure this gate exists to prevent.
- `UNVERIFIABLE` is a first-class outcome that sends the block back to the author — never a silent downgrade to "probably fine".
- Series with retold narratives carry the master guide's extra rule: a scholar's review before proceeding, recorded as an escalation to `book:review_senior` (SB-3).

**Acceptance:** [ ] verifier ≠ author enforced at assignment **for every role except PRINCIPAL**, whose self-verification is allowed and stamped `selfVerified` (D-#424); [ ] no code path sets `HUMAN_VERIFIED` without a named human and a timestamp — self-verification changes *who may*, never *whether a human did*; [ ] assembly refuses on anything but `HUMAN_VERIFIED` or `NOT_APPLICABLE`, in Bangla, naming the rule; [ ] **a book with no declared anchor resolves to `NOT_APPLICABLE` and assembles** — the GB-B01 regression (D-#426); [ ] `NOT_APPLICABLE` cannot be set by a user on a book that declares an anchor; [ ] `UNVERIFIABLE` routes back to the author.

### ST-4 — Assembly: six PDFs, on the server
The render worker (SB-4) gains the storybook adapter: materialize the book folder, run `crop_edges.py` → **sharp upscale (D-#422)** → `pick_placements`/`apply_strips.py` → `fit-sweep.js --write` → `validate.js` → `build-book.js`, producing `screen`, `print-archive` and `a4-home` in both languages. All six must pass or the job fails — the সহায়িকা's both-editions rule, widened.

**Upscayl is dropped (D-#422).** It is a Windows `.exe`, a Vulkan/GPU upscaler with no ARM64 Linux build, on a host with no usable GPU. Upscaling moves to **sharp**, which the studybook pipeline already uses and which runs on the server — so both pipelines share one server-runnable upscale step instead of two incompatible ones. Output must still clear the pipeline's own minimum-dimension gate; that gate is the arbiter, not the tool.

**Host additions (D-#423):** `python3-pil` (Pillow) for the Python tools — Python 3.12.3 is present, Pillow is not. **One Chromium serves both renderers**, and **builds stay serialized at concurrency 1**, so a second book type adds no memory peak.

**Acceptance:** [ ] six PDFs per book, any failure failing the job; [ ] `S1-B01` rebuilds identically to its laptop-built PDFs (the regression gate); [ ] sharp-upscaled images clear the pipeline's dimension gate; [ ] the `chapter-book-48` path renders without altering `standard-24` output.

### ST-5 — Catalog + school release
`catalog.json` becomes a `BookCatalogEntry`: titles, series, book number, format, age band, value theme, page count, language pair, output PDF handles, completion date. **Release means "available to the school"** — no price, no purchase, no external distribution. Whether finished books surface in the existing Library module (`library:read`) or as their own shelf is deliberately left to §8.

**Acceptance:** [ ] a book reaching QA_PASSED appends exactly one catalog entry; [ ] no pricing, payment or external-distribution field exists anywhere in the model.

---

## §6 — Given/When/Then journeys

1. **Author.** *Given* an approved story and prompts, *when* they import both, *then* cross-validation and `validate.js` run, the living-being ratio is reported, and the book enters `STORY_APPROVED`.
2. **Verifier.** *Given* a book whose author is someone else, *when* they check each claim and confirm the hadith reference themselves, *then* they set `HUMAN_VERIFIED` with their name and the date — and until they do, assembly stays locked.
3. **Illustrator.** *Given* 21 slots with prompts, *when* they generate with the series refs attached and approve one candidate each, *then* the lineage chain starts and the crop stage unlocks.
4. **Reviewer.** *Given* a page's text and its image side by side, *when* they doubt a retelling detail, *then* they escalate that block to the senior reviewer, and the book cannot reach `COMPLIANCE_DONE` while it is open.
5. **Assembler.** *Given* everything fresh and the anchor human-verified, *when* they queue a build, *then* six PDFs land in Drive or the job fails naming the offending page.
6. **Principal.** *Given* a question about a line in a printed story, *when* they open its timeline, *then* they see the draft, the verification, the reviewer's note and the policy version in force that day.

## §7 — Out of scope (explicitly)

- **The entire commercial surface**: storefront, reader app, streaming/DRM, watermarking, pricing, subscriptions, bundles, payment gateways. School-first (D-#420) means the school is the audience; **selling would need its own PRD and its own ruling**, and nothing in this contract forecloses or prepares it.
- **Story/translation/prompt authoring UI** for v1 — authoring stays in the chat, exactly as the সহায়িকা's SB-6 sequencing has it.
- **Migrating `workbench/`** — see §8. It keeps running; this replaces it function by function, not in one cut.
- **Adaptation of third-party works** (the business plan's §G "Adapt" mode). It carries derivative-work risk that is a legal question, not a build question.
- **Arabic support** — a locked upstream decision.

## §8 — Open questions for the owner

1. **Cutover.** The workbench has `GB-B01` mid-flight and `S4-B01` importing. Does the app take new books only, letting those two finish on the laptop — or is there a migration?
2. **Where finished storybooks appear** for the school: inside the existing Library module, or their own shelf?
3. ~~Who verifies anchors~~ — **ANSWERED 2026-08-01 (owner, D-#424): the Principal may self-verify**, stamped `selfVerified` and visible on the book. Anyone else still needs verifier ≠ author. A named second verifier remains preferable — the stamp exists to make its absence visible, not to make it unremarkable.
4. **`chapter-book-48`** was specified 2026-08-01 with a byte-identical `S1-B01` regression gate. Is it landing on the laptop first, or straight into this module?
5. **Age bands beyond 6–9.** The business plan names four; the school's use may need fewer.

## §9 — Traceability

| Source | Consumed as |
|---|---|
| `book-production-sop.md` 11 steps + status flow | `STORYBOOK_STATES`, the ST-1..ST-5 boundaries |
| SOP 2.1–2.4 (fresh eyes, human hadith check) | ST-3, the whole gate |
| SOP 5.2 (never generate canon from text alone) | ST-2's refusal |
| `islamic-series-master-guide.md` §5/§6/§8 | Red lines, image system, series canon → `SERIES_CODES`, the ≥30 % floor |
| `storybook-pipeline` `validate.js` / `fit-sweep.js` / `build-book.js` | ST-4, spawned unmodified (D-#407) |
| `chapter-book-48-implementation-spec.md` | `STORYBOOK_FORMATS`, ST-4's additive constraint |
| `storybook-business-master-plan.md` §A–§G | Production rules only; §H excluded (§7) |
| prd-support-book.md D-#403–#420 | The entire engine (§3) |
