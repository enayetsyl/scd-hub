/**
 * AL-5 (docs/prd-academic-loop-2027.md §5 B): the pure logic behind the 2027 homework screens —
 * the level words (AC-B18), the question picker's reducer + running minutes (B1/B2, AC-B16, R26),
 * the tick-wrong grid's cell cycle (B7, AC-B4) and the "no result word" rule (AC-B12, R35).
 *
 * The app workspace has no test runner, so the pure modules `app/src/lib/marksDisplay.ts`,
 * `homeworkPicker.ts` and `homeworkGrid.ts` are required from here (the `giftGrouping.test.ts` posture).
 */
import { readFileSync } from "fs";
import path from "path";

interface PickerItem { key: string; origin: "BANK" | "TEACHER"; qid: string | null; textBn: string; loCode: string; marks: number; repeat: boolean }
interface FreeLine { kind: string; textBn: string; estMinutes: number }
interface PickerState { items: PickerItem[]; freeLines: FreeLine[]; seq: number }
interface Candidate { qid: string; textBn: string; loCodes: string[]; marks: number; repeat?: boolean }
type Action =
  | { type: "load"; items: PickerItem[]; freeLines: FreeLine[] }
  | { type: "swap"; key: string; candidate: Candidate }
  | { type: "remove"; key: string }
  | { type: "addBank"; candidate: Candidate; loCode: string }
  | { type: "addOwn"; textBn: string; marks: number }
  | { type: "addFreeLine"; line: FreeLine }
  | { type: "removeFreeLine"; index: number };

const picker = require("../../../app/src/lib/homeworkPicker") as {
  emptyPicker: () => PickerState;
  pickerReducer: (s: PickerState, a: Action) => PickerState;
  totalMarks: (items: PickerItem[]) => number;
  estMinutes: (s: Pick<PickerState, "items" | "freeLines">, rate: number) => number;
  nextCandidate: (pool: Candidate[], items: PickerItem[], item: PickerItem) => Candidate | null;
  addableCandidates: (pool: Candidate[], items: PickerItem[], filter?: string) => Candidate[];
  saveArgs: (s: PickerState) => { selectedQids: string[]; teacherItems: { textBn: string; marks: number }[]; freeLines: FreeLine[] };
  draftToPicker: (items: { origin: string; qid: string | null; textBn: string | null; loCode: string; marks: number; fromBook?: boolean; repeat?: boolean }[], rate: number) => PickerState;
};

type GridItemX = { itemNo: number; marks: number | null; rework: boolean; tags: string[] };
const grid = require("../../../app/src/lib/homeworkGrid") as {
  allowsHalf: (m: number) => boolean;
  cellState: (earned: number, max: number) => "FULL" | "HALF" | "ZERO" | "CUSTOM";
  nextEarned: (earned: number, max: number) => number;
  earnedOf: (items: GridItemX[], itemNo: number, max: number) => number;
  tapCell: (items: GridItemX[], itemNo: number, max: number) => GridItemX[];
  childTotal: (items: GridItemX[], paperItems: { itemNo: number; marks: number }[]) => { earned: number; available: number };
  cellLabel: (earned: number, max: number, num: (n: number | string) => string) => string;
  toggleNotDone: (n: number[], i: number) => number[];
  rowEditable: (defaultStatus: string, resultStatus: string | null, hasRecord: boolean) => boolean;
  printedLabels: (items: { stimulusRef?: string | null }[], num: (n: number | string) => string) => string[];
  byStudentId: <T extends { schoolId?: string | null; name: string }>(rows: T[]) => T[];
};

const marks = require("../../../app/src/lib/marksDisplay") as {
  toBnDigits: (n: number | string) => string;
  fmtMarks: (n: number) => string;
  marksPercent: (e: number | null | undefined, a: number | null | undefined) => number | null;
  marksLine: (e: number | null | undefined, a: number | null | undefined, num?: (n: number | string) => string) => string | null;
  marksLevelLabel: (pct: number, lang?: "bn" | "en") => string;
  guardianMarksLine: (e: number | null | undefined, a: number | null | undefined, num?: (n: number | string) => string, lang?: "bn" | "en") => string | null;
};

const bank = (qid: string, lo = "LO1", m = 2): Candidate => ({ qid, textBn: `প্রশ্ন ${qid}`, loCodes: [lo], marks: m });
const item = (qid: string, lo = "LO1", m = 2, repeat = false): PickerItem => ({ key: qid, origin: "BANK", qid, textBn: `প্রশ্ন ${qid}`, loCode: lo, marks: m, repeat });

describe("level words (AC-B18, R32)", () => {
  it("9/10 খুব ভালো · 7/10 ভালো · 5/10 মোটামুটি · 4/10 আরও অনুশীলন দরকার", () => {
    expect(marks.marksLevelLabel(90)).toBe("খুব ভালো");
    expect(marks.marksLevelLabel(70)).toBe("ভালো");
    expect(marks.marksLevelLabel(50)).toBe("মোটামুটি");
    expect(marks.marksLevelLabel(40)).toBe("আরও অনুশীলন দরকার");
    expect(marks.marksLevelLabel(100)).toBe("খুব ভালো");
    expect(marks.marksLevelLabel(89.4)).toBe("ভালো");
    expect(marks.marksLevelLabel(0)).toBe("আরও অনুশীলন দরকার");
  });

  it("the thresholds are the shared vocab's, not a copy", () => {
    const { MARKS_LEVEL_WORDS } = require("@scd/shared") as { MARKS_LEVEL_WORDS: readonly { minPct: number; bn: string }[] };
    for (const w of MARKS_LEVEL_WORDS) expect(marks.marksLevelLabel(w.minPct)).toBe(w.bn);
  });

  it("the guardian line is marks + a level word: ৮/১০ — ভালো", () => {
    expect(marks.guardianMarksLine(8, 10)).toBe("৮/১০ — ভালো");
    expect(marks.guardianMarksLine(9, 10)).toBe("৯/১০ — খুব ভালো");
    expect(marks.guardianMarksLine(4, 10)).toBe("৪/১০ — আরও অনুশীলন দরকার");
    expect(marks.guardianMarksLine(null, 10)).toBeNull();
    expect(marks.guardianMarksLine(3, 0)).toBeNull();
  });
});

describe("marks line (AC-B12): ৭/১০ · ৭০%", () => {
  it("whole and half marks", () => {
    expect(marks.marksLine(7, 10)).toBe("৭/১০ · ৭০%");
    expect(marks.marksLine(4.5, 10)).toBe("৪.৫/১০ · ৪৫%");
    expect(marks.marksLine(10, 10)).toBe("১০/১০ · ১০০%");
  });
  it("nothing without a total", () => {
    expect(marks.marksLine(undefined, 10)).toBeNull();
    expect(marks.marksLine(5, null)).toBeNull();
    expect(marks.marksLine(0, 0)).toBeNull();
  });
  it("takes the screen's own digit formatter", () => {
    expect(marks.marksLine(7, 10, String)).toBe("7/10 · 70%");
  });
});

describe("picker reducer (B1/B2, AC-B16)", () => {
  const loaded = (): PickerState => picker.pickerReducer(picker.emptyPicker(), { type: "load", items: [item("A"), item("B", "LO2", 1, true)], freeLines: [] });

  it("a draft loads: bank items, a repeat kept with its flag, a book exercise becomes a free line", () => {
    const s = picker.draftToPicker(
      [
        { origin: "BANK", qid: "Q1", textBn: "এক", loCode: "L1", marks: 2 },
        { origin: "BANK", qid: "Q2", textBn: "দুই", loCode: "L1", marks: 1, repeat: true },
        { origin: "TEACHER", qid: null, textBn: "বইয়ের অনুশীলনী: ৩", loCode: "L2", marks: 5, fromBook: true },
      ],
      1.8,
    );
    expect(s.items.map((i) => [i.qid, i.repeat])).toEqual([["Q1", false], ["Q2", true]]);
    expect(s.freeLines).toEqual([{ kind: "TEXTBOOK", textBn: "বইয়ের অনুশীলনী: ৩", estMinutes: 9 }]);
  });

  it("remove drops one item", () => {
    const s = picker.pickerReducer(loaded(), { type: "remove", key: "A" });
    expect(s.items.map((i) => i.key)).toEqual(["B"]);
  });

  it("swap replaces in place with the candidate, never one already on the sheet", () => {
    const s = picker.pickerReducer(loaded(), { type: "swap", key: "A", candidate: bank("C") });
    expect(s.items.map((i) => i.key)).toEqual(["C", "B"]);
    expect(s.items[0]!.repeat).toBe(false);
    expect(picker.pickerReducer(s, { type: "swap", key: "C", candidate: bank("B") })).toBe(s);
  });

  it("nextCandidate walks the objective's pool after the current one, skips the taken, wraps, and ends at null", () => {
    const pool = [bank("A"), bank("C"), bank("D"), bank("X", "LO9")];
    const s = loaded();
    expect(picker.nextCandidate(pool, s.items, s.items[0]!)?.qid).toBe("C");
    const s2 = picker.pickerReducer(s, { type: "swap", key: "A", candidate: bank("C") });
    expect(picker.nextCandidate(pool, s2.items, s2.items[0]!)?.qid).toBe("D");
    const s3 = picker.pickerReducer(s2, { type: "swap", key: "C", candidate: bank("D") });
    expect(picker.nextCandidate(pool, s3.items, s3.items[0]!)?.qid).toBe("A"); // wraps to the freed one
    expect(picker.nextCandidate([bank("A")], s.items, s.items[0]!)).toBeNull(); // only itself
    expect(picker.nextCandidate(pool, s.items, s.items[1]!)).toBeNull(); // LO2 has no other candidate
  });

  it("repeats are ranked last in the swap walk and in the add list, a swapped-in repeat keeps its \"আবার\" flag, and the add list filters by text", () => {
    const rep = { ...bank("R"), repeat: true };
    const pool = [rep, bank("C"), bank("D")];
    const s = loaded();
    expect(picker.nextCandidate(pool, s.items, s.items[0]!)?.qid).toBe("C"); // not the repeat, though it is first in the pool
    const swapped = picker.pickerReducer(s, { type: "swap", key: "A", candidate: rep });
    expect(swapped.items[0]!.repeat).toBe(true);
    expect(picker.addableCandidates(pool, s.items).map((c) => c.qid)).toEqual(["C", "D", "R"]);
    expect(picker.addableCandidates(pool, s.items, "d").map((c) => c.qid)).toEqual(["D"]);
    expect(picker.addableCandidates(pool, s.items, "zzz")).toEqual([]);
  });

  it("add from the bank skips duplicates; the addable list is the pool minus the sheet", () => {
    let s = picker.pickerReducer(loaded(), { type: "addBank", candidate: bank("C"), loCode: "LO1" });
    expect(s.items.map((i) => i.key)).toEqual(["A", "B", "C"]);
    expect(picker.pickerReducer(s, { type: "addBank", candidate: bank("C"), loCode: "LO1" })).toBe(s);
    expect(picker.addableCandidates([bank("A"), bank("D")], s.items).map((c) => c.qid)).toEqual(["D"]);
  });

  it("the teacher's own item needs text and marks in steps of 0.5", () => {
    const s0 = loaded();
    expect(picker.pickerReducer(s0, { type: "addOwn", textBn: "  ", marks: 2 })).toBe(s0);
    expect(picker.pickerReducer(s0, { type: "addOwn", textBn: "প্রশ্ন", marks: 0 })).toBe(s0);
    expect(picker.pickerReducer(s0, { type: "addOwn", textBn: "প্রশ্ন", marks: 1.3 })).toBe(s0);
    const s1 = picker.pickerReducer(s0, { type: "addOwn", textBn: " নিজের ", marks: 1.5 });
    expect(s1.items[2]).toMatchObject({ origin: "TEACHER", textBn: "নিজের", marks: 1.5, qid: null });
    const s2 = picker.pickerReducer(s1, { type: "addOwn", textBn: "আরেক", marks: 2 });
    expect(s2.items[3]!.key).not.toBe(s2.items[2]!.key);
  });

  it("free lines: a kind, a text, whole minutes 0..240", () => {
    const s0 = picker.emptyPicker();
    expect(picker.pickerReducer(s0, { type: "addFreeLine", line: { kind: "READING", textBn: "", estMinutes: 10 } })).toBe(s0);
    expect(picker.pickerReducer(s0, { type: "addFreeLine", line: { kind: "READING", textBn: "পাঠ ৩", estMinutes: 241 } })).toBe(s0);
    expect(picker.pickerReducer(s0, { type: "addFreeLine", line: { kind: "READING", textBn: "পাঠ ৩", estMinutes: 2.5 } })).toBe(s0);
    const s1 = picker.pickerReducer(s0, { type: "addFreeLine", line: { kind: "READING", textBn: "পাঠ ৩ পড়ে আসবে", estMinutes: 10 } });
    expect(s1.freeLines).toHaveLength(1);
    expect(picker.pickerReducer(s1, { type: "removeFreeLine", index: 0 }).freeLines).toEqual([]);
  });

  it("running total: marks × the policy rate + the free lines' minutes (R26, AC-B17)", () => {
    let s = picker.pickerReducer(picker.emptyPicker(), { type: "load", items: [item("A", "L", 4), item("B", "L", 6)], freeLines: [] });
    expect(picker.totalMarks(s.items)).toBe(10);
    expect(picker.estMinutes(s, 1.8)).toBe(18); // a 10-mark homework counts 18 minutes, not grid × 2
    s = picker.pickerReducer(s, { type: "addFreeLine", line: { kind: "HANDWRITING", textBn: "হাতের লেখা ১ পৃষ্ঠা", estMinutes: 7 } });
    expect(picker.estMinutes(s, 1.8)).toBe(25);
    expect(picker.estMinutes(s, 2)).toBe(27); // the rate is an input, never a constant here
    expect(picker.estMinutes(s, Number.NaN)).toBe(7);
    s = picker.pickerReducer(s, { type: "remove", key: "A" });
    expect(picker.totalMarks(s.items)).toBe(6);
    expect(picker.estMinutes(s, 1.8)).toBe(18); // 10.8 + 7 = 17.8 → 18
  });

  it("save sends selectedQids (bank), teacherItems (own) and freeLines", () => {
    let s = loaded();
    s = picker.pickerReducer(s, { type: "addOwn", textBn: "নিজের", marks: 2 });
    s = picker.pickerReducer(s, { type: "addFreeLine", line: { kind: "MEMORISE", textBn: "সূরা", estMinutes: 5 } });
    expect(picker.saveArgs(s)).toEqual({
      selectedQids: ["A", "B"],
      teacherItems: [{ textBn: "নিজের", marks: 2 }],
      freeLines: [{ kind: "MEMORISE", textBn: "সূরা", estMinutes: 5 }],
    });
  });
});

describe("tick-wrong grid cells (B7, AC-B4)", () => {
  it("the ½ step exists only where half the marks is a multiple of 0.5", () => {
    expect(grid.allowsHalf(1)).toBe(true);
    expect(grid.allowsHalf(2)).toBe(true);
    expect(grid.allowsHalf(3)).toBe(true);
    expect(grid.allowsHalf(1.5)).toBe(false);
    expect(grid.allowsHalf(2.5)).toBe(false);
    expect(grid.allowsHalf(0.5)).toBe(false);
  });

  it("a tap cycles full → ½ → 0 → full", () => {
    let e = 2;
    e = grid.nextEarned(e, 2);
    expect(e).toBe(1);
    expect(grid.cellState(e, 2)).toBe("HALF");
    e = grid.nextEarned(e, 2);
    expect(e).toBe(0);
    e = grid.nextEarned(e, 2);
    expect(e).toBe(2);
  });

  it("a question that cannot be halved goes full → 0 → full", () => {
    expect(grid.nextEarned(1.5, 1.5)).toBe(0);
    expect(grid.nextEarned(0, 1.5)).toBe(1.5);
  });

  it("a stored odd value (3 of 5) shows as CUSTOM and a tap resets it to full", () => {
    expect(grid.cellState(3, 5)).toBe("CUSTOM");
    expect(grid.nextEarned(3, 5)).toBe(5);
  });

  it("only exceptions are kept: a tap to ½ adds a row, three taps drop it again", () => {
    let items: GridItemX[] = [];
    items = grid.tapCell(items, 3, 2);
    expect(items).toEqual([{ itemNo: 3, marks: 1, rework: false, tags: [] }]);
    items = grid.tapCell(items, 3, 2);
    expect(items[0]!.marks).toBe(0);
    items = grid.tapCell(items, 3, 2);
    expect(items).toEqual([]);
  });

  it("a tap keeps the item's re-work flag and tags (the entry screen's) and keeps their row at full marks", () => {
    const items: GridItemX[] = [{ itemNo: 1, marks: 0, rework: true, tags: ["T1"] }];
    const back = grid.tapCell(items, 1, 2); // 0 → full (null marks)
    expect(back).toEqual([{ itemNo: 1, marks: null, rework: true, tags: ["T1"] }]);
  });

  it("a child's total: 28 children style — one ½ of 2 on item 3 = 9 of 10", () => {
    const paper = [{ itemNo: 1, marks: 2 }, { itemNo: 2, marks: 2 }, { itemNo: 3, marks: 2 }, { itemNo: 4, marks: 2 }, { itemNo: 5, marks: 2 }];
    const tapped = grid.tapCell([], 3, 2);
    expect(grid.childTotal(tapped, paper)).toEqual({ earned: 9, available: 10 });
    expect(marks.marksLine(9, 10)).toBe("৯/১০ · ৯০%");
    expect(grid.childTotal([], paper)).toEqual({ earned: 10, available: 10 });
  });

  it("a free-line 'হয়নি' tick toggles, sorted, no duplicates", () => {
    expect(grid.toggleNotDone([], 1)).toEqual([1]);
    expect(grid.toggleNotDone([1], 0)).toEqual([0, 1]);
    expect(grid.toggleNotDone([0, 1], 0)).toEqual([1]);
  });

  it("an absent child, one who did not hand in, or one with no record is not editable (AC-B9)", () => {
    expect(grid.rowEditable("PRESENT", null, true)).toBe(true);
    expect(grid.rowEditable("ABSENT", null, true)).toBe(false);
    expect(grid.rowEditable("NOT_SUBMITTED", null, true)).toBe(false);
    expect(grid.rowEditable("PRESENT", null, false)).toBe(false);
    expect(grid.rowEditable("PRESENT", "ABSENT", true)).toBe(false);
    expect(grid.rowEditable("ABSENT", "PRESENT", true)).toBe(true);
  });

  it("rows are in student-ID order, numeric-aware, no ID last — never by roll number", () => {
    const rows = [
      { schoolId: "0103", name: "গ" },
      { schoolId: "0059", name: "ক" },
      { schoolId: null, name: "অ" },
      { schoolId: "0100", name: "খ" },
    ];
    expect(grid.byStudentId(rows).map((r) => r.name)).toEqual(["ক", "খ", "গ", "অ"]);
  });

  it("question numbers are printed as on the sheet (ক/খ parts share a number)", () => {
    expect(grid.printedLabels([{}, { stimulusRef: "S1" }, { stimulusRef: "S1" }, {}], String)).toEqual(["1", "2(ক)", "2(খ)", "3"]);
  });
});

describe("no CORRECT / PARTIAL / WRONG word next to marks (AC-B12, R35)", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../../../app/src", rel), "utf8");
  const RESULT_WORD = /\b(CORRECT|PARTIAL|WRONG)\b|hwResultLabel|hwOutcome(Correct|Partial|Wrong)/;

  it("the cell label is a plain figure", () => {
    const s = grid.cellLabel(1, 2, String);
    expect(s).toBe("1/2");
    expect(s).not.toMatch(RESULT_WORD);
  });

  it("the grid screen, the picker and the display helpers never name a result", () => {
    for (const f of ["screens/mastery/HomeworkMarksGridScreen.tsx", "components/HomeworkQuestionPicker.tsx", "lib/marksDisplay.ts", "lib/homeworkGrid.ts"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect({ f, hit: RESULT_WORD.test(src) }).toEqual({ f, hit: false });
    }
  });

  it("the guardian card and the profile show marks first and fall back to a result word only when there are none", () => {
    expect(read("screens/guardian/ChildHomeworkScreen.tsx")).toMatch(/guardianMarksLine\(r\.earnedMarks, r\.availableMarks[\s\S]{0,900}hwResultLabel\(r\.result\)/);
    expect(read("screens/student/profile/TrackerTab.tsx")).toMatch(/marksLine\(it\.earnedMarks, it\.availableMarks, bnNum\) \?\? \(it\.result/);
  });

  it("the workspace opens the grid by the paper CODE, gates on mastery:view + the release switch, never disables on a chasing child, and shows marks in the view-only fold", () => {
    const ws = read("screens/homework/HomeworkWorkspaceScreen.tsx");
    expect(ws).toContain("params: { paperId: paperCode }");
    expect(ws).toContain('can("mastery:view") && (can("mastery:enter_results") || can("homework:check"))');
    expect(ws).toContain("const paperCode = loopOn ?");
    expect(ws).not.toContain("disabled={(tally?.pendingSubmission");
    expect(ws).toContain("marksLine(r.earnedMarks, r.availableMarks, bnNum)");
    const decl = read("screens/homework/DeclareHomeworkScreen.tsx");
    expect(decl).toContain("pick || editPaperId || pickerActive ? {} : { timeDecl: td, qCount: q }");
  });
});
