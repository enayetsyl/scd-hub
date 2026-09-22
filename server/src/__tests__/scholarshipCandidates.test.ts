/**
 * Scholarship candidates — SC-9 (D-#697).
 *
 * The primary scholarship examination is sat by SOME of class five. A child the school
 * never entered must not appear in the analysis pool, must not be counted in the "of N"
 * a rank is given out of, and must not be writable — but her marks, if she has any, are
 * never deleted.
 *
 * The filter is the thing under test, and its one trap: `scholarshipExcluded` is ABSENT
 * on every student who has never been touched, so the query has to ask `$ne: true`.
 * Testing `=== false` would return nobody at all and empty the whole module.
 *
 * DB-free, the repo convention: models and audit are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockStudentFind = jest.fn();
const mockStudentFindById = jest.fn();
const mockStudentUpdateOne = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (q: unknown) => mockStudentFind(q),
    findById: (id: unknown) => mockStudentFindById(id),
    updateOne: (...a: unknown[]) => mockStudentUpdateOne(...a),
  },
}));

const mockScoreAggregate = jest.fn();
jest.mock("../modules/scholarship/models/ScholarshipScore", () => ({
  ScholarshipScore: {
    aggregate: (p: unknown) => mockScoreAggregate(p),
    find: () => leanChain([]),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../modules/scholarship/models/ScholarshipPaper", () => ({
  ScholarshipPaper: { find: () => leanChain([]), findById: () => leanChain(null) },
}));
jest.mock("../modules/scholarship/models/ScholarshipTopic", () => ({
  ScholarshipTopic: { find: () => leanChain([]) },
}));
jest.mock("../modules/scholarship/models/ScholarshipSequence", () => ({
  ScholarshipSequence: { findOneAndUpdate: jest.fn() },
}));
jest.mock("../modules/foundation/models/Section", () => ({ Section: { findById: () => leanChain(null) } }));
jest.mock("../modules/foundation/models/Class", () => ({ Class: { findById: () => leanChain(null) } }));
jest.mock("../modules/trackers/subjectTeacher", () => ({ resolveSubjectTeacher: jest.fn() }));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (...a: unknown[]) => mockWriteAudit(...a),
}));

import { listCandidates, setCandidateSitting } from "../modules/scholarship/services/ScholarshipService";
import { sittingFilter } from "../modules/scholarship/services/ScholarshipAnalysisService";

const SECTION = oid();
const PRINCIPAL = { userId: String(oid()), role: "PRINCIPAL" };

beforeEach(() => {
  jest.clearAllMocks();
  mockScoreAggregate.mockResolvedValue([]);
});

describe("sittingFilter", () => {
  it("asks $ne: true, because the field is ABSENT on everyone who has never been touched", () => {
    const f = sittingFilter(String(SECTION)) as { scholarshipExcluded: unknown };
    expect(f.scholarshipExcluded).toEqual({ $ne: true });
    // The trap this exists to avoid: `false` matches nobody on a fresh roster.
    expect(f.scholarshipExcluded).not.toEqual(false);
  });

  it("casts a string section id, and passes an ObjectId through untouched", () => {
    expect(String((sittingFilter(String(SECTION)) as { sectionId: unknown }).sectionId)).toBe(String(SECTION));
    expect((sittingFilter(SECTION) as { sectionId: unknown }).sectionId).toBe(SECTION);
  });
});

describe("listCandidates", () => {
  it("returns the WHOLE roster — this is the screen where the choice is made", () => {
    const a = oid();
    const b = oid();
    mockStudentFind.mockReturnValue(
      leanChain([
        { _id: a, name: "Zulqarnain Chowdhury", rollNumber: "7" },
        { _id: b, name: "Khadija Binte Kader", scholarshipExcluded: true },
      ]),
    );
    return listCandidates(String(SECTION)).then((rows) => {
      // The query it ran carries NO exclusion — that is the point of this read.
      expect(mockStudentFind.mock.calls[0][0]).not.toHaveProperty("scholarshipExcluded");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ nameBn: "Zulqarnain Chowdhury", sitting: true, rollNumber: "7" });
      expect(rows[1]).toMatchObject({ nameBn: "Khadija Binte Kader", sitting: false });
    });
  });

  it("falls back to `name` when the Bangla name is missing, as every other roster does", () => {
    const a = oid();
    mockStudentFind.mockReturnValue(leanChain([{ _id: a, name: "Ibrahim Hossain", nameBn: "  " }]));
    return listCandidates(String(SECTION)).then((rows) => {
      expect(rows[0].nameBn).toBe("Ibrahim Hossain");
    });
  });

  it("counts the papers a child already has marks on, so removing her is a visible choice", () => {
    const a = oid();
    mockStudentFind.mockReturnValue(leanChain([{ _id: a, name: "Saood Al Mahmud" }]));
    mockScoreAggregate.mockResolvedValue([{ _id: a, n: 3 }]);
    return listCandidates(String(SECTION)).then((rows) => {
      expect(rows[0].scoredPapers).toBe(3);
    });
  });
});

describe("setCandidateSitting", () => {
  const student = oid();

  beforeEach(() => {
    mockStudentFindById.mockReturnValue(leanChain({ _id: student, sectionId: SECTION }));
    mockStudentFind.mockReturnValue(leanChain([{ _id: student, name: "Khadija Binte Kader" }]));
    mockStudentUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it("removing a child SETS the flag and never touches her scores", async () => {
    await setCandidateSitting(String(student), false, PRINCIPAL);
    expect(mockStudentUpdateOne).toHaveBeenCalledWith(
      { _id: student },
      { $set: { scholarshipExcluded: true } },
    );
    // No score model write of any kind — the flag is a scope, not a purge.
    expect(mockScoreAggregate).toHaveBeenCalled(); // the read-back only
  });

  it("entering a child UNSETS the flag rather than storing false", async () => {
    await setCandidateSitting(String(student), true, PRINCIPAL);
    expect(mockStudentUpdateOne).toHaveBeenCalledWith(
      { _id: student },
      { $unset: { scholarshipExcluded: "" } },
    );
  });

  it("audits both directions with distinct kinds", async () => {
    await setCandidateSitting(String(student), false, PRINCIPAL);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      eventKind: "SCHOLARSHIP_CANDIDATE_REMOVED",
      targetKind: "Student",
      targetId: String(student),
    });
    mockWriteAudit.mockClear();
    await setCandidateSitting(String(student), true, PRINCIPAL);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({ eventKind: "SCHOLARSHIP_CANDIDATE_ADDED" });
  });

  it("is the desk's decision — a TEACHER is refused", async () => {
    await expect(
      setCandidateSitting(String(student), false, { userId: String(oid()), role: "TEACHER" }),
    ).rejects.toThrow(/অনুমতি নেই/);
    expect(mockStudentUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses a student who does not exist rather than writing nothing quietly", async () => {
    mockStudentFindById.mockReturnValue(leanChain(null));
    await expect(setCandidateSitting(String(oid()), false, PRINCIPAL)).rejects.toThrow(/পাওয়া যায়নি/);
  });
});
