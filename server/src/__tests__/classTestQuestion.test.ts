/**
 * CT question-request tests (owner ask 2026-07-20) — the office-produced
 * question-paper loop in front of the existing class-test print path.
 *
 * Create — every field mandatory (chapter/marks/duration/date validated);
 *          year/level derived from the section; test number auto-suggested.
 * Rounds — office send requires a classtest_question file; locked after CONFIRMED.
 * Review — row-gated to the requester; only from IN_REVIEW; changes need a
 *          comment; approve locks (CONFIRMED + confirmedAt).
 * Print  — only the requester, only from CONFIRMED; calls the EXISTING
 *          createRequest with the office file + allowForeignQuestionFile and
 *          flips to PRINT_REQUESTED with the ClassTest linked.
 *
 * DB-free (repo convention): models + audit + ClassTestService are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockFind = jest.fn();
const mockExists = jest.fn();
const mockCountDocuments = jest.fn();
jest.mock("../modules/trackers/models/ClassTestQuestionRequest", () => {
  const actual = jest.requireActual("../modules/trackers/models/ClassTestQuestionRequest");
  return {
    CT_QUESTION_STATUSES: actual.CT_QUESTION_STATUSES,
    ClassTestQuestionRequest: {
      create: (d: unknown) => mockCreate(d),
      findById: (id: unknown) => mockFindById(id),
      find: (q: unknown) => ({ lean: async () => mockFind(q) }),
      exists: (q: unknown) => mockExists(q),
      countDocuments: (q: unknown) => mockCountDocuments(q),
    },
  };
});
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => ({ select: () => ({ lean: async () => mockSectionFindById(id) }) }) },
}));
const mockClassFindById = jest.fn();
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { findById: (id: unknown) => ({ select: () => ({ lean: async () => mockClassFindById(id) }) }) },
}));
const mockUserFind = jest.fn();
const mockUserFindById = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    find: (q: unknown) => ({ select: () => ({ lean: async () => mockUserFind(q) }) }),
    findById: (id: unknown) => ({ select: () => ({ lean: async () => mockUserFindById(id) }) }),
  },
}));
const mockStoredFileFindById = jest.fn();
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { findById: (id: unknown) => ({ lean: async () => mockStoredFileFindById(id) }) },
}));
const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));
const mockSuggestTestNumber = jest.fn();
const mockCreateRequest = jest.fn();
jest.mock("../modules/trackers/services/ClassTestService", () => ({
  suggestTestNumber: (...a: unknown[]) => mockSuggestTestNumber(...a),
  createRequest: (i: unknown) => mockCreateRequest(i),
}));
// D-#342: stage notifications — teacher on send-for-review, office otherwise.
const mockEmitTeacher = jest.fn();
const mockEmitOffice = jest.fn();
const mockEmitUpcoming = jest.fn();
jest.mock("../modules/notifications/services/emitters", () => ({
  emitCtQuestionTeacher: (id: unknown, e: unknown) => mockEmitTeacher(id, e),
  emitCtQuestionOffice: (e: unknown) => mockEmitOffice(e),
  // D-#472: send-to-print also tells the family what is coming.
  emitClassTestUpcoming: (e: unknown) => mockEmitUpcoming(e),
}));

import {
  createCtQuestionRequest,
  sendCtQuestionForReview,
  reviewCtQuestion,
  requestCtQuestionPrint,
  ctQuestionQueue,
  ctQuestionCounts,
} from "../modules/trackers/services/ClassTestQuestionService";

const TEACHER = oid();
const OFFICE = oid();
const SECTION = oid();
const CLASS = oid();
const YEAR = oid();
const FILE = oid();

const validCreate = () => ({
  sectionId: SECTION.toString(),
  subject: "MATH",
  chapter: "ভগ্নাংশ",
  totalMarks: 20,
  durationMinutes: 30,
  examDate: "2026-07-24",
  actorId: TEACHER.toString(),
});

const madeDoc = (over: Record<string, unknown> = {}) => {
  const doc: Record<string, unknown> = {
    _id: oid(),
    academicYearId: YEAR,
    classLevel: 3,
    classId: CLASS,
    sectionId: SECTION,
    subject: "MATH",
    chapter: "ভগ্নাংশ",
    testNumber: 4,
    totalMarks: 20,
    durationMinutes: 30,
    examDate: new Date("2026-07-24"),
    status: "REQUESTED",
    rounds: [] as unknown[],
    currentFileId: null,
    requestedBy: TEACHER,
    requestedAt: new Date(),
    confirmedAt: null,
    classTestId: null,
    active: true,
    markModified: jest.fn(),
    save: jest.fn(async () => undefined),
    ...over,
  };
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSectionFindById.mockReturnValue({ classId: CLASS });
  mockClassFindById.mockReturnValue({ level: 3, academicYearId: YEAR });
  mockSuggestTestNumber.mockResolvedValue(4);
  mockCreate.mockImplementation(async (d: Record<string, unknown>) => madeDoc(d));
  mockStoredFileFindById.mockReturnValue({ kind: "classtest_question" });
  mockUserFind.mockReturnValue([{ _id: TEACHER, name: "Nuha" }]);
  mockUserFindById.mockReturnValue({ name: "Nuha" });
});

describe("createCtQuestionRequest — mandatory fields + derivation", () => {
  test("rejects an empty chapter, non-positive marks/duration, bad date", async () => {
    await expect(createCtQuestionRequest({ ...validCreate(), chapter: "  " })).rejects.toThrow(/অধ্যায়/);
    await expect(createCtQuestionRequest({ ...validCreate(), totalMarks: 0 })).rejects.toThrow(/পূর্ণমান/);
    await expect(createCtQuestionRequest({ ...validCreate(), durationMinutes: 0 })).rejects.toThrow(/সময়/);
    await expect(createCtQuestionRequest({ ...validCreate(), examDate: "nope" })).rejects.toThrow(/তারিখ/);
  });

  test("derives level/year from the section, auto test number, REQUESTED + audit + office notify", async () => {
    const out = await createCtQuestionRequest(validCreate());
    expect(mockSuggestTestNumber).toHaveBeenCalledWith(YEAR.toString(), 3, "MATH");
    expect(out.status).toBe("REQUESTED");
    expect(out.testNumber).toBe(4);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CT_QUESTION_REQUESTED" }));
    expect(mockEmitOffice).toHaveBeenCalledWith(expect.objectContaining({ dedupeSuffix: "new" }));
  });
});

describe("sendCtQuestionForReview — office rounds", () => {
  test("requires a classtest_question file", async () => {
    mockFindById.mockResolvedValue(madeDoc());
    mockStoredFileFindById.mockReturnValue({ kind: "print_upload" });
    await expect(
      sendCtQuestionForReview({ id: "x", fileId: FILE.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/প্রশ্নপত্র নয়/);
  });

  test("pushes a round, sets currentFileId, IN_REVIEW + audit; repeatable after CHANGES_REQUESTED", async () => {
    const doc = madeDoc({ status: "CHANGES_REQUESTED", rounds: [{ fileId: oid(), sentBy: OFFICE, sentAt: new Date() }] });
    mockFindById.mockResolvedValue(doc);
    const out = await sendCtQuestionForReview({ id: "x", fileId: FILE.toString(), note: "নতুন সংস্করণ", actorId: OFFICE.toString() });
    expect(out.status).toBe("IN_REVIEW");
    expect(out.rounds).toHaveLength(2);
    expect(out.currentFileId).toBe(FILE.toString());
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CT_QUESTION_SENT_FOR_REVIEW" }));
    // The requesting teacher is told a round awaits them — round-unique dedupe.
    expect(mockEmitTeacher).toHaveBeenCalledWith(
      TEACHER.toString(),
      expect.objectContaining({ dedupeSuffix: "review:r2" }),
    );
  });

  test("a CONFIRMED request refuses new rounds (locked)", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "CONFIRMED" }));
    await expect(
      sendCtQuestionForReview({ id: "x", fileId: FILE.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/চূড়ান্ত/);
  });
});

describe("reviewCtQuestion — teacher verdict", () => {
  const inReview = () =>
    madeDoc({ status: "IN_REVIEW", currentFileId: FILE, rounds: [{ fileId: FILE, sentBy: OFFICE, sentAt: new Date(), teacherComment: null, respondedAt: null }] });

  test("only the requester may review", async () => {
    mockFindById.mockResolvedValue(inReview());
    await expect(reviewCtQuestion({ id: "x", approve: true, actorId: oid().toString() })).rejects.toThrow(/অনুরোধকারী/);
  });

  test("only IN_REVIEW is reviewable", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED" }));
    await expect(reviewCtQuestion({ id: "x", approve: true, actorId: TEACHER.toString() })).rejects.toThrow(/সংস্করণ নেই/);
  });

  test("changes-requested needs a comment; the round is stamped", async () => {
    const doc = inReview();
    mockFindById.mockResolvedValue(doc);
    await expect(
      reviewCtQuestion({ id: "x", approve: false, comment: " ", actorId: TEACHER.toString() }),
    ).rejects.toThrow(/লিখুন/);
    const out = await reviewCtQuestion({ id: "x", approve: false, comment: "২ নম্বর প্রশ্ন বদলান", actorId: TEACHER.toString() });
    expect(out.status).toBe("CHANGES_REQUESTED");
    expect(out.rounds[0].teacherComment).toBe("২ নম্বর প্রশ্ন বদলান");
    expect(mockEmitOffice).toHaveBeenCalledWith(
      expect.objectContaining({ bodyBn: expect.stringContaining("২ নম্বর প্রশ্ন বদলান") }),
    );
  });

  test("approve locks: CONFIRMED + confirmedAt", async () => {
    mockFindById.mockResolvedValue(inReview());
    const out = await reviewCtQuestion({ id: "x", approve: true, actorId: TEACHER.toString() });
    expect(out.status).toBe("CONFIRMED");
    expect(out.confirmedAt).toBeTruthy();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "CT_QUESTION_REVIEWED" }));
  });
});

describe("requestCtQuestionPrint — the existing path takes over", () => {
  test("only from CONFIRMED, only the requester", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "IN_REVIEW", currentFileId: FILE }));
    await expect(requestCtQuestionPrint({ id: "x", actorId: TEACHER.toString() })).rejects.toThrow(/চূড়ান্ত নিশ্চিত/);
    mockFindById.mockResolvedValue(madeDoc({ status: "CONFIRMED", currentFileId: FILE }));
    await expect(requestCtQuestionPrint({ id: "x", actorId: oid().toString() })).rejects.toThrow(/অনুরোধকারী/);
  });

  test("files the standard ClassTest with the office file + waived ownership, links it, PRINT_REQUESTED", async () => {
    const doc = madeDoc({ status: "CONFIRMED", currentFileId: FILE });
    mockFindById.mockResolvedValue(doc);
    const ctDbId = oid().toString();
    mockCreateRequest.mockResolvedValue({ id: ctDbId, ctId: "CT-C3-MATH-0007" });
    const out = await requestCtQuestionPrint({
      id: "x",
      colour: "BW",
      sides: "SINGLE",
      copiesMode: "CLASS_PRESENT",
      actorId: TEACHER.toString(),
    });
    expect(mockCreateRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "UPLOADED_PAPER",
        questionFileId: FILE.toString(),
        allowForeignQuestionFile: true,
        testNumber: 4,
        copiesMode: "CLASS_PRESENT",
        notes: expect.stringContaining("ভগ্নাংশ"),
      }),
    );
    expect(out.request.status).toBe("PRINT_REQUESTED");
    expect(out.request.classTestId).toBe(ctDbId);
    expect(out.classTest.ctId).toBe("CT-C3-MATH-0007");

    // D-#472: the family is told at exactly this moment, and the notice carries the
    // four things a parent needs to act on — subject, chapter, date, marks/minutes.
    expect(mockEmitUpcoming).toHaveBeenCalledTimes(1);
    const notice = mockEmitUpcoming.mock.calls[0][0] as {
      testId: string;
      sectionId: string;
      titleBn: string;
      bodyBn: string;
    };
    expect(notice.testId).toBe(ctDbId);
    expect(notice.sectionId).toBe(SECTION.toString());
    expect(notice.bodyBn).toContain("ভগ্নাংশ"); // chapter
    expect(notice.bodyBn).toContain("২০২৬-০৭-২৪"); // exam date, Bangla digits
    expect(notice.bodyBn).toContain("২০"); // total marks
    expect(notice.bodyBn).toContain("৩০"); // duration minutes
  });

  test("a paper that never reaches print tells NO family (the notice rides send-to-print only)", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "IN_REVIEW", currentFileId: FILE }));
    await expect(requestCtQuestionPrint({ id: "x", actorId: TEACHER.toString() })).rejects.toThrow(/চূড়ান্ত/);
    expect(mockEmitUpcoming).not.toHaveBeenCalled();
  });
});

describe("ctQuestionQueue", () => {
  test("work-needed first with teacher names joined", async () => {
    mockFind.mockReturnValue([
      madeDoc({ status: "PRINT_REQUESTED" }),
      madeDoc({ status: "REQUESTED" }),
      madeDoc({ status: "IN_REVIEW" }),
      madeDoc({ status: "CHANGES_REQUESTED" }),
    ]);
    const rows = await ctQuestionQueue();
    expect(rows.map((r) => r.status)).toEqual(["REQUESTED", "CHANGES_REQUESTED", "IN_REVIEW", "PRINT_REQUESTED"]);
    expect(rows[0].requesterName).toBe("Nuha");
  });
});

describe("ctQuestionCounts (drawer badges, owner 2026-07-25)", () => {
  test("pending = REQUESTED + CHANGES_REQUESTED; inReview = IN_REVIEW; office-wide (no owner filter)", async () => {
    // countDocuments called twice: [pending, inReview].
    mockCountDocuments.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const counts = await ctQuestionCounts(null);
    expect(counts).toEqual({ pending: 5, inReview: 2 });
    // pending query is the two office-owed statuses; neither query carries requestedBy.
    const pendingQ = mockCountDocuments.mock.calls[0][0];
    expect(pendingQ.status).toEqual({ $in: ["REQUESTED", "CHANGES_REQUESTED"] });
    expect(pendingQ.requestedBy).toBeUndefined();
  });

  test("teacher scope filters by requestedBy", async () => {
    mockCountDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await ctQuestionCounts("teacher-123");
    expect(mockCountDocuments.mock.calls[0][0].requestedBy).toBe("teacher-123");
    expect(mockCountDocuments.mock.calls[1][0]).toMatchObject({ requestedBy: "teacher-123", status: "IN_REVIEW" });
  });
});
