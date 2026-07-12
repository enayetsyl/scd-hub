# Testing guide — 2026-07-10 release candidate

**Round 3.** Updated after your second pass. Everything is now merged on `dev` and
deployed to the dev site. Nothing is in production yet (`main` is still at PR #182).

**Test on the dev site.** Run §0.1 (the migration) first — it is now due.

## What rounds 1 and 2 already settled

**Passed — do not retest.**

| From | Passed |
|---|---|
| Round 1 | 1 (class ordering) · 2c (cover hands over marking) · 2d (non-school days) · 2e (Office unmarked view) · 3a (teacher red card) · 5b (send an assembled set) |
| Round 2 | **A1** (Nursery/KG first-period teacher marks) · **A2** (assignment countdown) · **A3** (unmarked list names the Quran groups) · **A5** (mark-printed moves the job with no refresh) |
| Round 2 · §0.3 | **Bug 2 is closed.** You ran the diagnostic and it passed — the legacy overrides were not defeating the routine after all. **§0.3 is done; do not run it again.** |

**Still to confirm — that is what this round is for:**

- **Part A** — only **A4** and **A6** are left (never reported either way).
- **Part B** — the class-test absorption. **Never tested** (it wasn't on `dev`). **Run §0.1 first.**
- **Part C** — the three deferred features. **Never tested** (also wasn't on `dev`).
- **Part D** — the five fixes from your round-2 report. **New.**

**Dropped by decision:** the Quran option in Admin → Proxy grants. A `ScopeGrant` is
keyed `class + section + subject`, and a Quran group is cross-section with **no
classId** — that form structurally cannot name one. Cover management already hands over
the Quran *marking* duty (2c passed). What a group cover does **not** get is *content
access*; if that ever bites, that is the real fix.

## Where the code is

| PR | Contains | State |
|---|---|---|
| — | features 1–6 (attendance, Today board, countdown, print queue PQ-1…4) | merged on `dev` |
| **#188** | the round-1 + round-2 fixes | **merged on `dev`** |
| **#186** | print queue PQ-5 (class-test absorption, delivered notify, migration) | **merged on `dev`** |
| **#187** | guardian attachments · cross-tracker profile · plan→PDF | **merged on `dev`** |

> **Everything below is now on `dev` and deployed to the dev site** — no local
> checkout needed. Production (`main`) is still at PR #182; nothing here is live.

---

## Part 0 — before you start

### 0.1 ⚠️ The migration — **now due** (PQ-5 is on `dev`)

A `ClassTest` has **always been** a print request. Without the back-fill, **every class
test created before PQ-5 vanishes from the Office's queue.**

```bash
npx tsx server/scripts/migrate-classtest-print-requests.ts            # dry-run
npx tsx server/scripts/migrate-classtest-print-requests.ts --commit
```

Idempotent; repairs a half-run. Expect `Create: <N>  Repair-link: 0  Already migrated: 0
Problems: 0`. **Problems > 0** → read the WARN lines (a class test with a missing
`setId`/`questionFileId` is skipped, never mangled).

### 0.2 Data prerequisites

| Needed for | If missing |
|---|---|
| **Class 1–5 attendance** — Quran memberships (`subjectgroupmemberships`, `track:"quran"`) | 1–5 students fall back to their **section**, marked by the class teacher. *Designed fallback, not a bug* — but you won't be exercising the Quran path. |
| **Assignment countdown** — an `AssignmentSchedule` | Stays silent by design. **The academic-year half of this is now fixed** — see A2. |

### 0.3 ✅ Bug 2 — closed, nothing to run

Round 1 found *"in Nursery and KG only the assigned teacher can mark, not the first-period
teacher."* The theory was that legacy `SectionAttendanceAssignment` overrides were beating
the routine (marker resolution is **override → routine → class-teacher**, and an override
always wins). **You ran the diagnostic and it passed** — so that was not it, and **A1
passed** on the next round. Nothing here needs running.

The two scripts remain if this ever resurfaces:

```bash
npx tsx server/scripts/diag-attendance-markers.ts        # READ-ONLY, writes nothing
npx tsx server/scripts/revoke-legacy-attendance-markers.ts --commit   # only if diag says OVERRIDE
```

The revoke **deactivates, never deletes** (ADR-008). An admin-assigned marker stays a
deliberate escape hatch — the fallback order is by design, not a bug.

---

## Part A — what's left of the round-1 fixes

**A1 · A2 · A3 · A5 passed in round 2 — skip them.** Two remain.

### A4 · The Office can open a question set *(was: 403, nothing happened)*

**Root cause:** `OFFICE` holds `roster:manage` but **not** `set:read`, so `/pdf/set/:id`
refused every question-set job. Rather than opening the whole assessment plane to the
Office, the route now admits `roster:manage` **only for a set a live PrintRequest
references**.

1. Teacher: **Sets → an assembled set → 🖨️ Send to print**.
2. **Office → Print → Yet to print → Open**.

✅ The question-set **PDF opens** (Bangla renders).
✅ **Cancel** that job → the Office can **no longer** open that set. Access is withdrawn
with the job — the assessment plane stays shut. *This is the half that matters; a working
Open button with no withdrawal would be a permission leak.*

### A6 · The print request form *(new fields)*

**Print → ➕ New request.**

✅ **Title autofills** from your name (still editable).
✅ **Colour** (B&W / Colour) — **mandatory, nothing pre-selected**. Submitting without it
is refused.
✅ **Sides** (Single / Both) — same.
✅ **Copies** and **Needed by** — mandatory (marked `*`). **Notes** optional.
✅ **Upload**: the button shows a **spinner** while uploading; each attached file has a
**Remove** button; a 6th file is refused.

**Office → Print → Yet to print:**
✅ Each row **displays colour + sides** — the Office cannot start a job without them.

---

## Part B — the print queue absorbs class tests (PQ-5) · **run §0.1 first**

### B1 · Nothing is lost
**Office → Print → Yet to print.**
✅ Every pre-existing `REQUESTED` class test is there (`CT-… · SUBJECT`, purpose
`CLASS_TEST`).
✅ Previously-PRINTED class tests sit under **Printing done**, not Delivered.

### B2 · The class-test queue is gone
**Class Test → home.**
✅ No separate class-test print queue; its print button **crosses to the 🖨️ Print tab**.

### B3 · Filing a class test files a queue row
Teacher: **Class Test → Request class test** → Office: **Print → Yet to print**.
✅ It's there. **Open** renders the paper (set PDF or the uploaded file).

### B4 · Advancing the queue advances the class test
Office: **Mark printed** → Teacher: **Class Test → home**.
✅ The class test now reads **PRINTED** (it is the official exam — results can be entered).
✅ Cancelling the row instead → the class test reads **CANCELLED**.

### B5 · Delivery notifies the teacher
Office: **Mark delivered** → the requesting teacher's bell.
✅ *"আপনার প্রিন্ট প্রস্তুত"*.
✅ If notifications are down, the **delivery still succeeds** (best-effort by design).

---

## Part C — the three deferred features

### C1 · Guardians can open class-note attachments
Teacher posts a class note **with an attachment** → guardian of a child in that
section/group → **Class notes**.
✅ A `📎 filename` row appears; tapping opens it (web).

**The security checks matter more than the happy path:**
✅ A guardian whose child is **not** in that group **cannot** open it — try the direct
`/files/<id>` URL.
✅ **Revoke the GuardianLink** → access is withdrawn immediately.
✅ An **orphan** upload (uploaded, never attached to a note) is unreadable by any guardian.

### C2 · Cross-tracker whole picture (staff)
**Class Test → Reports → a student's profile.**
✅ A **"Whole picture"** card above the class-test detail: class test · homework ·
assignment · attendance.
✅ Attendance shows a **recent-vs-earlier split** (`92% → 71%`) — it moves *before* the
term average does.

**Falsify it:** a student with low homework but a steady trajectory → **Steady**, not
Declining. Add a second weak signal (low attendance) → **Declining**. One weak signal is
an off fortnight, not a decline.

### C3 · Guardian trajectory summary
**Guardian → Home**, card at the top.
✅ Plain Bangla: direction, the child's own average, attendance %, any behaviour concern.
✅ **It must never show a rank or class comparison.** Check the `childTrajectory` network
response — no `latestRank`, no class size.
✅ No data → *"মূল্যায়নের জন্য যথেষ্ট তথ্য নেই"*, not `0%`.

### C4 · Plan → PDF from the queue
Teacher: **Lesson Plans → a plan → 🖨️ Send to print** → Office: **Print → Open**.
✅ A real **paginated PDF** opens (Bangla renders).
✅ The Office **cannot** open an arbitrary plan (`/pdf/artifact/<other-id>` → 403).
✅ **Cancel** the job → the Office can no longer open that plan.

---

## Part D — the round-2 fixes

These came out of your second pass. All are on `dev`.

### D1 · Every attachment opens *(was: only the image, never the PDF)*

**Root cause:** the Office's **Open** button only ever opened `fileIds[0]`. With a PDF and
an image attached, whichever was second was **unreachable** — nothing was wrong with the
PDF itself.

Teacher: **Print → ➕ New request → attach a PDF *and* an image** → Office: **Print**.

✅ The row lists **one `📄 <name>` line per file, each with its own Open button**.
✅ **Both** open — the PDF *and* the image.

### D2 · Today's unmarked list matches the Attendance one

Round 2: *"Office login — Today and Attendance disagree about what's unmarked."*
Today was still listing **classes**; Attendance had already moved to **units**.

**Office/Principal → Today**, then **→ Attendance → Report**, same date.

✅ The two lists now **name the same things** — 🕌 Quran groups by name for Class 1–5,
section + first-period teacher for Nursery/KG.
✅ Nothing appears as unmarked on one screen and marked on the other.

### D3 · Send to print, from the plan page

**Lesson Plans → open a chapter/lesson plan.**

✅ A **🖨️ Send to print** button on the plan itself (you no longer have to start from the
Print tab and hunt for the plan).
✅ It lands in **Office → Print → Yet to print**, and **Open** renders the plan PDF.

### D4 · The set's print title carries the teacher name

**Sets → an assembled set → 🖨️ Send to print.**

✅ The queued row's title includes **your name** — the Office can tell whose paper it is
without opening it. (This already worked from the Print tab; the *Set screen* path was
the one missing it.)

### D5 · Validation errors are impossible to miss

**Print → ➕ New request → submit with a required field blank.**

✅ The error shows **inline at the top** *and* as a **toast**. Previously it only sat at
the top of a long form — off-screen, so submitting looked like it silently did nothing.

---

## Sign-off

This is the **last round before production.** Every box below is something no one has
confirmed yet.

**Part 0**
- [ ] §0.1 migration `--commit` run — **required before Part B**

**Part A — the two that are left**
- [ ] A4 · Office opens a queued set; **cancel → access withdrawn**
- [ ] A6 · colour/sides refuse to submit unselected; spinner + Remove work

**Part B — the class-test absorption**
- [ ] B1 · **no pre-existing class test lost**
- [ ] B4 · the queue row advances the linked class test

**Part C — the deferred features**
- [ ] C1 · a guardian of another child **cannot** open the attachment
- [ ] C3 · `childTrajectory` response contains **no rank**
- [ ] C4 · Office can open a **queued** plan, and **only** a queued plan

**Part D — the round-2 fixes**
- [ ] D1 · a PDF **and** an image both open (one button per file)
- [ ] D2 · Today and Attendance agree on what's unmarked
- [ ] D3 · 🖨️ Send to print works from the plan page
- [ ] D4 · the set's print title carries your name
- [ ] D5 · a blank required field **toasts**

**Then:** if this round is clean, the next step is the deliberate `dev → main` promotion
PR. `dev` is ~18 commits ahead of production — say the word and I'll raise it.

---

## If something looks wrong

1. **Check who you're logged in as.** Both "bugs" in round 1's first report were two
   *different* teachers.
2. **Check §0.2.** A missing Quran membership or `AssignmentSchedule` makes a feature
   silently inert — by design, not by fault.
3. **Hard-refresh.** The web app persists navigation state; a stale bundle misleads.
4. Report the **account + date + screen**, and the **network response** for the query
   involved. That triple is almost always enough.

> A pattern worth knowing, because it explains three of the bugs you found: **this codebase
> tends to go quiet rather than complain.** The countdown was silent because no
> `AcademicYear` was flagged current; the Office's Open button did nothing because it was
> 403'd; a submit looked like a no-op because the error was off-screen. If a feature does
> *nothing*, that is a finding — report it exactly as "I clicked X and nothing happened."
> That phrasing has been right every time.
