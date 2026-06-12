# PRD — Attendance (teacher + student)

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** two attendance flows that share one calendar and one reporting surface but capture data
differently:
1. **Teacher attendance** — the Admin uploads a daily **Employee Attendance Report** Excel (export from
   the school's biometric/HR system); the app parses it into per-staff per-day records (present / late /
   leave / absent).
2. **Student attendance** — captured **in-app**, once per day per section, **absent-only** (the assigned
   teacher marks absentees; everyone else is present). The app then **produces the absentee report** that
   today lives in an external SMS system.

Plus the cross-cutting machinery both need: **who is assigned to mark a section today**, a **timed
reminder + escalation** engine (12:10 / 12:45 / 2:00 on school-open days), a **student leave application**
(recorded only), a **WhatsApp/push** notification path, and the **reports + RBAC**.

This is the build contract; the authoritative decisions live in `DECISIONS.md` (D-#63–D-#67). If they
disagree, the decision row wins — fix this file.

---

## 1. Goal
Replace two manual/external processes with one in-app system of record:
- Teacher absence/late/leave currently lives only in the biometric export → **ingest it daily** so it's
  queryable and reportable inside the app.
- Student absentees are phoned/SMSed from an external sheet → **capture them in-app** and **generate the
  same absentee report**, while nudging the responsible teacher (and, on miss, Office then Principal) and
  giving guardians a path to file a leave reason.

## 2. What exists today (reused, not rebuilt)
- **Staff records** — `StaffProfile` (HR master, `schoolId` = the source ID e.g. `20171`, plus optional
  `biometricId`). Teacher-attendance rows hang off these.
- **Student roster** — `Student` (`schoolId` = the ID number e.g. `0093`, `classId`, `sectionId`,
  `gender`, `phone`). **Roll number differs from the ID** (O1) → a new `Student.rollNumber` field is added;
  the absentee report carries **both roll and ID** (the source sheet's two columns), residential dropped.
- **Section daily-coordinator gate** — `assertIsClassTeacher(ctx, sectionId)` (D-#42/#45/#53). **Student
  attendance is duty CT-2** in `prd-class-teacher.md` §3 — this PRD wires that gate.
- **Class-teacher assignment + history** — `Section.classTeacherId`, `Section.supportTeacherIds`,
  append-only `ClassTeacherAssignment` (D-#53). The per-day/range marker assignment extends this pattern.
- **School calendar** — `routine/calendar.ts` + `HolidayException` (D-#50): Sun–Thu FULL, Fri OFF,
  Sat QURAN-ONLY, holiday overrides. **The reminder engine fires only on FULL days** (and QURAN-ONLY for
  Quran groups — see §7). Single calendar source, no second truth.
- **Routine trigger pattern** — `routine/trigger.ts` defines a *schedule of trigger points; delivery rides
  the messaging/push pipeline* (D-#52). The attendance reminder is exactly trigger type (b) from D-#52 —
  this PRD builds the delivery for it.
- **Manual WhatsApp send** — `buildCredentialShareLink` `wa.me` deep-link pattern (D-#59/ADR-003) +
  `message:dispatch` permission. **WhatsApp stays manual click-to-send** (see §9 / D-#65).
- **Audit log** — append-only `Audit` (ADR-008); new event kinds added per §10.

## 3. Decisions (authoritative in DECISIONS.md)
| ID | One-line |
|---|---|
| D-#63 | Two attendance flows: teacher = daily Excel snapshot (name-matched); student = in-app, once-daily, absent-only. |
| D-#64 | Student-attendance marking is gated by `assertIsClassTeacher` (CT-2); a per-day/date-range **marker assignment** lets Principal/Office assign any teacher to a section, multi-section allowed. |
| D-#65 | Reminder/escalation engine: **external scheduler** → idempotent server endpoint at 12:10/12:45/2:00 on school-open days; **push is automatic, WhatsApp is a manual button**; escalates teacher → Office (12:45) → Principal (2:00). |
| D-#66 | Student **leave application** = recorded only (no approval, D-#45 CT-3 not built); absence-without-application is a first-class reportable state. |
| D-#67 | New vocab: permissions `attendance:mark` / `attendance:manage`; new models + audit kinds; staff **name→profile reconciliation** for the ID-less export. |

## 4. Status legend — the Excel exports (LOCKED from source inspection)
**Teacher file (`Employee Attendance Report …xlsx`)** — one row per employee for the dated column:
| Symbol | Meaning | App status |
|---|---|---|
| ✔ | present on time | `PRESENT` |
| 𝓛 | late (source already flags it — **read the symbol, no grace computation**) | `LATE` |
| ✘ | not present | `LEAVE` if a leave record is on file for that staff/date, else `ABSENT` (D-#63) |
| ℞ | "regular" | **ignored** |
- Identity: the export **omits the ID column** → match by **Name** with a reconciliation step (§6.A).
  (Our `StaffProfile.schoolId` equals the source ID, so if the export ever includes the ID column the
  importer matches on it directly — name match is the fallback, not the only path.)
- Punch times: **store both** in/out when present. Date is **read from the sheet header**, not "today".
- One shift per person (parsed from the `Shift` text, e.g. "Syl Morning Shift 7:00-12:00").
- Re-upload of the same date **overwrites** that date (full snapshot).

**Student file (`Absentee Report …xlsx`)** — this is the **OUTPUT** the app produces (class/section,
absentee count, names, **roll numbers + ID numbers**), **not** an import. Residential-status column is
**dropped** (D-#63).

## 5. Build-step → slice map
| Slice | Build-step | Status |
|---|---|---|
| **AT-1** | Teacher-attendance import: model + Excel parser + name-reconciliation + Principal/Office upload screen + records/reports | buildable now |
| **AT-2** | Student-attendance capture: model + marker-assignment + mark-absentees screen (CT-2 gate) + absentee-report generation | buildable now |
| **AT-3** | Student leave application (recorded-only) + "absent & no application" linkage | buildable now |
| **AT-4** | Reminder + escalation engine: external-scheduler endpoint, unmarked-section detection, push delivery (`expo-notifications` + device tokens), manual-WhatsApp action | needs infra (§9) |
| **AT-5** | Reporting surface + RBAC: class/section/single-student/absent-no-application + teacher absence/late summaries | buildable after AT-1/2 |

## 6. Journeys & acceptance criteria

### AT-1 — Teacher attendance (Excel upload)  *(buildable now)*
- **AT1.1 Upload + parse** — Given an Admin (`attendance:manage`) uploads the Employee Attendance Report
  for a date, Then each row is parsed to `{ staff, date, status, punchIn?, punchOut?, shift }` using the
  §4 legend; the **date is taken from the sheet**; ℞ rows are skipped.
- **AT1.2 Name reconciliation** — Given a row whose `Name` does not uniquely resolve to one active
  `StaffProfile`, Then it is held in an **unmatched list**; the Admin maps it once to a profile and the
  mapping is **remembered** (a `StaffNameAlias`) so future uploads auto-match. No silent drop — the upload
  reports matched / unmatched / skipped counts.
- **AT1.3 Late** — Given a 𝓛 row, Then status = `LATE` directly from the symbol (no grace window, D-#63).
  *(If a future export gives punch-only with no symbol, late = first punch after the shift start, 0 grace.)*
- **AT1.4 Leave vs absent** — Given a ✘ row, Then status = `LEAVE` iff a staff leave record exists for that
  date, else `ABSENT` (D-#63). *(Staff-leave entry is out of this PRD's first cut — until a staff-leave
  source exists, ✘ = `ABSENT`; the split is data-driven, no code change when staff-leave lands.)*
- **AT1.5 Idempotent overwrite** — Given a re-upload for an already-imported date, Then that date's teacher
  records are replaced wholesale (snapshot semantics); an `Audit` `ATTENDANCE_IMPORTED` row is appended
  (actor, date, counts).
- **AT1.6 Upload screen** — Admin tab: pick file → preview matched/unmatched/skipped → resolve unmatched →
  commit. Past uploads are listed by date.

### AT-2 — Student attendance (in-app, absent-only)  *(buildable now)*
- **AT2.1 Marker assignment** — Given Principal/Office (`attendance:manage`), When they assign a teacher to
  a section for **a day or a date range**, Then a `SectionAttendanceAssignment { section, teacherId,
  fromDate, toDate, actor }` persists (append-only history, ADR-008). Default marker = the section's
  `classTeacherId`; a teacher may be assigned to **multiple sections** the same day (no cap, surfaced).
- **AT2.2 Who may mark** — Given a school day, the section's **assigned marker for that date** (the override
  assignment if present, else the class teacher) may mark; the gate is `assertIsClassTeacher` generalized
  to "is the section's marker today" (CT-2). Principal/Office are **not** auto-allowed to mark (they assign).
- **AT2.3 Mark absentees** — Given the marker opens the section for today, Then they see the section roster
  and tap the **absent** students; on submit, a `StudentAttendanceDay { section, date, absentStudentIds[],
  markedBy, markedAt }` is written and the section is **marked** for the day. Everyone not tapped = present
  (absent-only capture, D-#63). One record per section per day; re-open edits it until locked.
- **AT2.4 Once daily** — exactly one `StudentAttendanceDay` per (section, date); the cutoff that drives the
  reminders is **~12:00** (D-#65).
- **AT2.5 Absentee report generation** — Given marked sections for a date, Then the app produces the
  **absentee report** (per class + per section: count, student names, **roll numbers + ID numbers**) —
  replacing the external SMS sheet; residential-status column omitted.

### AT-3 — Student leave application (recorded-only)  *(buildable now)*
- **AT3.1 Submit** — Given a guardian (or Office on their behalf) submits a `StudentLeaveApplication
  { student, fromDate, toDate, reason, submittedBy, submittedAt }`, Then it is **recorded** — **no approval
  step** (D-#66 / CT-3 not built). Visible to the class teacher and Office.
- **AT3.2 Absent ⇄ application linkage** — Given a student is marked absent on a date, Then a report can
  show whether a leave application covers that date; **"absent with no application"** is a first-class
  reportable state (§8). This linkage also drives the teacher-side ✘ = leave-vs-absent split (AT1.4) once a
  staff-leave source exists — same shape, different subject.

### AT-4 — Reminder + escalation engine  *(needs infra — §9)*
- **AT4.1 School-day gate** — Given a date, the engine runs **only when `resolveDayType` = FULL** (and
  QURAN-ONLY for Quran-group attendance, §7); on OFF/HOLIDAY it is a no-op (reuses D-#50 calendar).
- **AT4.2 Unmarked detection** — At each trigger time the engine computes **sections expected to be marked
  today that are still unmarked** (no `StudentAttendanceDay`).
- **AT4.3 12:10 → marker** — For each unmarked section, notify the **assigned marker (+ the class teacher)**
  via **push (automatic)** to mark the section. *(Teachers are not asked to chase guardians — O3.)*
- **AT4.4 12:45 → Office** — Sections still unmarked escalate to **Office**.
- **AT4.5 2:00 → Principal** — Sections still unmarked escalate to **Principal**.
- **AT4.7 Guardian chase is an Office action (manual WhatsApp)** — Given marked absentees, the **Office**
  (`attendance:manage`) sees the absentee list and, per absent student lacking a leave application, can
  **manually send a `wa.me` WhatsApp** nudging the guardian to submit a leave application with reason. The
  **teacher never chases guardians** (O3); push to the teacher is only "mark your section". WhatsApp stays
  manual (D-#65).
- **AT4.6 Idempotent endpoint** — The three times are driven by an **external scheduler** calling a single
  **authenticated, idempotent** server endpoint with the trigger tier (`T1210|T1245|T1400`); calling it
  twice for the same date/tier sends nothing extra. The server owns *what* to send; the scheduler owns
  *when* (D-#65). Each dispatch is audited.

### AT-5 — Reporting + RBAC  *(after AT-1/2)*
See §8 (reports) and §11 (RBAC).

## 7. Quran / SubjectGroup attendance (scope note)
General student attendance is per **`Section`** (this PRD). Quran/Arabic are taught in cross-grade
**`SubjectGroup`s** (D-#48/#56) whose attendance runs against the group, on QURAN-ONLY Saturdays too. This
PRD builds **Section** attendance first; SubjectGroup attendance reuses the same model with `groupId` in
place of `sectionId` and is a **fast-follow**, flagged here so the model is shaped to allow it (an optional
`subjectGroupId` alternative to `sectionId`). Not built in AT-1..5 unless explicitly pulled in.

## 8. Reports (D-#67)
| Report | Audience | Shape |
|---|---|---|
| Class-wise absentee (a date) | Principal/Office | per class: count + names + roll + IDs |
| Section-wise absentee (a date) | Principal/Office/class teacher (own) | per section: count + names + roll + IDs (the external sheet's replacement) |
| Single-student attendance (a period) | Principal/Office/class teacher (own) | per-day present/absent + % over a date range |
| **Absent & no leave application** (a period) | Principal/Office/class teacher (own) | absent dates with no covering `StudentLeaveApplication` |
| Teacher absence / late / leave summary (a period) | Principal/Office | per staff counts + %; daily roster |
| Unmarked-section log (a date) | Principal/Office | which sections missed marking + escalation tier reached |

## 9. Infrastructure realities (decided)
1. **WhatsApp = manual.** The `wa.me` pattern is human click-to-send; automatic WhatsApp would need the
   WhatsApp Business API / a paid provider. **Decision (D-#65): WhatsApp stays a manual "Send" button;
   push is the only automatic channel.** If a Business-API key is provided later, the same dispatch point
   can fan out automatically — no model change.
2. **Timed triggers via external scheduler.** No always-on in-process cron is assumed. **Decision (D-#65):
   an external scheduler** (cron service / platform scheduler) hits the idempotent endpoint (AT4.6) at
   12:10 / 12:45 / 2:00 local time. The endpoint is safe to call repeatedly.
3. **Push transport.** Add **`expo-notifications`** to the app + a **`PushDevice`** store (one or more Expo
   push tokens per `User`, registered on login/permission-grant). Server sends via the Expo push service.
   *(Approved: add the dependency + token storage.)*

## 10. New vocab / models / audit (contract-sync — D-#67)
> Adding permissions touches **`/shared/vocab.ts` + the schema + the harness**, then run the verifiers
> (`skills/contract-sync`). Do not change one in isolation.
- **Permissions:** `attendance:mark` (the section marker — granted via the `assertIsClassTeacher` gate, role
  TEACHER) and `attendance:manage` (upload teacher Excel, assign markers, full reports — Principal/Office).
  Both `build` status. Reuse `message:dispatch` for the manual WhatsApp action.
- **Models (identity/operational plane — NO corpus path, ADR-005):** `TeacherAttendanceDay`,
  `StaffNameAlias`, `SectionAttendanceAssignment`, `StudentAttendanceDay`, `StudentLeaveApplication`,
  `PushDevice`.
- **Audit kinds (append to `Audit.ts`):** `ATTENDANCE_IMPORTED`, `ATTENDANCE_MARKED`,
  `ATTENDANCE_MARKER_ASSIGNED`, `ATTENDANCE_REMINDER_SENT`, `LEAVE_APPLICATION_SUBMITTED`.
- **Student field:** add **`Student.rollNumber`** (optional string) — roll differs from `schoolId`/ID (O1);
  `schoolId` stays the ID number. Additive, existing records valid.

## 11. RBAC (D-#67)
- **`attendance:manage`** (Principal/Office): upload teacher Excel; resolve name matches; assign/clear
  section markers; view all reports.
- **`attendance:mark`** (the section's assigned marker / class teacher, via `assertIsClassTeacher`): mark
  that section's absentees; view that section's reports only.
- **Guardian:** submits/reads their child's leave application (rides the deferred guardian portal,
  `guardian:read_child` is `pipeline` — until then Office submits on their behalf).
- **PII firewall (ADR-005):** all attendance/leave data is identity-plane; **no corpus path**; the J5.6
  fail-closed firewall test must keep passing. No analytics/export resolver may join attendance to identity.

## 12. Out of scope (this feature)
- **Per-period** student attendance (once-daily only, D-#63).
- **Student-leave approval workflow** (recorded-only, D-#66; CT-3 stays deferred per `prd-class-teacher.md`).
- **Automatic WhatsApp** (manual button only until a Business-API key exists, §9).
- **Staff leave management** (entry/approval) — the teacher-side ✘ split is data-ready (AT1.4) but the
  staff-leave *source* is a separate module; until then ✘ = `ABSENT`.
- **SubjectGroup (Quran/Arabic) attendance** — fast-follow, model-shaped for it (§7), not built here.
- **Payroll / pay-impact of absence** — HR module concern, not attendance capture.

## 13. Confirmed (were open)
- **O1 — Roll ≠ ID → RESOLVED:** add `Student.rollNumber` (O1); the report shows **both roll and ID**,
  `schoolId` stays the ID number (§2/§4/§8/§10).
- **O2 — Lock time → RESOLVED:** the section day is **editable until end of day**; after that **Principal/
  Office** can unlock to amend. (Reminders/escalation are unaffected — they key off "marked at all".)
- **O3 — Guardian chase → RESOLVED:** **Office chases guardians** via the manual WhatsApp action (AT4.7);
  **teachers are never asked to chase** — their 12:10 push is only "mark your section".
- **O4 — Teacher-side reports → CONFIRMED:** the staff late/leave/absent summary set in §8 (per-staff
  counts + % over a period, plus the daily roster) is what the Principal wants.
