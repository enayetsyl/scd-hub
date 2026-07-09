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

jest.mock("../modules/printing/models/PrintRequest", () => ({
  PrintRequest: {
    create: (d: unknown) => mockCreate(d),
    findById: (id: unknown) => mockFindById(id),
  },
}));
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (p: unknown) => mockWriteAudit(p),
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

  test("rejects a blank title, an unknown purpose, bad copies and a bad date key", async () => {
    await expect(createPrintRequest({ ...baseInput, title: "  " })).rejects.toThrow(/title/);
    await expect(createPrintRequest({ ...baseInput, purpose: "VIBES" })).rejects.toThrow(/purpose/);
    await expect(createPrintRequest({ ...baseInput, copies: 0 })).rejects.toThrow(/copies/);
    await expect(createPrintRequest({ ...baseInput, neededByKey: "09-07-2026" })).rejects.toThrow(/YYYY-MM-DD/);
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
