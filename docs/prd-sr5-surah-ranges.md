# PRD — Saturday Revision SR-5: surah:ayah ranges replace per-juz records

**Status:** Planned — build contract (amends SR-1, SR-3, SR-4). Owner rulings 2026-10-24.
**Owner:** Principal (SCD) · **Module prefix:** SR · **Plane:** identity (ADR-005)
**Builds on:** SR-1..SR-4 (`docs/prd-sr1.md` … `docs/prd-sr4.md`) · **Traceability:** D-#833–#838 (supersede
D-#241's `JuzRecord` and the juz-storage parts of D-#246)

> Teachers write what was heard ("বাকারা ১৭৩–১৮১", "নাবা – নাযিয়াত"), never a juz number. Store exactly that,
> and work the juz out when a report needs it.

## §0 — At a glance
- [ ] Each portion = **category + start (surah:ayah) → end (surah:ayah) + status + তানবীহ/ফাতহ + mistake
  counts + note**. No juz number and no `amountJuz` are stored; both are derived from the range.
- [ ] A fixed **Quran reference table** in `/shared/quran.ts`: 114 surahs (Bangla name, Arabic name, ayah
  count) + the 30 juz start points, with pure helpers (juz of an ayah, ayahs in a range, split by surah /
  by juz, Bangla range text).
- [ ] **Status per portion:** COMPLETED / PARTIAL / NOT_DONE / FAILED (the paper's "সবক হয়নি",
  "অকৃতকার্য", "একটি আয়াতও পড়তে পারেনাই").
- [ ] **Mistakes stay counts** per type, entered with one-tap +1 counters.
- [ ] **One teacher per entry** (the recorder). No co-teacher field.
- [ ] Reports are **provisional** (owner will revise): weakness by surah and by juz (both derived), juz
  coverage/overdue, weekly trend incl. new-lesson ayahs, status counts.
- [ ] Data: **all existing `RevisionEntry` rows are deleted**; the Jan–Apr 2026 paper sheets are
  back-filled with dates snapped to the Saturday, never delivered to guardians.

## §1 — Why (evidence from 143 paper sheets, 2026-01 … 2026-04)
- Portions are always written as surah names / ayah ranges / a para number. A juz number is never written,
  and an amount is never written.
- Two cohorts: the juz-30 group (surah names, often 2–3 per row; old revision as a surah range) and the
  Baqara group (Baqara ayah ranges; old revision as "২৬ তম পারা").
- Some rows hold two separate portions ("২৬ পারা + বাকারা ১–৭৬").
- "Not done" / "failed" is common and had no home in the SR-1 model.
- The mistake table is filled on 9 of 143 sheets, mostly with ticks.

## §2 — Data model (`RevisionEntry`, identity plane)
`RevisionEntry` keeps `{ groupId, studentId, date, present, teacherComment?, teacherUserId, deliveredAt?,
deliveryChannels[] }` and the unique `(studentId, date)`. `juzRecords` is **removed** and replaced by:

**`portions: RevisionPortion[]`** (empty when absent; several per category allowed):
```
{ category  ∈ REVISION_CATEGORIES (SABAQ | SABQI | MANZIL),
  status    ∈ REVISION_PORTION_STATUSES (COMPLETED | PARTIAL | NOT_DONE | FAILED),
  fromSurah 1–114, fromAyah 1–ayahs(fromSurah),
  toSurah   1–114, toAyah   1–ayahs(toSurah),
  tanbih ≥ 0, fath ≥ 0, mistakes { harf, ghunnah, madd, other } (each ≥ 0), note? }
```
Rules: the range is in mushaf order (start ≤ end). It may cross surahs and juz. The four range fields
are required, except that a **NOT_DONE** portion may carry no range (the paper's bare "সবক হয়নি"); then
all four are omitted together. Counts are allowed on every status (sheets record counts on unfinished
rows).

## §3 — Quran reference (`/shared/quran.ts`)
- `SURAHS`: `{ n, bn, ar, ayahs }` × 114 — ayah counts from quran.com (`api/v4/chapters`, total 6,236),
  Bangla names from Bangla Wikipedia "কুরআনের সূরার তালিকা" (short form, without "আল"/"সূরা"; a few
  normalised to the school's spelling: আলে ইমরান, যুমার, শূরা, দোহা). **Owner to review the spellings.**
- `JUZ_STARTS`: 30 `[surah, ayah]` pairs (quran.com `api/v4/juzs`).
- Helpers: `ayahIndex`, `juzOf`, `rangeAyahCount`, `splitRangeBySurah`, `splitRangeByJuz`,
  `rangeJuzAmount` (Σ ayahs-in-juz ÷ ayahs-of-that-juz), `wholeJuzRange(j)`, `formatRangeBn`.
- App-native reference data, not a wire-contract enum (no schema twin). The status enum lives in
  `/shared/vocab.ts` with a verifier section like D-#243's.

## §4 — Derived reports (provisional, D-#837)
- **Counts across a range are split by ayah share** — Naba 1 → Naziat 46 with 6 তানবীহ gives
  Naba 40/86 × 6 and Naziat 46/86 × 6 (kept to 2 decimals). The same rule gives the per-juz split.
- **Weakness by surah** (new) and **by juz** (kept, derived): তানবীহ, ফাতহ, mistakes, ayahs heard, total.
- **Coverage / overdue:** per (student × juz) last revised, from the ranges (the 28-day window kept).
- **Weekly trend:** as before, plus new-lesson ayahs per Saturday (`sabaqAyahs`).
- **Dashboards:** derived juz amount per category (kept name `portionsByCategory`), ayahs per category,
  status counts, weakest 5 juz + weakest 5 surahs.
- **Guardian digest + history:** lines read "সবক: বাকারা ১৭৩–১৮১ (সম্পন্ন) · তানবীহ ২ · ফাতহ ০".
- **Monthly report:** `juzHeard` = Σ derived juz amount.

## §5 — App
- Entry grid: per portion — category, status chips, a searchable surah picker (number + Bangla name) and an
  ayah box limited to that surah's count, for start and end; a "পুরো পারা" shortcut that fills a whole juz;
  +/− counters for তানবীহ/ফাতহ and the four mistake types; note.
- Prefill: the recent-lesson (SABQI) row starts from last Saturday's new-lesson range.
- History, guardian card, deliver screen and dashboard show ranges as Bangla text.

## §6 — Data operations (owner-approved 2026-10-24; prod, run deliberately)
1. Delete every `RevisionEntry` (and the SR absence-dispatch rows that point at them). Audited.
2. Back-fill the paper sheets (transcribed from photos): date = the sheet's date snapped to the Saturday;
   student matched to an active Hifz-group member by name (owner confirms uncertain matches); entries are
   **not delivered**. Inactive or unmatched students are reported, not forced.

## §7 — Acceptance
- A range outside a surah's ayah count, a reversed range, or a half-filled range is refused.
- Juz/surah splits match hand calculation (Naba–Naziat; Baqara 247–259 → juz 2: 6, juz 3: 7).
- All reports read portions only; no `juzRecords` reference remains in server or app.
- Gate: shared + server + app typecheck, vocab verifier, jest revision suites + monthly metrics.
