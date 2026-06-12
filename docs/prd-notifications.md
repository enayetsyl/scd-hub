# PRD — Notifications, Phase 1: in-app inbox + trigger scheduler + push

| | |
|---|---|
| **Status** | DRAFT — build contract, build-ready |
| **Owner** | Principal |
| **Date** | 2026-06-12 |
| **Decisions** | D-#72 (pipeline + emit seam), D-#73 (first internal scheduler), D-#74 (reminder timing + escalation ladder — refines D-#52 b/c), D-#75 (push in phase 1 — second live external dependency) |
| **Depends on** | Routine R-1..R-5 (built), HW-T1..T4 (built), Plan-review PR-1..PR-3 (built), CT-1 (built — class teacher gate) |
| **Supersedes** | nothing — fulfils the delivery half of D-#52; D-#74 refines D-#52's per-period reminder timings |

## Summary (read this first)
Every trigger the app already computes (bell, class-note prompts — D-#52; homework
parent-comms prompts — D-#34/#44; review assignments; cover assignments) finally **lands
somewhere a person sees it**: a per-recipient in-app notification inbox (🔔 + unread badge)
**plus a phone push pop-up** for anyone using the native app with a registered device. One
`NotificationService.emit()` seam is the single door — every emitter (event-driven and
scheduled) calls it; channels (inbox row always; push when a device is registered; later
WhatsApp/SMS) fan out behind it, so future transports touch zero emitters.

Per the Principal's rulings (D-#74): reminders are **daily sweeps, not per-period nags** —
attendance reminder once at 12:00 to every class teacher (interim unconditional; the
"only-if-not-submitted" check ships with the attendance module), and the class-note prompt
runs a **12:00 → 13:00 → 14:00 ladder to the teacher, escalating to Office at 15:00 and to
the Principal at 16:00**, each rung firing only for notes still unwritten. Bell reminders
stay per-period (~5 min before each period end, to the bell-duty admin). Pushes send
anytime — no quiet hours (Principal ruling, D-#75).

**Known phase-1 limitation (recorded, not hidden):** 129 guardians are contact-only
(`loginEnabled:false`) — no login → no inbox, no push. R5.4 (guardian notified on class-note
publish) is delivered **to login-enabled guardians only**; reaching the rest is the
external-channel phase (WhatsApp Cloud API / bulk SMS — deferred, `docs/roadmap.md`).
Push pop-ups additionally require the **native app** (Expo iOS/Android); web users get the
inbox + badge only.

## 1. Goal
Staff (and login-enabled guardians) are told — in Bangla, with a pop-up where possible and
always in one in-app inbox — everything the system wants from them or wants them to know:
ring the bell, submit attendance, publish the class note (with escalation when it slips),
contact a parent about chased homework, review an assigned plan, cover an absent colleague,
read today's class note for your child. Triggers stop being silent records.

## 2. Where this starts (leans on existing machinery)

| Need | Already exists | This PRD adds |
|---|---|---|
| Trigger schedule | `bellSchedule`, `myClassNotePrompts`, routine slots + covers (R-5/R-4) | A scheduler that *fires* them as notifications |
| Event triggers | class-note publish, HW §7.2 thresholds, review assign, cover assign (all built) | One `emit()` call inside each mutation/service |
| Day/calendar | `resolveDayType`, `ScheduleWindow`, `HolidayException` (R-1) | Scheduler honors day-type; holidays = silent |
| Class teacher | `Section.classTeacherId` + `assertIsClassTeacher` (D-#42/CT-1) | Recipient of the daily attendance reminder + HW parent-comms prompt |
| Recipients | `User` (staff), `Guardian` (login-optional, D-#31) | `Notification` rows keyed to exactly one of them |
| Transport seam | `message:dispatch` + manual wa.me path (J4.2, ADR-003) | Unchanged; WA/SMS adapters plug in later |
| Plane split | ADR-005 + J5.6 fail-closed test | Notifications are identity-plane; nothing crosses to corpus |

## 3. Gap table

| # | Gap today | Phase-1 answer |
|---|---|---|
| G1 | Triggers computed but delivered nowhere (R5.5 parked everything) | `Notification` model + inbox + push; visible surfaces |
| G2 | No single emission seam — each future transport would touch every feature | `NotificationService.emit()` — the only door; idempotent by `dedupeKey`; channels fan out behind it |
| G3 | Time-driven triggers have no runner; repo is deliberately cron-free (D-#20/#21) | First in-process scheduler, D-#73: 60s ticker, school-day aware, idempotent, stale-skip, no external infra |
| G4 | D-#52's per-period reminder timings don't match how the Principal wants the school run | D-#74 timing rules: daily 12:00 attendance sweep; class-note 12→13→14 ladder + 15:00/16:00 escalation; bell stays per-period |
| G5 | No pop-up reaches a locked phone | Expo push (D-#75): device token registry + send-on-emit; web falls back to inbox |
| G6 | Guardian delivery impossible for contact-only guardians | Recorded limitation; external channels deferred (roadmap) |
| G7 | "Attendance if not submitted" can't be checked — attendance capture is unbuilt | Interim unconditional 12:00 reminder (Principal ruling); the conditional check ships WITH the attendance module |

## 4. Model & contract (app-native only — NO wire-contract sync)

**`Notification`** (new model, `server/src/modules/notifications/`, identity plane):
`{ recipientUserId? | recipientGuardianId? (exactly one), kind: NOTIFICATION_KINDS,
titleBn, bodyBn, refs: { module-specific ids — classNoteId / hwItemId / reviewAssignmentId /
slotRef+date / sectionId }, dedupeKey (unique index), readAt?, createdAt }`. Append +
markRead only — no edits, no deletes.

**`DeviceToken`** (new model, same module, identity plane): `{ ownerUserId? |
ownerGuardianId? (exactly one), expoPushToken, platform (ios|android), updatedAt }`.
Registered/refreshed from the native app at login; unregistered at logout; tokens Expo
reports as dead are pruned. Tokens are device credentials — never logged, never exported,
never committed (ADR-005 hygiene; repo is public).

**`NotificationService.emit(input)`** — upsert-by-`dedupeKey` (duplicate emit = silent
no-op). On a NEW row: fan out to channels — inbox (the row itself, always) + push to each
of the recipient's registered devices via the Expo push service. **Push failure never
blocks or rolls back the row** — the inbox is the source of truth; push is best-effort.
All emitters call only this.

**New vocab (`/shared/vocab.ts`, app-native, no wire twin, vocab verifier extends + stays green):**
`NOTIFICATION_KINDS = [BELL_REMINDER, ATTENDANCE_REMINDER, CLASS_NOTE_PROMPT,
CLASS_NOTE_ESCALATION, CLASS_NOTE_PUBLISHED, HW_PARENT_COMMS, REVIEW_ASSIGNED,
COVER_ASSIGNED]` + `NOTIFICATION_KIND_LABELS_BN`. A notification is a feature, not
import-envelope content: **no two-/three-place sync** (no envelope/harness change).

**Permissions: none added.** Inbox reads/markRead and device registration are own-row only
(any authenticated User/Guardian acts only on their own rows/tokens). Emission is
server-internal, never a user-callable mutation. Keeps the small permission set (D-#17).

**GraphQL:** queries `myNotifications(unreadOnly?, limit?)`, `myUnreadNotificationCount`;
mutations `markNotificationRead(id)`, `markAllNotificationsRead`,
`registerDeviceToken(token, platform)`, `unregisterDeviceToken(token)`. All self-scoped.

## 5. Scheduler design (D-#73/#74 — read before building N-2)
- In-process `setInterval` ticker (~60s) inside the existing Node server. **No cron
  daemon, no queue, no external infra.** Single-instance assumption (current single-node
  deployment); multi-instance locking is explicitly out of scope and flagged for any
  future scale-out.
- Each tick: `resolveDayType(today)` → OFF/holiday ⇒ nothing. Saturday ⇒ Quran-track
  scope only (D-#50). Else compute due triggers and `emit()` each — `dedupeKey` makes
  restarts and overlapping ticks double-send-proof.
- **Stale policy:** a trigger whose moment passed >30 min ago is skipped, never backfilled
  (a 9 a.m. bell at 2 p.m. is noise). The hourly ladder self-heals: a missed 13:00 rung is
  caught by the 14:00 rung.
- **Trigger schedule (D-#74):**
  - `BELL_REMINDER` → bell-duty admin (per-period override → whole-day, D-#54), ~5 min
    before each period end, computed from the active grid + window (D-#55/#57/#58).
    Dedupe `BELL:{date}:{period}:{adminId}`.
  - `ATTENDANCE_REMINDER` → **every assigned class teacher**, once daily at **12:00**
    ("submit attendance" — Bangla), interim **unconditional** (G7); sections with no class
    teacher assigned are skipped (the CT-1 admin overview already flags them). When the
    attendance module lands, this becomes conditional (only-if-unsubmitted) **in that
    module's contract**. Dedupe `ATT:{date}:{sectionId}`.
  - `CLASS_NOTE_PROMPT` → each teacher with today's notes still unwritten, at **12:00,
    13:00, 14:00** — one combined message per teacher per rung listing their missing
    slot+date notes (reuses the `myClassNotePrompts` logic; a note published between rungs
    drops off the next rung; all published ⇒ no message). Nursery/KG teachers (day ends
    10:50, D-#57) ride the same 12:00 sweep. Dedupe `CNP:{date}:{hour}:{teacherId}`.
  - `CLASS_NOTE_ESCALATION` → at **15:00** to every OFFICE user, at **16:00** to every
    PRINCIPAL user — one combined message listing the still-missing notes with teacher +
    group/section + period. Dedupe `CNE:{date}:{hour}:{recipientId}`.
- **D-#20/#21 are refined, not reopened:** request-time enforcement stays correct for
  proxy expiry (silent expiry leaves nothing to act on). Reminders are the opposite case —
  their entire value is firing when no one is asking. Recorded as D-#73.

## 6. Push transport (D-#75 — slice N-4)
- Transport = **Expo push service** (`expo-notifications` in the app; Expo push API from
  the server). **This is the app's SECOND live external delivery dependency** (after the
  D-#24 biometric sync), recorded as D-#75: free tier, no secret required for basic send;
  any access token, if later added, lives in `.env` only (never committed — public repo).
  Server deployment must be able to reach the Expo push endpoint.
- Native app registers/refreshes the device token at login; logout unregisters. One
  recipient may hold multiple devices; push goes to all registered.
- **Web = inbox + badge only** (no pop-up); nothing else degrades.
- **No quiet hours** — pushes send anytime (Principal ruling). Phase-1 kinds are
  school-workflow messages and mostly fire in school hours anyway.
- Delivery receipts: dead/invalid tokens reported by Expo are pruned; send failures are
  logged server-side and never fail the emitting mutation or the inbox row.

## 7. Slices (build order; each slice's acceptance = tests, green before the next)

| Slice | Delivers | Journeys | Notes |
|---|---|---|---|
| **N-1** | `Notification` model + `emit()` seam + inbox API + **event-driven** emitters (class-note publish → login guardians; HW chase ≥3 → class teacher; review assigned → reviewer; cover assigned → covering teacher) | N1.* | No scheduler, no push yet. Existing mutations gain one `emit()` call each. |
| **N-2** | Trigger **scheduler**: bell per-period + the 12:00 attendance sweep + the class-note ladder + 15:00/16:00 escalation | N2.* | Needs N-1 + R-5's `bellSchedule` + CT-1's class-teacher gate. D-#73/#74. |
| **N-3** | App: 🔔 unread badge (header, all tabs) + `NotificationCenterScreen` (unread-first, markRead/mark-all, deep-links) | N3.* | Frontend-only over N-1's contract; badge polls `myUnreadNotificationCount`. |
| **N-4** | **Push**: `DeviceToken` registry + register/unregister + send-on-emit via Expo + dead-token pruning | N4.* | Needs N-1. Native only; web unaffected. D-#75. |
| (cross-cut) | Plane split + firewall + Bangla labels | N5.* | Every slice; J5.6 stays green. |

## 8. Journeys & acceptance criteria

### N1 — Model, seam, inbox API, event emitters *(slice N-1)*
- **N1.1 Emit is idempotent** — Given the same `dedupeKey` emitted twice, Then exactly one
  row exists and the second call is a silent no-op.
- **N1.2 Own-rows only** — Given user A's notifications, When user B queries
  `myNotifications`, Then B never sees A's rows (and a Guardian never sees a staff row).
- **N1.3 Class-note publish → guardians** *(R5.4, in-app)* — Given a class note published
  for a group/section, Then a `CLASS_NOTE_PUBLISHED` row is emitted to each
  **login-enabled** guardian of that group/section's students; contact-only guardians get
  nothing (§Summary limitation).
- **N1.4 HW parent-comms prompt** *(§7.2, D-#34)* — Given a student's CHASE_COUNT reaches 3,
  Then an `HW_PARENT_COMMS` row is emitted to the section's class teacher (the parent-comms
  owner, D-#45), deduped per student+item.
- **N1.5 Review assigned** — Given `assignPlanReview`, Then a `REVIEW_ASSIGNED` row is
  emitted to the assigned teacher with the address/round refs.
- **N1.6 Cover assigned** — Given `assignCover`, Then a `COVER_ASSIGNED` row is emitted to
  the covering teacher with slot+date refs; cancel emits nothing (the cover list is the truth).
- **N1.7 markRead** — Given an unread row, When its recipient marks it read, Then `readAt`
  is set and the unread count drops; markRead on another's row is denied.

### N2 — Scheduler *(slice N-2; D-#73/#74)*
- **N2.1 Bell** *(R5.1)* — Given a teaching day and a bell-duty assignment, Then the
  bell-duty admin receives a `BELL_REMINDER` ~5 min before each period end, once per period.
- **N2.2 Attendance daily sweep** *(refines D-#52(b))* — Given a teaching day, Then at
  12:00 every assigned class teacher receives one `ATTENDANCE_REMINDER` for their section,
  unconditionally (interim, G7); unassigned sections are skipped; once per section per day.
- **N2.3 Class-note ladder** *(refines D-#52(c))* — Given a teacher with unwritten notes
  for today, Then at 12:00 / 13:00 / 14:00 they receive one combined `CLASS_NOTE_PROMPT`
  listing only the still-missing notes; a note published between rungs drops off; all
  published ⇒ that rung emits nothing for that teacher.
- **N2.4 Escalation** — Given notes still missing at 15:00, Then every OFFICE user
  receives a combined `CLASS_NOTE_ESCALATION` (teacher + group + period); still missing at
  16:00 ⇒ every PRINCIPAL user receives the same; nothing missing ⇒ no escalation.
- **N2.5 Holidays are silent** — Given a `HolidayException` or an OFF day, Then the tick
  emits nothing; Saturday emits only for Quran-track scope (D-#50).
- **N2.6 Restart-safe + stale-skip** — Given a server restart mid-day, Then re-ticking
  emits no duplicates (dedupeKey) and skips triggers staler than 30 min; a missed ladder
  rung is caught by the next rung, not back-sent.

### N3 — App inbox *(slice N-3)*
- **N3.1 Badge** — Given unread rows, Then the 🔔 badge shows the count on every tab; zero
  hides it.
- **N3.2 Center** — Given the NotificationCenter, Then rows render newest-first,
  unread-first, with Bangla title/body + kind label; tapping marks read and deep-links
  (class note → DailyNote, review → ReviewSubmit, HW → HomeworkHome, cover → MyRoutine,
  attendance/escalation → the relevant section's screen); mark-all-read works.
- **N3.3 Guardian view** — Given a login-enabled guardian, Then their inbox shows only
  `CLASS_NOTE_PUBLISHED` rows for their own children's groups.

### N4 — Push *(slice N-4; D-#75)*
- **N4.1 Register** — Given a native-app login, Then the device's Expo token is
  registered/refreshed for that recipient; logout unregisters; one recipient may hold
  multiple devices.
- **N4.2 Send-on-emit** — Given a NEW notification row whose recipient has registered
  device(s), Then a push (Bangla title/body) is sent to each; tapping it opens the app to
  the same deep-link as N3.2.
- **N4.3 Push never blocks** — Given the Expo service down or a token dead, Then the inbox
  row still exists, the emitting mutation still succeeds, and the failure is logged;
  Expo-reported dead tokens are pruned.
- **N4.4 Web fallback** — Given a web session, Then no push is attempted and the inbox +
  badge behave identically.
- **N4.5 Anytime** — Then pushes are sent regardless of hour (no quiet-hours suppression
  — Principal ruling, D-#75).

### N5 — Plane split, firewall & labels *(cross-cutting; every slice)*
- **N5.1 Identity-plane only** — Then no notification/scheduler/push path reads from or
  writes to the corpus plane; no analytics/export path joins a notification or token row
  to a student/guardian. **J5.6 stays green after every slice. ← non-negotiable.**
- **N5.2 Bangla + codes** — Then every kind, title, and body renders Bangla labels with
  English codes (NFR-5); vocab verifier green.
- **N5.3 No secrets/tokens committed** — Then no push token, device id, or service
  credential appears in committed code, fixtures, or docs (public repo).

## 9. Out of scope (phase 1)
- **WhatsApp Cloud API / bulk-SMS gateway** — stays in `docs/roadmap.md` (provider, cost,
  templates, opt-in, send-window policy — all parked external-channel decisions). This is
  what reaches the 129 contact-only guardians.
- **Notices module / admin broadcast** — deferred ops module; not a notification kind here.
- **Attendance capture** — its own module; we only remind. The conditional
  "only-if-unsubmitted" upgrade to N2.2 ships with that module's contract.
- **Guardian portal screens** beyond the inbox rows themselves.
- **Multi-instance scheduler locking** — single-process assumption recorded in §5.
- **Web push** — web stays inbox-only this phase.

## 10. Reused / unchanged
- `bellSchedule` / `myClassNotePrompts` / routine slot + cover reads (R-5/R-4) — read-only consumers.
- `Section.classTeacherId` + the CT-1 gate (D-#42/#45) — recipient resolution only; gate untouched.
- `message:dispatch` + manual wa.me path (J4.2, ADR-003) — untouched; remains the manual comms route.
- `REVIEW_STATUSES`, LOCKED import envelope, harness, all mirrored enums — **untouched; no sync**.
- Role set + all existing permissions (D-#17) — no additions.
- ADR-005 plane split + J5.6 — unchanged and re-verified per slice.

## 11. Traceability
D-#52 (trigger schedule → this delivers it; timings refined by D-#74), D-#34/#44 (§7.2
prompt), D-#42/#45 (class teacher = attendance + parent-comms recipient), D-#31
(login-optional guardians → §Summary limitation), D-#50/#54/#55/#57/#58 (calendar/grids the
scheduler reads), D-#20/#21 (no-cron posture — refined by D-#73), D-#24 (first external
dependency precedent → D-#75 is the second), D-#17 (no new roles/perms), ADR-003 (no
auto-dispatch via unofficial channels), ADR-005 (plane split), NFR-5 (Bangla labels).
New rows this session: **D-#72, D-#73, D-#74, D-#75**.
