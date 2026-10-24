/**
 * Saturday-Revision SR-3 tests (prd-sr3 §3/§4/§6, D-#246).
 *
 * Pure      — aggregate (portions/totals/perJuz/mistakes), trendOf.
 * Derived   — studentJuzWeakness (weakest-first), groupCoverage (overdue flag),
 *             weeklyTrend (per-Saturday totals + ↑/↓/→), levelDashboard,
 *             completenessStatus (the gap), completenessChase (stateless wa.me nudge).
 *
 * DB-free (the repo convention): models + the template renderer are mocked.
 */
import mongoose from "mongoose";
import { wholeJuzRange } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockEntryFind = jest.fn();
jest.mock("../modules/saturday-revision/models/RevisionEntry", () => ({
  RevisionEntry: { find: (q: unknown) => mockEntryFind(q) },
}));
const mockGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (q: unknown) => mockGroupFind(q) },
}));
const mockMembershipFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroupMembership", () => ({
  SubjectGroupMembership: { find: (q: unknown) => mockMembershipFind(q) },
}));
const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => mockSlotFind(q) },
}));
const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { find: (q: unknown) => mockStudentFind(q) },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));
const mockRenderTemplate = jest.fn();
jest.mock("../modules/templates/services/MessageTemplateService", () => ({
  renderTemplate: (k: string, p: unknown) => mockRenderTemplate(k, p),
}));

import {
  aggregate,
  trendOf,
  studentJuzWeakness,
  groupCoverage,
  weeklyTrend,
  levelDashboard,
  completenessStatus,
  completenessChase,
} from "../modules/saturday-revision/services/RevisionSummaryService";

/** A portion covering the whole of juz `juz` (SR-5: ranges, the juz is derived). */
const juz = ({ juz: j = 1, ...over }: Record<string, unknown> = {}) => ({
  category: "MANZIL", status: "COMPLETED", ...wholeJuzRange(j as number), tanbih: 0, fath: 0,
  mistakes: { harf: 0, ghunnah: 0, madd: 0, other: 0 }, ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  _id: oid(), groupId: oid(), studentId: oid(), date: new Date("2026-06-13T00:00:00Z"),
  present: true, portions: [], deliveryChannels: [], ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderTemplate.mockResolvedValue("নুডজ");
});

// ===========================================================================
// Pure
// ===========================================================================

describe("aggregate (pure)", () => {
  test("folds present/absent + tanbih/fath/mistakes, split by ayah share (SR-5)", () => {
    const agg = aggregate([
      entry({
        present: true,
        portions: [
          // Half of juz 1 (74 of 148 ayahs) — all in juz 1.
          juz({ fromSurah: 1, fromAyah: 1, toSurah: 2, toAyah: 67, tanbih: 2, fath: 1, mistakes: { harf: 1, ghunnah: 0, madd: 0, other: 0 } }),
          juz({ juz: 2, tanbih: 1 }),
          // Naba 1 → Naziat 46 (40 + 46 ayahs): 6 tanbih split 40/86 vs 46/86.
          juz({ category: "SABAQ", status: "PARTIAL", fromSurah: 78, fromAyah: 1, toSurah: 79, toAyah: 46, tanbih: 6 }),
          juz({ category: "SABQI", status: "NOT_DONE", fromSurah: undefined, fromAyah: undefined, toSurah: undefined, toAyah: undefined, fath: 2 }),
        ],
      }),
      entry({ present: false, portions: [] }),
    ] as never);
    expect(agg.present).toBe(1);
    expect(agg.absent).toBe(1);
    expect(agg.portionsByCategory.MANZIL).toBeCloseTo(1.5, 5);
    expect(agg.ayahsByCategory).toEqual({ SABAQ: 86, SABQI: 0, MANZIL: 74 + 111 });
    expect(agg.statusCounts).toEqual({ COMPLETED: 2, PARTIAL: 1, NOT_DONE: 1, FAILED: 0 });
    expect(agg.totalTanbih).toBe(9);
    expect(agg.totalFath).toBe(3); // a range-less NOT_DONE still counts in the totals
    expect(agg.mistakes.harf).toBe(1);
    const j1 = agg.perJuz.get(1)!;
    expect(j1.tanbih + j1.fath + j1.harf).toBe(2 + 1 + 1);
    expect(agg.perSurah.get(78)!.tanbih).toBeCloseTo((6 * 40) / 86, 5);
    expect(agg.perSurah.get(79)!.tanbih).toBeCloseTo((6 * 46) / 86, 5);
    expect(agg.perJuz.get(30)!.ayahsHeard).toBe(86);
  });
});

describe("trendOf", () => {
  test("up/down/flat; one point ⇒ flat", () => {
    expect(trendOf(5, 3)).toBe("up");
    expect(trendOf(2, 4)).toBe("down");
    expect(trendOf(3, 3)).toBe("flat");
    expect(trendOf(3, null)).toBe("flat");
  });
});

// ===========================================================================
// Derived reads
// ===========================================================================

describe("studentJuzWeakness", () => {
  test("returns per-juz weakness, weakest first", async () => {
    mockEntryFind.mockReturnValue(leanChain([
      entry({ portions: [juz({ juz: 5, tanbih: 1 }), juz({ juz: 9, tanbih: 4, mistakes: { harf: 2, ghunnah: 0, madd: 0, other: 0 } })] }),
    ]));
    const rows = await studentJuzWeakness(oid().toString());
    expect(rows[0].juz).toBe(9); // weakest (total 6) first
    expect(rows[0].total).toBe(6);
    expect(rows[1].juz).toBe(5);
  });
});

describe("groupCoverage", () => {
  test("flags a juz not revised within the window as overdue", async () => {
    const s = oid();
    const asOf = new Date("2026-06-13T00:00:00Z");
    mockEntryFind.mockReturnValue(leanChain([
      entry({ studentId: s, date: new Date("2026-04-01T00:00:00Z"), portions: [juz({ juz: 3 })] }), // ~73d ago
      entry({ studentId: s, date: new Date("2026-06-06T00:00:00Z"), portions: [juz({ juz: 4 })] }), // 7d ago
    ]));
    mockStudentFind.mockReturnValue(leanChain([{ _id: s, nameBn: "আমিনা" }]));
    const rows = await groupCoverage(oid().toString(), asOf, 28);
    const byJuz = Object.fromEntries(rows.map((r) => [r.juz, r]));
    expect(byJuz[3].overdue).toBe(true);
    expect(byJuz[4].overdue).toBe(false);
  });
});

describe("weeklyTrend", () => {
  test("per-Saturday totals + trend (latest vs previous)", async () => {
    mockEntryFind.mockReturnValue(leanChain([
      entry({ date: new Date("2026-06-06T00:00:00Z"), portions: [juz({ tanbih: 1 })] }), // total 1
      entry({ date: new Date("2026-06-13T00:00:00Z"), portions: [juz({ tanbih: 3 })] }), // total 3
    ]));
    const res = await weeklyTrend({ studentId: oid().toString() });
    expect(res.points).toHaveLength(2);
    expect(res.points[1].total).toBe(3);
    expect(res.trend).toBe("up"); // more mistakes = up
  });

  test("requires a scope", async () => {
    await expect(weeklyTrend({})).rejects.toThrow(/studentId or groupId/);
  });
});

describe("levelDashboard", () => {
  test("rolls up present/absent + weakest juz", async () => {
    mockEntryFind.mockReturnValue(leanChain([
      entry({ present: true, portions: [juz({ juz: 7, tanbih: 5 })] }),
      entry({ present: false }),
    ]));
    const d = await levelDashboard(oid().toString());
    expect(d.present).toBe(1);
    expect(d.absent).toBe(1);
    expect(d.weakestJuz[0].juz).toBe(7);
  });
});

// ===========================================================================
// Completeness (J-SR3-5)
// ===========================================================================

describe("completenessStatus", () => {
  test("returns Hifz groups with no entry for the date", async () => {
    const g1 = oid();
    const g2 = oid();
    mockGroupFind.mockReturnValue(leanChain([
      { _id: g1, code: "H1", nameBn: "হিফজ ১", level: "Hifz 1" },
      { _id: g2, code: "H2", nameBn: "হিফজ ২", level: "Hifz 2" },
      { _id: oid(), code: "Q", nameBn: "কায়দা", level: "Qaida" }, // not Hifz → excluded
    ]));
    mockEntryFind.mockReturnValue(leanChain([{ groupId: g1 }])); // g1 entered
    const rows = await completenessStatus(new Date("2026-06-13T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBe(g2.toString());
  });
});

describe("completenessChase", () => {
  test("resolves the group's teacher + a wa.me nudge (stateless)", async () => {
    const g = oid();
    const teacher = oid();
    mockGroupFind.mockReturnValue(leanChain([{ _id: g, code: "H1", nameBn: "হিফজ ১", level: "Hifz 1" }]));
    mockEntryFind.mockReturnValue(leanChain([])); // none entered → g is missing
    mockSlotFind.mockReturnValue(leanChain([{ teacherId: teacher }]));
    mockUserFind.mockReturnValue(leanChain([{ _id: teacher, name: "Ustadh", phone: "01711222333" }]));
    const rows = await completenessChase(new Date("2026-06-13T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0].teacherName).toBe("Ustadh");
    expect(rows[0].waLink).toMatch(/wa\.me\/01711222333/);
    expect(rows[0].unreachableByWa).toBe(false);
  });

  test("a group with no teacher is unreachable", async () => {
    const g = oid();
    mockGroupFind.mockReturnValue(leanChain([{ _id: g, code: "H1", nameBn: "হিফজ ১", level: "Hifz 1" }]));
    mockEntryFind.mockReturnValue(leanChain([]));
    mockSlotFind.mockReturnValue(leanChain([]));
    const rows = await completenessChase(new Date("2026-06-13T00:00:00Z"));
    expect(rows[0].unreachableByWa).toBe(true);
    expect(rows[0].teacherId).toBeNull();
  });
});
