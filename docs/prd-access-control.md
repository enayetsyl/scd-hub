# PRD — Per-User Access Control (role-as-template + per-user grant/revoke)

**Status:** Planned — design ratified, no feature code yet
**Owner:** Principal (SCD)
**Module prefix:** AC  ·  **Plane:** identity/operational (ADR-005)
**Traceability:** D-#193 (refines/supersedes D-#17) · ADR-004 (row-scope) · ADR-005 (plane firewall) · ADR-008 (append-only audit) · ADR-017 (scope grants)

## At-a-glance (checklist)
- [ ] Role stops being the final word on permissions → becomes a **template** (a starting set).
- [ ] A staff login resolves to: **effective = (∪ templates ∪ granted) − revoked**, reserved-locked perms excluded for non-Principal.
- [ ] Two teachers on the same template can differ (8 vs 20) via per-person add/remove.
- [ ] One person can hold **Teacher ＋ Office** templates at once (multi-template union).
- [ ] Five permissions are **reserved-locked** (Principal-only, ungrantable): `payroll:approve`, `performance:signoff`, `chat:oversee`, `template:manage`, `access:manage`.
- [ ] Guardian is untouched — a different login identity, walled off.
- [ ] Fully additive — **zero migration**; existing logins behave exactly as today until edited.
- [ ] One new permission `access:manage` (Principal-only) gates the whole editor.

## 1. Goal
Let the Principal tune *what each individual staff member can do* — by feature and sub-feature — without minting new roles. The capability vocabulary already exists at the right granularity (`resource:action`, ~36 scopes); today it is bound to a fixed role map (`ROLE_PERMISSIONS`) read through one helper (`roleHasPermission`). This feature turns the role into an editable-per-person **template** and changes that single resolution seam — nothing downstream.

## 2. What stays exactly as today (no churn)
- The **role set** is unchanged: `PRINCIPAL / TEACHER / OFFICE / GUARDIAN` (D-#17). We are not adding roles.
- **Row-scope is untouched.** *Where* a teacher may act (`ScopeGrant`: teaching / supervisory / proxy) and duty designations (class-teacher of a section, librarian, vocab tester) are a separate axis (ADR-004). Granting a person `tracker:write` per-user does **not** widen which sections they reach — the section check (`assertCanWrite`) still applies. This PRD governs *what*, never *where*.
- **Guardian plane** (Fork 3 ruling, D-#193): `Guardian` is a distinct login entity from staff `User`, behind the ADR-005 firewall. The per-user model governs the staff `User` only. Staff permissions are **ungrantable** to a `Guardian`; `guardian:read_child` is **ungrantable** to a staff `User`. A teacher who is also a parent uses two logins by design (the staff `User` + the family `Guardian` credential, D-#59); switching hats = switching login. The shared-phone ambiguity already fails **closed** (D-#103/#185) — no masquerade.

## 3. Gap table
| # | Today (live repo) | Wanted | This PRD |
|---|---|---|---|
| G1 | Role = fixed permission set (`ROLE_PERMISSIONS`) | Per-person tuning | Role becomes a template; per-user `granted`/`revoked` on top |
| G2 | Two same-role teachers are identical in capability | 8 vs 20 for same role | Per-user add/remove ⇒ different effective sets |
| G3 | One login = one role | Some-admin-some-teacher | `additionalTemplates[]` (TEACHER/OFFICE union) |
| G4 | No editor surface ("no permission-admin UI", vocab §B) | Principal edits permissions | `access:manage` + AC-2 screen |
| G5 | Principal-only perms enforced by role map | Keep that guarantee under per-user grants | Reserved-locked set, structurally filtered + verifier-proven |

## 4. The model (additive, zero migration)
Three optional fields on the existing staff `User` (default empty ⇒ identical to today; no backfill on shared Atlas, worktree rule 3):
- `additionalTemplates: Role[]` — default `[]`. **Assignable templates = {TEACHER, OFFICE} only** (`ASSIGNABLE_TEMPLATES`). `PRINCIPAL` is **not** an assignable additional template (there is one Principal, by provisioning); `GUARDIAN` is never assignable to a `User`.
- `grantedPermissions: Permission[]` — default `[]`. Per-user adds. A reserved-locked perm is **rejected at write-time** (Bangla 422).
- `revokedPermissions: Permission[]` — default `[]`. Per-user removes; a revoke always wins.

`User.role` is the **primary template** (untouched). Effective templates = `[role, ...additionalTemplates]`.

## 5. The single seam (the only behavioural change)
A pure function replaces the per-caller role lookup. All ~hundreds of existing gates keep calling the resolver middleware unchanged; only the middleware's "what can this caller do?" answer is recomputed.
effectivePermissions(user):

base   = ⋃ permissionsForRole(t)  for t in [user.role, ...additionalTemplates]

eff    = (base ∪ grantedPermissions) − revokedPermissions

if user.role !== "PRINCIPAL":

eff = eff − RESERVED_PERMISSIONS      // structural backstop: reserved perms can ONLY reach a PRINCIPAL login

return eff
callerHasPermission(user, perm) = effectivePermissions(user).has(perm) && isPermissionActive(perm)

- `RESERVED_PERMISSIONS = [payroll:approve, performance:signoff, chat:oversee, template:manage, access:manage]` — Fork 2 ruling.
- The reserved filter is the guarantee: even if a future bug placed a reserved perm in a template or in `granted`, a non-Principal can never hold it. The write-time rejection is the first gate; this filter is the backstop.
- `roleHasPermission` is **retained** (templates still use it via `permissionsForRole`); it is no longer the per-caller authority.

## 6. Slices (build order)
- **AC-1 (server):** the three `User` fields + `effectivePermissions`/`callerHasPermission` pure functions + the resolver-middleware seam swap + `access:manage` permission (vocab) + the grant/revoke/template mutations (`access:manage`-gated, reserved-locked rejection, Bangla deny) + `USER_ACCESS_CHANGED` audit (records prior + new {templates, granted, revoked}, ADR-008/D-#101 prior-state pattern) + `effectivePermissions(userId)` read for the screen. **No app.** No wire-contract twin (Role/Permission are app-native, vocab §B header) — no harness/envelope sync.
- **AC-2 (app):** the Principal-only editor screen (entry gated `access:manage`; server re-enforces). Per staff user: template chips (Teacher/Office add-remove), then every live `PERMISSIONS` entry grouped by module, each row showing a **provenance state** — `টেমপ্লেট থেকে` (from template) / `যোগ করা হয়েছে` (added) / `সরানো হয়েছে` (removed) / `সংরক্ষিত` (locked, non-editable). Tapping toggles add/remove relative to the template baseline. Bangla-first throughout.

## 7. Vocabulary additions (`/shared/vocab.ts`, app-native — no wire sync)
- `PERMISSIONS += "access:manage"` ; `PERMISSION_BUILD_STATUS["access:manage"] = "build"` ; `ROLE_PERMISSIONS.PRINCIPAL += "access:manage"` (Principal only — Office/Teacher/Guardian never).
- `RESERVED_PERMISSIONS` (the five) and `ASSIGNABLE_TEMPLATES = ["TEACHER","OFFICE"]` constants.
- **`PERMISSION_LABELS_BN` + `PERMISSION_LABELS_EN`** — a Bangla (＋ English) name **and short description** for **every** entry of the live `PERMISSIONS` array (the screen needs them; Bangla-first). Build covers the live array exactly — proposed labels below; confirm/adjust at review:

  | Permission | Bangla name (proposed) |
  |---|---|
  | content:read · question:read · set:read | কনটেন্ট/প্রশ্ন/সেট দেখা |
  | content:import / assign_review / review / promote_gold | কনটেন্ট ইম্পোর্ট / রিভিউ বরাদ্দ / রিভিউ-অনুমোদন / গোল্ড চিহ্নিত |
  | question:select · set:assemble · set:export | প্রশ্ন নির্বাচন / সেট তৈরি / সেট এক্সপোর্ট |
  | tracker:read · tracker:write · tracker:export | ট্র্যাকার দেখা / এন্ট্রি / এক্সপোর্ট |
  | routine:read · routine:manage | রুটিন দেখা / পরিচালনা |
  | attendance:mark · attendance:manage | হাজিরা মার্ক / হাজিরা পরিচালনা |
  | library:read · library:manage | লাইব্রেরি ব্রাউজ / ডেস্ক ও ক্যাটালগ |
  | chat:read · chat:write · chat:manage · **chat:oversee** | চ্যাট পড়া / পাঠানো / গ্রুপ পরিচালনা / **চ্যাট তদারকি (সংরক্ষিত)** |
  | roster:manage | রোস্টার ও ক্লাস-টিচার বরাদ্দ |
  | staff:manage · leave:manage | স্টাফ রেকর্ড / স্টাফ ছুটি পরিচালনা |
  | payroll:manage · **payroll:approve** | বেতন প্রস্তুত / **বেতন অনুমোদন ও লক (সংরক্ষিত)** |
  | performance:manage · **performance:signoff** | পারফরম্যান্স পরিচালনা / **মূল্যায়ন চূড়ান্ত অনুমোদন (সংরক্ষিত)** |
  | guardian:link · message:dispatch | অভিভাবক লগইন সংযুক্ত / বার্তা পাঠানো |
  | user:manage · audit:read | ইউজার লগইন পরিচালনা / অডিট লগ পড়া |
  | **template:manage** · **access:manage** | **বার্তা টেমপ্লেট সম্পাদনা (সংরক্ষিত)** / **অনুমতি পরিচালনা (সংরক্ষিত)** |
  | guardian:read_child | সন্তানের তথ্য দেখা (অভিভাবক প্লেন — স্টাফকে দেওয়া যায় না) |
- Follow the vocab header "add a Permission" checklist (PERMISSIONS → ROLE_PERMISSIONS → PERMISSION_BUILD_STATUS → labels).

## 8. Verifier additions (new §, exact-set checks)
- `access:manage` exists, build, and is **PRINCIPAL-exact-holder** (the `template:manage`/`payroll:approve` posture).
- `RESERVED_PERMISSIONS` is exactly the five; **none appears in `ROLE_PERMISSIONS.TEACHER` or `.OFFICE`** (reserved perms reach only PRINCIPAL).
- `ASSIGNABLE_TEMPLATES` excludes `PRINCIPAL` and `GUARDIAN`.
- `PERMISSION_LABELS_BN`/`_EN` are **total** over `PERMISSIONS` (every scope labelled).

## 9. Journeys (Given/When/Then)
- **J-AC1 (different perms, same template):** *Given* two Teacher-template logins, *When* the Principal removes `tracker:export` and `chat:write` from teacher A and adds `library:manage` to teacher B, *Then* A's effective set shrinks by two and B's grows by one; both still reach only their own sections (row-scope unchanged).
- **J-AC2 (multi-template):** *Given* a Teacher login, *When* the Principal adds the Office template, *Then* effective = teacher ∪ office perms (e.g. now holds `roster:manage`, `leave:manage`), **minus** the reserved five — the deputy/acting-office config.
- **J-AC3 (reserved-locked):** *Given* any non-Principal login, *When* the Principal tries to add `payroll:approve`, *Then* the mutation is refused (Bangla 422) and the row renders `সংরক্ষিত`, non-toggleable; the backstop filter would drop it even if forced.
- **J-AC4 (guardian wall):** *Given* a teacher who is also a parent, *Then* their staff login carries staff permissions and never `guardian:read_child`; their family `Guardian` login sees only their own children — neither path crosses (J5.6 firewall stays green).
- **J-AC5 (zero-migration):** *Given* every existing login pre-AC, *When* AC-1 ships, *Then* with empty arrays each resolves to its old role set byte-for-byte; no login changes until edited.
- **J-AC6 (audit):** *Given* any edit, *Then* `USER_ACCESS_CHANGED` records actor, target, prior and new {templates, granted, revoked}; the Principal can read the trail via `audit:read`.

## 10. Out of scope (v1)
- **Editing the templates themselves** (Fork 1 = A) — templates remain the code-defined Teacher/Office/Principal sets; global redefinition is deferred.
- A "switch account" convenience for teacher-parents (two logins stand; UX sugar later).
- Time-bounded / expiring per-user grants (proxy already handles time-bounded *reach*; capability expiry deferred).
- Any change to row-scope, `ScopeGrant`, or duty designations.

## 11. Reused / unchanged
- `ROLES`, `ROLE_PERMISSIONS`, `permissionsForRole`, `roleHasPermission`, `isPermissionActive` — all retained (templates consume them).
- `ScopeGrant` / `assertCanRead` / `assertCanWrite` / duty gates (`assertIsClassTeacher`, …) — untouched.
- `Audit` (ADR-008), `Guardian`/`GuardianLink` (D-#8/#59), the resolver middleware (ADR-004).

## 12. Firewall
All fields are on the identity-plane `User`; no corpus path is introduced. The NFR-11 fail-closed firewall test stays green; the AC build adds the new server files to the relevant block (corpus ↛ access-control).
