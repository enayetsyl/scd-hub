# PRD — Class-test scripts: hand-in, scan, guardian view, return (`CS-1..CS-3`)

| | |
|---|---|
| **Status** | v1.0 — BUILT (CS-1..CS-3, branch `feat/ct-scripts`, 2026-10-12). Build notes in §13 |
| **Owner** | Principal |
| **Date** | 2026-10-12 |
| **Decisions** | D-#715, D-#716, D-#717, D-#718, D-#719 (this doc; D-#719 amends D-#717's return path); builds on D-#85 (derive-never-store), D-#143 (server-side resolution), D-#144 (file store reuse), D-#159/#606 (school-day deadline), D-#160/#161 (versioned publish + dedupe), D-#277 (admin approves & publishes), D-#370 (orthogonal status axes), D-#443/#444 (script archive), D-#467 (template-aware roles), ADR-005 (PII firewall), ADR-008 (audit) |
| **Plane** | Operational / identity (ADR-005). Scans show student names and handwriting — identity data, never on a corpus/analytics path |
| **Mockup** | Claude Design canvas "Class Test Script Flow" (6 screens) — owner-reviewed 2026-10-12 |

## 0. At-a-glance (checklist for the builder)

- [ ] **Third status axis on a class test** — the *script stage* — next to entry state (`complete`/`overdue`…) and publish state (D-#370). DERIVED on read from stamps; never a stored status field.
- [ ] Starts when the test's results are **first published**; that moment stores a `dueDateKey` = **1 school day later** (D-#715).
- [ ] **Teacher** sees "খাতা জমা দিন" on Today until the **Office** marks the scripts received. The teacher has no button in this flow.
- [ ] **Office/Principal** (`roster:manage`) receive, scan-upload, tag per student, publish to guardians, hand the paper back to the teacher, or waive. No new role, no new permission.
- [ ] Scans: new `StoredFile` kind `classtest_script`, Drive store, 10 MB/file, jpeg/png/pdf. A guardian reads ONLY their own child's file, ONLY after the scripts are published.
- [ ] The paper goes **back to the students via the teacher** (D-#719): after publishing, the Office hands the bundle to the teacher (`WITH_TEACHER`), the teacher gets a second Today reminder "খাতা শিক্ষার্থীদের ফেরত দিন" (1 school day), and the teacher's "ফেরত দিয়েছি" ends the flow (`RETURNED`).
- [ ] The script archive (D-#443) is **unchanged**, including the Class-test home's "খাতা ফাইল করুন" prompt.
- [ ] **Backfill**: every test published in the current academic year enters the flow, due = launch day + 1 school day, so nothing arrives already overdue.
- [ ] App-native vocab only (`shared/vocab.ts` + BN labels) — no wire-contract twin; vocab verifier extended and green every slice.
- [ ] Every transition writes an audit row (ADR-008).

## 1. Goal

After a class test is checked and its marks are published, guardians see a number
and a weakness note, but never the paper itself. The paper stays with the teacher,
nobody tracks whether it reaches the office, and a guardian who wants to see *why*
the child lost marks has to ask. This feature closes the loop:

1. The teacher is reminded to hand the scripts to the office.
2. The office acknowledges receipt, which clears the teacher's reminder.
3. The office (Akmol, today) scans each student's script and tags it to that student.
4. Publishing makes each script visible to that child's guardian in the portal.
5. The office hands the paper back to the teacher, who returns it to the students in class and records that in the app.

## 2. Settled product choices (owner, 2026-10-12)

1. **Due window = 1 school day** after the results are published.
2. **Backfill = all of this academic year**: every test already published this year enters the flow (not only tests published after launch).
3. **Receipt is an Office action only.** The teacher does not tap "handed over".
4. **Everyone with the Office or Principal role** works the queue (receive, upload, publish, return). Akmol is the one OFFICE-role login today; Tazkir and Akter Hossen are TEACHER logins carrying the OFFICE template (STATUS 2026-09-30) and get it too.
5. **Paper goes back to students** after scanning, and the **return is tracked** in the app.
6. **The office returns the paper through the teacher**, who hands it back in class (2026-10-12, follow-up; D-#719).
7. **The archive prompt stays**: the Class-test home keeps asking to file scripts in খাতা আর্কাইভ; D-#443 is not amended (2026-10-12, follow-up).

## 3. Gap table

| Need | Exists today | Gap |
|---|---|---|
| Know a test's results are out | `ClassTestResult.publishedAt` per student (D-#160) | A test-level moment the script clock starts from: `scripts.dueDateKey` stamped on the first publish |
| Teacher reminder | Today alerts via `pendingWorkFor` (`AlertKind` union) | New kind `ct_script_submit` |
| Office work card | `AdminTodayService` cards incl. `classTests` | New card `ctScripts` (both Today screens, see §7) |
| Per-student scan | Nothing — `ClassTestResult` has no file reference | `scriptFileIds[]` + `scriptMissing` on the result row |
| File upload | `/files/*` → Drive → `StoredFile` (kind-dispatched GET) | `POST /files/ctscript` + kind `classtest_script` + guardian read gate |
| Guardian view | `childTestResults` (published rows only) | `scriptFiles` on each row, only when the scripts are published |
| Paper back to students | Nothing | Office → teacher hand-back stamp + teacher "returned" stamp (D-#719) |
| Paper custody | `ScriptBundle` archive (D-#443) — files paper into a box | No change: the archive and its "খাতা ফাইল করুন" prompt stay as they are (owner, §2.7) |

## 4. The script stage (vocabulary)

Additions to `/shared/vocab.ts`, with `*_LABELS_BN` / `*_LABELS_EN`
(owner BN terms: শিক্ষার্থী, শাখা — never ছাত্র):

`CT_SCRIPT_STAGES`

| Value | BN label | EN label | Meaning |
|---|---|---|---|
| `DUE` | খাতা জমা বাকি | Scripts due | Results published; office has not received the scripts; today ≤ due day |
| `OVERDUE` | খাতা জমায় বিলম্ব | Scripts overdue | Same, after the due day |
| `UPLOAD_PENDING` | আপলোড বাকি | Upload pending | Received; no student has a scan or a "no script" mark yet |
| `UPLOAD_IN_PROGRESS` | আপলোড চলমান | Upload in progress | Some present students are resolved, not all |
| `UPLOAD_DONE` | আপলোড সম্পন্ন | Upload done | Every PRESENT student has ≥1 page or is marked খাতা নেই; not published to guardians |
| `PUBLISHED` | খাতা প্রকাশিত | Scripts published | Guardians can see them; paper still at the office |
| `WITH_TEACHER` | শিক্ষকের কাছে ফেরত | With teacher to return | Office handed the paper to the teacher; teacher has not yet confirmed returning it to the students |
| `RETURN_OVERDUE` | ফেরত দিতে বিলম্ব | Return overdue | Same, after the teacher's return due day |
| `RETURNED` | খাতা ফেরত দেওয়া হয়েছে | Returned to students | Teacher confirmed the students have their scripts. Final |
| `WAIVED` | খাতা প্রযোজ্য নয় | Not applicable | Office closed the test without scans, with a reason (e.g. the paper already went home before launch). Final |

Per-student label (not a stage): **খাতা নেই** / *No script* — a present student
whose paper was not received (lost, not handed in). ABSENT students need no script
and never block `UPLOAD_DONE`.

**Derivation** (one pure function in the server, the `ctPublishStatus.ts`
posture — every screen reads the server value, never re-derives it):

```
not in flow  ← no result row has publishedAt, or test.status !== PRINTED
WAIVED       ← scripts.waivedAt
RETURNED     ← scripts.returnedAt
RETURN_OVERDUE ← scripts.handedBackAt && today > scripts.returnDueDateKey
WITH_TEACHER ← scripts.handedBackAt
PUBLISHED    ← scripts.publishedAt
UPLOAD_DONE  ← receivedAt && every PRESENT row has (scriptFileIds.length > 0 || scriptMissing)
UPLOAD_IN_PROGRESS ← receivedAt && at least one such row
UPLOAD_PENDING     ← receivedAt
OVERDUE      ← today > dueDateKey          (strictly after — see D-#715)
DUE          ← otherwise
```

The hand-back is allowed only from `PUBLISHED`: publishing is one tap once
`UPLOAD_DONE`, so there is no reason to release paper before guardians can see
the scan, and the stage stays a straight line.

**No new permission.** Office-side actions ride `roster:manage` (Office template +
Principal); the teacher's two alerts and the teacher's "ফেরত দিয়েছি" ride
`tracker:write` + `teacherId = me` (a `roster:manage` holder may also record it, for
a teacher who is away); reads ride `tracker:read`. Guardian reads ride `guardian:read_child` + `assertGuardianOfStudent`.

New `NOTIFICATION_KINDS`: `CT_SCRIPT_PUBLISHED` — BN "ক্লাস টেস্টের খাতা দেখা যাবে".

Audit kinds: `CT_SCRIPTS_RECEIVED`, `CT_SCRIPTS_RECEIVE_UNDONE`, `CT_SCRIPT_TAGGED`
(page added/removed/missing-toggled; meta = studentId + before/after),
`CT_SCRIPTS_PUBLISHED`, `CT_SCRIPTS_UNPUBLISHED`, `CT_SCRIPTS_HANDED_BACK`,
`CT_SCRIPTS_RETURNED`, `CT_SCRIPTS_WAIVED`.

## 5. Model changes

**`ClassTest.scripts`** (embedded, optional — absent = not in flow yet):

| Field | Set by | Notes |
|---|---|---|
| `dueDateKey` | first `publishExam`/`publishResult` on the test; backfill | `YYYY-MM-DD`, Dhaka. `deadlineFrom(publishDay, 1, isOpenDay)` — the existing class-test school-day helper. **Never moves** on a re-publish |
| `receivedAt/By`, `receivedCount` | `receiveClassTestScripts` | Count is what the office counted; a shortfall is a hint, not a block |
| `publishedAt/By`, `publishedVersion` | `publishClassTestScripts` | Version +1 per publish (D-#160 posture) |
| `handedBackAt/By`, `returnDueDateKey` | `handBackClassTestScripts` | Office gave the bundle to the teacher; due = `deadlineFrom(handBackDay, 1)` |
| `returnedAt/By` | `markClassTestScriptsReturned` | Normally the teacher |
| `waivedAt/By`, `waiveReason` | `waiveClassTestScripts` | Reason required |
| `backfilled` | backfill script | `true` on rows the launch backfill created (report filter / audit) |

**`ClassTestResult`** gains: `scriptFileIds: ObjectId[]` (ordered pages, ref
`StoredFile`), `scriptMissing: boolean`, `scriptMissingReason?`, `scriptTaggedBy/At`.

Indexes: `{ "scripts.dueDateKey": 1 }` sparse, for the teacher/office queues.

## 6. Server API

Mutations (all `roster:manage` unless noted; every one audits):

| Mutation | Allowed when | Effect |
|---|---|---|
| `receiveClassTestScripts(testId, count)` | stage DUE/OVERDUE | stamps `received*`; teacher alert disappears on next load |
| `undoReceiveClassTestScripts(testId)` | UPLOAD_PENDING only (nothing tagged yet) | clears `received*` |
| `attachClassTestScriptPages(testId, studentId, fileIds[])` | received, not published | appends pages; clears `scriptMissing` |
| `removeClassTestScriptPage(testId, studentId, fileId)` | not published | |
| `setClassTestScriptMissing(testId, studentId, missing, reason?)` | received, not published, student PRESENT | |
| `publishClassTestScripts(testId)` | UPLOAD_DONE | stamps `scripts.published*`, version+1, emits §8 notifications |
| `unpublishClassTestScripts(testId)` | PUBLISHED | clears `scripts.publishedAt` (guardians lose access immediately); a re-publish notifies again |
| `handBackClassTestScripts(testId)` | PUBLISHED | stamps `handedBack*` + `returnDueDateKey`; the teacher's return alert appears |
| `markClassTestScriptsReturned(testId)` — `tracker:write` (own test) OR `roster:manage` (declared `hasAnyPermission`, D-#441) | WITH_TEACHER / RETURN_OVERDUE | stamps `returned*`; the alert disappears |
| `waiveClassTestScripts(testId, reason)` / `unwaiveClassTestScripts` | any stage before PUBLISHED | |

Upload: `POST /files/ctscript` (`roster:manage`; jpeg/png/pdf; **10 MB**/file;
Drive subfolder `ct-scripts`), returns `{fileId,…}` exactly like `/files/classtest`.

Read gate for kind `classtest_script` in `GET /files/:id`: look up the
`ClassTestResult` that lists the fileId, then —
staff with `tracker:read` or `roster:manage` → allow;
guardian → `assertGuardianOfStudent(result.studentId)` AND `result.publishedAt`
AND `test.scripts.publishedAt` → allow; everyone else → 403.
A file not referenced by any result is staff-only (an untagged upload).

Queries:
- `classTestScriptQueue` (`roster:manage`) — tests grouped by stage for the office card and receive list.
- `classTestScriptSheet(testId)` (`roster:manage`) — roster in roll order with attendance, marks, pages, missing flag.
- `scriptStage` added to the `classTestReportsStatus` rows (dashboard tiles/filter).
- `childTestResults` rows gain `scriptPages: [{fileId, mime}]` (empty unless the guardian gate above passes) and `scriptPending`.
- `myClassTestScriptTasks` (`tracker:write`, own tests) — the teacher's two reminders (§7.1; built as a card, see §13).

**Results unpublished after the flow started** (`unpublishClassTestExam`): the
stage freezes where it is; guardians lose script access automatically because the
gate also requires `result.publishedAt`. Nothing is deleted.

## 7. Screens (see the mockup)

1. **Teacher · Today** — alert `ct_script_submit` per test where `teacherId = me` and stage DUE/OVERDUE: "খাতা জমা দিন — {class} · {শাখা} · {subject} · টেস্ট নং {n}", due date, present count; red with "{n} দিন বিলম্ব" when OVERDUE. Tap → the test's results view. Copy under it: "খাতাগুলো অফিসে জমা দিন। অফিস গ্রহণ করলে এই কাজটি নিজে থেকেই চলে যাবে।" Added to `AlertKind`, `pendingWorkFor`, and the client `alertLabel`/`alertTarget` (an unknown kind currently falls through to the assignment label — add the branch, don't rely on the fallback).
   Second teacher alert `ct_script_return` when stage WITH_TEACHER/RETURN_OVERDUE: "খাতা শিক্ষার্থীদের ফেরত দিন — {class} · {subject} · টেস্ট নং {n}", due date, and an inline "ফেরত দিয়েছি" button (`markClassTestScriptsReturned`); red when RETURN_OVERDUE.
2. **Office · Today card "ক্লাস টেস্টের খাতা"** — badges খাতা জমা বাকি · বিলম্ব · আপলোড বাকি · প্রকাশ বাকি · শিক্ষককে দিতে বাকি (PUBLISHED) · শিক্ষকের কাছে (WITH_TEACHER + RETURN_OVERDUE). A PUBLISHED row carries "শিক্ষককে খাতা দিন" (`handBackClassTestScripts`). Receive list with a count stepper (defaults to the present count) and "নিশ্চিত করুন". Rendered on `AdminTodayScreen` AND on `TodayScreen` when `can("roster:manage")` — `AppTabs` picks the Today screen by PRIMARY role, so Tazkir and Akter Hossen (TEACHER + OFFICE template) would otherwise never see it.
3. **Scan upload & tag** (web-first; works on Android) — test header (subject comes from the test, not typed), multi-file picker, "রোল অনুযায়ী মিলিয়ে দিন" (assigns untagged files in upload order to unresolved present students in roll order — the office scans in roll order), per-row "পৃষ্ঠা যোগ" / "খাতা নেই", progress `n/m সম্পন্ন`, publish button disabled until UPLOAD_DONE, then "প্রকাশ বাতিল" and "শিক্ষককে খাতা দিন".
4. **Guardian portal** — on each result card "খাতা দেখুন ({n} পৃষ্ঠা)" when `scriptFiles` is non-empty; "খাতা স্ক্যান করা হচ্ছে — শিগগিরই এখানে দেখা যাবে" while the test is received but unpublished; nothing otherwise. Viewer = the existing `useFileOpen` path (blob on web, OS viewer on Android).
5. **Class-test dashboard** — a second tile row "খাতার ধাপ" (one tile per stage, tap = filter) under the existing entry-state tiles, and a খাতা column on the drill-down rows.

## 8. Notifications

- Guardian, on `publishClassTestScripts`: kind `CT_SCRIPT_PUBLISHED`, one per (student with ≥1 page × linked guardian with a login), dedupe
  `CTSCR:${testId}:${studentId}:${guardianId}:v${scripts.publishedVersion}` (recipient + version in the key — a re-publish notifies again, a new guardian is never swallowed). Deep link → that child's class-test results. Template-rendered BN, inside `bestEffort()`.
- **No** teacher push for "scripts due" — the Today alert is the channel (notification fatigue: D-#700's 4-in-5 unread read).
- **No** wa.me fallback in v1: a family without a login cannot open the portal anyway.

## 9. Backfill (D-#718)

One-off script `server/scripts/backfill-ct-scripts.ts`, **dry-run by default**,
`--apply` to write, run on the VM through the dist services (memory: prod writes
via dist services, `TZ=Asia/Dhaka`). For every `PRINTED` test in the current
academic year with ≥1 published result and no `scripts` field: set
`scripts = { dueDateKey: launchDay + 1 school day, backfilled: true }`.
Prints per-teacher counts before applying, so the owner sees the size of the
day-one Today backlog first.

Expect many old tests whose paper **already went home**: the office closes those
with `waiveClassTestScripts` ("খাতা আগেই ফেরত দেওয়া হয়েছে"). The receive list gets
a "বাদ দিন" action with a reason picker for exactly this.

## 10. Slices

| Slice | Contents | Gate |
|---|---|---|
| **CS-1** Hand-in | vocab (`CT_SCRIPT_STAGES`, labels, notification kind, audit kinds) + verifier; `ClassTest.scripts`, result fields; stage function; `dueDateKey` hook in `ClassTestPublishService`; receive / undo / waive; teacher alert; office card on both Today screens; dashboard tiles + column; backfill script (dry-run) | vocab verifier, carrier verifier, server+app tsc, jest (stage table, due-day math across Fri/Sat + holiday, alert appears/disappears, permission matrix), expo web export |
| **CS-2** Scan & tag | `/files/ctscript`, `StoredFile` kind, staff read gate; attach/remove/missing mutations; `classTestScriptSheet`; upload & tag screen with roll-order auto-match | + jest for the gate (untagged file staff-only), tag rules, UPLOAD_* transitions |
| **CS-3** Guardian + return | publish/unpublish, guardian read gate, `childTestResults.scriptFiles`, guardian card + viewer, `CT_SCRIPT_PUBLISHED` emitter; office hand-back, teacher `ct_script_return` alert + "ফেরত দিয়েছি"; WITH_TEACHER / RETURN_OVERDUE / RETURNED | + jest: guardian of another child → 403, unpublished → 403, result unpublished → 403, re-publish re-notifies, dedupe per recipient; hand-back refused before PUBLISHED; another teacher cannot mark returned |

Note: `TodayScreen.tsx` on the owner's working branch `fix/staff-hub-round2b` has
three cards stranded among the hooks (not in the returned JSX). CS-1 was built off
`origin/dev`, where they are in place; that branch will need the same fix and a
merge of this file when it lands.

## 11. Open questions — both answered by the owner, 2026-10-12

1. ~~Should the Class-test home stop prompting "খাতা ফাইল করুন" for tests in the flow?~~ **No** — the archive and its prompt stay unchanged (§2.7). Note for the builder: a test whose paper has gone home will keep showing "ফাইল করা হয়নি"; that is accepted as-is.
2. ~~Who hands the paper back?~~ **The office gives it to the teacher, who returns it in class** (§2.6, D-#719).

## 12. Acceptance criteria

1. Publishing a test's results shows "খাতা জমা দিন" on its teacher's Today with the next school day as the due date; on a Thursday publish the due day is Sunday.
2. The alert turns red the school day after the due day, not on it.
3. When an Office user marks the scripts received, the teacher's alert is gone on the next Today load and the test appears under আপলোড বাকি on every Office/Principal Today, including a TEACHER login with the OFFICE template.
4. A teacher cannot call any CS mutation (403).
5. Publish is refused until every present student has a page or খাতা নেই; absent students never block it.
6. After publish, the guardian of a tagged student sees খাতা দেখুন and gets one notification; the guardian of a different child gets 403 on that file id; an unpublish removes access at once.
7. After publish, the Office's "শিক্ষককে খাতা দিন" puts "খাতা শিক্ষার্থীদের ফেরত দিন" on that teacher's Today (due next school day); the teacher's "ফেরত দিয়েছি" clears it and moves the dashboard row to খাতা ফেরত দেওয়া হয়েছে. A different teacher gets 403.
8. The backfill dry run lists per-teacher counts and writes nothing; `--apply` makes those tests show as DUE (not OVERDUE) on launch day.
9. Each transition leaves one audit row with actor and before/after.

## 13. Build notes (2026-10-12, all three slices in one branch at the owner's request)

- **Teacher reminders are a self-contained card, not two new `AlertKind`s.** The
  `myDay` alerts are COUNTS per kind (`{kind, count, oldestDateKey}`), with no room
  for one row per test, a due date or a "ফেরত দিয়েছি" button. `CtScriptTeacherCard`
  follows the `TodayWorkCard` posture instead: its own `myClassTestScriptTasks` query,
  renders nothing when empty or on error. Same for `CtScriptOfficeCard`
  (`classTestScriptQueue`), so `AdminTodayService`'s card registry is untouched.
- **Receive happens inline on the Office card** (count stepper + নিশ্চিত করুন), and
  on the scan & tag screen; waive (বাদ দিন) is on the scan & tag screen with an
  editable reason pre-filled with "খাতা আগেই শিক্ষার্থীদের ফেরত দেওয়া হয়েছে".
- **Upload order:** the picker sorts the chosen files by name (numeric-aware), so a
  scanner's `scan_0001 … scan_0024` stays in roll order for "রোল অনুযায়ী মিলিয়ে দিন".
  Untagged uploads live only on that screen; a page left untagged is an orphan
  `StoredFile` that only the Office can open.
- **`scriptStage` on `classTestReportsStatus` is opt-in** (`withScriptStages`) — only
  the GraphQL query asks for it, so the 60-second badge pollers pay nothing.
- **The script clock is best-effort** inside the results publish: a calendar failure
  logs and never fails a publish that already reached guardians.
- **Tests:** `ctScripts.test.ts` (stage table, Thu→Sun clock, every transition's stage
  guard, the file gate) and `ctScriptsRbac.test.ts` (real GraphQL per role: the Office
  side is `roster:manage` only; "returned" is the test's own teacher or the Office).
