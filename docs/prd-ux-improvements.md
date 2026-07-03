# PRD — App-wide UX Improvement Program (UX-1 … UX-7)

**Status:** Draft for build — approved by Principal 2026-07-02
**Owner:** Principal (SCD)
**Scope:** App layer (Expo/React Native) + ONE new server read (`myDay`, UX-4). No schema/vocab/enum changes.
**Traceability:** D-#265 (this program). Builds on: D-#61 (ui-guidelines), D-#258 (drawer nav), the per-class Homework dashboard pattern (STATUS 2026-07, no D-#), D-#63 (absent-only attendance — unchanged).
**Revision 1 (2026-07-03):** adds UX-8 (Class Notes teacher-first entry). Approved by Principal.

---

## 0. Quick checklist (read this first)

- [ ] Eight slices, built strictly in order **UX-1 → UX-8**. One PR per slice, off `dev`.
- [ ] UX-1..UX-3 create **shared primitives first**, then sweep call sites. Never fork a per-screen variant.
- [ ] UX-4 is the only slice with server work (one gated read, no new permission, no vocab change).
- [ ] Every slice ends GREEN on: app `tsc --noEmit`, `expo export --platform web`, server `tsc` + jest (UX-4 only), plus the slice's **manual test checklist** (§4.x.5) executed on BOTH web ≥1024px and a phone-width viewport.
- [ ] All new user-facing strings go into `app/src/lib/labels.ts` (`STR`) with **both** Bangla and English values. Bangla is the default.
- [ ] Hard rules: patch don't regenerate; one slice per PR; nothing sensitive in docs; existing route names, RBAC gates, and server contracts untouched except as §4.4 states.

## 1. Goal

Shorten and simplify every daily task in the app — especially on phones — by fixing seven **cross-cutting** UX defects found in a full code audit (2026-07-02). The audit found the shared foundations sound (tokens, 48dp targets, bilingual labels, name-based pickers, auto-selected academic year); the problems are repeated *patterns*, so shared fixes improve 100+ screens at once.

## 2. Gap table

| # | Gap (audit evidence) | Impact | Slice |
|---|---|---|---|
| G1 | Success/error `Notice` renders at the **top** of scrollable forms while Submit sits at the bottom — result invisible after tap. No toast system. 41 call sites show generic `errGeneric` instead of naming the missing field. | Users unsure whether a submit worked; retry/duplicate submits | UX-1 |
| G2 | **Zero confirmation dialogs** in the app; 32 `variant="danger"` buttons (revoke/delete/remove) fire the mutation on a single tap. | Irreversible mistakes one mis-tap away | UX-1 |
| G3 | Typed `YYYY-MM-DD` text inputs in **21 screens**; the calendar `DateField` exists but is used in only 5. | Daily friction + typo source on phones | UX-2 |
| G4 | `Select` has **no search/filter**; long flat lists (staff ~30, students 91, vocab word banks growing). Class-test still asks the teacher to **type a Set ID**. | Slow picking now, unusable at scale | UX-3 |
| G5 | **No landing dashboard** — staff land on the Content tab (first registered route) and navigate a 15-entry drawer for every task. | Every journey starts 1–2 taps too long | UX-4 |
| G6 | **Three** section-selection patterns coexist (SectionBar→picker screen; inline dropdown pair; class-button dashboard) and context doesn't carry (Homework Home picks a date on a calendar, Declare asks it typed again). | Inconsistent mental model, repeated data entry | UX-5 |
| G7 | Long single-screen forms with rarely-changed inputs always visible (Request Class Test = 9 inputs; Build Vocab Test = 2 phases on one screen). | Perceived complexity, abandonment | UX-6 |
| G8 | No `KeyboardAvoidingView` (0 uses); no pull-to-refresh (0 `RefreshControl`); all lists are `.map` in `ScrollView` (no `FlatList`); login lacks a show-password toggle. | Keyboard hides Submit on Android; stale screens; future jank | UX-7 |
| G9 | Class-note publishing is buried: Drawer → Routine → 16-button hub → find the group card → DailyNote → find your slot among the whole day's periods. The teacher searches through groups/slots that mostly aren't theirs, and the note form has a typed "Homework ID" field. | Daily task for every teacher takes 5–6 steps; ID-paste remnant | UX-8 |

## 3. Shared design rules this PRD establishes (house rules after landing)

1. **R-Feedback:** every mutation outcome surfaces via the global toast (§4.1). Inline `Notice` remains only for persistent state (e.g. an over-ceiling block), never as the sole submit feedback.
2. **R-Confirm:** every destructive action (`variant="danger"`) passes through `confirmAction()` (§4.1). No exceptions.
3. **R-Date:** `DateField` is the **only** date input. A typed date `Field` may not be introduced again.
4. **R-Validate:** client-side validation names the offending field in the field's own `error` prop AND focuses/scrolls to it; `errGeneric` is reserved for truly unknown failures.
5. **R-Search:** any `Select` that can exceed ~10 options must pass `searchable`.
6. **R-Context:** a screen never re-asks for a value (date, section) the user already set upstream in the same flow; it is passed as a route param or read from context, shown, and editable.

## 4. Slices

### 4.1 UX-1 — Feedback & safety layer

**New primitives (all in `app/src/components/` unless noted):**

1. `state/ToastContext.tsx` — `ToastProvider` + `useToast()` returning `show(message, tone?: "ok"|"danger"|"info")`. Renders a bottom-anchored, safe-area-aware pill (token colors: `primaryContainer`/`errorContainer`/`infoContainer`), auto-dismiss 3.5s, tap to dismiss, max one visible (queue length 1 — newest wins). Mount the provider in `App.tsx` inside the theme/safe-area providers, above the navigator.
2. `components/ConfirmSheet.tsx` + `state/ConfirmContext.tsx` — `useConfirm()` returning `confirmAction({ title, message, confirmLabel, tone: "danger"|"primary" }) → Promise<boolean>`. Implement as a `Modal`-based bottom sheet (works identically on web + native; do NOT use `Alert.alert` — inconsistent on web). Buttons: cancel (secondary, label `STR.cancel` "বাতিল") and confirm (danger variant when tone=danger). 48dp targets.
3. `lib/validate.ts` — tiny helper: `required(fieldsMap) → { firstErrorKey, errors }` so screens set per-field `error` props and toast the first error message.

**New STR keys (bn/en):** `cancel` (বাতিল/Cancel), `confirmTitle` (নিশ্চিত করুন/Confirm), `saved` (সংরক্ষণ হয়েছে/Saved), `fieldRequired` (এই ঘরটি পূরণ করুন/This field is required) — plus per-screen field messages as touched.

**Sweep (in this order):**
- Step 1: wire providers, build primitives, `tsc` green.
- Step 2: convert the ~32 `variant="danger"` `onPress` handlers to `if (!(await confirmAction({...}))) return;` first line. Files (from audit): `attendance/AssignMarkerScreen`, `admin/MessageTemplateEditScreen`, `admin/GuardianCredentialsScreen`, `admin/AssignSubjectTeacherScreen`, `admin/AssignClassTeacherScreen`, `admin/SupervisoryGrantScreen`, `admin/ScopeGrantScreen`, `hr/AdvancesScreen`, `hr/LeaveAdminScreen`, `hr/LeaveCoverScreen`, `hr/MyLeaveScreen`, `hr/OffboardingCaseScreen`, and every other `variant="danger"` call site (`grep -rn 'variant="danger"' app/src/screens`).
- Step 3: convert submit handlers to toast on success (`toast.show(STR.saved, "ok")` or the screen's existing success string) and toast + per-field `error` on validation failure. Start with the highest-traffic forms: `homework/DeclareHomeworkScreen`, `homework/HomeworkReconcileScreen`, `classtest/RequestClassTestScreen`, `vocab/BuildVocabTestScreen`, `attendance/MarkAttendanceScreen`, `finance/DailyEntryScreen`, `comments/CommentEntryScreen`; then sweep the remaining `setOk(`/`setError(` sites. Keep the existing `ok`/`error` state where it drives persistent UI; delete it where it was only submit feedback.

**Acceptance (Given/When/Then):**
- Given a teacher at the bottom of Declare Homework, When they submit successfully, Then a toast confirms within the viewport without scrolling, And the form resets as today.
- Given a required field empty, When submitting, Then the field shows its own red error text And a toast names it — never bare `errGeneric`.
- Given any danger button, When tapped once, Then nothing mutates until the confirm sheet's confirm is tapped; cancel leaves state untouched.

**Manual test checklist (phone + web):**
1. Declare homework with no topic → field error + toast; fix → submit → success toast visible without scrolling.
2. Revoke a proxy grant → confirm sheet appears; cancel → grant still listed; repeat → confirm → toast + row gone.
3. Dark mode: toast + confirm sheet legible in both themes.
4. Bangla and English toggle: all new strings switch.

---

### 4.2 UX-2 — Calendar dates everywhere

**Work:** replace every typed-date `Field` (`placeholder="YYYY-MM-DD"`) with the existing platform-split `DateField` (`components/DateField.tsx` / `.web.tsx`), keeping the same state variable (ISO string). Where a screen filters a range, use two `DateField`s labelled from/to (থেকে/পর্যন্ত).

**Exact call-site list (21 files, from audit):**
`assignment/AssignmentScheduleScreen`, `attendance/AssignMarkerScreen`, `attendance/AttendanceHomeScreen`, `attendance/AttendanceReportScreen`, `classtest/RequestClassTestScreen`, `comments/MeetingsListScreen`, `finance/DailyEntryScreen`, `finance/DailySnapshotScreen`, `finance/FeesZakatScreen`, `finance/QardIouScreen`, `finance/ReconciliationScreen`, `guardian/ChildAttendanceScreen`, `guardian/ChildHomeworkScreen`, `guardian/ChildLeaveScreen`, `homework/DeclareHomeworkScreen`, `homework/HomeworkReconcileScreen`, `notifications/NotificationCenterScreen`, `revision/RevisionHomeScreen`, `sets/AssembleSetScreen`, `vocab/BuildVocabTestScreen`, `vocab/VocabAssignmentScreen`.

**Steps:** (1) extend `DateField` if needed so it accepts `label`, `value` (ISO string | ""), `onChange(iso)`, optional `min`/`max`; (2) mechanical sweep, one module per commit inside the slice PR; (3) re-run the audit grep — `grep -rn 'YYYY-MM-DD' app/src/screens` must return **zero**.

**Acceptance:** Given any date input in the app, When tapped, Then a native picker (phone) or browser date input (web) opens; typed free-text dates are impossible.

**Manual test checklist:** open one screen per module above on phone-width; pick a date; verify the stored/submitted value behaves as before (e.g. class-test exam date lands correctly in the print queue). Verify guardian date filters still constrain results.

---

### 4.3 UX-3 — Searchable pickers; kill the last ID fields

**Work:**
1. Add `searchable?: boolean` to `Select` (`components/ui.tsx`): when open and searchable, render a filter `TextInput` pinned above the options list; filter matches label + hint, case/whitespace-insensitive; works with Bangla text as plain substring match. Keyboard stays open while tapping options (`keyboardShouldPersistTaps` already set).
2. Turn on `searchable` in: `StaffSelect`, `TeacherSelect`, and any Select fed by roster/staff/word lists (`components/selects.tsx`, `components/vocabPickers.tsx` call sites).
3. **Set picker (class test):** in `classtest/RequestClassTestScreen`, replace the typed `Set ID` `Field` with a `Select` fed by the caller's assembled sets (existing sets list query from the Sets module, filtered client-side to the chosen subject/class where the data allows), label = set name/id, hint = subject·class. Keep a collapsed "advanced: enter id manually" escape hatch under a ghost button in case an old set isn't listed.
4. **Vocab word selection:** in `vocab/BuildVocabTestScreen` step 2, add a filter `Field` above each direction's chip grid that narrows the rendered chips (client-side); show `selected n / shown m` counts.

**Acceptance:** Given 30+ options, When the user types 2+ characters, Then the list narrows live; Given Request Class Test, When choosing the pool-set source, Then the teacher picks a set by name — no pasted ID on the happy path.

**Manual test checklist:** pick a staff member by typing part of a Bangla name; build a class-test request end-to-end without typing any ID; vocab step-2 filter narrows chips and selections survive filtering.

---

### 4.4 UX-4 — Staff **Today** dashboard + landing route (server + app)

**Server (one gated read, no new permission, no vocab/enum change):**
- New query `myDay(date: String!): MyDay` in the routine/homework seam, `authenticated`, internally reusing existing scope logic only:
  - `slots`: the caller's enriched routine slots for the date (reuse the `myRoutineSlots`/`routineForDate` enrichment — teacherName, startTime, endTime, subject, section).
  - `homework`: `{ pendingChecking, openResubmissions, activeChases }` summed over the caller's accessible refs (reuse the `homeworkClassOverview` per-ref logic; skip unreadable refs exactly as it does).
  - `attendancePending`: Boolean — true if the caller marks attendance for ≥1 section (marker/class-teacher path, existing gates) and today's record is absent.
- Jest: one focused suite — teacher sees own slots only; counts match `homeworkClassOverview`; guardian/office callers get empty slots without error.

**App:**
- New `screens/home/TodayScreen.tsx` in a new `HomeTab` stack, registered **first** in the drawer for staff (`DrawerContent` STAFF_NAV top: `{ route: "HomeTab", labelKey: "drawerItemToday", icon: "🏠" }`) — mirrors the guardian `gpToday` pattern. Landing = HomeTab (drawer initial route for staff).
- Layout (top→bottom): date header (today, Bangla day name) · **My periods** card (time · subject · class; empty state for holidays via existing day-type label) · **Pending work** card with tappable count rows deep-linking: pending checking → Homework Checking, chases → Homework home, attendance pending → Attendance home · **Quick actions** chip row: হোমওয়ার্ক দিন (Declare), উপস্থিতি (Attendance), ক্লাস টেস্ট (Request CT) — rendered only when the role holds the target tab's existing gate (reuse the same `roleHasPermission` checks AppTabs uses; no new gating logic).
- Focus-refetch on screen focus (match HomeworkHome's pattern). New STR keys: `drawerItemToday` (আজ/Today), `myPeriods` (আমার ক্লাস/My periods), `pendingWork` (বাকি কাজ/Pending work), `quickActions` (দ্রুত কাজ/Quick actions).

**Acceptance:** Given a logged-in teacher, When the app opens, Then Today renders their periods + pending counts within one screen and each count opens the exact work queue in ≤1 tap. Given a Principal, Then Today renders (periods possibly empty) and quick actions reflect their permissions. Guardian navigation is untouched.

**Manual test checklist:** login as Teacher / Principal / Office / Guardian: landing correct per role; counts match the Homework dashboard's numbers for the same sections; deep links land on the right screens; holiday date shows the day-type empty state; drawer highlight tracks Today as active.

---

### 4.5 UX-5 — One section-selection pattern + context carry-through

**Decision:** the **class-button dashboard** pattern (Homework home) is the house pattern for module landing screens; `SectionContext` remains the single storage. The full-screen `SectionPickerScreen` is retired from daily flows (kept only where a cross-year pick is genuinely needed).

**Work:**
1. Extract Homework home's class-buttons + section-row into a reusable `components/ClassSectionDashboard.tsx` (props: accessible refs, per-class badge counts?, onSelect → writes `SectionContext`).
2. Adopt it on the Trackers and Sets landings (the two remaining SectionBar→picker flows), preserving each module's downstream screens unchanged.
3. **Context carry:** `DeclareHomeworkScreen` receives the date chosen on Homework home as a route param (editable `DateField`, prefilled) and stops asking again; audit other same-flow re-asks (Reconcile ← home date) and fix identically.
4. `SectionBar` remains as the compact "current selection + change" strip on inner screens.

**Acceptance:** Given a teacher on any module landing, When they tap their class, Then downstream screens inherit section AND date without re-entry; Given one accessible section, Then it auto-selects (existing behavior preserved).

**Manual test checklist:** Homework declare inherits home's date; Trackers landing shows class buttons and a one-section teacher lands straight in; switching class on one module is reflected on the others (shared context).

---

### 4.6 UX-6 — Form shortening (defaults + advanced folds)

**Work (per-screen passes, same recipe: sensible default → move to a collapsed "আরও অপশন / More options" fold):**
1. `classtest/RequestClassTestScreen`: defaults — pass mark = ⌈total × 0.33⌉ (editable), deadline days = existing house default (confirm from server default; else 3), test number already auto-suggested. Fold: pass mark, deadline, notes. Visible core: section, subject, source, paper/set, exam date, total marks → **9 inputs → 5 visible**.
2. `vocab/BuildVocabTestScreen`: render as two explicit numbered steps with a step header (১/২) and a disabled step-2 until created; fold test date + half-miss into "More options".
3. `finance/DailyEntryScreen`: date defaults to today (DateField prefilled); repeat-entry flow keeps the date and clears only amount/description.
4. `homework/DeclareHomeworkScreen`: fold pool-ref + revision flag; time defaults to 20 (already) — keep visible.

**Acceptance:** Given each form above, Then the visible input count on first paint is ≤6 and a complete happy-path submit needs no fold opened.

**Manual test checklist:** file a class test touching only the 5 core inputs; verify the derived pass mark lands server-side; vocab build walks 1→2 with the fold closed; finance repeat entry keeps the date.

---

### 4.7 UX-7 — Mobile hygiene sweep

**Work:**
1. `Screen` primitive (`components/ui.tsx`): wrap content in `KeyboardAvoidingView` (behavior `padding` iOS / `height` Android) so bottom fields and Submit stay visible — one change, app-wide effect. Verify no layout regression on the wide/web frame.
2. Pull-to-refresh: add `RefreshControl` wired to the screen's refetch on list-style screens (start: NotificationCenter, HomeworkRecords, CheckingQueue, ChatHome, guardian screens; then sweep landings).
3. `FlatList` conversion for the lists most likely to grow: NotificationCenter, VocabWordBank, ChatThread messages, Roster. Keep `.map` elsewhere (91-student scale).
4. Login: show/hide password eye toggle; `keyboardType="email-address"` + `autoComplete` hints on the identifier field.

**Acceptance:** Given a bottom form field focused on a phone, Then it is visible above the keyboard; Given a stale list screen, When pulled down, Then it refetches with a spinner.

**Manual test checklist (Android web-view/phone-width emphasis):** focus the last field on Declare Homework — Submit reachable; pull-to-refresh on Notifications; scroll a 200-item word bank without jank; login with password visible toggle.

---

### 4.8 UX-8 — Class Notes: teacher-first drawer entry

**Principle:** the routine already knows which periods this teacher taught — never ask them to pick class/subject for their own notes. (D-#266)

**App work (no server change):**
1. New `screens/classnotes/MyClassNotesScreen.tsx` — root of a new `ClassNotesTab` stack, gated `routine:read` (same gate as DailyNote; reuse the exact `roleHasPermission` convention from AppTabs).
   - Header: `DateField` prefilled today (catch-up allowed by changing it).
   - Body: the caller's own slots for that date via the existing `myRoutineSlots`/enriched routine read (`teacherName`, `startTime`–`endTime`, subject, group) — non-break slots only, one Card per period the teacher taught: `Period n · time · subject · group`.
   - Per card: "Published ✓" badge when a note exists (reuse the `classNotesForDate` read per slot's group, or the slot-keyed note map exactly as DailyNote builds it), else an inline note box: multiline taught-summary `Field` + publish `Button` (`publishClassNote`, unchanged mutation). UX-1 rules apply: toast on success, field-level error when the summary is empty.
   - Empty states: holiday → existing day-type label; no slots that date → `STR.rtNoSlots`.
2. **Homework link picker:** replace the typed `Homework ID` field with a `Select` of that day's declared homework items for the slot's section+subject, reusing the same day-items read `HomeworkReconcileScreen` uses; auto-link silently when exactly one item exists; show the Select only when >1. If no existing app-side read exposes the day's items for (section, subject, date), keep the typed field inside a collapsed "আরও অপশন" fold and record the gap in STATUS as a follow-up — do NOT add a server read in this slice.
3. **Drawer:** new top-level flat item between Attendance and Comments in `DrawerContent` STAFF_NAV: `{ type: "item", route: "ClassNotesTab", labelKey: "drawerItemClassNotes", icon: "📓" }`. New STR keys: `drawerItemClassNotes` (ক্লাস নোট/Class Notes), `cnMyPeriods` (আমার পিরিয়ড/My periods). Additive drawer screen — no nav-state key bump.
4. **Untouched:** the group-based `DailyNoteScreen` and its Routine Home entry stay as the admin/cover/Principal path; `ClassNoteReportScreen` unchanged; guardian reads unchanged.
5. **After UX-4 lands:** add a Today quick-action chip "ক্লাস নোট" deep-linking to `ClassNotesTab` (one-line follow-up inside the UX-4 or UX-8 PR, whichever lands second).

**Acceptance (Given/When/Then):**
- Given a teacher who taught 3 periods today, When they open Class Notes from the drawer, Then exactly their 3 periods render with published/pending status, And publishing a note takes tap-period → type → publish with no class/subject selection.
- Given a period whose section+subject has exactly one declared homework that day, When the note is published, Then it links automatically; given several, Then a name-based Select offers them.
- Given the Principal, When they need to publish for another group, Then the existing Routine → DailyNote path works unchanged.

**Manual test checklist (phone + web):**
1. Teacher with multi-period day: only own periods listed; publish one → toast + badge; re-open → badge persists.
2. Change the date to yesterday → publish a catch-up note; holiday date → day-type empty state.
3. Homework auto-link: declare one HW for the section+subject, publish a note, verify the guardian class-note view shows the link; with two declared items, the picker appears.
4. Cover teacher on an active proxy day sees the covered period; Principal path via Routine Home unchanged.
5. Bangla/English toggle + dark mode on the new screen.

## 5. Out of scope

- Any RBAC/permission change, route renames, or server contract changes beyond §4.4's `myDay`.
- Redesign of Attendance marking (absent-only pattern is good — untouched), routine master grid, guardian navigation.
- Offline queueing, push notifications, per-user AC client-tab lighting (known limitation, separate track).

## 6. Reused / unchanged

Theme tokens + ui-guidelines (D-#61); drawer IA (D-#258); `SectionContext` storage; `DateField`, `friendlyError`, focus-refetch pattern; all GraphQL operations except the added `myDay`; all Jest suites (additive only).

## 7. Contract-sync note

No mirrored enum, no `shared/vocab.ts` change, no import-envelope change. UX-4 adds one GraphQL read type (`MyDay`) — server-owned, no wire vocab. The vocab verifier must still pass untouched on every slice.

## 8. Build order & PR shape

`feat/ux-1-feedback` → `feat/ux-2-dates` → `feat/ux-3-search` → `feat/ux-4-today` → `feat/ux-5-sections` → `feat/ux-6-forms` → `feat/ux-7-hygiene` → `feat/ux-8-classnotes`, each off `dev`, sequential (each assumes the previous landed). UX-8 depends only on UX-1 primitives and may be pulled earlier by the Principal. Gate per slice: app `tsc --noEmit` + `expo export --platform web`; UX-4 adds server `tsc` + jest; every slice executes its §4.x.5 manual checklist on phone-width and ≥1024px web before merge.

**Next = build UX-1 per docs/prd-ux-improvements.md §4.1, slice order UX-1→UX-7.**
