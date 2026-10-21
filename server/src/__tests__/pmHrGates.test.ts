/**
 * PM sweep — HR / finance / printing gates on catalogue actions (D-#790..#801).
 *
 * Executes REAL GraphQL against the built schema so the Pothos scope layer (the real
 * permission map, role defaults, role-template overrides and per-person grants) is
 * exercised, plus the in-resolver branch checks this sweep introduced:
 *   1. `staff` / `staffProfile` sensitive-field gates (owner ruling 2026-10-20, PRD §12
 *      Q6): pay → payroll:view, NID + bank → staff_records:view_sensitive, else null.
 *   2. `updateStaffProfile` ignores blank NID/bank values from a caller who cannot see
 *      them (the form was shown null and must not clear the record).
 *   3. `decideStaffLeave` split: approve/reject → leave:approve; cancel another's →
 *      leave:approve; cancel own → leave:apply (SELF).
 *   4. `cancelPrintRequest` split: any job → printing:process; own → printing:create.
 * Invariant: every default PRINCIPAL / TEACHER / OFFICE login keeps today's answer.
 *
 * DB-free: models and services are mocked; a service that is reached throws a sentinel
 * so "the gate let it through" is observable without decorating a result.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();
const REACHED = "SERVICE_REACHED";

// --- staff records -----------------------------------------------------------
const STAFF_DOC = {
  _id: oid(),
  schoolId: "0042",
  name: "Rumana",
  category: "teacher",
  employmentType: "full_time",
  employmentStatus: "confirmed",
  active: true,
  nid: "1990123456789",
  bankAccount: "0011223344",
  bankAccountName: "Rumana",
  bankName: "IBBL",
  bankBranch: "Zindabazar",
  routingNo: "125910001",
  monthlySalary: 18000,
  paymentMethod: "bank",
};
jest.mock("../modules/foundation/models/StaffProfile", () => ({
  StaffProfile: {
    find: () => ({ sort: () => ({ lean: async () => [STAFF_DOC] }) }),
    findById: () => ({ lean: async () => STAFF_DOC }),
  },
}));
const mockUpdateStaffProfile = jest.fn();
jest.mock("../modules/foundation/services/StaffProfileService", () => ({
  StaffProfileError: class extends Error {},
  createStaffProfile: jest.fn(),
  updateStaffProfile: (...a: unknown[]) => mockUpdateStaffProfile(...a),
}));

// --- staff leave -------------------------------------------------------------
const mockDecideLeave = jest.fn();
jest.mock("../modules/hr/services/StaffLeaveService", () => ({
  applyForLeave: jest.fn(),
  decideLeave: (...a: unknown[]) => mockDecideLeave(...a),
  leaveForStaff: jest.fn(),
  listLeave: jest.fn(),
  listLeavePage: jest.fn(),
}));
jest.mock("../modules/hr/services/LeaveEntitlementService", () => ({
  balancesForStaff: jest.fn(),
  upsertEntitlement: jest.fn(),
}));
jest.mock("../modules/hr/services/CoverService", () => ({
  proposeCover: jest.fn(),
  decideCoverSlot: jest.fn(),
  coverSlotsForLeave: jest.fn(),
  needsCoverSlots: jest.fn(),
  routineSubjectForSlot: jest.fn(),
}));
const MY_PROFILE = oid().toString();
jest.mock("../modules/hr/services/staffMatch", () => ({
  resolveStaffProfileForUser: async () => ({ _id: { toString: () => MY_PROFILE } }),
}));
let leaveOwner = MY_PROFILE;
jest.mock("../modules/hr/models/StaffLeaveApplication", () => ({
  StaffLeaveApplication: {
    findById: () => ({ select: () => ({ lean: async () => ({ staffProfileId: { toString: () => leaveOwner } }) }) }),
  },
}));

// --- printing ----------------------------------------------------------------
const mockCancelPrint = jest.fn();
jest.mock("../modules/printing/services/PrintRequestService", () => {
  const stub = () => jest.fn();
  return {
    countingSectionIdOf: stub(),
    presentCountFrom: stub(),
    createPrintRequest: stub(),
    markPrinted: stub(),
    markDelivered: stub(),
    cancelPrintRequest: (...a: unknown[]) => mockCancelPrint(...a),
    printQueue: stub(),
    myPrintRequests: stub(),
    myPrintRequestsPage: stub(),
    printRequestById: stub(),
    printQueueCounts: stub(),
    printHistory: stub(),
    printHistoryPage: stub(),
    printHistoryFacets: stub(),
    reprintPrintRequest: stub(),
    tagPrintRequests: stub(),
    suggestTagFor: stub(),
  };
});

import { builder } from "../schema";
import "../modules/foundation/resolvers/staff";
import "../modules/hr/resolvers/staffLeave";
import "../modules/printing/resolvers/printRequest";

const schema = builder.toSchema();

type Auth = {
  role: string;
  userId: string;
  additionalTemplates?: string[];
  grantedPermissions?: string[];
  revokedPermissions?: string[];
};
const as = (role: string, extra: Partial<Auth> = {}): Auth => ({ role, userId: oid().toString(), ...extra });
const run = (source: string, auth: Auth | null): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth } }) as Promise<ExecutionResult>;
const msg = (r: ExecutionResult) => (r.errors ?? []).map((e) => e.message).join(" | ");
const denied = (r: ExecutionResult) => /Not authorized|অনুমতি|may only|Only Principal|Not allowed/i.test(msg(r));

afterEach(() => {
  setRoleTemplateOverrides({});
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Sensitive staff fields
// ---------------------------------------------------------------------------

const STAFF_Q = `query { staff { id name monthlySalary paymentMethod nid bankAccount bankAccountName bankName bankBranch routingNo } }`;
const ONE_Q = (id: string) => `query { staffProfile(staffProfileId: "${id}") { name monthlySalary nid bankAccount } }`;
type StaffRow = Record<string, unknown>;
const firstRow = (r: ExecutionResult): StaffRow => ((r.data?.staff as StaffRow[]) ?? [])[0];

describe("staff records — sensitive field gates (PRD §12 Q6)", () => {
  test("default Office and Principal see pay, NID and bank exactly as before", async () => {
    for (const role of ["OFFICE", "PRINCIPAL"]) {
      const r = await run(STAFF_Q, as(role));
      expect(r.errors).toBeUndefined();
      const row = firstRow(r);
      expect(row.monthlySalary).toBe(18000);
      expect(row.paymentMethod).toBe("bank");
      expect(row.nid).toBe(STAFF_DOC.nid);
      expect(row.bankAccount).toBe(STAFF_DOC.bankAccount);
      expect(row.routingNo).toBe(STAFF_DOC.routingNo);
    }
  });

  test("a default Teacher cannot read staff records at all", async () => {
    expect(denied(await run(STAFF_Q, as("TEACHER")))).toBe(true);
  });

  test("Office with payroll:view switched off: pay fields null, NID/bank still shown", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["payroll:view"] } });
    const row = firstRow(await run(STAFF_Q, as("OFFICE")));
    expect(row.name).toBe("Rumana");
    expect(row.monthlySalary).toBeNull();
    expect(row.paymentMethod).toBeNull();
    expect(row.nid).toBe(STAFF_DOC.nid);
    expect(row.bankAccount).toBe(STAFF_DOC.bankAccount);
  });

  test("Office with staff_records:view_sensitive switched off: NID + every bank field null, pay shown", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["staff_records:view_sensitive"] } });
    const row = firstRow(await run(STAFF_Q, as("OFFICE")));
    for (const f of ["nid", "bankAccount", "bankAccountName", "bankName", "bankBranch", "routingNo"]) {
      expect(row[f]).toBeNull();
    }
    expect(row.monthlySalary).toBe(18000);
  });

  test("a Teacher granted only staff_records:view sees the list with pay, NID and bank masked", async () => {
    const row = firstRow(await run(STAFF_Q, as("TEACHER", { grantedPermissions: ["staff_records:view"] })));
    expect(row.name).toBe("Rumana");
    expect(row.monthlySalary).toBeNull();
    expect(row.nid).toBeNull();
    expect(row.bankAccount).toBeNull();
  });

  test("staffProfile applies the same field gates", async () => {
    const id = STAFF_DOC._id.toString();
    const full = (await run(ONE_Q(id), as("OFFICE"))).data?.staffProfile as StaffRow;
    expect(full.monthlySalary).toBe(18000);
    expect(full.nid).toBe(STAFF_DOC.nid);
    const masked = (await run(ONE_Q(id), as("TEACHER", { grantedPermissions: ["staff_records:view"] }))).data
      ?.staffProfile as StaffRow;
    expect(masked.monthlySalary).toBeNull();
    expect(masked.nid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. updateStaffProfile — a masked caller cannot clear what it never saw
// ---------------------------------------------------------------------------

const UPDATE_M = (input: string) =>
  `mutation { updateStaffProfile(staffProfileId: "${STAFF_DOC._id}", input: ${input}) { name } }`;

describe("updateStaffProfile — staff_records:edit + the blank-sensitive guard", () => {
  beforeEach(() => mockUpdateStaffProfile.mockResolvedValue(STAFF_DOC));

  test("default Office passes the blanks through (it can see them, so a blank really clears)", async () => {
    const r = await run(UPDATE_M(`{ name: "R", nid: "", bankAccount: "" }`), as("OFFICE"));
    expect(r.errors).toBeUndefined();
    expect(mockUpdateStaffProfile.mock.calls[0][1]).toEqual({ name: "R", nid: "", bankAccount: "" });
  });

  test("without view_sensitive, blank NID/bank are dropped; a typed value is still written", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["staff_records:view_sensitive"] } });
    const r = await run(UPDATE_M(`{ name: "R", nid: "", bankAccount: "999", routingNo: "" }`), as("OFFICE"));
    expect(r.errors).toBeUndefined();
    expect(mockUpdateStaffProfile.mock.calls[0][1]).toEqual({ name: "R", bankAccount: "999" });
  });

  test("Office with staff_records:edit switched off is refused", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["staff_records:edit"] } });
    expect(denied(await run(UPDATE_M(`{ name: "R" }`), as("OFFICE")))).toBe(true);
    expect(mockUpdateStaffProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. decideStaffLeave — approve/reject vs cancel own vs cancel another's
// ---------------------------------------------------------------------------

const DECIDE = (decision: string) =>
  `mutation { decideStaffLeave(applicationId: "${oid()}", decision: "${decision}") { status } }`;

describe("decideStaffLeave — leave:approve / leave:apply split", () => {
  beforeEach(() => mockDecideLeave.mockRejectedValue(new Error(REACHED)));

  test("defaults: Office/Principal approve and reject; a Teacher may not", async () => {
    for (const role of ["OFFICE", "PRINCIPAL"]) {
      expect(msg(await run(DECIDE("approve"), as(role)))).toContain(REACHED);
      expect(msg(await run(DECIDE("reject"), as(role)))).toContain(REACHED);
    }
    expect(denied(await run(DECIDE("approve"), as("TEACHER")))).toBe(true);
  });

  test("a Teacher cancels their OWN leave (leave:apply, SELF) but not another's", async () => {
    leaveOwner = MY_PROFILE;
    expect(msg(await run(DECIDE("cancel"), as("TEACHER")))).toContain(REACHED);
    leaveOwner = oid().toString();
    expect(denied(await run(DECIDE("cancel"), as("TEACHER")))).toBe(true);
    leaveOwner = MY_PROFILE;
  });

  test("Office with leave:approve switched off cannot approve nor cancel another's; a Teacher granted it can", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["leave:approve"] } });
    expect(denied(await run(DECIDE("approve"), as("OFFICE")))).toBe(true);
    leaveOwner = oid().toString();
    expect(denied(await run(DECIDE("cancel"), as("OFFICE")))).toBe(true);
    expect(msg(await run(DECIDE("approve"), as("TEACHER", { grantedPermissions: ["leave:approve"] })))).toContain(REACHED);
    expect(msg(await run(DECIDE("cancel"), as("TEACHER", { grantedPermissions: ["leave:approve"] })))).toContain(REACHED);
    leaveOwner = MY_PROFILE;
  });

  test("a legacy per-person leave:manage grant still approves (read-time expansion)", async () => {
    expect(msg(await run(DECIDE("approve"), as("TEACHER", { grantedPermissions: ["leave:manage"] })))).toContain(REACHED);
  });
});

// ---------------------------------------------------------------------------
// 4. cancelPrintRequest — any job (printing:process) vs own (printing:create)
// ---------------------------------------------------------------------------

const CANCEL = `mutation { cancelPrintRequest(id: "${oid()}") { id } }`;

describe("cancelPrintRequest — printing:process / printing:create split", () => {
  beforeEach(() => mockCancelPrint.mockRejectedValue(new Error(REACHED)));
  const isOfficeArg = () => (mockCancelPrint.mock.calls[0][2] as { isOffice: boolean }).isOffice;

  test("defaults: Office cancels ANY job; a Teacher reaches the service own-row only", async () => {
    expect(msg(await run(CANCEL, as("OFFICE")))).toContain(REACHED);
    expect(isOfficeArg()).toBe(true);
    mockCancelPrint.mockClear();
    expect(msg(await run(CANCEL, as("TEACHER")))).toContain(REACHED);
    expect(isOfficeArg()).toBe(false);
  });

  test("Office with printing:process switched off is refused (it holds no printing:create)", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["printing:process"] } });
    expect(denied(await run(CANCEL, as("OFFICE")))).toBe(true);
    expect(mockCancelPrint).not.toHaveBeenCalled();
  });

  test("a Teacher granted printing:process cancels any job; one with printing:create revoked cannot cancel", async () => {
    expect(msg(await run(CANCEL, as("TEACHER", { grantedPermissions: ["printing:process"] })))).toContain(REACHED);
    expect(isOfficeArg()).toBe(true);
    mockCancelPrint.mockClear();
    expect(denied(await run(CANCEL, as("TEACHER", { revokedPermissions: ["printing:create"] })))).toBe(true);
  });

  test("a legacy roster:manage revoke still removes the operator powers (expansion keeps parity)", async () => {
    expect(denied(await run(CANCEL, as("OFFICE", { revokedPermissions: ["roster:manage"] })))).toBe(true);
  });
});
