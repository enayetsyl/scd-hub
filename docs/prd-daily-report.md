# Daily school report — build contract (D-#1030–#1035)

Owner ask 2026-11-06: at the end of each day the Principal gets a notification summing up the whole
day (what went well, what went wrong, mistakes, other numbers). The same report is in the Reports
hub with history and cumulative views, and the Principal can let another office or teacher login
see the whole report or only some parts.

Plan + mockups the owner approved: https://claude.ai/artifact/KiJtX6qpHYrEY2B3gvwVis
(the "Digging down" section covers the exact jumps).

## 1. Owner answers (2026-11-06)

| # | Question | Answer |
|---|---|---|
| 1 | Send time | 18:00 on school days |
| 2 | Who gets it at the start | Principal only; the Principal shares the rest |
| 3 | Headline | three counts + the on-time rate |
| 4 | Per-person table in the month view | No; places and duties only |
| 5 | Rebuild past days | No; history starts on launch day |
| 6 | End date on a share | Yes, optional |
| 7 | Finance / guardians / system | Principal only by default, shareable with a warning (mistakes treated the same) |
| 8 | Notification or pop-up | Notification, plus an unread card on Today |

## 2. The parts (D-#1030)

Server: `server/src/modules/daily-report/services/dailyReportParts.ts`. Each part READS the services
the existing reports use; a part that throws becomes an ERROR line and the report is still saved.

| Part | onTime | problems | stats | Jump |
|---|---|---|---|---|
| ATTENDANCE (FULL days only, else NA) | units marked | each unit still unmarked | present, absent, absent without application | Absentee report on the day, section first |
| STAFF | present | unfilled cover + ABSENT + LATE (from the imported sheet) | present/late/absent/leave, cover unfilled, sheet missing | Needs-cover inbox |
| TEACHING | class notes written | class notes missing | written, missing, observations | Class-note report on the day |
| HOMEWORK | classes reconciled | not declared + declared but not issued | issued, not declared, not issued | Reconciliation on the day |
| ASSIGNMENT | packets printed | not declared + not delivered + unprinted packets | packets, unprinted, … | Reconciliation on the day |
| CLASS_TEST | published today | overdue (teacher or publish) | taken/published today, late with teacher, late to publish | The test's results |
| MISTAKES | — | explanations past deadline | tiers 1–3, pending review, warnings; entries count in **ভুল** | The person's record |
| WORK_BOARD | due today, done by end of day | due today, still open | due, done, older still open | The task |
| OFFICE | print requests handled today | print requests waiting from an earlier day | queue, comments | Print home |
| GUARDIANS | — | claims waiting more than a day | families active, claims | Guardian claims |
| FINANCE | — | — | income, expense, closing | Daily snapshot on the day |
| SYSTEM | checks passed | backup warn/critical, stale reminder clock | backup ages | System health |

Status per line: OK (no problems), WARN, BAD (problems ≥ a third of the part's duties, or a critical
backup), NA (nothing due), ERROR. On-time rate = onTime ÷ (onTime + problems).

## 3. The saved day (D-#1030)

- `DailyReport` (one per `dateKey`, unique) is made by the scheduler at `settings.sendMinutes`
  (18:00) on a school day (`resolveDayType` not OFF/HOLIDAY), and up to 4 hours late after a restart.
  It is never changed afterwards. No report on closed days. No rebuilt history (owner Q5).
- Rows are capped at 40 per part (`itemsMore` carries the rest). Each row carries its jump
  `{tab, screen, params, perms}`.
- "Fixed later": the next report re-runs the previous day's replayable parts and stores
  `fixedLater = max(0, then.problems − now.problems)` per part on the NEW report.
- Today before the send time, the screen shows a live "so far" view (built, not saved).

## 4. Who sees what (D-#1031)

- One switch per part, `reports:daily_<part>`, Principal only by default. Holding any one opens the
  Reports hub tile; the report shows only those parts and the headline counts only those parts.
- `reports:daily_share` and `reports:daily_settings` are PRINCIPAL-DEFAULT.
- A Principal's own staff-mistake entries are removed (rows, count, tier stats) for anyone without
  `staff_mistakes:review_principal` (D-#1000).

## 5. Notification + Today card (D-#1032)

- `DAILY_REPORT` notification "আজকের দৈনিক প্রতিবেদন", body
  `সময়মতো N · সমস্যা N · ভুল N` + `সময়মতো কাজ R% (আগের ৫ দিনে P%)`. No names. Opens that day.
  Dedupe `DRPT:{date}:{user}`.
- Recipients: the Principal(s) (unless switched off in settings) + every unexpired share with
  notify on, each only if they still see at least one part.
- The Today card (admin Today and teacher Today) shows the newest unread one; opening the day marks
  its notification read.
- Settings: send time 14:00–22:00, which parts count in the headline, Principal notified on/off.

## 6. History (D-#1033)

Day / week (7 days) / month (to date) / year (to date) from the saved days: totals, the same span
before, problems per day, each part's rate against the span before, and "repeated problems" — a
part + place that went wrong on 3+ saved days. Places and duties only: MISTAKES and WORK_BOARD rows
(people) are never grouped (owner Q4).

## 7. Sharing (D-#1034)

- `shareDailyReport(userId, sections, notify, untilKey?)`: grants each chosen switch the person does
  not hold yet (ordinary per-person grant, audited USER_ACCESS_CHANGED) and records WHICH grants the
  share added. Changing or removing a share takes back only those. A switch held before is never
  touched.
- End date (owner Q6): a share past its end day is refused at read time at once and removed by the
  calendar-daily scheduler sweep.
- Mistakes, guardians, finance and system need a second press ("সাধারণত শুধু প্রধান শিক্ষক").
- New access shows in the person's app the next time they open it (permissions come with the login).

## 8. Exact jumps (D-#1035)

- Absentee report: optional `{date, sectionId}` (section listed first and marked).
- Reconciliation: optional `{date}` (opens a one-day custom range; `useReportRange({initialDay})`).
- Daily snapshot: optional `{date}` (loaded at once).
- Class-note report already took `{date}`; task, test results and person mistakes open one record.
- With no params every screen behaves as before. A jump is shown only when the viewer holds one of
  the link's `perms`; a jump never opens an entry form.

## 9. Acceptance (tests)

`server/src/__tests__/dailyReport.test.ts` (in-memory Mongo, real services) +
`notificationsScheduler.test.ts` (window, restart, holiday, sweep):
saved once / 12 parts / work-board + mistake counts / jump params; fixed later and the old day
unchanged; part visibility + headline; Principal's own mistakes hidden (also through the
notification on a hydrated report); notify Principal + shared-with-notify once, dedupe, unread
card cleared on open; Principal notification off; share grants only what is missing and takes back
only its own; end date refused at once then swept; Bangla refusals; history totals, previous span,
repeated places; the resolver gate lists every part switch.

## 10. Not built (owner chose against, or later)

No names on the notification; no daily teacher ranking; no copied lists; no live alarms; no AI
paragraph; no email/WhatsApp/PDF; no editing; not for guardians; no invented history.
Later: a Thursday weekly summary, an AI paragraph, a printable copy, lesson-plan progress once on prod.
