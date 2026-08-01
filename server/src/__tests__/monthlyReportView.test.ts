/**
 * MR-5 — what a narrowed reader actually receives (prd-monthly-report §4).
 *
 * The report is cross-subject by nature, so the §4 gate has to bite on the FROZEN
 * snapshot, not only on the query: a subject teacher gets their own subjects' rows,
 * no fee block, and no AI paragraph at all.
 */
import { narrowSnapshot } from "../modules/reports/resolvers/monthlyReport";

const snapshot = (): Record<string, unknown> => ({
  metrics: {
    homework: {
      submissionRate: 84,
      bySubject: [{ subject: "MATH" }, { subject: "BANGLA" }, { subject: "ENGLISH" }],
    },
    assignment: { bySubject: [{ subject: "MATH" }, { subject: "ENGLISH" }] },
    classTest: { bySubject: [{ subject: "MATH" }, { subject: "ARABIC" }] },
    fees: { paidTotal: 1000, paidYearToDate: 6150 },
    attendance: { rate: 82 },
  },
  previous: {
    homework: { bySubject: [{ subject: "MATH" }, { subject: "ENGLISH" }] },
  },
  cohort: { attendanceRate: { avg: 88, best: 100 } },
});

describe("MR-5 §4 — the narrowed view", () => {
  test("a subject teacher sees ONLY their own subjects, in every stream", () => {
    const out = narrowSnapshot(snapshot(), ["MATH"], { hideFees: true }) as any;
    expect(out.metrics.homework.bySubject).toEqual([{ subject: "MATH" }]);
    expect(out.metrics.assignment.bySubject).toEqual([{ subject: "MATH" }]);
    expect(out.metrics.classTest.bySubject).toEqual([{ subject: "MATH" }]);
  });

  test("last month's rows are narrowed too — the comparison cannot leak what the panel hides", () => {
    const out = narrowSnapshot(snapshot(), ["MATH"], { hideFees: true }) as any;
    expect(out.previous.homework.bySubject).toEqual([{ subject: "MATH" }]);
  });

  test("teachers never see the fee block (D-#401)", () => {
    const out = narrowSnapshot(snapshot(), null, { hideFees: true }) as any;
    expect(out.metrics.fees).toBeUndefined();
    expect(out.metrics.attendance).toBeDefined();
  });

  test("a full-view reader keeps every subject, and Principal/Office keep fees", () => {
    const out = narrowSnapshot(snapshot(), null, { hideFees: false }) as any;
    expect(out.metrics.homework.bySubject).toHaveLength(3);
    expect(out.metrics.fees.paidTotal).toBe(1000);
  });

  test("the cohort is untouched — it is already anonymous, and suppressed at compute time", () => {
    const out = narrowSnapshot(snapshot(), ["MATH"], { hideFees: true }) as any;
    expect(out.cohort.attendanceRate).toEqual({ avg: 88, best: 100 });
  });

  test("narrowing COPIES — the stored snapshot is never mutated", () => {
    const original = snapshot();
    narrowSnapshot(original, ["MATH"], { hideFees: true });
    expect((original.metrics as any).homework.bySubject).toHaveLength(3);
    expect((original.metrics as any).fees).toBeDefined();
  });

  test("a teacher narrowed to a subject with no rows gets empty lists, not everything", () => {
    const out = narrowSnapshot(snapshot(), ["SCIENCE"], { hideFees: true }) as any;
    expect(out.metrics.homework.bySubject).toEqual([]);
    expect(out.metrics.classTest.bySubject).toEqual([]);
  });

  test("an empty snapshot does not throw", () => {
    expect(narrowSnapshot({}, ["MATH"], { hideFees: true })).toEqual({});
  });
});
