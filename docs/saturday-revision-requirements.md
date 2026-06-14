# Saturday Revision Tracker (Qur'an Hifz) — Module Requirements (REQ)

_Status: PLANNED (requirements only — no build). Owner: Principal (SCD). Created: 2026-06-14._
_Type: module-level REQ (what/why/scope + sub-slice map). Slice-level journeys + acceptance live in the per-slice PRDs (SR-1…SR-4), authored one at a time after this REQ is approved._
_Module prefix: **SR**  ·  Plane: identity (ADR-005)._

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — this tracks the children's Qur'an (an amanah); accuracy and traceability over convenience.

## Scope checklist (read first)

- [ ] **In:** the weekly **Saturday Hifz revision record** — per student × Saturday: present/absent, the three revision types (Sabaq / Sabqi / Manzil) recorded **per juz**, with تنبيه/فتح counts and structured tajweed-mistake counts **attributed to a juz number**, plus the teacher's comment.
- [ ] **In:** guardian delivery on the existing rails (absent alert + weekly digest), Principal analytics (per-juz weakness, coverage/rotation, weekly trends, level-wise & student-wise dashboards, bar/line charts), and teacher-completeness chasing.
- [ ] **Reuse, don't rebuild:** the **Quran `SubjectGroup`** (routine module, D-#48/#56) is the halaqa/level; **`SubjectGroupMembership`** is the roster; the **`QURAN_ONLY` Saturday** day-type (D-#50) is the revision day. No new grouping, roster, or calendar.
- [ ] **Scope = Hifz levels only** (Hifz 1/2/3). Pre-Hifz Quran levels (Qaida / Ammapara / Najera) do **not** do juz-memorized revision and are **out** (v1).
- [ ] **Out:** Arabic groups; general `Section` subjects; payroll/HR; anything off the identity plane.
- [ ] **One school**, no branch dimension. Identity plane only (ADR-005). Reuse teacher/Office/Principal/guardian RBAC (no new role).

## 1. Goal

Replace the paper **শিক্ষার্থীর পাঠ সম্পাদন রিপোর্ট** ("student's lesson-completion report," filled every Saturday — প্রতি শনিবার পূরণ করতে হবে) with a purpose-built tracker inside the app. Today each Hifz student's Saturday revision (new memorization, recent lesson, old revision) is heard by a teacher and hand-recorded on a per-student sheet — تنبيه/فتح counts, tajweed-mistake notes, and a comment — then the paper is filed. The teacher instead records directly in the app (a per-group grid), which then notifies guardians (absent + weekly), drives the Principal's analytics, and — crucially — lets the school see **which juz each student is weak in** by attributing every mistake to a juz number.

This is a **per-juz revision-quality record**, not a curriculum planner. It mirrors the school's existing Saturday Hifz discipline; it does not assign or schedule what to revise (that stays with the teacher).

## 2. Gap table (today → target)

| Area | Today (paper sheet) | Target (app) | Key gap to close |
|---|---|---|---|
| Entry | Teacher hand-writes one sheet per student | Per-group weekly grid, roster-linked | One screen per Hifz group; ID-linked, not free-text names |
| Student ID | আই ডি নং left blank | Bound to the real roster via `SubjectGroupMembership` | Permanent per-child history |
| Revision detail | One تنبيه/فتح count per row (Sabaq/Sabqi/Manzil) | Recorded **per juz** within each row | Per-juz attribution of effort + mistakes |
| Mistakes | হরফ/গুন্নাহ/মাদ/অন্যান্য as free-text | Structured counts per category, **per juz** | "Most common error / weakest juz" becomes analyzable |
| Manzil amount | Varies per student (1.5 vs 2 juz), implicit | Explicit `amountJuz` per juz record | Individual revision load tracked, not level-fixed |
| Absence | "অনুপস্থিত" circled on the sheet | Present/absent flag → guardian alert | Automatic absent notification |
| Guardian comms | None (paper filed) | Weekly digest + absent alert on the rails | Families see each Saturday's outcome |
| Analysis | None (paper) | Per-juz weakness heatmap, coverage/rotation, weekly trends, level/student dashboards, charts | Replace "no visibility" with derived analytics |
| Completeness | Manual | Office sees which groups weren't entered + can chase | No silent gaps |

## 3. Reference data (finalized in SR-1 against live code + glossary)

- **Groups (the halaqa = the level):** Quran `SubjectGroup` with `track = quran`, `level ∈ {Hifz 1, Hifz 2, Hifz 3}`, **gender-split** (so "Hifz 1" may be two groups: boys + girls). Roster = `SubjectGroupMembership`. One halaqa per (level, gender). **No separate group-lead** — the recording teacher is the slot/assigned teacher (routine D-#56).
- **Day:** the `QURAN_ONLY` Saturday day-type (D-#50) — the single calendar truth; the revision day.
- **Revision categories (3):** **Sabaq** (নতুন মুখস্ত — new memorization), **Sabqi** (সর্বসাম্প্রতিক পাঠ — most-recent lesson), **Manzil** (পুরনো রিভিশন — old revision).
- **Juz dimension:** 1–30 (the unit of attribution).
- **Per-juz metrics:** **تنبيه / তানবীহ** (a hint/alert the listener gave) and **فتح / ফাতহ** (the teacher had to open/say the word) — both error/help counts, **lower is better**, "X"/0 = none. _(Semantics confirmed with the owner.)_
- **Tajweed-mistake categories (structured count + optional note, per juz):** **হরফে সমস্যা** (articulation), **গুন্নাহ** (nasalization), **মাদ** (elongation), **অন্যান্য** (other) — the sheet's তিলাওয়াতে উচ্চারণে ভুলের ধরণ table.
- **Amount:** `amountJuz` decimal per juz record (0.25 / 0.5 / 1 …) — captures "1.5 juz vs 2 juz" individually.
- **Attendance:** present / absent.
- **Teacher comment:** free text (the উস্তায/উস্তাযার মন্তব্য field) + recording teacher (authenticated, the sheet's name/signature dropped).

## 4. The record (per-juz model — the key data decision)

Per student × Saturday, the teacher records **a list of juz records**, not three single-count rows:
```
RevisionEntry { groupId, studentId, date, present, juzRecords[], teacherComment, teacherUserId }
  juzRecord = {
    juz:       1–30,
    category:  sabaq | sabqi | manzil,           // which revision type
    amountJuz: decimal,                          // 0.25 / 0.5 / 1 … (the portion of that juz heard)
    tanbih:    count,
    fath:      count,
    mistakes:  { harf, ghunnah, madd, other },   // structured counts
    note?:     free text
  }
```
A Manzil of 1.5 juz over juz 1–2 → two juzRecords (juz 1 @ 0.5, juz 2 @ 1.0), each with its own تنبيه/فتح + mistake counts. Different students → different records. Aggregating juzRecords **by juz number** across Saturdays yields the per-juz weakness heatmap, the coverage/rotation map, and the trend charts.

**Fitting the old 71 sheets:** the paper's single per-row count is attributed to the juz in that row's range (a multi-juz row's count split across, or assigned to the primary juz) — a **one-time import adjustment** (owner-acknowledged). New entries are clean per-juz from day one.

## 5. Sub-slice decomposition (build map — each is a separate planning session + PRD)

| Slice | Scope | Notes |
|---|---|---|
| **SR-1** | Models + entry + reads (server) | `RevisionEntry` + `juzRecords`; record/edit service; derived per-student/per-group reads for the grid; vocab; RBAC; audit; firewall. Binds to the Quran `SubjectGroup` + the `QURAN_ONLY` calendar. |
| **SR-2** | Guardian delivery + Saturday trigger (server) | Absent alert + weekly digest on the existing rails (wa.me + emit + push), MT-registry bodies, Saturday-triggered; consecutive-absence escalation to guardian + Principal. |
| **SR-3** | Analytics (server) | All **derived** (D-#85): per-juz weakness heatmap, coverage/rotation ("juz overdue for revision"), weekly تنبيه/فتح trend (↑/↓/→), level-wise & student-wise dashboards, mistake-type breakdown, completeness/overdue-chase. |
| **SR-4** | App (Expo) | Teacher per-group entry grid (per-juz), Principal dashboards with bar/line charts per metric, guardian card on GuardianHome. |

## 6. Roles

Reuse existing RBAC — **no new role or permission** (D-#17/#94 posture):
- **Teacher** — records/edits the Saturday revision for their Hifz group (`tracker:write` + the student's Quran-group scope).
- **Office** — reads, runs guardian delivery, chases groups not yet entered.
- **Principal** — reviews the analytics/dashboards; any period-lock controls per slice PRD.
- **Guardian** — no entry UI; receives the absent alert + weekly digest, and reads their own child's revision history (`guardian:read_child`, D-#68).

## 7. High-level journeys (REQ-level; detailed G/W/T per SR PRD)

- **J-SR1 — Teacher entry (Teacher):** *Given* a `QURAN_ONLY` Saturday and a Hifz group, *when* the teacher opens the group grid and, per student, marks present/absent and records the per-juz revision (category, juz, amount, تنبيه/فتح, mistake counts) + a comment, *then* the entries persist and each child's history updates.
- **J-SR2 — Absent alert (Office/Teacher):** *Given* a student marked absent, *when* the entry is submitted/delivered, *then* the guardian receives an absent notification on the rails.
- **J-SR3 — Weekly digest (Office/Teacher):** *Given* a completed Saturday entry, *when* delivered, *then* each present student's guardian receives a weekly digest (portions heard, تنبيه/فتح, mistake summary, teacher comment) on the rails.
- **J-SR4 — Per-juz weakness (Teacher/Principal):** *Given* a student's accumulated entries, *when* the dashboard opens, *then* a per-juz weakness heatmap + coverage/rotation + weekly trend render (all derived).
- **J-SR5 — Level & metric analysis (Principal):** *Given* the live module, *when* the Principal opens the dashboard, *then* level-wise (group) and student-wise metrics, the mistake-type breakdown, bar/line charts per metric, and a "juz overdue for revision" list show — no paper.
- **J-SR6 — Completeness (Office):** *Given* a Saturday, *when* a Hifz group has no entry, *then* Office sees the gap and can chase the teacher (the AS-T4 "Office chases, never the teacher" posture).

## 8. Out of scope (v1)

- **Qaida / Ammapara / Najera** (pre-Hifz reading stages — revision is not juz-memorized; their cadence differs). Hifz levels only.
- **Arabic groups** and general `Section` subjects.
- **Curriculum planning / revision assignment** — the app records what was heard; it does not schedule what to revise (only surfaces "overdue").
- **Scanned-sheet attachments** — paper is retiring; if ever needed, reuse the GP-A/M-4 DriveStore (decided per SR PRD).
- Guardian self-entry; any online/self-service surface.
- Multi-branch / multi-school (single school, D-#145/#140 reaffirmed).

## 9. Reused / unchanged

- **Routine `SubjectGroup` / `SubjectGroupMembership` + the `QURAN_ONLY` calendar** (D-#48/#56/#50) — the halaqa, roster, and revision day. This tracker adds **no** grouping/roster/calendar.
- **Student roster + guardian links** (foundation) — entries link to existing students; the guardian read rides `guardian:read_child` (D-#68).
- **Notification rails** — wa.me to every family + in-app `emit()` + push for login-enabled guardians (D-#72/#31, ADR-003); **no new push system**.
- **Message Templates registry (MT-1 / D-#131)** — absent + digest bodies render from the registry; no inline strings.
- **Derived-never-stored** (D-#85) — all analytics computed read-time.
- **RBAC** teacher/Office/Principal/guardian (D-#17/#94) — no new role/permission.
- **Audit log** (ADR-008) — append-only entries on record/edit/deliver.
- **Identity plane** (ADR-005) — fails closed against the corpus/analytics plane.

## 10. Vocabulary & contract note (for the SR PRDs)

The Saturday Revision Tracker is an **app-native FEATURE**, not `doc_type` corpus content. Its enums (revision categories Sabaq/Sabqi/Manzil, recitation-mistake types হরফ/গুন্নাহ/মাদ/অন্যান্য, any `NOTIFICATION_KINDS` addition for the digest/absent kinds, and the MT keys) are added to `/shared/vocab.ts` with BN/EN labels **with NO import-envelope/wire sync expected** — serialize `vocab.ts` per AGENTS rule 5. **If any SR PRD ever touches a mirrored enum or the import-contract schema, that PRD must write the two-/three-place sync requirement (schema + `/shared/vocab.ts` + harness) into itself.** This REQ touches no vocab or schema files.

## 11. Traceability

- **New decisions:** D-#197 (module adopted), D-#198 (reuse Quran `SubjectGroup` + `QURAN_ONLY` Saturday; Hifz-only scope), D-#199 (per-juz recording model + old-sheet import adjustment), D-#200 (guardian delivery on the existing rails; absent + weekly + consecutive-absence escalation), D-#201 (reuse RBAC + app-native vocab, no new role/wire sync).
- **Reaffirmed:** D-#145/#140 (single school, no `schoolId`); D-#17/#94 (no new role/permission); D-#50 (one school-day calendar); D-#85 (derived, never stored); D-#72/#31 (delivery rails); D-#131 (MT registry); D-#68 (guardian read-child).
- **ADRs:** ADR-005 (PII firewall / plane split), ADR-008 (append-only audit), ADR-003 (manual wa.me send).
- **Related modules:** Routine (`SubjectGroup`, calendar — D-#48/#56/#50); Message Templates (MT-1 / D-#131); Notifications (N-1..N-4).

## 12. Firewall

All fields are on identity-plane models (`RevisionEntry` keyed by `studentId`/`groupId`); no corpus path is introduced. The NFR-11 fail-closed firewall test stays green; the SR build adds the new server files to the relevant block (corpus ↛ saturday-revision, both ways).
