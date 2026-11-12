/**
 * GH-3 permission gates (D-#1522) - real GraphQL against the built schema, per role. The Office queue needs
 * `homework_integrity:view` / `:record` (Office + Principal; a teacher and a guardian hold neither). The
 * teacher's hint count needs `mastery:view`. No guardian-facing type or field carries a case. Services and
 * models are mocked (RBAC is under test). DB-free.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { graphql, isObjectType, type ExecutionResult } from "graphql";

jest.mock("../modules/homework-integrity/services/IntegrityService", () => ({
  listCases: jest.fn(async () => []),
  caseDetail: jest.fn(async () => ({ row: null })),
  recordOutcome: jest.fn(async () => { throw new Error("service reached"); }),
  sweepYear: jest.fn(async () => ({ checked: 0, opened: 0, updated: 0, reopened: 0 })),
  hintStepsFor: jest.fn(async () => new Map()),
}));
jest.mock("../modules/mastery/models/MasteryAssignment", () => ({
  MasteryAssignment: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({ Student: { findOne: () => ({ select: () => ({ lean: async () => null }) }) } }));
jest.mock("../modules/mastery/services/MasteryWorkService", () => ({ assertMayWork: jest.fn(async () => undefined) }));

import { builder } from "../schema";
import "../modules/homework-integrity/resolvers/homeworkIntegrity";
import { CATALOGUE_PERMISSIONS, roleHasPermission } from "@scd/shared";

const schema = builder.toSchema();
const oid = () => new mongoose.Types.ObjectId().toString();
type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string): Ctx => ({ auth: { role, userId: oid() } });
const run = (source: string, ctx: Ctx): Promise<ExecutionResult> => graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors ?? []).some((e) => /not authorized|forbidden|unauthori|permission|insufficient/i.test(e.message));

const LIST = `query { homeworkIntegrityCases { id } }`;
const ONE = `query { homeworkIntegrityCase(id: "x") { row { id } } }`;
const RECORD = `mutation { recordHomeworkIntegrityOutcome(id: "x", outcome: "UNCLEAR") { id } }`;
const RECOMPUTE = `mutation { recomputeHomeworkIntegrity { checked } }`;
const HINTS = `query { childHintSteps(studentId: "${oid()}", assignmentId: "${oid()}", qids: ["q"]) { qid } }`;

describe("homework_integrity permissions", () => {
  it("are catalogued; Office and Principal hold them; teacher and guardian do not", () => {
    for (const p of ["homework_integrity:view", "homework_integrity:record"]) {
      expect(CATALOGUE_PERMISSIONS).toContain(p);
      for (const r of ["OFFICE", "PRINCIPAL"] as const) expect(roleHasPermission(r, p as never)).toBe(true);
      for (const r of ["TEACHER", "GUARDIAN"] as const) expect(roleHasPermission(r, p as never)).toBe(false);
    }
  });
  it.each([LIST, ONE, RECORD, RECOMPUTE])("Office and Principal pass the gate; a teacher, a guardian and anonymous are denied: %s", async (op) => {
    for (const r of ["OFFICE", "PRINCIPAL"]) expect(denied(await run(op, ctxOf(r)))).toBe(false);
    for (const r of ["TEACHER", "GUARDIAN"]) expect(denied(await run(op, ctxOf(r)))).toBe(true);
    expect((await run(op, { auth: null })).errors?.length).toBeGreaterThan(0);
  });
});

describe("childHintSteps", () => {
  it("a teacher may read it; a guardian may not", async () => {
    const t = await run(HINTS, ctxOf("TEACHER"));
    expect(t.errors).toBeUndefined();
    expect(denied(await run(HINTS, ctxOf("GUARDIAN")))).toBe(true);
  });
});

describe("no guardian-facing surface", () => {
  it("no Child*/Guardian* type exposes a case field, and no integrity type is reachable from them", () => {
    const types = Object.values(schema.getTypeMap()).filter(isObjectType).filter((t) => !t.name.startsWith("__"));
    for (const t of types) {
      if (/^(Child|Guardian|Portal)/i.test(t.name)) {
        for (const f of Object.keys(t.getFields())) expect(f).not.toMatch(/integrity/i);
      }
    }
    expect(types.filter((t) => /Integrity/.test(t.name)).map((t) => t.name).sort()).toEqual(
      ["HomeworkIntegrityCase", "HomeworkIntegrityCaseRow", "HomeworkIntegrityHistory", "HomeworkIntegrityItem", "HomeworkIntegrityRecompute"],
    );
  });
  it("the corpus plane does not reach the integrity module (firewall)", () => {
    const dir = path.resolve(__dirname, "../modules/corpus");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(dir).filter((x) => x.endsWith(".ts"))) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/homework-integrity|IntegrityCase/);
    }
  });
});
