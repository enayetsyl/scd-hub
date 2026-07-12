# Testing guide — 2026-07-10 release candidate

**Round 4.** Rounds 1–3 are done. **Everything passes except the print forms**, whose five
gaps are fixed in **PR #189** — that is the only thing left to test.

Production (`main`) is still at **PR #182**. Nothing in this release is live yet.

---

## The ledger — what is settled

**Do not retest any of this.**

| Area | Verdict |
|---|---|
| Attendance rework (D-#278) — Quran-group capture, class/section display | ✅ passed (1 · 2c · 2d · 2e · **A1** · **A3**) |
| Today backlog board (D-#279) — red pending cards, present counts | ✅ passed (3a · **D2**) |
| Assignment countdown (D-#280) | ✅ passed (**A2**) |
| Print queue PQ-1…4 (D-#281) — buckets, send-to-print, Office actions | ✅ passed (5b · **A4** · **A5** · **D1** · **D3** · **D4** · **D5**) |
| Print queue PQ-5 — class-test absorption, delivery notify, migration | ✅ passed (**B1**–**B5**) |
| Guardian class-note attachments (D-#282) | ✅ passed (**C1**) |
| Cross-tracker whole picture + guardian trajectory (D-#282) | ✅ passed (**C2** · **C3**) |
| Plan → PDF from the queue (D-#282) | ✅ passed (**C4**) |
| **Bug 2** (Nursery/KG marker) | ✅ **closed** — the diagnostic passed; legacy overrides were not the cause |
| **§0.1 migration** (`migrate-classtest-print-requests.ts`) | ✅ effectively confirmed — **B1 passed**, which is exactly what it protects |

**Dropped by decision:** the Quran option in Admin → Proxy grants. A `ScopeGrant` is keyed
`class + section + subject`, and a Quran group is cross-section with **no classId** — that
form structurally cannot name one. Cover management already hands over the Quran *marking*
duty (2c passed). What a group cover does **not** get is *content access*; if that ever
bites, that is the real fix.

---

## Where the code is

| PR | Contains | State |
|---|---|---|
| #186 · #187 · #188 | the whole release candidate (features 1–6, PQ-1…5, the three deferred items, rounds 1–2 fixes) | **merged on `dev`, deployed** |
| **#189** | **the five print-form fixes** | **open — test this** |

> #189 is **not on `dev` yet.** Merge it (or check out `fix/print-forms-round3`) to test.

---

## Part E — the print-form fixes (PR #189)

These are the five gaps from round 3. Nothing else in this round.

### E1 · You can back out of a print request

**Sets → an assembled set → 🖨️ Send to print** *(or Lesson Plans → a plan → Send to print)*.

✅ The form has a **Cancel** below Send — it returns you where you came from.
✅ Nothing is queued. **Office → Print → Yet to print** does not show it.

> On web this screen had no header back arrow, so a change of mind meant navigating away
> by hand.

### E2 · Open shows a spinner

**Office → Print → any job → Open.**

✅ The button shows a **spinner** while the file loads, and the other Open buttons are
**disabled** until it finishes.
✅ **Double-tapping opens ONE tab**, not two.

> A set/plan PDF is rendered on demand and an upload streams through the server, so seconds
> are normal. This is the same busy-tracking the guardian/homework screens already use.

### E3 · Class test: remove a wrongly-uploaded paper

**Class Test → New print request → Own paper → Upload paper.**

✅ Once uploaded, the file name has a **Remove** button.
✅ Remove → **Upload paper** again → the new file replaces it.
✅ Filing with **no** paper attached is **refused**.

### E4 · Class test: no academic-year dropdown

**Class Test → New print request.**

✅ **There is no year dropdown.** The form opens straight on **Class**.
✅ The class list is the **current** year's (the one an admin marked current).
✅ The test files against that year — check the CT id / the queue row.

> The dropdown was a way to file a test against the **wrong year**, not a feature. If no
> year is marked current, the screen now **says so** rather than showing a blank form.

### E5 · Class test: colour and sides

**Class Test → New print request.**

✅ **Colour** (Black & white / Colour) and **Sides** (Single / Both) are there,
**mandatory, nothing pre-selected**.
✅ Submitting with either unset is **refused**, and the message **toasts**.
✅ File the request → **Office → Print → Yet to print** → **the row shows the colour and
sides you chose.** *This is the half that matters — the Office cannot start a job without
them.*
✅ A **pre-existing** (migrated) class test still shows `Black & white · Single side` — the
back-filled default. It must not have been broken by this change.

---

## Sign-off

- [ ] E1 · Cancel returns you, and queues nothing
- [ ] E2 · Open spins; a double-tap opens one tab
- [ ] E3 · the uploaded paper can be removed
- [ ] E4 · no year dropdown; the test files against the current year
- [ ] E5 · **your colour/sides choice reaches the Office's queue row**
- [ ] E5 · a migrated class test still reads `Black & white · Single side`

**Then this release is done.** The last step is the deliberate **`dev → main` promotion PR**
— `dev` is ~20 commits ahead of production. Say the word and I'll raise it.

---

## If something looks wrong

1. **Check who you're logged in as.** Both "bugs" in round 1's first report were two
   *different* teachers.
2. **Hard-refresh.** The web app persists navigation state; a stale bundle misleads.
3. Report the **account + date + screen**, and the **network response** for the query
   involved. That triple is almost always enough.

> A pattern worth knowing, because it explains four of the bugs you found: **this codebase
> tends to go quiet rather than complain.** The countdown was silent because no
> `AcademicYear` was flagged current; the Office's Open button did nothing because it was
> 403'd; a submit looked like a no-op because the error was off-screen; a second attachment
> was unreachable because only the first was ever opened. If a feature does *nothing*, that
> is a finding — report it exactly as "I clicked X and nothing happened." That phrasing has
> been right every time.
