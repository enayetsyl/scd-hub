/**
 * HomeworkChaseSweepService tests — the end-of-due-day SYSTEM chase (owner
 * ruling 2026-08-04): records still GIVEN/DUE with chaseCount 0 whose due day
 * arrived (3-day lookback) get exactly one system chase, stamped with NO `by`.
 *
 * Real transitionRecord runs (the one chase truth — chaseCount bump + guardian
 * emit); only the model + emitters are mocked, the homeworkRosterPass.test.ts
 * convention.
 */
import mongoose from "mongoose";

const mockRecFindById = jest.fn();
const mockRecFind = jest.fn();
const mockEmitChase = jest.fn().mockResolvedValue(undefined);
const mockEmitParentComms = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: {
    findById: (id: unknown) => mockRecFindById(id),
    find: (filter: unknown) => mockRecFind(filter),
  },
}));
jest.mock("../modules/notifications/services/emitters", () => ({
  emitHwGuardianChase: (...a: unknown[]) => mockEmitChase(...a),
  emitHwParentComms: (...a: unknown[]) => mockEmitParentComms(...a),
}));

import {
  sweepHomeworkAutoChase,
  HW_AUTO_CHASE_MINUTES,
  HW_AUTO_CHASE_LOOKBACK_DAYS,
} from "../modules/trackers/services/HomeworkChaseSweepService";

const NOW = new Date(2026, 7, 4, 17, 30); // Tue 04 Aug 2026 17:30 local

function rec(over: Record<string, unknown> = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    hwId: "HW-C1-MATH-0001",
    hwItemId: new mongoose.Types.ObjectId(),
    studentId: new mongoose.Types.ObjectId(),
    sectionId: new mongoose.Types.ObjectId(),
    classId: new mongoose.Types.ObjectId(),
    state: "DUE",
    chaseCount: 0,
    dueDate: new Date(2026, 7, 4, 9, 0) as Date | null,
    stateDates: [] as Array<{ state: string; at: Date; by?: unknown }>,
    result: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(true),
    ...over,
  };
}

/** Wire both mocks over a doc set: `find` applies the sweep's filter semantics
 *  (state $in, chaseCount 0, dueDate range); `findById` hands transitionRecord
 *  the live doc. */
function stub(docs: ReturnType<typeof rec>[]) {
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  mockRecFindById.mockImplementation((id: unknown) => Promise.resolve(byId.get(String(id))));
  mockRecFind.mockImplementation((filter: unknown) => ({
    select: () => ({
      lean: () => {
        const f = filter as {
          state?: { $in?: string[] };
          chaseCount?: number;
          dueDate?: { $gte?: Date; $lt?: Date };
        };
        const states = f.state?.$in ?? [];
        const out = docs
          .filter(
            (d) =>
              states.includes(d.state) &&
              d.chaseCount === 0 &&
              d.dueDate != null &&
              (!f.dueDate?.$gte || (d.dueDate as Date) >= f.dueDate.$gte) &&
              (!f.dueDate?.$lt || (d.dueDate as Date) < f.dueDate.$lt),
          )
          .map((d) => ({ _id: d._id, state: d.state, dueDate: d.dueDate }));
        return Promise.resolve(out);
      },
    }),
  }));
}

beforeEach(() => jest.clearAllMocks());

describe("sweepHomeworkAutoChase", () => {
  test("a DUE record due today gets ONE system chase — no `by` on the stamp, guardian notified", async () => {
    const r = rec();
    stub([r]);
    const n = await sweepHomeworkAutoChase(NOW);
    expect(n).toBe(1);
    expect(r.state).toBe("CHASE");
    expect(r.chaseCount).toBe(1);
    expect(r.stateDates).toHaveLength(1);
    expect(r.stateDates[0].by).toBeUndefined(); // system stamp — D-#338 write-scope undo
    expect(mockEmitChase).toHaveBeenCalledTimes(1);
  });

  test("a GIVEN record (missed morning sweep) fast-forwards GIVEN → DUE → CHASE, both stamps by-less", async () => {
    const r = rec({ state: "GIVEN" });
    stub([r]);
    const n = await sweepHomeworkAutoChase(NOW);
    expect(n).toBe(1);
    expect(r.state).toBe("CHASE");
    expect(r.stateDates.map((s) => s.state)).toEqual(["DUE", "CHASE"]);
    expect(r.stateDates.every((s) => s.by === undefined)).toBe(true);
  });

  test("idempotent: a re-run finds nothing (chaseCount left the filter)", async () => {
    const r = rec();
    stub([r]);
    await sweepHomeworkAutoChase(NOW);
    const n2 = await sweepHomeworkAutoChase(NOW);
    expect(n2).toBe(0);
    expect(r.chaseCount).toBe(1);
    expect(mockEmitChase).toHaveBeenCalledTimes(1);
  });

  test("lookback floor: a record whose due day is OLDER than the lookback is left alone", async () => {
    const stale = new Date(NOW);
    stale.setDate(stale.getDate() - (HW_AUTO_CHASE_LOOKBACK_DAYS + 2));
    const r = rec({ dueDate: stale });
    stub([r]);
    const n = await sweepHomeworkAutoChase(NOW);
    expect(n).toBe(0);
    expect(r.state).toBe("DUE");
  });

  test("a record due TOMORROW is not swept", async () => {
    const tomorrow = new Date(NOW);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const r = rec({ state: "GIVEN", dueDate: tomorrow });
    stub([r]);
    const n = await sweepHomeworkAutoChase(NOW);
    expect(n).toBe(0);
    expect(r.state).toBe("GIVEN");
  });

  test("CHASE / SUBMITTED / ABSENT_REDELIVER records are never touched", async () => {
    const chased = rec({ state: "CHASE", chaseCount: 1 });
    const submitted = rec({ state: "SUBMITTED" });
    const absent = rec({ state: "ABSENT_REDELIVER", dueDate: null });
    stub([chased, submitted, absent]);
    const n = await sweepHomeworkAutoChase(NOW);
    expect(n).toBe(0);
    expect(mockEmitChase).not.toHaveBeenCalled();
  });

  test("the rung fires after the auto-issue window closes (17:30)", () => {
    expect(HW_AUTO_CHASE_MINUTES).toBe(17 * 60 + 30);
  });
});
