---
name: feature-lifecycle
description: Use when adding a new feature or changing an existing one in the school software repo. Covers the end-to-end flow from checking prior decisions through verified commit.
---
# Feature lifecycle

1. Read `STATUS.md` and `DECISIONS.md`. If the change touches a settled decision, STOP and flag it
   (state the decision, what's new, what it affects) — don't silently re-open it.
2. Locate the affected docs (`/docs`) and code. Read the live files before editing.
3. If the change is a real decision, append a row to `DECISIONS.md` (and an ADR to
   `docs/architecture.md` if architectural).
4. Implement with surgical edits (patch, don't regenerate).
   **Any list that grows over time is paged from the first commit (D-#761).** History, logs,
   records, results, comments, requests, anything that accumulates per day, per student or
   per year. Use a `<name>Page` query (`server/src/lib/paging.ts` + `server/src/pageRef.ts`)
   and `<Pager>` on the screen. Never a bare `.find()` with no limit, and never a silent
   `.limit(N)` with no way to reach older rows. See `docs/pagination.md`.
5. **Register every action in the permission catalogue (D-#799).** List each thing a person can do
   in the feature as `feature:action` (view, create, declare, check, return, approve, publish,
   export, settings…), with default roles (TEACHER / OFFICE; the Principal holds all), flags
   (LOCKED / PRINCIPAL-DEFAULT / DESIGNATION / ESCALATION / SELF) and BN/EN labels. Add it to
   `FEATURE_CATALOGUE` in `/shared/permissionCatalogue.ts` (the source of truth) and to
   `docs/permission-catalogue/README.md` + the area file's resolver/route/app-gate tables. Then:
   - every new resolver gets `authScopes: { hasPermission: "feature:action" }` (or is a listed SELF /
     GUARDIAN path with a reason);
   - every REST route checks its action with `callerHasPermission`;
   - every app button that triggers a mutation checks `can("feature:action")`;
   - "who should be told" = `holdersOf("feature:action")`, never a role list;
   - reach beyond own scope = `feature:view_all` / `feature:edit_all`, never `isAdminStaff` /
     `role === …`.
   Reusing another feature's permission ("composes existing perms", D-#94) is no longer allowed: the
   Principal must be able to switch the new feature's actions on and off by themselves.
   See `docs/prd-permission-matrix.md` §9.
6. If it touches the import contract or shared vocab/RBAC, run `/skills/contract-sync`.
7. Run `/skills/verify-before-commit`. Green output is the gate.
8. Update `STATUS.md`; append a `CHANGELOG.md` line. Commit (one change per commit); tag if a milestone.
