# SR-6 — Saturday revision: weekly target, listeners, release

_Status: BUILT 2026-11-09 (branch `feat/revision-listeners`). Owner flow given 2026-11-09, mock-up reviewed the same day. Decisions D-#1170–#1174._
_Builds on SR-1 (entry), SR-2 (delivery), SR-5 (surah:ayah ranges). Identity plane (ADR-005)._

## 1. The owner's flow

1. A teacher **declares the week's revision target** for Hifz 3 and Hifz 1.
   **Every student of a level gets the same target** (owner: "no target set for all group like hifz 1, hifz 3. all student in the same group should get same target").
2. A lead teacher (e.g. Abdul Mumin) **assigns each teacher the students they listen to**.
   - The assignment is **fixed for every Saturday**.
   - The lead, the Office and the Principal can add or remove students.
3. On Saturday the teacher sits **in front of the student**. For each section they mark:
   - **ফাতহ** and **তানবিহ**;
   - the **four pronunciation mistakes** (হরফ / গুন্নাহ / মাদ / অন্যান্য);
   - the **status** (সম্পন্ন / আংশিক / হয়নি / অকৃতকার্য);
   - a **comment**.

   An absent student is marked **absent** instead.
4. The lead, Office or Principal **release** the comments, and **guardians get a notification**.

## 2. What was built

| Step | Screen (RevisionTab) | Server | Permission |
|---|---|---|---|
| Target | সাপ্তাহিক রিভিশন লক্ষ্য (`RevisionTarget`) | `RevisionTarget` (level × Saturday, one range per category); `revisionTargets`, `myRevisionTargetLevels`, `setRevisionTarget` | `saturday_revision:set_target` (T on as group lead of that level, O on; `edit_all` = any level) |
| Listeners | শ্রোতা বরাদ্দ (`RevisionListeners`) | `RevisionListener` (one row per student, standing); `revisionListenerBoard`, `setRevisionListener` | `saturday_revision:assign_listeners` (O on, T off; grant to the lead per person) |
| Listen | আজকের রিভিশন শোনা (`RevisionListening`) → one student (`ListenStudent`) | `myRevisionListening`; saves through `recordRevisionEntry` / `editRevisionEntry` | `saturday_revision:enter_results` — the write gate now also passes the student's assigned listener |
| Release | মন্তব্য রিলিজ (`RevisionRelease`) | `revisionReleaseBoard`, `releaseRevisionSaturday` (runs SR-2 `deliverEntry` per entry) | `saturday_revision:release` (O on, T off) |

### Details

- **The target is keyed by the group's `level` string**, not by group. "Hifz 1" boys and girls share one target.
  - A level with no target this week is pre-filled from last week's:
    - the recent lesson (সর্বসাম্প্রতিক পাঠ) takes last week's new lesson;
    - the old revision (পুরনো রিভিশন) is copied;
    - the new lesson (নতুন মুখস্ত) starts empty.
  - Re-declaring replaces the target. Entries already recorded keep their own copy of the range.
- **The marking screen lays out one section per target part.**
  - The range comes from the target and the listener only marks.
  - The section comment is stored in the existing portion `note`.
  - The overall comment stays `teacherComment`.
  - With no target this week, a present student cannot be saved: the screen asks for the target first. Absent can always be saved.
- **Listener assignment is standing.**
  - It holds every Saturday until it is changed.
  - Setting the listener to null takes the student away from their listener.
  - Only someone holding `saturday_revision:enter_results` can be a listener.
  - Every change is audited (`SR_LISTENER_SET`).
- **Release sends every recorded, unsent Hifz entry of the Saturday.**
  - The screen passes the ids it showed, so nothing appears unseen.
  - Each family gets an inbox entry, a push and a wa.me link, through SR-2.
  - An absent entry gets the absence message, and the absence-streak escalation runs as before.
  - Students still waiting are listed. They are released later, in a second release.
- **The parents' message (digest) now carries each section's comment** on the line under that section ("↳ …"). The parent's revision screen shows it too.
- **The old per-group flow is unchanged:**
  - the group grid;
  - the group teacher's পাঠান (`saturday_revision:send`);
  - corrections after sending (`saturday_revision:correct`).

## 3. Not built / open

- **Help guides** `revision-weekly-target`, `revision-assign-listeners`, `revision-listen-mark` and `revision-release` are drafts. They need screenshots from prod after the promotion.
- **Teachers keep `saturday_revision:send` by default.** If only the lead, Office and Principal should send, switch it off for Teacher in the permission matrix.
- **No reminder** is sent to a listener who has students still waiting.
