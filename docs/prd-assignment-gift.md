# PRD — Assignment gift & streak reporting (AG-1..AG-3)

Build contract for the owner's new incentive rule. Source: owner ask 2026-08-15,
clarified in the same session (four rulings, §2). Decisions: **D-#479–#483**, plus
**D-#497** (continuous evaluation — §3.5, refines D-#481 after the owner reviewed
the shipped screen on prod).

Rides the EXISTING assignment tracker (`assignment` tracker-kind, D-#85). No new
tracker-kind, no envelope change, **no `/shared/vocab.ts` edit** — therefore no
two-place contract sync and no harness run (AGENTS "Two-place contract sync"
does not trigger).

---

## 1. The rule (owner's words)

> Those who submit all the assignments on Sunday that were given on Thursday get a
> gift; those who do it 4 weeks in a row get a higher gift.

The Thursday→Sunday cadence is **already modelled** — `AssignmentItem.deliveryDate`
/ `.dueDate` are resolved server-side per the §4 holiday rolls (D-#86), so a week
whose Sunday is a holiday rolls forward and the rule follows it automatically. This
module adds **no calendar of its own**.

---

## 2. Owner rulings (settled — do not re-open without flagging)

| # | Question | Ruling |
|---|---|---|
| R1 | What counts as on time? | Reached `SUBMITTED` **on or before the due date**. Quality ignored — a `WRONG` result still counts. A chased-but-on-time submission counts. **Late does not.** |
| R2 | Eligibility | Only students issued **≥1** assignment that week. **Absence is not an excuse** — an `ABSENT_REDELIVER` record must still be submitted by the same Sunday. |
| R3 | Streak | **Rolling — the counter never resets on a win.** |
| R4 | Surface | Report **plus** stored "gift given" tracking (date + who handed it out). |
| R5 | Higher-gift cadence | Handed out **once per completed 4-week block** — fires at streak 4, 8, 12…, while the displayed counter stays unbroken. |

R3+R5 together: the counter rolls (a 6-week clean run displays `6`), but the award
is gated to `streak % 4 === 0`, so weeks 5 and 6 display the streak without
minting a second higher gift.

---

## 3. Derivation (AG-1) — nothing about a winner is stored

A winner is **computed on read** from data the tracker already writes. The only
thing this module persists is the physical handover (§4). Rationale: the underlying
records stay mutable (revert D-#338, late collection, redelivery), so a stored
winner flag would silently go stale — and the owner would be handing gifts off a
number the tracker no longer agrees with.

### 3.1 The unit

Per **(student × `weekNumber`)** within one `academicYearId`.

### 3.2 Which records count

From `AssignmentStudentRecord`, joined to its `AssignmentItem` for `weekNumber` /
`dueDate`:

- **Excluded — resubmissions** (`resubOf` set). AS-T3 issues a resubmission as a
  NEW record on the same `asId`, *after* checking, therefore always after the due
  date. Counting it would fail every student whose teacher chose to re-issue —
  punishing the student for the teacher's action. Only the original pass is judged.
- **Excluded — `DRAFT` items.** Records exist only once the week is confirmed
  (`status: ISSUED`), so this falls out naturally; asserted anyway.
- **Included — `ABSENT_REDELIVER`** records, per R2.

### 3.3 On time

```
onTime(record) := firstStampAt(record, "SUBMITTED") !== null
                  && dhakaDayKey(firstStampAt) <= dhakaDayKey(item.dueDate)
```

- The **first** `SUBMITTED` stamp, not the last: `CHASE → SUBMITTED → CHASE` is a
  legal cycle, and a re-collection must not overwrite an on-time original.
- Day-key comparison, not instant comparison — `dueDate` is a **date-only,
  local-midnight** value (`atMidnight`, assignmentCalendar.ts), so an instant
  compare would cut the deadline at 00:00 of the due day instead of its end.
  `dhakaDayKey` resolves to the intended calendar day under both a UTC and an
  Asia/Dhaka server, making the compare TZ-stable (D-#480).
- A record that never reached `SUBMITTED` (still `DUE`/`CHASE`/`ABSENT_REDELIVER`)
  is **not** on time.

### 3.4 Weekly win

```
eligible(student, week) := issuedCount(student, week) >= 1
won(student, week)      := eligible && onTimeCount == issuedCount
```

### 3.5 Continuous evaluation — four outcomes (D-#497, supersedes the settled-only gate)

The first cut judged a week only after its due date passed, so the live week showed
nothing at all. Owner ask 2026-08-16: evaluate continuously — a student who is
already fully in should appear the moment they qualify, and the rest should be
visible as *awaiting entry* rather than absent.

Per (student × week), where `outstanding` = issued − onTime:

| | `outstanding = 0` | `outstanding > 0` |
|---|---|---|
| **due date passed** | `WON` | `LOST` |
| **week still live** | `QUALIFIED` | `PENDING` |

- `WON` and `QUALIFIED` both count as a win: they increment the streak and admit a
  gift handover. Nothing outstanding can arrive late, so a live week that is
  already complete is genuinely won.
- `QUALIFIED` is flagged **provisional**. A teacher may deliver and confirm an
  *extra* subject later in the same week (`confirmAssignmentWeek` re-runs whenever
  new `DRAFT` items exist), which raises `issued` and pushes the student back to
  `PENDING`.
- `PENDING` is neither a win nor a loss: it must **not** reset a streak, since the
  student can still submit before the due date. Same bridging behaviour as a
  no-work week (§3.6).
- A week with no assignments issued to that student is `PENDING` and never shown
  as a win.

Because a handover can now be recorded against a provisional win, every stored
award is re-checked against the live derivation on each read and carries
`entitlementHolds`. When it goes false — a revert (D-#338), or an extra subject
confirmed after the gift was handed over — the screen **flags the mismatch** and
the row stands. The ledger records what physically happened; it is never silently
rewritten to match a changed derivation.

### 3.6 Streak

Walk the student's settled weeks in ascending `weekNumber`:

- a **won** week increments the streak;
- a **lost** week resets it to 0;
- a week the student was **not eligible** for (no assignments issued — a vacation
  week, a suspended week, or a student who joined mid-term) is **neutral: it
  bridges the streak without incrementing it** (D-#482). A week in which the
  school set no work is not a failure by the student, so it must not break a run;
  equally it is not an achievement, so it must not extend one.

`higherGiftWeeks` = the weeks where the post-increment streak satisfies
`streak > 0 && streak % 4 === 0` (R5).

---

## 4. The award record (AG-2) — the only new state

New collection `assignmentgiftawards`, operational/identity plane (ADR-005 — it
stores `studentId`; the corpus module never imports it).

| field | note |
|---|---|
| `academicYearId`, `studentId`, `classId`, `sectionId` | scope + report filters |
| `kind` | `WEEKLY` \| `STREAK` |
| `weekNumber` | the week won (`WEEKLY`) or the block-closing week (`STREAK`) |
| `streakLength` | `STREAK` only — the counter at the moment of award |
| `handedOverAt`, `handedOverBy` | who physically gave it, when |
| `note` | optional, Bangla free text |

Unique on `(academicYearId, studentId, kind, weekNumber)` — ticking twice is an
idempotent no-op, not a duplicate gift.

**The award never creates entitlement.** Marking a handover is refused unless the
derivation (§3) currently says that student won that week — `WON` or `QUALIFIED`.
A refusal on a still-`PENDING` week says so explicitly ("the data isn't in yet"),
which is a different problem for the office than "this student missed one".

Because a handover may now be recorded against a live week, drift is possible
after the fact; every award therefore carries `entitlementHolds`, re-derived on
each read and flagged on the screen when false (§3.5).

---

## 5. RBAC (AG-3)

Reuses existing permissions; **no new permission, no vocab edit** (D-#483).

| Action | Gate |
|---|---|
| Read the report | `tracker:read`; Principal/Office unscoped (admin staff), a teacher must pass `assertCanRead` on the section |
| Mark handed over | Principal/Office (`isAdminStaff`) **or** the section's assigned class teacher (`Section.classTeacherId`) |

`assertCanWrite` is deliberately **not** used for the tick-off: it throws for
OFFICE (authz.ts), and the office is exactly who hands out gifts.

---

## 6. Slices

- **AG-1** — `AssignmentGiftService`: winner + streak derivation, section/class/week
  filters, per-student breakdown of which assignments were missed.
- **AG-2** — `AssignmentGiftAward` model + `recordGiftHandover` / `undoGiftHandover`,
  entitlement-checked.
- **AG-3** — GraphQL resolvers + the report screen (`উপহার`): week picker,
  class/section filter, weekly-winner list, streak list with block markers,
  handed-over tick-off.

## 7. Acceptance

1. A student with 3 assignments in week 5, all `SUBMITTED` on or before the due
   date → wins week 5, regardless of `result`.
2. One of the three submitted the day AFTER the due date → does not win week 5.
3. A student absent at delivery (`ABSENT_REDELIVER`) who never submits → does not
   win (R2).
4. A student with a resubmission on an otherwise on-time week → still wins (§3.2).
5. Weeks 1–4 all won → one `STREAK` entitlement at week 4. Week 5 also won →
   streak displays `5`, and **no** second `STREAK` entitlement (R5).
6. Weeks 1–2 won, week 3 has no assignments for the section, week 4–5 won →
   streak displays `4` at week 5 and a `STREAK` entitlement fires (§3.6 bridging).
7. During a live week: a student with work still unmarked is `PENDING` (not a
   loss, and the streak carries); a student already fully in is `QUALIFIED`,
   counts toward the streak, and may be handed the gift now. A `QUALIFIED` week
   becomes `WON` and a `PENDING` week becomes `LOST` once the due date passes.
   A handover on a still-pending week is refused with "data not in yet", which is
   a different message from "the student missed one".
8. `recordGiftHandover` for a student who did not win that week → refused.
9. A teacher who is not the section's class teacher and is not admin staff →
   refused on the tick-off, permitted on the read if `assertCanRead` passes.
