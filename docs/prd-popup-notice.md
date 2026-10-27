# PRD — Pop-up Notices (পপ-আপ বার্তা)

| | |
|---|---|
| **Status** | v1.0 — BUILT (branch `feat/popup-notices`); owner answers of 2026-10-26 folded in |
| **Owner** | Principal |
| **Date** | 2026-10-26 |
| **Decisions** | D-#852 (feature, replaces D-#700) · D-#853 (audience) · D-#854 (custom lists + tailored text) · D-#855 (queue + tracking) · D-#856 (close rules) · D-#857 (permissions) · D-#858 (pop-up only; no-login families via wa.me) |
| **Builds on** | D-#700 (guardian announcement — absorbed), D-#841/#844 (blocking pop-up), D-#851 (staff reminder pop-up), D-#790–#801 (permission catalogue), ADR-003 (wa.me), ADR-005, ADR-008 |
| **Plane** | Operational / identity — no corpus path; firewall test stays green |

## 0. Summary

The Office and the Principal compose a message once and choose:

- **who** gets it: staff and/or guardian filters, hand-picked people, or a saved list;
- **how it behaves on screen**: closes by itself, must be scrolled to the end, must stay open
  N seconds, or cannot close until a button is tapped;
- **when** it runs, and how often.

Recipients see it as a pop-up on their next app open (staff app or guardian portal, phone or
web), on whatever screen they land. Every person's progress (**seen / read / answered**) is
recorded on the server, so the sender's report is true across devices. People who haven't
finished can be shown it again, and families without an app login get a WhatsApp list.

## 1. Owner rulings (2026-10-26)

| # | Question | Ruling |
|---|---|---|
| 1 | "Current teachers" | Everybody on **probation or confirmed** (D-#853). |
| 2 | Approval before Office sends | **None** — Office sends directly (D-#857). |
| 3 | Phone notification nudge | **No.** Only the pop-up (D-#858). |
| 4 | Guardian male/female | **Not needed** — father and mother share one login. Guardians are targeted by child's class and section (the বালক/বালিকা sections cover the split) (D-#853). |
| 5 | Guardian changes an answer later | **Configured per notice by the sender** (Office/Principal); off by default (D-#856). |
| 6 | Class teachers sending pop-ups | **No** (D-#857). |
| 7 | Quick-info pop-ups per app open | **3** is right (D-#855). |
| + | Custom list + tailored message | Hand-pick any mix of guardians and staff, save the list, and write `{নাম}` / `{সন্তান}` / `{শ্রেণি}` so each person reads their own name, child and class (D-#854). |

## 2. Who uses it

| Actor | Does |
|---|---|
| **Principal** | Everything (holds every catalogue action). |
| **Office** | Composes, sends to staff and guardians, follows up, sees every report (all four actions on by default). |
| **Teacher / Office / Principal as recipients** | See the pop-up in the staff app; আমার বার্তা in the sidebar. |
| **Guardian (login-enabled)** | Sees the pop-up in the guardian portal; আমার বার্তা in the sidebar. |
| **Guardian (contact-only) / family with no guardian row** | Cannot see pop-ups. Counted as "no login" at compose time and in the report, with a per-family wa.me link (ADR-003). |

## 3. Audience (D-#853, D-#854)

An audience is the **union** of:

1. **Staff filter**, where rows are **AND**ed and values within a row are **OR**ed:
   - role: Teacher, Office or Principal;
   - employment: current (= probation + confirmed, the default), probation only, or confirmed only;
   - gender: male or female;
   - class taught: Nursery, KG, Class 1 … 5;
   - subject taught: BAN, ENG, MATH, SCI, BGS, ARABIC, ISLAM or QURAN;
   - class teachers only.

   Class and subject come from the **live routine**. A Quran/Arabic group's slot teaches the
   class levels of that group's members. An active login with no HR row counts as current.
   Staff with no gender on file are left out of a gender filter, and the composer says how many.
2. **Guardian filter** by the child's class level and/or specific sections. A guardian with
   two matched children is **one** recipient carrying both names.
3. **Hand-picked people**: staff by name, families by child's name or school id. Picking a
   child reaches every active guardian linked to that child.

One-tap segments: all, male, female, KG, Nursery + KG, class, and Quran teachers; Office only;
all staff; all, Nursery, and KG guardians; everyone. **Saved lists** keep the recipe (filters
and/or picks) under a name, shared by every sender. The composer shows a **live count**, a
paged **name list** and a "no login" warning before sending.

**Taking people out (D-#862).** Every name in the composer's list has a ✕. A hand-picked staff member just leaves the picks; anyone a filter matched is stored as an exclusion (`excludeUserIds` / `excludeGuardianIds` / `excludeStudentIds`) and stays out whatever matches them — "all teachers except these two". Removed people are listed with an undo chip and kept with drafts and saved lists.

**Frozen at publish.** The recipients are written once, when the notice goes out, so "23 of
184 have not seen it" stays true. **"নতুন যারা মেলে, যোগ করুন"** re-runs the audience and adds
only the newcomers.

## 4. Content

- Title (≤ 80) and body (Markdown-light: **bold**, line breaks, "- " lists; ≤ 10,000 chars).
- **Merge fields** `{নাম}` (recipient), `{সন্তান}` (the guardian's matched children), `{শ্রেণি}`
  (their class + section); English aliases `{name}` `{child}` `{class}`. They are filled per
  person from a snapshot taken at publish.
- Optional English title/body (shown when the app language is English), tone
  (তথ্য / গুরুত্বপূর্ণ / জরুরি), and an https attachment link.
- **Preview** on the sender's device (sample merge values) and **"আমাকে আগে পাঠান"**: a real
  pop-up for the sender only, never counted.

## 5. Close rules (D-#856)

| Switch | Meaning |
|---|---|
| `autoCloseSec` 3–60 | Closes by itself; a bar counts down. |
| `closeButton` | ✕ / "বন্ধ" shown (forced off by `mustAct`). |
| `mustScrollToEnd` | Locked until the end of the message has been on screen. |
| `minReadSec` 2–300 | Locked until open this long **in the foreground**. |
| `mustAct` | Only a button closes it. |
| `allowSnooze` (+ `maxSnooze` 1–5) | "পরে মনে করিয়ে দিন": back on the next app open. |
| `allowAnswerChange` | A CHOICE answer may be changed from আমার বার্তা while the notice runs. |

Presets: **দ্রুত তথ্য** (5 s), **পুরোটা পড়তে হবে**, **মনোযোগ দিয়ে পড়ুন** (30 s + scroll),
**উত্তর দিতে হবে**.

Enforced on screen:

- **Long text never vanishes.** The auto-close waits until the end has been scrolled into view.
- **A refused close explains itself.** ✕, the backdrop, Android Back and locked buttons all
  shake the pop-up and name what is left:
  - "পুরো বার্তাটি পড়তে নিচে স্ক্রল করুন ↓"
  - "অনুগ্রহ করে বার্তাটি মনোযোগ দিয়ে পড়ুন — আর N সেকেন্ড"
  - "চালিয়ে যেতে নিচের একটি বোতাম বেছে নিন"
- **Progress is visible before anyone tries to close.** A scroll progress bar and a
  "নিচে আরও আছে ↓" pill, plus ✕ and the close button counting down.
- **Short text counts as already scrolled.**

The server refuses what a rule makes impossible: ✕ on an answer-required notice, an
auto-close on a locked one, a second answer when changes are off. Auto-close combined with any
lock is refused at save time.

**Buttons** (≤ 3) come in four kinds:
- **ACK**: records that the person has read it.
- **CHOICE**: a one-question poll.
- **OPEN_SCREEN**: opens an app tab picked from a list, or a screen inside one (`HomeTab/MeetingCommentGuide` — the comment guideline, D-#871).
- **OPEN_LINK**: opens an https link.

Each tap is recorded and audited.

## 6. Schedule and repetition (D-#855)

Start now or at a Dhaka date + time; inclusive last day (default +7). Repeat modes:

| Mode | Behaviour |
|---|---|
| `once` | Shown on the next app open. |
| `daily` | Once per school day until done (the default). |
| `every_open` | Every app open until done. |
| `window` | Once a day for the whole window, even after done (the D-#700 behaviour). |

A snooze or a sender's reminder brings a notice back on the next open whatever the mode.
**Done** means closed with the rules met, or a button tapped. An auto-close counts as SEEN,
not READ.

The app asks on open, and again on return after ≥ 10 minutes away. It never re-asks on every
resume, because a guardian flipping to WhatsApp is not opening the app.

**Queue:** one pop-up at a time, with a "১/৩" counter:
1. answer-required first,
2. then read-required,
3. then at most **3** quick-info notices; the rest wait for the next open.

The meeting RSVP pop-up (D-#841) and the meeting-comment reminder (D-#851) go first: a notice waits until neither is on screen (D-#871).

**Status** is stored as DRAFT, PUBLISHED or WITHDRAWN. Scheduled, live and ended are derived
from the dates.

## 7. Tracking, report and follow-up (D-#855, D-#858)

Per recipient, recorded server-side and moving forward only:
- state `NOT_SEEN → SEEN → READ → ACTED`, plus done and close method;
- first/last seen, show count, foreground read time, answer, snoozes and device kinds.

Finishing on one device ends the notice on all of them.

The **report** shows:
- tiles: recipients (and how many have no login), seen, read, and answered (or done);
- the answer bar, with every segment labelled with its count;
- per-class / per-group meters, flagging low groups;
- the per-person list, filterable by not seen, not done, done, each answer, or no login, with
  a **WhatsApp link** (personalised text) for anyone unreachable or unfinished.

Follow-ups:
- **বাকিদের আবার দেখান**: everyone reachable and not done sees it on the next open.
- **নতুন যারা মেলে, যোগ করুন**: adds people who match the audience now.
- **লেখা ঠিক করুন**: changes the words, button labels and last day, with optional "show again
  to everyone". The audience and rules stay locked.
- **বার্তা বন্ধ করুন**: withdraws it from every screen at once; the report stays.
- **কপি করে নতুন বার্তা**: starts a new draft from this one.

There is **no push or inbox notification** (owner).

**আমার বার্তা** lists 90 days of received notices for every login. Re-reading drops the locks;
answer buttons return when the sender allowed changes.

## 8. Permissions (D-#857)

Catalogue feature `popup_notice` in the Communication group. The Office template holds all
four actions by default, and the Principal holds them implicitly.

| Action | Gates |
|---|---|
| `view` | List, report, per-person list, audience preview, people search, saved lists |
| `send_staff` / `send_guardian` | Compose, save, send, live-edit, withdraw, copy, test, save lists. The resolver needs either; the service checks **each half of the audience** against its own action |
| `follow_up` | Remind the rest, add new matches |

Recipient fields (`myPopupQueue`, `recordPopupEvent`, `myPopupHistoryPage`) are SELF, so they
are open to any login and on the gate test's OPEN_FIELDS. **Class teachers do not send.**

## 9. Data model

| Model | Holds |
|---|---|
| `PopupNotice` | Content, audience recipe, summary, rules, actions, schedule, status, version, counts |
| `PopupNoticeRecipient` | Per (notice, person): kind USER, GUARDIAN or STUDENT; reachable; test flag; personalisation `vars`; progress fields |
| `PopupAudienceList` | Name + audience recipe |

All three are model-local enums (the D-#840 precedent), so there are no `shared/vocab.ts`
enums and no wire twin.

Audit kinds: `POPUP_NOTICE_PUBLISHED`, `_EDITED`, `_WITHDRAWN`, `_ANSWERED`, `_FOLLOW_UP`.

**D-#700:** the app no longer mounts `AnnouncementPopup`; `PopupNoticeHost` takes its place.
`myAnnouncement` stays on the server for older installed bundles. New announcements are made
here.

## 10. Verified (2026-10-26)

- **Server:** 37 jest cases in `popupNotice.test.ts`, covering rules, every audience dimension,
  permissions, publish, the queue, events, the report, follow-ups, lists and history. The gate,
  error-registry and verifier suites pass, and server + app `tsc` is clean.
- **Running app** (in-memory Mongo, Expo web, Playwright): 8 API checks and 31 UI checks.
  - Teacher: the four rules in queue order, hints, foreground timer, auto-close, nothing again
    after reload, আমার বার্তা.
  - Office: segment + hand-picked family, merge fields, preset, preview, confirm and send.
  - Guardian (phone width): sees their own child's name and answers.
  - Report: counts, answer label, the not-seen filter, and the reminder count.

## 11. Not in v1

- Free-text replies.
- Pop-ups from class teachers.
- Push nudges.
- Per-person different text beyond the merge fields.
- An image upload. Today the attachment is a link.
