/**
 * PM sweep — foundation & platform gates (docs/permission-catalogue/foundation-platform.md).
 *
 * Executes REAL GraphQL against the built schema so the Pothos scope layer and the
 * in-body checks run with the real catalogue. Role bypasses that became actions:
 *   - archive reads: isAdminStaff OR tracker:read → `archive:view`;
 *   - fileScriptBundle's desk path (any source + auto-ack): roster:manage → `archive:approve`;
 *   - archive desk ops: roster:manage → approve / lend / void / delete / settings;
 *   - adminToday: actsAs PRINCIPAL|OFFICE → `admin_dashboard:view`.
 * Ship day (no edits) every default login keeps today's answer; a role edit or a
 * per-person grant moves it. Services are mocked (RBAC, not the flow). DB-free.
 */
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

const mockFileBundle = jest.fn();
const mockAnchorWrite = jest.fn();

const mockBundle = {
  id: "b1", sourceKind: "CLASS_TEST", sourceRefId: "t1", sourceLabel: "CT", academicYearId: "y",
  classLevel: 4, sectionId: "s", subject: "MATH", testNumber: 1, examDate: "2026-10-01",
  scriptCount: 10, boxId: "x", filedBy: "u", filedByName: null, filedAt: "2026-10-01",
  acknowledgedBy: null, acknowledgedAt: null, status: "FILED", checkouts: [], attachmentFileIds: [],
  disposedBy: null, disposedAt: null, disposeReason: null, voidedBy: null, voidedAt: null,
  voidReason: null, notes: null, overdue: false,
};
const mockBox = {
  id: "x", boxCode: "BX-2026-1", label: null, locationNote: "shelf", status: "ACTIVE",
  createdBy: "u", createdAt: "2026-10-01", bundleCount: 0, scriptCount: 0,
};

jest.mock("../modules/archive/services/ArchiveService", () => {
  const one = jest.fn(async () => mockBundle);
  const many = jest.fn(async () => [mockBundle]);
  const page = jest.fn(async () => ({ rows: [mockBundle], total: 1, page: 1, pageSize: 20, hasMore: false }));
  return {
    createBox: jest.fn(async () => mockBox),
    updateBox: jest.fn(async () => mockBox),
    retireBox: jest.fn(async () => mockBox),
    listBoxes: jest.fn(async () => [mockBox]),
    getBox: jest.fn(async () => mockBox),
    fileBundle: (...a: unknown[]) => {
      mockFileBundle(...a);
      return Promise.resolve(mockBundle);
    },
    acknowledgeBundle: one,
    checkOutBundle: one,
    checkInBundle: one,
    disposeBundle: one,
    voidBundle: one,
    getBundle: one,
    getBundleForSource: one,
    listBundles: many,
    listBundlesPage: page,
    listDisposablePage: page,
    listBoxBundles: many,
    listOpenCheckouts: many,
    listPendingAcks: many,
    listDisposable: many,
    locationsForTests: jest.fn(async () => []),
    decorateNames: jest.fn(async (rows: unknown[]) => rows),
  };
});
jest.mock("../modules/trackers/models/ClassTest", () => ({
  ClassTest: {
    findById: () => ({
      select: () => ({
        lean: async () => ({ sectionId: "s", classId: "c", subjectGroupId: null, subject: "MATH", teacherId: "t" }),
      }),
    }),
  },
}));
jest.mock("../modules/trackers/classTestAnchor", () => ({
  assertAnchorWrite: (...a: unknown[]) => {
    mockAnchorWrite(...a);
    return Promise.resolve();
  },
  subjectIdOrNull: async () => null,
}));
jest.mock("../modules/dashboard/services/AdminTodayService", () => ({
  adminToday: jest.fn(async () => []),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
jest.mock("../middleware/authz", () => ({ ForbiddenError: FakeForbidden, assertCanWrite: jest.fn() }));

import { builder } from "../schema";
import "../modules/archive/resolvers/archive";
import "../modules/dashboard/resolvers/adminToday";

const schema = builder.toSchema();

type Auth = {
  role: string;
  userId: string;
  additionalTemplates?: string[];
  grantedPermissions?: string[];
  revokedPermissions?: string[];
};
const as = (role: string, extra: Partial<Auth> = {}): { auth: Auth } => ({ auth: { role, userId: "u1", ...extra } });
const run = (source: string, ctx: { auth: Auth | null }): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

afterEach(() => {
  setRoleTemplateOverrides({});
  mockFileBundle.mockClear();
  mockAnchorWrite.mockClear();
});

// ---------------------------------------------------------------------------
// archive:view (was isAdminStaff OR tracker:read)
// ---------------------------------------------------------------------------
const ARCHIVE_READS = [
  `query { storageBoxes { id } }`,
  `query { storageBox(id: "x") { id } }`,
  `query { storageBoxBundles(boxId: "x") { id } }`,
  `query { scriptBundle(id: "b1") { id } }`,
  `query { scriptBundleForTest(sourceKind: "CLASS_TEST", refId: "t1") { id } }`,
  `query { scriptBundles { id } }`,
  `query { openScriptCheckouts { id } }`,
  `query { pendingScriptAcks { id } }`,
  `query { archiveLocationsForTests(testIds: ["t1"]) { testId } }`,
  `query { scriptBundlesPage { total } }`,
];

describe("archive reads ride archive:view", () => {
  test.each(ARCHIVE_READS)("P, T, O read by default; GUARDIAN refused: %s", async (q) => {
    for (const role of ["PRINCIPAL", "TEACHER", "OFFICE"]) expect(denied(await run(q, as(role)))).toBe(false);
    expect(denied(await run(q, as("GUARDIAN")))).toBe(true);
  });

  test("a Principal role edit switching archive:view off for Teacher refuses teachers", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["archive:view"] } });
    expect(denied(await run(ARCHIVE_READS[0], as("TEACHER")))).toBe(true);
    expect(denied(await run(ARCHIVE_READS[0], as("OFFICE")))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fileScriptBundle: archive:create; desk path follows archive:approve
// ---------------------------------------------------------------------------
const FILE = `mutation { fileScriptBundle(sourceKind: "CLASS_TEST", refId: "t1", scriptCount: 10, boxId: "x") { id } }`;
const lastCanManage = () => (mockFileBundle.mock.calls.at(-1)?.[0] as { actorCanManage: boolean }).actorCanManage;

describe("fileScriptBundle", () => {
  test("default Office takes the desk path (no anchor check, auto-ack)", async () => {
    expect(denied(await run(FILE, as("OFFICE")))).toBe(false);
    expect(mockAnchorWrite).not.toHaveBeenCalled();
    expect(lastCanManage()).toBe(true);
  });

  test("default Teacher files under the anchor write check, never auto-acked", async () => {
    expect(denied(await run(FILE, as("TEACHER")))).toBe(false);
    expect(mockAnchorWrite).toHaveBeenCalledTimes(1);
    expect(lastCanManage()).toBe(false);
  });

  test("a Teacher may not file a non-class-test source without archive:approve", async () => {
    const other = FILE.replace('"CLASS_TEST"', '"EXAM"');
    const r = await run(other, as("TEACHER"));
    expect(denied(r)).toBe(true);
  });

  test("Office with archive:approve switched off files like a teacher", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["archive:approve"] } });
    expect(denied(await run(FILE, as("OFFICE")))).toBe(false);
    expect(mockAnchorWrite).toHaveBeenCalledTimes(1);
    expect(lastCanManage()).toBe(false);
  });

  test("a Teacher granted archive:approve per person takes the desk path", async () => {
    expect(denied(await run(FILE, as("TEACHER", { grantedPermissions: ["archive:approve"] })))).toBe(false);
    expect(mockAnchorWrite).not.toHaveBeenCalled();
    expect(lastCanManage()).toBe(true);
  });

  test("GUARDIAN refused", async () => {
    expect(denied(await run(FILE, as("GUARDIAN")))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Desk ops (was roster:manage)
// ---------------------------------------------------------------------------
const DESK: Array<[string, string]> = [
  ["archive:approve", `mutation { acknowledgeScriptBundle(id: "b1") { id } }`],
  ["archive:lend", `mutation { checkOutScriptBundle(id: "b1", toUserId: "u2", purpose: "p") { id } }`],
  ["archive:lend", `mutation { checkInScriptBundle(id: "b1") { id } }`],
  ["archive:delete", `mutation { disposeScriptBundle(id: "b1", reason: "r") { id } }`],
  ["archive:delete", `query { disposableScriptBundles { id } }`],
  ["archive:delete", `query { disposableScriptBundlesPage { total } }`],
  ["archive:void", `mutation { voidScriptBundle(id: "b1", reason: "r") { id } }`],
  ["archive:settings", `mutation { createStorageBox(locationNote: "l") { id } }`],
  ["archive:settings", `mutation { updateStorageBox(id: "x", label: "l") { id } }`],
  ["archive:settings", `mutation { retireStorageBox(id: "x") { id } }`],
];

describe("archive desk ops", () => {
  test.each(DESK)("%s — P and O by default; T and GUARDIAN refused", async (_perm, op) => {
    expect(denied(await run(op, as("PRINCIPAL")))).toBe(false);
    expect(denied(await run(op, as("OFFICE")))).toBe(false);
    expect(denied(await run(op, as("TEACHER")))).toBe(true);
    expect(denied(await run(op, as("GUARDIAN")))).toBe(true);
  });

  test.each(DESK)("%s — Office switched off is refused; a Teacher granted it passes", async (perm, op) => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: [perm] } });
    expect(denied(await run(op, as("OFFICE")))).toBe(true);
    expect(denied(await run(op, as("TEACHER", { grantedPermissions: [perm] })))).toBe(false);
  });

  test("a legacy per-person roster:manage grant still opens the desk (read-time expansion)", async () => {
    expect(denied(await run(DESK[0][1], as("TEACHER", { grantedPermissions: ["roster:manage"] })))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// adminToday: admin_dashboard:view (was actsAs PRINCIPAL|OFFICE)
// ---------------------------------------------------------------------------
const ADMIN_TODAY = `query { adminToday(date: "2026-10-21") { key } }`;

describe("adminToday rides admin_dashboard:view", () => {
  test("P and O pass, T and GUARDIAN refused, a teacher with the OFFICE template passes", async () => {
    expect(denied(await run(ADMIN_TODAY, as("PRINCIPAL")))).toBe(false);
    expect(denied(await run(ADMIN_TODAY, as("OFFICE")))).toBe(false);
    expect(denied(await run(ADMIN_TODAY, as("TEACHER")))).toBe(true);
    expect(denied(await run(ADMIN_TODAY, as("GUARDIAN")))).toBe(true);
    expect(denied(await run(ADMIN_TODAY, as("TEACHER", { additionalTemplates: ["OFFICE"] })))).toBe(false);
  });

  test("Office switched off is refused; a Teacher granted it per person passes", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["admin_dashboard:view"] } });
    expect(denied(await run(ADMIN_TODAY, as("OFFICE")))).toBe(true);
    expect(denied(await run(ADMIN_TODAY, as("TEACHER", { grantedPermissions: ["admin_dashboard:view"] })))).toBe(false);
  });
});
