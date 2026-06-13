# PRD — Vocabulary Tracker (VC-… channel)

**Status:** Planned · build contract (slices VC-1..VC-5)
**Owner:** Principal (sponsor); build agent (executor)
**Plane:** Identity / operational (ADR-005 — no corpus path)
**Contract impact:** App-native `/shared/vocab.ts` additions only — **no import-envelope / harness three-place sync** (a vocab test is a feature, not `doc_type` content)
**Source decisions:** D-#104, D-#105, D-#106, D-#107 _(planned as D-#100–#103; renumbered at commit — those numbers were taken on main by Messaging M-2/M-3 + HR-2)_
**Supersedes:** the two-phase Google-Sheet system (Phase-1 per-test workbooks + Phase-2 IMPORTRANGE central tracker)

## At a glance
The last Google-Sheet ops process moves into the app. One Mongo source of truth replaces two
linked workbooks and per-class×gender×week file proliferation. Three independent programs —
**English, Bangla, Arabic** — share one data-driven engine. A weekly-assigned teacher per
(section × program) builds a test, marks wrong items by tap, and every score / weak-word list /
guardian message is **derived, never typed**. No auto-grading. **No Old/New word split.**

---

## 1. Goal
Replace the manual two-phase vocabulary tracker with an in-app module that (a) holds a reusable
per-class word bank per program, (b) lets a weekly-assigned teacher build and mark a test in a few
taps, (c) derives all reports (per-test, per-student, class, cumulative, persistent weak words),
and (d) generates the school's existing Bangla guardian messages — for English, Bangla and Arabic
vocabulary, on one engine that takes a new language by adding a program value, not a rebuild.

## 2. Gap table

| Capability today (sheet) | How it works now | App replacement | Slice |
|---|---|---|---|
| Per-test workbook + central tracker | Two files joined by IMPORTRANGE; deleting a file loses its data; one file per class × gender × week | One module; tests + results in Mongo; "central tracker" is a query | VC-2/VC-3/VC-4 |
| Words_Old / Words_New re-paste each week (~30 min) | Manual paste of two word lists per test | Persistent per-class-level **word bank** per program; entered once | VC-1 |
| Old/New + Source / Source SL | Tracked per word/position | **Removed** (D-#104, Principal ruling) — a test covers a flat word set | VC-1/VC-2 |
| Script_Map (Section/Q# → Word) | Manual row per question | **VocabTestPosition** auto-laid from selected words + program directions | VC-2 |
| Mistakes_Input (Student × Section × Q#) | Hand-typed rows from the marking table | Tap wrong cells on a student × position grid; dictation = 2 markable fields | VC-3 |
| Score / wrong-count / reports | Formula tabs per file | Read-side aggregates (D-#44); never typed (D-#85) | VC-3/VC-4 |
| Persistent weak words / cumulative period | Setup thresholds + QUERY tabs | Admin-param thresholds + dashboards | VC-4 |
| Guardian messages (Bangla, WhatsApp) | Copy from a tab, paste to WhatsApp | Generated server-side + wa.me (ADR-003) + emit() seam (D-#72) | VC-4/VC-5 |

## 3. Data model

### 3.1 Programs & directions (data-driven — D-#105)
- `VOCAB_PROGRAMS = [ENGLISH, BANGLA, ARABIC]` (+ `*_LABELS_BN`). A new language later = a new value.
- `VOCAB_DIRECTIONS = [DICTATION, HEADWORD_TO_BANGLA, BANGLA_TO_HEADWORD]` (+ `*_LABELS_BN`).
- Each program declares (in code, as data) which directions it uses and its dictation field count:
  - **ENGLISH:** DICTATION (2 fields: English spelling + Bangla meaning) · HEADWORD_TO_BANGLA · BANGLA_TO_HEADWORD
  - **BANGLA:** DICTATION (1 field: Bangla spelling) · HEADWORD_TO_BANGLA
  - **ARABIC:** DICTATION (2 fields: Arabic spelling + Bangla meaning) · HEADWORD_TO_BANGLA · BANGLA_TO_HEADWORD
- "Headword" = the program-language form (English/Bangla/Arabic word). Bangla→headword / headword→Bangla
  are **meaning** directions (not transliteration).

### 3.2 Word bank — `VocabWord` (VC-1)
`{ schoolId, program, classLevel ∈ ROSTER_CLASS_LEVELS, headword (program-language string),
banglaMeaning (string), active, addedOn, addedBy }`. **Nothing else stored** — no transliteration,
example sentence, or part-of-speech (D-#105). Scoped per (program × classLevel). No Old/New flag.

### 3.3 Test — `VocabTest` (VC-2)
`{ schoolId, program, sectionId (general Section; SubjectGroup polymorphism reserved for a future
Arabic-group program, D-#48), classLevel, testDate, label (e.g. "Set 1"), totalMarks (teacher-set),
dictationHalfMissCounts (bool — **configurable per test**, D-#105), createdBy, status }`.
Three programs ⇒ up to three tests for one section on one day (shared or separate periods); the test
is **period-agnostic, keyed by date**. Default `testDate` = Thursday; holiday → roll via D-#50 calendar.

### 3.4 Position — `VocabTestPosition` (VC-2)
`{ testId, direction, qNumber, wordId }` (the Script_Map analog). For a DICTATION position the
markable field count comes from the program (1 or 2). Positions are auto-laid when the teacher selects
words per direction.

### 3.5 Assignment — `VocabTestAssignment` (append-only, VC-2)
`{ schoolId, sectionId, program, weekOf, assignedTeacherId, assignedBy, source ∈ [direct, proxy],
proxyGrantId?, createdAt }`. The D-#64 marker-assignment pattern. Resolver composes the current
direct assignment with any active D-#20 proxy grant (time-bounded, request-time expiry, D-#21/#22).

### 3.6 Result — `VocabStudentResult` (VC-3)
Per student × position. `{ testId, studentId, positionId, status ∈ [PRESENT, ABSENT],
wrongFields[] }`. A whole-test absence is one ABSENT flag per student per test (sheet parity).
For a 2-field dictation position, each field is independently markable; `wrongFields` records which.
Everything else (score, wrong-count, wrong-words-by-direction) is derived (D-#85).

## 4. Scoring & marking rules
- **No auto-grading.** The assigned (or covering) teacher marks which items/fields are wrong.
- Marks lost per position: single-field positions = 1 if wrong. Dictation positions = governed by
  `dictationHalfMissCounts`: **off** ⇒ position wrong if *any* field wrong (max 1 lost); **on** ⇒
  1 lost *per* wrong field.
- `totalMarks` is the teacher-set value on the test (replaces the fixed 30/60 setup cell).
- ABSENT students are excluded from score denominators and feed the Absent guardian template.

## 5. Assignment & proxy (D-#106)
- One assigned teacher per (section × program), assigned weekly via `roster:manage`
  (Principal/Office — the D-#94 admin-gate precedent). **No new role, no new permission.**
- Cover/absence reuses the existing proxy grant (D-#20/#21/#22): a covering teacher gets a
  time-bounded, request-time-expiring grant; the **assigned or covering** teacher may build/mark.
- Test-build + marking gated by `tracker:write` + server-side section verification (`assertCanWrite`).

## 6. Slices (build order — **Next = build VC-1 per §6, slice order**)
- **VC-1 (server):** `vocab.ts` additions (`VOCAB_PROGRAMS`, `VOCAB_DIRECTIONS`, `*_LABELS_BN`,
  program→directions/dictation-field map as data) + verifier section; `VocabWord` model + word-bank
  CRUD (add/edit/deactivate per program×classLevel); firewall test extended (corpus ↛ vocab).
- **VC-2 (server):** `VocabTest` + `VocabTestPosition`; build-a-test (select words → auto-laid
  positions; teacher sets totalMarks + dictation half-miss rule); `VocabTestAssignment` append-only
  log + weekly assignment (`roster:manage`) + proxy resolution (D-#20); Thursday default + D-#50 roll.
- **VC-3 (server):** `VocabStudentResult`; mistake capture (student × position grid; 2-field
  dictation = two sub-marks; per-test ABSENT); derived score/total/wrong-count/wrong-words.
- **VC-4 (server):** `VocabSummaryService` read aggregates (D-#44) — per-test report, per-student
  dashboard + persistent weak words, class dashboard + most-missed, cumulative period (Weekly/
  Monthly/Last-N); thresholds as admin params. Guardian-message generation (templates resolved
  server-side) + wa.me (ADR-003) + login-guardian Notification via emit() seam (D-#72);
  `childVocab` guardian read rider (`assertGuardianOfStudent`, D-#68).
- **VC-5 (app):** WordBankManage · BuildVocabTest · VocabAssignment (admin) · VocabMarkGrid ·
  VocabReports (per-test/student/class) · GuardianVocab card on GuardianHome. UI per D-#61.

## 7. Journeys (Given/When/Then)
- **J1 — Manage word bank.** Given a teacher with `tracker:write` on a class, when they add words to a
  program×classLevel bank, then each word stores headword + Bangla meaning and is reusable across tests.
- **J2 — Assign the weekly tester.** Given Principal/Office (`roster:manage`), when they assign a teacher
  to (section × program) for the week, then that teacher is the test's operator; on the tester's absence
  a proxy grant lets a covering teacher build/mark within the grant window (D-#20).
- **J3 — Build a test.** Given the assigned teacher, when they pick words per direction and set totalMarks
  + the dictation half-miss rule, then positions are laid out automatically and the test is ready to mark.
- **J4 — Mark mistakes.** Given the test ran, when the assigned/covering teacher taps wrong items on the
  student × position grid (dictation shows two markable fields), then score, wrong-count and wrong-words
  are derived; whole-test absentees are flagged once.
- **J5 — Read reports.** Given marked tests, when a teacher/coordinator opens reports, then they see the
  per-test report, a per-student dashboard with persistent weak words, and a class most-missed view.
- **J6 — Message guardians.** Given a marked test, when Office/teacher generates messages, then the Bangla
  Regular/Perfect/Absent (or Cumulative) message is produced per student with a wa.me link; login-enabled
  guardians also receive an in-app notification.
- **J7 — Guardian view.** Given a login-enabled guardian, when they open the child's vocab card, then they
  see read-only results per program (no mutations, D-#68).

## 8. Guardian messaging
- Port the legacy Setup-tab templates **verbatim** as editable admin data: **Regular, Perfect, Absent,
  Cumulative** (Bangla; Islamic salutation + du'a preserved). Placeholder set:
  `{StudentName} {TestDate} {Score} {TotalMarks} {WrongCount}` + per-direction wrong-word lists +
  `{PeriodLabel} {NumTests} {PersistentWords} {School}` (the legacy `SecB/SecC/SecD` lists generalize to
  per-direction lists).
- Delivery: wa.me click-to-send for **all** guardians (ADR-003); login-enabled guardians additionally get
  a `Notification` via emit() (D-#72) → in-app/push. Contact-only guardians stay wa.me-only (D-#31/#72).
- `NOTIFICATION_KINDS += VOCAB_RESULT` (+BN/EN) extends verifier §C.5. If `vocab.ts` is frozen by an
  in-flight branch at VC-4 build time, ship the kind-gated no-op + wa.me path and activate the kind when
  vocab unfreezes (the D-#94 `ASSIGNMENT_CHASE` precedent).

## 9. Reports & thresholds
- Read-side aggregates only (D-#44); time inputs passed in (no clock inside) for deterministic math.
- Thresholds = admin params (ported from the sheet): per-student persistent = missed in ≥ N tests
  (default 2); class-level persistent = missed by ≥ X% of class (default 30%); cumulative period mode =
  Weekly / Monthly / Last-N (default Weekly, N=4).

## 10. Out of scope
Auto-grading; Old/New word split; transliteration / example / POS fields; Quran vocabulary (a separate
Quran Tracker, D-#36 pattern); any fines or money; importing the legacy `.xlsx` files (manual entry; a
one-off `import-vocab` ingest is a **possible later add** if the Principal confirms a clean source —
flagged, not built); native push beyond the existing emit() seam; multi-program combined papers.

## 11. Reused / unchanged
Trackers operational plane + ADR-005 firewall; D-#50 calendar (Thursday default + holiday roll);
ScopeGrant proxy (D-#20/#21/#22); append-only audit (ADR-008); wa.me (ADR-003); emit() seam (D-#72);
guardian read gate (`assertGuardianOfStudent`, D-#68); SubjectGroup polymorphism (D-#48, reserved for a
future Arabic-group program); UI guidelines (D-#61). RBAC composes existing permissions only (D-#94
precedent) — no new role/permission (D-#17).

## 12. Contract-sync note
This module is **app-native vocab only** — `/shared/vocab.ts` enum/label additions + verifier section,
**no import-envelope schema or harness change** (no two-/three-place wire sync). Per AGENTS.md rule 5,
if an in-flight branch is also editing `/shared/vocab.ts` when VC-1/VC-4 build, **serialize** (land one
PR, rebase the other); the vocab verifier must print green in the build session before commit.

## 13. Traceability
**New:** D-#104 (adopt module, no Old/New) · D-#105 (data-driven trilingual model + word bank) ·
D-#106 (weekly per-section×program assignment + proxy) · D-#107 (reports/messaging/guardian-read).
**Referenced:** D-#17, D-#20/#21/#22, D-#31, D-#36, D-#44, D-#48, D-#50, D-#64, D-#68, D-#72, D-#85,
D-#94 · ADR-003, ADR-005, ADR-008.
**Vocab refs (app-native):** `VOCAB_PROGRAMS`, `VOCAB_DIRECTIONS`, `*_LABELS_BN`, `NOTIFICATION_KINDS`
(+= `VOCAB_RESULT`).

## 14. Acceptance checklist (per slice — executed-verification gate)
- [ ] **VC-1:** vocab additions + verifier section green; `VocabWord` CRUD; firewall green (corpus ↛ vocab).
- [ ] **VC-2:** test + positions build from selected words; weekly assignment (`roster:manage`); proxy
      resolves; Thursday default + holiday roll.
- [ ] **VC-3:** grid marking; 2-field dictation sub-marks; configurable half-miss; ABSENT; counts derived.
- [ ] **VC-4:** per-test/student/class/cumulative reports; persistent-weak-word thresholds; guardian
      messages (wa.me + emit() seam); `childVocab` read.
- [ ] **VC-5:** all screens render; guardian card read-only; UI per D-#61.
- [ ] Gate per slice: shared build + tsc, vocab verifier PASS, jest green, app tsc + expo web export green.
- [ ] No corpus/identity firewall regression (J5.6 stays green).
