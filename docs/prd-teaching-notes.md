# PRD — Teaching Notes (শিক্ষক নোট): per (class × subject) note library with teacher improvement comments

**Status:** BUILT 2026-08-22 on `feat/teaching-notes` — **TN-1, TN-2 and TN-3 complete** (library,
comment loop, print, notifications). The decisions landed as **D-#514–#518**; the D-#513–#516
proposed below were renumbered because `origin/dev` took D-#513 while this was in flight. The BN
library name shipped as **নোট ও গাইড**, not the শিক্ষক নোট proposed in §7 — that string is already
the English Drive `TN` kind's label and would have collided in the drawer. It still needs owner
sign-off.

**Contract note on TN-3's notifications.** They add three `NOTIFICATION_KINDS`, six message-template
keys and the verifier's exact-equality list — all in `shared/vocab.ts`, which the unlanded
`feat/exams` (last commit 2026-07-29) also edits in the same three regions. AGENTS "Parallel
sessions" §5 serializes contract files; this was built anyway on the owner's explicit instruction
to finish the feature. Every edit is **append-at-end** of its list, so rebasing `feat/exams` is a
both-sides-keep resolution rather than a rewrite.

**One design change made during the build, recorded in D-#516:** §3's visibility rule said the
scope walk alone. It is not sufficient — `Subject.code` is FOUNDATION_SUBJECTS, so ARABIC and QURAN
have no `Subject` row to grant and are reachable only through `RoutineSlot`. The shipped rule walks
the routine AND the grants.

**The ask (owner, 2026-08-22):** upload the note / how-to-answer-question guide for each class and
subject; the respective subject teacher sees it and adds improvement comments on each file; those
comments are visible to the Principal and are tagged to the file for easy identification; a teacher
may comment many times on one file and many teachers may comment on the same file; an updated file
replaces the earlier one.

---

## 1. Goal

A curated, versioned library of TEACHER-FACING pedagogy documents — "how to answer a Class 5 Bangla
long question", "Class 5 Science short/long answer structure", a chapter helper note — keyed by
**(class level × subject)**, with a per-document improvement-comment thread the Principal supervises.

This is NOT curriculum content (no envelope, no import contract, no corpus path) and NOT a student-
or guardian-facing surface. It is an operational-plane staff library.

## 2. What it rides on (composition, not new infrastructure)

Every load-bearing part already exists and is proven in production:

| Need | Reused as-is |
|---|---|
| File bytes | `StoredFile` (Drive-backed; `driveFileId` is server-internal, never serialized) |
| Upload / download | `server/src/routes/files.ts` — the `POST /files/english-drive` block is the template, incl. DOCX→PDF via `docxConvert`; `GET /files/:id` per-kind read gate |
| Replace-the-earlier-one | `EnglishDriveDoc` semantics — an upload of an existing identity stamps the old row `replacedAt` and inserts the new; reads take the unreplaced row; history retained |
| "The respective subject teacher" | `resolveTeacherScopes` walked for teaching/proxy/supervisory items (the `EnglishDriveService.ts:118` pattern) |
| Comment thread with resolve | the `BookItemComment` shape (that model sits on the book connection; this one is main-DB) |
| Audit | `writeAudit` (ADR-008) |
| Print | `createPrintRequest` (TN-3) |
| Notify | the notifications `emit()` seam (TN-3) |

**No wire-contract change.** The subject axis is the EXISTING `ROUTINE_SUBJECTS` enum
(`shared/vocab.ts`) — BAN/ENG/MATH/SCI/BGS/ARABIC/ISLAM/QURAN, BN labels already present. The `kind`
enum is app-native with no wire twin (the routine/HR shape, D-#46/#52). `/skills/contract-sync` and
`verify_shared_vocab.mjs` are untouched.

## 3. Decisions locked by the owner (2026-08-22)

**Proposed D-#513 — Upload/replace is Principal + Office only, on the existing `roster:manage`.**
No new permission string. A senior teacher who should curate a subject is granted it individually
through Access Control (AC-1), which is exactly the case that surface exists for — widening the
TEACHER role to get one curator would hand upload of every subject to every teacher.

**Proposed D-#514 — An improvement comment carries `OPEN | ADDRESSED` status.** A comment nobody
has to answer is a comment that gets skipped in a busy week; this is the same reasoning already in
force for `BookItemComment` and for escalations. ADDRESSED is set by the uploader or Principal/Office
with an optional one-line note. The Principal then gets a real cross-subject "still outstanding"
list rather than a wall of undifferentiated remarks.

**Proposed D-#515 — Read visibility is (class × subject)-scoped for teachers; Principal/Office read
all; GUARDIAN has no path.** A teacher sees the Class 5 Bangla guide when they hold a teaching or
proxy scope for BAN in any section of a class at level 5 — the `EnglishDriveService` walk,
generalised from "English only, class-keyed" to "any ROUTINE_SUBJECT, (class × subject)-keyed".

**Proposed D-#516 — The comment thread anchors to the document IDENTITY, not the version row, and
each comment stamps `versionSeen`.** This is the load-bearing choice and it is not a detail. Comments
pinned to a version row would vanish the moment the improved file replaced the old one — destroying
the exact feedback the feature exists to collect, and destroying it silently. Anchoring to
`(classLevel, subject, kind, seq)` makes the thread outlive replacement; `versionSeen` then lets a
reader tell at a glance whether a suggestion predates or postdates the current file ("written on v2,
current is v3"), which is what makes "did v3 act on this?" answerable at all.

## 4. Data model (app-native; module `server/src/modules/teaching-notes/`)

### 4.1 `TeachingNote` — identity `(classLevel, subject, kind, seq)`

| Field | Type | Note |
|---|---|---|
| `classLevel` | `RosterClassLevel` −1..5 | WIDER than English Drive's 1..5 — Nursery/KG get notes too |
| `subject` | `RoutineSubject` | all 8, incl. ARABIC/QURAN/ISLAM |
| `kind` | `ANSWER_GUIDE \| LESSON_NOTE \| SYLLABUS \| OTHER` | module-local enum, no wire twin |
| `seq` | int ≥ 1 | several docs per (class, subject, kind) |
| `title` | string | |
| `version` | int ≥ 1 | monotonic per identity |
| `format` | `MD \| PDF \| DOCX` | |
| `contentMd` | string | set for MD; ≤ 1 MB (the English Drive cap) |
| `fileId` | → `StoredFile` | the ORIGINAL binary (PDF/DOCX); null for MD |
| `pdfFileId` | → `StoredFile` | LibreOffice-converted preview for DOCX; null otherwise |
| `fileName` / `fileMime` | string | download name + MIME |
| `uploadedBy` | → `User` | |
| `replacedAt` | Date \| null | stamped when a newer version supersedes this row |

Index: `{ classLevel, subject, kind, seq, replacedAt }` — the library list is the hot read.

### 4.2 `TeachingNoteComment`

| Field | Type | Note |
|---|---|---|
| `noteKey` | `{ classLevel, subject, kind, seq }` | the ANCHOR — survives replacement (D-#516) |
| `noteId` | → `TeachingNote` | the exact version commented on |
| `versionSeen` | int | denormalized from that row so the anchor renders without a join |
| `bodyBn` | string | |
| `anchor` | string \| null | optional free text — "Type 5 — তুলনা / পার্থক্য". NOT inline PDF annotation |
| `authorId` | → `User` | |
| `status` | `OPEN \| ADDRESSED` | D-#514 |
| `addressedBy` / `addressedAt` / `addressedNote` | | |

Indexes: `{ noteKey…, status, createdAt }` (the thread + the outstanding list) and
`{ authorId, createdAt }`.

### 4.3 One new `StoredFileKind`: `teaching_note`

Plus a branch in the `GET /files/:id` read gate dispatching to `assertTeachingNoteFileReadAccess`
— the same §3/D-#515 visibility rule as the GraphQL read, enforced independently at the byte path.

## 5. Upload boundary — the encoding guard (non-negotiable)

The owner's four seed documents, as handed over, are **mojibake**: UTF-8 bytes decoded as Latin-1,
so `বাংলা` arrives as `à¦¬à¦¾à¦à¦²à¦¾`. If the uploader does not defend against this, every Bangla
note in the library is unreadable and nobody notices until a teacher opens one weeks later.

The markdown upload path MUST decode strictly as UTF-8 and REJECT a body carrying the `Ã` / `à¦`
mojibake signature, with a Bangla error naming the fix ("ফাইলটি UTF-8 হিসেবে সেভ করে আবার আপলোড
করুন"). This is a repo-recurring failure mode (the BUG-009 signature); the same trap says never
round-trip these files through PowerShell `Get-Content` / `Set-Content`.

## 6. Slices

### TN-1 — model + upload/replace + scoped library + viewer (build first)
`TeachingNote` model, `POST /files/teaching-note`, `uploadTeachingNote` mutation (`roster:manage`),
`teachingNotes` / `teachingNote` queries with the (class × subject) scope filter, the read-gate
branch, the encoding guard, and the three screens. Ends by loading the owner's four real files.

### TN-2 — comments
`TeachingNoteComment` model, `addTeachingNoteComment` / `setTeachingNoteCommentStatus` /
`deleteOwnTeachingNoteComment` (soft), the thread UI under the viewer, the per-doc badge
("৩টি পরামর্শ · ১টি বাকি"), and the Principal's cross-subject open-comments list. Includes the bulk
"mark these open comments ADDRESSED" prompt offered at new-version upload.

### TN-3 — notifications + print
New doc/version → notify that class's teachers of that subject. New comment → notify the uploader
and the Principal. Status change → notify the comment author. All through the existing `emit()`
seam. Plus "send to print" via `createPrintRequest`.

## 7. Screens (`app/src/screens/teachingnotes/`, mirroring `englishdrive/`)

- `TeachingNotesHomeScreen` — class × subject picker, doc list, open-comment badges
- `TeachingNoteDocScreen` — MD render / PDF preview + version history + comment thread
- `TeachingNoteUploadScreen` — Office/Principal upload + replace
- The Principal open-comments list (may live on Home behind a chip)

**Register `TeachingNotesHomeScreen` FIRST in the stack.** A param-requiring screen registered first
becomes the stack's initial route and crashes the tab at runtime; neither `tsc` nor `expo export`
catches it.

BN labels follow the owner's fixed vocabulary (শাখা / শিক্ষার্থী / প্রধান শিক্ষক / চাপুন …).
Proposed new terms — **শিক্ষক নোট** (the library) and **পরামর্শ** (an improvement comment) — need
owner sign-off before they are frozen into `labels.ts`.

## 8. Acceptance criteria

1. Principal uploads a Class 5 Bangla `ANSWER_GUIDE` markdown file; it appears in the library under
   বাংলা / ৫ at version 1, and its Bangla renders correctly (not mojibake).
2. A file saved as Latin-1 is REJECTED at upload with the Bangla encoding error; nothing persists.
3. A teacher holding a BAN scope in a Class 5 section sees it. A teacher with only a MATH scope in
   Class 5, and a BAN teacher with no Class 5 section, do NOT.
4. That teacher posts two separate comments; a second BAN teacher posts a third. All three show on
   the file with author and date.
5. The Principal sees all three, tagged to that file, from a cross-subject outstanding list.
6. Principal uploads a revised file for the same (class, subject, kind, seq). It becomes version 2
   and the library shows only v2 — **and all three comments are still on the file**, each labelled as
   written against v1.
7. Marking a comment ADDRESSED removes it from the outstanding list; the thread still shows it.
8. `GET /files/:id` for the note's StoredFile is refused for a teacher outside the scope and for any
   GUARDIAN token.
9. Upload, replace, comment and status change each write an audit row.
10. Green: `npm run typecheck --workspace=server`, `npm run test --workspace=server`.

## 9. Out of scope (v1)

Inline/positional annotation on PDF pages; full-text search across `contentMd`; guardian or student
visibility; cross-subject structure-guide comparison; in-app editing of a document (upload a new
version instead); comment attachments; @-mentions.
