/**
 * RP-1 tests — HomeworkRosterPassService (submit/return roster passes, D-#355).
 *
 * Real lifecycle.ts + HomeworkService.transitionRecord run; only the Mongoose
 * model + notification emitters are mocked (DB-free), mirroring
 * homeworkOutcome.test.ts. The focus is the FIRST-CROSS-ONLY chase rule (§3.1)
 * and the one-timestamp fast-forward walk.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockEmitChase = jest.fn().mockResolvedValue(undefined);
const mockEmitParentComms = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
  },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHwGuardianChase: (...a: unknown[]) => mockEmitChase(...a),
  emitHwParentComms: (...a: unknown[]) => mockEmitParentComms(...a),
}));

import { submitPass, returnPass } from "../modules/trackers/services/HomeworkRosterPassService";

const ACTOR = new mongoose.Types.ObjectId().toString();
const ITEM_ID = new mongoose.Types.ObjectId().toString();

function rec(over: Record<string, unknown> = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    recordId: id.toString(),
    hwId: "HW-C1-MATH-0001",
    hwItemId: { toString: () => ITEM_ID },
    studentId: new mongoose.Types.ObjectId(),
    sectionId: new mongoose.Types.ObjectId(),
    classId: new mongoose.Types.ObjectId(),
    state: "GIVEN",
    chaseCount: 0,
    dueDate: null as Date | null,
    stateDates: [] as Array<{ state: string; at: Date }>,
    result: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

/** findById supports BOTH a bare await (real doc, for transitionRecord) AND a
 *  `.select().lean()` chain (the pass's own state peek). Keyed by id so a pass
 *  over several records resolves each to its own doc. */
function stubDocs(docs: ReturnType<typeof rec>[]) {
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  mockRecFindById.mockImplementation((id: unknown) => {
    const doc = byId.get(String(id));
    return {
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(doc).then(resolve, reject),
      select: () => ({
        lean: () => Promise.resolve(doc ? { state: doc.state, hwItemId: doc.hwItemId } : null),
      }),
    };
  });
}

beforeEach(() => jest.clearAllMocks());

describe("submitPass — submitted:true fast-forward", () => {
  test("GIVEN → DUE → SUBMITTED with ONE shared timestamp (undo-group)", async () => {
    const r = rec({ state: "GIVEN" });
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: true }], ACTOR);
    expect(r.state).toBe("SUBMITTED");
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED"]);
    const stamps = r.stateDates.map((s) => new Date(s.at).getTime());
    expect(new Set(stamps).size).toBe(1); // one action for popActionGroup
    expect(res).toEqual({ submittedCount: 1, chasedCount: 0, unchangedCount: 0 });
  });

  test("CHASE → SUBMITTED keeps chaseCount, sends no reminder", async () => {
    const r = rec({ state: "CHASE", chaseCount: 1 });
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: true }], ACTOR);
    expect(r.state).toBe("SUBMITTED");
    expect(r.chaseCount).toBe(1);
    expect(mockEmitChase).not.toHaveBeenCalled();
    expect(res.submittedCount).toBe(1);
  });
});

describe("submitPass — the first-cross-only chase rule (§3.1)", () => {
  test("GIVEN crossed → CHASE, chaseCount 0→1, guardian reminder once", async () => {
    const r = rec({ state: "GIVEN" });
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: false }], ACTOR);
    expect(r.state).toBe("CHASE");
    expect(r.chaseCount).toBe(1);
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "CHASE"]);
    expect(mockEmitChase).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ submittedCount: 0, chasedCount: 1, unchangedCount: 0 });
  });

  test("already-CHASE crossed again → NO-OP (no stamp, no increment, no reminder)", async () => {
    const r = rec({ state: "CHASE", chaseCount: 1 });
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: false }], ACTOR);
    expect(r.state).toBe("CHASE");
    expect(r.chaseCount).toBe(1);
    expect(r.stateDates).toEqual([]);
    expect(r.save).not.toHaveBeenCalled();
    expect(mockEmitChase).not.toHaveBeenCalled();
    expect(res).toEqual({ submittedCount: 0, chasedCount: 0, unchangedCount: 1 });
  });
});

describe("submitPass — the owner's worked example (mixed roster)", () => {
  test("2 submit, 1 first-cross, 1 already-chased re-cross", async () => {
    const a = rec({ state: "GIVEN" });
    const b = rec({ state: "DUE" });
    const c = rec({ state: "DUE" }); // first cross → chase
    const d = rec({ state: "CHASE", chaseCount: 1 }); // re-cross → no-op
    stubDocs([a, b, c, d]);
    const res = await submitPass(
      ITEM_ID,
      [
        { recordId: a.recordId, submitted: true },
        { recordId: b.recordId, submitted: true },
        { recordId: c.recordId, submitted: false },
        { recordId: d.recordId, submitted: false },
      ],
      ACTOR,
    );
    expect(res).toEqual({ submittedCount: 2, chasedCount: 1, unchangedCount: 1 });
    expect(a.state).toBe("SUBMITTED");
    expect(b.state).toBe("SUBMITTED");
    expect(c.state).toBe("CHASE");
    expect(c.chaseCount).toBe(1);
    expect(d.chaseCount).toBe(1); // untouched
    expect(mockEmitChase).toHaveBeenCalledTimes(1); // only the first cross
  });
});

describe("submitPass — guards", () => {
  test("rejects a record not in GIVEN/DUE/CHASE", async () => {
    const r = rec({ state: "CHECKED" });
    stubDocs([r]);
    await expect(
      submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: true }], ACTOR),
    ).rejects.toThrow(/CHECKED/);
  });

  test("rejects a record belonging to another item", async () => {
    const r = rec({ state: "GIVEN", hwItemId: { toString: () => "other-item" } });
    stubDocs([r]);
    await expect(
      submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: true }], ACTOR),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("returnPass", () => {
  test("uncrossed CHECKED → RETURNED; crossed left alone", async () => {
    const a = rec({ state: "CHECKED", result: "CORRECT" });
    const b = rec({ state: "RESUBMIT" });
    const c = rec({ state: "CHECKED", result: "PARTIAL" }); // kept back
    stubDocs([a, b, c]);
    const res = await returnPass(
      ITEM_ID,
      [
        { recordId: a.recordId, returned: true },
        { recordId: b.recordId, returned: true },
        { recordId: c.recordId, returned: false },
      ],
      ACTOR,
    );
    expect(a.state).toBe("RETURNED");
    expect(b.state).toBe("RETURNED");
    expect(c.state).toBe("CHECKED");
    expect(c.save).not.toHaveBeenCalled();
    expect(res).toEqual({ returnedCount: 2, unchangedCount: 1 });
  });

  test("rejects returning a non-checked record", async () => {
    const r = rec({ state: "SUBMITTED" });
    stubDocs([r]);
    await expect(
      returnPass(ITEM_ID, [{ recordId: r.recordId, returned: true }], ACTOR),
    ).rejects.toThrow(/SUBMITTED/);
  });
});
