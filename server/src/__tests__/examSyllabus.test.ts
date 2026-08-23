/**
 * Exam syllabus tests (SY-2/SY-3, docs/prd-exam-syllabus.md §6, D-#530–#532).
 *
 * Marks    — Σ = 100 in EVERY class (D-#532); a component row carries no
 *            count/marksEach (D-#531); count × marksEach must equal total. The
 *            Nursery-Arabic sheet from §5.1 is the fixture, because it is the one
 *            row-set the owner actually wrote down.
 * Approver — routine-derived, NOT typed and NOT granted (D-#533). ARABIC reaches
 *            an approver only through a cross-grade subjectgroup slot; a scope
 *            grant confers read, never sign-off.
 * Chain    — DRAFT → TEACHER_REVIEW → PRINCIPAL_REVIEW → PUBLISHED, no stage
 *            skipping, send-back needs a reason, publish is Principal-only, and a
 *            content edit clears an existing approval (§7.3).
 *
 * DB-free (repo convention): models + audit are mocked.
 */
import mongoose from "mongoose";
import type { AppContext } from "../context";
import { validateMarkRows, type ISyllabusMarkRow } from "../modules/exams/models/ExamSyllabus";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const mockSyllabusCreate = jest.fn();
const mockSyllabusFindOne = jest.fn();
const mockSyllabusFindById = jest.fn();
jest.mock("../modules/exams/models/ExamSyllabus", () => {
  const actual = jest.requireActual("../modules/exams/models/ExamSyllabus");
  return {
    ...actual,
    ExamSyllabus: {
      create: (d: unknown) => mockSyllabusCreate(d),
      findOne: (q: unknown) => Promise.resolve(mockSyllabusFindOne(q)),
      findById: (id: unknown) => Promise.resolve(mockSyllabusFindById(id)),
    },
  };
});

const mockNoteFindOne = jest.fn();
const mockNoteCreate = jest.fn();
jest.mock("../modules/exams/models/ExamClassNote", () => ({
  ExamClassNote: {
    findOne: (q: unknown) => Promise.resolve(mockNoteFindOne(q)),
    create: (d: unknown) => mockNoteCreate(d),
  },
}));

jest.mock("../modules/exams/models/Exam", () => ({
  Exam: { findById: jest.fn(async () => ({ _id: "exam1", name: "বার্ষিক পরীক্ষা ২০২৬" })) },
}));

const mockSlots = jest.fn();
jest.mock("../modules/routine/models/RoutineSlot", () => ({
  RoutineSlot: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockSlots(q) }) }),
  },
}));

const mockAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockAudit(p),
}));

import {
  saveExamClassNote,
  routineHoldersFor,
  defaultApproverFor,
  isRoutineHolder,
  saveSyllabus,
  submitSyllabusToTeacher,
  approveSyllabusAsTeacher,
  sendBackSyllabus,
  publishSyllabus,
} from "../modules/exams/services/ExamSyllabusService";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLASS = oid().toString();
const OFFICE_ID = oid().toString();
const PRINCIPAL_ID = oid().toString();
const ROKSANA = oid().toString(); // holds the pair, 5 periods
const KARIM = oid().toString(); // holds the pair, 2 periods
const OUTSIDER = oid().toString(); // teaches something else entirely

function ctxFor(
  role: "PRINCIPAL" | "OFFICE" | "TEACHER" | "GUARDIAN",
  userId: string,
): AppContext {
  return {
    req: {} as AppContext["req"],
    res: {} as AppContext["res"],
    auth: { userId, role, additionalTemplates: [], grantedPermissions: [], revokedPermissions: [] },
  };
}

const OFFICE = ctxFor("OFFICE", OFFICE_ID);
const PRINCIPAL = ctxFor("PRINCIPAL", PRINCIPAL_ID);
const TEACHER = ctxFor("TEACHER", ROKSANA);

/** §5.1 — the মানবন্টন the owner actually wrote for Nursery Arabic. Sums to 100. */
const NURSERY_ARABIC: ISyllabusMarkRow[] = [
  { seq: 1, label: "ছবি দেখে শব্দের প্রথম অক্ষরে বৃত্ত আঁকা", count: 10, marksEach: 1, total: 10 },
  { seq: 2, label: "ছবি দেখে শব্দের প্রথম অক্ষর লেখা", count: 10, marksEach: 2, total: 20 },
  { seq: 3, label: "ছবি দেখে সঠিক উত্তরে টিক চিহ্ন", count: 10, marksEach: 1, total: 10 },
  { seq: 4, label: "সঠিক তারতিবে হরফ লেখা", count: 10, marksEach: 1, total: 10 },
  { seq: 5, label: "আগে ও পরের হরফ লেখা", count: 10, marksEach: 1, total: 10 },
  { seq: 6, label: "ছবি দেখে শব্দ বলা", itemType: "oral", count: 10, marksEach: 2, total: 20 },
  { seq: 7, label: "ক্লাস টেস্ট", component: "CT", total: 10 },
  { seq: 8, label: "আখলাক", component: "ADAB", total: 10 },
];

/** A stored row that behaves enough like a mongoose doc for the service. */
function docFor(over: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    examId: oid(),
    classId: new mongoose.Types.ObjectId(CLASS),
    subject: "ARABIC",
    bodyMd: "রওজাতুল আতফাল-১",
    marks: NURSERY_ARABIC,
    questionTypes: [],
    status: "DRAFT",
    approverUserId: null,
    teacherApprovedBy: null,
    teacherApprovedAt: null,
    teacherBypass: false,
    publishedBy: null,
    publishedAt: null,
    sendBackReason: null,
    sendBackBy: null,
    sendBackAt: null,
    save: jest.fn(async function (this: unknown) {
      return this;
    }),
    ...over,
  };
}

/** Routine slots: Roksana 5 periods, Karim 2, all cross-grade subjectgroup. */
function slotsRoksanaAndKarim() {
  return [
    ...Array(5).fill({ teacherId: new mongoose.Types.ObjectId(ROKSANA) }),
    ...Array(2).fill({ teacherId: new mongoose.Types.ObjectId(KARIM) }),
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSlots.mockReturnValue(slotsRoksanaAndKarim());
  mockSyllabusCreate.mockImplementation(async (d: Record<string, unknown>) => ({
    _id: oid(),
    ...d,
  }));
});

// ---------------------------------------------------------------------------
// Mark distribution — the Σ = 100 guard (D-#531/#529)
// ---------------------------------------------------------------------------

describe("validateMarkRows", () => {
  test("accepts the Nursery-Arabic sheet from §5.1 — 10+20+10+10+10+20+10+10 = 100", () => {
    expect(validateMarkRows(NURSERY_ARABIC)).toBeNull();
  });

  test("refuses rows summing to 90 and NAMES the actual sum", () => {
    const short = NURSERY_ARABIC.filter((r) => r.seq !== 8);
    const err = validateMarkRows(short);
    expect(err).toContain("90");
  });

  test("refuses rows summing to 110", () => {
    const over = [...NURSERY_ARABIC, { seq: 9, label: "অতিরিক্ত", count: 1, marksEach: 10, total: 10 }];
    expect(validateMarkRows(over)).toContain("110");
  });

  test("refuses an empty distribution rather than treating it as zero", () => {
    expect(validateMarkRows([])).toBeTruthy();
  });

  test("a CT/ADAB component row carrying count or marksEach is refused (D-#531)", () => {
    const bad = NURSERY_ARABIC.map((r) =>
      r.component === "CT" ? { ...r, count: 2, marksEach: 5 } : r,
    );
    expect(validateMarkRows(bad)).toContain("কম্পোনেন্ট");
  });

  test("a question row whose count × marksEach ≠ total is refused, with the arithmetic", () => {
    const bad = NURSERY_ARABIC.map((r) => (r.seq === 2 ? { ...r, marksEach: 3 } : r));
    const err = validateMarkRows(bad);
    expect(err).toContain("30");
    expect(err).toContain("20");
  });

  test("a question row missing count or marksEach is refused", () => {
    const bad = NURSERY_ARABIC.map((r) => (r.seq === 1 ? { ...r, count: null } : r));
    expect(validateMarkRows(bad)).toBeTruthy();
  });

  test("a KG-shaped 2-row sheet is valid — composition is per subject, not per band (D-#532)", () => {
    const kg: ISyllabusMarkRow[] = [
      { seq: 1, label: "আদব", component: "ADAB", total: 10 },
      { seq: 2, label: "লিখিত পরীক্ষা", count: 9, marksEach: 10, total: 90 },
    ];
    expect(validateMarkRows(kg)).toBeNull();
  });

  test("a single-row /100 sheet is valid — one component is not an error", () => {
    const one: ISyllabusMarkRow[] = [
      { seq: 1, label: "লিখিত পরীক্ষা", count: 10, marksEach: 10, total: 100 },
    ];
    expect(validateMarkRows(one)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The routine-derived approver (D-#533)
// ---------------------------------------------------------------------------

describe("routine-derived approver", () => {
  test("ranks holders by period count — the default is the one who teaches it most (§7.1)", async () => {
    const holders = await routineHoldersFor(CLASS, "ARABIC");
    expect(holders).toEqual([
      { userId: ROKSANA, periods: 5 },
      { userId: KARIM, periods: 2 },
    ]);
    expect(await defaultApproverFor(CLASS, "ARABIC")).toBe(ROKSANA);
  });

  test("queries BOTH section slots for this class AND every cross-grade subjectgroup slot", async () => {
    await routineHoldersFor(CLASS, "ARABIC");
    const q = mockSlots.mock.calls[0][0] as Record<string, unknown>;
    // ARABIC/QURAN have no Subject row and are taught only through cross-grade
    // groups (D-#521) — dropping the subjectgroup arm ships an approval stage no
    // Arabic teacher could ever act on.
    expect(q.$or).toEqual([
      { groupType: "section", classId: expect.anything() },
      { groupType: "subjectgroup" },
    ]);
    expect(q.subject).toBe("ARABIC");
    expect(q.active).toEqual({ $ne: false });
  });

  test("a teacher who holds no slot for the pair is not a holder", async () => {
    expect(await isRoutineHolder(OUTSIDER, CLASS, "ARABIC")).toBe(false);
    expect(await isRoutineHolder(ROKSANA, CLASS, "ARABIC")).toBe(true);
  });

  test("nobody in the routine yields a null default rather than stranding the row (§7.2)", async () => {
    mockSlots.mockReturnValue([]);
    expect(await defaultApproverFor(CLASS, "ARABIC")).toBeNull();
  });

  test("slots with no teacher assigned are ignored", async () => {
    mockSlots.mockReturnValue([{ teacherId: null }, { teacherId: undefined }]);
    expect(await routineHoldersFor(CLASS, "ARABIC")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Write + §7.3 re-open
// ---------------------------------------------------------------------------

describe("saveSyllabus", () => {
  const input = {
    examId: oid().toString(),
    classId: CLASS,
    subject: "ARABIC" as const,
    bodyMd: "রওজাতুল আতফাল-১",
    marks: NURSERY_ARABIC,
    questionTypes: [],
  };

  test("a teacher cannot write a syllabus", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    await expect(saveSyllabus(TEACHER, input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("refuses mojibake in the body — the D-#523 guard, reused not re-implemented", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    await expect(
      saveSyllabus(OFFICE, { ...input, bodyMd: "à¦¬à¦¾à¦à¦²à¦¾" }),
    ).rejects.toThrow(/এনকোডিং/);
    expect(mockSyllabusCreate).not.toHaveBeenCalled();
  });

  test("refuses mojibake in a mark-row label too, not just the body", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    const bad = NURSERY_ARABIC.map((r) => (r.seq === 1 ? { ...r, label: "à¦à§à¦²à¦¾à¦¸" } : r));
    await expect(saveSyllabus(OFFICE, { ...input, marks: bad })).rejects.toThrow(/এনকোডিং/);
  });

  test("refuses a distribution that does not reach 100, before anything persists", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    await expect(
      saveSyllabus(OFFICE, { ...input, marks: NURSERY_ARABIC.slice(0, 3) }),
    ).rejects.toThrow(/৳|100|১০০|৪০|40/);
    expect(mockSyllabusCreate).not.toHaveBeenCalled();
  });

  test("creates a DRAFT row and audits it", async () => {
    mockSyllabusFindOne.mockReturnValue(null);
    await saveSyllabus(OFFICE, input);
    expect(mockSyllabusCreate).toHaveBeenCalled();
    expect(mockSyllabusCreate.mock.calls[0][0].status).toBe("DRAFT");
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_SAVED");
  });

  test("§7.3 — editing an APPROVED row clears the teacher's sign-off and reopens it", async () => {
    const doc = docFor({
      status: "PRINCIPAL_REVIEW",
      teacherApprovedBy: new mongoose.Types.ObjectId(ROKSANA),
      teacherApprovedAt: new Date(),
    });
    mockSyllabusFindOne.mockReturnValue(doc);

    await saveSyllabus(OFFICE, { ...input, bodyMd: "সম্পূর্ণ নতুন লেখা" });

    expect(doc.status).toBe("DRAFT");
    expect(doc.teacherApprovedBy).toBeNull();
    expect(doc.teacherApprovedAt).toBeNull();
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_REOPENED");
  });

  test("a NO-OP save of an approved row does NOT clear the sign-off", async () => {
    const approvedAt = new Date();
    const doc = docFor({
      status: "PRINCIPAL_REVIEW",
      teacherApprovedBy: new mongoose.Types.ObjectId(ROKSANA),
      teacherApprovedAt: approvedAt,
    });
    mockSyllabusFindOne.mockReturnValue(doc);

    // Same body, same rows — only the question-type chips moved.
    await saveSyllabus(OFFICE, { ...input, questionTypes: ["mcq"] });

    expect(doc.status).toBe("PRINCIPAL_REVIEW");
    expect(doc.teacherApprovedAt).toBe(approvedAt);
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_SAVED");
  });
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

describe("submitSyllabusToTeacher", () => {
  test("defaults to the routine holder with the most periods and moves to TEACHER_REVIEW", async () => {
    const doc = docFor();
    mockSyllabusFindById.mockReturnValue(doc);
    await submitSyllabusToTeacher(OFFICE, "s1");
    expect(doc.status).toBe("TEACHER_REVIEW");
    expect(String(doc.approverUserId)).toBe(ROKSANA);
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_SUBMITTED");
  });

  test("accepts an explicitly named holder who is NOT the default", async () => {
    const doc = docFor();
    mockSyllabusFindById.mockReturnValue(doc);
    await submitSyllabusToTeacher(OFFICE, "s1", KARIM);
    expect(String(doc.approverUserId)).toBe(KARIM);
  });

  test("refuses a named teacher who does not teach the pair (D-#366 — never seat one silently)", async () => {
    mockSyllabusFindById.mockReturnValue(docFor());
    await expect(submitSyllabusToTeacher(OFFICE, "s1", OUTSIDER)).rejects.toThrow(/পড়ান না/);
  });

  test("refuses when the routine names nobody, pointing at the Principal path (§7.2)", async () => {
    mockSlots.mockReturnValue([]);
    mockSyllabusFindById.mockReturnValue(docFor());
    await expect(submitSyllabusToTeacher(OFFICE, "s1")).rejects.toThrow(/প্রধান শিক্ষক/);
  });

  test("refuses to submit a row whose marks do not reach 100", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ marks: NURSERY_ARABIC.slice(0, 2) }));
    await expect(submitSyllabusToTeacher(OFFICE, "s1")).rejects.toThrow();
  });

  test("refuses to re-submit a row that is not a DRAFT", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ status: "TEACHER_REVIEW" }));
    await expect(submitSyllabusToTeacher(OFFICE, "s1")).rejects.toThrow(/খসড়া/);
  });
});

describe("approveSyllabusAsTeacher", () => {
  test("the NAMED routine holder signs off → PRINCIPAL_REVIEW", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(ROKSANA),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await approveSyllabusAsTeacher(TEACHER, "s1");
    expect(doc.status).toBe("PRINCIPAL_REVIEW");
    expect(doc.teacherBypass).toBe(false);
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_TEACHER_APPROVED");
  });

  test("a DIFFERENT teacher — even one who teaches the pair — cannot sign off another's row", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(ROKSANA),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(approveSyllabusAsTeacher(ctxFor("TEACHER", KARIM), "s1")).rejects.toThrow(
      /অনুমতি নেই/,
    );
  });

  test("a teacher who does not teach the pair at all is refused", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(OUTSIDER),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(approveSyllabusAsTeacher(ctxFor("TEACHER", OUTSIDER), "s1")).rejects.toThrow();
  });

  test("§7.2 — the Principal MAY sign off when the routine names nobody, stamped as a BYPASS", async () => {
    mockSlots.mockReturnValue([]);
    const doc = docFor({ status: "TEACHER_REVIEW" });
    mockSyllabusFindById.mockReturnValue(doc);
    await approveSyllabusAsTeacher(PRINCIPAL, "s1");
    expect(doc.status).toBe("PRINCIPAL_REVIEW");
    expect(doc.teacherBypass).toBe(true);
    // A DISTINCT audit kind — folding it into the normal one would make the stage
    // decorative and leave no way to ask which sign-offs a teacher actually gave.
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_TEACHER_BYPASSED");
  });

  test("the Principal may NOT bypass a teacher who exists and is waiting", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(ROKSANA),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(approveSyllabusAsTeacher(PRINCIPAL, "s1")).rejects.toThrow(/অনুমতি নেই/);
  });

  test("refuses a row that is not at the teacher stage", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ status: "DRAFT" }));
    await expect(approveSyllabusAsTeacher(TEACHER, "s1")).rejects.toThrow();
  });
});

describe("sendBackSyllabus", () => {
  test("the named teacher returns it to DRAFT with the reason recorded", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(ROKSANA),
      teacherApprovedBy: new mongoose.Types.ObjectId(ROKSANA),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await sendBackSyllabus(TEACHER, "s1", "Unit 5 শেষ হবে না");
    expect(doc.status).toBe("DRAFT");
    expect(doc.sendBackReason).toBe("Unit 5 শেষ হবে না");
    expect(doc.teacherApprovedBy).toBeNull();
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_SENT_BACK");
  });

  test("an empty or whitespace reason is refused — Office would have nothing to act on", async () => {
    const doc = docFor({
      status: "TEACHER_REVIEW",
      approverUserId: new mongoose.Types.ObjectId(ROKSANA),
    });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(sendBackSyllabus(TEACHER, "s1", "   ")).rejects.toThrow(/কারণ/);
    expect(doc.status).toBe("TEACHER_REVIEW");
  });

  test("an unrelated teacher cannot send back someone else's row", async () => {
    mockSyllabusFindById.mockReturnValue(
      docFor({ status: "TEACHER_REVIEW", approverUserId: new mongoose.Types.ObjectId(ROKSANA) }),
    );
    await expect(
      sendBackSyllabus(ctxFor("TEACHER", KARIM), "s1", "কারণ"),
    ).rejects.toThrow(/অনুমতি নেই/);
  });

  test("the Principal sends back from their own stage", async () => {
    const doc = docFor({ status: "PRINCIPAL_REVIEW" });
    mockSyllabusFindById.mockReturnValue(doc);
    await sendBackSyllabus(PRINCIPAL, "s1", "মানবন্টন ঠিক করুন");
    expect(doc.status).toBe("DRAFT");
  });

  test("a PUBLISHED row cannot be sent back — it is corrected by editing, which reopens it", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ status: "PUBLISHED" }));
    await expect(sendBackSyllabus(PRINCIPAL, "s1", "কারণ")).rejects.toThrow();
  });
});

describe("publishSyllabus", () => {
  test("the Principal publishes and publishedAt becomes the guardian predicate", async () => {
    const doc = docFor({ status: "PRINCIPAL_REVIEW" });
    mockSyllabusFindById.mockReturnValue(doc);
    await publishSyllabus(PRINCIPAL, "s1");
    expect(doc.status).toBe("PUBLISHED");
    expect(doc.publishedAt).toBeInstanceOf(Date);
    expect(String(doc.publishedBy)).toBe(PRINCIPAL_ID);
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_SYLLABUS_PUBLISHED");
  });

  test("OFFICE holds exam:manage and is STILL refused — publish rides the role (§7.4)", async () => {
    const doc = docFor({ status: "PRINCIPAL_REVIEW" });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(publishSyllabus(OFFICE, "s1")).rejects.toThrow(/প্রধান শিক্ষক/);
    expect(doc.status).toBe("PRINCIPAL_REVIEW");
    expect(doc.publishedAt).toBeNull();
  });

  test("no stage skipping — a DRAFT cannot be published past the teacher", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ status: "DRAFT" }));
    await expect(publishSyllabus(PRINCIPAL, "s1")).rejects.toThrow();
  });

  test("a row at TEACHER_REVIEW cannot be published", async () => {
    mockSyllabusFindById.mockReturnValue(docFor({ status: "TEACHER_REVIEW" }));
    await expect(publishSyllabus(PRINCIPAL, "s1")).rejects.toThrow();
  });

  test("publish re-checks the marks rather than trusting write time", async () => {
    const doc = docFor({ status: "PRINCIPAL_REVIEW", marks: NURSERY_ARABIC.slice(0, 2) });
    mockSyllabusFindById.mockReturnValue(doc);
    await expect(publishSyllabus(PRINCIPAL, "s1")).rejects.toThrow(/30|৩০/);
    expect(doc.status).toBe("PRINCIPAL_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// The per-CLASS question-type footer (§5.5)
// ---------------------------------------------------------------------------

describe("saveExamClassNote", () => {
  const input = {
    examId: oid().toString(),
    classId: CLASS,
    questionTypes: ["mcq", "fill_blank", "creative"] as never,
    noteMd: "পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর থাকবে, ইন শা আল্লাহ।",
  };

  beforeEach(() => {
    mockNoteFindOne.mockReturnValue(null);
    mockNoteCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));
  });

  test("a teacher cannot write the class footer", async () => {
    await expect(saveExamClassNote(TEACHER, input)).rejects.toThrow(/অনুমতি নেই/);
  });

  test("Office creates it and the write is audited", async () => {
    await saveExamClassNote(OFFICE, input);
    expect(mockNoteCreate).toHaveBeenCalled();
    expect(mockAudit.mock.calls[0][0].eventKind).toBe("EXAM_CLASS_NOTE_SAVED");
  });

  test("refuses mojibake in the footer — the same D-#523 guard", async () => {
    await expect(
      saveExamClassNote(OFFICE, { ...input, noteMd: "à¦¬à¦¾à¦à¦²à¦¾" }),
    ).rejects.toThrow(/এনকোডিং/);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  test("upserts rather than versioning — a second write updates the same row", async () => {
    const existing = {
      _id: oid(),
      questionTypes: ["mcq"],
      noteMd: "পুরনো",
      updatedBy: null,
      save: jest.fn(async function (this: unknown) {
        return this;
      }),
    };
    mockNoteFindOne.mockReturnValue(existing);
    await saveExamClassNote(OFFICE, input);
    expect(mockNoteCreate).not.toHaveBeenCalled();
    expect(existing.noteMd).toBe(input.noteMd);
    expect(existing.questionTypes).toEqual(["mcq", "fill_blank", "creative"]);
  });

  test("stays writable after the class's first subject has gone for sign-off", async () => {
    // Deliberately NOT gated on the syllabus status machine: the footer states exam
    // FORMAT, not what a teacher must cover, and would otherwise become un-editable
    // the moment one subject advanced.
    mockSyllabusFindById.mockReturnValue(docFor({ status: "PRINCIPAL_REVIEW" }));
    await expect(saveExamClassNote(OFFICE, input)).resolves.toBeDefined();
  });
});
