# PRD — Permission Matrix (every feature × every action, editable per role)

**Status:** Planned — owner questions answered 2026-10-20 (§12); ready to build. No feature code yet. Gaps in today's gates found along the way are listed separately (§12a).
**Owner:** Principal (SCD)
**Module prefix:** PM  ·  **Plane:** identity/operational (ADR-005)
**Traceability:** D-#790–#801 · refines D-#193 (AC-1, role-as-template) and its §10 deferral ("editing the templates themselves") · composes with D-#484 (delegated scope — the *where* axis, unchanged) · D-#17 (role set unchanged) · ADR-004 (row-scope) · ADR-008 (append-only audit)
**Catalogue (the build checklist):** [`permission-catalogue/`](permission-catalogue/README.md) — every feature and action ([README](permission-catalogue/README.md)), every resolver, REST route and app gate per area, the old → new map ([legacy-expansion](permission-catalogue/legacy-expansion.md)), and the gaps found in today's gates ([findings](permission-catalogue/findings.md)). Built from a 2026-10-20 read of origin/dev `f9617aef`: ~416 mutations, ~515 queries, ~30 REST routes.

## At-a-glance (checklist)
- [ ] Every feature is split into **actions** — homework: declare, issue, mark submitted, check, return, confirm the day, undo, delete unissued, view… — and each action is a permission `feature:action`.
- [ ] A new **Roles** tab in Access control: pick **Teacher** or **Office** → every feature, every action, an On/Off switch. Principal always holds everything; Guardian is not in the editor.
- [ ] Role edits are stored as a **delta on the code default** (`RoleTemplateOverride`), so a new feature's default actions still arrive for every role on deploy.
- [ ] The per-person editor stays and shows the **same feature × action grid** on top of the person's role(s).
- [ ] **What vs where is unchanged:** the action permission says *what*; the teaching grant / delegation / designation still says *where* (D-#484 stands).
- [ ] **Ship day changes nobody's access.** Each role's default action set is the exact expansion of today's coarse set; the verifier proves it.
- [ ] Released app bundles keep working: `myPermissions` keeps answering the old coarse names until every phone runs the new bundle.
- [ ] **Rule for the future:** a feature cannot ship unless every resolver it adds names a catalogued action — a source-scanning test fails CI otherwise.
- [ ] One release: all modules swept in one go (owner ruling 2026-10-20).

## 1. Goal
The owner's ask (2026-10-20): *"After selecting each role I should be able to see all the features with all the permissions — e.g. homework should have permissions for declare, issue, mark submit, check, return etc. — for all the features. When a new feature is added it should also be added to the permission list with all its permissions."*

Two things are missing today:
1. **Action grain.** Permissions are coarse. One `tracker:write` covers declaring, issuing, marking submitted, checking and returning homework — *and* the same for assignments and class tests. No switch can turn one of those off alone.
2. **Role-level editing.** Role templates (`ROLE_PERMISSIONS`) are code. The AC-2 editor edits one person at a time; editing the templates themselves was deferred (prd-access-control §10, Fork 1 = A). This PRD lifts that deferral.

## 2. What stays exactly as today
- **Roles:** PRINCIPAL / TEACHER / OFFICE / GUARDIAN (D-#17). No new role.
- **Row-scope (the *where*).** Teaching grants, supervisory (read-only), proxy, delegation (D-#484–#489), and duty designations (class teacher, homework confirmer, librarian, attendance marker of the day, assigned observer, vocab tester). Holding `homework:check` does **not** let a teacher check another class's homework; `assertCanWrite` still decides that.
- **Delegated duties.** `DELEGATED_ACTIONS` and their gates are unchanged. A delegation widens *where*; the holder still needs the matching action permission (§5.3).
- **Reserved, Principal-only powers.** The five reserved permissions keep their posture, under their new names (§4.4).
- **Guardian plane.** Guardians keep `guardian:read_child` only. Guardian-facing resolvers are not in the editor.
- **Self-service.** Things anyone does for themselves (apply own leave, own tasks, own notifications, own password, push registration) stay `authenticated` + own-row checks. They are listed in the catalogue as **SELF** so the editor can show them, read-only.
- **The PII firewall** (ADR-005). Identity plane only; no corpus path; NFR-11 stays green.

## 3. Gap table
| # | Today (live repo, origin/dev f9617aef) | Wanted | This PRD |
|---|---|---|---|
| G1 | ~60 coarse permissions; `tracker:write` = every tracker write | Per-action switches | `feature:action` permissions from `FEATURE_CATALOGUE` |
| G2 | Role templates are code (`ROLE_PERMISSIONS`) | Edit Teacher / Office as a role | `RoleTemplateOverride` delta + Roles tab |
| G3 | Per-person editor lists permissions grouped by prefix | Same view per role and per person | One feature × action grid component, two hosts |
| G4 | Some powers ride the PRINCIPAL **role** inside a resolver (exam publish, scholarship release, monthly-report overrides…) | Visible, switchable | Each becomes an action, default Principal-only (§4.5) |
| G5 | Adding a feature = an ad-hoc permission choice; reuse encouraged (D-#94) | Every new feature appears in the list with all its actions | Catalogue entry + source-scanning test (§9) |

## 4. The model

### 4.1 The catalogue (`/shared/vocab.ts`, app-native — no wire-contract twin)
```ts
export const FEATURE_CATALOGUE = {
  homework: {
    group: "teaching",                 // editor section
    actions: {
      view:            { default: ["TEACHER"] },
      view_all:        { default: [] },
      declare:         { default: ["TEACHER"] },
      issue:           { default: ["TEACHER"] },            // give to a student who was absent
      mark_submitted:  { default: ["TEACHER"] },
      check:           { default: ["TEACHER"] },
      return:          { default: ["TEACHER"] },
      confirm_day:     { default: ["TEACHER"], needs: "designation:homework_confirmer" },
      undo:            { default: ["TEACHER"] },            // own step, same day
      undo_any:        { default: ["OFFICE"] },             // today's isAdminStaff revert
      edit_all:        { default: [] },                     // today: PRINCIPAL bypass in assertCanWrite
      delete:          { default: ["OFFICE"] },             // today's homework:void (never-issued items)
      view_reports:    { default: ["OFFICE"] },
      remind:          { default: ["OFFICE"] },             // weekly guardian follow-up
    },
  },
  // … every feature
} as const satisfies Record<string, FeatureDef>;

export type Permission = /* derived: `${feature}:${action}` for every catalogue entry */;
export const PERMISSIONS: readonly Permission[] = /* derived from the catalogue */;
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = /* derived from `default` */;
```
- **PRINCIPAL is implicit in every action** and is not written in `default`.
- **GUARDIAN** keeps a single hand-written entry, `guardian:read_child`.
- The derived `PERMISSIONS` / `ROLE_PERMISSIONS` keep their names and types, so `effectivePermissions`, `callerHasPermission`, `permissionsForRole` and every `authScopes: { hasPermission }` site keep working unchanged.
- Labels: `FEATURE_LABELS_BN/_EN` (feature name + one-line description) and `ACTION_LABELS_BN/_EN` keyed by `feature:action` (name + one-line description). The verifier requires both to be total.
- Each action may carry `{ reserved: true }` (§4.4), `{ needs: "designation:<name>" }` (shown in the editor as "also needs: শ্রেণি শিক্ষক"), or `{ self: true }` (read-only row).

### 4.2 Role-template override (new collection, identity plane)
```ts
RoleTemplateOverride {
  role: "TEACHER" | "OFFICE";        // unique
  granted: Permission[];             // added on top of the code default
  revoked: Permission[];             // removed from the code default
  updatedBy, updatedAt
}
```
**Why a delta, not a stored full set:** when a later release adds `homework:new_thing` with `default: ["TEACHER"]`, every teacher gets it on deploy, unless the Principal has explicitly turned it off. A stored full set would freeze the role at the day it was first edited and silently withhold every new feature.

Resolution (extends D-#193's formula; one seam):
```
roleSet(r)      = (codeDefault(r) ∪ override(r).granted) − override(r).revoked
effective(user) = (⋃ roleSet(t) for t in [role, …additionalTemplates] ∪ user.granted) − user.revoked
                  − RESERVED for any non-Principal
PRINCIPAL       = every catalogued staff permission, always (not editable)
```
A per-person revoke still beats everything; a per-person grant still adds on top of the role.

### 4.3 Where the override is read
The role override is **not** put in the JWT (it would bloat every token and lag a role edit by up to a session). The server keeps it in an **in-process cache**, loaded at boot and replaced on every override write, with a 60 s re-read as a safety net. Prod and dev each run one server process, so a role edit applies to the very next request. The user's own deltas still ride the token exactly as today (D-#211/#708).

`callerHasPermission(ctx.auth, perm)` gains the cache as an input. `effectivePermissions` stays a pure function: `effectivePermissions(profile, roleOverrides)`.

### 4.4 Reserved actions (Principal-only, locked)
The five reserved permissions keep the D-#212/#213 posture under their catalogue names:

| Today | Catalogue name(s) |
|---|---|
| `payroll:approve` | `payroll:approve`, `salary_advance:issue`, `salary_advance:settle`, `offboarding:settle` |
| `performance:signoff` | `appraisal:sign_off`, `conduct:sign_off` |
| `chat:oversee` | `chat:view_all` |
| `template:manage` | `message_templates:view`, `message_templates:edit` |
| `access:manage` | `access_control:edit`, `access_control:delegate` |

They show in the editor as **locked** rows (lock icon, no switch). Write-time rejection (Bangla 422) and the read-time backstop both stay. The verifier pins the exact set. The catalogue README is authoritative for the final names.

**The Principal is a superset on ship day, and that is safe.** Today the Principal lacks `attendance:mark` (D-#64) and `observation:review` (D-#147) on purpose. Under "Principal holds every action", the Principal gains both, but both are designation-gated: the Principal is never the marker of the day or an assigned observer, so nothing he can do changes. The ship-day equality check (§6) exempts exactly these designation-gated actions for PRINCIPAL.

### 4.5 Powers that ride the PRINCIPAL role today
Some resolvers decide by `isPrincipalStaff` / `ctx.auth.role === "PRINCIPAL"` instead of a permission (exam/syllabus publish, scholarship release to guardians, the monthly-report coverage override / revoke / reopen, …; full list in the catalogue). Each becomes an explicit action with **default = Principal only, not reserved**, so it appears in the editor and the Principal can hand it to Office or a teacher. The decision to keep any of them *reserved* instead is listed as an open question (§12).

## 5. Enforcement

### 5.1 Server gates
Every resolver names the action it performs:
```ts
authScopes: { hasPermission: "homework:check" }
```
The extra gates that follow (`assertCanWrite`, `assertCanConfirmHomework`, own-row checks, service rules) stay. Where one resolver does two things depending on its input (`transitionHomeworkRecord(toState)`), the resolver checks the second action inside, with `assertHasPermission(ctx, "homework:mark_submitted")`.

### 5.2 Designations
Where a designation is the real gate (class teacher, homework confirmer, librarian, marker of the day, assigned observer, vocab tester), the action permission means **"may do this when designated"**. Both must pass. Turning `homework:confirm_day` off for TEACHER stops every class teacher from confirming. Turning it on does not make a non-class-teacher a confirmer.

**Waiver:** a holder of the feature's `view_all` (reads) or `edit_all` (writes) passes without the designation. That is how Office passes these gates today. A few actions name a different lever in the catalogue (e.g. `assignment:confirm_week` is waived by `assignment:settings`).

### 5.2a Two-hat logins (teacher + Office template)
Today some bypasses are template-aware (`isAdminStaff`) and others check only the primary role (`assertCanWrite`, `vocabGate`, `contentScope`). So a teacher who also holds the Office template has a mixed set of powers. Once one `edit_all` replaces both kinds, three write powers shift for these people: `class_test:edit_all`, `scholarship_practice:edit_all` and `assignment:edit_all`. Pure Teacher and pure Office logins are reproduced exactly. These rows are flagged `2H` in the catalogue, and the /verify drive includes one two-hat login.

### 5.3 Delegations
A delegation action (`check_homework`) widens *where*. A fixed map `DELEGATED_ACTION_PERMISSIONS` ties each delegated duty to the **full set** of new actions it covers today. D-#592 made a duty cover its whole tail: `check_homework` = check + return + the answer file; `declare_*` = declare + fix/delete + give to an absent student + the question file; undo passes on any of a tracker's duties. So `check_homework` maps to `homework:check` + `homework:return` (and `assignment` adds `resubmit`). Existing delegates keep exactly what they do today, and nothing is migrated in `ScopeGrant.actions`.

The delegate must also hold each mapped permission. A delegation never grants a permission (D-#484): if the Principal switches Teacher `homework:return` off, a `check_homework` delegate can still check, but not return. The delegated-duties editor shows which parts of a duty the person lacks.

### 5.4 Reach: `view_all` and `edit_all`
Today "see the whole school" and "act on anyone's rows" are decided by **role** in about 60 places: `isAdminStaff`, `ctx.auth.role === "PRINCIPAL"`, `role === "TEACHER"` self-scoping, and a blanket refusal of OFFICE in `assertCanWrite` / `assertAnchorWrite` / `vocabGate` (`middleware/authz.ts:202`). That is why a switch alone would lie: granting Office `class_test:enter_results` would show **on** and still 403 at the scope layer.

Each feature that has such a bypass gets:
- `view_all`: read beyond your own scope (replaces the read bypasses);
- `edit_all`: act on rows beyond your own scope, or on other people's work (replaces the write bypasses and the blanket Office refusal).

The scope helpers take the feature: `assertCanWrite(ctx, sectionId, subjectId, { feature: "class_test", action })` passes on `class_test:edit_all`, otherwise on teaching / proxy / delegation exactly as today. Defaults reproduce today: Office holds `view_all` where it reads school-wide today and `edit_all` only where it writes school-wide today, so **D-#554 holds by default**.

This is still not a per-person *extent* (D-#484). `edit_all` is all-or-own for a whole role or person. "Class 4 only" stays a delegation.

### 5.5 Notification recipients follow the action
About a dozen emitters pick recipients by role: office queue cards, leave-approval cards, print and leave pushes, attendance reminders, work-claim digest (catalogue §g per area). A teacher given `leave:approve` would never be told a leave is waiting, and an Office user with it switched off would still get the card. Each such emitter resolves recipients as **every active staff user who holds the action** (`holdersOf(permission)`), plus any designation it already uses. With defaults, the recipients are the same people as today.

### 5.6 Escalation guards
Some actions mint authority: create a login, reset a password, provision a staff login, add a teaching / supervisory / proxy grant, set a user's role. Today only the Principal holds them, so they are safe. Once they become switchable, an Office holder could reset the Principal's password. Before any of these can be switched on for Teacher or Office, the service gains a **target guard**: only the Principal may create, reset or re-role a PRINCIPAL login, and nobody may grant an action they do not hold themselves. These actions carry the `ESCALATION` flag in the catalogue. The editor keeps them off and locked until their guard ships, which is in this release.

### 5.7 One resolver, two features
`importEnvelope` / `importFiles` take both lesson plans and question banks. The resolver already parses the envelope before writing, so it checks `lesson_plans:import` or `question_bank:import` for what it actually received. Read queries shared by two features (`homeworkIssueRoster`, `reconciliationReport`) use `hasAnyPermission`.

### 5.8 Sensitive fields
The `staff` query returns salary, bank and NID fields under plain `staff:manage`. These fields get field-level gates: pay fields need `payroll:view`, and NID and bank fields need `staff_records:view_sensitive`. Office holds both by default, so nothing changes until someone is switched off.

## 6. Migration (ship day changes nobody's access)
1. **Code defaults = today, exactly.** For each role, `ROLE_PERMISSIONS` (derived) must equal `expand(today's ROLE_PERMISSIONS)`, using `LEGACY_PERMISSION_EXPANSION` (old name → the new actions it covered; [legacy-expansion.md](permission-catalogue/legacy-expansion.md)). Umbrella permissions expand one-to-many: `roster:manage` alone reaches about 17 modules (printing, class-test desk, comments, vocab, notes, worksheets…), and `tracker:write` reaches homework, assignment, class test, comments, revision and worksheets. Actions that today ride a role check default to that role. The verifier asserts this equality, so a wrong default fails CI.
2. **Per-person deltas.** `User.grantedPermissions` / `revokedPermissions` hold old names. These are expanded at **read time** through the same map, so no DB write is needed on ship day. A one-off script, run later by the owner, rewrites the arrays to the new names (dry-run first; prod writes via the dist service, per the prod-write rule). After that runs, the read-time expansion is removed.
3. **Old app bundles.** `myPermissions` also returns the **old coarse names** a caller would have held (`tracker:write` if they hold any homework/assignment/class-test write action, and so on), via `LEGACY_PERMISSION_ALIASES`. An app bundle from before this release keeps showing its screens. The aliases are retired once the OTA has been out for one APK cycle (tracked in STATUS).
4. **Old JWTs** carry old names in their delta arrays; read-time expansion covers them.
5. **Delegation grants** (`ScopeGrant.actions`) keep their strings; nothing to migrate.

## 7. The editor (app)
**Access control** gets two tabs: **ভূমিকা (Roles)** and **ব্যক্তি (People)** — the existing user list.

**Roles tab:** pick শিক্ষক (Teacher) or অফিস (Office) → features grouped by section (Teaching, Students & families, Staff & HR, Finance, Content, School operations, Admin). Each feature is a collapsible card:
```
▾ বাড়ির কাজ (Homework)                                  9 / 14 on
    দেখা                         View                        [On ]
    সব শাখার বাড়ির কাজ দেখা      View all sections            [Off]
    ঘোষণা করা                    Declare                     [On ]
    অনুপস্থিতকে পরে দেওয়া        Give to an absent student    [On ]
    জমা নেওয়া                    Mark submitted              [On ]
    যাচাই করা                    Check                       [On ]
    খাতা ফেরত দেওয়া              Return                      [On ]
    দিনের কাজ চূড়ান্ত করা         Confirm the day             [On ]  also needs: শ্রেণি শিক্ষক / confirmer
    নিজের ধাপ ফিরিয়ে নেওয়া       Undo own step               [On ]
    যেকোনো ধাপ ফিরিয়ে নেওয়া      Undo anyone's step          [Off]
    যেকোনো শাখায় কাজ করা          Work in any section         [Off]
    না-দেওয়া কাজ মুছে ফেলা        Delete never-issued         [Off]
    রিপোর্ট দেখা                  Reports                     [Off]
    অভিভাবককে রিমাইন্ডার           Guardian reminder           [Off]
```
- Each row has a badge: **default** / **changed** (differs from code default, with "reset to default").
- Each card header has an all-on / all-off for that feature, and a count.
- A search box filters features and actions.
- Locked rows (reserved) show a lock; SELF rows show "everyone, for themselves".
- Saving writes one override row per change, with a `ROLE_TEMPLATE_CHANGED` audit row (prior + new delta).
- A confirmation states how many people the change affects ("এই পরিবর্তন ২৩ জন শিক্ষকের উপর প্রযোজ্য").

**People tab:** the existing per-person screen, re-laid as the same grid. Each row's badge says where it comes from: from role / added for this person / removed for this person / locked.

The grid is one component (`PermissionMatrix`) used by both tabs, driven by `FEATURE_CATALOGUE`. A new catalogue entry appears in both with no app change.

Gated by `access_control:edit` (reserved, Principal-only — today's `access:manage`).

## 8. App gating
Every button and screen that performs an action checks that action: `can("homework:check")`. Screens open on `view`; a screen whose actions are all off hides from the drawer. The app sweep is listed per screen in the catalogue.

## 9. The rule for every future feature (docs + CI)
A new feature is not done until:
1. It has a `FEATURE_CATALOGUE` entry listing **every** action a person can do in it, with default roles and BN/EN labels.
2. Every resolver it adds names one of those actions in `authScopes` (or is marked SELF / GUARDIAN with a one-line reason).
3. Every app button that triggers a mutation checks the same action with `can()`.

4. Every REST route it adds (`/files`, `/pdf`, exports) checks a catalogued action with `callerHasPermission`.
5. Any notification it sends to "whoever does X" resolves recipients with `holdersOf("feature:action")`, never a role list.
6. It never decides capability with a role check (`isAdminStaff`, `role === …`). Reach is `view_all` / `edit_all`; designations stay designations.

CI enforces 1, 2, 4 and 6:
- **Verifier §C.PM** (in `verify_shared_vocab.mjs`): catalogue labels total; no orphan permission; reserved set exact; PRINCIPAL holds all; GUARDIAN exact; code defaults equal the legacy expansion (until retired).
- **Source-scanning test** (`permissionCatalogueGates.test.ts`, the D-#592 posture). It parses every resolver file and every REST router, and it fails if:
  - a query, mutation or route has no `hasPermission` / `hasAnyPermission` / `callerHasPermission` naming a catalogued action and is not on the SELF/GUARDIAN allow-list (each allow-list entry carries a one-line reason);
  - a catalogued action gates nothing (a dead switch that turns nothing off);
  - a new `isAdminStaff` / `role ===` capability check appears outside the frozen list of designation helpers.

**Docs already state the rule.** This docs PR adds it now, so features built before the matrix ships (e.g. Mastery M-0) also register in [`permission-catalogue/`](permission-catalogue/README.md). It goes into `AGENTS.md` (hard rule), `skills/feature-lifecycle/SKILL.md` (step 5), `shared/AGENTS.md`, `skills/contract-sync/SKILL.md` and `docs/architecture.md` §7. Until the build ships, the catalogue doc is the registry. After it ships, `FEATURE_CATALOGUE` in `vocab.ts` is the registry and the doc is generated from it.

## 10. Journeys (Given/When/Then)
- **J-PM1 (role edit).** Given the Principal on Roles → Teacher, when he turns off বাড়ির কাজ → ফেরত (Return), then every teacher's next tap on ফেরত দিন gets the Bangla "অনুমতি নেই" message; the button is hidden after the teacher's next app open; an audit row records the change.
- **J-PM2 (person on top of role).** Given Teacher Return is off, when the Principal turns Return on for Jerin on People, then Jerin can return homework and nobody else can.
- **J-PM3 (new feature).** Given a release adds feature `mastery` with `default: ["TEACHER"]` actions, when it deploys, then every teacher has them and the Roles tab shows a Mastery card with no app change to the editor.
- **J-PM4 (revoked stays revoked).** Given the Principal turned off Teacher `class_test:publish`, when a later release adds a new class-test action, then the new action is on for teachers and `publish` stays off.
- **J-PM5 (ship day).** Given the release deploys, when any staff member signs in, then their effective permission set (expanded) equals what they held before, and their old app bundle still shows every screen.
- **J-PM6 (designation).** Given Teacher `homework:confirm_day` is on, a non-class-teacher still cannot confirm a day.
- **J-PM7 (delegation).** Given Jerin holds a whole-school `check_homework` delegation and the Principal turns off Teacher `homework:check`, Jerin can no longer check anywhere, and the delegated-duties editor shows the duty greyed with the reason.
- **J-PM8 (locked).** The Principal cannot turn on `payroll:approve` for Office: the row is locked; a direct API call gets the Bangla 422.

## 11. Build (one release, owner ruling 2026-10-20)
All modules are swept in one release, but the work is still ordered so each step is verifiable:
1. **Foundation:**
   - `vocab.ts`: the catalogue, the derived lists, the legacy expansion, the aliases and `DELEGATED_ACTION_PERMISSIONS`.
   - Verifier §C.PM.
   - `RoleTemplateOverride`, its cache and the new resolution.
   - The role-editor mutations and the `ROLE_TEMPLATE_CHANGED` audit kind.
   - Scope helpers that take a feature (`edit_all`).
   - `holdersOf()`.
   - The escalation target guards.

   Gate: verifier green; the ship-day equality holds.
2. **Server sweep:** every resolver, REST route, role-check bypass and role-based notification recipient re-gated to its catalogue action, module by module. The work runs in parallel short-path worktrees off one integration branch, on disjoint files, following the per-area checklists. Gate: server tsc + full jest + the source-scanning test green.
3. **App:** the `PermissionMatrix` editor (Roles + People) + the `can()` sweep. Gate: app tsc + web export + a /verify drive (role edit → a teacher's button disappears and the API refuses).
4. **Docs + rule:** AGENTS.md, skills, architecture, the catalogue file in sync.
5. **Release:** one PR → `dev` → owner checks on the dev site → promote + OTA. The legacy aliases keep older bundles working.

## 12. Owner answers (2026-10-20) — all six settled
| # | Question | Answer | Effect |
|---|---|---|---|
| 1 | Principal-only powers (the 13 `PRINCIPAL-DEFAULT` rows: exam/syllabus publish; monthly-report override, revoke, thresholds; result-entry targets; work-claim digest list; observation quota; book-build force; `edit_all` for homework, assignments, set tracker, question sets, vocab): switchable or locked? | **Switchable** | As planned: default Principal only, switchable for Teacher/Office. Only the 11 `LOCKED` rows stay locked. D-#397/#424/#533 now hold by default, not as a guarantee. |
| 2 | D-#554 (Office never resolves tracker work): a default, or locked? | **Can be changed** | Office tracker actions default off and are switchable. |
| 3 | Homework `issue` = give to an absent student later (the day is issued by confirm day) | **OK** | As planned. |
| 4 | Return split from check; existing check delegations map to both | **OK** | As planned (`DELEGATED_ACTION_PERMISSIONS`). |
| 5 | SELF actions always-on, shown read-only | **Yes** | As planned: the 12 `SELF` rows are not switchable. |
| 6 | Sensitive staff fields get their own switches | **Yes** | Field gates on `staff` / `staffProfile`: `monthlySalary` → `payroll:view`; NID and bank fields → new `staff_records:view_sensitive` (Office on by default). A holder of `staff_records:view` alone gets those fields as null. |

## 12a. Gaps found in today's gates
The inventory found gaps in **today's** gates that this plan does not cause, listed in [findings.md](permission-catalogue/findings.md). The most serious is that `studentsInSection` needs only a login: a guardian's login can read any section's student date of birth, phone, address and blood group, and their guardians' phones. These are separate fixes, each in its own PR, and are **not** folded into the matrix release. The matrix's source-scanning test (§9) would have caught `studentsInSection`, because it gates nothing catalogued and is not on the SELF/GUARDIAN list.

## 13. Out of scope
- New roles, or editing the GUARDIAN or PRINCIPAL templates.
- Changing row-scope, grant kinds, designations, or delegation semantics.
- Time-bounded permission grants (proxy and delegation `expiresAt` already cover time-bounded reach).

## 14. Firewall
`RoleTemplateOverride` lives in the identity plane (`access-control` module). No corpus import. The firewall test adds the new files to the corpus ↛ access-control block.
