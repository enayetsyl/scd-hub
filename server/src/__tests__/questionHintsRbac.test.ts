/**
 * GH-1 permission gates (D-#1520/#1521) - executes REAL GraphQL against the built schema per role.
 * importQuestionHints needs `question_hint:import` (Principal by role; Office/Teacher/Guardian do not
 * hold it); the guardian reads need `guardian:read_child`, which staff do not hold. Services are mocked
 * (RBAC, not the flow, is under test). DB-free.
 */
import mongoose from "mongoose";
import { graphql, type ExecutionResult } from "graphql";

jest.mock("../modules/guardian-help/services/QuestionHintService", () => ({
  importQuestionHints: jest.fn(async () => ({
    ok: true, dryRun: true, total: 0, created: 0, updated: 0, unchanged: 0, refused: 0, problems: [], warnings: [], fileError: null,
  })),
}));
jest.mock("../modules/guardian-help/services/GuardianHintService", () => ({
  ASSIGNED_QUESTION_SOURCES: ["ASSIGNMENT", "EXTRA_HOMEWORK", "HOMEWORK"],
  childAssignedQuestions: jest.fn(async () => []),
  openQuestionHint: jest.fn(async () => ({ qid: "q", step: 1, textBn: "ক", hasNext: true })),
}));
class FakeForbidden extends Error {
  constructor(msg = "Forbidden") {
    super(msg);
    this.name = "ForbiddenError";
  }
}
jest.mock("../middleware/authz", () => ({ ForbiddenError: FakeForbidden, assertGuardianOfStudent: jest.fn(async () => undefined) }));

import { builder } from "../schema";
import "../modules/guardian-help/resolvers/questionHints";
import { CATALOGUE_PERMISSIONS, roleHasPermission } from "@scd/shared";

const schema = builder.toSchema();
const oid = () => new mongoose.Types.ObjectId().toString();
type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string): Ctx => ({ auth: { role, userId: oid() } });
const run = (source: string, ctx: Ctx): Promise<ExecutionResult> => graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors?.length ?? 0) > 0;

const IMPORT = `mutation { importQuestionHints(hintsJson: "{}", apply: false) { ok } }`;
const LIST = `query { childAssignedQuestions(studentId: "s") { qid } }`;
const OPEN = `mutation { openQuestionHint(studentId: "s", qid: "q", step: 1) { step } }`;

describe("question_hint:import", () => {
  it("is a catalogued action, held by the Principal only", () => {
    expect(CATALOGUE_PERMISSIONS).toContain("question_hint:import");
    expect(roleHasPermission("PRINCIPAL", "question_hint:import" as never)).toBe(true);
    for (const r of ["OFFICE", "TEACHER", "GUARDIAN"] as const) expect(roleHasPermission(r, "question_hint:import" as never)).toBe(false);
  });
  it("the Principal may import; a teacher, Office and a guardian may not", async () => {
    expect(denied(await run(IMPORT, ctxOf("PRINCIPAL")))).toBe(false);
    for (const r of ["TEACHER", "OFFICE", "GUARDIAN"]) expect(denied(await run(IMPORT, ctxOf(r)))).toBe(true);
    expect(denied(await run(IMPORT, { auth: null }))).toBe(true);
  });
});

describe("guardian reads", () => {
  it.each([LIST, OPEN])("a guardian may; staff and anonymous may not: %s", async (op) => {
    expect(denied(await run(op, ctxOf("GUARDIAN")))).toBe(false);
    for (const r of ["TEACHER", "OFFICE", "PRINCIPAL"]) expect(denied(await run(op, ctxOf(r)))).toBe(true);
    expect(denied(await run(op, { auth: null }))).toBe(true);
  });
});
