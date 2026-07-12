# Testing guide — 2026-07-10 release candidate

**Round 3.** Updated after your second pass. Everything is now merged on `dev` and
deployed to the dev site. Nothing is in production yet (`main` is still at PR #182).

**Test on the dev site.** Run §0.1 (the migration) first — it is now due.

## What round 1 settled

**Passed — do not retest:** 1 (class ordering) · 2c (cover hands over marking) ·
2d (non-school days) · 2e (Office unmarked view) · 3a (teacher red card) ·
5b (send an assembled set).

**Fixed in PR #188 — retest these (Part A):** 3b · 4 · 5a · 5c.

**Still open — needs one command from you (Part 0.3):** 2 (Nursery/KG marker).

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

### 0.3 🔴 Run this first — it decides bug 2

Round 1 found: *"in Nursery and KG only the assigned teacher can give attendance, not the
first-period teacher."*

Marker resolution is **override → routine → class-teacher**. Before D-#278, *an admin
assigning a marker was the normal path* — and **an override always wins**. Those legacy
rows are almost certainly defeating the new rule.

```bash
npx tsx server/scripts/diag-attendance-markers.ts     # READ-ONLY, writes nothing
```

Read the `=> MARKER:` line for each Nursery/KG section:

| Output | Meaning | Do this |
|---|---|---|
| `=> MARKER: OVERRIDE -> <name>` | **Confirmed.** Legacy rows are winning. | run the revoke below, then retest **A1** |
| `=> MARKER: ROUTINE -> <name>` | The routine already wins — bug 2 is something else | **send me the output**; do not run the revoke |
| `=> MARKER: CLASSTCHR -> …` and `routine P1 teacher: (none)` | N/KG has no routine slot with a teacher | **send me the output** — the fix is a different one |

If and only if it says **OVERRIDE**:

```bash
npx tsx server/scripts/revoke-legacy-attendance-markers.ts            # dry-run
npx tsx server/scripts/revoke-legacy-attendance-markers.ts --commit
```

It **deactivates, never deletes** (history preserved, ADR-008). Marking then falls to the
routine's first-class teacher. Assignments you make *from now on* are untouched — the
override remains a deliberate escape hatch.

---

## Part A — the round-1 fixes (PR #188)

### A1 · Nursery/KG: the first-period teacher marks *(after §0.3)*

1. Find who teaches **KG period 1** today (Routine → Master grid).
2. Log in as that teacher → **Attendance**.

✅ The KG section is in their worklist; they can mark it.
✅ KG's **class teacher** does **not** see it in their worklist (they are the *fallback*),
but **can** still open Attendance → Report for the section.

> If this still fails after the revoke, §0.3 mis-diagnosed it — send me the diag output.

### A2 · The assignment countdown appears *(was: silent)*

**Root cause:** `AcademicYear.current` **defaults to `false`**. With no year flagged, the
countdown *and* the overdue alert went silent. It now falls back to the year whose date
range **covers today**.

1. Log in as a teacher with an **undelivered** scheduled item this week → **Today**.

✅ An **amber** row: `⏳ Prepare assignment question · 3d 4h left`, with `due: <date>`.
✅ It **ticks** — leave it a minute; the time updates with no reload.
✅ **Before 07:00 on delivery day** it is *still counting down*, **not** overdue.
✅ At/after 07:00 still undelivered → it turns into the **red** "Assignment entry pending".
✅ **Deliver the item** → the amber row disappears at once.

> Still silent? Then you have no `AssignmentSchedule` at all (§0.2) — that is a separate,
> deliberate silence, not this bug.

### A3 · Unmarked list names the Quran group *(was: only the class)*

**Office → Attendance → Report → Unmarked sections**, on a FULL day before marking.

✅ A Class 1–5 row now lists its **🕌 Quran groups by name** (e.g. `হিফজ ৩`), each with
its own marker — so you can see **which Quran teacher to chase**.
✅ Nursery/KG rows name the section and its first-period teacher.
✅ A section is complete only when **every** unit holding its students is marked.

### A4 · The Office can open a question set *(was: 403, nothing happened)*

**Root cause:** `OFFICE` holds `roster:manage` but **not** `set:read`, so `/pdf/set/:id`
refused every question-set job. Rather than opening the whole assessment plane to the
Office, the route now admits `roster:manage` **only for a set a live PrintRequest
references**.

1. Teacher: **Sets → an assembled set → 🖨️ Send to print**.
2. **Office → Print → Yet to print → Open**.

✅ The question-set **PDF opens** (Bangla renders).
✅ **Cancel** that job → the Office can **no longer** open that set. Access is withdrawn
with the job — the assessment plane stays shut.

### A5 · "Mark printed" moves the job without a refresh *(was: needed F5)*

**Office → Print.**

✅ **Mark printed** → the job **immediately** appears under **Printing done** (no manual
refresh).
✅ **Mark delivered** → it moves to **Delivered** the same way.

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

**Part 0**
- [ ] §0.3 diagnostic run; output understood (revoke run **only** if it said `OVERRIDE`)
- [ ] §0.1 migration `--commit` run — **required before Part B**

**Part A — the fixes**
- [ ] A1 · N/KG first-period teacher can mark
- [ ] A2 · countdown appears, ticks, and flips to red at 07:00
- [ ] A3 · unmarked list names the 🕌 Quran groups
- [ ] A4 · Office opens a queued set; **cancel → access withdrawn**
- [ ] A5 · Mark printed moves the job with **no manual refresh**
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
- [ ] D5 · a blank required field **toasts**

---

## If something looks wrong

1. **Check who you're logged in as.** Both "bugs" in round 1's first report were two
   *different* teachers.
2. **Check §0.2.** A missing Quran membership or `AssignmentSchedule` makes a feature
   silently inert — by design, not by fault.
3. **Hard-refresh.** The web app persists navigation state; a stale bundle misleads.
4. Report the **account + date + screen**, and the **network response** for the query
   involved. That triple is almost always enough.
