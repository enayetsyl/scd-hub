/**
 * AS-T3 tests — checking + teacher-OPTIONAL resubmission (PRD §5 AS-T3, D-#87).
 *
 * AJ-5 — result + marks + feedback recorded at CHECKED; NOTHING auto-spawns on
 *        any result; the teacher may explicitly issue a resubmission (new
 *        record, same asId, resubOf set, fresh pass; original → RESUBMIT).
 *
 * DB-free: models mocked; the shared lifecycle engine is real.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockRecCreate = jest.fn();
const mockItemFindById = jest.fn();

jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
    create: (a: unknown) => mockRecCreate(a),
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }) },
}));

import {
  checkAssignmentRecord,
  issueAssignmentResubmission,
} from "../modules/trackers/services/AssignmentCheckingService";

const oid = () => new mongoose.Types.ObjectId();
const ACTOR = oid().toString();
const REC_ID = oid();

function rec(over: Record<string, unknown> = {}) {
  return {
    _id: REC_ID,
    asItemId: oid(),
    asId: "AS-C2-BAN-0042",
    studentId: oid(),
    sectionId: oid(),
    classId: oid(),
    state: "SUBMITTED",
    stateDates: [] as Array<{ state: string; at: Date }>,
    chaseCount: 0,
    marks: undefined as number | undefined,
    feedback: undefined as string | undefined,
    result: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFindById.mockResolvedValue({ _id: oid(), totalMarks: 10 });
  mockRecCreate.mockImplementation((a: Record<string, unknown>) =>
    Promise.resolve({ _id: oid(), ...a }),
  );
});

// ===========================================================================
// AJ-5 — checking
// ===========================================================================

describe("AJ-5 — checkAssignmentRecord", () => {
  test("result=WRONG + marks 4/10 + feedback recorded; NOTHING auto-spawns (D-#87)", async () => {
    const r = rec();
    mockRecFindById.mockResolvedValue(r);
    const res = await checkAssignmentRecord({
      recordId: REC_ID.toString(),
      result: "WRONG", // ভুল — homework would auto-spawn here; assignments must NOT
      marks: 4,
      feedback: "আরও অনুশীলন প্রয়োজন",
      actorId: ACTOR,
    });
    expect(r.state).toBe("CHECKED");
    expect(r.result).toBe("WRONG");
    expect(r.marks).toBe(4);
    expect(r.feedback).toBe("আরও অনুশীলন প্রয়োজন");
    expect(res.totalMarks).toBe(10);
    expect(mockRecCreate).not.toHaveBeenCalled(); // no auto-resubmission on ANY result
  });

  test("marks and feedback are optional — result alone suffices", async () => {
    const r = rec();
    mockRecFindById.mockResolvedValue(r);
    const res = await checkAssignmentRecord({ recordId: REC_ID.toString(), result: "CORRECT", actorId: ACTOR });
    expect(res.marks).toBeNull();
    expect(res.feedback).toBeNull();
    expect(r.state).toBe("CHECKED");
  });

  test("marks above totalMarks are rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    await expect(
      checkAssignmentRecord({ recordId: REC_ID.toString(), result: "PARTIAL", marks: 11, actorId: ACTOR }),
    ).rejects.toThrow(/cannot exceed/);
  });

  test("marks on an item without totalMarks are rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    mockItemFindById.mockResolvedValue({ _id: oid(), totalMarks: undefined });
    await expect(
      checkAssignmentRecord({ recordId: REC_ID.toString(), result: "PARTIAL", marks: 5, actorId: ACTOR }),
    ).rejects.toThrow(/no totalMarks/);
  });

  test("invalid result and non-SUBMITTED state are rejected", async () => {
    mockRecFindById.mockResolvedValue(rec());
    await expect(
      checkAssignmentRecord({ recordId: REC_ID.toString(), result: "MAYBE", actorId: ACTOR }),
    ).rejects.toThrow(/RESULT must be/);

    mockRecFindById.mockResolvedValue(rec({ state: "GIVEN" }));
    await expect(
      checkAssignmentRecord({ recordId: REC_ID.toString(), result: "CORRECT", actorId: ACTOR }),
    ).rejects.toThrow(/Illegal lifecycle transition/);
  });
});

// ===========================================================================
// AJ-5 — explicit resubmission
// ===========================================================================

describe("AJ-5 — issueAssignmentResubmission (teacher-optional, any result)", () => {
  test("legal on a CHECKED record even with result=CORRECT: original → RESUBMIT; new record same asId + resubOf", async () => {
    const r = rec({ state: "CHECKED", result: "CORRECT" });
    mockRecFindById.mockResolvedValue(r);
    const res = await issueAssignmentResubmission(REC_ID.toString(), ACTOR, new Date(2026, 0, 12)); // Mon
    expect(r.state).toBe("RESUBMIT");
    const createArg = mockRecCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.asId).toBe("AS-C2-BAN-0042"); // same AS_ID — never a new stream
    expect(createArg.resubOf).toBe(r._id);
    expect(createArg.state).toBe("GIVEN"); // fresh pass
    expect(res.recordId).not.toBe(res.originalRecordId);
    expect(res.dueDate!.slice(0, 10)).toBe("2026-01-13"); // next school day (Tue)
  });

  test("rejected unless the record is CHECKED", async () => {
    mockRecFindById.mockResolvedValue(rec({ state: "SUBMITTED" }));
    await expect(issueAssignmentResubmission(REC_ID.toString(), ACTOR)).rejects.toThrow(
      /Illegal lifecycle transition/,
    );
    expect(mockRecCreate).not.toHaveBeenCalled();
  });
});
