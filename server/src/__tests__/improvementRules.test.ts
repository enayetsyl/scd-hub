/**
 * Student progress + improvement actions — the pure rules (docs/prd-student-progress.md,
 * D-#734..#738). DB-free: every rule takes its inputs, so each is pinned on its own.
 */
import {
  addDaysKey,
  weekdayOfKey,
  scheduleDayKeys,
  actionState,
  dayNumber,
  pastDays,
  trailingUnmarked,
  responsibleFor,
  trendOf,
  isFalling,
  isAtRisk,
  rollupStudent,
  classRows,
  beforeAfter,
  type ScoredResult,
} from "../modules/improvement/rules";

// 2026-10-13 is a Tuesday. Fri (5) and Sat (6) are closed; 2026-10-15 is a holiday here.
const HOLIDAY = "2026-10-15";
const isOpen = (k: string) => {
  const wd = weekdayOfKey(k);
  return wd !== 5 && wd !== 6 && k !== HOLIDAY;
};

describe("schedule (§4.2)", () => {
  it("adds calendar days across a month end", () => {
    expect(addDaysKey("2026-10-30", 3)).toBe("2026-11-02");
    expect(weekdayOfKey("2026-10-13")).toBe(2);
  });

  it("counts open school days only, skipping Fri/Sat and holidays", () => {
    expect(scheduleDayKeys("2026-10-13", 5, isOpen, null)).toEqual([
      "2026-10-13", // Tue
      "2026-10-14", // Wed
      // 15 Thu holiday, 16 Fri, 17 Sat
      "2026-10-18", // Sun
      "2026-10-19",
      "2026-10-20",
    ]);
  });

  it("SUBJECT_DAYS keeps only the subject's weekdays", () => {
    // Math on Sun (0) and Tue (2) only.
    expect(scheduleDayKeys("2026-10-13", 3, isOpen, new Set([0, 2]))).toEqual(["2026-10-13", "2026-10-18", "2026-10-20"]);
  });

  it("a section with no period of the subject yields nothing instead of looping", () => {
    expect(scheduleDayKeys("2026-10-13", 5, isOpen, new Set())).toEqual([]);
  });

  it("state: upcoming / running / ended / stopped", () => {
    const days = ["2026-10-13", "2026-10-14", "2026-10-18"];
    expect(actionState(days, false, "2026-10-12")).toBe("UPCOMING");
    expect(actionState(days, false, "2026-10-13")).toBe("RUNNING");
    expect(actionState(days, false, "2026-10-16")).toBe("RUNNING"); // a gap day inside the span
    expect(actionState(days, false, "2026-10-19")).toBe("ENDED");
    expect(actionState(days, true, "2026-10-13")).toBe("STOPPED");
    expect(dayNumber(days, "2026-10-18")).toBe(3);
    expect(dayNumber(days, "2026-10-16")).toBe(0);
  });

  it("past days stop at the stop day", () => {
    const days = ["2026-10-13", "2026-10-14", "2026-10-18", "2026-10-19"];
    expect(pastDays(days, "2026-10-19")).toEqual(["2026-10-13", "2026-10-14", "2026-10-18"]);
    expect(pastDays(days, "2026-10-19", "2026-10-14")).toEqual(["2026-10-13"]);
  });

  it("guardian run: counts unmarked days at the end, a tick resets it", () => {
    const past = ["d1", "d2", "d3", "d4", "d5"];
    expect(trailingUnmarked(past, new Set(["d1", "d2"]))).toBe(3);
    expect(trailingUnmarked(past, new Set(["d4"]))).toBe(1);
    expect(trailingUnmarked(past, new Set(["d5"]))).toBe(0);
    expect(trailingUnmarked(past, new Set())).toBe(5);
  });
});

describe("who does the teacher task (§5, D-#736)", () => {
  const base = { assignedUserId: "T", overrideUserId: null, teacherAway: false, coverUserId: null };
  it("the assigned teacher on a normal day", () => {
    expect(responsibleFor(base)).toEqual({ userId: "T", source: "ASSIGNED" });
  });
  it("the cover teacher while the teacher is away", () => {
    expect(responsibleFor({ ...base, teacherAway: true, coverUserId: "C" })).toEqual({ userId: "C", source: "COVER" });
  });
  it("nobody when away with no cover — Office picks", () => {
    expect(responsibleFor({ ...base, teacherAway: true })).toEqual({ userId: null, source: "NONE" });
  });
  it("an Office override wins over everything", () => {
    expect(responsibleFor({ ...base, teacherAway: true, coverUserId: "C", overrideUserId: "O" })).toEqual({ userId: "O", source: "OVERRIDE" });
    expect(responsibleFor({ ...base, overrideUserId: "O" })).toEqual({ userId: "O", source: "OVERRIDE" });
  });
});

describe("board rules (§2, D-#734)", () => {
  it("trend compares the last two results; ±1 point is a move", () => {
    expect(trendOf([50])).toBe("NONE");
    expect(trendOf([50, 51])).toBe("UP");
    expect(trendOf([50, 49])).toBe("DOWN");
    expect(trendOf([50, 50.5])).toBe("FLAT");
  });

  it("falling = the last three strictly decreasing", () => {
    expect(isFalling([44, 38, 32])).toBe(true);
    expect(isFalling([90, 44, 38, 32])).toBe(true);
    expect(isFalling([44, 38, 38])).toBe(false);
    expect(isFalling([38, 32])).toBe(false);
  });

  it("at risk = falling trend AND the newest result failed (CT-10)", () => {
    expect(isAtRisk([{ percent: 70, pass: true }, { percent: 50, pass: true }, { percent: 30, pass: false }])).toBe(true);
    expect(isAtRisk([{ percent: 70, pass: true }, { percent: 50, pass: true }, { percent: 45, pass: true }])).toBe(false);
    expect(isAtRisk([{ percent: 30, pass: false }, { percent: 50, pass: true }, { percent: 35, pass: false }])).toBe(false);
  });

  const r = (studentId: string, subject: string, examKey: string, percent: number | null, pass: boolean | null = percent === null ? null : percent >= 40, weakness: string | null = null): ScoredResult => ({
    studentId, subject, examKey, percent, pass, weakness,
  });

  it("rolls one student up per subject, oldest first, absences apart", () => {
    const rows = [
      r("A", "MATH", "2026-09-01", 44, true, "fractions"),
      r("A", "MATH", "2026-09-10", 38, false, "Fractions"),
      r("A", "MATH", "2026-09-20", 32, false),
      r("A", "ENG", "2026-09-05", 80),
      r("A", "ENG", "2026-09-15", null),
      r("B", "MATH", "2026-09-01", 99),
    ];
    const u = rollupStudent("A", rows);
    expect(u.absent).toBe(1);
    const math = u.cells.find((c) => c.subject === "MATH")!;
    expect(math).toMatchObject({ avgPercent: 38, tests: 3, trend: "DOWN", falling: true, last3: [44, 38, 32], latestWeakness: "Fractions" });
    expect(u.cells.find((c) => c.subject === "ENG")!.tests).toBe(1);
    expect(u.overall).toBe(59); // (38 + 80) / 2
    expect(u.recurringWeaknesses).toEqual(["fractions (2)"]);
    expect(u.atRisk).toBe(true);
  });

  it("class highest and class average per subject and overall", () => {
    const rows = [r("A", "MATH", "2026-09-01", 40), r("B", "MATH", "2026-09-01", 90), r("B", "ENG", "2026-09-01", 70)];
    const ups = [rollupStudent("A", rows), rollupStudent("B", rows)];
    const c = classRows(ups, ["MATH", "ENG"]);
    expect(c.perSubject).toEqual([
      { subject: "MATH", highest: 90, average: 65 },
      { subject: "ENG", highest: 70, average: 70 },
    ]);
    expect(c.highestOverall).toBe(80); // B: (90 + 70) / 2
    expect(c.averageOverall).toBe(60); // (40 + 80) / 2
  });

  it("before = last result before the start; after = first result after the end", () => {
    const series = [
      { examKey: "2026-09-01", percent: 44 },
      { examKey: "2026-10-01", percent: 32 },
      { examKey: "2026-10-20", percent: 50 }, // during the action — neither
      { examKey: "2026-11-12", percent: 55 },
      { examKey: "2026-11-30", percent: 70 },
    ];
    expect(beforeAfter(series, "2026-10-14", "2026-11-10")).toEqual({ before: 32, after: 55 });
    expect(beforeAfter(series.slice(0, 3), "2026-10-14", "2026-11-10")).toEqual({ before: 32, after: null });
  });
});
