# PRD — Parents'-meeting slot response (guardian RSVP + change approval)

Owner ask, 2026-10-24. Decisions D-#840–#843. Builds on CM-3/CM-4 (`ParentMeeting`,
`ParentMeetingSlot`, dispatch) — see `prd-comments-meetings.md`.

## 1. Goal
The school has prepared the parents'-meeting schedule (one 10-minute slot per family,
siblings on one phone collapsed). Every guardian is asked, in the app, to answer for their
slot. The office and the Principal see every answer, and the Principal / Vice Principal
approve or decline time-change requests.

## 2. The guardian pop-up (D-#841)
Shown to a guardian login when **all** hold:
- a meeting is `scheduled` (dispatched) and its date is today or later (Asia/Dhaka);
- one of the guardian's linked children is in a slot of that meeting;
- that slot has **no answer yet**.

It cannot be closed without answering. It shows the meeting label, date, the family's time
(or "ডাকা হলে আসবেন" for On-Call) and the children's names. Three choices:

| Choice | What the guardian does | Stored |
|---|---|---|
| **সময়টি ঠিক আছে** (`CONFIRMED`) | one tap | choice |
| **সময় পরিবর্তন করতে চাই** (`CHANGE_REQUESTED`) | picks one other time from the meeting's timed slots. All slots are taken, so the list is every other family's time — **times only, never names** (ADR-005 / PII). Then sees: "এটি এখনো নিশ্চিত নয়। আমরা আপনার পছন্দের সময় দেওয়ার চেষ্টা করব — নিশ্চিত হলে আপনাকে জানানো হবে।" | choice + preferred slot + its time (snapshot) |
| **আসতে পারব না** (`CANT_COME`) | optional reason (≤ 500 chars) | choice + reason |

**One answer per family slot, final.** Any linked guardian of any child in the slot may
answer; the first answer wins (atomic: the write only lands while the slot is unanswered).
A guardian cannot change it later. Answering removes the pop-up on every device (server
state, not device storage).

The guardian Home shows a small meeting card: the time, and the answer's state
(confirmed / change awaiting approval / approved → new time / declined → original time /
can't come).

## 3. Approving a change (D-#842)
New action **`parents_meeting:approve_change`** — "সময় পরিবর্তনের অনুরোধ অনুমোদন",
flag `PRINCIPAL_DEFAULT` (the Principal holds it; it is switched on for the Vice Principal
in Access control → By person). Office/Teacher templates: off.

- **Approve = swap.** The requesting family and the family in the preferred slot exchange
  `order`, `slotTime` and `onCall`. No other slot moves.
  - If the other family had also asked for **this** family's time (a mutual request), both
    requests are approved by the one swap.
  - If the other family has its **own pending** change request to a different slot, approve
    is refused — decide that request first.
  - The other family's time has changed, so if it had answered `CONFIRMED` (or had an
    approved/declined change) its answer is **cleared** and it is asked again; the pop-up
    says the time was changed (`rescheduledAt`). A `CANT_COME` answer is kept.
- **Decline** keeps the original time; optional note.
- Approve/decline is allowed only while the meeting is `scheduled`. Both are audited.

## 4. What office and Principal see (D-#843)
On the meeting screen (`parents_meeting:view`, Office + Principal), once dispatched:
- counts: confirmed · change requested (pending) · approved · declined · can't come · no answer;
- the change-request list: family, current time → wanted time, the other family in that
  slot and its answer, mutual marker; Approve / Decline buttons for holders of
  `approve_change`;
- each slot row carries its answer badge; can't-come rows show the reason.

## 5. Data (identity plane, ADR-005; vocab-free)
`ParentMeetingSlot.response` (sub-document, absent = unanswered):
`choice`, `preferredSlotId?`, `preferredSlotTime?`, `reason?`, `respondedAt`,
`respondedByGuardianId`, `review? { outcome APPROVED|DECLINED, note?, fromSlotTime?, reviewedAt, reviewedBy }`.
`ParentMeetingSlot.rescheduledAt?` — set when a swap moved this family. Choice/outcome are
**model-local literal unions** (like `ParentMeeting.status`), not `shared/vocab.ts` enums.

## 6. API
- `myMeetingSlots` (guardian, `guardian:read_child`): the guardian's slots in scheduled,
  not-yet-past meetings — meeting label/date, time, on-call, children, the answer, and the
  other timed slots' times (`choices`) for option 2.
- `respondToMeetingSlot(slotId, choice, preferredSlotId?, reason?)` (guardian,
  `guardian:read_child` + link check on a child in the slot).
- `reviewMeetingChange(slotId, approve, note?)` (`parents_meeting:approve_change`).
- `parentMeetingSlots` gains `response` + `rescheduledAt`;
  `meetingResponseSummary(meetingId)` (`parents_meeting:view`).

## 7. Journeys
- **J-RS1** Given a dispatched meeting tomorrow and a guardian whose child has the 10:20
  slot, when they open the app, the pop-up shows 10:20 and cannot be dismissed; they tap
  "ঠিক আছে" and it does not return on any device.
- **J-RS2** Given the same guardian picks "পরিবর্তন" → 11:00, they see the not-confirmed
  message; the office sees one pending request 10:20 → 11:00.
- **J-RS3** Given the Principal approves it, the two families swap; the 11:00 family (which
  had confirmed) is asked again with its new time 10:20; the requester's Home card shows 11:00.
- **J-RS4** Given a guardian picks "আসতে পারব না" with no reason, it is saved; the office sees
  it under can't come.
- **J-RS5** A second guardian of the same family opening the app after the first answered
  sees no pop-up; a direct API answer is refused ("ইতিমধ্যে উত্তর দেওয়া হয়েছে").
- **J-RS6** An Office user without `approve_change` sees the requests but no Approve/Decline.

## 8. Out of scope (v1)
- A push/inbox notice when a request is approved/declined or a family is moved
  (`MEETING_SCHEDULE` is still unregistered — CM-4 vocab lock). The Home card and the
  re-ask pop-up carry it; the office can re-send timings via the existing dispatch.
- Changing an answer after it is given (owner ruling: final).
- Contact-only guardians (no login) — reached by wa.me as today.
