/**
 * AL-6 — the in-school rule for MASTERED and the section trigger (docs/prd-academic-loop-2027.md §3.8, D-#1670).
 * Pure (no database). ACs: AC-D4, AC-F2, and the OFF half of AC-R1 (the 2026 behaviour is untouched).
 *
 *   computeOutcomeState   four good HW items → IMPROVING "ক্লাসে যাচাই বাকি", never MASTERED; + one good CT item in a
 *                         separate week → MASTERED; a good at-home revision item leaves REVISION_DUE, a good in-school
 *                         one returns to MASTERED, a poor one of any source → WEAK; school weeks (Sun–Sat) count
 *   inSchoolSectionSummary 16/28 below 50 % in class with 2 papers → trigger; 16/28 WEAK from homework only and 3/20
 *                         weak in class → none; only 6 children with an in-school item (4 weak) → none (Q12 guard)
 *   OFF                   the same rows with the switch off (or `masteredNeedsInSchool` off) are exactly 2026
 */
import { MASTERY_POLICY_DEFAULTS, type MasteryPolicyValues } from "@scd/shared";
import {
  computeOutcomeState,
  inSchoolSectionSummary,
  isInSchoolSource,
  requireInSchool,
  schoolWeekKey,
  type EvidenceLike,
} from "../modules/mastery/diagnosis";
import { isoWeekKey } from "../modules/mastery/evidence";

const OFF: MasteryPolicyValues = { ...MASTERY_POLICY_DEFAULTS };
const ON: MasteryPolicyValues = { ...MASTERY_POLICY_DEFAULTS, academicLoop2027On: true };
const NOW = new Date("2027-03-30T00:00:00Z");
const LO = "LO-C3-MATH-07-03";

const ev = (paperId: string, date: string, earned: number, available: number, source: string, over: Partial<EvidenceLike> = {}): EvidenceLike => {
  const at = new Date(`${date}T00:00:00Z`);
  return { paperId, itemNo: 1, qid: `Q-${paperId}`, loCode: LO, earned, available, rework: false, signal: "NONE", routed: false, at, week: isoWeekKey(at), source, ...over };
};
const state = (rows: EvidenceLike[], policy: MasteryPolicyValues = ON, now = NOW) => computeOutcomeState(rows, policy, { sectionMeanPct: null, now });

/** Four good homework items over two weeks (Mon 1 Mar, Mon 8 Mar). */
const hw4 = [
  ev("h1", "2027-03-01", 2, 2, "HW"),
  ev("h2", "2027-03-02", 2, 2, "HW"),
  ev("h3", "2027-03-08", 2, 2, "HW"),
  ev("h4", "2027-03-09", 2, 2, "HW"),
];

describe("sources and the switch", () => {
  it("CT, RETEST, RUBRIC and CW are in school; HW, AS and extra homework are at home", () => {
    for (const s of ["CT", "RETEST", "RUBRIC", "CW"]) expect(isInSchoolSource(s)).toBe(true);
    for (const s of ["HW", "AS", "EXTRA_HW", "", null, undefined]) expect(isInSchoolSource(s as never)).toBe(false);
  });
  it("the rule needs the release switch AND masteredNeedsInSchool", () => {
    expect(requireInSchool(ON)).toBe(true);
    expect(requireInSchool(OFF)).toBe(false);
    expect(requireInSchool({ ...ON, masteredNeedsInSchool: false })).toBe(false);
  });
});

describe("AC-D4 — MASTERED needs one good in-school answer", () => {
  it("four good at-home items in two weeks → IMPROVING with the note, never MASTERED", () => {
    const s = state(hw4);
    expect(s.state).toBe("IMPROVING");
    expect(s.inSchoolPending).toBe(true);
    expect(s.nextRevisionAt).toBeNull();
  });

  it("…then one good class-test item in a separate week → MASTERED (and the note is gone)", () => {
    const s = state([...hw4, ev("c1", "2027-03-15", 2, 2, "CT")]);
    expect(s.state).toBe("MASTERED");
    expect(s.inSchoolPending).toBe(false);
    expect(s.nextRevisionAt).not.toBeNull();
  });

  it("a WEAK child whose next work is good at home goes IMPROVING (not MASTERED), then MASTERED after a good CW item", () => {
    const weak = [ev("w1", "2027-03-01", 0, 2, "HW"), ev("w2", "2027-03-02", 0, 2, "HW")];
    expect(state(weak).state).toBe("WEAK");
    const homeGood = [...weak, ev("g1", "2027-03-08", 2, 2, "HW"), ev("g2", "2027-03-15", 2, 2, "AS")];
    expect(state(homeGood)).toMatchObject({ state: "IMPROVING", inSchoolPending: true });
    expect(state([...homeGood, ev("g3", "2027-03-22", 2, 2, "CW")]).state).toBe("MASTERED");
  });

  it("an at-home item still makes WEAK exactly as before (R17)", () => {
    expect(state([ev("a1", "2027-03-01", 0, 2, "HW"), ev("a2", "2027-03-08", 1, 2, "AS")]).state).toBe("WEAK");
  });

  it("OFF: the same four homework items are MASTERED — 2026 untouched (AC-R1)", () => {
    const s = state(hw4, OFF);
    expect(s.state).toBe("MASTERED");
    expect(s.inSchoolPending).toBe(false);
    expect(state(hw4, { ...ON, masteredNeedsInSchool: false }).state).toBe("MASTERED");
  });

  it("OFF with a source on the rows changes nothing (rows with and without a source read the same)", () => {
    const bare = hw4.map(({ source: _s, ...r }) => r as EvidenceLike);
    expect(state(bare, OFF)).toEqual(state(hw4, OFF));
  });
});

describe("§3.8 revision", () => {
  /** Mastered with a CT item, revision due 4 weeks after the CT. */
  const mastered = [...hw4, ev("c1", "2027-03-15", 2, 2, "CT")];
  const due = new Date("2027-04-12T00:00:00Z"); // revisionFirstWeeks 4 → due 12 Apr

  it("a good at-home revision item leaves REVISION_DUE as it is", () => {
    const s = state([...mastered, ev("r1", "2027-04-13", 2, 2, "HW")], ON, new Date("2027-04-20T00:00:00Z"));
    expect(s.state).toBe("REVISION_DUE");
    expect(s.nextRevisionAt!.getTime()).toBe(due.getTime());
  });

  it("a good in-school revision item returns to MASTERED and pushes the date (+ revisionThenWeeks)", () => {
    const s = state([...mastered, ev("r1", "2027-04-13", 2, 2, "CT")], ON, new Date("2027-04-20T00:00:00Z"));
    expect(s.state).toBe("MASTERED");
    expect(s.nextRevisionAt!.getTime()).toBe(new Date("2027-04-13T00:00:00Z").getTime() + 8 * 7 * 86_400_000);
  });

  it("a poor revision item of ANY source → WEAK (REVISION_FAILED)", () => {
    for (const source of ["HW", "AS", "CT"]) {
      const s = state([...mastered, ev("r1", "2027-04-13", 0, 2, source)], ON, new Date("2027-04-20T00:00:00Z"));
      expect(s).toMatchObject({ state: "WEAK", reasons: ["REVISION_FAILED"] });
    }
  });

  it("OFF: a good at-home revision item returns to MASTERED (2026)", () => {
    const s = state([...hw4, ev("r0", "2027-03-15", 2, 2, "HW"), ev("r1", "2027-04-13", 2, 2, "HW")], OFF, new Date("2027-04-20T00:00:00Z"));
    expect(s.state).toBe("MASTERED");
  });
});

describe("§3.8 school weeks (Sun–Sat, D-#275; accepted R36)", () => {
  it("schoolWeekKey is the Sunday that starts the week", () => {
    expect(schoolWeekKey(new Date("2027-03-07T00:00:00Z"))).toBe("2027-03-07"); // Sunday
    expect(schoolWeekKey(new Date("2027-03-08T00:00:00Z"))).toBe("2027-03-07"); // Monday
    expect(schoolWeekKey(new Date("2027-03-13T00:00:00Z"))).toBe("2027-03-07"); // Saturday
    expect(schoolWeekKey(new Date("2027-03-14T00:00:00Z"))).toBe("2027-03-14"); // next Sunday
  });

  it("a Sunday and the Monday after are two ISO weeks but ONE school week: not 'separate' with the rule on", () => {
    const rows = [ev("s1", "2027-03-07", 2, 2, "CT"), ev("s2", "2027-03-08", 2, 2, "CT")];
    expect(isoWeekKey(rows[0]!.at)).not.toBe(isoWeekKey(rows[1]!.at));
    expect(state(rows, OFF).state).toBe("MASTERED"); // 2026: ISO weeks differ
    expect(state(rows, ON).state).toBe("INSUFFICIENT"); // 2027: the same school week — no separate weeks yet
    expect(state([...rows, ev("s3", "2027-03-14", 2, 2, "CT")], ON).state).toBe("MASTERED");
  });
});

// ---------------------------------------------------------------------------
// The section trigger
// ---------------------------------------------------------------------------

const kids = (n: number) => Array.from({ length: n }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);
type Row = EvidenceLike & { studentId: string };
const row = (studentId: string, paperId: string, date: string, earned: number, source: string): Row => ({ ...ev(paperId, date, earned, 2, source), studentId, qid: `${paperId}-${studentId}` });

describe("AC-F2 — the section trigger reads in-school evidence", () => {
  const P = { ...ON, sectionTriggerMinAssessedPct: 50 };

  it("16 of 28 below 50 % in class over 2 confirmed in-school papers → triggered", () => {
    const rows: Row[] = [];
    kids(28).forEach((s, i) => {
      const weak = i < 16;
      rows.push(row(s, "ct1", "2027-03-01", weak ? 0 : 2, "CT"), row(s, "ct2", "2027-03-08", weak ? 0 : 2, "CT"));
    });
    const r = inSchoolSectionSummary(rows, P, 28);
    expect(r).toMatchObject({ weak: 16, verdicts: 28, weakPct: 57, inSchoolAssessments: 2, triggered: true });
  });

  it("16 of 28 WEAK from homework only and 3 of 20 weak in class → none", () => {
    const rows: Row[] = [];
    kids(28).forEach((s, i) => {
      rows.push(row(s, "h1", "2027-03-01", i < 16 ? 0 : 2, "HW"), row(s, "h2", "2027-03-02", i < 16 ? 0 : 2, "HW"));
    });
    kids(20).forEach((s, i) => {
      rows.push(row(s, "ct1", "2027-03-08", i < 3 ? 0 : 2, "CT"), row(s, "ct2", "2027-03-15", i < 3 ? 0 : 2, "CT"));
    });
    const r = inSchoolSectionSummary(rows, P, 28);
    expect(r).toMatchObject({ weak: 3, verdicts: 20, triggered: false });
    expect(r.weakPct).toBe(15);
  });

  it("only 6 children have an in-school item (4 weak) → none (the Q12 guard: 6/28 < 50 %)", () => {
    const rows: Row[] = [];
    kids(6).forEach((s, i) => rows.push(row(s, "ct1", "2027-03-01", i < 4 ? 0 : 2, "CT"), row(s, "ct2", "2027-03-08", i < 4 ? 0 : 2, "CT")));
    const r = inSchoolSectionSummary(rows, P, 28);
    expect(r.weakPct).toBe(67);
    expect(r.assessedPct).toBeCloseTo(21.43, 1);
    expect(r.triggered).toBe(false);
    // …and with the guard off the same rows do trigger
    expect(inSchoolSectionSummary(rows, { ...P, sectionTriggerMinAssessedPct: 0 }, 28).triggered).toBe(true);
  });

  it("one in-school paper is below sectionTriggerMinAssessments (2) → none; a rubric-low child counts weak", () => {
    const rows: Row[] = kids(10).map((s) => row(s, "ct1", "2027-03-01", 0, "CT"));
    expect(inSchoolSectionSummary(rows, P, 10)).toMatchObject({ weak: 10, inSchoolAssessments: 1, triggered: false });
    const rub: Row[] = kids(4).flatMap((s, i) => [
      { ...row(s, "r1", "2027-03-01", 2, "RUBRIC"), rubricStep: i === 0 ? 1 : 4 },
      { ...row(s, "r2", "2027-03-08", 2, "RUBRIC"), rubricStep: i === 0 ? 1 : 4 },
    ]);
    expect(inSchoolSectionSummary(rub, P, 4).weakStudentIds).toEqual(["S01"]);
  });

  it("a child's last TWO in-school papers decide (an old bad one is forgotten)", () => {
    const rows: Row[] = [row("S01", "ct1", "2027-03-01", 0, "CT"), row("S01", "ct2", "2027-03-08", 2, "CT"), row("S01", "ct3", "2027-03-15", 2, "CT")];
    expect(inSchoolSectionSummary(rows, P, 1).weak).toBe(0);
  });
});
