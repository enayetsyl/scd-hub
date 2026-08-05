/**
 * D-#338 — revertHomeworkRecord: pop the last ACTION (trailing same-timestamp
 * stamp group) and restore the previous state with side-effect cleanup.
 *
 * DB-free: HomeworkStudentRecord is mocked; lifecycle.popActionGroup and the
 * Dhaka-day gate run for real.
 */
import mongoose from "mongoose";

const mockFindById = jest.fn();
const mockFindOne = jest.fn();
const mockDeleteOne = jest.fn();

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
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

import { revertHomeworkRecord } from "../modules/trackers/services/HomeworkRevertService";
import { popActionGroup } from "../modules/trackers/lifecycle";

const ACTOR = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const REC_ID = new mongoose.Types.ObjectId();
const ITEM_ID = new mongoose.Types.ObjectId();
const STUDENT_ID = new mongoose.Types.ObjectId();

const T0 = new Date("2026-07-19T09:00:00+06:00"); // issue
const T1 = new Date("2026-07-19T10:00:00+06:00"); // action 1
const T2 = new Date("2026-07-19T11:00:00+06:00"); // action 2
const NOW = new Date("2026-07-19T12:00:00+06:00");

function makeRec(extra: Record<string, unknown> = {}) {
  return {
    _id: REC_ID,
    hwId: "HW-C1-MATH-0001",
    hwItemId: ITEM_ID,
    studentId: STUDENT_ID,
    state: "CHECKED",
    stateDates: [
      { state: "GIVEN", at: T0 },
      { state: "DUE", at: T1, by: ACTOR },
      { state: "SUBMITTED", at: T1, by: ACTOR },
      { state: "CHECKED", at: T1, by: ACTOR },
    ],
    chaseCount: 0,
    result: "CORRECT",
    dueDate: new Date("2026-07-20T00:00:00+06:00"),
    answerFileId: undefined,
    save: jest.fn().mockResolvedValue(true),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOne.mockResolvedValue(null);
  mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
});

describe("popActionGroup (pure)", () => {
  test("groups trailing stamps by identical timestamp", () => {
    const rec = makeRec();
    const { popped, restored } = popActionGroup(rec.stateDates as never, "CHECKED" as never);
    expect(popped.map((s: { state: string }) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED"]);
    expect(restored.state).toBe("GIVEN");
  });

  test("never swallows the entry stamp even with an equal timestamp", () => {
    const stamps = [
      { state: "GIVEN", at: T1 },
      { state: "DUE", at: T1 },
    ];
    const { popped, restored } = popActionGroup(stamps as never, "DUE" as never);
    expect(popped.map((s: { state: string }) => s.state)).toEqual(["DUE"]);
    expect(restored.state).toBe("GIVEN");
  });

  test("entry-only record throws", () => {
    expect(() => popActionGroup([{ state: "GIVEN", at: T0 }] as never, "GIVEN" as never)).toThrow(
      /ইস্যু/,
    );
  });

  test("last stamp must match the current state", () => {
    const rec = makeRec({ state: "SUBMITTED" });
    expect(() => popActionGroup(rec.stateDates as never, "SUBMITTED" as never)).toThrow(/অসঙ্গত/);
  });
});

describe("revertHomeworkRecord", () => {
  test("pops a one-tap CHECKED group back to GIVEN and clears result", async () => {
    const rec = makeRec();
    mockFindById.mockResolvedValue(rec);
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("GIVEN");
    expect(res.poppedStates).toEqual(["DUE", "SUBMITTED", "CHECKED"]);
    expect(rec.result).toBeUndefined();
    expect(rec.stateDates).toHaveLength(1);
    expect(rec.save).toHaveBeenCalled();
  });

  // 2026-08-04 ruling: system auto-chase stamps carry NO `by` — a by-less stamp
  // is NOT foreign, so the subject teacher can undo it same-day (write-scope
  // gate only), and popping the CHASE decrements chaseCount back to 0.
  test("a SYSTEM auto-chase (by-less stamps) is teacher-undoable and restores chaseCount", async () => {
    const rec = makeRec({
      state: "CHASE",
      chaseCount: 1,
      result: undefined,
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "DUE", at: T2 }, // system fast-forward — no `by`
        { state: "CHASE", at: T2 }, // system chase — no `by`
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("GIVEN");
    expect(res.poppedStates).toEqual(["DUE", "CHASE"]);
    expect(res.chaseCount).toBe(0);
    expect(rec.chaseCount).toBe(0);
  });

  // D-#354: the popped stamps are DELETED from the record, so without this audit
  // row a submitted+checked record silently reads as never-submitted. The row must
  // preserve what was undone, who had done it, and where the record landed.
  test("writes an HW_RECORD_REVERTED audit carrying the popped stamps (the only trace)", async () => {
    const rec = makeRec();
    mockFindById.mockResolvedValue(rec);

    await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });

    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const row = mockWriteAudit.mock.calls[0][0];
    expect(row.eventKind).toBe("HW_RECORD_REVERTED");
    expect(row.actorId).toBe(ACTOR.toString());
    expect(row.targetKind).toBe("HomeworkStudentRecord");
    expect(row.meta.revertedFrom).toBe("CHECKED");
    expect(row.meta.restoredTo).toBe("GIVEN");
    expect(row.meta.hwId).toBe("HW-C1-MATH-0001");
    expect(row.meta.studentId).toBe(STUDENT_ID.toString());
    // The work that was undone is still legible even though the stamps are gone.
    expect(row.meta.popped.map((p: { state: string }) => p.state)).toEqual([
      "DUE",
      "SUBMITTED",
      "CHECKED",
    ]);
    expect(row.meta.popped[1].by).toBe(ACTOR.toString());
    expect(rec.stateDates).toHaveLength(1); // stamps really are gone from the record
  });

  test("WRONG action (CHECKED+RESUBMIT) deletes the untouched spawn, back to SUBMITTED", async () => {
    const rec = makeRec({
      state: "RESUBMIT",
      result: "WRONG",
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "DUE", at: T0 },
        { state: "SUBMITTED", at: T1, by: ACTOR },
        { state: "CHECKED", at: T2, by: ACTOR },
        { state: "RESUBMIT", at: T2, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const spawnId = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({
      _id: spawnId,
      state: "GIVEN",
      stateDates: [{ state: "GIVEN", at: T2 }],
      answerFileId: undefined,
    });
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("SUBMITTED");
    expect(res.deletedResubmissionId).toBe(spawnId.toString());
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: spawnId });
    expect(rec.result).toBeUndefined();
  });

  test("progressed spawn blocks the revert (record untouched)", async () => {
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
      state: "DUE",
      stateDates: [{ state: "GIVEN", at: T2 }, { state: "DUE", at: NOW }],
    });
    await expect(
      revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW }),
    ).rejects.toThrow(/পুনঃজমার কাজ শুরু/);
    expect(rec.save).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });

  test("popping CHASE decrements chaseCount", async () => {
    const rec = makeRec({
      state: "CHASE",
      result: undefined,
      chaseCount: 2,
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "DUE", at: T0 },
        { state: "CHASE", at: T1, by: ACTOR },
        { state: "CHASE", at: T2, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("CHASE");
    expect(res.chaseCount).toBe(1);
  });

  test("undo of a redeliver restores ABSENT_REDELIVER and clears dueDate", async () => {
    const rec = makeRec({
      state: "GIVEN",
      result: undefined,
      stateDates: [
        { state: "ABSENT_REDELIVER", at: T0 },
        { state: "GIVEN", at: T1, by: ACTOR },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("ABSENT_REDELIVER");
    expect(rec.dueDate).toBeUndefined();
  });

  test("teacher cannot revert another teacher's stamped action; admin can", async () => {
    const stamps = [
      { state: "GIVEN", at: T0 },
      { state: "DUE", at: T1, by: OTHER },
      { state: "SUBMITTED", at: T1, by: OTHER },
    ];
    mockFindById.mockResolvedValue(makeRec({ state: "SUBMITTED", result: undefined, stateDates: stamps }));
    await expect(
      revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW }),
    ).rejects.toThrow(/অন্য শিক্ষক/);

    mockFindById.mockResolvedValue(makeRec({ state: "SUBMITTED", result: undefined, stateDates: [...stamps.map((s) => ({ ...s }))] }));
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: true, now: NOW });
    expect(res.state).toBe("GIVEN");
  });

  test("Dhaka same-day gate: 23:30 action cannot be reverted at 00:10 next day; admin can", async () => {
    const lateStamp = [
      { state: "GIVEN", at: T0 },
      { state: "DUE", at: new Date("2026-07-18T23:30:00+06:00"), by: ACTOR },
    ];
    const after = new Date("2026-07-19T00:10:00+06:00");
    mockFindById.mockResolvedValue(makeRec({ state: "DUE", result: undefined, stateDates: lateStamp }));
    await expect(
      revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: after }),
    ).rejects.toThrow(/সেদিনই/);

    mockFindById.mockResolvedValue(makeRec({ state: "DUE", result: undefined, stateDates: lateStamp.map((s) => ({ ...s })) }));
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: true, now: after });
    expect(res.state).toBe("GIVEN");
  });

  test("unstamped (pre-D-#338) action falls back to write-scope-only same-day revert", async () => {
    const rec = makeRec({
      state: "SUBMITTED",
      result: undefined,
      stateDates: [
        { state: "GIVEN", at: T0 },
        { state: "DUE", at: T1 },
        { state: "SUBMITTED", at: T1 },
      ],
    });
    mockFindById.mockResolvedValue(rec);
    const res = await revertHomeworkRecord({ recordId: REC_ID.toString(), actorId: ACTOR.toString(), admin: false, now: NOW });
    expect(res.state).toBe("GIVEN");
  });
});
