/**
 * GH-3: a throwing homework-integrity recompute must not break (or even delay) a class-test confirm.
 * afterEvidence is the tail of confirmPaper / saveResults; the recompute is fire-and-forget and CT-only. DB-free.
 */
const recompute = jest.fn();
jest.mock("../modules/homework-integrity/services/IntegrityService", () => ({ recomputeForPaper: (...a: unknown[]) => recompute(...a) }));
jest.mock("../modules/mastery/services/MasteryActionService", () => ({ evaluateSectionTriggers: jest.fn(async () => undefined) }));

import { Types } from "mongoose";
import { afterEvidence } from "../modules/mastery/services/MasteryWorkService";

const paper = (source: string) => ({ source, paperId: "P", _id: new Types.ObjectId(), sectionId: new Types.ObjectId(), subject: "MATH", academicYearId: new Types.ObjectId() });
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("afterEvidence -> homework-integrity", () => {
  beforeEach(() => recompute.mockReset());
  it("a throwing recompute is logged and the confirm still succeeds", async () => {
    recompute.mockRejectedValue(new Error("boom"));
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(afterEvidence(paper("CT") as never)).resolves.toBeUndefined();
    await flush();
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("a slow recompute does not hold the save", async () => {
    recompute.mockReturnValue(new Promise(() => undefined)); // never resolves
    await expect(afterEvidence(paper("CT") as never)).resolves.toBeUndefined();
  });
  it("homework papers do not trigger it", async () => {
    await afterEvidence(paper("HW") as never);
    await flush();
    expect(recompute).not.toHaveBeenCalled();
  });
});
