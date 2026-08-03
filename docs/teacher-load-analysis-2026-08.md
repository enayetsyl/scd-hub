# Teacher load analysis & recruitment forecast — August 2026

**Purpose:** size the teaching establishment for (a) the announced departures/returns,
(b) adding Class 6 next academic year, and (c) splitting Classes 1–6 into boys/girls
sections. **Status:** analysis only — no decision is recorded here. Decisions belong in
`DECISIONS.md`.

**Data source:** `scdhub_prod`, read-only, as at **2026-08-02**. Reproduce with
`server/scripts/diag-teacher-load-2026-08{,b,c,d,e}.ts`.

---

## 0. What the data can and cannot support

| | |
|---|---|
| Routine | 225 active teaching periods/week, every one assigned, no orphan slots. Reliable. |
| Leave | 18 `StaffLeaveApplication` rows (14 in July). Reliable. |
| **Teacher attendance** | **`teacherattendancedays` = 0 rows in prod.** No biometric import has run. Unrecorded absence and lateness are invisible; "absence" below means *approved leave only*. |
| **Routine history** | **Unavailable.** All 225 slots read `effectiveFrom 2026-01-01`, open-ended, edited in place, so "what was the routine in June?" cannot be answered. All figures are the routine *as it stands today*. |
| Leave entitlements | 0 rows. Every leave is stamped `paid=0 / unpaid=all`, i.e. recorded as LWP. |
| Rooms | 0 rooms defined; 0 of 225 slots set a `roomId`. Physical room capacity is not modelled anywhere. |
| Evening programme | Fawjan Ajima Chowdhury has a staff profile but no user account and no routine slots. Entirely outside this analysis. |

Two data-quality notes that affect counts:

- **Duplicate leave applications double the cover fan-out.** Kuddus applied twice for
  2026-07-06; Mahfuj's 07-18→20 and 07-19→21 applications overlap. 82 raw
  `StaffCoverSlot` rows correspond to 67 real class meetings. All cover figures below
  are **deduplicated** by `(date, period, absent teacher, slot)`.
- **36 approved covers produced only 25 `RoutineSubstitution` rows.** Worth a separate
  check that approved covers reach the day view; not diagnosed here.

---

## 1. The timetable's shape

Two period grids are in force (`PeriodGrid`, D-#51):

| Audience | Periods | Structure |
|---|---|---|
| Class 1–5 | 8 (P4 = tiffin break) | **P1–P2 Quran**, **P3 Arabic**, P5–P8 general |
| Nursery / KG | 6 (P4 = break) | all general track, 5 teaching periods/day |

Quran and Arabic for Classes 1–5 are taught in **cross-grade `SubjectGroup`s by level**,
not by section: 5 Quran groups (Qaida, Ammapara, Najera, Hifz 1, Hifz 3) and 5 Arabic
groups (Book 1, Book 2 boys, Book 2 girls, Book 3, Quranic Arabic).

### Weekly demand — 225 periods

| Consumer | Periods/week | Working |
|---|---|---|
| 5 Quran groups | 50 | 2 periods/day × 5 days × 5 groups |
| 5 Arabic groups | 25 | 1 × 5 × 5 |
| Nursery | 25 | 5 periods/day × 5 days |
| KG | 25 | 5 × 5 |
| Classes 1–5, general | 100 | 4 periods/day × 5 days × 5 classes |
| **Total** | **225** | |

### Simultaneous groups per period

| Period | Concurrent groups | Composition |
|---|---|---|
| P1, P2 | **7** | 5 Quran groups + Nursery + KG |
| P3 | **7** | 5 Arabic groups + Nursery + KG |
| P5, P6 | **7** | 5 classes + Nursery + KG |
| P7, P8 | **5** | 5 classes |

This is the number of teachers who must be **physically teaching at the same moment**.
It, not the weekly total, is what sets the establishment.

### By subject

| Subject | Periods/wk | Teachers | Distribution |
|---|---|---|---|
| QURAN | 60 | 7 | Akbor 15, Mariam 10, Momin 10, Kuddus 10, Afia 5, Nuha 5, Mahfuj 5 |
| ENG | 35 | 4 | Tazkir 15, Zarir 10, Nuha 5, Fida 5 |
| ARABIC | 35 | 6 | Afia 10, Mariam 5, Momin 5, Mahfuj 5, Kuddus 5, Sajeda 5 |
| MATH | 32 | 5 | Maruf 13, Sajeda 5, Fida 5, Hamida 5, Nuha 4 |
| BAN | 32 | 5 | Mahfuj 9, Kawsar 9, Hamida 5, Sajeda 5, Zarir 4 |
| ISLAM | 16 | 3 | Momin 9, Kuddus 6, Mahfuj 1 |
| SCI | 9 | 3 | Maruf 3, Nuha 3, Fida 3 |
| **BGS** | **6** | **2** | Kawsar 4, Hamida 2 |

---

## 2. Who actually teaches

The roster holds **22 teacher-category staff profiles**. **Fourteen** carry the entire
225-period timetable. The other eight teach nothing:

| Zero routine load | Reason |
|---|---|
| Md Enayetur Rahman (Principal), Akter Hossen | exempt from class |
| Tahia Tuz Chara | left, August 2026 |
| Tanjila Akter Jerin | on leave — returns **mid-August 2026** |
| Masrura Akther Sarah | on leave, return uncertain |
| Mahzabin Yasmin | assigned to desk work |
| Rubina Khanam | Nursery support teacher — fully occupied |
| Fawjan Ajima Chowdhury | evening programme |

The timetable has therefore **already been re-cut around the departures**: Tahia's,
Jerin's and Sarah's exits left no visible hole because the remaining 14 absorbed them.

### Load, split by teaching window

Structural caps: the morning Quran/Arabic window is **P1–P3 = 15 periods/week**; the
general afternoon is **P5–P8 = 20/week**.

| Teacher | Morning | Afternoon | Total | Subjects |
|---|---|---|---|---|
| Md Abdul Momin | **15 / 15** | 9 | 24 | ISLAM, QURAN, ARABIC |
| Md Abdul Kuddus | **15 / 15** | 6 | 21 | QURAN, ARABIC, ISLAM |
| Shah Mahfuj Ahmed | 10 | 10 | 20 | BAN, ARABIC, QURAN, ISLAM |
| Nuha Kalam Tamany | 10 | 7 | 17 | ENG, MATH, SCI, QURAN |
| Uesuf Hasan Maruf | 0 | 16 | 16 | MATH, SCI |
| Sajeda Jannat | 10 | 5 | 15 | MATH, ARABIC, BAN |
| Afia Loskor | 10 | 5 | 15 | QURAN, ARABIC |
| Mariam Begum | **15 / 15** | **0** | 15 | QURAN, ARABIC |
| Mahmudur Rahman Tazkir | 0 | 15 | 15 | ENG |
| MD Akbor Hussein | 10 | 5 | 15 | QURAN |
| Zarir Fazlullah | 0 | 14 | 14 | ENG, BAN |
| Husne ara Rahman Fida | 0 | 13 | 13 | MATH, ENG, SCI |
| Kawsar Hossain | 0 | 13 | 13 | BGS, BAN |
| Hamida Akter | 10 | 2 | 12 | BGS, BAN, MATH |
| **Total** | **105** | **120** | **225** | mean 16.1 |

### The structural finding: two pools of unusable time

Because most Quran teachers cannot take general subjects and vice versa:

- **75 idle morning periods/week** sit with the five general-only teachers (Maruf,
  Tazkir, Zarir, Fida, Kawsar), each free for the whole of P1–P3.
- **75 idle afternoon periods/week** sit with the Quran/Arabic teachers — Mariam alone
  has 20, teaching nothing after P3.

Overall utilisation is **225 of 490 possible periods = 46%**, yet the morning window has
no float at all. **Aggregate headcount is not the constraint; track and concurrency are.**

Genuine crossovers are only three: Mahfuj (Bangla + Quran + Arabic), Nuha (Eng/Math/Sci
+ Quran), Sajeda (general + Arabic). Momin and Kuddus cross only into Islamiat.

---

## 3. July 2026 — absence and cover

July had **22 school days** (Sun–Thu; Fridays 3/10/17/24/31 and Saturdays 4/11/18/25 off).

### Approved leave

| Teacher | Calendar days | School days | Applications |
|---|---|---|---|
| Md Abdul Momin | 4.00 | 3 | 07-11→14 |
| Husne ara Rahman Fida | 3.33 | 3.33 | 07-07, 07-21, 07-26, 07-28 (½-day) |
| Md Abdul Kuddus | 3.00 | 2 | 07-06, 07-06→07 *(duplicate)* |
| Hamida Akter | 3.00 | 3 | 07-12, 07-20→21 |
| Shah Mahfuj Ahmed | 3.00 | 2 | 07-18→20 |
| Kawsar Hossain | 1.00 | 1 | 07-19 |
| Afia Loskor | 1.00 | 1 | 07-20 |
| Mahmudur Rahman Tazkir | 1.00 | 1 | 07-16 |
| **Total** | **19.33** | **≈17.33** | 8 of 14 teachers; 4 more cancelled/rejected |

**Absence rate = 17.33 / (14 × 22) = 5.6% of teacher-days.**

### Cover outcome — 55% success

67 distinct class meetings lost their teacher (62 in July):

| Status | Meetings | Share |
|---|---|---|
| Cover approved | 36 | **54%** |
| `needs_cover` — nobody found | 24 | 36% |
| `proposed` — never confirmed | 7 | 10% |

By absent teacher:

| Absent | Meetings | Never covered |
|---|---|---|
| Md Abdul Momin | 20 | 3 |
| Shah Mahfuj Ahmed | 20 | 16 unconfirmed |
| **Md Abdul Kuddus** | 16 | **12** |
| Husne ara Rahman Fida | 7 | 2 |
| Hamida Akter | 7 | 5 |
| **Afia Loskor** | 6 | **5** |
| Mahmudur Rahman Tazkir | 3 | 3 |
| Kawsar Hossain | 3 | 0 |

Cover taken (proposed or approved): Afia 7, Akbor 5, **Akter Hossen 5**, Nuha 5,
Mahfuj 4, Hamida 3, Kuddus 3, Momin 1, Fida 1, Kawsar 1, Sajeda 1.

### Why the failures cluster on the religious track

All five Quran groups run simultaneously at P1–P2 and all five Arabic groups at P3. When
a Quran or Arabic teacher is absent, every colleague who could replace them is already
teaching. The uncovered lessons are exactly Kuddus's, Afia's and Momin's Quran/Arabic
periods.

**The Arabic P3 wall.** The seven teachers free at P3 are Maruf, Zarir, Tazkir, Fida,
Kawsar, Hamida and Akbor — **not one teaches Arabic**. Of ~13 Arabic lessons hit by
absence in the record, 5 were covered, and **4 of those 5 by Akter Hossen**, who is not
supposed to take classes; the fifth by Akbor, a Quran-only teacher. The rest went
uncovered. Arabic currently has no cover capacity of its own at all.

---

## 4. Announced changes → September 2026

| Change | Effect on the routine |
|---|---|
| Hamida Akter leaves after August | **−12 periods** |
| Tanjila Akter Jerin returns mid-August | **+capacity** (she holds 0 periods today) |
| Rubina Khanam, Mahzabin Yasmin | unavailable — no capacity to redeploy |
| Masrura Akther Sarah | holds 0 periods; return is capacity-neutral either way |

Teaching establishment: **14 now → 15 mid-August → 14 from September.** Flat.

### Reallocating Hamida's 12 periods

Jerin teaches Quran, lower-level Bangla and can cover BGS; **not Arabic**.

| Hamida's slots | Reassign to |
|---|---|
| নার্সারি Bangla, P1 × 5 | **Jerin** — lower-level Bangla, exact fit |
| Class 3 BGS, P8 × 2 (Tue, Thu) | **Jerin** — P8 does not collide with her morning work |
| কেজি Maths, P2 × 5 | **Fida** (13 → 18). Alternatives: Maruf (16 → 21), Nuha (17 → 22) |

Jerin's return (mid-August) overlaps Hamida's departure (end of August) by about two
weeks — **use it for handover**.

At 7 periods Jerin has spare morning capacity. Recommended use: **leave 3–5 morning
periods unassigned as a standing Quran cover reserve** rather than filling her
timetable. With a 46% cover-failure rate, reserve is worth more than taught periods.
If the capacity must be used, take a Quran group off **Momin** (24/week, the heaviest,
and saturated at 15/15 in the morning).

### What the reallocation does not fix

Jerin adds an eighth Quran-capable body but **cannot teach Arabic**. The P3 wall is
untouched, and the person propping it up is scheduled to stop taking classes.

**Recommendation: recruit one Arabic-capable teacher (Arabic + Quran preferred).** This
is a redundancy hire, not a capacity hire — it adds no new periods, it makes the 35
existing Arabic periods coverable.

Standing fragilities after September:

- **BGS** — 6 periods, only Kawsar and Jerin.
- **English** — 35 periods over 4 teachers, 10 of them held by **Zarir Fazlullah**, who
  is part-time, on probation since 2026-07-01, and class teacher of Class 1.

---

## 5. Forecast: adding Class 6

Class 6 adds no students — this year's Class 5 promotes into it. It adds a **class
level**: 4 general periods/day × 5 days = **+20 periods/week**. Quran and Arabic are
unaffected; Class 6 students join the existing cross-grade groups.

| | Now | With Class 6 |
|---|---|---|
| Weekly periods | 225 | **245** |
| Concurrent at P5/P6 | 7 | **8** |
| Concurrent at P7/P8 | 5 | **6** |
| Mean load on 14 staff | 16.1 | 17.5 |

**Recruit 1 general-subject teacher.** The 14 could absorb 17.5 periods each on paper,
but only **2–3 general-capable teachers are free at P5/P6** (the Quran teachers free
then cannot take general subjects). Class 6 consumes one of those.

**Contingency +1.** The school runs Hifz 1 and Hifz 3 but no Hifz 2. As students
progress a sixth Quran level is likely; that is +10 periods and a **sixth simultaneous
group at P1/P2**, requiring a sixth Quran teacher.

---

## 6. Forecast: boys/girls section split, Classes 1–6

Splitting one class into two sections **doubles its general teaching: +20 periods/week**
and adds **one simultaneous group at P5–P8**. A new full-time general teacher carries
about 20 periods. The rule is therefore **one teacher per class split**.

### Class sizes next year

This year's roster promoted one level (new Nursery intake not modelled):

| Next year | Students | Boys / Girls | If split |
|---|---|---|---|
| KG | 21 | 10 / 11 | — |
| Class 1 | 12 | 7 / 5 | 7 + 5 |
| Class 2 | 7 | 3 / 4 | **3 + 4** |
| Class 3 | 14 | 8 / 6 | 8 + 6 |
| Class 4 | 17 | 9 / 8 | 9 + 8 |
| Class 5 | 12 | 7 / 5 | 7 + 5 |
| Class 6 | 8 | 4 / 4 | **4 + 4** |

### Incremental establishment

Baseline: **14 teaching staff** (September 2026, Jerin in, Hamida out).

| Step | Weekly periods | Concurrent P5/P6 | Staff needed | **Cumulative hires** |
|---|---|---|---|---|
| Class 6 added, all combined | 245 | 8 | 15 | **+1** |
| + Class 6 split | 265 | 9 | 16 | **+2** |
| + Class 5 split | 285 | 10 | 17 | **+3** |
| + Class 4 split | 305 | 11 | 18 | **+4** |
| + Class 3 split | 325 | 12 | 19 | **+5** |
| + Class 2 split | 345 | 13 | 20 | **+6** |
| + Class 1 split (all six) | 365 | 14 | 21 | **+7** |

Add **+1 Arabic teacher** (§4) to any row — that hire is independent of the split.

### Three qualifications

1. **Top-down is the least efficient order.** Splitting Class 6 (4 + 4) and Class 2
   (3 + 4) costs a full teacher each to produce sections of three and four students.
   **Classes 4 (9 + 8) and 3 (8 + 6) are the only splits where both halves stay
   viable** — splitting those two costs 2 hires instead of 6 for most of the benefit.
2. **If separation extends to the Quran/Arabic groups, the cost roughly doubles.** Five
   Quran groups and three Arabic groups are currently mixed (Book 2 is already
   boys/girls). Splitting them gives **10 simultaneous Quran classes at P1/P2** and 8
   Arabic at P3 — **+65 periods** and **+3 to +4 religious teachers**, in the one track
   that already cannot cover a single absence. Full separation across sections *and*
   subject groups lands at roughly **25 teaching staff for ~95 students (≈4:1)**.
3. **Rooms are not modelled.** 14 simultaneous groups at P5/P6 needs 14 rooms; the
   system holds no room records and cannot tell you whether they exist.

**Note:** Classes 3, 4 and 5 already had Boys/Girls sections. They remain in the
database, deactivated, superseded by the "ALL" sections on 2026-06-15. Re-splitting can
reuse those rows rather than creating new ones, preserving historical student links.

---

## 7. Recommendation summary

| Priority | Hire | Why |
|---|---|---|
| 1 (now) | **Arabic-capable teacher** (Arabic + Quran) | 35 Arabic periods, 5 groups all at P3, zero float, currently propped up by a teacher who is to stop taking classes. Jerin cannot relieve it. |
| 2 (next year) | **General-subject teacher** | Class 6 adds 20 periods into the already-tight P5–P8 window. |
| 3 (conditional) | **Quran teacher** | Only if a sixth Quran level (Hifz 2) opens. |
| 4 (per split) | **1 general teacher per class split** | +20 periods each. Prioritise Classes 4 and 3. |

Non-recruitment levers, in order of value:

1. **Move one Quran or Arabic group out of P1–P3 into the afternoon.** This converts
   part of the 150 idle periods into real cover capacity at zero salary cost, and is
   the only change that attacks the root cause.
2. **Keep a standing morning reserve** (Jerin's spare capacity) instead of a full
   timetable.
3. **Configure leave entitlements** so leave stops being recorded wholly as LWP.
4. **Run the biometric attendance import**, so absence analysis stops depending on
   leave applications alone.
