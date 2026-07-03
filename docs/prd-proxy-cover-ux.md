# PRD — Proxy Cover UX (availability-aware propose, admin override, needs-cover inbox — PXG-1..PXG-2)

**Status:** Draft for build — approved by Principal 2026-07-03
**Owner:** Principal (SCD)
**Scope:** Server slice (approve-with-override, needs-cover inbox read, availability-gate widening, one new notification kind) + app slice (availability-aware propose picker, admin override control, needs-cover inbox screen). ONE contract sync: `NOTIFICATION_KINDS += COVER_ASSIGNED` (see §7).
**Traceability:** D-#268 (this design). Builds on: D-#20 (proxy grant minting on approval), D-#22 (leave cover slots), ENH-002 (per-subject proxy narrowing), the routine `teacherAvailability` read (R4, CoverManage), D-#256 (domain-error surfacing), UX program D-#265/#266 (R-Feedback/R-Search apply as those slices land).

---

## 0. Quick checklist (read this first)

- [ ] Two slices, built in order: **PXG-1 (server) → PXG-2 (app)**. One PR each, off `dev`. Server before app (house rule).
- [ ] Existing flow is EXTENDED, never replaced: applicant-proposes → admin-decides (D-#20/D-#22) stays the spine; `proposeStaffCover` unchanged; `assignCover`/CoverManage and ScopeGrant bypasses untouched.
- [ ] ONE contract sync declared (§7): `NOTIFICATION_KINDS += COVER_ASSIGNED` — shared vocab list + verifier §C.5 exact-list + the server emit site must move together. Vocab is declared here but NOT added to `shared/vocab.ts` until the PXG-1 build session (house rule — parallel-PR conflict avoidance).
- [ ] `decideStaffCoverSlot` gains only OPTIONAL args — no breaking change to existing callers.
- [ ] The `teacherAvailability` gate widening (routine:manage → any authenticated staff) is a deliberate D-#268 ruling — do not widen any other routine read.
- [ ] Gates: PXG-1 = server `tsc` + focused jest + full jest green + vocab verifier PASS (with the §C.5 extension); PXG-2 = app `tsc --noEmit` + `expo export --platform web` + §8 manual checklist on phone-width AND ≥1024px web.
- [ ] New user-facing strings → `STR` (Bangla + English).

---

## 1. Goal

Match the app to the physical cover flow. Physically: the leave-taking teacher arranges his own cover per class — possibly different colleagues per period — and when he can't find a match, the Principal/Office assigns someone. In the app today the spine exists (propose per slot → admin approve mints the subject-scoped proxy grant), but (a) the teacher proposes **blind** from an alphabetical list while the availability intelligence (`teacherAvailability`: free-first + day class-count) is locked behind the admin-only CoverManage screen; (b) the admin can only approve-or-reject — no "assign someone else instead"; (c) uncovered slots hide inside individual leave applications with no cross-leave worklist; (d) the covering colleague gets no confirmation when their cover is approved.

## 2. Gap table

| # | Gap | Impact | Slice |
|---|---|---|---|
| G1 | Applicant's propose picker is a plain `TeacherSelect` — no visibility of who is free in that slot's period. | "Can't find a good match"; proposals bounce | PXG-1 (gate) + PXG-2 (picker) |
| G2 | `decideStaffCoverSlot` supports approve/reject only; a poor proposal forces reject → wait → re-propose. Admin also cannot act on a slot with NO proposal from this screen. | Slow fallback; admin detours to raw ScopeGrant | PXG-1 + PXG-2 |
| G3 | No cross-leave needs-cover worklist; admin discovers uncovered slots only by opening each application. | Classes silently uncovered | PXG-1 (read) + PXG-2 (screen) |
| G4 | The approved covering teacher gets no notification; the verbal agreement is never confirmed in-app. | Missed covers | PXG-1 |

## 3. Design — PXG-1 (server)

1. **Approve-with-override / direct-assign.** Extend `decideStaffCoverSlot(slotId, approve, overrideCoverTeacherUserId?)` — both new behaviors additive:
   - `approve=true` + override on a **proposed** slot → mint the D-#20 proxy grant for the override teacher (not the proposer's pick); persist both proposed and final teacher on the slot (append-only audit row records the substitution).
   - `approve=true` + override on a **needs_cover** slot (no proposal) → direct-assign: mint the grant for the override teacher. This powers the inbox (G3).
   - No override → behavior byte-identical to today. Same permission gate as today — no new permission. Grant minting reuses the existing path unchanged (time-bounded, ENH-002 subject-scoped).
2. **Needs-cover inbox read.** New query `needsCoverSlots(from: String!, to: String!)` — every cover slot in `needs_cover` (including rejected-back) belonging to approved leave applications overlapping the range, each row carrying: absent teacher name, dateKey, periodNumber, subject, class/section labels, leaveApplicationId, slotId. Gate: the same permission that gates `decideStaffCoverSlot` today. Scale note: iterate applications in range then their slots — no N+1 hardening needed at this school's size.
3. **Slot fields for availability.** Ensure `StaffCoverSlot` exposes `dateKey` and `periodNumber` (additive GraphQL fields if not already surfaced) — the app needs them to call `teacherAvailability` per slot.
4. **Availability gate widening (D-#268 ruling).** `teacherAvailability(date, periodNumber)` gate widens from `routine:manage` to any **authenticated staff** caller (guardian plane remains excluded by the existing plane isolation). Exposes only teacher names + free/busy + day class-count — low sensitivity, and the applicant needs it to propose well. No other routine read changes.
5. **Cover-approved notification (G4).** On successful approval (with or without override), emit ONE notification to the final covering teacher — kind `COVER_ASSIGNED`, deep-link target their routine, riding the existing deferred push pipeline. `NOTIFICATION_KINDS += COVER_ASSIGNED` (§7 sync). Idempotent per (slotId, grantId); no guardian/WA leg.
6. **Jest (focused `coverOverride.test.ts`):** approve-no-override byte-identical; override-on-proposed mints for override teacher + audit row; direct-assign on needs_cover; reject unchanged; needsCoverSlots range/status filtering + gate deny; teacherAvailability allows plain teacher + still denies guardian; COVER_ASSIGNED emitted once, correct recipient, idempotent on retry.

## 4. Design — PXG-2 (app)

1. **`AvailableTeacherSelect`** (new shared component in `components/selects.tsx`): props `date`, `periodNumber`, `value`, `onChange`; wraps `Select` over `teacherAvailability` — free teachers first (hint "ফ্রি"), busy after (hint "ব্যস্ত · n ক্লাস"), self and the absent teacher excluded. `searchable` once UX-3 lands (soft dependency — plain list until then).
2. **`LeaveCoverScreen` applicant mode:** the propose picker per slot becomes `AvailableTeacherSelect(slot.dateKey, slot.periodNumber)`. Nothing else changes — propose still grants nothing.
3. **`LeaveCoverScreen` manage mode:** per slot —
   - `proposed`: approve · **অন্য কাউকে দিন** (assign someone else — expands an inline `AvailableTeacherSelect` + confirm, calling decide with override) · reject. Reject keeps a confirm sheet per UX-1 when landed.
   - `needs_cover`: direct-assign via the same inline picker (decide with override, no proposal required).
4. **`NeedsCoverInboxScreen`** (new screen in the HR stack; additive route `NeedsCoverInbox`): default range today → +7 days (two `DateField`s), rows grouped by date — `period · subject · class · absent teacher` — each expanding to the inline availability picker + assign. Entry points: a Button on `LeaveAdminScreen` header area and (post UX-4) a pending-count row on the Today dashboard (one-line follow-up in whichever lands second). Empty state: "সব ক্লাস কভার হয়েছে".
5. **New STR keys (bn/en):** `hrCoverAssignOther` (অন্য কাউকে দিন/Assign someone else), `hrCoverFree` (ফ্রি/Free), `hrCoverBusy` (ব্যস্ত/Busy), `hrNeedsCoverTitle` (কভার প্রয়োজন/Needs cover), `hrAllCovered` (সব ক্লাস কভার হয়েছে/All classes covered).
6. **Untouched:** `CoverManageScreen`, `ScopeGrantScreen`, MyRoutine cover display, proposal mutation, guardian plane.

## 5. Journeys (Given/When/Then)

- Given a teacher on leave with three classes that day, When he opens Cover on his application, Then each slot's picker lists teachers free in THAT period first with their day load, And he can propose a different colleague per slot.
- Given a proposed slot the Principal judges a poor match, When she taps অন্য কাউকে দিন and picks a free teacher, Then the proxy grant mints for HER pick in one step, And the slot records both the proposal and the final assignment.
- Given a slot with no proposal two days before the leave, When Office opens the Needs-cover inbox, Then the slot appears under its date, And assigning from the row mints the grant without opening the leave application.
- Given any approval, Then the final covering teacher receives one COVER_ASSIGNED notification deep-linking to their routine.
- Given a guardian token, When it calls teacherAvailability or needsCoverSlots, Then the existing plane isolation denies it.

## 6. Out of scope

- Changing the proxy-grant model, duration semantics, ENH-002 subject narrowing, or the D-#20 approval-mints-grant rule.
- Teacher-to-teacher in-app cover *requests*/consent flows (the verbal ask stays physical; the app records the arrangement).
- WhatsApp/guardian legs for COVER_ASSIGNED; CoverManage/ScopeGrant redesign; auto-matching suggestions.

## 7. Contract-sync note (REQUIRED — read before building PXG-1)

`NOTIFICATION_KINDS += COVER_ASSIGNED`. Three places move together in the PXG-1 PR: (1) the `NOTIFICATION_KINDS` list in `shared/vocab.ts`; (2) the vocab verifier §C.5 exact-list extension; (3) the server emit site. The vocab verifier must be GREEN with the extension in the PXG-1 gate. Per house rule the addition happens only in the build session, not before. No other enum, wire-vocab, or import-envelope change; `overrideCoverTeacherUserId` and the inbox read are plain GraphQL additions.

## 8. Build order & gates

`feat/pxg-1-cover-server` → `feat/pxg-2-cover-app`, each off `dev`, sequential. PXG-1 gate: server `tsc`, focused + full jest green, verifier PASS (§C.5 extended). PXG-2 gate: app `tsc --noEmit`, `expo export --platform web`, manual checklist: (1) applicant sees free-first per-slot pickers on a phone; (2) propose→approve unchanged end-to-end (grant active, covered slot on the cover teacher's routine); (3) approve-with-override mints for the override teacher; (4) direct-assign from the inbox on a proposal-less slot; (5) COVER_ASSIGNED lands in the covering teacher's notification center and deep-links; (6) guardian deny; (7) Bangla/English toggle + dark mode on the new screen.

**Next = build PXG-1 per docs/prd-proxy-cover-ux.md §3, then PXG-2 per §4.**
