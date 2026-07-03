# STATUS

- 2026-07-02: ENH-003 is now built: the Principal staff list has a client-side search field that filters by name, ID, phone, and category, matching the roster search pattern. Verified green with app `tsc --noEmit` in this session.
- 2026-07-02: Proxy-grant start date now uses the same Pressable-to-datepicker interaction as the other app calendars, so clicking the field/icon opens the picker on web. Verified green with app `tsc --noEmit` in this session.
- 2026-07-02: Proxy-grant placeholders were cleaned up for teacher/class/section/subject/year/reviewer selects, and the web date field now shows an app-owned "Choose a date" prompt while still opening the calendar picker. Verified green with app `tsc --noEmit` in this session.
- 2026-07-02: Foundation subjects now include Islamic Studies in the operational `Subject` collection and seed path, and the current database was backfilled so proxy subject dropdowns can surface it. Verified green with direct shared/server/app TypeScript compilers in this session.
- 2026-07-02: Proxy-grant form no longer exposes academic year; it now defaults class selection from the centrally marked current year, and the start date uses the shared calendar picker. Verified green with app `tsc --noEmit` in this session.
- 2026-07-02: ENH-002 proxy grants now carry subject context through manual assignment and subject-scoped tracker/content gates; manual proxy assignment, assessment set creation, homework/class-test writes, and proxy read/write scope now narrow by subject. Verified green with direct server `tsc --noEmit` and app `tsc --noEmit` in this session.
- 2026-07-01: Homework home now hides `Reconcile & issue` unless the selected section belongs to the logged-in class teacher or an existing admin/supervisor path; the reconcile screen blocks trim/confirm controls the same way. Verified green with app `tsc`.
- 2026-07-01: Homework ceiling now uses 120 minutes everywhere it is surfaced or enforced: the shared constant, guardian day-load, reconciliation badge/gate, and homework summary/reconcile strings all align. Verified green with server/app `tsc` and focused homework/guardian Jest tests.
- 2026-07-01: Homework declare now accepts KG/Nursery roster levels end-to-end: generic fallback topics work for pre-primary classes, Nursery HW IDs are parsed safely, and the declare screen shows the roster class name instead of raw `C0`/`C-1`. Verified green with server/app `tsc` and focused homework Jest tests.
- 2026-07-01: English-mode label sweep completed for the shared section chooser/bar plus routine, roster, assignment-marker, attendance-marker, and class-note report screens; homework reminder wording updated in shared vocab. Verified green with `verify_shared_vocab.mjs` and app/server `tsc`.

_Updated: 2026-06-16 (**EximusEdu-familiar navigation reskin — branch `feat/drawer-nav-reskin` (off dev) → PR into dev (D-#258).** Owner UI-reconciliation against the EximusEdu school system staff/teachers/guardians already use: the app's top-level navigation swaps the bottom-tab bar for a grouped hamburger **DRAWER** (`createBottomTabNavigator`→`createDrawerNavigator` + a custom collapsible `DrawerContent` — collapsible groups Academics/Trackers + flat Attendance/Comments/Observation/Library/Chat/Finance/HR/Admin; guardian = Home + Academics). The drawer is **permanent** (always-visible left sidebar) at width ≥ 1024dp (laptop/desktop web) and a **slide-over** (☰ hamburger in the header) below. The **☰ is always shown**: on web it collapses/expands the permanent sidebar (drawer width 300↔0dp; when collapsed the content `Screen` frame widens 720→1400dp so the body fills — shared `SidebarProvider` `state/SidebarContext`); on phone it opens the overlay. The header top-right consolidates into the 🔔 bell + a 👤 account menu (name/language/report/logout). Installed `@react-navigation/drawer`@6 + `react-native-gesture-handler` + `react-native-reanimated` (expo-resolved for SDK 51) + wired the gesture-handler entry import + reanimated babel plugin + `GestureHandlerRootView`; bumped the web nav-state key →`scd_nav_state_v2` (old tab-state tree is incompatible with the drawer). **Every route name + `roleHasPermission` gate + screen IA is unchanged** (notification deep-links + Basket→Sets cross-nav intact); **palette + dark mode + Bengali type kept** — the chosen "shell + chrome only" depth: NO Profile hero-card / Home dashboard tiles / Attendance calendar+pie / data-table list rebuild / nested drawer sub-items / EximusEdu dark-slate drawer. **Gate GREEN (executed):** app `tsc --noEmit` clean + `expo export --platform web` green (1883 modules, 4.21 MB); `git diff -- server shared` empty. **No vocab/contract change. Highest D-#=#258. NOT verified live** — next: dev-deploy test (permanent drawer on web ≥1024px; slide-over ☰ on phone; per-role gating Principal/Teacher/Office/Guardian; the notification deep-link + Basket→Sets regressions; web-refresh restore via the bumped key). —— Prior: **Routine-driven content access — branch `feat/content-routine-scope` (off dev) → PR into dev (D-#257).** Content visibility now follows the ROUTINE: a teacher sees a content artifact iff their scope covers `(subject, classLevel)` — a routine **teaching** grant (D-#49, created/revoked as they're added to/removed from a content-subject section slot), an **active proxy** grant (now per-subject: `assignCover` stamps the covered slot's subject; covers only that subject's content for the cover days, auto-expires), or **supervisory** (whole_school/subject_dept/grade_class/explicit_set). New `modules/content/contentScope.ts` (built once/request) replaces the old whole-school-only content scope; `assignProxy`/`ProxyScope` carry `subjectId`; `seed-routine.ts` backfills 36 teaching grants for the bulk-seeded routine. **Gate GREEN (executed):** server tsc + **jest 1472/1472 (90 suites, +contentScope.test)**; live-verified per teacher (each sees exactly their taught subject×class, nothing else). No vocab/contract change. **Highest D-#=#257.** —— Prior: **Routine usability + admin master grid — branch `feat/routine-views` (off dev) → PR into dev, from live routine testing.** Implements the R-3 view layer over the seeded routine (D-#46/#47/#48/#56 — no new decision). (1) **Names + times:** server `enrichRoutineSlots` resolves teacherId→name + computes per-period clock windows (PeriodGrid+ScheduleWindow); `RoutineSlot` GraphQL gains `teacherName`/`coverTeacherName`/`startTime`/`endTime` on `routineSlots`/`myRoutineSlots`/`routineForDate` — the grid now reads "Period 5 · 09:40–10:15 · English · Tazkir" instead of raw ObjectIds. (2) **Admin master grid:** `routineMaster(day)`/`routineMasterWeek` (`routine:manage`) → all sections + Quran/Arabic groups × periods in one screen with cross-group conflict detection; new `RoutineMasterScreen` + All/Sun–Thu selector; `Screen wide` (1400dp `MAX_WIDE_CONTENT_WIDTH` token + ui-guidelines §6) for the laptop-width grid. (3) **Seeder:** idempotent `server/scripts/seed-routine.ts` imports the V9 Excel → schedule window + period grids + 10 Quran/Arabic SubjectGroups (general→Section, Quran/Arabic→SubjectGroup per §4.3) — guarded to scdhub_local; the Excel stays out of git. **Gate GREEN (executed):** server tsc + jest 1465/1465 (89 suites); app tsc + Metro; live-verified routine reads. **No vocab/contract change. Highest D-#=#256.** —— Prior: **Reviewer↔admin content parity + verdict resubmit + meaningful errors — branch `feat/reviewer-content-parity` (off dev) → PR into dev, from live reviewer testing.** (1) **Reviewer detail now renders like admin:** `<Markdown>` (internal-footer comment hidden) + Export PDF + doc-type/curation badges; "My reviews" gains collapsible subject/class/plan-type filters + decided-round cards with a verdict badge. (2) **Verdict resubmit (D-#255):** reviewer edits their own decision on a still-open round (assigned|submitted); `myReviewAssignments` returns assigned+submitted; symmetric `reviewStatusForVerdict` (APPROVE draft→reviewed, resubmitted CHANGES reverts reviewed→draft, gold untouched). A signed-off (gold) or superseded (current=false) round shows a closed-notice instead of the edit form. Plan content stays imported/read-only (ADR-006 — owner's call). (3) **Meaningful errors (D-#256):** a Yoga `maskError` whitelist surfaces our ~28 domain-error classes' messages (constructor.name), default-denies internal/DB/JWT errors — live-verified ("Review assignment not found", not "Unexpected error"). **Gate GREEN (executed):** server tsc + **jest 1453/1453 (87 suites, +3 review)**, app tsc + Metro bundle, live error-surface smoke. **No vocab/contract change. Highest D-#=#256.** —— Prior: **MON-1 — GlitchTip self-host LIVE on the prod VM (observability / error tracking).** Coordinator ran the [OP] infra over SSH: Docker + compose at `/opt/glitchtip` (`glitchtip:6` all-in-one + `postgres:18` + `valkey:9`, web→`127.0.0.1:8050`) behind a Caddy vhost at **https://errors.scdhub.shafayet.me** (valid LE cert; prod/dev `/healthz` still 200); locked (no signup/org-creation, `ALLOWED_HOSTS`, admin creds in VM `/opt/glitchtip/admin-credentials.txt` mode 600); org `scd` + projects `scdhub-server`/`scdhub-app` + DSNs; retention 30d; **acceptance: a test event landed in scdhub-server (Issue=1)**; GlitchTip Postgres folded into the nightly Drive backup (own `SCD-Hub-Backups-GlitchTip` pool — verified). **This PR (into dev) = only the backup-script repo change** (`scripts/backup.sh` + `drive-backup.mjs` folder-arg); the GlitchTip infra+secrets live on the VM, not the repo (§0). **OPEN: DNS — `errors.*` must point to the VM on ALL resolvers (Google currently returns a stale `136.243.75.67`); MON-2..6 (server/app SDK capture, feedback, uptime, host alert) next.** No vocab/contract change. —— Prior: **Content-feature UX + PDF crash fix — branch `feat/content-browse-pdf-fix` (off dev) → PR into dev, from live Principal testing of the content feature.** (a) **PDF export fixed + made crash-proof:** Bengali **reph** (র্+consonant) tripped a fontkit 2.0.4 GPOS null-anchor crash that took the whole server down (un-try/caught route) — null-guarded `getAnchor` via `patches/fontkit+2.0.4.patch` + **patch-package** `postinstall`, both PDF routes now try/catch→500 (D-#254); reph regression test added. (b) **App content-browse UX:** drag-and-drop import (`FileDropZone.web.tsx`), post-import refresh (focus refetch, no reload), chapter/session distinction (doc-type badge + dynamic header + "Plan type" filter — the data always had it, the UI didn't), collapsible filter accordion. **Local-only cleanup this session:** wiped all dummy ContentArtifacts from `scdhub_local` (DB script, not a feature). **Gate GREEN (executed):** server tsc + **jest 1450/1450 (87 suites, +1 reph)**, app tsc + Metro web bundle, live PDF endpoint 200. **No vocab/contract change.** **Highest D-#=#254.** —— Prior: **SATURDAY REVISION (SR-1..SR-4) + CO-2 footage app rider MERGED to main (coordinator).** SR landed as ONE integration via the tip PR **#97** (4 stacked PRs #94→#97 cut from the finance merge; coordinator resolved the PR-#93 append-log/Audit/app-file conflicts once + renumbered the SR-4 childRevision build ruling **D-#249→#251** since PR #93 took #249/#250; **#94/#95/#96 closed as landed-via-#97**). The **CO-2 footage app rider #98** (in-app YouTube GIS upload — `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, unlisted, the merged `recordSessionFootage`/`observationRecording` API) merged first, clean. **Reviews:** 5-finder SR + 2-finder #98 → **NO merge-blocking findings.** **Integrated gate GREEN (executed by coordinator + CI):** verifier PASS (§C.18/§C.19/§C.5), shared+server tsc clean, **jest 1449/1449 (87 suites)** incl. SR firewall both ways, app tsc + expo web export green. SR: NO new permission (reuses `tracker:*`/`message:dispatch`/`guardian:read_child`); app-native vocab (`REVISION_*` + `SR_ABSENT`/`SR_DIGEST` + `sr.*` MT keys, no wire sync); identity-plane firewall both ways; guardian `childRevision` delivered-only + omits staff fields. **Non-blocking follow-ups (memory):** SR `amountJuz` schema `min:0` (service validates `>0`); mistake-key `toLowerCase` fragility; `completenessChase` N+1 RoutineSlot per group (~4 groups); a stale GuardianHome comment (impl correct). **CO-2 NOT live** until `EXPO_PUBLIC` Google creds + the D-#149 handbook recording-policy check. **Highest D-#=#251.** **All open PRs landed — nothing queued.** —— Prior (SR build detail): **SATURDAY REVISION MODULE COMPLETE (SR-1..SR-4, server + app) — 4 stacked PRs #94→#97 (dev←sr-1←sr-2←sr-3←sr-4), all gated green.** SR-4 = the 🕌 Revision Expo tab (RevisionHome/GroupGrid/StudentHistory/Deliver/Dashboard) over SR-1..3 + a GuardianRevision card; carries the one `childRevision` guardian read SR-2 deferred (D-#251, delivered-only, guardian:read_child). **Gate RE-VERIFIED by me (executed):** app tsc clean + expo web export green (784 modules); server jest 1448/1448 (87 suites); vocab verifier PASS; no app-induced server/shared drift. Not verified live. **Build order SR-1→SR-2→SR-3→SR-4 done; merge the stack bottom-up (retarget each to dev as the one below lands).** —— Prior: **SR-3 BUILT — Saturday Revision derived analytics (slice 3 of 4) on branch `claude/sr-3`; PR #96.** `RevisionSummaryService` ALL DERIVED over SR-1 (no new model, D-#85): per-juz weakness heatmap, coverage/overdue, weekly ↑/↓/→ trend, level/student dashboards, mistake breakdown, + stateless completeness-chase (`sr.completeness_chase.wa`, message:dispatch + P/O); D-#246. **Gate GREEN (executed):** verifier PASS, shared+server tsc clean, **jest 1447/1447 (87 suites)** (+`revisionSummary.test.ts` [10]). Server-only; not verified live. **Next = SR-4** (Expo app — completes the module). —— Prior: **SR-2 BUILT — guardian delivery + consecutive-absence escalation (slice 2 of 4) on branch `claude/sr-2`; PR #95.** `deliverEntry` (absent alert / weekly digest on the wa.me+emit rails, MT registry `sr.{absent,digest}.*`, seals the SR-1 entry) + N-consecutive-absence escalation to guardian+Principal (default 2, read-time config, idempotent via `RevisionAbsenceDispatch`); `NOTIFICATION_KINDS += SR_ABSENT/SR_DIGEST` (verifier §C.5 exact-list extended); D-#244/#245. **Gate GREEN (executed):** verifier PASS, shared+server tsc clean, **jest 1437/1437 (86 suites)** (+`revisionDelivery.test.ts` [14]). Server-only; not verified live. **Next = SR-3** (derived analytics), then SR-4 (app). —— Prior: **SR-1 BUILT — Saturday Revision server foundation (slice 1 of 4) on branch `claude/sr-1` (off dev); PR #94.** Per-juz Hifz revision store (`RevisionEntry` + embedded `juzRecords`) + entry/edit + grid reads, reusing the Quran `SubjectGroup`/`QURAN_ONLY` calendar/membership; app-native vocab `REVISION_CATEGORIES`/`REVISION_MISTAKE_CATEGORIES` (verifier §C.19, NO wire sync); D-#241–#243. **Gate GREEN (executed):** verifier PASS, shared+server tsc clean, **jest 1422/1422 (85 suites)** (+`revision.test.ts` [22] + 2 firewall SR checks). Server-only; not verified live. **Building SR-2→SR-3→SR-4 next, one stacked PR per slice (SR-2 off `claude/sr-1`, etc.).** —— Prior: **FINANCE MODULE COMPLETE — FIN-1..FIN-6 MERGED to main via PR #92** (cloud-built bundle, 8 per-slice commits FIN-1→FIN-6B; coordinator 7-finder bundle review → **no merge-blocking findings** — the one `feeSplit.ts:88` endDate flag was a FALSE POSITIVE: the code excludes when `endDate < asOf` which matches the PRD "active if endDate ≥ asOf" verbatim, so the proposed `<`→`<=` flip would have broken it. **One renumber:** the PR's FIN-2B fee-split build ruling collided with CO-6's `D-#230` → renumbered to **D-#248** across DECISIONS/CHANGELOG/STATUS/3 code comments/prd-finance-fin2.md (CO-6's #230 untouched). **Integrated gate GREEN (executed by coordinator):** vocab verifier PASS (§C.18+§C.5), shared build + shared/server tsc clean, **jest 1398/1398 (84 suites)** incl. 7 new finance suites + the finance firewall block (corpus ⇄ finance both ways), app tsc clean + expo web export green (778 modules). All `finance:manage` (Principal+Office, no new role; NOT reserved → AC-1 can grant the books to an accountant alone); identity-plane (firewall both ways); single-school. **Non-blocking follow-ups (memory):** (1) budget annual/12 rounding drift is by-spec (D-#237/#238), no fix; (2) `guardianDueFor`/`providerStatement`/3×MT-render are fine at 91-student scale but would N+1 if a BULK fee-due chase is added — pre-load then; (3) optional `(date,kind)` index on FinancePosting at higher volume; (4) the app 💰 tab gates via `roleHasPermission(role,…)` per the established app convention, so a per-user `finance:manage` GRANT (AC-1) won't light the client tab though the server still gates — same limitation as AC-2/CO-app. **Next: build SR-1 (Saturday Revision, server) per docs/prd-sr1.md, OR the CO-2 footage app rider; FIN not verified live.** —— Prior cycle: **CM-5 + AC-1 BOTH MERGED to main (main=034a444)** — two server slices landed this cycle, integrated gate green: **jest 1198/1198 [70 suites]**, vocab verifier PASS incl. §C.17, shared/server tsc clean. **CM-5** (PR #78) — Comments: `MeetingComment` + comparison timeline + guardian `childComments`/`childMeetingSlot`, VOCAB-FREE, D-#124 governing + D-#202 ruling; coordinator 3-finder review = no fixes (comparison reads' reps-gate is intentional per PRD §8). **AC-1** (PR #79) — Per-user Access Control: role→template seam swap (`schema.ts` + ALL ~30 production `roleHasPermission(ctx.auth.role,…)` → `callerHasPermission(ctx.auth,…)`), 3 additive `User` fields ZERO-migration, `access:manage` RESERVED-locked, D-#193 + D-#210–#215; sole vocab owner; coordinator 6-finder review = no fixes (byte-identical proof = every prior RBAC test green; verifier §C.17). Merged CM-5 first, AC-1 last (highest blast radius, keep-both append-logs + index/Audit union). **Non-blocking follow-ups recorded:** (1) AC per-user changes apply on the target's NEXT login (JWT-baked, ≤8h TTL — D-#211; relevant to AC-2 UX); (2) `effectivePermissions` recomputes per gate — future per-request memo if profiling warrants; (3) CM-5 comparison timeline is wider than CM-1 section-scope (reps gate, by PRD design). Prior — **CT-4-FIX MERGED** [jest 1165, D-#196]. **DEP-1..6 DONE — prod LIVE + dev env + CI/CD.** On main as PRDs (not built): Finance (D-#186–#192), Saturday-Revision (D-#197–#201). **OPEN-PRD BACKLOG CLEARED — 7 slices landed PER-SLICE from the cloud-agent bundle PR #81 (hybrid approach: each cherry-picked into its own gated + finder-reviewed PR, stack order): AC-2 #82 (app editor over AC-1), CM-6 #83 (Comments app over CM-1..5), HR-G2 #84 (staff directory, D-#216/#217/#218), CO-2 #85 (SessionRecording/footage), CO-3 #86 (release+response+escalation, +4 NOTIFICATION_KINDS, D-#219), CO-4 #87 (trend), CO-5 #88 (Quran/ClassEcho form, D-#220).** Integrated gate green: **jest 1280/1280 (74 suites)**, verifier PASS (§C.16b Quran + §C.5 +4 obs kinds), shared/server tsc, app tsc + expo web export; dev synced. **PRs #80 + #81 closed** (superseded by the per-slice landing). **4 non-blocking follow-ups recorded (memory):** (1) HR-G2 N+1 in the observableOnly reverse-join; (2) CO-3 escalation sweep Promise.all not per-observation error-isolated (self-healing); (3) CO-5 reviewObservation silently drops an extraneous cross-form payload (data-safe; strict-reject = hardening); (4) **CO-2 footage-upload APP surface still missing** — #80's UI targets the old recordSessionRecording/sessionRecording API; the merged server uses recordSessionFootage/observationRecording; port needed (youtubeUpload.web.ts reusable on branch worktree-classroom-obs-co2; needs EXPO_PUBLIC Google creds + D-#149 handbook check). **Comments + Access Control now fully built server+app; Classroom Observation CO-1..CO-5 server done.** **CLASSROOM OBSERVATION MODULE COMPLETE server + app — CO-6 #89 + CO-7 #90 + CO-app #91 all MERGED to main 2026-06-15 (main=4ab24d7); integrated server jest 1323/1323 [77 suites], verifier PASS (§C.16c SUPPORT_TIERS), app tsc + expo export green; dev synced.** The 3 PRs from the (now-stopped) parallel CO session, landed per-slice + finder-reviewed: CO-6 review scheduler (SUPPORT_TIERS, suggests-not-assigns, D-#230), CO-7 reviewer effectiveness (calibration/timeliness/throughput/impact/fairness — PRIVATE, observation:manage-only, D-#231), CO-app (9 Expo screens over CO-1..CO-7). **Coordinator FIXED a CO-7 privacy leak pre-merge:** `fairnessRating`/`usefulnessRating` were plain-exposed on the row-scoped `ClassroomObservation` object → the rated OBSERVER could read their own rating; un-exposed (now ONLY via the `observation:manage` `reviewerEffectiveness` read + the `rateReview` mutation result, §CO-7 "surfaced to the Principal only"). CO-6 non-blocking nit: `ObservationScheduleConfig.needsSupportMultiplier` schema lacks `max:1` (service validates it). Also this session: **FIN-1 + FIN-2 build-contract PRDs authored** (finance:manage ratified D-#221; FIN-2 zakat per-head FULL/AMOUNT + SALARY pre-fill+adjust ratified D-#226/#228). **Open follow-up:** the CO-2 footage-upload APP surface (port #80's youtubeUpload.web.ts to recordSessionFootage/observationRecording). **Next: build FIN-1 (server) per docs/prd-finance-fin1.md, or FIN-2A. Carried follow-up: NONE blocking.**)_

## Now / next
- **Planned (Homework Check Grid HWG-1..HWG-2 — docs/prd-homework-check-grid.md,
  D-#267):** collapses the 3-interaction, 2-screen homework outcome entry into ONE
  tap per student on an attendance-style roster grid (ঠিক/আংশিক/ভুল/দেয়নি). HWG-1 =
  one atomic composite server mutation `recordHomeworkOutcome` that legally
  fast-forwards GIVEN→DUE→SUBMITTED→check (or →CHASE for not-submitted) reusing the
  existing lifecycle + check services with an audit row per edge — outcome is a
  server-validated String arg (no enum/vocab/contract change, no new permission,
  existing transition/check mutations untouched). HWG-2 = CheckingQueueScreen
  rebuilt as the grid (route name kept): all-state rows grouped date→item, one-tap
  chips for actionable states, inline expander for PARTIAL/WRONG extras,
  CHECKED/ABSENT rows read-only with a Records hint; Records screen stays as the
  exception drill-down. Follow-on noted in PRD §5: the deferred pending-by-date
  phases (Assignments→CT→Vocab→SR) should adopt this grid recipe later.
  Next = build HWG-1 per docs/prd-homework-check-grid.md §3.1, then HWG-2 per §3.2.
- **Planned (App-wide UX Improvement Program UX-1…UX-8 — docs/prd-ux-improvements.md, D-#265):**
  full app-code audit (2026-07-02) found 8 cross-cutting UX gaps; PRD defines 7 sequential
  slices — UX-1 toast/confirm/field-validation layer, UX-2 DateField sweep (21 typed-date
  screens), UX-3 searchable Select + class-test set picker, UX-4 staff "Today" dashboard +
  landing route (adds ONE gated server read `myDay`, no new permission, no vocab change),
  UX-5 unified class-button section pattern + context carry, UX-6 form shortening with
  advanced folds, UX-7 keyboard/refresh/FlatList/login hygiene. Each slice = one PR off dev
  with its own manual test checklist (§4.x.5). Docs-only this session.
  Revision 1 (2026-07-03, D-#266) adds UX-8: a teacher-first Class Notes drawer
  entry — new top-level flat drawer item opening the caller's OWN periods for a
  date via the existing myRoutineSlots read (zero class/subject selection),
  inline publish per period, homework link via a day-items picker (auto-link when
  exactly one) replacing the typed Homework ID field; the group-based DailyNote
  stays as the admin/cover path. App-only, no server change.
  Next = build UX-1 per docs/prd-ux-improvements.md §4.1, slice order UX-1→UX-8
  (UX-8 depends only on UX-1 and may be pulled earlier).
  (Renumbered from the handoff's D-#264 — that number is already claimed by the comments
  delivery-workflow ruling referenced across `main`/`dev` code and commit 8126f7c.)
- **Built (Homework ceiling lowered to 120 min, server + app):** shared `HW_DAILY_CEILING_MIN` now 120, so the daily reconciliation badge, confirm gate, and related homework rollups all use the lower cap. The homework reconciliation / resubmission / guardian portal tests were updated and the focused homework Jest sweep passed. **Gate GREEN (executed):** server tsc clean, app tsc clean, focused homework Jest sweep passed. Not verified live.
- **Built (Principal/Office class-note submission report, server + app):** the roll-up now renders in a tabular, admin-report layout with a row-limit selector, Print/PDF/Excel/Columns/Reset controls, teacher school ID, and posted vs pending subject columns; it still jumps back into Daily Note for follow-up. `ClassNoteReport` is wired into Routine Home, `DailyNote` accepts an optional date seed, and the server report resolver is covered by a focused Jest test. **Gate GREEN (executed):** `server/src/__tests__/routineClassNoteReport.test.ts` passed, server tsc clean, app tsc clean. Not verified live.
- **Built (Comments workflow — teachers author/edit, Principal/Office review + deliver, server + app, D-#263)
  [branch `feat/comments-any-teacher` off dev → PR into dev]:** from live testing. **Authoring** is no longer
  section-write-scoped: `record` drops `assertCanWrite` (keeps `tracker:write`; still stores the section) so any
  teacher comments on any child; a teacher edits **own** + sees them in **"My comments"** (`myStudentComments`).
  **Delivery removed from the teacher end** → **Principal/Office** only (`roster:manage`): `deliverStudentComment`
  is `roster:manage`-gated, `editStudentComment` allows author OR P/O reviewer (sealed once delivered), and new
  **`commentReviewInbox`** (`roster:manage`) powers a **Review & deliver dashboard** (every undelivered comment,
  child+author names) → P/O review/edit/deliver. Section reads widened `tracker:read`→`authenticated` so Office
  (no tracker perms) can review; `assertReadSection` stays the gate. Also: `ClassSectionSelect` auto-selects a
  class's sole section (shared picker). **No new perm/enum/vocab/contract; firewall untouched.** **Gate GREEN
  (executed):** verifier PASS, shared build + server tsc + app tsc clean, **server jest green** (+myComments/
  reviewInbox/reviewer-edit), expo web export green. Highest D-#=#263. Not verified live.
- **Built (Pending-by-date — Phase 1 Homework, server + app) [branch `feat/pending-by-date-homework` off dev
  → PR into dev]:** Phase 1 of the cross-tracker rework "auto-show pending work grouped by date, no date
  picker" (owner request, all-trackers scope). **Homework Checking queue + Student records** drop the typed
  date field + per-item drill-in and auto-list ALL pending records for the section across every date, grouped
  into **date-wise cards**. New server read `homeworkOpenRecords(sectionId, classId, states)` (`listOpenRecords`
  joins item subject/date + student name; `tracker:read` + `assertCanRead`); Checking = `["SUBMITTED"]`,
  Records = open non-terminal set; existing check/transition/attach actions unchanged. New pure
  `lib/groupByDate.ts` + `dateHeaderLabel`. **No vocab/contract/RBAC change.** **Gate GREEN (executed):**
  verifier PASS, shared build + server tsc + app tsc clean, **jest 1488/1488 (91 suites)**, expo web export
  green. No new D-#. Not verified live. **Remaining phases (same recipe, per-module PRs, owner deferred):
  Assignments → Class Test → Vocabulary → Saturday Revision.**
- **Built (Per-class Homework dashboard — server + app) [branch `feat/homework-class-dashboard` off dev → PR
  into dev]:** from live testing of the Homework screen. The landing replaces the SectionPicker with inline
  **class buttons** (the teacher's assigned classes — `myScopes` ∪ class-teacher sections; Principal/Office
  see all), each with a cumulative **badge** (pending-checking count; red when chases open). Tapping a class
  loads that class+date's detail inline — one accessible section auto-selects, several show a **section row**;
  selection still flows through `SectionContext` so Declare/Reconcile/Records/Checking are unchanged. Date is
  a real **calendar** on web (`<input type=date>`) + phone (new `@react-native-community/datetimepicker`) via a
  platform-split `DateField`. Server: `homeworkSummary` += `pendingChecking`; new `homeworkClassOverview(refs)`
  batch query (pending checking / open resubmissions / active chases / on-time% / over-ceiling-days-this-week
  per class; each ref `assertCanRead`-gated, unreadable refs skipped). **No vocab/contract/enum/RBAC change**
  (reuses `tracker:read`). **Gate GREEN (executed against dev base):** verifier PASS, shared build + server tsc
  clean, app tsc clean, **jest 1487/1487 (90 suites)**, expo web export green. No new D-#. Not verified live.
- **Built (Supervisory read-oversight grant CRUD — server + app, D-#262) [branch `feat/supervisory-grants`
  off dev]:** answers the owner question "can a teacher see all classes' lesson plans?" — yes, via the
  ADR-017 **supervisory** grant, whose kind + four extents + read-scoping (`canRead` + `contentScope`,
  D-#257) already existed but had **no create/list/revoke seam** (ScopeGrantScreen's header literally said
  "supervisory grant CRUD needs server mutations not yet exposed"). New `grantSupervisory`/`revokeSupervisory`/
  `supervisoryGrants` (gated `user:manage`, **no new permission**, mirrors the teaching-grant exposure D-#249)
  with a **configurable extent**: `whole_school` (all) / `subject_dept` (one subject × all classes) /
  `grade_class` (one class × all subjects) / `explicit_set` ((class,subject) pairs). Single-target extents
  idempotent on (teacher, extent, target); `explicit_set` always creates. `ScopeGrant` view + GraphQL type gain
  `extent` + `explicitSet` (additive, null on teaching/proxy); pure `validateSupervisoryGrant` (unit-tested, +5).
  **App:** new `SupervisoryGrant` admin screen (teacher + scope picker + explicit-set pair-builder + revoke list)
  + AdminHome card + nav wiring + bilingual `sg*` labels. **Supervisory is READ-ONLY** (`canWrite` ignores it,
  D-#17) → a grant lets the teacher SEE content + section trackers at the scope, NOT write — surfaced in the UI
  hint. **No vocab/contract change.** **Gate GREEN (executed): server tsc + jest scopeGrant 26/26 + app tsc.**
  **Not verified live.** Highest D-#=**262** (renumbered from #261 — origin/dev already took #261 for the
  plan-review override; merged origin/dev in + kept both rows). PR #121 → dev (CI gate).
- **Built (Plan-review Principal override + status visibility — server + app, D-#261) [branch
  `feat/plan-review-principal-override` off dev → PR into dev]:** from live Principal testing of the
  পর্যালোচনা (review) screen. (1) **Override sign-off:** `approvePlan(artifactId, overrideReason?)` lets the
  Principal overrule a reviewer's CHANGES_REQUESTED and advance a non-`reviewed` plan straight to `gold` with
  a REQUIRED reason (a blank reason is rejected; the normal `reviewed→gold` path is unchanged + reason-free).
  Sign-off stamps `approvedBy/approvedAt/approvalOverride` + (when given) `approvalNote` on `ContentArtifact`
  (additive, zero-migration optional fields) + audits `PLAN_APPROVED` with `{override, reason}`; open rounds
  are superseded as before. The review-thread shows an **"Override & approve"** card (reason field) for a
  non-`reviewed` plan + the stored reason once `gold`. (2) **Status visibility:** the bulk-assign screen
  (`AssignReviewsScreen`) gains a reviewStatus badge + a status filter + a class filter so the Principal sees
  which plans are draft/reviewed/approved. **Principal-only (reuses `content:promote_gold`, NO new perm); no
  vocab/contract change** (verifier untouched). **Gate GREEN (executed against dev base):** vocab verifier
  PASS, shared build + shared/server tsc clean, app tsc clean, **jest 1479/1479 (90 suites; +4 override
  tests)**. Highest D-#=#261. Not verified live.
- **Local-testing fixes — branch `feat/meaningful-errors-and-hw-lifecycle` off dev, 2026-06-17 (7 commits,
  NOT pushed/PR'd — owner driving):** the whole live-testing follow-up backlog is now BUILT + gated green
  (server tsc + jest 1472/1472 (90 suites) + app tsc + expo export throughout). Commits: (1) **meaningful
  errors on every screen** (`maskError` surfaces bare `Error` messages, deny-list keeps Mongo/JWT masked —
  **D-#259**, extends D-#256); (2) **homework per-student lifecycle screen** (`HomeworkRecordsScreen` wires the
  missing GIVEN→DUE→SUBMITTED step so the Checking queue is reachable); (3) **stale unique-index migration**
  (`migrate-hw-record-index.ts` dropped `hwItemId_1_studentId_1` on scdhub_local — **dev/prod still need it
  run** before the Wrong→resubmission path is used); (4) **bulk reviewer-assignment + Principal load overview**
  (`assignPlanReviewBulk`/`reviewerAssignmentLoad`/`assignablePlans` + `AssignReviewsScreen`, owner request, no
  new perm); (5) **routine slots show the class/group name** (`enrichRoutineSlots` `groupName`); (6) **Section→
  Class display** post-merge (`SectionBar`); (7) **checking-queue student names + day-tally refetch-on-focus +
  drawer toggle on nested screens**. i18n module-level-`STR` capture was a single instance (HomeworkRecords),
  fixed in commit 2; verified no others remain. Remaining backlog items (memory `project_local_testing_followups.md`)
  are non-blocking. **NEXT: owner live-tests the branch; then push + PR `feat/...` → dev; run the index migration
  on dev/prod.**
- **Planned (Monitoring & Error Reporting MON-1..MON-6 — launch-readiness observability, build contract
  authored `docs/prd-observability.md`, D-#252/#253 ratified 2026-06-15):** answers "how will I know when
  users (web/Android/iOS) hit a problem?" — today there is **NO auto-reporting** (server `console.error`→
  journal; app has no `ErrorBoundary`/global urql error handler/tracker). The plan: **self-host GlitchTip**
  (Sentry-API-compatible) on the VM (systemd+Caddy, DEP-2 pattern) + `@sentry/node` (server) +
  `@sentry/react-native`/`sentry-expo` (web/Android/iOS) + `ErrorBoundary` + **notification-delivery
  monitoring** (Expo push receipts + ticker watchdog — the silent-failure path) + **off-box uptime
  backstop** + **VM disk/RAM alert** (the self-monitoring + host blind-spots). Slices: MON-1 GlitchTip
  self-host + guardrails → MON-2 server capture → MON-3 app capture + symbolication + "Report a problem"
  → MON-4 notification monitoring → MON-5 availability/host → MON-6 (optional) centralized logs.
  **Governance: D-#252 = a NEW third telemetry plane that MAY carry identity for debugging, ISOLATED from
  the ADR-005 corpus firewall (UNCHANGED, fail-closed test intact) — a new append-only row, NOT an edit to
  ADR-005; D-#253 = self-host over managed SaaS so PII stays on our infra.** Config ratified: 30-day
  retention, email alerts, GlitchTip Postgres folded into the nightly Drive backup, Android-APK-first for
  the MON-3 native acceptance. **NO `shared/vocab.ts` / wire-contract / `NOTIFICATION_KINDS` / app-RBAC
  change** (verifier untouched, jest unaffected, parallel-safe). **Subdomain `errors.<prod-host>` CREATED
  + verified pointing at the VM 2026-06-15 (propagating across resolvers).** **Full execution runbook now
  authored — `docs/observability-runbook.md`** (concrete compose/env/Caddy/CI snippets + code + per-slice
  executed-acceptance + an explicit **[OP]operator / [EX]executor** split; all IP/domain/DSN/SMTP as
  `<PLACEHOLDERS>` per §0), written so a FRESH session can build the whole module end-to-end. Build order
  MON-1[OP]→MON-2[EX]→MON-3[EX]→MON-4[EX]→MON-5[OP] (MON-6 later); ~1 day core + ~½ day MON-4..5.
  **STATUS UPDATE 2026-06-15 (this session): MON-1 (GlitchTip self-host, operator) + MON-2..MON-5 are NOW
  BUILT** — stacked PRs #102 (MON-2 server capture) → #103 (MON-3 app capture) → #104 (MON-4 notification
  monitoring) → #105 (MON-5 host-alert script), each gated green + "not verified live" pending the operator
  acceptance. **Only MON-6 (centralized structured logs) remains — deferred, non-launch-blocking.** See the
  per-slice "Built (Observability MON-*)" bullets below.
- **Built (Observability MON-2 — server error capture `@sentry/node`, prd-observability.md §4 /
  observability-runbook.md MON-2, D-#252/#253) [branch `claude/open-prd-xuh335-mon2` off dev]:** slice 2 of the
  MON module (MON-1 GlitchTip self-host already LIVE at https://errors.scdhub.shafayet.me + backup folded in).
  New `server/src/observability/sentry.ts` inits `@sentry/node` **only when `SENTRY_DSN` is set** (no-op for
  local/dev/jest → standing gate untouched); `beforeSend` scrubs credential headers + recursively strips
  `password`/`token`/`secret`/`jwt` keys (D-#252 §6); `tracesSampleRate:0`, `release=GIT_SHA` + `environment`;
  auto-captures `uncaughtException`/`unhandledRejection`. **Resolver capture** = a Yoga/Envelop plugin
  (`sentryYogaPlugin`) reporting `result.errors` with `operation` + `role`/`userId`, **skipping the app's
  expected/business error classes** (`EXPECTED_ERROR_NAMES` + Pothos "Not authorized" text) so deliberate
  denials don't flood the dashboard (§6 quota = hard ceiling); `setupExpressErrorHandler` covers the REST
  surface; a `SENTRY_DEBUG_ROUTE=1` non-prod-only `/debug/sentry` aid (off by default). **No vocab/contract
  change. Gate GREEN (executed): server tsc clean + jest 1457/1457 (88 suites; +`observability.test.ts` [7]).
  Server-only. Not verified live** (operator triggers a fault → confirms scrubbed payload in `scdhub-server`).
  **Next = MON-3** (app capture: web/Android/iOS + ErrorBoundary + "Report a problem").
- **Built (Observability MON-3 — app error capture web/Android/iOS + ErrorBoundary + "Report a problem",
  `@sentry/react-native`, prd-observability.md §4 / observability-runbook.md MON-3, D-#252/#253) [branch
  `claude/open-prd-xuh335-mon3` stacked off MON-2]:** JS + native crashes on all three clients land in the
  same self-hosted GlitchTip (`scdhub-app` project), plus a user self-report path. New
  `app/src/observability/sentry.ts` inits `@sentry/react-native@5.24.3` (Expo-51-pinned) **only when
  `EXPO_PUBLIC_SENTRY_DSN` is set** (no-op for local/the web-export gate; sessions off, `tracesSampleRate:0`,
  `sendDefaultPii:false`). **App.tsx:** `initSentry()` + `Sentry.wrap(App)` + a top-level `Sentry.ErrorBoundary`
  OUTSIDE the providers with a self-contained BN/EN `AppErrorFallback` (web white-screen → reload + auto-report).
  **urql** (`client.ts`): a `mapExchange` captures **networkError only** (transport failures MON-2 can't see;
  graphQLErrors stay server-side to avoid flooding). **Symbolication:** `metro.config.js`→`getSentryExpoConfig`
  (debug-IDs injected, verified in the bundle); `app.json`→`@sentry/react-native/expo` plugin; `deploy.sh` emits
  + uploads web source maps via `sentry-cli` then deletes the `.map`s (guarded by `SENTRY_AUTH_TOKEN`, non-fatal).
  **"Report a problem":** a 🐞 `HeaderRight` button (every authed user, staff + guardian) → root-modal
  `ReportProblemScreen` (`captureUserFeedback`). New `report*`/`errBoundary*` BN+EN labels; `.env.example` updated.
  **No vocab/contract change. Gate GREEN (executed): app tsc clean + expo web export green (debug-IDs injected),
  no server/shared drift.** **Not verified live** (operator forces web + Android-APK crashes → symbolicated stacks
  + feedback event). **Next = MON-4** (notification-delivery monitoring — push receipts + ticker watchdog).
- **Built (Observability MON-4 — notification-delivery monitoring, the silent-failure path, server,
  prd-observability.md §4 / observability-runbook.md MON-4, D-#252/#253) [branch `claude/open-prd-xuh335-mon4`
  stacked off MON-3]:** catches delivery failures that throw NO exception. **(1) Expo push ticket errors →
  GlitchTip:** pure `deliveryFailureCodes(tickets)` in `ExpoPush.ts` surfaces every error ticket EXCEPT the
  routine `DeviceNotRegistered` prune (would flood); `sendExpoPush` calls `capturePushDeliveryFailure`
  (new server sentry helper → `expo_push_delivery_failed` warning) per failure + a `transport_unreachable`
  capture on the unreachable catch (today both silently dropped). **(2) Ticker watchdog:** `SchedulerService`
  records `lastTickAt` (set FIRST in `runSchedulerTick`, before the school-day gate) + pure `getTickerHealth()`
  → `{lastTickAt, ageSeconds}`, exposed at **`GET /internal/ticker`** (no PII) for MON-5's off-box monitor.
  **No vocab/contract change. Gate GREEN (executed): server tsc clean + jest 1462/1462 (89 suites;
  +notificationMonitoring.test.ts [3] + 2 heartbeat tests). Server-only. Not verified live** (operator: bad
  push token → captured event; stop ticker → /internal/ticker stale + MON-5 alert). **Next = MON-5** (off-box
  uptime + VM host-alert script; mostly operator [OP] + the `scripts/host-alert.sh` [EX] writes).
- **Built (Observability MON-5 — host disk/RAM alert + availability runbook, prd-observability.md §4 /
  observability-runbook.md MON-5, D-#252/#253) [branch `claude/open-prd-xuh335-mon5` stacked off MON-4]:**
  the self-monitoring + host blind-spot fixes. **[EX]:** new `scripts/host-alert.sh` — cron disk/RAM threshold
  check that warns before disk-full/OOM takes down prod AND GlitchTip together (shared VM disk). Env-tunable
  (`ALERT_EMAIL`, `HOST_ALERT_DISK_PCT`=85, `HOST_ALERT_MEM_FREE_PCT`=10); mail/msmtp with stdout fallback;
  never fails the cron. **Executed:** `bash -n` clean, forced-low threshold fired, normal silent. **[OP]
  (documented in the PR, not committed):** UptimeRobot off-box monitors (prod/dev `/healthz`, the GlitchTip
  URL, `/internal/ticker` keyword) + the `*/15` cron → email. **No vocab/contract change; no server/app
  source touched. Email/uptime legs not verified live** (operator). **MON-1..5 now built; MON-6 (centralized
  logs) deferred, non-launch-blocking — the MON launch set is complete.**
- **Built (Saturday Revision SR-4 — the Expo app, COMPLETES the module SR-1..SR-4, prd-sr4.md §2/§3/§4,
  D-#68/#155 + build ruling D-#251) [branch `claude/sr-4` stacked off `claude/sr-3`]:** the 🕌 Revision tab over
  the merged SR-1..SR-3 resolvers + the new SR-4 `childRevision` guardian read. **App:** `app/src/graphql/revision.ts`
  (typed urql ops over the full SR surface) + `RevisionStack` + the 🕌 tab gated `tracker:read || roster:manage`
  (GUARDIAN excluded). 5 screens — RevisionHome (`myRevisionGroups` + Saturday date field), GroupRevisionGrid
  (J-SR1 per-student present/absent + per-juz JuzRecord editor + comment; `recordRevisionEntry`/`editRevisionEntry`;
  read-only once delivered), StudentRevisionHistory, DeliverRevision (J-SR2 — deliver-all/per-entry, `Linking.openURL`
  wa.me + delivered/unreachable/escalated badges), RevisionDashboard (J-SR3 — level dashboard / weekly ↑↓→ trend /
  mistake breakdown / coverage-overdue / juz-weakness heat / completeness + chase). **Guardian rider:** a read-only
  GuardianRevision card on GuardianHome via `childRevision` (delivered-only, own child — the `childComments` posture).
  `tabRevision`/`rev*` BN/EN labels reusing the `@scd/shared` REVISION_* maps. **Server (D-#251):** SR-4 carries the
  one `childRevision` guardian read SR-2 deferred (delivered-only, `guardian:read_child` + `assertGuardianOfStudent`,
  staff fields omitted — D-#68/#155) so the module is complete — NOT strictly app-only. Built by a delegated subagent;
  **gate RE-VERIFIED by me (executed): app `tsc --noEmit` clean + `expo export --platform web` green (784 modules);
  server jest 1448/1448 (87 suites; +1 childRevision test); vocab verifier PASS; no app-induced server/shared drift.**
  Intentional app simplifications (recorded): plain `YYYY-MM-DD` date field (no native picker dep); numeric/badge
  dashboards (no charting lib, the CT/VC/Finance posture); the per-student weakness heat takes a Student-id field.
  **Not verified live. SATURDAY REVISION MODULE COMPLETE (SR-1..SR-4, server + app).**
- **Built (Saturday Revision SR-3 — derived analytics, server, prd-sr3.md §3/§4/§5/§6, D-#246)
  [branch `claude/sr-3` stacked off `claude/sr-2`]:** slice 3 of 4 — the payoff of per-juz recording, **ALL
  DERIVED over SR-1** (no new model, D-#85). **`RevisionSummaryService`** (pure `aggregate` + `trendOf`):
  `studentJuzWeakness` (per-juz Σতানবিহ/ফাতহ + mistakes — the weakness heatmap), `groupCoverage` (per student×juz
  last-revised + overdue over a read-time 28-day window), `weeklyTrend` (per-Saturday ↑/↓/→), `levelDashboard`/
  `studentDashboard`, `mistakeBreakdown`, `completenessStatus` (the gap), `completenessChase` (STATELESS wa.me nudge
  via `sr.completeness_chase.wa`, no follow-up/audit). **Resolver:** 8 reads — student/group `tracker:read` + group
  scope (P/O unscoped); dashboards + completeness P/O; chase `message:dispatch` + P/O (Office chases, not the
  teacher — D-#88); GUARDIAN denied. **Vocab:** one MT key `sr.completeness_chase.wa` + verifier §C.19 SR-3 check.
  NO new model/permission; firewall block extended. **Gate GREEN (executed):** verifier PASS, shared build +
  shared/server tsc clean, **jest 1447/1447** (87 suites; +`revisionSummary.test.ts` [10] over the 1437 base;
  firewall green). **Server-only. Not verified live. Next = SR-4** (the Expo app — completes the module).
- **Built (Saturday Revision SR-2 — guardian delivery + Saturday trigger, server, prd-sr2.md §3/§4/§5/§6,
  D-#244/#245) [branch `claude/sr-2` stacked off `claude/sr-1`]:** slice 2 of 4 — each Saturday's outcome
  reaches the family on the existing rails. **`RevisionDeliveryService`:** `deliverEntry` (absent → `sr.absent.*`;
  present → `sr.digest.*` portions/তানবিহ-ফাতহ/mistakes/comment via pure `buildDigestSummary`; wa.me for every
  family with a phone + `emitRevisionDelivery` inbox/push for login-enabled guardians; **seals** the SR-1
  `deliveredAt`; audit `SR_ENTRY_DELIVERED`; N+1 guard) + `deliverGroupSaturday` (batch). **Escalation (D-#245):**
  `checkAbsenceEscalation` on an absent delivery — streak ≥ admin threshold (read-time default **2**,
  `RevisionEscalationConfig` singleton, NO seed — D-#97) → guardian + every active Principal
  (`emitRevisionEscalation`, reuses `SR_ABSENT`), idempotent per (student, streakLength) via
  `RevisionAbsenceDispatch`; audit `SR_ABSENCE_ESCALATED`. **Vocab (app-native, NO wire sync):**
  `NOTIFICATION_KINDS += SR_ABSENT/SR_DIGEST` (verifier §C.5 exact-list extended) + `sr.{absent,digest}.*` MT keys +
  registry defaults + verifier §C.19 SR-2 checks. `NotificationRefs += revisionEntryId/streakLength/escalation`.
  **Resolver:** `deliverRevisionEntry`/`deliverGroupRevisionSaturday` (group-teacher `tracker:write` OR P/O) +
  `revisionEscalationConfig`/`setRevisionEscalationConfig` (P/O only); GUARDIAN recipient-only. 3 audit kinds;
  firewall block extended. **Gate GREEN (executed):** verifier PASS (§C.5 + §C.19 SR-2), shared build +
  shared/server tsc clean, **jest 1437/1437** (86 suites; +`revisionDelivery.test.ts` [14] + 1 firewall SR-2 file
  check over the 1422 base; firewall green). **Server-only. Not verified live. Next = SR-3** (derived analytics).
- **Built (Saturday Revision SR-1 — models + entry + grid reads, server, prd-sr1.md §3/§4/§5/§6, D-#241–#243)
  [branch `claude/sr-1` off dev]:** slice 1 of 4 of the Saturday Qur'an-Hifz revision module (replaces the paper
  শিক্ষার্থীর পাঠ সম্পাদন রিপোর্ট). New `server/src/modules/saturday-revision/`. **Model `RevisionEntry`**
  (one per student×Saturday, unique; embedded `juzRecords` per-juz category/amount/তানবিহ-ফাতহ/structured mistake
  counts {harf,ghunnah,madd,other}; `deliveredAt` immutability seal — D-#242; no schoolId). **`RevisionService`:**
  `recordEntry` (upsert — group=Hifz Quran `SubjectGroup` + date=`QURAN_ONLY` Saturday via the D-#50 ONE calendar +
  active `SubjectGroupMembership`, all validated server-side; present⇒records / absent⇒none; per-juz split;
  immutable-after-deliver; audit `SR_REVISION_RECORDED`), `editEntry` (by id, refused once delivered),
  `groupSaturday` (the roster×Saturday grid), `studentRevisionHistory`, `myRevisionGroups`, + the
  `teacherTeachesGroup`/`teacherCanReadStudent` Quran-group scope helpers (RoutineSlot teacherId, D-#56).
  **Resolver:** record/edit + 3 reads — authScopes `authenticated:true` + internal `tracker:write`/`tracker:read` +
  Quran-group scope (OFFICE holds no `tracker:*` → Principal/Office admin-bypass, the CT-4-FIX/D-#196 posture);
  GUARDIAN denied. **Vocab (app-native, NO wire sync):** `REVISION_CATEGORIES` [SABAQ/SABQI/MANZIL] +
  `REVISION_MISTAKE_CATEGORIES` [HARF/GHUNNAH/MADD/OTHER] + BN/EN + verifier §C.19 (NO NOTIFICATION_KINDS/MT keys —
  those are SR-2). 1 audit kind; new saturday-revision firewall block (corpus ⇄ SR both ways). **Gate GREEN
  (executed):** vocab verifier PASS (§C.19), shared build + shared/server tsc clean, **jest 1422/1422** (85 suites;
  +1 new suite `revision.test.ts` [22] + 2 firewall SR checks over the 1398 base; firewall green). **Server-only.
  Not verified live. Next = SR-2** (guardian delivery + Saturday trigger).
- **Built (testing-round fixes + 2 admin features) [branch `test/teacher-content` off dev → PR #93 into dev]:** from a
  live Principal testing session. App UX fixes — StaffCredentials search + inline password (no list-jump); Users
  list refetch-on-focus (provisioned logins now appear); web nav-state persistence (browser refresh keeps the
  current screen); AssignClassTeacher tappable overview rows + assigned teacher/support names. **Subject-teacher
  assignment** (server `grantTeaching`/`revokeTeaching`/`teachingGrants`, `user:manage`, **D-#249**; new
  Assign-subject-teacher screen) — closes the ScopeGrantScreen "teaching-grant CRUD not yet exposed" gap.
  **Academic-year set-once** (server `createAcademicYear`/`setCurrentAcademicYear`, `roster:manage`, **D-#250**; new
  Academic-Year admin screen; `AcademicYearSelect` auto-hides on operational screens when a single year exists) —
  design-A. **No vocab/contract change** (audit kinds server-local). Merged origin/dev (CO module) into the branch +
  re-verified. **Gate GREEN (executed): jest 1324/1324 (77 suites), server/app tsc, vocab verifier PASS, expo web
  export.** **Not verified live. Parked (design-B, decide after testing):** replace the section picker with
  all-students-by-default + class/section/gender filters.
- **Built (FINANCE MODULE COMPLETE — FIN-1..FIN-6, server + app) [branch `claude/open-prds-o1bwkh`]:** the whole
  finance/accounting module landed slice-by-slice (build order FIN-1 → 2A → 2B → 3 → 4 → 5 → 6A → 6B), each its own
  commit with the gate green. **FIN-1** ledgers + opening balances + the `finance:manage` perm + the whole-module
  vocab freeze (`LEDGER_KINDS`/`FINANCE_*`/`QARD_IOU_*`, new verifier §C.18) + the `ledgerBalanceAsOf` seam. **FIN-2A**
  `FinancePosting` (append-only, kind-discriminated; reverse-not-edit) + the derived daily snapshot (seam extended to
  opening + Σ postings) + the PII-free HR SALARY pre-fill bridge. **FIN-2B** zakat/3rd-party fee-support (`FeeProvider`
  + effective-dated `FeeSupportAllocation` + pure `splitFee` + provider statement + guardian fee-due chase; **build
  ruling D-#248** — the split is a derived memo, no double-count). **FIN-3** Qard/IOU register (`FinanceParty` +
  append-only `QardIouEntry`; one record carries both cash + control effects, seam + snapshot fold all 5 ledgers;
  staff advances stay HR). **FIN-4** dual reconciliation (`ReconciliationEntry`; bankDiff + per-ledger eximusDiff off
  the seam, Eximus parallel/no live link). **FIN-5** budget-vs-actual (`BudgetLine` per year×head + monthly phasing;
  actuals auto-derived, movement heads excluded). **FIN-6A** rollups + Principal dashboard reads (ALL derived, no new
  model). **FIN-6B** the 💰 Finance Expo tab (gated `finance:manage`, GUARDIAN never; 8 screens over FIN-1..6 — built
  by a delegated subagent, gate RE-VERIFIED by me). **Vocab added (app-native, NO wire sync):** the FIN-1 freeze +
  `FINANCE_POSTING_KINDS` + `FEE_COVERAGE_TYPES` + `FEE_SUPPORT_ALLOCATION_STATUSES` + `FINANCE_FEE_DUE` (kind) +
  `finance.fee_due.chase.*` MT keys + `FINANCE_PARTY_KINDS` + `RECON_SOURCES` + `BUDGET_LINE_KINDS`. **D-#248 newly
  RULED at build** (FIN-2B fee-split = derived memo; the rest were the D-#221–#240 planning band). **Gate GREEN
  (executed, server slices):** vocab verifier PASS (§C.18 + §C.5), shared build + shared/server tsc clean, **jest
  1398/1398 (84 suites)** incl. 7 new finance suites + the finance firewall block (corpus ⇄ finance both ways).
  **Gate GREEN (executed, FIN-6B app):** app `tsc --noEmit` clean + `expo export --platform web` green (778 modules);
  no server/shared drift (`git diff` empty). **Not verified live.** **Carried follow-up (FIN-6B app):** the DailyEntry
  salary-adjustment lines + the budget monthly-override UI are wired in the ops but the screens pass base-only /
  annual-only (additive optional args — no broken functionality); a later app polish can surface them.
  **Next = promote `dev`→prod when ready, or build SR-1 (the other open module).**
- **Built (Classroom Observation app surface — Expo, APP-ONLY, prd-classroom-observation §CO-1..§CO-7) [branch
  `slice/co-app` off dev] — COMPLETES the module server + app:** the Expo surface over the CO-1..CO-7 resolvers.
  **NO server/shared/vocab/contract change** (`git diff origin/dev -- server shared` empty). New 👁️ Observation tab
  gated `observation:read||upload||review||manage` (GUARDIAN excluded); `app/src/graphql/observation.ts` ops module
  + 9 screens (`ObservationStack`): Home, UploadObservation (J1), ReviewQueue, ReviewObservation (REF-11 OR Quran by
  form), ObservationDetail (view + observed-teacher Respond + Rate-review + Principal re-request/attach-footage),
  ObservationTrend, ObservationDueList (CO-6 + schedule config), ReviewerEffectiveness (CO-7), ObservationConfig
  (CO-3 escalation). `obs*` BN/EN labels + helpers; `ObservationStackParamList`. Built by a delegated subagent;
  **gate RE-VERIFIED by me (executed): app tsc clean + expo export green (769 modules), server/shared diff empty.**
  Intentional simplifications (recorded): free-text id fields (the `users` directory is `user:manage`-gated, would
  dead-end Office); footage = manual YouTube-id field + open-link (the GIS auto-upload stays the CO-2 app rider).
  No DECISIONS row (app slice — CT-5/VC-5/CM-6 posture). **The CO-6/CO-7 app surfaces reference ops that ride PRs
  #89/#90 (not yet on dev); the app build doesn't validate against the live schema so they light up once those
  merge.** **Not verified live. Next = FIN-1.**
- **Built (Classroom Observation CO-7 — reviewer effectiveness, server, prd-classroom-observation §CO-7, build
  ruling D-#231) [branch `slice/co7` off dev] — COMPLETES the CO-1..CO-7 server pipeline:** a PRIVATE,
  developmental read on how well the OBSERVERS review (Principal/Office only — NOT a public scoreboard) + the
  observed teacher's fairness rating of a review. **VOCAB-FREE** (rating scale + audit kind server-local; verifier
  untouched); **NO new permission** (reuses observation:read for the rating + observation:manage for the read).
  Model: 3 additive nullable fields (fairnessRating/usefulnessRating 1–5 + fairnessRatedAt) on `ClassroomObservation`.
  `ClassroomObservationEffectivenessService`: `rateReview` (observed-teacher + released-state gated, audited
  OBSERVATION_REVIEW_RATED) + `reviewerEffectiveness(now)` (one-pass DERIVED): (1) calibration = per-domain
  agreement-within-one between two observers sharing a recordingId (the re-review pipeline puts ≥2 on a recording);
  (2) timeliness = assign→review turnaround + ASSIGNED backlog; (3) throughput; (4) developmental impact = domains
  improved on a re-review chain, attributed to the PRIOR observer (D-#231 — overall-movement proxy since growthFocus
  is free text); (5) teacher fairness ratings. Pure `agreementWithinOne` + `domainMovement`. Resolvers:
  `rateObservationReview` (observation:read) + `reviewerEffectiveness` (observation:manage). **Gate GREEN (executed):**
  shared build + verifier PASS (untouched), shared/server tsc clean, **jest 1298/1298** (76 suites; +1 new suite
  `observationEffectiveness.test.ts` [18] over the 1280 base; firewall green). **Server-only. Not verified live. PR
  pending. Next = CO app surface.**
- **Built (Classroom Observation CO-6 — review scheduler, server, prd-classroom-observation §CO-6, build ruling
  D-#230) [branch `slice/co6` off dev]:** the tier-driven cadence scheduler that SUGGESTS who's due for a review —
  **never auto-assigns** (§CO-6 guardrail). **Server-only; the ONLY shared change is `shared/vocab.ts`**
  (`SUPPORT_TIERS` [STRONG/DEVELOPING/NEEDS_SUPPORT] + BN/EN labels, app-native NO wire twin D-#46; verifier §C.16c);
  **NO new permission** (reuses observation:read/manage). All DERIVED (D-#85): pure `deriveTier` (REF-11 breach/level-1
  ⇒ NEEDS_SUPPORT, all ≥3 ⇒ STRONG, else DEVELOPING; Quran avg≥4+full-compliance ⇒ STRONG, avg≤2.5 or <½ ⇒
  NEEDS_SUPPORT, else DEVELOPING — review data only) + pure `intervalForTier` (DEVELOPING base, STRONG ×mult longest,
  NEEDS_SUPPORT ×mult shortest, clamped to the minIntervalDays frequency cap). `dueForReview(now)` — candidates =
  teachers with REAL teaching sessions (distinct teacherId over active non-break RoutineSlots), tiered off their MOST
  RECENT released review; only due/overdue (+ never-reviewed → soonest bucket) returned, ranked never-reviewed →
  weakest tier → most-overdue. `ObservationScheduleConfig` singleton (read-time defaults 30 / ×2 / ×0.5 / cap 7, NO
  seed write D-#97); `setScheduleConfig` validates + audits `OBSERVATION_SCHEDULE_CONFIG_SET`. Resolvers
  (`observationSchedule.ts`): observationDueList + observationScheduleConfig + setObservationScheduleConfig — **all
  gated observation:manage** (D-#230: the "Principal/Office/observers" intent narrowed to manage — no perm
  distinguishes an observer from a plain TEACHER, and observation:read would expose every teacher's cadence to ALL
  staff). 1 audit kind; CO firewall auto-covers. **Gate GREEN (executed):** shared build + vocab verifier PASS
  (§C.16c), shared/server tsc clean, **jest 1305/1305** (76 suites; +1 new suite `observationScheduler.test.ts` [25]
  over the 1280 base; firewall green). **Server-only. Not verified live. PR pending. Next = CO-7** (reviewer
  effectiveness).
- **Planned (Finance FIN-1 — Ledgers & opening balances, build-contract PRD authored `docs/prd-finance-fin1.md`,
  D-#221–#223):** slice 1 of 6 over the finance REQ (`finance-requirements.md`, D-#186–#192). FIN-1 = the
  FOUNDATION only (no postings — those are FIN-2): the 5 `LEDGER_KINDS` + the full **`FINANCE_*`-namespaced
  vocab freeze** (modes/income/student-fee/movement/expense[~24]/Qard-IOU dirs+types — namespaced to dodge
  the HR `PAYMENT_METHODS` clash, app-native, NO wire sync); the **effective-dated append-only
  `LedgerOpeningBalance`** (the cutover seed = the only stored balance; opening = prior close is COMPUTED,
  D-#222); the single **`ledgerBalanceAsOf` seam** (opening-only now, FIN-2 extends it with Σ-postings, D-#223).
  **RBAC ratified: ONE new perm `finance:manage`** (Principal+Office, no new role — refines the REQ's D-#192;
  the Library/Observation/HR precedent + AC-1 per-user-grant synergy lets the Principal grant the books to the
  accountant alone, D-#221); `finance:approve` (period-lock) deferred. Server-only; identity-plane (ADR-005,
  firewall both ways); single-school (no `schoolId`). Docs-only — nothing built. **Data confirmations RATIFIED
  2026-06-15:** head lists final (22 expense/11 income/7 fee) + heads are a **code-controlled list** (a dev
  adds one additively, no migration; `OTHER` is the runtime valve; self-service registry deferred — D-#247);
  **Eximus = per-ledger closing balance** (D-#236). **Finance planning fully locked — nothing deferred. Next =
  build FIN-1 (server) per `docs/prd-finance-fin1.md` §3/§4/§10.**
- **Planned (Finance FIN-2 — Daily entry & postings + zakat fee-support, build-contract PRD authored
  `docs/prd-finance-fin2.md`, D-#224–#229):** slice 2 of 6, the **heaviest** — recommends building as TWO PRs
  (D-#229). **FIN-2A** = `FinancePosting` (unified append-only money event; kind-discriminated; fee=feeLines
  split, transfer=mode→toLedger; **reverse-not-edit**, D-#224) + the derived **`dailySnapshot`** extending
  FIN-1's `ledgerBalanceAsOf` seam for Cash/Bank/Online (D-#225) + the **SALARY** line — **pre-fill from the
  HR `approved_locked` net-payable aggregate + manual deduction/adjustment lines** (HR base + adjustments
  stored/audited; no payslip crosses — D-#228 **ratified**). **FIN-2B** = `FeeProvider` + effective-dated
  append-only `FeeSupportAllocation` + pure `splitFee` (provider-due/guardian-due, gross counted once) +
  provider receivable + `ProviderReceipt` + statement (D-#226 **ratified — coverage is PER-HEAD**
  `[{head, type∈{FULL, AMOUNT}, amount?}]`: FULL = whole head, AMOUNT = a ৳ cap per posting, varying per
  student per head; PERCENT deferred) + the guardian **fee-due chase** (wa.me + emit `FINANCE_FEE_DUE`, MT
  bodies `finance.fee_due.chase.*`, no guardian finance UI, D-#227). Reuses `finance:manage` (NO new perm);
  vocab-toucher (additive). Qard/IOU stays FIN-3 (plugs into the same snapshot seam).**
- **Planned (Finance FIN-3..FIN-6 build-contract PRDs authored 2026-06-15 — FINANCE MODULE FULLY PLANNED,
  D-#232–#240):** **FIN-3** (`prd-finance-fin3.md`, D-#232–#234) Qard/IOU register — saved `FinanceParty`
  master + append-only `QardIouEntry` + per-party outstanding + **due-dates/schedules + overdue**; staff
  salary advances EXCLUDED (HR, D-#188); extends `ledgerBalanceAsOf` for the control ledgers. **FIN-4**
  (`prd-finance-fin4.md`, D-#235–#236) dual reconciliation — dated append-only entry, entered bank-statement
  + Eximus control figure vs the DERIVED app balance → bankDiff/eximusDiff + history (Eximus parallel/no live
  link; figure definition confirmed at build). **FIN-5** (`prd-finance-fin5.md`, D-#237–#238) budget-vs-actual
  — per-head **expense AND income** budgets, **monthly-phased (default annual/12, each month overridable)**,
  actuals auto-DERIVED from FIN-2 (movement heads excluded), monthly+cumulative variance + surplus/deficit.
  **FIN-6** (`prd-finance-fin6.md`, D-#239–#240) rollups + Principal dashboard + the Expo finance app — ALL
  DERIVED (no new model), builds as 2 PRs (6A server rollups, 6B the 💰 Finance app over FIN-1..6); NO guardian
  finance UI. **All reuse `finance:manage` — NO new permission; ALWAYS-OPEN (no period-lock / `finance:approve`,
  per the Principal).** Identity-plane; single-school. Docs-only — nothing built. **Build order = FIN-1 → 2A
  → 2B → 3 → 4 → 5 → 6A → 6B. Next = build FIN-1 (server) per `docs/prd-finance-fin1.md`.**
- **Built (Classroom Observation CO-5 — Quran (ClassEcho) form, server, prd-classroom-observation §CO-5, D-#56
  + build rulings D-#220) [branch `claude/open-prds-nl0az4`]:** the ported ClassEcho rating form, used when
  `subject==="QURAN"`. **Server-only; the ONLY shared change is `shared/vocab.ts`** (2 app-native enums, NO wire
  twin). **Vocab:** `QURAN_REVIEW_CRITERIA` (8, **pinned verbatim from the LIVE ClassEcho `video.model.ts`** — the
  in-repo dump was stale, D-#220) + `QURAN_COMPLIANCE_ITEMS` (7 PRD-final) + BN/EN labels + verifier §C.16b. Nested
  optional `quran?` sub-doc on `ClassroomObservation` (ratings[]+compliance[]+3 narrative); pure `quran.ts`
  validator (sibling of ref11.ts); `uploadObservation` enforces `subject==="QURAN"` ⟺ `form==="QURAN"` (Bangla
  both ways), review branches on `doc.form`; assign/review/respond/escalation form-agnostic + unchanged; CO-4 trend
  keeps excluding Quran rows. **Gate GREEN (executed):** shared build + vocab verifier PASS (§C.16b), shared/server
  tsc clean, **jest 1280/1280** (75 suites; +1 new suite `quranObservation.test.ts` [19] over the 1260 base;
  firewall green). **Server-only. Not verified live. Next = CO-6** (review scheduler).
- **Built (Classroom Observation CO-4 — trend, server, prd-classroom-observation §CO-4, REF-11 §2.2/§8)
  [branch `claude/open-prds-nl0az4`]:** per-teacher domain trend + the school-wide training-need signal.
  **Server-only, shared/vocab-free, NO new permission** — all DERIVED (D-#85), reuses `observation:read`/
  `observation:manage`. `ClassroomObservationTrendService.teacherDomainTrend` (per-domain D1..D5 chronological
  level series + ↑/↓/→ over **released REF-11** observations; drafts + QURAN-form excluded; NO average) +
  `schoolObservationPatterns` (weakest-domain staff aggregate, never an individual score). Resolvers
  (`observationTrend.ts`): `teacherObservationTrend` = `observation:read` + row-scope (manage reads any; else
  own-only); `schoolObservationPatterns` = `observation:manage`. No audit kind; firewall auto-covers (staff-only,
  no corpus path). **Gate GREEN (executed):** shared/server tsc clean, vocab verifier PASS (untouched), **jest
  1260/1260** (74 suites; +1 new suite `observationTrend.test.ts` [18] over the 1242 base; firewall green).
  **Server-only. Not verified live. Next = CO-5** (Quran ClassEcho form — needs the exact `QURAN_REVIEW_CRITERIA`
  labels pinned from the external ClassEcho repo).
- **Built (Classroom Observation CO-3 — release + teacher response + escalation, server,
  prd-classroom-observation §CO-3, D-#149/#52 + build rulings D-#219) [branch `claude/open-prds-nl0az4`]:** the
  two-way feedback loop over a REVIEWED observation. **Server-only; the ONLY shared change is `shared/vocab.ts`
  NOTIFICATION_KINDS** (4 app-native kinds, NO wire twin — D-#46; verifier §C.5 + BN/EN PASS); NO new permission.
  `reviewObservation` now emits `OBSERVATION_RELEASED` to the observed teacher on REVIEWED. New
  `respondToClassroomObservation` (gated `observation:read` + observed-teacher check, REVIEWED-only, scores not
  editable → `TEACHER_RESPONDED`, emits `OBSERVATION_RESPONDED` to observer + Principals; non-observed refused
  in Bangla). **Escalation ladder (2/4/7 CALENDAR-day default, configurable via `observation:manage`):**
  `ObservationEscalationConfig` singleton (read-time defaults, no seed — D-#97) + `ObservationEscalationDispatch`
  idempotency ledger (the AttendanceReminderDispatch precedent) + `runObservationEscalation(now)` wired into the
  N-2 ticker (once/calendar-day, before the school-day gate; 1st/2nd reminder → teacher, final → Principal;
  stops on response). 3 audit kinds; `NotificationRefs += observationId/teacherId/stage/daysSince`; CO firewall
  auto-covers. Device push deferred (D-#52 — in-app now). **Gate GREEN (executed):** shared build + vocab
  verifier PASS, shared/server tsc clean, **jest 1242/1242** (73 suites; +1 new suite `observationEscalation.test.ts`
  [18] over the 1224 base; notificationsScheduler.test.ts extended to mock the new service, stays green; firewall
  green). **Server-only. Not verified live. Next = CO-4** (trend).
- **Built (Classroom Observation CO-2 — session footage, server, prd-classroom-observation §CO-2/§3, D-#149)
  [branch `claude/open-prds-nl0az4`]:** the SECOND CO slice — the `SessionRecording` (YouTube-unlisted) footage
  backing a CO-1 observation. **Server-only, shared/vocab-free, NO new permission** — reuses CO-1's
  `observation:upload`/`read` + the pure `canReadObservation` row-scope. New `SessionRecording` model (anchor
  MIRRORS the observation; `youtubeVideoId`, `privacyStatus:"unlisted"`, `uploadedBy`; no schoolId, D-#145).
  `SessionRecordingService.recordSessionFootage` — Principal/Office store the **client-returned** `youtubeVideoId`
  (the GIS/YouTube-Data-API upload is a LATER app rider), creating a recording that copies the anchor, **FORCES
  `privacyStatus:"unlisted"`** (never a caller value), sets `observation.recordingId` (re-upload relinks),
  audits `SESSION_RECORDING_ADDED` (prior+new); empty id rejected (Bangla). `observationRecording(observationId)`
  = `observation:read` + row-scoped (`canReadObservation`: observer own; observed teacher only at/after REVIEWED;
  Principal/Office all; GUARDIAN scope-rejected). 1 audit kind (Audit.ts server-local union); CO firewall block
  auto-covers the new files (`walkDir`). **Privacy = the D-#149 knowing trade-off — action pending: confirm
  against the School-Handbook recording/data-protection policy before live use.** **Gate GREEN (executed):**
  shared build + shared/server tsc clean, vocab verifier PASS (untouched), **jest 1224/1224** (72 suites; +1 new
  suite `sessionRecording.test.ts` [17] over the 1207 base; firewall green). **Server-only** (the client
  YouTube/GIS upload UI is the CO-2 app rider). **Not verified live. Next = CO-3** (release + teacher response +
  in-app notify/escalation).
- **Built (Student Comments + Parents-Meeting CM-6 — app, Expo, prd-comments-meetings §6 + J-CM1..J-CM8)
  [branch `claude/open-prds-nl0az4`] — COMPLETES the module (CM-1..CM-6, server + app):** the Expo surface
  over the merged CM-1..CM-5 resolvers. **APP-ONLY** (`git diff origin/dev -- server shared` empty). New
  `app/src/graphql/comments.ts` + a **🗣️ Comments tab** gated `tracker:read || roster:manage` (GUARDIAN
  excluded). **6 screens:** CommentsHome (hub), SectionComments (picker + students + section comments,
  Delivered/Draft badges), CommentEntry (J-CM1 — type/sentiment chips + text + record-then-attach via
  `pickAndUploadCommentFile`; deliver → wa.me link + counts; **read-only once delivered** — server seal),
  MeetingsList (+ create), MeetingAdmin (generate slots, On-Call toggle, up/down reorder, dispatch + per-slot
  wa.me, post-dispatch present/absent + derived `meetingAttendanceSummary`), MeetingComparison (J-CM7 —
  editable current positive/concern → `saveMeetingComment` [class-teacher-only deny inline, J-CM6] + prior
  comments + by-type rollup). **Guardian rider (J-CM8):** delivered-comments card via `childComments` on
  GuardianHome. New `pickAndUploadCommentFile` + comment/meeting label helpers + `cm*`/`gpComments`/`tabComments`
  BN+EN keys. **Deliberately skipped — recorded follow-up:** the guardian **meeting-slot** card —
  `childMeetingSlot` needs a `meetingId` but there is **no guardian-facing "list my meetings" read**, so a
  guardian can't obtain one (a small server slice — a guardian upcoming-meetings read — must ship first; a
  `// CM-6 follow-up:` comment marks it in GuardianHomeScreen). No DECISIONS row (app slice; CT-5/VC-5 posture).
  **Gate GREEN (executed):** app `tsc --noEmit` clean + `expo export --platform web` green (759 modules);
  no-drift = server/shared untouched + jest unchanged. **Not verified live.** **CM is now built server + app
  (CM-1..CM-6), minus the noted guardian meeting-slot server gap.**
- **Built (Access Control AC-2 — app, Expo, prd-access-control §6 + J-AC1..J-AC3) [branch
  `claude/open-prds-nl0az4`] — COMPLETES Access Control (AC-1 server + AC-2 app):** the Principal-only
  per-user permission editor over the merged AC-1 resolvers. **APP-ONLY: no server/shared/vocab/contract
  change** (`git diff origin/dev -- server shared` empty; vocab verifier PASS unchanged). New
  `app/src/graphql/accessControl.ts` (typed ops over the 5 AC mutations + the `userEffectiveAccess` read;
  kept out of operations.ts — the classTest.ts precedent). **Two AdminStack screens:** `AccessControlUsers`
  (staff picker via the existing `users` query, **GUARDIAN excluded** — the J-AC4 wall; tap → editor) and
  `AccessControlEdit` (per staff user: primary-role badge + additional-template chips [TEACHER/OFFICE, minus
  the primary role] → `setUserAdditionalTemplates`; every live `PERMISSIONS` entry grouped by `resource:`
  module, each row showing a **provenance badge** — টেমপ্লেট থেকে / যোগ করা হয়েছে / সরানো হয়েছে / সংরক্ষিত —
  + an on/off toggle). **The server is the gate:** each tap fires ONE `access:manage` mutation and the screen
  re-seeds from the returned server-derived effective set, so "a revoke always wins" + the reserved backstop
  reflect without client guessing; the toggle resolves to add-grant / remove-grant / add-revoke / remove-revoke
  relative to the client-computed template baseline (`permissionsForRole`); RESERVED-locked rows (non-Principal)
  are non-toggleable; Bangla 422s surface inline. AdminHome entry gated `access:manage` (RESERVED-locked +
  Principal-only → `roleHasPermission` exact). New BN/EN `ac*` labels + `permissionName`/`permissionDesc`/
  `permissionModuleLabel` helpers over `PERMISSION_LABELS_BN/_EN`. No DECISIONS row (straightforward app slice —
  the CT-5/VC-5 posture). **Gate GREEN (executed):** app `tsc --noEmit` clean + `expo export --platform web`
  green (752 modules); no-drift = vocab verifier PASS + server/shared untouched + jest unchanged. **Not verified
  live.** **Access Control is now fully built server + app (AC-1 + AC-2).**
- **Built (HR-G2 — teacher-readable staff directory, server, prd-hr §H8.2/H8.3, D-#216/#217 + build ruling
  D-#218) [branch `claude/open-prds-nl0az4`]:** the PII-free `staffDirectory(observableOnly: Boolean = false,
  category)` read that unblocks the H5.2 supervisor observation picker + the chat staff-list. **Server-only,
  vocab-free, NO new permission.** New dedicated `StaffDirectoryEntry {id, name, nameBn, designation, category}`
  objectRef — STRUCTURALLY omits every H1.4 sensitive + bio row (the CT-3 precedent; the full record stays on
  the `staff` query, `staff:manage`). Gate `authenticated:true` + **GUARDIAN rejected in-resolver** (the
  student-roster discovery posture). `observableOnly:false` → every active staff member; `observableOnly:true`
  → Principal/Office (`performance:manage`/`staff:manage`) all, a bounded supervisor → the teachers assigned
  (`RoutineSlot.teacherId`) to a (class, subject) cell their SUPERVISORY scope covers
  (`composeTeacherScope`→`supervisoryCovers`), **fail-closed on the `teacherId`→`StaffProfile` phone-join**
  (`resolveStaffProfileForUser`, D-#103/#185). **Reverse-join build risk (D-#217) resolved (D-#218):**
  `RoutineSlot.subject` (enum) → `Subject._id` via one `Subject.find()` for the 5 general codes; ARABIC/ISLAM/
  QURAN + cross-grade subjectgroup slots match only class-based/whole_school extents. New `StaffDirectoryService`
  + resolver (registered in index.ts); identity plane → firewall unchanged-green; non-mutating → no audit kind.
  **Gate GREEN (executed):** shared build + shared/server tsc clean, vocab verifier PASS (untouched), **jest
  1207/1207** (71 suites; +1 new suite `staffDirectory.test.ts` [9] over the 1198 base; firewall green).
  **Server-only** (the app picker is the H8.4 rider — a later app slice). **Not verified live. Next = CO-2.**
- **Built (Access Control AC-1 — server, prd-access-control §4/§5/§6, J-AC1..J-AC6, D-#193 + build rulings
  D-#210–#215) [branch `worktree-access-control-ac1`, PR #79 MERGED to main 2026-06-14 (main=034a444); 6-finder
  review = no fixes; merged LAST (highest blast radius)]:** role stops being the final word on permissions → it
  becomes an editable-per-person **TEMPLATE**; the single RBAC resolution seam is recomputed. **The seam (the
  only behavioural change):** a PURE pair `effectivePermissions(AccessProfile)` / `callerHasPermission` in
  `shared/vocab.ts` (D-#210 — `eff = (∪[role,...additionalTemplates] ∪ granted) − revoked`, then `− RESERVED`
  for any non-Principal; `roleHasPermission`/`permissionsForRole` RETAINED for templates). Swapped `schema.ts`
  `hasPermission` + **ALL ~30 production `roleHasPermission(ctx.auth.role,…)` call sites → `callerHasPermission(ctx.auth,…)`**
  (tests still call `roleHasPermission` — they test the retained template fn = the byte-identical proof at scale).
  **AuthPayload threading (D-#211):** the three arrays ride the JWT (baked at staff login in `AuthService`, read
  in `context.ts` onto `AuthPayload extends AccessProfile`; absent ⇒ empty ⇒ identical-to-today; a grant/revoke
  change applies on next login [≤8h TTL], the READ is live; GUARDIAN token never carries them — the wall, J-AC4).
  **Model (additive, ZERO migration — D-#215):** 3 optional `User` fields `additionalTemplates`/`grantedPermissions`/
  `revokedPermissions` (default []; no backfill on the shared Atlas). **Vocab (app-native, NO wire sync — SOLE
  owner this cycle):** `PERMISSIONS += access:manage` (PRINCIPAL-only, BUILD, RESERVED-locked — the `template:manage`
  posture) + PRINCIPAL grant; new `RESERVED_PERMISSIONS` (the five) + `ASSIGNABLE_TEMPLATES` ({TEACHER, OFFICE})
  consts; `PERMISSION_LABELS_BN/_EN` (name + desc, total over PERMISSIONS) + new verifier **§C.17** (access:manage
  exact-holder + RESERVED exact-five-and-none-in-TEACHER/OFFICE + ASSIGNABLE excludes PRINCIPAL/GUARDIAN +
  byte-identical seam + labels total). **New `modules/access-control/`:** `AccessControlService` (set-templates
  [TEACHER/OFFICE only], add/remove-grant [**RESERVED + guardian:read_child REJECTED at write-time, Bangla 422 —
  D-#213**], add/remove-revoke [revoke wins], `effectiveUserAccess` read) + resolver (5 mutations + 1 query, all
  `access:manage`). 1 audit kind `USER_ACCESS_CHANGED` (prior+new {templates,granted,revoked} snapshot per change —
  D-#214); new access-control firewall block (corpus ⇄ access-control, both ways). **Guardian wall (J-AC4):** staff
  perms ungrantable to a Guardian (the model governs the staff User only). **Gate GREEN (executed):** vocab verifier
  PASS (incl. §C.17), shared build + shared/server tsc clean, **jest 1183/1183** (69 suites; +1 new suite
  `accessControl.test.ts` [16] + 1 firewall check over the 1165 base; **every prior RBAC test stayed green = the
  byte-identical proof at scale**; firewall green). **Server-only** (the Principal editor screen is AC-2, app).
  **Not verified live.** **Next = AC-2** (app: per-user editor with template chips + per-permission provenance
  state [from-template / added / removed / locked]).
- **Built (Student Comments + Parents-Meeting CM-5 — server, prd-comments-meetings §3/§6/§8, J-CM6/J-CM7/J-CM8,
  D-#124 + build ruling D-#202) [branch `worktree-comments-cm5`, PR #78 MERGED to main 2026-06-14; 3-finder review = no fixes]:** the FIFTH CM
  slice — the class-teacher `MeetingComment` + the cross-meeting comparison reads + the guardian portal reads.
  **VOCAB-FREE** — `shared/vocab.ts` + the verifier UNTOUCHED (`git diff origin/main -- shared` empty). **New
  model `MeetingComment`** `{meetingId, studentId, authorUserId, positiveText, concernText}` (one per
  student×meeting, unique; no schoolId, D-#145). **`MeetingCommentService`:** `saveMeetingComment` (UPSERT one
  note per student×meeting; both-empty rejected; audited `MEETING_COMMENT_SAVED`); `studentCommentTimeline`
  (DERIVED D-#44 — prior MeetingComments chronological + a daily-StudentComment **by-type rollup** since the most
  recent meeting, D-#202); `meetingComparison(meetingId, studentId)` (this note + prior notes + the rollup since
  the previous meeting); guardian `childComments` (DELIVERED daily comments ONLY, structurally omits
  authorUserId/sectionId/deliveryChannels — J-CM8) + `childMeetingSlot` (the family's own slot, omits
  familyKey/studentIds/attendanceRemark). Pure `rollupByType` (counts over ALL COMMENT_TYPES, zeros included)
  unit-tested. **Resolvers (`meetingComment.ts`):** `saveMeetingComment` = `tracker:write` +
  `assertIsClassTeacher` on the child's server-resolved section (**Office/Principal denied — J-CM6**, the
  D-#42/#45 parent-comms duty); `studentCommentTimeline`/`meetingComparison` = the reps gate **`tracker:read` OR
  `roster:manage`** (function-form authScopes — first OR-of-two-perms gate in the codebase);
  `childComments`/`childMeetingSlot` = `guardian:read_child` + `assertGuardianOfStudent` (D-#68). **RBAC: NO new
  role/permission** (D-#17). 1 new audit kind `MEETING_COMMENT_SAVED` (Audit.ts, NOT vocab). CM firewall block
  extended (MeetingComment + MeetingCommentService corpus-clean, both ways). **Gate GREEN (executed):** vocab
  verifier PASS (UNTOUCHED), shared build + shared/server tsc clean, **jest 1180/1180** (69 suites; +1 new suite
  `meetingComment.test.ts` [13 — incl. the J-CM6 class-teacher deny, the J-CM7 rollup, the J-CM8
  structural-omission guardian shapes] + 1 firewall check; firewall green). **Server-only** (no app — CM-6 is the
  app slice; expo skipped). **Not verified live.** **Next = CM-6** (the Expo app slice over CM-1..CM-5 — completes
  the Comments + Parents-Meeting module).
- **Planned (Saturday Revision Tracker — Qur'an Hifz, module REQ written, D-#197–#201):**
  REQ scoped in docs/saturday-revision-requirements.md — replaces the paper শিক্ষার্থীর পাঠ
  সম্পাদন রিপোর্ট (weekly Saturday Hifz revision sheet). Per student × Saturday: present/absent +
  the 3 revision types (Sabaq/Sabqi/Manzil) recorded **per juz** (juz 1–30 × amountJuz × তানবীহ/ফাতহ
  × structured mistake counts হরফ/গুন্নাহ/মাদ/অন্যান্য) + teacher comment. **Reuses routine's Quran
  `SubjectGroup` (track=quran, Hifz 1/2/3, gender-split) + `SubjectGroupMembership` roster + the
  `QURAN_ONLY` Saturday calendar (D-#48/#56/#50) — NO new grouping/roster/calendar.** Hifz-only
  (Qaida/Ammapara/Najera deferred — not juz-memorized). Guardian delivery on the existing rails
  (wa.me + emit + push, MT-registry bodies): absent alert + weekly digest + consecutive-absence
  escalation. Principal analytics ALL derived (D-#85): per-juz weakness heatmap, coverage/rotation,
  weekly trends, level/student dashboards, charts, completeness-chase. Reuse RBAC (no new role,
  D-#17/#94); app-native vocab, NO wire sync (AGENTS rule 5). Identity plane (ADR-005). Plan/docs
  only — nothing built. **SR-1..SR-4 build-contract PRDs now AUTHORED 2026-06-15 (`docs/prd-sr1.md`..`prd-sr4.md`,
  D-#241–#246) — SR module FULLY PLANNED:** SR-1 models+entry+reads (RevisionEntry + per-juz JuzRecords, Quran
  SubjectGroup + QURAN_ONLY calendar, immutable-after-deliver), SR-2 guardian delivery (absent/digest rails +
  SR_ABSENT/SR_DIGEST + consecutive-absence escalation N=2), SR-3 derived analytics (per-juz heatmap / coverage-
  overdue / ↑↓→ trend / dashboards / completeness-chase), SR-4 the Expo app (per-juz grid + charts + guardian
  delivered-only card). NO new role/permission; app-native vocab. **Next = build SR-1 (server) per `docs/prd-sr1.md`,
  slice order SR-1→SR-2→SR-3→SR-4.**
- **Built (CT-4-FIX — Class Test dashboard/reports RBAC, server, D-#196 [renumbered from #186 at merge — Finance REQ took #186]) [branch `worktree-ct4-rbac-fix`, PR #77 MERGED]:** the pre-existing CT-4 RBAC bug flagged at the CT-5 app review. The four
  CT-4 READ aggregates (`classTestPrincipalDashboard`, `classTestReportsStatus`,
  `classTestClassSubjectAnalysis`, `classTestStudentProfile`) gated `authScopes: { hasPermission:
  "tracker:read" }`, but **OFFICE holds NO `tracker:read`** (it holds `message:dispatch` — which is why
  the overdue-chase already worked) while the §6/§9 + D-#166 intent is for Office to read the dashboard +
  reports. Pothos scope-auth runs `authScopes` BEFORE the resolver, so Office was rejected at the scope
  layer and the intended Principal/Office branch inside `assertDashboardAdmin`/`assertReportRead` was
  unreachable dead code. **Fix (resolver-gating ONLY — NO enum/permission/vocab change):** relax the four
  reads to `authScopes: { authenticated: true }` and let the already-correct gate helpers be the authority
  (the `assertChaseAdmin` pattern) — `assertDashboardAdmin` keeps P/O-only (now reachable by Office);
  `assertReportRead` keeps P/O-unscoped + teacher section-scoped (`assertCanRead`) + denies GUARDIAN/any
  role without `tracker:read`. The chase (`message:dispatch` + P/O) is unchanged. **Non-widening, proven by
  a new schema-execution test `classTestSummaryRbac.test.ts` (11 tests)** that runs real GraphQL queries
  against the built schema with each role's context (exercising the scope-auth layer + the real permission
  map): Office reads all four; a teacher reads only a section it can read and is denied the dashboard;
  GUARDIAN + unauthenticated are denied. **Gate GREEN (executed):** vocab verifier PASS (untouched), shared
  build + shared/server tsc clean, **jest 1090/1090** (65 suites; +1 new suite [11]; the existing
  `classTestSummary.test.ts` stays green). **Server-only.** Not verified live. **Do NOT merge** (PR for
  review).
- **Built (Student Comments + Parents-Meeting CM-4 — server, prd-comments-meetings §4.1/§6, J-CM4/J-CM5,
  D-#176) [branch `worktree-comments-cm4`, PR #76 MERGED]:** the FOURTH CM slice — the
  parents'-meeting timing DISPATCH + present/absent capture over the CM-3 `ParentMeeting`/`ParentMeetingSlot`
  arrangement (no new model). **VOCAB-FREE** (CO-1 holds the vocab lock) — `shared/vocab.ts` + the verifier
  UNTOUCHED (git diff empty), so it ran fully parallel with CO-1. **`MeetingDispatchService`:**
  `dispatchMeetingSchedule(meetingId)` flips the meeting `draft → scheduled` and, per slot, renders the Bangla
  timing message ONCE (`meetingSlotMessageBn` — the slot time, or "ডাকা হলে আসবেন (On Call)" for `onCall`,
  J-CM4), stamps `dispatchedAt`, builds a `wa.me` link for every family with a phone (the CM-3 `familyKey` IS
  the digits-only number → no Student re-query; phone-less → `unreachableCount`), and emits `MEETING_SCHEDULE`
  via the D-#72 seam — **kind-gated** (`emitMeetingSchedule` checks `NOTIFICATION_KINDS.includes("MEETING_SCHEDULE")`
  and no-ops → wa.me-only until the kind is activated; the §4.1/D-#94 path; the emitter resolves login-enabled
  guardians across the slot's siblings). **N+1 guard:** the message is rendered once per slot, the pre-rendered
  text passed to the emitter (never re-rendered per guardian). `setSlotAttendance(slotId, attended, remark?)`
  captures present/absent per family slot, gated to a dispatched (non-draft) meeting; `meetingAttendanceSummary`
  is a DERIVED read (present/absent/pending/on-call/dispatched/reachable — never stored, replaces the Office-Copy
  hand-typed counts). **Two vocab-lock deferrals (§4.1) + recorded ACTIVATION FOLLOW-UP:** `MEETING_SCHEDULE` is
  NOT added to `NOTIFICATION_KINDS` and the message is INLINE Bangla (not a `meeting_schedule.*` MT key) — both
  would touch `shared/vocab.ts`; **when the lock frees, a small slice adds `NOTIFICATION_KINDS += MEETING_SCHEDULE`
  (+BN/EN, verifier §C.5) + migrates the inline message to a `meeting_schedule.*` MT key (D-#131) — no CM-4 logic
  change.** **Resolvers (`meetingDispatch.ts`):** `dispatchMeetingSchedule` / `setMeetingSlotAttendance` /
  `meetingAttendanceSummary` — all `roster:manage` (the D-#94 admin gate; meetings span sections → no per-section
  scope). **RBAC: NO new role/permission** (D-#17/#94). 2 new audit kinds in `Audit.ts`
  (`PARENT_MEETING_SCHEDULED` / `MEETING_SLOT_ATTENDANCE_SET`); `NotificationRefs += parentMeetingId/meetingSlotId`
  (server model, NOT vocab). CM firewall block extended (MeetingDispatchService corpus-clean, both ways).
  **Gate GREEN (executed):** vocab verifier PASS (UNTOUCHED), shared build + shared/server tsc clean, **jest
  1112/1112** (66 suites; +1 new suite `meetingDispatch.test.ts` [18 — incl. the kind-gated no-op short-circuit,
  the On-Call message, wa.me-for-all + unreachableCount, the derived aggregates] + 1 firewall check; firewall
  green). **Server-only** (no app — CM-6 is the app slice; expo skipped). **Not verified live.** **Next = CM-5**
  (`MeetingComment` class-teacher-authored + the comparison timeline + guardian `childComments`/`childMeetingSlot` reads).
- **Built (Classroom Observation CO-1 — server, prd-classroom-observation §4/§5/§6 + J1/J2,
  D-#146/#147 + build rulings D-#194/#195 [renumbered from #190/#191 at merge — Finance/Access PRDs
  took #190–#193 on main]) [branch `worktree-classroom-obs-co1`, PR #75 MERGED]:** the FIRST slice of the standalone classroom-observation module —
  the REF-11 form core + the upload→assign→review→supersede pipeline + the FOUR new app-native
  permissions. **New `server/src/modules/classroom-observation/`, model `ClassroomObservation`**
  (DISTINCT from HR-4's `modules/hr/models/Observation` — pre-flight clash check; no touch to HR's
  model). **Model:** `form ∈ OBSERVATION_FORMS`; session anchor `{routineSlotId?, EXACTLY ONE of
  sectionId|subjectGroupId, subject, teacherId, classDate, periodNumber?}` (REUSES RoutineSlot/Section/
  SubjectGroup/HW_SUBJECTS, D-#48/#54/#56; REF11 subject ∈ HW_SUBJECTS, QURAN=CO-5); `observerId?`;
  REF-11 payload `{domains:[{domain,level1-4,note}]×5, gates:[{gate,result,breachNote?}]×2, oneStrength,
  growthFocus, prevObservationId?, priorFocusProgress?}` — **NO total/average**; `state ∈
  OBSERVATION_STATES`; `recordingId?` (CO-2) + `teacherResponse?` (CO-3) present but unset; no schoolId
  (D-#145). **Pure `ref11.ts` validator** (no DB/clock — the classTestScoring posture): exactly 5
  distinct domains (1–4 + note), 2 distinct gates, 1 strength + 1 growth focus; **a gate BREACH stands
  on its own regardless of levels** (§2.1). **`ClassroomObservationService`:** `uploadObservation`
  (Principal/Office UPLOADED + assign → ASSIGNED, J1; **CONFLICT GUARD observer ≠ observed teacher,
  refused**), `assignObserver`, `reviewObservation` (ASSIGNED-only + gated to the assigned observerId →
  **REVIEWED releases to the observed teacher, NO Principal sign-off**, REF-11 §1.3), `requestReReview`
  (prior REVIEWED → NEW ASSIGNED on the same anchor/recording + prior SUPERSEDED — enables CO-7
  calibration), reads + the **pure `canReadObservation` row-scope predicate** (observer own; observed
  teacher own ONLY at/after REVIEWED — UPLOADED/ASSIGNED hidden, never another observer's input;
  Principal/Office all — §5/D-#28). 7 resolvers (upload/assign/review/reRequest + classroomObservation/
  teacherClassroomObservations/myObservationReviewQueue, row-scoped). **Vocab (app-native, NO wire/
  harness sync — SOLE owner this cycle):** OBSERVATION_FORMS/DOMAINS/LEVELS/GATES/GATE_RESULTS/STATES/
  GROWTH_PROGRESS (+BN/EN) + the **4 NEW permissions** observation:{upload(P/O),review(TEACHER, resolver
  gates to observerId),read(P/T/O row-scoped),manage(P/O)} (PERMISSIONS + ROLE_PERMISSIONS +
  PERMISSION_BUILD_STATUS all "build" + OFFICE exact-list) + new verifier §C.16. 4 audit kinds
  (CLASSROOM_OBSERVATION_UPLOADED/_ASSIGNED/_REVIEWED/_SUPERSEDED, in Audit.ts not vocab); new CO
  firewall block (corpus ⇄ classroom-observation both ways). **GUARDIAN holds no observation:* perm**
  (staff-internal, §7). **Gate GREEN (executed):** vocab verifier PASS (incl. §C.16), shared build +
  shared/server/app tsc clean, **jest 1113/1113** (64 suites; +1 new suite `classroomObservation.test.ts`
  [40] + 2 firewall CO checks over the 1071 base). **Server-only** (footage upload=CO-2; teacher-response/
  notify/escalation=CO-3; Quran payload=CO-5; app later; expo skipped). **Not verified live.** **Next =
  CO-2** (SessionRecording / YouTube-unlisted footage).
- **Planned (Access Control — per-user permissions, build contract written, D-#193):**
  role becomes an editable-per-person TEMPLATE; effective = (∪ templates ∪ granted) − revoked,
  reserved-locked set {payroll:approve, performance:signoff, chat:oversee, template:manage,
  access:manage} Principal-only. Additive 3 fields on `User` (zero migration), one resolver
  seam swap (`effectivePermissions`/`callerHasPermission`), new `access:manage` perm +
  `PERMISSION_LABELS_BN/EN` (app-native vocab, NO wire sync). Guardian plane untouched.
  Slices **AC-1** (server: fields+seam+mutations+audit+`access:manage`) → **AC-2** (app: Principal
  editor screen w/ provenance chips). **Next = build AC-1 per `docs/prd-access-control.md` §6,
  slice order AC-1→AC-2.**
- **Planned (Finance/Accounting module FIN-1..FIN-6, D-#186–#192):** REQ scoped in
  docs/finance-requirements.md — migrate the SCD Google-Sheet accounting layer (Daily,
  Budget-vs-Actual, Qard/IOU Central, Bank & Online, Master Dashboard) into the app.
  Eximus stays parallel (no live link); app reconciles vs bank statement AND an entered
  Eximus control figure (FIN-4). Salary/payroll CARVED OUT — HR module owns it; FIN posts
  the monthly net-payable total only. Staff salary-recoverable advances stay in HR; FIN
  Qard/IOU register owns community/non-salary loans+advances. One school (no branch),
  identity-plane only (ADR-005), reuse Office/Principal RBAC. Zakat = roster-linked,
  effective-dated, append-only allocation + provider receivable + auto guardian/provider
  fee-split. App-native vocab in later PRDs (NO wire sync expected, AGENTS rule 5). Plan/docs
  only — nothing built. **Next = build FIN-1 (Ledgers & opening balances) per
  docs/finance-requirements.md §4/§6, slice order FIN-1→FIN-6 (separate session).**
- **Built (Student Comments + Parents-Meeting CM-3 — server, prd-comments-meetings §3/§6, D-#123,
  J-CM3/J-CM4 + build rulings D-#174/#175) [branch `worktree-comments-cm3`, PR open — coordinator reviews]:**
  the THIRD CM slice — the `ParentMeeting` + per-family `ParentMeetingSlot` models, slot generation, On-Call,
  reorder, and the admin reads. **VOCAB-FREE** — `ParentMeeting.status ∈ {draft, scheduled, closed}` is a
  **model-local literal union** (NOT a shared/vocab.ts enum); shared/vocab.ts + the verifier are UNTOUCHED
  (parallel-safe with any concurrent vocab owner, e.g. CO-1). **Models:** `ParentMeeting`
  `{academicYearId (default current), instanceLabel "2026 — 1st", meetingDate, slotMinutes, dayStartMinutes,
  status, includeScope{classIds[],sectionIds[]} — both empty ⇒ all active}` (no schoolId, D-#145);
  `ParentMeetingSlot` (one per FAMILY) `{meetingId, familyKey, studentIds[], classLabels[], order, slotTime?,
  onCall, dispatchedAt?/attended?/attendanceRemark? — CM-4 fields present but NEVER written here}`, unique
  `(meetingId, familyKey)`. **`ParentMeetingService`:** `createParentMeeting` (born draft; validates
  label/slotMinutes≥1/dayStart 0..1439; current-year default); `generateSlots` (active students in
  includeScope → group by `Student.phone` digits-only → one slot per family, **siblings collapsed** [J-CM3,
  "Asila…, Arham | KG, Two"], default order class→section→name via the family's lead child, sequential timed
  slots from dayStart — **WHOLESALE / idempotent delete-then-relay, DRAFT-only** [D-#175]); `setSlotOnCall`
  (flag On-Call → null time + re-time the rest, J-CM4); `reorderSlots` (membership-validated; the new order
  drives the times); admin reads (`parentMeetings`/`parentMeeting`/`parentMeetingSlots`). **Pure helpers
  (unit-tested):** `groupFamilies` (sibling collapse + phone-less each-own-family + ordering) + `assignSlotTimes`
  (timed step from dayStart, On-Call skipped → null; SHARED by generate/setOnCall/reorder so "order drives the
  times" is single-truth). **Phone-less (D-#174):** each forms its own `nophone:<id>` family, gets a timed slot,
  counted in `unreachableCount` — the CM-2 store-and-count posture (never dropped). **Resolvers
  (`parentMeeting.ts`):** all 7 gated `roster:manage` (the D-#94 admin gate; meetings span sections so no
  per-section row-scope). **RBAC: NO new role/permission** (D-#17/#94). 3 new audit kinds in `Audit.ts`
  (`PARENT_MEETING_CREATED`/`_SLOTS_GENERATED`/`_SLOTS_REORDERED`); CM firewall block extended (corpus ⇄
  ParentMeeting/ParentMeetingSlot/ParentMeetingService, both ways). **Gate GREEN (executed):** vocab verifier
  PASS (untouched), shared build + shared/server tsc clean, **jest 1088/1088** (64 suites; +1 new suite
  `parentMeeting.test.ts` [16] + 1 firewall check over the 1071 base; firewall green). **Server-only** (no app —
  CM-6 is the app slice; expo skipped). **Not verified live.** **Next = CM-4** (dispatch + `MEETING_SCHEDULE` +
  `setSlotAttendance` + derived present/absent — that's where the vocab lands).
- **Built (APP-FU1 — guardian-notice full-section picker, Expo, APP-ONLY) [branch `worktree-app-fu1`,
  PR open]:** the small app-polish pass over a deferred, server-ready surface. Closes the recorded
  **M-5/M-6 follow-up**: `GuardianNoticeScreen` sourced its SECTION picker only from
  `mySectionsAsClassTeacher`, so Principal/Office couldn't target an arbitrary section's notice (they
  fell back to SCHOOL scope). Now **`chat:manage` holders get a full academic-year → all-sections
  picker** (`AcademicYearSelect` + a `Select` of every class's sections, sourced from the existing
  `classes` query — `authenticated:true`, P/O readable); class teachers (chat:write only) keep their
  coordinated-sections chips unchanged. **Server already authorizes the arbitrary-section notice**
  (`assertCanComposeNotice` bypasses `assertIsClassTeacher` when `canManage`) — this is purely the
  missing picker UI. **APP-ONLY: NO server / shared / vocab / contract change** (`git diff origin/main
  -- server shared` empty); 2 files touched (`GuardianNoticeScreen.tsx`, `lib/labels.ts` — 2 new BN/EN
  keys). **Discovery scan (server-ready-but-unrendered reads):** all 110 client query ops are already
  rendered — no further deferred reads to surface (Class-Test/Vocab excluded — owned by other sessions).
  No new server-gaps found; the previously-known gaps (guardian attendance/leave) have no resolver and
  stay deferred. No DECISIONS row (straightforward app surface). **Gate GREEN (executed):** app
  `tsc --noEmit` clean + `expo export --platform web` green; vocab verifier PASS + server/shared
  untouched + jest unchanged (server untouched). **Not verified live.**
- **Built (HR-G1 — staff own-row self-service reads, server, prd-hr §4/§3, D-#185) [branch
  `worktree-hr-gap-reads`, PR #73 MERGED]:** the two server gaps flagged when the HR
  app shipped (PR-1/#56 surfaced them as "pending"). **Server-only, vocab-free, NO new permission** —
  both reads compose existing services + the D-#103 phone-join. **`myPayslips`:** the caller's OWN
  payslips across runs, newest month first, **`approved_locked` runs ONLY** (a staff member never sees a
  draft/`prepared` payslip, §4.2) — new `payslipsForStaff` in `PayrollService`. **`myStaffAttendance`:**
  the caller's OWN attendance over [fromKey, toKey], oldest day first, **reusing the AT-1 ✘=ABSENT → LEAVE
  read-time overlay** (HR-2, `applyLeaveOverlay`) — new `staffAttendanceForRange` in
  `TeacherAttendanceService` (the daily snapshot keys cleanly off `staffProfileId`, so the join is exact —
  the myStaffAttendance gap is NOT blocked). Both resolve the caller's `StaffProfile` via the EXISTING
  `resolveStaffProfileForUser` (User → phone → StaffProfile, **fail-closed on a shared phone — not
  weakened/twinned**) and scope the read to that one id. Resolvers added inline to the existing
  `payroll.ts` / `teacherAttendance.ts`, gated `authScopes: { authenticated: true }` (the staff-self
  path; Principal/Office keep their `payroll:manage` / `attendance:manage` admin reads). **D-#185:** a
  caller with no linked StaffProfile (guardian / email-only admin / ambiguous phone) gets `[]`, never
  another person's data — these own-record app-card reads **return empty, they do NOT throw** like the
  `myConductRecords`/`callerStaffProfileId` precedent. Identity-plane only; NO new model → firewall stays
  green. **NOT built (recorded follow-up):** the supervisor observation-submit + teacher-readable
  staff-directory gap (needs a scoped directory read + design — left for a later slice). **Gate GREEN
  (executed):** vocab verifier PASS (untouched), shared build + shared/server tsc clean, **jest 1061/1061**
  (63 suites; +1 new suite `hrSelfService.test.ts` [8] over the 1053 main base; firewall green).
  **Server-only** (the app surface for these reads is a later app-only pass). **Not verified live.**
- **Built (Student Comments + Parents-Meeting CM-2 — server, prd-comments-meetings §4.1/§5/§6, J-CM1,
  D-#172/#173) [branch `worktree-comments-cm2`, PR #71 MERGED]:** the SECOND CM slice —
  daily-comment DELIVERY + the comment-attachment file store. **Delivery (`CommentDeliveryService`):**
  `deliverComment` (per-comment, mirrors the Form's per-row send) stamps `deliveredAt` + `deliveryChannels`
  — which SEALS the CM-1 immutability (editComment already refuses a delivered comment; deliveredAt stamped
  ONCE, re-deliver keeps the original). Rails (D-#72/#31): a `wa.me` link for EVERY family with a phone
  (`commentWaLink`, ADR-003; phone-less → `unreachableByWa`) + an in-app Notification (kind `STUDENT_COMMENT`)
  via `emit()` → inbox + push behind the seam for login-enabled guardians; contact-only stay wa.me-only.
  Body rendered from the MT registry (`student_comment.notify.*`, D-#131 — NOT inline). **N+1 guard:**
  title + body rendered ONCE per comment; `emitStudentComment` takes pre-rendered text. **Kind-gated no-op
  fallback (§4.1/D-#94):** the emitter no-ops (returns []) if the kind isn't registered → wa.me fallthrough
  (CM-2 registers it, so it's the safety net). Resolver `deliverStudentComment` = `tracker:write` +
  `assertCanWrite` (section resolved server-side). **Attachments (`CommentFileService` + `POST /files/comment`):**
  REUSE the GP-A/M-4 Drive store (no twin) — `tracker:write` + the comment's section verified server-side
  (comment-first: comment must exist + not yet delivered), MIME image/pdf/video/audio ≤ 10 MB (D-#108),
  Drive-first ⇒ 503 (GP-J8), `<year>/comments/` subfolder; new `StoredFile` `comment_*` kinds +
  `studentCommentId` (`$addToSet`ed onto the comment's attachmentIds). `GET /files/:id` dispatches `comment_*`
  to `assertCommentFileReadAccess` = the AUTHOR (any state) OR a guardian of the child for a DELIVERED comment
  (D-#68); others denied; Drive id never reaches a client. **Vocab (app-native, sole owner this cycle):**
  `NOTIFICATION_KINDS += STUDENT_COMMENT` (+BN/EN — the deferred CM-1 kind lands; extends verifier §C.5) +
  a `student_comment.notify.*` MT key + §C.15 extension. **`MEETING_SCHEDULE` deliberately NOT added** (CM-4
  owns it). 1 new audit kind `STUDENT_COMMENT_DELIVERED`; `NotificationRefs += studentCommentId`. CM firewall
  block extended (CM-2 files corpus-clean, both ways). **RBAC (D-#172): NO new role/permission** (D-#17/#94).
  **Gate GREEN (executed):** vocab verifier PASS (incl. §C.5 + the MT key), shared build + shared/server tsc
  clean, **jest 1071/1071** (63 suites; +1 new suite `commentDelivery.test.ts` [17] + 1 firewall check over
  the 1053 main base; firewall green). **Server-only** (no app — CM-6 is the app slice; expo skipped). **Not
  verified live.** **Next = CM-3** (ParentMeeting + per-family slot generation).
- **Built (Student Comments + Parents-Meeting CM-1 — server, prd-comments-meetings §3/§4/§6, J-CM1/J-CM9,
  D-#114/#115 + build rulings D-#170/#171) [branch `worktree-comments-cm1`, PR #69 MERGED]:**
  the FIRST CM slice — the `StudentComment` daily-observation store + the COMMENT vocab. Replaces the
  Student-Complain Google Form→Sheet. **New `modules/comments/` model:** `StudentComment`
  `{studentId, sectionId, authorUserId, type ∈ COMMENT_TYPES, sentiment ∈ COMMENT_SENTIMENTS, text,
  attachmentIds[], deliveredAt?, deliveryChannels[]}` — subject-free, permanent (never deleted — the CM-5
  comparison timeline needs full history), no schoolId (D-#145). **`StudentCommentService`:**
  `resolveCommentSection` (section ALWAYS derived server-side from the student, never client-supplied —
  D-#115; rejects missing/inactive), `recordComment` (validated; author = the authenticated teacher [the
  Form's "ustaz" field dropped]; audited `STUDENT_COMMENT_RECORDED`), `editComment` (AUTHOR-ONLY, REFUSED
  once `deliveredAt` set — immutable, a correction is a new comment §3), `listSectionComments`/
  `studentComments` (staff reads, newest-first). **Resolvers:** `recordStudentComment`/`editStudentComment`
  (tracker:write + `assertCanWrite` on the resolved section — Office + Guardians denied),
  `sectionStudentComments`/`studentComments` (tracker:read + section read-scope). **NO delivery (no
  emit()/wa.me) + NO attachment-upload route — those are CM-2** (`deliveredAt` null, `deliveryChannels` []);
  the guardian delivered-only read is CM-5. **Vocab (app-native, NO wire sync — additive + disjoint, ran
  PARALLEL with the in-flight CT-4 vocab owner, AGENTS rule 5):** `COMMENT_TYPES` (GENERAL/ATTENDANCE/
  STUDY_HOMEWORK/BEHAVIOUR/SERIOUS_MATTER — the Form's M-column taxonomy verbatim) + `COMMENT_SENTIMENTS`
  (CONCERN/POSITIVE) + BN/EN labels + new verifier §C.15. **`NOTIFICATION_KINDS += STUDENT_COMMENT/
  MEETING_SCHEDULE` deliberately NOT added here** (no delivery in CM-1 → CM-2 owns them; keeps the footprint
  disjoint from CT-4 — §C.5/NOTIFICATION_KINDS untouched). 1 new audit kind; new CM firewall block (corpus ⇄
  comments both ways). **RBAC (D-#170): NO new role/permission** (D-#17/#94). **Gate GREEN (executed):** vocab
  verifier PASS (incl. §C.15), shared build + shared/server tsc clean, **jest 1041/1041** (61 suites; +1 new
  suite `studentComment.test.ts` [18] + 2 firewall checks over the 1021 main base; firewall green).
  **Server-only** (no app — CM-6 is the app slice; expo skipped). **Not verified live.** **Next = CM-2**
  (daily delivery: emit() STUDENT_COMMENT + wa.me + the `/comments/` attachment store).
- **Built (Vocabulary Tracker VC-5 — Expo app, APP-ONLY, prd-vocabulary-tracker §6 VC-5 + J1–J7)
  [branch `worktree-vocab-vc5`, PR #67 MERGED] — COMPLETES the Vocabulary Tracker
  (VC-1..VC-5):** the app surfaces over the merged VC-1..VC-4 resolvers. **NO server / shared / vocab /
  contract change** (proven: `git diff origin/main -- server shared` empty) — consumes existing resolvers
  + adds client ops/labels/screens only. New **🔤 Vocab tab** gated `tracker:read` OR `roster:manage`
  (Principal/Teacher read+build+mark; Office does the weekly assignment + message generation; GUARDIAN
  never sees it). **10 screens (`VocabStack`):** VocabHome (hub + `myVocabAssignments`); **VocabWordBank**
  (J1 — program×classLevel CRUD, the `assertCanManageClassLevel` reach gate surfaced); **VocabTests**
  (browse a section×program's tests → mark/report/messages, + new-test); **BuildVocabTest** (J3 —
  `createVocabTest` then per-direction word selection → `setVocabTestPositions`; operator-gated);
  **VocabMarkGrid** (J4 — per-student PRESENT/ABSENT + tap-wrong cells, a 2-field DICTATION shows two
  sub-fields via `VOCAB_DICTATION_FIELDS`, wholesale `submitVocabStudentResult`, prefilled from
  `vocabTestResults`, derived score badge); **VocabReport** (J5 per-test rollup + students + most-missed);
  **VocabStudentReport** (J5 per-student dashboard + persistent weak words + Weekly/Monthly/Last-N
  cumulative toggle); **VocabClassReport** (J5 class dashboard + most-missed); **VocabMessages** (J6 —
  `generateVocabTestMessages` + `generateVocabCumulativeMessages` → recipients with wa.me Send
  [`Linking.openURL`, ADR-003] + in-app/unreachable counts); **VocabAssignment** (J2 — `assignVocabTester`
  roster:manage + current/history). **Guardian portal lit up (J7):** a read-only Vocabulary-results card
  on GuardianHome (`childVocab`, marked-tests-only per D-#155). New `components/vocabPickers.tsx`
  (ProgramSelect/ClassLevelSelect/ClassSectionSelect) + vocab ops + BN/EN labels + helpers +
  `VocabStackParamList`. Every surface gated on the SAME permission the server enforces — the server stays
  the gate (Bangla deny surfaces inline). **No new build ruling needed** (pure app slice; no new
  perm/vocab). **Gate GREEN (executed):** app `tsc --noEmit` clean + `expo export --platform web` green
  (728 modules); no-drift — vocab verifier PASS + **jest 1006/1006 unchanged** (server untouched).
  **Not verified live.** **Vocabulary Tracker is now fully built server + app (VC-1..VC-5).**
- **Built (Vocabulary Tracker VC-4 — server, prd-vocabulary-tracker §6/§8/§9, J5/J6/J7, build rulings
  D-#153/#154/#155) [branch `worktree-vocab-vc4`, PR #65 MERGED]:** the FOURTH vocab slice —
  read aggregates + persistent weak words + guardian messages + the guardian child read. **Vocab (app-native,
  NO wire sync; PARALLEL-SAFE with the in-flight CT-2 per AGENTS rule 5 — purely additive, disjoint
  enums/verifier sections):** `NOTIFICATION_KINDS += VOCAB_RESULT` (+BN/EN — extends verifier §C.5 exact-list) +
  5 `vocab.result.*` MESSAGE_TEMPLATE keys (title + Regular/Perfect/Absent/Cumulative bodies; BN defaults with
  the Islamic salutation + du'a; built DIRECTLY on the MT-1 registry per D-#131, NOT inline) + verifier §C.12
  additions. **Server (`modules/vocab/`):** pure **`vocabAggregate`** (no DB/clock, all inputs incl. `asOf`
  passed in — D-#153: thresholds with read-time defaults [persistent ≥2 tests / class ≥30% / Weekly N=4, no
  seed write D-#97], `persistentWeakWords` [distinct-TEST count], `mostMissedWords` [distinct-student ÷ present
  ≥ pct], `scoreRollup` [ABSENT excluded from denominators, §4], `selectPeriodTests` [Weekly/Monthly/Last-N],
  `periodLabel`); **`VocabSummaryService`** (all DERIVED, never stored D-#85 — rolls up the VC-3 `vocabScoring`
  engine via `studentResult`/`testResults`, never re-derives: `vocabTestReport` / `vocabStudentDashboard` +
  persistent weak words / `vocabClassDashboard` + most-missed / `vocabStudentCumulative` + the guardian
  `childVocab` [MARKED tests only — D-#155]); **`VocabGuardianService`** (`buildVocabResultMessage`
  perfect/regular/absent + `buildVocabCumulativeMessage` via `renderTemplate`; `generateVocabTestMessages` +
  `generateVocabCumulativeMessages` — wa.me for ALL families with a phone [ADR-003] + emit() Notification for
  login-enabled guardians [D-#72], contact-only stay wa.me-only [D-#31]; **N+1 guard** — the title is rendered
  ONCE per batch + each body ONCE per student, `renderTemplate`/`getEffectiveTemplate` is NEVER called inside
  the per-guardian loop, and NO cache was added to `getEffectiveTemplate`). New emitter `emitVocabGuardianResult`
  (takes pre-rendered text; writes the VOCAB_RESULT inbox row); `vocabTestId` ref added to `NotificationRefs`
  (additive, disjoint from any class-test ref); `WrongWord` gains `wordId` (additive — the word-aggregation
  key). New resolvers `vocabSummary` (reports = `tracker:read`; message generation = `message:dispatch` —
  Principal/Teacher/Office, the AS-T4 R-T2 posture, Guardian denied) + `vocabGuardian` (`childVocab` =
  `guardian:read_child` + `assertGuardianOfStudent`, D-#68; read-only). **RBAC (D-#154) — composes existing
  perms, NO new role/permission (D-#94/#17).** 1 new audit kind VOCAB_RESULT_MESSAGED. **Firewall
  unchanged-green** (VC-4 adds NO new models — the vocab-module dir scan already covers the new services).
  **Gate GREEN (executed):** vocab verifier PASS, shared build + shared/server tsc clean, **jest 981/981**
  (58 suites; +1 suite `vocabSummary.test.ts` [+22 over the 959 base] — pure aggregates + persistent-weak-word
  thresholds + the template-rendered message byte-check + the childVocab marked-only guardian boundary).
  **Server-only** (no app — VC-5 is the app slice; expo export skipped). **Not verified live.** **Next = VC-5**
  (app screens: WordBankManage · BuildVocabTest · VocabAssignment · VocabMarkGrid · VocabReports · GuardianVocab).
- **Planned (Classroom Observation module — REF-11 + Quran review, build contract written, D-#146–#152):**
  build contract authored, **no feature code yet**. New standalone `classroom-observation` module (identity
  plane, ADR-005). Two forms, one pipeline: **REF-11** (general+Arabic+Islam, `HW_SUBJECTS`) and the ported
  **ClassEcho form** for **Quran**. Pipeline: Office/Principal **upload + assign** a senior-teacher observer →
  observer scores+comments → **REVIEWED releases to the observed teacher (no Principal sign-off)** → teacher
  **responds** → in-app notify + **escalation ladder** nudges the teacher (device push deferred, D-#52).
  Footage = **YouTube-unlisted**, ported from ClassEcho (knowing privacy trade-off, D-#149; School-Handbook check
  pending). Plus a **review scheduler** (tiered cadence — weaker reviewed more, suggests-not-assigns) and a
  private **reviewer-effectiveness** read (calibration double-reviews + timeliness + throughput + impact +
  teacher fairness rating). App-native vocab only — **no wire twin / no two-place sync**. Slices **CO-1**
  REF-11 core+pipeline → **CO-2** footage → **CO-3** release+response+notify/escalate → **CO-4** trend →
  **CO-5** Quran form → **CO-6** scheduler → **CO-7** reviewer effectiveness.
  _(Renumbered from the handoff's D-#59–#65 — taken on main; slotted into the free D-#146–#152 run. Pre-flight
  flag: an `Observation` model already exists in `modules/hr` [HR-4's lightweight observation w/ parked REF-11
  rubricScores] — the new module's `ClassroomObservation` is a distinct name/module, no clash, but related.)_
  **Next = build CO-1 per `docs/prd-classroom-observation.md` §5, slice order CO-1→CO-7.**
- **Built (Class Test Tracker CT-5 — app, Expo, prd-tracker-class-test §6/J1–J7) [branch
  `worktree-class-test-ct5`, PR #70 MERGED] — COMPLETES the Class Test Tracker
  (CT-1..CT-5):** the app slice over the merged CT-1..CT-4 resolvers. **APP-ONLY: no server/shared/vocab/
  contract change** (working tree touches only `app/`; vocab verifier PASS). New 🧪 **Class Test tab** gated
  `tracker:read || roster:manage` (GUARDIAN never sees it); every action re-gated server-side, the Bangla deny
  surfaces inline (D-#42/#125). New `app/src/graphql/classTest.ts` (typed ops, kept out of the 4.7k-line
  operations.ts) + `ClassTestStackParamList` + ct* BN/EN labels + `pickAndUploadClassTestPaper`. **9 screens:**
  ClassTestHome (role-aware hub + myClassTests), RequestClassTest (J1 — set/upload + metadata + test#
  auto-suggest), ClassTestPrintQueue (J2 — Office /pdf/set or file download → mark printed/cancel),
  ClassTestResults (J3 — per-student grid: marks/Absent + weakness + teacher-action[internal] + guardian-action,
  derived %/pass shown, prefill), ClassTestPublish (J4 — per-student + bulk publish/unpublish; renders the wa.me
  links to tap-send; re-publish re-notifies), ClassTestDashboard (J5 — KPIs + overdue-by-teacher + the Office
  overdue-chase wa.me, message:dispatch), ClassTestReports (J5/J6 — Reports Status by section+subject → results
  / Class×Subject), ClassTestClassSubject (J6/§9 — trend ↑/↓/→ → profile), ClassTestStudentProfile (J6 — across
  subjects). **GuardianTestResults card** on GuardianHomeScreen (childTestResults — PUBLISHED-only, read-only;
  **never shows teacherAction** — the query doesn't select it, J7/D-#68). **Gate GREEN (executed):** app
  `tsc --noEmit` clean + `expo export --platform web` green (749 modules); no-drift = vocab verifier PASS +
  working tree app-only (server/shared/contract untouched → jest unchanged at the main base). No DECISIONS row
  (straightforward app surfaces, no new ruling). **Not verified live.** **Class Test Tracker fully built
  server + app — remaining work is live verification only.**
- **Built (Class Test Tracker CT-4 — server, prd-tracker-class-test §6/§9/J5/J6, D-#44 + build rulings
  D-#166/#167) [branch `worktree-class-test-ct4`, PR #68 MERGED]:** the FOURTH class-test
  slice — the read-side aggregates + the Office overdue-chase. **New `ClassTestSummaryService` (ALL DERIVED
  D-#85; `now`/`asOf` injected, deterministic; REUSES CT-2's `examReportStatus` — deadline/overdue NOT
  re-derived, the ONE D-#50 calendar source stays single-truth):** `reportsStatus` (per-exam submitted/
  pending/overdue + school-days late + a derived state via pure `reportStateOf` — 4-way partition complete >
  overdue > in_progress > not_started); `principalDashboard` (KPIs over the partition + completionRatePct +
  **overdue-by-teacher** grouped on `requestedBy`); `classSubjectAnalysis` (per-student PRESENT-percent series
  + `trendOf` ↑/↓/→, latest vs previous §9, **ABSENT excluded** §4); `studentProfile` (one student across
  subjects — per-result newest-first + per-subject avg/latest/trend); `overdueChaseList` (J6, AS-T4 posture:
  overdue rows grouped by teacher → Bangla wa.me nudge naming the overdue exams; **the Office chases, never the
  teacher**). **Resolvers:** `classTestReportsStatus`/`classTestClassSubjectAnalysis`/`classTestStudentProfile`
  (`tracker:read`, teacher section-scoped via `assertCanRead`, P/O unscoped); `classTestPrincipalDashboard`
  (Principal/Office); `classTestOverdueChase` (`message:dispatch` + P/O). **Vocab (app-native, additive):** ONE
  MT registry key `class_test.overdue_chase.wa` (D-#131 build-on-registry, NOT inline; TeacherName/Count/
  ExamList) + verifier check; **N+1 guard** — `getEffectiveTemplate` resolved ONCE per call, `interpolate`d per
  teacher. **NO new enum/permission (D-#94/#17)**; the chase is a stateless READ (no follow-up rows, no audit
  kind, no emit — the send is the Office tapping wa.me). Firewall class-test block extended (corpus ↛
  class-test). **Gate GREEN (executed):** vocab verifier PASS, shared build + shared/server tsc clean, **jest
  1033/1033** (61 suites; +1 new suite `classTestSummary.test.ts` [12] over the 1021 main base; firewall
  green). **Server-only** (no app — CT-5 is the app slice; expo skipped). **Not verified live.** **Next = CT-5**
  (the app slice — RequestClassTest / PrintQueue / Results entry / Publish / Dashboard / Reports + the
  GuardianTestResults card; completes the Class Test Tracker).
- **Built (Class Test Tracker CT-3 — server, prd-tracker-class-test §5/§8/J4/J7, D-#121/#122 + build rulings
  D-#160/#161) [branch `worktree-class-test-ct3`, PR #66 MERGED]:** the THIRD class-test
  slice — publish/unpublish + guardian delivery on the Message-Templates registry + the guardian read.
  **Publish (`ClassTestPublishService`):** `publishResult` (per-student) + `publishExam` (whole-exam bulk)
  stamp `publishedAt = now` + `$inc publishedVersion` (the CT-2 field), then deliver; `unpublishResult`/
  `unpublishExam` clear `publishedAt` (LEAVE publishedVersion → a re-publish bumps it again). **Guardian
  delivery built DIRECTLY on the merged MT registry (D-#131, NOT inline):** 4 `class_test.result.*` keys
  (`title` + `regular`/`excellent`/`absent` bodies, §8 Bangla verbatim as code defaults) render via
  `renderTemplate`; §8 mapping = ABSENT→absent, PRESENT+weakness→regular (feedback), PRESENT+no-weakness→
  excellent. Rails (D-#72/#31): **wa.me for EVERY family with a phone** (ADR-003) + in-app Notification
  (kind `CLASS_TEST_RESULT`, registered at CT-1 — consumed, NOT re-added) via `emit()` for login-enabled;
  contact-only stay wa.me-only. **N+1 guard:** title once/batch, body once/student, `renderTemplate` never in
  the per-guardian loop. **Republish RE-notifies (D-#122):** dedupeKey `CTR:{testId}:{studentId}:{guardianId}:v{publishedVersion}`
  — a fresh version → new key → emit re-fires (same version = no-op). **Guardian read (`childTestResults`,
  J7/D-#68):** `guardian:read_child` + `assertGuardianOfStudent`, **PUBLISHED-only**, mapped to a dedicated
  `GuardianClassTestResult` shape that **structurally omits `teacherAction`** (can't leak — the staff shape
  keeps it). **RBAC (D-#160): NO new role/permission** — publish/unpublish ride `tracker:write` +
  `assertCanWrite` (Office prints, never publishes); Office overdue-chase is CT-4. 2 audit kinds
  `CLASS_TEST_RESULT_PUBLISHED`/`_UNPUBLISHED`; `NotificationRefs += classTestId`. Firewall class-test block
  extended (corpus ↛ class-test). **Gate GREEN (executed):** vocab verifier PASS, shared build + shared/server
  tsc clean, **jest 1021/1021** (60 suites; +1 new suite `classTestPublish.test.ts` [15] over the 1006 main
  base; firewall green). **Server-only** (no app — CT-5 is the app slice; expo skipped). **Not verified live.**
  **Next = CT-4** (read aggregates: Reports Status / Principal Dashboard [KPIs + overdue-by-teacher] /
  Class×Subject Analysis / Student Profile + the Office overdue-chase via `message:dispatch`).
- **Built (Class Test Tracker CT-2 — server, prd-tracker-class-test §3.3/§4/§5/§9, D-#121 + build rulings
  D-#158/#159) [branch `worktree-class-test-ct2`, PR #64 MERGED]:** the SECOND class-test
  slice — per-student results + derived scoring + the school-day-aware, exam-date-anchored deadline/overdue.
  **New `modules/trackers/` model:** `ClassTestResult` (one row per student×exam, unique `(testId, studentId)`,
  freely editable, **NO retake** D-#121; `status PRESENT|ABSENT`, `marks?`, `weakness?`, internal `teacherAction?`,
  parent-facing `guardianAction?`, `publishedAt?`/`publishedVersion` reserved for CT-3; no schoolId D-#145).
  **Pure engines (no DB/clock, unit-tested):** `classTestScoring` (percent = marks÷total×100 [1dp], pass =
  marks≥passMark; **ABSENT ⇒ null marks/percent/pass, excluded from denominators** §4) + `classTestCalendar`
  (`deadlineFrom` advances N OPEN school-days after the EXAM date, skipping Fri/Sat/holiday via the injected
  `isOpenDay`; `deriveOverdue` — clock injected; async resolvers over the ONE D-#50 `resolveDayType`, open==FULL,
  **no second calendar truth**). **`ClassTestResultService`:** `enterResult` (marks 0..totalMarks + required
  only when PRESENT, ABSENT `$unset`s marks; **PRINTED-only, on/after the exam date** J3; upsert + audit),
  derived `studentResult`/`testResults` (never stored D-#85), `examReportStatus` (per-exam completion:
  roster/entered/present/absent/pending + complete + **overdue = past-deadline AND incomplete** [D-#120 idle
  until exam date] + schoolDaysLate). **Resolvers:** `enterClassTestResult` (`tracker:write` + `assertCanWrite`
  on the test's section — **Office prints, never scores**), `classTestStudentResult`/`classTestResults`/
  `classTestReportStatus` (`tracker:read` + section read-scope for teachers; `asOf` overrides the clock).
  **Vocab (app-native, NO wire sync — class-test-namespaced + DISJOINT from the in-flight VC-4, AGENTS rule 5):**
  `CLASS_TEST_ATTENDANCE_STATUSES = [PRESENT, ABSENT]` (+BN/EN) extends verifier **§C.14** (reuse of VC-4's
  `VOCAB_ATTENDANCE_STATUSES` rejected — would couple CT to vocab + cross the disjoint-enum line). 1 new audit
  kind `CLASS_TEST_RESULT_ENTERED`; firewall class-test block extended with `ClassTestResult` + the 2 pure
  engines + the result service/resolver (corpus ↛ class-test). **RBAC (D-#158): NO new role/permission**
  (composes existing perms, D-#94/#17). **Gate GREEN (executed):** vocab verifier PASS, shared build +
  shared/server tsc clean, **jest 984/984** (58 suites; +1 new suite `classTestResult.test.ts` [25] over the
  959 main base; firewall green). **Server-only** (no app — CT-5 is the app slice; expo export skipped). **Not
  verified live.** **Next = CT-3** (publish/unpublish per-student + per-exam; guardian delivery on the MT-1
  template registry + wa.me/emit() — republish re-notifies via versioned dedupeKey; `childTestResults` read).
- **Built (Class Test Tracker CT-1 — server, prd-tracker-class-test §3/§5/§6, D-#119–#122 + build rulings
  D-#143/#144/#145) [branch `worktree-class-test-ct1`, PR #63 MERGED]:** the FIRST class-test slice —
  the print-request → official-exam lifecycle replacing the Exam-Log + per-class Google Forms + IMPORTRANGE sheet.
  **Vocab (app-native, NO wire sync — a class test is a FEATURE not `doc_type` content; PARALLEL-SAFE with the
  in-flight VC-3 per AGENTS rule 5 — purely additive, disjoint enums):** `CLASS_TEST_STATUSES`
  (REQUESTED/PRINTED/CANCELLED) + `CLASS_TEST_SOURCES` (POOL_SET/UPLOADED_PAPER) + BN/EN labels;
  `NOTIFICATION_KINDS += CLASS_TEST_RESULT` (+BN/EN — extends verifier §C.5 exact-list, CONSUMED at CT-3);
  `StoredFile` kind += `classtest_question` (the M-4 model-enum pattern); new verifier **§C.14**. **The CT-kind
  question set already existed** (`SET_TYPES` "CT" → `SET_TYPE_TO_TRACKER.classtest`) so linking a pool set needed
  NO new set-kind enum (no STOP). **Server (`modules/trackers/`):** `ClassTest` model (the exam header / print
  request — born REQUESTED, promoted to the official exam on Office mark-printed; `testNumber` auto-suggested +
  editable, atomic `ctId`; `passMark` default round(0.40×total); `deadlineDays` stored default 2 — the school-day
  deadline derivation is CT-2, not here), `ClassTestSequence` (atomic `CT-C{class}-{SUBJ}-{nnnn}`, the D-#34
  pattern, replacing the fragile composite text key), `ClassTestService` (generateCtId / suggestTestNumber /
  createRequest [POOL_SET set-link OR UPLOADED_PAPER; **year+level+class resolved server-side from the section**,
  D-#143] / markPrinted [REQUESTED→PRINTED + printedAt/By] / cancelRequest [REQUESTED→CANCELLED] / reads),
  `ClassTestFileService` (the uploaded-paper read gate), resolvers (`createClassTestRequest` /
  `suggestClassTestNumber` / `markClassTestPrinted` / `cancelClassTest` / `classTestPrintQueue` / `myClassTests` /
  `classTestsForSection` / `classTest`). **Files (§5.2):** `POST /files/classtest` (multipart, `tracker:write`,
  jpeg/png/pdf ≤ 5 MB reusing `validateUpload`, Drive-first ⇒ 503 + nothing persisted — GP-J8) over the GP-A/M-4
  `DriveStore` `subfolder` (`SCD-Hub-Files/<year>/classtest/`); `GET /files/:id` dispatches `classtest_question`
  to a class-test gate = Office (`roster:manage`) OR the uploading teacher; the Drive id never reaches a client.
  **RBAC (D-#144) — composes existing perms, NO new role/permission (D-#94/#17):** teacher request/results =
  `tracker:write` + `assertCanWrite` section verify; Office mark-printed/cancel = `roster:manage`; staff reads =
  `tracker:read`. 3 new audit kinds (CLASS_TEST_REQUESTED/_PRINTED/_CANCELLED). **Firewall:** new class-test block
  (corpus ↛ class-test models + class-test source files ↛ corpus, both ways). **Build rulings:** D-#145 (no
  `schoolId` — single-school convention; renumbered from #142 at merge), D-#143 (year/level/class derived from
  the section — blocks sequence-key spoofing), D-#144 (file-store reuse + Office-or-uploader read gate). **Gate GREEN (executed):**
  vocab verifier PASS, shared build + shared/server tsc clean, **jest 943/943** (56 suites; +1 new suite
  `classTest.test.ts` + 2 new firewall checks over the 910 base; firewall green). **Server-only** (no app — CT-5
  is the app slice; expo export skipped). **Not verified live.** **Next = CT-2** (per-student `ClassTestResult` +
  derived percent/pass-fail + configurable passMark + the school-day-aware exam-date-anchored deadline/overdue).
- **Built (Vocabulary Tracker VC-3 — server, prd-vocabulary-tracker §3.6/§4/§6, D-#142) [branch
  `worktree-vocab-vc3`, PR #62 MERGED]:** the THIRD vocab slice — mistake capture + derived
  scoring. **New `modules/vocab/` models:** `VocabStudentTest` (per student × test — the ONE PRESENT/ABSENT
  attendance flag, sheet parity; the marked-roster anchor) + `VocabStudentResult` (per student × position — the
  Mistakes_Input analog; `wrongFields` = 1-based field indices marked wrong; only mistakes stored, no row =
  correct). **Pure `vocabScoring` engine** (no DB/clock): marks-lost per §4 (single-field wrong=1; 2-field
  DICTATION governed by the test's `dictationHalfMissCounts` — off ⇒ any field=1, on ⇒ 1/field), `score =
  max(0, totalMarks − Σlost)`, wrongCount + wrong-words-by-direction; **ABSENT excluded (null score)**.
  **`VocabResultService`:** `submitStudentResult` (WHOLESALE per student×test — set status + replace mistake
  rows, validates position-belongs-to-test + wrongFields-in-range, flips test→marked, audited) + derived reads
  `studentResult`/`testResults` (never stored, D-#85). **RBAC (D-#142) — NO new role/permission:** marking =
  `tracker:write` + the VC-2 operator gate (assigned/covering tester); reads = `tracker:read`. **Closed the VC-2
  coordinator follow-up:** `updateVocabTest` now re-gates on the TARGET week when a testDate change crosses weeks.
  Vocab `VOCAB_ATTENDANCE_STATUSES` (+BN/EN) + verifier §C.12; 1 audit kind VOCAB_RESULT_RECORDED; firewall block
  extended with the 2 student-bearing models. **Gate GREEN (executed):** vocab verifier PASS, shared build +
  shared/server tsc clean, **jest 926/926** (56 suites; +1 suite `vocabResult.test.ts`, +16 tests over the 910
  main base; firewall green). **Server-only** (no app — VC-5 is the app slice). **Not verified live.** **Next =
  VC-4** (read aggregates: per-test/student/class/cumulative reports + persistent weak words via admin thresholds;
  guardian messages server-resolved via the MT-1 template registry + wa.me/emit() seam; `childVocab` guardian read).
- **Built (Message Templates MT-1..MT-3 — server + app, prd-message-templates §3–§7, D-#128–#131 + build
  rulings D-#140/#141) [branch `worktree-message-templates`, PR #61 MERGED — integrated gate green, jest
- **Built (Message Templates MT-1..MT-3 — server + app, prd-message-templates §3–§7, D-#128–#131 + build
  rulings D-#140/#141) [branch `worktree-message-templates`, PR #61 MERGED — integrated gate green, jest
  910/910; coordinator 7-finder review = no code fixes, N+1 hoist follow-up recorded in memory]:** ONE
  admin-editable registry for EVERY generated message body + a big-bang migration of all live sites.
  **MT-1:** `MESSAGE_TEMPLATE_KEYS` (30 — title+body per notification kind + wa.me variants) +
  `MESSAGE_TEMPLATE_REGISTRY` (the code-default "printed page": per-key placeholders + default BN body +
  optional EN body + default langMode AS DATA) + `TEMPLATE_LANGUAGE_MODES` (BN/EN/BOTH) + the NEW permission
  **`template:manage` (PRINCIPAL only, verifier-proven exact-holder set — the payroll:approve posture)** +
  verifier §C.13. New `modules/templates/`: `MessageTemplate` override model (key globally unique, **no
  schoolId — D-#140**; `bufferCommands:false`), `MessageTemplateService` (`getEffectiveTemplate`
  override-or-default, `renderTemplate` interpolate+langMode, edit-time placeholder validation [unknown ⇒
  Bangla 422 naming the allowed set], empty-EN guard, edit/reset with **prior body audited first**
  [MESSAGE_TEMPLATE_EDITED], list + history), Principal-only resolvers; 1 audit kind; firewall corpus↛templates.
  **MT-2 (big-bang migration):** every in-scope site swapped to `renderTemplate`, each current inline string
  registered as that key's **VERBATIM** default — class-note published/prompt/escalation, HW parent-comms,
  review-assigned, cover-assigned, bell, attendance reminders (3 tiers), library due-soon/overdue, assignment
  guardian chase (in-app + wa.me, one shared body), credential-share (guardian/staff), tracker non-submitter.
  **`renderTemplate` is async (D-#141)** → the 5 pure builders became async delegates; the byte-identical
  notification/wa.me jest tests gained `await` ONLY (asserted strings unchanged → zero visible change proven).
  EXCLUDED: free-form chat (M-1..M-7) + the M-6 guardian-notice composer. **MT-3 (app, Principal-only):**
  `MessageTemplatesScreen` (list grouped by feature, Default/Edited badge) + `MessageTemplateEditScreen`
  (BN+EN fields, BN/EN/BOTH toggle, tap-to-insert placeholder chips, live preview with sample values, inline
  Bangla validation, edit history, reset-to-default) under the Admin tab, gated `template:manage`. **Vocab is
  PURELY ADDITIVE (AGENTS rule 5)** — no existing enum / RBAC-shape / import-contract change; rebases trivially
  behind the in-flight VC owner. **Gate GREEN (executed):** vocab verifier PASS, shared build + shared/server
  tsc clean, **jest 910/910** (55 suites; +1 new suite `messageTemplates.test.ts` [21] + 2 firewall over the
  887 base; all byte-identical migration tests unchanged-green), app tsc clean + expo web export green. **Not
  verified live.** Future features (e.g. Class Test) build on the registry directly (D-#131, no inline-then-migrate).
- **Built (HR app PR-4 — offboarding surfaces, Expo, APP-ONLY, D-#135) [branch `worktree-hr-app-offboarding`
  stacked on PR-3, PR #60 MERGED] — COMPLETES the HR app surfaces (PR-1..PR-4):** the
  cross-cutting exit workflow (consumes the HR-5 offboarding resolvers; NO server/vocab/contract change).
  Adds an **Offboarding** hub entry (`staff:manage`): `OffboardingHomeScreen` (status-filtered
  `offboardingCases` + `initiateOffboarding` trigger/last-working-day/notice → seeds the default clearance
  list server-side) → `OffboardingCaseScreen` (the whole case): clearance checklist
  (`addOffboardingClearanceItem` / `updateOffboardingClearanceItem`), **system access** (`revokeOffboardingAccess`
  — login disable + all grants withdrawn, with revoked badge/count), the **hard-held final settlement**
  (`computeFinalSettlement` [`payroll:manage`] showing gross/day-rate/encashment/advance-recovery/net + a
  held/released badge; **`releaseFinalSettlement` is PRINCIPAL-only `payroll:approve` and the server gates it
  on clearance complete, D-#29** — Office sees an info note), exit interview (`recordExitInterview`), service
  certificate (`issueServiceCertificate`), and `cancelOffboarding`. NOTE: the model's `OFFBOARDING_STATUSES`
  (initiated/access_revoked/completed/cancelled) matched the vocab labels (the earlier in_progress/settled
  guess was wrong). New BN/EN STR + offboarding label helpers. **Gate GREEN (executed):** app tsc clean +
  expo web export green (726 modules); vocab PASS + **jest 853/853** + the PR-4 diff vs its base touches no
  server/shared/contract. **Heads-up:** origin/main advanced past the chain's `e913ee5` base (VC-2 merged);
  the stacked PR chain (#56→#57→#59→this) is internally consistent and each PR's diff-vs-base is clean, but
  the chain needs a rebase onto current origin/main at merge time. **Not verified live. HR module is now
  fully built server + app.**
- **Built (HR app PR-3 — performance/conduct/development surfaces, Expo, APP-ONLY, D-#135) [branch
  `worktree-hr-app-performance` stacked on PR-2, PR #59 MERGED]:** the third HR app PR
  (consumes the HR-4 performance resolvers; NO server/vocab/contract change). Adds a **Performance** hub
  entry (`performance:manage`): `PerformanceHomeScreen` (StaffSelect → `StaffPerformanceScreen` +
  grievance inbox) → per-staff `StaffObservationsScreen` (`staffObservations` + `submitObservation`),
  `StaffAppraisalsScreen` (`staffAppraisals` + `upsertAppraisal`; **sign-off PRINCIPAL-only
  `performance:signoff`**, outcome form hidden for Office), `StaffConductScreen` (`staffConductRecords` +
  `recordConductStep`→`recordConductHearing`→**`finalizeConductStep` PRINCIPAL-only**; gross-misconduct
  fast-track flag; confidential), `StaffCpdScreen` (`staffDevelopmentLog` + `addDevelopmentLog`);
  `GrievanceInboxScreen` (`grievances` filter + `updateGrievance`). Confidentiality respected — the whole
  surface is `performance:manage`-gated so supervisors (neither perm) never reach conduct/grievance/outcome
  (H5.5). New BN/EN STR. **FLAGGED, not built (D-#135 umbrella):** the SUPERVISOR observation-write (H5.2)
  needs a teacher-readable staff-profile directory to pick the observed staff; only the manager-gated
  `staff` roster exists, so in-app a supervisor can't select the observed `staffProfileId` — managers
  observe here, a supervisor's own authored observations already read in My record (PR-1). **Gate GREEN
  (executed):** app tsc clean + expo web export green (724 modules); vocab PASS + no server/shared/contract
  drift + **jest 853/853 unchanged**. **Not verified live.** **Next = PR-4 (offboarding).**
- **Built (HR app PR-2 — payroll surfaces, Expo, APP-ONLY, D-#135) [branch `worktree-hr-app-payroll`
  stacked on PR-1, PR #57 MERGED]:** the second HR app-surface PR (consumes the HR-3
  payroll resolvers; NO server/vocab/contract change). Adds to the Staff/HR hub a **Payroll** entry
  (`payroll:manage`): `PayrollHomeScreen` (run list + links) → `PreparePayrollScreen` (`preparePayrollRun`
  month/working-days/note) → `PayrollRunDetailScreen` (`payslipsForRun` itemised net = gross − deductions +
  additions; **Approve+lock is PRINCIPAL-only — `payroll:approve`, button hidden for Office** with an info
  note; Cancel for `payroll:manage`) → `PaymentExportScreen` (`payrollPaymentExport`, locked run, cash
  excluded); `StaffPayScreen` (`setStaffPay` salary + method — set-and-confirm since the pay row isn't in
  the `staff` read); `AdvancesScreen` (`staffAdvances` list + qard-hasan `issueStaffAdvance`/
  `settleStaffAdvance` — **Principal-only controls gated `payroll:approve`**). New `paymentMethod`/
  `payrollRunStatus`/`payDeduction`/`payAddition`/`advanceStatus` label helpers + `money()` + BN/EN STR.
  **Gate GREEN (executed):** app tsc clean + expo web export green (717 modules); vocab PASS + no
  server/shared/contract drift + **jest 853/853 unchanged**. **Not verified live.** **Next = PR-3
  (performance/conduct/development)** → PR-4 offboarding.
- **Built (HR app PR-1 — Staff/HR tab + leave + staff self-service, Expo, APP-ONLY, D-#135)
  [branch `worktree-hr-app-leave`, PR #56 MERGED]:** the first of four HR app-surface
  PRs over the now-complete HR-1..HR-5 server module (which was server-only by HR precedent). **NO
  server / vocab / contract change** (proven: `git diff origin/main -- server shared docs skills` empty)
  — consumes existing HR resolvers + adds client ops/labels only. New **🧑‍💼 Staff/HR tab** gated
  `role !== "GUARDIAN"` (universal staff self-service; GUARDIAN never sees it) → `HrHomeScreen` hub
  branching self-service (all staff) vs management (permission-gated, re-checked server-side). **Self-
  service (own-row `my*`, no perm):** `MyLeaveScreen` (per-type balances for the current AY via
  `myStaffLeaveBalances` + `myStaffLeave` list with the approval paid/unpaid split + exceed-warning
  banner + `applyForStaffLeave` + own-cancel) → `LeaveCoverScreen` (per-slot `proposeStaffCover` via
  TeacherSelect); `MyRecordScreen` (read-only `myAppraisals`/`myConductRecords`/`myGrievances`+
  `raiseGrievance`/`myDevelopmentLog`/`myObservations`, confidentiality respected — own record only).
  **Admin (`leave:manage`):** `LeaveAdminScreen` (status-filtered `staffLeaveApplications` → approve/
  reject; `LeaveCover` in manage mode → `decideStaffCoverSlot` mints the D-#20 proxy; entitlements
  editor `upsertStaffLeaveEntitlement` w/ StaffSelect + AcademicYearSelect). New `HrStack` routes +
  BN/EN labels + `StaffSelect`. **Two server gaps FLAGGED, not built (D-#135 / guardrail):** no own-row
  **payslip** read (only `payslipsForRun`/payroll:manage) and no own-row **staff-attendance** read
  (only `teacherAttendance*`/attendance:manage) — surfaced as "pending" notices; adding them is a
  separate server slice for the coordinator. **Gate GREEN (executed):** app tsc clean + expo web export
  green; no-drift = vocab verifier PASS + full jest unchanged at the e913ee5 base (server untouched).
  **Not verified live.** **Next = HR app PR-2 (payroll surfaces)** → PR-3 performance → PR-4 offboarding.
- **Planned (Message Templates MT-1..MT-3, D-#128–#131):** build contract
  docs/prd-message-templates.md — one admin-editable registry for every GENERATED
  message body (guardian wa.me + in-app notification title/body per kind + staff
  notification bodies); EXCLUDES free-form authored (M-1..M-7 chat, M-6 guardian-notice
  composer). Default-in-code + admin-row-wins + read-time resolve + no seed write
  (D-#97/#103). Controlled MESSAGE_TEMPLATE_KEYS (one key per variant, each declaring its
  placeholder set); per-template language mode BN/EN/BOTH (default BN; can't set EN/BOTH
  until EN body filled). NEW permission template:manage (PRINCIPAL only, verifier-proven —
  payroll:approve posture); edit/reset audited (MESSAGE_TEMPLATE_EDITED, prior body
  retained). Edit-time placeholder validation (only declared placeholders; unknown →
  Bangla 422). renderTemplate(key,params) interpolates + applies langMode. MT-2 = big-bang
  migration: every in-scope generated-message site swaps to renderTemplate, current inline
  string becomes that key's verbatim code default (zero visible change); exact site
  inventory produced at build against live code (broader than the 6 first listed — also
  staff notification bodies + per-kind in-app text). MT-3 = Principal-only screen
  (list/edit/BN+EN/langMode toggle/allowed-placeholder chips/live preview with sample
  values/validation/edit history/reset-to-default, UI per D-#61). App-native vocab — no
  wire sync; serialize vocab.ts per AGENTS rule 5 (MT-1 waits for the in-flight vocab
  owner to land, then rebases). Class Test Tracker, when built, targets the registry
  directly (no inline-then-migrate) if this lands first. Plan/docs only — nothing executed.
  Next = build MT-1 per docs/prd-message-templates.md §6, slice order.
  _(Renumbered from the handoff's D-#117–#120 at commit — taken on main by HR-5 + Class-Test;
  MT slotted into the free #128–#131 run, clear of in-flight VC #132+ / HR-app #135+.)_
- **Planned (Comments & Parents-Meeting CM-1..CM-6, D-#114/#115/#123/#124):** build contract
  docs/prd-comments-meetings.md — replaces the Student-Complain Google Form→Sheet (daily teacher
  observations to guardians) AND the parents-meeting spreadsheets (schedule + per-child comments +
  cross-meeting comparison). Two stores: `StudentComment` (daily, typed [COMMENT_TYPES 5 values +
  COMMENT_SENTIMENTS concern/positive], subject-free, author = auth teacher, section-verified, permanent;
  delivered per-comment — wa.me all + emit() inbox/push login-enabled, kind-gated no-op fallback if vocab
  frozen per D-#94; attachments reuse DriveStore /comments/ ≤10 MB) and `MeetingComment` (class-teacher
  authored positive+concern per student×meeting — lands the D-#45 parent-comms duty). `ParentMeeting`+
  per-family `ParentMeetingSlot` (siblings collapsed by Student.phone, On-Call, configurable slotMinutes/
  dayStart, reorderable; present/absent derived); timing dispatch = wa.me + emit() MEETING_SCHEDULE + push.
  Comparison timeline = prior meeting comments + daily-by-type rollup since last meeting (D-#44 read-aggregate).
  RBAC composes existing perms — teacher tracker:write+section verify, Office roster:manage, class-teacher
  assertIsClassTeacher (meeting comment), guardian guardian:read_child; NO new role/permission (D-#17).
  App-native vocab only (COMMENT_TYPES/COMMENT_SENTIMENTS + NOTIFICATION_KINDS += STUDENT_COMMENT/
  MEETING_SCHEDULE, verifier §C.5/§C.x) — no wire/envelope/harness sync; serialize vocab per AGENTS rule 5.
  Identity plane (ADR-005); no corpus path; J5.6 firewall extends both ways. Slices server-then-app:
  CM-1 store+vocab → CM-2 delivery+attachments → CM-3 meeting+slot-gen → CM-4 dispatch+attendance →
  CM-5 meeting-comment+comparison+guardian-reads → CM-6 app. Plan/docs only — nothing executed.
  Next = build CM-1 per docs/prd-comments-meetings.md §6, slice order.
- **Built (Vocabulary Tracker VC-2 — server, prd-vocabulary-tracker §3.3–§3.5/§5/§6, D-#106 + build ruling
  D-#127) [branch `worktree-vocab-vc2`, PR open — coordinator reviews]:** the SECOND vocab slice — build-a-test
  + weekly tester assignment. **New `modules/vocab/` models:** `VocabTest` (per program×section, period-agnostic
  keyed by date; teacher-set `totalMarks` + per-test `dictationHalfMissCounts`, D-#105; `draft→ready→marked`),
  `VocabTestPosition` (Script_Map analog — auto-laid `{direction, qNumber, wordId}`; DICTATION field count is
  program-derived at mark time, not stored), `VocabTestAssignment` (append-only weekly (section×program) tester,
  the D-#64 marker pattern; `source direct|proxy`). **Services:** `vocabCalendar` (pure week/Thursday + holiday
  roll over the ONE D-#50 source), `VocabTestService` (create/update/`setVocabTestPositions` layout engine =
  delete+relay, validates directions vs program + words vs the program×classLevel bank), `VocabAssignmentService`
  (assign/current/history/mine + pure `isVocabOperator`), `vocabGate` (builder-free gates, deny-paths unit-tested).
  **RBAC (D-#127) — NO new role/permission:** test build (create/edit/lay positions) = `tracker:write` + the
  OPERATOR gate (`assertCanOperateVocab` — the current assigned tester OR an active D-#20 proxy on the section;
  stricter than assertCanWrite — teaching/supervisory scope does NOT qualify; Principal unscoped, Office/Guardian
  denied); weekly assignment = `roster:manage`; reads = `tracker:read`. Default test date = the week's THURSDAY,
  holiday-rolled backward; `weekOf` normalised to Sunday (test↔assignment share a key). 4 new audit kinds
  (VOCAB_TEST_*); vocab additions VOCAB_TEST_STATUSES + VOCAB_ASSIGNMENT_SOURCES (+BN/EN) + verifier §C.12;
  firewall block extended with the 3 new models. **Closed the VC-1 coordinator follow-up:** the auth gates were
  extracted into `vocabGate.ts` so their deny paths are unit-tested. **Gate GREEN (executed):** vocab verifier
  PASS, shared build + shared/server tsc clean, **jest 887/887** (54 suites; +2 new suites `vocabTest.test.ts`
  + `vocabGate.test.ts`, +34 tests over the 853 VC-1 base; firewall green). **Server-only** (no app — VC-5 is
  the app slice). **Not verified live.** **Next = VC-3**
  (`VocabStudentResult` — mistake capture on a student × position grid; 2-field dictation sub-marks; per-test
  ABSENT; derived score/wrong-count/wrong-words).
- **Built (Vocabulary Tracker VC-1 — server, prd-vocabulary-tracker §3/§6, D-#104/#105 + build ruling
  D-#126) [branch `worktree-vocab`, PR #55 MERGED — coordinator reviewed]:** the FIRST slice of the new
  vocab module (replacing the two-phase Google-Sheet system). **The data-driven trilingual model
  (D-#105):** `VOCAB_PROGRAMS` (ENGLISH/BANGLA/ARABIC) + `VOCAB_DIRECTIONS` (DICTATION/
  HEADWORD_TO_BANGLA/BANGLA_TO_HEADWORD) + BN/EN labels + the program→directions map
  (`VOCAB_PROGRAM_DIRECTIONS`) and dictation-field map (`VOCAB_DICTATION_FIELDS`: ENGLISH/ARABIC=2,
  BANGLA=1) AS DATA — a new language later = a new value + two map rows, not a rebuild; **no Old/New**
  (D-#104). Verifier §C.12 added. **New `modules/vocab/`:** `VocabWord` model (minimal —
  `{program, classLevel, headword, banglaMeaning, active, addedBy, addedOn}`; no transliteration/
  example/POS, no academicYearId [persistent], no schoolId [single-school live-repo convention]);
  `VocabWordService` (validators + add/edit/(de)activate-soft/list/get + audit); resolvers. **RBAC
  (D-#126) — NO new role/permission (D-#94/#106 compose pattern):** word-bank WRITE rides `tracker:write`
  + a class-level write-reach check (`assertCanManageClassLevel` — the §7 J1 actor; Principal unscoped,
  teacher needs a teaching/proxy scope at that class level, Office/Guardian denied); READ rides
  `tracker:read` (shared content, not reach-restricted); the VC-2 weekly tester assignment is reserved
  for `roster:manage`. 3 new audit kinds (VOCAB_WORD_*) in `platform/models/Audit.ts`. New vocab firewall
  block (corpus ⇄ vocab both ways — the module holds per-student results from VC-3). **Gate GREEN
  (executed):** vocab verifier PASS, shared build + shared/server tsc clean, **jest 853/853** (52 suites;
  1 new suite `vocabWord.test.ts` + 2 firewall checks; firewall green). **Server-only** (no app — VC-5 is
  the app slice; expo export skipped). **Not verified live.** **Next = VC-2** (`VocabTest` +
  `VocabTestPosition` build-a-test from selected words → auto-laid positions; teacher sets totalMarks +
  the dictation half-miss rule; `VocabTestAssignment` append-only weekly assignment via `roster:manage` +
  D-#20 proxy resolution; Thursday default + D-#50 holiday roll).
- **Planned (Class Test Tracker CT-1..CT-5, D-#119–#122):** build contract
  docs/prd-tracker-class-test.md — replaces the Google-Sheet Class Test system
  (Exam Log + per-class Google Forms + IMPORTRANGE analysis). In-app lifecycle:
  teacher assembles a CT-set from the question pool (or uploads own paper) →
  print request → Office prints the PDF + marks printed (creates the exam record;
  deadline anchors the EXAM date not the print date, school-day-aware via D-#50,
  default 2, admin-configurable) → teacher enters per-student results
  (marks/Absent + weakness + teacher-action + guardian-action; %/pass-fail
  derived; passMark configurable; no auto-grading; no retake) → publish
  per-student/per-exam (edit + unpublish; republish RE-notifies via versioned
  dedupeKey) → guardian portal results card + wa.me (all) + emit() Notification
  (login-enabled). Read aggregates (D-#44): Reports Status, Principal Dashboard
  (KPIs + overdue-by-teacher), Class×Subject Analysis, Student Profile; Office
  (not teachers) chases overdue (message:dispatch). Uploaded papers reuse the
  StoredFile/DriveStore store (D-#70/#71/M-4). RBAC composes existing perms —
  teacher=tracker:write+section verify, Office=roster:manage, guardian=
  guardian:read_child; no new role/permission (D-#17). App-native vocab
  (CLASS_TEST_* + NOTIFICATION_KINDS += CLASS_TEST_RESULT + StoredFile classtest
  kind) — no wire sync; serialize vocab.ts per AGENTS rule 5. Inline Bangla
  guardian templates ship now; migrate to the planned Message Templates registry
  later (no rework). Plan/docs only — nothing executed.
  Next = build CT-1 per docs/prd-tracker-class-test.md §6, slice order.
  _(Renumbered from the handoff's D-#111–#114 at commit — those taken on main; CT
  slotted into the free #119–#122 gap, clear of in-flight VC-1 #126+ / HR-app #135+.)_
- **Built (HR step 5 — offboarding, server, prd-hr §6/H6, D-#29 + build rulings D-#117/#118)
  [branch `worktree-hr-offboarding`, PR open — coordinator reviews]:** the cross-cutting exit workflow that
  COMPLETES the HR module (HR-1..HR-5); it COMPOSES the earlier slices, never twins them. The HR-4
  termination→employmentStatus trigger is its entry point. **New `modules/hr/` model:** `OffboardingCase`
  (trigger + status + lastWorkingDay + embedded clearance checklist + embedded hard-held final settlement +
  exit interview + service-certificate flags). **Services:** `offboardingMath` (pure: trigger→status,
  default checklist, clearanceComplete, lazy date-gate), `OffboardingService` (initiate / clearance / access
  revoke + the `runDueOffboardingRevocations` sweep / settlement compute+release / exit interview /
  certificate / cancel / reads); foundation `ScopeGrantService.revokeAllGrantsForUser` (REUSED).
  **H6.1:** the trigger sets `StaffProfile.employmentStatus` (resignation→resigned, termination→terminated
  [HR-4 entry point], fixed_term_end→contract_ended, retirement→retired — EMPLOYMENT_STATUSES gained the two
  new exit states, D-#117). **H6.2:** configurable clearance checklist (3 §6 categories seeded as read-time
  defaults, D-#97 no-seed). **H6.3 — by the system:** access revoked on the last working day via the EXISTING
  N-2 ticker (no new scheduler; no-cron/lazy posture D-#20/#21) — `runDueOffboardingRevocations` runs
  once-per-day from the tick, disables the `User` login + revokes ALL scope grants (idempotent, lazy
  date-gate); manual admin path too. **H6.4:** `computeFinalSettlement` composes salary pro-rated to last day
  + arrears + full leave encashment (HR-2) − outstanding advance (HR-3, full one_shot netting via the
  payrollMath net-pay guard), **HARD-HELD until clearance complete** (`releaseFinalSettlement`,
  payroll:approve/Principal — throws unless every item done/waived, D-#29; commits advance recovery +
  completes). **H6.5:** StaffProfile retained never deleted; exit interview + service certificate.
  **RBAC (D-#117) — NO new permission:** composes `staff:manage` + `payroll:manage` + `payroll:approve`
  (Principal-only release). **Vocab (app-native, NO wire sync):** EMPLOYMENT_STATUSES += retired/contract_ended;
  OFFBOARDING_TRIGGERS/OFFBOARDING_STATUSES/CLEARANCE_ITEM_STATUSES + BN/EN; verifier §C.11 (no OFFICE-list
  change). 8 new audit kinds; HR firewall extended with `OffboardingCase`. **Gate GREEN (executed):** vocab
  verifier PASS, shared build + shared/server tsc clean, **jest 831/831** (51 suites; 17 new in
  `offboarding.test.ts`; firewall green). **Server-only** (no app — HR precedent; expo export skipped). **Not
  verified live.** Parked (prd-hr §10/H7.7): clearance-list items, BD statutory final-dues timeline (vs D-#29),
  §6 app screens. **HR MODULE COMPLETE (HR-1..HR-5)** — next HR work = the §6/§5 app surfaces + live verification.
- **Built (Messaging M-6 + M-7 app pass — Expo, APP-ONLY, D-#125) [branch `worktree-messaging-app`,
  PR open — coordinator reviews]:** the deferred app surfaces for the already-merged M-6/M-7 server
  work, per `docs/prd-messaging.md` §5/§6. **NO server / vocab / contract change** (proven: `git diff
  origin/main -- server shared docs` is empty) — consumes the existing M-6/M-7 resolvers + adds client
  ops. **New ops** (`operations.ts`): `setConversationMuted`, `oversightConversations`,
  `openConversationOversight`, `oversightMessages`, `composeGuardianNotice` (+ result types); `muted`
  added to `ChatMemberT` + the member selection in `CONVERSATION_FIELDS`. **M-7 mute:** ChatThread 🔕/🔔
  own-row toggle (reads `members[].muted`, flips via `setConversationMuted`, optimistic); ChatHome shows
  a muted badge/prefix. **M-6 oversight** (`chat:oversee` = PRINCIPAL): ChatHome entry → `ChatOversightScreen`
  (browser over `oversightConversations`) → `ChatOversightThreadScreen` fires the **audited**
  `openConversationOversight` on open then pages `oversightMessages` (load-older); READ-ONLY, deleted
  originals shown un-masked with a marker. **M-6 notice composer** (`chat:write`): ChatHome entry →
  `GuardianNoticeScreen` — scope SECTION/SCHOOL (SCHOOL chip only for `chat:manage`), SECTION picker from
  `mySectionsAsClassTeacher`, → `composeGuardianNotice` → `recipients[]` as ADR-003 `wa.me` links +
  reach counts; the server enforces D-#45 and its Bangla deny shows inline. New ChatStack routes + BN/EN
  labels. **Gate GREEN (executed):** app tsc clean + expo web export green (706 modules); no-drift =
  vocab verifier PASS + **jest 814/814 unchanged** (server untouched). **Not verified live.** **Messaging
  module is now fully built server + app (M-1..M-7).** Follow-up (deferred, D-#125): a full-section picker
  so Principal/Office can target an arbitrary SECTION notice (server already authorizes it; only the
  picker UI is absent — SCHOOL scope covers the gap today) + live verification.
- **Built (HR step 4 — performance / conduct / development, server, prd-hr §5/H5, D-#28 + build rulings
  D-#112/#113) [branch `worktree-hr-performance`, PR open — coordinator reviews]:** the fourth HR slice,
  independent of payroll; needs HR-1 (StaffProfile) + the supervisory scope (D-#28). **New `modules/hr/`
  models:** `Observation` (event: observer/date/class+subject/notes/follow-up + free-form REF-11
  `rubricScores`, parked), `Appraisal` (one per staff per academic year, `draft→signed_off`, goals +
  developmentNeeds + Principal-only `overallOutcome`), `ConductRecord` (ladder stage/status/grossMisconduct
  + hearing + `liveUntil` lapse), `Grievance` (staff-raised confidential), `DevelopmentLog` (CPD).
  **Services:** `conductLadder` (pure order/fast-track/lapse), `observationScope` (pure `supervisoryCovers`
  + `userCanObserve` reusing `composeTeacherScope`), `ConductService` (record→hearing→finalize with enforced
  order + 'adl hearing-before-finalize + termination→employmentStatus + lazy `lapseExpiredConduct`),
  `PerformanceService` (observations/appraisals; sign-off EMITS CPD), `GrievanceService`. **RBAC (D-#112):**
  two NEW permissions — `performance:manage` (PRINCIPAL/OFFICE) prepares/reads everything; `performance:signoff`
  (**PRINCIPAL only**) signs off appraisals + finalizes conduct (Office cannot — a distinct permission the
  verifier proves, mirrors payroll:approve, H5.2/§2). The **supervisor observation-WRITE is NOT a permission**
  — it rides the existing supervisory `ScopeGrant` extent (D-#28, the D-#94 compose-don't-add pattern); a
  supervisor reads ONLY their own observations, never conduct/outcome (H5.2). **Confidentiality (satr,
  H5.5/H7.3):** conduct/grievance/appraisal-outcome = `performance:manage` (P/O) + subject own-row
  (`myConductRecords`/`myAppraisals`/`myGrievances` via the staffMatch phone-link); supervisors hold neither
  perm so they structurally can't read conduct. **Conduct ladder (D-#113):** enforces verbal→written→final→
  termination (no rung-skip; gross misconduct fast-tracks), hearing recorded before finalisation, termination
  writes `employmentStatus → terminated` (the offboarding TRIGGER; the H6 workflow stays HR-5's court),
  warnings lapse LAZILY (D-#21 posture) + stay on file. **Vocab (app-native, NO wire sync; HR owns vocab this
  cycle):** CONDUCT_STAGES/CONDUCT_RECORD_STATUSES/APPRAISAL_STATUSES/APPRAISAL_OUTCOMES/GRIEVANCE_STATUSES +
  BN/EN + performance:manage/performance:signoff; verifier §C.10 + OFFICE exact-list. 12 new audit kinds
  (OBSERVATION_SUBMITTED / APPRAISAL_* / CONDUCT_* / STAFF_TERMINATED / GRIEVANCE_* / DEVELOPMENT_LOGGED) in
  `platform/models/Audit.ts`. HR firewall block extended with the five new models (green both ways).
  **Gate GREEN (executed):** vocab verifier PASS, shared build + shared/server tsc clean, **jest 801/801**
  (49 suites; 25 new in `performance.test.ts`; firewall green). **Server-only** (no app screens — the HR-1..HR-3
  precedent; expo export skipped). **Not verified live.** Parked (prd-hr §6/§10): REF-11 observation rubric
  (curriculum-owned), per-stage warning-lapse period, the §5 app screens. **Next after merge = HR-5
  (offboarding)** — stitches records + leave + payroll + conduct; the termination trigger this slice stamps
  is its entry point.
- **Built (Messaging M-7 — staff Expo push, server, D-#116) [branch `worktree-messaging-m7`, PR open
  — coordinator reviews]:** the SEVENTH and FINAL messaging slice per `docs/prd-messaging.md` §5/J-M1 —
  **messaging M-1..M-7 is now COMPLETE**. **VOCAB-FREE** (HR-4 owns `shared/vocab.ts` this cycle):
  chat push is **transient** — straight through the existing platform `sendExpoPush` transport, with
  **NO Notification inbox row and NO `NOTIFICATION_KINDS` value** (the conversation list `myConversations`
  IS the chat inbox; a push is only the live nudge), so the verifier is untouched-PASS. New
  `ChatPushService.pushNewChatMessage(message)`: loads the conversation's members EXCEPT the sender +
  EXCEPT muted, looks up their **active non-web `PushDevice` tokens** (the AT-4/N-4 staff registry —
  REUSED, not twinned), fans out one Expo push each (title = group title, else sender name for DIRECT,
  else "SCD Hub" for the system feed; body = text or "📎 সংযুক্তি" for an attachment-only message;
  `data.kind:"CHAT_MESSAGE"` is a transport label for the app tap-router, NOT a vocab enum); best-effort
  + fully defensive (never throws), dead tokens pruned exactly as AT-4/N-4. **Per-user mute** = new
  `muted` boolean on `ConversationMember` + `setConversationMuted(conversationId, muted)` (own-row,
  membership-gated, **no new permission** — D-#42 pattern; a muted member still reads the thread, only
  the push is suppressed; exposed per-member on the GraphQL `ConversationMember` type). Push wired at
  each path's **public entry point**, fire-and-forget: the `sendMessage`/`forwardMessage` resolvers fire
  after the service persists (no added latency, never blocks/rolls back the send); the M-6
  **`dispatchSystemMessage` seam** fires it in-service — the **D-#52 routine-trigger push path** (wiring
  the triggers themselves still stays in the routine module's court). **NO app change** — the staff
  device-token login/logout lifecycle already exists (N-4 `registerPushToken`/`unregisterPushToken`,
  web no-op) and is reused; **guardian push stays portal-deferred** (PRD §7, chat is staff-only D-#76).
  Firewall unaffected (ChatPushService is identity/platform-plane; no corpus path). **Gate GREEN
  (executed):** vocab verifier PASS, shared build + shared/server tsc clean, **jest 789/789** (49 suites;
  13 new across chatPush 10 + chat mute 3; firewall green). **Not verified live** (rides DEP-3). **Next =
  the messaging app pass for M-7** (a small mute-toggle on the conversation/thread screen — server slice
  preceded the app like M-1..M-4 → M-5) + live verification; the messaging MODULE is otherwise done.
- **Built (Messaging M-6 — Principal oversight + guardian notice composer + dispatch seam, server, D-#111)
  [branch `worktree-messaging-m6`, PR open — coordinator reviews]:** sixth messaging slice per
  `docs/prd-messaging.md` §5/§6. **Vocab (the planned M-6 flip):** `chat:oversee` pipeline→**build** in
  `PERMISSION_BUILD_STATUS` — the LAST pipeline perm, so the verifier's pipeline-set is now **EMPTY**
  (every permission is BUILD); §C.7 build-status assertion updated. **Oversight** (`chat:oversee` =
  PRINCIPAL only): `ChatOversightService` — `oversightConversations` (EVERY conversation incl. DIRECT +
  archived; NO membership filter), `oversightMessages` (**UN-MASKED** — Principal sees deleted originals,
  since M-3 delete only stamps `deletedAt`, never erases; the member path still masks), `openConversationOversight`
  (the **audited open** `CHAT_OVERSIGHT_OPENED`, one row per open — accountability both ways); READ-ONLY
  (post/edit/delete stay membership-gated). **Guardian notices** (`GuardianNotice` model +
  `composeGuardianNotice`): per-guardian ADR-003 **wa.me fan-out** (one link per active student WITH a family
  phone — `Student.phone`, the D-#31/#59 contact reality; phone-less → `unreachableCount`); authorization =
  extracted unit-tested `assertCanComposeNotice` (the **D-#45 duty**: SECTION → class teacher
  `assertIsClassTeacher` OR chat:manage; SCHOOL → chat:manage; no new perm, D-#42 pattern; J-M8 deny tested);
  `NOTICE_SENT` audited. **Dispatch seam**: `MessageDispatchService.dispatchSystemMessage(userId, text)` posts
  as a sentinel SYSTEM sender (zero ObjectId, no User row) into a per-user system→user DIRECT thread
  (ANNOUNCEMENT one-way feed; privileged — bypasses membership/posting gates; idempotent on directKey) — the
  interface the **routine triggers** (bell/attendance/class-note) will call; **wiring the triggers stays in
  the routine module's court** (PRD §5/§7), this slice only builds + unit-tests the API. Two new audit kinds
  in `platform/models/Audit.ts`. Firewall extended (corpus ↛ `models/GuardianNotice`). **App surfaces (the
  oversight browser + the notice composer screen) are a LATER app pass** (like M-1..M-4 server preceded the
  M-5 app). **Gate GREEN (executed):** vocab verifier PASS (chat:oversee flip), shared+server tsc clean,
  **jest 776/776** (48 suites; 17 new across chatOversight 5 / guardianNotice 9 / messageDispatch 3; firewall
  green), app tsc clean + expo web export green. **Not verified live.** **Next = M-7** (staff Expo push — the
  D-#52/R5.4–R5.5 transport for STAFF; rides AT-4's `PushDevice` + the N-4 push channel; guardian push stays
  portal-deferred). **Messaging module is then complete (M-1..M-7).**
- **Built (Messaging M-5 — Chat tab + screens, Expo app, APP-ONLY) [branch `worktree-messaging-m5`,
  PR open — coordinator reviews]:** the frontend slice for everything M-1..M-4 shipped server-side,
  per `docs/prd-messaging.md` §5. **NO server / vocab / contract change** — consumes the existing chat
  queries/mutations + `/files` endpoints only. New 💬 **Chat tab** gated `chat:read` (Principal/Teacher/
  Office; GUARDIAN never sees it). Four screens (`ChatStack`): **ChatHome** (conversation list from
  `myConversations` — DIRECT + auto SECTION/SUBJECT/SCHOOL + manual CUSTOM; ANNOUNCEMENT badge, member
  count, last activity; "+new DM" + managers' "new group"); **ChatThread** (`messages` with `_id`-cursor
  "load older"; per-message reply / forward / react-toggle / edit / delete own-only; deleted → Bangla
  removed-placeholder; reactions aggregated by emoji + a free-form palette; seen ✓count on own messages;
  `markSeen` on focus; ANNOUNCEMENT hides the composer for non-managers but keeps reactions; attachment
  picker + viewer via `POST /files/chat` + `GET /files/:id`, web-only graceful-degrade like GP-A; managers
  get an inline ⚙ Manage-group link); **NewChat** (1:1 staff picker → `openDirectConversation`);
  **GroupManage** (`chat:manage`: create group + posting policy, add/remove MANUAL members, flip
  OPEN⇄ANNOUNCEMENT, archive CUSTOM). **Design note / flag:** the staff directory for the new-DM /
  add-member pickers is **DERIVED from conversation memberships** (the SCHOOL auto-group holds every active
  staff member) because **no `chat:read`-scoped staff-directory query exists** server-side (`users`/`staff`
  are manager-only) — the app-only guardrail meant I did NOT add one; sufficient because SCHOOL contains all
  staff, flagged for the coordinator if a dedicated directory read is wanted. New `lib/chat.ts` +
  `pickAndUploadChatFile` (`lib/files.ts`) + chat BN/EN labels; existing tab-nav / urql / ui-guidelines
  token patterns (D-#61). **Gate GREEN (executed):** app `tsc --noEmit` clean + `expo export --platform web`
  green; no-drift — vocab verifier PASS + **jest 738/738** untouched (server unchanged). **Not verified
  live** (rides DEP-3). **Next = M-6** (Principal oversight + guardian notice composer — flips
  `chat:oversee` pipeline→build, a vocab-toucher; sequence against whoever owns vocab then) → M-7 staff push.
- **Built (HR step 3 — payroll, server, prd-hr §4, D-#26/#27 + build rulings D-#109/#110) [MERGED to main,
  PR #48 — coordinator review applied]:** the monthly payroll run on top of HR-1
  salary + HR-2 leave. **New `modules/hr/` models:** `PayrollRun` (monthly, `prepared → approved_locked`,
  immutable once locked), `Payslip` (itemised **net = gross − deductions + additions**), `AdvanceLoan`
  (qard-hasan — interest- & fee-free, NO rate/fee field exists, D-#27). **Services:** `payrollMath` (pure
  `dayRate` = monthly ÷ run working-days + `computePayslip` with the §4.5 **net-pay guard** — a repayment
  never drives net < 0, excess rolls forward), `PayrollService` (prepare/recompute → **approve+LOCK**
  commits advance recovery → cancel → `paymentExport`), `AdvanceService` (issue/settle/read).
  `StaffProfile` gains optional `monthlySalary` + `paymentMethod` (additive, no migration); `setStaffPay`
  (payroll:manage). **RBAC (D-#109):** `payroll:manage` (PRINCIPAL/OFFICE) prepares/reads; `payroll:approve`
  (**PRINCIPAL only**) locks + issues/settles advances — Office cannot approve, a distinct permission the
  verifier proves (H4.2/H4.7). **Lock/correction seam (D-#110, the design ask):** a locked run is NEVER
  retro-edited — post-lock corrections ride `arrears`/clawback lines on the NEXT run; the unpaid-leave
  deduction reads the **STORED** leave paid/unpaid split (not the read-time attendance overlay), attributed
  to the leave's start month; advance recovery commits at lock so recompute is safe; cash-paid staff
  excluded from the export. **Vocab (app-native, NO wire sync; serialized to this session this cycle — the
  parallel Vocab-Tracker session adds only VOCAB_* + no perms, no collision):** PAYMENT_METHODS /
  PAYROLL_RUN_STATUSES / PAY_DEDUCTION_TYPES / PAY_ADDITION_TYPES / ADVANCE_STATUSES + BN/EN +
  payroll:manage/payroll:approve; verifier §C.9 + OFFICE exact-list. New audit kinds STAFF_PAY_SET /
  PAYROLL_* / ADVANCE_*. HR firewall block extended with the payroll models. **Gate GREEN (executed):**
  vocab verifier PASS, shared build + shared/server tsc clean, **jest 731/731** (44 suites; 19 new in
  `payroll`). **Server-only** (no app screens — the HR-2 / Messaging precedent). **Not verified live.**
  Parked (prd-hr §10): entitlement/bonus figures, statutory deductions, payment-export target format,
  lateness-rule params, ÷30 day-rate alternative. **Next after merge = HR-4 (performance/conduct/
  development)** — independent of payroll; needs HR-1 + supervisory scope (D-#28).
- **Built (Messaging M-4 — chat attachments image/PDF/video/voice ≤10 MB, server, D-#108) [MERGED to main,
  PR #47 — coordinator review applied]:** fourth messaging slice per
  `docs/prd-messaging.md` §5. **Storage pre-flight (AGENTS rule 3 — live repo wins over the PRD):
  REUSES the GP-A Google Drive store; the PRD §9 Oracle-VM-disk path is NOT built** (Drive already
  holds the bytes on the school's My-Drive quota — D-#70/#71; the §9 VM-disk reason, GridFS can't hold
  video, is moot). **No twin store/transport/model:** generalized `platform/services/DriveStore` (a
  `subfolder` param → `SCD-Hub-Files/<year>/chat/`) + `platform/models/StoredFile` (four `chat_*` kinds
  on the existing `hw_*` enum + optional `conversationId`) + the existing server-streamed `GET /files/:id`
  (Drive id never reaches a client). **Upload:** `POST /files/chat` (multipart, `chat:write` +
  `assertChatMember`; MIME whitelist per ATTACHMENT_KINDS + 10 MB hard cap; Bangla 422; Drive-first ⇒ 503
  + nothing persisted — GP-J8 posture). **Read gate** (`ChatFileService.assertChatFileReadAccess`): member
  of SOME conversation holding a LIVE message that references the file → a **deleted message's attachment
  becomes inaccessible** (M-4 acceptance; refs stay in the MESSAGE_DELETED audit); `GET /files/:id`
  dispatches by the file's OWN kind (hw → HomeworkFile, chat → ChatFile) so neither plane re-exposes the
  other's files. **Send binding:** `sendMessage` gains `attachmentIds` — `resolveSendAttachments` admits
  only CHAT files the SENDER uploaded FOR this conversation (no foreign/cross-conversation/hw file);
  attachment-only messages (no body) now allowed; `ChatMessage` GraphQL gains an `attachments` field
  (batched). One new audit kind `CHAT_ATTACHMENT_UPLOADED` in `platform/models/Audit.ts` — NOT vocab
  (HR owns it this cycle; verifier untouched + PASS). **Gate GREEN (executed):** vocab verifier PASS,
  shared+server tsc clean, **jest 710/710** (43 suites; 26 new in `chatAttachments.test.ts`; firewall
  green), app tsc clean + expo web export green. **Not verified live** (needs the Drive credential —
  D-#70/#71 — + DEP-3). **Next = M-5** (app screens: Chat tab — conversation list, thread, reply/forward/
  react/edit/delete, attachment picker + voice recorder, seen-by) → M-6 oversight + guardian notices
  (flips `chat:oversee`) → M-7 staff push.
- **Planned (Vocabulary Tracker VC-1..VC-5, D-#104–#107):** build contract
  docs/prd-vocabulary-tracker.md — replaces the two-phase Google-Sheet vocab system (Phase-1
  per-test files + Phase-2 IMPORTRANGE). Three data-driven programs (English/Bangla/Arabic),
  per-class word bank, **no Old/New**, per-test totalMarks, configurable dictation half-miss,
  no auto-grading; weekly per-(section×program) assigned teacher + D-#20 proxy + append-only
  assignment log; reports/guardian-messages ride D-#44 aggregates + wa.me/emit() seam. App-native
  vocab only — no wire/harness sync (serialize per AGENTS rule 5 at VC-1/VC-4). Identity-plane
  (ADR-005), no new role/permission (D-#94 pattern). Plan/docs only — nothing executed.
  Next = build VC-1 per docs/prd-vocabulary-tracker.md §6, slice order.
- **Built (HR step 2 — staff ATTENDANCE & LEAVE, server, prd-hr §3/H2, D-#22/#23 + build rulings
  D-#102/#103) [MERGED to main, PR #46]:** the genuinely-missing
  **staff LEAVE source** + the staff-attendance leave reconciliation AT-1 left open. **Scope boundary
  (D-#102, the pre-flight call):** the existing `attendance` module (D-#63–#67) already ingests staff
  attendance as a biometric Excel SNAPSHOT (`TeacherAttendanceDay`) = HR-2b's "internal record + manual
  transport"; HR-2 does NOT rebuild the punch-driven §3a schedule/grace/working-days/manual-source layer
  (it presupposes punch-level data the symbol snapshot lacks + the parked live device sync, D-#24/H7.6) —
  it builds leave + closes the ✘→LEAVE seam. **New `modules/hr/`:** `StaffLeaveEntitlement` (per
  staff/year/type allowance — admin DATA, numbers parked §10, read-time 0 default, NO seed — D-#97 posture),
  `StaffLeaveApplication` (parent record; approval stamps a paid/unpaid split — the exceed rule WARNS, never
  blocks §3.3; maternity/hajj wholly unpaid, D-#23), `StaffCoverSlot` (fans out one slot per class the
  absent teacher teaches → approval mints a **D-#20 proxy grant** via `assignProxy`; cancel/reject revoke it
  — the D-#22 propose-then-approve gate, grant model unchanged). Services: LeaveEntitlementService
  (balance/proration/day-count pure math), StaffLeaveService, CoverService, `staffMatch` (the **phone-only
  `User`↔`StaffProfile` join** provisioning uses — NO FK/migration added, worktree-rule-3 safe). **AT-1 seam
  CLOSED:** a biometric ✘ now reads LEAVE when an approved staff leave covers that staff/date — a READ-TIME
  overlay in `TeacherAttendanceService` (forDate + summary), correct even when leave is approved AFTER the
  snapshot import (D-#103). **RBAC (D-#103):** `leave:manage` (PRINCIPAL/OFFICE, build) = the admin surface +
  record-on-behalf for support (no login, D-#25); teacher self-apply/propose-cover/cancel/view-own = OWN-ROW,
  **no new permission** (D-#17/#72 posture). **Vocab (app-native, NO wire sync, I own vocab this cycle):**
  `LEAVE_TYPES`/`LEAVE_STATUSES`/`COVER_SLOT_STATUSES` + BN/EN + `LEAVE_TYPE_RULES` (settled §3.2 table) +
  `leave:manage`; verifier §C.8 added + OFFICE exact-list updated. New audit kinds STAFF_LEAVE_*/STAFF_COVER_*.
  Firewall test extended both ways (corpus ⇄ hr). **Gate GREEN (executed):** vocab verifier PASS, shared
  build + shared/server tsc clean, **jest 690/690** (42 suites; 27 new in `staffLeave` + 2 firewall;
  firewall green). **Server-only** (no app screens — the Messaging M-1/M-2 precedent; an HR app slice is the
  follow-up). **Not verified live.** Parked (prd-hr §10, unchanged): leave entitlement amounts/Hajj reset,
  maternity legal check (H7.5/D-#23), the §3a live-sync layer (H7.6). **Next after merge = HR-3 (payroll)** —
  needs HR-1 salary + this leave (encashment) + attendance (unpaid-leave day-rate deduction).
- **Built (Messaging M-3 — reply/forward/reactions/edit/delete, server, D-#77/#101) [MERGED to main,
  PR #45 + coordinator review fix — reaction emoji bounded]:** third messaging slice per
  `docs/prd-messaging.md` §5. Wires the inert M-1 `ChatMessage` fields (replyTo was already validated in
  M-1 sendMessage). **forward** (`forwardMessage`): member of BOTH source + target, sets `forwardOfId`,
  carries attachment refs forward, honours the target's M-2 ANNOUNCEMENT gate; deleted source rejected.
  **reactions** (new `Reaction` model, unique `(messageId,userId)` + `toggleReaction`): ONE per user per
  message — same emoji toggles OFF, different SWITCHES (single upsert); **free-form emoji, NO vocab enum**
  (D-#101 — the cycle's vocab guardrail; a fixed palette would be a separate coordinator-sequenced vocab
  add); allowed in ANNOUNCEMENT groups, rejected on a deleted message; batched per page next to receipts.
  **edit** (`editMessage`): own-only + membership; prior body → append-only audit (`MESSAGE_EDITED`) FIRST,
  then `editedAt`; empty/deleted rejected; no time limit. **delete** (`deleteMessage`): own-only,
  hide-not-erase — original body + attachment refs → audit (`MESSAGE_DELETED`), row masked behind a Bangla
  removed-placeholder for ALL readers (`listMessages`/`getChatMessage` mask; attachment refs cleared; hard
  delete never occurs; re-delete idempotent). All four reuse `assertChatMember` + `ChatError` + `writeAudit`
  (no twins). Resolvers `forwardMessage`/`editMessage`/`deleteMessage`/`toggleReaction` (chat:write +
  membership); ChatMessage type gains `deletedAt` + `reactions`. **Two new audit kinds in
  `platform/models/Audit.ts` — NOT `shared/vocab.ts`** (parallel HR session owns vocab this cycle; verifier
  untouched). Firewall test extended (corpus ↛ `models/Reaction`). **Gate GREEN (executed):** vocab verifier
  PASS (untouched), shared+server tsc clean, **jest 683/683** (42 suites; 20 new in `chatRich.test.ts`;
  firewall green), app tsc clean + expo web export green. **Not verified live.** **Next = M-4** (attachments:
  photo/PDF/video/voice ≤10 MB, Oracle VM disk storage — confirm storage backend at build, PRD §9) → M-5 app
  screens → M-6 oversight + guardian notices (flips `chat:oversee`) → M-7 staff push. **One vocab flag for
  the coordinator:** if a controlled reaction palette is wanted, sequence it as a vocab add (the M-3 build
  kept reactions free-form to honour the guardrail).
- **Built (Guardian portal app — surface existing reads + polish, FRONTEND ONLY) [branch
  `worktree-guardian-app-riders`, PR #43 — coordinator review applied]:** an app-only pass that renders guardian-readable server data the
  portal already had but never showed, and polishes the existing screens. **NO server / vocab / contract
  change** (parallel session owns those) — uses only guardian queries that already exist. **Gaps closed:**
  (1) **child-info card** on GuardianHome — section name + Quran/Arabic **group memberships** (from
  `myChildren`, fetched by `GuardianChildProvider` but previously unrendered; cross-grade groups D-#48/#56);
  (2) **ChildClassNotesScreen** — lesson history (last 7 days of `childClassNotes`, the date-parameterized
  read GuardianHome only ever used for *today*), a sub-screen of the GuardianHome stack reachable via a
  "আগের পাঠ দেখুন" ghost-button on the class-notes card (new `ChildClassNotes` route in
  GuardianHomeStackParamList); (3) **day-load breakdown** — base + top-up split on GuardianHome (fields
  already in `childDayLoad`). New BN+EN labels (gpChildInfo/gpSection/gpQuranGroup/gpArabicGroup/
  gpDayLoadBase/gpDayLoadTopup/gpPastLessons/gpClassNotesHistory/gpNoNotesDay). Follows the existing guardian
  tab + `GuardianChildProvider`/`ChildSwitcher` pattern + `docs/ui-guidelines.md` tokens; Bangla
  guardian-facing labels. **Surfaces deliberately NOT built (no server read exists — would collide):**
  guardian attendance / leave / results — these stay inert "শীঘ্রই আসছে" placeholders (a guardian
  attendance read does not exist server-side; building it is the parallel session's plane). **Gate GREEN
  (executed):** app `tsc --noEmit` clean + `expo export --platform web` green (698 modules); no-drift
  confirmed — vocab verifier PASS + **jest 643/643** untouched. **Not verified live** (rides DEP-3).
- **Built (Messaging M-2 — auto-provisioned + manual groups + posting policy, server, D-#78/#98/#100)
  [MERGED to main, PR #44]:** second messaging slice per `docs/prd-messaging.md` §5.
  **Vocab (the D-#98 flip):** `chat:manage` pipeline→**build** in `PERMISSION_BUILD_STATUS`; the vocab
  verifier's exact pipeline-set check is now `{chat:oversee}` ONLY (+ a §C.7 build-status assertion).
  `chat:oversee` stays pipeline → flips at M-6. **Server** (`modules/chat/ChatGroupService`):
  idempotent **source-tagged auto-provision** (the D-#49 pattern — the reconcile writes/removes ONLY
  `source:"auto"` rows, NEVER a manual one): SECTION per active Section (class teacher + support +
  routine-slot teachers + active `teaching` ScopeGrant teachers), SUBJECT per ROUTINE_SUBJECTS value
  (its slot teachers; Quran/Arabic flow via SubjectGroup slots, D-#48), SCHOOL singleton (all active
  non-guardian staff). `resyncChatGroups` (chat:manage) full rebuild + best-effort hooks wired into
  `RoutineSlotService` (slot create/delete) and `ClassTeacherService` (class-teacher/support change) —
  awaited best-effort, never block the host mutation (the N-1 emitter posture). **Manual CUSTOM groups**
  (`createGroupConversation`/`addConversationMember`/`removeConversationMember`/`archiveConversation`) +
  `setPostingPolicy`, all gated `chat:manage` (Principal/Office; teachers cannot create groups — DIRECT
  stays open). **ANNOUNCEMENT enforcement** wired into `ChatService.sendMessage` (non-manager post blocked
  in Bangla; OPEN/DIRECT unrestricted; reactions are M-3). Audit kinds CHAT_GROUP_CREATED /
  CHAT_MEMBERSHIP_CHANGED. Firewall test covers the new file both ways (corpus⇄chat). **Gate GREEN
  (executed):** vocab verifier PASS, shared+server tsc clean, **jest 663/663** (41 suites; chatGroups 19
  new; firewall green), app tsc clean + expo web export green. **Not verified live.** **Next = M-3**
  (reply/forward/reactions/edit/delete) → M-4 attachments → M-5 app screens →
  M-6 oversight + guardian notices (flips `chat:oversee`) → M-7 staff push.
- **Built (Notifications N-2+N-3+N-4 — scheduler + app inbox + Expo push, D-#73/#74/#75 + build
  reconciliations D-#99) [branch `worktree-notifications-n2-n4`, PR #42 — coordinator review applied]: the notifications module
  (N-1..N-4) is COMPLETE server+app.** **N-2:** the app's FIRST internal scheduler — a 60s in-process
  ticker (`notifications/SchedulerService`, started in server `start()`; single-instance, never under
  jest) — school-day aware (`resolveDayType`; OFF/HOLIDAY silent, Saturday = quran-track bell only),
  30-min stale-skip, restart-safe by dedupeKey + an in-memory once-per-day guard for the dispatcher
  calls. Fires BELL_REMINDER (~5 min before each period end, per active PeriodGrid audience → bell-duty
  admin; `BellTrigger` gained `track`), the CLASS_NOTE_PROMPT 12/13/14 ladder (one combined row per
  teacher, recomputed per rung via the new all-teachers `unwrittenClassNoteSlots` — `myClassNotePrompts`
  now delegates to it) + CLASS_NOTE_ESCALATION (15:00 → all OFFICE, 16:00 → all PRINCIPAL, combined
  teacher+group+period list), the attendance tiers by **CALLING AT-4's `dispatchAttendanceReminders`**
  (12:10/12:45/14:00 — the merged conditional engine SUPERSEDES the PRD's interim-unconditional 12:00
  sweep, the upgrade D-#74 anticipated) and the library sweep by **CALLING `dispatchLibraryReminders`**
  hourly 09–16 (D-#96 — ONE dispatch truth, nothing re-implemented). `/triggers/*` endpoints remain a
  redundant ops path; `server/README.md` ops note updated (external cron now optional). **D-#99:** AT-4's
  delivery moved OFF direct Expo sends ONTO the D-#72 emit() seam — ATTENDANCE_REMINDER inbox rows per
  recipient, push riding the channel (no double transport; ledger + audit kept; summary
  `deviceCount`→`recipientCount`). **N-3:** 🔔 + unread badge in EVERY stack header (staff and guardian;
  shared 60s poll via `NotificationContext`) → root-level `NotificationCenterScreen` modal
  (newest-first/unread-first, Bangla title/body + kind chip, markRead-on-tap + per-kind deep links in
  `lib/notificationNav.ts`, mark-all-read; badge snaps via context refresh). **N-4:** Expo push channel
  (`notifications/pushChannel`) registered behind emit() at server start — rides AT-4's `PushDevice` +
  platform `sendExpoPush`, dead tokens pruned; **D-#75's DeviceToken reconciled ONTO PushDevice** (optional
  guardian owner, exactly-one invariant, owner derived from auth role in `registerPushDevice` — no twin
  registry); app adds a foreground display handler, logout now unregisters the device token, push-tap
  opens the NotificationCenter (the row inside carries the same deep-link). NotificationRefs extended
  (audienceKey/periodNumber/tier/hour + loanId/rung now GraphQL-exposed). **NO vocab/contract change**
  (the scheduler kinds existed since N-1; verifier untouched). **Gate GREEN (executed):** shared build +
  shared/server tsc clean, vocab verifier PASS, **jest 616/616** (39 suites; 29 new — notificationsScheduler
  16 + pushChannel 8 + attendanceReminder reworked to the seam; firewall green), app tsc clean + expo web
  export green. **Not verified live** (rides DEP-3). NB for the live deploy: the in-process ticker fires in
  the SERVER's local timezone — the Oracle VM must run Asia/Dhaka (or systemd `Environment=TZ=Asia/Dhaka`)
  for the 12:00-ladder times to mean school time. **Coordinator review applied:** owner-scoped
  `unregisterPushDevice` (closed a cross-user push-silencing IDOR) + an Asia/Dhaka startup-TZ warning in
  the ticker; gate re-run **jest 619/619** (+3 owner-scope tests). Two review claims REFUTED (no change).
- **Built (Messaging M-1 — core chat models + 1:1 + read receipts, server, D-#76/#77) [MERGED to main,
  PR #41]:** first messaging slice per `docs/prd-messaging.md` §5 (+ coordinator review: batched
  receipts/members, bounded markSeen, parallel member gate). **Vocab
  (app-native, NO wire sync):** `chat:read`/`chat:write` (P/T/O, build) + `chat:manage` (P/O,
  **pipeline → flips at M-2**) + `chat:oversee` (PRINCIPAL only, **pipeline → flips at M-6**, D-#77) +
  CONVERSATION_KINDS/POSTING_POLICIES/ATTACHMENT_KINDS/NOTICE_SCOPES + BN/EN labels; verifier §C.7
  added (15 checks), OFFICE exact-list + pipeline-set checks updated. **Server** (`modules/chat/`):
  `Conversation` (sparse-unique `directKey` = sorted pair key — ONE DIRECT thread per pair, race-safe
  like dedupeKey) · `ConversationMember` (source `auto|manual`, the D-#49 pattern — M-2's sync will
  touch only auto rows) · `ChatMessage` (forward-compatible replyToId/forwardOfId/attachmentIds/
  editedAt/deletedAt fields; their mutations land M-3/M-4) · `MessageReceipt` (one per reader×message,
  first-seen wins via $setOnInsert). `ChatService`: openDirectConversation (idempotent, staff-only —
  guardians rejected, D-#76; self-DM rejected) / sendMessage (same-conversation replyTo validated,
  lastMessageAt stamped) / listMessages (newest-first, _id-cursor pagination) / myConversations /
  markConversationSeen (sweeps only OTHERS' messages); EVERY read/write through `assertChatMember`
  (Bangla deny, no existence leak). Resolvers: myConversations/conversation/messages (chat:read) +
  openDirectConversation/sendMessage/markSeen (chat:write); per-message seenBy list + seenCount.
  Firewall test extended both ways (corpus ⇄ chat). **Gate GREEN (executed):** vocab verifier PASS,
  shared+server tsc clean, **jest 610/610** (21 chat + 2 firewall new; 38 suites), app tsc clean +
  expo web export green (693 modules). **Not verified live.** **Next = M-2** (auto-provisioned
  SECTION/SUBJECT/SCHOOL groups + manual CUSTOM groups + posting policy; flip `chat:manage`
  pipeline→build + verifier there), then M-3 rich messaging → M-4 attachments → M-5 app screens →
  M-6 oversight + guardian notices (flips `chat:oversee`) → M-7 staff push.
- **Built (Library module — catalog + circulation + reservations + overdue chasing, LB-1..LB-5,
  D-#81–#84 + build rulings D-#96/#97) [MERGED to main, PR #40, 887468c]:** the full prd-library contract,
  server+app. **LB-1:** app-native vocab (`library:read` P/T/O + `library:manage` P/O; BORROWER_TYPES/
  COPY_STATUSES/LOAN_STATUSES/RESERVATION_STATUSES/BOOK_LANGUAGES + BN/EN; verifier §C.6, no wire sync);
  BookTitle/BookCopy (unique accessionNo)/LibraryPolicy/LibrarianAssignment (append-only duty log);
  `assertIsLibrarian` (library:manage OR latest duty row = assign — D-#42/#64 pattern, NO new role);
  catalog resolvers + availability computed from copies. **Policy = admin data with READ-TIME defaults**
  (7/2/1/3 student · 14/4/2/3 staff · 7/2/1/3 guardian · hold 3) — no seed write against the shared live
  DB (D-#97); Principal edits in-app (LibraryAdmin). **LB-2:** issue (by accession; ON_HOLD only to its
  READY borrower) / return / renew (blocked at maxRenewals OR any QUEUED/READY reservation) / markLost
  (replacement note only — NO money fields anywhere, D-#27); per-type maxConcurrent + loanDays from
  policy; desk mutations gated assertIsLibrarian. **LB-3:** title-level FIFO reservations; return → copy
  ON_HOLD + head READY with holdDays window; **lazy request-time expiry is the ONE truth**
  (`expireLapsedHolds`, D-#21/#83 — every touch runs it; a future N-2 sweep calls the same fn); staff
  self-reserve + desk on-behalf; duplicate/holding-borrower rejected. **LB-4:** new 📖 **Library tab**
  (`library:read`; 📚 was taken by Content) — LibraryHome (search/browse + my loans/reservations +
  librarian chase list; desk/manage entries gated by amILibrarian / library:manage), TitleDetail (copies
  + self-reserve + FIFO queue), LibraryDesk (borrower picker via new librarian-gated
  `libraryBorrowerSearch` + issue/return/renew/lost + desk reservations), CatalogManage, LibraryAdmin
  (policy editor + librarian assign/revoke + duty history). **LB-5:** chase list (`libraryChaseList` —
  overdue grouped by borrower type, family/guardian phone + ADR-003 wa.me Bangla links, staff chased
  in-app, works with zero notification infra) + NOTIFICATION_KINDS += LIBRARY_DUE_SOON/LIBRARY_OVERDUE
  riding the **merged D-#72 emit() seam** (due-tomorrow once; overdue on school-day rungs 1/4/7… via
  `resolveDayType`; STUDENT borrower → login-enabled linked guardians; contact-only guardians stay
  wa.me-only) dispatched by **POST /triggers/library-reminder** (AT-4 external-scheduler pattern, same
  shared secret, idempotent — D-#96; N-2's ticker should call the same `dispatchLibraryReminders`) +
  guardian rider `childLibraryLoans` (assertGuardianOfStudent, narrow read-only type; loans card on
  GuardianHome — no guardian mutations). Audit: 8 new BOOK_*/RESERVATION_*/LIBRARIAN_ASSIGNED/
  LIBRARY_CATALOG_CHANGED kinds. Firewall test extended both ways (corpus ⇄ library). **Gate GREEN
  (executed):** vocab verifier PASS, shared+server tsc clean, **jest 532/532** (32 suites; 73 new),
  app tsc clean + expo web export green. **Not verified live.** Open items unchanged from the PRD:
  possible `import-books` ingest if a register spreadsheet exists (Principal to confirm); policy
  figures are working values until the Principal edits them in-app.
- **Built (Slice-4 follow-ups — server lookups + app wiring):** `myScopes` enriched
  (class/section/subject ids + proxy detail), new `users` + `proxyGrants` queries (existing
  `user:manage`, no permission change); SectionPicker my-sections shortcuts, UserList real list,
  ScopeGrant list-driven extend/revoke. `/pdf` CORS found already closed (GP-A [4556696]).
  Gate green: shared+server tsc, jest 430/430 (firewall green), app tsc + web export. Details in
  "Slice 4 follow-ups" below. **Not verified live.** [branch `worktree-slice4-followups`]
- **Built (Notifications N-1 — model + emit() seam + own-row inbox + event emitters, D-#72) [branch
  `worktree-notifications-n1`, PR open]:** first notifications slice, server-side. New
  `server/src/modules/notifications/` — `Notification` model (per-recipient, exactly ONE of User/Guardian,
  unique `dedupeKey`, **append + markRead only**, identity-plane) + **`NotificationService.emit()`** — the
  single seam every emitter calls (idempotent by dedupeKey: a duplicate emit is a silent no-op, incl. the
  concurrent unique-index race; a **channel registry fans out BEHIND the seam** — the inbox row is written
  always and is the source of truth; channels run best-effort on NEW rows only and never block the row; none
  registered in N-1, Expo push registers in N-4) + own-row inbox API `myNotifications`/
  `myUnreadNotificationCount`/`markNotificationRead`/`markAllNotificationsRead` (**NO new permissions** —
  recipient derived from the auth token; a GUARDIAN token reads guardian rows, any staff token its user rows).
  **Four event emitters wired (one best-effort call each — a notification failure never blocks the host
  mutation):** class-note publish → **login-enabled** guardians of the Section/SubjectGroup (R5.4 partial;
  contact-only guardians get nothing, the recorded D-#31/D-#72 limitation; dedupe `CNPUB:slot:date:guardian`),
  HW chase reaching ≥3 → the section's class teacher (§7.2/D-#34/D-#45; dedupe `HWPC:item:student`; unassigned
  section skipped), review-round assigned → the reviewer (`REV:assignment`), cover assigned → the covering
  teacher (`COV:substitution`; cancel emits nothing). New app-native `NOTIFICATION_KINDS` (8 kinds + BN/EN
  labels) — **vocab.ts additive only, no wire-contract sync**; verifier §C.5 added (labels total + exact kind
  list + no notification:* permission). Firewall test extended both ways (corpus ↛ notifications,
  notifications ↛ corpus). **Gate GREEN:** vocab verifier PASS, shared build + shared/server tsc clean,
  **jest 452/452** (29 new; firewall green). **Not verified live.** **N-2/N-3/N-4 now BUILT — see the
  "Built (Notifications N-2+N-3+N-4 …)" bullet at the top; the module is complete.**
- **Planned (Deployment — go-live + dev pipeline, D-#90–#93):** build contract
  `docs/deployment.md`. Slices DEP-1 (Oracle VM + DNS) → DEP-2 (prod install,
  systemd + Caddy/HTTPS, Atlas IP allow-list; closes the /pdf CORS follow-up via
  same-origin) → DEP-3 (live golden-path verification — clears the standing
  'not verified live' debt) → DEP-4 (nightly Atlas→Drive backup + executed
  restore drill, ADR-011/016) → DEP-5 (`dev` branch + dev environment + separate
  seeded dev DB; feature code now pushes to `dev`, docs-only commits stay on
  `main`) → DEP-6 (GitHub Actions: CI gate + auto-deploy dev/prod). Plan/docs
  only — nothing executed. Next = execute DEP-1 per docs/deployment.md §4,
  slice order. (Handoff proposed D-#59–#62 — renumbered, taken through D-#89.
  The D-#91 "push to dev" handoff rule takes effect when DEP-5 executes.)
- **Built (Assignment Tracker AS-T1..AS-T5 — server + app, D-#85–#89 + D-#94) [MERGED to
  main, PR #39, 5dd55b3]:** the weekly AS-… channel replacing the Google Sheet
  tracker is feature-complete server+app, per `docs/prd-tracker-assignment.md`. **Server**
  (`trackers` module): `AssignmentSchedule` (per-year term anchor + admin-configurable
  Thu-deliver/Sun-due cadence + 4-week rotation; anchors Sun–Thu only) · `AssignmentItem`
  (one per realized week×section×subject, §4 dates resolved SERVER-side, unique per cell) ·
  `AssignmentStudentRecord` (the shared D-#37 lifecycle engine's second consumer; marks ≤
  teacher-set totalMarks + feedback, D-#87; non-unique for resubmissions) ·
  `AssignmentFollowUp` (append-only ladder log; the only post-append mutation is the
  sent-status/outcome stamp) · `AssignmentSequence` (`AS-C{class}-{SUBJ}-{nnnn}`, D-#34).
  Pure cadence calendar (`assignmentCalendar.ts`): 52-week grid computed on read; delivery
  rolls to the PREVIOUS open day, due to the NEXT open day, vacation weeks suspended +
  excluded from rate denominators — single D-#50 calendar source. Slices: AS-T1 schedule
  CRUD + expected-grid + `myAssignmentPrepPrompts` (D-#89 Sun/Mon); AS-T2 deliver/
  redeliver/collect/chase-sweep with ALL counts derived (never typed); AS-T3 checking +
  teacher-explicit resubmission (NO auto-spawn on any result); AS-T4 Office chase list +
  escalation ladder (in-app ×2 → WhatsApp w/ generated §7 Bangla message + wa.me, manual
  send, outcome logged); AS-T5 `assignmentSummary` (delivery rate vs scheduled excl.
  suspended weeks per teacher/class/week, submission rate, D-#34 thresholds 2/3, checking
  latency, open resubs) + `childAssignments` guardian read (assertGuardianOfStudent).
  **RBAC composed from EXISTING permissions — vocab frozen this session (D-#94):** schedule
  CRUD = `roster:manage`; Office follow-up surface = `message:dispatch` + explicit
  Principal/Office check (D-#88 — teachers never chase); teacher flows = `tracker:write` +
  assertCanWrite with the record's/item's real section verified server-side; guardian =
  `guardian:read_child`. **Guardian in-app chase steps ride the D-#72 emit() seam but are
  KIND-GATED:** `ASSIGNMENT_CHASE` is not yet in NOTIFICATION_KINDS (another in-flight
  session owns vocab.ts) — the emitter is a recorded no-op (the ladder step logs SKIPPED
  and Office proceeds to WhatsApp, the PRD's delivery-reality posture); activation = add
  the kind + BN/EN labels + extend verifier §C.5 (it currently asserts EXACTLY 8 kinds).
  **App:** new 📋 Assignment tab (tracker:read OR roster:manage so Office sees it) —
  AssignmentHome (prep prompts + week-navigable expected grid + deliver/collect/check
  entries) · AssignmentSchedule (admin rotation editor — the sheet's Schedule tab is
  entered here, xlsx never imported) · DeliverAssignment (tap-absent roster) ·
  CollectAssignment (submitted toggles + redeliver) · AssignmentChecking (result/marks/
  feedback + return/resubmission) · AssignmentChase (ladder + wa.me + outcome stamp) ·
  AssignmentRollups; guardians get a 4th tab অ্যাসাইনমেন্ট (ChildAssignmentsScreen — the
  GP rider the PRD pre-flight allows). Firewall test extended (corpus ↛ assignment models).
  **Gate GREEN (executed):** vocab verifier PASS, shared+server tsc clean, **jest 514/514**
  (55 new across 5 assignment suites; firewall green), app tsc clean + web export green
  (688 modules). **Not verified live.** Remaining: enter the live rotation via the editor;
  register `ASSIGNMENT_CHASE` once vocab unfreezes; live golden path (DEP-3 posture).
- **Planned (Library module — catalog + circulation + reservations, D-#81–#84):** build contract
  `docs/prd-library.md` authored — pulls the LIBRARY half of the deferred "loanable-resource" ops
  module forward (asset register stays deferred; roadmap patched). Per-copy catalog (unique accession
  numbers) + admin-set per-borrower-type `LibraryPolicy` (loanDays/maxConcurrent/maxRenewals/holdDays;
  seed working values 7/2/1 student · 14/4/2 staff · 7/2/1 guardian · 3-day hold). Borrowers =
  **students, staff AND guardians** — all desk-mediated (students have no logins; guardian portal is
  read-only, D-#68); staff additionally browse + self-reserve in-app. **NO fines ever** — overdue =
  reminders + chase list; lost/damaged = replacement recorded, no money in-app (D-#27 posture).
  Title-level FIFO **reservations** (renewal blocked while queued; hold + pickup window on return;
  **lazy request-time expiry**, D-#21 posture — no scheduler dependency). Desk gated by
  `assertIsLibrarian` — `library:manage` (Principal/Office) OR a TEACHER via append-only
  `LibrarianAssignment` (D-#42/#64 duty pattern, no new role). LB-5 overdue emitters ride the D-#72
  `emit()` seam (needs N-1; the chase-list report + ADR-003 wa.me links stand alone); guardian portal
  gets a read-only **child-loans card** (GP-2 rider, `assertGuardianOfStudent`). App-native vocab only
  (`library:read`/`library:manage` + BORROWER_TYPES/COPY_STATUSES/LOAN_STATUSES/RESERVATION_STATUSES/
  BOOK_LANGUAGES + BN) — no wire sync; verifier extends at build time. Open items: possible
  `import-books` ingest if a register spreadsheet exists (Principal to confirm); seed figures are
  working values. **BUILT 2026-06-13 (LB-1..LB-5 complete, server+app) — see the "Built (Library
  module …)" bullet above.** (Handoff proposed D-#80–#83 — renumbered; D-#80 is taken by roll-number=ID.)
- **Built (Attendance AT-4 — reminder + escalation engine, D-#65):** server + app on branch
  `feat/attendance-at4` (PR open). The attendance module is now AT-1..AT-5 complete (general Section flow).
  New `PushDevice` (Expo tokens per User, reusable) + `AttendanceReminderDispatch` (idempotency ledger,
  one row per date×tier×section) models; `ExpoPush` transport (plain-fetch to exp.host, best-effort, dead-
  token pruning — no SDK dep) in platform; `AttendanceReminderService.dispatchAttendanceReminders(tier,
  dateKey?)`: **AT4.1** FULL-day gate (single calendar `resolveDayType`), **AT4.2** reuses `unmarkedSections`,
  **AT4.3** T1210→marker + class teacher, **AT4.4** T1245→all Office, **AT4.5** T1400→all Principal,
  **AT4.6** idempotent (a 2nd call for the same date/tier re-sends nothing), each section dispatch audited
  `ATTENDANCE_REMINDER_SENT`. **Endpoint** `POST /triggers/attendance-reminder {tier}` — Express beside /pdf,
  **shared-secret header** `x-trigger-secret` (env `ATTENDANCE_TRIGGER_SECRET`, **fail-closed** if unset),
  driven by an **external scheduler** (no in-process cron) — cron lines (12:10/12:45/14:00 Asia/Dhaka) in
  `server/README.md`. Mutations `registerPushDevice`/`unregisterPushDevice` (own-row, no new perm); app
  registers its Expo token on auth (web/sim/denied → graceful no-op via `expo-notifications`). **AT4.7
  Office guardian-chase** = manual wa.me button per absent-no-application row (`guardianChaseLink`,
  attendance:manage; teachers NEVER chase, O3; WhatsApp stays manual, D-#65). **No vocab/contract change**
  (tiers + audit kind already existed). **Gate GREEN:** vocab verifier PASS, shared+server tsc clean,
  **jest 423/423** (9 new in `attendanceReminder.test.ts`, firewall green); app tsc clean + web export green.
  **Not verified live.** Out of scope (unchanged): SubjectGroup/Quran attendance, staff-leave entry,
  automatic WhatsApp, per-period, leave approval. **O1 resolved: roll number = the ID (D-#80)** — the roster
  has no separate roll, so no import script; absentee reports surface `rollNumber ?? schoolId` (Roll column
  shows the ID); `Student.rollNumber` kept unset/forward-safe.
- **Planned (Messaging module — staff chat + guardian notices + push transport, D-#76/#77/#78/#79):** build
  contract `docs/prd-messaging.md` authored — pulls the deferred messaging pipeline forward (this is the
  transport D-#52/R5.4–R5.5 await). Staff-only chat (guardians are notice recipients, NOT participants):
  1:1 + auto-provisioned groups (per-Section staff / per-ROUTINE_SUBJECT teacher set / school-wide,
  idempotent source-tagged sync per D-#49 pattern) + Principal/Office-only manual ad-hoc groups; reply/
  forward/reactions/edit/delete (delete hides for all, original audit-retained, ADR-008); attachments
  photo/PDF/video/voice ≤10 MB (storage backend = Oracle VM disk, proposed — PRD §9); read receipts;
  Principal read-oversight on ALL chats incl. 1:1 (each open itself audited); school-wide switchable
  announcement-only. Guardian notices NOW via composer + ADR-003 wa.me fan-out (no guardian login;
  SECTION notices gate on the class teacher — lands the D-#45 parent-comms duty); guardian push stays
  portal-deferred; wa.me links permanent fallback (ADR-003 reaffirmed). App-native vocab only (`chat:*`
  perms + CONVERSATION_KINDS/POSTING_POLICIES/ATTACHMENT_KINDS/NOTICE_SCOPES + BN) — no wire sync.
  **M-1 now BUILT (see the "Built (Messaging M-1 …)" bullet above); next = M-2 per
  docs/prd-messaging.md §5, slice order.** (Handoff proposed D-#59–#62 — renumbered, taken through D-#75.)
- **Planned (Notifications phase 1 — in-app inbox + scheduler + push, D-#72/#73/#74/#75):** build contract
  `docs/prd-notifications.md` authored — **N-1 now BUILT (see bullet above); N-2..N-4 remain**. Delivers the D-#52 trigger schedule:
  `Notification` model + single `NotificationService.emit()` seam (idempotent by dedupeKey, channels fan
  out behind it) + own-row inbox queries (no new permissions); event emitters (class-note publish → login
  guardians [R5.4 partial — 129 contact-only guardians unreachable until the WA/SMS phase], HW §7.2
  chase≥3 → class teacher, review assigned, cover assigned); **first internal scheduler** (D-#73 — refines
  the D-#20/#21 no-cron posture; 60s in-process ticker, school-day aware, stale-skip, single-instance)
  firing the **Principal's D-#74 timing rules** (refine D-#52 b/c): bell ~5 min before each period end;
  attendance once daily 12:00 to every class teacher (interim unconditional — conditional check ships with
  the attendance module); class-note ladder 12:00/13:00/14:00 → teacher, escalation 15:00 → Office, 16:00
  → Principal; 🔔 badge + NotificationCenter; **Expo push** (D-#75 — second live external dependency after
  D-#24; native only, web = inbox; no quiet hours; push never blocks the inbox row). App-native
  `NOTIFICATION_KINDS` vocab only — no wire-contract sync; vocab verifier extends at build time.
  WhatsApp/SMS stay deferred (roadmap patched). **N-1..N-4 ALL BUILT — the module is complete (see the
  top bullet); remaining = live verification (DEP-3).** (Handoff proposed D-#59–#62 — renumbered: those are
  taken by credential provisioning / UI / section merge, and D-#71 is held by the in-flight guardian-portal
  build.)
- **Planned (Guardian portal v1 — D-#68/#69/#70):** `docs/prd-guardian-portal.md` adopted —
  activates the pipeline-gated `guardian:read_child` (vocab status flip only in GP-1, verifier must
  stay green; no wire/schema/harness sync; no new permission). **GP-1** (server):
  `assertGuardianOfStudent` link-scoped authz helper + guardian queries `myChildren` / `childRoutine` /
  `childClassNotes` / `childHomework` (FULL lifecycle incl. chase/resubmission/results + day-load vs 240).
  **Guardian routine shows subject + period + time ONLY — no teacher name, no room, no cover data
  (D-#69, closes R4.5's deferred guardian-read as won't-show); separate narrow guardian slot type.**
  **GP-A:** first file capability — teacher-attached optional question file (per HomeworkItem) +
  checked-answer file (per HomeworkStudentRecord), 5 MB jpeg/png/pdf, Express multipart beside /pdf;
  **storage RULED = the school's Google Drive as the LIVE store (D-#70) — the app's SECOND live external
  dependency (after D-#24); server always in the middle, no Drive id/URL ever reaches a client;
  credential in server secrets only (public repo), setup gates GP-A LIVE verification (jest mocks
  Drive)**; guardian download gated by the link helper; audit `HW_FILE_ATTACHED`; guardians never upload.
  **GP-2** (app, AFTER UI-1; file display needs GP-A): Guardian tab set + child switcher (J5.3) + আজ home
  + homework (with প্রশ্নপত্র/উত্তরপত্র viewers) + weekly routine + inert "শীঘ্রই আসছে" placeholders for
  attendance/fees/notices/leave/push (real surfaces ride their modules, GP-3+; push stays on the deferred
  messaging pipeline, D-#52). How-to-guide docs out of scope (no guide doc_type in the LOCKED contract).
  Identity-plane only; J5.6 + a new guardian-firewall assertion must stay green. Docs-only this session —
  no code change. **Next = build GP-1 per docs/prd-guardian-portal.md §6 (server only); then GP-A; UI-1;
  GP-2 after UI-1. Drive credential setup (Principal/Office + ops note) runs in parallel.**
- **Built (Attendance AT-1..AT-3 + AT-5 — server + app, D-#63–#67) [branch `feat/attendance`]:** the
  contract below is now BUILT except AT-4. **Server:** new `modules/attendance/` — `TeacherAttendanceDay`
  (Excel snapshot import: legend ✔/𝓛/✘/℞, both punches, **date read from the sheet** w/ year inference;
  **name reconciliation** vs active StaffProfiles + remembered `StaffNameAlias`; preview→commit, no silent
  drop — unmatched names must be mapped or explicitly ignored; re-upload replaces the date; ✘→ABSENT until a
  staff-leave source exists), `SectionAttendanceAssignment` (per-day/range marker override, newest-covering
  wins, revoke keeps history), `StudentAttendanceDay` (once-daily absent-only per section, **CT-2 marker
  gate** = override else classTeacherId, Principal/Office do NOT mark; FULL-day calendar gate via D-#50
  `resolveDayType`; same-day editable, past = admin `amendStudentAttendance`, O2), `StudentLeaveApplication`
  (recorded-only, D-#66). Reports (§8): `absenteeReport` (class→section, names + **roll + ID**, leave-covered
  flag), `sectionAbsentees` (class-teacher own), `studentAttendanceHistory` (% over range),
  `absentNoApplication` (Office chase list), `unmarkedSections` (AT4.2 detection), `teacherAttendanceSummary`
  + daily roster. Vocab: perms `attendance:mark` (TEACHER) / `attendance:manage` (Principal/Office) +
  `TEACHER_ATTENDANCE_STATUSES` + `ATTENDANCE_REMINDER_TIERS` (verifier C.4 added, OFFICE exact-list updated);
  `Student.rollNumber` + `setStudentRollNumber`; 5 audit kinds; `exceljs` dep. **App:** new 🙋 **Attendance
  tab** — AttendanceHome (teacher worklist `myMarkingSections` + admin entries), MarkAttendance (tap-absent
  capture), TeacherAttendanceImport (pick .xlsx → preview → map/ignore → commit + past uploads),
  AttendanceReport (absentee + unmarked + absent-no-application w/ inline leave recording + staff summary),
  AssignMarker (assign/revoke overrides). **Gate GREEN:** vocab verifier PASS, shared+server tsc clean,
  **jest 363/363** (43 new across `attendanceImport.test.ts`/`attendance.test.ts`; firewall green); app tsc
  clean + web export green. **Executed proof:** the real `Employee Attendance Report….xlsx` parses to
  2026-06-11, 23 rows (17✔/3𝓛/3✘, double punches captured). **Not verified live; NOT merged — built in a
  separate worktree on `feat/attendance` (GP-1 was in flight on the shared tree). Remaining: AT-4
  reminder/escalation engine (external scheduler + expo-notifications + `PushDevice` — needs infra, §9);
  roll numbers not yet loaded onto the live roster (`setStudentRollNumber` exists); SubjectGroup/Quran
  attendance fast-follow (§7, model-shaped).**
- **Built (Guardian portal v1 — GP-1 + GP-A + GP-2, D-#68/#69/#70/#71): the portal is feature-complete
  server+app on branch `feat/guardian-portal`** [abe7ed3, 4556696, 56624d9].
  **GP-1 (server):** `guardian:read_child` flipped pipeline→build (verifier check updated, green);
  `assertGuardianOfStudent` link-scoped gate (Bangla deny; new additive `GuardianLink.active`, missing =
  active for the 194 live links); queries `myChildren`/`childRoutine`/`childClassNotes`/`childHomework`
  (FULL lifecycle: stage timeline, chase, resubmission chain, result, top-up)/`childDayLoad` (vs 240).
  **D-#69 enforced structurally:** narrow `GuardianSlot` type (subject+period+time only); slots come from a
  new substitution-free `slotsForDate` (routineForDate keeps the cover overlay for staff); source-guard +
  guardian-firewall tests assert no teacher/room/cover field and no corpus⇄guardian import path.
  **GP-A (files):** `StoredFile` + `DriveStore` (OAuth refresh token on the school account — **D-#71**,
  the D-#70 delegated mechanism choice; plain fetch, no googleapis dep); `POST /files/hw` (staff,
  tracker:write, jpeg/png/pdf ≤5 MB, Bangla rejections, Drive-fail ⇒ 503 + nothing persisted) +
  `GET /files/:id` (authz FIRST: staff read-scope / guardian link gate; server streams — `driveFileId`
  never reaches any client, source-guarded); attach mutations + audit `HW_FILE_ATTACHED`;
  `questionFileId`/`answerFileId` on items/records (staff + guardian GraphQL); teacher attach hooks in
  DeclareHomework + CheckingQueue; ops setup note `server/README.md` + `.env.example` GOOGLE_* keys.
  **GP-2 (app):** GUARDIAN sees ONLY the guardian tabs (আজ / বাড়ির কাজ / রুটিন — staff tabs permission-gated
  off); `GuardianChildProvider` + `ChildSwitcher` (J5.3); GuardianHome (day-type routine w/ holiday label,
  class notes, open homework chips, day-load vs 240, inert শীঘ্রই-আসছে placeholder cards — GP-J11, no dead
  queries); ChildHomework (date-range, day-grouped, full lifecycle + প্রশ্নপত্র/উত্তরপত্র viewers via
  /files/:id, web); ChildRoutine weekly grid. **Login fixed for guardians:** app falls back to
  `guardianLogin` (phone/email identifier) and `me` now resolves a Guardian's own account (it returned
  null for guardian JWTs — guardians could not complete app login before).
  **Gate GREEN:** vocab verifier PASS; shared+server tsc clean; **jest 371/371** (26 GP-1 + 25 GP-A new;
  J5.6 + new guardian-firewall green); app tsc clean + web bundle green.
  **MERGED to main** (PR #31; integrated with PR #30 attendance — vocab/verifier/ledger conflicts resolved so
  both features survive; integrated gate green: **jest 414/414**, app tsc + web export green).
  **LIVE-VERIFIED against Atlas (2026-06-12)** with the real provisioned family login (Fardhousi Jahan Shaly,
  +8801409514518, password reset via `verify-provisioning.ts --provision` to obtain a known credential):
  `guardianLogin` → role GUARDIAN ✓; `myChildren` → both children (Barakah Binte Habib/কেজি, Yousuf Bin
  Habib/তৃতীয়) ✓; `childRoutine` day-type aware (Fri=OFF/ছুটি empty; Sun–Thu=FULL — slots empty as no
  RoutineSlots are authored for the live sections yet, a data state) ✓; **D-#69 proven structurally** — the
  schema rejects `GuardianSlot.teacherId` (no teacher/room field exists) ✓; `childHomework`/`childClassNotes`
  empty (none authored), `childDayLoad` → 0/240 ✓; an **unlinked studentId → ForbiddenError** (Bangla
  "এই শিক্ষার্থীর তথ্য দেখার অনুমতি নেই") ✓. **Frontend-only checks still need a manual browser pass** (guardian
  sees ONLY guardian tabs; child-switcher interaction) — covered by GP-2 tests + app build, no browser this
  session. **GP-A file attach/view still NOT live-verified** — needs the Google Drive credential (D-#70/#71;
  `server/.env` GOOGLE_OAUTH_* absent; setup steps below). GP-3+ riders (attendance/fees/notices/leave/push
  surfaces) land with their modules.
- **Planned (Attendance PRD — D-#63–#67, AT-1..AT-5 now BUILT incl. AT-4 above):** finalized the build contract for **teacher +
  student attendance** in `docs/prd-attendance.md`. Teacher = daily **Excel snapshot** of the biometric
  "Employee Attendance Report" (legend ✔=present / 𝓛=late / ✘=leave-or-absent / ℞=ignored; **name-matched**
  since the export drops the ID column → `StaffNameAlias` remembers the mapping; both punch times; date from
  sheet; re-upload overwrites). Student = **in-app, once-daily, absent-only** (assigned marker taps
  absentees, rest present) → app **produces the absentee report** (roll + ID; residential dropped). Marking
  gated by `assertIsClassTeacher` (**CT-2**) with a per-day/range **marker override** (Principal/Office).
  **Reminder/escalation** via **external scheduler** → idempotent endpoint at **12:10 marker → 12:45 Office
  → 2:00 Principal** on FULL days; **push auto, WhatsApp manual**; **Office** (not teachers) chases guardians.
  Student **leave application = recorded-only** (no approval); "absent & no application" is a report. Adds
  perms `attendance:mark`/`attendance:manage`, `Student.rollNumber`, `expo-notifications` + `PushDevice`.
  Slices **AT-1..AT-5**; SubjectGroup/Quran attendance is a fast-follow. **Next: build AT-1 (teacher import)
  + AT-2 (student capture).**
- **Built (Section merge/split — reversible per-class section config, D-#62):** Principal/Office can combine a
  class's gender-split sections (Boys+Girls) into one combined section so the children sit as a single class,
  and split them back. New `SectionMerge` model + `SectionMergeService` (merge moves students into a combined
  section [code `ALL`] + deactivates sources; split restores the originals exactly and places post-merge
  newcomers by `Student.gender`); resolvers `mergeSections`/`splitSections`/`activeSectionMerges` (roster:manage)
  + `Section.studentCount`; audit `SECTIONS_MERGED`/`SECTIONS_SPLIT`. App: **SectionConfigScreen** (Admin tab,
  year→class list, per-class merge/split + counts). **Gate GREEN:** server tsc + **jest 320/320** (7 new in
  `sectionMerge.test.ts`, firewall green) + vocab verifier; app tsc + web export green. **Not verified live;
  merge moves REAL students — run only via the UI on purpose.** Reverses cleanly via split.
- **Built (UI-1 — adopt UI guidelines v1 in code, D-#61):** the app now renders from the
  `docs/ui-guidelines.md` §3–§6 token system, light **and** dark (follows the OS;
  `userInterfaceStyle:"automatic"`). `app/src/theme` is the ONE code source: `palette.json` (the §3/§4 hex
  tables — also `require`d by `tailwind.config.js`, so NativeWind maps the SAME palette when re-enabled,
  ADR-010/014) + `tokens.ts` (radius 8/12/pill, 4dp spacing, §5 type scale) + hooks
  `useColors`/`makeStyles`/`useNavigationTheme` — components read tokens only, never branch on scheme.
  **Noto Sans Bengali 400/500/700 loads at app start** (expo-font, splash held until loaded; only the 3
  faces bundled) and applies app-wide via the type scale — the text primitives resolve the screens'
  existing `fontWeight` idiom to the matching face (no Android faux-bold over a real bold face).
  Primitives swept to spec: buttons 48dp (disabled = surfaceAlt/textDisabled, pressed = primaryPressed),
  chips 36dp + hit-slop to 48dp, badges/notices/banners = `…Container`/`on…Container` pairs (+ new
  info/gold tones), inputs ≥48dp label-above + new error/helper line, `Screen` centers at 720dp max on
  web, tappable cards ≥56dp; Markdown, stack headers + tab bar tokenized; off-scale margins rounded to the
  4dp scale. Color was already centralized, so screens needed only 3 small edits (Login + 2 homework).
  **Gate GREEN: app `tsc --noEmit` clean + web bundle green (494 modules).** **NOT done: the §0 manual
  checklist pass (Login/RoutineHome/HomeworkHome/Roster, both themes) on a device/browser — no browser in
  this session**; icon-set migration + in-app theme toggle stay out of scope per §12.
- **Built (Credential provisioning — phone logins for guardians + teachers, share via WhatsApp, D-#59/#60):**
  server + app. Principal/Office now generate logins and hand them out over WhatsApp. **Guardians:** ONE shared
  login per family keyed by `Student.phone` — auto-links every sibling on that phone, both parents use it
  (D-#59); idempotent re-provision (resets password, links new siblings, no dup links). **Staff:** teachers had
  **no `User` accounts** (StaffProfile data only) — `provisionStaffLogin` mints a **phone-login** `User`, role
  mapped from HR category (teacher/assistant_hifz→TEACHER, office_accounts→OFFICE; support/phoneless rejected,
  D-#25/#60). Model: `User.email`→optional sparse-unique + new sparse-unique `User.phone`; `staffLogin` accepts
  email **or** phone. New `credentials.ts` (ambiguity-free `generatePassword` + Bangla `buildCredentialShareLink`
  wa.me builder, ADR-003) + `ProvisioningService`; resolvers `guardian/staffCredentialCandidates` + `provision/
  reset` mutations (gated `guardian:link` / `user:manage`, **no new permission**); audit kind
  `CREDENTIAL_PROVISIONED`. App: Admin **Guardian logins** + **Teacher/staff logins** screens (generate/reset →
  password shown **once** + "Send on WhatsApp" + copy); login screen takes email-or-phone. **Gate GREEN:** server
  tsc + **jest 313/313** (24 new in `provisioning.test.ts`, firewall green), vocab verifier PASS; **app tsc clean
  + web bundle green** (495 modules). Committed [fc755c6]. **MIGRATION APPLIED to live Atlas** (`migrate-user-
  login-index.ts --commit`): the non-sparse `users.email_1` index was dropped + recreated **sparse** (phone-only
  staff can now be inserted). **VERIFIED LIVE** (`verify-provisioning.ts`): real roster groups into **60 guardian
  families** by phone (1 five-sibling family, 23 two-child; no phone groups ≥6 → no shared/default-number false
  joins); **23 staff all provisionable** (21 TEACHER / 2 OFFICE). End-to-end provisioned **1 guardian** (2-child
  family → password authenticates via `guardianLogin` ✓) + **1 teacher** (phone login authenticates via
  `staffLogin` ✓) — **two real active logins now exist on Atlas** (Fardhousi Jahan Shaly +8801409514518; Afia
  Loskor +8801706050753) — the Principal should reset/share their passwords (printed once at provision time).
- **Built (Class-teacher CT-1 — generalize the coordinator gate + support teacher + history, D-#42/#45/#53):**
  server + app. `assertIsClassTeacher` doc generalized to the **section daily-coordinator** gate (CT1.1, no
  behavior change — reused by future attendance/leave/report-card/comms). New `Section.supportTeacherIds`
  (support/assistant teachers — recorded, NOT the gate, D-#53) + append-only `ClassTeacherAssignment` log
  (every set/clear/add/remove + actor + timestamp, ADR-008). New `ClassTeacherService` (assign + support
  add/remove + history); `assignClassTeacher` refactored through it (now logs). Resolvers: `setSupportTeacher`
  + `mySectionsAsClassTeacher` (CT1.2 teacher self-view, query ready) + `classTeacherHistory`;
  `supportTeacherIds` on the Section type. App: **AssignClassTeacherScreen** enhanced — overview of **all
  sections** (unassigned flagged + per-teacher load badge, CT1.3/1.4) + support add/remove + assignment
  history. **Gate GREEN:** server tsc + **jest 289/289** (6 new in `classTeacherService.test.ts`, firewall
  green); **app tsc clean + web bundle green** (491 modules). Covers CT1.1–CT1.6. **Not verified live.**
  CT-2..5 duty gates land with their (unbuilt) attendance/leave/report-card/comms modules.
- **Built (Routine R-5 — triggers + class-note/daily-diary, D-#52/#54): ROUTINE MODULE COMPLETE (R-1→R-5).**
  Server: `ClassNote` (one per slot+date; what-was-taught + optional HW-T1 `homeworkItemId` link — no second
  homework path) + `BellDutyAssignment` (whole-day or per-period, D-#54). `RoutineTriggerService` + pure
  `trigger.ts` `buildBellSchedule` (per-period override → whole-day duty → null). Queries `bellSchedule`
  (period end times from the R-1 grid/window + the bell-duty admin), `classNotesForDate`,
  `myClassNotePrompts` (the teacher's slots still needing a note), `bellDutyForDate`; mutations
  `publishClassNote` (authorized to the slot's teacher / active cover / admin), `assignBellDuty`. **Delivery
  (push) rides the deferred messaging pipeline; R5.4 guardian notify + R5.5 push are pipeline.** App:
  `DailyNoteScreen` (per group+date — publish what-was-taught per slot + view notes), `BellScheduleScreen`
  (date+audience bell schedule + assign bell-duty, managers), MyRoutine **"notes to publish today"** prompt.
  **Gate GREEN:** server tsc + **jest 283/283** (8 new in `routineTrigger.test.ts`, firewall green); **app
  tsc clean + web bundle green** (491 modules). Covers R5.1–R5.3. **Not verified live.** **Routine module is
  feature-complete server+app (R-1 calendar/grids → R-2 slots/conflict/scope → R-3 views → R-4 cover/
  proxy-manage → R-5 triggers/class-note).** Next: live verification, or another module.
- **Built (Routine R-4 — substitution/cover + proxy-manage, D-#22/#46/#49):** server + app. New
  `RoutineSubstitution` model (one cover per slot per date). **Server:** `RoutineCoverService` — pure
  `rankAvailability` (free-first, lightest-load-next) + `teacherAvailability(date, period)` (who's free +
  each teacher's class count that day), `assignCover` (records the sub; for a **Section** slot backs it
  with a **time-bounded proxy `ScopeGrant`** via the existing `assignProxy`, D-#20/#22; a SubjectGroup
  cover is record-only — no content scope), `cancelCover` (deactivate + `revokeProxy`), `coversForDate`.
  `routineForDate` now **overlays covers** (each slot gains `coverTeacherId` for the date, R4.4).
  Resolvers `teacherAvailability`/`coversForDate` + `assignCover`/`cancelCover` (manage) +
  `coverTeacherId` on the slot type. **App:** `CoverManageScreen` (reachable per group from RoutineHome,
  managers only) — date + the day's slots; "Find cover" → ranked availability → assign; active-covers
  list with cancel. New cover operations + STR keys (BN/EN). **R4.5 (guardian read) is pipeline-deferred**
  (guardian portal). **Gate GREEN:** server tsc + **jest 275/275** (6 new in `routineCover.test.ts`,
  firewall green); **app tsc clean + web bundle green**. **Not verified live.** Covers R4.1–R4.4.
  **Next = R-5** (routine-driven triggers + class-note/daily-diary).
- **Built (Routine R-3 — app views, D-#46):** first routine **frontend** slice (Expo). New **Routine tab**
  (📅, gated `routine:read` → Principal/Teacher/Office), `RoutineStack` with 4 screens: `RoutineHome`
  (role-aware landing — My routine / section grid / Quran-Arabic group list; editor entries shown only to
  `routine:manage`), `GroupRoutineScreen` (R3.1 weekly grid for a Section/SubjectGroup, grouped by day via
  shared `SlotList`), `MyRoutineScreen` (R3.2 the teacher's own slots, today highlighted), `RoutineEditor`
  (R3.3 admin create/delete slots — day/period/subject/track/teacher/room chips+fields; **server conflict
  rejection shown inline + authority warnings surfaced as a notice**). One small server read added:
  `myRoutineSlots` (`routine:read`, scoped to the caller). App-native operations + `routineSubjectLabel`/
  `dayOfWeekLabel`/`periodTrackLabel` + STR keys (BN/EN). **Frontend-only beyond the one read; no
  contract/schema change.** **Gate GREEN:** server tsc + **jest 269/269** (firewall green); **app
  `tsc --noEmit` clean + web bundle green** (`expo export --platform web`, 488 modules). **Not verified
  against a live server.** Covers R3.1–R3.3. **Next = R-4** (substitution/cover + proxy-manage).
- **Built (Routine R-2 — slots + conflict engine + scope binding, D-#46/#49/#56):** server-side. New
  `RoutineSlot` model (`(group×day×period)→subject,teacher,room`; group = Section or SubjectGroup;
  effective-dated `[from,to)`; a Quran double = two adjacent slots, D-#56). **Conflict engine** (pure
  `conflicts.ts`): rejects teacher / group / room double-booking at the same (day, period) with
  overlapping effective windows. **Scope binding** (D-#49): a content-subject Section slot auto-upserts a
  teaching `ScopeGrant` tagged `source:"routine"` (new field on the model) — Quran/Arabic groups +
  non-content subjects bind nothing (no content scope); delete revokes **only** when no remaining slot
  maps to it (manual grants never touched). **Teacher-authority = warn, never blocks** (R2.6). Day rule
  (`weekdayBaseDayType`): Fri rejected, Sat only quran, Sun–Thu all. `RoutineSlotService` + resolvers
  `routineSlots`/`routineForDate` (read) + `createRoutineSlot` (→ `{slot, warnings}`)/`deleteRoutineSlot`
  (manage). **Gate GREEN:** vocab verifier PASS, shared+server tsc clean, **jest 269/269** (24 new in
  `routineSlots.test.ts`; firewall green). **Not verified live; not committed yet.** Covers R2.1–R2.8.
  **Next = R-3** (views: group grid + my-routine + admin editor — app).
- **Built (Routine R-1 — calendar + rooms + groups + grids + windows, D-#46–#58):** first routine slice,
  server-side. New app-native vocab in `/shared/vocab.ts`: `DAYS_OF_WEEK`/`DAY_TYPES`/`PERIOD_TRACKS`/
  `SEASONS`/`HOLIDAY_TYPES`/`GROUP_GENDERS`/`ROUTINE_SUBJECTS` (⊇ HW_SUBJECTS + QURAN) + BN/EN labels +
  `routine:read`/`routine:manage` perms (PRINCIPAL/OFFICE manage, TEACHER read). New `server/src/modules/
  routine/`: models `Room`, `SubjectGroup` + `SubjectGroupMembership` (cross-grade gender-split Quran/Arabic
  groups, ≤1-per-track), `PeriodGrid` (per-(audienceKey,season), per-period track tag + durationMin — D-#58),
  `ScheduleWindow` (admin date windows + `dayStartMinutes`), `HolidayException`. Pure helpers `calendar.ts`
  (`dayTypeFor`/`dayTypeAdmitsTrack`/`resolveDayType` — reuses trackers `isSchoolDay`, no second calendar)
  + `schedule.ts` (`computePeriodTimes` from a day-start, `windowFor`, `dateRangesOverlap`, HH:MM helpers).
  GraphQL resolvers: queries `rooms`/`subjectGroups`/`subjectGroupMembers`/`periodGrids`/`scheduleWindows`/
  `holidays`/`dayType`/`resolvedDay` (computes a day's clock times) gated `routine:read`; mutations
  `createRoom`/`setRoomActive`/`createSubjectGroup`/`add|removeGroupMember`/`upsertPeriodGrid`/
  `createScheduleWindow`/`createHolidayException` gated `routine:manage`. **Gate GREEN:** vocab verifier PASS
  (incl. new C.3 routine checks + OFFICE exact-list updated), shared+server tsc clean, **jest 245/245**
  (22 new in `routine.test.ts`; firewall green). **Not verified live; not committed yet.** Covers R1.1–R1.6.
  **Next = R-2** (routine slots + conflict engine + scope binding + RBAC).
- **Planned (Routine module + Class-teacher generalization — build contracts written, D-#45–#52):**
  two new build contracts authored, **no feature code yet**. (1) `docs/prd-routine.md` — full Routine/
  Timetable module, **scope-expanded after the Principal walkthrough** (D-#48–#52). Now owns: a **day-type
  calendar** (Sun–Thu full, Fri off, **Sat Quran-only**, + holiday exceptions that suspend routine+
  attendance, D-#50); **rooms**; **groupings** — general `Section` + new cross-grade **`SubjectGroup`** for
  Quran/Arabic (a Hifz year mixes class 2/3/4, with student membership, D-#48); **period grids** keyed by
  audience×track×season (Class 1–5: general 35-min / Arabic 40-min / Quran 90-min double, winter 60;
  Nursery/KG own grid: single-period Quran + first-2 periods 45/30-min, D-#51); **routine slots** +
  conflict engine (no teacher/group/room double-booking) + effective-dating; **scope binding** — a
  subject-teacher slot **auto-grants** teaching access (`source:"routine"` ScopeGrant; manual+supervisory
  coexist; proxy→time-bounded; D-#49); **substitution/cover** + an admin **proxy-manage** availability view
  (who's free + how loaded that day); section/teacher/guardian **views**; and a **routine-driven trigger
  schedule** (bell→duty-admin, attendance→teacher, class-note→subject-teacher, note-published→guardian)
  feeding a **class-note/daily-diary** (reuses HW-T1 declaration; push **delivery rides the deferred
  messaging/push pipeline**, D-#52). Slices **R-1** (calendar+rooms+groups+grids) → **R-2** (slots+conflict
  engine+scope binding+RBAC) → **R-3** (views) → **R-4** (cover+proxy-manage) → **R-5** (triggers+
  class-note). New app-native vocab `routine:read`/`routine:manage` + `DAYS_OF_WEEK`/`DAY_TYPES`/
  `PERIOD_TRACKS`/`SEASONS`/`ROUTINE_SUBJECTS` (no wire twin). (2) `docs/prd-class-teacher.md` — generalize
  `assertIsClassTeacher` (D-#42) into the section "daily coordinator" gate for attendance/leave/report-card/
  parent-comms; **CT-1** now also adds a **support/assistant teacher** on the section (Nursery has one;
  KG/others future) + an **append-only `ClassTeacherAssignment` history log** (both pulled INTO scope by
  Principal, D-#53 — reverses D-#45). Duty gates still land with their (unbuilt) modules. Decisions
  **D-#45–#54** appended; roadmap updated. **Routine open items resolved (D-#54):** `ROUTINE_SUBJECTS =
  [BAN,ENG,MATH,SCI,BGS,ARABIC,ISLAM,QURAN]` (BGS+Science class 3–5 only, rest all classes); bell-duty =
  per-day default + optional per-period; memberships year-stable (no mid-year class change); class-note =
  what-taught + link to declared homework. **Seasons = admin-set `ScheduleWindow`s (D-#55):** winter dates
  float yearly; day-start steps 07:00→07:15→07:30; `PeriodGrid` holds durations, absolute clock times
  computed from the window's `dayStartTime`. **Grounded in the live V3 routine (`Class Routine
  Teacher.xlsx`, D-#56):** double-period = two adjacent independently-staffed slots (not atomic);
  `SubjectGroup`s are leveled + gender-split (Quran: Qaida/Ammapara/Najera/Hifz 1–3; Arabic: Book 1/2/3),
  no separate group-lead; "Deen"→ISLAM label; sections gender-split (Boys/Girls) from ~Class 2/3; the
  sheet's bottom table gives current Lead(class-teacher)+Support assignments + the period grid, **seedable
  for CT-1/R-1**. **Period grids PINNED (D-#57):** Nursery/KG = 6 periods (single-period Quran, ends 10:50);
  Class 1–5 = 8 periods (Quran double + Arabic + 4 general, ends 12:00); winter compresses only P1/P2
  (45→30); exact minutes seed from V3. **All routine + class-teacher open items now resolved — contracts
  build-ready.** **Next = build R-1** (calendar+rooms+groups+grids) — or CT-1 first if class-teacher
  visibility is the priority.
- **Built (Homework Tracker — app screens, frontend for HW-T1→T4):** new Expo **Homework tab** (📒, gated
  `tracker:read`) — 4 screens over the existing server contract (no server/contract change): `HomeworkHome`
  (daily DAY_TOTAL vs 240 + declarations w/ band warnings + summary roll-up: chase list w/ §7.2 badges, open
  resubmissions, on-time %/chase volume/return latency, topic touches), `DeclareHomework` (subject-teacher
  declaration form, classLevel derived from the class), `HomeworkReconcile` (class-teacher trim ক/খ/গ +
  present/absent roster + confirm-issue, over-ceiling blocks), `CheckingQueue` (SUBMITTED → RESULT + optional
  Pool top-up). New homework labels/STR + `HomeworkTab` nav. Gate: **app tsc clean + web bundle green** (480
  modules). **Not verified against a live server.** **Principal roll-ups screen now also built**
  (`HomeworkRollupsScreen` — watch-list / trim-pattern / de-identified question-usage; reachable from
  HomeworkHome). **Assign-class-teacher UI built** too (`AssignClassTeacherScreen`, Admin tab, roster:manage)
  — D-#42 now has a UI. Homework feature complete server **and** app. Remaining = operational/governance only:
  Quran/§6.3→Project 06 (**note drafted** — `docs/project06-deviation-quran.md`, for the Principal to send);
  **run** the class-teacher assignments on the live roster (UI now exists); live golden-path verification.
- **Built (Homework Tracker HW-T4 — roll-ups + thresholds + question-usage feed, D-#44):** the homework build
  (HW-T1→T4) is now feature-complete server-side. `HomeworkSummaryService` + `tracker:read` queries:
  `homeworkSummary` (chase list + §7.2 attention/comms thresholds, open resubmissions, submitted-on-time % /
  chase volume / Given→Returned latency, touches-per-TOP-tag), `homeworkWatchList` (§7.3 ≥3 open/recent
  resubmissions per rolling 14 days), `homeworkTrimPattern` (§7.4 subject trimmed >30% of the month's
  reconciled days), `questionUsageFeed` (§8.4 **de-identified** per-qid usage — no identity, firewall green).
  Thresholds = A-01/D-#34. No new vocab/wire change. Gate green: server tsc clean, vocab verifier PASS,
  **jest 223/223** (5 new; firewall green). **Not committed yet; not verified live.** Covers handoff §12 #10.
  **Homework Tracker §12 acceptance now fully covered (#1–#11).** Remaining: optional app screens (handoff
  §8.1/§8.2 views) + the parked cross-feature items (Quran/§6.3 deviation to Project 06; assign class teachers
  live; live golden-path verification).
- **Built (Plan review/approval loop PR-3 — app screens, D-#38):** the loop is now usable end-to-end in
  the Expo app. New **Review tab** (📝, gated `content:review` OR `content:assign_review` → Teacher +
  Principal + Office). `ReviewHomeScreen` — role-aware: **Inbox** (admins: `planReviewInbox`, submitted
  rounds) + **My reviews** (teacher: `myReviewAssignments`); each query paused when the role lacks the perm.
  `ReviewSubmitScreen` (teacher) — renders the assigned plan (reviewer read-override) + verdict chips
  (অনুমোদন / পরিবর্তন প্রয়োজন) + feedback → `submitPlanReview`. `ReviewThreadScreen` (admin) — full round
  history with **copy-feedback to clipboard** (the Claude-Desktop text), **Assign next round** (reviewer id),
  and **Approve / sign-off** (Principal, enabled only when `reviewed`). `PlanViewScreen` gains the same
  assign + approve actions for the Principal (who browses content). New app-native vocab labels
  (`reviewVerdictLabel`/`reviewRoundStatusLabel` + STR). Re-upload uses the existing Import screen (R3.4).
  **Frontend-only, no server/contract change.** Gate: **app `tsc --noEmit` clean + web bundle green**
  (`expo export --platform web`, 476 modules). **Not verified against a live server.** Plan-review loop
  (PR-1→PR-3) is now feature-complete server+app.
- **Built (Homework Tracker HW-T3 — resubmission + Pool top-up, D-#43):** `HomeworkResubmissionService` —
  `checkRecord` records RESULT at SUBMITTED→CHECKED; WRONG auto-spawns a resubmission (NEW record, same
  HW_ID, `resubOf`, fresh GIVEN→…→RETURNED; original→RESUBMIT), PARTIAL spawns only on teacher judgment,
  CORRECT advances. All four §5 top-up boundaries enforced (selected-not-authored via the question store;
  reactive-only; time-counted in `getStudentDayLoad`; inside the resubmission/same HW_ID). GraphQL
  `checkHomeworkRecord` (subject-teacher write) + `studentDayLoad` (per-child base+top-up vs 240). Fixed an
  HW-T1 bug: dropped the unique `{hwItemId,studentId}` index (a resubmission is a legit 2nd record). No new
  vocab/wire change. Gate green: server tsc clean, vocab verifier PASS, **jest 218/218** (14 new; firewall
  green). **Not committed yet; not verified live.** Covers handoff §12 #6 (all four boundaries) + #3 (the
  resubmission's own 1→6 pass). **Next = HW-T4** (trackerSummary roll-ups + thresholds + question-usage feed).
- **Built (Plan review/approval loop PR-2 — D-#38):** closes the loop. `approvePlan` — Principal
  sign-off `reviewed→gold` (`content:promote_gold`, Principal-locked), closes the thread (supersedes
  any open round), audits `PLAN_APPROVED`; rejects sign-off unless the plan is `reviewed` (a teacher
  APPROVE must land first). `planReviewInbox` (Principal/Office — submitted rounds newest-first, the
  `feedback` is the Claude-Desktop text) + `planReviewThread` (full round history by any artifact
  version; Principal/Office see all, a teacher only threads they reviewed). **Re-import linkage
  (R2.2):** `persistEnvelope` now calls `supersedeOpenRoundsForAddress` when a revised plan version
  supersedes the prior — the open round flips `superseded`, the next round assigns on the new (`draft`)
  version. Shared supersede helper (reused by reassign + re-import + sign-off). **No wire-contract
  change.** Gates: vocab verifier green, server tsc clean, **205/205 tests** (incl. the merged D-#42
  class-teacher suite + new PR-2 cases), firewall green. **Merged (PR #3).** Closed out by PR-3 above.
- **Built (Plan review/approval loop PR-1 — D-#38–#40):** server core of the in-app plan-vetting loop.
  Build contract `docs/prd-plan-review.md`. App-native vocab: new perm `content:assign_review`
  (Principal/Office), `content:review` extended to TEACHER, `REVIEW_VERDICTS` enum (`APPROVE`/
  `CHANGES_REQUESTED`) + BN labels; verifier extended + green. New `ReviewAssignment` model
  (`content` module — address-keyed `{docType,subject,classLevel,anchorWord,addressNumber}` so the
  review thread spans re-imported versions; identity plane, behind ADR-005). `ReviewService`
  (`assignPlanReview`/`submitPlanReview`/`cancelPlanReview` + pure `advanceOnApprove`/`isPlanDocType`/
  `addressKeyOf` + `reviewerMayReadArtifact`). Resolvers `assignPlanReview`/`submitPlanReview`/
  `cancelPlanReview`/`myReviewAssignments`; **reviewer read-scope override** wired into the `artifact`
  query (an assigned teacher reads that exact version out-of-subject, read-only). `APPROVE` on a `draft`
  plan advances `reviewStatus`→`reviewed`; one open round per address (supersede on reassign, D-#40).
  Audit kinds `REVIEW_ASSIGNED`/`REVIEW_SUBMITTED`/`REVIEW_CANCELLED` (+`PLAN_APPROVED` reserved for PR-2).
  **No wire-contract change.** Gates: vocab verifier green, shared+server tsc clean, 188/188 tests
  (18 new in `review.test.ts`), firewall green. **Merged (PR #1).** Closed out by PR-2 above.
- **Built (Homework Tracker HW-T2 — daily 240-min reconciliation + trim log + cadence, D-#41):** the ceiling
  is now real. `HomeworkReconciliation` (Layer C, one per class/day, immutable ক/খ/গ trim log) +
  `HomeworkReconciliationService`: `tallyDay` (live DAY_TOTAL vs 240 + >40 band warnings), `getTrimCandidates`
  (pre-ranked ক→খ→গ), `applyTrim` (cut Q_COUNT → TIME_DECL follows proportionally, never extends time; logs an
  immutable row; rejected once reconciled), `confirmHomeworkDay` (BLOCKS if DAY_TOTAL>240, hard-blocks Fri/Sat,
  else issues every declared item w/ q>0 + reconciles). New vocab `RECON_STATES`/`TRIM_RANKS` + the LOCKED
  figures (240/120/40/20) + verifier checks. GraphQL: homeworkDayTally/homeworkTrimCandidates +
  trimHomeworkItem/confirmHomeworkDay. **Fixed HW-T1's over-strict TIME_DECL>40 reject → now allowed (band
  warns, never blocks; only the 240 sum blocks).** Gate green: vocab verifier PASS, shared+server tsc clean,
  **jest 170/170** (16 new tests; firewall green). **Not committed; not verified live.** Covers handoff §12
  #4 (240 block + trim by count not time + band-warn-not-block), #5 (immutable trim log w/ rank ক/খ/গ +
  from/to + minutes), #7 (Fri/Sat hard-block + Thursday light), #8 (one common sheet). **Class-teacher-only
  reconcile now ENFORCED (D-#42, resolves the D-#41 open item):** `Section.classTeacherId` (a TEACHER) +
  `assignClassTeacher` mutation (roster:manage); `trimHomeworkItem`/`confirmHomeworkDay` gate on
  `assertIsClassTeacher` (not any write-scoped teacher; Principal/Office assign, don't reconcile).
  **Next = HW-T3** (resubmission + Pool top-up, 4 boundaries).
- **Built (Homework Tracker HW-T1 — model + 6-stage lifecycle, D-#36/#37):** the daily HW machinery now has
  its foundation. App-native vocab `HW_SUBJECTS` (content-subject superset + Arabic/Islam, NOT Quran — D-#36, Quran→Quran Tracker),
  `LIFECYCLE_STATES` (8 atomic states for §3's 6 stages, D-#37), `HW_RESULTS` (+BN labels, verifier green).
  Shared lifecycle engine `server/.../trackers/lifecycle.ts` (transition graph + guards + stage map — built
  once, to be reused by the Assignment tracker) + `calendar.ts` (Sun–Thu school nights). Models `HomeworkItem`
  (Layer A — one common sheet/class+subject+day), `HomeworkStudentRecord` (Layer B — **identity-bearing**
  lifecycle carrier on the operational plane, ADR-005; corpus never imports it), `HomeworkSequence` (atomic
  year-continuous HW_ID). `HomeworkService` (declare/issue/transition) + GraphQL resolvers wired
  (declare/issue/transition mutations + homeworkItems/homeworkStudentRecords queries, tracker:read/write).
  Gate green: vocab verifier PASS, shared+server tsc clean, **jest 154/154** (27 new tests; firewall green).
  **Not verified live** (no running server/Atlas). **Not committed.** Acceptance covered: handoff §12 #2
  (HW_ID + ≥1 TOP tag), #3 (6-stage lifecycle, timestamped, shared-once), #8 (one common sheet — no
  per-student item variant), #9 (Bangla labels + English codes); partial #1 (no new tracker-kind/sync).
  **Next = HW-T2** (daily 240-min reconciliation + trim log + Fri/Sat cadence block).
- **Planned (Homework Tracker, Project-06 handoff adopted — D-#33–#35):** stored the LOCKED source verbatim
  (`docs/tracker-homework-handoff.md`, PRD v1.1 incl. Amendment A-01) and authored the repo build contract
  (`docs/prd-tracker-homework.md`). **Key finding:** the Slice-3 "homework tracker" is only the bare generic
  tracker (`TrackerRecord` = one `complete` boolean per de-identified student) — the handoff's HW machinery
  (§3 6-stage lifecycle, §4 240-min reconciliation+trim log, §5 resubmission+Pool top-up, §8 roll-ups) is
  **unbuilt**, so "ratifies and completes" is really a multi-slice build. Build order:
  **HW-T1** model + 6-stage lifecycle (FIRM, built once + shared w/ Assignment) → **HW-T2** daily budget
  reconciliation (240 ceiling block, trim by count not time, immutable ক/খ/গ trim log) + Sun–Thu cadence
  (Fri/Sat hard-block, Thursday light) → **HW-T3** resubmission + Pool top-up (4 boundaries) → **HW-T4**
  `trackerSummary` roll-ups + thresholds (chase 2/3, watch-list ≥3/2wk, trim >30%/mo) + de-identified
  question-usage feed; cross-cut RBAC (class-teacher-only reconcile/confirm) + plane split + firewall green.
  Rides the existing `homework` tracker-kind — **no new tracker-kind, no envelope-schema/harness sync**;
  only app-native `/shared/vocab.ts` additions (lifecycle states, RESULT scale). **Plan/docs only — no
  feature code yet; not committed.** Next = build HW-T1.
- **Built (question-bank import / fan-out, D-#32):** the app now imports a Project-04 **question bank**
  (a `{stimuli,questions}` collection) by **fanning it out** into N single-doc envelopes (one per stimulus
  + one per question) via new `server/import/build_question_envelopes.py` (question analog of
  `build_envelope.py`), each through the **unchanged** gate. subject/class/unit parsed from the qid/stimulus_id
  (mixed bank refused); `tags` copied from payload; `review_status=draft` + synthesized `address` injected;
  `curation_tag` picked in the UI; companion `.md`/register `.tsv` NOT imported (questions app-rendered).
  Import is **atomic** (validate all → persist only if all pass → else store nothing). `persistEnvelope`
  extracted from `importEnvelope`; `importQuestionBank` added; `importFiles` gains `curationTag`/`unitTitle`;
  `ImportResult` gains item tallies; Import screen detects a bank + shows a curation picker + "Imported X/Y".
  **Register stance (D-#32):** NOT stored — the live `questions()` filter + Question-bank screen ARE the
  register (never stale); the TSV stays an offline P04 deliverable. **No contract change.** Executed proof:
  real C5_ENG_U09 bank → 114 envelopes, **114/114 PASS** through `validate_import.py`; server **127/127**
  (3 new bank tests), shared+server+app tsc clean, vocab verifier green. **Not yet verified live** against a
  running server/Atlas (manual web golden path pending); not yet committed to git.
- **LOADED to Atlas (HR-1 staff records):** **real staff roster** (23: 21 teacher / 2 office_accounts) — verified
  live, all with phone + biometricId. First HR slice (prd-hr H1): new `StaffProfile` model (foundation/identity
  plane; bio+employment + sensitive NID/bank/biometric rows), app-native vocab `HR_CATEGORY`/`EMPLOYMENT_TYPE`/
  `EMPLOYMENT_STATUS` (+ BN labels, no wire twin), `staff:manage` perm (Principal/Office). `staff` query gated
  `staff:manage` (default-deny to TEACHER, H1.4) + read-only **StaffListScreen** (Admin tab, category filter).
  Pipeline: `extract-staff.py` (both .xlsx → gitignored `staff.json`) → `import-staff.ts` (idempotent upsert by
  schoolId, no clears). **Data-only — no `User` logins yet** (login optional/separate, H1.2). No new corpus path;
  firewall green (124/124, shared+server+app tsc clean, vocab verifier green). Not yet committed to git.
- **LOADED to Atlas:** **real student roster** (91 students) — verified live: 91 students (all w/ phone, 88 w/ dob),
  7 classes (Nursery 21 / KG 12 / One 7 / Two 14 / Three 17 / Four 12 / Five 8), 10 populated sections,
  129 contact-only guardians (`loginEnabled:false`), 194 guardian links. Seed leftovers cleared first
  (6 `S-30x` students + `@scd.test` users + their grants + 3 empty seed sections) via `clear-seed.ts`.
  Model/contract work: roster class-level axis (`ROSTER_CLASS_LEVELS` −1..5, Nursery/KG below content's
  C1–C5; content `class_level` LOCKED 1..5 untouched, D-#30); `Student` + core operational fields;
  `Guardian` login-optional (D-#31). Pipeline: `extract-students.py` → gitignored `students.json` →
  `import-students.ts` (idempotent upsert by schoolId). Gates green (124/124, typecheck, vocab verifier).
  Source .xlsx + students.json are gitignored PII (ADR-005). Model/script/contract layer committed [e4962a3].
- **Built (frontend roster view):** new read-only **RosterScreen** under the Admin tab (gated `roster:manage`,
  Office/Principal). `StudentRef` now exposes nameBn/gender/dob/phone/address/bloodGroup + a `guardians`
  field (GuardianLink→Guardian); app `ROSTER_QUERY` + `RosterScreen` render them per section (reuses the
  SectionPicker), with Bangla gender/relation/DOB labels and roster-aware `classLevelLabel` (Nursery/KG).
  app tsc + server tsc clean, 124/124 tests, vocab verifier green. **Verified live** on Expo web
  (localhost:8081): Admin → শিক্ষার্থী তালিকা lists real students with their fields + guardians.
  Committed [56a9c0a] (server `guardians` field + RosterScreen; operations.ts/labels.ts also swept in
  pre-existing import-screen WIP strings per operator choice).
- **Designed (not built):** **HR / staff lifecycle module** — all four build-steps + offboarding designed
  in `docs/hr-design.md`; per-journey PRD in `docs/prd-hr.md`; decisions **D-#22–D-#29** appended.
  Build-steps mirror the slice approach: (1) staff records, (2) attendance & leave, (3) payroll,
  (4) performance/conduct/development, + offboarding (cross-cutting). Operational/identity plane, behind
  the PII firewall (ADR-005) — **no new corpus→identity path**; the J5.6 fail-closed firewall test must
  stay green. **Remaining before build:** maternity legal check (D-#23) + parked numbers/specs (leave
  entitlements + Hajj reset; attendance times/grace + **biometric device model/SDK**; Eid bonus + day-rate
  basis; statutory deductions w/ accountant; payment-export target format; warning lapse periods + appraisal
  cadence; REF-11 rubric from curriculum Projects; offboarding clearance-list + notice periods).
  HR **pulled forward** from `docs/roadmap.md` "Deferred ops modules" into the active build (this is the
  STATUS/roadmap call the design flagged).
- **Done:** Slice 4 — connected frontend (Expo app). [45fe2eb 9210cd1 3e31a17]
  - All teacher/principal/office screens per `docs/prd.md` §8: Login; Content tree + Plan
    view + PDF; Question bank (multi-filter) + Preview + Basket; Set list/detail + Assemble
    (HW/AS/CT); Tracker list/open/entry/summary + wa.me copy link; Admin import + user
    create + proxy-grant assign/extend/revoke. 16 screens, role-gated bottom tabs.
  - urql + hand-typed TypedDocumentNodes (codegen deferred — PRD §8 step 8); JWT in
    SecureStore/localStorage; Bangla labels from `shared/vocab` (NFR-5), English codes on
    forms; write-scope ForbiddenError → Bangla message. **`tsc --noEmit` CLEAN; web bundle
    compiles green** (`expo export --platform web`, 471 modules, ~10 s).
  - **NativeWind v4 wired in package.json (ADR-010/014) but its Babel/Metro transform is
    left disabled:** on Windows (no watchman) the css-interop transformer hangs the cold
    Metro web bundle 30+ min. UI uses a themed StyleSheet system; re-enable steps are inline
    in `app/babel.config.js` / `app/metro.config.js` (do it on a watchman platform / CI).
  - **Not executed:** golden-path data flows (needs a running server + seeded Atlas +
    credentials) and native iOS/Android builds. PDF export + DocumentPicker are web-path
    only this slice.
- **Done:** Slice 3 — trackers (J4 end-to-end).
  - `TrackerRecord` model (`trackers` module) — open/closed lifecycle, per-student entries de-identified via sha256 pseudonym (ADR-005), CT score / AS submitted / HW complete fields.
  - `openTracker` / `recordEntry` / `closeTracker` mutations — write-scope via `assertCanWrite` (J4.5: supervisory-only teachers denied); `recordEntry` emits `tracker_recorded` CorpusEvent (de-identified, ADR-005).
  - `tracker` / `trackers` / `trackerSummary` queries — read-scope enforced; `trackers` supports filters: trackerKind / setId / status (J4.4).
  - `waLink` query — pure wa.me deep-link builder (J4.2, ADR-003); no server dispatch.
  - Tests: 124/124 pass (J4.1–J4.5 + all prior tests). `tsc --noEmit` clean. Vocab verifier PASS.
- **Done:** Slice 2 — question bank + assembly (J2 + J3 end-to-end). [e1db6d7]
- **Next:** verify the frontend golden path against a running server (seed Atlas + a staff
  login), then guardian portal screens (deferred; `docs/roadmap.md`) or the server follow-ons
  below.

## Slice 4 follow-ups (frontend was built to the existing contract; these would improve it)
- **DONE (2026-06-12, branch `worktree-slice4-followups`):** the first three follow-ups are closed.
  `academicYears` + `teachers` queries had already landed with later modules (year/teacher pickers
  in `app/src/components/selects.tsx` use them); this session added the rest: **`myScopes` enriched**
  (classId/sectionId/subjectId + proxy detail via pure `grantView`), **`users`** + **`proxyGrants`**
  lookups (existing `user:manage`, Principal — no new permission), SectionPicker **"আমার শাখা"
  shortcuts** from myScopes, UserList renders the real list, ScopeGrant extend/revoke is list-driven
  (no pasted GRANT_IDs). **`/pdf` CORS was already closed by GP-A [4556696]** — `corsForRest` in
  `server/src/index.ts` covers `/pdf` (incl. `/pdf/set`) + `/files`. Gate: shared+server tsc clean,
  jest 430/430 (7 new in adminLookups.test.ts, firewall green), app tsc clean + web export green.
- native PDF via expo-file-system + expo-sharing (web PDF path works today).
- **Re-enable NativeWind** on a watchman platform / CI (see build-config notes above).
- **graphql-codegen client-preset** to replace the hand-typed operations (PRD §8 step 8).

## In flight
- 2026-07-02: dev deploy repair in progress - three guardian screen modules were present locally but missing from the branch; app typecheck is green after confirming them.
- (none — Slice 4 shipped)

## Blocked / waiting
- (none blocking)
  - Open follow-ons from the Project-04 contract LOCK (D-#19), non-blocking:
    - Wire the **authoritative REF-19 registry** via `--ref19-registry`.
    - Upgrade **`topic_tag`** from pattern-only to registry validation.

## Foundation in place
- Requirements (DRAFT), Architecture/17 ADRs (DRAFT), **import contract LOCKED v1.0**, conformance
  harness v1.0 (L1→L4, working), 11 fixture instances green.
- `/shared` vocab v1.0 + RBAC (verified).
- **Slice 0 shipped (2026-06-09):**
  - npm workspaces: `/shared` (built, .d.ts emitted), `/server` (Node + Yoga + Pothos + Envelop),
    `/app` (Expo skeleton, boots on web).
  - Foundation models: User, Guardian, Student, GuardianLink, Class (+ auto-Main section), Section,
    Subject, AcademicYear, ScopeGrant.
  - Audit model (append-only, ADR-008) + AuditService.
  - Staff auth (email+password, JWT) + Guardian auth (flexible identifier).
  - Scope-grant model (teaching/supervisory/proxy) + ScopeGrantService + resolver authz middleware.
  - Proxy auto-expiry: window-checked at request time; expiry audit stamped at first denied-after-expiry
    (D-#21). Early-revoke + extend supported.
  - **Fail-closed firewall test GREEN** (J5.6, ADR-005): corpus analytics path cannot resolve
    student/guardian identity — 7 firewall assertions pass.
  - tsc --noEmit: CLEAN. npm test: 31/31 PASS. vocab verifier: PASS.

## Recent decisions
- **HR module (D-#22–D-#29):** D-#22 cover proposal → admin approval; D-#23 maternity unpaid (accepted
  risk, legal check pending); D-#24 attendance live device sync (first live external dependency);
  D-#25 all staff incl. support attendance-tracked; D-#26 lateness no deduction by default (optional rule);
  D-#27 advances interest- & fee-free (*qard hasan*); D-#28 supervisor observation-write; D-#29 final
  settlement hard-held until clearance.
- D-#17/#18: TEACHER scope overlays — supervisory (read-only) + proxy/cover (bounded write).
- D-#19: adopted Project-04 LOCKED question/stimulus contract.
- D-#20: proxy grants duration-bounded in days; auto-expiry + audit.
- **D-#21:** proxy-expiry audit stamped at request time (first denied-after-expiry) — no cron.
- **Slice 1 design:** Python harness invoked via child_process (not re-ported to TS) — canonical gate stays single-source. pdfkit + NotoSansBengali font (not puppeteer) — no system Chromium dep on Oracle Always-Free.

## Backlog
- Deferred pipeline (guardian portal, analytics, AI/LLM export, messaging automation, ops modules)
- 2026-07-01: guardian portal shortcuts now open live attendance, fees, class notes, leave, and notifications screens; child/section labels are language-aware in English mode. Server + app typechecks passed in this session.
  lives in `docs/roadmap.md`.
- 2026-07-01: content browsing now has a `currentOnly` toggle on `contentTree`, so Principal can switch from current versions to all versions when older session plans need to be reviewed. Server + app typechecks passed in this session.
- 2026-07-01: session-plan ordering now uses the stored `payload.session_plan.period_index`, so Session 1 appears before Session 2 in both the Lesson Plans tree and the Principal review list. Server + app typechecks passed in this session.
- 2026-07-01: Lesson Plans now open on the `All versions` tab by default for Principal, with session plans still sorted ascending by `payload.session_plan.period_index`. Server + app typechecks passed in this session.
- 2026-07-01: Lesson Plans filter controls are now laid out in a compact responsive grid, so the filter block fits higher on wide screens instead of taking most of the viewport. Server + app typechecks passed in this session.
- 2026-07-01: session-plan cards now show the session number beside the chapter name, sourced from `payload.session_plan.period_index`. Server + app typechecks passed in this session.
- 2026-07-01: homework topic selection now falls back to a synthetic generic tag when a subject/class has no seeded rows, Homework home also falls back to routine slots when listing accessible classes, and class-note screens now use the shared calendar field plus a class/group header. Server homework test and app/server typechecks passed in this session.
- 2026-07-01: the shared-vocab CI verifier was still checking the old homework tuple `240/120/40/20`; it now matches the current `120/120/40/20` values so the gate can reflect the lowered ceiling. Local verifier rerun passed in this session.
- 2026-07-02 - feat(admin/review/guardian): rename the Supervisory grant card, add manual guardian/student link + relink tooling on Guardian logins, and expose reviewer-centric plan unassign. Gate: app + server tsc --noEmit green in this session. [uncommitted]
