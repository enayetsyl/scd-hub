# PRD — Saturday Revision SR-2: Guardian delivery + Saturday trigger (server)

**Status:** Planned — build contract (slice 2 of 4). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** SR · **Plane:** identity (ADR-005)
**Source REQ:** `docs/saturday-revision-requirements.md` (LOCKED) · **Builds on:** SR-1 (`prd-sr1.md`)
**Traceability:** D-#197–#201 (REQ) · D-#241–#243 (SR-1) · **new D-#244–#245** · D-#72/#31/#131 · ADR-003/005/008

> Each Saturday's outcome reaches the family — an absent alert and a weekly digest, on the existing rails.

## §0 — At a glance
- [ ] On a delivered Saturday entry: an **absent alert** (absent students) + a **weekly digest** (present
  students — portions heard, تنবিه/فতহ, mistake summary, teacher comment) to the guardian, on the **existing
  rails** (wa.me for all + `emit()` inbox + push for login-enabled — D-#72/#31, ADR-003).
- [ ] **Consecutive-absence escalation** → guardian + Principal after **N consecutive absences** (default
  **2**, admin-tunable; D-#245).
- [ ] Bodies render from the **MT registry** (`sr.absent.*` / `sr.digest.*` — D-#131, never inline).
  Delivery **seals** the SR-1 entry's immutability (`deliveredAt`).
- [ ] Vocab-toucher (additive): `NOTIFICATION_KINDS += SR_ABSENT, SR_DIGEST` + the MT keys. No new permission.

## §1 — Goal
Close the "families see nothing" gap: when the teacher/Office delivers a Saturday entry, each absent
student's guardian gets an alert and each present student's guardian gets a digest of that Saturday's
revision — automatically, from the entry SR-1 stored, on the same rails every other guardian message uses.

## §2 — Scope boundary
| In SR-2 | NOT SR-2 |
|---|---|
| `deliverEntry` (absent alert + weekly digest) + consecutive-absence escalation + the `SR_ABSENT`/`SR_DIGEST` kinds + MT keys | Recording the entry → SR-1 · analytics → SR-3 · the app → SR-4 |
| Seals the SR-1 entry (`deliveredAt`) | The guardian's own child-history READ (rides `guardian:read_child`; surfaced in SR-4's guardian card) |

## §3 — Delivery (reused seams)
**`RevisionDeliveryService.deliverEntry(entryId)`** (per entry — or batch per group/Saturday):
- Stamps `deliveredAt` + `deliveryChannels` → **seals SR-1 immutability** (the CM-2 posture).
- **Absent** (`present=false`) → render `sr.absent.*` (the day, the group); deliver to the family.
- **Present** → render `sr.digest.*` (portions heard by category, total تنবিه/فতহ, mistake-category summary,
  the teacher comment) from the per-juz records.
- **Rails (D-#72/#31, ADR-003):** a `wa.me` link for **every** family with a phone (`Student.phone`,
  phone-less → `unreachableCount`) + `emit()` an inbox row + N-4 push for **login-enabled** guardians;
  contact-only stay wa.me-only. **N+1 guard:** the title + body render ONCE per recipient group, the
  pre-rendered text passed to the emitter (the VC-4/CT-3 posture).
- **Kind-gated fallback:** the emitter no-ops to wa.me-only if a kind isn't registered (the D-#94
  `ASSIGNMENT_CHASE` posture) — SR-2 registers them, so it's the safety net.

**Consecutive-absence escalation (D-#245):** when a student reaches **N consecutive `QURAN_ONLY`-Saturday
absences** (default N=2, admin-tunable read-time config — the no-seed-write D-#97 posture), escalate to the
**guardian + the Principal** (`emit()` + wa.me) — beyond the per-week absent alert. Derived from the
absence streak; idempotent per (student, streak-length) so it fires once per threshold crossing.

**Audit kinds** (Audit.ts): `SR_ENTRY_DELIVERED`, `SR_ABSENCE_ESCALATED`.

## §4 — Vocabulary (app-native; additive; NO wire sync)
- `NOTIFICATION_KINDS += SR_ABSENT, SR_DIGEST` (+ BN/EN) — **the verifier §C.5 exact-list must be extended
  by the same edit** (the CT-1/CM-2 posture). (Consecutive-absence escalation reuses `SR_ABSENT` or a third
  `SR_ABSENCE_ESCALATION` kind — pinned at build; default: reuse `SR_ABSENT` with an escalation flag.)
- `MESSAGE_TEMPLATE_KEYS += sr.absent.{title,body,wa}` + `sr.digest.{title,body,wa}` + registry defaults
  (Bangla, with the Islamic salutation) — extends verifier §C.13. Rendered via `renderTemplate`, never inline.

## §5 — RBAC — reuses existing, no new permission
- `deliverEntry` = the SR-1 author (`tracker:write` + group scope) or Office (`message:dispatch`/admin reach);
  the guardian is a **recipient only** — no SR resolver is guardian-writable. Escalation is system/Office-run.
- Guardian receives on the rails; their own child-history READ rides `guardian:read_child` (D-#68) and is
  surfaced in SR-4 (the guardian card). No new permission.

## §6 — Journeys (Given/When/Then)
- **J-SR2-1 (absent alert).** *Given* a student marked absent, *when* the entry is delivered, *then* the
  guardian gets an `SR_ABSENT` wa.me (+ inbox/push if login-enabled); phone-less → `unreachableCount`.
- **J-SR2-2 (weekly digest).** *Given* a present student, *when* delivered, *then* the guardian gets an
  `SR_DIGEST` (portions / تنবিه/فতহ / mistakes / comment), rendered from the MT registry.
- **J-SR2-3 (seal).** *When* delivered, *then* the SR-1 entry is immutable (deliveredAt set).
- **J-SR2-4 (escalation).** *Given* 2 consecutive Saturday absences, *then* the guardian **and** Principal
  are escalated once (idempotent per streak), beyond the weekly alert.
- **J-SR2-5 (firewall).** Delivery joins no corpus path; green both ways.

## §7 — Out of scope (SR-2)
Recording (SR-1) · analytics (SR-3) · the app (SR-4) · SMS/hard-cap beyond wa.me (the D-#31/#72 limitation) ·
guardian reply/two-way (one-way, like notices).

## §8 — Reused / unchanged
The `emit()` seam + N-4 push + `PushDevice` (D-#72/#75/#99) · wa.me (ADR-003) + `Student.phone` (D-#31) ·
the MT registry + `renderTemplate` (D-#131) · append-only audit · identity-plane firewall · the D-#50
`QURAN_ONLY`-Saturday calendar (the absence streak). No new push system; no new role/permission.

## §9 — Firewall (ADR-005)
`RevisionDeliveryService` is identity-plane; no corpus path; the SR firewall block (SR-1) is extended;
NFR-11 green.

## §10 — Acceptance gate (build verifies — executed)
1. Deliver → absent alert + digest on the rails (wa.me-all + emit login-enabled, `unreachableCount`); bodies
   from the registry (never inline); `deliveredAt` seals SR-1. `SR_ABSENT`/`SR_DIGEST` in §C.5 + the MT keys
   §C.13; verifier PASS.
2. Consecutive-absence escalation fires once per threshold to guardian + Principal (idempotent). RBAC: no
   guardian-writable path; firewall green. Full gate: verifier PASS, shared+server tsc, jest all-green (+
   `revisionDelivery.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#241–#243 (SR-1). **Reaffirmed:** D-#72/#31 (rails), D-#131 (MT), D-#68 (guardian read),
  D-#94/#97, ADR-003/005/008.
- **New — D-#244–#245:**
  - **D-#244** — guardian delivery rides the existing rails: wa.me-all + `emit()` (`SR_ABSENT`/`SR_DIGEST`)
    login-enabled + push, bodies from the MT registry (`sr.absent.*`/`sr.digest.*`, D-#131), `unreachableCount`
    for phone-less; delivery **seals** the SR-1 entry; **no new permission** (the guardian is recipient-only).
  - **D-#245** — **consecutive-absence escalation** to guardian + Principal after **N consecutive Saturday
    absences** (default N=2, admin-tunable read-time config, no seed write); derived from the streak,
    idempotent per threshold crossing.
- **Next:** SR-3 (analytics).
