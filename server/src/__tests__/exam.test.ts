/**
 * Exam row tests (SY-1, docs/prd-exam-syllabus.md §6).
 *
 * The acceptance box this closes: "a second `Exam` for the same year+term is
 * refused". The unique index is the real guarantee, but the index cannot be
 * exercised without a database and the repo's tests are DB-free — so the rule
 * also lives in the service, and this pins it there.
 *
 * Why it matters: two "Annual 2026" rows would silently split the syllabus
 * across them — half the subjects on one, half on the other — and every coverage
 * count would read as complete on both.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();

const mockExamFindOne = jest.fn();
const mockExamCreate = jest.fn();
jest.mock("../modules/exams/models/Exam", () => ({
  Exam: {
    findOne: (q: unknown) => Promise.resolve(mockExamFindOne(q)),
    create: (d: unknown) => mockExamCreate(d),
  },
}));

const mockAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockAudit(p),
}));

import { createExam } from "../modules/exams/services/ExamService";

function ctxFor(role: "PRINCIPAL" | "OFFICE" | "TEACHER" | "GUARDIAN"): AppContext {
  return {
    req: {} as AppContext["req"],
    res: {} as AppContext["res"],
    auth: {
      userId: oid().toString(),
      role,
      additionalTemplates: [],
      grantedPermissions: [],
      revokedPermissions: [],
    },
  };
}

const YEAR = oid().toString();
const input = { academicYearId: YEAR, term: "ANNUAL", name: "বার্ষিক পরীক্ষা ২০২৬" };

beforeEach(() => {
  jest.clearAllMocks();
  mockExamFindOne.mockReturnValue(null);
  mockExamCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
});

describe("createExam", () => {
  test("Office creates an exam and the write is audited", async () => {
    await createExam(ctxFor("OFFICE"), input);
    expect(mockExamCreate).toHaveBeenCalled();
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_CREATED");
  });

  test("a SECOND exam for the same year + term is refused, in Bangla", async () => {
    mockExamFindOne.mockReturnValue({ _id: oid() });
    await expect(createExam(ctxFor("OFFICE"), input)).rejects.toThrow(/আগেই তৈরি/);
    expect(mockExamCreate).not.toHaveBeenCalled();
  });

  test("the same year with the OTHER term is fine — the two terms stand alone", async () => {
    await createExam(ctxFor("OFFICE"), { ...input, term: "HALF_YEARLY" });
    expect(mockExamCreate).toHaveBeenCalled();
    expect(mockExamFindOne.mock.calls[0][0]).toEqual({
      academicYearId: YEAR,
      term: "HALF_YEARLY",
    });
  });

  test("an unknown term is refused before anything is read or written", async () => {
    await expect(createExam(ctxFor("OFFICE"), { ...input, term: "TERMLY" })).rejects.toThrow(
      /ধরন/,
    );
    expect(mockExamFindOne).not.toHaveBeenCalled();
    expect(mockExamCreate).not.toHaveBeenCalled();
  });

  test("a teacher cannot create an exam", async () => {
    await expect(createExam(ctxFor("TEACHER"), input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("a guardian cannot create an exam", async () => {
    await expect(createExam(ctxFor("GUARDIAN"), input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("an unauthenticated caller is refused", async () => {
    await expect(
      createExam(
        { req: {} as AppContext["req"], res: {} as AppContext["res"], auth: null },
        input,
      ),
    ).rejects.toThrow();
  });
});
