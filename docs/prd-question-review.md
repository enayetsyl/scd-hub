# PRD — Question Review & Publish Loop (`question`)

**Status:** DRAFT · **Owner:** Principal
**Scope:** extend the shipped **plan** review loop ([prd-plan-review.md](prd-plan-review.md)) to the
**question bank**, and add the thing plans never needed — a **publish gate**. The Principal assigns
questions to a teacher reviewer; the teacher **accepts or rejects** each question (rejection reason
**optional**); accepted questions collect in a Principal list; **only when the Principal publishes**
does a question become visible and selectable by teachers. Identity-plane feature behind the ADR-005
firewall; nothing here adds a corpus→identity path.

This file is the **build contract**: per-role journeys with testable acceptance criteria + a slice-by-
slice build order that seeds the Jest+Supertest gate. Traceability points at `DECISIONS.md` (`D-#nn`).

> **CORRECTED at build time (D-#509):** the claim below holds for permissions, enums and the
> wire contract, but **two app-native message-template keys were added** —
> `question.review.assigned.title`/`.body`. The plan keys name a *plan* and quote an address,
> and a question shares its unit address with dozens of others, so reusing that copy pointed
> the reviewer at the wrong artifact. Vocab verifier still PASSes; there is still no
> two-place/harness sync.
>
> **No wire-contract change and no vocab change.** `REVIEW_STATUSES` (`draft/reviewed/gold`),
> `REVIEW_VERDICTS` (`APPROVE`/`CHANGES_REQUESTED`), the import-envelope schema, and the permission set
> are all **untouched** — `content:assign_review`, `content:review`, `content:promote_gold` already
> exist and are already granted to the right roles (`shared/vocab.ts:3216-3218, 3348, 3379, 3396`).
> **No two-place sync, no harness edit, no vocab-verifier surface change.** See **D-#508**.

---

## 1. Goal
Today the question bank is an **open shelf**: `questions()` returns every `current` question in a
teacher's content scope, and `addQuestionToSet` / `createSetFromBasket` (`question:select`) will take
any artifact id. `reviewStatus` is rendered as a badge and offered as a filter chip — it **gates
nothing**. Make the bank a **vetted shelf**: nothing reaches a teacher until a peer has read it and the
Principal has published it.

Loop: **import (→`draft`) → Principal assigns → teacher accepts/rejects → Principal publishes (→`gold`)
→ teacher can see + use.**

## 2. The gap (what exists vs. what's missing)
| Capability | Built today | This PRD |
|---|---|---|
| `ReviewAssignment` model, rounds, statuses, audit, notification | ✅ [ReviewAssignment.ts](../server/src/modules/content/models/ReviewAssignment.ts) | reused; **thread key extended** (§4) |
| assign / bulk-assign / submit / cancel / thread / inbox / reviewer-load | ✅ [ReviewService.ts](../server/src/modules/content/services/ReviewService.ts), 10 resolvers in [review.ts](../server/src/modules/content/resolvers/review.ts) | reused; plan-only gate replaced by a doc-type set |
| Reviewer read-scope override (read an artifact outside your subject) | ✅ `reviewerMayReadArtifact` | reused as-is |
| Principal sign-off → `gold` **with a mandatory override reason** | ✅ `approvePlan` | reused as the **publish** action |
| Review UI (assign, my-reviews, inbox, thread) | ✅ 4 screens in [app/src/screens/review/](../app/src/screens/review/) | pattern reused; question variants added |
| **Thread key for a question** | ❌ `addressKeyOf` keys on `anchorWord`+`address.number`; a whole unit of questions **shares one address** | **`qid` thread key** (§4) — the real new model work |
| **Publish gate on read** (`questions`, `question`, `questionTopicTags`, `stimuli`, `contentTree`) | ❌ none — every teacher sees every question | **built** |
| **Publish gate on use** (`addQuestionToSet`, `createSetFromBasket`, homework top-up qids) | ❌ none | **built** |
| Questions land at the envelope's declared `review_status` (schema allows `"gold"`) | ⚠️ `ContentService.ts:179` — an upload can **self-publish** | **clamped to `draft`** for questions |
| Rejected-question list for the Principal | ❌ none | **built** |

## 3. Roles & scope (no new roles, no new permissions — D-#17)
| Role | In this feature | Jobs |
|---|---|---|
| **Principal** | Assigns, reads verdicts, **publishes** | `assignQuestionReview(Bulk)`, `questionReviewInbox`, `publishQuestion` (→`gold`). The only role that opens the shelf. |
| **Office (Admin)** | Assigns + reads verdicts; **no** publish | already holds `content:assign_review`; publish stays `content:promote_gold` = Principal. |
| **Teacher** | Reviewer (one per round) + consumer | Reads assigned questions via the existing scope override; submits `APPROVE` / `CHANGES_REQUESTED` + **optional** reason. In the bank, sees **only published** questions. |

**Settled (2026-08-18, owner):**
- **Review unit — per question, bulk-assigned.** The Principal filters the bank and multi-selects; one
  `ReviewAssignment` row per question; the teacher works a queue and decides **each question
  separately**. One weak question never holds up the other 39.
- **Visibility — hidden until published.** Teachers see only `gold` questions. Principal/Office see
  everything; the assigned reviewer sees their assigned questions via the read-scope override.
- **Rejections — rejected list + override publish.** Rejected questions collect in a Principal-only
  list with the reviewer's (optional) reason. The Principal may publish anyway, but **must** supply an
  override reason — the existing `approvePlan` override path, unchanged.
- **Existing bank — HARD DELETE.** Every `question` document is removed; the shelf starts genuinely
  empty and fills only through the loop. Confirmed by the owner **twice**: once as a choice, and again
  after being shown the measured counts (§9 SETTLED-1) and told the publish gate would empty the
  teachers' bank on its own without deleting anything. Consequences accepted: the 6,505 current
  questions must be re-imported from Claude Desktop to ever return. The single assembled `AS` paper is
  **deleted with them** (owner: it was built for testing), leaving prod with no `AssessmentSet` rows
  and so no dangling references at all.
- **No bulk publish-by-filter escape hatch.** A "publish everything matching this filter" migration
  shortcut was offered and declined — with the bank deleted there is no backlog to shortcut, and the
  gate stays without a hole. Every question reaches the shelf through assign → accept → publish.
- **Stimuli are NOT gated and NOT deleted.** Only `question` docs. See §5a.

## 4. Data model — the one genuinely new piece
`ReviewAssignment` currently anchors a thread on the **plan** address key
(`docType, subject, classLevel, anchorWord, addressNumber`), because that is the key `persistEnvelope`
supersedes plans on. **Questions do not supersede on address** — `ContentService.ts:203-218` keys them
on `envelopeJson.payload.qid`, precisely because *"a whole unit shares one address"*. Reusing
`addressKeyOf` for questions would put every question in a unit on **one** thread and make
`supersedeOpenRoundsForAddress` cancel 40 unrelated rounds at once.

**Change:** add a nullable `qid` field to `ReviewAssignment` and make the thread key doc-type-aware:

| docType | thread key | supersession trigger |
|---|---|---|
| `chapter_plan`, `session_plan` | `docType+subject+classLevel+anchorWord+addressNumber` (today) | re-import of the same address |
| `question` | `docType + qid` | re-import of the same `qid` |

- New field: `qid?: string` (set on question rounds, unset on plan rounds).
- New sparse index: `{ qid: 1, status: 1 }`; keep `{ reviewerId: 1, status: 1 }` for the teacher queue.
- `addressKeyOf` stays for plans; add `threadKeyOf(artifact)` returning either shape.
- `supersedeOpenRoundsForAddress` gains a sibling `supersedeOpenRoundsForQid` (same audit row,
  `reason: "superseded_by_reimport"`), called from `persistEnvelope`'s question branch — the branch that
  today does nothing (`isPlanDocType` guard, line 225).

Existing `assigned | submitted | superseded | cancelled` statuses, `roundNumber`, verdict, feedback,
audit eventKinds and the `emitReviewAssigned` notification are **all reused unchanged**.

## 5. Status mapping (no enum change)
| `reviewStatus` | Meaning for a question | Who sees it |
|---|---|---|
| `draft` | imported, not yet accepted (or rejected — see below) | Principal/Office; assigned reviewer |
| `reviewed` | a teacher **accepted** it — awaiting the Principal's publish | Principal/Office; assigned reviewer |
| `gold` | **published** — on the shelf | everyone in content scope |

### 5a. Why stimuli stay ungated
A question payload may carry a **`stimulus_ref`** which must resolve to a stored `stimulus_id` — the
import harness treats unresolved refs as an app-side integrity concern
(`server/import/validate_import.py:210`), and stimuli are shared passages/poems/audio-scripts that
several questions point at. If stimuli were gated on `reviewStatus` too, a **published** question could
render **without its passage** whenever its stimulus was still `draft` — a silent content bug in the
one place it matters most (a paper in a child's hand). Stimuli are supporting material, not assessable
content, so:
- `stimuli()` keeps its current behaviour — **no publish gate** (this PRD deliberately drops stimuli
  from the Q3.1 gate).
- The 2 existing stimulus documents are **not** deleted with the questions.
- A future stimulus-review loop, if wanted, is a separate decision (§8).

A **rejection** (`CHANGES_REQUESTED`) leaves/returns the question at `draft`; the *rejection* itself
lives on the `ReviewAssignment` round (verdict + optional feedback), which is what the Principal's
rejected list reads. `reviewStatusForVerdict` already implements exactly this both-directions sync
(`APPROVE`: draft→reviewed; `CHANGES_REQUESTED`: reviewed→draft; `gold` never touched) — reused as-is.

## 6. Build order (slices)
| Slice | Build-step | Journeys | Gate |
|---|---|---|---|
| **QR-1** | `qid` thread key + doc-type-aware supersession + question branch in `persistEnvelope` + import clamp to `draft` | Q1.* | Foundation. `tsc` + vocab verifier + jest green; firewall green. |
| **QR-2** | Assign/submit/publish for questions + Principal inbox (accepted) + rejected list + `assignableQuestions` | Q2.* | Needs QR-1. |
| **QR-3** | **The publish gate** on every read + every select path + miss-tolerant set rendering | Q3.* | Needs QR-2. The behaviour-changing slice — ship last on the server side. |
| **OPS-1** | **The bank delete** — an owner-confirmed operational step run AFTER QR-3 is live, with a verified `mongodump` first. Not a code slice, not part of the feature PR | SETTLED-1 | Irreversible; preconditions in §9. |
| **QR-4** | App screens: reviewer queue, Principal assign/inbox/rejected/publish | Q4.* | After server contract green; mirrors the PR-3 screens. |
| (cross-cut) | RBAC + plane split + firewall | Q5.* | Verified in **every** slice; J5.6 stays green. |

## 7. Journeys & acceptance criteria (Given/When/Then)

### QR-1 — thread key & import
- **Q1.1 A question round threads on `qid`** — Given two questions sharing one address (`anchorWord`
  `unit`, number `9`) with distinct `qid`s, When each is assigned, Then two independent rounds exist and
  superseding one leaves the other **open**. (Regression guard for the §4 bug.)
- **Q1.2 Re-import supersedes by `qid`** — Given an open round on question `qid=X` v1, When a revised
  `qid=X` is re-imported, Then v1 flips `current=false`, v2 is `current` at `draft`, and the open round
  is `superseded` (audited `REVIEW_CANCELLED`, `reason=superseded_by_reimport`). A re-import of a
  *different* `qid` supersedes nothing.
- **Q1.3 Import cannot self-publish** — Given an envelope with `doc_type=question` and
  `review_status: "gold"` (the schema permits it), When it is imported, Then the stored artifact is
  **`draft`**. Plans keep honouring the declared value (no change to plan import). Applies to the
  `question_batch` path identically — every item lands `draft`.

### QR-2 — assign, accept/reject, publish
- **Q2.1 Assign questions in bulk** — Given the Principal/Office and a multi-selection of current
  question artifacts, When they `assignQuestionReviewBulk(artifactIds, reviewerId)`, Then one
  `assigned` round per question persists with `roundNumber` = prior max + 1 **for that `qid`**, each
  audited `REVIEW_ASSIGNED`; per-artifact failures are collected, not fatal (the existing
  `assignPlanReviewBulk` contract). A TEACHER actor is denied (`content:assign_review`).
- **Q2.2 Assignable list** — `assignableQuestions(subject, classLevel, topicTag, reviewStatus, search)`
  returns current questions **not yet published**, each with its open-round reviewer/status, for the
  picker. Principal/Office only.
- **Q2.3 Teacher accepts** — Given the assigned reviewer, When they submit `verdict=APPROVE`, Then the
  round is `submitted` and the question advances `draft→reviewed`; audited `REVIEW_SUBMITTED`. A
  non-assigned teacher is denied.
- **Q2.4 Teacher rejects with an OPTIONAL reason** — Given the assigned reviewer, When they submit
  `verdict=CHANGES_REQUESTED` **with no feedback**, Then it succeeds (round `submitted`, feedback null)
  and the question stays `draft`. **This is the one behavioural divergence from the plan loop**, where
  `submitPlanReview` throws `"feedback is required when requesting changes"`
  ([ReviewService.ts:281](../server/src/modules/content/services/ReviewService.ts#L281)). The
  requirement must therefore be **per doc-type**, not global — the plan rule stays as it is.
- **Q2.5 Reviewer queue** — `myQuestionReviews` returns the caller's `assigned` + `submitted` question
  rounds with enough payload to decide in place (question text, marks, type, topic) — a queue, not a
  list of links. Resubmission stays allowed while the round is open (existing behaviour).
- **Q2.6 Principal's accepted list** — `questionReviewInbox(verdict: APPROVE)` returns `submitted`
  rounds whose artifact is `reviewed` — the publish queue. Teacher denied.
- **Q2.7 Principal's rejected list** — the same query with `verdict: CHANGES_REQUESTED` returns rejected
  rounds with the reviewer's reason (or null). Teacher denied.
- **Q2.8 Publish** — Given a `reviewed` question, When the Principal `publishQuestion(artifactId)`,
  Then `reviewStatus` → `gold`, `approvedBy`/`approvedAt` stamped, any open round for that `qid`
  superseded, audited (`QUESTION_PUBLISHED`). Office and Teacher are denied
  (`content:promote_gold` is Principal-only). Publishing an already-`gold` question errors.
- **Q2.9 Override-publish a rejected question** — Given a `draft` question a reviewer rejected, When the
  Principal publishes **without** `overrideReason`, Then it is **refused** with the reason-required
  error; **with** a reason, it goes `gold` with `approvalOverride=true` and `approvalNote` stored +
  audited. (Identical to `approvePlan`'s two paths — reuse, don't reimplement.)
- **Q2.10 Bulk publish** — the accepted list supports publishing a multi-selection in one action
  (loop + per-item failure collection, the `assignPlanReviewBulk` shape). Override-publish stays
  one-at-a-time (a reason is per question).

### QR-3 — the publish gate (the behaviour change)
- **Q3.1 Bank read is gated** — Given a TEACHER, When they call `questions(...)`, Then only
  `reviewStatus="gold"` rows return, **enforced in the Mongo filter** (not post-filtered — the query is
  cursor-paginated, so a post-filter would silently short pages). Principal/Office are unrestricted.
  Same gate on `questionTopicTags` (an unpublished question must not leak its topic into the filter
  chips). **`stimuli()` is deliberately NOT gated** — see §5a; a test asserts a `draft` stimulus stays
  readable, so the exemption cannot be "tidied away" later by mistake.
- **Q3.2 Single-question read is gated** — `question(id)` returns null/forbidden for a TEACHER when the
  artifact is not `gold`, **unless** `reviewerMayReadArtifact(userId, id)` — the reviewer must be able
  to read exactly what they were assigned. Principal/Office unrestricted.
- **Q3.3 `contentTree` is gated** — [content.ts:400](../server/src/modules/content/resolvers/content.ts#L400)
  filters by scope but not by docType or status; unpublished questions must not appear there either.
- **Q3.4 Selection is gated** — `addQuestionToSet` and `createSetFromBasket`
  ([assessment.ts:243,304](../server/src/modules/assessment/resolvers/assessment.ts#L243)) refuse a
  non-`gold` artifact with a Bangla-labelled error. Enforced in `AssessmentService`, so the REST
  set-PDF route and any future caller inherit it.
- **Q3.5 Homework top-up is gated** — `assertTopupSelectedFromPool`
  ([HomeworkResubmissionService.ts:53](../server/src/modules/trackers/services/HomeworkResubmissionService.ts#L53))
  matches on `docType=question, current: true`; add `reviewStatus: "gold"` so a top-up cannot pull an
  unvetted question.
- **Q3.6 A set whose questions no longer exist degrades, never crashes** — `setPdf.ts:70-72` and
  `assessment.ts:382-383` both build a map from a `find({_id:{$in:...}})`; a miss must render a
  clearly-marked gap, not throw or emit a blank page. **Defensive only** — OPS-1 deletes the single
  test set that would have dangled (SETTLED-1), so prod has no such set. Kept because the guard is a
  few lines and the alternative failure mode is a blank paper in a child's hand.
- **Q3.7 The shelf starts empty** — after the delete, a teacher's bank shows zero questions and the
  empty state explains why in Bangla (not a bare "no results"). Note the gate alone would produce this
  same state (§9 SETTLED-1); the delete is what makes it irreversible.
- **Q3.8 A published question's stimulus always resolves** — Given a `gold` question whose payload
  carries `stimulus_ref`, When a teacher previews it or renders it into a paper, Then the referenced
  stimulus is readable (§5a). A test covers a `gold` question pointing at a `draft` stimulus.

### QR-4 — app screens (mirror the PR-3 pattern)
- **Q4.1 Reviewer queue** — "My question reviews": one card per question with the text rendered
  (reuse [QuestionAnswer.tsx](../app/src/components/QuestionAnswer.tsx)), **Accept** / **Reject**
  buttons, reason box shown on Reject and clearly marked optional (`ঐচ্ছিক`), advance-to-next on submit.
- **Q4.2 Assign screen** — Principal/Office: filter the bank (subject/class/topic/status) → multi-select
  → pick a teacher → assign. Mirrors [AssignReviewsScreen.tsx](../app/src/screens/review/AssignReviewsScreen.tsx).
- **Q4.3 Accepted list + publish** — Principal: accepted questions, multi-select, **Publish**.
- **Q4.4 Rejected list** — Principal: rejected questions + reviewer reason + **Publish anyway** (opens a
  mandatory-reason sheet).
- **Q4.5 Bank badges** — Principal/Office see the status badge on each bank card; the teacher's bank
  needs no badge (everything visible is published).
- **Q4.6 Bangla labels, English codes** (NFR-5); write-deny → Bangla message (`friendlyError`).

### QR-5 — RBAC, plane split & firewall (cross-cutting)
- **Q5.1** `content:assign_review` default-denies TEACHER/GUARDIAN; `content:promote_gold` Principal-only.
  **No vocab change** — asserted by a test that the permission set is unchanged.
- **Q5.2** `submitQuestionReview` is allowed only for the assigned reviewer (row-scope).
- **Q5.3** The reviewer read-override stays read-only and artifact-scoped — a reviewer may **read** an
  assigned unpublished question but **not** select it into a set (Q3.4 has no reviewer exemption).
- **Q5.4 Firewall stays green** — no review/verdict resolver joins identity to the corpus plane; the
  J5.6 fail-closed test keeps passing. **← non-negotiable.**
- **Q5.5 Corpus events** — question-selection corpus events keep carrying no identity; the publish gate
  changes *which* questions can be selected, never what the event records.

## 8. Out of scope
- **Stimuli and question_sets review** — questions only. `stimuli()` is **neither gated nor deleted**
  (§5a): no visibility change, no assign/publish loop of its own in this build.
- **Multi-reviewer rounds / quorum** — one reviewer per round (D-#40).
- **Off-app revision** — rejected questions are revised in Claude Desktop and re-imported, exactly as
  plans are. No in-app editing of question payloads.
- **Auto-assignment** (by subject, round-robin) — the Principal picks the reviewer.
- **Re-publishing on re-import** — a re-imported `qid` lands `draft` and must be re-reviewed. If the
  owner wants "a revision of a published question stays published until re-reviewed", that is a
  deliberate follow-up, not a default.

## 9. Settled / open items
- **SETTLED-1 — the existing bank is HARD DELETED.** The owner chose "delete earlier" over auto-publishing.
  **Measured 2026-08-18** (read-only, `server/scripts/diag-question-bank-size.ts`) —
  `scdhub_prod`: **6,901** question documents (**6,505** `current`, 396 superseded), **every one of them
  `draft`; zero `reviewed`, zero `gold`**; 2 stimuli; **1** `AssessmentSet` in existence (AS/assembled,
  citing 18 questions). `scdhub_local`: 2,681 questions, 13 sets citing 58 items.
  **Consequence: the QR-3 publish gate empties the teachers' bank on its own** — with nothing at `gold`,
  a gated `questions()` returns zero rows without a single document being touched. A clearing step is
  therefore **not required to reach an empty shelf**; it only decides whether those 6,901 documents
  remain recoverable (publishable later through the loop) or must be re-imported from Claude Desktop.
  **Decision (owner, 2026-08-18, reaffirmed after seeing the counts above):** hard-delete every
  `question` document — `deleteMany({ docType: "question" })`. Retiring via `current:false`, and the
  "gate alone is sufficient" finding, were both put to the owner explicitly and declined in favour of a
  truly empty bank.
  **Accepted costs**, recorded so they are never a surprise:
  1. **6,505 current questions must be re-imported** from Claude Desktop to return. Nothing in the app
     can restore them.
  2. The **1 assembled `AS` set is deleted along with the questions** (owner, 2026-08-18: it was built
     for testing). So prod is left with **zero** `AssessmentSet` documents and **zero** dangling
     references — the referent problem is removed rather than handled. OPS-1 therefore deletes that one
     set too, in the same confirmed step. **Q3.6 survives as a cheap defensive guard only** — no longer
     load-bearing, but kept so a future dangling id degrades instead of blanking a paper.
  3. The 396 superseded versions go too — the question version history is erased with them.
  **Execution preconditions (non-negotiable, AGENTS.md "executed verification"):**
  - a `mongodump` of `contentartifacts` taken and its restore **verified** before the delete runs;
  - the delete is scoped `{ docType: "question" }` **only** — plans, stimuli and every other docType
    are untouched (a count printed before and after, both recorded in `STATUS.md`);
  - **plus** the one test `AssessmentSet` (`AS`/assembled, 18 items) is deleted in the same step, by
    its `_id`, after printing it for the owner to eyeball. `assessmentsets` must read **0** afterwards
    on prod — if it reads anything else, stop: a real paper was created since this was measured;
  - run against `scdhub_prod` from the VM per the deploy runbook, **not** from a dev worktree, and
    **not** as part of the feature PR — it is a separate, owner-confirmed operational step **after**
    QR-3 ships, so the gate is already in place and the bank is empty to teachers either way.
- **SETTLED-3 — any teacher may review any question they are assigned** (owner, 2026-08-18). No subject
  guard at assign time: whoever Principal **or Office** assigns can review it, regardless of what they
  teach. The existing `reviewerMayReadArtifact` override already implements exactly this and is reused
  unchanged — the reviewer reads that one artifact, read-only, and gains nothing else (Q5.3).
- **SETTLED-2 — `reviewed` does NOT mean usable** (owner, 2026-08-18). For plans, D-#38 settled that a
  `reviewed` plan is usable to teach from in the interim; for **questions the opposite holds** —
  accepted-but-unpublished stays invisible to teachers, because the publish step is the whole point.
  The two doc-types diverge deliberately; **D-#38 is not being re-opened**, its ruling simply does not
  extend to questions. Worth calling out in the D-#508 row so a later reader does not "fix" the
  inconsistency.

## 10. Reused / unchanged
- `ReviewAssignment` statuses, `roundNumber`, verdicts, `reviewStatusForVerdict`, `reviewerMayReadArtifact`,
  `assignPlanReviewBulk`'s failure-collection shape, `reviewerAssignmentLoad`.
- `approvePlan`'s two-path sign-off (normal vs. mandatory-reason override) — the publish action.
- `Audit` eventKinds `REVIEW_ASSIGNED`, `REVIEW_SUBMITTED`, `REVIEW_CANCELLED`; **new**
  `QUESTION_PUBLISHED` (module-local eventKind, the `PLAN_APPROVED` precedent).
- `emitReviewAssigned` notification (N1.5) — fires for question rounds too.
- `buildContentScope` / `contentScopeMongo` — the publish gate ANDs into the existing scope filter; it
  does not replace it.
- `shared/vocab.ts` — **not edited**.
