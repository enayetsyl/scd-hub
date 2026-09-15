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
    // The status GATES are the real thing, not a copy — a mock that restated them
    // would let the service and its test agree with each other and with nothing else.
    CT_QUESTION_EDITABLE: actual.CT_QUESTION_EDITABLE,
    CT_QUESTION_CANCELLABLE: actual.CT_QUESTION_CANCELLABLE,
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
// Only `deleteCtQuestionRequest` reads it — to refuse removing the origin of a
// class test that is still live. Stubbed like every other model here so the
// suite stays DB-free (an unmocked model buffers 10s per call).
const mockClassTestFindById = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: { findById: (id: unknown) => ({ select: () => ({ lean: async () => mockClassTestFindById(id) }) }) },
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
  editCtQuestionRequest,
  cancelCtQuestionRequest,
  deleteCtQuestionRequest,
  myCtQuestionRequests,
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

  test("a withdrawn request is in NEITHER badge bucket", async () => {
    // The badge counts are a to-do list. CANCELLED is nobody's to-do, and it must
    // not be able to arrive in one by falling through a status list.
    mockCountDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    await ctQuestionCounts(null);
    const [pendingQ, inReviewQ] = mockCountDocuments.mock.calls.map((c) => c[0]);
    expect(pendingQ.status.$in).not.toContain("CANCELLED");
    expect(inReviewQ.status).not.toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// Correct / withdraw / remove (owner ask 2026-09-15)
// ---------------------------------------------------------------------------

const edit = (over: Record<string, unknown> = {}) => ({
  id: "req-1",
  chapter: "দশমিক",
  totalMarks: 25,
  durationMinutes: 45,
  examDate: "2026-08-01",
  actorId: TEACHER.toString(),
  ...over,
});

describe("editCtQuestionRequest — correcting a mistake", () => {
  test("updates the four detail fields and leaves the ADDRESS untouched", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    const out = await editCtQuestionRequest(edit());
    expect(doc.chapter).toBe("দশমিক");
    expect(doc.totalMarks).toBe(25);
    expect(doc.durationMinutes).toBe(45);
    expect(new Date(doc.examDate as Date).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    // Subject, section and the auto test number are the request's address.
    expect(doc.subject).toBe("MATH");
    expect(doc.sectionId).toBe(SECTION);
    expect(doc.testNumber).toBe(4);
    expect(doc.save).toHaveBeenCalled();
    expect(out.chapter).toBe("দশমিক");
  });

  test("also allowed from CHANGES_REQUESTED — the office still owes a paper", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "CHANGES_REQUESTED" }));
    await expect(editCtQuestionRequest(edit())).resolves.toBeDefined();
  });

  test.each(["IN_REVIEW", "CONFIRMED", "PRINT_REQUESTED", "CANCELLED"])(
    "refused from %s — a paper already exists or the request is closed",
    async (status) => {
      const doc = madeDoc({ status });
      mockFindById.mockResolvedValue(doc);
      await expect(editCtQuestionRequest(edit())).rejects.toThrow(/সংশোধন/);
      expect(doc.save).not.toHaveBeenCalled();
    },
  );

  test("another teacher cannot edit someone else's request", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await expect(editCtQuestionRequest(edit({ actorId: oid().toString() }))).rejects.toThrow(
      /শুধু অনুরোধকারী/,
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("a soft-deleted row is not editable", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED", active: false }));
    await expect(editCtQuestionRequest(edit())).rejects.toThrow(/পাওয়া যায়নি/);
  });

  test("applies the SAME validation as create — nothing rejected on the way in is settable on the way back", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED" }));
    await expect(editCtQuestionRequest(edit({ chapter: "   " }))).rejects.toThrow(/অধ্যায়/);
    await expect(editCtQuestionRequest(edit({ totalMarks: 0 }))).rejects.toThrow(/পূর্ণমান/);
    await expect(editCtQuestionRequest(edit({ durationMinutes: -5 }))).rejects.toThrow(/সময়/);
    await expect(editCtQuestionRequest(edit({ examDate: "not-a-date" }))).rejects.toThrow(/তারিখ/);
  });

  test("the audit row carries BEFORE and AFTER, and the office is told the spec moved", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED" }));
    await editCtQuestionRequest(edit());
    const audit = mockWriteAudit.mock.calls[0][0];
    expect(audit.eventKind).toBe("CT_QUESTION_EDITED");
    expect(audit.meta.before).toMatchObject({ chapter: "ভগ্নাংশ", totalMarks: 20, durationMinutes: 30 });
    expect(audit.meta.after).toMatchObject({ chapter: "দশমিক", totalMarks: 25, durationMinutes: 45 });
    // The office may be typing the paper against the old spec right now.
    expect(mockEmitOffice).toHaveBeenCalledTimes(1);
  });

  test("two corrections notify TWICE — the dedupe key is not entity-only", async () => {
    // An entity-only key would swallow the second correction and leave the office
    // working from the first one's numbers.
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED" }));
    await editCtQuestionRequest(edit({ totalMarks: 25 }));
    await editCtQuestionRequest(edit({ totalMarks: 30 }));
    const suffixes = mockEmitOffice.mock.calls.map((c) => c[0].dedupeSuffix);
    expect(suffixes).toHaveLength(2);
    expect(suffixes[0]).toMatch(/^edited:/);
    expect(new Set(suffixes).size).toBe(2);
  });
});

describe("cancelCtQuestionRequest — the teacher withdraws", () => {
  test.each(["REQUESTED", "IN_REVIEW", "CHANGES_REQUESTED"])(
    "allowed from %s — nothing is confirmed or at the press yet",
    async (status) => {
      const doc = madeDoc({ status });
      mockFindById.mockResolvedValue(doc);
      const out = await cancelCtQuestionRequest({ id: "r", reason: "ভুল অধ্যায়", actorId: TEACHER.toString() });
      expect(doc.status).toBe("CANCELLED");
      expect(doc.cancelledBy).toBeDefined();
      expect(doc.cancelledAt).toBeInstanceOf(Date);
      expect(doc.cancelReason).toBe("ভুল অধ্যায়");
      expect(out.status).toBe("CANCELLED");
      expect(out.cancelReason).toBe("ভুল অধ্যায়");
    },
  );

  test.each(["CONFIRMED", "PRINT_REQUESTED"])("refused from %s — the office's call by then", async (status) => {
    const doc = madeDoc({ status });
    mockFindById.mockResolvedValue(doc);
    await expect(cancelCtQuestionRequest({ id: "r", actorId: TEACHER.toString() })).rejects.toThrow(/অফিসে জানান/);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("cancelling twice is refused, not silently re-stamped", async () => {
    const doc = madeDoc({ status: "CANCELLED" });
    mockFindById.mockResolvedValue(doc);
    await expect(cancelCtQuestionRequest({ id: "r", actorId: TEACHER.toString() })).rejects.toThrow(/আগেই বাতিল/);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("another teacher cannot withdraw someone else's request", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await expect(cancelCtQuestionRequest({ id: "r", actorId: oid().toString() })).rejects.toThrow(
      /শুধু অনুরোধকারী/,
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("an empty reason stores null, not an empty string", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await cancelCtQuestionRequest({ id: "r", reason: "   ", actorId: TEACHER.toString() });
    expect(doc.cancelReason).toBeNull();
  });

  test("the row STAYS — a withdrawal is not a delete", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await cancelCtQuestionRequest({ id: "r", actorId: TEACHER.toString() });
    // The office may already be working on it; a card that silently vanishes is
    // strictly worse for them than one that says it was withdrawn.
    expect(doc.active).toBe(true);
    expect(mockEmitOffice).toHaveBeenCalledTimes(1);
    expect(mockEmitOffice.mock.calls[0][0].dedupeSuffix).toBe("cancelled");
    expect(mockWriteAudit.mock.calls[0][0].eventKind).toBe("CT_QUESTION_CANCELLED");
    expect(mockWriteAudit.mock.calls[0][0].meta.previousStatus).toBe("REQUESTED");
  });

  test("a withdrawn request can receive no further office round", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "CANCELLED" }));
    await expect(
      sendCtQuestionForReview({ id: "r", fileId: FILE.toString(), actorId: OFFICE.toString() }),
    ).rejects.toThrow(/বাতিল/);
  });
});

describe("deleteCtQuestionRequest — the office removes a row", () => {
  test("soft-deletes via active:false and stamps who/when/why", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await expect(
      deleteCtQuestionRequest({ id: "r", reason: "ভুল করে জমা", actorId: OFFICE.toString() }),
    ).resolves.toBe(true);
    expect(doc.active).toBe(false);
    expect(doc.deletedBy).toBeDefined();
    expect(doc.deletedAt).toBeInstanceOf(Date);
    expect(doc.deleteReason).toBe("ভুল করে জমা");
    expect(mockWriteAudit.mock.calls[0][0].eventKind).toBe("CT_QUESTION_DELETED");
  });

  test("the requesting teacher is TOLD — their card is about to vanish", async () => {
    const doc = madeDoc({ status: "REQUESTED" });
    mockFindById.mockResolvedValue(doc);
    await deleteCtQuestionRequest({ id: "r", actorId: OFFICE.toString() });
    expect(mockEmitTeacher).toHaveBeenCalledTimes(1);
    expect(mockEmitTeacher.mock.calls[0][0]).toBe(TEACHER.toString());
    expect(mockEmitTeacher.mock.calls[0][1].dedupeSuffix).toBe("deleted");
  });

  test("a WITHDRAWN row can still be deleted — the two verbs compose", async () => {
    const doc = madeDoc({ status: "CANCELLED" });
    mockFindById.mockResolvedValue(doc);
    await expect(deleteCtQuestionRequest({ id: "r", actorId: OFFICE.toString() })).resolves.toBe(true);
    expect(doc.active).toBe(false);
  });

  test("refused while a LIVE class test hangs off the request", async () => {
    const doc = madeDoc({ status: "PRINT_REQUESTED", classTestId: oid() });
    mockFindById.mockResolvedValue(doc);
    mockClassTestFindById.mockResolvedValue({ status: "REQUESTED" });
    await expect(deleteCtQuestionRequest({ id: "r", actorId: OFFICE.toString() })).rejects.toThrow(
      /প্রিন্ট সারি/,
    );
    // Hiding the origin while the press still has the job would leave a paper
    // being printed against a request nobody can trace.
    expect(doc.active).toBe(true);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("allowed once that class test is itself CANCELLED", async () => {
    const doc = madeDoc({ status: "PRINT_REQUESTED", classTestId: oid() });
    mockFindById.mockResolvedValue(doc);
    mockClassTestFindById.mockResolvedValue({ status: "CANCELLED" });
    await expect(deleteCtQuestionRequest({ id: "r", actorId: OFFICE.toString() })).resolves.toBe(true);
    expect(doc.active).toBe(false);
  });

  test("deleting an already-deleted row is refused", async () => {
    mockFindById.mockResolvedValue(madeDoc({ status: "REQUESTED", active: false }));
    await expect(deleteCtQuestionRequest({ id: "r", actorId: OFFICE.toString() })).rejects.toThrow(
      /পাওয়া যায়নি/,
    );
  });
});

describe("the soft-delete flag is honoured by the LISTS, not just the writes", () => {
  test("both lists filter active", async () => {
    mockFind.mockResolvedValue([]);
    await myCtQuestionRequests(TEACHER.toString());
    expect(mockFind.mock.calls[0][0].active).toEqual({ $ne: false });
    mockFind.mockResolvedValue([]);
    await ctQuestionQueue();
    expect(mockFind.mock.calls[1][0].active).toEqual({ $ne: false });
  });
});
