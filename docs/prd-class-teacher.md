# PRD — Class teacher as a duty-bearing role

**Status:** DRAFT (build contract) · **Owner:** Principal
**Scope:** generalize the existing per-section **class-teacher** designation from a homework-only
coordinator into the **shared "section daily coordinator" gate** that multiple features key off:
homework reconciliation (already wired), **student attendance**, **student leave approval**,
**report-card / result-sheet sign-off**, and **parent-communications ownership**. **No new auth role,
no new permission** — `assertIsClassTeacher` becomes the reusable authorization check; each duty's
*write* gate is added **with its own module** as those modules are built. Operational/identity plane;
no corpus path; the J5.6 firewall test is unaffected.

This is the build contract; the decision is authoritative in `DECISIONS.md` (D-#45). If they disagree,
the decision row wins — fix this file.

---

## 1. Goal
Today "class teacher" means exactly one thing — the person who runs the **homework** day reconciliation
(D-#42). The school wants it to mean the **section's daily coordinator**: the single teacher accountable
for that section's day-to-day operational decisions. This contract (a) makes the existing
`assertIsClassTeacher` a **general, reusable gate** plus the visibility a coordinator needs, and (b)
records the **duty map** so each future module wires its write-gate to the class teacher instead of
re-deciding who is in charge.

## 2. What exists today
- `Section.classTeacherId` — one optional `TEACHER` per section (`server/.../foundation/models/Section.ts`).
- `assignClassTeacher(sectionId, userId)` — Principal/Office, via the existing `roster:manage`, no new
  permission (`server/.../foundation/resolvers/classes.ts`).
- `assertIsClassTeacher(ctx, sectionId)` — stricter than `assertCanWrite`; even a teaching/proxy teacher
  is denied unless they are the assigned class teacher; Principal/Office are **not** auto-allowed
  (`server/.../middleware/authz.ts`). Currently called only by `trimHomeworkItem` / `confirmHomeworkDay`.
- `AssignClassTeacherScreen` — Admin tab (D-#42 UI).

So the *mechanism* is built and correct; it is just **homework-scoped** and lacks coordinator visibility.

## 3. The duty map (what `assertIsClassTeacher` will gate)
Each row is a **write** gated on "caller is the section's class teacher". The gate exists now; the duty
lands **when its module is built** — most of these modules do not exist yet, so this is a *forward
contract*, not work to do today.

| Duty | Gate | Module status | Lands in |
|---|---|---|---|
| Homework reconcile / confirm-issue | `assertIsClassTeacher` | **built** (D-#42) | done |
| **Student attendance** — mark / lock the section's daily attendance | `assertIsClassTeacher` | not built | with the **attendance** module |
| **Leave approval** — approve / forward a student's leave for the section | `assertIsClassTeacher` | not built | with the **student-leave** module |
| **Report-card sign-off** — review / sign the section's result sheet | `assertIsClassTeacher` | not built | with the **report-card / results** module |
| **Parent-comms ownership** — own notices / chase messages for the section | `assertIsClassTeacher` | not built | with the **comms / notices** module |

> **Dependency note (important):** three of the four new duties presuppose features SCD Hub does not yet
> have (no attendance, student-leave, report-card, or comms module). The only **standalone** work this
> contract authorizes now is CT-1 (generalize + visibility). The duty gates are a one-line `await
> assertIsClassTeacher(...)` added inside each module when it is built — recorded here so that module
> reuses the gate instead of inventing a new "who's in charge" rule.

## 4. Build-step → slice map
| Slice | Build-step | Journeys | Status |
|---|---|---|---|
| **CT-1** | Generalize the gate + coordinator visibility + support teacher + assignment-history log (server + app) | CT1.* | **buildable now** |
| **CT-2..5** | Duty write-gates (attendance / leave / report-card / comms) | CT2.*–CT5.* | **deferred** — each rides its module |

## 5. Journeys & acceptance criteria

### CT-1 — Generalize the gate + coordinator visibility  *(buildable now)*
- **CT1.1 `assertIsClassTeacher` is module-agnostic** — Given the gate, Then it is documented and used as
  the **general** "section daily coordinator" check (not named/commented as homework-only), ready for any
  module to call; its current homework behavior is unchanged. *(Refactor/relabel + a reusable test
  helper; no behavior change.)*
- **CT1.2 "My sections as class teacher" (teacher view)** — Given a teacher who is class teacher of one or
  more sections, When they open their home/coordinator view, Then those sections are listed (the entry
  point their coordinator duties hang off).
- **CT1.3 Admin overview of assignments** — Given an admin (`roster:manage`), When they open the
  class-teacher overview, Then every section shows its class teacher **and unassigned sections are
  flagged** (an unassigned section cannot reconcile homework today — and will not be able to run any
  future duty either).
- **CT1.4 Multi-section is allowed, surfaced not blocked** — Given a teacher already class teacher of a
  section, When they are assigned another, Then it succeeds (no hard cap), but the admin overview shows
  the count so over-loading is visible (D-#45). *(Confirm if a hard cap is ever wanted — default: none.)*
- **CT1.5 Support / assistant teacher on a section** *(D-#53)* — Given an admin (`roster:manage`), When
  they add/remove a support teacher on a section, Then a `Section` support-teacher list (a TEACHER set)
  persists; the support teacher is a **recorded** member and is **not** granted `assertIsClassTeacher`
  rights; the class teacher remains the single coordinator. Nursery seeds one today.
- **CT1.6 Append-only assignment history** *(D-#53)* — Given any class-teacher set/clear (`assignClassTeacher`)
  or support-teacher change, When it is written, Then a `ClassTeacherAssignment` row is appended (section,
  teacherId/`null`, role=class_teacher|support, actorId, timestamp); the log is **append-only** (ADR-008
  pattern), never mutated, and is queryable per section/teacher.

### CT-2..5 — Duty write-gates  *(deferred; land with each module)*
Each is the same shape — stated now so the module build is unambiguous:
- **CT-2 Attendance** — only the section's class teacher may mark/lock that section's daily attendance.
- **CT-3 Leave approval** — only the class teacher may approve/forward a student's leave for the section.
- **CT-4 Report-card sign-off** — only the class teacher may sign the section's result sheet.
- **CT-5 Parent-comms** — the class teacher is the owner of the section's notices/chase messages.
Each: Given a non-class-teacher on the section → denied; the class teacher → allowed; Principal/Office are
not auto-allowed (they assign the class teacher, matching D-#42).

## 6. In scope by Principal reversal (D-#53)
Both items the first draft deferred are now **in scope** (D-#53 supersedes the D-#45 out-of-scope note):
- **Assistant / support teacher** — `Section` gains an optional **support-teacher** list (a TEACHER set).
  Nursery runs one today; KG/others may in future. Built in **CT-1** (see CT1.5). The **class teacher
  stays the single coordinator gate** (`assertIsClassTeacher`); a support teacher is a *recorded* member,
  separately grantable, and is **not** auto-granted the coordinator duties — whether a specific duty (e.g.
  Nursery attendance) should also admit the support teacher is confirmed per-duty when that module ships.
- **Append-only assignment history** — a `ClassTeacherAssignment` log (append-only, ADR-008 audit pattern)
  records every class-teacher set/clear with actor + timestamp. Built in **CT-1** (see CT1.6) — **not**
  deferred, because teachers move between subjects/classes often and the assignments are auditable acts.

## 7. Out of scope (this feature)
- **Support-teacher *coordinator* authority** — a support teacher does **not** inherit
  `assertIsClassTeacher` rights by default; any per-duty exception is decided with that duty's module.
- **A general staff-assignment / posting history** beyond the class-teacher role — the `ClassTeacherAssignment`
  log records the class-teacher designation only, not every teaching-subject change (routine scope-binding,
  D-#49, owns that).

## 8. Reused / unchanged
- **`Section.classTeacherId` + `assignClassTeacher` + `assertIsClassTeacher`** (D-#42) — generalized in
  place, not replaced; no new permission (`roster:manage` still assigns). Adds a support-teacher list
  (D-#53) alongside, not replacing, `classTeacherId`.
- **`roster:manage`** (Principal/Office) — the assignment permission; unchanged.
- **Plane/firewall** (ADR-005) — class-teacher data is identity-plane; no corpus path; J5.6 unaffected.
