/**
 * PQ-1 (D-#281) — the print queue's status machine.
 *
 *   1. create — born REQUESTED, audited; exactly ONE source payload must match the
 *      declared `sourceType` (the XOR rule); purpose/copies/date validated
 *   2. REQUESTED → PRINTED → DELIVERED, each guarding the CURRENT status, each audited
 *   3. out-of-order transitions reject (a PRINTED job cannot be delivered twice, a
 *      DELIVERED job cannot be printed, a PRINTED job cannot be cancelled)
 *   4. cancel — the requester may withdraw their OWN REQUESTED job; the Office may
 *      cancel any; a stranger may not
 *   5. isPrintableUrl — only absolute http(s) links
 *
 * DB-free: the model + audit are mocked; the machine is real.
 */
import mongoose from "mongoose";

const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockWriteAudit = jest.fn().mockResolvedValue(undefined);
const mockSetFindById = jest.fn();
const mockArtifactFindById = jest.fn();
const mockStoredFileFind = jest.fn();
const mockEmitDelivered = jest.fn().mockResolvedValue(undefined);
const mockEmitRequested = jest.fn().mockResolvedValue(undefined);
const mockUserFindById = jest.fn().mockResolvedValue({ name: "Teacher T" });
const mockClassTestUpdateOne = jest.fn().mockResolvedValue({});
const mockClassPresence = jest.fn();
const mockCountDocuments = jest.fn();
const mockPublishRealtime = jest.fn();
const mockFind = jest.fn();
const mockClassFind = jest.fn().mockResolvedValue([]);

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: {
    create: (d: unknown) => mockCreate(d),
    findById: (id: unknown) => mockFindById(id),
    countDocuments: (f: unknown) => Promise.resolve(mockCountDocuments(f)),
    // D-#362: the reprint history's scan — .sort().limit().lean().
    find: (q: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.sort = () => chain;
      chain.limit = () => chain;
      chain.lean = () => mockFind(q);
      return chain;
    },
  },
}));
// D-#362: the history sorts by class LEVEL, resolved in one batched lookup.
jest.mock("../modules/foundation/models/Class", () => ({
  Class: { find: (q: unknown) => ({ select: () => ({ lean: () => mockClassFind(q) }) }) },
}));
// D-#294: CLASS_PRESENT copies resolve from the use day's attendance roll-up.
jest.mock("../modules/attendance/services/AttendanceReportService", () => ({
  classPresenceForDate: (k: unknown) => mockClassPresence(k),
}));
// D-#295: every queue transition nudges the realtime bus (badges/queue push).
jest.mock("../modules/realtime/bus", () => ({
  publishRealtime: (...a: unknown[]) => mockPublishRealtime(...a),
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
}));
// PQ-2: the referenced document must exist and be printable.
jest.mock("../modules/assessment/models/AssessmentSet", () => ({
  AssessmentSet: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockSetFindById(id) }) }) },
}));
jest.mock("../modules/content/models/ContentArtifact", () => ({
  ContentArtifact: { findById: (id: unknown) => ({ select: () => ({ lean: () => mockArtifactFindById(id) }) }) },
}));
jest.mock("../modules/platform/models/StoredFile", () => ({
  StoredFile: { find: (f: unknown) => ({ select: () => ({ lean: () => mockStoredFileFind(f) }) }) },
}));
// PQ-5: delivering notifies the requester (best-effort; must never block the transition).
jest.mock("../modules/notifications/services/emitters", () => ({
  emitPrintDelivered: (e: unknown) => mockEmitDelivered(e),
  // D-#296: filing a request nudges the queue's operators.
  emitPrintRequested: (e: unknown) => mockEmitRequested(e),
}));
jest.mock("../modules/foundation/models/User", () => ({
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: () => mockUserFindById(id) }) }),
  },
}));
// PQ-5: advancing a class-test queue row mirrors onto the linked ClassTest.
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: { updateOne: (q: unknown, u: unknown) => mockClassTestUpdateOne(q, u) },
}));

import {
  createPrintRequest,
  markPrinted,
  markDelivered,
  cancelPrintRequest,
  validateSource,
  isPrintableUrl,
  effectiveCopiesFor,
  printQueueCounts,
  printHistory,
  reprintPrintRequest,
  historyKey,
  PrintRequestError,
} from "../modules/printing/services/PrintRequestService";

const oid = () => new mongoose.Types.ObjectId();
const TEACHER = oid().toString();
const OFFICE = oid().toString();
const SET = oid().toString();

/** A saveable doc stub standing in for a mongoose document. */
interface DocStub {
  _id: mongoose.Types.ObjectId;
  status: string;
  requestedBy: mongoose.Types.ObjectId;
  save: jest.Mock;
  title?: string;
  classTestId?: mongoose.Types.ObjectId;
  cancelReason?: string;
  printedAt?: Date;
  deliveredAt?: Date;
}
const docStub = (over: Partial<DocStub> = {}): DocStub => ({
  _id: oid(),
  status: "REQUESTED",
  requestedBy: new mongoose.Types.ObjectId(TEACHER),
  save: jest.fn().mockResolvedValue(undefined),
  ...over,
});

const baseInput = {
  title: "Class 3 Math worksheet",
  purpose: "CLASSWORK",
  sourceType: "SET",
  setId: SET,
  requestedBy: TEACHER,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockImplementation((d) => Promise.resolve({ _id: oid(), ...d }));
  mockSetFindById.mockResolvedValue({ status: "assembled" });
  mockArtifactFindById.mockResolvedValue({ docType: "session_plan" });
  mockStoredFileFind.mockResolvedValue([]);
  mockEmitDelivered.mockResolvedValue(undefined);
  mockClassTestUpdateOne.mockResolvedValue({});
});

describe("isPrintableUrl", () => {
  test("accepts absolute http(s); rejects anything else", () => {
    expect(isPrintableUrl("https://forms.google.com/x")).toBe(true);
    expect(isPrintableUrl("http://example.com")).toBe(true);
    expect(isPrintableUrl("javascript:alert(1)")).toBe(false);
    expect(isPrintableUrl("/relative/path")).toBe(false);
    expect(isPrintableUrl("not a url")).toBe(false);
  });
});

describe("validateSource — the XOR rule (PQ1.2)", () => {
  test("each sourceType requires its own payload", () => {
    expect(() => validateSource({ ...baseInput, sourceType: "SET", setId: null })).toThrow(PrintRequestError);
    expect(() => validateSource({ ...baseInput, sourceType: "CONTENT_ARTIFACT" })).toThrow(PrintRequestError);
    expect(() => validateSource({ ...baseInput, sourceType: "UPLOAD", fileIds: [] })).toThrow(PrintRequestError);
    expect(() => validateSource({ ...baseInput, sourceType: "LINK", linkUrl: null })).toThrow(PrintRequestError);
  });

  test("a LINK must be an http(s) URL", () => {
    expect(() =>
      validateSource({ ...baseInput, sourceType: "LINK", linkUrl: "javascript:alert(1)" }),
    ).toThrow(/http/);
  });

  test("uploads are capped at 5 files", () => {
    const ids = Array.from({ length: 6 }, () => oid().toString());
    expect(() => validateSource({ ...baseInput, sourceType: "UPLOAD", fileIds: ids })).toThrow(/5 files/);
  });

  test("an unknown sourceType rejects", () => {
    expect(() => validateSource({ ...baseInput, sourceType: "TELEPATHY" })).toThrow(PrintRequestError);
  });
});

describe("createPrintRequest", () => {
  test("is born REQUESTED with the requester stamped, and is audited", async () => {
    await createPrintRequest(baseInput);
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.status).toBe("REQUESTED");
    expect(created.copies).toBe(1); // default
    expect(created.setId).toBeDefined();
    expect(created.linkUrl).toBeUndefined(); // no smuggled second source
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PRINT_REQUEST_CREATED", actorId: TEACHER }),
    );
  });

  test("only the declared source's payload is persisted", async () => {
    await createPrintRequest({
      ...baseInput,
      sourceType: "LINK",
      linkUrl: "https://forms.google.com/x",
      setId: SET, // a stray value the caller passed — must be ignored
    });
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.linkUrl).toBe("https://forms.google.com/x");
    expect(created.setId).toBeUndefined();
  });

  test("colour/sides default when absent (internal path) and reject an unknown value", async () => {
    // The RESOLVER makes them mandatory for a teacher; the service defaults so the
    // internal class-test path and migration-backfilled rows stay valid.
    await createPrintRequest(baseInput);
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.colour).toBe("BW");
    expect(created.sides).toBe("SINGLE");

    await expect(createPrintRequest({ ...baseInput, colour: "RAINBOW" })).rejects.toThrow(/colour/i);
    await expect(createPrintRequest({ ...baseInput, sides: "TRIPLE" })).rejects.toThrow(/sides/i);
  });

  test("a chosen colour + sides are persisted", async () => {
    await createPrintRequest({ ...baseInput, colour: "COLOR", sides: "DOUBLE" });
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.colour).toBe("COLOR");
    expect(created.sides).toBe("DOUBLE");
  });

  test("rejects a blank title, an unknown purpose, bad copies and a bad date key", async () => {
    await expect(createPrintRequest({ ...baseInput, title: "  " })).rejects.toThrow(/title/);
    await expect(createPrintRequest({ ...baseInput, purpose: "VIBES" })).rejects.toThrow(/purpose/);
    await expect(createPrintRequest({ ...baseInput, copies: 0 })).rejects.toThrow(/copies/);
    await expect(createPrintRequest({ ...baseInput, neededByKey: "09-07-2026" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("PQ-2 — the referenced document must exist and be printable", () => {
  test("SET: a DRAFT set cannot be sent for printing (only assembled ⇒ locked ⇒ immutable)", async () => {
    mockSetFindById.mockResolvedValue({ status: "draft" });
    await expect(createPrintRequest(baseInput)).rejects.toThrow(/ASSEMBLED/);
  });

  test("SET: a missing set rejects", async () => {
    mockSetFindById.mockResolvedValue(null);
    await expect(createPrintRequest(baseInput)).rejects.toThrow(/not found/);
  });

  test("CONTENT_ARTIFACT: only a chapter/session plan may be printed", async () => {
    const input = { ...baseInput, sourceType: "CONTENT_ARTIFACT", contentArtifactId: oid().toString() };
    mockArtifactFindById.mockResolvedValue({ docType: "question" }); // not a plan
    await expect(createPrintRequest(input)).rejects.toThrow(/chapter or session plan/);

    mockArtifactFindById.mockResolvedValue({ docType: "chapter_plan" });
    await expect(createPrintRequest(input)).resolves.toBeDefined();
  });

  test("UPLOAD: every file must exist, be a print_upload, and belong to the requester", async () => {
    const f1 = oid().toString();
    const input = { ...baseInput, sourceType: "UPLOAD", fileIds: [f1] };

    mockStoredFileFind.mockResolvedValue([]); // missing
    await expect(createPrintRequest(input)).rejects.toThrow(/was not found/);

    mockStoredFileFind.mockResolvedValue([{ kind: "hw_question", uploadedBy: TEACHER }]); // wrong kind
    await expect(createPrintRequest(input)).rejects.toThrow(/not a print upload/);

    mockStoredFileFind.mockResolvedValue([{ kind: "print_upload", uploadedBy: oid().toString() }]); // someone else's
    await expect(createPrintRequest(input)).rejects.toThrow(/files you uploaded/);

    mockStoredFileFind.mockResolvedValue([{ kind: "print_upload", uploadedBy: TEACHER }]);
    await expect(createPrintRequest(input)).resolves.toBeDefined();
  });

  test("LINK: nothing is looked up — an external URL cannot be verified", async () => {
    await createPrintRequest({ ...baseInput, sourceType: "LINK", linkUrl: "https://forms.google.com/x", setId: null });
    expect(mockSetFindById).not.toHaveBeenCalled();
    expect(mockArtifactFindById).not.toHaveBeenCalled();
    expect(mockStoredFileFind).not.toHaveBeenCalled();
  });
});

describe("the status machine: REQUESTED → PRINTED → DELIVERED", () => {
  test("markPrinted advances a REQUESTED job and stamps the operator", async () => {
    const doc = docStub();
    mockFindById.mockResolvedValue(doc);
    await markPrinted(doc._id.toString(), OFFICE);
    expect(doc.status).toBe("PRINTED");
    expect(doc.save).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PRINT_REQUEST_PRINTED", actorId: OFFICE }),
    );
  });

  test("markDelivered advances a PRINTED job and notifies the requester (PQ-5)", async () => {
    const doc = docStub({ status: "PRINTED", title: "Class 3 Math worksheet" });
    mockFindById.mockResolvedValue(doc);
    await markDelivered(doc._id.toString(), OFFICE);
    expect(doc.status).toBe("DELIVERED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PRINT_REQUEST_DELIVERED" }),
    );
    // The requesting teacher is told — the Office is the single actor, no receipt step.
    expect(mockEmitDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: TEACHER, title: "Class 3 Math worksheet" }),
    );
  });

  test("only DELIVERED notifies — printing does not", async () => {
    mockFindById.mockResolvedValue(docStub());
    await markPrinted("id", OFFICE);
    expect(mockEmitDelivered).not.toHaveBeenCalled();
  });

  test("a REQUESTED job cannot skip straight to DELIVERED", async () => {
    mockFindById.mockResolvedValue(docStub({ status: "REQUESTED" }));
    await expect(markDelivered("id", OFFICE)).rejects.toThrow(/Only a PRINTED job/);
  });

  test("a PRINTED job cannot be printed again, nor a DELIVERED one delivered again", async () => {
    mockFindById.mockResolvedValue(docStub({ status: "PRINTED" }));
    await expect(markPrinted("id", OFFICE)).rejects.toThrow(/Only a REQUESTED job/);
    mockFindById.mockResolvedValue(docStub({ status: "DELIVERED" }));
    await expect(markDelivered("id", OFFICE)).rejects.toThrow(/Only a PRINTED job/);
  });

  test("a missing job rejects", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(markPrinted("nope", OFFICE)).rejects.toThrow(/not found/);
  });
});

describe("PQ-5 — a class-test job mirrors onto its ClassTest", () => {
  const CT = oid();

  test("marking the queue row PRINTED advances the linked ClassTest + audits it", async () => {
    const doc = docStub({ classTestId: CT });
    mockFindById.mockResolvedValue(doc);
    await markPrinted(doc._id.toString(), OFFICE);

    expect(mockClassTestUpdateOne).toHaveBeenCalledWith(
      { _id: CT, status: "REQUESTED" }, // guarded, so a mirrored write cannot double-apply
      expect.objectContaining({ $set: expect.objectContaining({ status: "PRINTED" }) }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_PRINTED", targetKind: "ClassTest" }),
    );
  });

  test("cancelling the queue row cancels the linked ClassTest", async () => {
    const doc = docStub({ classTestId: CT });
    mockFindById.mockResolvedValue(doc);
    await cancelPrintRequest(doc._id.toString(), OFFICE, { isOffice: true });
    expect(mockClassTestUpdateOne).toHaveBeenCalledWith(
      { _id: CT, status: "REQUESTED" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "CANCELLED" }) }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "CLASS_TEST_CANCELLED", targetKind: "ClassTest" }),
    );
  });

  test("an ordinary job (no classTestId) never touches ClassTest", async () => {
    mockFindById.mockResolvedValue(docStub());
    await markPrinted("id", OFFICE);
    expect(mockClassTestUpdateOne).not.toHaveBeenCalled();
  });

  test("a trusted internal create skips source resolution (a class-test paper is not a print_upload)", async () => {
    await createPrintRequest({
      ...baseInput,
      sourceType: "UPLOAD",
      setId: null,
      fileIds: [oid().toString()],
      classTestId: CT.toString(),
      trusted: true,
    });
    expect(mockStoredFileFind).not.toHaveBeenCalled();
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.classTestId).toBeDefined();
  });
});

describe("cancel", () => {
  test("the requester may withdraw their OWN REQUESTED job", async () => {
    const doc = docStub();
    mockFindById.mockResolvedValue(doc);
    await cancelPrintRequest(doc._id.toString(), TEACHER, { isOffice: false, reason: "typo" });
    expect(doc.status).toBe("CANCELLED");
    expect(doc.cancelReason).toBe("typo");
  });

  test("a different teacher may NOT cancel someone else's job", async () => {
    mockFindById.mockResolvedValue(docStub());
    await expect(cancelPrintRequest("id", oid().toString(), { isOffice: false })).rejects.toThrow(
      /requester or the Office/,
    );
  });

  test("the Office may cancel anyone's REQUESTED job", async () => {
    const doc = docStub();
    mockFindById.mockResolvedValue(doc);
    await cancelPrintRequest(doc._id.toString(), OFFICE, { isOffice: true });
    expect(doc.status).toBe("CANCELLED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PRINT_REQUEST_CANCELLED", meta: expect.objectContaining({ byOffice: true }) }),
    );
  });

  test("a PRINTED job cannot be cancelled — the paper already exists", async () => {
    mockFindById.mockResolvedValue(docStub({ status: "PRINTED" }));
    await expect(cancelPrintRequest("id", OFFICE, { isOffice: true })).rejects.toThrow(/Only a REQUESTED job/);
  });
});
// ---------------------------------------------------------------------------
// D-#294 — copies from the USE day's present students
// ---------------------------------------------------------------------------

describe("CLASS_PRESENT copies (D-#294)", () => {
  const CLS = oid();
  const cpInput = {
    ...baseInput,
    copiesMode: "CLASS_PRESENT",
    copiesClassId: CLS.toString(),
    neededByKey: "2026-07-13",
  };
  const cpDoc = (over: Record<string, unknown> = {}) =>
    docStub({
      copiesMode: "CLASS_PRESENT",
      copiesClassId: CLS,
      neededByKey: "2026-07-13",
      copies: 1,
      ...over,
    } as Partial<DocStub>);

  test("create requires the class AND the use date", async () => {
    await expect(
      createPrintRequest({ ...cpInput, copiesClassId: null }),
    ).rejects.toThrow(/needs the class/);
    await expect(
      createPrintRequest({ ...cpInput, neededByKey: null }),
    ).rejects.toThrow(/date the print will be used/);
    await createPrintRequest(cpInput);
    const created = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(created.copiesMode).toBe("CLASS_PRESENT");
    expect(created.copiesClassId).toBeDefined();
  });

  test("effectiveCopiesFor: complete attendance on the use day → the present count", async () => {
    mockClassPresence.mockResolvedValue([
      { classId: CLS.toString(), presentCount: 32, complete: true },
    ]);
    const r = await effectiveCopiesFor(cpDoc() as never, new Date(2026, 6, 13));
    expect(r).toEqual({ copies: 32, pending: false });
    expect(mockClassPresence).toHaveBeenCalledWith("2026-07-13");
  });

  test("effectiveCopiesFor: incomplete attendance → pending", async () => {
    mockClassPresence.mockResolvedValue([
      { classId: CLS.toString(), presentCount: 10, complete: false },
    ]);
    const r = await effectiveCopiesFor(cpDoc() as never, new Date(2026, 6, 13));
    expect(r).toEqual({ copies: null, pending: true });
  });

  test("effectiveCopiesFor: a FUTURE use day is always pending (attendance can't exist)", async () => {
    const r = await effectiveCopiesFor(cpDoc() as never, new Date(2026, 6, 12));
    expect(r).toEqual({ copies: null, pending: true });
    expect(mockClassPresence).not.toHaveBeenCalled();
  });

  test("effectiveCopiesFor: FIXED jobs just echo their copies", async () => {
    const r = await effectiveCopiesFor(docStub({ copiesMode: "FIXED", copies: 7 } as Partial<DocStub>) as never);
    expect(r).toEqual({ copies: 7, pending: false });
    expect(mockClassPresence).not.toHaveBeenCalled();
  });

  test("markPrinted finalizes the LIVE count onto copies", async () => {
    const doc = cpDoc();
    mockFindById.mockResolvedValue(doc);
    mockClassPresence.mockResolvedValue([
      { classId: CLS.toString(), presentCount: 28, complete: true },
    ]);
    await markPrinted(doc._id.toString(), OFFICE);
    expect((doc as unknown as { copies: number }).copies).toBe(28);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ copies: 28, copiesSource: "attendance" }) }),
    );
  });

  test("markPrinted with attendance pending and NO manual count → rejects with guidance", async () => {
    const doc = cpDoc();
    mockFindById.mockResolvedValue(doc);
    mockClassPresence.mockResolvedValue([]);
    await expect(markPrinted(doc._id.toString(), OFFICE)).rejects.toThrow(/attendance for the use day is pending/);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("markPrinted with a MANUAL count uses it (attendance pending path)", async () => {
    const doc = cpDoc();
    mockFindById.mockResolvedValue(doc);
    await markPrinted(doc._id.toString(), OFFICE, 30);
    expect((doc as unknown as { copies: number }).copies).toBe(30);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ copies: 30, copiesSource: "manual" }) }),
    );
    expect(mockClassPresence).not.toHaveBeenCalled();
  });

  test("a non-positive manual count rejects", async () => {
    const doc = cpDoc();
    mockFindById.mockResolvedValue(doc);
    await expect(markPrinted(doc._id.toString(), OFFICE, 0)).rejects.toThrow(/positive integer/);
  });
});

describe("printQueueCounts (D-#294 badges)", () => {
  test("returns the REQUESTED and PRINTED counts", async () => {
    mockCountDocuments.mockImplementation((f: { status: string }) =>
      f.status === "REQUESTED" ? 3 : 2,
    );
    expect(await printQueueCounts()).toEqual({ requested: 3, printed: 2 });
  });
});

describe("realtime nudges (D-#295)", () => {
  test("create / printed / delivered / cancelled each publish a print_queue event", async () => {
    await createPrintRequest(baseInput);
    expect(mockPublishRealtime).toHaveBeenLastCalledWith(
      "print_queue",
      expect.objectContaining({ op: "created" }),
    );

    const doc = docStub();
    mockFindById.mockResolvedValue(doc);
    await markPrinted(doc._id.toString(), OFFICE);
    expect(mockPublishRealtime).toHaveBeenLastCalledWith(
      "print_queue",
      expect.objectContaining({ op: "printed" }),
    );

    doc.status = "PRINTED";
    await markDelivered(doc._id.toString(), OFFICE);
    expect(mockPublishRealtime).toHaveBeenLastCalledWith(
      "print_queue",
      expect.objectContaining({ op: "delivered" }),
    );

    const doc2 = docStub();
    mockFindById.mockResolvedValue(doc2);
    await cancelPrintRequest(doc2._id.toString(), OFFICE, { isOffice: true });
    expect(mockPublishRealtime).toHaveBeenLastCalledWith(
      "print_queue",
      expect.objectContaining({ op: "cancelled" }),
    );
  });
});

// ===========================================================================
// D-#362 — the reprint history + the reprint clone
// ===========================================================================

/** A LEAN history doc (what `.lean()` hands back), not a hydrated document. */
const histDoc = (over: Record<string, unknown> = {}): any => ({
  _id: oid(),
  title: "Worksheet",
  purpose: "HOMEWORK",
  sourceType: "UPLOAD",
  fileIds: [oid()],
  colour: "BW",
  sides: "SINGLE",
  copies: 20,
  copiesMode: "FIXED",
  status: "PRINTED",
  requestedBy: new mongoose.Types.ObjectId(TEACHER),
  requestedAt: new Date("2026-07-01T04:00:00Z"),
  printedAt: new Date("2026-07-01T05:00:00Z"),
  ...over,
});

describe("historyKey — what counts as THE SAME document", () => {
  test("the same upload for the same class/subject/purpose is ONE document", () => {
    const cls = oid(), file = oid();
    const a = histDoc({ fileIds: [file], classId: cls, subject: "BAN" });
    const b = histDoc({ fileIds: [file], classId: cls, subject: "BAN" });
    expect(historyKey(a)).toBe(historyKey(b));
  });

  test("attachment ORDER does not split one document into two", () => {
    const f1 = oid(), f2 = oid();
    expect(historyKey(histDoc({ fileIds: [f1, f2] }))).toBe(historyKey(histDoc({ fileIds: [f2, f1] })));
  });

  test("the same sheet printed for a DIFFERENT class / subject / purpose stays separate", () => {
    const file = oid(), c3 = oid(), c4 = oid();
    const base = { fileIds: [file], subject: "BAN", purpose: "HOMEWORK" };
    const k3 = historyKey(histDoc({ ...base, classId: c3 }));
    expect(historyKey(histDoc({ ...base, classId: c4 }))).not.toBe(k3);
    expect(historyKey(histDoc({ ...base, classId: c3, subject: "MATH" }))).not.toBe(k3);
    expect(historyKey(histDoc({ ...base, classId: c3, purpose: "CLASSWORK" }))).not.toBe(k3);
  });

  test("a set / plan / link is keyed by its own reference", () => {
    expect(historyKey(histDoc({ sourceType: "SET", setId: oid(), fileIds: [] }))).toContain("set:");
    expect(historyKey(histDoc({ sourceType: "LINK", linkUrl: "https://x.test/a", fileIds: [] }))).toContain("link:");
  });
});

describe("printHistory — one row per document, browsable by class/subject/purpose", () => {
  test("reads only ALREADY-PRINTED jobs (printed + delivered)", async () => {
    mockFind.mockResolvedValue([]);
    await printHistory();
    expect(mockFind.mock.calls[0][0]).toMatchObject({ status: { $in: ["PRINTED", "DELIVERED"] } });
  });

  test("collapses repeats into one row carrying the count and the newest print", async () => {
    const file = oid(), cls = oid();
    const older = histDoc({ fileIds: [file], classId: cls, subject: "BAN", printedAt: new Date("2026-07-01T05:00:00Z") });
    const mid = histDoc({ fileIds: [file], classId: cls, subject: "BAN", printedAt: new Date("2026-07-10T05:00:00Z") });
    const recent = histDoc({ fileIds: [file], classId: cls, subject: "BAN", printedAt: new Date("2026-07-20T05:00:00Z") });
    mockFind.mockResolvedValue([recent, mid, older]);
    mockClassFind.mockResolvedValue([{ _id: cls, level: 3 }]);

    const page = await printHistory();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].printCount).toBe(3);
    // `latest` IS the reprint source, so it must be the most recent print.
    expect(page.rows[0].latest._id.toString()).toBe(recent._id.toString());
    expect(page.rows[0].lastPrintedAt.toISOString()).toBe("2026-07-20T05:00:00.000Z");
    expect(page.rows[0].firstPrintedAt.toISOString()).toBe("2026-07-01T05:00:00.000Z");
    expect(page.rows[0].classLevel).toBe(3);
  });

  test("lists every requester of a shared document (the Office view)", async () => {
    const file = oid(), other = oid();
    mockFind.mockResolvedValue([
      histDoc({ fileIds: [file] }),
      histDoc({ fileIds: [file], requestedBy: other }),
      histDoc({ fileIds: [file] }),
    ]);
    const page = await printHistory();
    expect(page.rows[0].requesterIds.sort()).toEqual([TEACHER, other.toString()].sort());
  });

  test("orders by class level, then subject, then purpose", async () => {
    const c1 = oid(), c5 = oid();
    mockFind.mockResolvedValue([
      histDoc({ fileIds: [oid()], classId: c5, subject: "BAN", purpose: "HOMEWORK" }),
      histDoc({ fileIds: [oid()], classId: c1, subject: "MATH", purpose: "HOMEWORK" }),
      histDoc({ fileIds: [oid()], classId: c1, subject: "BAN", purpose: "CLASS_TEST" }),
      // CLASSWORK precedes CLASS_TEST in PRINT_PURPOSES, so it sorts first within (c1, BAN).
      histDoc({ fileIds: [oid()], classId: c1, subject: "BAN", purpose: "CLASSWORK" }),
      histDoc({ fileIds: [oid()], classId: null, subject: "BAN", purpose: "OTHER" }),
    ]);
    mockClassFind.mockResolvedValue([{ _id: c1, level: 1 }, { _id: c5, level: 5 }]);

    const page = await printHistory();
    expect(page.rows.map((r) => [r.classLevel, r.latest.subject, r.latest.purpose])).toEqual([
      [1, "BAN", "CLASSWORK"],
      [1, "BAN", "CLASS_TEST"],
      [1, "MATH", "HOMEWORK"],
      [5, "BAN", "HOMEWORK"],
      // A job with no class sorts LAST, not as level 0 ahead of class 1.
      [null, "BAN", "OTHER"],
    ]);
  });

  test("scopes to one requester when asked (a teacher sees only their own)", async () => {
    mockFind.mockResolvedValue([]);
    await printHistory({ requestedBy: TEACHER, subject: "BAN", purpose: "HOMEWORK" });
    const q = mockFind.mock.calls[0][0] as Record<string, { toString(): string }>;
    expect(q.requestedBy.toString()).toBe(TEACHER);
    expect(q).toMatchObject({ subject: "BAN", purpose: "HOMEWORK" });
  });

  test("rejects an unknown purpose filter", async () => {
    await expect(printHistory({ purpose: "NONSENSE" })).rejects.toThrow(PrintRequestError);
  });
});

describe("reprintPrintRequest — send an earlier print again, no re-upload", () => {
  const reprintArgs = { neededByKey: "2026-08-01", actorId: TEACHER, isOffice: false };

  test("clones the source + print settings into a NEW REQUESTED job for the new date", async () => {
    const file = oid(), cls = oid(), sec = oid();
    const original = histDoc({
      fileIds: [file], classId: cls, sectionId: sec, subject: "BAN",
      copies: 20, colour: "COLOR", sides: "DOUBLE",
    });
    mockFindById.mockReturnValue({ lean: async () => original });
    mockStoredFileFind.mockResolvedValue([{ _id: file }]);
    mockCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));

    await reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString() });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      sourceType: "UPLOAD",
      fileIds: [file],
      classId: cls,
      sectionId: sec,
      subject: "BAN",
      colour: "COLOR",
      sides: "DOUBLE",
      copies: 20,
      neededByKey: "2026-08-01",
      status: "REQUESTED",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "PRINT_REQUEST_REPRINTED",
        meta: expect.objectContaining({ fromPrintRequestId: original._id.toString() }),
      }),
    );
    // The queue's operators are nudged exactly as for a fresh request.
    expect(mockEmitRequested).toHaveBeenCalled();
  });

  test("an override copy count wins over the original's", async () => {
    const file = oid();
    const original = histDoc({ fileIds: [file], copies: 20 });
    mockFindById.mockReturnValue({ lean: async () => original });
    mockStoredFileFind.mockResolvedValue([{ _id: file }]);
    mockCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));

    await reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString(), copies: 35 });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ copies: 35 });
  });

  test("NEVER re-links the class test — the exam record keeps its own lifecycle", async () => {
    const file = oid();
    const original = histDoc({ fileIds: [file], classTestId: oid(), purpose: "CLASS_TEST" });
    mockFindById.mockReturnValue({ lean: async () => original });
    mockStoredFileFind.mockResolvedValue([{ _id: file }]);
    mockCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));

    await reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString() });
    expect(mockCreate.mock.calls[0][0].classTestId).toBeUndefined();
  });

  test("the Office may reprint another teacher's job; a teacher may not", async () => {
    const file = oid();
    const original = histDoc({ fileIds: [file], requestedBy: oid() }); // filed by a third party
    mockFindById.mockReturnValue({ lean: async () => original });
    mockStoredFileFind.mockResolvedValue([{ _id: file }]);
    mockCreate.mockImplementation(async (d: Record<string, unknown>) => ({ _id: oid(), ...d }));

    await expect(
      reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString() }),
    ).rejects.toThrow(/only reprint your own/i);

    await reprintPrintRequest({
      ...reprintArgs, sourceRequestId: original._id.toString(), actorId: OFFICE, isOffice: true,
    });
    // The NEW job belongs to whoever filed the reprint, not to the original requester.
    expect(mockCreate.mock.calls[0][0].requestedBy.toString()).toBe(OFFICE);
  });

  test("only an ALREADY-PRINTED job can be reprinted", async () => {
    for (const status of ["REQUESTED", "CANCELLED"]) {
      const original = histDoc({ status });
      mockFindById.mockReturnValue({ lean: async () => original });
      await expect(
        reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString() }),
      ).rejects.toThrow(/already-printed/i);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("refuses when an attached file has since been deleted", async () => {
    const original = histDoc({ fileIds: [oid(), oid()] });
    mockFindById.mockReturnValue({ lean: async () => original });
    mockStoredFileFind.mockResolvedValue([{ _id: original.fileIds[0] }]); // one of two survives
    await expect(
      reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString() }),
    ).rejects.toThrow(/no longer exists/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("validates the new use date", async () => {
    const original = histDoc();
    mockFindById.mockReturnValue({ lean: async () => original });
    await expect(
      reprintPrintRequest({ ...reprintArgs, sourceRequestId: original._id.toString(), neededByKey: "01-08-2026" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});
