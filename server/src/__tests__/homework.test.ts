/**
 * HW-T1 tests — Homework Tracker data model + 6-stage lifecycle.
 *
 * T1.1 — declareHomeworkItem: validations (class 1–5, school-night, ≥1 TOP tag,
 *        TIME_DECL band, defaults) + HW_ID format
 * T1.2 — lifecycle engine: legal edges, illegal/terminal rejection, timestamps
 * T1.3 — engine is a single shared unit (state set + guards), no per-kind copy
 * T1.4 — absent-on-given re-delivery shifts the due date to the next school day
 *
 * DB-free: Mongoose models are mocked; the lifecycle engine + calendar are pure.
 */
import mongoose from "mongoose";
import {
  LIFECYCLE_EDGES,
  ENTRY_STATES,
  TERMINAL_STATES,
  STAGE_OF,
  canTransition,
  assertTransition,
  isEntryState,
  isTerminalState,
  isLifecycleState,
} from "../modules/trackers/lifecycle";
import { isSchoolDay, isWeekend, nextSchoolDay } from "../modules/trackers/calendar";

// ---------------------------------------------------------------------------
// Mock models BEFORE importing the service under test
// ---------------------------------------------------------------------------

const mockItemCreate = jest.fn();
const mockItemFindById = jest.fn();
const mockSeqUpdate = jest.fn();
const mockRecordInsertMany = jest.fn();
const mockRecordFindById = jest.fn();

jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: {
    create: (a: unknown) => mockItemCreate(a),
    findById: (id: unknown) => mockItemFindById(id),
  },
}));

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    insertMany: (a: unknown) => mockRecordInsertMany(a),
    findById: (id: unknown) => mockRecordFindById(id),
  },
}));

jest.mock("../modules/trackers/models/HomeworkSequence", () => ({
  HomeworkSequence: {
    findOneAndUpdate: (...args: unknown[]) => mockSeqUpdate(...args),
  },
}));

// Import AFTER mocks
import {
  generateHwId,
  declareHomeworkItem,
  issueHomeworkItem,
  transitionRecord,
} from "../modules/trackers/services/HomeworkService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR_ID = new mongoose.Types.ObjectId().toString();
const ITEM_ID = new mongoose.Types.ObjectId();
const REC_ID = new mongoose.Types.ObjectId();
const YEAR_ID = new mongoose.Types.ObjectId().toString();
const CLASS_ID = new mongoose.Types.ObjectId().toString();
const SECTION_ID = new mongoose.Types.ObjectId().toString();

/** A date whose local day-of-week equals `target` (0=Sun … 6=Sat). */
function dateWithDay(target: number): Date {
  const d = new Date(2026, 5, 1, 9, 0, 0); // June 2026, 09:00 local
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return d;
}

const A_TUESDAY = dateWithDay(2); // school night
const A_FRIDAY = dateWithDay(5); // weekend (blocked)
const A_THURSDAY = dateWithDay(4); // school night (light roster)

function validDeclareInput(over: Record<string, unknown> = {}) {
  return {
    academicYearId: YEAR_ID,
    classId: CLASS_ID,
    classLevel: 1,
    sectionId: SECTION_ID,
    subject: "MATH",
    dateGiven: A_TUESDAY,
    topTags: ["TOP-MATH-C1-01"],
    qCount: 5,
    actorId: ACTOR_ID,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSeqUpdate.mockResolvedValue({ seq: 1 });
  mockItemCreate.mockImplementation((arg: Record<string, unknown>) =>
    Promise.resolve({ _id: ITEM_ID, ...arg }),
  );
});

// ===========================================================================
// T1.2 / T1.3 — lifecycle engine (pure)
// ===========================================================================

describe("T1.2/T1.3 — lifecycle engine (the single shared 6-stage unit)", () => {
  test("entry + terminal states match §3", () => {
    expect([...ENTRY_STATES].sort()).toEqual(["ABSENT_REDELIVER", "GIVEN"]);
    expect(TERMINAL_STATES).toEqual(["RETURNED"]);
    expect(isEntryState("GIVEN")).toBe(true);
    expect(isEntryState("DUE")).toBe(false);
    expect(isTerminalState("RETURNED")).toBe(true);
  });

  test("the 8 atomic states map onto the 6 stages", () => {
    expect(STAGE_OF.GIVEN).toBe(1);
    expect(STAGE_OF.ABSENT_REDELIVER).toBe(2);
    expect(STAGE_OF.DUE).toBe(3);
    expect(STAGE_OF.SUBMITTED).toBe(4);
    expect(STAGE_OF.CHASE).toBe(4); // compound stage 4
    expect(STAGE_OF.CHECKED).toBe(5);
    expect(STAGE_OF.RESUBMIT).toBe(5); // compound stage 5
    expect(STAGE_OF.RETURNED).toBe(6);
  });

  test("legal edges are accepted (incl. the GIVEN→DUE overnight path)", () => {
    expect(canTransition("GIVEN", "DUE")).toBe(true);
    expect(canTransition("ABSENT_REDELIVER", "GIVEN")).toBe(true);
    expect(canTransition("DUE", "SUBMITTED")).toBe(true);
    expect(canTransition("DUE", "CHASE")).toBe(true);
    expect(canTransition("CHASE", "CHASE")).toBe(true); // repeat chase
    expect(canTransition("SUBMITTED", "CHECKED")).toBe(true);
    expect(canTransition("CHECKED", "RETURNED")).toBe(true);
    expect(canTransition("CHECKED", "RESUBMIT")).toBe(true);
  });

  test("illegal skips are rejected (no GIVEN→SUBMITTED, no DUE→CHECKED)", () => {
    expect(canTransition("GIVEN", "SUBMITTED")).toBe(false);
    expect(canTransition("DUE", "CHECKED")).toBe(false);
    expect(() => assertTransition("GIVEN", "CHECKED")).toThrow(/Illegal lifecycle transition/);
  });

  test("RETURNED is terminal (no outgoing edge)", () => {
    expect(LIFECYCLE_EDGES.RETURNED).toEqual([]);
    expect(() => assertTransition("RETURNED", "GIVEN")).toThrow(/terminal/);
  });

  test("unknown target state is rejected", () => {
    expect(isLifecycleState("BOGUS")).toBe(false);
    expect(() => assertTransition("GIVEN", "BOGUS" as never)).toThrow(/Unknown lifecycle state|Illegal/);
  });
});

// ===========================================================================
// calendar (pure) — Sun–Thu school nights (§6)
// ===========================================================================

describe("calendar — school nights are Sun–Thu (handoff §6.1)", () => {
  test("Fri/Sat are weekend; Sun–Thu are school days", () => {
    expect(isWeekend(dateWithDay(5))).toBe(true); // Fri
    expect(isWeekend(dateWithDay(6))).toBe(true); // Sat
    for (const d of [0, 1, 2, 3, 4]) expect(isSchoolDay(dateWithDay(d))).toBe(true);
  });

  test("nextSchoolDay skips the weekend and lands strictly after", () => {
    const fromThu = nextSchoolDay(dateWithDay(4)); // Thu → should skip Fri/Sat → Sun
    expect(isSchoolDay(fromThu)).toBe(true);
    expect(fromThu.getDay()).toBe(0); // Sunday
    const fromFri = nextSchoolDay(dateWithDay(5)); // Fri → Sun
    expect(fromFri.getDay()).toBe(0);
  });
});

// ===========================================================================
// T1.1 — declareHomeworkItem + HW_ID
// ===========================================================================

describe("T1.1 — HW_ID generation (year-continuous, per class+subject)", () => {
  test("formats HW-C{class}-{SUBJECT}-{nnnn}, 4-digit zero-padded", async () => {
    mockSeqUpdate.mockResolvedValue({ seq: 7 });
    const id = await generateHwId(YEAR_ID, 3, "ENG");
    expect(id).toBe("HW-C3-ENG-0007");
  });

  test("keys the counter by (year, class, subject) so year-reset is automatic", async () => {
    await generateHwId(YEAR_ID, 1, "MATH");
    const [filter, update, opts] = mockSeqUpdate.mock.calls[0];
    expect(filter).toEqual({ academicYearId: YEAR_ID, classLevel: 1, subject: "MATH" });
    expect(update).toEqual({ $inc: { seq: 1 } });
    expect(opts).toMatchObject({ upsert: true, new: true });
  });
});

describe("T1.1 — declareHomeworkItem validations (handoff §2.1)", () => {
  test("happy path: defaults TIME_DECL=20, status=declared, returns HW_ID", async () => {
    const res = await declareHomeworkItem(validDeclareInput());
    expect(res.hwId).toBe("HW-C1-MATH-0001");
    expect(res.timeDecl).toBe(20); // default
    expect(res.status).toBe("declared");
    const createArg = mockItemCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.status).toBe("declared");
    expect(createArg.timeDecl).toBe(20);
  });

  test("Thursday (light roster) is a valid school night", async () => {
    const res = await declareHomeworkItem(validDeclareInput({ dateGiven: A_THURSDAY }));
    expect(res.status).toBe("declared");
  });

  test("rejects a weekend dateGiven (Fri/Sat blocked, §6.1)", async () => {
    await expect(declareHomeworkItem(validDeclareInput({ dateGiven: A_FRIDAY }))).rejects.toThrow(
      /school nights only/,
    );
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  test("rejects classLevel outside 1..5 (homework is C1–C5 only)", async () => {
    await expect(declareHomeworkItem(validDeclareInput({ classLevel: 0 }))).rejects.toThrow(/C1–C5/);
    await expect(declareHomeworkItem(validDeclareInput({ classLevel: 6 }))).rejects.toThrow(/C1–C5/);
  });

  test("rejects empty topTags (≥1 TOP tag required)", async () => {
    await expect(declareHomeworkItem(validDeclareInput({ topTags: [] }))).rejects.toThrow(/TOP-… tag/);
  });

  test("rejects a malformed / mismatched TOP tag", async () => {
    await expect(
      declareHomeworkItem(validDeclareInput({ topTags: ["TOP-ENG-C1-01"] })), // wrong subject
    ).rejects.toThrow(/Malformed TOP tag/);
    await expect(
      declareHomeworkItem(validDeclareInput({ topTags: ["TOP-MATH-C2-01"] })), // wrong class
    ).rejects.toThrow(/Malformed TOP tag/);
  });

  test("TIME_DECL: 0 is valid; >40 is allowed (band warns, never blocks — §2.1/T2.5); negative rejected", async () => {
    const zero = await declareHomeworkItem(validDeclareInput({ timeDecl: 0 }));
    expect(zero.timeDecl).toBe(0); // 0 is honest/valid (D-030)
    const over = await declareHomeworkItem(validDeclareInput({ timeDecl: 45 }));
    expect(over.timeDecl).toBe(45); // >40 accepted (reduced-roster days); warning is a tally concern
    await expect(declareHomeworkItem(validDeclareInput({ timeDecl: -1 }))).rejects.toThrow(
      /non-negative integer/,
    );
  });

  test("rejects unknown/excluded subjects; accepts roster-only Arabic + Islam (not Quran, D-#36)", async () => {
    await expect(declareHomeworkItem(validDeclareInput({ subject: "HISTORY" }))).rejects.toThrow(
      /Unknown homework subject/,
    );
    // Quran is NOT a homework subject (Principal ruling, D-#36) → handled by the Quran Tracker.
    await expect(declareHomeworkItem(validDeclareInput({ subject: "QURAN" }))).rejects.toThrow(
      /Unknown homework subject/,
    );
    const res = await declareHomeworkItem(
      validDeclareInput({ subject: "ARABIC", topTags: ["TOP-ARABIC-C1-01"] }),
    );
    expect(res.hwId).toBe("HW-C1-ARABIC-0001");
  });

  test("rejects a malformed POOL_REF when provided", async () => {
    await expect(
      declareHomeworkItem(validDeclareInput({ poolRef: "QP-WRONG" })),
    ).rejects.toThrow(/Malformed POOL_REF/);
  });
});

// ===========================================================================
// issueHomeworkItem — spawn Layer-B records (present→GIVEN, absent→ABSENT_REDELIVER)
// ===========================================================================

describe("issueHomeworkItem — per-student record spawn", () => {
  function makeItemDoc() {
    return {
      _id: ITEM_ID,
      hwId: "HW-C1-MATH-0001",
      sectionId: SECTION_ID,
      classId: CLASS_ID,
      dateGiven: A_TUESDAY,
      status: "declared" as string,
      issuedAt: undefined as Date | undefined,
      save: jest.fn().mockResolvedValue(true),
    };
  }

  test("present→GIVEN with a due date; absent→ABSENT_REDELIVER with none; item→issued", async () => {
    const item = makeItemDoc();
    mockItemFindById.mockResolvedValue(item);
    mockRecordInsertMany.mockResolvedValue([]);

    const res = await issueHomeworkItem(
      ITEM_ID.toString(),
      [
        { studentId: "s1", present: true },
        { studentId: "s2", present: false },
      ],
      ACTOR_ID,
    );

    expect(res.issuedCount).toBe(2);
    expect(res.status).toBe("issued");
    expect(item.status).toBe("issued");
    expect(item.save).toHaveBeenCalled();

    const inserted = mockRecordInsertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    const present = inserted.find((r) => r.studentId === "s1")!;
    const absent = inserted.find((r) => r.studentId === "s2")!;
    expect(present.state).toBe("GIVEN");
    expect(present.dueDate).toBeInstanceOf(Date);
    expect(absent.state).toBe("ABSENT_REDELIVER");
    expect(absent.dueDate).toBeUndefined();
    // STATE_DATES stamped at issue
    expect((present.stateDates as Array<{ state: string }>)[0].state).toBe("GIVEN");
  });

  test("throws when the item is not found", async () => {
    mockItemFindById.mockResolvedValue(null);
    await expect(issueHomeworkItem(ITEM_ID.toString(), [], ACTOR_ID)).rejects.toThrow(
      "HomeworkItem not found",
    );
  });
});

// ===========================================================================
// transitionRecord — legal moves, timestamps, chase, result, T1.4 due-shift
// ===========================================================================

describe("transitionRecord — lifecycle moves (timestamped)", () => {
  function makeRecord(over: Record<string, unknown> = {}) {
    return {
      _id: REC_ID,
      hwId: "HW-C1-MATH-0001",
      state: "GIVEN" as string,
      stateDates: [] as Array<{ state: string; at: Date }>,
      chaseCount: 0,
      result: undefined as string | undefined,
      dueDate: undefined as Date | undefined,
      save: jest.fn().mockResolvedValue(true),
      ...over,
    };
  }

  test("a legal transition updates state and pushes a STATE_DATES stamp", async () => {
    const rec = makeRecord({ state: "GIVEN" });
    mockRecordFindById.mockResolvedValue(rec);
    const res = await transitionRecord({ recordId: REC_ID.toString(), toState: "DUE", actorId: ACTOR_ID });
    expect(rec.state).toBe("DUE");
    expect(rec.stateDates).toHaveLength(1);
    expect(rec.stateDates[0].state).toBe("DUE");
    expect(rec.stateDates[0].at).toBeInstanceOf(Date);
    expect(rec.save).toHaveBeenCalled();
    expect(res.state).toBe("DUE");
  });

  test("an illegal transition is rejected and not persisted", async () => {
    const rec = makeRecord({ state: "GIVEN" });
    mockRecordFindById.mockResolvedValue(rec);
    await expect(
      transitionRecord({ recordId: REC_ID.toString(), toState: "CHECKED", actorId: ACTOR_ID }),
    ).rejects.toThrow(/Illegal lifecycle transition/);
    expect(rec.save).not.toHaveBeenCalled();
  });

  test("→CHECKED requires a RESULT and stores it", async () => {
    const rec = makeRecord({ state: "SUBMITTED" });
    mockRecordFindById.mockResolvedValue(rec);
    await expect(
      transitionRecord({ recordId: REC_ID.toString(), toState: "CHECKED", actorId: ACTOR_ID }),
    ).rejects.toThrow(/RESULT .* is required/);

    const rec2 = makeRecord({ state: "SUBMITTED" });
    mockRecordFindById.mockResolvedValue(rec2);
    const res = await transitionRecord({
      recordId: REC_ID.toString(),
      toState: "CHECKED",
      result: "WRONG",
      actorId: ACTOR_ID,
    });
    expect(res.result).toBe("WRONG");
    expect(rec2.result).toBe("WRONG");
  });

  test("entering CHASE increments CHASE_COUNT", async () => {
    const rec = makeRecord({ state: "DUE", chaseCount: 0 });
    mockRecordFindById.mockResolvedValue(rec);
    const res = await transitionRecord({ recordId: REC_ID.toString(), toState: "CHASE", actorId: ACTOR_ID });
    expect(res.chaseCount).toBe(1);
  });

  test("T1.4 — re-delivery (ABSENT_REDELIVER→GIVEN) shifts the due date to the next school day", async () => {
    const rec = makeRecord({ state: "ABSENT_REDELIVER", dueDate: undefined });
    mockRecordFindById.mockResolvedValue(rec);
    const res = await transitionRecord({
      recordId: REC_ID.toString(),
      toState: "GIVEN",
      actorId: ACTOR_ID,
      at: A_THURSDAY,
    });
    expect(rec.state).toBe("GIVEN");
    expect(rec.dueDate).toBeInstanceOf(Date);
    expect(isSchoolDay(rec.dueDate as unknown as Date)).toBe(true);
    expect(res.dueDate).not.toBeNull();
  });

  test("throws when the record is not found", async () => {
    mockRecordFindById.mockResolvedValue(null);
    await expect(
      transitionRecord({ recordId: REC_ID.toString(), toState: "DUE", actorId: ACTOR_ID }),
    ).rejects.toThrow("HomeworkStudentRecord not found");
  });
});
