# Dev test scenarios — Jan–Jun 2027 (the owner's 2-month+ test on the dev site)

Owner ask (23 Nov 2026): fake 2027 activity on the **dev site only** up to the end of June, built from the school's real
patterns, covering the practical situations the 2027 academic loop must handle. This file is (a) the spec for the
fake-data generator (`server/src/lib/devData/`) and (b) the testers' checklist: each scenario names where to look.

Source of the numbers: a read-only aggregate pass over the 2026 year on prod (23 Nov 2026; counts and rates only, no
identities). Dev runs on a masked copy (D-#1677) with the year changed to 2027; a dev-only clock (AL-14) makes "today"
a 2027 day.

## 1. Real 2026 patterns (the generator's base rates)

| Area | 2026 fact | Generator rule |
|---|---|---|
| Roster | 91 children: Nursery 21, KG 12, C1 7, C2 14, C3 17, C4 12, C5 8 (2026 classes; 2027 = moved up) | Use the real 2027 roster after the dev year change |
| Daily absence | mean 10.8 % (p50 10.5 %, p90 28.6 %) of a group; Sun 13.4 %, Mon 13.2 %, Tue 11.7 %, Wed 10.0 %, Thu 12.4 % | Per-day absence by weekday, ± noise |
| Absent days per child (183 days) | p25 12 · p50 21 · p75 38 · p90 63 · p95 80 | Each child gets an absence propensity drawn from this spread |
| Longest absence streak | p50 4 · p90 12 · p95 24 days | 1–2 children per class level get a long streak (illness / travel) |
| Homework record outcome | RETURNED/CHECKED 62 %, CHASE 24 %, ABSENT_REDELIVER 12 %, rest in flight | Per child a non-submission propensity: p50 19 %, p90 47 % |
| Homework size | 20 min (p90 30), 1–10 questions (p50 3) | Draft from the sessions taught, marks × 1.8 min |
| Homework per level × subject | ENG most (55–75/yr in C1–C5), MATH 26–66, BAN uneven (C2/C3 only 8–10!), ISLAM 5–16 | Keep the uneven mix (some subjects rarely give homework) |
| Assignment outcome | per child miss p50 8 %, p90 42 %; CHASE 15 %, ABSENT_REDELIVER 10 % | Propensity per child, correlated with homework |
| Class tests | 14 % absent on the test day; score mean 68 %; C3 mean 53 % (p10 19 %), Nursery 88 %; 16 % below pass; recheck 3 % | Score = child ability × subject difficulty × class level; C3 weakest |
| Class notes | ~6 h after the period; per teacher 30–378 a year (very uneven) | Teacher diligence persona |
| Staff leave | 161 applications: casual 73 %, sick 20 %, unpaid 5 %; per app 1 day (p90 3); per teacher p50 6 d, p90 21 d | Teacher leave persona; covers ~40/month |
| Staff mistakes (most) | HW pass skipped 42, CT marks overdue 33, AS unmarked 33, class-note change 40, mark correction 24 | Late/forgetful teacher personas |

## 2. Calendar Jan–Jun 2027 (dev only; real closures — no national-day themes in content, owner rule)

School week Sun–Thu (Saturday Quran only). Dates below are **assumptions for the test** — the Office edits the real ones.

| When | What | Effect |
|---|---|---|
| Sun 3 Jan | First school day of 2027 | Loop live (switch ON on dev) |
| Sun 21 Feb | Holiday | Closed |
| ~Tue 9 – Thu 18 Mar (Eid-ul-Fitr ≈ 10 Mar) | Eid break | Closed; assignment Thursday rolls; homework due rolls |
| Wed 14 Apr | Pohela Boishakh | Closed (mid-week holiday → delivery roll test) |
| ~Sun 16 – Thu 20 May (Eid-ul-Adha ≈ 17 May) | Eid break | Closed |
| Sun 6 – Thu 10 Jun | Half-yearly preparation | Pause ASSIGNMENT_GENERATION + ASSIGNMENT_CHASE; homework optional |
| Sun 13 – Thu 24 Jun | Half-yearly exams | Pause all four kinds; exam days are not teaching days (AL-11) |
| Sun 27 – Wed 30 Jun | Results, guardian meeting week | Term 1 ends 30 Jun (term 2 rules start 1 Jul) |

## 3. Scenario catalogue (each must produce data; testers check the "look at" column)

### Children
| # | Scenario | Data | Look at |
|---|---|---|---|
| C1 | Steady child | ~5 % absent, submits ~95 %, scores 80–95 % | Mastery: MASTERED after in-school answers; guardian "খুব ভালো" |
| C2 | Struggling child (esp. C3) | scores 30–50 %, 25 % non-submission | WEAK objectives, Part B weak items, extra homework, re-teach list |
| C3 | Improver | WEAK Jan → IMPROVING Mar → MASTERED May (needs a good class-test/CW answer) | Weak → improving moves on loop health; guardian "উন্নতি হচ্ছে" |
| C4 | Long illness | 2–3 week absence streak once | ABSENT_REDELIVER, "ক্লাস মিস" objectives, 1–2 easy items each (3 most recent), guardian home guide |
| C5 | Chronic absentee | 30–35 % absent all term | Attendance reports, missed lessons, no evidence → NOT_ASSESSED, class teacher follow-up |
| C6 | Homework skipper | 45 % CHASE, normal in class | Chase ladder, Principal late lists, weekly guardian message with low marks |
| C7 | Outside help at home | HW 85–95 %, CT 40–55 % on the same objectives | Integrity case → class teacher records "অভিভাবক করে দিয়েছেন" → staff tag + guardian gentle note for the term; one "অস্পষ্ট"; one "শিশু নিজে করেছে"; a recurring child (2 cases in term 1) |
| C8 | Late joiner | admitted mid-Feb into C2 | Roster, no history, first weeks NOT_ASSESSED, catch-up |
| C9 | Leaver | leaves in April | Records stop, past data stays |
| C10 | Absent on class-test day | 14 % per test | CT ABSENT rows, retest, CT-without-sheet warning when no sheet |
| C11 | Twins / siblings | one guardian, two children | Separate weekly message per child (GWSUM) |
| C12 | Gender-split শাখা | বালক/বালিকা sections | Each শাখা its own papers, history, drafts |

### Teachers
| # | Scenario | Data | Look at |
|---|---|---|---|
| T1 | Diligent teacher | notes same day, marks same day | Loop health green |
| T2 | Late marker | confirms HW 2–4 days late, AS after Tuesday | 09:30 marks-entered list, Principal card; quiet mistake rows from term 2 only (none in Jan–Jun) |
| T3 | Notes skipper | marks 50–60 % of periods | Loop health "periods marked", lesson-progress behind |
| T4 | Teacher on leave (casual/sick) | 1–3 day leaves, half-days; one 5-day sick leave in March | Substitute covers; deadlines move to first day back; finalise-on-leave by substitute/Office on a Wed/Thu |
| T5 | Behind syllabus | one শাখা × subject 2+ weeks behind its half-yearly target | "লক্ষ্য থেকে N সেশন পিছিয়ে", LPBEHIND notice to the Principal |
| T6 | Engine user vs hand-builder | most accept the Wednesday draft, some swap/remove/add, one builds by hand | Suggestion audit, swap card accepted by class teacher, NEEDS_REVIEW sheet resolved |
| T7 | Over-cap week | a 3-subject week over 360 min / a day over 180 | Finalise refusal naming the overage; trim |
| T8 | Re-teach | half the class below 50 % in class on one objective | MasteryAction proposed → planned → done with before/after |

### School / Office
| # | Scenario | Data | Look at |
|---|---|---|---|
| S1 | Holidays and roll | 21 Feb, 14 Apr (Wed), Eid breaks | Delivery/due rolls, ASDRAFT one school day earlier, no chase on closed days |
| S2 | Exam pause | 6–24 Jun pauses + exam routine | No drafts, no marking reminders, exam days not teaching days, half-yearly target read |
| S3 | Merged sections day | two শাখা merged for a day | Use history across sources |
| S4 | Print queue | Office prints Thursday sheets; one print cancelled | Locked items, re-print |
| S5 | Term targets | Office sets half-yearly targets for all C1–C5 subjects in December | On-track / behind column |
| S6 | Guardian side | weekly message Wednesday 18:00, ৮/১০ — ভালো, hints, ক্লাস মিস | Guardian app |
| S7 | Readiness | some pairs red (low stock, no hints), some green | Loop health → January readiness |

## 4. Generator shape (to build)
- `--until <YYYY-MM-DD>` (default 2027-06-30) instead of a fixed 8 weeks; the dev calendar of §2 is seeded first (dev-only
  holiday exceptions, pause windows, half-yearly exam + routine), tagged as config so `--remove` keeps or drops them by flag.
- A **persona** per child (C1–C7 spread so the class-level rates match §1) and per teacher (T1–T4), drawn with the run seed;
  every day: attendance by persona + weekday, sessions taught by teacher persona, homework given/handed in/marked by persona,
  Wednesday drafts → Thursday print → Sunday hand-in → Tuesday marking, class tests ~every 3 weeks per subject, CW now and then.
- Events of §3 placed on specific weeks so each scenario is guaranteed (listed in the run report with the children / teachers
  it used, so testers can find them).
- Writes through the services with the generator clock (devClock), muted emitters, every row tagged; residue 0 on `--remove`.
- The run report prints the achieved rates next to the §1 targets.
