/**
 * RP-3 tests — AssignmentRosterPassService (submit/return passes + outcome, D-#356).
 *
 * Real lifecycle.ts + AssignmentService.transitionAssignmentRecord +
 * AssignmentCheckingService.checkAssignmentRecord run; only the Mongoose models are
 * mocked (DB-free), mirroring homeworkRosterPass.test.ts. Focus: first-cross-only
 * chase, chase-BEFORE-due (G7), the owner's 20/15/5 example, and no auto-spawn.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockItemFindById = jest.fn();

// GC-2: the submit edge now closes any open guardian claim, and the chase edge
// asks whether one is open. This suite is DB-free, so the claim model is stubbed
// EMPTY — without it every transition would buffer against a dead connection.
jest.mock("../modules/trackers/models/GuardianWorkClaim", () => ({
  GuardianWorkClaim: {
    find: () => Promise.resolve([]),
    exists: () => Promise.resolve(null),
  },
}));
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
  },
}));
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { findById: (id: unknown) => ({ lean: () => mockItemFindById(id) }) },
}));

import {
  submitPass,
  returnPass,
  recordAssignmentOutcome,
} from "../modules/trackers/services/AssignmentRosterPassService";

const ACTOR = new mongoose.Types.ObjectId().toString();
const ITEM_ID = new mongoose.Types.ObjectId().toString();

function rec(over: Record<string, unknown> = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    recordId: id.toString(),
    asId: "AS-C1-MATH-0001",
    asItemId: { toString: () => ITEM_ID },
    studentId: new mongoose.Types.ObjectId(),
    sectionId: new mongoose.Types.ObjectId(),
    classId: new mongoose.Types.ObjectId(),
    state: "GIVEN",
    chaseCount: 0,
    dueDate: null as Date | null,
    stateDates: [] as Array<{ state: string; at: Date }>,
    result: undefined as string | undefined,
    marks: undefined as number | undefined,
    feedback: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

/** findById supports a bare await (real doc, for transition/check) AND a
 *  `.select().lean()` chain (the pass's own state peek). */
function stubDocs(docs: ReturnType<typeof rec>[]) {
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  mockRecFindById.mockImplementation((id: unknown) => {
    const doc = byId.get(String(id));
    return {
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(doc).then(resolve, reject),
      select: () => ({
        lean: () => Promise.resolve(doc ? { state: doc.state, asItemId: doc.asItemId } : null),
      }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockItemFindById.mockResolvedValue({ totalMarks: 20 });
});

describe("submitPass — first-cross-only + chase-before-due (G7)", () => {
  test("DUE crossed BEFORE due date → CHASE, count 0→1", async () => {
    const r = rec({ state: "DUE" }); // no pastDue notion — chase on cross
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: false }], ACTOR);
    expect(r.state).toBe("CHASE");
    expect(r.chaseCount).toBe(1);
    expect(res).toEqual({ submittedCount: 0, chasedCount: 1, unchangedCount: 0 });
  });

  test("already-CHASE crossed again → NO-OP", async () => {
    const r = rec({ state: "CHASE", chaseCount: 1 });
    stubDocs([r]);
    const res = await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: false }], ACTOR);
    expect(r.chaseCount).toBe(1);
    expect(r.stateDates).toEqual([]);
    expect(r.save).not.toHaveBeenCalled();
    expect(res).toEqual({ submittedCount: 0, chasedCount: 0, unchangedCount: 1 });
  });

  test("GIVEN submit → DUE→SUBMITTED with one timestamp", async () => {
    const r = rec({ state: "GIVEN" });
    stubDocs([r]);
    await submitPass(ITEM_ID, [{ recordId: r.recordId, submitted: true }], ACTOR);
    expect(r.state).toBe("SUBMITTED");
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED"]);
    expect(new Set(r.stateDates.map((s) => new Date(s.at).getTime())).size).toBe(1);
  });
});

describe("submitPass — the owner's worked example (20 delivered)", () => {
  test("15 submit, 3 present-not-submitted, 2 absent-that-day → 15 submitted, 5 chase", async () => {
    const submit = Array.from({ length: 15 }, () => rec({ state: "DUE" }));
    const notSubmitted = Array.from({ length: 3 }, () => rec({ state: "DUE" }));
    const absentToday = Array.from({ length: 2 }, () => rec({ state: "DUE" })); // held since Thursday
    const all = [...submit, ...notSubmitted, ...absentToday];
    stubDocs(all);
    const res = await submitPass(
      ITEM_ID,
      [
        ...submit.map((r) => ({ recordId: r.recordId, submitted: true })),
        ...notSubmitted.map((r) => ({ recordId: r.recordId, submitted: false })),
        ...absentToday.map((r) => ({ recordId: r.recordId, submitted: false })),
      ],
      ACTOR,
    );
    expect(res).toEqual({ submittedCount: 15, chasedCount: 5, unchangedCount: 0 });
    expect([...notSubmitted, ...absentToday].every((r) => r.state === "CHASE" && r.chaseCount === 1)).toBe(true);
  });

  test("re-run: 4 of the 5 submit (no re-chase), 5th re-crossed (no-op)", async () => {
    const submitLater = Array.from({ length: 4 }, () => rec({ state: "CHASE", chaseCount: 1 }));
    const stillMissing = rec({ state: "CHASE", chaseCount: 1 });
    stubDocs([...submitLater, stillMissing]);
    const res = await submitPass(
      ITEM_ID,
      [
        ...submitLater.map((r) => ({ recordId: r.recordId, submitted: true })),
        { recordId: stillMissing.recordId, submitted: false },
      ],
      ACTOR,
    );
    expect(res).toEqual({ submittedCount: 4, chasedCount: 0, unchangedCount: 1 });
    expect(submitLater.every((r) => r.state === "SUBMITTED" && r.chaseCount === 1)).toBe(true);
    expect(stillMissing.chaseCount).toBe(1); // untouched — manual তাগাদা escalates
  });
});

describe("recordAssignmentOutcome — marks + feedback, NO auto-spawn (D-#87)", () => {
  test("SUBMITTED + WRONG → CHECKED, no resubmission spawned", async () => {
    const r = rec({ state: "SUBMITTED" });
    stubDocs([r]);
    const res = await recordAssignmentOutcome({ recordId: r.recordId, result: "WRONG", marks: 5, actorId: ACTOR });
    expect(r.state).toBe("CHECKED");
    expect(r.result).toBe("WRONG");
    expect(r.marks).toBe(5);
    expect(res.state).toBe("CHECKED");
    // No second record is created — checkAssignmentRecord never spawns (D-#87).
  });

  test("GIVEN + CORRECT → fast-forwards DUE→SUBMITTED→CHECKED", async () => {
    const r = rec({ state: "GIVEN" });
    stubDocs([r]);
    await recordAssignmentOutcome({ recordId: r.recordId, result: "CORRECT", actorId: ACTOR });
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "SUBMITTED", "CHECKED"]);
    expect(r.state).toBe("CHECKED");
  });

  test("marks over totalMarks rejected", async () => {
    const r = rec({ state: "SUBMITTED" });
    stubDocs([r]);
    await expect(
      recordAssignmentOutcome({ recordId: r.recordId, result: "CORRECT", marks: 21, actorId: ACTOR }),
    ).rejects.toThrow(/exceed/);
  });

  test("non-actionable state rejected", async () => {
    const r = rec({ state: "RETURNED" });
    stubDocs([r]);
    await expect(
      recordAssignmentOutcome({ recordId: r.recordId, result: "CORRECT", actorId: ACTOR }),
    ).rejects.toThrow(/RETURNED/);
  });
});

describe("returnPass", () => {
  test("uncrossed CHECKED → RETURNED; crossed kept", async () => {
    const a = rec({ state: "CHECKED", result: "CORRECT" });
    const b = rec({ state: "CHECKED", result: "PARTIAL" });
    stubDocs([a, b]);
    const res = await returnPass(
      ITEM_ID,
      [
        { recordId: a.recordId, returned: true },
        { recordId: b.recordId, returned: false },
      ],
      ACTOR,
    );
    expect(a.state).toBe("RETURNED");
    expect(b.state).toBe("CHECKED");
    expect(res).toEqual({ returnedCount: 1, unchangedCount: 1 });
  });
});
