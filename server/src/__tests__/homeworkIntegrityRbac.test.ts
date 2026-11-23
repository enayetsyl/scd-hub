/**
 * GH-3 + AL-12 permission gates (D-#1522, D-#1676) - real GraphQL against the built schema, per role.
 *  - the queue / one case / a note: `homework_integrity:view` or `:view_all` (Office + Principal; a guardian holds
 *    neither; a TEACHER holds `view` once the catalogue flips it on - PRD section 6 "Teacher on", row-scoped in the service);
 *  - record: `:record`; recompute: `:view_all`; the two settings keys: `:settings` (Principal only, LOCKED);
 *  - the teacher's hint count and the section tags need `mastery:view`.
 * No guardian-facing type or field carries a case (the one guardian query returns a subject code and a fixed sentence).
 * Services and models are mocked (RBAC is under test). DB-free.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { graphql, isObjectType, type ExecutionResult, type GraphQLObjectType } from "graphql";

jest.mock("../modules/homework-integrity/services/IntegrityService", () => ({
  listCases: jest.fn(async () => []),
  caseDetail: jest.fn(async () => ({ row: null })),
  recordOutcome: jest.fn(async () => { throw new Error("service reached"); }),
  addCaseNote: jest.fn(async () => { throw new Error("service reached"); }),
  integrityPolicy: jest.fn(async () => ({ gapPoints: 20, recurringCases: 2 })),
  saveIntegrityPolicy: jest.fn(async () => ({ gapPoints: 15, recurringCases: 2 })),
  sweepYear: jest.fn(async () => ({ checked: 0, opened: 0, updated: 0, reopened: 0 })),
  hintStepsFor: jest.fn(async () => new Map()),
}));
jest.mock("../modules/homework-integrity/services/IntegrityTagService", () => ({
  OUTSIDE_HELP_MARK_BN: "mark",
  GUARDIAN_HELP_NOTE_BN: "note",
  tagsForSection: jest.fn(async () => []),
  tagsForStudent: jest.fn(async () => []),
  guardianNotesFor: jest.fn(async () => []),
}));
jest.mock("../modules/mastery/models/MasteryAssignment", () => ({
  MasteryAssignment: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
}));
jest.mock("../modules/foundation/models/Student", () => ({
  Student: { findOne: () => ({ select: () => ({ lean: async () => null }) }), findById: () => ({ select: () => ({ lean: async () => ({ sectionId: "s" }) }) }) },
}));
jest.mock("../modules/mastery/services/MasteryWorkService", () => ({ assertMayWork: jest.fn(async () => undefined) }));

import { builder } from "../schema";
import "../modules/homework-integrity/resolvers/homeworkIntegrity";
import "../modules/homework-integrity/resolvers/homeworkHelpNote";
import { CATALOGUE_PERMISSIONS, roleHasPermission } from "@scd/shared";

const schema = builder.toSchema();
const oid = () => new mongoose.Types.ObjectId().toString();
type Ctx = { auth: { role: string; userId: string } | null };
const ctxOf = (role: string): Ctx => ({ auth: { role, userId: oid() } });
const run = (source: string, ctx: Ctx): Promise<ExecutionResult> => graphql({ schema, source, contextValue: ctx }) as Promise<ExecutionResult>;
const denied = (r: ExecutionResult) => (r.errors ?? []).some((e) => /not authorized|forbidden|unauthori|permission|insufficient/i.test(e.message));

const LIST = `query { homeworkIntegrityCases { id } }`;
const ONE = `query { homeworkIntegrityCase(id: "x") { row { id } } }`;
const NOTE = `mutation { addHomeworkIntegrityNote(id: "x", text: "t") { row { id } } }`;
const RECORD = `mutation { recordHomeworkIntegrityOutcome(id: "x", outcome: "UNCLEAR") { id } }`;
const RECOMPUTE = `mutation { recomputeHomeworkIntegrity { checked } }`;
const SETTINGS = `query { homeworkIntegritySettings { gapPoints recurringCases } }`;
const SAVE = `mutation { saveHomeworkIntegritySettings(gapPoints: 15, recurringCases: 2) { gapPoints } }`;
const HINTS = `query { childHintSteps(studentId: "${oid()}", assignmentId: "${oid()}", qids: ["q"]) { qid } }`;
const STUDENT_TAGS = `query { studentOutsideHelpTags(studentId: "${oid()}") { loCode } }`;
const TAGS = `query { sectionOutsideHelpTags(sectionId: "${oid()}", subject: "MATH") { loCode } }`;

/** PRD section 6 "Teacher on" is a catalogue flag (lead-only). Until it is on, a teacher is refused at the gate. */
const teacherHolds = roleHasPermission("TEACHER", "homework_integrity:view" as never);

describe("homework_integrity permissions", () => {
  it("are catalogued; Office and Principal hold view / record / view_all; a guardian holds none", () => {
    for (const p of ["homework_integrity:view", "homework_integrity:record", "homework_integrity:view_all", "homework_integrity:settings"]) {
      expect(CATALOGUE_PERMISSIONS).toContain(p);
      expect(roleHasPermission("GUARDIAN", p as never)).toBe(false);
    }
    for (const p of ["homework_integrity:view", "homework_integrity:record", "homework_integrity:view_all"]) {
      for (const r of ["OFFICE", "PRINCIPAL"] as const) expect(roleHasPermission(r, p as never)).toBe(true);
    }
  });
  it("the settings key is the Principal's alone (LOCKED)", () => {
    expect(roleHasPermission("PRINCIPAL", "homework_integrity:settings" as never)).toBe(true);
    for (const r of ["OFFICE", "TEACHER", "GUARDIAN"] as const) expect(roleHasPermission(r, "homework_integrity:settings" as never)).toBe(false);
  });
  it.each([LIST, ONE, NOTE, RECORD, RECOMPUTE, SETTINGS])("Office and Principal pass the gate; a guardian and anonymous are denied: %s", async (op) => {
    for (const r of ["OFFICE", "PRINCIPAL"]) expect(denied(await run(op, ctxOf(r)))).toBe(false);
    expect(denied(await run(op, ctxOf("GUARDIAN")))).toBe(true);
    expect((await run(op, { auth: null })).errors?.length).toBeGreaterThan(0);
  });
  it("a teacher never runs the school-wide sweep", async () => {
    expect(denied(await run(RECOMPUTE, ctxOf("TEACHER")))).toBe(true);
  });
  it("only the Principal saves the settings; the Office, a teacher and a guardian are denied", async () => {
    expect(denied(await run(SAVE, ctxOf("PRINCIPAL")))).toBe(false);
    for (const r of ["OFFICE", "TEACHER", "GUARDIAN"]) expect(denied(await run(SAVE, ctxOf(r)))).toBe(true);
  });
  const teacherIt = teacherHolds ? it : it.skip;
  teacherIt.each([LIST, ONE, NOTE, RECORD])("AC-H3: a teacher passes the view / record gate (the row rule is in the service): %s", async (op) => {
    expect(denied(await run(op, ctxOf("TEACHER")))).toBe(false);
  });
});

describe("childHintSteps + sectionOutsideHelpTags", () => {
  it.each([HINTS, TAGS, STUDENT_TAGS])("a teacher may read it; a guardian may not: %s", async (op) => {
    expect((await run(op, ctxOf("TEACHER"))).errors).toBeUndefined();
    expect(denied(await run(op, ctxOf("GUARDIAN")))).toBe(true);
  });
});

describe("no guardian-facing surface", () => {
  it("no Child*/Guardian* type exposes a case field, and the one guardian type carries a subject code and a sentence only", () => {
    const types = Object.values(schema.getTypeMap()).filter(isObjectType).filter((t) => !t.name.startsWith("__"));
    for (const t of types) {
      if (/^(Child|Guardian|Portal)/i.test(t.name)) {
        for (const f of Object.keys(t.getFields())) expect(f).not.toMatch(/integrity/i);
      }
    }
    expect(Object.keys((schema.getType("ChildHomeworkHelpNote") as GraphQLObjectType).getFields()).sort()).toEqual(["noteBn", "subject"]);
    expect(types.filter((t) => /Integrity/.test(t.name)).map((t) => t.name).sort()).toEqual([
      "HomeworkIntegrityCase", "HomeworkIntegrityCaseRow", "HomeworkIntegrityHistory", "HomeworkIntegrityItem", "HomeworkIntegrityNote",
      "HomeworkIntegrityRecompute", "HomeworkIntegritySettings", "HomeworkIntegrityTag",
    ]);
  });
  it("the corpus plane does not reach the integrity module (firewall)", () => {
    const dir = path.resolve(__dirname, "../modules/corpus");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(dir).filter((x) => x.endsWith(".ts"))) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/homework-integrity|IntegrityCase/);
    }
  });
});
