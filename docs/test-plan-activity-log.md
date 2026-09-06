# Test plan — কার্যক্রম / person activity (AL-1, D-#645)

Shipped to prod 2026-09-06 via PR #791 (→ `dev`) and PR #792 (→ `main`). Prod deploy
green (run 34038531633). `activityPeople` / `activityPerson` / `personActivity` /
`personActivityDays` / `activityGroups` confirmed in the schema by the CI gate.

Nothing below has been executed. **This is the unexecuted half of the gate** — the
automated gate (241 suites / 4371 tests) proved the fold is correct against mocks; only
these steps prove it describes a real teacher's real day.

> **Web only, for now.** This is a new screen, so a phone running the installed APK will
> not have it until a new build ships. Test at the prod web app.

---

## 0. Before you start

| | |
|---|---|
| Where | the prod web app (or the dev site for a rehearsal — both carry it) |
| Who | a **Principal** login for everything; one **Office** and one **teacher** login for T11 |
| Data | a teacher whose recent week you can independently verify — the original case was **Tazkir**; plus one guardian who has filed a বাড়িতে সম্পন্ন হয়েছে claim |

**Read this before judging any number.** Four properties are deliberate and every one of
them looks like a bug if you do not know it:

1. **A roster pass is ONE row with a count, not one row per student.** "২৮ জন
   শিক্ষার্থী" on a single row is the whole pass. Thirty rows would be the raw records;
   the row is the act.
2. **Two passes over the same item on the same day fold into one row.** If a teacher marks
   twenty students at 10:30 and eight more at 11:15 on the same homework item, you get one
   row reading ২৮, timed at the later stamp. That is intended — the answer to "what did he
   do that day" is the day's total.
3. **Days are Asia/Dhaka days, not UTC.** Anything done after 6:00 pm Dhaka is still that
   Dhaka day; the server's UTC clock is not what you are reading.
4. **The window is a date RANGE, not infinite scroll.** There is no "load more". If the
   window is hiding rows you get a warning (T9) and you narrow the range.

---

## 1. The path

**অ্যাডমিন → কার্যক্রম**

The card sits directly below **অডিট লগ**. If you cannot see it, you are not logged in as
Principal — see T11.

---

## 2. Test cases

### T1 — The person picker finds staff and guardians
**Do:** Open কার্যক্রম. Leave the search box empty, then type `tazkir`, then type a
guardian's name.
**Expect:** With no search, a list of people, **staff first**, then guardians, each with a
role badge (শিক্ষক / অফিস / প্রধান শিক্ষক / অভিভাবক). An inactive account carries a
নিষ্ক্রিয় অ্যাকাউন্ট badge and is still listed.
**Pass when:** both a staff member and a guardian can be found by name.
**Note:** a name with a dot in it (`Md. Tazkir`) must match literally — it is regex-escaped
server-side. If typing a dot matches unrelated names, that is a real bug; report it.

### T2 — The original question gets an answer
**Do:** Pick **Tazkir**. Leave the default ৭ দিন window.
**Expect:** A header card with his name, role badge, **মোট কাজ** and **কর্মদিবস**; then the
timeline grouped by day, newest day first, each day headed *বুধবার, ৬ সেপ্টেম্বর ২০২৬* with
a count badge.
**Pass when:** you can read, for each day, what he did and at what time — and the day
headers cover only days he actually worked (a day with nothing does not appear).

### T3 — The tracker fold is the point of the whole slice ⭐
**This is the test that settles it.** Everything else is presentation.

**Do:** Find a day in Tazkir's timeline with a **বাড়ির কাজ** row — e.g.
*"বাড়ির কাজে “জমা হয়েছে” চিহ্নিত করেছেন"* with a `HW-…` code and a `২৮ জন শিক্ষার্থী`
badge. Note the HW code, the state and the count. Now open that same homework item the
normal way (বাড়ির কাজ → the item) and count how many students are actually in that state.
**Expect:** the two numbers agree.
**Pass when:** they match exactly.
**If they do not:** note the person, the date, the HW code and both numbers, and report it.
The row id encodes the fold key (`HOMEWORK:<itemId>:<state>:<day>`), so any count can be
traced back to the individual stamps behind it.
**Known-good discrepancy:** a student whose record was later *reverted* (D-#338) still has
the stamp from when it was marked, so the timeline can legitimately show a pass the current
roster no longer reflects. That is the timeline being right and the roster being current —
not a bug.

### T4 — Old work is there, not just work done since the deploy ⭐
**Do:** Set the window to a month **before 6 September 2026** — say 1–31 August.
**Expect:** homework/assignment rows for that month.
**Pass when:** rows appear. This is the property that justified reading `stateDates`
instead of writing new audit rows; if August is empty for a teacher who plainly worked in
August, the retroactive read is broken and the whole design call was wrong.

### T5 — Audit events read as Bangla sentences
**Do:** Look at the non-tracker rows (grey **অডিট ঘটনা** badge) on any timeline.
**Expect:** *লগইন করেছেন*, *উপস্থিতি নিয়েছেন*, *প্রশ্ন প্রকাশ করেছেন* — never
`ATTENDANCE_MARKED` or other SCREAMING_CASE.
**Pass when:** no raw event code appears anywhere on the screen.
**If a code does appear:** it is an event kind written by an older build than this one; the
screen deliberately title-cases what it cannot name rather than hiding the row. Report
which code.

### T6 — বিস্তারিত opens the detail
**Do:** On an audit row that shows a **বিস্তারিত** button, press it.
**Expect:** the event's stored detail, one `key: value` per line.
**Pass when:** the panel opens and stays open. Rows with no stored detail correctly show no
button.

### T7 — Narrowing to a single day agrees with the totals
**Do:** Note **মোট কাজ** for the ৭ দিন window. Now set both শুরুর তারিখ and শেষ তারিখ to
one busy day inside it.
**Expect:** that day's rows only, and মোট কাজ falls to that day's own number.
**Pass when:** the single-day total matches the count badge that day carried in the wider
window.
**Caution:** the count badge counts ROWS (a pass is one row); মোট কাজ counts underlying
events (a 28-student pass counts 28). They are different numbers on purpose — compare
day-total to day-total, not badge to total.

### T8 — The filters narrow, and do not lie
**Do:** Set **কাজের ধরন** to উপস্থিতি ও ছুটি. Then clear it and set **উৎস** to বাড়ির কাজ.
**Expect:** the first shows only attendance/leave events; the second shows only homework
rows, no audit rows at all.
**Pass when:** each filter narrows to exactly its family, and clearing it restores the full
list.

### T9 — A busy window says so instead of lying
**Do:** Pick the busiest person you have (likely yourself, or the office desk) and set the
window to several months.
**Expect:** either the full list, or an orange notice: *"এই সময়ে এত বেশি কাজ হয়েছে যে সব
দেখানো যাচ্ছে না — তারিখের সীমা ছোট করুন।"*
**Pass when:** you never see a silently-clipped list. A window over ~400 days is refused
outright — that is intended.

### T10 — A guardian has a timeline too
**Do:** Pick a guardian who has filed a বাড়িতে সম্পন্ন হয়েছে claim.
**Expect:** *বাড়িতে কাজ হয়েছে জানিয়েছেন* (অভিভাবকের দাবি family), plus their logins.
**Pass when:** the guardian's own actions appear. Guardians never have tracker rows —
only a teacher marks a record — so an all-অডিট timeline is correct here.

### T11 — The gate holds
**Do:** Log in as **Office**, then as a **teacher**. Look at the অ্যাডমিন tab.
**Expect:** no কার্যক্রম card for either. It rides `audit:read`, which is Principal-only.
**Pass when:** neither role can see or reach it.

### T12 — The audit log itself improved
**Do:** Open **অডিট লগ** (the existing screen).
**Expect:** three things that were not there before — (a) event names in Bangla instead of
raw codes, (b) শুরুর/শেষ তারিখ date fields, (c) every actor name is **underlined and
tappable**.
**Do:** Tap an actor name.
**Pass when:** it opens that person's কার্যক্রম timeline directly.

### T13 — A View-as row is attributed honestly
**Only if you have used "View as" on someone.**
**Do:** Open that person's timeline for the day you did it.
**Expect:** the rows you generated appear on **their** timeline with an orange
*প্রধান শিক্ষক এই অ্যাকাউন্টে ঢুকে করেছেন* badge.
**Pass when:** the badge is present. A View-as action shown as the borrowed account's own
work would make the log lie — that is the failure this badge exists to prevent.

### T14 — Nothing is not an error
**Do:** Pick a staff member you believe has never used the app, or set the window to a
holiday week.
**Expect:** *"এই সময়ে কোনো কার্যক্রম নেই — তারিখের সীমা বাড়িয়ে দেখুন, অথবা ফিল্টার তুলে
দিন।"*
**Pass when:** you get that empty state, not a spinner and not an error banner.

---

## 3. Performance note (first run only)

Two indexes (`{stateDates.by, stateDates.at}` on both tracker record models) are built by
mongoose when the server first connects after this deploy. **The very first
`personActivity` issued before they finish will be slow** — it scans the tracker records.
If T2 takes many seconds the first time and is fast afterwards, that is the index
finishing, not a defect. If it is *still* slow an hour later, report it.

---

## 4. What this screen deliberately does NOT show

Do not file these as bugs — they are scope, recorded here so a tester knows the edges:

- **Chat message bodies.** Reading a conversation is governed by the D-#77/#111 oversight
  rules and its own audit trail (`CHAT_OVERSIGHT_OPENED`), not by this screen. Chat
  *administration* (group created, membership changed, message edited/deleted) does appear.
- **Roughly 89 mutations that still write no audit row at all** — the largest clusters are
  routine edits, parts of attendance, and assessment. They are invisible here because they
  are invisible everywhere; closing those gaps is separate work.
- **Student-level detail inside a tracker pass.** You get the item, the state and the count,
  not the 28 names. Open the item itself for those.
- **Export.** No CSV or PDF of a timeline.
- **A tappable calendar.** The per-day counts drive the summary; you narrow with the date
  fields.

---

## 5. Reporting

Anything that fails: capture the **person**, the **date window**, the **filter state**, and
for a count mismatch both numbers plus the `HW-…`/`AS-…` code. File under
`docs/issues/BACKLOG.md` per the SOP there.
