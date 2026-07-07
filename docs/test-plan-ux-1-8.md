# Manual Test Plan — UX-1…UX-8 (App-wide UX Improvement Program)

> Step-by-step LOCAL testing guide for the 8 UX slices merged into `dev` on 2026-07-03
> (stack tip PR #153, commit `60d6c0d`; D-#265 + D-#266). Source contracts:
> `docs/prd-ux-improvements.md` §4.1–§4.8 (each slice's §4.x.5 manual checklist, expanded
> here into concrete click-paths). Tick `- [ ]` as you go; `[x]` = pass, `⚠️` = fail
> (log it in the Bug log at the bottom, BUG-NNN style, same convention as
> `docs/test-plan-by-role.md`).

| Field | Value |
|---|---|
| Tester | _____ |
| Date started | _____ |
| Build / commit | _____ (`git rev-parse --short HEAD` on `dev`) |
| Environment | **local** (`scdhub_local`) |

---

## 0. One-time local setup

1. **Sync `dev`:** `git checkout dev && git pull`, then `npm install` and
   `npm run build --workspace=shared` (skip install/build if already current).
2. **Server → local DB:** make sure the root `.env`'s `MONGODB_URI` points at the
   **`scdhub_local`** database, then start it:
   ```
   npm run dev:server
   ```
   Confirm `http://localhost:4000/healthz` responds.
3. **App (web):** `app/.env` must have `EXPO_PUBLIC_API_URL=http://localhost:4000/graphql`, then:
   ```
   cd app && npm run web
   ```
4. **Test passwords:** if you haven't already, set the known local password on every
   non-Principal user (dry-run first, then commit):
   ```
   npx tsx server/scripts/set-local-test-password.ts
   npx tsx server/scripts/set-local-test-password.ts --commit
   ```
   → every user except the Principal logs in with **`Test1234`** (identifier = their phone/email).
5. **Accounts you'll need** (pick real ones from your local roster):
   - **T1** — a teacher with **multiple routine periods** on a school day (check Routine home).
   - **T2** — a teacher with exactly **one accessible class+section** (for the auto-select test). If none exists, skip the two checks marked *(T2)*.
   - **P** — the Principal. **O** — an Office user. **G** — a guardian with a linked child.
6. **Two viewports, both required per slice:** a **phone-width** window (DevTools device
   toolbar, ~390px — this is how teachers use it) and a **desktop ≥1024px** window
   (permanent sidebar visible). Steps below say "phone" / "web" when it matters;
   otherwise run the flow once per viewport.
7. **Language + theme:** you'll toggle Bangla/English and dark mode from the 👤 account
   menu (top right) at the end of each slice — each slice's last check covers it.

> **Tip — order:** test in slice order UX-1 → UX-8. Later slices assume the earlier
> primitives work (e.g. UX-8 publishes with UX-1 toasts on UX-2 date fields).

---

## ✅ Progress

- [ ] UX-1 Feedback & safety layer
- [ ] UX-2 Calendar dates everywhere
- [ ] UX-3 Searchable pickers + no pasted IDs
- [ ] UX-4 Staff Today dashboard + landing
- [ ] UX-5 One section pattern + context carry
- [ ] UX-6 Form shortening
- [ ] UX-7 Mobile hygiene
- [ ] UX-8 Class Notes teacher-first entry

---

## UX-1 — Feedback & safety layer (toast · confirm sheet · field validation)

*Login as **T1** unless stated. What changed: every mutation outcome shows a bottom toast pill; every red (danger) button opens a confirm bottom-sheet before mutating; the 7 high-traffic forms show per-field red errors instead of a generic error.*

1. - [ ] **Validation error, field-level:** Drawer → ট্র্যাকার/Trackers → হোমওয়ার্ক (Homework) → pick a class/section → ঘোষণা (Declare). Leave the **topic empty**, tap Submit.
   *Expect:* the topic field gets its own red error text **and** a toast names the field — NOT a bare generic error; nothing was saved.
2. - [x] **Success toast in view:** fix the topic (fill the form minimally) and submit. → **BUG-011 (fixed)**
   *Expect:* a success toast appears at the bottom **without scrolling** (even on phone with the form long), and the form resets.
3. - [ ] **Confirm sheet blocks the mutation:** as **P**, Drawer → Admin → proxy/scope grants (Supervisory/Scope grant screen) → tap a **revoke/danger** button on an existing grant → in the sheet tap **বাতিল/Cancel**.
   *Expect:* a bottom confirm sheet appeared **before** anything happened; after Cancel the grant is still listed (refresh to be sure).
4. - [x] **Confirm → mutate:** repeat and tap the red confirm button. → **BUG-010 (fixed)**
   *Expect:* toast + the row disappears.
5. - [ ] **Sample two more danger sites** (e.g. HR → Leave admin reject; Admin → Message template delete): both show the sheet first; cancel is always a no-op.
6. - [ ] **Theme + language:** toggle dark mode → trigger one toast + one confirm sheet: both legible. Switch to English → the confirm sheet title/buttons and the "field required" message are English; back to Bangla → Bangla.

---

## UX-2 — Calendar dates everywhere

*What changed: every typed `YYYY-MM-DD` text input is now a calendar `DateField` (browser date input on web, native picker on phone). State/queries unchanged — a picked date must behave exactly like the typed date used to.*

1. - [x] **No typed dates remain (spot-sweep, one screen per module):** open each of these and confirm the date is a **picker**, not free text — tapping it opens a calendar; you cannot type garbage into it: → **BUG-012 (fixed)**
   - Homework → Declare (date) and Reconcile (date)
   - Attendance → home + report (date / from–to)
   - Class Test → Request (exam date)
   - Finance → Daily entry (date), Reconciliation (from/to)
   - HR → Leave request (from/to)
   - Routine → cover/bell screens (date)
   - Vocab → Build test (fold — test date), Assignment
   - Guardian (**G** login) → child attendance / homework / leave filters
2. - [ ] **Value lands correctly:** file a class-test request with an exam date picked from the calendar → the created request shows that exact date (check the class-test list/print queue).
3. - [ ] **Range fields constrain:** on a from/to screen (Attendance report or Finance reconciliation) set **from**, then open **to**.
   *Expect:* **to** can't be set before **from** (min is enforced), and the filtered results respect the range.
4. - [ ] **Guardian filters still work (G):** set a date range on child attendance → results constrain as before.
5. - [ ] **Phone:** repeat check 2 on phone-width — the native/browser mobile picker opens.

---

## UX-3 — Searchable pickers + no pasted IDs

*What changed: long dropdowns (staff, roster, reviewers…) have a pinned search box when open; class-test set selection is a named picker instead of a typed Set-ID; vocab step-2 has a chip filter.*

1. - [ ] **Bangla substring search:** as **P**, open any staff picker (e.g. Admin → Assign class teacher, or HR → observation observer select). Open the dropdown, type **2+ characters of a Bangla name**.
   *Expect:* the list narrows live (label or hint match); clearing the filter restores all; the keyboard stays open while tapping an option (phone).
2. - [ ] **Roster-fed picker:** Admin → Guardian credentials → the guardian/student manual-link picker searches the 91-student roster the same way.
3. - [ ] **Class test with zero typed IDs:** as **T1**, Class Test → Request: choose section/subject → for the paper/set source pick a **CT set by name** from the searchable Select (hint shows question count · marks).
   *Expect:* the whole request files end-to-end **without typing any ID**.
4. - [ ] **Escape hatch:** on the same screen the ghost button "অ্যাডভান্সড: আইডি নিজে লিখুন / advanced: enter ID" reveals the old typed field.
5. - [ ] **Vocab chip filter with sticky selection:** Vocab → Build test → step 2: type in the filter above a direction's chip grid → chips narrow, counter shows `selected n / shown m`. Select 2–3 chips, **change the filter so they're hidden, then clear it**.
   *Expect:* the earlier selections are still selected (selection survives filtering).

---

## UX-4 — Staff **Today** dashboard + landing route

*What changed (only slice with server work): new `myDay` read; staff land on a new 🏠 আজ/Today screen — my periods, pending-work counts (deep-linking), permission-gated quick actions. Guardian navigation untouched.*

1. - [ ] **Landing per role:** log in fresh as each role and note the first screen:
   - **T1** → Today (🏠 আজ, top drawer item, highlighted as active)
   - **P** → Today (periods may be empty; quick actions reflect Principal perms)
   - **O** → Today (renders — likely empty periods; **no error**)
   - **G** → guardian Home exactly as before (no Today item anywhere)
2. - [ ] **My periods (T1):** the periods card lists exactly T1's own routine periods for today — `period n · time · subject · group`, matching Routine home for the same teacher/date. No other teacher's periods.
3. - [ ] **Count parity (T1):** note the pending-checking / resubmission / chase numbers, then open the Homework dashboard for the same sections.
   *Expect:* Today's counts match the Homework dashboard's numbers.
4. - [ ] **Deep links (T1):** tap each pending row: checking → Checking queue; chases → Homework home; resubmissions → Homework records; attendance pending → Attendance home. Each lands in **one tap**.
5. - [ ] **Quick actions gated:** T1 sees Declare-HW / Attendance / Request-CT chips (per their perms); **G** never sees the screen; chips a role lacks the gate for don't render.
6. - [ ] **Holiday empty state:** as **T1** — if today is a school day, verify via a holiday: the periods card on a holiday shows the day-type empty label (e.g. Friday). (If Today has no date switcher, check the equivalent day-type state via UX-8's Class Notes screen with a holiday date — same `myDay` read.)
7. - [ ] **Focus refetch:** from Today, declare a homework via quick action, come back → counts update without a manual reload.

---

## UX-5 — One section pattern + context carry

*What changed: Trackers and Sets landings now use the Homework-home class-buttons + section-row dashboard (no more full-screen section picker in daily flows); the date chosen on Homework home rides into Declare/Reconcile; selection is shared app-wide via SectionContext.*

1. - [ ] **New landings:** open Trackers landing and Sets landing → both show the class-button + section-row dashboard (same pattern as Homework home), and picking class → section drops you into the module as before.
2. - [ ] **Shared context:** pick class 3 / section A on the **Trackers** landing → go to **Homework home** and **Sets**.
   *Expect:* both already show class 3 / A (one selection, all modules).
3. - [ ] **Date carry:** on Homework home change the calendar date to **yesterday** → open **Declare**.
   *Expect:* the declare date field is prefilled with yesterday (editable). Go back, open **Reconcile** → same date carried; neither screen asked again.
4. - [ ] **Deep links unaffected:** open Declare via the Today quick action (not via Homework home).
   *Expect:* it defaults to today as usual (the carry is optional, not sticky garbage).
5. - [ ] *(T2)* **One-section auto-select:** log in as **T2** → open Homework/Trackers/Sets landings.
   *Expect:* lands straight in with the single class+section auto-selected — no picking step.
6. - [ ] **Inner screens:** SectionBar (compact "current selection + change" strip) still works on inner screens.

---

## UX-6 — Form shortening (defaults + advanced folds)

*What changed: happy paths need ≤6 visible inputs; secondary fields moved into a collapsed "আরও অপশন / More options" fold; smart defaults.*

1. - [x] **Class test in 5 core inputs (T1):** Class Test → Request. On first paint only the core inputs are visible (section, subject, source, paper/set, exam date, total marks) — pass mark/test number/deadline/notes are folded. File a complete request touching **only** the core inputs (never open the fold). → **BUG-013 (fixed)**
2. - [ ] **Derived pass mark lands server-side:** set total marks = 100, don't touch the fold → after filing, the request's pass mark is **⌈100 × 0.33⌉ = 33** (open the created request/print view to confirm).
3. - [ ] **Editable default:** repeat, but open the fold and set pass mark to 40 → 40 wins (your edit is not overwritten when total changes).
4. - [ ] **Vocab two-step:** Vocab → Build test shows "ধাপ ১ · নতুন টেস্ট" and a visibly **locked ধাপ ২** card until the test is created; after creating, step 2 unlocks. Full build works with the fold (test date + half-miss) closed.
5. - [ ] **Finance repeat entry (P/O):** Finance → Daily entry: date is prefilled **today**. Post an entry → the form keeps date/kind/mode and clears **only amount + description**, ready for the next entry. Change the date to yesterday and post again → the date **stays** yesterday for the next repeat.
6. - [ ] **Declare homework fold:** Homework → Declare: pool-ref + revision flag are folded; time is visible and defaults to ২০.

---

## UX-7 — Mobile hygiene (keyboard · pull-to-refresh · lists · login)

*Phone-width viewport for all of these (that's the point). What changed: app-wide KeyboardAvoidingView, pull-to-refresh on the list screens, FlatList for the growing lists, login password eye + email keyboard.*

1. - [ ] **Keyboard never hides the form:** on phone, Homework → Declare → focus the **last** field.
   *Expect:* the focused field AND the Submit button stay visible above the keyboard (no blind submit). Try one more long form (e.g. HR leave request).
   > True keyboard behavior needs a real phone/emulator (Expo Go on Android): `cd app && npm run start`, scan the QR. On desktop web this check is a no-op by design (KeyboardAvoidingView is disabled on web) — don't fail it there.
2. - [ ] **Pull-to-refresh:** on phone (or touch-emulated web), pull down on: Notification center, Homework records, Checking queue, Chat home, Guardian home (**G** — one pull refreshes all cards), Child homework (**G**), Vocab word bank, Roster.
   *Expect:* a spinner rides the pull and fresh data lands (verify by changing something from another login first, e.g. declare a HW → pull on the guardian's child-homework).
3. - [ ] **Long-list scroll:** open the Vocab word bank (largest list; aim for ~200 words) → scrolling is smooth, rows render as you go (FlatList), no multi-second freeze.
4. - [ ] **Inverted chat:** Chat → a thread: newest message renders at the **bottom**, composer pinned below the list; "load older" sits at the visual top; an **empty** thread's empty-state is not upside-down.
5. - [ ] **Login field hygiene:** log out → the password field has a 👁 show/hide toggle that works; on phone the identifier field brings up the **email keyboard** (@ visible) and offers autofill hints.

---

## UX-8 — Class Notes: teacher-first drawer entry

*What changed: new 📓 ক্লাস নোট drawer item (between Attendance and Comments) → the teacher's OWN periods for a date, inline publish per period, homework auto-link. DailyNote (via Routine home) stays the admin/cover path.*

1. - [ ] **Own periods only (T1, multi-period day):** Drawer → 📓 ক্লাস নোট.
   *Expect:* exactly T1's own periods for today render (period · time · subject · group) — count matches Today/Routine; **no** class/subject selection step anywhere.
2. - [ ] **Publish inline:** on an unpublished period card, tap → type a taught-summary → publish.
   *Expect:* UX-1 toast + the card flips to a "✓ প্রকাশিত" badge; **empty summary** → field-level error, nothing published. Leave the screen and come back → badge persists.
3. - [ ] **Catch-up + holiday:** change the date to **yesterday** → publish a catch-up note (works). Change to a **holiday** (e.g. Friday) → day-type empty state, no periods, no error.
4. - [ ] **Homework auto-link (exactly one):** as T1 declare **one** homework today for a period's section+subject → back in Class Notes, that period shows the linked item (🔗 hwId) with **no picker**; publish → as **G** (guardian of a child in that section) open the class-note view → the homework link is there.
5. - [ ] **Homework picker (several):** declare a **second** HW for the same section+subject+day → the period now offers a name-based Select of the two (no typed ID anywhere).
6. - [ ] **Subject-group period:** a Quran/Arabic (subject-group) period shows no homework link (expected — none exists for groups).
7. - [ ] **Cover teacher:** assign a cover (proxy) for one of T1's periods today to another teacher (as **P**, Routine → cover) → log in as the **cover teacher** → their Class Notes shows the covered period; T1's view reflects the cover.
8. - [ ] **Admin path untouched (P):** Routine home → Daily note still works exactly as before (group-based, any group).
9. - [ ] **Today chip:** on the Today screen the quick-actions row has a "📓 ক্লাস নোট" chip → one tap lands on Class Notes.
10. - [ ] **BN/EN + dark mode** on the new screen: drawer label, headers, empty states all switch; dark mode legible.

---

## Final cross-cutting sweep (after all 8)

- [ ] Nothing regressed at the shell: drawer opens/collapses on web ≥1024px and phone; notification deep-links still land; guardian navigation identical to before the stack.
- [ ] One full happy-path day as **T1**, phone-width, Bangla, dark mode: land on Today → mark attendance → declare HW → publish a class note → file a class test — zero typed IDs, zero typed dates, every mutation toasted.

---

## 🐞 Bug / Issue log

**Severity:** 🔴 Blocker · 🟠 High · 🟡 Medium · 🟢 Low. **Status:** Open · In progress · Fixed · Verified · Won't fix · Can't reproduce.
(When a bug is real, also move it into `docs/issues/BACKLOG.md` per the `log-issue` SOP.)

| ID | Date | Slice / check # | Role | Sev | What happened — expected vs actual (+ steps) | Status |
|---|---|---|---|---|---|---|
| BUG-013 | 2026-07-03 | UX-6 #1 | T1 | Medium | In New print request, tap Upload paper and choose a file. Expected the file to attach/upload and populate the form; actual selection is ignored and nothing uploads. | **Fixed** (see docs/issues/BACKLOG.md BUG-013) |
| BUG-012 | 2026-07-03 | UX-2 #1 | T1 | Low | On Attendance home, the Teacher attendance upload hint shows unexpected characters after `.xlsx` in the helper sentence. Expected readable punctuation; actual text contains mojibake. | **Fixed** (see docs/issues/BACKLOG.md BUG-012) |
| BUG-011 | 2026-07-03 | UX-1 #2 | T1 | Low | Trigger a loading state anywhere in the app. Expected plain loading text; actual loading labels show an extra symbol beside the text. | **Fixed** (see docs/issues/BACKLOG.md BUG-011) |
| BUG-010 | 2026-07-03 | UX-1 #4 | P | Medium | Add or remove a proxy grant from the admin flow. Expected a success/failure toast after the mutation; actual no toast appears. | **Fixed** (see docs/issues/BACKLOG.md BUG-010) |
