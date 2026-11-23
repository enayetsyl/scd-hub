/**
 * AL-7 — the suggestion engine's pure functions (docs/prd-academic-loop-2027.md §4; AC-C8, AC-C9, AC-C10, AC-E2, AC-D1,
 * AC-C6, AC-C13). No database.
 */
import {
  addDaysKey,
  childDayMinutes,
  childLoad,
  draftDayOf,
  excludedCounts,
  extraHomeworkDays,
  hash32,
  pendingMissed,
  rankBank,
  splitSubjectMarks,
  suggest,
  swapCard,
  weakPctOf,
  type SuggestChild,
  type SuggestInput,
} from "../modules/mastery/suggestion";
import { DEFAULT_BUDGET_POLICY, subjectShareMarks } from "../modules/mastery/assignmentBudget";

const LO_A = "LO-C3-MATH-07-01"; // chapter 7 (recent)
const LO_B = "LO-C3-MATH-02-01"; // chapter 2 (older)
const outcomes = new Map([
  [LO_A, { code: LO_A, chapterNumber: 7, questionTypeCodes: ["QT-SHORT"] }],
  [LO_B, { code: LO_B, chapterNumber: 2, questionTypeCodes: ["QT-SHORT"] }],
]);
const labels = new Map([[LO_A, "ভাগ"], [LO_B, "যোগ"]]);
const q = (n: number, lo: string, difficulty: string | null = "medium") => ({
  artifactId: `a${n}`, qid: `Q${String(n).padStart(3, "0")}`, loCodes: [lo], textBn: `প্রশ্ন ${n}`, qtCode: null, difficulty,
});
const bankA = Array.from({ length: 20 }, (_, i) => q(i + 1, LO_A));
const bankB = Array.from({ length: 20 }, (_, i) => q(i + 101, LO_B));
const child = (id: string, over: Partial<SuggestChild> = {}): SuggestChild => ({ studentId: id, states: new Map(), missed: [], avoid: new Set(), ...over });

const base = (over: Partial<SuggestInput> = {}): SuggestInput => ({
  seed: "sec|2027-W02|MATH",
  today: "2027-01-13",
  policy: { recentWeeks: 3, recentWeight: 3, revisionPct: 20, missedEasyQuestions: 2, missedObjectivesPerWeek: 3 },
  partAMarks: 10,
  partBMarks: 10,
  layout: { questionTypeCodes: [], mixWeak: 60, mixImproving: 25, mixRevision: 15 },
  outcomes,
  labels,
  taughtChapters: [{ chapterNumber: 7, lastTaughtDay: "2027-01-12" }, { chapterNumber: 2, lastTaughtDay: "2026-11-01" }],
  taughtCodes: new Set([LO_A, LO_B]),
  sectionWeak: new Map([[LO_A, { weak: 3, improving: 1, assessed: 2 }]]),
  children: [child("s1"), child("s2")],
  bank: [...bankA, ...bankB],
  marksOf: new Map([["QT-SHORT", 2]]),
  unmarkedTypes: new Set(),
  exposure: new Map(),
  seenBySection: new Set(),
  openExtra: new Set(),
  ledger: { hwYear: new Set(), window: new Set(), lastOn: new Map() },
  ...over,
});
const weakState = (seen: string[] = []) => ({ state: "WEAK", lastEvidenceAt: new Date("2027-01-05T00:00:00Z"), seenQids: seen });

describe("budget split (AC-C9)", () => {
  it("66 marks split 5 : 10 → 22 common + 44 per child; Part A off → all Part B", () => {
    expect(splitSubjectMarks(66, true, 5, 10)).toEqual({ partA: 22, partB: 44 });
    expect(splitSubjectMarks(66, false, 5, 10)).toEqual({ partA: 0, partB: 66 });
    expect(splitSubjectMarks(0, true, 5, 10)).toEqual({ partA: 0, partB: 0 });
    expect(subjectShareMarks(360, 3, DEFAULT_BUDGET_POLICY)).toBe(66);
  });
});

describe("ranking and determinism (AC-C8)", () => {
  it("never seen first, then fewest children who saw it, then the longest since last used", () => {
    const bank = [{ qid: "a" }, { qid: "b" }, { qid: "c" }, { qid: "d" }];
    const r = rankBank(bank, "s", new Set(["a", "b"]), new Map([["a", 5], ["b", 1]]), new Map([["c", "2026-12-01"], ["d", "2026-10-01"]]));
    const order = [...r.entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]);
    expect(order).toEqual(["d", "c", "b", "a"]);
  });
  it("the same inputs give the same draft; a different seed may reorder ties", () => {
    const one = suggest(base());
    const two = suggest(base());
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    expect(hash32("x")).toBe(hash32("x"));
    expect(addDaysKey("2027-01-31", 1)).toBe("2027-02-01");
  });
});

describe("Part A (common)", () => {
  it("fills the marks from the taught chapters, weak objectives first, with reasons", () => {
    const r = suggest(base());
    const marks = r.partA.reduce((s, i) => s + i.marks, 0);
    expect(marks).toBe(10);
    expect(r.partA.every((i) => i.reasonBn.length > 0)).toBe(true);
    expect(r.partA.some((i) => i.loCode === LO_A && i.reasonBn.startsWith("দুর্বল"))).toBe(true);
    // 20 % of 10 marks (= 1 question of 2 marks) is revision from the older chapter.
    expect(r.partA.some((i) => i.loCode === LO_B && i.reasonBn.startsWith("আগের অধ্যায়ের পুনরাবৃত্তি"))).toBe(true);
    expect(r.chaptersUsed).toEqual([2, 7]);
  });
  it("no lesson marks → says so and builds no Part A", () => {
    const r = suggest(base({ taughtChapters: [] }));
    expect(r.noLessonMarks).toBe(true);
    expect(r.partA).toEqual([]);
  });
  it("hard exclusions: a homework question of the year and any in-window use never appear (AC-C2)", () => {
    const hw = new Set(bankA.slice(0, 8).map((x) => x.qid));
    const win = new Set(bankA.slice(8, 16).map((x) => x.qid));
    const r = suggest(base({ ledger: { hwYear: hw, window: win, lastOn: new Map() }, partAMarks: 6 }));
    for (const it of r.partA) expect(hw.has(it.qid) || win.has(it.qid)).toBe(false);
  });
  it("a repeat ('আবার') only when no unseen question exists for the objective, ranked by oldest use, never homework / window", () => {
    const seen = new Set(bankA.map((x) => x.qid)); // every LO_A question was seen by the শাখা before
    const lastOn = new Map(bankA.map((x, i) => [x.qid, `2026-0${(i % 9) + 1}-01`]));
    const r = suggest(base({ taughtChapters: [{ chapterNumber: 7, lastTaughtDay: "2027-01-12" }], seenBySection: seen, ledger: { hwYear: new Set(), window: new Set(), lastOn }, partAMarks: 4 }));
    expect(r.partA.length).toBeGreaterThan(0);
    expect(r.partA.every((i) => i.repeat && i.reasonBn.startsWith("আবার"))).toBe(true);
    const win = new Set(bankA.map((x) => x.qid));
    const none = suggest(base({ taughtChapters: [{ chapterNumber: 7, lastTaughtDay: "2027-01-12" }], seenBySection: seen, ledger: { hwYear: new Set(), window: win, lastOn }, partAMarks: 4 }));
    expect(none.partA).toEqual([]);
  });
  it("recent chapters are weighted 3 : 1 when no revision share applies", () => {
    const r = suggest(base({ policy: { ...base().policy, revisionPct: 0 }, partAMarks: 16, sectionWeak: new Map() }));
    const inA = r.partA.filter((i) => i.chapterNumber === 7).length;
    const inB = r.partA.filter((i) => i.chapterNumber === 2).length;
    expect(inA).toBeGreaterThan(inB);
  });
});

describe("Part B (per child)", () => {
  it("AC-D1: a WEAK objective feeds the child's sheet with the reason 'দুর্বল'", () => {
    const r = suggest(base({ children: [child("s1", { states: new Map([[LO_A, weakState()]]) })], partAMarks: 0 }));
    const sheet = r.sheets[0]!;
    expect(sheet.items.length).toBeGreaterThan(0);
    expect(sheet.items[0]!.band).toBe("WEAK");
    expect(sheet.items[0]!.reasonBn).toBe("দুর্বল: ভাগ");
  });
  it("never a question the child has seen (the mastery rule) nor one in their avoid set", () => {
    const seen = bankA.slice(0, 15).map((x) => x.qid);
    const r = suggest(base({ children: [child("s1", { states: new Map([[LO_A, weakState(seen)]]), avoid: new Set([bankA[15]!.qid]) })], partAMarks: 0 }));
    for (const it of r.sheets[0]!.items) expect(seen.includes(it.qid) || it.qid === bankA[15]!.qid).toBe(false);
  });
  it("no unseen question → NEEDS_REVIEW with a NO_UNSEEN_QUESTION warning (never silent)", () => {
    const all = bankA.map((x) => x.qid);
    const r = suggest(base({ children: [child("s1", { states: new Map([[LO_A, weakState(all)]]) })], partAMarks: 0 }));
    expect(r.sheets[0]!.status).toBe("NEEDS_REVIEW");
    expect(r.sheets[0]!.warnings.some((w) => w.code === "NO_UNSEEN_QUESTION")).toBe(true);
  });
  it("AC-E2: a child with 5 missed objectives gets easy items for the 3 most recent only; the rest carry over", () => {
    const codes = [1, 2, 3, 4, 5].map((n) => `LO-C3-MATH-0${n}-01`);
    const oc = new Map(codes.map((c, i) => [c, { code: c, chapterNumber: i + 1, questionTypeCodes: ["QT-SHORT"] }]));
    const bank = codes.flatMap((c, i) => Array.from({ length: 6 }, (_, k) => q(i * 10 + k + 1, c, k === 0 ? "easy" : "hard")));
    const missed = codes.map((c, i) => ({ loCode: c, missedOn: `2027-01-0${i + 1}` })); // 05 is the most recent
    const r = suggest(base({ outcomes: oc, bank, taughtCodes: new Set(codes), taughtChapters: [], children: [child("s1", { missed })], partAMarks: 0, partBMarks: 20, sectionWeak: new Map() }));
    const sheet = r.sheets[0]!;
    const got = new Set(sheet.items.filter((i) => i.band === "MISSED").map((i) => i.loCode));
    expect([...got].sort()).toEqual([codes[2]!, codes[3]!, codes[4]!]);
    expect(sheet.missedCarried.sort()).toEqual([codes[0]!, codes[1]!]);
    expect(sheet.items.filter((i) => i.band === "MISSED" && i.loCode === codes[4]).length).toBe(2); // suggestMissedEasyQuestions
    // easy-tagged first
    const firstOf = sheet.items.find((i) => i.loCode === codes[4])!;
    expect(bank.find((b) => b.qid === firstOf.qid)!.difficulty).toBe("easy");
  });
  it("a missed objective practised since the missed day is no longer 'ক্লাস মিস'", () => {
    const c = child("s1", { states: new Map([[LO_A, { state: "WEAK", lastEvidenceAt: new Date("2027-01-10T00:00:00Z"), seenQids: [] }]]), missed: [{ loCode: LO_A, missedOn: "2027-01-08" }, { loCode: "ZZ", missedOn: "2027-01-08" }] });
    expect(pendingMissed(c, outcomes)).toEqual([]);
    expect(pendingMissed({ ...c, states: new Map() }, outcomes)).toEqual([{ loCode: LO_A, missedOn: "2027-01-08" }]);
  });
  it("excluded counts the taught bank questions left out by each rule", () => {
    const ex = excludedCounts([...bankA, ...bankB], new Set([LO_A]), { hwYear: new Set(["Q001"]), window: new Set(["Q001", "Q002"]), lastOn: new Map() }, new Set(["Q003"]));
    expect(ex).toEqual({ hw: 1, window: 1, seen: 1 });
  });
});

describe("swap card (AC-C6)", () => {
  const rot = [{ subject: "BAN", weakRows: 10, verdictRows: 40 }, { subject: "MATH", weakRows: 4, verdictRows: 40 }];
  it("appears only when a non-rotation subject passes the % AND has more WEAK rows than the weakest rotation subject", () => {
    expect(swapCard(rot, [{ subject: "SCI", weakRows: 12, verdictRows: 30 }], 30)).toMatchObject({ dropSubject: "MATH", addSubject: "SCI" });
    expect(swapCard(rot, [{ subject: "SCI", weakRows: 8, verdictRows: 80 }], 30)).toBeNull(); // 10 % < 30 %
    expect(swapCard(rot, [{ subject: "SCI", weakRows: 3, verdictRows: 4 }], 30)).toBeNull(); // not more than MATH's 4
    expect(weakPctOf({ weakRows: 0, verdictRows: 0 })).toBe(0);
  });
  it("a finalised rotation subject is never the one dropped", () => {
    const r = swapCard([{ subject: "BAN", weakRows: 10, verdictRows: 40 }, { subject: "MATH", weakRows: 4, verdictRows: 40, finalised: true }], [{ subject: "SCI", weakRows: 12, verdictRows: 30 }], 30);
    expect(r?.dropSubject).toBe("BAN");
    expect(swapCard([{ subject: "MATH", weakRows: 4, verdictRows: 40, finalised: true }], [{ subject: "SCI", weakRows: 12, verdictRows: 30 }], 30)).toBeNull();
  });
});

describe("draft day (AC-C13)", () => {
  const open = (holidays: string[]) => (d: Date) => d.getDay() <= 4 && !holidays.includes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  it("one school day before delivery: Thursday → Wednesday; delivery rolled to Wednesday → Tuesday", () => {
    expect(draftDayOf(new Date(2027, 0, 14), 1, open([])).getDate()).toBe(13); // Thu 14 Jan → Wed 13
    expect(draftDayOf(new Date(2027, 0, 13), 1, open([])).getDate()).toBe(12); // Wed 13 → Tue 12
    expect(draftDayOf(new Date(2027, 0, 14), 1, open(["2027-01-13"])).getDate()).toBe(12); // Wed is a holiday → Tue
    expect(draftDayOf(new Date(2027, 0, 17), 1, open([])).getDate()).toBe(14); // Sun → the Thursday before (Fri/Sat closed)
  });
});

describe("per-child load (AC-C10, AC-C7, R27)", () => {
  it("a BOTH subject fills Friday first; the day sums across subjects plus weekend extra homework; over the cap warns", () => {
    expect(childDayMinutes({ doOnDay: "BOTH", friMinutes: 60, childMinutes: 100 })).toEqual({ FRI: 60, SAT: 40 });
    expect(childDayMinutes({ doOnDay: "SAT", friMinutes: 0, childMinutes: 50 })).toEqual({ FRI: 0, SAT: 50 });
    const l = childLoad(
      [{ subject: "BAN", doOnDay: "FRI", friMinutes: 120, childMinutes: 120 }, { subject: "MATH", doOnDay: "BOTH", friMinutes: 60, childMinutes: 120 }],
      { FRI: 0, SAT: 30 },
      180,
    );
    expect(l).toMatchObject({ FRI: 180, SAT: 90, warn: false });
    const over = childLoad([{ subject: "BAN", doOnDay: "FRI", friMinutes: 120, childMinutes: 120 }], { FRI: 70, SAT: 0 }, 180);
    expect(over).toMatchObject({ FRI: 190, warn: true, over: { FRI: true, SAT: false } });
    expect(extraHomeworkDays(5, 40)).toEqual({ FRI: 40, SAT: 0 });
    expect(extraHomeworkDays(4, 40)).toEqual({ FRI: 20, SAT: 20 });
  });
});
