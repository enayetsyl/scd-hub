/**
 * D-#338 — revertAssignmentRecord: assignment mirror of the homework revert.
 * Module nuances under test: CHECKED pop clears result+marks+feedback;
 * RESUBMIT-alone pop restores CHECKED keeping result/marks/feedback;
 * redeliver undo leaves dueDate as-is.
 */
import mongoose from "mongoose";

const mockFindById = jest.fn();
const mockFindOne = jest.fn();
const mockDeleteOne = jest.fn();

jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findById: (id: unknown) => mockFindById(id),
    findOne: (q: unknown) => mockFindOne(q),
    deleteOne: (q: unknown) => mockDeleteOne(q),
  },
}));

// D-#354: a revert deletes the popped stamps, so the audit row is the only trace.
const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import { revertAssignmentRecord } from "../modules/trackers/services/AssignmentRevertService";

const ACTOR = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const REC_ID = new mongoose.Types.ObjectId();
const ITEM_ID = new mongoose.Types.ObjectId();
const STUDENT_ID = new mongoose.Types.ObjectId();

const T0 = new Date("2026-07-19T09:00:00+06:00");
const T1 = new Date("2026-07-19T10:00:00+06:00");
const T2 = new Date("2026-07-19T11:00:00+06:00");
const NOW = new Date("2026-07-19T12:00:00+06:00");

function makeRec(extra: Record<string, unknown> = {}) {
  return {
    _id: REC_ID,
    asId: "AS-C2-MATH-0001",
    asItemId: ITEM_ID,
    studentId: STUDENT_ID,
    state: "CHECKED",
    stateDates: [
      { state: "GIVEN", at: T0 },
      { state: "DUE", at: T0 },
      { state: "SUBMITTED", at: T1, by: ACTOR },
      { state: "CHECKED", at: T2, by: ACTOR },
    ],
    chaseCount: 0,
    result: "CORRECT",
    marks: 18,
    feedback: "ভালো হয়েছে",
    dueDate: new Date("2026-07-20T00:00:00+06:00"),
    save: jest.fn().mockResolvedValue(true),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockResolvedValue(null);
  mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe("revertAssignmentRecord", () => {
  test("popping CHECKED restores SUBMITTED and clears result, marks, feedback", async () => {
    const rec = makeRec();
    mockFindById.mockResolvedValue(rec);
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("SUBMITTED");
    expect(res.poppedStates).toEqual(["CHECKED"]);
    expect(rec.result).toBeUndefined();
    expect(rec.marks).toBeUndefined();
    expect(rec.feedback).toBeUndefined();
    expect(rec.save).toHaveBeenCalled();
  });

  // D-#354: the popped stamps are DELETED from the record — this row is the only
  // evidence the undone work ever happened.
  test("writes an AS_RECORD_REVERTED audit carrying the popped stamps (the only trace)", async () => {
    const rec = makeRec();
    mockFindById.mockResolvedValue(rec);

    await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const row = mockWriteAudit.mock.calls[0][0];
    expect(row.eventKind).toBe("AS_RECORD_REVERTED");
    expect(row.targetKind).toBe("AssignmentStudentRecord");
    expect(row.meta.revertedFrom).toBe("CHECKED");
    expect(row.meta.restoredTo).toBe("SUBMITTED");
    expect(row.meta.asId).toBe("AS-C2-MATH-0001");
    expect(row.meta.studentId).toBe(STUDENT_ID.toString());
    expect(row.meta.popped.map((p: { state: string }) => p.state)).toEqual(["CHECKED"]);
    expect(row.meta.popped[0].by).toBe(ACTOR.toString());
  });

  test("RESUBMIT-alone pop restores CHECKED and KEEPS result/marks/feedback", async () => {
    const rec = makeRec({
      state: "RESUBMIT",
      result: "WRONG",
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "SUBMITTED", at: T0, by: ACTOR },
        { state: "CHECKED", at: T1, by: ACTOR },
        { state: "RESUBMIT", at: T2, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const spawnId = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({
      _id: spawnId,
      state: "GIVEN",
      stateDates: [{ state: "GIVEN", at: T2 }],
    });
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("CHECKED");
    expect(res.poppedStates).toEqual(["RESUBMIT"]);
    expect(rec.result).toBe("WRONG");
    expect(rec.marks).toBe(18);
    expect(rec.feedback).toBe("ভালো হয়েছে");
    expect(res.deletedResubmissionId).toBe(spawnId.toString());
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: spawnId });
  });

  test("compound CHECKED+RESUBMIT group pops back to SUBMITTED and clears the check", async () => {
    const rec = makeRec({
      state: "RESUBMIT",
      result: "WRONG",
      marks: undefined,
      feedback: undefined,
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "SUBMITTED", at: T1, by: ACTOR },
        { state: "CHECKED", at: T2, by: ACTOR },
        { state: "RESUBMIT", at: T2, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("SUBMITTED");
    expect(res.poppedStates).toEqual(["CHECKED", "RESUBMIT"]);
    expect(rec.result).toBeUndefined();
  });

  test("progressed spawn blocks the revert", async () => {
    const rec = makeRec({
      state: "RESUBMIT",
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "SUBMITTED", at: T1, by: ACTOR },
        { state: "CHECKED", at: T2, by: ACTOR },
        { state: "RESUBMIT", at: T2, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    mockFindOne.mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      state: "SUBMITTED",
      stateDates: [{ state: "GIVEN", at: T2 }, { state: "SUBMITTED", at: NOW }],
    });
    await expect(
      revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW }),
    ).rejects.toThrow(/পুনঃজমার কাজ শুরু/);
    expect(rec.save).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });

  test("popping CHASE decrements chaseCount", async () => {
    const rec = makeRec({
      state: "CHASE",
      result: undefined,
      marks: undefined,
      feedback: undefined,
      chaseCount: 1,
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "DUE", at: T1, by: ACTOR },
        { state: "CHASE", at: T1, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("GIVEN");
    expect(res.poppedStates).toEqual(["DUE", "CHASE"]);
    expect(res.chaseCount).toBe(0);
  });

  test("undo of a redeliver restores ABSENT_REDELIVER without touching dueDate", async () => {
    const due = new Date("2026-07-21T00:00:00+06:00");
    const rec = makeRec({
      state: "GIVEN",
      result: undefined,
      marks: undefined,
      feedback: undefined,
      dueDate: due,
      stateDates: [
        { state: "ABSENT_REDELIVER", at: T0 },
        { state: "GIVEN", at: T1, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("ABSENT_REDELIVER");
    expect(rec.dueDate).toBe(due);
  });

  test("foreign stamped action blocks a teacher; admin bypasses", async () => {
    const stamps = [
      { state: "GIVEN", at: T0 },
      { state: "DUE", at: T1, by: OTHER },
      { state: "SUBMITTED", at: T1, by: OTHER },
    ];
    mockFindById.mockResolvedValue(
      makeRec({ state: "SUBMITTED", result: undefined, marks: undefined, feedback: undefined, stateDates: stamps }),
    );
    await expect(
      revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW }),
    ).rejects.toThrow(/অন্য শিক্ষক/);

    mockFindById.mockResolvedValue(
      makeRec({
        state: "SUBMITTED",
        result: undefined,
        marks: undefined,
        feedback: undefined,
        stateDates: stamps.map((s) => ({ ...s })),
      }),
    );
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: true, now: NOW });
    expect(res.state).toBe("GIVEN");
  });

  test("Dhaka same-day gate blocks a next-day teacher revert; admin bypasses", async () => {
    const stamps = [
      { state: "GIVEN", at: T0 },
      { state: "SUBMITTED", at: new Date("2026-07-18T23:30:00+06:00"), by: ACTOR },
    ];
    const after = new Date("2026-07-19T00:10:00+06:00");
    mockFindById.mockResolvedValue(
      makeRec({ state: "SUBMITTED", result: undefined, marks: undefined, feedback: undefined, stateDates: stamps }),
    );
    await expect(
      revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: after }),
    ).rejects.toThrow(/সেদিনই/);

    mockFindById.mockResolvedValue(
      makeRec({
        state: "SUBMITTED",
        result: undefined,
        marks: undefined,
        feedback: undefined,
        stateDates: stamps.map((s) => ({ ...s })),
      }),
    );
    const res = await revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: true, now: after });
    expect(res.state).toBe("GIVEN");
  });

  test("entry-only record cannot be reverted", async () => {
    const rec = makeRec({ state: "GIVEN", stateDates: [{ state: "GIVEN", at: T0 }] });
    mockFindById.mockResolvedValue(rec);
    await expect(
      revertAssignmentRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: true, now: NOW }),
    ).rejects.toThrow(/ইস্যু/);
    expect(rec.save).not.toHaveBeenCalled();
  });
});
