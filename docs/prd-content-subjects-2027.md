# PRD — Content pipeline: the 2027 subjects and Class 6 (PR-A of the objective chain)

**Status:** BUILT 2026-11-11 (overnight session, branch `claude/charming-cori-ksozdn`, slice label PR-A).
**Decisions:** D-#1310–#1313. **Contract:** import envelope v1.2 (additive; every v1.1 envelope still validates).

## Why
The school will import lesson plans, questions and objective trees for Islam (Classes 1–5) and for
Class 6 (Bangla 1st and 2nd paper, English 1st and 2nd paper, ICT). Before this, the envelope, the plan
schemas and the question payload accepted only BAN / ENG / MATH / SCI / BGS in Classes 1–5.

## The contract (a two-/three-place sync)
| Thing | Before | After |
|---|---|---|
| Content subject (`SUBJECTS`, envelope `subject`, plan `subject`) | BAN ENG MATH SCI BGS | + ISLAM, ICT, BAN2 (Bangla 2nd paper), ENG2 (English 2nd paper) |
| Content class (`CLASS_LEVELS`, envelope / plan `class_level`) | 1–5 | 1–6 |
| Question id `qid` | `QP-[A-Z]+-C[1-5]-…` | `QP-[A-Z][A-Z0-9]*-C[1-6]-…` (`QP-BAN2-C6-U03-Q012`) |
| Stimulus id, plan `topic_tag`, `rc_id` | `[A-Z]+`, C1–C5 | digit allowed in the subject part, C1–C6 (D-#1313) |
| Legacy `TOP-` question topic tag | — | unchanged (C1–C5, five subjects) |
| `ref19_topic_id` | required by the payload schema | required by the harness L4 for BAN ENG MATH SCI BGS BAN2 ENG2; optional and unchecked for ISLAM, ICT (D-#1311) |
| Objective / domain codes (`MASTERY_LO_CODE_RE`, `MASTERY_DOMAIN_CODE_RE`, payload `topic_tag` / `lo_codes`, envelope `lo_codes`) | 7 homework subjects | + ICT, BAN2, ENG2 (longer alternatives first) |
| `MASTERY_SUBJECTS` | `= HW_SUBJECTS` | its own list: HW_SUBJECTS + ICT, BAN2, ENG2 (D-#1312) |

BAN and ENG keep meaning the only paper, or the 1st paper in Class 6. Labels: ইসলাম শিক্ষা (the existing
ISLAM label), তথ্য ও যোগাযোগ প্রযুক্তি, বাংলা ২য় পত্র, ইংরেজি ২য় পত্র.

`NCTB_GENERAL_SUBJECTS` keeps the old five for anything that means "the five general subjects". The
operational `Subject` collection (`FOUNDATION_SUBJECTS`) is pinned to it + ISLAM, so it does not change.

**One name for Islam (D-#1440, 2026-11-12).** The P09 spelling `ISL` is dropped: the plan tools
(`LOCKED_SCD_PlanSchema_v2.json`, `render_plan.py`, `validate_plan.py`), `build_envelope.py` and the harness
accept only `ISLAM`. An `ISL` plan or envelope is refused with a message naming `ISLAM`. No `ISL` plan existed
in any fixture or case, so nothing was migrated. Any list of subjects for the P09 plan tools reads
`BAN ENG MATH SCI BGS ISLAM ICT BAN2 ENG2`.

**Division words.** A Class 6 `BAN2` plan uses `অধ্যায়`; an `ENG2` plan uses `Unit`. Enforced by the anchor-word
rules in both plan schemas (`LOCKED_SCD_PlanSchema_v2.json` and the import gate's `LOCKED_C5_PlanSchema_v1.json`),
with cases `pass_`/`fail_{ban2,eng2}_c6_session_plan_anchor_*` under `server/import/cases/subjects-2027/`.

**Question time.** `QUESTION_TIME_RATES` for `ISLAM`, `ICT`, `BAN2`, `ENG2` is 1.8 minutes per mark for every
question type (3 hours for 100 marks); the five older subjects keep their rows.

## Screens
Bank filters, plan lists, review assignment and the content tree read `SUBJECTS` / `CLASS_LEVELS` and so
show the new values. The mastery screens name ICT / BAN2 / ENG2 through `hwSubjectLabel` (now falls back to
the content labels). The mastery work home keeps the homework subjects as its chips (sheets follow the
routine). The English drive keeps Classes 1–5 (its server list). The class-note lesson-plan picker finds
an ISLAM session plan for an ISLAM routine slot (it already matched on the slot's subject).

## Out of scope
ICT / BAN2 / ENG2 as routine, homework or class-test subjects (Class 6 onboarding); Nursery and KG content;
Classes 7–8.

## Acceptance (tests + harness cases)
`server/import/cases/subjects-2027/` (15 cases, run with
`node skills/_tools/verify_descriptive_carriers.mjs server/import/cases/subjects-2027`) and
`server/src/__tests__/contentSubjects2027.test.ts`:
1. An ISLAM Class 3 session plan envelope and a Class 6 ICT question batch validate and import.
2. A Class 7 envelope and an unknown subject are refused.
3. `LO-C6-BAN2-03-02.1`, `LO-C6-ICT-01-01`, `DOM-ENG2-TENSE` match; `LO-C7-…` does not.
4. A C6 ICT tree file (test fixture) passes the tree verifier and imports as a draft round.
5. An ISLAM question without `ref19_topic_id` passes; a BAN question without it still fails.
6. Every existing harness case and verifier still passes.
