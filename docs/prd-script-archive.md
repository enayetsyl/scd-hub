# PRD — Answer-Script Archive (physical storage + retrieval, `archive` module)

| | |
|---|---|
| **Status** | v1.0 — BUILT (AR-1..AR-4, branch `feat/script-archive`, 2026-08-04) |
| **Owner** | Principal |
| **Date** | 2026-08-04 |
| **Decisions** | D-#443, D-#444, D-#445, D-#446, D-#447 (this session); builds on D-#34 (tracker ids), D-#85 (derive-never-store), D-#94/#17 (compose existing permissions), D-#143 (server-side resolution from sectionId), D-#145 (no schoolId), D-#193/#211 (AC-1 per-user grants), D-#441 (`hasAnyPermission` scope for OR-gates), ADR-008 (audit); precedents: library D-#81–#84 (accession/shelf/desk), print-queue D-#281, `ClassTestQuestionRequest.rounds[]` (embedded append-only log) |
| **Plane** | Operational / identity (ADR-005) — no corpus path |
| **Relation to `prd-exams.md`** | Fills the storage-location gap its EX-7 stage 13 (`ARCHIVE`) leaves open; when EX-7 builds, its ARCHIVE custody event **creates/references a ScriptBundle** here rather than a second archival record (one-line amendment to prd-exams.md at EX-7 build time) |

## 0. At-a-glance (checklist for the builder)

- [ ] **Source-agnostic archive**: `ScriptBundle.source = {kind ∈ ARCHIVE_SOURCE_KINDS, refId}`; only `CLASS_TEST` is wired in v1, `EXAM` is reserved vocabulary for the exams module.
- [ ] **Bundle-per-test granularity** — one record per class test: count, box, filed-by/when. NO per-student rows.
- [ ] **Simple filing record** — single-actor declared count + ONE additive office acknowledgement + embedded append-only checkout log. Explicitly NOT the EX-6 two-signature/DISPUTED chain (that stays exam-only).
- [ ] **Registered `StorageBox`** with server-minted `BX-{year}-{seq}` code; boxes grouped **per class, per year**; relocation = one record edit; RETIRED, never deleted.
- [ ] **Checkout is an Office desk action only** (`roster:manage`) — the library-desk posture; borrower may be any staff member.
- [ ] **Retention = current + previous academic year**; disposable list DERIVED on read (no stored flag, no scheduler — D-#21 posture); disposal only via explicit audited action; shred paper only after the app records DISPOSED.
- [ ] One live (non-VOID) bundle per test, enforced by a partial unique index **from day one**.
- [ ] No new permission, no new role — compose `tracker:write` / `tracker:read` / `roster:manage`.
- [ ] App-native vocab only (`shared/vocab.ts` + BN labels) — no wire-contract twin; vocab verifier green every slice.
- [ ] Every state transition writes an audit row (ADR-008).

## 1. Goal

Class-test answer scripts are checked, marks are entered (CT-1..CT-11), and then
the paper disappears into drawers. There is no way to answer "where are the
scripts for CT-C5-BAN-0001?" or "show me this student's English test from May" —
for a guardian conversation, a mark dispute, or a re-check — without a manual
hunt. This module gives the school (a) a paper-world filing SOP the office can
run, and (b) an in-app record of it, so any test's scripts are retrievable in
under a minute: search the ctId → the app answers "Box BX-2026-05 · অফিস
আলমারি, তাক ২" → date-ordered bundle → roll-ordered script.

The archive layer is **shared**: term-exam scripts (prd-exams.md, unbuilt) will
file into the same boxes and the same model when EX-7 lands.

## 2. Settled product choices (Principal, 2026-08-04)

1. **Shared archive layer**, not class-test-only — the exams module files into it later without a schema change.
2. **Bundle per test** — the unit is one test's scripts (one section, one subject), sorted by roll, cover sheet on top. No per-student tracking.
3. **Simple filing record** — "N scripts of test X filed in box Y" by one actor, one office acknowledgement, and a checkout/check-in log when a bundle is pulled later. Not the two-signature EX-6 chain.
4. **Boxes per class, per year** — e.g. `BX-2026-05` = "Class Five · ২০২৬", all subjects mixed, bundles in exam-date order; a whole class-year retires together. Scripts stay findable even without the app (cover sheets + date order are self-describing).
5. **Checkout = Office desk action only**, like the library desk — one accountable custodian.
6. **Retention: current + previous academic year** protected; older bundles surface in a derived disposable list; disposal is an explicit, audited app action.

## 3. Gap table

| Need | Exists today | Gap |
|---|---|---|
| Where a test's scripts physically are | Nothing — `ClassTest` chain stops at PRINTED | `ScriptBundle` keyed to the test + box + location |
| Labeled storage containers | Library `BookTitle.shelf` free-text hint only | `StorageBox` register: minted code, label, location, status |
| Box code minting | `ClassTestSequence` atomic `$inc` pattern (ctId) | `StorageBoxSequence` per-year counter → `BX-{year}-{seq}` |
| Who took a bundle out and why | Nothing | Embedded append-only `checkouts[]` (borrower, purpose, expected return, returned) |
| Retention / disposal | Nothing | Derived disposable list + audited `disposeScriptBundle` |
| Photo of a bundle/cover sheet | `StoredFile` + kind-dispatched `GET /files/:id` | New kind `archive_photo` + `POST /files/archive` |
| Audit | Append-only `Audit` (ADR-008) | New `SCRIPT_BUNDLE_*` / `STORAGE_BOX_CHANGED` kinds |
| Term-exam scripts | prd-exams.md EX-7 stage 13 names `ARCHIVE` but has no storage model | This module IS the storage truth; EX-7 references it later |

## 4. Vocabulary & contract impact

**App-native only — NO wire-contract twin** (same ruling as trackers D-#33,
library, routine; verified: `CLASS_TEST_STATUSES` / `PRINT_REQUEST_STATUSES`
have no `import-contract.schema.json` presence). The vocab verifier is extended
and must stay green.

Additions to `/shared/vocab.ts` (+ `*_LABELS_BN` for UI-facing values):

- `ARCHIVE_SOURCE_KINDS = [CLASS_TEST, EXAM]` — `EXAM` reserved, unwired in v1.
- `SCRIPT_BUNDLE_STATUSES = [FILED, CHECKED_OUT, DISPOSED, VOID]` — `VOID` = filed-in-error, terminal, record kept (the BookCopy `WITHDRAWN` posture).
- `STORAGE_BOX_STATUSES = [ACTIVE, RETIRED]` — `RETIRED` = closed to new filings; contents stay findable; never deleted.

**No new permission (D-#447).** Teachers file under `tracker:write` (own
section), the Office operates under `roster:manage`, reads ride `tracker:read`.
The one OR-gate (`fileScriptBundle`) is a declared `hasAnyPermission` scope per
D-#441 — never an in-body check. If one person becomes the archivist, that is
an AC-1 grant, not a new mechanism. `CUSTODY_*` vocab from prd-exams.md is NOT
reused — it is a docs-only reservation for custody *events*; a bundle is a
storage *record*.

Audit kinds appended to `Audit.ts`: `SCRIPT_BUNDLE_FILED`,
`SCRIPT_BUNDLE_ACKNOWLEDGED`, `SCRIPT_BUNDLE_CHECKED_OUT`,
`SCRIPT_BUNDLE_CHECKED_IN`, `SCRIPT_BUNDLE_DISPOSED`, `SCRIPT_BUNDLE_VOIDED`,
`STORAGE_BOX_CHANGED` (create/edit/retire in one kind, prior+new in meta — the
`LIBRARY_CATALOG_CHANGED` pattern).

## 5. Model (`server/src/modules/archive/models/`)

Doc-comment headers cite this PRD's § and D-# rows. No `schoolId` (D-#145).
Nothing is ever deleted.

- `StorageBox` — `boxCode` (**unique, server-minted** `BX-{year}-{seq}` via a
  per-year `StorageBoxSequence` counter, the `ClassTestSequence` atomic-`$inc`
  pattern — avoids the typed-code typo risk), `label?` (free text, e.g.
  "Class Five · ২০২৬"), `locationNote` (required free text, Bangla — e.g.
  "অফিস আলমারি, তাক ২"; the `BookTitle.shelf` precedent), `status`
  (STORAGE_BOX_STATUSES), `createdBy/At`. **Derived on read (D-#85), never
  stored:** `bundleCount`, `scriptCount`.
- `ScriptBundle` —
  - `source: { kind, refId }` (ARCHIVE_SOURCE_KINDS; v1: `CLASS_TEST` → `ClassTest._id`).
  - Resolved **server-side at filing** from the source row (D-#143 posture),
    never client-supplied: `academicYearId`, `classLevel`, `sectionId`,
    `subject`, `testNumber`, `examDate` — powers browse/retention queries
    without cross-module joins on every read.
  - `scriptCount` (min 1) — declared once by the filer.
  - `boxId` (ref StorageBox, required).
  - `filedBy`, `filedAt`.
  - `acknowledgedBy?`, `acknowledgedAt?` — the one office acknowledgement as an
    **additive stamp, not a status** (the CT-8/CO-8 `publishedAt` pattern);
    auto-stamped when the filer already holds `roster:manage`; the
    pending-acknowledgement list is `acknowledgedAt == null`, derived.
  - `status` (SCRIPT_BUNDLE_STATUSES): `FILED → (CHECKED_OUT ↔ FILED) →
    DISPOSED`; `VOID` reachable from FILED only.
  - `checkouts: [{ toUserId, purpose (required text), expectedReturnDateKey?,
    checkedOutBy/At, returnedBy?/At?, returnNote? }]` — **embedded append-only
    array** (the `ClassTestQuestionRequest.rounds[]` precedent; volume is tiny
    and the log is always read with the bundle). Open checkout = last element
    with `returnedAt == null`; **overdue is derived**, never stored.
  - `attachmentFileIds?: ObjectId[]` — `StoredFile` kind `archive_photo`.
  - `disposedBy/At?, disposeReason?` · `voidedBy/At?, voidReason?` · `notes?`.
  - **Indexes**: partial unique `{ "source.kind": 1, "source.refId": 1 }` where
    `status ≠ VOID` — **one live bundle per test, shipped day one** (the CT-11
    index was deferred only because live duplicates already existed; here there
    is no data yet), plus a service-level guard first so the refusal is a
    friendly Bangla error naming the existing bundle's box. Also
    `{boxId: 1, status: 1}`, `{status: 1, filedAt: -1}`,
    `{academicYearId: 1, classLevel: 1, subject: 1}`.
  - **Deliberately absent**: per-student rows (choice 2); an `itemKind` field —
    v1 bundles are answer scripts by definition; if mark-sheet archival is ever
    wanted, add `itemKind` then (additive, default ANSWER_SCRIPT).

## 6. Physical SOP (paper world)

1. **Bundle** — after checking + marks entry, the test's scripts are sorted by
   roll, rubber-banded, cover sheet on top:

   ```
   CT-C5-BAN-0001
   শ্রেণি: Five · শাখা: — · বিষয়: বাংলা · Test #1
   পরীক্ষার তারিখ: 2026-08-02 · স্ক্রিপ্ট: ৮টি
   ফাইল করেছেন: [name] · [date] · বাক্স: BX-2026-05
   ```

   Handwritten on a pad in v1; AR-4 optionally renders it as a PDF. The `ctId`
   is the retrieval key on paper and in-app.
2. **Box** — one box per class per year, all subjects mixed, bundles in
   exam-date order (newest at the front). When full, open "…box 2" for the same
   class (a second `StorageBox` with its own minted code). The box label carries
   the minted code + the class/year in Bangla.
3. **Location** — the box record's `locationNote` says where it stands; moving
   a box = editing that one record, every bundle follows.
4. **Retrieval** — app: search ctId (or tap the test on the dashboard) → box
   code + location → pull box → flip to the date → roll order finds the script.
   Without the app: pull the class's box, cover sheets + date order do the job.
5. **Checkout** — anyone needing a bundle comes to the office; the desk records
   who/why/expected return before the bundle leaves the box; check-in on return
   (optionally into a different box).
6. **Disposal** — when a year ages out of retention, the office pulls the
   class-year boxes from the disposable list, records DISPOSED per bundle (or
   box-batch in the UI), and only then shreds. Boxes are RETIRED, not deleted.

## 7. GraphQL surface

Queries (gate: `tracker:read` unless noted — operational metadata, staff-wide;
the print-queue posture):

- `scriptBundleForTest(sourceKind, refId)` — the retrieval story: bundle + box + location + open checkout.
- `scriptBundles(filter: {yearId?, classLevel?, subject?, status?, boxId?, ctIdQuery?})`.
- `storageBoxes(status?)` (with derived fill counts) · `storageBox(id)` (contents).
- `openScriptCheckouts(overdueOnly?)`.
- `disposableScriptBundles` — `roster:manage` (derived from the retention rule).

Mutations (every transition audited; state guards refuse out-of-order):

| Mutation | Gate | Guards |
|---|---|---|
| `fileScriptBundle(input)` | `hasAnyPermission: [tracker:write, roster:manage]` (D-#441); teachers additionally `assertCanWrite` on the test's own section | source exists; ClassTest is `PRINTED`; box `ACTIVE`; no live bundle for the source |
| `acknowledgeScriptBundle(id)` | `roster:manage` | once; not VOID/DISPOSED |
| `checkOutScriptBundle(id, {toUserId, purpose, expectedReturnDateKey?})` | `roster:manage` | status `FILED` |
| `checkInScriptBundle(id, {note?, boxId?})` | `roster:manage` | status `CHECKED_OUT`; target box `ACTIVE` if re-boxing |
| `disposeScriptBundle(id, reason)` | `roster:manage` | status `FILED` — never while checked out; outside retention window |
| `voidScriptBundle(id, reason)` | `roster:manage` | status `FILED` |
| `createStorageBox` / `updateStorageBox` / `retireStorageBox` | `roster:manage` | retire refuses while… nothing — a retired box keeps contents findable, it only refuses NEW filings |

App documents in `app/src/graphql/archive.ts` (schema-vs-document jest gate).

## 8. App screens (`app/src/screens/archive/`)

Small office tool. Gates via `useAuth().can()` (D-#438), never
`roleHasPermission`. All strings via `STR` labels (Bangla-first; codes in Latin
digits).

- `ArchiveHomeScreen` — search by ctId; box list (code/label/location/fill);
  open checkouts with overdue badge; pending acknowledgements. View under
  `tracker:read`; actions under `roster:manage`.
- `FileBundleScreen` — pick a `PRINTED` test with no live bundle → count → box
  picker → optional photo.
- `BundleDetailScreen` — cover-sheet fields, box + location, checkout log,
  actions per `can()`.
- `StorageBoxScreen` — location edit, contents, retire.
- **Existing-screen affordance** — a "স্ক্রিপ্ট কোথায়?" line on the
  `ClassTestDashboardScreen` drill-down and `ClassTestHomeScreen` PRINTED rows:
  filed → "Box BX-2026-05 · অফিস আলমারি, তাক ২" (+ "X-এর কাছে" if checked
  out); not filed → "ফাইল করা হয়নি" + a file action for the test's
  teacher/Office.

Navigation: an office-facing entry (Admin-stack tile or drawer leaf per the
D-#439/#440 precedent — decide at build time by who holds the gate; leaf perms
exist since D-#440).

## 9. Slices

### AR-1 — Core: file + look up (shippable alone)
Vocab + verifier; `StorageBox` + `StorageBoxSequence` + `ScriptBundle` (+ the
partial unique index); `ArchiveService`; `fileScriptBundle`,
`createStorageBox`/`updateStorageBox`, `scriptBundleForTest`, `storageBoxes`;
audit kinds; minimal `FileBundleScreen`; the class-test-screen lookup line.

**Acceptance:** filing a PRINTED test's bundle succeeds and writes
`SCRIPT_BUNDLE_FILED`; a second live bundle for the same test is refused with a
Bangla error naming the existing bundle's box; a REQUESTED or CANCELLED test is
refused; the lookup line on the class-test screen shows box code + location for
a filed test and "ফাইল করা হয়নি" otherwise; `boxCode` is server-minted and
unique; vocab verifier + server tsc/jest + app document gate green.

### AR-2 — Acknowledgement + checkout/check-in
Ack stamp (auto when the filer holds `roster:manage`); embedded checkout log;
overdue derivation; `BundleDetailScreen`; `openScriptCheckouts`.

**Acceptance:** only `roster:manage` acknowledges, exactly once; checkout
requires `FILED` and records borrower + purpose; check-in requires
`CHECKED_OUT` and may re-box; both audited; overdue appears once
`expectedReturnDateKey` passes and is never stored; the log is append-only (no
edit path exists).

### AR-3 — Archive home + retention + disposal + photos
`ArchiveHomeScreen`, `StorageBoxScreen`, browse filters;
`disposableScriptBundles` (current + previous academic year protected, derived);
dispose/void with reason; box retire; `archive_photo` kind + `POST
/files/archive` + the `GET /files/:id` read-gate branch.

**Acceptance:** dispose is refused while CHECKED_OUT and inside the retention
window; DISPOSED/VOID bundles remain readable with reason + actor; the
disposable list is derived (no stored flag, no scheduler); a RETIRED box
refuses new filings but its contents stay findable; a photo uploads and streams
back through the gated file route.

### AR-4 (optional polish) — Cover-sheet PDF
`GET /pdf/archive-cover/:bundleId` on the existing on-demand renderer pattern.

**Acceptance:** renders ctId/class/section/subject/test#/date/count/box code;
refused for VOID bundles.

## 10. Decisions appended this session

- **D-#443** — Shared source-agnostic script-archive module; bundle-per-test, no per-student rows.
- **D-#444** — Simple filing record (single actor + additive ack + embedded checkout log), NOT the EX-6 two-signature chain.
- **D-#445** — Registered per-class-per-year `StorageBox`, server-minted `BX-{year}-{seq}`, free-text location, RETIRED never deleted.
- **D-#446** — Retention current + previous academic year; derived disposable list; audited explicit disposal; no scheduler.
- **D-#447** — Archive enums vocab.ts-only; permissions composed (`tracker:write`/`tracker:read`/`roster:manage`), no `archive:*`; `CUSTODY_*` not reused.

## 11. Deferred / out of scope

- Term-exam filing (`source.kind = EXAM`) — wired when EX-7 builds; prd-exams.md gets its one-line amendment then.
- `itemKind` (mark sheets, question papers) — additive later if wanted.
- Barcodes/QR on boxes or bundles — the library's no-barcode v1 ruling applies.
- Per-student script tracking and guardian-facing visibility — not in v1.
