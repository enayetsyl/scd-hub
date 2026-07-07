# Manual Test Plan — by Feature, by Role

> Working checklist for a full manual pass of the app. Generated 2026-06-22 (branch `feat/comments-any-teacher`).
> Grounded in the live `/shared/vocab.ts` role→permission map, the `docs/prd-*.md` contracts, the `app/src/screens/**` screens, and the `server/src/modules/**` resolvers — not guessed. Tick `- [ ]` as you go.

---

## How to use this file (it is both the test plan AND the bug report)

| Field | Value |
|---|---|
| Tester | _your name_ |
| Date started | _____ |
| Build / commit | _____ (e.g. `git rev-parse --short HEAD`) |
| Environment | _local / dev (dev.scdhub.shafayet.me) / prod_ |

**Per test:** run the check, then set its box → `[x]` = tested & passing, leave `[ ]` = not yet, and mark a failing check with **⚠️** (e.g. `- [ ] ⚠️ ...`).
**When something fails:** add a row to the [**🐞 Bug / Issue log**](#-bug--issue-log) with a `BUG-NNN` id, the feature + role, and what you saw. (Reference that id next to the ⚠️ check if you like.)
**When a whole feature is done** (all checks passing or their bugs logged): tick it in [**✅ Testing progress**](#-testing-progress).

---

## ✅ Testing progress

**1 · Platform**
- [x] [Authentication & Login](#authentication--login)
- [x] [Navigation & Access shell](#navigation--access-shell)
- [x] [Roster / Sections / Class-teacher admin](#roster--sections--class-teacher-admin) — **BUG-001** fixed (prod re-sync, 2026-07-07); **BUG-002** placeholder localized, section proper-name EN deferred (needs `nameEn`)
- [x] [Staff & User admin](#staff--user-admin) — passed; notes: supervisory = the "Oversight access" card (confirmed working), guardian link is roster-import-only; enhancements **ENH-001–ENH-005**
- [x] [Access Control (AC-1/AC-2)](#access-control-ac-1ac-2)
- [x] [Message Templates](#message-templates)

**2 · Lesson Plan / Content / Assessment**
- [x] [Lesson Plan / Content](#lesson-plan--content)
- [x] [Plan Review / Approval loop](#plan-review--approval-loop)
- [ ] [Question Bank & Set Assembly](#question-bank--set-assembly)

**3 · Trackers**
- [ ] [Homework Tracker](#homework-tracker)
- [ ] [Assignment Tracker](#assignment-tracker)
- [ ] [Class Test Tracker](#class-test-tracker)
- [ ] [Vocabulary Tracker](#vocabulary-tracker)
- [ ] [Saturday Revision (Qur'an-Hifz)](#saturday-revision-quran-hifz)

**4 · Daily Operations**
- [ ] [Routine / Timetable](#routine--timetable)
- [ ] [Attendance](#attendance)
- [ ] [Comments & Parent Meetings](#comments--parent-meetings)
- [ ] [Classroom Observation](#classroom-observation)

**5 · HR & Finance**
- [ ] [HR — Staff records](#hr--staff-records)
- [ ] [HR — Leave](#hr--leave)
- [ ] [HR — Payroll](#hr--payroll)
- [ ] [HR — Performance / Conduct / Development](#hr--performance--conduct--development)
- [ ] [HR — Offboarding](#hr--offboarding)
- [ ] [Finance / Accounting](#finance--accounting)

**6 · Library, Chat, Notifications, Guardian Portal**
- [ ] [Library](#library)
- [ ] [Messaging / Staff Chat](#messaging--staff-chat)
- [ ] [Notifications](#notifications)
- [ ] [Guardian Portal](#guardian-portal)

---

## 🐞 Bug / Issue log

Log every failed check here. **Severity:** 🔴 Blocker · 🟠 High · 🟡 Medium · 🟢 Low (cosmetic).
**Status:** Open · In progress · Fixed · Verified · Won't fix · Can't reproduce.

| ID | Date | Feature / Section | Role | Sev | What happened — expected vs actual (+ steps) | Status |
|---|---|---|---|---|---|---|
| BUG-001 | 2026-06-22 | Roster — student list (Admin→Roster) | Principal/Office (admin), **PROD** | 🔴 | Picking a section in **Class 3 / 4 / 5** shows an empty roster (count 0); Nursery–KG–1–2 populate normally. Prod-only; passes on dev/local. → full write-up in [Bug details](#-bug-details-comprehensive--for-the-fixing-agent). | Fixed (2026-07-07 — prod data re-synced) |
| BUG-002 | 2026-06-22 | Section config / class + section names | Principal/Office (admin), **EN language** | 🟡 | With language = English, class & section names and the "combined name" input placeholder still render in **Bangla**. → full write-up in [Bug details](#-bug-details-comprehensive--for-the-fixing-agent). | Fixed-partial (2026-07-07: placeholder localized; section proper-name EN deferred) |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |

> Add more rows as needed. For bugs you want to act on later, you can also promote them into `docs/issues/BACKLOG.md` (the repo's `BUG-NNN` backlog).

### 🔎 Bug details (comprehensive — for the fixing agent)

#### BUG-001 — Roster shows an EMPTY student list for Class 3 / 4 / 5 (PROD only) — 🔴
- **Environment:** Production (`https://scdhub.shafayet.me`). Reported 2026-06-22. Believed prod-only — the same check passes on dev/local (and for Nursery–KG–1–2 on prod), so this is almost certainly **prod data**, not app/server logic.
- **Role / login:** admin (Principal or Office — both hold `roster:manage`).
- **Repro:** Log in as Principal/Office on prod → **Admin → Roster** → "Pick section" → choose a section in **Class 3** (repeat for 4, 5) → the student list is empty (EmptyState) and the header count reads 0. Pick a **Nursery/KG/Class 1/Class 2** section → students DO appear. So the break is class-specific (3–5), not a global outage.
- **Expected:** Each picked section lists its enrolled `active` students (as Nursery–2 do, and as all classes do on dev/local).
- **Actual:** Class 3/4/5 sections return 0 students on prod.
- **Code path (verified CORRECT — not the bug):**
  - App: [app/src/screens/admin/RosterScreen.tsx](app/src/screens/admin/RosterScreen.tsx) → `ROSTER_QUERY` with `sectionId` from `SectionContext` → renders `data.studentsInSection`.
  - Server: [server/src/modules/foundation/resolvers/students.ts:70-80](server/src/modules/foundation/resolvers/students.ts#L70-L80) → `Student.find({ sectionId: args.sectionId, active: true }).sort({ name: 1 })`. **No academic-year or class-level filter** — it purely matches `sectionId` + `active`. So an empty result means no `active` Student doc has `sectionId === <the picked section's _id>`.
- **Root-cause hypotheses (prod DATA), most→least likely:**
  1. **Section `_id` mismatch.** The prod `sections` docs for classes 3–5 have different `_id`s than the `sectionId` stored on those students (e.g. the academics sync UPSERTed/recreated sections, so `student.sectionId` now points at an old/orphaned section id while the SectionPicker lists the new one). Students are effectively orphaned for those sections.
  2. **Class 3–5 students not synced / inactive on prod** (`active: false`, or missing entirely).
  3. **Academic-year divergence** — 3–5 students enrolled under sections of a different academic year than the ones the picker lists on prod.
- **Diagnostics for the fixer** (run DB ops **from the VM, not a laptop** — dynamic IP → `tls:internal` per ops notes):
  - Prod app: **Admin → Section config** → check per-section `studentCount` for Class 3–5. If 0 there too, it confirms the picker's section `_id` has no students by `sectionId`.
  - `db.students.aggregate([{ $match:{active:true} }, { $group:{ _id:"$classLevel", n:{$sum:1} } }])` → are 3/4/5 present at all on prod?
  - For a Class-3 section id `S` shown in the picker: `db.students.countDocuments({ sectionId: S })` (expect >0; if 0 → id mismatch) and `db.sections.find({ level: 3 })` to compare `_id`s.
  - `db.students.find({ classLevel: 3 }, { sectionId:1, active:1 })` → do those `sectionId`s resolve to an existing `sections._id`? Orphans confirm hypothesis 1.
  - Compare prod vs local for the same students/sections (local is the sync source; see `server/scripts/sync-academics.ts`).
- **Likely remediation (DATA, not the resolver):** re-run the academics/roster sync so `student.sectionId` aligns with prod section `_id`s, or repoint orphaned `student.sectionId`s. Investigate why only 3–5 diverged (partial sync / upsert match-key) and confirm 3–5 sections weren't duplicated on prod. If a *code* fix is warranted, it's in the sync/upsert logic (preserve section `_id`s), not in `studentsInSection`.
- **✅ RESOLUTION (2026-07-07):** fixed by re-syncing the prod roster/academics so `student.sectionId` aligns with prod section `_id`s (it was a data divergence, not a resolver bug, as diagnosed). Class 3/4/5 sections now list their students on prod. **Status: Fixed.**

#### BUG-002 — English language mode still shows class/section names + combined-name placeholder in Bangla — 🟡
- **Environment:** observed on prod with app language = **English**; almost certainly reproduces on all envs (it's client i18n, not data-env specific). Reported 2026-06-22.
- **Role / login:** admin (Principal/Office), language set to English via the 👤 account menu.
- **Repro:** Set language → English → **Admin → Section config** (and **Admin → Roster**) → class names and section names display in Bangla; the **"Combined section name"** input placeholder shows `সম্মিলিত`.
- **Expected:** in English mode, labels/placeholders render in English.
- **Actual:** Bangla.
- **Affected code:**
  - [app/src/screens/admin/SectionConfigScreen.tsx:84](app/src/screens/admin/SectionConfigScreen.tsx#L84) — `placeholder="সম্মিলিত"` is a **hardcoded Bangla literal**, not language-aware. → replace with a localized `STR.*` key (BN/EN).
  - [SectionConfigScreen.tsx:97](app/src/screens/admin/SectionConfigScreen.tsx#L97) — `{classLevelLabel(c.level)} · {c.nameBn}`: `classLevelLabel` IS language-aware (good), but `c.nameBn` is always Bangla.
  - [SectionConfigScreen.tsx:103](app/src/screens/admin/SectionConfigScreen.tsx#L103) — `<Row label={s.nameBn} …>`: always-Bangla section name.
  - [app/src/screens/admin/RosterScreen.tsx:104-105](app/src/screens/admin/RosterScreen.tsx#L104-L105) — `selection.classNameBn ?? …` and `selection.sectionNameBn`: always Bangla. (The SectionPicker / `SectionContext` likely store `*NameBn` only — check there too.)
- **Root cause:** class/section **proper names are read from the stored `nameBn` field directly** with no English counterpart used; the merge mutation (`MERGE_SECTIONS`) only accepts `combinedNameBn`, so combined sections are Bangla-only by data model. (`bnNum` and `classLevelLabel` ARE language-aware and are the pattern to follow — `bnNum` correctly returns Latin digits in EN, so it is NOT part of this bug.)
- **Fix direction (a product decision is needed):**
  - **Low-risk immediate:** localize the hardcoded placeholder at line 84 (add an `STR` key) — fixes the most jarring part.
  - **Full fix:** add `nameEn` to the Class/Section model (+ a `combinedNameEn` arg on `MERGE_SECTIONS`) and pick BN/EN at render via the existing `pick()` helper; or, if section names are accepted as untranslated proper nouns, document that and only localize the surrounding chrome (placeholders, labels).
- **✅ RESOLUTION (2026-07-07, PARTIAL):** did the low-risk immediate fix — the hardcoded `placeholder="সম্মিলিত"` at [SectionConfigScreen.tsx:84](app/src/screens/admin/SectionConfigScreen.tsx#L84) is now a localized `STR.scCombinedNamePlaceholder` (BN "সম্মিলিত" / EN "Combined"). **DEFERRED (needs a product decision):** class/section *proper names* (`c.nameBn` / `s.nameBn` at SectionConfig lines 97/103, RosterScreen 104-105) stay Bangla — localizing them requires a `nameEn` model field (+ `combinedNameEn` on `MERGE_SECTIONS`) or an explicit "proper nouns stay Bangla" ruling. **Status: Fixed-partial.**

---

## 📋 Enhancement / change requests (found during testing)

These are **new functionality / change requests** raised by the owner during testing — not defects (the existing checks pass). Each is scoped for a future build agent.

| ID | Date | Area | Summary | Priority |
|---|---|---|---|---|
| ENH-001 | 2026-06-22 | User admin / Auth / Scope grants / Routine / Notifications | Add **deactivate/remove user** with full access teardown + vacancy backfill + admin notification | High |
| ENH-002 | 2026-06-22 | Scope grants (proxy) / Content / Trackers / Attendance | Proxy grants must carry a **subject** (per subject/class/day); proxy teacher gets the subject's lesson plan + trackers + attendance for the cover window | High |
| ENH-003 | 2026-06-22 | Staff list (Principal) | Add a **search field** to the staff list | Low |
| ENH-004 | 2026-06-22 | Admin home / labels | **Rename the "Oversight access" card** so the supervisory-grant screen is discoverable (owner couldn't find it by that name) | Low |
| ENH-005 | 2026-06-22 | Guardian credentials / linking | **Manual guardian↔child link/relink UI** (today linking is roster-import-only; the screen provisions logins, can't link) — ✅ confirmed wanted by owner | Med |
| ENH-006 | 2026-06-22 | Plan Review / content-review assignment | **Surface review UNASSIGN + reviewer-centric view** — click a reviewer → see all plans assigned to them for review → uncheck to unassign (cancel). `cancelPlanReview` + the app op exist but have NO UI button | Med |

#### ENH-001 — Deactivate / remove a user (access teardown + vacancy backfill + notify)
- **Requested by owner, 2026-06-22.** Principal can *create* a user but there is no way to **remove/deactivate** one.
- **Current state (verified):**
  - `createUser` exists ([server/src/modules/foundation/resolvers/users.ts](server/src/modules/foundation/resolvers/users.ts)); **no** `deactivateUser`/`setUserActive`/`removeUser`/`updateUser` mutation. [app/src/screens/admin/UserListScreen.tsx](app/src/screens/admin/UserListScreen.tsx) offers create only.
  - The `User` model already has an **`active: boolean`** field (exposed on `UserRef`; the `teachers` query filters `active: true`) — so the data layer supports active/inactive; nothing toggles it.
  - Closest existing teardown = **HR Offboarding** `revokeOffboardingAccess` (`staff:manage`): disables the login + revokes ALL scope grants. But it is (a) tied to an offboarding *case*, (b) in the HR module, not the Users screen, (c) does **not** blank routine slots or class-teacher/subject-teacher assignments beyond scope-grant revocation, and (d) does **not** notify admins of resulting vacancies.
- **Requested behavior:**
  1. Principal can deactivate/remove a user from **Admin → Users**. Prefer **soft-deactivate** (`User.active=false`), never hard-delete (preserve history/audit — mirrors offboarding's "never delete" posture).
  2. On deactivate: the user **cannot log in** and **loses all access** immediately (revoke/expire all teaching, supervisory, and proxy scope grants).
  3. **Cascade to vacancies:** clear the user's positions — class-teacher assignment(s), subject-teacher (teaching) assignments, routine slots where they're the assigned teacher, marker-of-the-day assignments, librarian assignment — so each slot reads as *vacant/unassigned*.
  4. **Notify:** emit a notification to **Principal + Office** listing the now-vacant positions to re-fill (e.g. "Teacher X deactivated — class-teacher of Section Y, subject-teacher for …, N routine slots are now vacant").
- **Implementation pointers / decisions:**
  - `AuthService` staff login must reject `User.active=false` (today it checks `guardian.loginEnabled`; add/confirm the staff `active` gate).
  - Reuse the offboarding teardown (`revokeOffboardingAccess` / `ScopeGrantService` revoke-all) rather than re-implementing scope revocation. **Decide whether "remove user" should simply trigger/share an HR Offboarding case** — they overlap heavily; avoid two divergent teardown paths.
  - Routine slots / class-teacher / subject-teacher assignments need cascade logic in the routine + foundation modules (a vacant slot must be representable; routine has conflict detection to respect).
  - New notification kind (e.g. `STAFF_DEACTIVATED_VACANCIES`) → add to vocab `NOTIFICATION_KINDS` + the §C list (two-place if mirrored).
- **Scope:** a real multi-module build (foundation users/auth/scope-grants + routine + HR offboarding + notifications + vocab + app UI), not a quick fix.

#### ENH-002 — Proxy grants need a SUBJECT dimension + proxy operational access
- **Requested by owner, 2026-06-22.** A teacher on leave may assign **different cover teachers for different subjects, in different classes, on different days** — so proxy must be subject-aware, not whole-section.
- **Current state (verified):**
  - Manual proxy assignment (**Admin → Scope grants → Assign proxy**, [app/src/screens/admin/ScopeGrantScreen.tsx:170-193](app/src/screens/admin/ScopeGrantScreen.tsx#L170-L193)) collects covering teacher, absent teacher, academic year, **class, section**, start date, duration — **no subject**. The `assignProxy` mutation args mirror that (no `subjectId`). So a manual proxy currently covers a whole section (all subjects).
  - A *separate* path — `RoutineCoverService` (routine cover) — already stamps a covered **subject** on the proxy, and content read-scope keys on subject+class for proxies (D-#257). So the **ScopeGrant data model can already carry a subject**; the manual screen + mutation just don't expose/collect it.
- **Requested behavior:**
  1. Proxy assignment selects **subject** in addition to class + section (and ideally specific day(s)/date(s)); support multiple per-subject/per-day proxy grants for one absence.
  2. For the covered subject+class+window, the proxy teacher can see/do: the **lesson plan** for that subject, the **homework tracker**, **attendance** (if any that day), **assignment** (if any), etc. — scoped to the covered subject.
- **Current behavior to fix/verify:**
  - Content read-scope: a subject-less proxy gets **no** content scope (the known under-grant, D-#257) — adding subject to the manual proxy fixes lesson-plan visibility for manual covers.
  - Tracker write-scope (homework/assignment/class-test) currently keys on the proxy's class/section (all subjects). With a subject dimension it should **narrow to the covered subject** — a scope-tightening change to verify across content + trackers + attendance resolvers.
- **Implementation pointers:** add `subjectId` (+ optional day/date) to `assignProxy` + a cascading SubjectSelect on `ScopeGrantScreen`; align the manual ScopeGrant path with `RoutineCoverService` (which already sets subjectId) so the two proxy sources stay consistent; reconcile "duration window" vs "per-date/weekday" granularity; respect proxy expiry (extend/revoke) and the PII firewall.
- **Scope:** feature change spanning ScopeGrantScreen + `assignProxy` + ScopeGrant model + content/tracker/attendance scope resolvers; coordinate with the routine-cover path.

#### ENH-003 — Staff list search field (Principal)
- **Requested by owner, 2026-06-22.**
- **Current state (verified):** [app/src/screens/admin/StaffListScreen.tsx](app/src/screens/admin/StaffListScreen.tsx) has no search/filter field.
- **Requested behavior:** a search field on the Principal staff list (filter by name; ideally also id/phone/category).
- **Implementation pointer:** mirror the existing pattern in [app/src/screens/admin/RosterScreen.tsx:131](app/src/screens/admin/RosterScreen.tsx#L131) (a `Field` + `useState` + client-side `.filter()` over the loaded list). App-only, low effort; no server change unless the list grows large.

#### ENH-004 — Supervisory-grant screen is not discoverable (card label)
- **Raised by owner, 2026-06-22:** "couldn't find any supervisory screen to create a supervisory grant."
- **Reality (verified — the feature EXISTS and works):** Admin → the card titled **"Oversight access"** (EN) / **"তত্ত্বাবধান অ্যাক্সেস"** (BN), subtitle *"Let a teacher see other classes' lesson plans"* → opens [app/src/screens/admin/SupervisoryGrantScreen.tsx](app/src/screens/admin/SupervisoryGrantScreen.tsx), which grants/revokes a read-oversight grant at extent whole_school / subject_dept / grade_class / explicit_set (`GRANT_SUPERVISORY`/`REVOKE_SUPERVISORY`). Card is at [AdminHomeScreen.tsx:59-64](app/src/screens/admin/AdminHomeScreen.tsx#L59-L64), gated `user:manage` (Principal-only) — so it IS shown to the Principal.
- **Issue:** the label "Oversight access" doesn't match the owner's / test-plan term "supervisory grant," so it reads as missing.
- **Fix:** rename/clarify `STR.sgManage` ([labels.ts:1238 BN](app/src/lib/labels.ts#L1238) / [:3129 EN](app/src/lib/labels.ts#L3129)) to e.g. "Supervisory (oversight) access". Pure label change, BN+EN, app-only.
- **Priority:** Low (usability/discoverability — the function is present).

#### ENH-005 — No manual guardian↔child link / relink UI (linking is import-only)
- **Raised by owner, 2026-06-22:** in Guardian credentials there's only "Generate login" + "Reset password" — no link/provision-to-child option.
- **Reality (verified):** [app/src/screens/admin/GuardianCredentialsScreen.tsx](app/src/screens/admin/GuardianCredentialsScreen.tsx) provisions ONE shared family login per phone (`PROVISION_GUARDIAN_LOGIN`) + resets it (`RESET_GUARDIAN_PASSWORD`). Its candidate list = family phones whose guardian↔student links **already exist from the roster import** (D-#31); the login then reaches every sibling on that phone. So **provisioning is present** ("Generate login"); what's absent is a manual **guardian↔child link/relink** screen.
- **Gap:** no admin UI to (a) link a guardian to a child not created by import, (b) add a second guardian to a child, or (c) fix/remove a wrong link.
- **Implementation pointers:** check whether a server link mutation already exists (the import path writes `GuardianLink` rows — see `ProvisioningService` / `guardians.ts`); if so this is app-only, else add `linkGuardianToStudent`/`unlinkGuardian` (`guardian:link`) + a screen. Respect the family-phone-keyed single-login model (D-#59) and the guardian-plane firewall.
- **Priority:** Medium — ✅ **confirmed wanted by owner (2026-06-22).** Today linking is fully roster-import-driven; owner wants a manual "link a guardian to a child" screen (also supporting add-second-guardian / relink / unlink).

#### ENH-006 — Surface review UNASSIGN (cancel a review round) + a reviewer-centric view
- **Requested by owner, 2026-06-22** (clarified: this is for **content review / Plan Review**, NOT teaching/routine grants). Wants to click a reviewer's name → see all the plans assigned to them for review → uncheck to unassign.
- **Current state (verified):** the **cancel/unassign already exists end-to-end at the data layer but has NO UI.** `cancelPlanReview` (R1.6) lives in [ReviewService.ts:334](server/src/modules/content/services/ReviewService.ts#L334) + resolver [review.ts:155](server/src/modules/content/resolvers/review.ts#L155) (gated `content:assign_review`), and the app already declares the op `CANCEL_PLAN_REVIEW` ([operations.ts:604](app/src/graphql/operations.ts#L604)) — but **no review screen calls it** (no unassign/cancel button anywhere in `app/src/screens/review/`). [AssignReviewsScreen.tsx](app/src/screens/review/AssignReviewsScreen.tsx) shows only a per-reviewer **load overview** (open/awaiting/decided counts) + bulk ASSIGN; you can't drill into a reviewer's assigned plans, and there's no unassign.
- **Requested behavior:**
  1. **Reviewer-centric view:** click a reviewer (e.g. from the load overview) → expand to the plans currently assigned to them → **unassign (cancel)** any (checkbox / Remove), bulk-friendly.
  2. Also surface single-plan unassign on `ReviewThread` (a Cancel button on an open round).
- **Notes for the fixing agent:**
  - **Permission already fits "Principal + admin":** `cancelPlanReview` is `content:assign_review`, held by **both Principal AND Office** — so NO permission change is needed (unlike the teaching-grant case).
  - `cancelPlanReview` only cancels an **OPEN** round (submitted/decided/superseded → rejected "cannot be cancelled"), so the UI should offer unassign only on open rounds.
  - **Mostly app-side:** wire the existing `CANCEL_PLAN_REVIEW` op to a button + add a "reviewer → their open assignments" list (a new query, or expand `reviewerAssignmentLoad` / `myReviewAssignments`). "Chapter" here = the plan/lesson assigned for review.
- **Priority:** Medium (plumbing exists; mainly a UI view + one list query).

---

## How to read this

The system has **only 4 auth roles**: `PRINCIPAL`, `TEACHER`, `OFFICE`, `GUARDIAN`. The functional roles you think in terms of ("class teacher", "subject teacher", "reviewer", "cover teacher") are all a **TEACHER wearing a different ScopeGrant**. The headings below are the functional roles; the permission/gate is noted so you know *why* something is or isn't visible.

| Functional role | Auth role | What makes it that role |
|---|---|---|
| **Principal** | `PRINCIPAL` | super-admin, unscoped, holds every reserved perm |
| **Office** | `OFFICE` | admin/accountant: roster, HR, payroll(prepare), finance, content-import, routine, attendance, library desk, chat+groups, observation-upload |
| **Subject Teacher** | `TEACHER` | a **TEACHING** ScopeGrant on own section(s) — read content, assemble sets, write trackers, mark attendance (if marker-of-day) |
| **Class Teacher / Coordinator** | `TEACHER` | a **SUPERVISORY** grant (read-only oversight over an extent) + the section **daily-coordinator** gate (homework reconcile/issue, attendance, meeting comments) |
| **Reviewer** | `TEACHER` | assigned a plan-review round (`content:review`) — gated to assigned rounds |
| **Cover / Proxy Teacher** | `TEACHER` | a time-bounded **PROXY** grant for a covered class (read plans, assemble, write trackers — that class only, expires at window end) |
| **Guardian** | `GUARDIAN` | `guardian:read_child` only — linked children's *delivered/published* slices, walled off from everything staff-internal |

There is **no separate "Owner" login**. "P/O" in the docs means *Principal or Office*. **Students are data-only** (no login).

### As-built nuances to watch (these tripped up the role-model summary; verified against code)
- **The 5 RESERVED, Principal-ONLY permissions** — even an Access-Control grant to Office is structurally stripped:
  `payroll:approve`, `performance:signoff`, `chat:oversee`, `template:manage`, `access:manage`. These are the **highest-value negative tests** — Office must be blocked.
- **Office does NOT hold `user:manage` in this build** → no Users / Scope-grant / subject-teacher-assign / supervisory-grant / staff-credentials cards for Office. Those admin surfaces are Principal-only here, despite "P/O" elsewhere.
- **Office holds `library:manage` by default** (it *is* the library desk), but **not** `tracker:*`, `question:*`, `set:*`, `content:review`, `content:promote_gold`, `audit:read`.
- **`content:review` belongs to TEACHER (+ Principal), not Office.** Office can *assign* reviews and *promote nothing*.
- **Question-bank visibility is scoped subject-only** (looser than chapter/session plans, which scope subject **+** class). Worth a tester's eye when a teacher sees a question for a class they don't teach.
- **In-flight on this branch:** *any* teacher can now comment on *any* student (D-#263), and **delivery of comments is Principal/Office only** (D-#264). The teacher entry screen shows a "delivery handled by admin" note. Verify both.

### Suggested test fixtures (so you can exercise each hat)
- One **Principal**, one **Office**, and at least **two Teacher** logins.
- Teacher A: a **teaching** grant on Section X (subject S). Teacher B: a **teaching** grant on a *different* section (so you can prove cross-section denial).
- Give Teacher A a **supervisory** grant (whole-school or one grade) → that's your "Class Teacher / Coordinator".
- Assign Teacher B a **plan-review round** → that's your "Reviewer".
- Create a **leave** for Teacher A, propose+approve Teacher B as **cover** → that mints Teacher B's **proxy** grant (your "Cover Teacher").
- One **Guardian** login linked to a child in Section X (and confirm it is *not* linked to another child for the negative tests).

### Legend
- `- [ ]` an action → its expected result.
- **"Negative / RBAC checks (must be BLOCKED)"** = the action must be denied / the control must be absent. These are as important as the happy paths — they prove the permission walls hold.

---

# 1 · Platform — Login, Navigation, Admin

## Authentication & Login
*What it is:* Per-role login (staff email or guardian phone via one field), JWT session, BN/EN toggle, account menu, logout. *Where:* `screens/auth/LoginScreen.tsx`; header 👤 account menu + 🌐 toggle in `navigation/AppTabs.tsx`.
### Principal
- [x] Log in with Principal email + password → lands on the staff app shell; drawer shows all staff groups + Admin ⚙️.
- [x] Open 👤 account menu (top-right) → name, language row, "Report a problem", Logout all present.
- [x] Tap Logout → returns to LoginScreen; reopening the app does not auto-restore the session.
### Office
- [x] Log in with Office email + password → shell loads with Office-permitted items (no Content/Questions/Sets). **Correction (verified 2026-06-22):** the **Review** item DOES appear for Office and Office CAN assign a reviewer — this is *correct* behavior (`content:assign_review`: assign + read inbox); Office still cannot APPROVE or promote-to-gold. The earlier "no Review" wording was a checklist error, not a bug.
### Teacher (Subject/Class)
- [x] Log in with Teacher email + password → shell loads with teaching groups; Admin ⚙️ tab absent. **Note (verified 2026-06-22):** a **Staff** group showing "My Leave" + "My Record" also appears — this is expected HR self-service (own-row, no permission required). Not a leak (no staff-admin/other-staff data). ✅ *Confirmed intended by owner (2026-06-22) — expected behavior, not a bug.*
### Guardian
- [x] Log in with the family phone (`01XXXXXXXXX`) + password → guardian portal loads (Home + Academics only), no staff tabs.
### Negative / RBAC checks (must be BLOCKED)
- [x] Enter a wrong password → a Bangla error Notice shows; no session is created and no tab shell loads.
- [x] App default language on first launch is Bangla (BN); toggling to English persists across a reload, then toggle back.
- [x] A logged-out (no JWT) attempt to deep-link any in-app screen → bounced to LoginScreen (no protected screen renders).

## Navigation & Access shell
*What it is:* Grouped hamburger drawer / collapsible web sidebar; each route registers only when the role holds its gating permission; guardian sees a walled-off tab set. *Where:* `navigation/AppTabs.tsx`, `navigation/DrawerContent.tsx`.
### Principal
- [x] Open the drawer → "Academics" group (Content/Questions/Sets/Review/Routine/Vocab) and "Trackers" group (Daily Tracker/Homework/Assignment/Class Test/Revision) both render, plus Attendance/Comments/Observation/Library/Chat/Finance/HR/Admin flat items.
- [x] On web ≥1024dp the sidebar is permanent; tap ☰ → it collapses to width 0 and the content reflows to full width; tap ☰ again → it re-expands.
### Office
- [x] Open the drawer → Admin ⚙️, Routine, Vocab, Library, Chat, Attendance, Comments, Observation, Class Test, Assignment, Finance, and Review all present; Content/Questions/Sets do NOT render. *[verified 2026-06-22 — all correct, no bug]* Office holds: `content:assign_review` (Review = assign + inbox, no approve/promote), `routine:read/manage`, `attendance:manage`, `observation:upload/read/manage`, `finance:manage`, `roster:manage`, `library:*`, `chat:read/write/manage`. **Vocab is gated by `roster:manage` (NOT `tracker:read`)** — Office sees it to assign the weekly tester + generate guardian messages, but cannot build/mark tests. Likewise Class Test & Assignment appear via `roster:manage`/`message:dispatch` (print-queue, dashboard, schedule, chase) but Office cannot enter results / deliver-collect-check (no `tracker:write`). Every action is re-gated server-side.
### Teacher (Subject/Class)
- [x] Open the drawer → Academics + Trackers groups render; Admin ⚙️ item is absent (no content:import/user:manage); Finance absent (no finance:manage). A **Staff** self-service group (My Leave / My Record) IS present (HR self-service, own-row). *[corrected 2026-06-22]*
- [x] On a narrow/phone width, ☰ opens a slide-over drawer overlay (not a permanent sidebar).
### Guardian
- [x] Open the drawer → ONLY "আজ/Home" + an Academics group with Routine/Homework/Assignments; no Trackers group, no Admin, Chat, Library, Finance, HR.
### Negative / RBAC checks (must be BLOCKED)
- [x] Guardian drawer shows NO staff item (Trackers, Chat, Admin, Library, Observation, Finance, HR all absent — staff route names are never registered for GUARDIAN).
- [x] Teacher's drawer shows no Admin ⚙️ entry and an empty group collapses out (a group with zero permitted leaves does not render its header).
- [x] Office's drawer shows no Content/Questions/Sets, **but Review IS present** (Office holds `content:assign_review`); the Academics group renders only its permitted leaves. *[corrected 2026-06-22]*

## Roster / Sections / Class-teacher admin
*What it is:* Classes/sections (auto "Main"), section config, class-teacher assignment, academic-year set-current (set-once), students roster (Nursery..Class5). *Where:* admin `RosterScreen`, `SectionConfigScreen`, `AssignClassTeacherScreen`, `AcademicYearScreen` (gated `roster:manage`).
### Principal
- [x] Admin → Roster → student list loads; counts render — **BUG-001 FIXED (2026-07-07, prod re-sync): Class 3/4/5 now populate on prod.**
- [x] Admin → Section config → a class with a single section shows "Main"; edit section settings and save. **BUG-002 (2026-07-07): combined-name placeholder now localizes (EN "Combined"); class/section proper names still Bangla — deferred, needs `nameEn`.**
- [x] Admin → Assign class teacher → pick a section, assign a teacher → assignment persists and shows on reopen.
- [x] Admin → Academic year → set the current year once → it is marked current; attempting to change a set year is blocked/guarded (set-once).
### Office
- [x] Admin → Roster, Section config, Assign class teacher, Academic year all reachable (Office holds roster:manage).
### Negative / RBAC checks (must be BLOCKED)
- [x] Teacher has no Admin ⚙️ tab → Roster / Section config / Class-teacher assignment are unreachable.
- [x] Guardian cannot reach any roster/section admin (no Admin tab; server roster:manage gate denies any forced call).

## Staff & User admin
*What it is:* Staff list, create/manage staff logins (`user:manage`), guardian credentials (`guardian:link`), scope grants (teaching/supervisory/proxy), guardian linking. *Where:* admin `StaffListScreen`, `StaffCredentialsScreen`, `UserListScreen`, `ScopeGrantScreen`, `SupervisoryGrantScreen`, `GuardianCredentialsScreen`.
### Principal
- [x] Admin → Users → staff login list loads; create/manage a staff login (user:manage). *(No deactivate/remove action yet → **ENH-001**.)*
- [x] Admin → Scope grants → create a teaching/proxy grant for a teacher → grant appears. *(Proxy form has class+section but no subject → **ENH-002**.)* ✅ **Supervisory grant confirmed working (owner, 2026-06-22)** — it's the separate Admin card labeled **"Oversight access / তত্ত্বাবধান অ্যাক্সেস"** (not under Scope grants). Optional rename for discoverability → **ENH-004**.
- [x] ⚠️ Admin → Guardian credentials → **provisions/resets the family login** ("Generate login" + "Reset password", keyed by family phone). The guardian↔child **link itself is created by the roster import, NOT a manual UI here** — no manual link/relink option. If manual linking is wanted → **ENH-005**.
- [x] Admin → Staff → staff directory loads with counts. *(No search field → **ENH-003**.)*
### Office
- [x] Admin → Staff (staff:manage) and Guardian credentials (guardian:link) reachable.
- [x] Office canNOT see Users / Scope grants / Subject-teacher / Supervisory cards (those are gated `user:manage`, which Office lacks).
### Negative / RBAC checks (must be BLOCKED)
- [x] Office opens Admin → the "Users", "Scope grants", "Assign subject teacher", "Supervisory grant", and "Staff credentials" cards are NOT present (all `user:manage`, Principal-only here).
- [x] Teacher has no Admin tab → no staff/user admin reachable; a forced server mutation is denied.
- [x] Guardian cannot reach any staff/user admin (walled-off plane; no Admin tab).

## Access Control (AC-1/AC-2)
*What it is:* Principal-only per-user permission editor — add Teacher/Office templates, grant/revoke per person; the 5 RESERVED perms are ungrantable to non-Principal. *Where:* admin `AccessControlUsersScreen` + `AccessControlEditScreen` (entry gated `access:manage`).
### Principal
- [x] Admin → "অনুমতি পরিচালনা / Access Control" card is present → opens the staff-user list.
- [x] Open a Teacher → add the Office template chip → effective set gains roster:manage/leave:manage (multi-template union); save persists.
- [x] On one Teacher remove `tracker:export` and add `library:manage` → that row reflects "সরানো হয়েছে"/"যোগ করা হয়েছে"; a second same-template teacher is unchanged (per-person tuning).
- [x] A reserved perm row (chat oversight / template / payroll-approve / performance-signoff / access:manage) renders as "সংরক্ষিত" and is non-toggleable.
### Negative / RBAC checks (must be BLOCKED)
- [x] Office opens Admin → the Access Control card is NOT present (`access:manage` is Principal-only RESERVED).
- [x] Teacher and Guardian have no path to Access Control at all (no Admin tab).
- [x] Attempt (e.g. via a forced mutation) to grant `payroll:approve`/`chat:oversee`/`template:manage`/`access:manage`/`performance:signoff` to a Teacher → rejected with a Bangla 422; even if forced into a template, the backstop filter drops it for the non-Principal.
- [x] Attempt to grant `guardian:read_child` to a staff User → rejected (the guardian-plane wall); a staff perm cannot be added to a Guardian.

## Message Templates
*What it is:* Principal-only editor for generated message bodies (override-wins, reset-to-default, BN/EN/both, placeholder-validated). *Where:* admin `MessageTemplatesScreen` + `MessageTemplateEditScreen` (gated `template:manage`).
### Principal
- [x] Admin → "বার্তা টেমপ্লেট / Message Templates" card present → list shows all keys grouped by feature with a default/overridden badge.
- [x] Edit a template's Bangla body using only its allowed placeholder chips → save succeeds; the new wording is what sends afterward.
- [x] Set langMode to English/Both with the English body filled → saves; clear the English body and try Both → blocked (empty-English guard).
- [x] Tap Reset-to-default on an overridden template → the override is removed, the badge flips back to default, and the change is audited.
### Negative / RBAC checks (must be BLOCKED)
- [x] Office opens Admin → the Message Templates card is NOT present (`template:manage` is Principal-only RESERVED).
- [x] Teacher / Guardian have no path to Message Templates.
- [x] Submit an edit using a placeholder the key does NOT declare → rejected with a Bangla error naming the allowed placeholder set; nothing is saved. ✅ **Passed (2026-06-22).** **HOW TESTED:** open a template → in the **Bangla body** field **hand-type a curly-brace token that is NOT one of the "Allowed placeholders" chips** (e.g. add `{foo}`) → tap **Save**. Expect a red Bangla error *অননুমোদিত প্লেসহোল্ডার "{foo}"…* listing the allowed set, and NO save (badge unchanged, no new history row). Server enforces it at [MessageTemplateService.ts:242-251](server/src/modules/templates/services/MessageTemplateService.ts#L242-L251) (scans BN **and** EN bodies). Tapping chips only inserts allowed tokens, so the bogus one must be typed by hand.

---

# 2 · Lesson Plan / Content / Assessment

## Lesson Plan / Content
*What it is:* Browse imported chapter/session plans (rendered markdown, never re-rendered) and import new content; teacher read-visibility is driven by the routine (subject + classLevel, D-#257). *Where:* Content tab → `ContentTree` (Subject×Class → Chapter → plan list) → tap a plan → `PlanView`; import lives in Admin tab → `Import`.

### Principal
- [x] Open the Content tab → see plans for **every** subject and class level (PRINCIPAL bypasses content scope, `scope.all = true`).
- [x] Open a plan in `PlanView` → rendered markdown shows, with `docType`, `curationTag`, and a `reviewStatus` badge (draft / reviewed / gold) in the matching color.
- [x] On web, tap **Export PDF** on a plan → server-rendered PDF opens (on native, "PDF web only" notice shows).
- [x] Admin tab → Import a plan JSON+MD pair → it lands at `reviewStatus = draft` and appears in `ContentTree` after the tab refocuses (gate: `content:import`).
- [x] Filter `ContentTree` by subject / class / plan-type / curation-tag → list narrows; clearing all filters restores the full tree.

### Office
- [x] **CORRECTED (verified 2026-06-22 — earlier checks were WRONG):** Office has **NO Content tab and cannot browse/open plans** — it lacks `content:read`. The tab gate `canContent` requires `content:read` ([AppTabs.tsx:888](app/src/navigation/AppTabs.tsx#L888)), and every content resolver (artifact/browse/tree) is gated `content:read` ([content.ts:229/257/295](server/src/modules/content/resolvers/content.ts#L229)). Office's content role is **Import only** (Admin → Import, `content:import`) **+ assign-review** (Review tab, `content:assign_review`). *(The deleted checks — "Office sees the Content tab / scope.all" and "open a plan + PDF" — were wrong; "scope.all" never applied because the `content:read` gate blocks Office first.)*
- [x] Admin tab → Import a plan JSON+MD pair (or a built envelope) → import succeeds (gate: `content:import`, held by Office).

### Subject Teacher
- [x] Open the Content tab → see plans only for the **exact subject+class you have a teaching grant on** (routine teaching grant → `pairs` set). A subject you teach for class 5 shows; the same subject for class 3 you don't teach does not.
- [x] Open a visible plan → markdown renders, status badge shows; confirm **no import button** in the app (Admin tab hidden — Teacher lacks `content:import`/`user:manage`).
- [x] Have an admin add you to the routine for a new subject → after re-login/refetch that subject's content becomes visible with no extra permission; have the grant revoked → it disappears.

### Class Teacher / Coordinator
- [x] With a **whole_school** supervisory grant, open Content → see all subjects/classes read-only (`scope.all`).
- [x] With a **subject_dept** grant → that one subject across **ALL** class levels, read-only (`subjects` set). ✅ **Passed (2026-06-22, via the Oversight access screen).** **NOTE:** this is a **Supervisory grant** — create it in **Admin → "Oversight access" → extent = subject_dept → pick the subject** — NOT via "Assign subject teacher". "Assign subject teacher" creates a **teaching** grant (exact subject+class from the routine), so the teacher sees only the subjects they teach — *that is correct behavior, not a bug.*- [x] With a **grade_class** grant → ALL subjects for ONE class/grade, read-only (`classLevels` set); **explicit_set** → only the listed subject+class pairs. ✅ **Passed (2026-06-22, via the Oversight access screen).** **NOTE:** also a **Supervisory grant** — Admin → "Oversight access" → extent = grade_class → pick the class. **Being assigned as "class teacher" does NOT grant this** (class-teacher = the section coordinator role for attendance/comments/report-card, not content oversight).- [x] Confirm content is **read-only** — no import, no assemble, no review/sign-off controls appear from a supervisory grant alone.

### Negative / RBAC checks (must be BLOCKED)
- [x] Subject Teacher opens a deep-link / direct `artifact` query for a subject+class they don't teach (and have no review assignment for) → `ForbiddenError`, plan not visible in tree or by id.
- [x] Teacher (no `content:import`) attempts the Import screen / `importEnvelope` mutation → denied; Admin tab is not even shown.
- [x] A proxy/cover teacher whose cover record carries **no subject** sees **no** content for that class (D-#257: no subject ⇒ no content scope).
- [x] Guardian login → **no Content tab at all** (GUARDIAN holds only `guardian:read_child`); no lesson-plan surface anywhere in the guardian portal.

## Plan Review / Approval loop
*What it is:* Assign a plan to a teacher reviewer → reviewer submits APPROVE / CHANGES_REQUESTED + feedback (APPROVE drives draft→reviewed) → admin copies feedback to Claude Desktop and re-imports → Principal signs off reviewed→gold. *Where:* Review tab → `ReviewHome` (Inbox + My reviews) → `AssignReviews` (bulk), `ReviewThread` (round history + assign/approve), `ReviewSubmit` (reviewer verdict form); assign/approve also available inline on `PlanView`.

### Principal
- [x] Review tab shows **both** the Inbox section (submitted rounds) and the My-reviews section.
- [x] On `PlanView` (or `ReviewThread`) of a plan, pick a teacher and **Assign for review** → success toast; reviewer's queue gets the round (gate: `content:assign_review`).
- [x] `AssignReviews` → see per-reviewer open-count overview, multi-select plans (filter by subject/class/status, "select all"), assign all to one teacher in one call; failures reported per-plan.
- [x] Open a `reviewed` plan → **Approve / sign off** button is enabled → tap → `reviewStatus` becomes **gold** and the thread closes (gate: `content:promote_gold`, Principal-only).
- [x] Open a `draft` plan a reviewer flagged CHANGES_REQUESTED → the normal Approve is disabled; use the **Override approve** card, which requires a reason → signs off to gold and records the override note/badge.
- [x] In `ReviewThread`, **Copy feedback** copies the reviewer's text to clipboard (for Claude Desktop); re-import a revised version via Admin → Import → the open round flips to `superseded` (R2.2).

### Office
- [x] Assign a plan to a reviewer + bulk-assign in `AssignReviews` → works (Office holds `content:assign_review`).
- [x] Open the Inbox / a `ReviewThread` → see submitted feedback and copy it.
- [x] Confirm there is **no Approve/sign-off control** for Office, and `approvePlan` is rejected if forced (Office lacks `content:promote_gold`).

### Subject Teacher (as the assigned Reviewer)
- [x] After being assigned, **My reviews** in the Review tab lists the round; tap it → `ReviewSubmit` opens the assigned plan's markdown (read-override lets you read it even outside your teaching subject — R1.3).
- [x] Submit **APPROVE** → plan advances draft→reviewed (status badge updates after refocus); submit **CHANGES_REQUESTED** with feedback → plan stays draft.
- [x] CHANGES_REQUESTED with empty feedback → blocked client-side ("feedback required"); add text → submits.
- [x] Re-open an already-submitted round → prior verdict + feedback are prefilled and editable (resubmit); a closed round (gold / superseded) shows a "review round is closed" notice instead of the form.

### Reviewer (general)
- [x] A teacher who is **not** the assigned reviewer cannot submit on that round (`submitPlanReview` → ForbiddenError; the round isn't in their My-reviews queue).
- [x] `planReviewThread` for a plan the teacher never reviewed → denied; for a thread they participated in → visible.

### Negative / RBAC checks (must be BLOCKED)
- [x] Subject Teacher / any teacher tries `assignPlanReview` or `cancelPlanReview` → denied (`content:assign_review` is Principal/Office only); no Inbox/Assign card shows in their Review tab.
- [x] Office attempts to APPROVE a plan to gold → no control present; forced `approvePlan` denied (lacks `content:promote_gold`).
- [x] Assigning a non-plan `docType` (e.g. a question) for review → rejected (plans only, `PLAN_DOC_TYPES`).
- [x] A `draft` plan signed off without override reason → rejected (must be `reviewed`, or supply an override reason).
- [x] Guardian → **no Review tab** and no review surface (holds neither `content:review` nor `content:assign_review`).

## Question Bank & Set Assembly
*What it is:* Browse/filter questions, add to a basket, then assemble a HW/AS/CT set for a section and export the set PDF. *Where:* Questions tab → `QuestionBank` (filters + basket toggle) → `QuestionPreview` / `Basket`; Sets tab → `SetList` → `SetDetail` → `AssembleSet` (+ `SectionPicker`).

### Principal
- [ ] Questions tab → filter by subject/class/type/paper-role/difficulty/bloom/marks-range → list updates; every subject/class is visible (PRINCIPAL bypasses scope).
- [ ] Tap **Add to basket** on several questions → basket count + total marks badge update; open `Basket`.
- [ ] In `Basket`, pick a set type (HW/AS/CT), choose a section, **Create set** → pushes to `AssembleSet`; set CT duration or HW/AS due date → **Assemble** → `SetDetail` shows status "assembled".
- [ ] On an assembled set (web) → **Export PDF** opens the set PDF.

### Subject Teacher
- [ ] Questions tab → see questions for the subject+class you teach (server row-scope via `assertCanRead`); add to basket.
- [ ] Pick a **writable section you teach** (`SectionPicker`) → Create + Assemble a set succeeds (`assertCanWrite` passes on your teaching/proxy section).
- [ ] Basket has class-5 questions but the selected section is class-3 → the **class-mismatch** warning blocks Create until you change section or basket.
- [ ] Export an assembled set's PDF on web.

### Class Teacher / Coordinator
- [ ] With a supervisory grant, browse questions in scope (read-only). Confirm question-bank visibility follows your grant.
- [ ] Attempt to assemble a set for a section you only **supervise** (no teaching/proxy grant) → blocked by `assertCanWrite` ("you may only assemble for sections you teach").

### Negative / RBAC checks (must be BLOCKED)
- [ ] Subject Teacher opens a `question` by id for a subject they don't teach → returns nothing / ForbiddenError (scope-filtered). *(Note: question scope is subject-only, looser than plans — watch a class you don't teach but whose subject you do.)*
- [ ] Teacher tries `createSet` / `addQuestionToSet` / `assembleSet` targeting a section outside their teaching+proxy grants → denied (`assertCanWrite`), even though they hold `set:assemble`/`question:select`.
- [ ] Office opens the Questions or Sets tab → **not present** (OFFICE lacks `question:read` / `set:read` / `question:select` / `set:assemble`); forcing `questions`/`assembleSet` → denied.
- [ ] Guardian → **no Questions tab and no Sets tab**; no question/set surface anywhere (holds only `guardian:read_child`).

---

# 3 · Trackers

## Homework Tracker
*What it is:* Subject teachers declare time-budgeted daily homework; the section's class teacher reconciles the day against a 240-min ceiling and issues it, then per-student records run a GIVEN→…→RETURNED lifecycle with results and guardian delivery. *Where:* `app/src/screens/homework/` (DeclareHomeworkScreen, HomeworkReconcileScreen, CheckingQueueScreen, HomeworkRecordsScreen, HomeworkHomeScreen, HomeworkRollupsScreen) + `app/src/screens/guardian/ChildHomeworkScreen.tsx`.

### Principal
- [ ] Open Homework Rollups → see watch-list (resubmissions ≥3 in 14 days), trim-pattern flags (>30% of month), and chase-attention list across all sections (unscoped).
- [ ] Open any section's reconcile/records screens → can read every section (no row-scope limit).
- [ ] Declare/issue/check on any section → succeeds (holds tracker:write, unscoped).
- [ ] Export a homework rollup → control is present (holds tracker:export).

### Office
- [ ] Open the app → confirm there is NO Homework tab / no homework controls (Office lacks tracker:read/write/export; every homework resolver is gated and Office is rejected at the scope layer).

### Subject Teacher
- [ ] Declare HW for own section: subject, dateGiven (must be a school night Sun–Thu), ≥1 topTag, timeDecl (default 20) → item created with status "declared".
- [ ] Declare a single subject with timeDecl > 40 → saves, but a band warning (advisory) is shown at reconcile; it does NOT block.
- [ ] Declare items whose day-sum exceeds 240 min → still declarable; the block only bites at issue.
- [ ] After class teacher issues the day, open Checking Queue → mark a SUBMITTED record CORRECT → advances to RETURNED, no resubmission spawned.
- [ ] Mark a SUBMITTED record WRONG → original goes CHECKED→RESUBMIT and a NEW record auto-spawns at GIVEN with same hwId + resubOf set.
- [ ] Mark a SUBMITTED record PARTIAL without ticking resubmit → no spawn; tick resubmit → spawns a resubmission.
- [ ] Attach a top-up (selected qids only, never free-typed) to a resubmission → counts toward the child's personal day-load (may exceed 240, accepted); cannot attach a top-up to a non-resubmission.
- [ ] Try to declare for a section you do not teach → blocked (write-scope).

### Class Teacher / Coordinator
- [ ] Open Reconcile for own section + date → see live DAY_TOTAL, ceiling 240, overBy, and per-item band warnings (timeDecl>40).
- [ ] With day-sum > 240, try Confirm/Issue → blocked with "exceeds the 240-min ceiling — trim required".
- [ ] Trim rank a (revision items first) / b (lightest subject, cannot zero) / c (zero a subject) until within ceiling → then Confirm/Issue succeeds; present students spawn GIVEN, absent students spawn ABSENT_REDELIVER.
- [ ] Try to issue on a Friday/Saturday → blocked (weekend).
- [ ] After issuing, attempt to trim again → blocked ("Day already reconciled — the trim log is immutable").
- [ ] Re-deliver an ABSENT_REDELIVER student → moves to GIVEN with dueDate shifted to next school day.
- [ ] Confirm a section you are NOT the class teacher of cannot reconcile/issue → only the section's class teacher may (supervisory-read alone is not enough).

### Cover/Proxy Teacher
- [ ] During an active proxy window for the covered class, declare/issue/check that class's homework → succeeds (time-bounded tracker:write for that class only).
- [ ] After the proxy window expires, repeat the same action → blocked.
- [ ] Attempt to write to any class other than the covered one → blocked.

### Guardian
- [ ] Open Child Homework for a linked child → see only issued/delivered records with state (Bangla label), dateGiven, due/submitted/checked dates, result, chaseCount, resubmission marker.
- [ ] Confirm staff-internal fields are absent: no declaredBy/issuedBy, no timeDecl/qCount, no poolRef/selectedQids, no teacherAction (homework guardian shape omits these structurally).
- [ ] Try to view a non-linked student's homework → blocked (assertGuardianOfStudent).

### Negative / RBAC checks (must be BLOCKED)
- [ ] Subject Teacher edits another section's homework item/record → blocked (write-scope to own sections).
- [ ] Subject Teacher (not the class teacher) runs the daily reconcile/issue → blocked.
- [ ] Office attempts any homework read/write/declare → no control surfaced; direct call rejected (lacks tracker:*).
- [ ] Guardian attempts a homework mutation (declare/check/transition) → blocked (guardian:read_child only).
- [ ] Guardian sees a record's teacherAction/internal declaration fields → must NOT appear.
- [ ] Cover teacher writes to the covered class AFTER window expiry → blocked.

## Assignment Tracker
*What it is:* Admin sets a 4-week rotation schedule; subject teachers deliver→collect→check weekly assignments through the shared lifecycle, Office runs the chase ladder, and guardians see their child's assignments. *Where:* `app/src/screens/assignment/` (AssignmentHomeScreen, AssignmentScheduleScreen, DeliverAssignmentScreen, CollectAssignmentScreen, AssignmentCheckingScreen, AssignmentChaseScreen, AssignmentRollupsScreen) + `app/src/screens/guardian/ChildAssignmentsScreen.tsx`.

### Principal
- [ ] Open Assignment Schedule → set term anchor + delivery/due weekdays (Sun–Thu only) and add a 4-week rotation (cycleWeek × section × subject → teacher) → entries saved.
- [ ] Open Rollups → see unscoped delivery/submission rates, chase volume, attention list (chaseCount ≥2), comms-prompt list (chaseCount ≥3), suspended weeks, avg checking latency across all teachers.
- [ ] Confirm a holiday on the delivery weekday rolls the delivery date backward; a holiday on the due weekday rolls it forward; a fully-closed week shows suspended and is excluded from rate denominators.

### Office
- [ ] Edit the assignment schedule (add/remove rotation entries) → succeeds (roster:manage).
- [ ] Open the Chase list → see all CHASE records school-wide with student/subject/days-overdue/guardian phone.
- [ ] Escalate a CHASE record through the ladder: step 1/2 in-app (skippable), step 3+ WHATSAPP/CALL/OTHER produces a wa.me link → mark outcome SENT/SKIPPED; each step appends one immutable AssignmentFollowUp row.
- [ ] Confirm Office has NO Deliver/Collect/Check/Rollups screens (lacks tracker:read/write/export).

### Subject Teacher
- [ ] On Sun/Mon, see prep prompts for own undelivered items for the week; prompt disappears after delivery.
- [ ] Deliver an assignment: mark present (GIVEN) / absent (ABSENT_REDELIVER), set totalMarks/setId → asId generated; counts are derived (read-only, never typed).
- [ ] On a later day, redeliver an absent student → ABSENT_REDELIVER→GIVEN, now counted delivered.
- [ ] On the due date, Collect: mark submitted (→SUBMITTED) / not-submitted past due (→CHASE, chaseCount increments).
- [ ] Check a SUBMITTED record: result CORRECT/PARTIAL/WRONG + marks (≤ totalMarks) + Bangla feedback → state CHECKED; confirm NO auto-resubmission spawns (unlike homework).
- [ ] Explicitly issue a resubmission on a CHECKED record → original→RESUBMIT, new record at GIVEN with same asId, dueDate = next school day.
- [ ] Open Rollups → see only own rows (self-scoped), not other teachers'.

### Cover/Proxy Teacher
- [ ] During an active proxy window, deliver/collect/check the covered class's assignments → succeeds (tracker:write for that section only).
- [ ] After expiry, repeat → blocked; any non-covered section → blocked.

### Guardian
- [ ] Open Child Assignments for a linked child → see pending (delivered, due future, no marks), overdue (daysLate>0), returned (marks/totalMarks, result, feedback), and resubmission flag.
- [ ] Confirm hidden staff fields: no chaseCount, no issuedBy/teacherAction, no follow-up ladder.
- [ ] Try a non-linked student → blocked.

### Negative / RBAC checks (must be BLOCKED)
- [ ] Subject Teacher delivers/checks another section's assignment → blocked (write-scope).
- [ ] Office tries to deliver/collect/check or view rollups → no control (lacks tracker:read/write).
- [ ] Subject Teacher opens the chase escalation ladder → blocked (escalate/follow-up are message:dispatch + P/O only).
- [ ] Guardian sees chaseCount or teacherAction on a child assignment → must NOT appear.
- [ ] Guardian attempts any assignment mutation → blocked.
- [ ] Cover teacher writes to the covered class after window expiry → blocked.

## Class Test Tracker
*What it is:* Teacher requests a printed test → Office prints it → teacher enters per-student results (only when PRINTED and on/after exam date) → publish/unpublish delivers PUBLISHED results to guardians → dashboards/reports + Office overdue-chase. *Where:* `app/src/screens/classtest/` (Home, RequestClassTest, PrintQueue, Results, Publish, Dashboard, Reports, ClassSubject, StudentProfile) + the class-test card on `GuardianHomeScreen.tsx`.

### Principal
- [ ] Open Dashboard → see KPIs (logged/complete/in-progress/not-started/overdue + completion-rate) and overdue-by-teacher, unscoped (P/O gate).
- [ ] Open Reports / Class×Subject / Student Profile → unscoped across all sections.
- [ ] Enter or publish results on any section → succeeds (holds tracker:write).

### Office
- [ ] Open Print Queue → see REQUESTED tests oldest-first; open the set PDF or uploaded paper; tap Mark Printed → status REQUESTED→PRINTED, printedBy/printedAt stamped (roster:manage).
- [ ] Cancel a REQUESTED test before printing → status CANCELLED.
- [ ] Open Dashboard and Reports → visible to Office even though Office lacks tracker:read (gate is authenticated + assertDashboardAdmin / assertReportRead with a P/O branch).
- [ ] Open the overdue-chase list → see per-teacher wa.me nudges and tap to send (message:dispatch + P/O).
- [ ] Confirm Office has NO "Enter Results" or "Publish" controls (lacks tracker:write).

### Subject Teacher
- [ ] Request a class test for own section: subject, exam date, total/pass marks, source (CT-set or uploaded paper) → status REQUESTED, ctId generated.
- [ ] Before exam date, on a PRINTED test, try to enter results → blocked ("can only be entered on or after the exam date").
- [ ] On/after exam date, on a PRINTED test, enter per-student PRESENT (marks 0..totalMarks) or ABSENT → percent/pass derived (ABSENT → null); cannot save marks for an ABSENT student.
- [ ] Try to enter results while status is REQUESTED (not yet printed) → blocked ("can only be entered on a printed (official) exam").
- [ ] Publish one student then the whole exam → publishedAt stamped, publishedVersion incremented; guardian wa.me + in-app notification issued.
- [ ] Unpublish a result (publishedAt cleared, publishedVersion unchanged) then republish → publishedVersion bumps, dedupeKey differs, guardian re-notified.
- [ ] Open Reports for own section → rows visible; trend ↑/↓/→ on Class×Subject.

### Cover/Proxy Teacher
- [ ] During an active proxy window, request/enter/publish results for the covered class → succeeds (tracker:write for that section only).
- [ ] After expiry → blocked; any non-covered section → blocked.

### Guardian
- [ ] Open the Class-Test card for a linked child → see only PUBLISHED results: subject, test#, marks/total, percent, pass/fail, weakness, guardianAction.
- [ ] Confirm teacherAction is NEVER shown (the guardian shape omits it structurally).
- [ ] Confirm an UNPUBLISHED result does NOT appear.

### Negative / RBAC checks (must be BLOCKED)
- [ ] Subject Teacher enters results on another section's test → blocked (assertCanWrite / assertWriteTest).
- [ ] Teacher tries to Mark Printed → blocked (print queue is roster:manage / P/O).
- [ ] Office tries to enter or publish a result → no control (lacks tracker:write).
- [ ] Teacher without message:dispatch hits the overdue-chase query → blocked (P/O + message:dispatch only).
- [ ] Guardian sees an UNPUBLISHED class-test result → must NOT appear.
- [ ] Guardian sees teacherAction on a published result → must NOT appear.
- [ ] Enter results before the exam date, or while not PRINTED → both blocked.

## Vocabulary Tracker
*What it is:* Teachers manage a per-class word bank, an admin assigns a weekly tester, the tester builds a positioned test and marks a tap-grid, reports/messages roll up, and login-enabled guardians see marked results. *Where:* `app/src/screens/vocab/` (VocabHome, VocabWordBank, BuildVocabTest, VocabAssignment, VocabTests, VocabMarkGrid, VocabReport, VocabStudentReport, VocabClassReport, VocabMessages) + guardian childVocab card.

### Principal
- [ ] Build a test (create draft → lay positions per direction → "ready"), mark a tap-grid (PRESENT marks fields wrong / ABSENT), submit → status flips to "marked"; score/marksLost/wrongWords derived (unscoped).
- [ ] Open Class/Student/Per-test reports → most-missed words flagged at ≥30%, persistent weak words at ≥2 tests; cumulative WEEKLY/MONTHLY/LAST_N toggles.
- [ ] Generate guardian messages and tap a wa.me link → opens WhatsApp with the Bangla body prefilled.

### Office
- [ ] Assign the weekly tester (year → program → section → week → teacher) → assignment recorded, current-tester badge shows "direct" (roster:manage).
- [ ] Read all tests/reports → visible (tracker:read).
- [ ] Generate guardian messages → succeeds (message:dispatch).
- [ ] Confirm Office CANNOT add a word, build a test, or mark a grid (lacks tracker:write) — controls hidden / mutation rejected.

### Subject Teacher
- [ ] Manage word bank for a class level you teach: add/edit/deactivate (soft-delete, still listed under "show inactive") → succeeds.
- [ ] As the assigned tester for the week+section+program, create a test, lay positions (DICTATION 2 fields on ENGLISH/ARABIC, 1 on BANGLA), mark students, submit → "marked".
- [ ] Verify half-miss scoring: dictationHalfMissCounts OFF → both fields wrong = max 1 lost; ON → 1 lost per wrong field.
- [ ] Verify ABSENT excludes the student from the average denominator.
- [ ] Try to manage the word bank for a class level you do NOT teach → blocked (assertCanManageClassLevel).
- [ ] Try to build/mark a test for a section/week you are NOT the assigned tester for → blocked (assertCanOperateVocab).

### Cover/Proxy Teacher
- [ ] With an active proxy grant on the section for the assigned tester's week, build/mark that test → succeeds.
- [ ] For a week outside the proxy window (or a different section) → blocked.

### Guardian
- [ ] Open the child's vocab card (login-enabled guardian) → see only MARKED tests: program/label/date, score or ABSENT, wrong words by direction.
- [ ] Confirm draft/ready (unmarked) tests do NOT appear and no edit controls exist.
- [ ] Confirm a contact-only (non-login) guardian gets only the wa.me message, not an in-app notification.

### Negative / RBAC checks (must be BLOCKED)
- [ ] Teacher builds/marks a test for a section they are not assigned (and hold no proxy) → blocked.
- [ ] Teacher edits the word bank for a non-taught class level → blocked.
- [ ] Office adds a word / builds a test / marks a grid → no control; mutation rejected (lacks tracker:write).
- [ ] Guardian opens BuildVocabTest/MarkGrid or fires a vocab mutation → blocked (guardian:read_child only).
- [ ] Guardian queries another guardian's child vocab → blocked (assertGuardianOfStudent).

## Saturday Revision (Qur'an-Hifz)
*What it is:* The Qur'an-group teacher logs per-juz revision (amountJuz, categories, mistakes) on a Qur'an-only Saturday, delivers a digest or absent alert, dashboards/coverage/chase roll up, and guardians see delivered-only entries. *Where:* `app/src/screens/revision/` (RevisionHome, GroupRevisionGrid, DeliverRevision, RevisionDashboard, StudentRevisionHistory) + the revision card on `GuardianHomeScreen.tsx`.

### Principal
- [ ] Open Revision Dashboard (unscoped) → level metrics (entries/present/absent, portions by SABAQ/SABQI/MANZIL, tanbih/fath, mistakes, weakest-juz top 5), per-juz weakness heatmap, coverage overdue (>28 days), weekly trend ↑/↓/→.
- [ ] Open Completeness for a Saturday → groups with no entry listed; tap a chase wa.me to nudge the group's teacher.
- [ ] Set the consecutive-absence escalation threshold → applied at read time (no seed write).

### Office
- [ ] Record/edit/deliver any group's revision and view all groups + dashboards → succeeds (Office is treated as admin via role check, despite holding no tracker:* permission).
- [ ] Tap a completeness-chase wa.me link → message names the group + date + teacher (message:dispatch).

### Subject Teacher
- [ ] (Qur'an-group teacher) Open the group's grid for a Qur'an-only Saturday → mark a student PRESENT and add juz records: juz 1–30, category, amountJuz>0, tanbih/fath/mistakes ≥0 → Save records the entry.
- [ ] Mark a student ABSENT → juz section hidden; saving with any juz record is rejected ("absent student carries no juz records").
- [ ] Record a multi-juz portion (e.g., 1.5 juz over juz 28–29) as separate per-juz records → dashboard attributes weakness per juz.
- [ ] Deliver a present entry → digest wa.me (portions + totals + mistakes + comment) for families with a phone; in-app/push for login-enabled guardians.
- [ ] Deliver consecutive absent entries up to the threshold → escalation fires once per streak length (idempotent), reaching the guardian + Principal.
- [ ] Try to edit an entry that has already been delivered → blocked (delivered = immutable).
- [ ] Try to record on a non-Qur'an-only day, an inactive student, or a student not in the group → blocked.

### Class Teacher / Coordinator
- [ ] (Supervisory read) Open Student Revision History / dashboards for groups within your extent → read-only timelines and analytics visible; no record/deliver controls for groups you don't lead.

### Cover/Proxy Teacher
- [ ] With an active Qur'an-track routine cover for the group's slot, record/deliver that group's Saturday → succeeds for the covered window.
- [ ] Outside the window or for another group → blocked.

### Guardian
- [ ] Open the child's Saturday Hifz Revision card → see only DELIVERED entries (newest first): date, present/absent, juz portions, mistakes, teacher comment.
- [ ] Confirm staff fields are absent: no teacherUserId, no deliveryChannels, no group/internal timestamps.
- [ ] Switch to another linked child → card updates to that child's delivered entries only; a non-linked child → blocked.

### Negative / RBAC checks (must be BLOCKED)
- [ ] Teacher records/delivers for a Qur'an group they do not lead → blocked ("you do not lead this Qur'an group").
- [ ] Edit of a delivered (sealed) entry → blocked (immutable).
- [ ] Recording on a non-Qur'an-only Saturday / inactive student / non-member student → blocked.
- [ ] Guardian sees an UNDELIVERED revision entry → must NOT appear.
- [ ] Guardian sees teacherUserId / deliveryChannels → must NOT appear.
- [ ] Guardian queries another guardian's child revision → blocked.

---

# 4 · Daily Operations

## Routine / Timetable
*What it is:* the weekly class timetable — calendar/day-types (FULL Sun–Thu, FRI off, SAT Quran-only), rooms, period-grids/bell schedule, groups, conflict-checked slots, my-routine, group grids, master grid, daily class-notes, and cover/substitution. *Where:* `RoutineHomeScreen`, `MyRoutineScreen`, `GroupRoutineScreen`, `RoutineMasterScreen`, `RoutineEditorScreen`, `BellScheduleScreen`, `DailyNoteScreen`, `CoverManageScreen`.

### Principal
- [ ] Open Routine tab → see "My routine", "Master grid", "Bell schedule" buttons + section/subject-group cards with View/Class note/Edit/Cover actions (manage holder) → all visible.
- [ ] Add a HolidayException (Eid/govt/special, single date or range) → resolving any covered date returns no slots, attendance not expected, holiday listed with its Bangla label.
- [ ] Create a Room (unique code, Bangla name, optional capacity) → persists; deactivate a room → it can't be newly assigned but existing slot history is preserved.
- [ ] Create a Quran/Arabic SubjectGroup (named by level: Qaida/Ammapara/Najera/Hifz or Book 1/2/3, gender-split) + add students spanning multiple class-levels → membership queryable both ways.
- [ ] In RoutineEditor place a slot on Saturday for a Quran group/track → accepted; place a general/Arabic slot on Saturday → rejected; place any slot on Friday → rejected.
- [ ] Place a slot that double-books a teacher / group / room at the same (day, period) in an overlapping window → save rejected with the clash named (live feedback before save).
- [ ] Save a subject-teacher slot → a `source:"routine"` teaching grant for (teacher, group, subject) is created; remove/replace the slot → only that routine-derived grant is revoked (manual/supervisory grants untouched).
- [ ] Place a teacher with no prior authority for the subject → save WARNS but succeeds.
- [ ] Open RoutineMaster (master grid) → full week × period grid renders with conflict detection highlighting.
- [ ] Open CoverManage for an absence date → see per-slot free/loaded teachers; assign a cover → a time-bounded proxy-backed substitution persists and shows on the cover teacher's My routine + the group grid (marked as cover).
- [ ] Assign a per-day (or per-period override) bell-duty admin in Bell schedule → persists.

### Office
- [ ] Same authoring as Principal: create calendar/holidays, rooms, groups, build/edit routines, run CoverManage, set bell-duty → all `routine:manage` actions succeed.
- [ ] Open Master grid + Bell schedule → both visible (manage holder).

### Subject Teacher
- [ ] Open "My routine" → see own slots for today/week across all groups, including any active cover slots.
- [ ] Open a section's GroupRoutine grid for a section you teach → renders read-only (subject Bangla / teacher / room, breaks shown).
- [ ] Open DailyNote for a slot you teach → publish a class note (what-was-taught Bangla + optional HW link) → persists.
- [ ] Confirm NO Edit / Cover / Master-grid / Bell-schedule buttons appear (no `routine:manage`).

### Class Teacher / Coordinator
- [ ] View own section's routine grid + publish daily class-notes for own section → succeed.
- [ ] View another section's grid → read-only oversight only; no edit controls.

### Guardian
- [ ] Open child's group grid (via guardian portal `guardian:read_child`) → renders read-only.
- [ ] Confirm guardian sees only the grid — no editor, no cover/proxy internals, no teacher-load/availability data.

### Negative / RBAC checks (must be BLOCKED)
- [ ] A Subject Teacher calls a `routine:manage` write (create slot/room/holiday) → denied (Bangla deny).
- [ ] A teacher opens a group's RoutineEditor URL directly → editor write rejected server-side even if the screen loads.
- [ ] A teacher tries to read a routine/group outside their groups/supervisory extent → `routine:read` row-scope denies it.
- [ ] A Saturday general-subject slot or any Friday slot save → rejected by the day-type rule.
- [ ] Guardian attempts any routine mutation → denied.

## Attendance
*What it is:* two flows sharing one calendar — teacher attendance via daily biometric Excel import (name-reconciled), and in-app once-daily absent-only student marking by the section's marker-of-the-day, plus marker assignment, reports, and Office guardian chase. *Where:* `AttendanceHomeScreen`, `TeacherAttendanceImportScreen`, `AssignMarkerScreen`, `MarkAttendanceScreen`, `AttendanceReportScreen`.

### Principal
- [ ] Open Attendance tab → see Upload / Report / Assign-marker cards (`attendance:manage`); confirm NO "My sections" marking worklist (Principal/Office assign, don't mark).
- [ ] Open AssignMarker → assign a teacher to a section for a day or date range → a `SectionAttendanceAssignment` persists (append-only); assign one teacher to multiple sections same day → allowed.
- [ ] Deactivate a marker assignment → history preserved, the section falls back to its class teacher as default marker.
- [ ] Open AttendanceReport → run class-wise + section-wise absentee (a date: count, names, roll + ID), single-student (% over a range), absent-and-no-application, unmarked-section log, and teacher absence/late/leave summary.

### Office
- [ ] Upload the Employee Attendance Report Excel for a date → preview matched/unmatched/skipped; date read from the sheet header; ℞ rows skipped; ✔→PRESENT, 𝓛→LATE, ✘→ABSENT (or LEAVE if a leave record exists).
- [ ] Re-upload the same date → that date's teacher records replaced wholesale (snapshot); an `ATTENDANCE_IMPORTED` audit row appended.
- [ ] Resolve an unmatched name → maps to a `StaffProfile` and is remembered (`StaffNameAlias`) so future uploads auto-match.
- [ ] In the absentee report, for an absent student lacking a leave application → manually send a wa.me chase to the guardian.
- [ ] Assign markers (same as Principal) → succeed.

### Subject Teacher
- [ ] When assigned as today's marker for a section, open Attendance Home → the section shows in "My sections" worklist with a Pending/Marked badge.
- [ ] Open MarkAttendance for that section → tap absentees → submit → a `StudentAttendanceDay` writes (everyone untapped = present); badge flips to Marked.
- [ ] Re-open the same section same day → edit the absentee set (editable until end of day).
- [ ] View own marked section's report → allowed; confirm exactly one record per section per day.

### Class Teacher / Coordinator
- [ ] As the default marker (no override assignment) for own section → can mark that section's absentees (CT-2 gate).
- [ ] View own section's attendance reports → allowed; another section's report → not shown.

### Guardian
- [ ] Submit a child's leave application (from/to date + reason) → recorded only (no approval step); visible to class teacher + Office.
- [ ] Confirm a leave application covering an absent date shows in the absent-vs-application linkage (not "absent with no application").

### Negative / RBAC checks (must be BLOCKED)
- [ ] A teacher who is NOT today's assigned marker (and not the class teacher) opens MarkAttendance for that section → blocked ("Only the section's assigned marker for this date may mark").
- [ ] A teacher assigned only as yesterday's marker tries to mark today → blocked (marker resolves per date).
- [ ] Principal/Office attempts to mark a section's absentees directly → denied (they lack `attendance:mark`; they assign, not mark).
- [ ] A non-admin tries to upload the teacher Excel or assign a marker → denied (`attendance:manage`).
- [ ] A teacher reads another section's absentee day they aren't marker/class-teacher of → denied.

## Comments & Parent Meetings
*What it is:* daily per-student comments (**any teacher can now comment on any student**, D-#263) authored by teachers, reviewed + delivered to guardians by **Principal/Office** (D-#264), immutable after delivery; plus parents' meeting scheduling, per-family slots, dispatch, attendance, class-teacher meeting comments, and cross-meeting comparison. *Where:* `CommentsHomeScreen`, `SectionCommentsScreen`, `CommentEntryScreen`, `CommentReviewScreen`, `MeetingsListScreen`, `MeetingAdminScreen`, `MeetingComparisonScreen`.

### Principal
- [ ] Open Comments tab → see Daily comments, Comment review, Parents' meetings cards + own "My comments" list.
- [ ] Open Comment review (`commentReviewInbox`) → every UNDELIVERED comment school-wide with child + author names; tap one → edit it (reviewer may edit ANY undelivered comment, D-#264) → save succeeds.
- [ ] From the review/entry screen, Deliver an undelivered comment → `deliveredAt` stamped, wa.me link returned, notified-guardian count shown, comment becomes read-only/sealed.
- [ ] Re-open a now-delivered comment → form is read-only, "delivered locked" notice shows, no Save/Deliver.

### Office
- [ ] Open Comment review → same undelivered inbox; edit + Deliver a comment → succeeds (Office is a `roster:manage` reviewer).
- [ ] In MeetingAdmin: create a draft meeting → Generate slots → siblings on one phone collapse into one slot (combined children + class labels); see family/reachable/unreachable counts.
- [ ] Toggle a slot On-Call (no fixed time) + reorder slots up/down → persists.
- [ ] Dispatch → meeting flips to "scheduled", per-slot wa.me links render (On-Call message for On-Call slots), notified count shown.
- [ ] After dispatch, set each slot present/absent → derived present/absent/total/pending summary updates.

### Subject Teacher
- [ ] In SectionComments, pick year → class/section → see the section roster + existing comments; tap a student → record a new comment (type + sentiment + text) → saved as draft (undelivered).
- [ ] Record a comment on a student in a section you do NOT teach (D-#263 "any teacher, any student") → succeeds (gated by `tracker:write` role, not section write-scope).
- [ ] Attach a file (≤10 MB, image/pdf/video/audio) to a saved comment → uploaded and listed.
- [ ] Edit your OWN undelivered comment → succeeds; open "My comments" on the hub → see all comments you authored across any student with delivered/draft badges.
- [ ] Confirm the entry screen shows "delivery handled by admin" note (teacher has no Deliver button — D-#264).

### Class Teacher / Coordinator
- [ ] Same comment authoring/edit as Subject Teacher for any student.
- [ ] In MeetingComparison for a child in own section → save a MeetingComment (Positive + Concern) → succeeds (class-teacher-only duty).
- [ ] Open the comparison view → see this meeting's editable note + prior meeting comments chronologically + a by-type daily-comment rollup since the last meeting.

### Guardian
- [ ] Open the portal → see the child's DELIVERED daily comments only + the child's own meeting slot (time or "On Call").
- [ ] Open a delivered comment's attachment → opens (guardian-of-delivered-comment gate).
- [ ] Confirm the guardian does NOT see the MeetingComment (Positive/Concern staff note) anywhere in-portal.

### Negative / RBAC checks (must be BLOCKED)
- [ ] A teacher tries to edit a comment authored by ANOTHER teacher (and they are not a reviewer) → denied ("Only the comment's author may edit it").
- [ ] Anyone tries to edit a DELIVERED comment → denied ("A delivered comment is immutable — record a new comment").
- [ ] A Subject Teacher tries to Deliver a comment (`deliverStudentComment`) → denied (delivery is `roster:manage`, Principal/Office only).
- [ ] A teacher opens `commentReviewInbox` → denied (review dashboard is `roster:manage`).
- [ ] A teacher who is NOT the section's class teacher tries to save a MeetingComment → denied (J-CM6, class-teacher only).
- [ ] Guardian queries an UNDELIVERED comment → must NOT appear (`childComments` is delivered-only).
- [ ] Guardian opens another family's meeting slot → denied (`assertGuardianOfStudent`).
- [ ] `myStudentComments` for one teacher → never returns another teacher's comments.

## Classroom Observation
*What it is:* an in-app teaching-review pipeline — Principal/Office upload a recorded session + assign a senior-teacher observer; the assigned observer scores (REF-11 form for general/Arabic/Islam, ClassEcho/Quran form for Quran) and releases; the observed teacher reads only at/after REVIEWED and responds; plus footage, trend, due-list, reviewer-effectiveness, and config. *Where:* `ObservationHomeScreen`, `UploadObservationScreen`, `ObservationReviewQueueScreen`, `ReviewObservationScreen`, `ObservationDetailScreen`, `ObservationTrendScreen`, `ObservationDueListScreen`, `ReviewerEffectivenessScreen`, `ObservationConfigScreen`.

### Principal
- [ ] Open Observation tab → see Upload, Review queue (if also an observer), Trend, Due list, Reviewer effectiveness, Config buttons.
- [ ] Upload an observation: pick form (REF-11/Quran), subject, observed teacher, class date, anchor (Section or SubjectGroup) + optionally observer → created in UPLOADED, ASSIGNED if observer set.
- [ ] On a REVIEWED observation, Re-request a re-review with a new observer → prior row goes SUPERSEDED, a new ASSIGNED row is created.
- [ ] Attach session footage (paste YouTube id, or web GIS upload to YouTube-unlisted) to an observation → linked, "Open video" appears.
- [ ] Open Due list → overdue teachers ranked by support-tier + lateness (suggestion only, never auto-assigns); change config intervals → ranking changes.
- [ ] Open Reviewer effectiveness → per-observer calibration / timeliness / throughput / impact / fairness (Principal-only, not a public scoreboard).

### Office
- [ ] Upload + assign an observer (same as Principal, `observation:upload`) → succeeds.
- [ ] Attach footage to an observation → succeeds.
- [ ] Confirm Office can open Trend / Due list / config (`observation:read`/`observation:manage`).

### Observer / Observed Teacher
- [ ] Observer: open Review queue → see ASSIGNED observations assigned to you; open one → the REF-11 form (5 domain levels 1–4 + notes, 2 gate PASS/BREACH + breach note, one strength, growth focus) OR Quran form (8 ratings 1–5 + 7 yes/no compliance + strengths/improvements/suggestions) per the row's form.
- [ ] Observer: submit a review → state goes REVIEWED, released to the observed teacher; confirm no total/average is stored and a gate BREACH stands regardless of levels.
- [ ] Observed Teacher: after REVIEWED, open ObservationDetail → see scores + footage → write a response (→ TEACHER_RESPONDED) and rate the review fairness/usefulness 1–5.
- [ ] Observed Teacher: confirm the response acknowledges "seen & discussed, not agreement"; cannot edit the observer's scores.

### Guardian
- [ ] Confirm classroom observation is entirely absent from the guardian portal (staff-internal; no guardian read path).

### Negative / RBAC checks (must be BLOCKED)
- [ ] Assign an observer who is the same person as the observed teacher → refused ("an observer cannot be assigned their own teaching").
- [ ] An observer who is NOT the assigned observerId opens an ASSIGNED observation to score → denied (gated to the assigned observerId).
- [ ] The observed teacher opens their own observation while still UPLOADED/ASSIGNED (pre-REVIEWED) → blocked (cannot read before REVIEWED).
- [ ] The observed teacher tries to see other observers' inputs on a multi-observer recording → never visible.
- [ ] A teacher with no `observation:upload` tries to upload/assign or attach footage → denied.
- [ ] A non-Principal opens Reviewer effectiveness or Config → denied (`observation:manage`).
- [ ] Re-request a re-review on a non-REVIEWED observation → refused (only a REVIEWED row can be re-reviewed).

---

# 5 · HR & Finance

## HR — Staff records
*What it is:* StaffProfile master records (HR category, employment type + status, salary/payment/contract rows) with an optional linked login. *Where:* `StaffListScreen`, `MyRecordScreen`, `HrHomeScreen`; server `foundation/resolvers/staff.ts` (`staff:manage`).

### Principal
- [ ] Create a StaffProfile for a teacher (category, employment type, employment status, join date) → profile persists; appears in staff list.
- [ ] Create a support-staff profile (guard/cleaner) with biometric_id and NO linked User → profile saves without a login.
- [ ] Set salary structure + payment method/account on a profile → sensitive rows save and are visible to you (P/O).
- [ ] Open a teacher's profile → salary, bank account, NID, payment method all visible.

### Office
- [ ] Create/edit a StaffProfile → succeeds (`staff:manage`).
- [ ] Set/edit salary + payment-method rows → succeeds (Office holds `staff:manage`).
- [ ] Link a User login to an existing profile → auth role is one of PRINCIPAL/TEACHER/OFFICE (creating a profile never mints a new role).

### Staff member (self-service)
- [ ] Open "My Record" (`MyRecordScreen`) → see own non-pay fields; resolved via phone-link to own StaffProfile.
- [ ] A staff login with no linked StaffProfile opens "My Record" → empty/own-only, never another person's data.

### Negative / RBAC checks (must be BLOCKED)
- [ ] A TEACHER (even one with supervisory scope) queries another staff member's profile → salary/bankAccount/NID/paymentMethod NOT returned (default-deny row-scope; `staff` query is `staff:manage`-gated).
- [ ] A TEACHER opens the Staff list / staff-records screen → blocked (lacks `staff:manage`).
- [ ] A staff member tries to read another staff member's record → blocked (own-row only).
- [ ] GUARDIAN reaches any staff-record screen → none exist for guardians (GUARDIAN holds only `guardian:read_child`).

## HR — Leave
*What it is:* leave entitlements/balances, self-apply, approve/reject (exceed-rule WARNS, never blocks; excess → unpaid LWP), and cover slots (needs_cover → proposed → approved; approval mints the proxy grant). *Where:* `LeaveAdminScreen`, `MyLeaveScreen`, `LeaveCoverScreen`; server `hr/resolvers/staffLeave.ts`.

### Principal
- [ ] Grant/edit a staff member's annual leave allowance (`upsertStaffLeaveEntitlement`) → balance shows allowance/taken/remaining.
- [ ] Approve a leave that exceeds allowance → system WARNS but still approves; excess days stamped as unpaid (LWP), not hard-blocked.
- [ ] Reject a leave → status rejected; any live cover proxy grants revoked.
- [ ] Approve a proposed cover slot (`decideStaffCoverSlot`) → proxy grant minted, cover teacher's write access begins.
- [ ] View all staff leave + balances for a range → all rows visible.

### Office
- [ ] Record leave on a support-staff member's behalf (no login) by passing staffProfileId (`applyForStaffLeave`) → leave recorded, cover slots fan out.
- [ ] Approve/reject leave and approve cover slots → succeeds (Office holds `leave:manage`).
- [ ] Approve a cover slot → proxy grant minted (Office can approve cover; this is `leave:manage`, NOT `payroll:approve`).

### Staff member (self-service)
- [ ] Apply for own leave from "My Leave" (omit staffProfileId) → leave recorded for own profile.
- [ ] View own leave + own balances (`myStaffLeave` / `myStaffLeaveBalances`) → own rows only.
- [ ] Propose a covering teacher on own leave's slot (`proposeStaffCover`) → slot moves to proposed; NO write access granted yet.
- [ ] Cancel own pending leave → status cancelled; cover grants revoked.

### Cover teacher
- [ ] Before approval: proposed-as-cover teacher tries to write to the covered class/section → blocked (proposal alone grants nothing).
- [ ] After Principal/Office approves the slot: same teacher writes to the covered class/section within the leave window → allowed (proxy grant active).
- [ ] After the leave window / on reject/cancel: cover teacher's write access to the class → revoked.

### Negative / RBAC checks (must be BLOCKED)
- [ ] A teacher tries to approve/reject leave → blocked ("Only Principal/Office may approve or reject leave"; `leave:manage`).
- [ ] A teacher tries to approve a cover slot (`decideStaffCoverSlot`) → blocked (lacks `leave:manage`); a proposal never self-activates.
- [ ] A staff member applies for someone else's leave by passing another staffProfileId → blocked ("You may only apply for your own leave").
- [ ] A staff member proposes cover on another person's leave slot → blocked ("You may only propose cover on your own leave").
- [ ] A staff member reads cover slots / balances for a leave that isn't theirs → blocked (own-row only).
- [ ] GUARDIAN reaches any leave screen → none exist for guardians.

## HR — Payroll
*What it is:* set pay, prepare/recompute a monthly run (Office), approve+LOCK (Principal only — locked run is immutable), payslips, payment export (cash excluded), advances/qard-hasan. *Where:* `PayrollHomeScreen`, `PreparePayrollScreen`, `PayrollRunDetailScreen`, `StaffPayScreen`, `PaymentExportScreen`, `AdvancesScreen`; server `hr/resolvers/payroll.ts`.

### Principal
- [ ] **Approve + LOCK a prepared run (`approvePayrollRun`, `payroll:approve` RESERVED) → status flips to approved_locked; advance recovery commits.** ← highest-value test
- [ ] Try to recompute/cancel a run after it is locked → rejected (locked run is immutable; corrections ride next run as arrears).
- [ ] Issue a qard-hasan advance (`issueStaffAdvance`, `payroll:approve`) → advance created interest-free & fee-free.
- [ ] Settle / write off an advance (`settleStaffAdvance`, `payroll:approve`) → balance cleared/written off.
- [ ] Open payment export for a locked run → cash-paid staff excluded from the bank/bKash file.
- [ ] Set a staff member's monthly salary + payment method (`setStaffPay`) → saved (Principal also holds `payroll:manage`).

### Office
- [ ] Set staff pay + payment method (`setStaffPay`, `payroll:manage`) → saved.
- [ ] Prepare/recompute a monthly run (`preparePayrollRun`) with workingDays + adjustments → net = gross − deductions + additions; unpaid-leave deduction = day-rate × days; advance repayment never pushes net negative (net-pay guard).
- [ ] Cancel a still-prepared (unlocked) run (`cancelPayrollRun`) → discarded.
- [ ] Read payslips for a run + payment export → visible.

### Staff member (self-service)
- [ ] View own payslips (`myPayslips`) → only LOCKED-run payslips returned; never a draft/prepared payslip; never another person's.
- [ ] A staff login with no linked StaffProfile calls myPayslips → empty list (fail-closed phone-join).

### Negative / RBAC checks (must be BLOCKED)
- [ ] **Office tries to approve+lock a payroll run → NO approve control / mutation rejected (Office lacks `payroll:approve`; it is RESERVED, Principal-only — Office can only prepare).** ← highest-value test
- [ ] **Office tries to issue or settle an advance (`issueStaffAdvance`/`settleStaffAdvance`) → blocked (those are `payroll:approve`, Principal only).** ← highest-value test
- [ ] Grant `payroll:approve` to an Office user via Access Control → rejected (RESERVED, reaches only a PRINCIPAL login; structural backstop subtracts it).
- [ ] A teacher opens any payroll screen → blocked (lacks `payroll:manage`).
- [ ] A staff member opens another staff member's payslip → blocked (myPayslips is own-row only).
- [ ] GUARDIAN reaches any payroll/advance screen → none exist for guardians.

## HR — Performance / Conduct / Development
*What it is:* observations, appraisals (draft prepare → Principal sign-off), conduct ladder (verbal→written→final→termination, hearing before finalize; Principal finalizes), confidential grievances, CPD log. *Where:* `PerformanceHomeScreen`, `StaffObservationsScreen`, `StaffAppraisalsScreen`, `StaffConductScreen`, `StaffCpdScreen`, `GrievanceInboxScreen`, `StaffPerformanceScreen`; server `hr/resolvers/performance.ts`.

### Principal
- [ ] **Sign off an appraisal (`signOffAppraisal`, `performance:signoff` RESERVED) → outcome set, appraisal locked, development needs emitted into the CPD log.** ← highest-value test
- [ ] Record a conduct step (`recordConductStep`) → ladder enforces order (no rung-skip; verbal→written→final→termination); gross-misconduct may fast-track.
- [ ] Record the hearing (`recordConductHearing`) BEFORE finalizing → step moves to hearing_held.
- [ ] **Finalize a conduct step (`finalizeConductStep`, `performance:signoff` RESERVED) → requires a recorded hearing first; a termination step writes employmentStatus → terminated and triggers offboarding.** ← highest-value test
- [ ] Handle a grievance (`updateGrievance`) → status under_review/resolved/closed (grievances are confidential to Principal).
- [ ] Submit an observation on any staff member (`submitObservation`, P/O via `performance:manage`) → recorded.

### Office
- [ ] Prepare/edit a DRAFT appraisal (`upsertAppraisal`, `performance:manage`) → goals + development needs saved; outcome stays empty (set only at sign-off).
- [ ] Record a conduct step + hearing → succeeds (Office prepares the ladder).
- [ ] Add a CPD development-log entry (`addDevelopmentLog`) → logged.
- [ ] Read all observations / appraisals / conduct / grievances → visible (`performance:manage`).

### Staff member (self-service)
- [ ] Raise a confidential grievance (`raiseGrievance`) → created, routed to Principal (own-row, no permission needed).
- [ ] View own conduct / appraisal / grievance / CPD records (`myConductRecords` / `myAppraisals` / `myGrievances` / `myDevelopmentLog`) → own records only, incl. own appraisal outcome.

### Cover teacher / Supervisor (bounded observation-write)
- [ ] A supervisor (Class Teacher / Coordinator / Subject Lead) submits an observation WITHIN their supervisory (class, subject) extent (`submitObservation`, no permission) → allowed.
- [ ] A supervisor views observations → only their OWN authored observations (`myObservations`); never the outcome or others' inputs.

### Negative / RBAC checks (must be BLOCKED)
- [ ] **Office tries to sign off an appraisal (`signOffAppraisal`) → blocked (Principal only; `performance:signoff` is RESERVED).** ← highest-value test
- [ ] **Office tries to finalize a conduct step (`finalizeConductStep`) → blocked (Principal only; `performance:signoff` RESERVED).** ← highest-value test
- [ ] Finalize a conduct step with no recorded hearing → rejected (hearing before finalize, 'adl; not optional).
- [ ] Record a conduct step that skips a rung (e.g. verbal → final without gross-misconduct) → rejected (ladder enforces order).
- [ ] A supervisor submits an observation OUTSIDE their supervisory extent → blocked ("You may only observe within your supervisory extent").
- [ ] A supervisor / teacher reads any conduct record, grievance, or appraisal outcome → blocked (supervisors never see conduct; `performance:manage` only, plus own-row self-view).
- [ ] GUARDIAN reaches any performance/conduct/grievance screen → none exist for guardians.

## HR — Offboarding
*What it is:* exit triggers set status → access-revoke (disable login + revoke scope grants on last day) → clearance checklist → final settlement hard-held until clearance done and released by Principal. *Where:* `OffboardingHomeScreen`, `OffboardingCaseScreen`; server `hr/resolvers/offboarding.ts`.

### Principal
- [ ] **Release the hard-held final settlement (`releaseFinalSettlement`, `payroll:approve` RESERVED) → succeeds ONLY when every clearance item is done/waived; commits advance recovery and closes the case.** ← highest-value test
- [ ] Try to release the settlement while a clearance item is still pending → rejected (hard-held until clearance complete, D-#29).
- [ ] Initiate a termination offboarding (`initiateOffboarding`) → StaffProfile status → terminated.
- [ ] Trigger access revocation (`revokeOffboardingAccess`) → login disabled + ALL scope grants revoked; idempotent.

### Office
- [ ] Initiate an offboarding (resignation/fixed_term_end/retirement, `initiateOffboarding`, `staff:manage`) → status set, default clearance checklist seeded.
- [ ] Add/update clearance items (`addOffboardingClearanceItem` / `updateOffboardingClearanceItem`) → item done/waived/pending with note.
- [ ] Compute the final settlement (`computeFinalSettlement`, `payroll:manage`) → salary pro-rated to last day + arrears + full leave encashment − outstanding advance; row stays `held: true`.
- [ ] Trigger access revocation + record exit interview + issue service certificate → succeed (`staff:manage`).

### Negative / RBAC checks (must be BLOCKED)
- [ ] **Office tries to release the final settlement (`releaseFinalSettlement`) → blocked (release is `payroll:approve`, Principal only; Office can compute the hard-held settlement but cannot release).** ← highest-value test
- [ ] Anyone attempts to release before clearance is complete → blocked even for Principal (hard-hold, no deadline).
- [ ] A teacher opens any offboarding screen → blocked (lacks `staff:manage`).
- [ ] A staff member views another person's offboarding case → blocked (Principal/Office only).
- [ ] GUARDIAN reaches any offboarding screen → none exist for guardians.

## Finance / Accounting
*What it is:* ledgers, opening balances, postings, reconciliation, budgets, dashboard, guardian-due/fee support, provider statements — all `finance:manage` (Principal+Office), identity-plane firewall both ways. *Where:* `FinanceHomeScreen`, `DailyEntryScreen`, `DailySnapshotScreen`, `FeesZakatScreen`, `QardIouScreen`, `ReconciliationScreen`, `BudgetScreen`, `FinanceDashboardScreen`; server `modules/finance/resolvers/*`.

### Principal
- [ ] Set ledger opening balances (`setLedgerOpeningBalance`) → saved; balance-as-of computes.
- [ ] Record a finance posting (`recordFinancePosting`) and reverse one (`reverseFinancePosting`) → entries recorded/reversed.
- [ ] Record a reconciliation (`recordReconciliation`) and view unreconciled days → reconciled.
- [ ] Set budget lines (`setBudgetLine`) and view budget-vs-actual / surplus-deficit → figures render.
- [ ] Open the Finance Dashboard (monthly report, year overview, YTD income statement, trends) → KPIs render.

### Office (the accountant's books)
- [ ] Perform every finance action above (`finance:manage` is held by both Principal and Office — Office is the accountant; there is NO Principal-only sub-gate in finance) → all succeed.
- [ ] Record provider receipts, set fee-support allocations, chase a fee due (`feeSupport.*`) → succeed.
- [ ] View provider statements + student fee history → render.

### Negative / RBAC checks (must be BLOCKED)
- [ ] A TEACHER opens the Finance tab or calls any finance resolver → blocked (lacks `finance:manage`; the tab is gated and every resolver re-gates server-side with a Bangla deny).
- [ ] **GUARDIAN reaches any finance screen or finance resolver → blocked / none exist for guardians (the finance wall, J-FIN6-4; identity-plane firewall both ways — no finance resolver joins to the corpus/analytics plane).**
- [ ] A user granted only `roster:manage` (not `finance:manage`) opens finance → blocked (finance is a distinct permission so the books can be granted to the accountant alone, D-#221).
- [ ] Confirm no finance/HR resolver can join to the corpus plane → the fail-closed firewall test stays green (ADR-005).

---

# 6 · Library, Chat, Notifications, Guardian Portal

## Library
*What it is:* Catalog browse, own loans/reservations, desk ops (issue/return/renew/lost), catalog + policy manage, librarian assignment. *Where:* `screens/library/` (LibraryHome/TitleDetail/LibraryDesk/CatalogManage/LibraryAdmin); gated `library:read`, desk via `amILibrarian`/`library:manage`.
### Principal
- [ ] Library → browse catalog + see Desk, Catalog manage, and Library admin entries (Principal holds library:manage).
- [ ] Library admin → edit a borrower-type policy (loanDays/maxConcurrent), assign a Teacher as librarian → assignment recorded; reservation/chase-list visible.
### Office
- [ ] Library → Desk + Catalog manage + Library admin all reachable (Office holds library:manage by default — the library desk).
- [ ] Desk → issue a copy by accession number to a student, then return it; renew a loan; over the borrower-type limit, a third issue is denied with a Bangla message.
### Teacher (Subject/Class)
- [ ] Library (plain teacher) → can browse catalog + see "My loans/reservations" and reserve a title for self; NO Desk/Catalog/Admin entries.
- [ ] After the Principal grants this teacher a Librarian assignment → the Desk entry now appears and issue/return succeeds (without widening their permission set).
### Guardian
- [ ] No Library tab at all; a child's loans appear (if implemented) only as a read-only card in the guardian portal — no reserve/renew control.
### Negative / RBAC checks (must be BLOCKED)
- [ ] Plain Teacher (no LibrarianAssignment) → no Desk/Catalog/Admin buttons; a forced `issueBook` is denied (Bangla error) until assigned.
- [ ] Teacher cannot edit policy or assign librarians (those are `library:manage`, Office/Principal only).
- [ ] Guardian has no Library tab and no desk/reserve action anywhere.

## Messaging / Staff Chat
*What it is:* 1:1 + group chat, seen receipts, group create/manage + posting policy (P/O), Principal chat oversight (audited read of ANY conversation), guardian notice composer. *Where:* `screens/chat/` (ChatHome/ChatThread/NewChat/GroupManage/ChatOversight*/GuardianNotice); gated `chat:read`/`chat:write`/`chat:manage`/`chat:oversee`.
### Principal
- [ ] Chat → "New group" entry present (chat:manage); create a group, add members, set posting policy.
- [ ] Chat → the oversight browser entry present (chat:oversee) → open any conversation including a 1:1 between two teachers → it is readable (incl. deleted-message originals).
- [ ] Set the SCHOOL conversation to ANNOUNCEMENT → Principal can still post.
### Office
- [ ] Chat → "New group" entry present (chat:manage); create/manage a group + posting policy.
- [ ] Office does NOT see the oversight browser entry (chat:oversee is Principal-only).
### Teacher (Subject/Class)
- [ ] Chat → open a 1:1 with another staff member, send a message; after they open it, the seen/receipt status shows.
- [ ] In a SECTION/SUBJECT auto-group the teacher belongs to, send a message; reply/forward/react work; edit/delete own message (deleted shows a "removed" placeholder).
- [ ] As the class teacher, compose a SECTION-scoped guardian notice → a per-guardian wa.me link list is produced.
### Guardian
- [ ] No Chat tab; guardians are notice recipients only (never chat participants).
### Negative / RBAC checks (must be BLOCKED)
- [ ] Teacher opens Chat → NO "new group" / group-create control (lacks `chat:manage`).
- [ ] Teacher opens Chat → NO oversight browser entry (`chat:oversee` is Principal-only RESERVED); a forced oversight call is denied.
- [ ] Principal opens oversight on a 1:1 → allowed AND a `CHAT_OVERSIGHT_OPENED` audit row is written for that open (one per open).
- [ ] In an ANNOUNCEMENT-mode group, a Teacher's send is blocked (reaction still allowed); a non-class-teacher subject teacher composing a SECTION notice for that section is denied.
- [ ] Guardian has no Chat tab and cannot send a chat message.

## Notifications
*What it is:* In-app inbox (🔔 + unread badge), per-kind notifications, push capture (native), own-rows-only. *Where:* `screens/notifications/NotificationCenterScreen.tsx`; 🔔 header bell in `AppTabs.tsx`.
### Principal
- [ ] 🔔 bell with unread badge shows in the header on every tab; tap → NotificationCenter renders newest-first, unread-first.
- [ ] At 16:00 with class notes still missing, a `CLASS_NOTE_ESCALATION` row arrives to Principal users; tapping a row marks it read and deep-links to the relevant screen.
### Office
- [ ] At 15:00 with notes missing, an escalation row arrives to Office users; mark-all-read clears the badge.
### Teacher (Subject/Class)
- [ ] Receives `ATTENDANCE_REMINDER` (12:00), `CLASS_NOTE_PROMPT` (12/13/14 ladder), `HW_PARENT_COMMS`, `REVIEW_ASSIGNED`, `COVER_ASSIGNED` rows as the respective trigger fires; a note published between rungs drops off the next rung.
- [ ] On the native app, log in → device push token registers; a new notification arrives as a push pop-up (web shows inbox + badge only, no pop-up).
### Guardian
- [ ] A login-enabled guardian's inbox shows ONLY `CLASS_NOTE_PUBLISHED` rows for their own children's groups.
### Negative / RBAC checks (must be BLOCKED)
- [ ] User B cannot see user A's notifications (`myNotifications` is own-rows only); a Guardian never sees a staff notification row.
- [ ] markRead/markAllRead on another user's row is denied.
- [ ] A contact-only guardian (loginEnabled:false) gets no inbox/push (recorded limitation — wa.me only).

## Guardian Portal
*What it is:* Guardian home + linked children's slices — routine (subject/period/time only), class notes, homework lifecycle, test results PUBLISHED-only, comments DELIVERED-only — a walled-off plane. *Where:* `screens/guardian/` (GuardianHome/ChildRoutine/ChildHomework/ChildClassNotes/ChildAssignments) + child switcher.
### Guardian
- [ ] Log in (family phone) → only the guardian tab set shows (Home + Academics: Routine/Homework/Assignments); a multi-child family sees a child switcher in the header that scopes every screen.
- [ ] GuardianHome ("আজ") → today's routine slots show subject + period + time ONLY (no teacher name, no room) — including on a day with an active cover.
- [ ] On a Saturday, childRoutine returns Quran-group slots only; on a holiday it shows the holiday label + empty slots.
- [ ] ChildHomework → full lifecycle per record (state chips, chase count, resubmission chain, result, day-load vs 240); a teacher-attached question/answer file opens in-app (streamed through the server).
- [ ] Test results show PUBLISHED-only (never teacherAction); comments show DELIVERED-only; placeholder cards (উপস্থিতি/ফি/নোটিশ/ছুটির আবেদন/নোটিফিকেশন) show "শীঘ্রই আসছে" and fire no query.
### Negative / RBAC checks (must be BLOCKED)
- [ ] Guardian requesting a child they are NOT linked to (any GP query/file with that studentId) → Bangla ForbiddenError (link-scoped, default-deny).
- [ ] A staff (Teacher) token calling `myChildren` → denied (role gate — guardian-plane only).
- [ ] No guardian response anywhere exposes a Google Drive file id/URL; an unauthenticated `/files/:id` request is denied.
- [ ] Guardian sees NO staff-internal view (no Trackers/Chat/Admin/Library tab), no audit, no corpus/analytics; no guardian mutation exists (reserve/renew/leave-apply are not available in v1).
- [ ] A teacher who is also a parent uses two separate logins — the staff login never carries `guardian:read_child`, and the guardian login never carries staff perms.
