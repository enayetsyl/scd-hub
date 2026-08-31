/**
 * BUG-WC-2 / WC-5 / WC-7 — who answers a claim.
 *
 * WC-5: on assignments `issuedBy` is whoever ran the DELIVERY PASS, so a BGS claim
 *       reached an English teacher (real prod case, AS-C3-BGS-0002).
 * WC-2: on historical homework `issuedBy` is the null ObjectId, so 21 of 23 claims
 *       named a user that does not exist.
 * WC-7: the ROUTINE is not the same thing as the right to write. On prod
 *       2026-08-30 a teacher held 5 MATH routine slots for C1 and no teaching
 *       grant: every claim reached him, and he could not open a single one.
 *
 * So the chain is GRANT -> ROUTINE (only where grants cannot answer: ARABIC/QURAN
 * have no Subject row) -> the section's owners -> the issuer -> null.
 */
import mongoose from "mongoose";

const mockSlotFind = jest.fn();
const mockSectionById = jest.fn();
const mockUserFindOne = jest.fn();
const mockSubjectFindOne = jest.fn();
const mockGrantFind = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSlotFind(q) }) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSectionById(id) }) }) },
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockSubjectFindOne(q) }) }) },
}));
jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: { find: (q: unknown) => ({ select: () => ({ lean: () => mockGrantFind(q) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findOne: (q: unknown) => ({ select: () => ({ lean: () => mockUserFindOne(q) }) }) },
}));

import {
  resolveClaimRecipient,
  NULL_OBJECT_ID,
} from "../modules/trackers/services/ClaimRecipient";

const oid = () => new mongoose.Types.ObjectId();
const SECTION = oid();
const SUBJECT_ROW = oid();
const BGS_TEACHER = oid();
const ENG_TEACHER = oid();
const CONFIRMER = oid();
const CLASS_TEACHER = oid();

/** Give these teachers the teaching grant, honouring any `$in` narrowing. */
const grantedTo = (...ids: mongoose.Types.ObjectId[]) =>
  mockGrantFind.mockImplementation(
    async (q: { teacherId?: { $in?: mongoose.Types.ObjectId[] } }) => {
      const rows = ids.map((teacherId) => ({ teacherId }));
      const only = q?.teacherId?.$in?.map(String);
      return only ? rows.filter((r) => only.includes(String(r.teacherId))) : rows;
    },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]);
  mockSectionById.mockResolvedValue(null);
  // The subject exists (so grants are authoritative) and nobody holds one.
  mockSubjectFindOne.mockResolvedValue({ _id: SUBJECT_ROW });
  mockGrantFind.mockResolvedValue([]);
  // by default every id is an active user
  mockUserFindOne.mockImplementation(async (q: { _id: unknown }) => ({ _id: q._id }));
});

describe("resolveClaimRecipient — the grant decides, not issuedBy and not the routine", () => {
  test("the SUBJECT teacher wins over the issuer (BUG-WC-5)", async () => {
    grantedTo(BGS_TEACHER);
    mockSlotFind.mockResolvedValue([{ teacherId: BGS_TEACHER }, { teacherId: BGS_TEACHER }]);
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("GRANT");
  });

  test("a routine teacher WITHOUT the grant is never chosen while a holder exists (BUG-WC-7)", async () => {
    const routineOnly = oid(); // 5 MATH slots, no grant — the prod case
    grantedTo(BGS_TEACHER);
    mockSlotFind.mockResolvedValue([
      { teacherId: routineOnly },
      { teacherId: routineOnly },
      { teacherId: routineOnly },
    ]);
    const r = await resolveClaimRecipient(SECTION, "MATH", null);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("GRANT");
  });

  test("among several grant holders, the one the routine names most wins", async () => {
    const occasional = oid();
    grantedTo(occasional, BGS_TEACHER);
    mockSlotFind.mockResolvedValue([
      { teacherId: occasional },
      { teacherId: BGS_TEACHER },
      { teacherId: BGS_TEACHER },
    ]);
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("GRANT");
  });

  test("a grant holder the routine never names is still chosen (the timetable may lag)", async () => {
    grantedTo(BGS_TEACHER);
    mockSlotFind.mockResolvedValue([]);
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("GRANT");
  });

  test("an INACTIVE grant holder is skipped for the next one", async () => {
    const gone = oid();
    grantedTo(gone, BGS_TEACHER);
    mockSlotFind.mockResolvedValue([{ teacherId: gone }, { teacherId: gone }]);
    mockUserFindOne.mockImplementation(async (q: { _id: { toString(): string } }) =>
      q._id.toString() === gone.toString() ? null : { _id: q._id },
    );
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
  });

  test("no Subject row (ARABIC/QURAN) → grants cannot answer, so the ROUTINE does", async () => {
    mockSubjectFindOne.mockResolvedValue(null);
    mockSlotFind.mockResolvedValue([{ teacherId: BGS_TEACHER }, { teacherId: BGS_TEACHER }]);
    const r = await resolveClaimRecipient(SECTION, "QURAN", ENG_TEACHER);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("ROUTINE");
    // and the grant table was never consulted for a subject it cannot describe
    expect(mockGrantFind).not.toHaveBeenCalled();
  });

  test("nobody holds the grant → the section's homework confirmer, NOT the routine", async () => {
    const routineOnly = oid();
    mockSlotFind.mockResolvedValue([{ teacherId: routineOnly }, { teacherId: routineOnly }]);
    mockSectionById.mockResolvedValue({
      homeworkConfirmerId: CONFIRMER,
      classTeacherId: CLASS_TEACHER,
    });
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(CONFIRMER.toString());
    expect(r!.source).toBe("CONFIRMER");
  });

  test("no grant and no confirmer → the class teacher", async () => {
    mockSectionById.mockResolvedValue({ classTeacherId: CLASS_TEACHER });
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(CLASS_TEACHER.toString());
    expect(r!.source).toBe("CLASS_TEACHER");
  });

  test("the ISSUER is the last resort, and only when they are real", async () => {
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r!.teacherId.toString()).toBe(ENG_TEACHER.toString());
    expect(r!.source).toBe("ISSUER");
  });

  test("the null ObjectId is NEVER a recipient (BUG-WC-2)", async () => {
    const r = await resolveClaimRecipient(
      SECTION,
      "BGS",
      new mongoose.Types.ObjectId(NULL_OBJECT_ID),
    );
    expect(r).toBeNull();
    const asked = mockUserFindOne.mock.calls.map((c) => String((c[0] as { _id: unknown })._id));
    expect(asked).not.toContain(NULL_OBJECT_ID);
  });

  test("nobody reachable → null, so the caller refuses instead of filing into the void", async () => {
    mockUserFindOne.mockResolvedValue(null);
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r).toBeNull();
  });
});
