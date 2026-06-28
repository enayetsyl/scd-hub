/**
 * Class-teacher designation tests (handoff §9 / D-#42).
 *
 * The class teacher is the ONLY role that may reconcile/confirm homework. These
 * cover the pure predicate + the assertIsClassTeacher guard (Section mocked).
 */
import mongoose from "mongoose";

const mockSectionFindById = jest.fn();
const mockUserFindById = jest.fn();

jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ lean: () => mockSectionFindById(id) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }) },
}));

import { isClassTeacher, assertIsClassTeacher, assertCanConfirmHomework, ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

const CT_ID = new mongoose.Types.ObjectId();
const OTHER_ID = new mongoose.Types.ObjectId().toString();
const SECTION_ID = new mongoose.Types.ObjectId().toString();

function ctx(userId: string, role = "TEACHER"): AppContext {
  return { auth: { userId, role } } as unknown as AppContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindById.mockResolvedValue({ homeworkSupervisor: false }); // not a supervisor by default
});

describe("isClassTeacher (pure predicate)", () => {
  test("true only when the ids match", () => {
    expect(isClassTeacher("u1", "u1")).toBe(true);
    expect(isClassTeacher("u1", "u2")).toBe(false);
    expect(isClassTeacher(null, "u1")).toBe(false);
    expect(isClassTeacher(undefined, "u1")).toBe(false);
  });
});

describe("assertIsClassTeacher (handoff §9 / D-#42)", () => {
  test("passes for the assigned class teacher", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID });
    await expect(assertIsClassTeacher(ctx(CT_ID.toString()), SECTION_ID)).resolves.toBeUndefined();
  });

  test("denies a different teacher (even with write-scope)", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID });
    await expect(assertIsClassTeacher(ctx(OTHER_ID), SECTION_ID)).rejects.toThrow(ForbiddenError);
  });

  test("denies when no class teacher is assigned", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: undefined });
    await expect(assertIsClassTeacher(ctx(CT_ID.toString()), SECTION_ID)).rejects.toThrow(
      /class teacher/,
    );
  });

  test("denies a Principal who is not the class teacher (daily-coordinator is specific)", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID });
    await expect(assertIsClassTeacher(ctx(OTHER_ID, "PRINCIPAL"), SECTION_ID)).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("throws when the section is not found", async () => {
    mockSectionFindById.mockResolvedValue(null);
    await expect(assertIsClassTeacher(ctx(CT_ID.toString()), SECTION_ID)).rejects.toThrow(
      /Section not found/,
    );
  });

  test("throws when unauthenticated", async () => {
    await expect(
      assertIsClassTeacher({ auth: undefined } as unknown as AppContext, SECTION_ID),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

describe("assertCanConfirmHomework (Principal / class teacher / delegate)", () => {
  const DELEGATE_ID = new mongoose.Types.ObjectId();

  test("passes for the assigned class teacher", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID });
    await expect(assertCanConfirmHomework(ctx(CT_ID.toString()), SECTION_ID)).resolves.toBeUndefined();
  });

  test("passes for the Principal of ANY section (no section read needed)", async () => {
    await expect(assertCanConfirmHomework(ctx(OTHER_ID, "PRINCIPAL"), SECTION_ID)).resolves.toBeUndefined();
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });

  test("passes for the assigned homework-confirm delegate", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID, homeworkConfirmerId: DELEGATE_ID });
    await expect(assertCanConfirmHomework(ctx(DELEGATE_ID.toString()), SECTION_ID)).resolves.toBeUndefined();
  });

  test("passes for a school-wide homework supervisor (any section)", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID, homeworkConfirmerId: DELEGATE_ID });
    mockUserFindById.mockResolvedValue({ homeworkSupervisor: true });
    await expect(assertCanConfirmHomework(ctx(OTHER_ID), SECTION_ID)).resolves.toBeUndefined();
  });

  test("denies a teacher who is neither class teacher, delegate, nor supervisor", async () => {
    mockSectionFindById.mockResolvedValue({ _id: SECTION_ID, classTeacherId: CT_ID, homeworkConfirmerId: DELEGATE_ID });
    mockUserFindById.mockResolvedValue({ homeworkSupervisor: false });
    await expect(assertCanConfirmHomework(ctx(OTHER_ID), SECTION_ID)).rejects.toThrow(ForbiddenError);
  });

  test("throws when unauthenticated", async () => {
    await expect(
      assertCanConfirmHomework({ auth: undefined } as unknown as AppContext, SECTION_ID),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
