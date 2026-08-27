/**
 * BUG-WC-2 / BUG-WC-5 — who answers a claim.
 *
 * Both bugs came from copying `record.issuedBy` into `claim.teacherId`:
 *   WC-5: on assignments issuedBy is whoever ran the DELIVERY PASS, so a BGS
 *         claim was addressed to an English teacher (real prod case,
 *         AS-C3-BGS-0002 → Mahmudur Rahman Tazkir, who teaches ENG only).
 *   WC-2: on historical homework issuedBy is the null ObjectId, so 21 of 23
 *         claims named a user that does not exist.
 *
 * The recipient is now derived from the ROUTINE, falling back to the section's
 * own owners, and `null` when nobody is reachable so the caller can refuse.
 */
import mongoose from "mongoose";

const mockSlotFind = jest.fn();
const mockSectionById = jest.fn();
const mockUserFindOne = jest.fn();

jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSlotFind(q) }) }) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSectionById(id) }) }) },
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
const BGS_TEACHER = oid();
const ENG_TEACHER = oid();
const CONFIRMER = oid();
const CLASS_TEACHER = oid();

beforeEach(() => {
  jest.clearAllMocks();
  mockSlotFind.mockResolvedValue([]);
  mockSectionById.mockResolvedValue(null);
  // by default every id is an active user
  mockUserFindOne.mockImplementation(async (q: { _id: unknown }) => ({ _id: q._id }));
});

describe("resolveClaimRecipient — the routine decides, not issuedBy", () => {
  test("the SUBJECT teacher from the routine wins over the issuer (BUG-WC-5)", async () => {
    mockSlotFind.mockResolvedValue([{ teacherId: BGS_TEACHER }, { teacherId: BGS_TEACHER }]);
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
    expect(r!.source).toBe("ROUTINE");
  });

  test("the teacher with the MOST periods wins when several teach it", async () => {
    const occasional = oid();
    mockSlotFind.mockResolvedValue([
      { teacherId: occasional },
      { teacherId: BGS_TEACHER },
      { teacherId: BGS_TEACHER },
      { teacherId: BGS_TEACHER },
    ]);
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
  });

  test("an INACTIVE routine teacher is skipped for the next one", async () => {
    const gone = oid();
    mockSlotFind.mockResolvedValue([
      { teacherId: gone }, { teacherId: gone }, { teacherId: BGS_TEACHER },
    ]);
    mockUserFindOne.mockImplementation(async (q: { _id: { toString(): string } }) =>
      q._id.toString() === gone.toString() ? null : { _id: q._id },
    );
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(BGS_TEACHER.toString());
  });

  test("no routine → the section's homework confirmer", async () => {
    mockSectionById.mockResolvedValue({ homeworkConfirmerId: CONFIRMER, classTeacherId: CLASS_TEACHER });
    const r = await resolveClaimRecipient(SECTION, "BGS", null);
    expect(r!.teacherId.toString()).toBe(CONFIRMER.toString());
    expect(r!.source).toBe("CONFIRMER");
  });

  test("no routine and no confirmer → the class teacher", async () => {
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
    const r = await resolveClaimRecipient(SECTION, "BGS", new mongoose.Types.ObjectId(NULL_OBJECT_ID));
    expect(r).toBeNull();
    // and it was never even looked up
    const asked = mockUserFindOne.mock.calls.map((c) => String((c[0] as { _id: unknown })._id));
    expect(asked).not.toContain(NULL_OBJECT_ID);
  });

  test("nobody reachable → null, so the caller refuses instead of filing into the void", async () => {
    mockUserFindOne.mockResolvedValue(null);
    const r = await resolveClaimRecipient(SECTION, "BGS", ENG_TEACHER);
    expect(r).toBeNull();
  });
});
