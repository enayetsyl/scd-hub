/**
 * Section merge / split tests (D-#62). Pure helper `deriveGenderToSource` is
 * exercised directly; the service runs against mocked Mongoose models (DB-free,
 * like review.test.ts).
 */
import mongoose from "mongoose";

const mockSectionFind = jest.fn();
const mockSectionFindOne = jest.fn();
const mockSectionCreate = jest.fn();
const mockSectionUpdateMany = jest.fn().mockResolvedValue({});
const mockSectionUpdateOne = jest.fn().mockResolvedValue({});
const mockStudentFind = jest.fn();
const mockStudentUpdateMany = jest.fn().mockResolvedValue({});
const mockMergeFindOne = jest.fn();
const mockMergeCreate = jest.fn().mockResolvedValue({});
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);

jest.mock("../modules/foundation/models/Section", () => ({
  Section: {
    find: (f: unknown) => mockSectionFind(f),
    findOne: (f: unknown) => mockSectionFindOne(f),
    create: (d: unknown) => mockSectionCreate(d),
    updateMany: (f: unknown, u: unknown) => mockSectionUpdateMany(f, u),
    updateOne: (f: unknown, u: unknown) => mockSectionUpdateOne(f, u),
  },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: {
    find: (f: unknown) => mockStudentFind(f),
    updateMany: (f: unknown, u: unknown) => mockStudentUpdateMany(f, u),
  },
}));
jest.mock("../modules/foundation/models/SectionMerge", () => ({
  SectionMerge: {
    findOne: (f: unknown) => mockMergeFindOne(f),
    create: (d: unknown) => mockMergeCreate(d),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));

import {
  deriveGenderToSource,
  mergeSections,
  splitSections,
  SectionMergeError,
} from "../modules/foundation/services/SectionMergeService";

const CLASS = new mongoose.Types.ObjectId();
const BOYS = new mongoose.Types.ObjectId();
const GIRLS = new mongoose.Types.ObjectId();
const COMBINED = new mongoose.Types.ObjectId();
const ACTOR = new mongoose.Types.ObjectId();
const leanFind = (rows: unknown[]) => ({ select: () => ({ lean: () => Promise.resolve(rows) }), lean: () => Promise.resolve(rows) });

beforeEach(() => jest.clearAllMocks());

describe("deriveGenderToSource (pure)", () => {
  test("labels each source by its dominant gender and inverts to gender→section", () => {
    const moves = [
      { studentId: "a", fromSectionId: "boys" },
      { studentId: "b", fromSectionId: "boys" },
      { studentId: "c", fromSectionId: "girls" },
    ];
    const genderOf = new Map([
      ["a", "male"],
      ["b", "male"],
      ["c", "female"],
    ]);
    expect(deriveGenderToSource(moves, genderOf)).toEqual({ male: "boys", female: "girls" });
  });

  test("students with unknown gender are ignored", () => {
    const moves = [{ studentId: "a", fromSectionId: "boys" }];
    expect(deriveGenderToSource(moves, new Map())).toEqual({});
  });
});

describe("mergeSections", () => {
  test("moves students into a new combined section and deactivates the sources", async () => {
    mockMergeFindOne.mockResolvedValueOnce(null); // no active merge
    mockSectionFind.mockReturnValueOnce(leanFind([{ _id: BOYS }, { _id: GIRLS }]));
    mockSectionFindOne.mockResolvedValueOnce(null); // no prior combined
    mockSectionCreate.mockResolvedValueOnce({ _id: COMBINED });
    mockStudentFind.mockReturnValueOnce(
      leanFind([
        { _id: new mongoose.Types.ObjectId(), sectionId: BOYS },
        { _id: new mongoose.Types.ObjectId(), sectionId: GIRLS },
        { _id: new mongoose.Types.ObjectId(), sectionId: BOYS },
      ]),
    );

    const res = await mergeSections(CLASS.toString(), "সম্মিলিত", ACTOR.toString());

    expect(res.movedStudents).toBe(3);
    expect(res.combinedSectionId).toBe(COMBINED.toString());
    expect(mockStudentUpdateMany).toHaveBeenCalledWith(expect.anything(), { $set: { sectionId: COMBINED } });
    expect(mockSectionUpdateMany).toHaveBeenCalledWith(expect.anything(), { $set: { active: false } });
    expect(mockMergeCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "SECTIONS_MERGED" }));
  });

  test("rejects when the class is already merged", async () => {
    mockMergeFindOne.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    await expect(mergeSections(CLASS.toString(), null, ACTOR.toString())).rejects.toThrow(SectionMergeError);
  });

  test("rejects a class with fewer than two active sections", async () => {
    mockMergeFindOne.mockResolvedValueOnce(null);
    mockSectionFind.mockReturnValueOnce(leanFind([{ _id: BOYS }]));
    await expect(mergeSections(CLASS.toString(), null, ACTOR.toString())).rejects.toThrow(SectionMergeError);
  });
});

describe("splitSections", () => {
  test("restores originally-moved students and places a post-merge newcomer by gender", async () => {
    const boyA = new mongoose.Types.ObjectId();
    const girlB = new mongoose.Types.ObjectId();
    const newBoy = new mongoose.Types.ObjectId(); // enrolled after the merge → by gender
    const saved: Record<string, unknown> = {};
    mockMergeFindOne.mockResolvedValueOnce({
      classId: CLASS,
      combinedSectionId: COMBINED,
      sourceSectionIds: [BOYS, GIRLS],
      moves: [
        { studentId: boyA, fromSectionId: BOYS },
        { studentId: girlB, fromSectionId: GIRLS },
      ],
      status: "active",
      save: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        Object.assign(saved, this);
        return Promise.resolve(this);
      }),
    });
    mockStudentFind.mockReturnValueOnce(
      leanFind([
        { _id: boyA, gender: "male" },
        { _id: girlB, gender: "female" },
        { _id: newBoy, gender: "male" },
      ]),
    );

    const res = await splitSections(CLASS.toString(), ACTOR.toString());

    expect(res.movedStudents).toBe(3);
    expect(res.restoredSections).toBe(2);
    // sources reactivated, combined deactivated
    expect(mockSectionUpdateMany).toHaveBeenCalledWith(expect.anything(), { $set: { active: true } });
    expect(mockSectionUpdateOne).toHaveBeenCalledWith({ _id: COMBINED }, { $set: { active: false } });
    // the post-merge boy was routed to BOYS (gender match)
    const boysMove = mockStudentUpdateMany.mock.calls.find(
      (c) => (c[1] as { $set: { sectionId: mongoose.Types.ObjectId } }).$set.sectionId.toString() === BOYS.toString(),
    );
    expect(boysMove).toBeTruthy();
    const idsToBoys = (boysMove![0] as { _id: { $in: mongoose.Types.ObjectId[] } })._id.$in.map((i) => i.toString());
    expect(idsToBoys).toEqual(expect.arrayContaining([boyA.toString(), newBoy.toString()]));
    expect(saved.status).toBe("split");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "SECTIONS_SPLIT" }));
  });

  test("rejects when the class is not merged", async () => {
    mockMergeFindOne.mockResolvedValueOnce(null);
    await expect(splitSections(CLASS.toString(), ACTOR.toString())).rejects.toThrow(SectionMergeError);
  });
});
