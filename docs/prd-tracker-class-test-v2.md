# PRD — Class Test Tracker v2 (CT-6..CT-10)

Build contract for the second wave of the Class Test module, from live testing +
owner rulings (2026-07-08). Extends `prd-tracker-class-test.md` (CT-1..CT-5, shipped).
All of this is **identity-plane** staff analytics (marks tied to a named student) —
it never touches the corpus/analytics plane (ADR-005). No corpus joins.

## Baseline recap
- `ClassTestResult`: `status`, `marks`, `weakness`, `teacherAction`, `guardianAction`,
  `publishedAt`, `publishedVersion`, `enteredBy`. Guardian visibility = `publishedAt != null`.
- Perms: `tracker:write` (teacher), `roster:manage` (Office/Principal), `tracker:read`
  (staff read), `guardian:read_child`.
- Already landed this cycle (pre-v2, same branch): result-entry errors inline+toast;
  WhatsApp SEND gated to `roster:manage`; **published results are edit-locked** (must
  unpublish to edit); `Class×subject analysis` label mojibake fixed.

## Ratified decisions (owner, 2026-07-08)
- **D-A (approval gate):** approve **per-exam**; "send back" carries a **reason**;
  **either** Office OR Principal may approve (`roster:manage`).
- **D-B:** read-only "view all" for staff — yes.
- **D-C:** cumulative per-student comments by subject — yes.
- **D-D:** charts are **hand-rolled** (`react-native-svg`), no chart dependency.
- **D-E:** ship **all** the analytics metrics in CT-10.

---

## CT-6 — Read-only results view (Slice 1)
**Goal:** teacher/admin/principal see every student's marks + weakness + teacher action
+ guardian action for an exam WITHOUT the edit form or the publish screen.

- **Server:** none — `classTestResults` already returns all fields.
- **App:** new read-only `ClassTestResultsView` screen: per-student card — name/id,
  marks/total · %/pass (or Absent), weakness, teacher action (staff-only), guardian
  action, and release state (Published / Not published). "Not entered" for missing rows.
  Reachable from ClassTestHome PRINTED rows ("View results") + from Reports.
- **Roles:** `tracker:read` (teacher scoped via `assertCanRead`; admin unscoped).
- **Acceptance:** shows all fields read-only; no edit/publish controls; `teacherAction`
  never rendered for a guardian (guardians don't have this tab anyway).

## CT-7 — Cumulative per-student comments by subject
**Goal:** a teacher reads a student's class-test comment history per subject in one place.

- **Server:** add `weakness`, `teacherAction`, `guardianAction` to the
  `ClassTestProfileResult` GraphQL type + `classTestStudentProfile` service builder.
- **App:** on Student profile, under each subject, a **comment timeline** (per test:
  weakness + teacher/guardian action, newest first) + an optional **recurring-weakness
  roll-up** (tally repeated weakness text per subject).
- **Roles:** `tracker:read`, scoped.
- **Acceptance:** each subject shows its exams' comments chronologically; teacherAction
  present for staff; empty subjects omitted.

## CT-8 — Approval gate (teacher submit → Office/Principal approve → guardian sees)
**Goal:** guardian visibility requires an admin release, not just the teacher.

- **Model (`ClassTestResult`):** add `submittedAt`/`submittedBy` (teacher proposes) and
  `approvedBy` (admin releases). Lifecycle `DRAFT → SUBMITTED → RELEASED`; guardian
  predicate stays `publishedAt != null` (set on approve). Add `sendBackReason` +
  `sendBackAt`/`sendBackBy` for the reject path.
- **Server:** rename teacher action to **submit** (`submitClassTestExam` — per-exam,
  sets `submittedAt` on all entered rows, no delivery). New admin
  `approveClassTestExam` (`roster:manage`) → sets `publishedAt`/`approvedBy`, fires the
  wa.me links + notifications (absorbs the WhatsApp-gating: approver = sender).
  `sendBackClassTestExam(reason)` (`roster:manage`) → clears `submittedAt`, stamps
  reason, returns to DRAFT (teacher edits + resubmits). Edit-lock extends to SUBMITTED
  (editing recalls to DRAFT). Any post-release edit re-enters submit→approve.
- **App:** teacher screen "Submit for release"; new **Release approvals** screen
  (`roster:manage`): SUBMITTED exams → Approve / Send back (reason). Guardian card
  unchanged (still reads released only).
- **Decision recorded:** per-exam approve; reason on send-back; either admin (D-A).
- **Acceptance:** teacher submit does NOT reach the guardian; only admin approve does;
  send-back with reason returns to DRAFT; re-submit → re-approve required.

## CT-9 — Progress charts (hand-rolled SVG)
**Goal:** visualize a student's mark trajectory.

- **Lib:** `react-native-svg` only (D-D) — a small in-repo `<LineChart>`/`<BarChart>`.
- **Charts:** per-subject % vs test# line (progress/decline; at-risk band below pass);
  small-multiples across subjects on the profile; latest-marks bar with a class-average
  benchmark line.
- **Server:** add a per-test **class/subject average** aggregate for the benchmark.
- **Roles:** `tracker:read`, scoped. Load the **dataviz** skill for palette/axes at build.
- **Acceptance:** renders on web + native from `classTestStudentProfile`; empty/one-point
  series degrade gracefully.

## CT-10 — Student analytics metrics (all)
**Goal:** meaningful per-student analysis. All identity-plane staff reads.

- **Metrics:** rank/percentile within section per test; improvement rate (regression
  slope) + consistency (std dev) → a "trajectory" badge; recurring-weakness tags;
  pass/fail streaks; intervention-effect (teacher action taken vs next-test delta);
  at-risk flag (declining slope AND below pass) → surfaces on the dashboard;
  cross-tracker whole-picture (class-test % vs homework completion vs assignment vs
  attendance — staff, identity-plane, NO corpus); a simple guardian-facing
  improving/steady/declining summary line.
- **Server:** derive on read (D-#85 style — never stored); the section distribution
  read powers rank/percentile; cross-tracker pulls from existing tracker reads.
- **Acceptance:** each metric derived, not stored; at-risk appears on the dashboard;
  cross-tracker never joins the corpus plane (firewall test stays green).

---

## CT-11 — Duplicate guard on class-test creation (D-#429)

**The problem this fixes — found in live data, not theorised.** Nothing stopped the same
test being filed twice. `ctId` is the collection's ONLY unique key and it is minted per
row, so it is always distinct; `suggestTestNumber` merely *suggests* and the number stays
editable. Prod had two duplicate pairs on 2026-08-02:

| | created apart | outcome |
|---|---|---|
| `CT-C5-BAN-0001` / `-0002` (Class 5 BAN, 29 Jul, Mahfuj) | 42 s | same PDF re-uploaded, marks total 10 vs 20; **8 copies of the wrong one printed and delivered** |
| `CT-C2-BAN-0002` / `-0003` (Class 2 BAN, 14 Jul, Kawsar) | 5 min | identical paper AND marks; the teacher then **entered results into BOTH**, nine days apart, and they **disagree on one child** (Ahsanat Chowdhury: `PRESENT 23` vs `ABSENT`), both published to guardians |

Both are a teacher re-submitting instead of editing the first attempt. The second case
shows the real cost: not clutter, but a child carrying two contradictory published results
for one test.

**The guard.** `createRequest` refuses when a non-CANCELLED `ClassTest` already exists for
the same **(sectionId × subject × testNumber)**, with an error naming the existing `ctId`,
its exam date and status so the teacher knows what to edit instead.

**Why that key.** `examDate` is deliberately **excluded**: the same Test # twice for one
section+subject is a mistake whatever the dates, and keying on the date would have let a
re-entry a day later through — it only caught the two live cases because both happened to
be same-day. `sectionId` rather than `classLevel` (which is what `suggestTestNumber`
scopes by) so two sections of one class can legitimately sit the same numbered test.
CANCELLED is excluded, matching `suggestTestNumber`, so a withdrawn request never blocks
its own replacement.

**DEFERRED — the unique index.** A partial unique index on the same key is the race-proof
backstop (the guard is a check-then-write, so two clicks in the same millisecond still
slip through). It **cannot be created yet**: `CT-C2-BAN-0002`/`-0003` are both live and
would make the build fail. Add it once that pair is resolved with Kawsar — the guard
blocks all new duplicates in the meantime.

**Acceptance:**
- [ ] A second live test with the same section + subject + test number is refused; nothing is written and no print-queue row is created.
- [ ] The refusal names the existing `ctId`, its exam date and status.
- [ ] The query keys on section + subject + testNumber, excludes CANCELLED, and does NOT include examDate.
- [ ] A withdrawn (CANCELLED) request does not block its replacement.
- [ ] A different test number for the same class + subject is allowed.

---

## CT-12 — A class test may be anchored on a SUBJECT GROUP, not only a section (D-#507)

**The problem this fixes — measured in the live data, not theorised.** The owner asked
whether an Arabic class test can be recorded the way classes 1–5 record theirs. Arabic is
taught **both** ways at this school:

| shape | active ARABIC slots | units |
|---|---|---|
| section (the whole section together) | 12 | 4 sections |
| **subject group** (cross-class, D-#48/#56) | **25** | **5 Arabic groups** |

and each group mixes students from **several classes**:
`ARABIC_BOOK_1_MIXED` 16 members / 3 classes · `ARABIC_BOOK_2_GIRLS` 11 / 4 ·
`ARABIC_BOOK_2_BOYS` 10 / 3 · `ARABIC_BOOK_3_MIXED` 13 / 3 ·
`ARABIC_QURANIC_ARABIC_MIXED` 8 / 2.

`ClassTest` required a `sectionId`, derived `classLevel`/`classId` from it, and counted
`Student.countDocuments({sectionId, active:true})` as the completion denominator. So a
group exam could only be filed by pretending it belonged to one section — and then the
marks screen listed that section's children who **do not attend** the group, offered no
way to reach the members from the **other** classes, and the "how many still pending"
count was meaningless. The live evidence that this never worked: **zero** ARABIC class
tests exist.

**The anchor.** EXACTLY ONE of `sectionId` or `subjectGroupId`, the shape
`ClassroomObservation` already uses for the same reason (D-#48/#56). On a group anchor
`classId`/`classLevel` are **null** — a group has no single class level — and the year comes
from the CURRENT `AcademicYear` instead of the section's class.

**What follows from the anchor, and why each is a decision:**
- **Roster = the group's ACTIVE membership** (`classTestAnchor.rosterStudentIds`). This is
  the whole feature; a section roster is wrong in both directions at once.
- **Id scheme `CT-G-{GROUP_CODE}-{nnnn}`**, counted in a NEW `ClassTestGroupSequence`
  collection keyed by (year, group). Not a nullable `classLevel` on the existing sequence:
  its unique index is (year, classLevel, subject), so every group's ARABIC counter would
  collide on (year, null, ARABIC) — and fixing that means dropping a unique index on a live
  collection, a migration this feature does not need.
- **Authz is the routine, not a section grant.** Teacher scopes ARE grants over sections,
  so "do you write section X?" is not a stricter or looser question for a cross-class group
  — it is a meaningless one. A group exam is writable by the teacher the routine names on
  that group (`teachesSubjectGroup`), with PRINCIPAL passing and OFFICE/GUARDIAN refused,
  mirroring `assertCanWrite`'s own role behaviour exactly. Same source as the accountable-
  teacher default, so the two can never disagree about whose group it is.
- **A per-student membership guard on `enterResult`** for group exams only: the group write
  scope is not per-student, so without it a group teacher could score any child in the
  school. Section exams keep their existing behaviour (a mid-year section move must not
  invalidate marks already entered).
- **Only ARABIC groups.** A Quran group is refused: Quran is out of the HW_SUBJECTS axis
  entirely (D-#36), so a Quran group could only ever be examined in a subject it does not
  teach.
- **Copies-per-present is refused on a group** (D-#303 counts one CLASS present on the exam
  day; a cross-class group has no such class), and the CT-11 duplicate guard keys on the
  ANCHOR — a group's Test # 1 and a section's Test # 1 are different exams.
- **The marks roster is a server read** (`classTestRoster`), not `studentsInSection`, and on
  a group exam each row carries the child's `class · section` — eleven children from four
  classes need telling apart.
- **The guardian sees the GROUP's name.** `classLevel` on the guardian result is now
  nullable (an `exposeInt` over null fails the whole field at request time, taking the
  parent's list down) and `groupNameBn` rides beside it, so a parent reads "আরবি বই ২ (মেয়ে)"
  rather than a class the exam was not held for.

**Deliberately NOT in this slice:** the section-keyed CT-4 dashboards keep working and stay
section-keyed — a group exam's roster is counted correctly in `reportsStatus` (a second
batched aggregate, so D-#500's fixed-query-count property survives) and its overdue chase
line names the group, but the class/section FILTERS do not offer groups yet. Nothing else
changes shape: no vocab, no new permission, no migration (`subjectGroupId` defaults null,
so every existing row reads as section-anchored).

**Acceptance:**
- [ ] A group-anchored request stores `subjectGroupId` with `sectionId`/`classId`/`classLevel` null, mints `CT-G-{CODE}-0001`, and takes the current academic year.
- [ ] Both anchors, or neither, are refused; a Quran-track group and a retired group are refused.
- [ ] The exam is attributed to the teacher the GROUP's routine names on the exam day, else the requester.
- [ ] The roster and the completion denominator are the group's active members; an inactive member is excluded; a section exam still counts its section.
- [ ] `enterResult` refuses a student who is not a member of the exam's group.
- [ ] Copies-per-present is refused on a group anchor; the duplicate guard keys on the group.
- [ ] PRINCIPAL may write a group exam; OFFICE may not; the group's routine teacher may; another teacher may not.
- [ ] The marks screen lists the group's members with each child's class·section; the guardian card names the group.
- [ ] Server + app tsc clean, full jest green, expo web export exit 0.

---

## Build status (2026-07-09, D-#277)
All slices BUILT in one pass (server+app tsc clean, jest 1629/1629, expo web export green):
- ✅ **CT-6** read-only view · ✅ **CT-7** cumulative comments · ✅ **CT-8** approval gate
  (submit/recall/approve/send-back; gates moved to `roster:manage`; edit-lock → submitted) ·
  ✅ **CT-9** dependency-free View bar charts · ✅ **CT-10** analytics (slope/consistency/
  at-risk/streaks/best-weak/recurring-weakness/latest-rank).
- ⏭ **Deferred within CT-10 (flagged, not half-built):** cross-tracker whole-picture
  (class-test × homework × assignment × attendance) and the guardian-facing trajectory
  summary — larger, cross-module; own follow-up.

Uncommitted on the working tree → one feature branch → PR into `dev`, then live-verify.
