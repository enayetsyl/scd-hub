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

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: {
    create: (d: unknown) => mockCreate(d),
    findById: (id: unknown) => mockFindById(id),
  },
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

import {
  createPrintRequest,
  markPrinted,
  markDelivered,
  cancelPrintRequest,
  validateSource,
  isPrintableUrl,
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

  test("markDelivered advances a PRINTED job", async () => {
    const doc = docStub({ status: "PRINTED" });
    mockFindById.mockResolvedValue(doc);
    await markDelivered(doc._id.toString(), OFFICE);
    expect(doc.status).toBe("DELIVERED");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "PRINT_REQUEST_DELIVERED" }),
    );
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
