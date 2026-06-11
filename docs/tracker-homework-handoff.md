# Homework Tracker — Project-06 handoff (LOCKED source)

**This file is the incoming spec, reproduced as received — do not edit it to reflect repo decisions.**
It is the `consult-via-human` handoff from **Project 06 — Tracker & Operations System** to SCD Hub
(system of record + runtime). It plays the same role for the Homework Tracker that `hr-design.md` plays
for the HR module: the **LOCKED source**. The repo's *build contract* derived from it is
`docs/prd-tracker-homework.md`; the adoption decision is `DECISIONS.md` (D-#33–#35). When this file and
the build contract disagree, **this file wins** — fix the build contract.

> Authority: master D-053 / D-PROJ06-006 · REF-08 Homework Architecture (LOCKED v1.3) · REF-07 Revision
> Architecture (LOCKED v1.2) · D-013/D-014/D-024/D-025/D-028/D-030/D-036/D-049 · Channel: consult-via-human
> (route every question/deviation through the Principal — neither side edits the other's governance).
> A tracker is a **feature**, not import-envelope content (no `doc_type: tracker`).
> **Status: v1.1 — FINAL, adoption-ready** (PRD v1.0 + Amendment A-01, both 2026-06-10).

---

## §0 — Summary (read this first)
The Homework Tracker is the daily tracker for the **HW-…** channel: one common sheet per class per
subject per day (never bespoke per student), every item numbered (HW-…) and topic-tagged (TOP-…), every
per-student copy moving through the ratified **6-stage lifecycle** (Given → Absent/Re-deliver → Due →
Submitted/Chase → Checked/Resubmit+Top-up → Returned). The tracker is the only place REF-08's daily
ceiling becomes real: it must compute the class's day total of declared homework minutes, compare it to
the uniform Classes 1–5 ceiling of **240 min (floor 120)**, and force any overage to be resolved by
**cutting question count, never extending time (D-030)**, with every cut written to a trim log. Wrong
answers trigger resubmission of the same numbered sheet, optionally carrying a top-up of extra questions
**selected (never authored)** from the topic's Project-04 chapter Pool. The tracker sits on the
operational (identity-bearing) plane; only de-identified aggregates cross to the corpus. It is an
**existing tracker-kind** (the Slice-3 HW build) — this PRD ratifies and completes it; **no new
tracker-kind, no three-place vocab/schema/harness sync.**

## §1 — Scope and status
**In scope:** the daily HW-… channel — item registration, per-student lifecycle, daily budget
reconciliation + trim log, resubmission/top-up, the roll-ups it must feed into `trackerSummary`.

**Out of scope (boundaries):**
| Not here | Where it lives |
|---|---|
| Weekly assignment AS-… (given Thu / worked Fri+Sat / collected Sun) | Assignment Tracker — but the 6-stage lifecycle component is built once and shared by both (REF-07 §5.1 / REF-08 §5.3) |
| Quran daily muraja'ah discipline (incl. weekend tilawah/hifz) | Quran Tracker. A Quran-subject homework row (e.g. 20 min tilawah) DOES live here and counts in the weekday budget; the muraja'ah discipline — incl. the weekend touch, outside all academic caps — is the Quran Tracker's |
| Question authoring; the chapter Pool QP-{SUBJECT}-C{class}-U{nn} (≥20 questions, D-028) | Project 04 / the Slice-2 question store. The tracker only references Pool questions on selection |
| Exit-check failures, REV_HOOK_DONE / REV_NONRECALL, the D-025 thresholds | Lesson Completion Tracker. The Homework Tracker contributes resubmission signals to the watch-list; it does not compute D-025 flags |
| The topic chart and revision scheduling | REF-07 machinery; the Master view reads this tracker's TOP-… tags |

**Build status:** HW is in the already-built slice. Treat this PRD as the spec to verify against and
**close gaps** (esp. §3 lifecycle — firm ratified requirement — §4 reconciliation, §5 top-up flag,
§8 roll-ups). Adopt by ADR; verify under the repo's own gate.

## §2 — Data model and fields (Bangla labels + English codes)
Three record layers. Map them onto the `TrackerRecord` schema as the adopting ADR sees fit — the fields
and semantics below are the **contract**, not the storage shape.

### 2.1 Layer A — Homework Item (class-level; one row per HW-… ID)
One common sheet for the whole class (REF-07 §2.3 / REF-08 §2.3). Created by the subject teacher's daily
declaration.

| Code | Bangla label | Type / rule |
|---|---|---|
| `HW_ID` | বাড়ির কাজ আইডি | `HW-{class}-{SUBJECT}-{nnnn}` — running number per class+subject, continuous within the academic year, 4-digit zero-padded, resets at year start (format decided here per REF-08 §5.1 delegation — **confirmed, A-01**) |
| `DATE_GIVEN` | প্রদানের তারিখ | date; school nights only (Sun–Thu; Thu = light roster) |
| `CLASS` | শ্রেণি | C1–C5 |
| `SUBJECT` | বিষয় | from the class roster (§6.2) |
| `TOP_TAGS` | টপিক ট্যাগ | one or more `TOP-{SUBJECT}-C{class}-{nn}` — **required, never empty** (REF-07 §3.5) |
| `TIME_DECL` | নির্ধারিত সময় (মিনিট) | integer minutes, 0–40 band, default 20 (Class-1 working value; a subject may exceed 40 on reduced-roster days for C3–5 — the firm constraint is the §4 day-sum, never this field). 0 is valid and honest (D-030 rule 4) |
| `Q_COUNT` | প্রশ্ন সংখ্যা | integer Y — tuned so the average student finishes inside `TIME_DECL` |
| `POOL_REF` | প্রশ্নভাণ্ডার সূত্র | `QP-{SUBJECT}-C{class}-U{nn}` + selected question IDs from the question store (selection, never authoring) |
| `REV_ITEM` | পুনরালোচনা আইটেম | Y/N — does the sheet carry the optional one revision item (REF-07 §2.2)? Needed because trims cut these first (§4.4a) |
| `SESSION_REF` | সেশন সূত্র | the Session Plan / lesson this homework reinforces (§2.7 traceability) |

### 2.2 Layer B — Per-student record (one per student × item; the lifecycle carrier)
| Code | Bangla label | Type / rule |
|---|---|---|
| `STUDENT_ID` | শিক্ষার্থী আইডি | identity-bearing — operational plane only (§9) |
| `HW_REF` | বাড়ির কাজ সূত্র | FK → Layer A |
| `STATE` | অবস্থা | one of the 6 lifecycle states (§3) |
| `STATE_DATES` | ধাপের তারিখসমূহ | timestamp per state transition (audit trail) |
| `CHASE_COUNT` | তাগাদা সংখ্যা | integer; increments per chase (§3 stage 4) |
| `RESULT` | ফলাফল | সঠিক (CORRECT) / আংশিক (PARTIAL) / ভুল (WRONG) — recorded at Checked (3-value scale **confirmed, A-01**; only ভুল auto-spawns a resubmission, আংশিক = teacher's judgment) |
| `RESUB_OF` | পুনঃজমার মূল রেকর্ড | FK → the prior per-student record this resubmission re-issues (same `HW_ID`; the unchanged ID is what makes the re-do traceable — REF-08 §5.2) |
| `TOPUP_FLAG` | টপ-আপ (অতিরিক্ত প্রশ্ন) | Y/N — only valid on a resubmission record (§5) |
| `TOPUP_QIDS` | টপ-আপ প্রশ্ন আইডি | Pool question IDs selected for the top-up |
| `TOPUP_TIME` | টপ-আপ সময় (মিনিট) | minutes — counts toward that child's daily load (§5 rule 3) |

### 2.3 Layer C — Daily reconciliation record (one per class per school day) + trim log
This is REF-08 §2.3's reconciliation instrument — **not a report generated after the fact**, but the
working surface the class teacher uses **before** homework goes home.

| Code | Bangla label | Type / rule |
|---|---|---|
| `RECON_DATE` / `CLASS` | তারিখ / শ্রেণি | key |
| `DECL_LIST` | বিষয়ভিত্তিক ঘোষণা | the day's Layer-A items per subject with their `TIME_DECL` |
| `DAY_TOTAL` | দিনের মোট সময় | computed sum of `TIME_DECL` across subjects that met today |
| `CEILING` | দৈনিক সর্বোচ্চ সীমা | **240 min**, uniform C1–5 (floor 120 is informational, not enforced) |
| `RECON_STATE` | সমন্বয় অবস্থা | within-ceiling ✓ / over-ceiling → trim required / reconciled-after-trim |
| `RECON_BY` | সমন্বয়কারী | the class teacher (daily coordinator role — RBAC §9) |

**Trim log** (child rows of the reconciliation record; REF-02 §2.7 rule 3 / REF-08 §5.3):

| Code | Bangla label | Type / rule |
|---|---|---|
| `TRIM_HW` | হ্রাসকৃত আইটেম | FK → Layer A item trimmed |
| `TRIM_RANK` | হ্রাস ক্রম | ক / খ / গ — which §4.4 priority rule applied (a/b/c) |
| `TRIM_FROM` / `TRIM_TO` | প্রশ্ন সংখ্যা: আগে / পরে | counts before/after (`TRIM_TO = 0` = zeroed, permitted) |
| `TRIM_MIN` | সাশ্রয়কৃত সময় (মিনিট) | minutes recovered |

## §3 — The 6-stage lifecycle (FIRM ratified requirement — D-PROJ06-006 req. 1)
Built once, shared by Homework and Assignment trackers. Per REF-07 §5 / REF-08 lifecycle:

| # | State | Bangla | Code | Entry / exit rules |
|---|---|---|---|---|
| 1 | Given | প্রদান করা হয়েছে | `GIVEN` | Sheet issued to the student on `DATE_GIVEN`. Student present → advances toward Due |
| 2 | Absent-on-given / Re-deliver | অনুপস্থিত / পুনঃপ্রদান | `ABSENT_REDELIVER` | Student absent when issued → record sits here; re-deliver on next attendance, then proceeds as Given (due date shifts; the ADR sets the shift rule; **default = next school night**) |
| 3 | Due | জমার দিন | `DUE` | The submission date (**default: next school morning** for HW-…) |
| 4 | Submitted / Chase | জমা হয়েছে / তাগাদা | `SUBMITTED` / `CHASE` | Submitted on time → `SUBMITTED`. Not submitted → `CHASE`, `CHASE_COUNT++` per school day until submitted. Chase threshold → §7.2 |
| 5 | Checked / Resubmit (+ Pool top-up) | যাচাই হয়েছে / পুনঃজমা (+ টপ-আপ) | `CHECKED` / `RESUBMIT` | Teacher checks; `RESULT` recorded. WRONG (or PARTIAL at teacher's judgment) → spawn a resubmission record (`RESUB_OF` set, same `HW_ID`); in a pre-class-test window the resubmission may carry a top-up (§5). Correct → advances |
| 6 | Returned | ফেরত দেওয়া হয়েছে | `RETURNED` | Checked sheet handed back. **Terminal.** A spawned resubmission runs its own 1→6 pass |

**Invariants:** no state skipping except `GIVEN`→`DUE` (the normal overnight path) and absence handling;
every transition timestamped; a resubmission is a **new per-student record on the same `HW_ID`** — never
a new ID, never a new stream (REF-07 §4.1 boundary 4).

## §4 — Daily budget enforcement (the §2.3 reconciliation, in software)
The tracker's reason to exist: *"the Homework Tracker is the only place the daily ceiling becomes real"*
(REF-08 §5.3).

1. **Collect.** Each subject teacher's daily declaration creates the Layer-A item (`TIME_DECL`,
   `Q_COUNT`, `TOP_TAGS`, Pool selections). One common sheet per subject — the UI **must not** offer
   per-student item variants (the only per-student divergence allowed anywhere is the §5 resubmission
   top-up).
2. **Tally.** The system computes `DAY_TOTAL` **live** as declarations land — the class teacher's daily
   view (§8.1) shows the running sum against the 240-min ceiling.
3. **Gate.** `DAY_TOTAL ≤ 240` → class teacher confirms; all items issue (per-student records spawn in
   `GIVEN`/`ABSENT_REDELIVER`). `DAY_TOTAL > 240` → **issuing is blocked until reconciled.**
4. **Trim — by question count, never by extending time (D-030)**, in this priority order, each cut logged:
   - **(a / ক)** cut pure-revision items first — items with `REV_ITEM = Y` lose the revision question;
   - **(b / খ)** reduce `Q_COUNT` on the lightest-priority subject(s) for today (teacher's judgment;
     system offers candidates **sorted ascending by `TIME_DECL`**);
   - **(c / গ)** zero out a subject's homework for the day (`TRIM_TO = 0` — permitted, D-030 rule 4).
   - Repeat until `DAY_TOTAL ≤ 240`. Reducing `Q_COUNT` reduces `TIME_DECL` proportionally (count is the
     lever; time is the target the count is tuned to).
5. **Issue + log.** On confirm, the reconciliation record closes (`RECON_STATE = reconciled`), trims are
   **immutable** in the log, and per-student lifecycle records spawn.

**The band is advisory; the sum is law.** Warn (don't block) when a single subject's `TIME_DECL > 40` —
legitimate on reduced-roster days (REF-08 §2.1 "uniform ceiling, flexing band"). **Block only on the
day-sum.**

## §5 — Resubmission + Pool top-up (the bounded catch-up — REF-07 §4.1 / REF-08 §4.3)
Trigger: `RESULT = WRONG` at Checked. The **four boundaries are hard rules** — enforce them in the feature:
1. **Selected, never authored.** `TOPUP_QIDS` may only reference existing questions in the topic's
   ≥20-question chapter Pool (QP-…) in the question store. **No free-text question entry** on this path.
2. **Reactive only.** A top-up can only attach to a record where `RESUB_OF` is set — i.e. spawned by an
   actual failure. **No UI for pre-scheduling** per-student top-ups, and none should be added.
3. **Time-bounded.** `TOPUP_TIME` counts toward that child's daily load. On a top-up day the teacher trims
   the child's other HW-… to make room; the child may still personally run over the ceiling — accepted and
   expected (REF-08 §2.6, the average-student framing). **Surface the child's personal day-load** in the
   teacher view so this is a visible choice, not an accident.
4. **Tracked inside the resubmission stage** — same `HW_ID`, `TOPUP_FLAG = Y`, its own due/submitted/
   checked pass. **Not a new stream.**

Top-ups are intended for the **pre-class-test window** of the failed topic's chapter; if the build can read
the Class Test schedule, prompt top-up availability there — otherwise leave it to teacher judgment (do not
block).

## §6 — Cadence and calendar rules
- **6.1 Cadence:** daily (D-014). HW-… issues **Sun–Thu only**. Friday and Saturday are **hard-blocked**
  for HW-… (weekend carries AS-… only — Assignment Tracker's business; the two academic caps add, never
  overlap — REF-08 §2.4/§3).
- **6.2 Rosters** (drive which subjects appear in the day's declaration list):
  - **Class 1–2:** six daily subjects Sun–Wed (Bangla, English, Math, Quran, Arabic, Islam); Thursday =
    Quran + Arabic + weekly tests — Thursday **may still carry light homework** from the subjects that met,
    tallied and reconciled exactly like any night, just smaller (REF-08 §2.3 step 6 — **not a zero-homework
    day**).
  - **Class 3–5:** Quran/Arabic daily; Bangla/English/Math ×4 days; BGS/Science/Islam ×2 days. Same method:
    sum only the subjects that met today against the same 240 ceiling.
- **6.3 Quran boundary:** Quran-subject homework rows live here and count in the weekday budget; the
  muraja'ah discipline (incl. the weekend touch, outside all caps) is the Quran Tracker's. **Don't
  double-log.**

## §7 — Follow-up rules and thresholds
1. **Over-ceiling day** → issuing blocked, trim workflow forced (§4). Never silently issue an over-ceiling
   day.
2. **Chase escalation** (**confirmed, A-01**): `CHASE_COUNT = 2` → flag to class teacher's attention list;
   `CHASE_COUNT = 3` → surface a parent-communication prompt. The Bangla wording is **not authored** in
   this build — Project 06 delivers parent-comms content separately (REF-12 §7); the feature only raises the
   trigger and sends through the existing delivery path (wa.me now, Cloud API later).
3. **Repeated resubmission** (**confirmed, A-01**): a student with **≥3 open or recent resubmissions in a
   rolling 2-week window** → appears on the Master watch-list alongside (not replacing) the D-025 flags the
   Lesson Completion Tracker computes.
4. **Trim-pattern review** (REF-08 §9, Subject Lead) (**confirmed, A-01**): if one subject is trimmed on
   **>30% of school days in a month** → flag it in the principal/Subject-Lead view. Persistent trimming of
   one subject means its §2.7 declarations are systematically oversized.
5. **D-049 materials rule:** any pupil-/parent-facing wording the feature renders may reference only the
   permitted materials — খাতা / পেনসিল / কলম for pupils; whiteboard + marker for the teacher.

## §8 — Dashboard / `trackerSummary` requirements
- **8.1 Class teacher (daily working view):** today's declarations per subject; live `DAY_TOTAL` vs 240 with
  a clear over/under state; the trim panel (§4.4 candidates pre-sorted); the chase list (records in `CHASE`
  with counts); open resubmissions; **per-child personal day-load including `TOPUP_TIME`** (§5.3).
- **8.2 Subject teacher:** own subject's items, checking queue (records at `SUBMITTED` awaiting `CHECKED`),
  resubmission queue with the Pool-selection picker.
- **8.3 Principal** (rolls into the Master/principal dashboard — full spec arrives in the Master PRD):
  - Weekly load roll-up per class (REF-08 §2.5): actual issued hours vs the typical ≈16–17 hr / ceiling
    ≈25 hr week — the instrument by which the ceiling itself is reviewed.
  - Completion health: submitted-on-time %, chase volume, return latency (Given→Returned).
  - Touches per topic: counts of delivered HW-… per TOP-… tag — feeds REF-07 §5.2's Master revision view.
    The tags make it free; no extra teacher logging.
  - Trim patterns per subject (§7.4) and watch-list contributions (§7.3).
- **8.4 Question-usage feed** (operational → de-identified): which Pool questions each HW-… used, and when —
  per-question usage counts feed the question store's rotation-health view (D-PROJ06-003 / D-PROJ06-006:
  `trackerSummary` + question store absorb the old register-view idea).

## §9 — Data plane and RBAC
- **Operational plane (identity-bearing):** all Layer-B records, chase counts, results, resubmission
  histories, the reconciliation/trim logs. Named, per-student, role-gated.
- **Corpus plane (de-identified):** only aggregates cross the ADR-005 firewall — per-question usage counts,
  per-topic touch counts, anonymized completion/trim statistics. **No student identity ever crosses.**
- **RBAC** (map to existing roles): subject teacher = declare + check own subject; **class teacher = the
  only role that runs §4 reconciliation + confirms issue** (the daily-coordinator role, REF-08 §2.3/§9);
  Principal = read-everything + §8.3; Subject Lead = read trim-patterns + substitution review.

## §10 — REF dependencies (consult-via-human; route any question through the Principal)
REF-08 v1.3 (budget, band, trim rule, weekend rule, average-student framing — the governing document) ·
REF-07 v1.2 (lifecycle, topic tags, resubmission/top-up boundaries, Master revision view) · D-024/D-030/
D-036 (ceiling figures + count-is-the-lever + floating allocation) · D-028 (≥20 Pool floor, read from the
question store) · D-013/D-014 (no 9th tracker; daily cadence) · D-049 (materials wording) · REF-12 §7
(parent-comms tone — content delivered separately by Project 06).

## §11 — Open items — CLOSED by Amendment A-01 (2026-06-10)
| §11 item | Ruling (Principal, 2026-06-10) | PRD effect |
|---|---|---|
| 1 · HW_ID numbering | **Continuous within the academic year, per class+subject, reset at year start** | §2.1 `HW_ID` rule stands; "Principal-confirm" marker removed |
| 2 · RESULT scale | **3 values — সঠিক / আংশিক / ভুল**; only ভুল auto-spawns resubmission, আংশিক = teacher's judgment | §2.2 `RESULT` stands; §3 stage 5 unchanged |
| 3 · Thresholds | **Confirmed as proposed** — chase 2 → attention list, 3 → parent-comms prompt; ≥3 resubmissions / rolling 2 weeks → Master watch-list; subject trimmed >30% of school days/month → trim-pattern flag | §7.2–7.4 stand; "proposed" markers removed |

All locked figures (**240 / 120 / 40 / 20 / ≈16–17 hr / ≈25 hr / ≥20**) are restated verbatim and are
**not** open.

## §12 — Acceptance checklist (verify under the gate before ADR adoption)
- [ ] No 9th tracker — HW-… rides this single Homework Tracker (D-013); no new tracker-kind, no
      vocab/schema/harness sync.
- [ ] Every item row carries HW-… ID + ≥1 TOP-… tag; tags feed touch-counts with zero extra logging.
- [ ] 6-stage lifecycle implemented exactly as §3, built once and shared with the Assignment Tracker, every
      transition timestamped.
- [ ] Daily per-student load roll-up + over-ceiling block live (§4) — 240-min uniform ceiling; trim by
      count, never time; band warning ≠ block.
- [ ] Trim log immutable, with rank ক/খ/গ, from/to counts, minutes.
- [ ] Resubmission + top-up enforces all four §5 boundaries (selected-not-authored; reactive-only;
      time-counted; inside the resubmission stage, same ID).
- [ ] Fri/Sat HW-… issuing hard-blocked; Thursday light path works like any night.
- [ ] One common sheet — no per-student item variants anywhere except the top-up.
- [ ] Columns render Bangla labels + English codes as specified.
- [ ] Plane split per §9; no identity crosses the ADR-005 firewall.
- [ ] §8 roll-ups exposed via `trackerSummary` for the Master/principal dashboard.
