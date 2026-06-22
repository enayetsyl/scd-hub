/**
 * Student Comments CM-1 tests (prd-comments-meetings §3/§4/§6, D-#114/#115).
 *
 * Vocab     — COMMENT_TYPES / COMMENT_SENTIMENTS label totality (BN + EN).
 * Service   — recordComment (type/sentiment/text validation, audited
 *             STUDENT_COMMENT_RECORDED); editComment (AUTHOR-ONLY, REFUSED once
 *             delivered — immutable §3); resolveCommentSection (real section from
 *             the student, never client-supplied; rejects missing/inactive).
 * RBAC      — the write gate (assertCanWrite) denies OFFICE (records belong to the
 *             teacher) + GUARDIAN; the read gate (assertCanRead) denies GUARDIAN.
 *
 * DB-free (the repo convention): models + audit are mocked.
 */
import mongoose from "mongoose";
import {
  COMMENT_TYPES,
  COMMENT_TYPE_LABELS_BN,
  COMMENT_TYPE_LABELS_EN,
  COMMENT_SENTIMENTS,
  COMMENT_SENTIMENT_LABELS_BN,
  COMMENT_SENTIMENT_LABELS_EN,
} from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the modules under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockFind = jest.fn();
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: {
    create: (doc: unknown) => mockCreate(doc),
    findById: (id: unknown) => mockFindById(id),
    find: (q: unknown) => mockFind(q),
  },
}));

const mockStudentFindById = jest.fn();
const mockStudentFind = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => mockStudentFindById(id), find: (q: unknown) => mockStudentFind(q) },
}));

const mockUserFind = jest.fn();
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// Import AFTER mocks
import {
  resolveCommentSection,
  recordComment,
  editComment,
  studentComments,
  myComments,
  reviewInbox,
  StudentCommentError,
} from "../modules/comments/services/StudentCommentService";
import { assertCanWrite, assertCanRead, ForbiddenError } from "../middleware/authz";
import type { AppContext } from "../context";

const SECTION_OID = oid();
const STUDENT_OID = oid();
const TEACHER_ID = oid().toString();

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
});

// ===========================================================================
// Vocab label totality (§4)
// ===========================================================================

describe("COMMENT_TYPES / COMMENT_SENTIMENTS vocab", () => {
  test("every comment type has a BN + EN label", () => {
    for (const k of COMMENT_TYPES) {
      expect(COMMENT_TYPE_LABELS_BN[k]).toBeTruthy();
      expect(COMMENT_TYPE_LABELS_EN[k]).toBeTruthy();
    }
    expect(Object.keys(COMMENT_TYPE_LABELS_BN).sort()).toEqual([...COMMENT_TYPES].sort());
    expect(Object.keys(COMMENT_TYPE_LABELS_EN).sort()).toEqual([...COMMENT_TYPES].sort());
  });

  test("every comment sentiment has a BN + EN label", () => {
    for (const k of COMMENT_SENTIMENTS) {
      expect(COMMENT_SENTIMENT_LABELS_BN[k]).toBeTruthy();
      expect(COMMENT_SENTIMENT_LABELS_EN[k]).toBeTruthy();
    }
    expect(Object.keys(COMMENT_SENTIMENT_LABELS_BN).sort()).toEqual([...COMMENT_SENTIMENTS].sort());
    expect(Object.keys(COMMENT_SENTIMENT_LABELS_EN).sort()).toEqual([...COMMENT_SENTIMENTS].sort());
  });
});

// ===========================================================================
// myComments — the caller's OWN comments, enriched with the child's name (D-#263)
// ===========================================================================

describe("myComments (see the comments they made)", () => {
  test("returns only the caller's comments, newest first, with student names joined", async () => {
    const author = oid();
    const stuA = oid();
    const stuB = oid();
    mockFind.mockReturnValue(
      leanChain([
        { _id: oid(), studentId: stuA, sectionId: SECTION_OID, authorUserId: author, type: COMMENT_TYPES[0], sentiment: COMMENT_SENTIMENTS[0], text: "c1", attachmentIds: [], deliveryChannels: [], createdAt: new Date(2), updatedAt: new Date(2) },
        { _id: oid(), studentId: stuB, sectionId: SECTION_OID, authorUserId: author, type: COMMENT_TYPES[0], sentiment: COMMENT_SENTIMENTS[0], text: "c2", attachmentIds: [], deliveryChannels: [], createdAt: new Date(1), updatedAt: new Date(1) },
      ]),
    );
    mockStudentFind.mockReturnValue(leanChain([{ _id: stuA, name: "Abdullah" }, { _id: stuB, name: "Unaisha" }]));

    const res = await myComments(author.toString());

    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ authorUserId: expect.anything() }));
    expect(mockFind.mock.calls[0][0]).not.toHaveProperty("studentId"); // no student filter
    expect(res).toHaveLength(2);
    expect(res[0].studentName).toBe("Abdullah");
    expect(res[1].studentName).toBe("Unaisha");
  });

  test("filters to one student when studentId is given; no DB hit when none authored", async () => {
    const author = oid();
    mockFind.mockReturnValue(leanChain([]));
    const res = await myComments(author.toString(), STUDENT_OID.toString());
    expect(mockFind.mock.calls[0][0]).toHaveProperty("studentId");
    expect(res).toEqual([]);
    expect(mockStudentFind).not.toHaveBeenCalled(); // no names looked up for an empty set
  });
});

// ===========================================================================
// resolveCommentSection — the section is ALWAYS server-derived (D-#115)
// ===========================================================================

describe("resolveCommentSection", () => {
  test("returns the student's real section", async () => {
    mockStudentFindById.mockReturnValue(leanChain({ sectionId: SECTION_OID, active: true }));
    expect(await resolveCommentSection(STUDENT_OID.toString())).toBe(SECTION_OID.toString());
  });

  test("rejects a missing student", async () => {
    mockStudentFindById.mockReturnValue(leanChain(null));
    await expect(resolveCommentSection(STUDENT_OID.toString())).rejects.toBeInstanceOf(StudentCommentError);
  });

  test("rejects an inactive student", async () => {
    mockStudentFindById.mockReturnValue(leanChain({ sectionId: SECTION_OID, active: false }));
    await expect(resolveCommentSection(STUDENT_OID.toString())).rejects.toThrow(/not active/);
  });

  test("rejects an invalid id without touching the DB", async () => {
    await expect(resolveCommentSection("not-an-id")).rejects.toThrow(/Invalid student id/);
    expect(mockStudentFindById).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// recordComment (J-CM1; NO delivery)
// ===========================================================================

describe("recordComment", () => {
  beforeEach(() => {
    mockCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
      _id: oid(),
      ...doc,
      attachmentIds: doc.attachmentIds ?? [],
      deliveryChannels: doc.deliveryChannels ?? [],
      createdAt: new Date("2026-06-14T00:00:00Z"),
      updatedAt: new Date("2026-06-14T00:00:00Z"),
    }));
  });

  test("stores a comment + audits STUDENT_COMMENT_RECORDED; not delivered", async () => {
    const res = await recordComment({
      studentId: STUDENT_OID.toString(),
      sectionId: SECTION_OID.toString(),
      type: "BEHAVIOUR",
      sentiment: "CONCERN",
      text: "Disrupted the class today.",
      actorId: TEACHER_ID,
    });
    expect(res).toMatchObject({
      type: "BEHAVIOUR",
      sentiment: "CONCERN",
      text: "Disrupted the class today.",
      authorUserId: TEACHER_ID,
      deliveredAt: null,
      deliveryChannels: [],
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STUDENT_COMMENT_RECORDED", targetKind: "StudentComment" }),
    );
  });

  test("trims text and rejects an empty body", async () => {
    await expect(
      recordComment({
        studentId: STUDENT_OID.toString(),
        sectionId: SECTION_OID.toString(),
        type: "GENERAL",
        sentiment: "POSITIVE",
        text: "   ",
        actorId: TEACHER_ID,
      }),
    ).rejects.toThrow(/text is required/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rejects an unknown type / sentiment", async () => {
    await expect(
      recordComment({ studentId: STUDENT_OID.toString(), sectionId: SECTION_OID.toString(), type: "NOPE", sentiment: "CONCERN", text: "x", actorId: TEACHER_ID }),
    ).rejects.toThrow(/type must be one of/);
    await expect(
      recordComment({ studentId: STUDENT_OID.toString(), sectionId: SECTION_OID.toString(), type: "GENERAL", sentiment: "MEH", text: "x", actorId: TEACHER_ID }),
    ).rejects.toThrow(/sentiment must be one of/);
  });
});

// ===========================================================================
// editComment (AUTHOR-ONLY, REFUSED once delivered — §3)
// ===========================================================================

describe("editComment", () => {
  const makeDoc = (over: Record<string, unknown> = {}) => {
    const doc: Record<string, unknown> = {
      _id: STUDENT_OID,
      studentId: STUDENT_OID,
      sectionId: SECTION_OID,
      authorUserId: new mongoose.Types.ObjectId(TEACHER_ID),
      type: "GENERAL",
      sentiment: "POSITIVE",
      text: "Original.",
      attachmentIds: [],
      deliveryChannels: [],
      deliveredAt: undefined,
      createdAt: new Date("2026-06-14T00:00:00Z"),
      updatedAt: new Date("2026-06-14T00:00:00Z"),
      ...over,
    };
    doc.save = jest.fn(async () => doc);
    return doc;
  };

  test("the author can edit an undelivered comment + it is audited (edited)", async () => {
    const doc = makeDoc();
    mockFindById.mockResolvedValue(doc);
    const res = await editComment({ commentId: STUDENT_OID.toString(), text: "Updated.", actorId: TEACHER_ID });
    expect(res.text).toBe("Updated.");
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STUDENT_COMMENT_RECORDED", meta: expect.objectContaining({ edited: true }) }),
    );
  });

  test("a non-author is refused", async () => {
    mockFindById.mockResolvedValue(makeDoc());
    await expect(
      editComment({ commentId: STUDENT_OID.toString(), text: "Hijack.", actorId: oid().toString() }),
    ).rejects.toThrow(/only the comment's author/i);
  });

  test("a reviewer (Principal/Office) may edit a NON-author's undelivered comment (D-#264)", async () => {
    const doc = makeDoc();
    mockFindById.mockResolvedValue(doc);
    const res = await editComment({
      commentId: STUDENT_OID.toString(),
      text: "Reviewer tidy-up.",
      actorId: oid().toString(), // not the author
      actorIsReviewer: true,
    });
    expect(res.text).toBe("Reviewer tidy-up.");
    expect((doc.save as jest.Mock)).toHaveBeenCalled();
  });

  test("a reviewer still cannot edit a DELIVERED comment (sealed)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ deliveredAt: new Date("2026-06-14T01:00:00Z") }));
    await expect(
      editComment({ commentId: STUDENT_OID.toString(), text: "Too late.", actorId: oid().toString(), actorIsReviewer: true }),
    ).rejects.toThrow(/immutable/);
  });

  test("a DELIVERED comment is immutable (§3)", async () => {
    mockFindById.mockResolvedValue(makeDoc({ deliveredAt: new Date("2026-06-14T01:00:00Z") }));
    await expect(
      editComment({ commentId: STUDENT_OID.toString(), text: "Too late.", actorId: TEACHER_ID }),
    ).rejects.toThrow(/immutable/);
  });

  test("a missing comment throws", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(
      editComment({ commentId: STUDENT_OID.toString(), text: "x", actorId: TEACHER_ID }),
    ).rejects.toBeInstanceOf(StudentCommentError);
  });
});

// ===========================================================================
// reviewInbox — the Principal/Office review dashboard (D-#264)
// ===========================================================================

describe("reviewInbox (Principal/Office dashboard)", () => {
  test("returns undelivered comments newest-first, with student + author names joined", async () => {
    const stu = oid();
    const author = oid();
    mockFind.mockReturnValue(
      leanChain([
        { _id: oid(), studentId: stu, sectionId: SECTION_OID, authorUserId: author, type: "GENERAL", sentiment: "CONCERN", text: "asfd", attachmentIds: [], deliveryChannels: [], createdAt: new Date(2), updatedAt: new Date(2) },
      ]),
    );
    mockStudentFind.mockReturnValue(leanChain([{ _id: stu, name: "Abdullah Al Anas" }]));
    mockUserFind.mockReturnValue(leanChain([{ _id: author, name: "Md Teacher" }]));

    const rows = await reviewInbox();
    expect(mockFind).toHaveBeenCalledWith({ deliveredAt: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe("Abdullah Al Anas");
    expect(rows[0].authorName).toBe("Md Teacher");
    expect(rows[0].text).toBe("asfd");
  });

  test("no undelivered comments → [] (no name lookups)", async () => {
    mockFind.mockReturnValue(leanChain([]));
    const rows = await reviewInbox();
    expect(rows).toEqual([]);
    expect(mockStudentFind).not.toHaveBeenCalled();
    expect(mockUserFind).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Reads
// ===========================================================================

describe("studentComments (staff timeline)", () => {
  test("returns the child's history newest-first shape", async () => {
    mockFind.mockReturnValue(
      leanChain([
        {
          _id: oid(), studentId: STUDENT_OID, sectionId: SECTION_OID, authorUserId: new mongoose.Types.ObjectId(TEACHER_ID),
          type: "ATTENDANCE", sentiment: "CONCERN", text: "Late again.", attachmentIds: [], deliveryChannels: ["wa"],
          deliveredAt: new Date("2026-06-13T00:00:00Z"), createdAt: new Date("2026-06-13T00:00:00Z"), updatedAt: new Date("2026-06-13T00:00:00Z"),
        },
      ]),
    );
    const rows = await studentComments(STUDENT_OID.toString());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "ATTENDANCE", sentiment: "CONCERN", deliveryChannels: ["wa"] });
    expect(rows[0].deliveredAt).toBe(new Date("2026-06-13T00:00:00Z").toISOString());
  });
});

// ===========================================================================
// RBAC deny-paths — the comment gates compose existing perms (D-#17/#94)
// ===========================================================================

describe("RBAC deny-paths (record / edit / read gates)", () => {
  const ctxOf = (role: string): AppContext =>
    ({ auth: { userId: oid().toString(), role } } as unknown as AppContext);

  test("the write gate (assertCanWrite) denies OFFICE", async () => {
    await expect(assertCanWrite(ctxOf("OFFICE"), SECTION_OID.toString())).rejects.toThrow(ForbiddenError);
  });

  test("the write gate denies GUARDIAN", async () => {
    await expect(assertCanWrite(ctxOf("GUARDIAN"), SECTION_OID.toString())).rejects.toThrow(ForbiddenError);
  });

  test("PRINCIPAL passes the write gate (unscoped admin)", async () => {
    await expect(assertCanWrite(ctxOf("PRINCIPAL"), SECTION_OID.toString())).resolves.toBeUndefined();
  });

  test("the read gate (assertCanRead) denies GUARDIAN", async () => {
    await expect(
      assertCanRead(ctxOf("GUARDIAN"), SECTION_OID.toString(), oid().toString()),
    ).rejects.toThrow(ForbiddenError);
  });
});
