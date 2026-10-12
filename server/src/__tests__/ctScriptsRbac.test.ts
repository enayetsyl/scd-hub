/**
 * Class-test script RBAC (CS-1..CS-3, docs/prd-ct-scripts.md §6, D-#715/#719).
 *
 * Executes REAL GraphQL against the built schema per role, so the Pothos scope layer
 * (the real permission map) is under test: the Office side is `roster:manage` only —
 * a TEACHER and a GUARDIAN are refused; "returned" is the test's OWN teacher or the
 * Office, never another teacher. The service is mocked (RBAC, not the flow, is
 * under test). DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

const oid = () => new mongoose.Types.ObjectId();
const OWNER = oid().toString();

const row = {
  testId: "t", ctId: "CT-C4-MATH-0003", subject: "MATH", subjectBn: "গণিত", testNumber: 3,
  examDate: new Date().toISOString(), classLevel: 4, sectionId: null, subjectGroupId: null,
  unitLabelBn: "৪র্থ শ্রেণি", teacherId: OWNER, teacherName: "মাহফুজ", stage: "DUE",
  dueDateKey: "2026-10-13", returnDueDateKey: null, presentCount: 2, resolvedCount: 0, pageCount: 0,
  receivedCount: null, receivedAt: null, publishedAt: null, handedBackAt: null, returnedAt: null,
  waivedAt: null, waiveReason: null, backfilled: false,
};

jest.mock("../modules/trackers/services/ClassTestScriptService", () => ({
  teacherScriptTasks: jest.fn(async () => [row]),
  officeScriptQueue: jest.fn(async () => [row]),
  scriptSheet: jest.fn(async () => ({ test: row, totalMarks: 20, students: [] })),
  scriptTestRow: jest.fn(async () => row),
  receiveScripts: jest.fn(async () => row),
  undoReceiveScripts: jest.fn(async () => row),
  waiveScripts: jest.fn(async () => row),
  unwaiveScripts: jest.fn(async () => row),
  attachScriptPages: jest.fn(async () => ({ test: row, totalMarks: 20, students: [] })),
  removeScriptPage: jest.fn(async () => ({ test: row, totalMarks: 20, students: [] })),
  setScriptMissing: jest.fn(async () => ({ test: row, totalMarks: 20, students: [] })),
  publishScripts: jest.fn(async () => ({ test: row, notifiedGuardianCount: 0 })),
  unpublishScripts: jest.fn(async () => row),
  handBackScripts: jest.fn(async () => row),
  markScriptsReturned: jest.fn(async () => ({ ...row, stage: "RETURNED" })),
  accountableTeacherId: jest.fn(async () => OWNER),
}));

class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
jest.mock("../middleware/authz", () => ({ ForbiddenError: FakeForbidden }));

import { builder } from "../schema";
import "../modules/trackers/resolvers/classTestScripts";

const schema = builder.toSchema();

type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string, userId = oid().toString()): Ctx => ({ auth: { role, userId } });
const run = (source: string, ctx: Ctx): Promise<ExecutionResult> =>
  graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

const OFFICE_OPS = [
  `mutation { receiveClassTestScripts(testId: "t", count: 2) { stage } }`,
  `mutation { waiveClassTestScripts(testId: "t", reason: "x") { stage } }`,
  `mutation { attachClassTestScriptPages(testId: "t", studentId: "s", fileIds: ["f"]) { totalMarks } }`,
  `mutation { setClassTestScriptMissing(testId: "t", studentId: "s", missing: true) { totalMarks } }`,
  `mutation { publishClassTestScripts(testId: "t") { notifiedGuardianCount } }`,
  `mutation { handBackClassTestScripts(testId: "t") { stage } }`,
  `query { classTestScriptQueue { stage } }`,
  `query { classTestScriptSheet(testId: "t") { totalMarks } }`,
];

describe("the Office side is roster:manage only", () => {
  test.each(OFFICE_OPS)("OFFICE and PRINCIPAL may: %s", async (op) => {
    expect(denied(await run(op, ctxOf("OFFICE")))).toBe(false);
    expect(denied(await run(op, ctxOf("PRINCIPAL")))).toBe(false);
  });
  test.each(OFFICE_OPS)("TEACHER and GUARDIAN may not: %s", async (op) => {
    expect(denied(await run(op, ctxOf("TEACHER")))).toBe(true);
    expect(denied(await run(op, ctxOf("GUARDIAN")))).toBe(true);
  });
});

describe("the teacher's reminders", () => {
  test("a TEACHER reads their own tasks; a GUARDIAN cannot", async () => {
    const q = `query { myClassTestScriptTasks { stage dueDateKey } }`;
    expect(denied(await run(q, ctxOf("TEACHER")))).toBe(false);
    expect(denied(await run(q, ctxOf("GUARDIAN")))).toBe(true);
  });
});

describe("returned to the students (D-#719)", () => {
  const m = `mutation { markClassTestScriptsReturned(testId: "t") { stage } }`;
  test("the test's own teacher may", async () => {
    const r = await run(m, ctxOf("TEACHER", OWNER));
    expect(denied(r)).toBe(false);
  });
  test("another teacher may not", async () => {
    expect(denied(await run(m, ctxOf("TEACHER")))).toBe(true);
  });
  test("the Office may, for an absent teacher", async () => {
    expect(denied(await run(m, ctxOf("OFFICE")))).toBe(false);
  });
  test("a guardian may not", async () => {
    expect(denied(await run(m, ctxOf("GUARDIAN")))).toBe(true);
  });
});
