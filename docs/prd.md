# PRD — First-priority slice

**Status:** DRAFT · **Owner:** Principal · **Scope:** the *build-now* slice only (REQ §3, §9 "In").
Pipeline work (guardian portal screens, analytics, AI, messaging, ops modules) is **out of scope** —
see `docs/roadmap.md`.

This PRD turns the requirements into **per-role journeys with testable acceptance criteria**, written
Given/When/Then so they seed the NFR-11 suite directly: Maestro e2e for the golden paths,
Jest+Supertest for resolver/authz, and the fail-closed firewall test. Traceability tags
(`R-Cx`, `R-Qx`, `R-Ax`, `R-Tx`, `R-ACx`, `D-#nn`) point back to `docs/requirements.md` / `DECISIONS.md`.

---

## 1. Goal of this slice
A teacher can **see authored content**, **assemble assessment sets from a filtered question bank**,
and **run the day-to-day trackers** — on iOS/Android/Web from one codebase — with content entering
only through the validated import seam, access enforced in resolvers, and the corpus/identity firewall
provably closed. Guardian **accounts + child linkage** exist; guardian *screens* do not (deferred).

## 2. Roles & scope in scope
**One `TEACHER` role; supervisory/cover positions are scope overlays** (D-#17/#18, ADR-017) — not new
roles or permissions, just wider row-scope.

| Role | In this slice | Primary jobs here |
|---|---|---|
| **Principal** | Full | Import content; full read; manage users; read (never edit) audit log. |
| **Teacher** | Full, scope = **union of grants** | Browse content, filter questions, assemble HW/AS/CT, fill trackers. Authors nothing in-app. |
| **Office** | Full | Import content; manage roster; link guardians to children; dispatch messages; manage scope grants. |
| **Guardian** | **Account + linkage only** | Authenticate + be linked to children. No portal screens; `guardian:read_child` pipeline-gated. |
| **Student** | Data only | Has a profile; **no login**. |

**Teacher scope grants** (the effective row-scope is their union):
- **Teaching** — own sections: read + assemble + tracker-write (base).
- **Supervisory** (Class Teacher / Coordinator / Subject Lead) — **read-only** oversight over a
  configurable extent: whole-school, a grade/class (all subjects), a subject/department (all classes),
  or an explicit assigned set. `*:read` only; no assemble/tracker-write outside teaching scope.
- **Proxy / cover** — for the covered class only: read chapter+lesson plans, `set:assemble`
  (assign homework), `tracker:write`. A **bounded write** overlay that is **duration-limited in days**:
  the assigner (Principal/Admin) sets the number of days at grant time (matching the absent teacher's
  leave); the grant **auto-expires** at the end of the last day and access is revoked (D-#20).

---

## 3. Journeys & acceptance criteria

### J1 — Content: import a plan, then view it  *(REQ-CONTENT; e2e golden path #1)*
- **J1.1 Import a valid envelope** *(R-C2, R-IMP1, R-IMP3; content:import → Principal+Office, D-#11)* —
  Given a Principal/Office user and a well-formed session_plan envelope, When imported, Then it passes
  the gate (L1 envelope → L2 plan-schema → L3 consistency → REF-21 advisory), is persisted with
  `rendered_markdown` + `pinned_to` + `curation_tag` + `review_status`, an `import_batches` audit row is
  written, and a de-identified `content_imported` event is emitted.
- **J1.2 Reject an invalid envelope** *(R-IMP3)* — malformed envelope → rejected, failing checks
  surfaced, **nothing** persisted.
- **J1.3 REF-21 advisory never blocks** *(R-IMP4, D-#4)* — surface-tripping envelope → flags recorded
  and surfaced, **import still succeeds**.
- **J1.4 Import is denied where unentitled** *(R-AC1, R-AC8)* — a Teacher attempting `content:import` is
  denied (default-deny).
- **J1.5 Browse & open** *(R-C1, R-C4, R-C5)* — browse Subject × Class → Chapter → Lesson; filter by
  subject/class/chapter/lesson/curation_tag; tree + opened session plan render on all three clients.
- **J1.6 Supervisory read beyond own classes** *(R-AC3, D-#17)* — Given a teacher with a supervisory
  grant (e.g. a Coordinator over Science, all classes), When they browse, Then they can **open content
  and question banks they do not teach** within that extent; a plain teacher without the grant **cannot**.
- **J1.7 Display is imported Markdown, never re-rendered** *(R-C3, ADR-006)* — the source is
  `rendered_markdown`; the app does not re-render from JSON.
- **J1.8 Export PDF (Bangla correct)** *(R-C6, NFR-5, NFR-7; Bangla PDF smoke test)* — server-generated
  **Markdown→PDF** with correct Bangla typography, identical across clients.
- **J1.9 Versioning is supersede-not-overwrite** *(R-C7)* — a new version retains the prior; `current` flips.

### J2 — Question bank: filter & search  *(REQ-QBANK)*
- **J2.1 Import questions via the same envelope** *(R-Q2, doc_type=question)* — same gate as J1.1/J1.2.
- **J2.2 Filter by any combination of tags** *(R-Q1, R-Q3)* — filter by subject/class/chapter-or-lesson/
  type/Bloom/difficulty/marks (any combination) → only matching questions, with tag chips.
  *`QUESTION_TYPES` + the question payload are RATIFIED + LOCKED (Project 04, D-#19). `paper_role` is
  a distinct filter axis from `question_type`. `stimulus` doc-type carries shared passages.*
- **J2.3 Preview a question** *(R-Q4)*.
- **J2.4 Supervisory read of un-taught question banks** *(R-AC3, D-#17)* — a supervisor sees question
  banks across their extent, not only their teaching subjects/classes.

### J3 — Assemble: basket → set → PDF  *(REQ-ASSEMBLE; e2e golden path #2)*
- **J3.1 Select into a basket** *(R-A1, R-A6)* — selections collect in a working basket; each is logged to `events`.
- **J3.2 Assemble a set** *(R-A2, R-A3)* — HW / AS / CT via one shared engine; per-type metadata
  (CT: marks + duration; HW/AS: due date).
- **J3.3 Section + date scoping** *(R-A5, D-#1, R-AC3)* — single-"Main"-section class → picker hidden,
  set scoped to "Main" + date; picker appears only when a class has >1 section.
- **J3.4 Export a set as PDF** *(R-A4, R-C6)*.
- **J3.5 Write-scope is narrow** *(R-AC3, R-AC8, D-#17/#18)* — a teacher may assemble only for a section
  in their **teaching or proxy** grant. **Supervisory grant does NOT permit assembling** outside teaching
  scope (read-only oversight). A **proxy** teacher **may** assemble (assign homework) for the covered class.

### J4 — Trackers  *(REQ-TRACK; e2e golden path #3)*
- **J4.1 Class-test tracker** *(R-T1, R-T6)* — scores per student per CT set; outcomes → `events`.
- **J4.2 Assignment tracker + non-submitter message** *(R-T2)* — compose a guardian **`wa.me` deep link**
  for **manual** send (no server endpoint, no automation this phase).
- **J4.3 Homework tracker** *(R-T3, R-T6)* — completion per student; outcomes → `events`.
- **J4.4 List / filter / export** *(R-T5)*.
- **J4.5 Tracker write-scope** *(R-AC3, D-#17/#18)* — a teacher fills trackers only for **teaching or
  proxy** sections; supervisory grant is read-only. A **proxy** teacher **may** fill the tracker for the covered class.

### J5 — Access, identity & the firewall  *(REQ §5; e2e golden path #4 + firewall test)*
- **J5.1 Staff auth** *(R-AC9, D-#5)* — email + password; reset via email link.
- **J5.2 Guardian auth** *(R-AC9, D-#9)* — flexible identifier (email / unique-ID / phone) + password;
  email guardians get reset links; others get office/Principal manual reset.
- **J5.3 Guardian linkage (many-to-many, uniform)** *(R-AC5, D-#8; guardian:link → Office)* — uniform
  access across all guardians linked to a child; every guardian screen is child-switcher scoped.
- **J5.4 Scope-grant enforcement** *(R-AC3, R-AC8, D-#17/#18)* — the resolver composes a teacher's grant
  union: a teacher cannot **read** outside (teaching ∪ supervisory ∪ proxy), and cannot **write** outside
  (teaching ∪ proxy). Office/Principal manage grant assignments.
- **J5.5 Audit log is read-only to Principal** *(R-AC6, R-AC7)* — system-appended; no role edits it;
  guardians never see it; retained ~2yr.
- **J5.6 Fail-closed firewall** *(R-AC4, R-AC8, R-X8, NFR-11)*  ← **the non-negotiable test** — the
  corpus/analytics resolver path, when it attempts to resolve student/guardian identity, **must fail**.
  No scope overlay (supervisory or proxy) creates a corpus→identity path. The test passes by failing.
- **J5.7 Proxy-grant lifecycle (duration-bounded)** *(R-AC3, D-#18/#20)*
  - **Assign:** Given a Principal/Admin and an absent teacher's class, When they create a proxy grant for
    the covering teacher and **enter a number of days N** (start date defaults to today, may be set
    forward), Then the covering teacher gains write (read plans + `set:assemble` + `tracker:write`) on
    **that class only**, effective `[start, start+N)`.
  - **Active window:** Given an active proxy grant, When the covering teacher acts within the window,
    Then writes to the covered class succeed; outside the covered class they are still denied.
  - **Auto-expiry:** Given the window has elapsed (end of day N, school-local time), When the covering
    teacher attempts a write, Then it is denied — the grant is expired (no manual cleanup required).
  - **Early revoke / extend:** Given the assigner revokes early (teacher returned) or extends (leave
    prolonged), Then the window updates accordingly and access follows.
  - **Audit:** Every assign / extend / revoke / expiry is written to the `audit` log (R-AC7).

---

## 4. Golden-path e2e (NFR-11) — what Maestro/Supertest must cover
1. **Import a plan → view it** (J1.1, J1.5, J1.7–J1.8).
2. **Filter questions → assemble a CT → export PDF** (J2.2, J3.1–J3.4).
3. **Record a tracker** (J4.1 or J4.3).
4. **Scope + firewall:** supervisor reads beyond teaching scope (J1.6); proxy writes only the covered
   class (J3.5/J4.5); guardian sees only their child; **fail-closed firewall** (J5.6).

Dense-logic unit/integration targets (NFR-11): import validator (J1.1–J1.3), assembly engine (J3.2),
**scope-grant resolver authz** (J1.4, J1.6, J3.5, J4.5, J5.4), fail-closed firewall (J5.6),
Bangla PDF smoke (J1.8).

## 5. Recommended build order (slices) — see D-#17/#18
1. **Slice 0 — skeleton + auth + identity + scope grants:** monorepo boots; GraphQL health; staff/guardian
   auth (J5.1–J5.2); accounts/roles, classes/sections, subjects, thin student roster, guardian linkage
   (J5.3); the **scope-grant model** (teaching/supervisory/proxy) wired into resolver authz (J1.4, J1.6,
   J3.5, J4.5, J5.4); **fail-closed firewall test green (J5.6)**.
2. **Slice 1 — content import + view + PDF:** J1 end to end (the import validator already exists).
3. **Slice 2 — question bank + assembly:** J2 + J3 (provisional question payload; revisit on Project 04).
4. **Slice 3 — trackers:** J4.
Each slice ships with its journey's acceptance criteria as tests, per `/skills/feature-lifecycle`.

## 6. Out of scope (this slice)
All guardian *portal screens*, analytics (R-AN1–4), AI/LLM export, WhatsApp/SMS automation, and the
deferred ops modules — `docs/roadmap.md`.

## 7. Dependencies / open items
- **Project-03 plan schema** (`*PlanSchema*.json`) — vendored at `server/import/LOCKED_C5_PlanSchema_v1.json`;
  the import gate's L2 now runs and the worked example passes end-to-end. Upstream-owned (Project-03);
  refresh the vendored copy when Project-03 re-locks the plan layouts. J1.1 is now fully verifiable.
- **Project-04 question payload** — RESOLVED (D-#19): ratified + LOCKED; closed payload schema in
  `server/import/`, `paper_role` + `stimulus` added, gate green. Remaining follow-ons: wire the
  authoritative REF-19 registry; upgrade `topic_tag` to registry validation.
- **Scope-grant data shape** — Slice 0 models teaching/supervisory/proxy grants in `/server` foundation.
  Decided (D-#20): a **proxy** grant stores `{covering_teacher, covered_class/section, absent_teacher?,
  start_date, duration_days, status}` with `end = start + duration_days`; resolver authz treats it as
  active only within the window; auto-expiry is window-based (no cron required — checked at request
  time), with optional early-revoke/extend. Supervisory grants store their extent (whole-school /
  grade-class / subject-dept / explicit set); teaching grants are the class→section assignments.
