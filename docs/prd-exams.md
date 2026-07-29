# PRD — Exams, script custody chain & report cards (`exams` module)

**Status:** DRAFT (build contract) — planning 2026-07-28; **all seven §9 rulings ratified by the owner 2026-07-28** (no open blockers)
**Owner:** Principal
**Module:** `server/src/modules/exams` (new) — identity/operational plane, behind ADR-005 (no corpus path)
**Decisions:** **D-#375–#382** (landed 2026-07-28). *Drafting note: this PRD originally reserved D-#369–#378; a concurrent session landed D-#369–#374 first, so the range was re-checked against the live log and renumbered — the AGENTS rule-3 / parallel-worktree hazard, in practice.*
**Source evidence (owner, 2026-07-28):** six scanned class bundles (`Class One/Two/Three/Four/Five Combined`, `KG Combined`) = CT/Adab grids + per-subject checker/rechecker mark sheets; five generated report-card bundles (`Report_Cards_*.pdf`) for KG · One · Two · Four · Five · Three, session 2026, exam **Half Yearly-Sylhet**.

---

## §0 — At a glance / build order (read first)

- **What:** turn the school's paper exam cycle into an in-app pipeline, from question-paper prep to a published report card — **including the physical custody chain** (who handed how many questions/scripts to whom, and who acknowledged receiving them) at every stage: issue → invigilation → return of used scripts + unused questions → checking → rechecking → mark tabulation → mark rechecking.
- **Two halves, both required:**
  1. **Marks & report card** (EX-1..EX-5, EX-9) — the numbers on `Report_Cards_*.pdf`, computed by the app instead of by hand.
  2. **Custody chain** (EX-6..EX-8) — the accountability layer the owner asked for; every physical handover is a **two-signature event with a count**.
- **Backfill:** the 2026 Half-Yearly results already exist on paper. **EX-10** imports them as an immutable historical exam so trends/transcripts start with real history — with the custody chain **deliberately absent** (there was none to record).
- **Cut-over rule:** the next exam runs **fully in-app**. No parallel paper mark sheet is the goal; the scanned sheet becomes an attachment, not the record.
- **Plane:** identity/operational (marks are tied to a named student). **No corpus/analytics join** — ADR-005 firewall untouched, the fail-closed firewall test must stay green.
- **Contract surface:** app-native `/shared/vocab.ts` additions only — **no envelope/schema twin, no harness sync** (the D-#46/#52 pattern). Vocab verifier stays green.
- **Build order:** **EX-1** exam + paper + grade scale → **EX-2** duty/checker assignment → **EX-3** mark entry (checker) → **EX-4** recheck + tabulation → **EX-5** report-card compute → **EX-6** custody model + two-signature handover → **EX-7** custody per stage + reconciliation → **EX-8** custody dashboard/exceptions → **EX-9** report-card PDF + approve/publish + guardian → **EX-10** backfill of 2026 Half-Yearly.

---

## §1 — Goal

One exam record per term that (a) proves where every question paper and answer script physically was and who signed for it, and (b) produces the report card the school already issues — arithmetic, grading and the class "highest marks" column computed, not hand-totalled on a photocopied sheet.

Two failure modes this closes, both visible in the source scans:
- **Custody is untraceable.** The checker/rechecker sheets carry names and signatures but no counts, no issue/return record, and no way to answer "how many scripts went out, how many came back".
- **Arithmetic is manual and drifts.** Marks are converted between paper scales by hand in the margin (`৬৬/৮০`, `90/100`, `Convert to`), re-copied into a second column, then totalled — a chain of transcriptions with no check.

## §2 — Gap table

| Area | Current (`main`, 2026-07-28) | Desired |
|---|---|---|
| Term exam record | **None.** Only `ClassTest` (per-lesson CT, CT-1..CT-10). | `Exam` + `ExamPaper` per class × subject (EX-1). |
| Grade scale / GPA | None. | `GradeScale` rows, GPA derived on read (EX-1/EX-5). |
| Mark entry | Paper sheet → hand-tabulated. | Checker enters in-app against a roster (EX-3). |
| Recheck | Second hand-written column on the same sheet. | Independent rechecker pass with divergence flags (EX-4). |
| Paper-scale conversion | Hand arithmetic in the margin. | Stored `paperFullMarks` → derived converted mark (EX-3). |
| Custody of questions/scripts | **Nothing recorded.** | `ExamCustodyEvent` — count + two signatures per handover (EX-6/7). |
| Reconciliation | None. | Issued = used + unused-returned, enforced per stage (EX-7). |
| Report card | Produced outside the app. | Rendered from stored marks, approved, published (EX-5/EX-9). |
| Guardian access | Paper handed over at a meeting. | Published report card in the guardian portal (EX-9). |
| History | Paper only. | 2026 Half-Yearly backfilled (EX-10). |

## §3 — Reused / unchanged (do not rebuild)

`Student` (`schoolId` = the printed **ID** column; `rollNumber`; `classId`/`sectionId`) · `Class` / `Section` (D-#1) · `Subject` / `FOUNDATION_SUBJECTS` and `ROUTINE_SUBJECTS` (D-#54, supplies ARABIC/ISLAM/QURAN which the report card needs and `SUBJECTS` alone does not) · `AcademicYear` (`label` = the printed **Session**) · `ROSTER_CLASS_LEVELS` −1..5 (KG=0, Nursery=−1 — the report card's Class column) · single `TEACHER` role plus **per-paper assignment rows** (the classroom-observation pattern: assign, never invent a role) · `assertCanRead`/`assertCanWrite` + `roster:manage` · `writeAudit` on every transition (ADR-008) · `StoredFile` + `GET /files/:id` kind-dispatched read gate (scan attachments) · the `GET /pdf/set/:id` on-demand renderer pattern (report-card PDF) · `bestEffort` notification emitters · `PrintRequest` (PQ-1..PQ-6) for actually **printing** the question papers — the exam module references a print request, it does not re-implement printing · guardian linkage + `guardian:read_child`.

## §4 — New vocabulary (app-native, `/shared/vocab.ts`; BN labels + English codes)

> App-native only; **no envelope twin, no three-place sync.** Verifier asserts presence + BN/EN label coverage (both maps — the HR/finance precedent).

- `EXAM_TERMS = [HALF_YEARLY, ANNUAL]` — অর্ধ-বার্ষিক / বার্ষিক. (The scans say `অর্ধ-বার্ষিক`; `ANNUAL` is added now so the year closes without a schema change.)
- `EXAM_STATUSES = [PLANNED, IN_PROGRESS, MARKING, TABULATED, APPROVED, PUBLISHED, ARCHIVED]`.
- `EXAM_COMPONENTS = [CT, ADAB, FINAL]` — শ্রেণি পরীক্ষা / আদব / সেমিস্টার ফাইনাল. Maps 1:1 onto the report card's **CT · Performance · Semester Final** columns. ("Performance" on the English transcript is the **Adab** mark from the `CT/Adab Marks` grid — same number, two names; the app uses one code and prints whichever label the card asks for.)
- `MARK_ENTRY_STATUSES = [PRESENT, ABSENT]` — the printed `Ab` / `A`.
- `CUSTODY_STAGES = [QUESTION_ISSUE, QUESTION_RETURN_UNUSED, SCRIPT_RETURN, CHECK_ISSUE, CHECK_RETURN, RECHECK_ISSUE, RECHECK_RETURN, TABULATION_ISSUE, TABULATION_RETURN, MARK_RECHECK_ISSUE, MARK_RECHECK_RETURN, ARCHIVE]`.
- `CUSTODY_ITEM_KINDS = [QUESTION_PAPER, BLANK_SCRIPT, ANSWER_SCRIPT, MARK_SHEET]`.
- `CUSTODY_EVENT_STATUSES = [PENDING_ACK, ACKNOWLEDGED, DISPUTED, CANCELLED]`.
- `EXAM_DUTY_ROLES = [INVIGILATOR, CHECKER, RECHECKER, TABULATOR, MARK_RECHECKER]` — assignment rows, **not** `ROLES` entries.
- `CT_AGGREGATION_MODES = [MEAN, BEST_N]` — গড় / সেরা কয়টি (§9.2).
- `GRADE_LETTERS = [A_PLUS, A, A_MINUS, B, C, F]` with display `A+ · A · A- · B · C · F`.
- Permissions: `exam:manage` (PRINCIPAL, OFFICE) · `exam:custody` (PRINCIPAL, OFFICE + any user named on a custody event) · `exam:mark` (assigned CHECKER/RECHECKER/TABULATOR) · `exam:read` (row-scoped staff read). **Guardian reads through the existing `guardian:read_child`** — no new guardian permission.

## §5 — The data the source documents pin down

Everything in this section is **derived from the attached scans + generated cards** and is reproduced here so the build has one place to check against. The seven inferences that needed ratifying were answered by the owner on **2026-07-28** and are folded in below; §9 records the answers.

### 5.1 Grade scale (printed on every card, identical across all classes)

| Letter | Point | Marks range |
|---|---|---|
| A+ | 5 | 80–100% |
| A | 4 | 70–79% |
| A- | 3.5 | 60–69% |
| B | 3 | 50–59% |
| C | 2 | 40–49% |
| F | 0 | 0–39% |

Stored as `GradeScale` **rows keyed to the exam**, not hardcoded — a future year may re-band without a code change.

### 5.2 Component structure differs by class band

| Band | Subjects | Components | Full marks |
|---|---|---|---|
| **Nursery** (−1) | Bangla, English, Math, Arabic, Quran (5) | **FINAL /100 only** — no CT, no Adab (ratified §9.4) | 500 |
| **KG** (0) | Bangla, English, Math, Quran, Arabic (5) | **ADAB /10 + FINAL /90** — *no CT column* | 500 |
| **One, Two** | Islam, Bangla, English, Mathematics, Arabic, Quran (6) | CT /10 + ADAB /10 + FINAL /80 | 600 |
| **Three, Four, Five** | the six above + BGS, Science (8) | CT /10 + ADAB /10 + FINAL /80 | 800 |

Verified against the cards: KG Musa Bangla `9 + 80 = 89`; KG Humayra Math `10 + 90 = 100`; One Yusuf Islam `7 + 8 + 52 = 67`; Three Umair Islam `7 + 6 + 55 = 68`. Therefore **`obtainedMarks = Σ components`**.

**Composition is configured PER PAPER, not per class band** (ratified §9.3). The band table above is the common case, not a rule the model may assume: **Class 3 Mathematics genuinely had no CT** this cycle, so that one paper carries `ADAB /10 + FINAL /90` while its seven siblings carry the three-component shape. A per-band constant would have silently forced a zero into ~16 report cards. Three distinct shapes therefore ship on day one — 1-component (Nursery), 2-component (KG, C3 Math), 3-component (everything else) — which is the strongest argument for keeping `components[]` on `ExamPaper`.

**Nursery is examined, FINAL only** (ratified §9.4), over **the same five subjects as KG** — Bangla, English, Math, Arabic, Quran — for a **500** total. No Nursery report cards exist for 2026 Half-Yearly, so EX-10 imports none; but EX-1 must accept a single-component paper from the start rather than treat `components.length === 1` as a validation error.

Note that Nursery and KG share a subject list but **not** a component shape (KG adds ADAB /10 and drops FINAL to /90). That is precisely why composition is keyed to the paper and not to the subject set — a `subjects → components` lookup would collapse these two bands into one and put an Adab column on a Nursery card.

### 5.3 Paper-scale conversion is a first-class field, not margin arithmetic

The checker sheets carry raw marks against **varying paper totals** — `৬৬/৮০`, `84/100`, `৯২/২০০`, with a hand-written `Convert to` column beside them (Class Three Quran/Arabic; Class Four Arabic/Quran; Class Five). So:

```
convertedFinal = round( rawMark / paperFullMarks × component.maxMarks , 0.5 )
```

`paperFullMarks` lives on `ExamPaper`; the converted value is **derived on read, never stored** (the D-#85 house rule).

**Rounding = nearest 0.5** (ratified §9.1) — `round(x * 2) / 2`, half-up on an exact `.25`/`.75` tie. This matches the half-marks all over the source (`87.5`, `57½`, `29.5`, `69½`) and must be implemented as **one shared helper used by both the marking screen's live preview and the report-card renderer** — two independent rounding sites is how the printed card and the on-screen figure drift apart.

### 5.4 GPA and the fail rule

- Subject grade point = band of `obtainedMarks` against the scale in §5.1.
- **Overall GPA = arithmetic mean of the subject grade points, rounded to 2 dp.** Verified: KG Musa `(5+5+5+4+5)/5 = 4.80` ✓ · Asila `4.60` ✓ · Barakah `(4+5+5+3.5+5)/5 = 4.50` ✓ · Afra `3.90` ✓ · Abdullah Mutammim `3.00` ✓.
- **Any subject graded F forces overall `0.00 / F`,** regardless of total. Verified: Wafiq (Bangla F) → `0.00 F` at 235/500; Rehana Bint Mustafa (Math F) → `0.00 F` at **552/800**, which would otherwise be a strong A. Reham → `0.00 F` at 484/800.
- Overall **letter** bands the *rounded GPA* on the same table: `4.80 → A`, `3.90 → A-`, `3.17 → B`, `5.00 → A+`.

### 5.5 "Highest Marks" is a cohort maximum, derived

The card's `Highest Marks` column is `max(obtainedMarks)` for that **subject within that class** across the exam (KG Bangla `96` = Mubashshira's 96). Derived at render time — it changes if any mark is corrected, so storing it would guarantee drift.

### 5.6 Absence is per component, not per student

`Ab` appears in a single `Semester Final` cell while the same row still carries CT and Adab marks — Azraf Bin Iman, Arabic: `Perf 6 · Final Ab · Obtained 6 · F`. The CT/Adab grid uses a bare `A` (Khadija `A/8`, Muhaiminul `A/6`). So `MARK_ENTRY_STATUSES` is stored **per (student × paper × component)**; an absent component contributes `0` to the total but is rendered `Ab`, and the student is **not** excluded from the subject's cohort denominators.

### 5.7 Identity fields the card prints

`ID` = `Student.schoolId` (note the source mixes zero-padded `0044` and bare `104` — the app prints the stored string verbatim, it does not normalise) · `Name` · `Session` = `AcademicYear.label` · `Class` = `ROSTER_CLASS_LABELS`.

**`Branch` = "Sylhet Branch"` and `Shift` = "Day"` are school-profile constants** (ratified §9.5) — neither becomes a model field now. But the owner has flagged that **shift may genuinely vary later, and real sections may be added**, so the renderer must read both from **one config object it is passed**, never inline the two strings into the card template. Promoting `shift` to a `Student` field later then touches the resolver that builds that object and nothing else.

**Sections are already modelled** (`Section`, `DEFAULT_SECTION_CODE = "Main"`, D-#1) and `ExamPaper.sectionId` is optional from EX-1 — so a future split into real sections needs no migration of exam data: a section-less paper means "the whole class", exactly as today.

### 5.8 Two identity defects in the source, which the backfill must not import

- **Duplicate `schoolId` 0073** — the KG Bangla/English sheets list `Azraf Bin Iman` twice at row 08 and 09, row 09 struck through and rewritten `Barakah Binte Habib`; the Arabic sheet corrects it to `0079`. The generated cards already show `0073 Azraf` and `0079 Barakah` correctly.
- **Three struck-through duplicate rows** at the foot of the KG CT/Adab grid (Musa, Abdullah, Afra), crossed out on the page.

EX-10 must reconcile against the live roster by `schoolId` and **halt on any unmatched or duplicate row** rather than guess.

---

## §6 — Slices

### EX-1 — Exam, papers, grade scale
**Models.**
```
Exam            { academicYearId, term∈EXAM_TERMS, name ("Half Yearly-Sylhet"),
                  status∈EXAM_STATUSES, startDateKey, endDateKey,
                  gradeScale:[{letter, point, minPercent, maxPercent}],
                  failRule:"ANY_SUBJECT_F"  (§5.4),
                  ctAggregation:{mode∈CT_AGGREGATION_MODES, bestN?},    // §9.2
                  createdBy/At }
ExamPaper       { examId, classId, sectionId?, subject∈ROUTINE_SUBJECTS,
                  components:[{component∈EXAM_COMPONENTS, maxMarks}],   // §5.2 — PER PAPER
                  paperFullMarks,                                       // §5.3
                  ctAggregationOverride?,                               // §9.2
                  examDateKey?, printRequestId?,                        // reuses PQ
                  questionsPrintedCount? }
```
`Σ components.maxMarks` must equal 100 per paper (model-level guard) — that holds for all three shapes, including Nursery's lone `FINAL /100`. One `ExamPaper` per (exam × class × subject) — unique index.

**Each term stands alone** (ratified §9.7): the annual exam carries **nothing** forward from the half-yearly — no weighting, no cumulative GPA. Two `Exam` rows in one `AcademicYear` are simply independent. This is a deliberate non-feature; do not add a combined transcript without a new decision.
**Acceptance:** [ ] a KG paper with no CT component is valid; [ ] a **single-component** Nursery paper is valid (`components.length === 1` is not an error); [ ] a paper whose components don't sum to 100 is refused; [ ] the grade scale round-trips per exam; [ ] an annual exam computes with no reference to the half-yearly row; [ ] every transition audited.

### EX-2 — Duty & marking assignments
`ExamAssignment { examId, paperId?, userId, role∈EXAM_DUTY_ROLES, assignedBy/At }`. Paper-less rows cover exam-wide duty (an invigilator on a date). **Guards:** a CHECKER and the RECHECKER of the same paper must be **different people** (the source sheets already name two distinct teachers); a teacher may check a paper they invigilated.
**Acceptance:** [ ] checker ≠ rechecker per paper (refused otherwise); [ ] assignment drives every `exam:mark` gate — there is no free-for-all mark entry.

### EX-3 — Mark entry (checker pass)
`ExamMark { examId, paperId, studentId, component, status∈MARK_ENTRY_STATUSES, rawMark?, enteredBy, enteredAt }` — unique on `(paperId, studentId, component)`.
- **FINAL** rows are entered against `paperFullMarks`; the converted value is derived (§5.3) and shown live beside the raw entry so the checker sees what will print.
- **CT rows are NOT hand-entered where the tracker already has them.** The `ClassTest` module (CT-1..CT-10) records every class test with marks per student. EX-3 offers **"pull CT from the tracker"** — the term's tracker results for that class × subject, scaled to the /10 component.
  **Both aggregation modes ship** (ratified §9.2): `CT_AGGREGATION_MODES = [MEAN, BEST_N]` — mean of every class test in the term, or the mean of the student's best *N* (`bestN` configurable, default 3). Set on the `Exam`, **overridable per paper**, and shown on the entry screen as *"CT pulled: best 3 of 5 · 8.5/10"* so the checker can see which rule produced the number. A manual override of any pulled value is allowed and stamps `overrideReason` + `enteredBy`.
  A student with **no** tracker results for that subject yields a **blank, not a zero** — the C3-Maths lesson (§5.2) applies to individuals too.
- **ADAB** is a new per-term judgement (/10), always hand-entered, and **owned by the subject teacher** (ratified §9.6) — not the class teacher. So the Adab entry grid is scoped per `ExamPaper` to whoever holds that class × subject in the routine, which is the same gate CT-1 already uses; the class teacher has no special write path to it.
- Entry screen is a **roster grid**, one row per student in `schoolId` order, matching the paper sheet the checker is reading from, so transcription is line-for-line.
**Acceptance:** [ ] one row per student × component; [ ] `rawMark ≤ paperFullMarks`; [ ] ABSENT carries no mark and prints `Ab`; [ ] the converted mark is never stored and rounds to nearest 0.5 via the one shared helper (§5.3); [ ] `MEAN` and `BEST_N` both produce the documented figure on a fixture, and the paper-level override beats the exam setting; [ ] a student with no tracker results pulls **blank, never 0**; [ ] Adab entry is refused for a teacher who does not hold that class × subject; [ ] a non-assigned teacher is refused everywhere else.

### EX-4 — Recheck + tabulation
The rechecker enters an **independent** value per student without seeing the checker's figure until submitted (the source sheets are two parallel columns; the app enforces the independence the paper cannot). On submit, a **divergence report** lists every student where checker ≠ rechecker; each must be resolved to a single agreed mark with a resolver stamp. Then TABULATOR locks the paper (`MARKING → TABULATED`), and MARK_RECHECKER verifies the tabulated totals.
**Acceptance:** [ ] rechecker cannot see the checker's mark before submitting their own; [ ] every divergence is explicitly resolved before the paper can be tabulated; [ ] a tabulated paper is edit-locked (re-open is an audited, `exam:manage` action).

### EX-5 — Report-card computation
Pure derivation, nothing new stored: per subject `obtained = Σ components` → grade point/letter (§5.1); `highest` = cohort max (§5.5); `total`, `GPA`, overall letter, with the **any-F rule** (§5.4). Plus `schoolComment` — a free-text per (exam × student) with a suggestion list drawn from the phrasings already in use ("Excellent! Keep it up.", "Bangla and Math need more emphasis in the second half.").
**Acceptance:** [ ] recomputing the backfilled 2026 Half-Yearly from its component marks reproduces **every** printed `Obtained / Highest / Grade Point / Letter / Total / GPA` cell — this is the regression test for the whole module; [ ] a student with an F in one subject shows GPA `0.00 / F`.

### EX-6 — Custody model + the two-signature handover *(the owner's core ask)*
```
ExamCustodyEvent {
  examId, paperId?,                       // paper-less = an exam-wide movement
  stage∈CUSTODY_STAGES, itemKind∈CUSTODY_ITEM_KINDS,
  fromUserId, toUserId,
  declaredCount,                          // what the giver says they handed over
  countedCount?,                          // what the receiver actually counted
  status∈CUSTODY_EVENT_STATUSES,
  handedOverAt, handedOverBy,             // giver's signature
  acknowledgedAt?, acknowledgedBy?,       // receiver's signature
  discrepancyNote?, attachmentFileIds?[], // photo of the sheet / bundle
  createdBy/At }
```
**The rule:** a handover is **created by the giver** (`PENDING_ACK`) and **only the named receiver can acknowledge it**. Acknowledging with `countedCount === declaredCount` → `ACKNOWLEDGED`. Acknowledging with a different count → **`DISPUTED`**, which is a valid terminal state carrying both numbers and a mandatory note — the app never silently overwrites one person's count with the other's. A `PENDING_ACK` event may be cancelled by its creator; an acknowledged one may not.
**Acceptance:** [ ] a third party cannot acknowledge; [ ] a mismatch stores **both** counts and forces a note; [ ] a giver cannot acknowledge their own handover; [ ] every event audited with both user ids.

### EX-7 — The stages, wired to the real workflow + reconciliation
The owner's described flow maps onto `CUSTODY_STAGES` as:

| # | Real-world step | Stage | Item | From → To |
|---|---|---|---|---|
| 1 | Office prints & counts papers | `QUESTION_ISSUE` | QUESTION_PAPER | Office → Invigilator |
| 2 | Blank scripts issued | `QUESTION_ISSUE` | BLANK_SCRIPT | Office → Invigilator |
| 3 | Invigilator returns **used scripts** | `SCRIPT_RETURN` | ANSWER_SCRIPT | Invigilator → Office |
| 4 | Invigilator returns **unused questions** | `QUESTION_RETURN_UNUSED` | QUESTION_PAPER | Invigilator → Office |
| 5 | Scripts out to the checker | `CHECK_ISSUE` | ANSWER_SCRIPT | Office → Checker |
| 6 | Checker returns marked scripts | `CHECK_RETURN` | ANSWER_SCRIPT | Checker → Office |
| 7–8 | Same pair for the rechecker | `RECHECK_ISSUE` / `RECHECK_RETURN` | ANSWER_SCRIPT | Office ↔ Rechecker |
| 9–10 | Mark sheet out and back for tabulation | `TABULATION_ISSUE` / `TABULATION_RETURN` | MARK_SHEET | Office ↔ Tabulator |
| 11–12 | Mark rechecking | `MARK_RECHECK_ISSUE` / `MARK_RECHECK_RETURN` | MARK_SHEET | Office ↔ Mark-rechecker |
| 13 | Scripts filed | `ARCHIVE` | ANSWER_SCRIPT | Office → store |

**Reconciliation invariants**, computed per paper and shown as a live balance:
- `QUESTION_ISSUE(count) = studentsPresent + QUESTION_RETURN_UNUSED(count) + spoiled`
- `SCRIPT_RETURN(count) = studentsPresent` (attendance for that paper is the expected script count)
- `CHECK_ISSUE = CHECK_RETURN`, `RECHECK_ISSUE = RECHECK_RETURN`
A stage may be started while the previous one is unbalanced, but the paper **cannot reach `TABULATED` with an open imbalance or an unresolved `DISPUTED` event** — that is the gate that makes the chain worth keeping.
**Acceptance:** [ ] each of the 13 steps is recordable with a count and two signatures; [ ] the balance line is derived, never stored; [ ] tabulation is blocked by an imbalance or an unresolved dispute, with the reason named on screen; [ ] present-count comes from the exam's own attendance, not a typed number.

### EX-8 — Custody dashboard & exceptions (Office)
One board per exam: rows = papers, columns = the 13 stages, each cell showing ✓ / count / ⚠. Plus a **"waiting on you"** list per teacher (handovers awaiting their acknowledgement) and an **exceptions** list (disputed, imbalanced, or sitting `PENDING_ACK` beyond a configurable interval). Notifications on issue (`EXAM_CUSTODY_HANDOVER` to the receiver) and on dispute (`EXAM_CUSTODY_DISPUTED` to `exam:manage`) — best-effort emitters, never blocking the mutation.
**Acceptance:** [ ] the board shows every paper's chain state at a glance; [ ] a receiver sees their pending acknowledgements without hunting; [ ] stale `PENDING_ACK` surfaces after the configured interval.

### EX-9 — Report-card PDF, approval gate, guardian release
Mirrors the ratified CT-8 / CO-8 pattern rather than inventing a third shape: TABULATED → **teacher/tabulator submits** → **Office or Principal approves** (`exam:manage`, either, per D-A) → `PUBLISHED` sets `publishedAt`, which is the guardian-visible predicate. Send-back carries a reason and returns the exam to `MARKING`.
- `GET /pdf/report-card/:examId/:studentId` — single card, and `GET /pdf/report-card/:examId?classId=` — the **class bundle**, which is exactly what `Report_Cards_*.pdf` is today.
- Layout reproduces the current card: header, student block, grade reference, subject table with the band's component columns, `Total/GPA` row, `Comment from School`, `Principal's Signature` rule.
- Guardian sees the published card in the portal under the existing `guardian:read_child` gate; **an unpublished or sent-back card is invisible to the guardian** and the PDF route refuses it.
**Acceptance:** [ ] a class bundle renders in `schoolId` order and is byte-for-byte comparable in content to the 2026 bundles; [ ] guardian cannot reach an unapproved card by any route; [ ] approve/send-back/re-publish all audited; [ ] a re-publish after a correction bumps a version so the guardian is re-notified.

### EX-10 — Backfill: 2026 Half-Yearly (KG · One · Two · Three · Four · Five)
A one-off, **re-runnable, idempotent** script under `server/scripts/`, not a UI import.
- **Source of truth = the generated report cards**, not the handwritten sheets: they are the values the school actually issued, and they are already reconciled. Component marks (CT / Performance / Semester Final) are read per subject per student, so §5.5/§5.4 recompute from them.
- **70 students** across six classes (KG 12 · One 7 · Two 14 · Three 17 · Four 12 · Five 8). Nursery: none.
- Matched to the roster by `schoolId`; **halts** on any unmatched, duplicate, or ambiguous row (§5.8) and prints the offending rows rather than guessing.
- Written with `Exam.status = ARCHIVED`, `source: "BACKFILL_2026_HY"`, **no custody events**, and marked non-editable through the normal marking UI.
- The scanned bundles are attached as `StoredFile`s on the exam for provenance.
- **Class 3 Mathematics is configured with no CT component at all** (ratified §9.3 — the test genuinely was not taken). It is therefore not a tolerated gap in the diff but a **2-component paper** (`ADAB /10 + FINAL /90`), and the diff runs strict against it like every other paper. Affected cards: Umair, Suraya, Juairiya, Rahma, Abdul Muiz, Ayesha, Zainab, Hamza, Nusaibah, Afizah, Juwairiya, Mabrur, Yousuf, Aieman, Dewan, Muhaiminul.
- **Verification gate:** the script re-derives every card and **diffs against the printed values**; a non-empty diff fails the run. No tolerances — every cell must reproduce.
- **Nursery:** no rows (no 2026 Half-Yearly Nursery cards exist), even though Nursery is examined going forward (§5.2).
**Acceptance:** [ ] re-running changes nothing; [ ] every printed `Obtained/Highest/GPA/Letter` reproduces exactly, or the run fails loudly; [ ] the roster mismatch halt fires on a deliberately corrupted fixture; [ ] backfilled rows are read-only in the app.

---

## §7 — Given/When/Then journeys

1. **Prepare & issue.** *Given* an exam with papers, *when* Office records `QUESTION_ISSUE` of 14 papers to the invigilator, *then* the invigilator gets a pending acknowledgement and nothing is "issued" until they confirm the count.
2. **Count mismatch.** *Given* a handover declared as 14, *when* the invigilator counts 13, *then* the event is `DISPUTED` with both numbers and a mandatory note, and the paper cannot be tabulated until it is resolved.
3. **Return.** *Given* an exam sat by 12 students, *when* the invigilator returns 12 scripts and 2 unused questions, *then* the balance line reads `14 = 12 + 2` and shows green.
4. **Check.** *Given* scripts issued to a checker, *when* the checker enters marks against the roster grid, *then* the converted mark is shown live and the raw mark is stored against the paper's own full marks.
5. **Recheck.** *Given* a checked paper, *when* the rechecker enters their own marks, *then* they never see the checker's figure first, and every divergence must be resolved by a named person.
6. **Publish.** *Given* a tabulated exam, *when* the Principal approves, *then* the report card becomes visible to the guardian and the class PDF bundle renders.
7. **Guardian.** *Given* a published card, *when* a guardian opens their child, *then* they see the transcript; *given* an unpublished one, they see nothing and the PDF route refuses.
8. **History.** *Given* the backfilled 2026 Half-Yearly, *when* a teacher opens a student profile, *then* the half-yearly result sits alongside the class-test trend with no custody chain shown (there was none).

## §8 — Out of scope

Annual promotion / pass-fail progression decisions · merit position / class rank on the card (the card carries `Highest Marks`, not a rank — do not add one unasked) · question-paper **authoring** (the QuestionBank + `AssessmentSet` modules already do this; an exam paper references a print request) · fee-clearance gating of results · SMS/WhatsApp result delivery (the guardian portal + existing notification transport only) · a `branch` dimension on Student (§5.7 — school-profile constant until the school is genuinely multi-branch) · OCR of the scanned sheets (EX-10 is a transcription of the *generated* cards, and the scans are attachments) · any corpus-plane join (ADR-005).

## §9 — Owner rulings (ratified 2026-07-28) — nothing here is open

| # | Question | Ruling | Lands in |
|---|---|---|---|
| 9.1 | Rounding for paper-scale conversion | **Nearest 0.5**, one shared helper for screen + PDF | §5.3, EX-3, EX-5 |
| 9.2 | CT aggregation from the tracker | **Keep both** — `MEAN` and `BEST_N` (default N=3), set on `Exam`, overridable per paper | §6 EX-1, EX-3 |
| 9.3 | Class 3 Mathematics CT | **Genuinely not taken** → composition moves to **per paper**; C3 Maths is a real 2-component paper, diffed strictly | §5.2, EX-1, EX-10 |
| 9.4 | Nursery | **Examined — FINAL component only**; single-component papers valid from EX-1 | §5.2, EX-1 |
| 9.5 | Branch / Shift | **Constants for now**; shift may vary later and sections may be added → renderer takes a config object, `ExamPaper.sectionId` optional from day one | §5.7, EX-1, EX-9 |
| 9.6 | Adab (/10) owner | **Subject teacher**, not the class teacher — gated by class × subject like CT-1 | EX-3 |
| 9.7 | Annual exam | **Stands alone** — no carry-forward, no weighting, no cumulative GPA | EX-1 |
| 9.8 | Nursery subject list | **Bangla, English, Math, Arabic, Quran (5)** — same as KG — FINAL /100 each, **500** total | §5.2 |

**Two consequences worth restating**, because they changed the shape of the build rather than just filling a blank:

- **9.3 killed the class-band constant.** Component composition is now per `ExamPaper`, and three shapes ship on day one (1 / 2 / 3 components). Had this been a per-band lookup, importing Class 3 Maths would have written a silent `0` CT into sixteen students' cards and dragged each of their subject grades down a band.
- **9.4 + 9.5 are the cheap-now/expensive-later pair.** Accepting a one-component paper and passing branch/shift as config costs nothing today; retrofitting either after a year of exam data is a migration.

**Nothing is outstanding.** Every input this contract needs is ratified; EX-1..EX-10 can be built without a further owner round-trip.

## §10 — Traceability

Reuses D-#1 (default section) · D-#31 (roster fields) · D-#46/#52 (app-native vocab, no wire twin; deferred push) · D-#54 (`ROUTINE_SUBJECTS` incl. QURAN/ARABIC/ISLAM) · D-#67 (roll ≠ schoolId) · D-#85 (derive, never store) · D-#121/#158 (`ClassTestResult` shape) · D-#145 (no `schoolId` field on new models — single school) · D-#277 / CT-8 D-A (per-exam approve, send-back reason, either admin) · D-#271 / CO-8 (publish gate as an additive `publishedAt`, not a new state) · D-#281 / PQ-1..6 (`PrintRequest` is the only print queue) · D-#366 (never silently self-assign an accountable teacher — EX-2 refuses instead) · ADR-005 (firewall) · ADR-008 (audit). **New: D-#375–#382** (landed 2026-07-28) — D-#375 module + custody ask · **D-#376 per-paper composition** · D-#377 grading arithmetic · D-#378 CT pull + Adab ownership · D-#379 branch/shift as config · D-#380 terms stand alone · D-#381 backfill policy · **D-#382 two-signature custody**. Vocab: `EXAM_TERMS`, `EXAM_STATUSES`, `EXAM_COMPONENTS`, `MARK_ENTRY_STATUSES`, `CUSTODY_STAGES`, `CUSTODY_ITEM_KINDS`, `CUSTODY_EVENT_STATUSES`, `EXAM_DUTY_ROLES`, `CT_AGGREGATION_MODES`, `GRADE_LETTERS`, `exam:{manage,custody,mark,read}`.

**Owner rulings 2026-07-28** (§9.1–9.7) are the substance of the reserved decision range: rounding-to-0.5 · both CT aggregation modes · per-paper composition · Nursery FINAL-only · branch/shift as constants · Adab owned by the subject teacher · annual stands alone.
