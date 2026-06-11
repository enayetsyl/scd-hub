# PRD — Plan Review & Approval Loop (`chapter_plan` / `session_plan`)

**Status:** DRAFT · **Owner:** Principal
**Scope:** an in-app **review/approval loop** for imported curriculum **plans** (`chapter_plan`,
`session_plan` only — `docType ∈ PLAN_DOC_TYPES`). After import, a plan is **assignable** to a teacher
reviewer; the teacher submits a **verdict + feedback**; the feedback surfaces to Principal/Office, who
take it to **Claude Desktop**, generate a revised plan, **re-import** it (a new version of the same
plan), and **reassign** to a teacher (same or different) — looping until the **Principal signs off**.
This is an **operational/identity-plane** feature (review records reference a teacher's identity) behind
the ADR-005 firewall; nothing here adds a corpus→identity path.

This file is the **build contract**: per-role journeys with testable acceptance criteria + a slice-by-
slice build order that seeds the Jest+Supertest gate (and the fail-closed firewall test). Traceability
tags point to `DECISIONS.md` (`D-#nn`), the ADRs in `docs/architecture.md`, and `shared/vocab.ts`.

> **No wire-contract change.** This feature builds the *in-app writer* of the existing `reviewStatus`
> field (`draft → reviewed → gold`); the `REVIEW_STATUSES` enum and the import envelope schema are
> **untouched**, so there is **no two-place / harness sync** — only app-native `shared/vocab.ts`
> additions (a new permission, a verdict enum), verified by the vocab verifier. See **D-#38**.

---

## 1. Goal
Close the loop between *publishing* a plan and *vetting* it. Today a plan lands at import as `draft`
([ContentService persistEnvelope](../server/src/modules/content/services/ContentService.ts)) and there
is no in-app path to advance it. Make it real end-to-end: **assign → review → (revise off-app → re-import)
→ reassign → … → Principal sign-off (`gold`)**, with every round audited and the per-version review
history queryable.

## 2. The gap (what exists vs. what's missing)
| Capability | Built today | This PRD |
|---|---|---|
| Plan import + version chain (`current` / `priorVersionId`, supersede by address) | ✅ `persistEnvelope` | reused as-is |
| `reviewStatus` `draft/reviewed/gold` on `ContentArtifact` | ✅ set at import only (mirror of envelope) | in-app **writer** built (no enum change) |
| `content:review` (draft→reviewed), `content:promote_gold` (reviewed→gold) permissions | ⚠️ **declared, unbuilt** (`shared/vocab.ts`) | resolvers built; `content:review` extended to TEACHER |
| Assign a specific plan to a teacher for review | ❌ none (`ScopeGrant` is teaching/supervisory/proxy, not a task) | **`ReviewAssignment`** model + mutations |
| Teacher submits a verdict + feedback | ❌ none | `submitPlanReview` + `REVIEW_VERDICTS` enum |
| Principal/Office "review inbox" (the text for Claude Desktop) | ❌ none | `planReviewInbox` query + screen w/ copy-to-clipboard |
| Reviewer reads a plan outside their teaching subject | ❌ blocked by row-scope | bounded read-scope override (artifact-scoped, read-only) |
| Review-round history per plan address | ❌ none | `planReviewThread` query |
| Plane split + ADR-005 firewall | ✅ pattern exists | extended; J5.6 stays green every slice |

## 3. Roles & scope (mapped to the existing role set — no new auth roles, D-#17)
| Role | In this feature | Jobs |
|---|---|---|
| **Principal** | Assigns, reads all feedback, **final sign-off** | `assignPlanReview`, read `planReviewInbox`, `approvePlan` (reviewed→gold). The only role that closes the loop. |
| **Office (Admin)** | Assigns + reads feedback; **no** sign-off | `assignPlanReview`, `cancelPlanReview`, read inbox. Operational publisher seam (already holds `content:import`). |
| **Teacher** | The reviewer (one per round) | Reads the assigned plan (scope override), submits `verdict + feedback`. An `APPROVE` verdict advances `draft→reviewed`. |

**Approval authority (D-#38):** a teacher's `APPROVE` is the *review pass* (`draft→reviewed`); the loop
**ends only on the Principal's sign-off** (`reviewed→gold`, `content:promote_gold` — Principal-locked).
Mirrors the D-#28 pattern (input distributed, judgement central).

**Plane/firewall (ADR-005):** `ReviewAssignment` (reviewer identity, feedback text, verdicts) is
**identity-plane**. No analytics/export resolver may join a review row to identity; the J5.6 fail-closed
firewall test **must stay green** after every slice.

## 4. Data model (new)
**`ReviewAssignment`** — one record per round (identity plane, behind the firewall):
- **Address key** (version-stable; mirrors the plan supersession key in `persistEnvelope`):
  `docType, subject, classLevel, anchorWord, addressNumber`. Anchors the *thread* across re-uploads.
- `artifactId` — the exact version shown to the reviewer (snapshot).
- `reviewerId`, `assignedBy`, `assignedAt`, `roundNumber`.
- `status`: `assigned | submitted | superseded | cancelled`.
- On submit: `verdict` (`APPROVE | CHANGES_REQUESTED`), `feedback` (string — the text copied to Claude
  Desktop), `submittedAt`.

The **thread** is *derived* (no separate doc): query `ReviewAssignment` by address key, ordered by
`roundNumber`. A plan is "approved/closed" when its current artifact reaches `gold`. **One open
(`assigned`/`submitted`) assignment per address key at a time** (D-#40).

## 5. Vocab / RBAC additions (app-native — no wire twin; vocab verifier + `/shared` build must pass)
- **New permission `content:assign_review`** — assign/cancel review rounds + read the inbox. Grant:
  PRINCIPAL, OFFICE. Add to `PERMISSIONS`, `ROLE_PERMISSIONS`, `PERMISSION_BUILD_STATUS` (= `build`).
- **Grant existing `content:review` to TEACHER** (currently Principal-only) — a teacher verdict drives
  `draft→reviewed`.
- **New enum `REVIEW_VERDICTS = ["APPROVE", "CHANGES_REQUESTED"]`** + `REVIEW_VERDICT_LABELS_BN`
  (e.g. `অনুমোদন` / `পরিবর্তন প্রয়োজন`). App-native, no envelope mirror.
- `content:promote_gold` — unchanged (PRINCIPAL); the sign-off.
- **`REVIEW_STATUSES` is NOT changed** — values stay `draft/reviewed/gold`; we only build the writer.

## 6. Build order (slices)
| Slice | Build-step | Journeys | Gate |
|---|---|---|---|
| **PR-1** | Model + vocab + assign/submit/cancel + reviewer read-scope + `draft→reviewed` | R1.* | Foundation. Vocab verifier + `tsc` green; firewall green. |
| **PR-2** | Final sign-off (`reviewed→gold`) + inbox/thread queries + supersession→`superseded` linkage + audit eventKinds | R2.* | Needs PR-1. |
| **PR-3** | App screens (teacher review form; Principal/Office assign + inbox + copy-feedback + approve) | R3.* | After server contract green; mirrors the Slice-4 frontend pattern. |
| (cross-cut) | RBAC + plane split + firewall | R4.* | Verified in **every** slice; J5.6 stays green. |

## 7. Journeys & acceptance criteria (Given/When/Then)

### PR-1 — model, assignment, submission, read-scope
- **R1.1 Assign a plan to a reviewer** — Given a Principal/Office user and a current plan artifact, When
  they `assignPlanReview(artifactId, reviewerId)`, Then a `ReviewAssignment` persists
  (`status=assigned`, `roundNumber` = prior max + 1 for that address key, address key copied from the
  artifact); a `REVIEW_ASSIGNED` audit row is written. A non-Principal/Office actor is **denied**
  (`content:assign_review`). Assigning a non-plan `docType` is rejected.
- **R1.2 One open round per address** — Given an existing open (`assigned`/`submitted`) assignment for an
  address key, When a new round is assigned, Then the prior open one is set `superseded` (or the assign
  is rejected if not yet acted — see §9 open item); never two open rounds for one plan.
- **R1.3 Reviewer can read the assigned plan out of scope** — Given a teacher with no teaching grant on
  the plan's subject but an active assignment for it, When they read that artifact, Then `assertCanRead`
  **allows** it (artifact-scoped, read-only override); a teacher with neither grant nor assignment is
  still **denied**. Adds **no** corpus→identity path.
- **R1.4 Submit a verdict + feedback** — Given the *assigned reviewer*, When they
  `submitPlanReview(assignmentId, verdict, feedback)`, Then the assignment records `verdict`, `feedback`,
  `submittedAt`, `status=submitted`; a `REVIEW_SUBMITTED` audit row is written. A user who is **not** the
  assigned reviewer is denied. `feedback` is required when `verdict=CHANGES_REQUESTED`.
- **R1.5 `APPROVE` advances the quality gate** — Given a `draft` plan, When the reviewer submits
  `verdict=APPROVE`, Then the artifact's `reviewStatus` advances `draft→reviewed` (`content:review`);
  `CHANGES_REQUESTED` leaves it `draft`. The transition is idempotent/guarded (no `reviewed→reviewed`,
  no skipping to `gold`).
- **R1.6 Cancel a round** — Given Principal/Office, When they `cancelPlanReview(assignmentId)`, Then it
  is set `cancelled` (audited); a cancelled/ superseded assignment grants no read override.
- **R1.7 Bangla labels + English codes** — verdicts render with `REVIEW_VERDICT_LABELS_BN` (NFR-5).

### PR-2 — close the loop
- **R2.1 Principal sign-off** — Given a `reviewed` plan, When the Principal `approvePlan(artifactId)`,
  Then `reviewStatus` advances `reviewed→gold` (`content:promote_gold`, Principal-only) and a
  `PLAN_APPROVED` audit row is written; the address has no open assignment afterward. Office/Teacher are
  denied. A `draft` plan cannot be signed off (must pass `reviewed` first).
- **R2.2 Re-import supersedes + carries the thread** — Given an open/submitted assignment on plan vN,
  When a revised vN+1 is imported for the same address (existing `persistEnvelope` supersession), Then
  vN+1 becomes `current` at `draft`, vN flips `current=false`, and the open assignment is set
  `superseded`. The thread (address key) now points reviews at the new version on the next assign.
- **R2.3 Review inbox** — Given Principal/Office, When they read `planReviewInbox`, Then they get the
  `submitted` assignments grouped by address: reviewer, verdict, **feedback text** (for Claude Desktop),
  submitted time, and the artifact link. Teacher is denied.
- **R2.4 Review thread / round history** — Given an address key (or any artifactId for it),
  `planReviewThread` returns the ordered round history (version, reviewer, verdict, feedback, status) for
  Principal/Office and the involved reviewer; an unrelated teacher is denied.
- **R2.5 Teacher inbox** — `myReviewAssignments` returns the caller's `assigned` rounds (the plans
  awaiting their review).

### PR-3 — app screens (mirror Slice-4 patterns)
- **R3.1 Teacher review** — "My reviews" list → open plan in `PlanViewScreen` → review form (verdict +
  feedback) → submit; Bangla labels, English codes; write-deny → Bangla message.
- **R3.2 Assign reviewer** — Principal/Office action on a plan (pick a teacher) from the content/admin UI.
- **R3.3 Review inbox + copy** — Principal/Office screen listing submitted feedback with a
  **copy-to-clipboard** of the feedback text, plus **"Approve / sign off"** (Principal only).
- **R3.4 Re-upload** — uses the existing `ImportScreen`; no new upload UI.

### PR-4 — RBAC, plane split & firewall (cross-cutting; verified every slice)
- **R4.1** `content:assign_review` default-denies TEACHER/GUARDIAN; `content:promote_gold` Principal-only.
- **R4.2** `submitPlanReview` is allowed **only** for the assigned reviewer (row-scope), not any teacher.
- **R4.3** The reviewer read-override is read-only and artifact-scoped (no write, no assemble, no tracker).
- **R4.4 Firewall stays green** — no review/feedback resolver joins identity to the corpus plane; J5.6
  fail-closed test keeps passing. **← non-negotiable.**
- **R4.5 No contract sync** — `REVIEW_STATUSES` + import envelope schema untouched; only app-native vocab
  additions, verified by the vocab verifier (no harness/schema edit).

## 8. Out of scope (this feature)
- **Off-app generation.** Claude Desktop authoring of the revised plan happens outside the app; the app
  only **surfaces feedback to copy** and **accepts the re-import**. No in-app LLM call.
- **Questions / stimuli / sets review** — plans only (`PLAN_DOC_TYPES`). A later analog could extend it.
- **Multi-reviewer rounds / quorum** — one reviewer per round (D-#40).
- **Notifications / scheduling** — the inbox is pull-based; no push/automation in this build.
- **A separate `review_status` wire value** — none added; the existing `reviewed`/`gold` are reused.

## 9. Reused / unchanged
- **`ContentArtifact` + version chain** (`current`/`priorVersionId`, supersede-by-address) — the
  "generate new plan → re-upload" step rides this with **no new import code**.
- **`importFiles` / `persistEnvelope`** — extended only to flip an open assignment to `superseded` on
  supersession (R2.2); the import path itself is unchanged.
- **`assertCanRead` / `assertCanWrite`** (ADR-004/017) — the reviewer read-override is added to
  `assertCanRead`; write paths untouched.
- **`Audit`** — new eventKinds `REVIEW_ASSIGNED`, `REVIEW_SUBMITTED`, `REVIEW_CANCELLED`, `PLAN_APPROVED`.
- **`content:review` / `content:promote_gold`** — the declared-but-unbuilt permissions, now wired.

## 10. Settled by the Principal (2026-06-11)
- **R1.2 behavior — SETTLED:** on `CHANGES_REQUESTED` the round **stays `submitted`** until an admin
  re-imports a revision (which auto-supersedes it, R2.2) and assigns the next round. No auto-close.
- **Who may assign — SETTLED:** `content:assign_review` is granted to **Principal + Office**; both may
  assign/cancel rounds. Final sign-off (`reviewed→gold`) stays **Principal-only**.
- **`reviewed` usability — SETTLED:** a `reviewed` plan is **usable to teach from** in the interim; the
  loop still closes only at `gold` (Principal sign-off). No gating change needed (read paths already allow
  any `reviewStatus`).
