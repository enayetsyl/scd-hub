/**
 * Answer-script archive tests (AR-1..AR-3, prd-script-archive §5/§7,
 * D-#443–#447).
 *
 * Box code   — generateBoxCode formats BX-{year}-{seq} (2-digit pad, atomic).
 * Filing     — fileBundle refuses a non-PRINTED test, a non-ACTIVE box and a
 *              duplicate live bundle (naming the existing box); denormalizes
 *              year/level/section/subject from the SOURCE row (D-#143); the
 *              office filer is auto-acknowledged (D-#444); audit written.
 * Ack        — once only; refused on VOID/DISPOSED.
 * Desk log   — checkout requires FILED + a purpose; check-in requires
 *              CHECKED_OUT, closes the open row, may re-box into ACTIVE only;
 *              overdue derives from expectedReturnDateKey (never stored).
 * Retention  — dispose refused while CHECKED_OUT and inside the protected
 *              (current + previous year) window (D-#446); void only from FILED.
 * Lookup     — locationsForTests returns box code + holder name, batched.
 * Photos     — validateArchivePhotoUpload (jpeg/png ≤ 5 MB) pure checks.
 *
 * DB-free (the repo's convention): models + audit are mocked.
 */
import mongoose from "mongoose";

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Mocks (BEFORE importing the module under test)
// ---------------------------------------------------------------------------

const leanChain = (val: unknown) => {
  const o: Record<string, unknown> = {};
  o.select = () => o;
  o.sort = () => o;
  o.lean = async () => val;
  return o;
};

const mockSeqUpdate = jest.fn();
jest.mock("../modules/archive/models/StorageBoxSequence", () => ({
  StorageBoxSequence: { findOneAndUpdate: (...a: unknown[]) => mockSeqUpdate(...a) },
}));

const mockBoxCreate = jest.fn();
const mockBoxFindById = jest.fn();
const mockBoxFind = jest.fn();
jest.mock("../modules/archive/models/StorageBox", () => ({
  StorageBox: {
    create: (a: unknown) => mockBoxCreate(a),
    findById: (id: unknown) => mockBoxFindById(id),
    find: (q: unknown) => mockBoxFind(q),
  },
}));

const mockBundleCreate = jest.fn();
const mockBundleFindById = jest.fn();
const mockBundleFindOne = jest.fn();
const mockBundleFind = jest.fn();
const mockBundleAggregate = jest.fn().mockResolvedValue([]);
jest.mock("../modules/archive/models/ScriptBundle", () => ({
  ScriptBundle: {
    create: (a: unknown) => mockBundleCreate(a),
    findById: (id: unknown) => mockBundleFindById(id),
    findOne: (q: unknown) => mockBundleFindOne(q),
    find: (q: unknown) => mockBundleFind(q),
    aggregate: (p: unknown) => mockBundleAggregate(p),
  },
}));

const mockTestFindById = jest.fn();
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: { findById: (id: unknown) => mockTestFindById(id) },
}));

const mockYearFindOne = jest.fn();
jest.mock("../modules/foundation/models/AcademicYear", () => ({
  AcademicYear: { findOne: (q: unknown) => mockYearFindOne(q) },
}));

const mockUserFind: jest.Mock = jest.fn((..._a: unknown[]) => leanChain([]));
jest.mock("../modules/foundation/models/User", () => ({
  User: { find: (q: unknown) => mockUserFind(q) },
}));

const mockAudit = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/platform/services/AuditService", () => ({
  writeAudit: (e: unknown) => mockAudit(e),
}));

import {
  generateBoxCode,
  fileBundle,
  acknowledgeBundle,
  checkOutBundle,
  checkInBundle,
  disposeBundle,
  voidBundle,
  bundleShape,
  locationsForTests,
} from "../modules/archive/services/ArchiveService";
import { validateArchivePhotoUpload } from "../routes/files";
import type { IScriptBundle } from "../modules/archive/models/ScriptBundle";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const actorId = oid().toString();
const yearId = oid();
const prevYearId = oid();
const sectionId = oid();
const boxId = oid();

const printedTest = () => ({
  _id: oid(),
  ctId: "CT-C5-BAN-0001",
  academicYearId: yearId,
  classLevel: 5,
  sectionId,
  subject: "BAN",
  testNumber: 1,
  examDate: new Date("2026-08-02"),
  status: "PRINTED",
});

const activeBox = () => ({ _id: boxId, boxCode: "BX-2026-01", status: "ACTIVE" });

/** A live mongoose-ish bundle doc: plain fields + save/markModified stubs. */
const liveBundle = (over: Partial<Record<string, unknown>> = {}) => {
  const b: Record<string, unknown> = {
    _id: oid(),
    source: { kind: "CLASS_TEST", refId: oid() },
    sourceLabel: "CT-C5-BAN-0001",
    academicYearId: yearId,
    classLevel: 5,
    sectionId,
    subject: "BAN",
    testNumber: 1,
    examDate: new Date("2026-08-02"),
    scriptCount: 8,
    boxId,
    filedBy: new mongoose.Types.ObjectId(actorId),
    filedAt: new Date("2026-08-03"),
    acknowledgedBy: null,
    acknowledgedAt: null,
    status: "FILED",
    checkouts: [],
    attachmentFileIds: [],
    disposedBy: null, disposedAt: null, disposeReason: null,
    voidedBy: null, voidedAt: null, voidReason: null,
    notes: null,
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
    ...over,
  };
  return b as unknown as IScriptBundle & { save: jest.Mock };
};

/** Both current + previous academic years exist and are the protected window. */
function stubProtectedYears() {
  mockYearFindOne.mockImplementation((q: Record<string, unknown>) => {
    if (q && "current" in q) {
      return { lean: async () => ({ _id: yearId, startDate: new Date("2026-01-01") }) };
    }
    return leanChain({ _id: prevYearId, startDate: new Date("2025-01-01") });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBundleAggregate.mockResolvedValue([]);
  mockUserFind.mockImplementation(() => leanChain([]));
  stubProtectedYears();
});

// ---------------------------------------------------------------------------
// Box code minting (D-#445)
// ---------------------------------------------------------------------------

describe("generateBoxCode", () => {
  it("formats BX-{year}-{seq} with a 2-digit pad and bumps atomically", async () => {
    mockSeqUpdate.mockResolvedValue({ seq: 3 });
    expect(await generateBoxCode(2026)).toBe("BX-2026-03");
    expect(mockSeqUpdate).toHaveBeenCalledWith(
      { year: 2026 },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
  });

  it("does not truncate a 3-digit sequence", async () => {
    mockSeqUpdate.mockResolvedValue({ seq: 123 });
    expect(await generateBoxCode(2026)).toBe("BX-2026-123");
  });
});

// ---------------------------------------------------------------------------
// Filing (AR-1)
// ---------------------------------------------------------------------------

describe("fileBundle", () => {
  const input = (over: Partial<Parameters<typeof fileBundle>[0]> = {}) => ({
    sourceKind: "CLASS_TEST" as const,
    sourceRefId: oid().toString(),
    scriptCount: 8,
    boxId: boxId.toString(),
    actorId,
    actorCanManage: false,
    ...over,
  });

  it("refuses a test that is not PRINTED", async () => {
    mockTestFindById.mockReturnValue(leanChain({ ...printedTest(), status: "REQUESTED" }));
    await expect(fileBundle(input())).rejects.toThrow(/অফিসিয়াল/);
    expect(mockBundleCreate).not.toHaveBeenCalled();
  });

  it("refuses the reserved EXAM source kind (unwired in v1)", async () => {
    await expect(fileBundle(input({ sourceKind: "EXAM" }))).rejects.toThrow(/EXAM/);
  });

  it("refuses a RETIRED box", async () => {
    mockTestFindById.mockReturnValue(leanChain(printedTest()));
    mockBoxFindById.mockReturnValue(leanChain({ ...activeBox(), status: "RETIRED" }));
    await expect(fileBundle(input())).rejects.toThrow(/বন্ধ/);
  });

  it("refuses a second live bundle, naming the existing bundle's box", async () => {
    mockTestFindById.mockReturnValue(leanChain(printedTest()));
    mockBoxFindById
      .mockReturnValueOnce(leanChain(activeBox()))
      .mockReturnValueOnce(leanChain({ boxCode: "BX-2026-02" }));
    mockBundleFindOne.mockReturnValue(leanChain({ boxId: oid() }));
    await expect(fileBundle(input())).rejects.toThrow(/BX-2026-02/);
    expect(mockBundleCreate).not.toHaveBeenCalled();
  });

  it("denormalizes from the SOURCE row, stamps the filer, audits — teacher path is NOT auto-acked", async () => {
    const test = printedTest();
    mockTestFindById.mockReturnValue(leanChain(test));
    mockBoxFindById.mockReturnValue(leanChain(activeBox()));
    mockBundleFindOne.mockReturnValue(leanChain(null));
    mockBundleCreate.mockImplementation(async (a) => liveBundle(a as Record<string, unknown>));

    await fileBundle(input());
    const created = mockBundleCreate.mock.calls[0][0];
    expect(created.sourceLabel).toBe("CT-C5-BAN-0001");
    expect(created.classLevel).toBe(5);
    expect(created.subject).toBe("BAN");
    expect(created.academicYearId).toBe(test.academicYearId);
    expect(created.acknowledgedAt).toBeNull();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SCRIPT_BUNDLE_FILED" }),
    );
  });

  it("auto-acknowledges when the filer holds roster:manage (D-#444)", async () => {
    mockTestFindById.mockReturnValue(leanChain(printedTest()));
    mockBoxFindById.mockReturnValue(leanChain(activeBox()));
    mockBundleFindOne.mockReturnValue(leanChain(null));
    mockBundleCreate.mockImplementation(async (a) => liveBundle(a as Record<string, unknown>));

    await fileBundle(input({ actorCanManage: true }));
    const created = mockBundleCreate.mock.calls[0][0];
    expect(created.acknowledgedBy).toBe(actorId);
    expect(created.acknowledgedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Acknowledgement (AR-2, D-#444 — once, additive)
// ---------------------------------------------------------------------------

describe("acknowledgeBundle", () => {
  it("stamps once and audits", async () => {
    const b = liveBundle();
    mockBundleFindById.mockResolvedValue(b);
    await acknowledgeBundle({ bundleId: b._id.toString(), actorId });
    expect(b.acknowledgedAt).toBeInstanceOf(Date);
    expect(b.save).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SCRIPT_BUNDLE_ACKNOWLEDGED" }),
    );
  });

  it("refuses a second acknowledgement", async () => {
    const b = liveBundle({ acknowledgedAt: new Date() });
    mockBundleFindById.mockResolvedValue(b);
    await expect(acknowledgeBundle({ bundleId: b._id.toString(), actorId })).rejects.toThrow(
      /আগেই/,
    );
  });

  it("refuses a VOID bundle", async () => {
    const b = liveBundle({ status: "VOID" });
    mockBundleFindById.mockResolvedValue(b);
    await expect(acknowledgeBundle({ bundleId: b._id.toString(), actorId })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Desk checkout / check-in (AR-2)
// ---------------------------------------------------------------------------

describe("checkOutBundle / checkInBundle", () => {
  it("checkout requires FILED, records borrower + purpose, audits", async () => {
    const b = liveBundle();
    mockBundleFindById.mockResolvedValue(b);
    const toUserId = oid().toString();
    await checkOutBundle({
      bundleId: b._id.toString(),
      toUserId,
      purpose: "পুনরায় যাচাই",
      expectedReturnDateKey: "2026-08-10",
      actorId,
    });
    expect(b.status).toBe("CHECKED_OUT");
    expect(b.checkouts).toHaveLength(1);
    expect(b.checkouts[0].purpose).toBe("পুনরায় যাচাই");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SCRIPT_BUNDLE_CHECKED_OUT" }),
    );
  });

  it("checkout refuses a CHECKED_OUT bundle and an empty purpose", async () => {
    const out = liveBundle({ status: "CHECKED_OUT" });
    mockBundleFindById.mockResolvedValue(out);
    await expect(
      checkOutBundle({ bundleId: "x", toUserId: oid().toString(), purpose: "p", actorId }),
    ).rejects.toThrow(/FILED/);

    const filed = liveBundle();
    mockBundleFindById.mockResolvedValue(filed);
    await expect(
      checkOutBundle({ bundleId: "x", toUserId: oid().toString(), purpose: "   ", actorId }),
    ).rejects.toThrow(/কারণ/);
  });

  it("check-in closes the open row and returns to FILED; re-box refuses a RETIRED box", async () => {
    const open = {
      toUserId: oid(),
      purpose: "যাচাই",
      expectedReturnDateKey: null,
      checkedOutBy: oid(),
      checkedOutAt: new Date(),
      returnedBy: null,
      returnedAt: null,
      returnNote: null,
    };
    const b = liveBundle({ status: "CHECKED_OUT", checkouts: [open] });
    mockBundleFindById.mockResolvedValue(b);
    await checkInBundle({ bundleId: b._id.toString(), note: "ঠিক আছে", actorId });
    expect(b.status).toBe("FILED");
    expect(b.checkouts[0].returnedAt).toBeInstanceOf(Date);
    expect(b.checkouts[0].returnNote).toBe("ঠিক আছে");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SCRIPT_BUNDLE_CHECKED_IN" }),
    );

    const b2 = liveBundle({ status: "CHECKED_OUT", checkouts: [{ ...open }] });
    mockBundleFindById.mockResolvedValue(b2);
    mockBoxFindById.mockReturnValue(leanChain({ boxCode: "BX-2026-09", status: "RETIRED" }));
    await expect(
      checkInBundle({ bundleId: b2._id.toString(), boxId: oid().toString(), actorId }),
    ).rejects.toThrow(/বন্ধ/);
  });

  it("check-in refuses a bundle that is not checked out", async () => {
    const b = liveBundle();
    mockBundleFindById.mockResolvedValue(b);
    await expect(checkInBundle({ bundleId: "x", actorId })).rejects.toThrow(/বের করা/);
  });

  it("overdue derives from the open checkout's expectedReturnDateKey", () => {
    const past = liveBundle({
      status: "CHECKED_OUT",
      checkouts: [
        {
          toUserId: oid(), purpose: "p", expectedReturnDateKey: "2020-01-01",
          checkedOutBy: oid(), checkedOutAt: new Date(), returnedBy: null,
          returnedAt: null, returnNote: null,
        },
      ],
    });
    expect(bundleShape(past as unknown as IScriptBundle).overdue).toBe(true);

    const future = liveBundle({
      status: "CHECKED_OUT",
      checkouts: [
        {
          toUserId: oid(), purpose: "p", expectedReturnDateKey: "2999-01-01",
          checkedOutBy: oid(), checkedOutAt: new Date(), returnedBy: null,
          returnedAt: null, returnNote: null,
        },
      ],
    });
    expect(bundleShape(future as unknown as IScriptBundle).overdue).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retention + disposal / void (AR-3, D-#446)
// ---------------------------------------------------------------------------

describe("disposeBundle / voidBundle", () => {
  it("refuses disposal while CHECKED_OUT", async () => {
    const b = liveBundle({ status: "CHECKED_OUT" });
    mockBundleFindById.mockResolvedValue(b);
    await expect(disposeBundle({ bundleId: "x", reason: "r", actorId })).rejects.toThrow(
      /ফেরত/,
    );
  });

  it("refuses disposal inside the protected current+previous-year window", async () => {
    const b = liveBundle({ academicYearId: prevYearId });
    mockBundleFindById.mockResolvedValue(b);
    await expect(disposeBundle({ bundleId: "x", reason: "পুরনো", actorId })).rejects.toThrow(
      /শিক্ষাবর্ষ/,
    );
  });

  it("disposes an outside-retention bundle with reason + actor + audit", async () => {
    const oldYear = oid();
    const b = liveBundle({ academicYearId: oldYear });
    mockBundleFindById.mockResolvedValue(b);
    await disposeBundle({ bundleId: b._id.toString(), reason: "মেয়াদ শেষ", actorId });
    expect(b.status).toBe("DISPOSED");
    expect(b.disposeReason).toBe("মেয়াদ শেষ");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: "SCRIPT_BUNDLE_DISPOSED" }),
    );
  });

  it("void only from FILED; keeps the record with reason", async () => {
    const b = liveBundle();
    mockBundleFindById.mockResolvedValue(b);
    await voidBundle({ bundleId: b._id.toString(), reason: "ভুল টেস্টে ফাইল", actorId });
    expect(b.status).toBe("VOID");
    expect(b.voidReason).toBe("ভুল টেস্টে ফাইল");

    const disposed = liveBundle({ status: "DISPOSED" });
    mockBundleFindById.mockResolvedValue(disposed);
    await expect(voidBundle({ bundleId: "x", reason: "r", actorId })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Batched lookup line (AR-1)
// ---------------------------------------------------------------------------

describe("locationsForTests", () => {
  it("returns box code + location, and the holder's name while CHECKED_OUT", async () => {
    const testId = oid();
    const holder = oid();
    const bundle = {
      _id: oid(),
      source: { kind: "CLASS_TEST", refId: testId },
      boxId,
      status: "CHECKED_OUT",
      checkouts: [
        {
          toUserId: holder, purpose: "p", expectedReturnDateKey: null,
          checkedOutBy: oid(), checkedOutAt: new Date(), returnedBy: null,
          returnedAt: null, returnNote: null,
        },
      ],
    };
    mockBundleFind.mockReturnValue(leanChain([bundle]));
    mockBoxFind.mockReturnValue(
      leanChain([{ _id: boxId, boxCode: "BX-2026-01", locationNote: "অফিস আলমারি, তাক ২" }]),
    );
    mockUserFind.mockReturnValue(leanChain([{ _id: holder, name: "রহিম" }]));

    const rows = await locationsForTests([testId.toString()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      testId: testId.toString(),
      boxCode: "BX-2026-01",
      locationNote: "অফিস আলমারি, তাক ২",
      status: "CHECKED_OUT",
      holderName: "রহিম",
    });
  });

  it("short-circuits on an empty id list", async () => {
    expect(await locationsForTests([])).toEqual([]);
    expect(mockBundleFind).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Photo upload validation (AR-3)
// ---------------------------------------------------------------------------

describe("validateArchivePhotoUpload", () => {
  it("admits jpeg/png ≤ 5 MB and refuses pdf / oversize / empty", () => {
    expect(validateArchivePhotoUpload("image/jpeg", 1024)).toBeNull();
    expect(validateArchivePhotoUpload("image/png", 5 * 1024 * 1024)).toBeNull();
    expect(validateArchivePhotoUpload("application/pdf", 1024)).toMatch(/JPEG/);
    expect(validateArchivePhotoUpload("image/jpeg", 5 * 1024 * 1024 + 1)).toMatch(/৫/);
    expect(validateArchivePhotoUpload("image/png", 0)).not.toBeNull();
  });
});
