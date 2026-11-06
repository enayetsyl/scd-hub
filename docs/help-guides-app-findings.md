# App findings from the whole-app help-guide walk (2026-11-06)

While capturing the help guides (prd-help-centre HC-5, D-#1022), the walks went through almost
every screen as each role. This is what they saw that looks wrong. No app code was changed for
any of these. The one exception is item T1, fixed in PR #1372.

Severity: **B** = a bug that blocks or misleads someone, **M** = mixed language or a wrong label,
**L** = layout or polish.

## Fixed

| # | Area | Finding |
|---|---|---|
| T1 | Assignment | **B** The teacher could not use the weekly gift report: no শাখা was selected and the pickers were hidden behind the server's refusal. **Fixed in #1372.** The pickers now always show and a class teacher's own শাখা is pre-selected. |

## Open — blocks or misleads

| # | Area | Finding |
|---|---|---|
| F1 | Finance | Fee collection, fee allocation, fee reminders, budget set/report and the finance dashboard ask for a raw **শিক্ষার্থী আইডি / শিক্ষাবর্ষ আইডি** (a database id that no screen shows). They need a student / year picker. Their 6 help guides wait as drafts until then. |
| F2 | Finance | **আমার পে-স্লিপ** shows deductions but not additions (বকেয়া, বোনাস), so the shown net does not add up. |
| F3 | Finance | The কর্মীর বেতন save button reads "বরাদ্দ সংরক্ষণ" (it reuses the leave-entitlement label). |
| N1 | Routine / cover | A period covered from কভার ব্যবস্থাপনা (routine side) still shows in কভার প্রয়োজন (leave side). The two cover lists do not update each other. |
| N2 | Routine | Saving in the master grid shows an English server warning: "Teacher has no prior teaching authority for ISLAM in this section; the routine slot now grants it." |
| N3 | Teaching assignments | বিষয়শিক্ষক নিয়োগ lists a subject twice when a manual grant and the routine both give it. |
| H1 | HR | The "প্রকাশের অপেক্ষায়" filter in সকল পর্যবেক্ষণ also lists observations that are only assigned, not reviewed. |
| H2 | HR | Opening an exit case hides the person from the staff list as "প্রাক্তন কর্মী" before their last working day. |
| H3 | HR | The কভার প্রয়োজন inbox lists the later date first. |
| P1 | Progress board | "+ নতুন কাজ" is missing when the board is opened from রিপোর্ট → শিক্ষার্থীর অগ্রগতি. The route is only registered in the ClassTest stack. |
| E1 | Class test | The publish page keeps **অনুমোদন ও প্রকাশ / ফেরত পাঠান** active after the results are already published. |
| E2 | Question sets | Picking the শাখা in "সেট তৈরি করুন" closes the sheet; the teacher must tap it again. |
| A1 | Attendance | উপস্থিতির দায়িত্ব sometimes shows "কিছু পাওয়া যায়নি" for the class list on the first visit, until reloaded. |
| A2 | Assignment | The rotation schedule shows the term start one day early (a 2026-01-01 anchor reads 2025-12-31). |
| C1 | Lesson plans | Office holds `lesson_plans:view_all` and `import` but not `lesson_plans:view`, so the পাঠ পরিকল্পনা menu item is hidden for them: they can import plans but not open them. |
| C2 | Book production | The whole sidebar group is hidden (owner ask 2026-10-04), so no guide was written. |
| G2 | Guardian | Guardians have no change-password screen; the guide sends them to the school. |
| S1 | Admin | AI key screen shows the last four characters of the key in use (by design). Capture runs must set `GEMINI_API_KEY=dummy`. |

## Open — English, codes or developer text on Bangla screens

| # | Where | What shows |
|---|---|---|
| L1 | Print request / queue | Purpose chips (Classwork, Homework…), Black & white / Colour, Single side / Both sides; queue cards show CLASSWORK / OTHER |
| L2 | Access control, users | Role codes PRINCIPAL / TEACHER / OFFICE; permission rows carry English descriptions |
| L3 | শ্রেণি শিক্ষক নির্ধারণ, অভিভাবক নোটিশ | "(handoff §9)", "(ADR-003)" |
| L4 | ঘণ্টা সূচি | a raw "অডিয়েন্স কী (যেমন class_1_5)" field |
| L5 | Audit log | raw meta such as "requestedBy: <id> · copies: 6 · copiesSource: fixed" |
| L6 | Monthly report | raw status DRAFT / READY, and the AI model name above the draft |
| L7 | Offboarding | the default clearance checklist is in English |
| L8 | Question set finalise | the label DURATION_MINUTES |
| L9 | Scholarship declare | item ধরন shows raw codes (short_answer) |
| L10 | Many date fields | the web placeholder "Choose a date" |
| L11 | Routine, bell schedule, master grid, class notes, pay run header, own payslip | Latin digits (times, P1–P8, "দেখানো হচ্ছে 3", "2026-09", সংযুক্তি 0/5) |

## Open — labels and layout

| # | Where | What |
|---|---|---|
| U1 | Observation upload | "পর্যবেক্ষকের আইডি (ঐচ্ছিক)" is really a name picker; the subject select shows "ফর্ম নির্বাচন করুন" |
| U2 | Qard, fee support | name pickers labelled "পক্ষ আইডি", "সহায়তাদাতা আইডি" |
| U3 | Leave, offboarding, grievance filters | the "all" chip reads "সব ক্যাটাগরি" |
| U4 | Vocab tester form | the teacher picker label repeats the submit text "টেস্টার নির্ধারণ করুন" |
| U5 | Saturday revision grid | the sent badge overflows beside the name and repeats under it |
| U6 | ক্লাস নোট জমা | "রিসেট" runs off the right edge on a phone; the SMS column prints the phone twice |
| U7 | Routine edit dialog | the title does not name the শাখা |
| U8 | Class note | "সেশন সংশোধন" shows on subjects that have no lesson plan |
| U9 | Notice শাখা chip | shows "বালক" with no class name |
| U10 | Question sets list | a draft set shows "০ নম্বর" until it is finalised |
| U12 | নোট আপলোড | the title and subtitle run together ("নোট আপলোডশ্রেণি ও বিষয়…") |
| U13 | Section pickers | English codes "(Main)", "(Boys)" next to the names |
| U11 | Salary-sent card | says the notification carries each person's amount; check it against the owner ruling (pop-up has no amount) |

When you fix any of these, update the matching help guide in the same PR (D-#973).
