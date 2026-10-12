/**
 * allowedSubjectCodesForSection — the read-side subject narrowing for tracker
 * lists (homework/assignment records). Prod finding 2026-07-13: a Science
 * teacher could see (and act on) English homework records because the list
 * queries were section-scoped only.
 *
 * DB-free: ScopeGrant / Section / User / Subject model chains are mocked.
 * `null` = unrestricted (all subjects); a Set = only those subject CODES.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const mockGrantFind = jest.fn();
const mockSectionFindById = jest.fn();
const mockUserFindById = jest.fn();
const mockSubjectFind = jest.fn();

jest.mock("../modules/foundation/models/ScopeGrant", () => ({
  ScopeGrant: {
    find: (q: unknown) => ({ lean: () => mockGrantFind(q) }),
    findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
  },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSectionFindById(id) }) }) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }) },
}));
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { find: (q: unknown) => ({ select: () => ({ lean: () => mockSubjectFind(q) }) }) },
}));

import { allowedSubjectCodesForSection, assertCanRead, ForbiddenError } from "../middleware/authz";

const TEACHER_ID = new mongoose.Types.ObjectId().toString();
const SECTION = "sec1";
const CLASS = "cls1";
const SUBJ_SCI_ID = new mongoose.Types.ObjectId().toString();
const SUBJ_ENG_ID = new mongoose.Types.ObjectId().toString();

function ctxOf(role: string, userId = TEACHER_ID): AppContext {
  return { req: {} as never, res: {} as never, auth: { userId, role } } as AppContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrantFind.mockResolvedValue([]);
  mockSectionFindById.mockResolvedValue(null);
  mockUserFindById.mockResolvedValue(null);
  mockSubjectFind.mockResolvedValue([]);
});

describe("allowedSubjectCodesForSection", () => {
  test("PRINCIPAL and OFFICE are unrestricted (null)", async () => {
    await expect(allowedSubjectCodesForSection(ctxOf("PRINCIPAL"), SECTION, CLASS)).resolves.toBeNull();
    await expect(allowedSubjectCodesForSection(ctxOf("OFFICE"), SECTION, CLASS)).resolves.toBeNull();
  });

  test("GUARDIAN is denied", async () => {
    await expect(allowedSubjectCodesForSection(ctxOf("GUARDIAN"), SECTION, CLASS)).rejects.toThrow(
      ForbiddenError,
    );
  });

  test("the section's class teacher is unrestricted (daily coordinator)", async () => {
    mockSectionFindById.mockResolvedValue({ classTeacherId: TEACHER_ID });
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();
  });

  test("the homework-confirm delegate is unrestricted", async () => {
    mockSectionFindById.mockResolvedValue({ homeworkConfirmerId: TEACHER_ID });
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();
  });

  // Owner decision 2026-07-19: the checking queue + class notes pass
  // { classTeacherOversight: false } — the class teacher falls through to
  // their grant-derived subject set like any subject teacher.
  test("classTeacherOversight:false — class teacher narrows to their own teaching grants", async () => {
    mockSectionFindById.mockResolvedValue({ classTeacherId: TEACHER_ID });
    mockGrantFind.mockResolvedValue([
      { kind: "teaching", sectionId: SECTION, classId: CLASS, subjectId: SUBJ_ENG_ID, active: true },
    ]);
    mockSubjectFind.mockResolvedValue([{ _id: SUBJ_ENG_ID, code: "ENG" }]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS, {
      classTeacherOversight: false,
    });
    expect(allowed).toEqual(new Set(["ENG"]));
  });

  test("classTeacherOversight:false — class teacher with NO grants gets an empty set", async () => {
    mockSectionFindById.mockResolvedValue({ classTeacherId: TEACHER_ID });
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS, {
      classTeacherOversight: false,
    });
    expect(allowed).toEqual(new Set());
  });

  test("classTeacherOversight:false — Principal/Office stay unrestricted", async () => {
    await expect(
      allowedSubjectCodesForSection(ctxOf("PRINCIPAL"), SECTION, CLASS, { classTeacherOversight: false }),
    ).resolves.toBeNull();
  });

  test("a school-wide homework supervisor is unrestricted", async () => {
    mockUserFindById.mockResolvedValue({ homeworkSupervisor: true });
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();
  });

  test("a subject teacher gets ONLY their teaching-grant subject code", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "g1", kind: "teaching", classId: CLASS, sectionId: SECTION, subjectId: SUBJ_SCI_ID },
    ]);
    mockSubjectFind.mockResolvedValue([{ _id: SUBJ_SCI_ID, code: "SCI" }]);

    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set(["SCI"]));
    // The Science teacher must NOT see English records:
    expect(allowed!.has("ENG")).toBe(false);
  });

  test("teaching grants on OTHER sections contribute nothing (empty set)", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "g1", kind: "teaching", classId: "clsX", sectionId: "secOther", subjectId: SUBJ_SCI_ID },
    ]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set());
  });

  test("multiple teaching grants union their subject codes", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "g1", kind: "teaching", classId: CLASS, sectionId: SECTION, subjectId: SUBJ_SCI_ID },
      { _id: "g2", kind: "teaching", classId: CLASS, sectionId: SECTION, subjectId: SUBJ_ENG_ID },
    ]);
    mockSubjectFind.mockResolvedValue([
      { _id: SUBJ_SCI_ID, code: "SCI" },
      { _id: SUBJ_ENG_ID, code: "ENG" },
    ]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set(["SCI", "ENG"]));
  });

  test("an active subject-bound proxy narrows to that subject", async () => {
    mockGrantFind.mockResolvedValue([
      {
        _id: "g1",
        kind: "proxy",
        classId: CLASS,
        sectionId: SECTION,
        subjectId: SUBJ_ENG_ID,
        startDate: new Date(),
        durationDays: 1,
        proxyStatus: "active",
      },
    ]);
    mockSubjectFind.mockResolvedValue([{ _id: SUBJ_ENG_ID, code: "ENG" }]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set(["ENG"]));
  });

  test("a legacy subject-less proxy on the section is unrestricted (null)", async () => {
    mockGrantFind.mockResolvedValue([
      {
        _id: "g1",
        kind: "proxy",
        classId: CLASS,
        sectionId: SECTION,
        startDate: new Date(),
        durationDays: 1,
        proxyStatus: "active",
      },
    ]);
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();
  });

  test("whole_school / matching grade_class supervisory are unrestricted", async () => {
    mockGrantFind.mockResolvedValue([{ _id: "g1", kind: "supervisory", extent: "whole_school" }]);
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();

    mockGrantFind.mockResolvedValue([
      { _id: "g2", kind: "supervisory", extent: "grade_class", classId: CLASS },
    ]);
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS)).resolves.toBeNull();
  });

  test("subject_dept supervisory narrows to its subject code", async () => {
    mockGrantFind.mockResolvedValue([
      { _id: "g1", kind: "supervisory", extent: "subject_dept", subjectId: SUBJ_ENG_ID },
    ]);
    mockSubjectFind.mockResolvedValue([{ _id: SUBJ_ENG_ID, code: "ENG" }]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set(["ENG"]));
  });

  test("explicit_set supervisory contributes only pairs matching the class", async () => {
    mockGrantFind.mockResolvedValue([
      {
        _id: "g1",
        kind: "supervisory",
        extent: "explicit_set",
        explicitSet: [
          { classId: CLASS, subjectId: SUBJ_SCI_ID },
          { classId: "clsOther", subjectId: SUBJ_ENG_ID },
        ],
      },
    ]);
    mockSubjectFind.mockResolvedValue([{ _id: SUBJ_SCI_ID, code: "SCI" }]);
    const allowed = await allowedSubjectCodesForSection(ctxOf("TEACHER"), SECTION, CLASS);
    expect(allowed).toEqual(new Set(["SCI"]));
    expect(mockSubjectFind).toHaveBeenCalledWith({ _id: { $in: [SUBJ_SCI_ID] } });
  });
});

// D-#727: a class-shaped read extent is matched against the SECTION's own class — a
// C4 supervisor pairing classId=C4 with a C5 section id used to read C5.
describe("the class comes from the section, not the caller (D-#727)", () => {
  const C4 = new mongoose.Types.ObjectId().toString();
  const C5 = new mongoose.Types.ObjectId().toString();
  const C5_BOYS = new mongoose.Types.ObjectId().toString();
  const c4Supervisor = [{ _id: "g9", kind: "supervisory", extent: "grade_class", classId: C4 }];

  test("assertCanRead: claiming C4 on a C5 section is refused", async () => {
    mockGrantFind.mockResolvedValue(c4Supervisor);
    mockSectionFindById.mockResolvedValue({ classId: C5 });
    await expect(assertCanRead(ctxOf("TEACHER"), C5_BOYS, C4)).rejects.toThrow(ForbiddenError);
  });

  test("assertCanRead: the same supervisor on a real C4 section passes", async () => {
    mockGrantFind.mockResolvedValue(c4Supervisor);
    mockSectionFindById.mockResolvedValue({ classId: C4 });
    await expect(assertCanRead(ctxOf("TEACHER"), C5_BOYS, C4)).resolves.toBeUndefined();
  });

  test("allowedSubjectCodesForSection: no unrestricted read on another class's section", async () => {
    mockGrantFind.mockResolvedValue(c4Supervisor);
    mockSectionFindById.mockResolvedValue({ classId: C5 });
    await expect(allowedSubjectCodesForSection(ctxOf("TEACHER"), C5_BOYS, C4)).resolves.toEqual(new Set());
  });

  test("a plain teaching grant never pays the section lookup", async () => {
    mockGrantFind.mockResolvedValue([{ kind: "teaching", sectionId: C5_BOYS, classId: C5, subjectId: SUBJ_SCI_ID, active: true }]);
    await assertCanRead(ctxOf("TEACHER"), C5_BOYS, C5);
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });
});
