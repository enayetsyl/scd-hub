/**
 * MR-8 — the Desktop round trip (docs/prd-monthly-report.md §8b, D-#415).
 *
 * The slice table names three refusals as the verification: a moved figure, an
 * invented numeral, and a released revision. All three are here, plus the two
 * properties the feature is unsafe without:
 *
 *   · the export carries NO identity — it goes into a chat window, which is a wider
 *     exposure than an API call, not a narrower one;
 *   · the rules in the file are the SAME string the in-app prompt is built from, so
 *     the two lanes cannot drift apart;
 *   · absent stamps REFUSE rather than skip the binding — a guard that silently does
 *     not run is the drift this feature was specified to prevent.
 *
 * DB-free: every function under test is pure. `importComments` (the write half) is
 * covered through `checkImportedComment`, which is the whole of its decision.
 */
import {
  buildCommentExportMarkdown,
  checkImportedComment,
  exportBlocksOf,
  parseImportEnvelope,
  CommentImportError,
  MONTHLY_COMMENT_EXCHANGE_VERSION,
} from "../modules/reports/services/MonthlyCommentExchangeService";
import { figuresHashOf, type MonthlySnapshot } from "../modules/reports/services/MonthlyReportService";
import { commentRules } from "../modules/reports/services/MonthlyCommentService";
import { DEFAULT_MONTHLY_REPORT_CONFIG } from "../modules/reports/services/MonthlyReportConfigService";
import type { IMonthlyReport } from "../modules/reports/models/MonthlyReport";
import { entryName } from "../modules/reports/routes/monthlyCommentExport";

const TREND = { state: "STEADY" };

const snapshot = (p: { present?: number; hwSubmitted?: number } = {}): MonthlySnapshot =>
  ({
    metrics: {
      periodKey: "2026-07",
      attendance: { present: p.present ?? 18, schoolDays: 22, rate: 82, absentUncovered: 2, absentStreakMax: 2 },
      homework: {
        issued: 38, submitted: p.hwSubmitted ?? 27, expectedWhilePresent: 32,
        submissionRate: 84, qualityRate: 63, checked: 30, correct: 24, partial: 0, wrong: 6,
        bySubject: [
          { subject: "BAN", submitted: 15, expectedWhilePresent: 16, checked: 14, correct: 10, partial: 0, wrong: 4, qualityRate: 71 },
          { subject: "MATH", submitted: 12, expectedWhilePresent: 16, checked: 16, correct: 7, partial: 2, wrong: 7, qualityRate: 44 },
        ],
        coverage: { settled: 0, total: 0, pct: 92 },
      },
      assignment: {
        issued: 6, submitted: 4, expectedWhilePresent: 5, submissionRate: 80, qualityRate: 50,
        checked: 4, correct: 2, partial: 0, wrong: 2,
        bySubject: [
          { subject: "BAN", submitted: 2, expectedWhilePresent: 2, checked: 2, correct: 2, partial: 0, wrong: 0, qualityRate: 100 },
          { subject: "MATH", submitted: 2, expectedWhilePresent: 3, checked: 2, correct: 0, partial: 1, wrong: 1, qualityRate: 0 },
        ],
        coverage: { settled: 0, total: 0, pct: 67 },
      },
      classTest: {
        attended: 11, testsHeld: 14, rate: 79, unmarked: 2,
        coverage: { settled: 0, total: 0, pct: 86 },
      },
      hifz: { sessions: 4, present: 3 },
      concerns: { concern: 3, positive: 2 },
      library: { taken: 2, overdue: 0 },
      fees: { paidTotal: 1000, paidYearToDate: 6150 },
    },
    trends: {
      attendance: { state: "DOWN" },
      homeworkSubmission: TREND,
      assignmentSubmission: TREND,
      classTest: TREND,
      concerns: TREND,
    },
    cohort: { attendanceRate: { avg: 88 } },
    flags: [],
    config: DEFAULT_MONTHLY_REPORT_CONFIG,
    classLevel: 3,
  }) as unknown as MonthlySnapshot;

/** The minimum of a report the guards actually read. */
const reportOf = (over: Partial<{ status: string; revision: number; snapshot: MonthlySnapshot }> = {}) =>
  ({
    status: over.status ?? "DRAFT",
    revision: over.revision ?? 1,
    snapshot: over.snapshot ?? snapshot(),
  }) as unknown as Pick<IMonthlyReport, "status" | "revision" | "snapshot">;

/** A paragraph whose only numerals are ones the facts contain. */
const GOOD_TEXT =
  "আপনার সন্তান জুলাই মাসে ২২ দিনের মধ্যে ১৮ দিন উপস্থিত ছিল। বাড়ির কাজ নিয়মিত জমা দিচ্ছে, তবে আরও যত্ন প্রয়োজন। প্রতিদিন বাড়িতে পড়ার একটি নির্দিষ্ট সময় ঠিক করে দিন।";

const stamps = (r = reportOf()) => ({
  revision: r.revision,
  figuresHash: figuresHashOf(r.snapshot as unknown as MonthlySnapshot),
});

// ---------------------------------------------------------------------------
// The three refusals the slice table names
// ---------------------------------------------------------------------------

describe("MR-8 §8b.4 — a moved figure is refused", () => {
  test("a comment written against figures that have since changed does not import", () => {
    const exported = reportOf({ snapshot: snapshot({ present: 18 }) });
    const now = reportOf({ snapshot: snapshot({ present: 21 }) }); // a mark landed in between
    const reason = checkImportedComment(GOOD_TEXT, now, stamps(exported));
    expect(reason).toMatch(/সংখ্যা বদলে গেছে/);
  });

  test("unchanged figures import cleanly", () => {
    const r = reportOf();
    expect(checkImportedComment(GOOD_TEXT, r, stamps(r))).toBeNull();
  });

  test("the hash ignores key ORDER, so an unchanged month is not falsely refused", () => {
    // Two snapshots with the same values must hash alike, or every export would be
    // invalidated by an implementation detail of how reportedFigures builds its object.
    expect(figuresHashOf(snapshot())).toBe(figuresHashOf(snapshot()));
  });
});

describe("MR-8 §8b.3 — an invented numeral is refused", () => {
  test("a number that is in no fact refuses the row, and names it", () => {
    const r = reportOf();
    const text = "আপনার সন্তান ২২ দিনের মধ্যে ১৯ দিন উপস্থিত ছিল। বাড়িতে নিয়মিত পড়ার অভ্যাস গড়ে তুলুন।";
    const reason = checkImportedComment(text, r, stamps(r));
    expect(reason).toMatch(/১৯|19/);
  });

  test("prose shape is enforced too — JSON debris is not a paragraph", () => {
    const r = reportOf();
    expect(checkImportedComment('{"text": "কিছু একটা"}', r, stamps(r))).not.toBeNull();
  });
});

describe("MR-8 §8b.3 — a released revision is refused", () => {
  test.each(["RELEASED", "SUPERSEDED"])("%s cannot be overwritten by an import", (status) => {
    const r = reportOf({ status });
    expect(checkImportedComment(GOOD_TEXT, r, stamps(r))).toMatch(/প্রকাশিত/);
  });

  test("the immutability reason wins over a numeral fault — the ROOT problem is reported", () => {
    // Told "৪২ is not in the facts" about a document that could not be edited anyway,
    // an operator would go and fix the wrong thing.
    const r = reportOf({ status: "RELEASED" });
    const bad = "আপনার সন্তান ৪২ দিন উপস্থিত ছিল। বাড়িতে নিয়মিত পড়ার অভ্যাস গড়ে তুলুন।";
    expect(checkImportedComment(bad, r, stamps(r))).toMatch(/প্রকাশিত/);
  });
});

// ---------------------------------------------------------------------------
// The binding must fail CLOSED
// ---------------------------------------------------------------------------

describe("MR-8 §8b.4 — absent stamps refuse, never skip", () => {
  test.each([
    ["no revision", { revision: null, figuresHash: "abc" }],
    ["no figuresHash", { revision: 1, figuresHash: null }],
    ["neither", { revision: null, figuresHash: null }],
  ])("%s → refused", (_label, expected) => {
    const reason = checkImportedComment(GOOD_TEXT, reportOf(), expected);
    expect(reason).toMatch(/revision\/figuresHash/);
  });
});

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

describe("MR-8 §8b.2 — the envelope is validated, and a fault NAMES the row", () => {
  const id = "64b7f9c2e4b0a1c2d3e4f5a6";
  const ok = JSON.stringify({
    periodKey: "2026-07",
    sectionId: "sec-1",
    comments: [{ reportId: id, revision: 1, figuresHash: "h", text: "কিছু একটা লেখা।" }],
  });

  test("a well-formed envelope parses, carrying the stamps through", () => {
    const env = parseImportEnvelope(ok);
    expect(env.periodKey).toBe("2026-07");
    expect(env.comments).toHaveLength(1);
    expect(env.comments[0]).toMatchObject({ reportId: id, revision: 1, figuresHash: "h" });
  });

  test.each([
    ["not JSON at all", "sorry, here are the comments!"],
    ["a bare array", "[]"],
    ["no periodKey", JSON.stringify({ comments: [{ reportId: id, text: "x" }] })],
    ["a bad periodKey", JSON.stringify({ periodKey: "2026-13", comments: [] })],
    ["an empty list", JSON.stringify({ periodKey: "2026-07", comments: [] })],
    ["a malformed reportId", JSON.stringify({ periodKey: "2026-07", comments: [{ reportId: "nope", text: "x" }] })],
    ["a missing text", JSON.stringify({ periodKey: "2026-07", comments: [{ reportId: id, text: "  " }] })],
  ])("%s is refused outright", (_label, raw) => {
    expect(() => parseImportEnvelope(raw)).toThrow(CommentImportError);
  });

  test("a duplicate reportId is refused, naming the id", () => {
    const dupe = JSON.stringify({
      periodKey: "2026-07",
      comments: [
        { reportId: id, text: "একটি লেখা।" },
        { reportId: id, text: "আরেকটি লেখা।" },
      ],
    });
    expect(() => parseImportEnvelope(dupe)).toThrow(new RegExp(id));
  });
});

// ---------------------------------------------------------------------------
// The export
// ---------------------------------------------------------------------------

describe("MR-8 §8b.1 — the export is de-identified and shares one copy of the rules", () => {
  const report = {
    _id: { toString: () => "64b7f9c2e4b0a1c2d3e4f5a6" },
    revision: 2,
    snapshot: snapshot(),
  } as unknown as IMonthlyReport;

  // classLevel is NOT in the snapshot — the in-app lane resolves it from the Class, so
  // the export must be handed the same thing rather than reading a field that is not
  // there. Driving the real route caught this sending null where the other lane sends
  // a number: the two lanes disagreeing about the facts.
  const LEVELS = new Map([["64b7f9c2e4b0a1c2d3e4f5a6", 3]]);

  test("a block carries the reportId and both stamps, and no name", () => {
    const [block] = exportBlocksOf([report], LEVELS);
    expect(block.reportId).toBe("64b7f9c2e4b0a1c2d3e4f5a6");
    expect(block.revision).toBe(2);
    expect(block.figuresHash).toBe(figuresHashOf(snapshot()));
    expect(JSON.stringify(block.facts)).not.toMatch(/name|roll|phone|guardian/i);
  });

  test("the classLevel handed in reaches the facts — both lanes must see the same number", () => {
    // Reading it off the snapshot silently produced null here while the in-app lane
    // sent 3. classLevel is one of `allowedNumbers`, so the disagreement would also
    // refuse a paragraph that legitimately named the class.
    expect(exportBlocksOf([report], LEVELS)[0].facts.classLevel).toBe(3);
    expect(exportBlocksOf([report], new Map())[0].facts.classLevel).toBeNull();
  });

  test("the file contains no identity — only ids, numbers and subject codes", () => {
    const md = buildCommentExportMarkdown(exportBlocksOf([report], LEVELS), {
      periodKey: "2026-07",
      sectionLabel: "তৃতীয় — মূল",
      sectionId: "sec-1",
    });
    // The section LABEL is a class name, not a child's; nothing per-child may identify.
    expect(md).toContain("64b7f9c2e4b0a1c2d3e4f5a6");
    expect(md).not.toMatch(/rollNumber|studentId|guardianPhone/);
  });

  test("the instruction block IS commentRules — not a second copy that can drift", () => {
    const md = buildCommentExportMarkdown(exportBlocksOf([report], LEVELS), {
      periodKey: "2026-07",
      sectionLabel: "তৃতীয় — মূল",
      sectionId: "sec-1",
    });
    expect(md).toContain(commentRules("2026-07"));
  });

  test("every section gets its OWN zip entry — a repeated name is a silent overwrite", () => {
    // The bug this pins: class names are Bangla, `slug()` strips them to nothing, and
    // every section here is coded "Main" — so four sections all resolved to
    // "Main-2026-07.md" and JSZip kept the last one. A four-class export shipped as a
    // one-class zip, with no error and nothing to notice until someone went looking.
    const used = new Set<string>();
    const names = [
      entryName(used, { level: 1, code: "Main", periodKey: "2026-07" }),
      entryName(used, { level: 2, code: "Main", periodKey: "2026-07" }),
      entryName(used, { level: 3, code: "Main", periodKey: "2026-07" }),
    ];
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe("class-1-Main-2026-07.md");
  });

  test("names stay unique even when the level cannot separate them", () => {
    // Belt-and-braces: a missing level must degrade to a numbered name, never to an
    // overwrite. Nothing about naming may be able to drop a section.
    const used = new Set<string>();
    const names = [
      entryName(used, { level: null, code: "Main", periodKey: "2026-07" }),
      entryName(used, { level: null, code: "Main", periodKey: "2026-07" }),
      entryName(used, { level: null, code: "Main", periodKey: "2026-07" }),
    ];
    expect(new Set(names).size).toBe(3);
  });

  test("the return-format sample asks for the stamps back — without them the binding cannot run", () => {
    const md = buildCommentExportMarkdown(exportBlocksOf([report], LEVELS), {
      periodKey: "2026-07",
      sectionLabel: "তৃতীয় — মূল",
      sectionId: "sec-1",
    });
    expect(md).toContain('"figuresHash"');
    expect(md).toContain('"revision"');
    expect(md).toContain(MONTHLY_COMMENT_EXCHANGE_VERSION);
  });
});
