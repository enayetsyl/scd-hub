# Consult-via-human note → Project 06 — Quran excluded from the Homework Tracker

**From:** SCD Hub (software / system of record + runtime), via the Principal
**To:** Project 06 — Tracker & Operations System (spec/design)
**Re:** Homework Tracker handoff (PRD v1.1) · **§6.2 rosters / §6.3 Quran boundary**
**Channel:** consult-via-human (neither side edits the other's governance)
**Status:** deviation in effect in SCD Hub, awaiting Project-06 confirmation or amendment
**Date raised:** 2026-06-11 · **SCD Hub ref:** DECISIONS D-#36

---

## 1. What we adopted
SCD Hub adopted the Project-06 Homework-Tracker PRD v1.1 (incl. Amendment A-01) by ADR (D-#33) and
built it end-to-end (slices HW-T1→T4 + app). The §12 acceptance checklist is satisfied with **one
deliberate deviation**, recorded here for your ruling.

## 2. The deviation
**The Principal ruled that Quran is NOT a homework subject in SCD Hub.** Quran homework is handled by the
**Quran Tracker**, not the Homework Tracker. In the build this means the operational subject axis
(`HW_SUBJECTS`) is `BAN, ENG, MATH, SCI, BGS, ARABIC, ISLAM` — Arabic and Islam are included; **Quran is
excluded**. Declaring a homework item with subject `QURAN` is rejected.

## 3. Where this conflicts with the handoff
This contradicts the LOCKED handoff in two places:

- **§6.2 rosters** list Quran among the daily subjects (Classes 1–2: "Bangla, English, Math, Quran,
  Arabic, Islam"; Classes 3–5: "Quran/Arabic daily").
- **§6.3 Quran boundary** states explicitly: *"Quran-subject homework rows live here and count in the
  weekday budget; the muraja'ah discipline (incl. the weekend touch, outside all caps) is the Quran
  Tracker's. Don't double-log."* — i.e. a Quran **homework row** (e.g. 20 min tilawah of the day's ayah)
  was intended to live in the Homework Tracker and count toward the **240-min weekday ceiling** (§4); only
  the **muraja'ah discipline** belongs to the Quran Tracker.

So the handoff drew the line *between Quran-homework (here) and Quran-muraja'ah (Quran Tracker)*; the
Principal's ruling moves **all** Quran work to the Quran Tracker.

## 4. The substantive question for Project 06
Does removing Quran-homework from the Homework Tracker's weekday budget break any REF-08 reasoning?
Specifically:

1. **240-min ceiling math (D-024/D-030):** with Quran-homework no longer counted here, the weekday
   day-total no longer includes its minutes. Is the ceiling still calibrated correctly, or was Quran's
   ~20 min assumed inside the 240 budget?
2. **Double-logging (§6.3):** the §6.3 "don't double-log" guard assumed Quran-homework *here* + muraja'ah
   *there*. If all Quran work is in the Quran Tracker, does that tracker now own the homework-row concept
   too, and does it (or should it) count toward any cap?
3. **Roster completeness (§6.2):** should §6.2 be amended to drop Quran from the Homework Tracker's
   declaration roster, or is Quran-homework expected to reappear here later?

## 5. What SCD Hub is doing in the meantime
- Following the Principal's ruling: `HW_SUBJECTS` excludes Quran (D-#36).
- **Fully reversible:** re-including Quran is a one-line change (add `"QURAN"` back to the `HW_SUBJECTS`
  enum + its Bangla label) with no schema/contract impact — no data migration, no wire change.
- Arabic and Islam remain homework subjects (they have no authored content but do carry homework, like
  Quran would have).

## 6. Requested outcome
Please **confirm** the exclusion (and, if so, amend REF-08 §6.2/§6.3 + the handoff so the spec and the
build agree), **or** push back (we re-include Quran). Route the answer back through the Principal as a
PRD amendment, consistent with the consult-via-human channel.
