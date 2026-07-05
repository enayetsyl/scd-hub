# Issue backlog

Issues found while testing the app. **Newest first.** Schema, allowed values, and the
intake/fix procedures live in [README.md](README.md). To add one: paste the issue
(+ screenshot + platform) in chat and say *"log this"*.

<!-- TEMPLATE — copy below the line for a new issue (newest goes at the top of the list):

## BUG-NNN — short title
- **Status:** open
- **Severity:** medium
- **Platform:** android-app, web
- **Area:** homework
- **Reported:** YYYY-MM-DD
- **Screenshot:** —

**Repro:**
**Expected:**
**Actual:**
**Notes:**
**Fix ref:** —

-->

---

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

## BUG-013 — Upload paper button does not attach the selected file
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** class-test
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Open "New print request" and tap "Upload paper", then choose a file from the picker.
**Expected:** The selected file should attach/upload and be reflected in the form.
**Actual:** Selecting a file does not upload it.
**Notes:** The upload pipeline itself is healthy — verified end-to-end in this session (an exact replica of the app's web upload code POSTed to the local server's `/files/classtest` → 200 + fileId, Drive included; ~2.3s round-trip). The defect was feedback: the Upload button had NO busy state and success showed only a small grey caption, so the multi-second Drive upload read as "nothing happened" (and a re-tap could start a second pick). Fixed: busy spinner + সেভ হচ্ছে label during the upload, a success toast naming the attached file, double-tap guard; error toast was already present. RETEST on local — if the button now sticks on busy or toasts an error, that output pinpoints the real environment issue.
**Fix ref:** fix/ux-testing-bugs

## BUG-012 — Unexpected characters in attendance upload hint
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** attendance
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Open Attendance home and look at the "Teacher attendance upload" card.
**Expected:** The upload hint should show normal punctuation and readable text.
**Actual:** The hint contains unexpected characters after `.xlsx` in the sentence "Upload the biometric Employee Attendance Report (.xlsx) — the date is read from the sheet."
**Notes:** Same root cause as BUG-009 — the em-dash in this hint string in `labels.ts` was double-encoded (UTF-8 read as CP1252). Covered by the BUG-009 encoding repair.
**Fix ref:** fix/ux-testing-bugs (with BUG-009)

## BUG-011 — Loading text shows an extra symbol
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** other
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Trigger any loading state in the app.
**Expected:** Loading UI should show only the loading text.
**Actual:** A symbol appears alongside the loading text and should be removed.
**Notes:** Same root cause as BUG-009 — the "extra symbol" was the loading label's ⏳ hourglass emoji rendered as mojibake after the CP1252 double-encoding. After the repair it renders as the intended ⏳ (that emoji is by design; say the word if it should be dropped entirely).
**Fix ref:** fix/ux-testing-bugs (with BUG-009)

## BUG-010 — Proxy grant add/remove does not show toast
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** admin
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Add or remove a proxy grant from the admin flow.
**Expected:** A success or failure toast should appear after the action.
**Actual:** No toast is shown.
**Notes:** `ScopeGrantScreen` was still on the pre-UX-1 inline-`Notice` pattern (part of the deliberately deferred ~70-file long-tail): assign/extend messages rendered as a Notice that sits above the grants list — off-viewport when you act on a card further down — and errors only ever used the "ok" tone. Converted all assign/revoke/extend outcomes (success, mutation error, validation error) to `useToast()` per R-Feedback and removed the submit-only Notice state.
**Fix ref:** fix/ux-testing-bugs

## BUG-009 — Bangla UI text renders as mojibake
- **Status:** fixed
- **Severity:** medium
- **Platform:** web
- **Area:** other
- **Reported:** 2026-07-03
- **Screenshot:** —

**Repro:** Open the app and view the main shell / form screen shown in the screenshot. Many Bangla labels render as mojibake (`অ...`) instead of readable Bangla, including the page title, left navigation items, card headings, helper text, and the red validation messages.
**Expected:** Bangla UI text should render normally and remain readable across the shell and form labels.
**Actual:** The app shows corrupted Bangla strings throughout the screen, making the labels unreadable.
**Notes:** Root cause found: commit 5dc1352 (2026-07-01, class-note submission report) re-saved `app/src/lib/labels.ts` through a CP1252 decode, double-encoding ~26k characters — every pre-existing Bangla/emoji/punctuation string became mojibake, while keys added by later commits stayed correct (why the new UX drawer items rendered fine next to a garbled shell). `GuardianHomeScreen.tsx`, this BACKLOG file, and 7 CHANGELOG rows were corrupted the same way. Fix = segment-wise reverse transform (CP1252+C1-fallback re-encode → UTF-8 decode), verified against the last-good pre-corruption `labels.ts` (26dc7a8; only legitimate post-06-28 edits differ). Also covers BUG-011 + BUG-012. Watch-out: whichever tool/editor wrote 5dc1352 must enforce UTF-8 before touching these files again.
**Fix ref:** fix/ux-testing-bugs (BUG-009 + BUG-011 + BUG-012 in one repair)

## BUG-008 — Reword homework Bangla labels: যাচাই → দেখা, তাগাদা → মনে করানো
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** homework
- **Reported:** 2026-06-18

**Context:** Owner wants friendlier Bangla wording for two homework terms (seen on the guardian
"Today" home + the staff checking/chase screens). **Owner-approved replacements:**
- **যাচাই** (jachai, "verify") → base **দেখা** ("review/see"): status "যাচাই হয়েছে" → "দেখা হয়েছে";
  "যাচাই তালিকা" → "দেখার তালিকা"; "যাচাই করুন / যাচাই" → "দেখুন"; "যাচাইয়ের অপেক্ষায়" → "দেখার অপেক্ষায়".
- **তাগাদা** (tagada, "dunning") → **"মনে করিয়ে দিন"** ("remind") for the action button; use a noun
  form ("স্মরণ" / "মনে করানো") for list/count labels: "আবার তাগাদা" → "আবার মনে করিয়ে দিন";
  "তাগাদা তালিকা" → "স্মরণ তালিকা"; "মোট তাগাদা" → "মোট স্মরণ". (NOTE: "মনে করিয়ে দিন" is imperative and
  doesn't nominalize cleanly — noun contexts read awkwardly; a short noun like "স্মরণ" fits there.)

**Where to change:**
1. **`shared/vocab.ts:603` `LIFECYCLE_STATE_LABELS_BN` (CONTRACT FILE)** — CHECKED "যাচাই হয়েছে" → "দেখা হয়েছে", CHASE "তাগাদা" → button form. This is the source of the guardian chip text via `GuardianPortalService.ts:409`. **Must run `npx tsx skills/_tools/verify_shared_vocab.mjs docs/import-contract.schema.json` after.** GIVEN "প্রদান করা হয়েছে" stays. Consider matching `LIFECYCLE_STATE_LABELS_EN` (CHECKED → "Reviewed"? CHASE → "Remind"?) if EN parity is wanted.
2. **`app/src/lib/labels.ts` homework keys** (~lines 803–847) — `hwCheck` / `hwChecking` / `hwCheckingTitle` / `hwCheckHint` / `hwGoChecking` / `hwNoSubmitted` (যাচাই→দেখা) and `hwChaseAction` / `hwChaseAgain` / `hwChaseList` / `hwChaseVolume` (তাগাদা→মনে করানো/স্মরণ).

**Scope decision (owner):** যাচাই/তাগাদা also appear in **assignment** (`asCheck`, `asChaseVolume`,
`asCheckTitle`…), **revision** (`revChaseTitle`, `rvAwaiting`), **attendance** (`attPreview`
"যাচাই করুন"), **finance** (`finChase` "তাগাদা দিন", `finChaseFeeDue`). Apply the same rename there for
consistency? — **except finance**, where তাগাদা (dunning) is arguably the RIGHT tone for a fee-due
reminder; likely keep তাগাদা for fees. Decide before fixing.
**Relates:** BUG-007 — if the guardian chips switch to client-side STR mapping, their text comes from
`labels.ts` instead of `stateLabelBn`; coordinate so the wording isn't changed in only one place.
**Fix ref:** PR #118

## BUG-007 — English mode still shows Bangla labels in many places (i18n leak)
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** other
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Set the app to English (account menu → language). On the guardian "Today" home the
homework status chips still render in Bangla — "যাচাই হয়েছে" (checked), "প্রদান করা হয়েছে" (given),
"তাগাদা" (chase) — and subject names render in Bangla. Owner reports "lots of places" show Bangla
in EN mode.
**Expected:** In English mode all UI labels render in English (subject names may be a deliberate
exception — confirm with owner).
**Actual:** Many labels stay Bangla regardless of the selected language.
**Notes:** Concrete instance pinned = `GuardianHomeScreen.tsx` line 252 renders `r.stateLabelBn`
and line 249 renders `r.subjectLabelBn` — **server-provided Bangla-only fields** displayed directly
regardless of app language. The sweep now covers the guardian home, shared section chooser/bar,
routine landing, homework dashboard, roster, assignment marker, attendance marker, and class-note
report. Subject names may remain Bangla by design unless the owner asks for translation. TWO distinct
root-cause classes to sweep:
1. **Server `*Bn`-only fields rendered directly** (e.g. `stateLabelBn` / `subjectLabelBn`). Fix:
   map the enum the app already holds (`r.state`, subject code) to a localized `STR` label
   client-side, or have the server return both EN + BN.
2. **Module-level `STR.<key>` captures** that freeze the default (Bangla) language at import — the
   cumulative i18n task already flagged 2026-06-17 (one instance fixed in HomeworkRecords). Grep for
   top-level `const … = STR.…` / label maps built at module scope and move them into render.

Recommend an app-wide i18n audit: grep render code for `Bn`-suffixed field usage, module-level STR
captures, and hardcoded Bangla string literals; verify a few screens in EN mode. The account-menu
"বাংলা" item is correct (language name, not a leak). **Related word-rename: see BUG-008.**
**Fix ref:** PR #118 — guardian-portal scope fixed; EN-mode leak sweep completed in this session.

## BUG-006 — Guardian portal: "Coming soon" placeholders need implementing
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** other
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Guardian "Today" home → bottom row shows 5 placeholder cards all reading "Coming soon":
Attendance, Fees, Notices, Leave application, Notifications.
**Expected:** Owner expects these live in the guardian portal (the staff-side features exist).
**Actual:** Hardcoded "Coming soon" placeholder cards.
**Notes:** Source = `app/src/screens/guardian/GuardianHomeScreen.tsx:125` —
`const placeholders = [STR.gpAttendance, STR.gpFees, STR.gpNotices, STR.gpLeave, STR.gpPush]`.
Implemented in this session as live shortcut cards for attendance, fees, class notes, leave, and notifications.
**NOT pure wiring — a quick server scan (verify before building) shows guardian-facing readiness
differs per card:**
- **Attendance** — no `childAttendance` guardian read found; only Office-side chase/notify
  (AT4.7 `guardianChaseLink`, `studentAttendance`). Needs a NEW guardian read + screen.
- **Fees** — `guardianDueFor` exists in `FeeSupportService` but as an internal service fn, not a
  guardian-facing query. Needs a guardian resolver + screen.
- **Notices** — likely the easiest: `childClassNotes` (GP-1 §4.3) already returns the child's
  published notes; may just need a card/screen.
- **Leave application** — explicitly deferred: `StudentLeaveApplication` model comment says the
  guardian applies "via the future portal" → guardian-facing flow is NOT built.
- **Notifications** (`gpPush`) — verify whether a guardian notification feed exists vs the bell only.

Recommend splitting into per-feature build tasks when scheduled — each needs its own guardian
resolver/screen gated by `guardian:read_child`. Follow the existing pattern: the portal already
ships `childRoutine` / `childHomework` / `childAssignments` / `childComments` / `childTestResults`
/ `childRevision`.
**Fix ref:** —

## BUG-005 — Rename "Change section" → "Change class" (section→class terminology, app-wide)
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18

**Repro:** Student list → the "Change section" button (and the shared section picker / "My sections"
/ "Select a section" across the app). Post section-merge each class has one operational section, so
"section" reads as redundant/confusing to users.
**Expected:** "Change section" → **"Change class"**, and propagate the section→class rename to
user-facing labels across the app **where they operationally mean the class**.
**Actual:** User-facing labels say "Section" / "শাখা".
**Notes:** Owner-confirmed. Primary label: `changeSection` in `app/src/lib/labels.ts`
(EN line 2902 "Change section", BN line 1069 "শাখা পরিবর্তন" → "শ্রেণি পরিবর্তন"). Broader cleanup
candidates (user-facing "section" that really means the class): `selectSection` (EN 3046 / BN 1213),
`mySections` (2889 / 1056), `sectionContext` (3061), `pickSection` (3062 / 1229),
`noSectionSelected` (3065 / 1232), plus the shared `SectionBar` / `SectionPickerScreen` display.
**Keep "section" where it genuinely means a section** — the Section-layout / merge admin feature
(`sectionConfig` "Section layout" 2875, `scMergeBtn` "Merge sections" 2878, `scCombinedName`,
`sectionConfigHint`) is literally about merging boys+girls sections and must stay "section".
Internal model / route / permission names stay unchanged — **labels only**. Extends the 2026-06-17
section-terminology cleanup (which renamed the SectionBar display but not this button).
**Fix ref:** PR #118

## BUG-004 — List screens (Users, Student list) need a search box
- **Status:** fixed
- **Severity:** medium
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** roster
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Admin → Users (full staff/teacher list) and Admin → Student list (full student list,
~91 students) render as a long scroll with no way to find a specific person.
**Expected:** A search/filter box at the top of each list to filter as you type.
**Actual:** Scroll-only; no search.
**Notes:** Add a client-side search/filter input. Sources: Users = `app/src/screens/admin/UserListScreen.tsx`;
Student list = `app/src/screens/admin/RosterScreen.tsx` (title `STR.roster` = "Student list"). Suggested
filter fields: name + email/phone (Users); name + ID + phone (students). Other long list screens
(Staff list, guardians, etc.) likely want the same — apply consistently.
**Fix ref:** PR #118

## BUG-003 — Rename Academics → "Content" menu/screen to "Lesson Plans"
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Academics group → the "Content" menu item (and the screen header also reads "Content").
**Expected:** A clearer, more relevant name — owner-chosen: **"Lesson Plans"** (BN: পাঠ পরিকল্পনা).
The screen surfaces `chapter_plan` + `session_plan` lesson plans; Questions and Sets already have
their own menu items, so the generic "Content" is misleading.
**Actual:** Generic label "Content" / "কন্টেন্ট".
**Notes:** Label-only change in `app/src/lib/labels.ts` — keys `tabContent` (EN line 2496,
BN line 663) and `contentTreeTitle` (EN line 2554, BN line 721): EN → "Lesson Plans", BN →
পাঠ পরিকল্পনা. **Route names (`ContentTab` / `ContentTree`) MUST stay unchanged** (D-#258 — deep-links
depend on them); this is purely the displayed strings. Label is wired via
`DrawerContent.tsx:46` (`labelKey: "tabContent"`) + `AppTabs.tsx:419` (`STR.contentTreeTitle`).
Leave the admin "Import content" card alone (separate string `importContent`).
**Fix ref:** PR #118

## BUG-002 — Internal dev codes (J*, ADR-*, D-#*) shown as menu subtitles to users
- **Status:** fixed
- **Severity:** low
- **Platform:** web, mobile-web, android-app, ios-app
- **Area:** nav
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Open the Admin home menu. Several cards show an internal journey/decision code as
their subtitle instead of a human description — Import content → "J1.1", Users → "J5.1",
Proxy grants → "J5.4 / J5.7", Assign subject teacher → "ADR-017", Assign class teacher → "D-#42",
Section layout → "D-#62" (and further down: Academic year / Message-templates etc. show
D-#59 / D-#60 / D-#128 / D-#193).
**Expected:** Cards show a short human-readable description (like the already-correct
"Student list → Students", "Staff list → Staff", "Academic year → Set the active year once…")
or no subtitle at all.
**Actual:** Raw internal codes leak to the end user.
**Notes:** Source confirmed = `app/src/screens/admin/AdminHomeScreen.tsx` — codes are hardcoded
`<Muted>…</Muted>` card subtitles at lines 34/41/48/55/76/83/97/104/111/118 (10 total). A grep of
rendered JSX across `app/src` found these leaked codes **only** in AdminHomeScreen.tsx, so the fix
is bounded to this one file. **Fix approach (owner-chosen): Option A** — replace each code
subtitle with a short human-readable description (matching the already-correct cards), not just
delete the line. Owner wants the codes gone everywhere.
**Fix ref:** PR #118

## BUG-001 — Session Map / chapter-plan content table unreadable on narrow screens
- **Status:** fixed
- **Severity:** medium
- **Platform:** mobile-web, android-app
- **Area:** content
- **Reported:** 2026-06-18
- **Screenshot:** —

**Repro:** Open a chapter plan ("অধ্যায় পরিকল্পনা") → scroll to the "কোন পিরিয়ডে কী / Session Map"
section. It renders a 7-column table — `#`, পিরিয়ডের শিরোনাম, আজকের লক্ষ্য, আজ যা ছোঁব,
আজকের Exit-Check, আজকের বাড়ির কাজ, আনুমানিক সময় — on a phone-width viewport (mobile browser
and the Android app).
**Expected:** The table is legibly readable on mobile — sensible column widths with horizontal
scroll, or a stacked/card layout below a breakpoint.
**Actual:** Columns are squeezed to ~1 syllable wide, so every Bangla word wraps vertically
roughly one character per line (e.g. "পিরিয়ডের শিরোনাম" becomes a tall stack পি/রি/য়/ডে/র …).
Header and cells become extremely tall and very hard to read; the table overflows the screen
width with no usable horizontal scroll. Owner: "not user friendly."
**Notes:** Wide content tables (markdown/HTML tables embedded in chapter-plan / session-map
content) aren't responsive on narrow viewports. Fix options: wrap wide tables in a horizontal-
scroll container, render as stacked cards below a width breakpoint, or set min column widths +
allow word-level wrapping. Affects the content renderer on both the web build and the RN app;
the same component likely affects other multi-column content tables. (Drop a screenshot at
`assets/BUG-001-1.png` if a picture is wanted on record.)
**Fix ref:** PR #118
