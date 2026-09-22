/**
 * Scholarship analysis export — SC-8 (D-#695).
 *
 * The file is written to be READ BY A MODEL that will generate practice questions from
 * it, so the things under test are the things that would make that practice wrong:
 *
 *  - an under-floor row must be separated and labelled an UNKNOWN, never listed among
 *    the weaknesses (a model handed "0%" with no caveat drills the wrong thing);
 *  - the catalogue must carry each item's real marks, or the practice comes back the
 *    right topic at the wrong size;
 *  - a null must render as an em dash and never as 0 (D-#660 all the way to the file);
 *  - a pipe in a Bangla topic label must not split the table it sits in.
 *
 * Pure string building — no database, no HTTP.
 */
import { buildAnalysisMarkdown } from "../modules/scholarship/services/ScholarshipExportService";
import type { AxisRow, StudentAnalysis } from "../modules/scholarship/services/ScholarshipAnalysisService";
import type { TopicView } from "../modules/scholarship/services/ScholarshipService";

const row = (over: Partial<AxisRow>): AxisRow => ({
  key: "TOP-X",
  label: "Rearrange the sentences to form a story",
  subject: "ENG",
  earned: 0,
  available: 21,
  percent: 0,
  band: "weak",
  classPercent: 43.8,
  classGap: -44,
  behindClass: true,
  paperCount: 3,
  series: [],
  classRank: { rank: 7, of: 7 },
  ...over,
});

const analysis = (over: Partial<StudentAnalysis>): StudentAnalysis => ({
  studentId: "stu-1",
  topics: [],
  chapters: [],
  papersSat: 3,
  totalEarned: 256.5,
  totalAvailable: 504,
  overallPercent: 50.9,
  papers: [],
  ...over,
});

const catalogue: TopicView[] = [
  { code: "TOP-X", labelBn: "Rearrange the sentences", subject: "ENG", axis: "skill", chapters: [], marks: 7, order: 13, active: true },
  { code: "TOP-Y", labelBn: "Write an email", subject: "ENG", axis: "skill", chapters: [], marks: 10, order: 22, active: true },
];

const build = (a: StudentAnalysis, cat: TopicView[] = catalogue): string =>
  buildAnalysisMarkdown({
    studentName: "Zulqarnain Chowdhury",
    classLevel: 5,
    subject: "ENG",
    analysis: a,
    catalogue: cat,
    today: "2026-09-22",
  });

describe("buildAnalysisMarkdown", () => {
  it("names the student and states the subject and overall figure", () => {
    const md = build(analysis({ topics: [row({})] }));
    expect(md).toContain("**Zulqarnain Chowdhury**");
    expect(md).toContain("Class 5 · English");
    expect(md).toContain("3 papers sat");
    expect(md).toContain("overall 50.9%");
  });

  it("tells the reader what the floor means BEFORE showing any number", () => {
    // A model given percentages with no rules treats every row as equally meaningful.
    const md = build(analysis({ topics: [row({})] }));
    const howTo = md.indexOf("## How to read this");
    expect(howTo).toBeGreaterThan(-1);
    expect(howTo).toBeLessThan(md.indexOf("## Topics"));
    expect(md).toContain("neither");
    expect(md).toContain("unknown, not a weakness");
  });

  it("separates under-floor rows from the weaknesses and says not to drill them", () => {
    const md = build(
      analysis({
        topics: [
          row({}),
          row({ key: "TOP-T", label: "Tense", available: 10, percent: null, band: "insufficient", classRank: null }),
        ],
      }),
    );
    const weak = md.indexOf("## Topics — weakest first");
    const unknown = md.indexOf("## Not enough evidence yet");
    expect(unknown).toBeGreaterThan(weak);
    // The insufficient row is BELOW the heading, i.e. not in the weakest-first table.
    expect(md.indexOf("| Tense |")).toBeGreaterThan(unknown);
    expect(md).toContain("Do not treat these as weaknesses");
  });

  it("renders a missing number as an em dash, never as zero", () => {
    const md = build(
      analysis({
        overallPercent: null,
        topics: [row({ percent: null, band: "insufficient", classPercent: null, classGap: null, classRank: null })],
      }),
    );
    expect(md).toContain("overall —");
    expect(md).not.toContain("overall 0%");
    // marks / % / class avg / gap / position all empty on that row
    expect(md).toContain("| 0/21 | — | not enough evidence | — | — | — | — |");
  });

  it("prints a trend only from the second sitting", () => {
    const one = build(analysis({ topics: [row({ series: [{ paperId: "p1", label: "Unit 1", earned: 1, available: 5, percent: 20 }] })] }));
    expect(one).toMatch(/\| — \|\n/);
    const two = build(
      analysis({
        topics: [
          row({
            series: [
              { paperId: "p1", label: "Unit 1", earned: 1, available: 5, percent: 20 },
              { paperId: "p2", label: "Unit 2", earned: 4, available: 5, percent: 80 },
            ],
          }),
        ],
      }),
    );
    expect(two).toContain("20% → 80%");
  });

  it("carries each catalogue item's real marks — practice at the wrong size is the failure mode", () => {
    const md = build(analysis({ topics: [row({})] }));
    expect(md).toContain("## The shape of a real paper");
    expect(md).toContain("| 1 | Rearrange the sentences | 7 |");
    expect(md).toContain("| 2 | Write an email | 10 |");
  });

  it("renders a catalogue item with no fixed mark as an em dash (D-#672)", () => {
    const md = build(analysis({ topics: [row({})] }), [{ ...catalogue[0], marks: null }]);
    expect(md).toContain("| 1 | Rearrange the sentences | — |");
  });

  it("says the chapter axis is EMPTY BECAUSE NOTHING IS TAGGED, not that she is fine", () => {
    const md = build(analysis({ topics: [row({})], chapters: [] }));
    expect(md).toContain("This is a gap in the declared papers, not a fact about her");
  });

  it("neutralises a pipe in a label so it cannot split the table", () => {
    const md = build(analysis({ topics: [row({ label: "সাধু | চলিত" })] }));
    expect(md).toContain("সাধু / চলিত");
    expect(md).not.toContain("সাধু | চলিত");
  });

  it("lists the papers with their dates and places", () => {
    const md = build(
      analysis({
        topics: [row({})],
        papers: [
          { paperId: "p1", label: "Eng Unit 1 Test 1", date: "2026-09-15", earned: 91, available: 168, percent: 54.2, rank: { rank: 3, of: 6 } },
        ],
      }),
    );
    expect(md).toContain("| Eng Unit 1 Test 1 | 2026-09-15 | 91/168 | 54.2% | 3 of 6 |");
  });

  it("says so plainly when nothing has cleared the floor yet", () => {
    const md = build(
      analysis({ topics: [row({ percent: null, band: "insufficient", classRank: null })] }),
    );
    expect(md).toContain("No topic has enough evidence for a verdict yet");
  });
});
