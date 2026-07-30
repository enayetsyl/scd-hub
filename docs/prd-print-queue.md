# PRD — Print request queue (one queue for everything the Office prints)

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** generalize the Class Test tracker's built-in print request into a **single
`PrintRequest` queue** every teacher submits to and the Office works from: app-generated
question sets, chapter/session plans, uploaded PDFs/images, and external links (Google
Form). Adds the missing **`DELIVERED`** state so the Office can track *yet to print →
printing done → delivered to the teacher*. **No new permission** (reuses `tracker:write`
to submit and `roster:manage` to operate — exactly the existing class-test print gates).
Operational/identity plane; no corpus path.

This is the build contract; the decision is authoritative in `DECISIONS.md` (D-#281).

---

## 1. Goal
Teachers already print through the app in exactly one place — a **Class Test** is *born as
a print request* (`ClassTest`, status `REQUESTED → PRINTED`). Everything else (a homework
question set, a session plan, a custom worksheet PDF, a Google Form link) is printed by
walking to the Office. The school wants **one queue** with **one lifecycle**, and the
Office wants to see what is still to print, what is printed, and what has been handed back.

## 2. What exists today (the blueprint — reuse it)
- **`ClassTest`** (`server/.../trackers/models/ClassTest.ts`) — the print request itself:
  `requestedBy/At` + `printedBy/At` stamps, queue index `{status, requestedAt}`, source is
  **exactly one of** `setId` (an assembled `AssessmentSet`) or `questionFileId` (a
  `StoredFile` of kind `classtest_question`).
- **`ClassTestService`** — the status machine: `createRequest` / `markPrinted` (guards
  `REQUESTED`) / `cancelRequest`, each `writeAudit`-stamped.
- **Gates** — teacher submit `tracker:write` + `assertCanWrite(section)`; Office actions
  `roster:manage` (`assertPrintAdmin`). **There is no `print:*` permission and none is added.**
- **`StoredFile`** — Drive-backed; clients only ever see the Mongo `_id` and stream through
  `GET /files/:id`, whose read gate **dispatches on the file's own `kind`**. Per-kind upload
  routes (`POST /files/classnote` etc.) with mime/size validators.
- **`GET /pdf/set/:id`** (`set:read`) — renders an **assembled** set to PDF on demand, with
  `?answers=1&marks=1` toggles.
- **`ContentArtifact`** — `chapter_plan` / `session_plan` rows, referenceable by `_id`.
- **Emitters** (`notifications/services/emitters.ts`) — `bestEffort` wrappers that `emit({
  recipientUserId, kind, titleBn, bodyBn, refs, dedupeKey })` and never block the mutation.
- **`ClassTestPrintQueueScreen`** — the Office queue UI to generalize.

## 3. Design

### 3.1 No PDF snapshot is required
An earlier draft proposed snapshotting the generated PDF at request time so a teacher could
not edit the paper after submitting. **Unnecessary:** `GET /pdf/set/:id` refuses a set that
is not `assembled`, and an **assembled set is locked** (add/remove questions is draft-only).
A bare `setId` reference is therefore already immutable in content. Uploads are
self-snapshotting. Only an external link is mutable, and that is outside our control.
So **every source is a reference by id** — same as `ClassTest` does today.

### 3.2 The model
```
PrintRequest
  requestedBy, title, purpose, copies, neededByDateKey
  classId? sectionId? subject? notes?
  source — EXACTLY ONE OF:
    setId             → an assembled AssessmentSet (HW / assignment / class-test paper)
    contentArtifactId → a chapter_plan | session_plan
    fileIds[]         → uploads (StoredFile kind "print_upload", ≤5 files)
    linkUrl           → Google Form / Doc
  status: REQUESTED → PRINTED → DELIVERED     (+ CANCELLED)
  requestedAt/By · printedAt/By · deliveredAt/By · cancelledAt/By · cancelReason?
```
`PRINT_REQUEST_STATUSES` + `PRINT_PURPOSES` (`classwork | homework | assignment |
class_test | lesson_plan | other`) land in `/shared/vocab.ts` with BN/EN label maps, the
house convention; the shared-vocab verifier must stay green.

### 3.3 The state machine (owner rulings, D-#281)
| Transition | Actor | Gate |
|---|---|---|
| create → `REQUESTED` | teacher | `tracker:write` |
| `REQUESTED → PRINTED` | Office/Principal | `roster:manage` |
| `PRINTED → DELIVERED` | Office/Principal | `roster:manage` |
| `REQUESTED → CANCELLED` | requester or Office | requester, else `roster:manage` |

Three statuses map exactly onto the Office's three buckets — **no separate in-progress
state**. `DELIVERED` emits a notification to the requesting teacher (`recipientUserId`);
the teacher does **not** confirm receipt (single-actor, mirroring `markPrinted`).

### 3.4 The class-test queue is absorbed
`ClassTest` keeps its test lifecycle (results, publish, approval — D-#277) but **its printing
concern moves to `PrintRequest`**: `ClassTest.printRequestId` points at the row, and the
Office works **one** queue. `ClassTestPrintQueueScreen` is retired in favour of the unified
screen. Existing `ClassTest` rows are migrated (one `PrintRequest` per row, status carried
across, `printRequestId` back-filled).

## 4. Build-step → slice map
| Slice | Build-step | Status |
|---|---|---|
| **PQ-1** | vocab enums + `PrintRequest` model + status machine + audit + resolvers (teacher create/list/cancel; Office queue/markPrinted/markDelivered) | buildable first |
| **PQ-2** | Sources: `print_upload` StoredFile kind + `POST /files/print` + `GET /files/:id` read-gate branch; `linkUrl`; `contentArtifactId`; `setId` | after PQ-1 |
| **PQ-3** | App — teacher "Send to print" (generic form + entry points on Set detail and Plan view) + "My print requests" with status | after PQ-2 |
| **PQ-4** | App — Office unified Print Queue (tabs *To print / Printed / Delivered*, filters by teacher / purpose / needed-by, actions) | after PQ-3 |
| **PQ-5** | Fold class-test printing in (`ClassTest.printRequestId` + migration; retire the CT queue) + `PRINT_DELIVERED` notification kind + emitter | last |

## 5. Journeys & acceptance criteria

### PQ-1 — Model + machine
- **PQ1.1** A teacher creates a request; it is born `REQUESTED`, stamped `requestedBy/At`, audited.
- **PQ1.2** Exactly one source is set; zero or two sources reject (model-level XOR, the `StudentAttendanceDay` pattern).
- **PQ1.3** `markPrinted` guards `status === "REQUESTED"`; `markDelivered` guards `PRINTED`. Out-of-order transitions reject.
- **PQ1.4** A teacher may cancel their OWN `REQUESTED` row; the Office may cancel any. A `PRINTED` row cannot be cancelled.
- **PQ1.5** Office queue = `REQUESTED`, oldest first (index `{status, requestedAt}`).

### PQ-2 — Sources
- **PQ2.1** `POST /files/print` accepts jpeg/png/pdf ≤10 MB, ≤5 files, gated `tracker:write`; `GET /files/:id` admits the requester and `roster:manage`.
- **PQ2.2** `setId` must reference an **assembled** set; the queue row opens `GET /pdf/set/:id`.
- **PQ2.3** `contentArtifactId` must reference a `chapter_plan`/`session_plan`; the queue row opens the plan viewer.
- **PQ2.4** `linkUrl` must be an absolute http(s) URL; the queue row opens it externally.

### PQ-3/PQ-4 — App
- **PQ3.1** "Send to print" is reachable from Set detail, Plan view, and a standalone form (upload / link).
- **PQ3.2** The teacher's "My print requests" shows status + timestamps and allows cancel while `REQUESTED`.
- **PQ4.1** The Office queue has three tabs matching the three statuses, each row showing requester, purpose, copies, needed-by, and a source-appropriate open action.
- **PQ4.2** `Mark printed` / `Mark delivered` advance the row and move it between tabs.

### PQ-5 — Absorption + notification
- **PQ5.1** A class-test request creates a `PrintRequest`; the Office sees it in the unified queue; `ClassTest.printRequestId` links them.
- **PQ5.2** Existing `ClassTest` rows migrate with status carried across; no print job is lost.
- **PQ5.3** `markDelivered` emits `PRINT_DELIVERED` to `requestedBy` (best-effort; never blocks the mutation).

### PQ-6 — Reprint history *(**D-#362**, owner ask; additive to PQ-3/PQ-4)*
- **PQ6.1** A screen lists **already-printed** jobs — `PRINTED` + `DELIVERED` only (a cancelled or
  still-queued job is not history) — so a document that was printed before is never sent to the Office
  a second time as a fresh upload.
- **PQ6.2** Rows are **one per document**: repeats of the same source for the same class × subject ×
  purpose collapse into a single row carrying `printCount`, `firstPrintedAt`, `lastPrintedAt` and the
  distinct requesters. The source identity is the set / artifact id, the sorted upload file-id list, or
  the link URL. Class/subject/purpose are part of the key deliberately — the same sheet printed for
  class 3 and class 4 stays two rows, because those are the axes the list is browsed by.
- **PQ6.3** Ordering is **class level → subject → purpose → newest print**, with filter chips on the
  same three axes; a job with no class sorts last. Purpose order follows `PRINT_PURPOSES`
  (classwork, homework, assignment, class test, lesson plan, other).
- **PQ6.4** Scope is server-side: `roster:manage` sees every requester's prints; a teacher
  (`tracker:write`) sees only their own — there is no argument that widens it.
- **PQ6.5** **Reprint** clones the earlier job's source, colour/sides, copies and class/subject/purpose
  into a new `REQUESTED` job for a **new use date** (`neededByKey` is required — a reprint is always for
  a new day; copies may be overridden). The original's requester or the Office may reprint; the new job
  belongs to whoever filed it. Audited as `PRINT_REQUEST_REPRINTED` with `fromPrintRequestId`, and the
  queue's operators are notified exactly as for a fresh request.
- **PQ6.6** A reprint **never re-links the class test**. `classTestId` is not copied: a `ClassTest`'s
  `PRINTED` status is what makes it the official exam (CT-1), so a second print of the same paper must
  not mirror another transition onto that record.
- **PQ6.7** The upload "you may only attach files you uploaded" rule does **not** apply to a reprint —
  the files were already accepted onto a printed job, and the Office reprints other people's jobs. The
  source is still re-checked for **existence**, so a reprint can never open onto a 404.
- **PQ6.8** The read scans a bounded window of recent printed jobs; hitting the bound is reported
  (`scannedCapped`) and surfaced in the app rather than silently truncating the list.

### PQ-7 — History filters the Office actually needs *(**D-#390**, owner ask off live use; additive to PQ-6)*
- **PQ7.1** The **page limit reports itself** (`truncated`, `totalRows`) exactly as the scan cap does —
  PQ6.8 covered only the scan. The old default of 200 groups against 263 grouped documents dropped 63
  rows with nothing on screen to say so. Default and max are now the scan cap (1000), so the reported
  scan bound is the only ceiling.
- **PQ7.2** A **printed-on window** (`fromKey` / `toKey`, inclusive `YYYY-MM-DD`) filters the JOBS
  *before* grouping — "printed in June" means a print landed in June, not that the document's newest
  print did. `toKey` includes its whole day. A row with no `printedAt` (migration-backfilled) is matched
  on `requestedAt`, the same fallback the grouping uses, so a dated view cannot silently drop it.
- **PQ7.3** The history may be narrowed **by requester** (`requestedBy`). Office only: for a teacher the
  scope is already their own rows, so the argument is ignored rather than allowed to widen it — PQ6.4
  stands. Rows expose `requesterIds` alongside `requesterNames` (index-aligned) so the filter keys off
  identity, not a display name two staff could share.
- **PQ7.4** The class filter offers **every roster class** (Nursery … Class 5), not just classes that
  appear in the returned rows. Deriving the axis from the rows hid Nursery/KG entirely — only the
  class-test path tagged a job with a class, so 244 of 269 printed jobs carried none.
- **PQ7.5** A print request **names the class and subject it is for** (both optional — an office notice
  belongs to no class), so a teacher-filed job is findable on those axes later. For a `CLASS_PRESENT`
  job the count's class defaults to the job's own class.
- **PQ7.6** "No class" is a **filter in its own right**, distinct from "all". It previously shared the
  "any" sentinel, which rendered it as a second permanently-lit copy of the *all* chip that filtered
  nothing.

### PQ-8 — The class a print is *for* *(**D-#391**, owner ask: the PQ-7 chips were still empty)*
- **PQ8.1** The history's class axis reads the **effective class**: the job's own `classId`, else
  `copiesClassId` — the class a `CLASS_PRESENT` job prints one copy per present student of. PQ7.4 gave
  the chips a complete roster but every historical job still answered "no class", so Nursery listed 0
  documents and Class 1 listed 1 of 263. This is not inference: `copiesClassId` is a class the teacher
  explicitly picked on the job. Live effect — Nursery 0→7, KG 1→9, Class 1 1→27, Class 2 4→35,
  Class 3 4→37, Class 4 7→36, Class 5 8→43, no-class 238→72.
- **PQ8.2** A job's **own class wins** where both are set: a class-1 sheet whose count follows class 3's
  attendance is a class-1 print, and must not appear under class 3.
- **PQ8.3** The effective class is part of the **grouping key**, so the same sheet printed for two
  different classes stays two rows — the axis the history is browsed by (PQ6.2 rationale, now applied to
  the class that is actually known).
- **PQ8.4** Rows expose the effective class as `PrintHistoryRow.classId` / `classLevel`, *separate* from
  `latest.classId`, which keeps meaning the job's own field. The row-level pair is what the class chips
  and the row label read.
- **PQ8.5** The server's `classId` filter matches the same effective class, and `noClass` selects the
  honest remainder — jobs naming a class **neither** way (72 live: fixed-count uploads and links, no
  section either). Class is not inferred from a title, so those stay untagged and are reached by
  teacher + date instead.

## 6. Out of scope
- **A `print:*` permission** — reuses `tracker:write` / `roster:manage` (D-#281).
- **Teacher receipt confirmation** — the Office marks delivered; no acknowledge step.
- **Plan → PDF rendering** — plans render from markdown (ADR-006), not through `/pdf/set`; the queue row opens the existing plan viewer. A true plan-PDF path is a later slice if the Office asks.
- **Print cost / paper accounting.**

## 7. Reused / unchanged
- `StoredFile` + Drive store + `GET /files/:id` kind-dispatched read gate — extended with one `kind`, not replaced.
- `GET /pdf/set/:id` on-demand renderer — unchanged.
- `writeAudit` on every transition; `bestEffort` emitter for the delivered notification.
- Plane/firewall (ADR-005) — identity/operational only; no corpus path.
