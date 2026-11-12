# PRD — Learning-objective tree (`mastery` catalogue v2 · শিখনফল-বৃক্ষ)

**Status:** OT-0 (this contract + the first draft content) 2026-11-04. Nothing built yet.
**Decision block:** D-#921–#928, reserved against `origin/dev@e9d693fc` (2026-11-04, max D-#918; open PRs hold
D-#919 #1291 and D-#920 #1292). Amends D-#776 (spine shape, one-vs-many LO open point), D-#783 (guardian
grain) and D-#785 (unknown/missing LO on import) — see §11.
**Parent contract:** `docs/prd-mastery.md` (M-0..M-6, all built). Everything there stays true unless this file
says otherwise. Read it first.
**Plan + mockups (owner-approved 2026-11-04):** https://claude.ai/artifact/7pYdzbNTduFTquefnbq3FA (7 screens).
**Content:** `docs/mastery/objective-tree/` — file format in its README; first draft `C1_MATH.tree.json` +
review sheet `C1_MATH.md`; school-wide `domains/MATH.json`.

**Owner ask (2026-11-03):** "One objective could be know the numbers. Another could be write the numbers
correctly … Addition could be another learning objective … In the addition, there could be sub learning
objective, one digit addition, two digit addition, addition with keeping in hand … by analyzing these books,
you, the Claude, will find out a comprehensive list of learning objective based on the books. And then you
will upload them and a teacher will review them and accept them. Based on this, we'll take the question,
lesson plan, and many more … These tagging will help us to identify which topic students are weak [in]."

## §0 — At a glance / build order

| Slice | What it is | Needs |
|---|---|---|
| OT-0 | This PRD, the tree file format, MATH domain ladder, C1 Math draft (content, docs only) | — |
| OT-1 | Model + tree import + configurable level names + code pattern `.N` (contract sync) + `mastery:review` | OT-0 |
| OT-2 | Review in the app: assign reviewer, queue, row detail with book evidence, accept/edit/split/merge/reject/add, comments, append-only review log, lock gate, decisions export | OT-1 |
| OT-3 | Roll-up (sub-objective → objective → domain) in every mastery view + prerequisite ("earlier step") hint; guardians at objective grain | OT-1 |
| OT-4 | Question bank: one code per question, ক/খ parts via stimulus, refuse untagged once locked, coverage screen | OT-1 |
| OT-5 | Lesson plans carry codes; marking a session taught records them; "taught but weak" vs "missed that class" | OT-1, LP-1..3 |
| OT-6 | Content waves (no code): pilot C1 + C3 Math → rest of C1–C3 → C4/C5 → C6, NUR/KG, Islam, Arabic | OT-2 for review |

**Pilot (D-#924):** C1 Math (the owner's own example) and C3 Math (dev already holds a month of seeded marks to
replay on the new codes). The pilot needs OT-1 + OT-2 to review in the app; OT-3..OT-5 may follow in any order.

## §1 — Goal

1. Replace the flat chapter → outcome list with a tree fine enough to say **which step** a child is stuck on
   (carrying, not "Chapter 7"), drafted by Claude from the **whole** 2027 book — every numbered exercise, not
   only the শিখনফল bullets.
2. Put a **teacher review** between the draft and the lock, inside the app, with the book evidence beside every
   row and a full record of who decided what.
3. Make the tree the one vocabulary for questions, lesson plans, marks, diagnosis, actions and the guardian view.
4. Link the same skill across classes so a weakness can be traced to an earlier, unsecured step.

## §2 — Gap table

| Need | Today (prd-mastery) | After |
|---|---|---|
| Grain | Flat LO per chapter; C1 Math Ch 7 (যোগ) = 3 LOs for ~11 skills | Domain → objective → sub-objective; split only where a child can fail apart |
| Source | Book's শিখনফল bullets only | Every numbered exercise + teacher notes + marks appendix + memo rules, with an exercise-coverage check |
| Review | Owner edits markdown, flips `Status:` | Assigned reviewer in the app; Principal locks behind a gate |
| Cross-class | None | School-wide domain ladder + `prereqCodes` |
| Question ↔ LO | `lo_codes` array, one-vs-many undecided (D-#776) | Exactly one code per question; two skills ⇒ ক/খ parts |
| Missing LO on a question | Warning (D-#785) | Refused once that class × subject is locked |
| Lesson plans | Linked by chapter only (LP-3) | `tags.lo_codes` per session plan; taught-codes recorded on marking |
| Level words | — | One configurable setting, read everywhere |

## §3 — Reused / unchanged

- **Diagnosis engine, evidence log, work sheets, tailored assignment, actions, extra classes, re-test, guardian
  notifications** (M-2..M-6) keep running on **tagged rows** exactly as they run on LOs today. A tagged row IS an
  LO in their eyes: same `code` field, same `MasteryOutcome` collection, same lock/retire rule.
- **Diagnosis tags** (নির্ণয়ের ট্যাগ, D-#778/#787) are unchanged and stay separate: an objective code says
  *what* a question tests; a diagnosis tag says *why* marks were lost. Strand routing still sends handwriting /
  answer-sentence slips to skill strands.
- **Catalogue import screen** (তালিকা ইমপোর্ট, dry-run diff first) — extended, not replaced.
- **Question review rounds** (QR) and the gold gate; **stimulus** doc-type (shared stem) for ক/খ parts.
- **Permission catalogue** (`shared/permissionCatalogue.ts`): new action registered and gated (CI source scan).
- **Never exam marks** (prd-mastery §3) — unchanged.

## §4 — The shape (D-#921, D-#922)

| Level | Bangla (default, configurable — D-#923) | Grain | Who reads it | Carries marks? |
|---|---|---|---|---|
| Domain | ক্ষেত্র | One skill area for a subject, **the same in every class** (যোগ, ভগ্নাংশ…) | Principal heat-map, cross-class trace | No — roll-up only |
| Objective | শিখনফল | About one lesson / one book শিখনফল; the size of one extra class or one week's tailored work | Guardian (label + home tip), teacher chapter view, actions | Only if it has no children |
| Sub-objective | উপ-শিখনফল | One step a child can fail on its own; one short question tests it | Teacher, bank, diagnosis | Yes |

**Split only when it can fail apart (D-#922).** An objective gets sub-objectives only if a child can pass one part
and fail another. Otherwise the objective itself is the tagged row. So the tree is uneven: `শূন্যের যোগ` is a
tagged objective with no children; `হাতে রেখে যোগ` has tagged children. Never exactly one child; never a child
that repeats its parent. **Tagged** = the rows questions, rubric grades and evidence name; untagged rows exist
only to group.

**Codes (D-#921).**
- Domain `DOM-<SUBJ>-<SLUG>` (e.g. `DOM-MATH-ADD`) — per subject, shared by all classes.
- Objective `LO-<CLASS>-<SUBJ>-<CC>-<NN>` (unchanged shape).
- Sub-objective `<objective code>.<N>`, N = 1..99 (e.g. `LO-C1-MATH-07-03.2`).
- Skill strand `LO-<CLASS>-<SUBJ>-SK-<STRAND>-<NN>` (unchanged), may also take `.N`.
- `MASTERY_LO_CODE_RE` becomes `^LO-(NUR|KG|C[1-6])-(BAN|ENG|MATH|SCI|BGS|ARABIC|ISLAM)-(\d{2}|SK-[A-Z]{2,8})-\d{2}(\.\d{1,2})?$`.
- Nothing is locked on prod (prd-mastery switch is off everywhere), so draft codes may be renumbered freely;
  each tree row lists the old flat codes it replaces in `legacyCodes`.

**Five drafting tests** (Claude applies them; the review screen shows which one a borderline row barely passed):
(1) one question of ≤ 2 minutes can test it; (2) the book practises it in ≥ 1 numbered exercise; (3) it can be
retaught on its own in one extra class; (4) it appears once per class (a skill repeated across chapters is one row
citing several chapters, or a skill strand); (5) split only when it can fail apart.

## §5 — Model (OT-1; `server/src/modules/mastery/models/`)

**`MasteryDomain`** (new) `{subject, code, labelBn, labelEn?, order, active, status: DRAFT|LOCKED, note?}` —
unique `code`. Imported from `domains/<SUBJ>.json`; LOCKED with the first class × subject of that subject that
locks. A domain may be added later (book of a new class); never deleted once locked, only made inactive.

**`MasteryOutcome`** gains:
`level: OBJECTIVE|SUB`, `parentCode: string|null` (SUB ⇒ the OBJECTIVE's code), `domainCode`,
`tagged: boolean`, `prereqCodes: string[]` (same subject, same or earlier class; a `BAN2`/`ENG2` row may also name a live `BAN`/`ENG` row of the same or an earlier class — PR-P, one direction only), `bookRef: {version, chapter,
lesson?, exercises: string[]}` (structured; replaces the free string), `claudeNote?`, `legacyCodes: string[]`,
`reviewState: PROPOSED|ACCEPTED|EDITED|REJECTED|ADDED` (meaningful while DRAFT), `mergedInto?`.
Invariants (enforced on import and on every review write): a SUB's parent exists, is an OBJECTIVE and has
`tagged:false`; an OBJECTIVE with children has `tagged:false`, without children `tagged:true`; no objective has
exactly one non-rejected child; codes match `MASTERY_LO_CODE_RE`; every `prereqCodes`/`domainCode` resolves.

**`MasteryCatalogueReview`** (new, one per class × subject × draft round) `{classToken, subject, round,
reviewerIds[], assignedBy, assignedAt, state: OPEN|SUBMITTED|LOCKED|SUPERSEDED, coverage: {exercisesTotal,
mapped, unmapped[{ref,text,reason, resolution?}]}, flags[], submittedAt?, lockedAt?, lockedBy?}`.

**`MasteryReviewEvent`** (new, **append-only**, also `writeAudit`) `{reviewId, code|null, action: ACCEPT|EDIT|
SPLIT|MERGE|REJECT|ADD|MOVE|COMMENT|REPLY|RESOLVE|REOPEN|BULK_ACCEPT, before?, after?, comment?, by, at}`.

**Level names (D-#923)** live in the SCHOOL `MasteryPolicy` row: `levelLabels: {domainBn, objectiveBn, subBn,
domainEn, objectiveEn, subEn}`, default ক্ষেত্র / শিখনফল / উপ-শিখনফল, edited on the existing পলিসি screen.
App screens read them through one hook, the server (PDFs, notifications, guardian payloads) through one helper.
No screen, PDF or notification hard-codes a level word (a source scan in CI fails on the literals outside
`labels.ts`' default). Renaming in পলিসি changes every surface without a deploy.

## §6 — Tree file and import (OT-1)

The draft Claude writes is `docs/mastery/objective-tree/<CLASS>_<SUBJ>.tree.json` (format
`scd-objective-tree/1`, full field list in that folder's README) plus a rendered review sheet `<CLASS>_<SUBJ>.md`
for reading on GitHub. The JSON is the only source; the sheet is regenerated, never hand-edited.

**How Claude drafts (D-#924)** — in a Claude Code session, offline; the app needs no AI key:
1. Read the **final version**: the writer-reviewer Word copy matching the print (e.g. `Final Book/
   C1_MATH_Book_v1_5_Writer-Reviewer.docx`), checked against the print IDML in `Print File`; if they differ, the
   print wins and the difference is flagged `VERSION_DIFF`.
2. Also read the teacher notes (শিখনফল), the marks appendix (question types, deduction rules) and the book memo.
3. Inventory **every numbered exercise** and map each to ≥ 1 tagged row; every tagged row cites ≥ 1 exercise.
4. Apply the five tests; fill prerequisites; flag `WORDING_RULE_CONFLICT` / `TOO_BROAD` / `DUPLICATE`.
5. Before drafting a class, read the previous review exports in `docs/mastery/objective-tree/feedback/` and
   follow what reviewers split, merged and rejected.
6. Run the structural verifier (§10 item 1) — green before the file is offered for upload.

**Import** (`importMasteryCatalogue`, extended for the tree format; the flat format stays readable):
preview shows counts per level, the coverage line, flags and the diff; apply writes rows as DRAFT with
`reviewState: PROPOSED` and opens a `MasteryCatalogueReview` round. Re-importing a new Claude draft over an
open round: rows whose content is unchanged keep their decision; changed rows return to PROPOSED; rows gone
from the file are REJECTED with reason "removed in redraft". Over a LOCKED catalogue (book revision): the
prd-mastery rule holds (locked code: label / home tip / question types only; missing ⇒ RETIRED, never deleted);
new rows enter a new round as PROPOSED; nothing locked moves.

## §7 — Review and lock (OT-2, D-#924)

- **Assign.** Principal (`mastery:settings`) assigns a round to one or more reviewers (**বরাদ্দ**). Owner ruling:
  **Mahzabin reviews every list** and consults subject teachers where needed; she holds the new `mastery:review`
  action by per-person grant. Notification to the reviewer on assignment.
- **Queue** (mock 2). Grouped chapter → objective; progress "N / M দেখা হয়েছে"; filter "শুধু বাকিগুলো";
  one-tap গ্রহণ / বাদ per row; "এই শিখনফলের সব গ্রহণ" (BULK_ACCEPT, one event per row).
- **Row detail** (mock 3). Code, path (domain › objective), label, book wording, book ref with exercise list,
  assess + question types, prerequisites, home tip (objective), Claude's note. Actions: **গ্রহণ**, **সম্পাদনা**
  (label, assess, QT, prereqs, home tip, domain), **ভাগ করুন** (creates children `.N`, parent turns untagged),
  **অন্যটির সাথে মেলান** (`mergedInto`, exercises move to the survivor), **সরান** (MOVE to another parent or
  domain), **বাদ দিন** (reason required), **নতুন যোগ** (ADDED, needs a book ref or a reason). Every write
  re-checks the §5 invariants and is refused with the broken rule named.
- **Comments.** Any row or the round; open until RESOLVE; reply threads; the Principal and assigned reviewers
  are notified.
- **Unmapped exercises** from the coverage list appear as rows to resolve: map to a row, or "not assessed this
  year" with a reason.
- **Submit → lock** (mock 4). Reviewer submits; the Principal sees decision counts and locks. **Gate:** no open
  comments, no unresolved unmapped exercise, every invariant holds. Lock sets `status: LOCKED` on every
  non-rejected row and on the subject's domains; codes become permanent (prd-mastery rule).
- **Decisions export (feedback for Claude).** `masteryReviewExport(classToken, subject, round)` → JSON of every
  event with before/after; the owner (or a session) saves it as `docs/mastery/objective-tree/feedback/
  <CLASS>_<SUBJ>.round<N>.json`. Claude reads these before the next draft (§6 step 5).
- **Switch.** Turning a class × subject on (prd-mastery D-#775) now also requires its round LOCKED.

## §8 — Downstream

### 8.1 Roll-up and ladder (OT-3; D-#925, D-#927, D-#943)
States are computed on tagged rows only (engine unchanged, D-#808). Views add:
- **Untagged objective** = NOT_ASSESSED if no child assessed; WEAK if any child WEAK; MASTERED (or
  REVISION_DUE) only when EVERY non-rejected tagged child has been assessed and is MASTERED/REVISION_DUE;
  INSUFFICIENT (তথ্য কম) if any child is still NOT_ASSESSED — never mastered on a half-checked objective
  (D-#943); else IMPROVING if any child is IMPROVING/MASTERED; else INSUFFICIENT. Guardians' rolled-up wording
  follows the same rule.
- **Grouping rows take no work** (D-#943): paper entry, rubric sheets and the weekly assignment refuse an untagged
  objective's code and name its tagged children. The heat-map opens at the domain level on a tree; an
  earlier-class step is judged by that class's own policy (it can show রিভিশন বাকি).
- **Domain** = counts per state of its tagged rows for that class + share mastered; the heat-map colours by share
  weak. All thresholds stay in পলিসি.
- **Section trigger** stays on tagged rows (D-#813); the proposal names the parent objective and lists the weak
  children, so an extra class is planned at objective size.
- **Guardians see the objective grain only (D-#925):** objective label + home tip + rolled-up guardian wording;
  sub-objective labels never reach a guardian payload. Amends D-#783.
- **Earlier step (D-#927):** on a WEAK tagged row, the student view and evidence trail show each prerequisite and
  its state for that student ("আগের ধাপ: … — আয়ত্তে ✓"). Cross-class prerequisites read the student's evidence
  from earlier years when it exists; otherwise "আগের শ্রেণির তথ্য নেই". Prerequisites are filled by Claude from
  the first draft.

### 8.2 Question bank (OT-4; D-#926, D-#928)
- **One code per question.** `lo_codes` gets `maxItems: 1` in `LOCKED_QuestionPayload_Schema_v1.json` and the
  envelope mirror; `topic_tag` = that code. Two-place contract sync (vocab regex `.N`, envelope schema, payload
  schema, harness, `verify_shared_vocab.mjs`), then every verifier in AGENTS.md.
- **ক/খ parts.** A question that tests two skills is authored as a `stimulus` (the shared stem, e.g. the story)
  plus one `question` per part, each with one code and its own marks; `MasteryPaperItem` gains `partLabel?`
  ("ক", "খ") and `stimulusRef?` so a work sheet prints them as 4(ক), 4(খ) under one stem. Never two codes on
  one item.
- **Refuse untagged once locked.** For a class × subject whose round is LOCKED, importing a question with no code,
  an unknown code, or an untagged (grouping) code is refused with the reason; before lock the D-#785 warning
  stays. Amends D-#785.
- **Coverage screen** (mock 5): gold questions per tagged row for a class × subject; zero rows highlighted; the
  list exports as a brief for the next Claude question batch (imported through the normal QR loop).

### 8.3 Lesson plans (OT-5)
**BUILT 2026-11-04** (branch `feat/objective-tree-ot5`, D-#949/#950): snapshot on `LessonDelivery` (fallback to the current plan), `lessonObjectiveStatus` + `LessonPlanForSlot.objectives`, `objectiveLesson(s)` on the mastery trail / student view.
- `session_plan` envelopes carry `tags.lo_codes` (tagged codes the session teaches; many allowed here — a lesson
  teaches several steps). Harness L3 checks each against the pattern; unknown codes warn.
- LP-1 marking (`LessonDelivery`) snapshots the plan's codes. Views gain per tagged row: taught on / not yet
  taught; students absent that day. The student evidence trail splits WEAK into "taught, not yet learnt" and
  "missed that class" (mock 6).
- Re-importing existing session plans with codes is content work (OT-6), done by Claude per subject after lock.

## §9 — Permissions and screens

New catalogue action under `mastery`: **`review`** — en "Review the objective list", bn "শিখনফল তালিকা
পর্যালোচনা", desc "Review an assigned draft: accept, edit, split, merge, reject, add, comment, submit", teacher
false, office false — per-person grant (Mahzabin). Lock and assign stay on `settings`. Register in
`permissionCatalogue.ts`, gate every resolver, add the legacy expansion row if a role name is introduced.

| Mock | Screen | Who | Slice |
|---|---|---|---|
| 1 | তালিকা ইমপোর্ট — tree preview: counts per level, coverage, flags | Principal | OT-1 |
| 2 | শিখনফল পর্যালোচনা — queue | Reviewer | OT-2 |
| 3 | উপ-শিখনফল / শিখনফল — row detail + actions | Reviewer | OT-2 |
| 4 | চূড়ান্ত করুন — decision counts, gate, lock | Principal | OT-2 |
| 5 | প্রশ্ন-ব্যাংক কভারেজ | Principal, reviewers, question authors | OT-4 |
| 6 | ক্লাস নোট — session's codes; শাখার অবস্থা per row | Teacher, Office | OT-5 |
| 7 | শিক্ষার্থী · বিষয় — domain heat strip, weak row, earlier step | Teacher, Principal | OT-3 |

## §10 — Acceptance (feeds tests)

1. **Structural verifier.** For a tree file: codes unique and match the patterns; every SUB's parent is an untagged
   OBJECTIVE; no objective has exactly one child; every tagged row cites ≥ 1 exercise; every prereq/domain
   resolves; `mapped + unmapped = exercisesTotal`. A file failing any check is refused by import with the rule
   and code named.
2. **Import round.** Importing C1 Math creates DRAFT rows (PROPOSED) and one OPEN round with the file's coverage;
   re-importing an unchanged file is a no-op; re-importing with one changed label returns only that row to
   PROPOSED and keeps every other decision.
3. **Split.** Splitting a tagged objective into two children makes it untagged with two tagged `.1`/`.2` rows;
   splitting into one child is refused; a later MERGE back leaves the objective tagged again.
4. **Gate.** Lock is refused while a comment is open or an unmapped exercise is unresolved; succeeds once both
   are cleared; after lock, renaming a code or deleting a row is refused, retire works.
5. **Permission.** A teacher without `mastery:review` cannot open the queue; Mahzabin with the grant but not
   assigned to C3 Math cannot write there; the Principal can assign and lock but review writes are logged
   under the Principal's name.
6. **Review log.** Every write adds exactly one append-only event (BULK_ACCEPT one per row); the export returns
   them in order with before/after.
7. **Level names.** Changing `objectiveBn` in পলিসি changes the review screen, student view, guardian view and
   the assignment PDF; no surface shows the old word.
8. **Roll-up.** Children WEAK + MASTERED ⇒ parent WEAK; all MASTERED ⇒ MASTERED; none assessed ⇒
   NOT_ASSESSED. A guardian payload contains objective codes/labels only.
9. **Earlier step.** A WEAK `07-03.2` with prerequisite `07-02.1` MASTERED shows "আগের ধাপ … আয়ত্তে".
10. **Bank.** After C1 Math locks, a question with two `lo_codes`, none, or an untagged code is refused; a
    stimulus + ক/খ pair with one code each imports and prints as 4(ক)/4(খ) on a work sheet.
11. **Lesson plan.** Marking a session plan with codes taught stores them; a student absent that day who is WEAK
    on one of them is shown as "missed that class".
12. **Switch.** A class × subject cannot be switched on until its round is LOCKED.

## §11 — Decisions (D-#921–#928) and what they amend

| D-# | Decision | Amends |
|---|---|---|
| D-#921 | Three-level tree: domain (school-wide per subject) → objective → sub-objective; codes `DOM-…`, `LO-…`, `LO-….N` | D-#776 shape |
| D-#922 | Split only when a child can fail apart; tagged-leaf rule; five drafting tests | — |
| D-#923 | Level names in one setting (পলিসি), default ক্ষেত্র · শিখনফল · উপ-শিখনফল; nothing hard-codes them | — |
| D-#924 | Claude drafts offline from the final print + full exercise coverage; Mahzabin reviews in the app (consults as needed); Principal locks behind a gate; append-only review log; decisions fed back to Claude; pilot C1 + C3 Math | prd-mastery §5.1 lock-by-file |
| D-#925 | Guardians see the objective grain only | D-#783 |
| D-#926 | One code per question; two skills ⇒ ক/খ parts (stimulus + one question per part) | D-#776 open point (§12.1) |
| D-#927 | Cross-class prerequisite ladder from the pilot | — |
| D-#928 | Once a class × subject is locked, a question without a valid tagged code is refused | D-#785 |

## §12 — Open

1. The domain list per subject is drafted by Claude (`domains/MATH.json` first); the owner/Mahzabin confirm it
   with the first locked class of that subject.
2. Whether Mahzabin reviews from the GitHub sheet before OT-2 ships (her call; decisions would then be entered in
   the app once it exists, or the file corrected and re-imported).
3. Class 5 scholarship topics (`TOP-…`) → tree codes: a one-time mapping when C5 is drafted (prd-mastery §11).
4. Books still to arrive: Islam, Arabic; Nursery/KG; C5 finals to confirm (Math v1; BGS/SCI have two versions).
