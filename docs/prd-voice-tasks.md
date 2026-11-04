# PRD — Assign tasks by voice (work board)

**Status:** BUILD CONTRACT · **Owner:** Principal · **Decisions:** D-#960–#966
**Scope:** a 🎤 button on the work board that turns a spoken Bangla / English / mixed note into
one or more **task drafts**, which the speaker reviews and saves through the **existing**
`createTask` / `createTaskTemplate` mutations; plus two daily "tasks you gave" summaries for
assigners. Identity plane (names staff) — no corpus path (ADR-005). No import-envelope change.

> The decisions in `DECISIONS.md` are authoritative; if this file disagrees, fix this file.

## 1. Goal
The owner (and later Tazkir, Akhtar, …) says *"আকমল স্যারকে বৃহস্পতিবারের মধ্যে ক্লাস ফাইভের খাতা
দেখা শেষ করতে বলো, জরুরি"* and gets a filled-in task card to check and save — no typing.
Origin: the Ashol sales-tracker Telegram bot blueprint (Nov 2026). Telegram was considered and
**dropped** (D-#960): the app already knows who is speaking, holds the permission rules, and has
the task form and notifications.

## 2. What already exists (reused, not rebuilt)
| Needed | Already in the build | Reused how |
|---|---|---|
| Tasks + recurring tasks | `Task`, `TaskTemplate`, `TaskService`, `TaskTemplateService` (WB-1/2, D-#701) | Save = the existing mutations; every rule, audit and `TASK_ASSIGNED` notice unchanged |
| Who may assign to whom | `work_board:assign` (+ self-tasks for everyone with `work_board:use`) | Unchanged; the voice switch only opens the 🎤 |
| Staff picker | `assignableStaff` query | The draft's assignee is a picker value from the same list |
| Gemini | `GEMINI_API_KEY` / `GEMINI_MODEL`, REST `generateContent` (MonthlyCommentService, ObservationRotaService) | Same seam, `gemini-flash-latest` alias, audio as `inline_data` |
| Scheduler | the one 60-second ticker; `TaskSweepService` 07:30 / 16:00 jobs | Two more jobs in the same file, same school-day gate + `runOnce` + dedupe keys |
| Undo | `cancelTask`, `setTaskTemplateActive` | "ফিরিয়ে নিন" after a save calls them |

## 3. Roles & permission (D-#961)
New catalogue action **`work_board:voice`** — *Assign by voice* / *কণ্ঠে কাজ দেওয়া*. Off for
TEACHER and OFFICE by default (Principal holds every action); the Principal switches it on per
person in the permission matrix.

| Caller holds | 🎤 shown | Assignees the parser may pick |
|---|---|---|
| `voice` + `assign` | yes | any active staff login (the `assignableStaff` list) |
| `voice` only | yes | the caller only (self-tasks) |
| no `voice` | no | — (`parseVoiceTasks` refused) |

Saving re-checks everything server-side through `createTask` / `createTaskTemplate`.

## 4. Flow
1. Work board → **🎤 কণ্ঠে কাজ দিন** (beside "নতুন কাজ"). Opens `VoiceTaskScreen`.
2. Tap to record, tap to stop (max **90 s**). Web: browser `MediaRecorder` → decoded and
   re-encoded in the browser to **16 kHz mono WAV** (D-#965; WAV is on Gemini's supported list,
   WebM is not). Android: VT-5.
3. App calls `parseVoiceTasks(audioBase64, mimeType, priorDraftJson?)`. **Nothing is written.**
4. Server sends Gemini: the rules prompt (today's date + weekday in Asia/Dhaka, Bangla relative
   dates), the allowed staff (id | English name | Bangla name | designation), the JSON schema,
   the audio, and — on a correction — the current draft.
5. Server checks the reply (§5) and returns `VoiceTaskDraft { transcript, tasks[], warnings[] }`.
6. App shows one card per task: assignee (picker), title, notes, date, slot, priority, minutes,
   repeat summary. Every field is editable by tap. A field filled by a default carries a ⚠️ mark.
7. **🎤 সংশোধন** records again; the current draft goes up as `priorDraftJson` and Gemini returns
   the FULL corrected draft ("আকমল না, কাওসার").
8. **সংরক্ষণ** → one `createTask` (or `createTaskTemplate`) per card, sequentially, button
   disabled while saving (no double save). Each call carries `viaVoice: true` → the audit row's
   `meta.via = "voice"`.
9. After saving: a banner *"৩টি কাজ দেওয়া হয়েছে · ফিরিয়ে নিন"*. Undo cancels exactly those
   tasks / switches off exactly those templates.

## 5. Parsing rules (D-#962, D-#963, D-#964)
**Schema per task:** `assigneeUserId | null`, `assigneeSaid` (the words used for the person),
`titleBn`, `notes`, `dueKey | null`, `slot | null`, `priority | null`, `effortMin | null`,
`recurrence: ONCE|SCHOOL_DAYS|WEEKLY|MONTHLY|MONTHLY_WEEKDAY`, `weekdays[]`, `monthDay`,
`weekOfMonth`, `endKey`; the server adds `defaulted[]` (fields it filled) and per-task
`warnings[]`. Top level: `transcript`, `warnings[]` (Bangla).

**Server checks (code, not the model):**
- Assignee must be in the caller's allowed list (§3); otherwise `null` + warning.
- **Name guard (D-#962):** normalise (NFD, drop hasanta/nukta/ZWJ/ZWNJ/spaces/punctuation,
  lower-case) the transcript and every allowed person's English + Bangla name tokens (≥ 3 chars).
  If the chosen person's name is not heard in the transcript: when exactly ONE other allowed
  person's name is heard, switch to them and warn; otherwise keep the pick and warn. A null pick
  with exactly one heard name is filled from it (warned). Never silent.
- **Date (D-#963):** no date said ⇒ `dueKey: null` and the card asks ("তারিখ বলা হয়নি — বেছে
  নিন"); Save stays disabled until every once-task has a date. A past date is cleared + warned.
  Recurring tasks need no `dueKey`; a past `endKey` is cleared + warned.
- Defaults (marked ⚠️): slot `ANY`, priority `NORMAL`, minutes `30`. Minutes clamped to 5–480.
- **Recurring (D-#964):** WEEKLY needs ≥ 1 weekday, MONTHLY a `monthDay` 1–31, MONTHLY_WEEKDAY one
  weekday + `weekOfMonth` 1–5; an incomplete pattern falls back to ONCE + warning.
- Titles trimmed to 200, notes to 2000. Empty title ⇒ the card is dropped + warned.

**Errors (Bangla, shown on the screen):** no key configured, audio too long/large (> 6 MB base64),
Gemini failure after one retry on 429/500/503, unreadable reply ("আবার বলুন").

## 6. Assigner summaries (D-#966)
School days only (the existing task gate), one notification per assigner per run, new kind
**`TASK_GIVEN_SUMMARY`** ("দেওয়া কাজের হিসাব"). Only tasks given to **someone else** count.
- **08:00** — "আজ দেওয়া কাজ: ৪টি বাকি, ২টি বকেয়া" (due today + overdue, open).
- **17:00** — "আজ: ৩টি শেষ, ২টি বাকি, ১টি আটকে" (done today; open due ≤ today; blocked).
- Nothing to say ⇒ no row. Dedupe key `TASKGS:<date>:<AM|PM>:<recipient>`. Tapping opens আমার
  দেওয়া কাজ. Runs beside (not instead of) the 07:30 digest and the 16:00 overdue notice.

## 7. Slices
| Slice | Content | Ships as |
|---|---|---|
| VT-1 | `work_board:voice`; `parseVoiceTasks` + pure parser/guard module; `viaVoice` audit flag | server |
| VT-2 | `VoiceTaskScreen` (web mic, WAV encode, review cards, correction, save, undo) | app (OTA) |
| VT-3 | recurring tasks by voice (parser + cards + `createTaskTemplate`) | server + app |
| VT-4 | 08:00 / 17:00 assigner summaries | server |
| VT-5 | Android mic: `expo-av`, mic permission, runtime bump → **APK 1.1.7** | APK |

VT-1..VT-4 build in one branch (`feat/voice-tasks`); VT-5 waits for the next APK.

## 8. Acceptance criteria
- **AC-1** `parseVoiceTasks` is refused without `work_board:voice`; writes no Task/TaskTemplate/audit.
- **AC-2** A caller without `work_board:assign` only ever gets themselves (or null) as assignee.
- **AC-3** Name guard: a pick whose name is not in the transcript switches to the single heard
  person with a warning; with zero or ≥ 2 heard it keeps the pick and warns.
- **AC-4** No date said ⇒ `dueKey` null + warning; past dates cleared.
- **AC-5** Defaults applied and listed in `defaulted[]` per task.
- **AC-6** Incomplete recurrence falls back to ONCE with a warning.
- **AC-7** Save creates the tasks through the existing mutations; audit `meta.via = "voice"`;
  the assignee gets `TASK_ASSIGNED` exactly as with the form.
- **AC-8** Undo cancels exactly the saved batch.
- **AC-9** 08:00 / 17:00 summaries: one per assigner, self-tasks excluded, none when empty,
  idempotent across ticks; the scheduler test stubs them.
- **AC-10** No key ⇒ a clear Bangla error; the rest of the work board is unaffected.

## 9. Risks / notes
- **Privacy:** audio + staff names go to Google. No student data is sent. If the key is on the
  free tier Google may use inputs; a paid key does not.
- **Prod key:** confirm `GEMINI_API_KEY` is set in `/opt/scdhub/prod/.env` before switching
  anyone on.
- **Android** shows "অ্যাপ আপডেট করুন" in place of recording until APK 1.1.7.
