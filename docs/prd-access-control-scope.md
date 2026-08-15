# PRD — Delegated Scope (fine-grained "who may do what, where")

**Status:** Planned — design ratified in session 2026-08-15, no feature code yet
**Owner:** Principal (SCD)
**Module prefix:** ACS  ·  **Plane:** identity/operational (ADR-005)
**Traceability:** D-#484–#489 · builds on D-#193 (AC-1 per-user permissions) · ADR-004 (row-scope) · ADR-017 (scope grants) · D-#17/#18/#20 (the three existing grant kinds) · D-#351 (routine-derived attribution) · ADR-008 (append-only audit)

## At-a-glance (checklist)
- [ ] The owner's ask ("Tazkir may declare an assignment for **any** subject", "Jerin may submit homework for **any** subject") is the **row/scope axis**, not the permission axis — AC-1 cannot express it.
- [ ] A **fourth `ScopeGrant` kind: `delegation`** — the supervisory extent shape (whole school / class / subject / explicit set) plus an **action allow-list**.
- [ ] A delegation grant gives **read over its extent + exactly the listed write actions**. Supervisory stays read-only (D-#17 unchanged).
- [ ] New app-native vocab `DELEGATED_ACTIONS` + a `build | pipeline` status map (the `PERMISSION_BUILD_STATUS` idiom).
- [ ] Seam: `canWrite(scopes, sectionId, subjectId?, **action?**)` — a delegation grant matches **only when the call site names an action**, so every untagged gate behaves exactly as today. **Zero migration.**
- [ ] Optional `expiresAt`, enforced at request time (the proxy-window pattern, no cron).
- [ ] Gated by `access:manage` (reserved, Principal-only) — **not** `user:manage`.
- [ ] Attribution is untouched: a delegated declaration still lands in the routine's subject teacher's row (D-#351); `declaredBy` records who actually acted.
- [ ] The ad-hoc school-wide booleans (`User.homeworkSupervisor`, `Section.homeworkConfirmerId`) are the same idea hard-coded — **frozen now, folded in ACS-3**.

## 1. Goal
Let the Principal say, per person: *"you may do **this one thing** across a wider slice of the school than you teach."* Today that sentence has no home. AC-1 (D-#193) made the **action** axis per-person — it explicitly left row-scope alone (`prd-access-control.md` §2/§10/§11). This PRD makes the **extent** axis per-person, in the same additive, zero-migration posture.

## 2. Why not "just add permissions"
The obvious-looking move — mint `assignment:declare_any`, `homework:submit_any` — fails on three counts:
1. **Permissions are school-wide verbs with no *where*.** You could not then say "class 4 only", which is the next thing that gets asked.
2. **The list grows once per duty, forever**, and every new one is a two-place-ish edit plus a verifier exact-holder rule.
3. **It contradicts the AC-1 model.** Permission = *what*; `ScopeGrant` = *where* (ADR-004). A permission that encodes an extent puts two axes in one string, and `assertCanWrite` — which is what actually blocks the teacher today — would still have to be taught about it.

The block is concretely here: [`canWrite`](../server/src/modules/foundation/services/ScopeGrantService.ts) passes a **teaching** grant matching `(section, subject)` or an active **proxy**, and nothing else. A supervisory grant of any extent is read-only by design (D-#17). So no permission edit in the AC-2 editor can ever unblock Tazkir.

## 3. Gap table
| # | Today (live repo) | Wanted | This PRD |
|---|---|---|---|
| S1 | Write reach = own teaching grants `(section × subject)` only | "declare assignment for any subject" | `delegation` grant, extent `whole_school`, action `declare_assignment` |
| S2 | Supervisory extents exist but are **read-only** | Oversight that may also *act*, narrowly | Delegation = same extents, write on the listed actions only |
| S3 | All-or-nothing per person: a teaching grant hands the WHOLE subject (declare + check + results) | "submit only, nothing else" | The action allow-list is the grain |
| S4 | School-wide duty = a new boolean field per duty (`homeworkSupervisor`, `homeworkConfirmerId`) | One mechanism, no field sprawl | Delegation subsumes them (ACS-3); no new booleans (D-#489) |
| S5 | Interim workaround = one manual teaching grant per (section × subject) | Not N×M rows per person | One grant, one extent |
| S6 | No time bound on non-proxy reach | "for this term / while she covers" | Optional `expiresAt`, request-time (D-#488) |

## 4. The model (additive, zero migration)
A fourth `kind` on the existing `ScopeGrant` collection ([`ScopeGrant.ts`](../server/src/modules/foundation/models/ScopeGrant.ts)) — no new collection, no backfill (shared Atlas, worktree rule 3):

```ts
interface DelegationGrant extends BaseGrant {
  kind: "delegation";
  extent: SupervisoryExtent;          // REUSED as-is: whole_school | grade_class | subject_dept | explicit_set
  classId?: ObjectId;                 // extent = grade_class
  subjectId?: ObjectId;               // extent = subject_dept
  explicitSet?: { classId; subjectId }[];  // extent = explicit_set
  actions: DelegatedAction[];         // NEW — non-empty; the fine grain
  expiresAt?: Date;                   // NEW — absent = open-ended (D-#488)
}
```

`source: "manual"` always — the routine sync (D-#49) touches only `source: "routine"` rows and must never create or reap a delegation.

### 4.1 Vocabulary (`/shared/vocab.ts`, app-native — **no wire-contract twin, no envelope/harness sync**)
```ts
export const DELEGATED_ACTIONS = [
  "declare_homework", "submit_homework", "check_homework",
  "declare_assignment", "submit_assignment", "check_assignment",
  "enter_classtest_result",
] as const;
```
Plus `DELEGATED_ACTION_BUILD_STATUS: Record<DelegatedAction, "build" | "pipeline">` and total BN/EN label maps (`{name, desc}`, the `PERMISSION_LABELS_*` shape).

**Why a status map:** an action whose call site is not yet tagged would be a **silent no-op** — the Principal ticks it, believes he granted something, and nothing changes. The editor offers only `build` actions, and *flipping an action to `build` and tagging its call site happen in the same PR.* This is the `PERMISSION_BUILD_STATUS` idiom already in vocab §B.

**ACS-1 ships `build`:** `declare_homework`, `submit_homework`, `declare_assignment`, `submit_assignment` — the owner's two, each with its parity twin (homework and assignment delivery are parity twins, D-#478; shipping one half would be a trap). The remaining three are `pipeline` until ACS-3.

### 4.2 What a delegation grant means, exactly
- **Read** over its extent (same predicate as the supervisory kind). Non-negotiable: you cannot submit what you cannot see, and the subject list a teacher sees is filtered separately by [`allowedSubjectCodesForSection`](../server/src/middleware/authz.ts) — which must learn the new kind or Jerin gets "permission granted" and an empty screen. **This is the single easiest thing to miss in the build.**
- **Write** on exactly the listed actions, within the extent. Nothing else — not set assembly, not confirmation, not any untagged gate.
- **It does not carry a permission.** The holder still needs `tracker:write` from their template or an AC-1 grant. Delegation widens *where*, AC-1 decides *what*: the two compose, and both must pass (D-#484).

## 5. The seam (the only behavioural change)
```
canWrite(scopes, sectionId, subjectId?, action?)
```
A `delegation` scope matches **iff**:
1. `action` is supplied by the call site (no action ⇒ never matches), **and**
2. `action ∈ grant.actions`, **and**
3. the extent covers the target — `whole_school` always; `grade_class` when the section's class matches; `subject_dept` when `subjectId` matches; `explicit_set` on a `(classId, subjectId)` pair, **and**
4. `expiresAt` is absent or in the future (request time).

`teaching` and `proxy` matching is byte-for-byte unchanged. **Every existing call site passes no action, so nothing anywhere changes until a gate is deliberately tagged** (D-#486) — the AC-1 zero-migration posture repeated.

**One wrinkle to design for:** `assertCanWrite(ctx, sectionId, subjectId?)` receives a *section*, but `grade_class` / `explicit_set` extents key off **class**. Resolve `Section.classId` **lazily** — only when the caller actually holds a delegation grant whose extent needs it — so the common path takes no extra query.

### 5.1 Call sites tagged in ACS-1
| Action | Gate to tag |
|---|---|
| `declare_assignment` | `deliverAssignment` / assignment declare path — [`resolvers/assignment.ts`](../server/src/modules/trackers/resolvers/assignment.ts) |
| `submit_assignment` | assignment submission transition — same file |
| `declare_homework` | `declareHomeworkItem` / `declareNoHomework` — [`resolvers/homework.ts`](../server/src/modules/trackers/resolvers/homework.ts) (and the DE-3 class-note composite path, which gates the homework half separately) |
| `submit_homework` | homework submission transition — same file |

## 6. What stays exactly as today (no churn)
- **The three existing grant kinds.** Teaching, supervisory (read-only), proxy (time-boxed) are untouched — D-#17/#18/#20 stand.
- **Attribution.** [`subjectTeacher.ts`](../server/src/modules/trackers/subjectTeacher.ts) resolves the accountable teacher from the **routine**, never from who typed the row (D-#351). A delegated declaration lands in the real subject teacher's row and their downstream flow; `HomeworkItem.declaredBy` records who actually acted. *The data model was already built for "someone else entered it" — only the write gate wasn't.* This is what makes the whole feature safe.
- **The "expected to declare" red lists.** They key off the routine + `HW_DECLARATION_EXPECTED_SUBJECTS`, not off grants, so a delegation creates **no** new declaration expectation and no teacher-load distortion. (The N×M teaching-grant workaround in S5 *does* distort these — the reason not to use it.)
- **The firewall.** Identity-plane only; no corpus path (ADR-005). NFR-11 stays green.
- **Duty designations** (class teacher, librarian, vocab tester) and their gates — `assertIsClassTeacher`, `assertCanConfirmHomework` — are a separate mechanism and are not touched in ACS-1/2.

## 7. Authority to delegate (D-#487)
Creating / editing / revoking a delegation is gated **`access:manage`** — reserved-locked, Principal-only, ungrantable (vocab §B.2). The existing grant mutations use `user:manage`, which is Principal-by-template but **AC-1-grantable onward**. A delegation manufactures write authority across the school; the power to mint it must not itself be delegable. The friction is deliberate and small (one person, rarely).

Audit: reuse the existing `SCOPE_GRANT_ASSIGN` / `SCOPE_GRANT_REVOKE` event kinds with `meta.actions` + `meta.extent` + `meta.expiresAt` — no new audit kind (the inventory is verifier-checked; reuse keeps it stable).

## 8. Slices (build order)
- **ACS-1 (server).** Model kind + vocab (`DELEGATED_ACTIONS`, status map, BN/EN labels) + `canWrite`/`canRead`/`allowedSubjectCodesForSection` teaching the new kind + lazy `Section.classId` resolution + expiry at compose time + `grantDelegation` / `revokeDelegation` mutations (`access:manage`, Bangla deny) + the four `build` call-site tags + audit meta + verifier §. **No app.**
- **ACS-2 (app).** A **দায়িত্ব বণ্টন / delegated duties** block inside the existing per-user editor [`AccessControlEditScreen.tsx`](../app/src/screens/admin/AccessControlEditScreen.tsx) — so one screen answers "what can this person do, **and where**". Extent picker reused from [`SupervisoryGrantScreen.tsx`](../app/src/screens/admin/SupervisoryGrantScreen.tsx); action ticks (`build` only, with the one-line desc); optional expiry; live list with revoke. Bangla-first.
- **ACS-3 (fold + widen, separate PR).** Flip `check_homework` / `check_assignment` / `enter_classtest_result` to `build` with their call sites, and migrate the two ad-hoc booleans onto delegation behind a read-compatible shim (below). **User-visible change to live behaviour — its own decision row and its own verification pass.**

## 9. The boolean-flag freeze (D-#489)
`User.homeworkSupervisor` and `Section.homeworkConfirmerId` are this same feature, hard-coded one duty at a time. **No new such field is to be added** — a new "let X do Y everywhere" ask is a delegation action from here on. The two existing ones keep working untouched through ACS-1/2 (they gate `assertCanConfirmHomework`, which ACS-1 does not tag) and are folded in ACS-3, reading old flag OR new grant during migration.

## 10. Journeys (Given/When/Then)
- **J-ACS1 (the owner's case A):** *Given* Tazkir holds the Teacher template with `tracker:write` and teaches only Science in one section, *When* the Principal grants him `{extent: whole_school, actions: [declare_assignment]}`, *Then* he can deliver an assignment for any section × subject; the item is attributed to that cell's routine subject teacher with `declaredBy = Tazkir`; and he still **cannot** check work or enter class-test results anywhere.
- **J-ACS2 (the owner's case B):** *Given* Jerin similarly, *When* granted `{extent: whole_school, actions: [submit_homework]}`, *Then* the whole school's homework rows are **visible** to her (the `allowedSubjectCodesForSection` half) and she can transition them to submitted — and nothing else.
- **J-ACS3 (narrowed extent):** *Given* the same grant with `{extent: grade_class, classId: Class 4}`, *Then* class 4 passes and class 5 is refused (Bangla deny).
- **J-ACS4 (zero migration):** *Given* every login and grant as they exist today, *When* ACS-1 ships, *Then* every untagged gate resolves byte-for-byte as before, and a teacher with no delegation grant sees no change anywhere.
- **J-ACS5 (permission still required):** *Given* a person whose `tracker:write` was revoked via AC-1, *When* they hold a delegation with `declare_homework`, *Then* they are refused — the axes compose, both must pass.
- **J-ACS6 (expiry):** *Given* a delegation with `expiresAt` yesterday, *Then* it is inert at request time with no cron having run, and its grant row survives as history.
- **J-ACS7 (not delegable):** *Given* an Office login granted `user:manage` via AC-1, *When* it opens the delegated-duties block, *Then* refused — minting delegations needs reserved `access:manage`.
- **J-ACS8 (no phantom duty):** *Given* Tazkir's whole-school declare delegation, *Then* the recon / "never declared" red lists and teacher-load reports are unchanged — he is not expected to declare anything he does not teach.

## 11. Verifier additions (new §)
- `DELEGATED_ACTIONS` is non-empty; `DELEGATED_ACTION_BUILD_STATUS` and both label maps are **total** over it (the `PERMISSION_LABELS_*` totality rule).
- No `DELEGATED_ACTION` value collides with a `Permission` string (they are different axes and must not be confusable).
- The delegation mutations are gated by a **reserved** permission (`access:manage`), asserted structurally, not by comment.

## 12. Out of scope (v1)
- Editing the role templates themselves (still Fork 1 = A, `prd-access-control.md` §10).
- Delegating **duty** gates (`assertIsClassTeacher`, confirm/reconcile) — ACS-3 at the earliest.
- Guardian plane: unchanged and unreachable (D-#193 Fork 3).
- Per-student or per-item delegation (extent stops at class × subject).
- Self-service request/approve flow for delegations (the Principal grants directly).

## 13. Open questions for the owner
1. **Expiry default in the editor** — offer "term end" as a one-tap preset, or leave open-ended the default? (Model supports both; this is a UI default only.)
2. **Should a delegation holder appear anywhere in the tracker UI as such** — e.g. a small "delegated" marker on rows they entered — or is `declaredBy` in the audit trail enough?
3. **ACS-3 scope confirmation** — is folding `homeworkSupervisor` / `homeworkConfirmerId` onto delegation wanted at all, or should those two stay as the special-cased duties they are?
