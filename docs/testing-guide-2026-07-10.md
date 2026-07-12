# Testing guide — 2026-07-10 release candidate

Everything below is **on `dev` or in an open PR. None of it is in production.**
Production (`main`) is still at PR #182.

| # | Feature | Decision | Where it is |
|---|---|---|---|
| 1 | Class pickers ordered Nursery → KG → One… | — | merged on `dev` |
| 2 | Attendance marked by the **first-class teacher** | D-#278 | merged on `dev` |
| 3 | Today **red backlog board** + admin class presence | D-#279 | merged on `dev` |
| 4 | **Assignment-prep countdown** | D-#280 | merged on `dev` |
| 5 | **Print queue** PQ-1…PQ-4 | D-#281 | merged on `dev` |
| 6 | Marker-determinism + empty-unit bug fixes | D-#278 | merged on `dev` |
| 7 | Print queue **PQ-5** (class-test absorption, delivered notify, migration) | D-#281 | **PR #186** |
| 8 | Guardian attachments · cross-tracker profile · plan→PDF | D-#282 | **PR #187** |

> Items **7 and 8 are not on `dev` yet.** To test them you must either merge those PRs
> into `dev`, or check the branch out locally (`feat/print-queue-absorb`,
> `feat/cross-tracker-profile`) and run the app against your local server.

---

## 0. Before you start — read this first

### 0.1 ⚠️ The migration (only needed for PR #186)

A `ClassTest` has **always been** a print request. PQ-5 moves printing onto the unified
queue. **Without the back-fill, every class test created before PQ-5 vanishes from the
Office's print queue.**

Run it against the environment's DB **before** a PQ-5 server serves traffic:

```bash
# 1. DRY-RUN first — writes nothing, prints what it would do
npx tsx server/scripts/migrate-classtest-print-requests.ts

# 2. Then commit
npx tsx server/scripts/migrate-classtest-print-requests.ts --commit
```

It is **idempotent** (safe to re-run) and repairs a half-run. Status carries across 1:1
(`REQUESTED` / `PRINTED` / `CANCELLED`). Nothing is back-filled as `DELIVERED` — that
state never existed, so a printed-but-uncollected job correctly lands in **"Printing
done"**.

**Expected dry-run output:** `Create: <N>  Repair-link: 0  Already migrated: 0  Problems: 0`
where `N` = your current ClassTest count. If **Problems > 0**, read the WARN lines — a
class test with a missing `setId`/`questionFileId` is skipped, not silently mangled.

### 0.2 Data prerequisites — two features do nothing without these

Check these **first**, or you will chase phantom bugs.

| Needed for | Check | If missing |
|---|---|---|
| **Class 1–5 attendance** (feature 2) | `db.subjectgroupmemberships.countDocuments({track:"quran"})` > 0 | Class 1–5 students fall back to their **section**, marked by the class teacher. That is the *designed fallback*, not a bug — but you won't be testing the Quran-group path. |
| **Assignment countdown + alert** (features 3, 4) | `db.academicyears.findOne({current:true})` **and** `db.assignmentschedules.findOne()` exist | Both stay **silent** by design (never error). You'll see no countdown and no assignment alert. |

### 0.3 Accounts you need

Log in as each of these at least once. Note **who** you're logged in as before judging a
result — several "bugs" reported during development turned out to be different teachers.

| Role | Why |
|---|---|
| **Teacher who opens a Quran group's period 1** (Class 1–5) | the new attendance marker |
| **Teacher who opens a Nursery/KG section's period 1** | the other new marker |
| **Class teacher of a Class 1–5 section** | must *not* be nagged (regression check) |
| **Office** | print queue, class presence, unmarked sections, amend |
| **Principal** | same as Office, plus `content:read` |
| **Guardian** with a linked child | class-note attachments, trajectory |

---

## Part A — merged on `dev`

### 1. Class pickers are ordered (2 min)

1. Log in as **Principal/Office**.
2. **Assignments → Assignment schedule → Add entry → Class** dropdown.

✅ **Expect:** `নার্সারি, কেজি, প্রথম শ্রেণি, দ্বিতীয়, তৃতীয়, চতুর্থ, পঞ্চম`
❌ **Was:** insertion order (`পঞ্চম, দ্বিতীয়, তৃতীয়, চতুর্থ, কেজি, নার্সারি`)

The fix is at the source (`classes` resolver), so **every** class picker in the app should
now be ordered. Spot-check one other (e.g. Assignment rollups).

---

### 2. Attendance is marked by the first-class teacher (D-#278)

The big one. Attendance is now captured where the students physically are at day-start.

| Level | Captured in | Marked by |
|---|---|---|
| **Class 1–5** | their cross-section **Quran group** | teacher of the group's **first Quran period** |
| **Nursery/KG** | their **section** | teacher of the section's **first period** |

Resolution order: **admin override → routine (cover-aware) → class-teacher fallback.**

#### 2a. Nursery/KG — the first-period teacher marks (no data prereq)

1. Look up who teaches **KG's period 1** today (Routine → Master grid).
2. Log in as that teacher → **Attendance** tab.

✅ The KG section appears in their worklist.
✅ Tap it → the roster renders under a **class/section heading**.
✅ Mark an absentee → submit → toast confirms.

3. Log in as KG's **class teacher** (if a different person).

✅ They do **not** see KG in their worklist (they're the fallback, not the marker).
✅ They **can** still open **Attendance → Report** for their section.

#### 2b. Class 1–5 — the Quran teacher marks (needs §0.2 memberships)

1. Log in as a teacher who opens a **Quran group's period 1**.

✅ Their worklist lists **the Quran group by name** (e.g. `হিফজ ৩`), not a section.
✅ Tap it → the roster is **grouped under class/section headings** — a Quran group mixes
sections, and the school reads attendance class-wise.

2. Mark one student absent → submit.
3. Log in as **Office → Attendance → Report** for today.

✅ That student appears under **their own class → section** (e.g. "Class 3 · ALL").
✅ **Nowhere** does the word "group" or the Quran group's name appear in the report.

> This roll-up is the whole design: capture is per Quran group, **display is always
> class/section.**

#### 2c. A cover hands over the marking duty

1. **Routine → Cover management** → find the Quran group's (or KG's) **period 1**.
2. Assign a cover teacher.
3. Log in as the **cover teacher** → **Attendance**.

✅ The unit now appears in the **cover teacher's** worklist.
✅ It has **disappeared** from the substantive teacher's worklist.

#### 2d. Non-school days

1. Set the date picker to a **Friday** (OFF) or a **holiday**.

✅ The worklist is **empty**. (Attendance isn't expected; the write path would reject it.)

#### 2e. Office view — unmarked sections

**Attendance → Report → Unmarked sections**, on a FULL day before marking.

✅ A **Class 1–5 section stays "unmarked" until *every* Quran group holding its students
is marked.** The row names the responsible marker(s).
✅ Nursery/KG rows name their first-period teacher.

---

### 3. Today = a red backlog board (D-#279)

#### 3a. Teacher — red "Pending" card

Log in as a teacher who owes work. The card sits **directly under the date**.

✅ Rows appear only when something is pending; the card is absent when nothing is.
✅ Each row is **tappable** and lands on the screen that clears it.

| Row | Fires when | Count means |
|---|---|---|
| Attendance not submitted | a marking unit of theirs has no record on a FULL day | pending **days** |
| Class notes not written | a routine period has no class note | pending **days** |
| Assignment entry pending | a scheduled item is past its delivery **deadline**, undelivered | pending **items** |

✅ When the backlog reaches past today, the row shows `oldest: YYYY-MM-DD`.
✅ The look-back is **7 days**, school days only (Fri and holidays skipped).

**Falsify it:** mark today's attendance → the attendance row disappears on refresh.

#### 3b. Principal/Office — class presence + unmarked

Log in as **Office → Today**.

✅ Below the date: **"Today's attendance by class"** — `Present: N · Absent: M / Total`.
✅ A class shows an **"Incomplete"** badge while *any* of its units hasn't reported.

> **Critical:** an unmarked Quran group must read **pending**, never silently "present".
> Verify by marking only *one* of a class's Quran groups and confirming the class is
> still `Incomplete`, and that `Present` counts only the marked students.

✅ Below that: the **unmarked-sections** list with each responsible marker.

---

### 4. Assignment-prep countdown (D-#280) — needs §0.2 schedule

An **amber** row inside the same Pending card, **above** the red rows (it hasn't slipped
yet).

1. Log in as a teacher with an **undelivered** scheduled assignment item this week.

✅ `⏳ Prepare assignment question · 3d 4h left`, with `due: <delivery date>` beneath.
✅ It **ticks** — leave the screen open a minute; the remaining time updates without a
reload.

2. **The deadline is the school day's START on the delivery date** (07:00, read from
   `ScheduleWindow.dayStartMinutes` — not hard-coded).

✅ On **delivery-day morning before 07:00** it is *still counting down*, **not** overdue.
✅ At/after 07:00, still undelivered → it becomes the **red** "Assignment entry pending".
✅ **Deliver the item** → the amber row disappears immediately.

3. **Holiday roll:** if the delivery date lands on a holiday, the schedule rolls delivery
   to the day before — the countdown must follow it, not stay on the original Thursday.

---

### 5. Print queue PQ-1…PQ-4 (D-#281)

A new **🖨️ Print** drawer tab. Role-aware inside.

#### 5a. Teacher files a request

**Print → ➕ New request.**

| Source | Steps | Expect |
|---|---|---|
| **Upload** | Add up to **5** files (jpeg/png/pdf, ≤10 MB each) | a 6th file is refused; an over-size file shows the Bangla error |
| **Link** | paste `https://forms.gle/…` | a relative path or `javascript:` URL is **rejected** |

✅ Fill title, purpose, copies, needed-by → **Send to print** → toast, and it appears
under **My requests** as **"Yet to print"**.

#### 5b. Send an assembled set to print

1. **Sets → open an ASSEMBLED set → 🖨️ Send to print.**

✅ The form opens with the set **pre-selected and the source picker locked**.
✅ A **DRAFT** set has no such button (and the server refuses a draft anyway).

#### 5c. Office works the queue

**Office → Print.** Three tabs: **Yet to print → Printing done → Delivered.**

✅ Each row shows requester, purpose, copies, needed-by.
✅ **Open** does the right thing per source: a set renders a PDF; an upload streams; a
link opens externally.
✅ **Mark printed** moves it to *Printing done*; **Mark delivered** moves it to
*Delivered*.
✅ **Cancel** exists only while **Yet to print**. A *printed* job **cannot** be
cancelled — the paper already exists.

#### 5d. Ownership

✅ A teacher may cancel **their own** job while REQUESTED, never someone else's.
✅ A teacher's **My requests** shows only their own.

---

### 6. Regression checks — bugs fixed this cycle

These are the exact defects found during development. Confirm they're gone.

#### 6a. The "flaky" attendance alert (marker determinism)

`routineForDate` sorted only by period number, so two live slots on one period let Mongo
pick the marker **arbitrarily** — the alert appeared and vanished between refreshes.

1. Log in as **one** teacher (write the username down).
2. **Hard-refresh Today 5 times.**

✅ The Pending card is **identical** every time.

> Your earlier report of flakiness was two *different* teachers (Period-5 Bangla vs Quran
> P1–P2). Confirm you're on a single login before judging.

#### 6b. Class 1–5 class teachers are no longer nagged forever

A Class 1–5 **section** unit holds only students *without* a Quran group. When there are
none, its roster is empty, nobody can ever mark it, and its class teacher used to get an
**unclearable** red alert.

1. Log in as a **Class 1–5 class teacher** whose students all have Quran groups.

✅ **No** "Attendance not submitted" alert.
✅ Their Attendance worklist does **not** show a 0-student section row.

#### 6c. A Nursery/KG child in a Quran group

`rosterForUnit` used to return *every* group member. A N/KG child placed in a Quran group
would appear on that teacher's roster and be markable — but the roll-up reads them via
their **section**, so the absence was **silently dropped**.

✅ If any N/KG child sits in a Quran group, they must **not** appear on that Quran
teacher's marking roster.

---

## Part B — PR #186 (PQ-5) · **run §0.1 migration first**

### 7a. Nothing is lost

After the migration, log in as **Office → Print → Yet to print**.

✅ **Every pre-existing `REQUESTED` class test appears as a queue row** (title
`CT-… · SUBJECT`, purpose `CLASS_TEST`).
✅ Previously-PRINTED class tests sit under **Printing done**, not Delivered.

### 7b. The class-test print queue is gone

**Class Test → home.**

✅ There is **no** separate class-test print queue screen.
✅ The print button now **crosses to the 🖨️ Print tab**.

### 7c. Filing a class test files a queue row

1. Teacher: **Class Test → Request class test** (pool set or uploaded paper).
2. Office: **Print → Yet to print.**

✅ The job is there, purpose `CLASS_TEST`.
✅ **Open** renders the paper (set PDF, or the uploaded file).

### 7d. Advancing the queue advances the class test

1. Office: **Mark printed** on that row.
2. Teacher: **Class Test → home.**

✅ The class test's own status is now **PRINTED** (it is the official exam — results can
be entered).
✅ Cancelling the row instead → the class test reads **CANCELLED**.

### 7e. Delivery notifies the teacher

1. Office: **Mark delivered**.
2. Log in as the **requesting teacher** → notification bell.

✅ A **"Your print is ready"** notification.
✅ If push/notifications are down, the delivery **still succeeds** (best-effort by design).

---

## Part C — PR #187 (three deferred features, D-#282)

### 8a. Guardians can open class-note attachments

1. **Teacher** posts a class note with an attachment (Routine → Daily note).
2. **Guardian** of a child in that section/group → **Class notes**.

✅ A `📎 filename` row appears under the note; tapping opens it (web).

**Now the security checks — these matter more than the happy path:**

✅ A guardian whose child is **not** in that section/group **cannot** open the file
(even with the direct `/files/<id>` URL).
✅ **Revoke** the `GuardianLink` → access is withdrawn immediately.
✅ An **orphan** upload (a file uploaded but never attached to a note) is unreadable by
any guardian.

### 8b. Cross-tracker whole picture (staff)

**Class Test → Reports → a student's profile.**

✅ A **"Whole picture"** card sits **above** the class-test detail, showing four rows:
class test · homework · assignment · attendance.
✅ Attendance shows a **recent-vs-earlier split** (`92% → 71%`) — this moves *before* the
term average does.
✅ The **Overall** badge is conservative: one weak signal ≠ "declining". It reads
declining only when the academic trajectory is down, **or** two behaviour signals fire.

**Falsify it:** find a student with (say) low homework completion but a steady trajectory
→ overall should read **Steady**, not Declining. Add a second weak signal (low attendance)
→ now it reads **Declining**.

### 8c. Guardian trajectory summary

**Guardian → Home.** A card at the top, above child info.

✅ Plain Bangla lines: overall direction, the child's own average, attendance %, and any
behaviour concern.
✅ **It must never show a rank or any class comparison.** Check the network response for
`childTrajectory` — there should be no `latestRank`, no class size, no peer data.
✅ A child with no data reads *"মূল্যায়নের জন্য যথেষ্ট তথ্য নেই"*, not `0%`.

### 8d. Plan → PDF from the print queue

1. **Teacher → Lesson Plans → open a plan → 🖨️ Send to print.**
2. **Office → Print → Yet to print → Open.**

✅ A real **paginated PDF** opens (Bangla renders correctly), not a "go look at the
viewer" toast.

**The gate check** — the Office holds `roster:manage` but **not** `content:read`:

✅ The Office **can** open a plan **that is queued**.
✅ The Office **cannot** open an arbitrary plan PDF (`/pdf/artifact/<some-other-id>` →
403). The content plane stays shut.
✅ **Cancel** the print job → the Office can no longer open that plan.

---

## Sign-off checklist

- [ ] §0.1 migration dry-run showed `Problems: 0`, then `--commit` run
- [ ] §0.2 data prerequisites confirmed (or their absence understood)
- [ ] 1 · class pickers ordered Nursery → Five
- [ ] 2 · N/KG first-period teacher marks; Quran teacher marks Class 1–5; report reads class/section
- [ ] 2c · a cover hands over the marking duty
- [ ] 3 · red backlog rows appear, deep-link, and clear when the work is done
- [ ] 3b · an unmarked Quran group reads **Incomplete**, never "present"
- [ ] 4 · countdown ticks; still counting at 06:59 on delivery day; red at 07:00; clears on delivery
- [ ] 5 · teacher files upload/link/set; Office advances through all three buckets
- [ ] 6a · same login, 5 hard refreshes, identical Pending card
- [ ] 6b · Class 1–5 class teacher has **no** unclearable alert
- [ ] 7a · **no pre-existing class test lost** from the queue after migration
- [ ] 7d · marking the queue row advances the linked class test
- [ ] 8a · a guardian of another child **cannot** open the attachment
- [ ] 8c · `childTrajectory` response contains **no rank**
- [ ] 8d · Office can open a **queued** plan, and **only** a queued plan

---

## If something looks wrong

1. **Check who you're logged in as.** Two "bugs" this cycle were two different teachers.
2. **Check §0.2.** A missing Quran membership or academic year makes features silently
   inert — by design, not by fault.
3. **Hard-refresh.** The web app persists navigation state; a stale bundle can mislead.
4. Note the **exact account, date, and screen**, and the **network response** for the
   query involved. That triple is usually enough to find it immediately.
