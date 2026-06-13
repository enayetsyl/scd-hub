# PRD — Class Test Tracker (CT-… channel)

**Status:** Planned · build contract (slices CT-1..CT-5)
**Owner:** Principal (sponsor); build agent (executor)
**Plane:** Identity / operational (ADR-005 — no corpus path)
**Contract impact:** App-native `/shared/vocab.ts` additions only — **no import-envelope / harness three-place sync** (a class test is a feature, not `doc_type` content)
**Source decisions:** D-#119, D-#120, D-#121, D-#122 _(renumbered at commit from the handoff's proposed D-#111–#114 — #111–#113 were already taken on main by M-6 / HR-4; CT slotted into the free #119–#122 gap, clear of the in-flight VC-1 [#126+] and HR-app [#135+] reservations — pre-flight wins)_
**Supersedes:** the Google-Sheet Class Test system (Exam Log + per-class Google Forms + IMPORTRANGE analysis/dashboard)

## At a glance
The exam lifecycle moves fully in-app. A teacher assembles a class-test paper from the question pool (or, in the rare case, uploads their own), files it as a **print request**; the Office prints the PDF and taps **Mark printed**, which creates the official exam record and starts the deadline clock — **anchored on the exam date, not the print date**. The teacher enters per-student results (marks or Absent + weakness + actions); percentage and pass/fail are derived — **no auto-grading**. On **publish** (per-student or per-exam, with edit + unpublish) the result reaches the guardian portal card, an in-app/push notification, and a wa.me message. The Principal dashboard shows live which reports are overdue and by which teacher; the **Office** (not the class teacher) chases them.

---

## 1. Goal
Replace the manual two-surface class-test process (admin-typed Exam Log + ten Google Forms joined by IMPORTRANGE) with one in-app module that (a) turns a question-pool selection into a print request and an official exam record on a single Office action, (b) lets the teacher mark per-student results in one form with score/percentage/pass-fail derived, (c) publishes results to guardians on the existing delivery rails, and (d) derives every report (status, Principal dashboard, class×subject progression, student profile) — for every content subject, on the existing trackers plane, with no new role or permission.

## 2. Gap table

| Capability today (sheet) | How it works now | App replacement | Slice |
|---|---|---|---|
| Exam Log (admin types metadata from the received paper) | Manual Excel row after receiving the paper outside the system | Teacher's print request carries class/subject/test#/date/total/pass mark; Office **Mark printed** creates the record | CT-1 |
| Per-class Google Forms (×10) + IMPORTRANGE merge | Ten separate forms; marks stored as dirty text ("Absent", Bangla numerals, sentences); duplicate rows | One in-app results form; marks numeric or Absent, one record per student per exam | CT-2 |
| Composite text key `id\|class\|subj\|exam#` | Fragile join across files | Atomic sequence `CT-C{class}-{SUBJ}-{nnnn}` | CT-1 |
| Reports Status deadline (one cell, raw calendar days) | `=ExamDate + 2` calendar days | **School-day-aware** deadline via D-#50 calendar; default 2, admin-configurable; **anchored on exam date** | CT-2/CT-4 |
| Guardian Action (free text, no channel) | Typed in a form column; no delivery | Publish → guardian portal card + wa.me + emit() notification | CT-3 |
| Pass Mark = 40% (Setup cell) | Fixed-ish formula | **Configurable per test** (default = 40% of total) | CT-2 |
| Principal Dashboard / Class-Subject Analysis / Student Profile | Formula + QUERY tabs | Read-side aggregates (D-#44), computed live | CT-4 |

## 3. Data model

### 3.1 Vocab additions (app-native — D-#119/#120/#122)
- `CLASS_TEST_STATUSES = [REQUESTED, PRINTED, CANCELLED]` (+ `*_LABELS_BN`). The exam moves `REQUESTED → PRINTED` (Office); `CANCELLED` for a withdrawn request. "Complete / overdue" is **derived**, never a stored status.
- `CLASS_TEST_SOURCES = [POOL_SET, UPLOADED_PAPER]` (+ `*_LABELS_BN`).
- `NOTIFICATION_KINDS += CLASS_TEST_RESULT` (+ BN/EN) — extends verifier §C.5.
- `StoredFile` kind enum += `classtest_question` (the M-4 pattern of adding a kind to the existing file-model enum; app-native, not the wire contract).
- Subjects reuse **`HW_SUBJECTS`** (Quran excluded — D-#36 pattern; the sheet's "Deen" = the `ISLAM` label).

### 3.2 `ClassTest` — the exam header / print request (CT-1)
`{ schoolId, ctId (sequence), classLevel ∈ ROSTER_CLASS_LEVELS, sectionId, subject ∈ HW_SUBJECTS, testNumber (int — auto-suggested = max for this class+subject + 1, editable), examDate, totalMarks (teacher-set), passMark (teacher-set, configurable — default round(0.40 × totalMarks)), source ∈ CLASS_TEST_SOURCES, setId? (CT-kind assembled set, when POOL_SET) | questionFileId? (StoredFile, when UPLOADED_PAPER), status ∈ CLASS_TEST_STATUSES, deadlineDays (admin-configurable, default 2), requestedBy, requestedAt, printedBy?, printedAt?, notes? }`. The record is **born as the print request** (`REQUESTED`) and becomes the official exam on Office mark-printed (`PRINTED`).

### 3.3 `ClassTestResult` — per student (CT-2)
`{ testId, studentId, status ∈ [PRESENT, ABSENT], marks? (number, only when PRESENT, ≤ totalMarks), weakness?, teacherAction? (internal), guardianAction? (parent-facing), publishedAt?, publishedVersion (int, default 0), enteredBy, updatedAt }`. **Derived (never stored, D-#85):** percent = marks/totalMarks, pass = marks ≥ passMark. **One record per student per exam — editable, no retake/resubmission lifecycle (D-#121).**

### 3.4 `ClassTestSequence` (CT-1)
Atomic, year-continuous `CT-C{class}-{SUBJ}-{nnnn}` (the HW_ID / AS-sequence pattern, D-#34) — replaces the fragile composite text key.

## 4. Scoring & marking rules
- **No auto-grading.** The teacher enters marks per student, or marks the student `ABSENT`.
- `percent = marks ÷ totalMarks`; `pass = marks ≥ passMark`. **`passMark` is configurable per test** (default 40% of total).
- `ABSENT` students carry no marks, are **excluded from class denominators**, and feed the Absent guardian template.
- One result per student per exam; freely editable; **no retake / no resubmission** (D-#121) — distinct from the homework lifecycle.

## 5. Lifecycle, files & RBAC

### 5.1 Lifecycle
1. **Request (teacher, `tracker:write`):** assemble a CT-kind set from the question pool → `setId`; **or** upload own paper → `questionFileId`. Supplies all §3.2 metadata at request time.
2. **Mark printed (Office, `roster:manage`):** opens the paper — exports the set PDF via the existing `/pdf/set`, or downloads the uploaded file via `GET /files/:id` — prints, taps **Mark printed** → `status: PRINTED`, stamps `printedAt`/`printedBy`. **The record is now the official exam.**
3. **Deadline:** `deadline = examDate + deadlineDays` **school-days** (D-#50 calendar; skips Fri/Sat/holidays). The clock is **idle until the exam date passes** — printing early does not start it (D-#120).
4. **Results (teacher, `tracker:write` + `assertCanWrite` section verify):** per-student entry; edit any time.
5. **Publish (teacher):** per-student or whole-exam; edit + unpublish; **republish increments `publishedVersion`**.
6. **Overdue chase (Office, `message:dispatch` + explicit Principal/Office check — mirrors AS-T4):** teachers never chase.

### 5.2 Uploaded-paper file store
Reuse `StoredFile` + `DriveStore` (D-#70/#71; the M-4 `subfolder` generalization → `SCD-Hub-Files/<year>/classtest/`). New `POST /files/classtest` (multipart, gated `tracker:write` + caller is the requesting teacher; MIME whitelist jpeg/png/pdf; size cap per GP-A; Bangla 422; **Drive-first ⇒ 503 + nothing persisted**, GP-J8 posture). `GET /files/:id` dispatches by the file's own kind → class-test gate = Office (`roster:manage`) **or** the requesting teacher. The Drive id never reaches a client. No twin store/route beyond the kind + subfolder.

### 5.3 RBAC — composes existing permissions only (D-#94 precedent; **no new role/permission**, D-#17)
- Teacher request + results + publish/unpublish = `tracker:write` (+ server-side section verification).
- Office print / mark-printed / cancel = `roster:manage` (Principal/Office admin lever).
- Office overdue chase = `message:dispatch` + explicit Principal/Office check.
- Guardian read = `guardian:read_child` (`assertGuardianOfStudent`).

## 6. Slices (build order — **Next = build CT-1 per §6, slice order**)
- **CT-1 (server):** vocab additions (`CLASS_TEST_STATUSES`, `CLASS_TEST_SOURCES`, `NOTIFICATION_KINDS += CLASS_TEST_RESULT`, `StoredFile.classtest_question`, `*_LABELS_BN`) + verifier section; `ClassTest` request→printed lifecycle + `ClassTestSequence`; create-request (teacher, CT-set link **or** uploaded paper via `POST /files/classtest`) + Office **mark-printed** (creates the exam record; exam-date deadline anchor); firewall test extended (corpus ↛ class-test).
- **CT-2 (server):** `ClassTestResult` per-student entry (marks/Absent + weakness + teacher-action + guardian-action); derived percent/pass-fail; configurable `passMark`; **school-day-aware** deadline + overdue derivation (D-#50). `tracker:write` + `assertCanWrite`.
- **CT-3 (server):** publish/unpublish (per-student **and** per-exam bulk); guardian delivery — wa.me for all (ADR-003) + `Notification` via emit() (D-#72) for login-enabled, **dedupeKey includes `publishedVersion`** so republish re-notifies (idempotent emit won't swallow it); inline Bangla templates (§8); `childTestResults` guardian read rider (`assertGuardianOfStudent`, D-#68).
- **CT-4 (server):** `ClassTestSummaryService` read aggregates (D-#44) — Reports Status (submitted/pending/overdue + school-days late), Principal Dashboard (KPIs: logged / complete / in-progress / not-started / overdue + completion rate; overdue-by-teacher), Class×Subject Analysis (per-student progression + trend ↑/↓), Student Profile (one student across subjects); Office overdue-chase list (`message:dispatch` + Principal/Office, wa.me links).
- **CT-5 (app):** RequestClassTest (assemble CT set / upload paper + metadata) · ClassTestPrintQueue (Office: open/export PDF + mark printed) · ClassTestResults (teacher entry grid) · ClassTestPublish (per-student / per-exam, edit + unpublish) · ClassTestDashboard (Principal) · ClassTestReports (status / class×subject / student profile) · GuardianTestResults card on GuardianHome (lights up the current placeholder). UI per D-#61.

## 7. Journeys (Given/When/Then)
- **J1 — File a print request.** Given a subject teacher (`tracker:write`), when they assemble a CT set (or upload a paper) and enter class/subject/test#/date/total/pass-mark, then a `ClassTest` is created `REQUESTED` and queued for the Office.
- **J2 — Print & log.** Given the Office (`roster:manage`), when they open the paper from the queue, print it, and tap Mark printed, then the record flips `PRINTED` with `printedAt`, and the exam-date deadline is set (idle until the exam date).
- **J3 — Enter results.** Given a printed exam on/after its date, when the teacher records each student's marks (or Absent) + weakness + actions, then percent and pass/fail are derived and one record exists per student.
- **J4 — Publish.** Given entered results, when the teacher publishes a student or the whole exam, then guardians receive the portal card + (login-enabled) a notification + a wa.me message; editing or unpublishing then republishing re-notifies.
- **J5 — Track overdue.** Given printed exams past deadline without complete results, when the Principal opens the dashboard, then overdue reports are listed by teacher with school-days late; the Office chases (teachers do not).
- **J6 — Read progression.** Given marked exams, when a teacher/coordinator opens reports, then they see per-exam status, a class×subject most-recent + trend view, and a per-student profile across subjects.
- **J7 — Guardian view.** Given a login-enabled guardian, when they open the child's results card, then they see read-only published results (subject, exam#, marks/total, %, pass/fail, weakness, guardian-action — **never** the teacher-action), D-#68.

## 8. Guardian messaging (inline templates — ship now, migrate later)
Three Bangla templates ship inline (Islamic salutation + du'a preserved; a weak score is never framed as "fail" to the parent). Placeholders: `{StudentName} {Subject} {TestNumber} {TestDate} {Marks} {TotalMarks} {Weakness} {GuardianAction}`.

- **Regular (result with feedback):**
  > আসসালামু আলাইকুম। {StudentName}-এর {Subject} ক্লাস টেস্ট ({TestNumber}) ফলাফল — প্রাপ্ত নম্বর: {Marks}/{TotalMarks}।
  > লক্ষণীয় দিক: {Weakness}
  > অভিভাবকের করণীয়: {GuardianAction}
  > আল্লাহ তাকে উত্তরোত্তর উন্নতি দান করুন, আমীন। কোনো জিজ্ঞাসা থাকলে জানাবেন। জাযাকাল্লাহু খাইরান।
- **Excellent (no weakness):**
  > আসসালামু আলাইকুম। আলহামদুলিল্লাহ! {StudentName} {Subject} ক্লাস টেস্ট ({TestNumber})-এ চমৎকার করেছে — {Marks}/{TotalMarks}। আল্লাহুম্মা বারিক। এই ধারাবাহিকতা ধরে রাখতে তাকে উৎসাহ দিন। জাযাকাল্লাহু খাইরান।
- **Absent:**
  > আসসালামু আলাইকুম। {StudentName} {TestDate}-এর {Subject} ক্লাস টেস্টে ({TestNumber}) অনুপস্থিত ছিল। নিয়মিত উপস্থিতি তার জন্য জরুরি — অনুগ্রহ করে উপস্থিতি নিশ্চিত করুন। জাযাকাল্লাহু খাইরান।

Delivery: wa.me for **all** guardians (ADR-003); login-enabled additionally get a `Notification` via emit() (D-#72). `NOTIFICATION_KINDS += CLASS_TEST_RESULT` extends verifier §C.5; if `vocab.ts` is frozen by an in-flight branch at CT-3 build, ship the **kind-gated no-op + wa.me path** and activate the kind when vocab unfreezes (the D-#94 `ASSIGNMENT_CHASE` / `VOCAB_RESULT` precedent). These templates **migrate verbatim** onto the planned Message Templates registry when it exists — no rework (wording is identical either way).

## 9. Reports & thresholds
Read-side aggregates only (D-#44); time inputs passed in (no clock inside) for deterministic math. Deadline default = 2 **school-days** after the exam date (admin-configurable per test). Trend = latest vs previous percent for the same student×subject (↑/↓/→).

## 10. Out of scope
Auto-grading; retakes / resubmission lifecycle; any fines or money (D-#27 posture); importing the legacy `.xlsx` (manual / forward entry — a one-off `import-classtests` ingest is a **possible later add** if the Principal confirms a clean source, flagged not built); the **Message Templates registry** (a separate planned session — CT ships inline templates and migrates later); guardian push beyond the existing emit() seam; Quran class tests (a Quran Tracker concern, D-#36 pattern); combining multiple subjects on one exam record.

## 11. Reused / unchanged
Trackers operational plane + ADR-005 firewall; the question pool + CT-kind set assembly + `/pdf/set` PDF export (existing); `StoredFile`/`DriveStore` file store (D-#70/#71, M-4 generalization); D-#50 routine calendar (school-day deadline); emit() seam (D-#72) + Notification inbox/push (N-1..N-4); wa.me (ADR-003); guardian read gate (`assertGuardianOfStudent`, D-#68) + the guardian portal results card (currently an inert placeholder); read aggregates (D-#44); counts-derived-never-typed (D-#85); append-only audit (ADR-008); sequence pattern (D-#34); UI guidelines (D-#61). RBAC composes existing permissions only (D-#94) — **no new role/permission** (D-#17).

## 12. Contract-sync note
**App-native vocab only** — `/shared/vocab.ts` enum/label additions (`CLASS_TEST_*`, `NOTIFICATION_KINDS += CLASS_TEST_RESULT`, `StoredFile` kind) + the verifier section; **no import-envelope schema or harness change** (no two-/three-place wire sync). Per AGENTS.md rule 5, if an in-flight branch is also editing `/shared/vocab.ts` when CT-1/CT-3 build, **serialize** (land one PR, rebase the other); the vocab verifier must print green in the build session before commit.

## 13. Traceability
**New:** D-#119 (adopt module; ad-hoc per-chapter; pool-set + uploaded-paper; HW_SUBJECTS, Quran excluded) · D-#120 (request-time metadata + exam-date deadline anchor + school-day-aware + file-store reuse) · D-#121 (results/scoring/publish/guardian-facing fields; configurable pass mark; no retake; republish re-notifies via versioned dedupeKey) · D-#122 (delivery + reports + RBAC composition; inline templates → registry migration).
**Referenced:** D-#17, D-#31, D-#34, D-#36, D-#44, D-#50, D-#68, D-#70, D-#71, D-#72, D-#85, D-#94 · ADR-003, ADR-005, ADR-008.
**Vocab refs (app-native):** `CLASS_TEST_STATUSES`, `CLASS_TEST_SOURCES`, `*_LABELS_BN`, `NOTIFICATION_KINDS` (+= `CLASS_TEST_RESULT`), `StoredFile` kind (`classtest_question`).

## 14. Acceptance checklist (per slice — executed-verification gate)
- [ ] **CT-1:** vocab additions + verifier section green; `ClassTest` request→printed lifecycle; `CT-…` sequence; CT-set link + uploaded-paper route; Office mark-printed creates the record; firewall green (corpus ↛ class-test).
- [ ] **CT-2:** per-student results; derived percent/pass-fail; configurable pass mark; **exam-date-anchored, school-day-aware** deadline + overdue derivation.
- [ ] **CT-3:** publish/unpublish per-student + per-exam; wa.me + emit() delivery; **republish re-notifies (versioned dedupeKey)**; inline templates; `childTestResults` read.
- [ ] **CT-4:** Reports Status, Principal Dashboard (KPIs + overdue-by-teacher), Class×Subject Analysis (trend), Student Profile; Office overdue-chase (`message:dispatch`).
- [ ] **CT-5:** all screens render; guardian card read-only (no teacher-action exposed); UI per D-#61.
- [ ] Gate per slice: shared build + tsc, vocab verifier PASS, jest green, app tsc + expo web export green.
- [ ] No corpus/identity firewall regression (J5.6 stays green).
