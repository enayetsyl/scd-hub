/**
 * WorksheetService (D-#744–#747) — gates and the send-to-print path.
 *
 *  - a teacher (tracker:write) and the Office (roster:manage) may generate; a guardian may not
 *  - only roster:manage saves the plan or names the teacher a paper is for
 *  - only Nursery/KG and BAN/ENG/MATH are generated
 *  - send = PDF → print_upload owned by the caller → createPrintRequest(UPLOAD), with the
 *    one-section class's section filled in, then pictures stamped and an audit row written
 *  - the answer key opens for its creator, the teacher it was for, or roster:manage — no one else
 *
 * DB-free (repo convention): every model, Drive and the print service are mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";

const oid = () => new mongoose.Types.ObjectId();
const CLASS_ID = oid();
const KG1_ID = oid();
const SECTION_ID = oid();
const EXAM_ID = oid();
const TEACHER = oid().toString();
const OTHER_TEACHER = oid().toString();
const OFFICE = oid().toString();

/** A chainable query stub: every builder method returns itself, `lean()` resolves. */
function chain<T>(value: T) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "sort", "limit", "skip"]) q[m] = () => q;
  q.lean = async () => value;
  return q;
}

const mockClass = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: (id: unknown) => chain(mockClass(String(id))) },
}));
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { find: () => chain([{ _id: SECTION_ID }]) },
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: { findById: () => chain({ name: "শিক্ষক এক" }), find: () => chain([]) },
}));
jest.mock("../modules/exams/models/Exam", () => ({
  Exam: { findById: () => chain({ name: "Annual 2026", startDateKey: "2026-12-01" }) },
}));
const BAN_MARKS = [
  { seq: 1, label: "আগের বর্ণ লেখ", itemType: "fill_blank", count: 10, marksEach: 1, total: 10 },
  { seq: 2, label: "পরের বর্ণ লেখ", itemType: "fill_blank", count: 10, marksEach: 1, total: 10 },
  { seq: 3, label: "ছবি দেখে সঠিক বর্ণ লেখ", itemType: "short_answer", count: 5, marksEach: 1, total: 5 },
];
const mockSyllabus = jest.fn(() => [{ examId: EXAM_ID, marks: BAN_MARKS }]);
jest.mock("../modules/exams/models/ExamSyllabus", () => ({
  ExamSyllabus: { find: () => chain(mockSyllabus()) },
}));
jest.mock("../modules/exams/services/ExamSyllabusService", () => ({
  routineHoldersFor: async () => [{ userId: TEACHER, periods: 6 }],
}));
const mockPlanFindOne = jest.fn(() => null as unknown);
const mockPlanUpsert = jest.fn();
jest.mock("../modules/worksheets/models/WorksheetPlan", () => ({
  WorksheetPlan: {
    findOne: () => chain(mockPlanFindOne()),
    findOneAndUpdate: (...a: unknown[]) => mockPlanUpsert(...a),
  },
}));
const PIC_IDS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"].map(() => oid());
const mockPictureUpdateMany = jest.fn();
jest.mock("../modules/worksheets/models/WorksheetPicture", () => ({
  PICTURE_META_FIELDS: "-image -thumb",
  WorksheetPicture: {
    find: () =>
      chain(
        PIC_IDS.map((_id, i) => ({
          _id,
          book: "BAN",
          letter: ["ক", "খ", "গ", "ঘ", "ঙ", "চ"][i],
          word: null,
          uses: ["FIRST_LETTER"],
          reserveForFinal: false,
          lastUsedAt: null,
          image: Buffer.from("x"),
          thumb: Buffer.from("t"),
        })),
      ),
    updateMany: (...a: unknown[]) => mockPictureUpdateMany(...a),
  },
}));
const mockWorksheetCreate = jest.fn(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
const mockWorksheetFindById = jest.fn();
// D-#761: the paged list — what find() was asked for, and what it hands back.
const mockListPlan: Record<string, unknown> = {};
const mockListRows = jest.fn((): unknown[] => []);
const mockListCount = jest.fn(async (_q?: unknown) => 0);
jest.mock("../modules/worksheets/models/Worksheet", () => ({
  Worksheet: {
    create: (d: Record<string, unknown>) => mockWorksheetCreate(d),
    findById: () => chain(mockWorksheetFindById()),
    find: (q: unknown) => {
      mockListPlan.filter = q;
      const c: Record<string, unknown> = {};
      for (const m of ["select", "sort", "skip", "limit"]) c[m] = (v: unknown) => { mockListPlan[m] = v; return c; };
      c.lean = async () => mockListRows();
      return c;
    },
    countDocuments: (q: unknown) => mockListCount(q),
  },
}));
const mockStoredCreate = jest.fn(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { create: (d: Record<string, unknown>) => mockStoredCreate(d) },
}));
jest.mock("../modules/platform/services/DriveStore", () => ({
  uploadToDrive: async () => "drive-file-1",
  DriveUnavailableError: class DriveUnavailableError extends Error {},
}));
const mockCreatePrint = jest.fn(async (i: Record<string, unknown>) => ({ _id: oid(), title: i.title }));
jest.mock("../modules/printing/services/PrintRequestService", () => ({
  createPrintRequest: (i: Record<string, unknown>) => mockCreatePrint(i),
}));
const mockAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({ writeAudit: (a: unknown) => mockAudit(a) }));
jest.mock("../modules/worksheets/render/worksheetPdf", () => ({
  renderWorksheetPdf: async () => Buffer.from("%PDF-1.3 test"),
}));

import {
  arabicBookFor,
  getPlan,
  savePlan,
  previewWorksheet,
  renderPreviewWorksheet,
  sendWorksheetToPrint,
  worksheetForRead,
  worksheetTeachers,
  myWorksheetsPage,
} from "../modules/worksheets/services/WorksheetService";

const ctxOf = (role: string, userId: string) => ({ auth: { userId, role } }) as unknown as AppContext;
const teacher = ctxOf("TEACHER", TEACHER);
const office = ctxOf("OFFICE", OFFICE);
const guardian = ctxOf("GUARDIAN", oid().toString());

beforeEach(() => {
  jest.clearAllMocks();
  mockClass.mockImplementation((id: string) =>
    id === CLASS_ID.toString()
      ? { _id: CLASS_ID, level: -1, nameBn: "নার্সারি" }
      : id === KG1_ID.toString()
        ? { _id: KG1_ID, level: 1, nameBn: "প্রথম শ্রেণি" }
        : null,
  );
});

const sendArgs = {
  classId: CLASS_ID.toString(),
  subject: "BAN",
  kind: "ASSIGNMENT",
  seed: 42,
  colour: "BW",
  sides: "SINGLE",
  copies: 20,
  neededByKey: "2026-10-22",
};

describe("gates", () => {
  it("lets a teacher and the Office read the plan, refuses a guardian", async () => {
    await expect(getPlan(teacher, CLASS_ID.toString(), "BAN")).resolves.toMatchObject({ classLevel: -1, finalTotal: 25 });
    await expect(getPlan(office, CLASS_ID.toString(), "BAN")).resolves.toBeTruthy();
    await expect(getPlan(guardian, CLASS_ID.toString(), "BAN")).rejects.toThrow();
  });

  it("gives a KG আরবি paper book 2 and leaves every other paper on its subject's book (D-#806)", () => {
    expect(arabicBookFor("ARABIC", 0)).toBe("ARABIC_KG");
    expect(arabicBookFor("ARABIC", -1)).toBeNull();
    expect(arabicBookFor("BAN", 0)).toBeNull();
  });

  it("generates only for Nursery/KG and BAN/ENG/MATH/ARABIC", async () => {
    await expect(getPlan(teacher, KG1_ID.toString(), "BAN")).rejects.toThrow(/নার্সারি ও কেজি/);
    await expect(getPlan(teacher, CLASS_ID.toString(), "ARABIC")).resolves.toMatchObject({ subject: "ARABIC" });
    await expect(getPlan(teacher, CLASS_ID.toString(), "QURAN")).rejects.toThrow(/এখনো/);
  });

  it("only roster:manage saves the plan", async () => {
    const input = { classId: CLASS_ID.toString(), subject: "BAN", rows: [{ seq: 1, kind: "BEFORE" }] };
    await expect(savePlan(teacher, input)).rejects.toThrow();
    await savePlan(office, input);
    expect(mockPlanUpsert).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "WORKSHEET_PLAN_SAVED" }));
  });

  it("refuses a plan row the syllabus does not have, or an unknown kind", async () => {
    await expect(savePlan(office, { classId: CLASS_ID.toString(), subject: "BAN", rows: [{ seq: 9, kind: "BEFORE" }] })).rejects.toThrow();
    await expect(savePlan(office, { classId: CLASS_ID.toString(), subject: "BAN", rows: [{ seq: 1, kind: "ESSAY" }] })).rejects.toThrow();
  });

  it("lists routine teachers only to the Office", async () => {
    await expect(worksheetTeachers(teacher, CLASS_ID.toString(), "BAN")).resolves.toEqual([]);
    await expect(worksheetTeachers(office, CLASS_ID.toString(), "BAN")).resolves.toEqual([{ userId: TEACHER, name: "" }]);
  });

  it("says so when the subject has no published syllabus", async () => {
    mockSyllabus.mockReturnValueOnce([]);
    await expect(previewWorksheet(teacher, { ...sendArgs })).rejects.toThrow(/সিলেবাস/);
  });
});

describe("preview", () => {
  it("returns the doc, the header and thumbnails, and stores nothing", async () => {
    const p = await previewWorksheet(teacher, { ...sendArgs, letterUpTo: 5 });
    const doc = JSON.parse(p.docJson);
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(p.header.title).toBe("সাপ্তাহিক অ্যাসাইনমেন্ট");
    expect(p.pictures.every((x) => x.dataUri.startsWith("data:image/jpeg;base64,"))).toBe(true);
    expect(mockWorksheetCreate).not.toHaveBeenCalled();
    expect(mockCreatePrint).not.toHaveBeenCalled();
  });
});

describe("preview PDF (owner 2026-10-17)", () => {
  it("renders the paper on screen without storing, printing or auditing it", async () => {
    const pdf = await renderPreviewWorksheet(teacher, { ...sendArgs, letterUpTo: 5 }, false);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(mockWorksheetCreate).not.toHaveBeenCalled();
    expect(mockCreatePrint).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a guardian", async () => {
    await expect(renderPreviewWorksheet(guardian, { ...sendArgs }, true)).rejects.toThrow();
  });
});

describe("send to print", () => {
  it("files a print_upload owned by the caller through createPrintRequest, tagged with the section", async () => {
    const r = await sendWorksheetToPrint(teacher, sendArgs);
    expect(mockStoredCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "print_upload", mime: "application/pdf", uploadedBy: TEACHER }),
    );
    const req = mockCreatePrint.mock.calls[0][0];
    expect(req).toMatchObject({
      purpose: "ASSIGNMENT",
      sourceType: "UPLOAD",
      classId: CLASS_ID.toString(),
      sectionId: SECTION_ID.toString(),
      subject: "BAN",
      requestedBy: TEACHER,
      neededByKey: "2026-10-22",
    });
    expect(req.trusted).toBeUndefined();
    expect(mockWorksheetCreate).toHaveBeenCalledWith(expect.objectContaining({ seed: 42, kind: "ASSIGNMENT" }));
    expect(mockPictureUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "WORKSHEET_SENT_TO_PRINT" }));
    expect(r.totalMarks).toBeGreaterThan(0);
  });

  it("prints exactly the previewed version (same seed → same doc)", async () => {
    const p = await previewWorksheet(teacher, sendArgs);
    await sendWorksheetToPrint(teacher, sendArgs);
    expect(JSON.stringify(mockWorksheetCreate.mock.calls[0][0].doc)).toBe(p.docJson);
  });

  it("lets only the Office name the teacher, and notes it on the request", async () => {
    await expect(sendWorksheetToPrint(teacher, { ...sendArgs, forTeacherId: OTHER_TEACHER })).rejects.toThrow();
    await sendWorksheetToPrint(office, { ...sendArgs, forTeacherId: TEACHER });
    expect(mockCreatePrint.mock.calls[0][0].notes).toContain("শিক্ষক এক");
    expect(mockWorksheetCreate.mock.calls[0][0].forTeacherId?.toString()).toBe(TEACHER);
  });

  it("requires the use date", async () => {
    await expect(sendWorksheetToPrint(teacher, { ...sendArgs, neededByKey: "" })).rejects.toThrow(/তারিখ/);
  });

  it("files a final under OTHER and a class test under CLASS_TEST", async () => {
    await sendWorksheetToPrint(teacher, { ...sendArgs, kind: "FINAL" });
    await sendWorksheetToPrint(teacher, { ...sendArgs, kind: "CLASS_TEST" });
    expect(mockCreatePrint.mock.calls.map((c) => c[0].purpose)).toEqual(["OTHER", "CLASS_TEST"]);
  });
});

describe("answer key read gate", () => {
  const stored = { _id: oid(), createdBy: new mongoose.Types.ObjectId(TEACHER), forTeacherId: null };
  it("opens for the creator and the Office, not another teacher", async () => {
    mockWorksheetFindById.mockReturnValue(stored);
    await expect(worksheetForRead(teacher, stored._id.toString())).resolves.toBeTruthy();
    await expect(worksheetForRead(office, stored._id.toString())).resolves.toBeTruthy();
    await expect(worksheetForRead(ctxOf("TEACHER", OTHER_TEACHER), stored._id.toString())).rejects.toThrow();
  });

  it("opens for the teacher the Office made it for", async () => {
    mockWorksheetFindById.mockReturnValue({ ...stored, createdBy: new mongoose.Types.ObjectId(OFFICE), forTeacherId: new mongoose.Types.ObjectId(OTHER_TEACHER) });
    await expect(worksheetForRead(ctxOf("TEACHER", OTHER_TEACHER), stored._id.toString())).resolves.toBeTruthy();
  });
});

// D-#761 — the "made" list stopped at the newest N with no way to an older paper.
describe("myWorksheetsPage", () => {
  it("pages my papers (made by me OR for me), newest first, projected to the row fields", async () => {
    const w = {
      _id: oid(), title: "Bangla CT", kind: "CLASS_TEST", subject: "BAN", classLevel: 0,
      totalMarks: 25, createdAt: new Date("2026-10-01T00:00:00Z"), printRequestId: null,
    };
    mockListRows.mockReturnValue([w]);
    mockListCount.mockResolvedValue(23);
    const page = await myWorksheetsPage(teacher, { page: 3, pageSize: 10 });
    expect(page).toMatchObject({ total: 23, page: 3, pageSize: 10 });
    expect(page.rows).toEqual([expect.objectContaining({ id: w._id.toString(), title: "Bangla CT", printRequestId: null })]);
    expect(mockListPlan.sort).toEqual({ createdAt: -1, _id: -1 });
    expect([mockListPlan.skip, mockListPlan.limit]).toEqual([20, 10]);
    // Never the generated `doc` — a list row is the summary only.
    expect(String(mockListPlan.select)).not.toContain("doc");
    const or = (mockListPlan.filter as { $or: Array<Record<string, { toString(): string }>> }).$or;
    expect(or.map((c) => Object.keys(c)[0])).toEqual(["createdBy", "forTeacherId"]);
    expect(or[0].createdBy.toString()).toBe(TEACHER);
  });

  it("is gated like generating: a guardian may not list", async () => {
    await expect(myWorksheetsPage(guardian, {})).rejects.toThrow();
  });
});
