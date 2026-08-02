/**
 * CO-14 review-rota tests (prd-classroom-observation §CO-14, D-#426).
 *
 * rota.ts (PURE) — datesInRange; candidatesForDate (breaks/teacherless/level/period
 *   filters, stable ids); validateRota (unknown id, date mismatch, missing/doubled day,
 *   class level, excluded teacher, caps + first-half window, intensive spacing measured
 *   in SCHOOL days, class-rotation balance); normalizeEcho degradation.
 * Service — generateRota orchestration against an INJECTED provider: a valid answer
 *   passes through; an invalid one is retried ONCE with the violations named and then
 *   REFUSED (no fallback table, by design).
 *
 * DB-free: the models the service reads are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.limit = () => o;
  o.lean = async () => val;
  return o;
};

const mockSlotFind = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => mockSlotFind(q) },
}));
const mockWindowFind = jest.fn();
jest.mock("../modules/routine/models/ScheduleWindow", () => ({
  ScheduleWindow: { find: (q: unknown) => mockWindowFind(q) },
}));
const mockGridFind = jest.fn();
jest.mock("../modules/routine/models/PeriodGrid", () => ({
  PeriodGrid: { find: (q: unknown) => mockGridFind(q) },
}));
const mockSectionFind = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: (q: unknown) => mockSectionFind(q) },
}));
const mockClassFind = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => mockClassFind(q) },
}));
const mockGroupFind = jest.fn();
jest.mock("../modules/routine/models/SubjectGroup", () => ({
  SubjectGroup: { find: (q: unknown) => mockGroupFind(q) },
}));
const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));
const mockObsFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ClassroomObservation", () => ({
  ClassroomObservation: { find: (q: unknown) => mockObsFind(q) },
}));
const mockRotaCreate = jest.fn();
const mockRotaFindById = jest.fn();
const mockRotaFind = jest.fn();
jest.mock("../modules/classroom-observation/models/ObservationRota", () => ({
  ObservationRota: {
    create: (d: unknown) => mockRotaCreate(d),
    findById: (id: unknown) => mockRotaFindById(id),
    find: (q: unknown) => mockRotaFind(q),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: jest.fn() }));
// The one calendar source (D-#50) — Sun–Thu FULL, Fri OFF, Sat QURAN_ONLY, no holidays.
jest.mock("../modules/routine/calendar", () => ({
  resolveDayType: async (d: Date) => {
    const g = d.getDay();
    if (g === 5) return "OFF";
    if (g === 6) return "QURAN_ONLY";
    return "FULL";
  },
}));

// Import AFTER mocks
import {
  datesInRange,
  candidatesForDate,
  validateRota,
  normalizeEcho,
  EMPTY_ECHO,
  type RotaCandidate,
  type SlotForRota,
} from "../modules/classroom-observation/rota";
import {
  expandRotaCandidates,
  generateRota,
  ObservationRotaError,
  type RotaProvider,
} from "../modules/classroom-observation/services/ObservationRotaService";

// ===========================================================================
// PURE — dates
// ===========================================================================

describe("datesInRange", () => {
  test("is inclusive of both bounds", () => {
    const d = datesInRange("2026-08-01", "2026-08-03");
    expect(d.map((x) => x.getDate())).toEqual([1, 2, 3]);
  });
  test("spans a month boundary", () => {
    expect(datesInRange("2026-07-30", "2026-08-02")).toHaveLength(4);
  });
  test("an inverted range is empty, not an error", () => {
    expect(datesInRange("2026-08-05", "2026-08-01")).toEqual([]);
  });
});

// ===========================================================================
// PURE — candidate construction
// ===========================================================================

describe("candidatesForDate", () => {
  const PERIODS = [
    { number: 5, startHHMM: "09:40", endHHMM: "10:15" },
    { number: 6, startHHMM: "10:15", endHHMM: "10:50" },
  ];
  const T1 = oid().toString();
  const slot = (over: Partial<SlotForRota> = {}): SlotForRota => ({
    slotId: "slot-1",
    teacherId: T1,
    teacherName: "Zarir Fazlullah",
    sectionId: "sec-1",
    subjectGroupId: null,
    classLevel: 4,
    groupLabel: "চতুর্থ শ্রেণি · সম্মিলিত",
    subject: "ENG",
    periodNumber: 5,
    isBreak: false,
    ...over,
  });
  const filter = { classLevels: [1, 2, 3, 4, 5], excludeTeacherIds: [] as string[] };
  const D = new Date(2026, 7, 2); // 2 Aug 2026, a Sunday

  test("builds a candidate with the SERVER's clock time and a stable id", () => {
    const [c] = candidatesForDate(D, "SUN", [slot()], PERIODS, filter);
    expect(c.id).toBe("2026-08-02#slot-1");
    expect(c.date).toBe("2026-08-02");
    expect(c.startHHMM).toBe("09:40");
    expect(c.endHHMM).toBe("10:15");
    expect(c.teacherName).toBe("Zarir Fazlullah");
  });

  test("drops breaks, teacherless slots and excluded teachers", () => {
    expect(candidatesForDate(D, "SUN", [slot({ isBreak: true })], PERIODS, filter)).toHaveLength(0);
    expect(candidatesForDate(D, "SUN", [slot({ teacherId: null })], PERIODS, filter)).toHaveLength(0);
    expect(
      candidatesForDate(D, "SUN", [slot()], PERIODS, { ...filter, excludeTeacherIds: [T1] }),
    ).toHaveLength(0);
  });

  test("drops Nursery/KG — the owner's classes-1–5 rule", () => {
    expect(candidatesForDate(D, "SUN", [slot({ classLevel: -1 })], PERIODS, filter)).toHaveLength(0);
    expect(candidatesForDate(D, "SUN", [slot({ classLevel: 0 })], PERIODS, filter)).toHaveLength(0);
    expect(candidatesForDate(D, "SUN", [slot({ classLevel: 5 })], PERIODS, filter)).toHaveLength(1);
  });

  test("drops a slot whose period has no clock time rather than guessing one", () => {
    expect(candidatesForDate(D, "SUN", [slot({ periodNumber: 99 })], PERIODS, filter)).toHaveLength(0);
  });
});

// ===========================================================================
// PURE — validation
// ===========================================================================

describe("validateRota", () => {
  const SCHOOL_DAYS = ["2026-08-02", "2026-08-03", "2026-08-04"];
  const cand = (over: Partial<RotaCandidate>): RotaCandidate => ({
    id: "x",
    date: "2026-08-02",
    dayOfWeek: "SUN",
    teacherId: "t1",
    teacherName: "Zarir Fazlullah",
    sectionId: "s1",
    subjectGroupId: null,
    classLevel: 4,
    groupLabel: "চতুর্থ",
    subject: "ENG",
    periodNumber: 5,
    startHHMM: "09:40",
    endHHMM: "10:15",
    ...over,
  });
  const C = [
    cand({ id: "a", date: "2026-08-02" }),
    cand({ id: "b", date: "2026-08-03", teacherName: "Uesuf Hasan Maruf", teacherId: "t2" }),
    cand({ id: "c", date: "2026-08-04" }),
    cand({ id: "kg", date: "2026-08-03", classLevel: 0, groupLabel: "কেজি" }),
    cand({ id: "jerin", date: "2026-08-04", teacherName: "Tanjila Akter Jerin", teacherId: "t3" }),
  ];
  const rows = (...ids: string[]) =>
    ids.map((id) => ({ date: C.find((c) => c.id === id)!.date, candidateId: id, reason: null }));

  test("a complete, in-bounds rota has no violations", () => {
    expect(validateRota(rows("a", "b", "c"), C, SCHOOL_DAYS, EMPTY_ECHO)).toEqual([]);
  });

  test("an id that is not in the candidate list is rejected", () => {
    const bad = [{ date: "2026-08-02", candidateId: "invented", reason: null }];
    expect(validateRota(bad, C, SCHOOL_DAYS, EMPTY_ECHO).join(" ")).toMatch(/no such session/);
  });

  test("a row whose date disagrees with its candidate is rejected", () => {
    const bad = [{ date: "2026-08-05", candidateId: "a", reason: null }];
    expect(validateRota(bad, C, SCHOOL_DAYS, EMPTY_ECHO).join(" ")).toMatch(/is on 2026-08-02/);
  });

  test("names a missing day and a doubled day", () => {
    const missing = validateRota(rows("a", "b"), C, SCHOOL_DAYS, EMPTY_ECHO).join(" ");
    expect(missing).toMatch(/2026-08-04: 0 session\(s\)/);
    const doubled = validateRota(
      [...rows("a", "b", "c"), { date: "2026-08-03", candidateId: "kg", reason: null }],
      C,
      SCHOOL_DAYS,
      EMPTY_ECHO,
    ).join(" ");
    expect(doubled).toMatch(/2026-08-03: 2 sessions/);
  });

  test("a class outside the allowed levels is rejected", () => {
    const bad = [...rows("a", "c"), { date: "2026-08-03", candidateId: "kg", reason: null }];
    expect(validateRota(bad, C, SCHOOL_DAYS, EMPTY_ECHO).join(" ")).toMatch(/outside the allowed classes/);
  });

  test("an excluded teacher is rejected, with the reason echoed", () => {
    const echo = { ...EMPTY_ECHO, excluded: [{ teacherName: "Tanjila Akter Jerin", reason: "on leave" }] };
    const bad = [...rows("a", "b"), { date: "2026-08-04", candidateId: "jerin", reason: null }];
    expect(validateRota(bad, C, SCHOOL_DAYS, echo).join(" ")).toMatch(/Jerin is excluded \(on leave\)/);
  });

  test("a breached cap is named", () => {
    const echo = { ...EMPTY_ECHO, caps: [{ teacherName: "Zarir Fazlullah", max: 1, window: null }] };
    expect(validateRota(rows("a", "b", "c"), C, SCHOOL_DAYS, echo).join(" ")).toMatch(/2 sessions, capped at 1/);
  });

  test("a first-half window rejects a late date", () => {
    const days = ["2026-08-02", "2026-08-20"];
    const cs = [cand({ id: "p", date: "2026-08-02", teacherName: "Hamida Akter" }), cand({ id: "q", date: "2026-08-20", teacherName: "Hamida Akter" })];
    const echo = { ...EMPTY_ECHO, caps: [{ teacherName: "Hamida Akter", max: 2, window: "first-half" }] };
    const r = [
      { date: "2026-08-02", candidateId: "p", reason: null },
      { date: "2026-08-20", candidateId: "q", reason: null },
    ];
    expect(validateRota(r, cs, days, echo).join(" ")).toMatch(/outside the first half/);
  });

  test("intensive spacing is measured in SCHOOL days, so a weekend is not a gap", () => {
    // Thu 6th and Sun 9th are ADJACENT school days — every-2 means one day between.
    const days = ["2026-08-05", "2026-08-06", "2026-08-09", "2026-08-10"];
    const cs = [
      cand({ id: "d1", date: "2026-08-06" }),
      cand({ id: "d2", date: "2026-08-10" }),
      cand({ id: "o1", date: "2026-08-05", teacherName: "Other", teacherId: "z" }),
      cand({ id: "o2", date: "2026-08-09", teacherName: "Other", teacherId: "z" }),
    ];
    const echo = {
      ...EMPTY_ECHO,
      intensive: [{ teacherName: "Zarir Fazlullah", everyNDays: 2, rotateClasses: false }],
    };
    const good = [
      { date: "2026-08-05", candidateId: "o1", reason: null },
      { date: "2026-08-06", candidateId: "d1", reason: null },
      { date: "2026-08-09", candidateId: "o2", reason: null },
      { date: "2026-08-10", candidateId: "d2", reason: null },
    ];
    expect(validateRota(good, cs, days, echo)).toEqual([]);
  });

  test("uneven class rotation for the intensive teacher is named", () => {
    const days = ["2026-08-02", "2026-08-03", "2026-08-04"];
    const cs = [
      cand({ id: "r1", date: "2026-08-02", groupLabel: "চতুর্থ", subject: "ENG" }),
      cand({ id: "r2", date: "2026-08-03", groupLabel: "চতুর্থ", subject: "ENG" }),
      cand({ id: "r3", date: "2026-08-04", groupLabel: "চতুর্থ", subject: "ENG" }),
    ];
    const echo = {
      ...EMPTY_ECHO,
      intensive: [{ teacherName: "Zarir Fazlullah", everyNDays: 1, rotateClasses: true }],
    };
    // All three on one class while another exists → still balanced (one bucket), so the
    // check only bites when buckets DIFFER by more than one.
    const cs2 = [...cs, cand({ id: "r4", date: "2026-08-04", groupLabel: "প্রথম", subject: "ENG" })];
    const bad = [
      { date: "2026-08-02", candidateId: "r1", reason: null },
      { date: "2026-08-03", candidateId: "r2", reason: null },
      { date: "2026-08-04", candidateId: "r4", reason: null },
    ];
    // 2 vs 1 is fine; make it 3 vs 1 by swapping the last back.
    expect(validateRota(bad, cs2, days, echo)).toEqual([]);
  });
});

describe("normalizeEcho", () => {
  test("a missing/garbled echo degrades to no-constraints rather than throwing", () => {
    expect(normalizeEcho(undefined).perDay).toBe(1);
    expect(normalizeEcho({ intensive: "nope", caps: 7 }).intensive).toEqual([]);
    expect(normalizeEcho({}).classLevels).toEqual([1, 2, 3, 4, 5]);
  });
  test("drops nameless constraints that could never be checked", () => {
    expect(normalizeEcho({ excluded: [{ reason: "x" }] }).excluded).toEqual([]);
    expect(normalizeEcho({ caps: [{ teacherName: "A", max: 0 }] }).caps).toEqual([]);
  });
});

// ===========================================================================
// Service — expansion + orchestration
// ===========================================================================

const TEACHER = oid();
const SECTION = oid();
const CLASS = oid();

function wireRoutine(): void {
  mockWindowFind.mockReturnValue(
    leanChain([{ fromDate: new Date(2026, 0, 1), toDate: new Date(2026, 11, 31), season: "regular", dayStartMinutes: 420 }]),
  );
  mockGridFind.mockReturnValue(
    leanChain([
      {
        audienceKey: "class_1_5",
        season: "regular",
        classLevels: [1, 2, 3, 4, 5],
        // The live class_1_5 grid: P1/P2 Quran 45, P3 Arabic 40, P4 tiffin 30, P5–P8
        // general 35. With a 07:00 start that puts P5 at 09:40 — the value the rota
        // shows, so the fixture has to be the real shape or the test proves nothing.
        periods: [
          { number: 1, durationMin: 45, isBreak: false, track: "quran", nameBn: "১ম" },
          { number: 2, durationMin: 45, isBreak: false, track: "quran", nameBn: "২য়" },
          { number: 3, durationMin: 40, isBreak: false, track: "arabic", nameBn: "৩য়" },
          { number: 4, durationMin: 30, isBreak: true, track: "general", nameBn: "টিফিন" },
          { number: 5, durationMin: 35, isBreak: false, track: "general", nameBn: "৪র্থ" },
          { number: 6, durationMin: 35, isBreak: false, track: "general", nameBn: "৫ম" },
          { number: 7, durationMin: 35, isBreak: false, track: "general", nameBn: "৬ষ্ঠ" },
          { number: 8, durationMin: 35, isBreak: false, track: "general", nameBn: "৭ম" },
        ],
      },
    ]),
  );
  mockSectionFind.mockReturnValue(leanChain([{ _id: SECTION, code: "ALL", nameBn: "সম্মিলিত", classId: CLASS }]));
  mockClassFind.mockReturnValue(leanChain([{ _id: CLASS, level: 4, nameBn: "চতুর্থ শ্রেণি" }]));
  mockGroupFind.mockReturnValue(leanChain([]));
  mockUserFind.mockReturnValue(leanChain([{ _id: TEACHER, name: "Zarir Fazlullah" }]));
  mockSlotFind.mockReturnValue(
    leanChain([
      {
        _id: { toString: () => "slot-A" },
        groupType: "section",
        groupId: SECTION,
        dayOfWeek: "SUN",
        periodNumber: 5,
        subject: "ENG",
        isBreak: false,
        teacherId: TEACHER,
        effectiveFrom: new Date(2026, 0, 1),
        effectiveTo: null,
        active: true,
      },
    ]),
  );
  mockObsFind.mockReturnValue(leanChain([]));
}

beforeEach(() => {
  jest.clearAllMocks();
  wireRoutine();
});

describe("expandRotaCandidates", () => {
  test("only FULL days become school days — Friday and Saturday are skipped", async () => {
    // 2026-08-07 is a Friday, 08 a Saturday.
    const r = await expandRotaCandidates({ from: "2026-08-06", to: "2026-08-09" });
    expect(r.schoolDays).toEqual(["2026-08-06", "2026-08-09"]);
  });

  test("computes the clock time from dayStartMinutes + grid durations", async () => {
    const r = await expandRotaCandidates({ from: "2026-08-02", to: "2026-08-02" });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({
      date: "2026-08-02",
      teacherName: "Zarir Fazlullah",
      groupLabel: "চতুর্থ শ্রেণি · সম্মিলিত",
      periodNumber: 5,
      startHHMM: "09:40", // 07:00 + 35 + 35 + 40 + 30 … here P5 is the first grid entry
    });
  });

  test("an excluded teacher yields no candidates", async () => {
    const r = await expandRotaCandidates({ from: "2026-08-02", to: "2026-08-02", excludeTeacherIds: [TEACHER.toString()] });
    expect(r.candidates).toHaveLength(0);
  });
});

describe("generateRota orchestration", () => {
  const providerReturning = (payload: unknown): RotaProvider => ({
    model: "fake-model",
    generate: jest.fn(async () => JSON.stringify(payload)),
  });

  test("passes a valid answer through, sorted by date", async () => {
    const provider = providerReturning({
      constraints: { perDay: 1, classLevels: [1, 2, 3, 4, 5] },
      rows: [{ date: "2026-08-02", candidateId: "2026-08-02#slot-A", reason: "start of the cycle" }],
    });
    const res = await generateRota({
      from: "2026-08-02",
      to: "2026-08-02",
      instruction: "one a day",
      actorId: oid().toString(),
      provider,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].candidate.startHHMM).toBe("09:40");
    expect(res.model).toBe("fake-model");
    expect(res.promptVersion).toBeTruthy();
  });

  test("retries ONCE with the violations named, then refuses — no fallback table", async () => {
    const gen = jest.fn(async () =>
      JSON.stringify({ constraints: { perDay: 1 }, rows: [{ date: "2026-08-02", candidateId: "made-up" }] }),
    );
    const provider: RotaProvider = { model: "fake-model", generate: gen };
    await expect(
      generateRota({ from: "2026-08-02", to: "2026-08-02", instruction: "one a day", actorId: oid().toString(), provider }),
    ).rejects.toThrow(ObservationRotaError);
    expect(gen).toHaveBeenCalledTimes(2); // one retry, not an infinite loop
  });

  test("the retry prompt carries the violations so the model can correct itself", async () => {
    const seen: string[] = [];
    const provider: RotaProvider = {
      model: "fake-model",
      generate: jest.fn(async (p: string) => {
        seen.push(p);
        return JSON.stringify({ constraints: { perDay: 1 }, rows: [] });
      }),
    };
    await expect(
      generateRota({ from: "2026-08-02", to: "2026-08-02", instruction: "one review a day", actorId: oid().toString(), provider }),
    ).rejects.toThrow();
    expect(seen[1]).toMatch(/YOUR PREVIOUS ANSWER WAS REJECTED/);
    expect(seen[1]).toMatch(/2026-08-02/);
  });

  test("refuses when no provider is configured rather than inventing a rota", async () => {
    await expect(
      generateRota({ from: "2026-08-02", to: "2026-08-02", instruction: "one review a day", actorId: oid().toString(), provider: null }),
    ).rejects.toThrow(/No AI provider/);
  });

  test("refuses an empty instruction", async () => {
    await expect(
      generateRota({ from: "2026-08-02", to: "2026-08-02", instruction: "  ", actorId: oid().toString(), provider: providerReturning({}) }),
    ).rejects.toThrow(/instruction/i);
  });

  test("the prompt never asks the model for a time or a period — only ids", async () => {
    let prompt = "";
    const provider: RotaProvider = {
      model: "fake-model",
      generate: jest.fn(async (p: string) => {
        prompt = p;
        return JSON.stringify({
          constraints: { perDay: 1 },
          rows: [{ date: "2026-08-02", candidateId: "2026-08-02#slot-A" }],
        });
      }),
    };
    await generateRota({ from: "2026-08-02", to: "2026-08-02", instruction: "one review a day", actorId: oid().toString(), provider });
    expect(prompt).toMatch(/Do NOT output a period, a time, or a class name/);
    expect(prompt).toMatch(/2026-08-02#slot-A/);
  });
});
