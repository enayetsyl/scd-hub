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
const mockExamFindById = jest.fn();
jest.mock("../modules/exams/models/Exam", () => ({
  Exam: {
    findOne: (q: unknown) => Promise.resolve(mockExamFindOne(q)),
    findById: (id: unknown) => Promise.resolve(mockExamFindById(id)),
    create: (d: unknown) => mockExamCreate(d),
  },
}));

const mockAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockAudit(p),
}));

import { createExam, updateExam } from "../modules/exams/services/ExamService";

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

// ---------------------------------------------------------------------------
// updateExam (SY-7) — the exam is editable in the app, so a typo is not fatal
// ---------------------------------------------------------------------------

describe("updateExam", () => {
  function examDoc(over: Record<string, unknown> = {}) {
    return {
      _id: oid(),
      academicYearId: oid(),
      term: "ANNUAL",
      name: "বার্ষিক পরীক্ষা ২০২৬",
      startDateKey: "2026-12-07",
      endDateKey: "2026-12-16",
      save: jest.fn(async function (this: unknown) {
        return this;
      }),
      ...over,
    };
  }

  test("renames an exam and audits WHICH field moved, not its value", async () => {
    const doc = examDoc();
    mockExamFindById.mockReturnValue(doc);
    await updateExam(ctxFor("OFFICE"), { id: "e1", name: "বার্ষিক পরীক্ষা ২০২৬ (সংশোধিত)" });
    expect(doc.name).toBe("বার্ষিক পরীক্ষা ২০২৬ (সংশোধিত)");
    const audit = mockAudit.mock.calls[0][0];
    expect(audit.eventKind).toBe("EXAM_UPDATED");
    expect(audit.meta.fields).toEqual(["name"]);
    // The new name must NOT be in the audit meta — the D-#526 posture.
    expect(JSON.stringify(audit.meta)).not.toContain("সংশোধিত");
  });

  test("is a PATCH — an omitted field is left alone, not blanked", async () => {
    const doc = examDoc();
    mockExamFindById.mockReturnValue(doc);
    await updateExam(ctxFor("OFFICE"), { id: "e1", name: "নতুন নাম" });
    expect(doc.startDateKey).toBe("2026-12-07");
    expect(doc.endDateKey).toBe("2026-12-16");
  });

  test("a no-op update writes nothing and audits nothing", async () => {
    const doc = examDoc();
    mockExamFindById.mockReturnValue(doc);
    await updateExam(ctxFor("OFFICE"), { id: "e1", name: doc.name as string });
    expect(doc.save).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("an empty name is ignored rather than wiping the exam's name", async () => {
    const doc = examDoc();
    mockExamFindById.mockReturnValue(doc);
    await updateExam(ctxFor("OFFICE"), { id: "e1", name: "   " });
    expect(doc.name).toBe("বার্ষিক পরীক্ষা ২০২৬");
  });

  test("dates can be cleared explicitly by passing null", async () => {
    const doc = examDoc();
    mockExamFindById.mockReturnValue(doc);
    await updateExam(ctxFor("OFFICE"), { id: "e1", startDateKey: null, endDateKey: null });
    expect(doc.startDateKey).toBeNull();
    expect(mockAudit.mock.calls[0][0].meta.fields).toEqual(["startDateKey", "endDateKey"]);
  });

  test("a teacher cannot edit an exam", async () => {
    mockExamFindById.mockReturnValue(examDoc());
    await expect(updateExam(ctxFor("TEACHER"), { id: "e1", name: "x" })).rejects.toThrow(
      /অনুমতি নেই/,
    );
  });

  test("a missing exam is refused", async () => {
    mockExamFindById.mockReturnValue(null);
    await expect(updateExam(ctxFor("OFFICE"), { id: "nope", name: "x" })).rejects.toThrow(
      /পাওয়া যায়নি/,
    );
  });
});
