/**
 * Student Comments CM-2 tests (prd-comments-meetings §5/§6, J-CM1, D-#172).
 *
 * Delivery   — deliverComment: stamps deliveredAt (sealing CM-1 immutability) +
 *              deliveryChannels; wa.me for EVERY family with a phone (ADR-003) +
 *              emit() inbox for login-enabled guardians; phone-less → unreachableByWa;
 *              contact-only (no login guardian) → wa.me-only; re-deliver keeps the
 *              original deliveredAt; the body renders byte-identically to the
 *              student_comment.notify.body MT default; audits STUDENT_COMMENT_DELIVERED.
 * Emitter    — emitStudentComment is the single inbox door (kind STUDENT_COMMENT,
 *              dedupeKey per comment+guardian) + a kind-gated no-op fallback (§4.1/D-#94).
 * Files      — validateCommentUpload (MIME whitelist + 10 MB cap); the GET read gate
 *              (author any state / guardian of a DELIVERED comment / everyone else denied).
 *
 * DB-free (the repo convention): models + the emit() door + audit are mocked; the real
 * emitter + renderTemplate run (renderTemplate falls back to the code-default registry).
 */
import mongoose from "mongoose";
import { COMMENT_TYPE_LABELS_BN } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

// --- Mocks (BEFORE importing the modules under test) ------------------------

const mockSCFindById = jest.fn();
const mockSCUpdateOne = jest.fn();
jest.mock("../modules/comments/models/StudentComment", () => ({
  StudentComment: {
    findById: (id: unknown) => mockSCFindById(id),
    updateOne: (...a: unknown[]) => mockSCUpdateOne(...a),
  },
}));

const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => mockStudentFindById(id) },
}));

// The real emitStudentComment runs (so the dedupeKey + login-enabled filter are
// exercised); only the single emit() door + the leaf models are mocked.
const mockEmit = jest.fn();
jest.mock("../modules/notifications/services/NotificationService", () => ({
  emit: (i: unknown) => mockEmit(i),
}));
const mockLinkFind = jest.fn();
jest.mock("../modules/foundation/models/GuardianLink", () => ({
  GuardianLink: { find: (q: unknown) => mockLinkFind(q) },
}));
const mockGuardianFind = jest.fn();
jest.mock("../modules/foundation/models/Guardian", () => ({
  Guardian: { find: (q: unknown) => mockGuardianFind(q) },
}));

const mockWriteAudit = jest.fn();
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockWriteAudit(e),
}));

// The comment-file read gate calls assertGuardianOfStudent — controllable here; the
// real ForbiddenError so instanceof checks hold.
class ForbiddenError extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
const mockAssertGuardian = jest.fn();
jest.mock("../middleware/authz", () => ({
  ForbiddenError,
  assertGuardianOfStudent: (...a: unknown[]) => mockAssertGuardian(...a),
}));

// Import AFTER mocks
import { deliverComment, commentWaLink } from "../modules/comments/services/CommentDeliveryService";
import {
  validateCommentUpload,
  assertCommentFileReadAccess,
  loadCommentForUpload,
  MAX_COMMENT_ATTACHMENT_BYTES,
} from "../modules/comments/services/CommentFileService";
import { emitStudentComment } from "../modules/notifications/services/emitters";
import type { IStoredFile } from "../modules/platform/models/StoredFile";

const SECTION_OID = oid();
const STUDENT_OID = oid();
const TEACHER_ID = oid().toString();

interface FakeCommentDoc {
  _id: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  sectionId: mongoose.Types.ObjectId;
  authorUserId: mongoose.Types.ObjectId;
  type: string;
  sentiment: string;
  text: string;
  attachmentIds: unknown[];
  deliveryChannels: string[];
  deliveredAt?: Date;
  save: jest.Mock;
}

const makeCommentDoc = (over: Record<string, unknown> = {}): FakeCommentDoc => {
  const doc = {
    _id: oid(),
    studentId: STUDENT_OID,
    sectionId: SECTION_OID,
    authorUserId: new mongoose.Types.ObjectId(TEACHER_ID),
    type: "BEHAVIOUR",
    sentiment: "CONCERN",
    text: "ক্লাসে মনোযোগ কম ছিল।",
    attachmentIds: [] as unknown[],
    deliveryChannels: [] as string[],
    deliveredAt: undefined as Date | undefined,
    ...over,
  } as FakeCommentDoc;
  doc.save = jest.fn(async () => doc);
  return doc;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAudit.mockResolvedValue(undefined);
  mockEmit.mockResolvedValue({ created: true });
});

// ===========================================================================
// deliverComment (J-CM1)
// ===========================================================================

describe("deliverComment", () => {
  beforeEach(() => {
    mockLinkFind.mockReturnValue(leanChain([{ guardianId: oid() }]));
  });

  test("delivers: stamps deliveredAt + channels, wa.me for the family, emits for login-enabled, audits DELIVERED", async () => {
    const guardianId = oid();
    const doc = makeCommentDoc();
    mockSCFindById.mockReturnValue(doc);
    mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, name: "Ali", nameBn: "আলী", phone: "01711-222333" }));
    mockLinkFind.mockReturnValue(leanChain([{ guardianId }]));
    mockGuardianFind.mockReturnValue(leanChain([{ _id: guardianId }]));

    const out = await deliverComment(doc._id.toString(), TEACHER_ID);

    // wa.me built for the family (digits only, URL-encoded body).
    expect(out.waLink).toMatch(/^https:\/\/wa\.me\/01711222333\?text=/);
    expect(out.unreachableByWa).toBe(false);
    expect(out.notifiedGuardianIds).toEqual([guardianId.toString()]);
    expect(out.deliveryChannels).toEqual(["wa", "inbox"]);
    expect(out.deliveredAt).toBeTruthy();

    // Immutability seal: deliveredAt stamped on the doc + saved.
    expect(doc.deliveredAt).toBeInstanceOf(Date);
    expect(doc.deliveryChannels).toEqual(["wa", "inbox"]);
    expect((doc.save as jest.Mock)).toHaveBeenCalled();

    // emit() — the single inbox door — kind + dedupeKey.
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "STUDENT_COMMENT",
        recipientGuardianId: guardianId.toString(),
        dedupeKey: expect.stringMatching(/^SCMT:/),
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "STUDENT_COMMENT_DELIVERED", targetKind: "StudentComment" }),
    );
  });

  test("body renders byte-identically to the student_comment.notify.body MT default (D-#131)", async () => {
    const doc = makeCommentDoc({ type: "BEHAVIOUR", text: "ক্লাসে মনোযোগ কম ছিল।" });
    mockSCFindById.mockReturnValue(doc);
    mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, name: "Ali", nameBn: "আলী", phone: "01711222333" }));
    mockLinkFind.mockReturnValue(leanChain([]));
    mockGuardianFind.mockReturnValue(leanChain([]));

    const out = await deliverComment(doc._id.toString(), TEACHER_ID);
    const typeBn = COMMENT_TYPE_LABELS_BN.BEHAVIOUR;
    expect(out.messageBn).toBe(
      `আসসালামু আলাইকুম। আলী সম্পর্কে শিক্ষকের একটি পর্যবেক্ষণ (${typeBn}): ক্লাসে মনোযোগ কম ছিল। — জাযাকাল্লাহু খাইরান।`,
    );
  });

  test("phone-less family → unreachableByWa, no wa link, inbox still emitted", async () => {
    const guardianId = oid();
    const doc = makeCommentDoc();
    mockSCFindById.mockReturnValue(doc);
    mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, name: "NoPhone" })); // no phone
    mockLinkFind.mockReturnValue(leanChain([{ guardianId }]));
    mockGuardianFind.mockReturnValue(leanChain([{ _id: guardianId }]));

    const out = await deliverComment(doc._id.toString(), TEACHER_ID);
    expect(out.waLink).toBeNull();
    expect(out.unreachableByWa).toBe(true);
    expect(out.deliveryChannels).toEqual(["inbox"]);
  });

  test("contact-only family (no login-enabled guardian) → wa.me only, no inbox row", async () => {
    const doc = makeCommentDoc();
    mockSCFindById.mockReturnValue(doc);
    mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, name: "Ali", phone: "01711222333" }));
    mockLinkFind.mockReturnValue(leanChain([{ guardianId: oid() }]));
    mockGuardianFind.mockReturnValue(leanChain([])); // none login-enabled

    const out = await deliverComment(doc._id.toString(), TEACHER_ID);
    expect(out.notifiedGuardianIds).toEqual([]);
    expect(out.deliveryChannels).toEqual(["wa"]);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test("re-deliver keeps the ORIGINAL deliveredAt (sealed once)", async () => {
    const original = new Date("2026-06-10T00:00:00Z");
    const doc = makeCommentDoc({ deliveredAt: original });
    mockSCFindById.mockReturnValue(doc);
    mockStudentFindById.mockReturnValue(leanChain({ _id: STUDENT_OID, name: "Ali", phone: "01711222333" }));
    mockLinkFind.mockReturnValue(leanChain([]));
    mockGuardianFind.mockReturnValue(leanChain([]));

    const out = await deliverComment(doc._id.toString(), TEACHER_ID);
    expect(out.deliveredAt).toBe(original.toISOString());
    expect(doc.deliveredAt).toBe(original);
  });

  test("a missing comment throws", async () => {
    mockSCFindById.mockReturnValue(null);
    await expect(deliverComment(oid().toString(), TEACHER_ID)).rejects.toThrow(/Comment not found/);
  });

  test("commentWaLink: digits-only + URL-encoded; null when no phone", () => {
    expect(commentWaLink(undefined, "hi")).toBeNull();
    expect(commentWaLink("  ", "hi")).toBeNull();
    expect(commentWaLink("+88 017-11", "a b")).toBe("https://wa.me/8801711?text=a%20b");
  });
});

// ===========================================================================
// emitStudentComment — single door + kind-gated no-op fallback (§4.1/D-#94)
// ===========================================================================

describe("emitStudentComment", () => {
  test("emits only for login-enabled guardians; dedupeKey per comment+guardian", async () => {
    const commentId = oid();
    const gLogin = oid();
    mockLinkFind.mockReturnValue(leanChain([{ guardianId: gLogin }, { guardianId: oid() }]));
    mockGuardianFind.mockReturnValue(leanChain([{ _id: gLogin }])); // only one login-enabled

    const notified = await emitStudentComment({
      commentId,
      studentId: STUDENT_OID,
      sectionId: SECTION_OID,
      titleBn: "শিক্ষকের পর্যবেক্ষণ",
      messageBn: "body",
    });
    expect(notified).toEqual([gLogin.toString()]);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "STUDENT_COMMENT",
        dedupeKey: `SCMT:${commentId.toString()}:${gLogin.toString()}`,
        refs: expect.objectContaining({ studentCommentId: commentId.toString() }),
      }),
    );
  });

  test("kind-gated fallback (§4.1/D-#94): when STUDENT_COMMENT is not registered, the emitter no-ops (no emit, returns [])", async () => {
    jest.resetModules();
    jest.doMock("@scd/shared", () => {
      const actual = jest.requireActual("@scd/shared");
      return { ...actual, NOTIFICATION_KINDS: actual.NOTIFICATION_KINDS.filter((k: string) => k !== "STUDENT_COMMENT") };
    });
    jest.doMock("../modules/notifications/services/NotificationService", () => ({ emit: mockEmit }));
    jest.doMock("../modules/foundation/models/GuardianLink", () => ({ GuardianLink: { find: (q: unknown) => mockLinkFind(q) } }));
    jest.doMock("../modules/foundation/models/Guardian", () => ({ Guardian: { find: (q: unknown) => mockGuardianFind(q) } }));

    let emitFn!: typeof emitStudentComment;
    jest.isolateModules(() => {
      emitFn = require("../modules/notifications/services/emitters").emitStudentComment;
    });
    const notified = await emitFn({
      commentId: oid(),
      studentId: STUDENT_OID,
      sectionId: SECTION_OID,
      titleBn: "t",
      messageBn: "m",
    });
    expect(notified).toEqual([]);
    expect(mockEmit).not.toHaveBeenCalled();

    jest.dontMock("@scd/shared");
    jest.resetModules();
  });
});

// ===========================================================================
// Comment-file upload validation + read gate (§5)
// ===========================================================================

describe("validateCommentUpload", () => {
  test("accepts the whitelisted MIME types → the right stored kind", () => {
    expect(validateCommentUpload("image/jpeg", 100)).toEqual({ storedKind: "comment_image" });
    expect(validateCommentUpload("image/webp", 100)).toEqual({ storedKind: "comment_image" });
    expect(validateCommentUpload("application/pdf", 100)).toEqual({ storedKind: "comment_pdf" });
    expect(validateCommentUpload("video/mp4", 100)).toEqual({ storedKind: "comment_video" });
    expect(validateCommentUpload("audio/mpeg", 100)).toEqual({ storedKind: "comment_audio" });
  });

  test("rejects a non-whitelisted MIME, zero size, and over-cap files", () => {
    expect(typeof validateCommentUpload("text/plain", 100)).toBe("string");
    expect(typeof validateCommentUpload("image/jpeg", 0)).toBe("string");
    expect(typeof validateCommentUpload("image/jpeg", MAX_COMMENT_ATTACHMENT_BYTES + 1)).toBe("string");
    expect(validateCommentUpload("image/jpeg", MAX_COMMENT_ATTACHMENT_BYTES)).toEqual({ storedKind: "comment_image" });
  });
});

describe("assertCommentFileReadAccess (GET /files/:id gate)", () => {
  const fileFor = (over: Partial<IStoredFile> = {}): IStoredFile =>
    ({ _id: oid(), kind: "comment_image", studentCommentId: oid(), ...over } as unknown as IStoredFile);
  const ctxOf = (role: string, userId: string) =>
    ({ auth: { userId, role } } as unknown as Parameters<typeof assertCommentFileReadAccess>[0]);

  test("the AUTHOR may read their own attachment, even before delivery", async () => {
    mockSCFindById.mockReturnValue(leanChain({ authorUserId: new mongoose.Types.ObjectId(TEACHER_ID), studentId: STUDENT_OID, deliveredAt: undefined }));
    await expect(assertCommentFileReadAccess(ctxOf("TEACHER", TEACHER_ID), fileFor())).resolves.toBeUndefined();
    expect(mockAssertGuardian).not.toHaveBeenCalled();
  });

  test("a guardian of a DELIVERED comment is allowed (via assertGuardianOfStudent)", async () => {
    mockSCFindById.mockReturnValue(leanChain({ authorUserId: oid(), studentId: STUDENT_OID, deliveredAt: new Date() }));
    mockAssertGuardian.mockResolvedValue(undefined);
    const gid = oid().toString();
    await expect(assertCommentFileReadAccess(ctxOf("GUARDIAN", gid), fileFor())).resolves.toBeUndefined();
    expect(mockAssertGuardian).toHaveBeenCalledWith(expect.anything(), STUDENT_OID.toString());
  });

  test("a guardian of an UNDELIVERED comment is denied (author-only before delivery)", async () => {
    mockSCFindById.mockReturnValue(leanChain({ authorUserId: oid(), studentId: STUDENT_OID, deliveredAt: undefined }));
    await expect(assertCommentFileReadAccess(ctxOf("GUARDIAN", oid().toString()), fileFor())).rejects.toThrow(ForbiddenError);
    expect(mockAssertGuardian).not.toHaveBeenCalled();
  });

  test("a file with no studentCommentId binding is denied", async () => {
    await expect(
      assertCommentFileReadAccess(ctxOf("TEACHER", TEACHER_ID), fileFor({ studentCommentId: undefined })),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("loadCommentForUpload", () => {
  const author = new mongoose.Types.ObjectId(TEACHER_ID);

  test("returns the comment's section + author + delivery state", async () => {
    mockSCFindById.mockReturnValue(leanChain({ sectionId: SECTION_OID, authorUserId: author, deliveredAt: undefined }));
    expect(await loadCommentForUpload(oid().toString())).toEqual({
      sectionId: SECTION_OID.toString(),
      authorUserId: TEACHER_ID,
      delivered: false,
    });
  });

  test("flags a delivered comment + rejects a missing one", async () => {
    mockSCFindById.mockReturnValue(leanChain({ sectionId: SECTION_OID, authorUserId: author, deliveredAt: new Date() }));
    expect(await loadCommentForUpload(oid().toString())).toEqual({
      sectionId: SECTION_OID.toString(),
      authorUserId: TEACHER_ID,
      delivered: true,
    });
    mockSCFindById.mockReturnValue(leanChain(null));
    await expect(loadCommentForUpload(oid().toString())).rejects.toThrow(ForbiddenError);
  });
});
