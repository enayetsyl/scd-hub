# PRD — Saturday Revision SR-1: Models + entry + reads (server)

**Status:** Planned — build contract (slice 1 of 4). No feature code yet.
**Owner:** Principal (SCD) · **Module prefix:** SR · **Plane:** identity (ADR-005)
**Source REQ:** `docs/saturday-revision-requirements.md` (LOCKED) · **Traceability:** D-#197–#201 (REQ) · **new D-#241–#243** · ADR-005/008 · D-#48/#56/#50/#85/#17/#94/#145

> The per-juz Saturday Hifz revision record — the foundation the delivery, analytics, and app build on.

## §0 — At a glance
- [ ] **`RevisionEntry`** (one per student × Saturday) carrying a **list of `juzRecords`** (per-juz
  category / amount / تنبিه/فتহ / structured tajweed-mistake counts) — the REQ §4 model verbatim.
- [ ] **Reuses, builds NOTHING new for grouping/roster/calendar:** the Quran **`SubjectGroup`**
  (track=quran, level Hifz 1/2/3, gender-split, D-#48/#56) is the halaqa; **`SubjectGroupMembership`** is
  the roster; the **`QURAN_ONLY` Saturday** day-type (D-#50) is the revision day. **Hifz levels only.**
- [ ] Teacher records/edits their group's entries; **editable until delivered, then immutable** (the CM-1
  posture — SR-2 seals it; D-#242). Reuses `tracker:write` + Quran-group scope (**no new permission**).
- [ ] Vocab-toucher (additive): revision categories + mistake categories. Server-only; identity plane.

## §1 — Goal
Replace the paper শিক্ষার্থীর পাঠ সম্পাদন রিপোর্ট with a per-group grid: the teacher records each Hifz
student's present/absent + per-juz revision (Sabaq/Sabqi/Manzil, the juz heard, amount, تنبিه/فতহ, mistake
counts) + a comment, roster-bound to the real child — so every effort and mistake is **attributed to a juz
number**, which is what makes the SR-3 weakness analytics possible. SR-1 = the store + entry + the grid reads.

## §2 — Scope boundary
| In SR-1 | NOT SR-1 |
|---|---|
| `RevisionEntry` + `juzRecords` model; record/edit; derived per-student/per-group grid reads; vocab; firewall | Guardian delivery + Saturday trigger → **SR-2** |
| Binds to the Quran `SubjectGroup` + `QURAN_ONLY` calendar | Analytics (heatmap/coverage/trend/dashboards) → **SR-3** · the Expo app → **SR-4** |

## §3 — Data model (identity plane; no `schoolId`)
**`RevisionEntry`** — one per (student × Saturday):
`{ groupId (Quran SubjectGroup _id), studentId, date (a QURAN_ONLY Saturday), present: boolean,
juzRecords: JuzRecord[] (empty when absent), teacherComment?, teacherUserId, deliveredAt?,
deliveryChannels[], createdAt, updatedAt }`. Unique `(studentId, date)`. Permanent — never deleted (the
per-juz history feeds SR-3).
**`JuzRecord`** (embedded): `{ juz: 1–30, category ∈ REVISION_CATEGORIES (SABAQ | SABQI | MANZIL),
amountJuz: number (>0, e.g. 0.25/0.5/1), tanbih: number (≥0), fath: number (≥0), mistakes: { harf, ghunnah,
madd, other } (each ≥0), note? }`. A Manzil of 1.5 juz over juz 1–2 → two JuzRecords (juz 1 @ 0.5, juz 2 @
1.0), each with its own counts (REQ §4).

**`RevisionService`:**
- `recordEntry`/`editEntry` — **the group + date are validated server-side** (the group is a Hifz-level
  Quran `SubjectGroup`; the date is a `QURAN_ONLY` Saturday via the D-#50 `resolveDayType` — the ONE
  calendar truth, no second calendar); the student must be an active `SubjectGroupMembership` of the group;
  `present=false` ⇒ `juzRecords` empty; each JuzRecord validated (juz 1–30, amount>0, counts ≥0).
  **Author + immutable-after-deliver (D-#242):** the recording teacher authors it; once `deliveredAt` is
  set (SR-2) the entry is immutable (a correction is a fresh Saturday's record / pre-delivery edit) — the
  CM-1 posture. Audited `SR_REVISION_RECORDED`.
- Derived reads (the grid): `groupSaturday(groupId, date)` (the group's roster × that Saturday's entries —
  the entry grid), `studentRevisionHistory(studentId)` (newest-first), `myRevisionGroups` (the teacher's
  Hifz groups). Never stored aggregates (SR-3 owns analytics).

**Audit kinds** (Audit.ts): `SR_REVISION_RECORDED`.

## §4 — Vocabulary (app-native; additive; BN+EN; NO wire sync — REQ §10)
- `REVISION_CATEGORIES = [SABAQ, SABQI, MANZIL]` + BN/EN labels (নতুন মুখস্ত / সর্বসাম্প্রতিক পাঠ / পুরনো রিভিশন).
- `REVISION_MISTAKE_CATEGORIES = [HARF, GHUNNAH, MADD, OTHER]` + BN/EN labels (হরফে সমস্যা / গুন্নাহ / মাদ / অন্যান্য).
- New verifier section: both enums exact + label-total. **`NOTIFICATION_KINDS`/MT keys are NOT touched here**
  (delivery is SR-2 — keeps SR-1's vocab footprint to the two entry enums). No new permission.

## §5 — RBAC — reuses existing, no new permission (D-#17/#94)
- `recordEntry`/`editEntry` = **`tracker:write` + the student's Quran-group scope** (the teacher assigned to
  the Hifz group; the routine D-#56 slot/assigned teacher — the same Quran-group reach the vocab/attendance
  trackers use). Office/Principal admin via their existing reach. Guardian denied (no entry UI).
- Reads = `tracker:read` + group scope (teacher), unscoped for Office/Principal. No new permission.

## §6 — Journeys (Given/When/Then)
- **J-SR1-1 (entry).** *Given* a `QURAN_ONLY` Saturday + a Hifz group the teacher leads, *when* they mark a
  student present and add per-juz records (category/juz/amount/تنبিه/فতহ/mistakes) + a comment, *then* the
  `RevisionEntry` persists (unique per student×Saturday) and the child's history updates.
- **J-SR1-2 (absent).** *When* a student is marked absent, *then* the entry stores `present=false` with no
  juzRecords (the SR-2 absent alert keys off it).
- **J-SR1-3 (per-juz split).** *Given* a 1.5-juz Manzil over juz 1–2, *then* two JuzRecords (juz 1 @ 0.5,
  juz 2 @ 1.0) are stored, each with its own counts — the per-juz attribution SR-3 aggregates.
- **J-SR1-4 (edit then sealed).** *When* the teacher edits before delivery, it updates; once delivered
  (SR-2), the entry is immutable (J-SR1 correction = next Saturday / pre-delivery).
- **J-SR1-5 (scope deny).** *Given* a teacher without that Quran group, *when* they try to record for it,
  *then* it is denied (Bangla); only the group's teacher (+ Office/Principal) may.
- **J-SR1-6 (firewall).** The corpus plane cannot resolve `RevisionEntry`; firewall green both ways.

## §7 — Out of scope (SR-1)
Guardian delivery / Saturday trigger (SR-2) · analytics (SR-3) · the app (SR-4) · Qaida/Ammapara/Najera
(Hifz only) · Arabic/Section subjects · curriculum planning (records what was heard, never schedules) ·
the one-time old-71-sheet import adjustment (a migration task, REQ §4 — not a code path here).

## §8 — Reused / unchanged
Quran `SubjectGroup` + `SubjectGroupMembership` + the `QURAN_ONLY` D-#50 calendar (D-#48/#56/#50) · the
student roster (foundation) · `tracker:write`/`tracker:read` + Quran-group scope (no new role/perm) ·
append-only audit (ADR-008) · identity-plane firewall (ADR-005) · single-school (no `schoolId`).

## §9 — Firewall (ADR-005)
`RevisionEntry` + `RevisionService` are identity-plane (keyed by studentId/groupId); no corpus path either
way; a new saturday-revision firewall block (corpus ⇄ SR) keeps NFR-11 green.

## §10 — Acceptance gate (build verifies — executed)
1. `RevisionEntry`/`JuzRecord` store; group+date+membership validated server-side (QURAN_ONLY Saturday via
   the ONE calendar); present⇒records / absent⇒none; per-juz split; unique per student×Saturday; immutable
   after deliver. `REVISION_CATEGORIES`/`REVISION_MISTAKE_CATEGORIES` verifier green.
2. RBAC tracker:write + Quran-group scope (J-SR1-5 deny tested); firewall both ways green. Full gate:
   verifier PASS, shared+server tsc, jest all-green (+ `revision.test.ts`). Server-only.

## §11 — Traceability & decision band
- **Builds on:** D-#197–#201 (REQ). **Reaffirmed:** D-#48/#56 (Quran SubjectGroup), D-#50 (one calendar),
  D-#85, D-#17/#94 (no new role/perm), D-#145.
- **New — D-#241–#243:**
  - **D-#241** — `RevisionEntry` (one per student×Saturday) holds a **list of `JuzRecords`** (per-juz
    category/amount/تنبিه/فতহ/structured mistake counts) — the REQ §4 per-juz model; bound to the Quran
    `SubjectGroup` roster + the `QURAN_ONLY` calendar; permanent (never deleted — SR-3 needs the history).
  - **D-#242** — an entry is **author-recorded + editable until delivered, then immutable** (the CM-1/CM-2
    posture; SR-2's `deliveredAt` seals it) — a correction is a pre-delivery edit or the next Saturday's record.
  - **D-#243** — SR-1 freezes the two entry enums (`REVISION_CATEGORIES`, `REVISION_MISTAKE_CATEGORIES`) +
    verifier; the delivery `NOTIFICATION_KINDS`/MT keys are SR-2's (kept out of SR-1's footprint). No new perm.
- **Next:** SR-2 (guardian delivery + Saturday trigger).
