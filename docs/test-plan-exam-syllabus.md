# Manual Test Guide — Exam Syllabus, Mark Distribution & Question Types

> Step-by-step test script for the **exam syllabus** module (slices SY-1..SY-6), organised by role and
> including the setup a Principal/Office must do before any teacher or guardian flow will work.
> Grounded in the live code: PRD [docs/prd-exam-syllabus.md](prd-exam-syllabus.md), services
> [server/src/modules/exams/services/](../server/src/modules/exams/services/), screens
> [app/src/screens/syllabus/](../app/src/screens/syllabus/), and the role→permission map in
> [shared/vocab.ts](../shared/vocab.ts). Decisions **D-#530–#535**. Tick `- [ ]` as you go.

---

## How to use this file (it is both the test plan AND the bug report)

| Field | Value |
|---|---|
| Tester | _your name_ |
| Date started | _____ |
| Build / commit | _____ (`git rev-parse --short HEAD`) |
| Environment | _local / dev site / prod_ |

**Per step:** run it, then set its box → `[x]` = passed, leave `[ ]` = not yet, mark a failure with **⚠️**
(e.g. `- [ ] ⚠️ ...`). **When something fails:** add a row to the [Bug log](#-bug--issue-log) with a
`BUG-NNN` id, the step number, and what you saw.

---

## 0 · Read this before you start

### 0.1 What this feature is

The printed **Annual Exam Syllabus** handout becomes an app record. For each **exam × class × subject**
Office types three things — the syllabus prose, the **mark distribution** (মানবন্টন), and the
**question types** — and the row travels a three-desk chain:

```
খসড়া ──submit──▶ শিক্ষকের অনুমোদনে ──approve──▶ প্রধান শিক্ষকের অনুমোদনে ──publish──▶ প্রকাশিত
  ▲  (Office)          (subject teacher)              (Principal)              (guardians + all staff)
  └──────────────── ফেরত দিন — mandatory reason, from EITHER stage ────────────┘
```

`publishedAt` is the **only** thing a guardian can see through. Nothing else gates them.

### 0.2 Roles at a glance

| Role | What they do here | Key permission |
|---|---|---|
| **Principal** | Everything Office does, **plus** the only desk that can `প্রকাশ করুন` (publish), plus the class × subject board | `exam:manage` + `exam:read` + PRINCIPAL role |
| **Office** | Creates exams, writes the syllabus + mark distribution + class note, submits for sign-off, sends back | `exam:manage` + `exam:read` |
| **Teacher** | Reads any **published** syllabus for classes they teach; signs off / sends back **only** the rows named to them | `exam:read` (sign-off is **not** a permission — see 0.4) |
| **Guardian** | Their linked child's class, **published rows only**, plus the PDF | `guardian:read_child` |

### 0.3 Not built — do NOT log these as bugs

- **Everything in this guide is reachable from the UI.** Exam creation, syllabus entry, both sign-off
  stages and every display are screens — no GraphQL is needed to run the feature. The only GraphQL
  steps left are the deliberate **negative** checks (4.5, 4.6, 5.7, 5.8, 6.7), which exist precisely
  because the UI does not offer those paths.
- **No notifications.** A teacher learns a syllabus is waiting from the **drawer badge only**. No push,
  no WhatsApp, no email.
- **No bulk publish.** Publishing is deliberately per subject (§7.6) — Class 5 Bangla is ready weeks
  before Class 5 Science, and holding a class to its slowest subject is the thing being fixed.
- **No 2026 content is loaded.** The owner's pasted syllabus arrived mojibake with byte loss and cannot
  be recovered; the original `.docx`/Docs link is still needed. You are testing with rows you type.

### 0.4 Deliberate design gotchas — verify these, they are NOT bugs

- **Office holds `exam:manage` and still cannot publish.** Publish rides the **PRINCIPAL role**, not a
  permission (the D-#397 posture), so Access Control can hand syllabus authoring to a senior teacher
  without handing them the release to 91 families.
- **Sign-off is not a permission — it is the routine.** The approver set comes from `RoutineSlot`. A
  supervisory or proxy **scope grant confers read, never sign-off**.
- **A teacher who teaches the subject but is not the NAMED approver is refused.** Office names one
  person when submitting; only that person (or the §7.2 bypass) can approve.
- **Editing an approved row silently returns it to খসড়া** and clears the teacher's sign-off. Intended
  (§7.3, the D-#520 rule): a signature must not survive the document being rewritten under it.
- **An unpublished subject shows as a dimmed `প্রকাশ হয়নি` button, not as absent.** Hiding it would read
  as "this class does not sit Arabic".
- **Σ of the mark rows must be exactly 100 in EVERY class**, Nursery included. Composition varies per
  subject; the total never does.
- **The class note stays editable** after that class's first subject has gone for sign-off. It states
  exam *format*, not what a teacher must cover.

---

## 1 · Setup (Principal or Office)

### 1.1 Create the exam — Drawer → পরীক্ষার সিলেবাস → পরীক্ষা ব্যবস্থাপনা

- [ ] **1.1.1** As Principal/Office the drawer group shows **পরীক্ষা ব্যবস্থাপনা** above সিলেবাস এন্ট্রি.
      As a **teacher** neither leaf is there.
- [ ] **1.1.2** The screen opens on the **current academic year**, already selected.
- [ ] **1.1.3** With no exams yet it reads *"এখনও কোনো পরীক্ষা নেই। নিচে একটি তৈরি করুন।"*
- [ ] **1.1.4** In **নতুন পরীক্ষা**: pick ধরন **বার্ষিক**, name it `বার্ষিক পরীক্ষা ২০২৬`, and set শুরুর
      তারিখ / শেষ তারিখ with the **date picker** (not a typed string).
- [ ] **1.1.5** The end-date picker will not offer a date **before** the start date.
- [ ] **1.1.6** Press **পরীক্ষা তৈরি করুন** → *পরীক্ষা সংরক্ষণ হয়েছে*, and the exam appears in the list above.
- [ ] **1.1.7 The duplicate rule, made visible.** Open নতুন পরীক্ষা again → **বার্ষিক is no longer offered**
      in the ধরন picker, because this year already has one. Only অর্ধ-বার্ষিক remains.
- [ ] **1.1.8** Create the half-yearly exam too → accepted. Now the form says the year is full
      (*"শিক্ষাবর্ষ ও ধরন পরে বদলানো যায় না…"*) and offers no create button.
- [ ] **1.1.9 Editing.** Press **সম্পাদনা** on an exam → name and both dates are editable; **ধরন and
      শিক্ষাবর্ষ are shown as plain text, never as pickers**. Change the name, save → the list updates.
- [ ] **1.1.10** Press সম্পাদনা, change nothing, save → accepted, nothing breaks.
- [ ] **1.1.11** Press সম্পাদনা, clear the name entirely → **সংরক্ষণ করুন is disabled**. An exam cannot
      be left nameless.
- [ ] **1.1.12** Switch the শিক্ষাবর্ষ picker to a different year → the exam list changes with it.
### 1.2 Confirm the routine has a subject teacher

The sign-off stage needs someone who actually teaches the pair.

- [ ] **1.2.1** Pick a class × subject that **has** a routine teacher (check the Routine tab). Note who.
- [ ] **1.2.2** Pick a second class × subject that has **no** routine teacher at all — you will need it
  for the §7.2 bypass in **4.4**.
- [ ] **1.2.3** For ARABIC or QURAN specifically, confirm a teacher appears — those are taught through
  cross-grade subject groups and have no `Subject` row, so this is the case most likely to be empty.

---

## 2 · Office — writing the syllabus (SY-4)

Drawer → **পরীক্ষার সিলেবাস** → **সিলেবাস এন্ট্রি**.

### 2.1 The coverage board

- [ ] **2.1.1** The exam picker lists both exams from 1.1. Pick the annual one.
- [ ] **2.1.2** Class chips run **নার্সারি · কেজি · শ্রেণি ১…৫** — pre-primary **first**, not buried
  mid-list (Nursery is level −1, KG is 0).
- [ ] **2.1.3** The header reads *"… এর মধ্যে … টি বিষয় লেখা হয়েছে"*. With nothing written it says 0.
- [ ] **2.1.4** Every subject row shows **বাকি** — not a blank row that looks finished.
- [ ] **2.1.5** A warning notice offers **শ্রেণি ভিত্তিক নোট** because the class footer is unwritten.

### 2.2 The subject editor — prose tab

- [ ] **2.2.1** Open a subject. Two tabs: **সিলেবাস** | **মানবন্টন**.
- [ ] **2.2.2** Type Bangla prose into the সিলেবাস tab and press **সংরক্ষণ করুন** → *সংরক্ষণ হয়েছে*.
- [ ] **2.2.2b** The **পরীক্ষার তারিখ** field is a **date picker** and is labelled as a date. (It was
      previously labelled "পরীক্ষা" and accepted free text — if you see either, log it.)
- [ ] **2.2.3** **Mojibake guard.** Paste `à¦¬à¦¾à¦à¦²à¦¾` into the body and save → refused with a Bangla
  encoding error naming the fix. **Nothing persists.**
- [ ] **2.2.4** Paste the same mojibake into a **mark-row label** (not the body) → also refused.

### 2.3 The mark distribution — the Σ = 100 guard

Use the owner's real Nursery Arabic sheet as the fixture (PRD §5.1):

| # | Row | সংখ্যা × নম্বর | মোট |
|---|---|---|---|
| ১ | ছবি দেখে শব্দের প্রথম অক্ষরে বৃত্ত আঁকা | ১০ × ১ | ১০ |
| ২ | ছবি দেখে শব্দের প্রথম অক্ষর লেখা | ১০ × ২ | ২০ |
| ৩ | ছবি দেখে সঠিক উত্তরে টিক চিহ্ন | ১০ × ১ | ১০ |
| ৪ | সঠিক তারতিবে হরফ লেখা | ১০ × ১ | ১০ |
| ৫ | আগে ও পরের হরফ লেখা | ১০ × ১ | ১০ |
| ৬ | ছবি দেখে শব্দ বলা — মৌখিক | ১০ × ২ | ২০ |
| ৭ | ক্লাস টেস্ট — **কম্পোনেন্ট CT** | — | ১০ |
| ৮ | আখলাক — **কম্পোনেন্ট ADAB** | — | ১০ |
| | **মোট** | | **১০০** |

- [ ] **2.3.1** Add rows 1–6 with **সংখ্যা** and **নম্বর**; each row's মোট is computed, not typed.
- [ ] **2.3.2** While the sum is below 100 the badge reads **যোগফল N** and
  **শিক্ষকের কাছে পাঠান is disabled**, with *মানবন্টনের যোগফল ১০০ হতে হবে* underneath.
- [ ] **2.3.3** Mark row 6 as **মৌখিক** (item type). Save.
- [ ] **2.3.4** Add rows 7 and 8 as **কম্পোনেন্ট সারি** (CT and ADAB). The সংখ্যা/নম্বর fields
  **disappear** for those rows — their number comes from the exam paper.
- [ ] **2.3.5** At exactly 100 the badge flips to **মোট ১০০** and submit enables.
- [ ] **2.3.6** Deliberately break a row (make ১০ × ২ claim a total of ২৫) → refused, and the error
  **names the arithmetic** (`10 × 2 = 20, কিন্তু মোট লেখা আছে 25`).
- [ ] **2.3.7** Delete a row so the sum is 90 → refused, and the message **says 90**.
- [ ] **2.3.8** Give a CT row a সংখ্যা → refused (*"একটি কম্পোনেন্ট সারি — এখানে সংখ্যা বা প্রতি নম্বর দেওয়া যাবে না"*).
- [ ] **2.3.9** Try to save with **no rows at all** → refused. An empty distribution is not zero.
- [ ] **2.3.10** Reopen the subject: the **লিখিত ৮০ · মৌখিক ২০** line is derived from the rows — you
  never typed it.

### 2.4 Other valid shapes — composition varies, the total does not

- [ ] **2.4.1** On a KG subject enter just **two** rows: আদব (ADAB) ১০ + লিখিত ৯০ = ১০০ → accepted.
- [ ] **2.4.2** On another subject enter a **single** row of ১০০ → accepted. One component is not an error.

### 2.5 The per-class question-type footer

- [ ] **2.5.1** From the board press **শ্রেণি ভিত্তিক নোট**.
- [ ] **2.5.2** Select chips (বহুনির্বাচনী · শূন্যস্থান পূরণ · সত্য-মিথ্যা · মিলকরণ · ছোট প্রশ্ন · বড় প্রশ্ন,
  plus **সৃজনশীল** for Class 3+) and type the footer sentence. Save.
- [ ] **2.5.3** Back on the board, the warning notice is gone.
- [ ] **2.5.4** Mojibake in the footer → refused, same guard.
- [ ] **2.5.5** Re-open and edit it → still editable. (Come back after step **4** and confirm it is
  **still** editable once that class's subjects have advanced — that is intended.)

### 2.6 Submitting for sign-off

- [ ] **2.6.1** In the editor, **অনুমোদনের জন্য পাঠান** names a teacher **from the routine**, with a
  *"N টি পিরিয়ড"* hint. It is a picker of routine holders — **not** a free-text field.
- [ ] **2.6.2** The default selection is the holder with the **most periods** for that pair (§7.1).
- [ ] **2.6.3** Press **শিক্ষকের কাছে পাঠান** → status becomes **শিক্ষকের অনুমোদনে**.
- [ ] **2.6.4** On the board that row now shows who is holding it and for how long.
- [ ] **2.6.5** On a subject with **no** routine teacher, submit is refused with
  *"রুটিনে এই শ্রেণি ও বিষয়ের কোনো শিক্ষক নেই — প্রধান শিক্ষক সরাসরি অনুমোদন করতে পারবেন।"*
- [ ] **2.6.6** Try to submit an already-submitted row → refused (*"কেবল খসড়া সিলেবাস…"*).

---

## 3 · Teacher — sign-off (SY-5)

Log in as the teacher named in **2.6.1**.

- [ ] **3.1** The drawer shows **পরীক্ষার সিলেবাস** with an **অনুমোদন** leaf carrying a **count badge**.
- [ ] **3.2** The badge sits on the **অনুমোদন** leaf only — not on সিলেবাস দেখুন as well.
- [ ] **3.3** Open **অনুমোদন** → the row from 2.6 is listed under *আপনার অনুমোদনের অপেক্ষায়*.
- [ ] **3.4** Open it: prose, mark distribution and question types render read-only, with a banner
  saying editing is not theirs and that a mistake should be **sent back with a reason**.
- [ ] **3.5** **There is no edit control anywhere on this screen.** If you find one, log it.
- [ ] **3.6** Press **ফেরত দিন** with an **empty** reason → refused (*"ফেরত দেওয়ার কারণ লিখুন"*).
- [ ] **3.7** Send back with a real reason (e.g. `Unit 5 শেষ হবে না`) → status returns to **খসড়া**,
  and the badge count drops by one.
- [ ] **3.8** As **Office**, reopen that subject → the teacher's reason is shown inline on the row.
- [ ] **3.9** As Office, fix and re-submit. As the teacher, press **অনুমোদন** → status becomes
  **প্রধান শিক্ষকের অনুমোদনে**, badge drops to zero, empty state reads *"এখন আপনার অনুমোদনের অপেক্ষায় কিছু নেই।"*

### 3.10 The refusals that matter

- [ ] **3.10.1** As a **different teacher who also teaches that subject**, open the row and try to
  approve → **refused**. Only the named approver signs off.
- [ ] **3.10.2** As a teacher who does **not** teach the pair at all → refused.
- [ ] **3.10.3** Grant a teacher a supervisory/proxy **scope grant** over that class in Access Control,
  but leave them out of the routine → they can **read** the published syllabus and **cannot** sign off.
- [ ] **3.10.4** As a teacher, confirm there is **no সিলেবাস এন্ট্রি leaf** in the drawer.

---

## 4 · Principal — the board and publishing (SY-5)

- [ ] **4.1** Drawer → **অনুমোদন**. A summary strip shows প্রকাশিত / আপনার কাছে / শিক্ষকের কাছে / খসড়া counts.
- [ ] **4.2** The **class × subject matrix** renders below it. Check:
  - [ ] **4.2.1** Each cell carries a **glyph as well as a colour** — ✓ / প্র / শি / · / ✕. Meaning is
        never colour alone.
  - [ ] **4.2.2** A legend names all five states.
  - [ ] **4.2.3** The grid scrolls **sideways inside its own box**; the page itself never scrolls
        horizontally on a 360dp phone.
  - [ ] **4.2.4** Classes run Nursery → Class 5, not alphabetically.
  - [ ] **4.2.5** Subjects a class does not sit show `—`, and those cells are not pressable.
- [ ] **4.3** Tap the cell from **3.9** → the row opens below with **প্রকাশ করুন** and **ফেরত দিন**.
- [ ] **4.3.0 Per-stage actions.** The matrix opens *any* cell, so check the card matches the stage:
  - [ ] a **খসড়া** cell → *অফিসের কাছে — এখন আপনার কিছু করার নেই*, **no publish button**;
  - [ ] a **শিক্ষকের কাছে** cell → *শিক্ষকের অনুমোদনের অপেক্ষায়*, send-back offered, publish **disabled**;
  - [ ] a **প্রকাশিত** cell → *প্রকাশিত*, no action controls;
  - [ ] only a **আপনার কাছে** cell offers a live **প্রকাশ করুন**.
- [ ] **4.3.0b** The mark-distribution toggle reads **মানবন্টন দেখুন** when closed and
      **মানবন্টন লুকান** when open — not the same label both ways.
  - [ ] **4.3.1** Send back with a reason → returns to খসড়া. Re-run 2.6/3.9 to bring it back.
  - [ ] **4.3.2** Press **প্রকাশ করুন** → status **প্রকাশিত**, cell turns ✓.
- [ ] **4.4 The §7.2 bypass.** Take the subject from **1.2.2** (no routine teacher). As Office, write it
  to 100 and try to submit → refused (2.6.5). Then **as Principal** approve it directly.
  - [ ] **4.4.1** It advances to প্রধান শিক্ষকের অনুমোদনে and is marked as a **bypass**, not a normal
        sign-off.
  - [ ] **4.4.2** Now try the bypass on a subject that **does** have a waiting teacher → **refused**.
        The Principal may not step over a teacher who exists.
- [ ] **4.5 No stage skipping.** Take a fresh **খসড়া** row and try `publishExamSyllabus` on it over
  GraphQL → refused. Same for a row at শিক্ষকের অনুমোদনে.
- [ ] **4.6 Publish re-checks the marks.** Over GraphQL, edit a row at প্রধান শিক্ষকের অনুমোদনে so its
  sum is no longer 100, then publish → refused with the sum named. (The UI keeps it at 100, so this one
  is easiest through the API.)

### 4.7 The gate Office must not pass

- [ ] **4.7.1** As **Office**, open the same published-ready row. Confirm **no প্রকাশ করুন button**.
- [ ] **4.7.2** As Office, call `publishExamSyllabus` directly over GraphQL → refused with
  *"সিলেবাস প্রকাশ কেবল প্রধান শিক্ষক করতে পারেন"*. **This is the single most important refusal in the
  feature** — Office holds `exam:manage` and must still be stopped here.

### 4.8 The re-open rule (§7.3)

- [ ] **4.8.1** Take a row the teacher has approved (at প্রধান শিক্ষকের অনুমোদনে). As Office, change the
  **prose** and save → it drops back to **খসড়া** and the teacher's sign-off is cleared.
- [ ] **4.8.2** Repeat, changing only a **mark row** → same.
- [ ] **4.8.3** Repeat, changing only the **question-type chips** (no prose, no mark change) → the row
  **keeps** its status and the sign-off survives. Only content edits reopen.

---

## 5 · Teacher — reading (SY-6)

Drawer → **পরীক্ষার সিলেবাস** → **সিলেবাস দেখুন**.

- [ ] **5.1** Pick the exam and a class you teach. Subjects render as a **grid of name buttons**, each
  showing its exam date and total.
- [ ] **5.2** Your **own** subjects are outlined and sort **first**.
- [ ] **5.3** A subject you teach that is not yet published appears as a **dimmed প্রকাশ হয়নি button** —
  present, not hidden.
- [ ] **5.4** Tap a published subject → prose + mark distribution + question types.
- [ ] **5.5** The **class note renders once at the top of the class screen**, not repeated on every
  subject.
- [ ] **5.6** Tap an unpublished (dimmed) button → it does not open a draft.
- [ ] **5.7** Over GraphQL, request `examSyllabusDetail` for an unpublished row as this teacher →
  refused (*"এই সিলেবাস এখনও প্রকাশ করা হয়নি"*).
- [ ] **5.8** Over GraphQL, call `examSyllabusBoard` as this teacher → **refused**. The board is the one
  read that shows drafts school-wide.

---

## 6 · Guardian (SY-6)

Log in as a guardian with a linked child.

- [ ] **6.1** The drawer shows **পরীক্ষার সিলেবাস** under পড়াশোনা — and **no** সিলেবাস এন্ট্রি and **no**
  অনুমোদন leaf.
- [ ] **6.2** The screen names the child and their class, and lists **only published** subjects.
- [ ] **6.3** The class question-type note shows once at the top.
- [ ] **6.4** Tap a subject → prose + mark distribution.
- [ ] **6.5** With more than one linked child, the child switcher changes the class shown.
- [ ] **6.6** A subject still in খসড়া / শিক্ষকের অনুমোদনে / প্রধান শিক্ষকের অনুমোদনে is **completely
  absent** — a guardian sees no placeholder and no status.
- [ ] **6.7 The leak checks** (do these over GraphQL with the guardian's token):
  - [ ] **6.7.1** `examSyllabusClass(examId, classId)` for their child's class → refused or published-only.
  - [ ] **6.7.2** `guardianChildSyllabus` with **another family's `studentId`** → refused.
  - [ ] **6.7.3** `examSyllabusBoard` → refused.
  - [ ] **6.7.4** `mySyllabusApprovals` → returns `[]`, **not** an error.

---

## 7 · The PDF (SY-6)

Route: `GET /pdf/syllabus/:examId?classId=…` for staff, `?studentId=…` for guardians.

- [ ] **7.1** As Principal/Office, open `/pdf/syllabus/<EXAM_ID>?classId=<CLASS_ID>` → the class bundle
  renders as A4.
- [ ] **7.2** Bangla renders correctly — no boxes, no mojibake — and the mark tables line up.
- [ ] **7.3** The class question-type note appears **once**.
- [ ] **7.4** As a **guardian**, open `/pdf/syllabus/<EXAM_ID>?studentId=<THEIR_CHILD>` → their child's
  class, published rows only.
- [ ] **7.5** As a guardian, call it with `?classId=` instead → **refused / ignored**. The class
  parameter must not be a way to read any class.
- [ ] **7.6** As a guardian, pass **another family's** `studentId` → refused.
- [ ] **7.7** A class whose subjects are all unpublished renders an empty-but-valid sheet, not a 500.
- [ ] **7.8** On the **dev site**, confirm the URL returns a **PDF and not the SPA's index.html**. (If
  you get HTML, the Caddy `@api` matcher is the suspect — but `/pdf` is already allow-listed, so this
  should pass.)

---

## 8 · Cross-cutting

- [ ] **8.1 The drawer never breaks.** Log in as each of the four roles in turn and confirm the drawer
  renders every time. A permission-carrying probe taking down the navigator is the exact failure fixed
  in `791e5fe`; the badge query is designed to return `0` rather than refuse.
- [ ] **8.2 Dark mode.** Walk the editor, the matrix and the guardian screen in dark mode. The matrix
  cells and badges must stay legible.
- [ ] **8.3 Bangla numerals.** Counts, marks and totals render as ০-৯ throughout; ids stay Latin.
- [ ] **8.4 Audit trail.** As Principal, open the audit log and confirm one row per transition:
  `EXAM_CREATED`, `EXAM_SYLLABUS_SAVED`, `EXAM_SYLLABUS_SUBMITTED`, `EXAM_SYLLABUS_TEACHER_APPROVED`,
  `EXAM_SYLLABUS_TEACHER_BYPASSED`, `EXAM_SYLLABUS_SENT_BACK`, `EXAM_SYLLABUS_REOPENED`,
  `EXAM_SYLLABUS_PUBLISHED`, `EXAM_CLASS_NOTE_SAVED`.
- [ ] **8.5** The bypass from **4.4** is logged as `EXAM_SYLLABUS_TEACHER_BYPASSED`, **not** as a normal
  approval — that distinction is the point of the stage.
- [ ] **8.6 Two terms stand alone.** Switch the exam picker to the half-yearly exam → its syllabus is
  empty and entirely independent of the annual one.

---

## 9 · Regression — nothing else moved

The syllabus work touched three shared files. Spot-check them:

- [ ] **9.1 Teaching Notes** still opens, uploads and rejects mojibake. (The encoding guard moved to
  `platform/services/encodingGuard` and is re-exported; behaviour must be identical.)
- [ ] **9.2** The **Print** and **Class Test** drawer badges still show their counts — `tintedBadgesFor`
  changed signature to take the leaf's screen.
- [ ] **9.3** The **Reports** drawer group still deep-links correctly to each of its screens.

---

## 📋 Bug / issue log

| id | step | role | what you saw | expected | severity |
|---|---|---|---|---|---|
| BUG-___ | | | | | |
| BUG-___ | | | | | |

> File confirmed bugs into [docs/issues/BACKLOG.md](issues/BACKLOG.md) following the SOP in that folder's
> README, with a screenshot in `issues/assets/` where the failure is visual.
