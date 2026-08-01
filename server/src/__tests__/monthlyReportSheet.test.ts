/**
 * MR-7 — the printable sheet (prd-monthly-report §8).
 *
 * The body is pure, so what the page SAYS is asserted without rendering a PDF. The
 * two rules worth defending: an unreleased revision must announce itself as such, and
 * a narrowed sheet must carry neither the other subjects nor the paragraph.
 */
import { buildMonthlyReportMarkdown } from "../modules/reports/services/MonthlyReportSheetService";
import { DEFAULT_MONTHLY_REPORT_CONFIG } from "../modules/reports/services/MonthlyReportConfigService";
import { markdownToPdf } from "../routes/pdfRenderer";
import type { MonthlySnapshot } from "../modules/reports/services/MonthlyReportService";

const snapshot = (over: Partial<{ fees: unknown; subjects: string[] }> = {}): MonthlySnapshot =>
  ({
    metrics: {
      periodKey: "2026-07",
      attendance: {
        schoolDays: 22, present: 18, absent: 4, absentLeaveCovered: 2,
        absentUncovered: 2, absentStreakMax: 3, rate: 82, weekdayPattern: null,
      },
      homework: {
        issued: 38, expectedWhilePresent: 32, submitted: 27, submissionRate: 84,
        checked: 27, correct: 17, partial: 5, wrong: 5, qualityRate: 63,
        resubmissions: 3, notSubmittedDueToAbsence: 6, remindersSent: 2,
        coverage: { settled: 35, total: 38, pct: 92 },
        bySubject: (over.subjects ?? ["BANGLA", "MATH"]).map((subject) => ({
          subject, issued: 8, expectedWhilePresent: 7, submitted: 6,
          submissionRate: 86, checked: 6, correct: 4, partial: 1, wrong: 1, qualityRate: 67,
        })),
      },
      classTest: {
        testsHeld: 14, attended: 12, absent: 2, marksObtained: 157, marksFull: 200,
        rate: 79, unmarked: 2, coverage: { settled: 12, total: 14, pct: 86 },
        bySubject: [{ subject: "MATH", testsHeld: 4, attended: 4, absent: 0, marksObtained: 55, marksFull: 60, rate: 92, unmarked: 0 }],
      },
      hifz: { sessions: 4, present: 3, absent: 1, juzHeard: 1.5, tanbih: 1, fath: 2, mistakes: 3, latestNote: "ভালো" },
      concerns: { concern: 3, positive: 2, seriousMatters: 0, byType: [] },
      library: { taken: 2, returned: 2, returnedOnTime: 1, returnedLate: 1, overdue: 0, stillHeld: 1 },
      participation: { remindersSent: 3, noticesSent: 5, phoneOnFile: true },
      ...(over.fees === undefined ? { fees: { paidTotal: 1000, paidYearToDate: 6150, latestPaymentKey: "2026-07-08", byHead: [{ head: "TUITION", amount: 800 }], supportHeads: [] } } : {}),
    },
    cohort: {
      rosterSize: 20,
      attendanceRate: { avg: 88, best: 100, n: 20, bestWithheld: false },
      attendancePresentDays: { avg: 19, best: 22, n: 20, bestWithheld: false },
    },
    schoolBestPresentDays: 22,
    trends: {
      attendance: { state: "DOWN", delta: -9 },
      homeworkSubmission: { state: "STEADY", delta: 5 },
      classTest: { state: "UP", delta: 5 },
      concerns: { state: "DOWN", delta: 2 },
    },
    flags: [{ flag: "ABSENT_STREAK", value: 3, threshold: 3 }],
    config: DEFAULT_MONTHLY_REPORT_CONFIG,
  }) as unknown as MonthlySnapshot;

const base = {
  snapshot: snapshot(),
  status: "RELEASED" as const,
  revision: 2,
  periodKey: "2026-07",
  dataAsOf: new Date("2026-07-31T23:00:00.000Z"),
  provisional: false,
  comment: "আপনার সন্তান গণিতে ভালো করেছে।",
  studentName: "মারুফ হাসান",
  classLabel: "চতুর্থ শ্রেণি",
  sectionLabel: "ক",
  rollNumber: "12",
  fullView: true,
  subjectFilter: [],
  printedByName: "আবদুল্লাহ",
  printedAt: new Date("2026-08-03T10:20:00.000Z"),
  changeLog: ["classTest.unmarked: 2 → 0"],
  subjectLabels: { BANGLA: "বাংলা", MATH: "গণিত", ENGLISH: "ইংরেজি" },
};

describe("MR-7 §8 — the sheet states what it is", () => {
  test("a released revision carries its status, revision and the re-release warning", () => {
    const md = buildMonthlyReportMarkdown(base);
    expect(md).toContain("প্রকাশিত");
    expect(md).toContain("সংস্করণ");
    expect(md).toContain("নতুন সংস্করণ তৈরি হবে");
  });

  test("AN UNRELEASED REVISION SAYS SO — it cannot be mistaken for the family's copy", () => {
    const md = buildMonthlyReportMarkdown({ ...base, status: "DRAFT", comment: null });
    expect(md).toContain("এই সংস্করণ এখনো প্রকাশিত হয়নি");
    expect(md).not.toContain("নতুন সংস্করণ তৈরি হবে");
  });

  test("a provisional report says its data is incomplete", () => {
    expect(buildMonthlyReportMarkdown({ ...base, provisional: true })).toContain("অসম্পূর্ণ তথ্য");
  });

  test("it stamps who printed it and when", () => {
    const md = buildMonthlyReportMarkdown(base);
    expect(md).toContain("প্রিন্ট করেছেন: আবদুল্লাহ");
  });

  test("the change log prints, so a re-release can be explained", () => {
    expect(buildMonthlyReportMarkdown(base)).toContain("classTest.unmarked: 2 → 0");
  });
});

describe("MR-7 — the numbers come from the snapshot, not from a recomputation", () => {
  test("attendance, cohort and the school best all print as frozen", () => {
    const md = buildMonthlyReportMarkdown(base);
    expect(md).toContain("১৮ / ২২"); // present / school days
    expect(md).toContain("৮২%"); // rate
    expect(md).toContain("৮৮%"); // class average
    expect(md).toContain("২২"); // school best present days
  });

  test("every trend prints with the delta it was decided on", () => {
    const md = buildMonthlyReportMarkdown(base);
    expect(md).toContain("মনোযোগ প্রয়োজন (-৯)");
    expect(md).toContain("স্থিতিশীল (+৫)");
  });

  test("the flags surface", () => {
    expect(buildMonthlyReportMarkdown(base)).toContain("টানা অনুপস্থিতি");
  });

  test("the appendix prints the thresholds this revision was computed with", () => {
    const md = buildMonthlyReportMarkdown(base);
    expect(md).toContain("প্রবণতা নির্ণয়ের নিয়ম");
    expect(md).toContain("১০ কর্মদিবস");
  });
});

describe("MR-7 §4 — a narrowed sheet", () => {
  const narrowed = buildMonthlyReportMarkdown({
    ...base,
    snapshot: snapshot({ subjects: ["MATH"], fees: null }),
    fullView: false,
    subjectFilter: ["MATH"],
    comment: null,
  });

  test("says on the page that it is limited, and names the subject", () => {
    expect(narrowed).toContain("এই রিপোর্টটি সীমিত");
    expect(narrowed).toContain("গণিত");
  });

  test("carries no other subject's row", () => {
    expect(narrowed).not.toContain("বাংলা");
  });

  test("carries NO paragraph — a cross-subject summary is not a narrowed reader's to see", () => {
    expect(narrowed).not.toContain("আপনার সন্তান গণিতে ভালো করেছে।");
  });

  test("carries no fee block", () => {
    expect(narrowed).not.toContain("ফি (পরিশোধের হিসাব)");
  });
});

describe("MR-7 — it renders", () => {
  test("the markdown becomes a valid Bangla PDF through the shared engine", async () => {
    const buf = await markdownToPdf(buildMonthlyReportMarkdown(base), {
      title: "মাসিক অগ্রগতি রিপোর্ট",
      fontScale: 0.92,
      margin: 38,
    });
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.toString("binary")).toMatch(/NotoSansBengali/);
    expect(buf.byteLength).toBeGreaterThan(5_000);
  }, 30_000);
});
