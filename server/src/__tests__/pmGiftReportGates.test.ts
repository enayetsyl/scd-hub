/**
 * PM sweep (D-#790..#801) — the gift and oversight-report gates that were role checks.
 *
 *   - recordGiftHandover: `assignment_gift:issue` + class teacher of the student's
 *     শাখা, the designation waived by `assignment_gift:view_all` (was isAdminStaff).
 *   - assignmentGiftReport: `assignment_gift:view`; no শাখা needs `view_all`.
 *   - reconciliationReport: any-of `homework:view_reports` / `assignment:view_reports`
 *     (was actsAsRole P/O).
 *
 * Defaults reproduce today; a role switch or a per-person grant moves the gate.
 * DB-free: the services and models are mocked.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => ({ select: () => ({ lean: async () => val }), lean: async () => val });

jest.mock("../modules/trackers/services/AssignmentGiftService");
jest.mock("../modules/trackers/services/ReconReportService");

const mockStudentFindById = jest.fn();
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findById: (id: unknown) => leanChain(mockStudentFindById(id)) },
}));
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => leanChain(mockSectionFindById(id)) },
}));

import { builder } from "../schema";
import "../modules/trackers/resolvers/assignmentGift";
import "../modules/trackers/resolvers/reconReport";

const schema = builder.toSchema();
const gift = jest.requireMock("../modules/trackers/services/AssignmentGiftService") as Record<string, jest.Mock>;
const recon = jest.requireMock("../modules/trackers/services/ReconReportService") as Record<string, jest.Mock>;

const ME = oid().toString();
const run = (source: string, role: string, extra: Record<string, unknown> = {}): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth: { role, userId: ME, ...extra } } }) as Promise<ExecutionResult>;
const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;

const HANDOVER = `mutation { recordGiftHandover(academicYearId: "y", studentId: "${oid()}", kind: "WEEKLY", weekNumber: 3) { __typename } }`;
const REPORT = `query { assignmentGiftReport(academicYearId: "y") { __typename } }`;
const RECON = `query { reconciliationReport(from: "2026-10-01", to: "2026-10-21") { __typename } }`;

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentFindById.mockReturnValue({ sectionId: oid() });
  mockSectionFindById.mockReturnValue({ classTeacherId: null });
  gift.recordGiftHandover.mockResolvedValue({});
  gift.assignmentGiftReport.mockResolvedValue({});
  recon.reconciliationReport.mockResolvedValue({});
});
afterEach(() => setRoleTemplateOverrides({}));

describe("recordGiftHandover — issue + class teacher, waived by view_all", () => {
  test("default Office ticks any student (the waiver), without the class-teacher lookup", async () => {
    expect(ok(await run(HANDOVER, "OFFICE"))).toBe(true);
    expect(mockStudentFindById).not.toHaveBeenCalled();
  });

  test("Office with view_all switched off falls back to the designation — and is refused", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["assignment_gift:view_all"] } });
    expect(ok(await run(HANDOVER, "OFFICE"))).toBe(false);
    expect(gift.recordGiftHandover).not.toHaveBeenCalled();
  });

  test("the student's class teacher ticks; another teacher is refused", async () => {
    expect(ok(await run(HANDOVER, "TEACHER"))).toBe(false);
    mockSectionFindById.mockReturnValue({ classTeacherId: ME });
    expect(ok(await run(HANDOVER, "TEACHER"))).toBe(true);
  });

  test("Teacher issue switched off: even the class teacher is refused", async () => {
    mockSectionFindById.mockReturnValue({ classTeacherId: ME });
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["assignment_gift:issue"] } });
    expect(ok(await run(HANDOVER, "TEACHER"))).toBe(false);
  });
});

describe("assignmentGiftReport — the whole school needs view_all", () => {
  test("Office and the Principal read it with no শাখা; a teacher must name one", async () => {
    expect(ok(await run(REPORT, "OFFICE"))).toBe(true);
    expect(ok(await run(REPORT, "PRINCIPAL"))).toBe(true);
    expect(ok(await run(REPORT, "TEACHER"))).toBe(false);
  });

  test("a teacher granted view_all per person reads it school-wide", async () => {
    expect(ok(await run(REPORT, "TEACHER", { grantedPermissions: ["assignment_gift:view_all"] }))).toBe(true);
  });
});

describe("reconciliationReport — either tracker's view_reports", () => {
  test("Principal and Office by default; a teacher is refused", async () => {
    expect(ok(await run(RECON, "PRINCIPAL"))).toBe(true);
    expect(ok(await run(RECON, "OFFICE"))).toBe(true);
    expect(ok(await run(RECON, "TEACHER"))).toBe(false);
  });

  test("a role edit stored under the RETIRED names still applies (D-#846 translation)", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["homework:view_reports"] } });
    expect(ok(await run(RECON, "OFFICE"))).toBe(true);
    // Both retired names off + the print desk off: no part of the payload is left for the Office.
    setRoleTemplateOverrides({
      OFFICE: { granted: [], revoked: ["homework:view_reports", "assignment:view_reports", "printing:view_all"] },
    });
    expect(ok(await run(RECON, "OFFICE"))).toBe(false);
  });

  test("a teacher granted assignment:view_reports reads it", async () => {
    expect(ok(await run(RECON, "TEACHER", { grantedPermissions: ["assignment:view_reports"] }))).toBe(true);
  });
});
