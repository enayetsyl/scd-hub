/**
 * MR-3 — the document's rules (docs/prd-monthly-report.md §7, D-#393/#394/#397/#398).
 *
 * The invariants pinned here are the ones that make the feature safe to send to a
 * family: a recompute that changes nothing raises nothing, an unreviewed report is
 * unreleasable by ANYONE, and the two refusals a Principal may override are exactly
 * the two the Office may not.
 */
import {
  diffFigures,
  figuresHashOf,
  lockStateOf,
  releaseVerdictOf,
  reportedFigures,
  rollupOf,
  sweepPeriodKeyFor,
  type MonthlySnapshot,
} from "../modules/reports/services/MonthlyReportService";
import { DEFAULT_MONTHLY_REPORT_CONFIG } from "../modules/reports/services/MonthlyReportConfigService";

const CFG = DEFAULT_MONTHLY_REPORT_CONFIG;

const snapshot = (p: {
  present?: number;
  rate?: number | null;
  hwSubmitted?: number;
  hwCoverage?: number | null;
  ctUnmarked?: number;
  ctRate?: number | null;
  concerns?: number;
  trend?: string;
  flags?: string[];
}): MonthlySnapshot =>
  ({
    metrics: {
      attendance: { present: p.present ?? 18, schoolDays: 22, rate: p.rate ?? 82, absentUncovered: 2, absentStreakMax: 2 },
      homework: {
        issued: 38, submitted: p.hwSubmitted ?? 27, submissionRate: 84, qualityRate: 63,
        coverage: { settled: 0, total: 0, pct: p.hwCoverage === undefined ? 92 : p.hwCoverage },
        bySubject: [],
      },
      assignment: {
        issued: 6, submitted: 4, submissionRate: 80, qualityRate: 50,
        coverage: { settled: 0, total: 0, pct: 67 },
        bySubject: [],
      },
      classTest: {
        testsHeld: 14, rate: p.ctRate ?? 79, unmarked: p.ctUnmarked ?? 2,
        coverage: { settled: 0, total: 0, pct: 86 },
      },
      hifz: { sessions: 4, present: 3 },
      concerns: { concern: p.concerns ?? 3, positive: 2 },
      library: { taken: 2, overdue: 0 },
      fees: { paidTotal: 1000, paidYearToDate: 6150 },
    },
    trends: { attendance: { state: p.trend ?? "DOWN" } },
    flags: (p.flags ?? ["ABSENT_STREAK"]).map((flag) => ({ flag, value: 3, threshold: 3 })),
    config: CFG,
  }) as unknown as MonthlySnapshot;

describe("MR-3 §6.3 — a recompute that changes nothing raises nothing", () => {
  test("identical inputs produce an empty diff", () => {
    expect(diffFigures(reportedFigures(snapshot({})), reportedFigures(snapshot({})))).toEqual([]);
  });

  test("a mark landing on the 9th IS a change, and is named field by field", () => {
    const changes = diffFigures(
      reportedFigures(snapshot({ ctUnmarked: 2, ctRate: 79 })),
      reportedFigures(snapshot({ ctUnmarked: 0, ctRate: 81 })),
    );
    expect(changes.map((c) => c.field)).toEqual(["classTest.rate", "classTest.unmarked"]);
    expect(changes[1]).toEqual({ field: "classTest.unmarked", before: "2", after: "0" });
  });

  test("a changed TREND STATE alone is a change worth a revision", () => {
    const changes = diffFigures(
      reportedFigures(snapshot({ trend: "DOWN" })),
      reportedFigures(snapshot({ trend: "STEADY" })),
    );
    expect(changes).toEqual([{ field: "trend.attendance", before: "DOWN", after: "STEADY" }]);
  });

  test("a flag appearing is a change", () => {
    const changes = diffFigures(
      reportedFigures(snapshot({ flags: [] })),
      reportedFigures(snapshot({ flags: ["SERIOUS_MATTER"] })),
    );
    expect(changes).toEqual([{ field: "flags", before: null, after: "SERIOUS_MATTER" }]);
  });

  test("a null becoming a number is a change, and reads honestly in the log", () => {
    const changes = diffFigures(
      reportedFigures(snapshot({ hwCoverage: null })),
      reportedFigures(snapshot({ hwCoverage: 92 })),
    );
    expect(changes).toEqual([{ field: "homework.coverage", before: null, after: "92" }]);
  });

  test("only PRINTED figures are compared — the snapshot's other fields cannot force a revision", () => {
    const keys = Object.keys(reportedFigures(snapshot({})));
    expect(keys).not.toContain("dataAsOf");
    expect(keys).not.toContain("previous");
    expect(keys).not.toContain("config");
    expect(keys).toContain("attendance.rate");
  });
});

describe("MR-8 D-#459 — a per-subject split IS a reportable change, even when overall totals match", () => {
  // The exact bug an owner-run audit of a real export file found: two revisions with
  // identical OVERALL homework totals but different per-subject splits hashed the
  // same, because reportedFigures never touched bySubject. A comment can legitimately
  // cite subject-level numbers (D-#456), so the binding has to cover them too.
  const withHomeworkSplit = (bySubject: Array<{ subject: string; qualityRate: number }>) =>
    ({
      ...snapshot({}),
      metrics: {
        ...snapshot({}).metrics,
        homework: {
          ...snapshot({}).metrics.homework,
          bySubject: bySubject.map((s) => ({
            subject: s.subject, submitted: 5, expectedWhilePresent: 5,
            checked: 5, correct: Math.round((s.qualityRate / 100) * 5), partial: 0,
            wrong: 5 - Math.round((s.qualityRate / 100) * 5), qualityRate: s.qualityRate,
          })),
        },
      },
    }) as unknown as MonthlySnapshot;

  const recordFour = withHomeworkSplit([
    { subject: "BAN", qualityRate: 100 }, { subject: "ENG", qualityRate: 100 }, { subject: "MATH", qualityRate: 60 },
  ]);
  const recordTwenty = withHomeworkSplit([
    { subject: "BAN", qualityRate: 91 }, { subject: "ENG", qualityRate: 100 }, { subject: "MATH", qualityRate: 50 },
  ]);

  test("figuresHash now DIFFERS for a subject-split-only change — it used to match", () => {
    expect(figuresHashOf(recordFour)).not.toBe(figuresHashOf(recordTwenty));
  });

  test("diffFigures names exactly which subject moved, not just that homework changed", () => {
    const changes = diffFigures(reportedFigures(recordFour), reportedFigures(recordTwenty));
    const fields = changes.map((c) => c.field);
    expect(fields).toContain("homework.bySubject.BAN.qualityRate");
    expect(fields).toContain("homework.bySubject.MATH.qualityRate");
    expect(fields).not.toContain("homework.bySubject.ENG.qualityRate"); // unchanged, correctly silent
  });

  test("a subject with no change at all produces an empty diff, same as before this fix", () => {
    expect(diffFigures(reportedFigures(recordFour), reportedFigures(recordFour))).toEqual([]);
  });
});

describe("MR-3 §6.2 — the revision calendar", () => {
  // July 2026 ends 2026-07-31; the window is 14 days, the hard lock 21.
  const at = (dateKey: string): Date => new Date(`${dateKey}T12:00:00.000Z`);

  test("the first fortnight is OPEN to the nightly recompute", () => {
    expect(lockStateOf("2026-07", at("2026-08-01"), CFG)).toBe("OPEN");
    expect(lockStateOf("2026-07", at("2026-08-14"), CFG)).toBe("OPEN");
  });

  test("after the window only a person may recompute", () => {
    expect(lockStateOf("2026-07", at("2026-08-16"), CFG)).toBe("WINDOW_CLOSED");
    expect(lockStateOf("2026-07", at("2026-08-21"), CFG)).toBe("WINDOW_CLOSED");
  });

  test("past the hard lock the month is closed", () => {
    expect(lockStateOf("2026-07", at("2026-08-23"), CFG)).toBe("HARD_LOCKED");
    expect(lockStateOf("2026-07", at("2026-12-01"), CFG)).toBe("HARD_LOCKED");
  });

  test("the month still running is OPEN", () => {
    expect(lockStateOf("2026-07", at("2026-07-20"), CFG)).toBe("OPEN");
  });

  test("the sweep works on the month that has just ended", () => {
    expect(sweepPeriodKeyFor(new Date(2026, 7, 3))).toBe("2026-07");
    expect(sweepPeriodKeyFor(new Date(2026, 0, 2))).toBe("2025-12");
  });
});

describe("MR-3 D-#394/#397/#399 — who may release what", () => {
  const reviewed = { status: "READY", provisional: false, commentFinal: "ভালো", reviewedAt: new Date() };

  test("a reviewed, complete report releases for the Office", () => {
    expect(releaseVerdictOf(reviewed, "OPEN", false)).toEqual({ allowed: true, reason: null, requiresPrincipal: false });
  });

  test("NOBODY releases words no person has read — not even the Principal", () => {
    const unreviewed = { status: "DRAFT", provisional: false, commentFinal: null, reviewedAt: null };
    for (const isPrincipal of [false, true]) {
      const v = releaseVerdictOf(unreviewed, "OPEN", isPrincipal);
      expect(v.allowed).toBe(false);
      expect(v.reason).toBe("NOT_REVIEWED");
      expect(v.requiresPrincipal).toBe(false); // no override exists for this one
    }
  });

  test("an accepted-but-blank comment does not count as reviewed", () => {
    const v = releaseVerdictOf({ ...reviewed, commentFinal: "   " }, "OPEN", true);
    expect(v.reason).toBe("NOT_REVIEWED");
  });

  test("a provisional report is refused, and ONLY the Principal is offered the override", () => {
    const provisional = { ...reviewed, provisional: true };
    expect(releaseVerdictOf(provisional, "OPEN", false)).toMatchObject({ allowed: false, reason: "PROVISIONAL", requiresPrincipal: true });
    // The verdict is the same for the Principal — `requiresPrincipal` is what the
    // service reads to decide whether an override reason may unlock it.
    expect(releaseVerdictOf(provisional, "OPEN", true)).toMatchObject({ allowed: false, reason: "PROVISIONAL", requiresPrincipal: true });
  });

  test("a hard-locked month is refused, overridable by the Principal only", () => {
    expect(releaseVerdictOf(reviewed, "HARD_LOCKED", false)).toMatchObject({ reason: "HARD_LOCKED", requiresPrincipal: true });
  });

  test("the lock is checked BEFORE the coverage gate, so the harder refusal wins", () => {
    expect(releaseVerdictOf({ ...reviewed, provisional: true }, "HARD_LOCKED", true).reason).toBe("HARD_LOCKED");
  });

  test("an already-released revision cannot be released again, and a superseded one never can", () => {
    expect(releaseVerdictOf({ ...reviewed, status: "RELEASED" }, "OPEN", true)).toMatchObject({
      allowed: false, reason: "ALREADY_RELEASED", requiresPrincipal: false,
    });
    expect(releaseVerdictOf({ ...reviewed, status: "SUPERSEDED" }, "OPEN", true)).toMatchObject({
      allowed: false, reason: "REVOKED_STATE", requiresPrincipal: false,
    });
  });

  test("a WINDOW_CLOSED month still releases — the window governs recompute, not release", () => {
    expect(releaseVerdictOf(reviewed, "WINDOW_CLOSED", false).allowed).toBe(true);
  });
});

describe("MR-7 — the Principal's class roll-up", () => {
  const rep = (p: {
    status?: string;
    provisional?: boolean;
    reviewed?: boolean;
    att?: number | null;
    hw?: number | null;
    ct?: number | null;
    trend?: string;
    flags?: string[];
  }) => ({
    status: p.status ?? "DRAFT",
    provisional: p.provisional ?? false,
    reviewedAt: p.reviewed ? new Date() : null,
    snapshot: {
      metrics: {
        attendance: { rate: p.att === undefined ? 80 : p.att },
        homework: { submissionRate: p.hw === undefined ? 90 : p.hw },
        classTest: { rate: p.ct === undefined ? 70 : p.ct },
      },
      trends: { attendance: { state: p.trend ?? "STEADY" } },
      flags: (p.flags ?? []).map((flag) => ({ flag, value: 3, threshold: 3 })),
    } as unknown as Record<string, unknown>,
  });

  test("counts what the office has to act on", () => {
    const r = rollupOf("sec", "2026-07", [
      rep({ status: "RELEASED", reviewed: true }),
      rep({ status: "READY", reviewed: true }),
      rep({ status: "DRAFT" }),
      rep({ status: "DRAFT", provisional: true }),
    ]);
    expect(r).toMatchObject({ students: 4, released: 1, awaitingReview: 2, provisional: 1 });
  });

  test("averages skip children with no figure rather than counting them as zero", () => {
    const r = rollupOf("sec", "2026-07", [rep({ att: 90 }), rep({ att: 70 }), rep({ att: null })]);
    expect(r.avgAttendancePct).toBe(80);
  });

  test("flags are tallied per child, most common first", () => {
    const r = rollupOf("sec", "2026-07", [
      rep({ flags: ["ABSENT_STREAK", "SERIOUS_MATTER"] }),
      rep({ flags: ["ABSENT_STREAK"] }),
      rep({}),
    ]);
    expect(r.flagCounts).toEqual([
      { flag: "ABSENT_STREAK", students: 2 },
      { flag: "SERIOUS_MATTER", students: 1 },
    ]);
  });

  test("declining attendance is counted, because that is what the Principal looks for", () => {
    const r = rollupOf("sec", "2026-07", [rep({ trend: "DOWN" }), rep({ trend: "DOWN" }), rep({ trend: "UP" })]);
    expect(r.attendanceDeclining).toBe(2);
  });

  test("an empty section yields nulls, not zeroes", () => {
    expect(rollupOf("sec", "2026-07", [])).toMatchObject({
      students: 0, avgAttendancePct: null, avgHomeworkSubmissionPct: null, flagCounts: [],
    });
  });
});
