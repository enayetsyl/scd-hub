/**
 * HWG-1 tests — recordHomeworkOutcome (one-tap outcome recording, D-#267).
 *
 * Real lifecycle.ts/calendar.ts/HomeworkService/HomeworkResubmissionService run for
 * real — only the Mongoose models + notification emitters are mocked (DB-free), so
 * the composition (fast-forward → check/chase) is genuinely exercised, mirroring
 * homeworkResubmission.test.ts's convention.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockRecCreate = jest.fn();
const mockItemFindById = jest.fn();
const mockArtifactFindOne = jest.fn();
const mockEmitChase = jest.fn().mockResolvedValue(undefined);
const mockEmitParentComms = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
    create: (a: unknown) => mockRecCreate(a),
  },
}));
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }) },
}));
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findOne: (f: unknown) => ({ lean: () => mockArtifactFindOne(f) }) },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHwGuardianChase: (...a: unknown[]) => mockEmitChase(...a),
  emitHwParentComms: (...a: unknown[]) => mockEmitParentComms(...a),
}));

import { recordHomeworkOutcome } from "../modules/trackers/services/HomeworkOutcomeService";

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
    state: "GIVEN",
    chaseCount: 0,
    dueDate: null as Date | null,
    stateDates: [] as Array<{ state: string; at: Date }>,
    result: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

/** findById must support BOTH a bare `await` (the real doc, for transitionRecord/
 *  checkRecord) AND a `.select().lean()` chain (the composite's own state peek). */
function stubFindById(doc: ReturnType<typeof rec>) {
  mockRecFindById.mockReturnValue({
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(doc).then(resolve, reject),
    select: () => ({
      lean: () =>
        Promise.resolve({
          state: doc.state,
          hwId: doc.hwId,
          chaseCount: doc.chaseCount,
          result: doc.result ?? null,
          dueDate: doc.dueDate ?? null,
        }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFindById.mockResolvedValue({ subject: "MATH", classLevel: 1 });
  mockArtifactFindOne.mockResolvedValue({ subject: "MATH", classLevel: 1 });
  mockRecCreate.mockImplementation((a: Record<string, unknown>) =>
    Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...a }),
  );
});

describe("outcome validation", () => {
  test("rejects an unknown outcome before touching the record", async () => {
    await expect(
      recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "MAYBE", actorId: ACTOR }),
    ).rejects.toThrow(/outcome must be/);
    expect(mockRecFindById).not.toHaveBeenCalled();
  });
});

describe("illegal starting states", () => {
  test.each(["ABSENT_REDELIVER", "CHECKED", "RESUBMIT", "RETURNED"])(
    "rejects when the record is %s",
    async (state) => {
      stubFindById(rec({ state }));
      await expect(
        recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "CORRECT", actorId: ACTOR }),
      ).rejects.toThrow(new RegExp(state));
    },
  );
});

describe("CORRECT/PARTIAL/WRONG — fast-forward then check", () => {
  test("GIVEN + CORRECT: 3 audit rows (DUE, SUBMITTED, CHECKED)", async () => {
    const r = rec({ state: "GIVEN" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "CORRECT", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED"]);
    expect(r.state).toBe("CHECKED");
    expect(res.kind).toBe("checked");
  });

  test("GIVEN + WRONG: 4 audit rows + spawns a resubmission", async () => {
    const r = rec({ state: "GIVEN" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "WRONG", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED", "RESUBMIT"]);
    expect(mockRecCreate).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe("checked");
    if (res.kind === "checked") expect(res.result.resubmission).not.toBeNull();
  });

  test("GIVEN + PARTIAL (no resubmit): 3 audit rows, no spawn", async () => {
    const r = rec({ state: "GIVEN" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "PARTIAL", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED"]);
    expect(mockRecCreate).not.toHaveBeenCalled();
    if (res.kind === "checked") expect(res.result.resubmission).toBeNull();
  });

  test("GIVEN + PARTIAL (resubmit=true): 4 audit rows + spawn", async () => {
    const r = rec({ state: "GIVEN" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({
      recordId: REC_ID.toString(),
      outcome: "PARTIAL",
      resubmit: true,
      actorId: ACTOR,
    });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED", "RESUBMIT"]);
    if (res.kind === "checked") {
      expect(res.result.resubmission).not.toBeNull();
      expect(res.result.resubmission!.state).toBe("GIVEN");
    }
  });

  test("DUE + CORRECT: 2 audit rows (SUBMITTED, CHECKED)", async () => {
    const r = rec({ state: "DUE" });
    stubFindById(r);
    await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "CORRECT", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["SUBMITTED", "CHECKED"]);
  });

  test("CHASE + WRONG: 3 audit rows (SUBMITTED, CHECKED, RESUBMIT); chaseCount untouched", async () => {
    const r = rec({ state: "CHASE", chaseCount: 2 });
    stubFindById(r);
    await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "WRONG", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["SUBMITTED", "CHECKED", "RESUBMIT"]);
    expect(r.chaseCount).toBe(2); // fast-forward exits CHASE, doesn't re-enter it
  });

  test("SUBMITTED + CORRECT: no-op fast-forward, 1 audit row (CHECKED)", async () => {
    const r = rec({ state: "SUBMITTED" });
    stubFindById(r);
    await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "CORRECT", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["CHECKED"]);
  });

  test("top-up carries through on a WRONG spawn from GIVEN", async () => {
    const r = rec({ state: "GIVEN", hwId: "HW-C1-MATH-0042" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({
      recordId: REC_ID.toString(),
      outcome: "WRONG",
      topup: { qids: ["MATH-C1-U02-Q07"], time: 10 },
      actorId: ACTOR,
    });
    const createArg = mockRecCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg.hwId).toBe("HW-C1-MATH-0042");
    expect(createArg.topupFlag).toBe(true);
    expect(createArg.topupTime).toBe(10);
    if (res.kind === "checked") expect(res.result.resubmission!.topupFlag).toBe(true);
  });
});

describe("NOT_SUBMITTED — chase path, no check call", () => {
  test("GIVEN + NOT_SUBMITTED: 2 audit rows (DUE, CHASE), chaseCount=1, guardian chase emitted", async () => {
    const r = rec({ state: "GIVEN" });
    stubFindById(r);
    const res = await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "NOT_SUBMITTED", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "CHASE"]);
    expect(r.chaseCount).toBe(1);
    expect(r.result).toBeUndefined();
    expect(mockEmitChase).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe("chased");
  });

  test("DUE + NOT_SUBMITTED: 1 audit row (CHASE), chaseCount=1", async () => {
    const r = rec({ state: "DUE" });
    stubFindById(r);
    await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "NOT_SUBMITTED", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["CHASE"]);
    expect(r.chaseCount).toBe(1);
  });

  // D-#355 (first-cross-only): re-marking an already-CHASE record not-submitted is
  // now a NO-OP — no state stamp, no chaseCount increment, no guardian/parent nudge.
  // Escalation is the explicit CHASE→CHASE transition (তাগাদা), not a re-run.
  test("CHASE + NOT_SUBMITTED: no-op — count untouched, nothing emitted", async () => {
    const r = rec({ state: "CHASE", chaseCount: 2 });
    stubFindById(r);
    const res = await recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "NOT_SUBMITTED", actorId: ACTOR });
    expect(r.stateDates).toEqual([]);
    expect(r.chaseCount).toBe(2);
    expect(r.save).not.toHaveBeenCalled();
    expect(mockEmitChase).not.toHaveBeenCalled();
    expect(mockEmitParentComms).not.toHaveBeenCalled();
    expect(res.kind).toBe("chased");
  });

  test("SUBMITTED + NOT_SUBMITTED is explicitly rejected", async () => {
    const r = rec({ state: "SUBMITTED" });
    stubFindById(r);
    await expect(
      recordHomeworkOutcome({ recordId: REC_ID.toString(), outcome: "NOT_SUBMITTED", actorId: ACTOR }),
    ).rejects.toThrow(/submitted/i);
    expect(r.stateDates).toEqual([]);
  });
});
