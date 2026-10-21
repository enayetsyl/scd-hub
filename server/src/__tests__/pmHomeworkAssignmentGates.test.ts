/**
 * PM sweep (docs/prd-permission-matrix.md §5, D-#790..#801) — the homework / assignment
 * gates that moved from coarse permissions and role checks onto catalogue actions.
 *
 *   - transitionHomeworkRecord / transitionAssignmentRecord: the field admits any of the
 *     step actions; the TARGET STATE names the one the call needs (PM §5.1).
 *   - revert*Record: `*:undo_any` replaces the isAdminStaff flag (any actor, any day, no
 *     scope); `*:undo` keeps the scope gate + the service's own-stamp rule (F-7 kept).
 *   - confirmHomeworkDay: `homework:confirm_day` + the designation, waived by
 *     `homework:edit_all` (was the PRINCIPAL leg).
 *   - confirmAssignmentWeek: `assignment:confirm_week` + class teacher, waived by
 *     `assignment:settings` (was roster:manage).
 *   - updateAssignmentItem: `assignment:edit_all` replaces the isAdmin = isAdminStaff flag.
 *
 * Ship day changes nobody's access: each default login is checked, then a switch is
 * turned off for a role (`setRoleTemplateOverrides`) or on for one person.
 *
 * DB-free: services and models are mocked; the scope helpers are spies.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";
import { setRoleTemplateOverrides } from "@scd/shared";

const oid = () => new mongoose.Types.ObjectId();
const leanChain = (val: unknown) => ({ select: () => ({ lean: async () => val }), lean: async () => val });

jest.mock("../modules/trackers/services/HomeworkService");
jest.mock("../modules/trackers/services/HomeworkRevertService");
jest.mock("../modules/trackers/services/HomeworkReconciliationService");
jest.mock("../modules/trackers/services/AssignmentService");
jest.mock("../modules/trackers/services/AssignmentRevertService");

const mockAssertCanWrite = jest.fn();
const mockAssertCanWriteAny = jest.fn();
const mockAssertCanConfirmHomework = jest.fn();
jest.mock("../middleware/authz", () => ({
  ...jest.requireActual("../middleware/authz"),
  assertCanWrite: (...a: unknown[]) => mockAssertCanWrite(...a),
  assertCanWriteAny: (...a: unknown[]) => mockAssertCanWriteAny(...a),
  assertCanConfirmHomework: (...a: unknown[]) => mockAssertCanConfirmHomework(...a),
}));

const mockSubjectFindOne = jest.fn();
jest.mock("../modules/foundation/models/Subject", () => ({
  Subject: { findOne: (f: unknown) => leanChain(mockSubjectFindOne(f)) },
}));
const mockSectionFindById = jest.fn();
jest.mock("../modules/foundation/models/Section", () => ({
  Section: { findById: (id: unknown) => leanChain(mockSectionFindById(id)) },
}));
const mockHwItemFindById = jest.fn();
jest.mock("../modules/trackers/models/HomeworkItem", () => ({
  HomeworkItem: { findById: (id: unknown) => leanChain(mockHwItemFindById(id)) },
}));
const mockHwRecFindById = jest.fn();
jest.mock("../modules/trackers/models/HomeworkStudentRecord", () => ({
  HomeworkStudentRecord: { findById: (id: unknown) => leanChain(mockHwRecFindById(id)) },
}));
const mockAsItemFindById = jest.fn();
jest.mock("../modules/trackers/models/AssignmentItem", () => ({
  AssignmentItem: { findById: (id: unknown) => leanChain(mockAsItemFindById(id)) },
}));
const mockAsRecFindById = jest.fn();
jest.mock("../modules/trackers/models/AssignmentStudentRecord", () => ({
  AssignmentStudentRecord: {
    findById: (id: unknown) => leanChain(mockAsRecFindById(id)),
    distinct: async () => [],
  },
}));

import { builder } from "../schema";
import "../modules/trackers/resolvers/homework";
import "../modules/trackers/resolvers/assignment";

const schema = builder.toSchema();
const hwSvc = jest.requireMock("../modules/trackers/services/HomeworkService") as Record<string, jest.Mock>;
const hwRevert = jest.requireMock("../modules/trackers/services/HomeworkRevertService") as Record<string, jest.Mock>;
const hwRecon = jest.requireMock("../modules/trackers/services/HomeworkReconciliationService") as Record<string, jest.Mock>;
const asSvc = jest.requireMock("../modules/trackers/services/AssignmentService") as Record<string, jest.Mock>;
const asRevert = jest.requireMock("../modules/trackers/services/AssignmentRevertService") as Record<string, jest.Mock>;

const ME = oid().toString();
const SECTION = oid().toString();
const RECORD = oid().toString();
const ITEM = oid().toString();

const run = (source: string, role: string, extra: Record<string, unknown> = {}): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: { auth: { role, userId: ME, ...extra } } }) as Promise<ExecutionResult>;
const ok = (r: ExecutionResult) => !r.errors || r.errors.length === 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockSubjectFindOne.mockReturnValue({ _id: oid() });
  mockHwRecFindById.mockReturnValue({ hwItemId: oid(), sectionId: SECTION });
  mockHwItemFindById.mockReturnValue({ subject: "MATH" });
  mockAsRecFindById.mockReturnValue({ asItemId: oid(), sectionId: SECTION });
  mockAsItemFindById.mockReturnValue({ _id: ITEM, subject: "MATH", sectionId: SECTION });
  mockSectionFindById.mockReturnValue({ classTeacherId: null, classId: oid() });
  mockAssertCanWrite.mockResolvedValue(undefined);
  mockAssertCanWriteAny.mockResolvedValue(undefined);
  mockAssertCanConfirmHomework.mockResolvedValue(undefined);
  hwSvc.transitionRecord.mockResolvedValue({ recordId: RECORD, hwId: "HW-1", state: "X" });
  hwRevert.revertHomeworkRecord.mockResolvedValue({
    recordId: RECORD, hwId: "HW-1", state: "GIVEN", poppedStates: [], chaseCount: 0, result: null, deletedResubmissionId: null,
  });
  hwRecon.confirmHomeworkDay.mockResolvedValue({});
  asSvc.transitionAssignmentRecord.mockResolvedValue({ recordId: RECORD, asId: "AS-1", state: "X" });
  asSvc.confirmAssignmentWeek.mockResolvedValue({
    academicYearId: "y", sectionId: SECTION, weekNumber: 1, ceiling: 360, totalMinutes: 0, itemsIssued: 0, recordsIssued: 0,
  });
  asSvc.updateAssignmentItem.mockResolvedValue({});
  asRevert.revertAssignmentRecord.mockResolvedValue({
    recordId: RECORD, asId: "AS-1", state: "GIVEN", poppedStates: [], chaseCount: 0,
    result: null, marks: null, feedback: null, deletedResubmissionId: null,
  });
});
afterEach(() => setRoleTemplateOverrides({}));

const hwTransition = (toState: string) =>
  `mutation { transitionHomeworkRecord(sectionId: "${SECTION}", recordId: "${RECORD}", toState: "${toState}") { recordId } }`;
const asTransition = (toState: string) =>
  `mutation { transitionAssignmentRecord(sectionId: "${SECTION}", recordId: "${RECORD}", toState: "${toState}") { recordId } }`;

describe("transitionHomeworkRecord — the target state names the action", () => {
  test("a default teacher may take every step; Office may take none", async () => {
    for (const s of ["GIVEN", "SUBMITTED", "CHASE", "CHECKED", "RETURNED"]) {
      expect(ok(await run(hwTransition(s), "TEACHER"))).toBe(true);
    }
    expect(ok(await run(hwTransition("SUBMITTED"), "OFFICE"))).toBe(false);
    expect(hwSvc.transitionRecord).toHaveBeenCalledTimes(5);
  });

  test("Teacher `homework:return` switched off: RETURNED is refused, SUBMITTED still works", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["homework:return"] } });
    expect(ok(await run(hwTransition("RETURNED"), "TEACHER"))).toBe(false);
    expect(ok(await run(hwTransition("SUBMITTED"), "TEACHER"))).toBe(true);
    expect(hwSvc.transitionRecord).toHaveBeenCalledTimes(1);
  });

  test("GIVEN needs `homework:issue`, CHECKED needs `homework:check`", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["homework:issue", "homework:check"] } });
    expect(ok(await run(hwTransition("GIVEN"), "TEACHER"))).toBe(false);
    expect(ok(await run(hwTransition("CHECKED"), "TEACHER"))).toBe(false);
    expect(ok(await run(hwTransition("CHASE"), "TEACHER"))).toBe(true);
  });

  test("the write-scope gate now carries the homework reach action", async () => {
    await run(hwTransition("SUBMITTED"), "TEACHER");
    expect(mockAssertCanWrite.mock.calls[0][4]).toEqual({ editAll: "homework:edit_all" });
  });
});

describe("revertHomeworkRecord — homework:undo_any replaces isAdminStaff", () => {
  const REVERT = `mutation { revertHomeworkRecord(sectionId: "${SECTION}", recordId: "${RECORD}") { recordId } }`;

  test("default Office: any actor/any day, no scope gate (F-7 reproduced)", async () => {
    expect(ok(await run(REVERT, "OFFICE"))).toBe(true);
    expect(mockAssertCanWriteAny).not.toHaveBeenCalled();
    expect(hwRevert.revertHomeworkRecord.mock.calls[0][0]).toMatchObject({ admin: true });
  });

  test("Office with undo_any switched off is refused", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["homework:undo_any"] } });
    expect(ok(await run(REVERT, "OFFICE"))).toBe(false);
    expect(hwRevert.revertHomeworkRecord).not.toHaveBeenCalled();
  });

  test("default teacher: scope-gated, own-step rule (admin=false)", async () => {
    expect(ok(await run(REVERT, "TEACHER"))).toBe(true);
    expect(mockAssertCanWriteAny).toHaveBeenCalled();
    expect(hwRevert.revertHomeworkRecord.mock.calls[0][0]).toMatchObject({ admin: false });
  });

  test("a teacher granted undo_any per person gets the admin path", async () => {
    expect(ok(await run(REVERT, "TEACHER", { grantedPermissions: ["homework:undo_any"] }))).toBe(true);
    expect(mockAssertCanWriteAny).not.toHaveBeenCalled();
    expect(hwRevert.revertHomeworkRecord.mock.calls[0][0]).toMatchObject({ admin: true });
  });
});

describe("confirmHomeworkDay — confirm_day + designation, waived by edit_all", () => {
  const CONFIRM = `mutation { confirmHomeworkDay(sectionId: "${SECTION}", classId: "${oid()}", date: "2026-10-21", roster: []) { __typename } }`;

  test("a default teacher goes through the designation gate", async () => {
    await run(CONFIRM, "TEACHER");
    expect(mockAssertCanConfirmHomework).toHaveBeenCalled();
  });

  test("the Principal (edit_all) and a teacher granted edit_all skip the designation", async () => {
    await run(CONFIRM, "PRINCIPAL");
    await run(CONFIRM, "TEACHER", { grantedPermissions: ["homework:edit_all"] });
    expect(mockAssertCanConfirmHomework).not.toHaveBeenCalled();
    expect(hwRecon.confirmHomeworkDay).toHaveBeenCalledTimes(2);
  });

  test("Teacher confirm_day switched off: even a designated class teacher is refused", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["homework:confirm_day"] } });
    await run(CONFIRM, "TEACHER");
    expect(hwRecon.confirmHomeworkDay).not.toHaveBeenCalled();
  });
});

describe("transitionAssignmentRecord — the target state names the action", () => {
  test("Teacher `assignment:resubmit` off: RESUBMIT refused, CHECKED still works", async () => {
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["assignment:resubmit"] } });
    expect(ok(await run(asTransition("RESUBMIT"), "TEACHER"))).toBe(false);
    expect(ok(await run(asTransition("CHECKED"), "TEACHER"))).toBe(true);
    expect(asSvc.transitionAssignmentRecord).toHaveBeenCalledTimes(1);
  });

  test("Office holds no step action (D-#554 kept)", async () => {
    expect(ok(await run(asTransition("SUBMITTED"), "OFFICE"))).toBe(false);
  });
});

describe("confirmAssignmentWeek — confirm_week + class teacher, waived by assignment:settings", () => {
  const CONFIRM = `mutation { confirmAssignmentWeek(academicYearId: "y", sectionId: "${SECTION}", weekNumber: 1) { sectionId } }`;

  test("default Office passes through the settings waiver (the old roster:manage leg)", async () => {
    expect(ok(await run(CONFIRM, "OFFICE"))).toBe(true);
    expect(mockSectionFindById).not.toHaveBeenCalled();
  });

  test("Office with settings off must be the class teacher — it is not, so refused", async () => {
    setRoleTemplateOverrides({ OFFICE: { granted: [], revoked: ["assignment:settings"] } });
    expect(ok(await run(CONFIRM, "OFFICE"))).toBe(false);
  });

  test("the class teacher passes; with confirm_week switched off she is refused", async () => {
    mockSectionFindById.mockReturnValue({ classTeacherId: ME });
    expect(ok(await run(CONFIRM, "TEACHER"))).toBe(true);
    setRoleTemplateOverrides({ TEACHER: { granted: [], revoked: ["assignment:confirm_week"] } });
    expect(ok(await run(CONFIRM, "TEACHER"))).toBe(false);
  });

  test("a teacher who is not the class teacher is refused", async () => {
    expect(ok(await run(CONFIRM, "TEACHER"))).toBe(false);
  });
});

describe("revertAssignmentRecord / updateAssignmentItem — undo_any and edit_all replace isAdminStaff", () => {
  const REVERT = `mutation { revertAssignmentRecord(sectionId: "${SECTION}", recordId: "${RECORD}") { recordId } }`;
  const UPDATE = `mutation { updateAssignmentItem(itemId: "${ITEM}", description: "x") { __typename } }`;

  test("Office reverts any step by default; a teacher only through scope", async () => {
    expect(ok(await run(REVERT, "OFFICE"))).toBe(true);
    expect(asRevert.revertAssignmentRecord.mock.calls[0][0]).toMatchObject({ admin: true });
    expect(ok(await run(REVERT, "TEACHER"))).toBe(true);
    expect(asRevert.revertAssignmentRecord.mock.calls[1][0]).toMatchObject({ admin: false });
    expect(mockAssertCanWriteAny).toHaveBeenCalledTimes(1);
  });

  test("isAdmin on an edit is assignment:edit_all — Principal yes, teacher no unless granted", async () => {
    await run(UPDATE, "PRINCIPAL");
    await run(UPDATE, "TEACHER");
    await run(UPDATE, "TEACHER", { grantedPermissions: ["assignment:edit_all"] });
    const flags = asSvc.updateAssignmentItem.mock.calls.map((c) => (c[0] as { isAdmin: boolean }).isAdmin);
    expect(flags).toEqual([true, false, true]);
  });
});
