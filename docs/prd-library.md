# PRD — Library Module (Catalog + Circulation + Reservations)

| | |
|---|---|
| **Status** | DRAFT v1.0 — build contract |
| **Owner** | Principal |
| **Date** | 2026-06-12 |
| **Decisions** | D-#81, D-#82, D-#83, D-#84 (this session); builds on D-#21, D-#27 (posture), D-#42/#64 (duty-gate pattern), D-#68, D-#72/#73, ADR-003, ADR-005, ADR-008 |
| **Plane** | Operational / identity (ADR-005) — no corpus path; J5.6 firewall must stay green |

## 0. At-a-glance (checklist for the builder)

- [ ] Library ONLY — the asset register stays on the deferred list (roadmap patched).
- [ ] Per-copy catalog: every physical copy gets a unique accession number.
- [ ] Borrowers = students, staff, AND guardians — all issue/return happens at the desk; only staff self-serve (browse + reserve) in-app.
- [ ] Loan policy is admin DATA (`LibraryPolicy` per borrower type), not constants.
- [ ] NO fines, ever — overdue = reminders + chase list; lost/damaged = replacement recorded; no money handled in-app.
- [ ] Reservations: title-level FIFO queue; renewal blocked while queued; hold + pickup window on return; lazy request-time expiry.
- [ ] Desk gated by `assertIsLibrarian` (Principal/Office always; a TEACHER via append-only `LibrarianAssignment`) — no new role.
- [ ] Overdue reminders ride the D-#72 `emit()` seam (LB-5 needs N-1); chase list + wa.me work without it.
- [ ] Guardian portal: read-only child-loans card (GP-2 rider; guardians get NO mutations, D-#68 preserved).
- [ ] App-native vocab only — no wire-contract / harness sync; vocab verifier extended and green every slice.

## 1. Goal

Give the school a working library system inside SCD Hub: a per-copy book catalog,
an issue/return/renew desk run by Office or an assigned librarian-teacher, a
reservation queue, and overdue chasing that reuses the school's existing
reminder + wa.me machinery. This pulls the **library half** of the deferred
"loanable-resource (library + asset register)" ops module forward; the **asset
register stays deferred** and will reuse this module's copy/loan shapes when it
lands.

Students and guardians do not have in-app borrowing actions (students have no
logins by design; guardian portal v1 is read-only, D-#68) — their borrowing is
**desk-mediated**: the librarian records the issue/return against the Student or
Guardian record. Staff additionally browse the catalog and place their own
reservations in-app.

## 2. Settled product choices (Principal, 2026-06-12)

1. Scope = library only; asset register later (separate PRD when pulled forward).
2. Borrowers: **students, staff, and guardians**.
3. Catalog tracks **each physical copy** with its own accession number.
4. Loan period (and limits) **admin-configurable per borrower type**.
5. **No fines** — overdue draws reminders only; a lost/damaged book is settled by
   **replacement**, recorded in-app; the app never computes or records money.
6. Desk duty: Principal/Office, **and assignable to a teacher** as a librarian
   duty — no new role.
7. **Reservation queue in v1**; renewal is allowed unless the title is reserved.
8. Overdue reminders are **automatic via the notifications seam** (N-phase) plus
   a chase-list report with manual wa.me send.
9. The **guardian portal shows the child's current loans + history** (read-only
   card).

## 3. Gap table

| Need | Exists today | Gap |
|---|---|---|
| Book catalog | Nothing | `BookTitle` + per-copy `BookCopy` (accession no.) models + manage UI |
| Loan policy per borrower type | Nothing | `LibraryPolicy` admin data (loanDays / maxConcurrent / maxRenewals / holdDays) |
| Issue / return / renew | Nothing | `BookLoan` model + `LibraryService` + desk screens |
| Borrower identities | `Student`, `StaffProfile`/`User`, `Guardian` all live (rosters loaded) | Loan references only — read-only joins, no roster change |
| Desk authority | `library:*` perms absent; duty-assignment pattern proven (D-#42/#64) | `library:read`/`library:manage` + `LibrarianAssignment` + `assertIsLibrarian` |
| Reservations | Nothing | `BookReservation` FIFO queue + hold-on-return + lazy expiry |
| Overdue reminders | `NotificationService.emit()` seam CONTRACTED (D-#72, prd-notifications — unbuilt) | Library due/overdue emitters (LB-5, after N-1) |
| Guardian/student chase | ADR-003 wa.me builder + roster phones | Overdue chase-list report with per-borrower wa.me links |
| Guardian visibility | Guardian portal contract (D-#68) — GP-1/GP-2 unbuilt | `childLibraryLoans` query + a loans card in GP-2 (rider) |
| Audit | Append-only `Audit` + AuditService (ADR-008) | New `BOOK_*` / `RESERVATION_*` / `LIBRARIAN_ASSIGNED` kinds |

## 4. Vocabulary & contract impact

**App-native only — NO wire-contract twin, NO two-/three-place sync** (same
ruling as trackers D-#33, HR, routine D-#46, messaging). The import-envelope
schema, mirrored enums, and the Python harness are untouched. The **vocab
verifier** is extended to check the new entries and must stay green.

Additions to `/shared/vocab.ts` (+ `*_LABELS_BN` for all UI-facing values):

- Permissions: `library:read` (PRINCIPAL/TEACHER/OFFICE — browse catalog, own
  loans/reservations), `library:manage` (PRINCIPAL/OFFICE — desk ops, catalog,
  policy, librarian assignment). A TEACHER passes desk-op gates only via
  `assertIsLibrarian` (active `LibrarianAssignment`) — the permission set on the
  TEACHER role is NOT widened (D-#17, D-#42 pattern).
- `BORROWER_TYPES = [STUDENT, STAFF, GUARDIAN]`
- `COPY_STATUSES = [AVAILABLE, ON_LOAN, ON_HOLD, LOST, DAMAGED, WITHDRAWN]`
- `LOAN_STATUSES = [ACTIVE, RETURNED, LOST]` (overdue is COMPUTED from dueDate —
  never stored as a status)
- `RESERVATION_STATUSES = [QUEUED, READY, FULFILLED, CANCELLED, EXPIRED]`
- `BOOK_LANGUAGES = [BANGLA, ARABIC, ENGLISH, OTHER]`

No new role. Bangla labels throughout the UI (লাইব্রেরি, ইস্যু, ফেরত, নবায়ন,
সংরক্ষণ…), English codes on accession numbers and reports (glossary rule).

## 5. Model (identity plane — ADR-005; no corpus path)

- `BookTitle` — titleBn (+ optional titleEn), author, `language`
  (BOOK_LANGUAGES), category (free text, e.g. ইসলাম শিক্ষা / গল্প / বিজ্ঞান),
  optional ISBN, shelf/location, active.
- `BookCopy` — titleId, **accessionNo (unique, school-assigned)**, `status`
  (COPY_STATUSES), condition note. WITHDRAWN = removed from circulation,
  never deleted (history keeps pointing at it).
- `LibraryPolicy` — one row per `borrowerType`: `loanDays`, `maxConcurrent`,
  `maxRenewals`, `holdDays` (reservation pickup window). **Admin-edited data,
  not constants** (the D-#55 pattern). Seed working values (Principal may change
  in-app): STUDENT 7/2/1/3 · STAFF 14/4/2/3 · GUARDIAN 7/2/1/3.
- `BookLoan` — copyId, `borrowerType` + **exactly one of**
  studentId / userId / guardianId, issuedAt, dueDate (issuedAt + loanDays,
  calendar days), renewCount, returnedAt?, `status` (LOAN_STATUSES),
  lostNote? (replacement record — text only, **no money fields**), issuedBy.
- `BookReservation` — titleId (title-level, not copy-level), borrower (same
  exactly-one-of shape), `status` (RESERVATION_STATUSES), createdAt (FIFO
  order), readyAt? + heldCopyId? (set when a returned copy is put ON_HOLD),
  expiresAt? (readyAt + holdDays).
- `LibrarianAssignment` — **append-only** (ADR-008 pattern, mirrors
  `ClassTeacherAssignment`/`SectionAttendanceAssignment`): userId (TEACHER),
  action assign|revoke, actor, timestamp. `assertIsLibrarian` = PRINCIPAL/OFFICE
  (`library:manage`) OR a teacher whose latest row is `assign`.
- Audit kinds: `BOOK_ISSUED`, `BOOK_RETURNED`, `BOOK_RENEWED`,
  `BOOK_MARKED_LOST`, `RESERVATION_PLACED`, `RESERVATION_EXPIRED`,
  `LIBRARIAN_ASSIGNED`, `LIBRARY_CATALOG_CHANGED`.

**Expiry posture (D-#83):** a READY hold past `expiresAt` is expired **lazily at
request time** (any read/issue touching the title flips it EXPIRED and promotes
the next QUEUED reservation) — the D-#21 request-time posture; no scheduler
dependency. If/when the D-#73 ticker exists, a sweep MAY be added behind the
same service function — never a second expiry truth.

## 6. Slices (build order)

### LB-1 — Catalog + policy + librarian gate (server)
- Vocab additions (§4) + verifier extension; models `BookTitle`, `BookCopy`,
  `LibraryPolicy` (seeded working values), `LibrarianAssignment`.
- `assertIsLibrarian` helper; `LibraryCatalogService`.
- Resolvers: `bookTitles(filter: text/language/category)`, `bookTitle(id)`
  (with copies + computed availability), `libraryPolicies`, `librarianHistory`
  — `library:read`; `createBookTitle`/`updateBookTitle`/`addBookCopy`/
  `setCopyStatus` (incl. WITHDRAWN)/`upsertLibraryPolicy`/`assignLibrarian`/
  `revokeLibrarian` — `library:manage`.
- Acceptance: duplicate accessionNo rejected; WITHDRAWN copy excluded from
  availability but readable in history; teacher with assignment passes the gate,
  without it denied (Bangla error); vocab verifier + tsc + jest + firewall green.

### LB-2 — Circulation: issue / return / renew / lost (server)
- `LibraryCirculationService`: `issueBook(copyId, borrower)` — copy must be
  AVAILABLE (or ON_HOLD **for this borrower**); enforces `maxConcurrent` for the
  borrower's type; sets dueDate from policy. `returnBook(loanId)` — loan
  RETURNED, copy AVAILABLE unless a QUEUED reservation exists (→ §LB-3 hold).
  `renewLoan(loanId)` — blocked when `renewCount ≥ maxRenewals` OR a QUEUED/
  READY reservation exists on the title; otherwise dueDate += loanDays.
  `markLost(loanId, note)` — loan LOST + copy LOST + replacement note; a later
  replacement copy enters as a NEW accession (catalog op), the lost copy stays
  LOST.
- All desk mutations gated `assertIsLibrarian`; queries `loans(filter)`,
  `borrowerLoans(borrower)`, `myLoans` (staff own-row) — `library:read`.
- Acceptance: over-limit issue denied per borrower type with Bangla message;
  due date honors the borrower-type policy; renew/limit/reservation-block rules
  exact; no money field exists anywhere; jest + firewall green.

### LB-3 — Reservations (server)
- `reserveTitle(titleId, borrower)` — staff self-serve for themselves
  (`library:read` own-row) OR desk on anyone's behalf (`assertIsLibrarian`);
  duplicate active reservation per (title, borrower) rejected; no reservation
  while the borrower already holds a copy of that title.
- On `returnBook` with a queue: copy → ON_HOLD, head reservation → READY
  (readyAt, expiresAt = readyAt + reserver-type holdDays). `issueBook` to the
  READY borrower fulfills it; lazy expiry promotes the next (§5 posture).
- `cancelReservation`; queries `reservationsForTitle` (FIFO), `myReservations`.
- Acceptance: FIFO honored; renewal blocked exactly while a queue exists; expiry
  promotes the next borrower on the next touch; jest + firewall green.

### LB-4 — App screens (Expo)
- New **Library tab** (📚, gated `library:read`): `LibraryHome` (role-aware:
  search/browse + My loans/reservations; desk + manage entries only when
  `assertIsLibrarian` / `library:manage`), `TitleDetail` (copies, availability,
  reserve-for-myself for staff), `LibraryDesk` (borrower picker —
  student/staff/guardian search — issue by accessionNo, return, renew, mark
  lost, fulfill READY hold), `CatalogManage` (titles/copies/withdraw),
  `LibraryAdmin` (policy editor + librarian assign/revoke + history).
- Bangla labels from `shared/vocab`; accession numbers and codes in Latin
  digits (D-#61).
- Acceptance: app tsc clean + web bundle green; every LB-1..LB-3 capability
  reachable in UI; non-librarian teacher sees browse + own rows only.

### LB-5 — Overdue chasing + reminders + guardian-portal rider
- **Chase-list report** (`library:read`, surfaced on LibraryHome for
  librarians): overdue loans grouped by borrower type — student rows resolve
  the family phone (`Student.phone`) and guardian rows the guardian phone, each
  with an ADR-003 **wa.me click-to-send** Bangla reminder; staff rows link to
  chat/contact. Works with ZERO notification infrastructure.
- **Emitters via the D-#72 seam** (requires N-1 to have landed; if not, this
  half waits — the report above stands alone): kinds `LIBRARY_DUE_SOON` (due
  tomorrow) and `LIBRARY_OVERDUE` (day after due, then every 3rd school day)
  added to `NOTIFICATION_KINDS`; recipients = staff borrowers (inbox+push) and
  login-enabled guardian borrowers / guardians of student borrowers (inbox);
  contact-only guardians (D-#31) remain wa.me-only — same recorded limitation
  as D-#72. Day checks ride the D-#73 ticker's school-day awareness.
- **Guardian portal rider** (requires GP-2): read-only **child loans card** —
  `childLibraryLoans(studentId)` gated `assertGuardianOfStudent` (D-#68);
  current loans + due dates + history; **no guardian mutations** (reserve/renew
  stay desk-only for guardians).
- Acceptance: chase list correct per type with working wa.me links; emit
  idempotent by dedupeKey (no double reminder per loan per rung); guardian
  query link-scoped (another guardian denied); firewall green.

## 7. Journeys (Given / When / Then)

- **J-L1 (catalog):** Given the librarian adds "সীরাত গ্রন্থ" with 3 copies, Then
  3 unique accession numbers exist and the title shows availability 3; adding a
  copy with a duplicate accession number is rejected.
- **J-L2 (limit per type):** Given STUDENT policy maxConcurrent=2 and student S
  has 2 ACTIVE loans, When the desk issues a third, Then it is denied with a
  Bangla message; a STAFF borrower under the staff limit succeeds.
- **J-L3 (librarian gate):** Given teacher T has no `LibrarianAssignment`, When
  T attempts `issueBook`, Then denied; after the Principal assigns T, the same
  call succeeds and `LIBRARIAN_ASSIGNED` is in the audit.
- **J-L4 (return):** Given an ACTIVE loan with no queue, When returned, Then the
  loan is RETURNED with timestamp and the copy is AVAILABLE.
- **J-L5 (renew):** Given renewCount < maxRenewals and no reservation, When
  renewed, Then dueDate extends by loanDays; Given a QUEUED reservation on the
  title, Then renewal is denied.
- **J-L6 (reservation FIFO + hold):** Given guardians G1 then G2 reserve a fully
  loaned title, When a copy returns, Then it is ON_HOLD and G1 is READY with a
  holdDays window; When the window lapses and the title is next touched, Then
  G1 is EXPIRED and G2 is READY.
- **J-L7 (lost — no money):** Given a loan is marked lost with a note, Then the
  loan is LOST, the copy is LOST, the note is stored, and no monetary field
  exists; a replacement enters as a new accession.
- **J-L8 (overdue chase):** Given an overdue student loan, Then the chase list
  shows it under STUDENT with a wa.me link to the family phone; with N-1 live,
  the class-teacher-independent reminder lands in the staff borrower's inbox
  exactly once per rung (dedupeKey).
- **J-L9 (guardian portal):** Given guardian G linked to child C with an ACTIVE
  loan, When G opens the portal loans card, Then C's loans + due dates are
  visible read-only; a guardian NOT linked to C is denied; no
  reserve/renew control is rendered.

## 8. Out of scope (this PRD)

- **Asset register** — stays on the deferred ops list; will reuse the
  copy/loan shapes here.
- **Fines or any money handling** — deliberately excluded (Principal ruling;
  consistent with the D-#27 no-penalty-money posture). Recorded so it is never
  added silently later.
- Barcode/QR/RFID hardware — accession numbers are typed/searched in v1.
- E-books / digital lending; inter-library loan.
- Guardian or student self-service mutations (reserve/renew from the portal) —
  guardian portal stays read-only per D-#68; revisit at GP-3+.
- Reading analytics / corpus events — the library NEVER emits to the corpus
  plane (a child's reading record is identity data, ADR-005).
- WhatsApp/SMS automation — manual wa.me only (ADR-003), same as everywhere.

## 9. Reused / unchanged

- Import envelope, mirrored enums, Python harness — untouched (no sync).
- `Student` / `Guardian` / `User` / `StaffProfile` — read-only loan references;
  no roster change.
- ADR-003 wa.me builder — reused for the chase list.
- ADR-008 audit model — reused (new kinds, §5).
- D-#72 `emit()` seam + D-#73 ticker — consumed by LB-5, not modified; library
  defines kinds + dedupe keys only.
- D-#68 guardian-portal contract — extended by one read query; no-mutations
  rule preserved.
- ADR-005 plane split — all library data is identity-plane; J5.6 fail-closed
  firewall test must stay green every slice.

## 10. Open items

1. **Initial catalog ingest** — if a book register spreadsheet exists, an
   `extract-books.py` → `import-books.ts` pipeline (the roster/staff pattern)
   lands at LB-1 build; Principal to confirm whether a register file exists and
   share it (gitignored, like the rosters).
2. **Seed policy figures** (7/2/1 student · 14/4/2 staff · 7/2/1 guardian ·
   3-day hold) are working values — Principal confirms or edits in-app after
   LB-4.

## 11. Traceability

D-#81 (module scope + borrowers + librarian gate) · D-#82 (per-copy catalog +
policy-as-data + no-fines/replacement) · D-#83 (reservation queue + hold +
lazy expiry) · D-#84 (reminders via the seam + chase list + guardian-portal
rider) · builds on D-#17 (small role set), D-#21 (request-time posture),
D-#27 (no-penalty-money posture), D-#31/#59 (guardian contact/login reality),
D-#42/#64 (duty-gate pattern), D-#68/#69 (portal read-only), D-#72/#73
(notification seam + ticker), ADR-003, ADR-005, ADR-008. Vocab: app-native
`library:*`, `BORROWER_TYPES`, `COPY_STATUSES`, `LOAN_STATUSES`,
`RESERVATION_STATUSES`, `BOOK_LANGUAGES` (+BN labels) — verifier extended,
no wire twin.

> **Numbering note (renumbered at commit):** the planning handoff proposed
> D-#80–#83, but D-#80 was already taken in the live repo (roll number = ID,
> attendance O1) — renumbered to D-#81–#84 per AGENTS.md pre-flight rules.
