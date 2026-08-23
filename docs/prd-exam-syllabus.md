# PRD — Exam syllabus, mark distribution & question types (`exams` module, slices SY-1..SY-6)

**Status:** BUILD CONTRACT — owner rulings ratified 2026-08-23; no open blockers
**Owner:** Principal
**Module:** `server/src/modules/exams` (new) — identity/operational plane, behind ADR-005 (no corpus path)
**Decisions:** **D-#527–#532** (reserved 2026-08-23, pre-flighted against `origin/dev` @ `26a7e0e`, live max was D-#526)
**Source evidence:** owner's *Annual Exam Syllabus 2026 (SCD Sylhet)* — Nursery → Class 5, one table per class, one row per subject, carrying syllabus prose + a numbered mark distribution + a per-class question-type footer.

---

## §0 — At a glance

- **What:** the printed exam-syllabus handout becomes an app record. Office types one syllabus per **exam × class × subject**; the **subject teacher signs it off**; the **Principal publishes it**; guardians and all teachers read it and can print it.
- **Three things per subject, not one:** the prose (`bodyMd`), the **mark distribution** (`marks[]`, summing to 100), and the **question types** (`questionTypes[]`).
- **Relationship to `docs/prd-exams.md`:** this is the same `exams` module, landed **first**. SY-1 creates the minimal `Exam` row that EX-1 later *extends* — there must never be two competing exam records. Nothing here depends on EX-1..EX-10 being built.
- **Plane:** identity/operational. **No corpus/analytics join** — ADR-005 firewall untouched, the fail-closed firewall test must stay green.
- **Contract surface:** app-native `/shared/vocab.ts` additions only — **no envelope/schema twin, no harness sync** (the D-#46/#52 routine/HR pattern). Vocab verifier stays green.
- **Build order:** SY-1 vocab + `Exam` → SY-2 `ExamSyllabus` + Σ guard → SY-3 state machine + approver lookup → SY-4 Office entry → SY-5 teacher sign-off + Principal publish → SY-6 read screen + guardian + PDF.

## §1 — Goal

One syllabus record per exam × class × subject that (a) reaches a guardian's phone instead of a photocopier, (b) states how the 100 marks are split before the exam rather than after it, and (c) has been checked by the person who actually teaches the subject.

Three failure modes this closes:

- **The handout is the only copy.** A parent who loses the sheet has no way back to it; a teacher joining mid-term has no record of what was set.
- **Nobody checks feasibility.** The syllabus is typed in the office from last year's file. The person who knows whether Class 4 Bangla will actually reach *চারদিকে দেখি* by 11 December never sees it before it is handed out.
- **The mark split is invisible until the paper.** Parents and students learn the weighting when they open the question paper.

## §2 — Gap table

| Area | Current (`origin/dev`, 2026-08-23) | Desired |
|---|---|---|
| Exam record | **None.** `prd-exams.md` is planned, unbuilt; no `exams` module on disk. | Minimal `Exam` row (SY-1), extended later by EX-1. |
| Syllabus | A Word table, photocopied. | `ExamSyllabus` per exam × class × subject (SY-2). |
| Mark distribution | Hand-typed into the same Word cell. | `marks[]` rows, Σ = 100 enforced (SY-2). |
| Question types | A per-class footer line. | `questionTypes[]`, app-native codes (SY-1/2). |
| Feasibility check | None — office to photocopier. | Subject-teacher sign-off, routine-derived (SY-3/5). |
| Release control | None. | Principal publish; `publishedAt` is the guardian predicate (SY-3/5). |
| Guardian access | Paper, if the child brings it home. | Read + PDF in the portal (SY-6). |

## §3 — Reused / unchanged (do not rebuild)

`Class` / `Section` (D-#1) · `Subject` / `ROUTINE_SUBJECTS` (D-#54 — supplies ARABIC/ISLAM/QURAN, which `SUBJECTS` alone does not) · `AcademicYear` · `ROSTER_CLASS_LEVELS` −1..5 · `RoutineSlot` as the authority on who teaches what · **`teachingNoteVisibility()` / `myTeachingNoteScope()`** in `TeachingNoteService.ts` (D-#521) for the routine+grant pair walk · `assertCanRead`/`assertCanWrite` · `writeAudit` on every transition (ADR-008) · the `/pdf` router mount (already in the VM Caddy allowlist — **no Caddyfile change**) · `guardian:read_child` for the guardian gate · `bestEffort` notification emitters · the mojibake guard shape from D-#523.

## §4 — New vocabulary (app-native, `/shared/vocab.ts`)

> App-native only; **no envelope twin, no three-place sync** (D-#46/#52). Verifier asserts presence + BN/EN label coverage on both maps.

- `SYLLABUS_STATUSES = [DRAFT, TEACHER_REVIEW, PRINCIPAL_REVIEW, PUBLISHED]` — খসড়া / শিক্ষকের অনুমোদনে / প্রধান শিক্ষকের অনুমোদনে / প্রকাশিত.
- `SYLLABUS_ITEM_TYPES = [mcq, short_answer, true_false, fill_blank, matching, descriptive, creative, oral, practical, other]` — the exercise family a mark row belongs to.
- `EXAM_TERMS = [HALF_YEARLY, ANNUAL]` — অর্ধ-বার্ষিক / বার্ষিক. *(Also specified by `prd-exams.md` §4; landed here first, unchanged.)*
- `EXAM_COMPONENTS = [CT, ADAB, FINAL]` — শ্রেণি পরীক্ষা / আদব / সেমিস্টার ফাইনাল. *(Same — landed here, EX-1 reuses it.)*
- Permissions: `exam:manage` (PRINCIPAL, OFFICE) · `exam:read` (row-scoped staff read). **Guardians read through the existing `guardian:read_child`** — no new guardian permission.

### D-#527 — do not extend `QUESTION_TYPES`

`QUESTION_TYPES` (`shared/vocab.ts:130`) is a **mirrored, wire-contract enum** bound to the import-envelope schema. It carries exactly six of the ten codes this feature needs, which makes extending it the obvious move and the wrong one: adding `creative`/`oral`/`practical` there triggers the two-place contract sync and changes the import contract for a reason that has nothing to do with importing. `SYLLABUS_ITEM_TYPES` is therefore a **separate, app-native enum that deliberately reuses the same six code strings**, so a later "assemble this paper from the bank" join is still a straight string match, and no envelope changes.

## §5 — The data the source document pins down

### 5.1 Every subject totals 100 — in every class (owner ruling, 2026-08-23)

`Σ marks[].total === 100` is a **single universal model-level guard**, not a per-class-band lookup. What *fills* the 100 stays **per subject**, exactly as the source sheet writes it.

Worked example — **Nursery Arabic**, the sheet's most explicit মানবন্টন:

| # | Row | count × each | total |
|---|---|---|---|
| 1 | ছবি দেখে শব্দের প্রথম অক্ষরে বৃত্ত আঁকা | 10 × 1 | 10 |
| 2 | ছবি দেখে শব্দের প্রথম অক্ষর লেখা | 10 × 2 | 20 |
| 3 | ছবি দেখে সঠিক উত্তরে টিক চিহ্ন | 10 × 1 | 10 |
| 4 | সঠিক তারতিবে হরফ লেখা | 10 × 1 | 10 |
| 5 | আগে ও পরের হরফ লেখা | 10 × 1 | 10 |
| 6 | ছবি দেখে শব্দ বলা *(মৌখিক)* | 10 × 2 | 20 |
| 7 | ক্লাস টেস্ট *(CT)* | — | 10 |
| 8 | আখলাক *(ADAB)* | — | 10 |
| | **মোট** | | **100** |

### 5.2 A mark row may BE a report-card component — D-#528

Rows 7 and 8 above are not question items; they are the **CT and Adab components** that `prd-exams.md` §5.2 models on `ExamPaper`. So each mark row carries an optional `component ∈ EXAM_COMPONENTS`, and the invariant is:

```
Σ marks[].total = 100 = Σ ExamPaper.components[].maxMarks
```

Without that link, the syllabus handed to a parent and the report card issued to the same parent can disagree about how a subject was marked, and nothing in the app would notice. A row carrying a `component` takes **no** `count`/`marksEach` — its number comes from the paper, so nobody types it twice.

### 5.3 This supersedes `prd-exams.md` §9.4 for the annual exam — D-#529

§9.4 / D-#377 ratified **Nursery = FINAL /100 only, no CT, no Adab** — read off the 2026 *Half-Yearly* report cards. The 2026 **Annual** syllabus contradicts it: Nursery Arabic carries CT 10 + Adab 10. The owner ruled (2026-08-23) that **every subject in every class totals 100** and composition stays per paper. §9.4 is therefore **descriptive of the half-yearly, not a rule for the module**. This costs nothing to implement because **D-#376 already moved composition onto the paper** rather than the class band; a per-band constant would have made this a migration.

### 5.4 Written / oral is a row flag, not a second document

KG and Class 1–5 headers read `লিখিত-৯০ মৌখিক-১০` / `Written-90, Oral-10`. That split is **derived** by summing rows whose `itemType === "oral"` against the rest. Storing a separate written/oral pair alongside the rows is the same number in two places, and they drift.

### 5.5 Question types are per class AND per row

The sheet carries a single footer line per class (*"পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর, শূন্যস্থান পূরণ, সত্য-মিথ্যা নির্ণয়, মিলকরন, ছোট প্রশ্ন, বড় প্রশ্ন ইত্যাদি থাকবে, ইন শা আল্লাহ।"* — Class 3 adds সৃজনশীল). So `questionTypes[]` + a free-text `classNote` live on a **per exam × class** row, rendered once at the top of the class's syllabus, while each mark row also carries its own optional `itemType`.

### 5.6 The 2026 source text cannot be recovered from the paste

The document as supplied is **mojibake with byte loss** — every Bengali codepoint lost its third byte in transit, so `বাংলা` arrived as `à¦¬à¦¾à¦à¦²à¦¾` and decodes back to `বা?লা`. Latin text and digits survived intact. The original `.docx`/Docs link is required before any content import; **D-#523's mojibake guard is re-applied here** (§6 SY-2) because whatever produced that file will produce more.

## §6 — Slices

### SY-1 — Vocab + the `Exam` row
```
Exam { academicYearId, term∈EXAM_TERMS, name, startDateKey?, endDateKey?,
       createdBy/At }
```
Deliberately minimal — `status`, `gradeScale`, `failRule`, `ctAggregation` are **EX-1's** fields and are not invented here. Unique on `(academicYearId, term)`.
**Acceptance:** [ ] vocab verifier green with the four new enums + two permissions; [ ] BN and EN labels present for every code; [ ] `QUESTION_TYPES` and `docs/import-contract.schema.json` **unchanged** (D-#527); [ ] a second `Exam` for the same year+term is refused.

### SY-2 — `ExamSyllabus` + the Σ guard
```
ExamSyllabus {
  examId, classId, subject∈ROUTINE_SUBJECTS,
  bodyMd,                                  // the prose
  marks: [{ seq, label, itemType?, component?, count?, marksEach?, total }],
  questionTypes: [SyllabusItemType],
  status∈SYLLABUS_STATUSES,
  approverUserId?,                         // the named subject teacher
  teacherApprovedBy?/At?, teacherBypass?,   // §7.2
  publishedBy?/At?,                         // the guardian predicate
  sendBackReason?, sendBackBy?/At?,
  examDateKey?, createdBy/At, updatedBy/At }

ExamClassNote { examId, classId, questionTypes: [SyllabusItemType], noteMd }
```
Unique on `(examId, classId, subject)` and `(examId, classId)`.
**Guards:** `Σ marks[].total === 100` (refused otherwise, error naming the actual sum); a row with `component` set carries no `count`/`marksEach`; a row without `component` requires `count` and `marksEach` and `count * marksEach === total`; `bodyMd`/`label`/`noteMd` refuse the mojibake signature (`à¦`/`à§`) with a Bangla error naming the fix (D-#523).
**Acceptance:** [ ] rows summing to 90 are refused, and the message says `90`; [ ] a CT row with a `count` is refused; [ ] a non-component row whose `count × marksEach ≠ total` is refused; [ ] the Nursery-Arabic fixture of §5.1 round-trips; [ ] mojibake refused server-side.

### SY-3 — The state machine + the routine-derived approver
Transitions, each audited (ADR-008) with the actor and the reason:

| From | Action | Who | To |
|---|---|---|---|
| DRAFT | `submitSyllabusToTeacher(approverUserId)` | `exam:manage` | TEACHER_REVIEW |
| TEACHER_REVIEW | `approveSyllabusAsTeacher` | the named approver | PRINCIPAL_REVIEW |
| TEACHER_REVIEW | `approveSyllabusAsTeacher` (bypass) | PRINCIPAL only, §7.2 | PRINCIPAL_REVIEW |
| TEACHER_REVIEW / PRINCIPAL_REVIEW | `sendBackSyllabus(reason)` | approver / `exam:manage` | DRAFT |
| PRINCIPAL_REVIEW | `publishSyllabus` | `exam:manage` | PUBLISHED |
| PUBLISHED | *(any content edit)* | `exam:manage` | DRAFT — §7.3 |

**The approver set is routine-derived, never typed** — `RoutineSlot`, the same walk `teachingNoteVisibility()` performs, because it is the only path that reaches ARABIC and QURAN (no `Subject` row; cross-grade groups only, D-#521). **A supervisory or proxy scope grant does NOT confer sign-off** — read visibility is deliberately wider than approval.
**Acceptance:** [ ] a teacher who does not hold the pair is refused; [ ] a teacher holding it via a scope grant but not the routine is refused; [ ] `publishSyllabus` from `TEACHER_REVIEW` is refused (no stage skipping); [ ] send-back without a reason is refused; [ ] every transition writes an audit row.

### SY-4 — Office entry (app)
Coverage board (exam → class chips → per-subject rows with status, holder and age) + a two-tab subject editor (`সিলেবাস` | `মানবন্টন`). Live Σ badge; **submit disabled until Σ = 100**. The approver is named from the routine before sending, defaulting per §7.1 — never a free-text picker (D-#366: an accountable teacher is never silently self-assigned). A sent-back row shows the reason inline.
**Acceptance:** [ ] `tsc` clean, expo web export exit 0; [ ] submit is disabled at Σ ≠ 100 and the badge shows the running total; [ ] a subject with no mark rows reads বাকি, not blank.

### SY-5 — Teacher sign-off + Principal publish (app)
Teacher: a "waiting on you" inbox, a read-only render, `অনুমোদন` / `ফেরত দিন` with a mandatory reason, and a banner stating that editing is not theirs. Principal: the class × subject matrix (five states, each with a glyph as well as a colour — §0 of the UI guidelines), plus the blocked reason named on screen.
**The drawer badge is a permission-carrying probe.** It MUST be paused unless the caller holds the permission and read with `?.` — this is the exact shape that white-screened the app in `791e5fe` (2026-08-23).
**Acceptance:** [ ] a teacher with no pending rows sees an empty state, never an error; [ ] the drawer renders for a role holding none of these permissions; [ ] send-back requires a reason; [ ] publish is refused while Σ ≠ 100, with the sum named.

### SY-6 — Read screen, guardian scope, PDF
One renderer, three surfaces. Screen = a grid of **subject-name buttons** (owner's ruling) → detail showing prose + mark distribution + question types; the class note renders **once at the top**, not per subject. Teacher scope = every published subject of any class they teach, own subjects outlined first. Guardian scope = their child's class, **published rows only**, under `guardian:read_child`. `GET /pdf/syllabus/:examId?classId=` renders the class bundle — the sheet the school photocopies today.
**Acceptance:** [ ] a guardian cannot reach an unpublished row by any route, including the PDF; [ ] an unpublished subject renders as a dimmed `প্রকাশ হয়নি` button, not as absent; [ ] the PDF and the screen come from one renderer; [ ] `/pdf` needs no Caddyfile change.

## §7 — Owner rulings (ratified 2026-08-23)

| # | Question | Ruling |
|---|---|---|
| 7.0 | Marks per subject | **100 in every class**, composition per subject (§5.1, §5.3) |
| 7.1 | Several teachers hold one class × subject | Office names one when sending, defaulting to the routine holder with the **most periods** for that pair; **any one approval releases it**, and the row records who. Requiring all stalls on whoever is on leave. |
| 7.2 | Nobody holds it in the routine | The **Principal may approve in the teacher's place**, stamped `teacherBypass` and audited under a **distinct kind**, so it reads as a bypass rather than a normal sign-off. Silently skipping the stage would make it decorative the first time it was inconvenient. |
| 7.3 | Office edits an already-approved row | Any edit to `bodyMd` or `marks[]` returns it to `DRAFT` and **clears the teacher's approval** — the D-#520 rule that a closure does not survive the thing it closed being changed. |
| 7.4 | Who publishes | **Principal.** Office cannot release to guardians. |
| 7.5 | Teacher read scope | Every **published** subject of any class they teach, own subjects first. |
| 7.6 | Guardian release | **Per subject, on publish** — no held release date. |
| 7.7 | Navigation | Drawer group → `সিলেবাস দেখুন` (all) · `সিলেবাস এন্ট্রি` (`exam:manage`) · `অনুমোদন` (badge). |

## §8 — Out of scope

Mark entry, rechecking, tabulation, report cards, the custody chain (**all of that is `prd-exams.md` EX-1..EX-10**) · question-paper authoring (the QuestionBank + `AssessmentSet` modules) · auto-assembling a paper from the syllabus rows (the shared codes make it possible later; it is not built here) · importing the 2026 text (blocked on a clean source, §5.6) · any corpus-plane join (ADR-005) · SMS/WhatsApp delivery.

## §9 — Traceability

Reuses D-#1 · D-#46/#52 (app-native vocab, no wire twin) · D-#54 (`ROUTINE_SUBJECTS`) · D-#85 (derive, never store — §5.4) · D-#271/CO-8 (`publishedAt` as an additive publish gate) · D-#277/CT-8 (approve + send-back-with-reason) · D-#366 (never silently self-assign an accountable teacher) · D-#376 (per-paper composition — what makes §5.3 free) · D-#377/§9.4 (superseded for the annual exam, §5.3) · D-#405 (per-leaf drawer permission gating) · D-#520 (a closure does not survive a change to what it closed) · D-#521 (routine-derived class × subject pairs; ARABIC/QURAN have no `Subject` row) · D-#523 (mojibake refusal) · ADR-005 · ADR-008.

**New: D-#527–#532.** D-#527 separate app-native `SYLLABUS_ITEM_TYPES`, `QUESTION_TYPES` untouched · D-#528 a mark row may be a report-card component; Σ = 100 = Σ paper components · D-#529 every subject totals 100, superseding §9.4 for the annual exam · D-#530 subject-teacher sign-off between Office and Principal, routine-derived, grants excluded · D-#531 bypass + re-approval rules (§7.1–7.3) · D-#532 the drawer badge is a permission-gated probe (the `791e5fe` rule).
