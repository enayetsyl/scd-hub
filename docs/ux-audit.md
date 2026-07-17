# SCD Hub — UX / UI Audit (2026-07-16)

**Status:** audit 2026-07-16; **F2, F3, F14 FIXED 2026-07-16** (branch `fix/f2-f3-error-states`: shared
`QueryGate` + netinfo offline detection swept over all 30 error-less screens, retry wired on the 4 dead
ErrorBanners, ConfirmSheet + result handling on the 3 unconfirmed destructive mutations). **F1 FIXED
2026-07-17** (branch `feat/ux-audit-f1-tracker-entry`: TrackerEntry rebuilt per the approved "এক ট্যাপে
ট্র্যাকিং" prototype — one-tap `OutcomeSegment` rows with optimistic save + আনডু toast, `BatchBar` one-tap
batch via a new `recordEntries` server mutation (fills unrecorded rows only), `ScoreSheet` numpad for marks,
sticky progress header, server-state hydration via client-side sha256 pseudonym matching, QueryGate adoption,
confirm-close → per-student TrackerSummary). **F4, F5, F6, F10 (+F15, F16) FIXED 2026-07-17** (branch
`feat/ux-audit-f4-question-bank`: QuestionBank rebuilt per the approved "প্রশ্ন খুঁজুন ও বাছাই করুন" prototype —
`SearchField` (debounced text+qid search, Bangla-digit "৪২"→HW-0042 via a new server `search` arg),
`FilterBar` active chips + `FilterSheet` with টপিক ট্যাগ (new `questionTopicTags` distinct query) and review
status wired, filters+search persisted via `QuestionBankContext` (storage-backed, survive restarts; selection
survives navigation via BasketContext), `SelectableCard` checkbox multi-select + sticky `SelectionTray`,
grapheme-safe `numberOfLines` clamp replacing `truncate()`, true cursor pagination (`after` arg, pages append),
and a one-step `CreateSetSheet` (reorder ▲/▼, HW/AS/CT, due date/duration) calling a new transactional
`createSetWithQuestions` mutation — validate-all-then-one-write, so a failure can never leave a half-set;
BasketScreen/AssembleSetScreen retained for the draft-edit path). Other findings open.
**Method:** static analysis of all 174 screen files + shared components/theme; no runtime testing.
**Baseline:** this audit is *post* UX-1…UX-8 (D-#265) and post ui-guidelines adoption (D-#61). It does not
re-report gaps those programs already fixed (toasts, confirm sheets, DateField, searchable Select,
KeyboardAvoiding, landing dashboards). It measures what is true in the code **today**.

---

## 1. App map

### 1.1 Navigation structure

React Navigation: one root native-stack (auth gate) → a single **grouped drawer** (D-#258; permanent
push-sidebar on web/wide, slide-over on phone) → 28 per-tab native-stacks (24 staff + 4 guardian).
Two root-level modals: NotificationCenter (🔔 in every header) and ReportProblem. Header right on every
stack: bell + avatar menu (language bn/en toggle, report-problem, logout). Nav state persists on web.

- **Teacher entry:** `HomeTab → TodayScreen` (`myDay` dashboard).
- **Principal/Office entry:** `HomeTab → AdminTodayScreen` (`adminToday` card dashboard). Same route name `Today`, picked by role.
- **Guardian entry:** `GuardianHomeTab → GuardianHomeScreen` (child-today); guardians see only 4 tabs.
- Drawer items/groups are permission-gated per role (`roleHasPermission`); staff and guardian route sets are disjoint.
- Drawer groups (Bangla labels by default): Today 🏠 · **Academics** 📖 (Content, Questions, Sets, Review, Routine, Vocab) · **Trackers** ✅ (Daily Tracker, Homework, Assignment, ClassTest, Revision) · Attendance 🙋 · Print 🖨️ · ClassNotes 📓 · Comments 🗣️ · Observation 👁️ · Library 📖 · Chat 💬 · Finance 💰 · HR 🧑‍💼 · **Reports** 📊 (7 deep-links) · Admin ⚙️.
- Badges: Questions tab shows basket count; Print tab shows to-print/to-deliver counters (poll + SSE).

Key files: [RootNavigator.tsx](../app/src/navigation/RootNavigator.tsx), [AppTabs.tsx](../app/src/navigation/AppTabs.tsx) (stacks + gating), [DrawerContent.tsx](../app/src/navigation/DrawerContent.tsx), [types.ts](../app/src/navigation/types.ts), [App.tsx](../app/App.tsx) (provider tree: Sentry → Gesture → SafeArea → Urql → Language → Auth → Basket → Section → Sidebar → Toast → Confirm → UpdateGate → WebPushGate → Navigation).

### 1.2 Screen inventory (173 screens, 27 modules)

One line per module; the per-screen tables live in the navigation agent transcripts and in
[AppTabs.tsx](../app/src/navigation/AppTabs.tsx), which is the authoritative registry.

| Module (count) | What it covers | Primary role |
|---|---|---|
| home (2) | TodayScreen (teacher `myDay`), AdminTodayScreen (admin cards) | Teacher / Principal-Office |
| questions (3) | QuestionBank (filter + add-to-basket), QuestionPreview, Basket | Teacher |
| sets (3) | SetList, SetDetail (+PDF export), AssembleSet (finalize) | Teacher |
| trackers (5) | TrackerList, OpenTracker (set→tracker), TrackerEntry (per-student), TrackerSummary, WaLink | Teacher |
| homework (6) | HomeworkHome dashboard, Declare, Reconcile, Records, CheckingQueue, Rollups | Teacher / class teacher |
| assignment (8) | Weekly channel: Home, Schedule, Deliver, Collect, Checking, Reconcile, Chase, Rollups | Teacher / Office |
| attendance (7) | Home, Mark (absent-only), Admin, TeacherImport, Report, SectionAttendance, AssignMarker | Teacher / Office |
| classtest (9) | Home, Request, Results entry/view, Publish, Dashboard, Reports, ClassSubject, StudentProfile | Teacher / Principal |
| vocab (10) | WordBank, Tests, Build, MarkGrid, 4 reports, Messages, Assignment | Teacher |
| comments (7) | Home, SectionComments, Review, Entry, Meetings ×3 | Teacher / Principal |
| revision (5) | Saturday Hifz revision: Home, GroupGrid, StudentHistory, Deliver, Dashboard | Hifz teacher |
| routine (11) | Home, MyRoutine, Master grid, GroupRoutine, Editor, Cover, DailyNote, ClassNoteReport, ClassNotesAdmin, BellSchedule (+ClassLoadDetail remount) | Teacher / Office |
| classnotes (1) | MyClassNotes — teacher-first front door (UX-8) | Teacher |
| content (2) | ContentTree (Subject×Class→Chapter→plan), PlanView (markdown + PDF) | Teacher |
| review (4) | Plan review loop: Home, Submit, Thread, AssignReviews | Teacher / Principal |
| chat (7) | Home, Thread, New, GroupManage, Oversight ×2, GuardianNotice | Staff |
| printing (2) | PrintHome (queue), NewPrintRequest | Teacher / Office |
| library (5) | Home, TitleDetail, Desk (circulation), CatalogManage, Admin | Librarian |
| observation (12) | Teaching-observation lifecycle: upload → review → respond → trend/calibration | Principal / observers |
| finance (8) | DailyEntry, Snapshot, FeesZakat, QardIou, Reconciliation, Budget, Dashboard, Home | Principal / Office |
| hr (21) | Leave (4), Payroll (6), Performance/conduct/CPD (6), Grievance, Offboarding (2), self-service (2) | Staff / Principal |
| admin (20) | Import gate, users/credentials/permissions, roster, section config, templates, 2 monitoring reports | Principal / Office |
| reports (7) | ReportsHome + PendingReport ×4 routes + TeacherClassLoad ×2 | Principal / Office |
| guardian (8) | Child today, class notes, attendance, fees, leave, homework, routine, assignments | Guardian |
| common (2) | SectionPicker (mounted in 7 stacks), ReportProblem | All |
| notifications (1) | NotificationCenter (root modal) | All |
| auth (1) | Login | — |

No dead screens (only `routine/SlotList.tsx` is a mis-located shared component, not a screen). No
orphan routes. Several screens are intentionally multi-mounted (PendingReport ×4, SectionPicker ×7,
four report screens cross-mounted per D-#311/D-#327).

---

## 2. UI audit (visual layer)

### 2.1 Verdict: a real design system exists and is genuinely adopted

[theme/tokens.ts](../app/src/theme/tokens.ts) + [palette.json](../app/src/theme/palette.json) (light+dark),
`space(n)=4n` scale, radius {8,12,pill}, Noto Sans Bengali via three real faces (no synthetic bold —
`resolveTextStyle` maps `fontWeight` → face), typeScale 12–22 with ≥1.5 line-height for body Bangla.
Shared kit [ui.tsx](../app/src/components/ui.tsx): Screen/Card/Button(4 variants)/Chip/Badge/Field/
Select(searchable)/Loader/EmptyState/ErrorBanner/Notice — 48dp buttons, 56dp tappable cards, 1dp borders.
Governing doc: [ui-guidelines.md](ui-guidelines.md) (ADOPTED, D-#61).

Adoption measurements (ripgrep over 174 screen files):

| Measure | Result | Verdict |
|---|---|---|
| `space()` calls vs off-scale literals | 923 vs 51 (~5%; mostly `marginTop: 2/6` half-steps) | good |
| Text primitives (Body/Muted/H1/H2) vs raw `<Text>` | 1441 vs 15 (6 files, mostly glyphs) | excellent |
| Shared `<Button>` vs bespoke Pressable-buttons | 237 vs ~25 raw Pressables in 16 files (mostly legit rows/cells); `TouchableOpacity` = 0 | good — effectively **one** button implementation |
| Hard-coded hex/rgba colors in screens | 9 occurrences in **3 files** (see 2.2) | quarantined hotspot |
| Shadows/elevation | 0 (borders-only rule fully honored) | excellent |
| Direct `useColorScheme` branching in screens | 0 | excellent |
| `fontSize` below the 12sp floor | 9 occurrences in 3 files (10sp/11sp) | violation |
| Icon library | **none** — 241 emoji glyphs across 43 files (`@expo/vector-icons` not installed) | accepted v1 debt, now the biggest visual-polish gap |

### 2.2 The violation hotspots (nearly everything is in 3 files)

1. **[ClassNoteReportScreen.tsx](../app/src/screens/routine/ClassNoteReportScreen.tsx)** — the single worst
   file: an entire off-palette **blue** scheme (`#4f9cf9` :291, `#eef5ff/#fff` :331, `#dbeafe` :335,
   `#dde7f5` :333, `rgba(255,255,255,…)` :302,307), `fontSize: 11` (:307), and `fontWeight:"700"` on raw
   `<Text>` (:305,339) which bypasses `resolveTextStyle` → synthetic bold on Bangla. Hard-coded light
   values = broken in dark mode.
2. **[RoutineMasterScreen.tsx](../app/src/screens/routine/RoutineMasterScreen.tsx)** — 5× sub-floor
   `fontSize: 10/11` (:105,113,131,134,139) + rgba scrim (:245).
3. **[CompareObservationsScreen.tsx](../app/src/screens/observation/CompareObservationsScreen.tsx)** —
   3× `fontSize: 11` (:174,185,239).

Minor: `#0001` border in [GroupRevisionGridScreen.tsx:163](../app/src/screens/revision/GroupRevisionGridScreen.tsx#L163);
one sub-44 target `minHeight: 40` in [CollectAssignmentScreen.tsx:150](../app/src/screens/assignment/CollectAssignmentScreen.tsx#L150);
glyph-sized checkbox Pressables without explicit hit area in
[NotificationCenterScreen.tsx:175](../app/src/screens/notifications/NotificationCenterScreen.tsx#L175) and
[HomeworkRecordsScreen.tsx:181](../app/src/screens/homework/HomeworkRecordsScreen.tsx#L181).

### 2.3 Bangla typography

Correct by construction: Noto Sans Bengali loaded app-wide, body 16/24 (1.5×), no ALL-CAPS/tracking,
`Markdown.tsx` uses the typeScale and real bold faces. The only Bangla-rendering defects are the two raw
`fontWeight` Texts above and a naive 90-char `slice` truncation of question text
([question.ts:50-52](../app/src/lib/question.ts#L50-L52)) that is blind to grapheme clusters — can cut a
conjunct mid-cluster on collapsed cards.

---

## 3. UX audit (behavioral layer)

### 3.1 Data-state coverage (loading / error / empty / retry)

| Metric | Count |
|---|---|
| Screens with `useQuery` | 158 |
| …rendering a `Loader` | 147 |
| …rendering **any** error UI | 128 — **30 render no error state at all** |
| …rendering `EmptyState` | 80 (others inline text) |
| `ErrorBanner` uses with a working retry | 50 of 54 (4 dead banners) |
| Screens with pull-to-refresh | **10** of ~60+ list screens |
| Mutation screens using the R-Feedback toast | **13 of 99** (most still use inline `Notice`) |
| `accessibilityLabel` occurrences app-wide | **4** (3 files) |

**The 30 no-error-state screens** branch `fetching → Loader` then fall through to `data ?? []` — a network
failure renders as "no data" with no message and no retry. They include **all 7 guardian screens** (e.g.
[ChildHomeworkScreen.tsx:212](../app/src/screens/guardian/ChildHomeworkScreen.tsx#L212) shows
`gpNoHomework` for both "no homework" and "query failed"), plus hub/report screens:
RoutineHome, VocabHome (+4 vocab reports), AssignmentHome, ChatHome, ChatOversight, ClassTestHome,
ClassTestResultsView, CommentsHome/Review/Section, PerformanceHome, MyObservations, AllObservations,
ObservationReviewQueue, RevisionHome/Dashboard, TeacherClassLoad ×2. With no offline detection
(default urql `cacheExchange`, [client.ts](../app/src/graphql/client.ts)), an offline guardian simply sees
an empty app.

Dead ErrorBanners (no `onRetry`): [MarkAttendanceScreen.tsx:88](../app/src/screens/attendance/MarkAttendanceScreen.tsx#L88),
[ChildLeaveScreen.tsx:113](../app/src/screens/guardian/ChildLeaveScreen.tsx#L113),
[HomeworkRollupsScreen.tsx:65](../app/src/screens/homework/HomeworkRollupsScreen.tsx#L65),
[AssembleSetScreen.tsx:81](../app/src/screens/sets/AssembleSetScreen.tsx#L81).

### 3.2 Question-bank filters ([QuestionBankScreen.tsx](../app/src/screens/questions/QuestionBankScreen.tsx))

- Six single-select chip groups (subject/class/type/paper-role/difficulty/bloom) + marks min/max fields (:160-227).
- **Filters do NOT persist** — all local `useState` (:95-102); any navigation (Basket and back, tab switch) resets everything to "All".
- **No topic-tag or review-status filter**, although the GraphQL query accepts both
  ([operations.ts:735,742](../app/src/graphql/operations.ts#L735)) — tags render as read-only badges only (:247-252). **No text/qid search** despite qids being displayed (:243).
- Pagination is a "আরও দেখুন" load-more that refetches the whole grown window (`limit` grows, `offset: 0`, :104-123) rather than appending a page.

### 3.3 Set-builder flow (bank → basket → set)

- Add-to-basket is a clean one-tap toggle per card ("ঝুড়িতে যোগ" ↔ "ঝুড়িতে আছে", :279-295); basket is
  context-backed, dedupes, survives navigation ([BasketContext.tsx](../app/src/state/BasketContext.tsx)), and
  clears on set creation ([BasketScreen.tsx:88](../app/src/screens/questions/BasketScreen.tsx#L88)).
- **No batch selection** (no select-all/range) — a 20-question paper is 20 taps. **No reorder** anywhere
  (Basket :103-113, AssembleSet :123-135, SetDetail :193-204) — order is insertion order.
- Basket visibility while browsing is partial: a count summary card sits at the *top of the scroll* (:146-155)
  and scrolls away; per-card state only via button label; the count badge is on the drawer item, not on screen.
- Flow is split over **4 screens**: Basket (pick HW/AS/CT type + section, create + loop-add) →
  auto-navigate to AssembleSet (due date, finalize) → SetDetail. ≈ **12–15 taps** for a 5-question set.
  Due date is asked *after* the set exists; section comes from SectionContext (persisted — good) with a real
  class-mismatch guard (:52-59).
- **Partial-failure bug-shape:** `createSet` then per-question `addQuestionToSet` in a loop; a mid-loop
  failure bails leaving a half-populated draft set AND an uncleared basket (:80-85) — duplicate-set trap.

### 3.4 Trackers (the completion loop)

[TrackerEntryScreen.tsx](../app/src/screens/trackers/TrackerEntryScreen.tsx): one row per student, each row
holds local state + its **own Save button** firing an individual mutation (:139-148). For ~30 students:
**60+ taps** (chip + Save per row). No mark-all, no "all done except…", no default value. `saved` is a
local flag (:66-71,100-101) — leave and return and there is **no indication of who was already recorded**.
Feedback is a per-row label flip; no toast, no refetch. Closing a tracker is confirm-gated (good) and routes
to a read-only Summary with no per-student drill-down.

Contrast: [CheckingQueueScreen.tsx:131-140](../app/src/screens/homework/CheckingQueueScreen.tsx#L131-L140)
already implements the right pattern — one-tap outcomes (ঠিক / আংশিক / ভুল / দেয়নি) that fire immediately,
expanding a panel only for the two outcomes needing detail. **The best interaction in the app**, and the
model TrackerEntry should copy.

### 3.5 Two parallel homework systems

"Sets of type HW" (bank → basket → set → tracker) and "Declare Homework"
([DeclareHomeworkScreen.tsx](../app/src/screens/homework/DeclareHomeworkScreen.tsx): topic-tags +
description + attachments, own nil-declaration flow, own CheckingQueue lifecycle) model the same
deliverable twice, with different tracking screens and no cross-link. The teacher Today screen's quick
actions (📒 Declare Homework, 🙋 Attendance, 📓 Class Notes, 🧪 Class Test —
[TodayScreen.tsx:383-411](../app/src/screens/home/TodayScreen.tsx#L383-L411)) actively promote the Declare
path and offer **no entry point at all to Question Bank / Sets / Trackers** — the audited core loop is
unreachable from the landing screen in ≤2 taps.

### 3.6 Destructive actions and feedback

The R-Confirm rule (danger buttons → `confirmAction`) held for `variant="danger"`, but destructive
mutations rendered as **Chip/ghost buttons bypass it**:

- [ChatThreadScreen.tsx:176-178](../app/src/screens/chat/ChatThreadScreen.tsx#L176-L178) — permanent message delete on one tap of a ghost button (:482), no confirm.
- [SetDetailScreen.tsx:78-82](../app/src/screens/sets/SetDetailScreen.tsx#L78-L82) — remove question from set: no confirm **and** the mutation result is discarded (silent failure).
- [AssignmentScheduleScreen.tsx:128-134](../app/src/screens/assignment/AssignmentScheduleScreen.tsx#L128-L134) — rotation entry removal from a Chip, no confirm.
- Silent mutation: [CompareObservationsScreen.tsx:73-74](../app/src/screens/observation/CompareObservationsScreen.tsx#L73-L74) — publish result never checked, no success/error surface.
- Systemic: only 13/99 mutation screens toast; most confirm via an inline `Notice` that can sit off-viewport on long forms — the exact failure UX-1 was built to end.

### 3.7 Forms

Where the shared `required()` validator is used (DeclareHomework, DailyEntry, RequestClassTest,
BuildVocabTest) validation is solid: per-field Bangla errors + toast naming the field. Elsewhere it's
ad-hoc guards with toast/Notice only (NewPrintRequest :134-139, CommentEntry, NewChat). All error strings
are Bangla (`friendlyError` mapping) — no English leakage found. Some submits stay tappable and validate
on press (acceptable), a few disable until valid (better: MyLeave :88,180, Import :196).

### 3.8 Accessibility

Near-absent at screen level: **4 `accessibilityLabel`s app-wide**; the ubiquitous selected-Chip pattern
exposes no `accessibilityState={{selected}}` (a screen reader cannot tell which filter/tab/outcome is
active); ~241 emoji-as-icon controls are unlabeled; no web focus management. Only the shared primitives
self-label (ErrorBanner retry, Field secure toggle). Color-alone meaning is mostly avoided (badges carry
text) — good. OS font scaling is not disabled — good.

---

## 4. Severity-ranked findings

| # | Sev | Screen / area | Issue | Evidence | User impact |
|---|---|---|---|---|---|
| F1 | **Critical** — **FIXED 2026-07-17** | TrackerEntry | Per-student chip+Save, no batch, saved-state not reloaded. Fixed: one-tap `OutcomeSegment` (optimistic save + আনডু), `BatchBar` (one `recordEntries` mutation, unrecorded rows only, 3 taps for all+2 exceptions), `ScoreSheet` marks numpad, sticky "১২/৩০ রেকর্ড হয়েছে" progress header, hydration via client-side sha256 pseudonym map, QueryGate, confirm-close → per-student summary | TrackerEntryScreen.tsx:66-71,139-148 | 60+ taps per class; re-entry shows blank slate → double entry / abandonment of the tracking loop |
| F2 | **Critical** — **FIXED 2026-07-16** | 30 query screens incl. all 7 guardian screens | No error state — failures & offline render as "empty". Fixed: shared `QueryGate` (Loader/ErrorBanner+retry/offline via netinfo) swept over all 30 | e.g. ChildHomeworkScreen.tsx:212, RoutineHomeScreen.tsx:116 | Guardians/teachers silently see wrong "no data"; trust damage; no recovery path |
| F3 | **Critical** — **FIXED 2026-07-16** | ChatThread, SetDetail, AssignmentSchedule | Destructive mutations without confirmation; SetDetail also discarded the mutation result. Fixed: `confirmAction` + toast feedback + result handling (incl. SetDetail `onSaveName`) | ChatThreadScreen.tsx:176-178,482; SetDetailScreen.tsx:78-82; AssignmentScheduleScreen.tsx:128-134 | One mis-tap permanently deletes a message / silently corrupts a set |
| F4 | **Major** — **FIXED 2026-07-17** | QuestionBank | No topic-tag / review-status filter (API supports both), no text/qid search. Fixed: FilterSheet wires topicTag (distinct-values query) + reviewStatus; SearchField searches text+qid server-side with Bangla-digit normalisation | QuestionBankScreen.tsx:113-124; operations.ts:735,742 | The "tagged question bank" value prop is unusable at scale; teachers eyeball long lists |
| F5 | **Major** — **FIXED 2026-07-17** | QuestionBank | Filters are local useState — wiped on every navigation. Fixed: QuestionBankContext above the navigator; filters+search also persist to storage across restarts | QuestionBankScreen.tsx:95-102 | Re-filter from scratch on every basket round-trip; compounds F4 |
| F6 | **Major** — **FIXED 2026-07-17** | Bank→Basket→Set | No batch add, no reorder, 4-screen create flow, top-anchored basket summary scrolls away. Fixed: checkbox multi-select cards, sticky SelectionTray, one CreateSetSheet with ▲/▼ reorder (old screens retained for draft edits) | BasketScreen.tsx:103-113; AssembleSetScreen.tsx:123-135 | 12–15 taps for a small set; question papers can't be ordered |
| F7 | **Major** | TodayScreen + homework module | Two parallel HW systems; core sets loop absent from landing quick actions | TodayScreen.tsx:383-411; DeclareHomeworkScreen.tsx | Confused mental model; the flagship loop starts with drawer spelunking |
| F8 | **Major** | App-wide | Accessibility: 4 labels total, no selected-state on chips, unlabeled emoji controls | grep totals; ui.tsx Chip | Screen-reader users locked out; Android TalkBack unusable |
| F9 | **Major** | ClassNoteReport (+RoutineMaster, CompareObservations) | Off-palette hard-coded light-only colors, sub-12sp text, synthetic-bold Bangla | ClassNoteReportScreen.tsx:291-339; RoutineMasterScreen.tsx:105-139 | Illegible in dark mode; sub-floor text on low-end phones |
| F10 | **Major** — **FIXED 2026-07-17** | BasketScreen | create-set + per-question add loop; mid-loop failure leaves half-set + full basket. Fixed: transactional `createSetWithQuestions` (validate-all-then-one-write) is the primary path; error → toast, sheet stays open, selection intact | BasketScreen.tsx:80-85 | Duplicate/corrupt draft sets after flaky connections |
| F11 | **Major** | 86 mutation screens | R-Feedback toast adopted by only 13/99; Notice-at-top as sole submit feedback persists | ToastContext.tsx header vs grep | Submit results invisible below the fold → retries, duplicate posts |
| F12 | **Minor** | CompareObservations | Publish fires with no success/error surface | CompareObservationsScreen.tsx:73-74 | Silent failure of a sign-off action |
| F13 | **Minor** | ~50 list screens | Pull-to-refresh on only 10 screens | usePullRefresh grep | Stale counts on mobile with no refresh gesture |
| F14 | **Minor** — **FIXED 2026-07-16** | 4 screens | ErrorBanner without onRetry (dead banner). Fixed: retry wired to network-only reexecute on all 4 | MarkAttendanceScreen.tsx:88 et al. | Error shown but unrecoverable in place |
| F15 | **Minor** — **FIXED 2026-07-17** | QuestionBank cards | 90-char naive slice truncation of Bangla. Fixed: `numberOfLines={2}` clamp; `truncate()` deleted | question.ts:50-52 | Conjuncts can be cut mid-grapheme on collapsed cards |
| F16 | **Minor** — **FIXED 2026-07-17** | QuestionBank | Load-more refetches entire grown window. Fixed: cursor pagination (`after` arg) appends one page per fetch | QuestionBankScreen.tsx:104-123 | Slow growth on big banks / low-end phones |
| F17 | **Minor** | SectionPicker, GuardianHome | Dead-end empty states (generic message, no CTA) | SectionPickerScreen.tsx:84; GuardianHomeScreen.tsx:161 | Blocked users get no next step |
| F18 | **Minor** | App-wide | No offline detection/stale indicator; default document cache | client.ts | Offline is indistinguishable from empty (worst on F2 screens) |
| F19 | **Minor** | 43 files | Emoji as the only iconography; no vector icon set | package.json | Inconsistent rendering across OEM emoji fonts; unprofessional edge |
| F20 | **Minor** | CollectAssignment, NotificationCenter, HomeworkRecords | Sub-44dp targets (minHeight 40; glyph-sized checkboxes) | CollectAssignmentScreen.tsx:150 | Mis-taps on the daily collection pass |

---

## 5. Redesign priority (teacher-workflow impact)

1. **TrackerEntryScreen** — the highest-volume, highest-pain task (F1). Adopt the CheckingQueue one-tap
   outcome pattern + a batch bar ("সবাই সম্পন্ন" / mark-all-except) + hydrate prior entries. This one screen
   converts the tracking loop from ~60 taps to ~5 for a typical day.
2. **QuestionBankScreen** (with basket tray) — F4, F5, F6, F15, F16. Tag filter + search + persistent
   filters + multi-select + a sticky selection tray fix the discovery half of the core loop.
3. **Basket→AssembleSet merge** — F6, F10. One create step (type, section, date, name together), reorder,
   transactional create; kills a whole screen and the half-set trap.
4. **TodayScreen quick actions + homework-path unification** — F7. Surface the sets loop (প্রশ্নব্যাংক / সেট)
   on Today; cross-link Declare-HW and Sets-HW or fold their tracking into one grid.
5. **Guardian screens error/offline hardening** — F2, F18. One shared `QueryGate` wrapper (loader / retryable
   error / empty with CTA) swept across the 30 screens; cheap, systemic, protects the parent-facing surface.

(F3's unconfirmed deletes are a bug-fix, not a redesign — do it first regardless; it's a two-line change per site.)

---

## 6. Proposed visual direction: "Refine, don't replace"

The deep-green/gold identity is adopted, calm, AA-checked, and dark-mode complete — replacing it would be
churn. The direction is **systematize what exists + close the icon/density gaps**.

### 6.1 Color (keep the existing palette — it is the design system)

Light: bg `#F6F8F6` · surface `#FFFFFF` · surfaceAlt `#ECF2EE` · border `#D3DCD6` · text `#182420` /
`#46554E` / disabled `#8B968F` · **primary `#156B45`** (pressed `#0E4C31`, container `#D8EBDF`, on-container
`#0B3B26`) · gold `#8F6400` (container `#F3E7C9`) · warning `#9A4D00` (`#FCE8D5`) · error `#B3261E`
(`#F9DEDC`) · info `#155E96` (`#DCEAF7`). Dark set already defined in
[palette.json](../app/src/theme/palette.json). **One addition:** a dedicated `success` hue is currently
aliased to `primary`; keep the alias (it works for this brand) but add `selection` (= `primaryContainer` at
full-row width) as a named token for the new multi-select surfaces.

### 6.2 Type (Noto Sans Bengali — already loaded; extend the scale upward)

| Token | Size/line | Face | Use |
|---|---|---|---|
| display | 28/36 | Bold | dashboard stat numerals (AdminToday tiles) |
| pageTitle | 22/30 | Bold | existing |
| sectionTitle | 18/24 | Bold | existing |
| body / bodyStrong | 16/24 | Regular/Bold | existing (1.5× — correct for Bangla) |
| secondary | 14/21 | Regular | existing |
| chip/button | 14–16/20–24 | Medium | existing |
| caption | 12/18 | Regular | existing — **hard floor; delete every 10/11sp** |

Digits/codes stay Latin (HW-0042); no caps, no tracking (already the rule).

### 6.3 Spacing / radius / elevation (keep)

4dp base, sanctioned steps 4/8/12/16/24/32 (`space(1|2|3|4|6|8)`); radius 8 (badges) / 12 (cards, buttons,
inputs) / pill (chips); **1dp borders, zero shadows** (cheap on low-end Android, already fully adopted).
Sweep the 51 off-scale literals (mostly `2`/`6` half-steps → `space(1)`/`space(2)`).

### 6.4 Iconography (the one real addition)

Adopt **one** outline icon set — `lucide-react-native` (or Feather via `@expo/vector-icons`) — 24dp, stroke
1.75, colored by text tokens. Replace the 241 emoji in **controls and navigation** first (drawer, quick
actions, header bell/avatar, checkbox glyphs); decorative emoji in report rows can go last. Every icon-only
control gets a Bangla `accessibilityLabel` in the same sweep (fixes half of F8 mechanically).

### 6.5 Core component set (build these once, sweep everywhere)

| Component | Purpose | Replaces / fixes |
|---|---|---|
| `QueryGate` | wraps query state → Loader / retryable ErrorBanner / EmptyState-with-CTA | F2, F14, F17 |
| `SelectionTray` | sticky bottom bar: count · marks · primary CTA; slides up when >0 selected | F6 basket visibility |
| `FilterBar` + `FilterSheet` | horizontal active-filter chips + bottom-sheet full filter grid; state in context/storage | F4, F5 |
| `SearchField` | debounced text search with clear button | F4 |
| `OutcomeSegment` | one-tap per-row outcome chips (CheckingQueue pattern), optimistic save + undo toast | F1 |
| `BatchBar` | "mark all ✓ / all except…" header for roster grids | F1 |
| `SelectableCard` | Card + checkbox + selected surface, `accessibilityState` | F6, F8 |
| `DataTable` | tokenized scrollable grid (sticky first column, min 12sp) | F9 (ClassNoteReport, RoutineMaster) |
| `StatTile` | display-numeral dashboard tile | AdminToday raw Texts |
| `IconButton` | 48dp icon control with required Bangla label | F8, F19 |
| Existing kept as-is | Button, Chip (+`accessibilityState`), Badge, Field, Select, DateField, Toast, ConfirmSheet | — |

---

## 7. Design briefs — top 3 screens

### 7.1 TrackerEntry — "এক ট্যাপে ট্র্যাকিং" (one-tap tracking)

**Goal.** A teacher records completion for a 30-student class in under 60 seconds, can leave and return
without losing the picture, and can never double-enter.

**Audience.** Subject teachers, in-class, one-handed on low/mid Android phones; Bangla UI; roll numbers and
scores in Latin digits.

**Layout.**
- Sticky header: set name + kind badge (HW/AS/CT), progress pill **"১২/৩০ রেকর্ড হয়েছে"**, and a thin
  progress bar in `primaryContainer`.
- `BatchBar` under the header: [ সবাই সম্পন্ন ✓ ] [ বাকিদের অসম্পূর্ণ ] — batch actions confirm via
  ConfirmSheet, then apply optimistically.
- Body: one `FlatList` row per student — roll (Latin) + name (Bangla, 16sp) + `OutcomeSegment` on the right:
  HW: [সম্পন্ন] [অসম্পূর্ণ] · AS: [জমা দিয়েছে] [জমা দেয়নি] · CT: numeric score field.
  **No per-row Save button** — tapping a segment saves immediately (optimistic), row shows a ✓ +
  `primaryContainer` wash. Rows hydrate from existing entries on load.
- Sticky footer: [ ট্র্যাকার বন্ধ করুন ] (secondary until all rows recorded, then primary).

**Content (Bangla samples).** Header: "গণিত — বাড়ির কাজ · ৫ম শ্রেণি (ক)"; empty roster: "এই শাখায় কোনো
শিক্ষার্থী নেই।"; undo toast: "সংরক্ষণ হয়েছে — আনডু"; batch confirm: "৩০ জনকে 'সম্পন্ন' হিসেবে রেকর্ড করা হবে?"

**Interactions (prototype flows).**
1. Tap an outcome → instant ✓ + toast with 5s আনডু; tap again to change (upsert).
2. "সবাই সম্পন্ন" → ConfirmSheet → all rows flip; then tap the 2 exceptions to অসম্পূর্ণ (3 taps total for a
   28/2 day).
3. Kill the app, reopen → rows show prior entries with ✓ (server hydration).
4. Close tracker → ConfirmSheet → Summary with per-student list (new: drill-down), reopen disabled.

### 7.2 QuestionBank — "প্রশ্ন খুঁজুন ও বাছাই করুন" (find & select)

**Goal.** A teacher finds the right tagged questions in seconds and selects many at once, with the basket
always visible; filters survive the whole session.

**Audience.** Subject teachers preparing HW/AS/CT sets, mobile-first; also Principal reviewing the bank on web.

**Layout.**
- Sticky top: `SearchField` (placeholder **"প্রশ্ন বা কোড খুঁজুন…"** — matches text + qid) and a `FilterBar`
  of active-filter chips ("গণিত ✕", "৫ম শ্রেণি ✕", "সহজ ✕") + [ ফিল্টার ⚙ ] opening a `FilterSheet` with all
  groups **including টপিক ট্যাগ and review status** (wire the existing GraphQL args).
- Body: question cards — qid + marks badge top row; question text (Bangla body 16/24, grapheme-safe
  2-line clamp); tag/difficulty badges; leading checkbox. Tap card = preview; tap checkbox (or long-press) =
  select. Selected cards get the `selection` surface.
- Sticky bottom `SelectionTray` (appears when >0): **"৫টি প্রশ্ন · ২০ নম্বর"** + [ সেট তৈরি করুন ].
- Footer of list: true cursor pagination ("আরও দেখুন" appends).

**Content (Bangla samples).** Card: "HW-0042 · ৫ নম্বর — অনুচ্ছেদটি পড়ে প্রশ্নগুলোর উত্তর দাও…"; tags:
"ব্যাকরণ", "অনুধাবন"; empty: "এই ফিল্টারে কোনো প্রশ্ন নেই — ফিল্টার বদলে দেখুন।"; tray: "ঝুড়ি: ৫ · ২০ নম্বর"।

**Interactions (prototype flows).**
1. Type "৪২" → qid match surfaces HW-0042; select 3 via checkboxes → tray counts up live.
2. Open FilterSheet → pick টপিক ট্যাগ "ব্যাকরণ" → sheet closes, active chip appears; navigate to a preview
   and back → filters and selection intact (context-backed).
3. Tap tray → bottom sheet: reorder by drag, remove, name the set, type HW/AS/CT, section (prefilled from
   SectionContext), due date — one [ তৈরি করুন ] creates transactionally and routes to SetDetail.

### 7.3 TodayScreen (teacher) — "আজকের কাজ" (today's work)

**Goal.** Every daily job — including the question-bank loop — starts here in ≤2 taps; the screen answers
"what needs me right now?" before anything else.

**Audience.** All teachers, first screen after login, phone-first, glanced between classes.

**Layout.**
- Header: date + Bangla day ("বুধবার, ১৬ জুলাই ২০২৬"), class-teacher duty line.
- **Alert stack** (keep — it works): red backlog / amber countdown cards, each deep-linking to its clearing
  screen, `errorContainer`/`goldContainer` fills, icon + text (never color alone).
- **আমার পিরিয়ড** — horizontal timeline of today's slots; current period highlighted `primaryContainer`;
  tap → class note for that slot.
- **অমীমাংসিত কাজ** — count rows (checking queue, chase list, resubmission, attendance) with counts as
  `display` numerals; tap-through.
- **Quick actions** — an 8-tile `IconButton` grid replacing the 4 chips: বাড়ির কাজ ঘোষণা · হাজিরা · ক্লাস নোট ·
  ক্লাস টেস্ট · **প্রশ্নব্যাংক** · **আমার সেট** · **ট্র্যাকার** · ছুটির আবেদন.
- **সাম্প্রতিক সেট** — last 2 assembled sets as cards with a one-tap [ ট্র্যাকার খুলুন ] shortcut (closes the
  loop from assembly to tracking without drawer navigation).

**Content (Bangla samples).** Alert: "৩টি বাড়ির কাজ চেক করা বাকি"; period card: "৩য় পিরিয়ড — গণিত · ৫ম (ক)";
pending row: "চেকিং কিউ — ১২"; empty day: "আজ কোনো নির্ধারিত কাজ নেই।"

**Interactions (prototype flows).**
1. Login → Today → tap "চেকিং কিউ ১২" → CheckingQueue (1 tap).
2. Tap প্রশ্নব্যাংক tile → QuestionBank with last-used filters restored (1 tap; loop entry fixed).
3. Recent-set card → [ ট্র্যাকার খুলুন ] → TrackerEntry directly (2 taps, replaces 4-screen drawer path).
4. Pull-to-refresh updates alerts + counts.

---

## 8. Consolidated handoff

=== HANDOFF SUMMARY FOR PARENT CHAT ===

**App:** SCD Hub — Expo RN (iOS/Android/web via one codebase), urql/GraphQL, Bangla-first UI (bn/en toggle), drawer nav with per-role gating. **173 screens / 27 modules**; roles Principal/Office/Teacher/Guardian; teacher entry = TodayScreen (`myDay`), admin = AdminToday cards, guardian = child-today. Core teacher loop: QuestionBank → Basket → AssembleSet → SetDetail → OpenTracker → TrackerEntry; parallel simpler path: DeclareHomework → CheckingQueue.

**State of the UI:** a real, adopted design system exists (`app/src/theme` tokens + `ui.tsx` kit, docs/ui-guidelines.md D-#61): deep-green/gold palette (light+dark), Noto Sans Bengali 3 faces (no synthetic bold), 4dp scale, 48dp targets, borders-not-shadows. Adoption measured: 923 space() vs 51 off-scale; 1441 text primitives vs 15 raw Text; 237 shared Buttons, 0 TouchableOpacity; 0 shadows; hex violations quarantined to ~3 files. **No icon library — 241 emoji as icons.**

**Top findings (severity):**
- CRIT F1: TrackerEntry = chip+Save **per student** (60+ taps/class), saved-state local-only (no hydration) — worst pain in the core loop. CheckingQueue already has the right one-tap pattern to copy.
- CRIT F2: **30 query screens have no error state** (incl. all 7 guardian screens) — network failure renders as "empty", no retry, no offline detection.
- CRIT F3: destructive mutations with **no confirmation** via ghost/Chip buttons: ChatThread message delete, SetDetail remove-question (result also discarded), AssignmentSchedule remove.
- MAJ F4/F5: QuestionBank has **no tag filter or search** (API already supports topicTag/reviewStatus) and filters reset on every navigation (local useState).
- MAJ F6/F10: no batch select, no reorder; 4-screen create flow (~12–15 taps for 5 questions); create-set loop can leave a half-populated set on mid-loop failure.
- MAJ F7: two parallel homework systems (Declare vs Sets-HW); Today quick actions omit Bank/Sets/Trackers entirely.
- MAJ F8: accessibility ~absent (4 labels app-wide; chips lack selected state).
- MAJ F9: ClassNoteReport off-palette blue grid (dark-mode break, synthetic-bold Bangla); sub-12sp text there + RoutineMaster + CompareObservations.
- MAJ F11: R-Feedback toast adopted by only 13/99 mutation screens.
- MIN: 4 dead ErrorBanners; pull-to-refresh on only 10 screens; 90-char grapheme-blind truncation; load-more refetches whole window; dead-end empty states; no offline indicator.

**Redesign priority:** 1) TrackerEntry (one-tap OutcomeSegment + BatchBar + hydration) · 2) QuestionBank (search + tag filter + persistent FilterBar + multi-select + SelectionTray) · 3) Basket/AssembleSet merge (one transactional create with reorder) · 4) TodayScreen quick-action grid incl. sets loop + recent-sets shortcut · 5) QueryGate sweep for the 30 error-less screens (guardian first). Fix F3 confirms immediately (bug-fix, not redesign).

**Design tokens (keep existing palette/type — refine):** primary `#156B45` (pressed `#0E4C31`, container `#D8EBDF`), gold `#8F6400`/`#F3E7C9`, bg `#F6F8F6`, surface `#FFFFFF`, surfaceAlt `#ECF2EE`, border `#D3DCD6`, text `#182420`/`#46554E`, error `#B3261E`, warning `#9A4D00`, info `#155E96` (+ full dark set in palette.json). Type: Noto Sans Bengali — display 28/36 (new), 22/30, 18/24, 16/24 body (1.5×), 14/21, 12/18 floor (kill all 10–11sp). Spacing 4/8/12/16/24/32; radius 8/12/pill; 1dp borders, no shadows. **Add:** lucide/Feather outline icons 24dp replacing emoji in controls, with Bangla accessibilityLabels. New components: QueryGate, SelectionTray, FilterBar+FilterSheet, SearchField, OutcomeSegment, BatchBar, SelectableCard, DataTable, StatTile, IconButton.

**Briefs (prototype-ready):**
1. **TrackerEntry "এক ট্যাপে ট্র্যাকিং"** — sticky progress header ("১২/৩০ রেকর্ড হয়েছে"), BatchBar ("সবাই সম্পন্ন ✓" + exceptions), per-row one-tap outcomes (সম্পন্ন/অসম্পূর্ণ · জমা দিয়েছে/জমা দেয়নি · score), optimistic save + আনডু toast, server hydration, close→Summary with drill-down. Flows: single tap-to-save; mark-all-then-2-exceptions (3 taps); return-and-see-state.
2. **QuestionBank "প্রশ্ন খুঁজুন ও বাছাই করুন"** — sticky SearchField ("প্রশ্ন বা কোড খুঁজুন…") + active-filter chips + FilterSheet (incl. টপিক ট্যাগ, review status), checkbox multi-select cards, sticky SelectionTray ("৫টি প্রশ্ন · ২০ নম্বর — সেট তৈরি করুন") → one bottom-sheet create (type/section/date/reorder) → SetDetail. Filters + selection persist across navigation.
3. **TodayScreen "আজকের কাজ"** — alert stack (keep), আমার পিরিয়ড timeline, pending-count rows, 8-tile quick-action grid (adds প্রশ্নব্যাংক / আমার সেট / ট্র্যাকার), সাম্প্রতিক সেট cards with one-tap "ট্র্যাকার খুলুন". Flows: login→queue in 1 tap; bank with restored filters in 1 tap; set→tracker in 2 taps.

=== END HANDOFF SUMMARY ===
