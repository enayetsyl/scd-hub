# Issue backlog

Issues found while testing the app. **Newest first.** Schema, allowed values, and the
intake/fix procedures live in [README.md](README.md). To add one: paste the issue
(+ screenshot + platform) in chat and say *"log this"*.

<!-- TEMPLATE â€” copy below the line for a new issue (newest goes at the top of the list):

## BUG-NNN â€” short title
- **Status:** open
- **Severity:** medium
- **Platform:** android-app, web
- **Area:** homework
- **Reported:** YYYY-MM-DD
- **Screenshot:** â€”

**Repro:**
**Expected:**
**Actual:**
**Notes:**
**Fix ref:** â€”

-->

---

## BUG-014 — "View paper" opens the PDF with no loading feedback
- **Status:** open
- **Severity:** low
- **Platform:** web
- **Area:** class-test
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Class Test → Print queue → a request card with an uploaded paper → tap "View paper".
**Expected:** Immediate feedback that the paper is being fetched, then the PDF opens.
**Actual:** Nothing visible happens for several seconds (the server streams the bytes from Drive
before the blob URL opens in a new tab), so the button feels dead until the tab suddenly appears.
**Notes:** `ClassTestPrintQueueScreen.tsx` → `openStoredFile(questionFileId)` — no busy state on
the button. Fix shape = the BUG-013 recipe (busy spinner + double-tap guard while the fetch runs).
The same unguarded `openStoredFile` pattern exists on `ChatThreadScreen.tsx` (attachment open) and
`CommentEntryScreen.tsx` — sweep them in the same pass.
**Fix ref:** —

## BUG-015 — Exam date on New print request shows a typed YYYY-MM-DD field, not the calendar
- **Status:** open (likely invalid — wrong build under test)
- **Severity:** low
- **Platform:** web
- **Area:** class-test
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Class Test → New print request → Exam date renders as a free-text field with a
`YYYY-MM-DD` placeholder instead of the calendar `DateField`.
**Expected:** UX-2 (D-#265) replaced every typed date with the calendar `DateField`, including this
screen.
**Actual:** Typed text field.
**Notes:** At report time the local repo was checked out on **`main`**, which predates the whole
UX-1..8 stack — the screenshot also shows the pre-UX-3 typed "Set id" field and the pre-UX-6
"Blank = 40% of total" hint, all long since replaced on `dev`. The UX-2 `DateField` IS live on this
screen on `dev`/`fix/ux-testing-bugs`. **Retest on the dev build (or the fix branch) before treating
this as a code bug**; close as invalid if the calendar shows there.
**Fix ref:** —

## BUG-008 â€” Reword homework Bangla labels: à¦¯à¦¾à¦šà¦¾à¦‡ â†’ à¦¦à§‡à¦–à¦¾, à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ â†’ à¦®à¦¨à§‡ à¦•à¦°à¦¾à¦¨à§‹
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** homework
- **Reported:** 2026-06-18

**Context:** Owner wants friendlier Bangla wording for two homework terms (seen on the guardian
"Today" home + the staff checking/chase screens). **Owner-approved replacements:**
- **à¦¯à¦¾à¦šà¦¾à¦‡** (jachai, "verify") â†’ base **à¦¦à§‡à¦–à¦¾** ("review/see"): status "à¦¯à¦¾à¦šà¦¾à¦‡ à¦¹à¦¯à¦¼à§‡à¦›à§‡" â†’ "à¦¦à§‡à¦–à¦¾ à¦¹à¦¯à¦¼à§‡à¦›à§‡";
  "à¦¯à¦¾à¦šà¦¾à¦‡ à¦¤à¦¾à¦²à¦¿à¦•à¦¾" â†’ "à¦¦à§‡à¦–à¦¾à¦° à¦¤à¦¾à¦²à¦¿à¦•à¦¾"; "à¦¯à¦¾à¦šà¦¾à¦‡ à¦•à¦°à§à¦¨ / à¦¯à¦¾à¦šà¦¾à¦‡" â†’ "à¦¦à§‡à¦–à§à¦¨"; "à¦¯à¦¾à¦šà¦¾à¦‡à¦¯à¦¼à§‡à¦° à¦…à¦ªà§‡à¦•à§à¦·à¦¾à¦¯à¦¼" â†’ "à¦¦à§‡à¦–à¦¾à¦° à¦…à¦ªà§‡à¦•à§à¦·à¦¾à¦¯à¦¼".
- **à¦¤à¦¾à¦—à¦¾à¦¦à¦¾** (tagada, "dunning") â†’ **"à¦®à¦¨à§‡ à¦•à¦°à¦¿à¦¯à¦¼à§‡ à¦¦à¦¿à¦¨"** ("remind") for the action button; use a noun
  form ("à¦¸à§à¦®à¦°à¦£" / "à¦®à¦¨à§‡ à¦•à¦°à¦¾à¦¨à§‹") for list/count labels: "à¦†à¦¬à¦¾à¦° à¦¤à¦¾à¦—à¦¾à¦¦à¦¾" â†’ "à¦†à¦¬à¦¾à¦° à¦®à¦¨à§‡ à¦•à¦°à¦¿à¦¯à¦¼à§‡ à¦¦à¦¿à¦¨";
  "à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ à¦¤à¦¾à¦²à¦¿à¦•à¦¾" â†’ "à¦¸à§à¦®à¦°à¦£ à¦¤à¦¾à¦²à¦¿à¦•à¦¾"; "à¦®à§‹à¦Ÿ à¦¤à¦¾à¦—à¦¾à¦¦à¦¾" â†’ "à¦®à§‹à¦Ÿ à¦¸à§à¦®à¦°à¦£". (NOTE: "à¦®à¦¨à§‡ à¦•à¦°à¦¿à¦¯à¦¼à§‡ à¦¦à¦¿à¦¨" is imperative and
  doesn't nominalize cleanly â€” noun contexts read awkwardly; a short noun like "à¦¸à§à¦®à¦°à¦£" fits there.)

**Where to change:**
1. **`shared/vocab.ts:603` `LIFECYCLE_STATE_LABELS_BN` (CONTRACT FILE)** â€” CHECKED "à¦¯à¦¾à¦šà¦¾à¦‡ à¦¹à¦¯à¦¼à§‡à¦›à§‡" â†’ "à¦¦à§‡à¦–à¦¾ à¦¹à¦¯à¦¼à§‡à¦›à§‡", CHASE "à¦¤à¦¾à¦—à¦¾à¦¦à¦¾" â†’ button form. This is the source of the guardian chip text via `GuardianPortalService.ts:409`. **Must run `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` after.** GIVEN "à¦ªà§à¦°à¦¦à¦¾à¦¨ à¦•à¦°à¦¾ à¦¹à¦¯à¦¼à§‡à¦›à§‡" stays. Consider matching `LIFECYCLE_STATE_LABELS_EN` (CHECKED â†’ "Reviewed"? CHASE â†’ "Remind"?) if EN parity is wanted.
2. **`app/src/lib/labels.ts` homework keys** (~lines 803â€“847) â€” `hwCheck` / `hwChecking` / `hwCheckingTitle` / `hwCheckHint` / `hwGoChecking` / `hwNoSubmitted` (à¦¯à¦¾à¦šà¦¾à¦‡â†’à¦¦à§‡à¦–à¦¾) and `hwChaseAction` / `hwChaseAgain` / `hwChaseList` / `hwChaseVolume` (à¦¤à¦¾à¦—à¦¾à¦¦à¦¾â†’à¦®à¦¨à§‡ à¦•à¦°à¦¾à¦¨à§‹/à¦¸à§à¦®à¦°à¦£).

**Scope decision (owner):** à¦¯à¦¾à¦šà¦¾à¦‡/à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ also appear in **assignment** (`asCheck`, `asChaseVolume`,
`asCheckTitle`â€¦), **revision** (`revChaseTitle`, `rvAwaiting`), **attendance** (`attPreview`
"à¦¯à¦¾à¦šà¦¾à¦‡ à¦•à¦°à§à¦¨"), **finance** (`finChase` "à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ à¦¦à¦¿à¦¨", `finChaseFeeDue`). Apply the same rename there for
consistency? â€” **except finance**, where à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ (dunning) is arguably the RIGHT tone for a fee-due
reminder; likely keep à¦¤à¦¾à¦—à¦¾à¦¦à¦¾ for fees. Decide before fixing.
**Relates:** BUG-007 â€” if the guardian chips switch to client-side STR mapping, their text comes from
`labels.ts` instead of `stateLabelBn`; coordinate so the wording isn't changed in only one place.
**Fix ref:** PR #118

## BUG-007 â€” English mode still shows Bangla labels in many places (i18n leak)
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** other
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Set the app to English (account menu â†’ language). On the guardian "Today" home the
homework status chips still render in Bangla â€” "à¦¯à¦¾à¦šà¦¾à¦‡ à¦¹à¦¯à¦¼à§‡à¦›à§‡" (checked), "à¦ªà§à¦°à¦¦à¦¾à¦¨ à¦•à¦°à¦¾ à¦¹à¦¯à¦¼à§‡à¦›à§‡" (given),
"à¦¤à¦¾à¦—à¦¾à¦¦à¦¾" (chase) â€” and subject names render in Bangla. Owner reports "lots of places" show Bangla
in EN mode.
**Expected:** In English mode all UI labels render in English (subject names may be a deliberate
exception â€” confirm with owner).
**Actual:** Many labels stay Bangla regardless of the selected language.
**Notes:** Concrete instance pinned = `GuardianHomeScreen.tsx` line 252 renders `r.stateLabelBn`
and line 249 renders `r.subjectLabelBn` â€” **server-provided Bangla-only fields** displayed directly
regardless of app language. The sweep now covers the guardian home, shared section chooser/bar,
routine landing, homework dashboard, roster, assignment marker, attendance marker, and class-note
report. Subject names may remain Bangla by design unless the owner asks for translation. TWO distinct
root-cause classes to sweep:
1. **Server `*Bn`-only fields rendered directly** (e.g. `stateLabelBn` / `subjectLabelBn`). Fix:
   map the enum the app already holds (`r.state`, subject code) to a localized `STR` label
   client-side, or have the server return both EN + BN.
2. **Module-level `STR.<key>` captures** that freeze the default (Bangla) language at import â€” the
   cumulative i18n task already flagged 2026-06-17 (one instance fixed in HomeworkRecords). Grep for
   top-level `const â€¦ = STR.â€¦` / label maps built at module scope and move them into render.

Recommend an app-wide i18n audit: grep render code for `Bn`-suffixed field usage, module-level STR
captures, and hardcoded Bangla string literals; verify a few screens in EN mode. The account-menu
"à¦¬à¦¾à¦‚à¦²à¦¾" item is correct (language name, not a leak). **Related word-rename: see BUG-008.**
**Fix ref:** PR #118 â€” guardian-portal scope fixed; EN-mode leak sweep completed in this session.

## BUG-006 â€” Guardian portal: "Coming soon" placeholders need implementing
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** other
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Guardian "Today" home â†’ bottom row shows 5 placeholder cards all reading "Coming soon":
Attendance, Fees, Notices, Leave application, Notifications.
**Expected:** Owner expects these live in the guardian portal (the staff-side features exist).
**Actual:** Hardcoded "Coming soon" placeholder cards.
**Notes:** Source = `app/src/screens/guardian/GuardianHomeScreen.tsx:125` â€”
`const placeholders = [STR.gpAttendance, STR.gpFees, STR.gpNotices, STR.gpLeave, STR.gpPush]`.
Implemented in this session as live shortcut cards for attendance, fees, class notes, leave, and notifications.
**NOT pure wiring â€” a quick server scan (verify before building) shows guardian-facing readiness
differs per card:**
- **Attendance** â€” no `childAttendance` guardian read found; only Office-side chase/notify
  (AT4.7 `guardianChaseLink`, `studentAttendance`). Needs a NEW guardian read + screen.
- **Fees** â€” `guardianDueFor` exists in `FeeSupportService` but as an internal service fn, not a
  guardian-facing query. Needs a guardian resolver + screen.
- **Notices** â€” likely the easiest: `childClassNotes` (GP-1 Â§4.3) already returns the child's
  published notes; may just need a card/screen.
- **Leave application** â€” explicitly deferred: `StudentLeaveApplication` model comment says the
  guardian applies "via the future portal" â†’ guardian-facing flow is NOT built.
- **Notifications** (`gpPush`) â€” verify whether a guardian notification feed exists vs the bell only.

Recommend splitting into per-feature build tasks when scheduled â€” each needs its own guardian
resolver/screen gated by `guardian:read_child`. Follow the existing pattern: the portal already
ships `childRoutine` / `childHomework` / `childAssignments` / `childComments` / `childTestResults`
/ `childRevision`.
**Fix ref:** â€”

## BUG-005 â€” Rename "Change section" â†’ "Change class" (sectionâ†’class terminology, app-wide)
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18

**Repro:** Student list â†’ the "Change section" button (and the shared section picker / "My sections"
/ "Select a section" across the app). Post section-merge each class has one operational section, so
"section" reads as redundant/confusing to users.
**Expected:** "Change section" â†’ **"Change class"**, and propagate the sectionâ†’class rename to
user-facing labels across the app **where they operationally mean the class**.
**Actual:** User-facing labels say "Section" / "à¦¶à¦¾à¦–à¦¾".
**Notes:** Owner-confirmed. Primary label: `changeSection` in `app/src/lib/labels.ts`
(EN line 2902 "Change section", BN line 1069 "à¦¶à¦¾à¦–à¦¾ à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨" â†’ "à¦¶à§à¦°à§‡à¦£à¦¿ à¦ªà¦°à¦¿à¦¬à¦°à§à¦¤à¦¨"). Broader cleanup
candidates (user-facing "section" that really means the class): `selectSection` (EN 3046 / BN 1213),
`mySections` (2889 / 1056), `sectionContext` (3061), `pickSection` (3062 / 1229),
`noSectionSelected` (3065 / 1232), plus the shared `SectionBar` / `SectionPickerScreen` display.
**Keep "section" where it genuinely means a section** â€” the Section-layout / merge admin feature
(`sectionConfig` "Section layout" 2875, `scMergeBtn` "Merge sections" 2878, `scCombinedName`,
`sectionConfigHint`) is literally about merging boys+girls sections and must stay "section".
Internal model / route / permission names stay unchanged â€” **labels only**. Extends the 2026-06-17
section-terminology cleanup (which renamed the SectionBar display but not this button).
**Fix ref:** PR #118

## BUG-004 â€” List screens (Users, Student list) need a search box
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** roster
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Admin â†’ Users (full staff/teacher list) and Admin â†’ Student list (full student list,
~91 students) render as a long scroll with no way to find a specific person.
**Expected:** A search/filter box at the top of each list to filter as you type.
**Actual:** Scroll-only; no search.
**Notes:** Add a client-side search/filter input. Sources: Users = `app/src/screens/admin/UserListScreen.tsx`;
Student list = `app/src/screens/admin/RosterScreen.tsx` (title `STR.roster` = "Student list"). Suggested
filter fields: name + email/phone (Users); name + ID + phone (students). Other long list screens
(Staff list, guardians, etc.) likely want the same â€” apply consistently.
**Fix ref:** PR #118

## BUG-003 â€” Rename Academics â†’ "Content" menu/screen to "Lesson Plans"
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Academics group â†’ the "Content" menu item (and the screen header also reads "Content").
**Expected:** A clearer, more relevant name â€” owner-chosen: **"Lesson Plans"** (BN: à¦ªà¦¾à¦  à¦ªà¦°à¦¿à¦•à¦²à§à¦ªà¦¨à¦¾).
The screen surfaces `chapter_plan` + `session_plan` lesson plans; Questions and Sets already have
their own menu items, so the generic "Content" is misleading.
**Actual:** Generic label "Content" / "à¦•à¦¨à§à¦Ÿà§‡à¦¨à§à¦Ÿ".
**Notes:** Label-only change in `app/src/lib/labels.ts` â€” keys `tabContent` (EN line 2496,
BN line 663) and `contentTreeTitle` (EN line 2554, BN line 721): EN â†’ "Lesson Plans", BN â†’
à¦ªà¦¾à¦  à¦ªà¦°à¦¿à¦•à¦²à§à¦ªà¦¨à¦¾. **Route names (`ContentTab` / `ContentTree`) MUST stay unchanged** (D-#258 â€” deep-links
depend on them); this is purely the displayed strings. Label is wired via
`DrawerContent.tsx:46` (`labelKey: "tabContent"`) + `AppTabs.tsx:419` (`STR.contentTreeTitle`).
Leave the admin "Import content" card alone (separate string `importContent`).
**Fix ref:** PR #118

## BUG-002 â€” Internal dev codes (J*, ADR-*, D-#*) shown as menu subtitles to users
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Open the Admin home menu. Several cards show an internal journey/decision code as
their subtitle instead of a human description â€” Import content â†’ "J1.1", Users â†’ "J5.1",
Proxy grants â†’ "J5.4 / J5.7", Assign subject teacher â†’ "ADR-017", Assign class teacher â†’ "D-#42",
Section layout â†’ "D-#62" (and further down: Academic year / Message-templates etc. show
D-#59 / D-#60 / D-#128 / D-#193).
**Expected:** Cards show a short human-readable description (like the already-correct
"Student list â†’ Students", "Staff list â†’ Staff", "Academic year â†’ Set the active year onceâ€¦")
or no subtitle at all.
**Actual:** Raw internal codes leak to the end user.
**Notes:** Source confirmed = `app/src/screens/admin/AdminHomeScreen.tsx` â€” codes are hardcoded
`<Muted>â€¦</Muted>` card subtitles at lines 34/41/48/55/76/83/97/104/111/118 (10 total). A grep of
rendered JSX across `app/src` found these leaked codes **only** in AdminHomeScreen.tsx, so the fix
is bounded to this one file. **Fix approach (owner-chosen): Option A** â€” replace each code
subtitle with a short human-readable description (matching the already-correct cards), not just
delete the line. Owner wants the codes gone everywhere.
**Fix ref:** PR #118

## BUG-001 â€” Session Map / chapter-plan content table unreadable on narrow screens
- **Status:** fixed
- **Severity:** medium
- **Platform:** mobile-web, android-app
- **Area:** content
- **Reported:** 2026-06-18
- **Screenshot:** â€”

**Repro:** Open a chapter plan ("à¦…à¦§à§à¦¯à¦¾à¦¯à¦¼ à¦ªà¦°à¦¿à¦•à¦²à§à¦ªà¦¨à¦¾") â†’ scroll to the "à¦•à§‹à¦¨ à¦ªà¦¿à¦°à¦¿à¦¯à¦¼à¦¡à§‡ à¦•à§€ / Session Map"
section. It renders a 7-column table â€” `#`, à¦ªà¦¿à¦°à¦¿à¦¯à¦¼à¦¡à§‡à¦° à¦¶à¦¿à¦°à§‹à¦¨à¦¾à¦®, à¦†à¦œà¦•à§‡à¦° à¦²à¦•à§à¦·à§à¦¯, à¦†à¦œ à¦¯à¦¾ à¦›à§‹à¦à¦¬,
à¦†à¦œà¦•à§‡à¦° Exit-Check, à¦†à¦œà¦•à§‡à¦° à¦¬à¦¾à¦¡à¦¼à¦¿à¦° à¦•à¦¾à¦œ, à¦†à¦¨à§à¦®à¦¾à¦¨à¦¿à¦• à¦¸à¦®à¦¯à¦¼ â€” on a phone-width viewport (mobile browser
and the Android app).
**Expected:** The table is legibly readable on mobile â€” sensible column widths with horizontal
scroll, or a stacked/card layout below a breakpoint.
**Actual:** Columns are squeezed to ~1 syllable wide, so every Bangla word wraps vertically
roughly one character per line (e.g. "à¦ªà¦¿à¦°à¦¿à¦¯à¦¼à¦¡à§‡à¦° à¦¶à¦¿à¦°à§‹à¦¨à¦¾à¦®" becomes a tall stack à¦ªà¦¿/à¦°à¦¿/à¦¯à¦¼/à¦¡à§‡/à¦° â€¦).
Header and cells become extremely tall and very hard to read; the table overflows the screen
width with no usable horizontal scroll. Owner: "not user friendly."
**Notes:** Wide content tables (markdown/HTML tables embedded in chapter-plan / session-map
content) aren't responsive on narrow viewports. Fix options: wrap wide tables in a horizontal-
scroll container, render as stacked cards below a width breakpoint, or set min column widths +
allow word-level wrapping. Affects the content renderer on both the web build and the RN app;
the same component likely affects other multi-column content tables. (Drop a screenshot at
`assets/BUG-001-1.png` if a picture is wanted on record.)
**Fix ref:** PR #118
