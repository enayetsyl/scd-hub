# Test plan — Reviewer progress (QR-5, D-#537)

Shipped to prod 2026-08-25 via PR #662 (→ `dev`) and PR #664 (→ `main`). Deploy green,
`questionReviewerProgress` / `questionReviewerRounds` / `questionReviewerRoundCount`
confirmed live in the prod schema.

Nothing below has been executed. **This is the unexecuted half of the gate** — the
automated gate proved the code is correct against mocks; only these steps prove it is
correct against the real roster and the real question bank.

> **Web only, for now.** These are new screens, so a phone running the installed APK will
> not have them until a new build ships. Test at the prod web app.

---

## 0. Before you start

| | |
|---|---|
| Where | the prod web app (or the dev site, if you want a rehearsal first) |
| Who | a **Principal** login for the full path; an **Office** login for T7; a **reviewer teacher** login for T8 |
| Data | at least one reviewer who has been assigned class-5 questions — the original case was Kaynat |

**Read this before judging any number.** Two properties are deliberate, and both look like
bugs if you do not know them:

1. **Counters count ROUNDS, not distinct questions.** A question re-assigned after a
   re-import, or sent back by *শর্ত মুক্ত করুন*, is a second piece of work — it counts once
   under each round's verdict. So `assigned` can exceed the number of distinct questions
   you handed over.
2. **A decision counts forever, even after you publish the question.** Publishing
   supersedes the round but leaves its verdict alone, and the counters read the verdict.
   This is the whole point of the slice — see T4, which is the test that proves it.

---

## 1. The path

**পর্যালোচনা** (Review tab) **→ পর্যালোচনার অগ্রগতি** (Reviewer progress)

The card sits directly below *প্রশ্ন প্রকাশ*. If you cannot see it, you are logged in as
someone without `content:assign_review` — see T8.

---

## 2. Test cases

### T1 — The original question gets an answer
**Do:** Open পর্যালোচনার অগ্রগতি. Tap **শ্রেণি ৫**.
**Expect:** One card per reviewer who holds class-5 question rounds. Kaynat's card shows
`N বরাদ্দ · M সম্পন্ন`, a progress bar, and four counters: **অনুমোদিত**, **শর্তসাপেক্ষ**,
**বাতিলকৃত**, **অপেক্ষমাণ**.
**Pass when:** the four counters plus *সিদ্ধান্ত ছাড়াই বন্ধ* (if shown) add up exactly to
`বরাদ্দ`. If they do not, stop and report it — the arithmetic is derived by subtraction
specifically so that it cannot drift.

### T2 — Order is by who still owes work
**Do:** Look at the order of the cards with no filter applied.
**Expect:** Reviewers with the largest **অপেক্ষমাণ** first; ties broken by total assigned,
then by name. A reviewer who has finished everything sinks to the bottom.

### T3 — The filters actually narrow
**Do:** Toggle **শ্রেণি ৫** off and on; then add a subject (e.g. **ইংরেজি**).
**Expect:** Counts shrink as you narrow and never grow. With both filters off you see every
reviewer across every class. Selecting a class the reviewer has nothing in makes their card
disappear entirely rather than showing a row of zeros.

### T4 — **The important one: publishing must not erase her approvals**
This is the defect the slice was built to prevent, and the only test that can catch its
return.

**Do:**
1. Note Kaynat's **অনুমোদিত** count for শ্রেণি ৫ — call it `A`.
2. Go to **প্রশ্ন প্রকাশ → গৃহীত**, select one question she approved, and publish it.
3. Return to পর্যালোচনার অগ্রগতি, শ্রেণি ৫.

**Expect:** **অনুমোদিত** is *still* `A`. It must **not** drop to `A−1`.
**If it dropped**, the counters have been rewired onto round status and every reviewer's
record now empties as you work through it. Report immediately.

**Also expect:** in the drill-down (T5) that question now carries a **প্রকাশিত** badge —
that is how you tell "she approved it and it shipped" from "she approved it and it is
waiting".

### T5 — Drill-down
**Do:** Tap the **অনুমোদিত** counter on Kaynat's card.
**Expect:** Her approved class-5 questions, newest decision first, with five tabs across the
top. The header shows her name and the filter you arrived with (`শ্রেণি ৫ · ইংরেজি`). A
count line reads `50 / 231`-style when there is more than one page.
**Then:** Tap a row → the existing round-history thread opens for that question. Back
returns you to the list, not to the progress screen.

### T6 — Tabs, paging, and the zero case
**Do:** Switch between the five tabs. On a tab with more than 50 rows, press **আরও দেখুন**.
**Expect:** Switching tabs clears the list and reloads — no rows from the previous tab leak
in. *আরও দেখুন* appends the next 50 with **no duplicated rows** and no gaps. A counter
showing `০` is not tappable; you cannot navigate into an empty list.
**On the সিদ্ধান্ত ছাড়াই বন্ধ tab:** an explanatory line appears above the rows saying the
question was re-imported or published before she could rule. That bucket is hidden entirely
on the card when it is zero.

### T7 — The conditional verdict, which had no UI at all until now
Until this release `APPROVE_WITH_CONDITION` was invisible to the Principal and
`clearQuestionCondition` had no caller anywhere in the app. **So if the শর্তসাপেক্ষ counter
is non-zero, those questions have been stalled since whenever that verdict was first used** —
this is likely the first time you are seeing them.

**Do:** **প্রশ্ন প্রকাশ → শর্তসাপেক্ষ** (the new middle tab).
**Expect:** Each row shows **শর্ত: <the reviewer's condition text>**. The condition is
mandatory server-side, so it is never blank — a `—` here means something is wrong.

**Then:** Press **শর্ত মুক্ত করুন** on one row.
**Expect:** A hint appears stating plainly that clearing does **not** publish — the question
goes back to the same reviewer to confirm the condition was met — plus an optional
"what was done" note. Confirm.
**Pass when:** the row leaves the শর্তসাপেক্ষ tab, the notice says it has gone back to the
reviewer, and **the question reappears in that reviewer's own queue** (check with her login,
or via T8). It must **not** appear in গৃহীত and must **not** be published.
**Side effect to expect on the progress screen:** her **শর্তসাপেক্ষ** count stays as it is
(the old round keeps its verdict) and **অপেক্ষমাণ** goes up by one (the new round). Total
`বরাদ্দ` therefore also rises by one. That is correct — see property 1 above.

### T8 — Permissions
| Login | Expect |
|---|---|
| **Principal** | sees the পর্যালোচনার অগ্রগতি card, all counters, all drill-downs, and can publish and clear conditions |
| **Office** | sees the same progress card and drill-downs (they hold `content:assign_review`), but **publishing is refused** with a Bangla message — they lack `content:promote_gold`. Clearing a condition *is* allowed. |
| **Reviewer teacher** | does **not** see the পর্যালোচনার অগ্রগতি card at all — only *আমার প্রশ্ন পর্যালোচনা*. This is the one to check deliberately: a reviewer-only teacher is exactly the account shape that white-screened the app in `791e5fe`, so confirm the tab loads normally for her rather than erroring. |

Permissions are read from **effective** permissions, not the role template, so a user
customised through the AC-1 access editor follows their actual grants.

---

## 3. What this plan does not cover

- **No phone build.** The screens exist on web only until a new APK ships.
- **No `published` count in the rollup.** Deliberate: that is a property of the question,
  not of the reviewer's decision, and it would need a per-round artifact join. The
  drill-down's প্রকাশিত badge is the per-row substitute (T4).
- **No nudge/notification.** Nothing tells a reviewer they are behind; this slice is
  read-only apart from clearing a condition.
- **Load.** The drill-down is capped at 50 rows a page / 200 a request, sized off the
  2026-08-24 incident where one reviewer held 2,742 rounds. If a reviewer at that scale
  exists, T6 on their largest bucket is the case worth running.

---

## 4. If something fails

Capture the reviewer name, the class/subject filter, the tab, and the counter values, then
file it under `docs/issues/BACKLOG.md` per the `log-issue` SOP. For T4 specifically, note
both the before and after counts — that pair is the whole diagnosis.
