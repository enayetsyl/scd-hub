/**
 * Scholarship weakness analysis — SC-3/SC-4 (docs/prd-scholarship-practice.md §6,
 * D-#660/#661/#662/#663).
 *
 * Floor     — under 15 available marks there is NO percentage and NO band, and the row
 *             sinks below every ranked one however bad its arithmetic looks (D-#662) —
 *             unless the topic has been set on two separate papers, the second door
 *             added at D-#691.
 * Trend     — every row carries its per-sitting points, oldest first, unfloored (SC-7).
 * Rank      — a place among the students who SAT the topic, ties sharing a place, and
 *             never on a row that refused to give a percentage (SC-7).
 * Absence   — an ABSENT paper contributes to NEITHER side, personal or class, and an
 *             unmarked item is not a zero (D-#660).
 * Axes      — topic partitions and reconciles; a multi-chapter item counts IN FULL
 *             toward each chapter, so the chapter axis deliberately does not sum (D-#661).
 * Bands     — absolute against the scholarship bar, plus the class gap, and the two are
 *             allowed to disagree (D-#663).
 *
 * Pure functions over hand-built rows — no database, no mocks.
 */
import {
  bandOf,
  buildRows,
  hasVerdict,
  paperResults,
  percentOf,
  rankAxis,
  rankBy,
  rankRows,
  tallyClass,
  tallyStudent,
  type AxisRow,
  type PaperWithScores,
} from "../modules/scholarship/services/ScholarshipAnalysisService";
import { SCHOLARSHIP_MIN_MARKS_FOR_VERDICT } from "@scd/shared";

const ART = "TOP-ART";
const COMP = "TOP-COMP";

/** One paper: an 18-mark comprehension item spanning chapters 1 and 2, and a 5-mark
 *  article item with no chapter (a grammar skill spans the book). */
const paper = (id: string, scores: PaperWithScores["scores"]): PaperWithScores => ({
  paper: {
    _id: id as never,
    items: [
      { itemNo: 1, label: "comprehension", subject: "ENG", topicCode: COMP, chapters: [1, 2], itemType: "descriptive", marks: 18 },
      { itemNo: 2, label: "articles", subject: "ENG", topicCode: ART, chapters: [], itemType: "fill_blank", marks: 5 },
    ],
  },
  scores,
});

const present = (studentId: string, marks: { itemNo: number; marks: number }[]) => ({
  studentId: studentId as never,
  status: "PRESENT" as const,
  itemMarks: marks,
});

const absent = (studentId: string) => ({
  studentId: studentId as never,
  status: "ABSENT" as const,
  itemMarks: [],
});

const A = "stu-a";
const B = "stu-b";

describe("percentOf and the reliability floor", () => {
  it("refuses a percentage under the floor, however lopsided the marks", () => {
    // One 5-mark item, 1 earned. Arithmetically 20% and the worst number on the screen —
    // and from a sample of one question, which is exactly what must not be ranked.
    expect(percentOf(1, 5)).toBeNull();
    expect(bandOf(percentOf(1, 5), 5)).toBe("insufficient");
  });

  it("computes once the floor is reached", () => {
    expect(percentOf(5, SCHOLARSHIP_MIN_MARKS_FOR_VERDICT)).toBeCloseTo(33.3, 1);
    expect(bandOf(percentOf(5, 15), 15)).toBe("weak");
  });

  it("opens the MARKS door on one sitting when the marks alone are enough", () => {
    // One 18-mark comprehension item carries more evidence than four 1-mark gaps, and
    // passes on its first outing without any help from the paper count (D-#662).
    expect(percentOf(9, 18)).toBe(50);
    expect(bandOf(percentOf(9, 18), 18)).toBe("fair");
    expect(hasVerdict(18, 1)).toBe(true);
  });

  it("opens the PAPERS door on a second sitting, however few the marks (D-#691)", () => {
    // A 5-mark item asked twice a fortnight apart, 0 both times. Ten marks never reach
    // the mark floor, but two independent readings agreeing is not a sample of one.
    expect(percentOf(0, 10)).toBeNull();
    expect(percentOf(0, 10, 2)).toBe(0);
    expect(bandOf(percentOf(0, 10, 2), 10, 2)).toBe("weak");
  });

  it("keeps ONE sitting shut whatever its marks say", () => {
    // The amendment adds a door; it does not widen the original one. A single 5-mark
    // item is still the sample of one that D-#662 exists to refuse.
    expect(hasVerdict(5, 1)).toBe(false);
    expect(bandOf(percentOf(1, 5, 1), 5, 1)).toBe("insufficient");
  });

  it("refuses a verdict on zero available marks through either door", () => {
    expect(hasVerdict(0, 9)).toBe(false);
    expect(percentOf(0, 0, 9)).toBeNull();
  });

  it("bands on the scholarship bar: <50 weak, <70 fair, >=70 good", () => {
    expect(bandOf(49.9, 20)).toBe("weak");
    expect(bandOf(50, 20)).toBe("fair");
    expect(bandOf(69.9, 20)).toBe("fair");
    expect(bandOf(70, 20)).toBe("good");
  });
});

describe("tallyStudent", () => {
  it("credits a multi-chapter item IN FULL to each chapter it lists", () => {
    const data = [paper("p1", [present(A, [{ itemNo: 1, marks: 9 }, { itemNo: 2, marks: 1 }])])];
    const byChapter = tallyStudent(data, A, "chapter");
    // 18 marks appear against BOTH chapter 1 and chapter 2 — the question is "how does
    // she do on questions that TOUCH chapter 2", so half-weighting would invent a split.
    expect(byChapter.get("1")!.available).toEqual([18]);
    expect(byChapter.get("2")!.available).toEqual([18]);
    // The article item lists no chapter, so it appears on neither.
    expect([...byChapter.keys()].sort()).toEqual(["1", "2"]);
  });

  it("partitions on the topic axis — every item lands in exactly one bucket", () => {
    const data = [paper("p1", [present(A, [{ itemNo: 1, marks: 9 }, { itemNo: 2, marks: 1 }])])];
    const byTopic = tallyStudent(data, A, "topic");
    expect(byTopic.get(COMP)!.available).toEqual([18]);
    expect(byTopic.get(ART)!.available).toEqual([5]);
    const total = [...byTopic.values()].flatMap((t) => t.available).reduce((a, b) => a + b, 0);
    expect(total).toBe(23); // the paper's own total — the topic axis reconciles
  });

  it("ignores a paper the student was ABSENT for — neither earned nor available", () => {
    const data = [
      paper("p1", [present(A, [{ itemNo: 1, marks: 9 }, { itemNo: 2, marks: 1 }])]),
      paper("p2", [absent(A)]),
    ];
    const byTopic = tallyStudent(data, A, "topic");
    expect(byTopic.get(COMP)!.available).toEqual([18]);
    expect(byTopic.get(COMP)!.papers.size).toBe(1);
  });

  it("ignores a paper the student has no row on at all", () => {
    const data = [paper("p1", [present(B, [{ itemNo: 1, marks: 9 }])])];
    expect(tallyStudent(data, A, "topic").size).toBe(0);
  });

  it("treats an UNMARKED item as unmarked, not as zero", () => {
    // Marking is often half-done. Counting a missing cell as 0 would report a weakness
    // that is really an unfinished marking pass.
    const data = [paper("p1", [present(A, [{ itemNo: 1, marks: 9 }])])];
    const byTopic = tallyStudent(data, A, "topic");
    expect(byTopic.has(ART)).toBe(false);
    expect(byTopic.get(COMP)!.earned).toEqual([9]);
  });
});

describe("tallyClass", () => {
  it("pools only PRESENT students, so an absent child cannot move the mean", () => {
    const data = [
      paper("p1", [
        present(A, [{ itemNo: 2, marks: 5 }]),
        absent(B),
      ]),
    ];
    const cls = tallyClass(data, [A, B], "topic");
    expect(cls.get(ART)).toEqual({ earned: 5, available: 5 });
  });

  it("sums half marks without floating-point drift", () => {
    const halfPaper: PaperWithScores = {
      paper: {
        _id: "p1" as never,
        items: Array.from({ length: 10 }, (_, i) => ({
          itemNo: i + 1,
          label: `p${i}`,
          subject: "ENG" as const,
          topicCode: ART,
          chapters: [],
          itemType: "fill_blank" as const,
          marks: 0.5,
        })),
      },
      scores: [present(A, Array.from({ length: 10 }, (_, i) => ({ itemNo: i + 1, marks: 0.5 })))],
    };
    const cls = tallyClass([halfPaper], [A], "topic");
    expect(cls.get(ART)).toEqual({ earned: 5, available: 5 });
  });
});

describe("rankRows", () => {
  const row = (key: string, percent: number | null, band: AxisRow["band"], available: number): AxisRow => ({
    key,
    label: key,
    subject: "ENG",
    earned: 0,
    available,
    percent,
    band,
    classPercent: null,
    classGap: null,
    behindClass: false,
    paperCount: 1,
    series: [],
    classRank: null,
  });

  it("puts the weakest ranked row first", () => {
    const out = rankRows([row("a", 70, "good", 20), row("b", 31, "weak", 20), row("c", 55, "fair", 20)]);
    expect(out.map((r) => r.key)).toEqual(["b", "c", "a"]);
  });

  it("sinks every insufficient row below the ranked ones, however low its arithmetic", () => {
    // A 20%-looking row with 5 marks behind it must never head a list titled "weakest
    // topics" — that is the whole point of the floor.
    const out = rankRows([row("weak", 31, "weak", 20), row("thin", null, "insufficient", 5)]);
    expect(out.map((r) => r.key)).toEqual(["weak", "thin"]);
  });
});

describe("buildRows", () => {
  const label = (k: string) => `label:${k}`;

  it("carries the class gap and flags a student well behind her own class", () => {
    const data = [
      paper("p1", [
        present(A, [{ itemNo: 1, marks: 4 }]),  // 4/18 = 22.2%
        present(B, [{ itemNo: 1, marks: 16 }]), // 16/18 = 88.9%
      ]),
    ];
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A, B], "topic"), label);
    const comp = rows.find((r) => r.key === COMP)!;
    expect(comp.band).toBe("weak");
    expect(comp.classPercent).toBeCloseTo(55.6, 1);
    expect(comp.classGap).toBe(-33);
    expect(comp.behindClass).toBe(true);
  });

  it("does NOT flag a weak student whose whole class is equally weak — that is a teaching problem", () => {
    // The absolute band and the relative flag are allowed to disagree, and their
    // disagreeing is the most actionable output the analysis has (D-#663).
    const data = [
      paper("p1", [
        present(A, [{ itemNo: 1, marks: 7 }]),
        present(B, [{ itemNo: 1, marks: 7 }]),
      ]),
    ];
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A, B], "topic"), label);
    const comp = rows.find((r) => r.key === COMP)!;
    expect(comp.band).toBe("weak");
    expect(comp.classGap).toBe(0);
    expect(comp.behindClass).toBe(false);
  });

  it("reports an under-floor topic with no percentage and no class gap to rank on", () => {
    const data = [paper("p1", [present(A, [{ itemNo: 2, marks: 1 }])])];
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A], "topic"), label);
    const art = rows.find((r) => r.key === ART)!;
    expect(art.available).toBe(5);
    expect(art.percent).toBeNull();
    expect(art.band).toBe("insufficient");
    expect(art.classGap).toBeNull();
    expect(art.behindClass).toBe(false);
  });

  it("accumulates one topic across several papers until it clears the floor", () => {
    // Four 5-mark article items across four papers = 20 available, which passes 15.
    const data = ["p1", "p2", "p3", "p4"].map((id) =>
      paper(id, [present(A, [{ itemNo: 2, marks: 1 }])]),
    );
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A], "topic"), label);
    const art = rows.find((r) => r.key === ART)!;
    expect(art.available).toBe(20);
    expect(art.percent).toBe(20);
    expect(art.band).toBe("weak");
    expect(art.paperCount).toBe(4);
  });

  it("clears the floor on the SECOND paper now, without waiting for 15 marks (D-#691)", () => {
    const data = ["p1", "p2"].map((id) => paper(id, [present(A, [{ itemNo: 2, marks: 0 }])]));
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A], "topic"), label);
    const art = rows.find((r) => r.key === ART)!;
    expect(art.available).toBe(10); // under the 15-mark floor
    expect(art.paperCount).toBe(2);
    expect(art.percent).toBe(0);
    expect(art.band).toBe("weak");
    // And it now leads the list, which is the whole point of the amendment.
    expect(rows[0].key).toBe(ART);
  });

  it("carries one trend point per sitting, oldest first, unfloored", () => {
    const data = [
      paper("p1", [present(A, [{ itemNo: 2, marks: 1 }])]),
      paper("p2", [present(A, [{ itemNo: 2, marks: 4 }])]),
    ];
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A], "topic"), label, {
      paperName: (id) => `paper ${id}`,
    });
    const art = rows.find((r) => r.key === ART)!;
    expect(art.series.map((p) => p.paperId)).toEqual(["p1", "p2"]);
    expect(art.series.map((p) => p.percent)).toEqual([20, 80]);
    expect(art.series[0].label).toBe("paper p1");
  });

  it("gives an insufficient row no rank — a place IS a percentage comparison", () => {
    // Both items marked: the 18-mark comprehension row clears the floor on one sitting,
    // the 5-mark article row does not, and only one of them may carry a place.
    const data = [paper("p1", [present(A, [{ itemNo: 1, marks: 9 }, { itemNo: 2, marks: 1 }])])];
    const rows = buildRows(tallyStudent(data, A, "topic"), tallyClass(data, [A], "topic"), label, {
      rankOf: () => ({ rank: 1, of: 6 }),
    });
    const art = rows.find((r) => r.key === ART)!;
    expect(art.band).toBe("insufficient");
    expect(art.classRank).toBeNull();
    // The ranked row on the same build DOES take the place it was handed.
    expect(rows.find((r) => r.key === COMP)!.classRank).toEqual({ rank: 1, of: 6 });
  });
});

describe("rankBy", () => {
  it("ranks highest first and counts only the students who sat it", () => {
    const out = rankBy([
      { id: "a", percent: 40 },
      { id: "b", percent: 90 },
      { id: "c", percent: null },
    ]);
    expect(out.get("b")).toEqual({ rank: 1, of: 2 });
    expect(out.get("a")).toEqual({ rank: 2, of: 2 });
    // Not last — not in the race at all, which is why `of` is 2 and not 3.
    expect(out.has("c")).toBe(false);
  });

  it("lets a tie share a place and skips the next (1, 2, 2, 4)", () => {
    const out = rankBy([
      { id: "a", percent: 90 },
      { id: "b", percent: 50 },
      { id: "c", percent: 50 },
      { id: "d", percent: 10 },
    ]);
    expect(out.get("a")!.rank).toBe(1);
    expect(out.get("b")!.rank).toBe(2);
    expect(out.get("c")!.rank).toBe(2);
    expect(out.get("d")!.rank).toBe(4);
  });
});

describe("rankAxis", () => {
  it("places each student on each topic, ignoring the ones who never sat it", () => {
    const data = [
      paper("p1", [
        present(A, [{ itemNo: 1, marks: 18 }, { itemNo: 2, marks: 1 }]),
        present(B, [{ itemNo: 1, marks: 9 }]),
        absent("stu-c"),
      ]),
    ];
    const ranks = rankAxis(data, [A, B, "stu-c"], "topic");
    expect(ranks.get(COMP)!.get(A)).toEqual({ rank: 1, of: 2 });
    expect(ranks.get(COMP)!.get(B)).toEqual({ rank: 2, of: 2 });
    // B never had the article item marked, so that topic is a field of one.
    expect(ranks.get(ART)!.get(A)).toEqual({ rank: 1, of: 1 });
    expect(ranks.get(ART)!.has(B)).toBe(false);
    expect(ranks.get(COMP)!.has("stu-c")).toBe(false);
  });
});

describe("paperResults", () => {
  const meta = (id: string) => ({ label: `paper ${id}`, date: null });

  it("lists one row per paper SAT, with the student's place on it", () => {
    const data = [
      paper("p1", [
        present(A, [{ itemNo: 1, marks: 9 }, { itemNo: 2, marks: 1 }]),
        present(B, [{ itemNo: 1, marks: 18 }, { itemNo: 2, marks: 5 }]),
      ]),
      paper("p2", [present(A, [{ itemNo: 1, marks: 18 }, { itemNo: 2, marks: 5 }])]),
    ];
    const out = paperResults(data, A, [A, B], meta);
    expect(out.map((r) => r.paperId)).toEqual(["p1", "p2"]);
    expect(out[0]).toMatchObject({ earned: 10, available: 23, rank: { rank: 2, of: 2 } });
    // B did not sit p2, so A is first of one — and the denominator says so.
    expect(out[1]).toMatchObject({ earned: 23, available: 23, rank: { rank: 1, of: 1 } });
  });

  it("omits a paper the student was ABSENT for rather than scoring it zero (D-#660)", () => {
    const data = [
      paper("p1", [present(A, [{ itemNo: 1, marks: 9 }])]),
      paper("p2", [absent(A)]),
    ];
    expect(paperResults(data, A, [A], meta).map((r) => r.paperId)).toEqual(["p1"]);
  });

  it("omits a paper whose items are all still unmarked", () => {
    const data = [paper("p1", [present(A, [])])];
    expect(paperResults(data, A, [A], meta)).toEqual([]);
  });
});
