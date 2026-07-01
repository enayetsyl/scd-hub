/**
 * HW-T3 tests — checking, resubmission spawn + Pool top-up (handoff §5).
 *
 * T3.1 — RESULT at Checked: WRONG auto-spawns; PARTIAL only at judgment; CORRECT advances
 * T3.2 — boundary 1: top-up qids must resolve to existing Pool questions (selected, not authored)
 * T3.3 — boundary 2: a top-up only attaches to a spawned resubmission (reactive only)
 * T3.4 — boundary 3 + day-load: TOPUP_TIME counted in the child's personal day-load
 * T3.5 — boundary 4: resubmission is a NEW record on the SAME HW_ID
 *
 * DB-free: models + listDailyItems mocked; lifecycle + calendar are real.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockRecCreate = jest.fn();
const mockRecFind = jest.fn();
const mockItemFindById = jest.fn();
const mockArtifactFindOne = jest.fn();
const mockList = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
    create: (a: unknown) => mockRecCreate(a),
    find: (q: unknown) => ({ lean: () => mockRecFind(q) }),
  },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }) },
}));
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findOne: (f: unknown) => ({ lean: () => mockArtifactFindOne(f) }) },
}));
jest.mock("../modules/trackers/services/HomeworkService", () => ({
  listDailyItems: (...a: unknown[]) => mockList(...a),
}));

import { checkRecord, getStudentDayLoad } from "../modules/trackers/services/HomeworkResubmissionService";

const ACTOR = new mongoose.Types.ObjectId().toString();
const REC_ID = new mongoose.Types.ObjectId();
const STUDENT = new mongoose.Types.ObjectId().toString();
const CLASS = new mongoose.Types.ObjectId().toString();

function rec(over: Record<string, unknown> = {}) {
  return {
    _id: REC_ID,
    hwId: "HW-C1-MATH-0001",
    hwItemId: new mongoose.Types.ObjectId(),
    studentId: STUDENT,
    sectionId: new mongoose.Types.ObjectId(),
    classId: CLASS,
    state: "SUBMITTED",
    stateDates: [] as Array<{ state: string; at: Date }>,
    result: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFindById.mockResolvedValue({ subject: "MATH", classLevel: 1 });
  mockArtifactFindOne.mockResolvedValue({ subject: "MATH", classLevel: 1 }); // qid resolves
  mockRecCreate.mockImplementation((a: Record<string, unknown>) =>
    Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...a }),
  );
});

// ===========================================================================
// T3.1 — RESULT + spawn behaviour
// ===========================================================================

describe("T3.1 — RESULT recording + auto/judgment spawn", () => {
  test("WRONG auto-spawns a resubmission; original → RESUBMIT", async () => {
    const r = rec({ state: "SUBMITTED" });
    mockRecFindById.mockResolvedValue(r);
    const res = await checkRecord({ recordId: REC_ID.toString(), result: "WRONG", actorId: ACTOR });
    expect(r.result).toBe("WRONG");
    expect(r.state).toBe("RESUBMIT");
    expect(mockRecCreate).toHaveBeenCalledTimes(1);
    expect(res.resubmission).not.toBeNull();
    expect(res.resubmission!.state).toBe("GIVEN");
  });

  test("CORRECT advances to CHECKED, no resubmission", async () => {
    const r = rec({ state: "SUBMITTED" });
    mockRecFindById.mockResolvedValue(r);
    const res = await checkRecord({ recordId: REC_ID.toString(), result: "CORRECT", actorId: ACTOR });
    expect(r.state).toBe("CHECKED");
    expect(res.resubmission).toBeNull();
    expect(mockRecCreate).not.toHaveBeenCalled();
  });

  test("PARTIAL does NOT spawn by default", async () => {
    const r = rec({ state: "SUBMITTED" });
    mockRecFindById.mockResolvedValue(r);
    const res = await checkRecord({ recordId: REC_ID.toString(), result: "PARTIAL", actorId: ACTOR });
    expect(r.state).toBe("CHECKED");
    expect(res.resubmission).toBeNull();
  });

  test("PARTIAL spawns when the teacher elects resubmit=true", async () => {
    const r = rec({ state: "SUBMITTED" });
    mockRecFindById.mockResolvedValue(r);
    const res = await checkRecord({
      recordId: REC_ID.toString(),
      result: "PARTIAL",
      resubmit: true,
      actorId: ACTOR,
    });
    expect(r.state).toBe("RESUBMIT");
    expect(res.resubmission).not.toBeNull();
  });

  test("checking a non-SUBMITTED record is rejected (illegal transition)", async () => {
    const r = rec({ state: "GIVEN" });
    mockRecFindById.mockResolvedValue(r);
    await expect(
      checkRecord({ recordId: REC_ID.toString(), result: "CORRECT", actorId: ACTOR }),
    ).rejects.toThrow(/Illegal lifecycle transition/);
  });

  test("invalid RESULT is rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    await expect(
      checkRecord({ recordId: REC_ID.toString(), result: "MAYBE", actorId: ACTOR }),
    ).rejects.toThrow(/RESULT must be/);
  });
});

// ===========================================================================
// T3.2 / T3.3 / T3.5 — top-up boundaries
// ===========================================================================

describe("T3.2/T3.3/T3.5 — top-up boundaries", () => {
  const topup = { qids: ["MATH-C1-U02-Q07"], time: 10 };

  test("boundary 4: resubmission carries the SAME HW_ID + top-up fields", async () => {
    const r = rec({ state: "SUBMITTED", hwId: "HW-C1-MATH-0042" });
    mockRecFindById.mockResolvedValue(r);
    const res = await checkRecord({ recordId: REC_ID.toString(), result: "WRONG", topup, actorId: ACTOR });
    const createArg = mockRecCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.hwId).toBe("HW-C1-MATH-0042"); // same HW_ID, not a new stream
    expect(createArg.resubOf).toBe(r._id);
    expect(createArg.topupFlag).toBe(true);
    expect(createArg.topupQids).toEqual(["MATH-C1-U02-Q07"]);
    expect(createArg.topupTime).toBe(10);
    expect(res.resubmission!.topupFlag).toBe(true);
  });

  test("boundary 2 (reactive only): a top-up on a CORRECT check is rejected", async () => {
    const r = rec({ state: "SUBMITTED" });
    mockRecFindById.mockResolvedValue(r);
    await expect(
      checkRecord({ recordId: REC_ID.toString(), result: "CORRECT", topup, actorId: ACTOR }),
    ).rejects.toThrow(/reactive only/);
    expect(mockRecCreate).not.toHaveBeenCalled();
  });

  test("boundary 1 (selected, not authored): an unknown qid is rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    mockArtifactFindOne.mockResolvedValue(null); // qid not in the store
    await expect(
      checkRecord({ recordId: REC_ID.toString(), result: "WRONG", topup, actorId: ACTOR }),
    ).rejects.toThrow(/selected, never authored/);
    expect(mockRecCreate).not.toHaveBeenCalled();
  });

  test("boundary 1: a qid outside the topic's pool (wrong subject/class) is rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    mockArtifactFindOne.mockResolvedValue({ subject: "ENG", classLevel: 1 }); // wrong subject
    await expect(
      checkRecord({ recordId: REC_ID.toString(), result: "WRONG", topup, actorId: ACTOR }),
    ).rejects.toThrow(/outside this topic's pool/);
  });

  test("a top-up with no minutes is rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    await expect(
      checkRecord({
        recordId: REC_ID.toString(),
        result: "WRONG",
        topup: { qids: ["MATH-C1-U02-Q07"], time: 0 },
        actorId: ACTOR,
      }),
    ).rejects.toThrow(/TOPUP_TIME must be a positive integer/);
  });
});

// ===========================================================================
// T3.4 — getStudentDayLoad (base + top-up minutes)
// ===========================================================================

describe("T3.4 — student day-load includes top-up minutes", () => {
  test("sums issued items + open resubmission top-ups; flags over-ceiling", async () => {
    mockList.mockResolvedValue([
      { status: "issued", qCount: 5, timeDecl: 200 },
      { status: "issued", qCount: 3, timeDecl: 30 },
      { status: "declared", qCount: 4, timeDecl: 20 }, // not issued → excluded
      { status: "issued", qCount: 0, timeDecl: 0 }, // zeroed → excluded
    ]);
    mockRecFind.mockResolvedValue([
      { state: "GIVEN", topupTime: 15 }, // open → counts
      { state: "DUE", topupTime: 10 }, // open → counts
      { state: "RETURNED", topupTime: 30 }, // terminal → excluded
    ]);
    const load = await getStudentDayLoad(CLASS, STUDENT, new Date(2026, 5, 2));
    expect(load.baseMinutes).toBe(230); // 200 + 30
    expect(load.topupMinutes).toBe(25); // 15 + 10
    expect(load.totalMinutes).toBe(255);
    expect(load.ceiling).toBe(120);
    expect(load.overCeiling).toBe(true); // a top-up day MAY push a child over — visible choice
  });

  test("within ceiling when there are no top-ups", async () => {
    mockList.mockResolvedValue([{ status: "issued", qCount: 5, timeDecl: 100 }]);
    mockRecFind.mockResolvedValue([]);
    const load = await getStudentDayLoad(CLASS, STUDENT, new Date(2026, 5, 2));
    expect(load.totalMinutes).toBe(100);
    expect(load.overCeiling).toBe(false);
  });
});
