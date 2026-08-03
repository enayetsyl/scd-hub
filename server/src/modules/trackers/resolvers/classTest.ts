/**
 * Class Test Tracker resolvers (CT-1, prd-tracker-class-test §5, D-#119–#122).
 *
 * RBAC — composes EXISTING permissions only (D-#94/#17, no new role/permission):
 *   - Teacher request (createClassTestRequest, suggestClassTestNumber): `tracker:write`
 *     + `assertCanWrite` on the section — exactly the homework/assignment pattern.
 *     The section's real class/year is resolved server-side, so a teacher can't
 *     file under a section they don't write.
 *   - Office mark-printed / cancel: `roster:manage` (the Principal/Office admin
 *     lever — the assignment-schedule / mark-printed precedent).
 *   - Staff reads (queue / section list / one test): `tracker:read` with
 *     `assertCanRead` for the section list; Principal/Office are unscoped staff.
 *
 * The uploaded-paper file moves over `POST /files/classtest` + `GET /files/:id`
 * (routes/files.ts) — not GraphQL; the Drive id never reaches a client.
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { Role } from "@scd/shared";
import {
  createRequest as createRequestSvc,
  markPrinted as markPrintedSvc,
  cancelRequest as cancelRequestSvc,
  suggestTestNumber as suggestTestNumberSvc,
  getClassTest as getClassTestSvc,
  listPrintQueue as listPrintQueueSvc,
  listMyClassTests as listMyClassTestsSvc,
  listClassTestsForSection as listForSectionSvc,
  retireClassTest as retireClassTestSvc,
  restoreClassTest as restoreClassTestSvc,
  type ClassTestShape,
} from "../services/ClassTestService";
import { Section } from "../../foundation/models/Section";
import { Class } from "../../foundation/models/Class";
import {
  assertCanWrite,
  assertCanRead,
  ForbiddenError,
} from "../../../middleware/authz";
import { Subject } from "../../foundation/models/Subject";
import type { Types } from "mongoose";

async function resolveSubjectId(subject: string): Promise<string> {
  const doc = await Subject.findOne({ code: subject }).select("_id").lean();
  if (!doc) throw new Error(`Subject not found: ${subject}`);
  return doc._id.toString();
}

// ---------------------------------------------------------------------------
// Gate helpers
// ---------------------------------------------------------------------------

/** Office / Principal — the print operator (mark-printed / cancel). */
function assertPrintAdmin(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  if (!callerHasPermission(ctx.auth, "roster:manage")) {
    throw new ForbiddenError("ক্লাস টেস্ট ছাপানো/বাতিল অফিস/অধ্যক্ষের কাজ");
  }
}

/** Staff read of the print queue: Principal/Office (unscoped) or tracker:read. */
function assertStaffRead(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (role === "PRINCIPAL" || role === "OFFICE") return;
  if (callerHasPermission(ctx.auth, "tracker:read")) return;
  throw new ForbiddenError();
}

// ---------------------------------------------------------------------------
// Object shape
// ---------------------------------------------------------------------------

const ClassTestRef = builder.objectRef<ClassTestShape>("ClassTest");
ClassTestRef.implement({
  description:
    "A class-test header / print request (CT-1). Born REQUESTED; PRINTED becomes the official exam. Operational plane (ADR-005).",
  fields: (t) => ({
    id: t.exposeString("id"),
    ctId: t.exposeString("ctId"),
    academicYearId: t.exposeString("academicYearId"),
    classLevel: t.exposeInt("classLevel"),
    classId: t.exposeString("classId"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    totalMarks: t.exposeInt("totalMarks"),
    passMark: t.exposeInt("passMark"),
    source: t.exposeString("source"),
    setId: t.string({ nullable: true, resolve: (r) => r.setId }),
    questionFileId: t.string({ nullable: true, resolve: (r) => r.questionFileId }),
    status: t.exposeString("status"),
    deadlineDays: t.exposeInt("deadlineDays"),
    teacherId: t.string({ nullable: true, resolve: (r) => r.teacherId }),
    requestedBy: t.exposeString("requestedBy"),
    requestedAt: t.exposeString("requestedAt"),
    printedBy: t.string({ nullable: true, resolve: (r) => r.printedBy }),
    printedAt: t.string({ nullable: true, resolve: (r) => r.printedAt }),
    notes: t.string({ nullable: true, resolve: (r) => r.notes }),
  }),
});

// ===========================================================================
// J1 — teacher files a print request (tracker:write + section verify)
// ===========================================================================

builder.mutationField("createClassTestRequest", (t) =>
  t.field({
    type: ClassTestRef,
    description:
      "File a class-test print request (J1): a CT-kind pool set (setId) or an uploaded paper " +
      "(questionFileId). Year/class resolved server-side from the section. Born REQUESTED.",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      examDate: t.arg.string({ required: true }),
      totalMarks: t.arg.int({ required: true }),
      passMark: t.arg.int({ required: false }),
      source: t.arg.string({ required: true }),
      setId: t.arg.string({ required: false }),
      questionFileId: t.arg.string({ required: false }),
      // A class test IS a print job (PQ-5), so it carries the same two answers every
      // other job must: how to print it. Optional here ONLY so a pre-PQ-5 caller keeps
      // working — the schema defaults BW/SINGLE, which is what the migration back-filled.
      colour: t.arg.string({ required: false }),
      sides: t.arg.string({ required: false }),
      // D-#303: copies — a typed number (default 1) or CLASS_PRESENT on the exam day.
      copies: t.arg.int({ required: false }),
      copiesMode: t.arg.string({ required: false }),
      testNumber: t.arg.int({ required: false }),
      deadlineDays: t.arg.int({ required: false }),
      notes: t.arg.string({ required: false }),
      /** Accountable subject teacher — set when registering on a teacher's
       *  behalf. Omitted → the routine decides (else the actor). */
      teacherId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await resolveSubjectId(args.subject));
      return createRequestSvc({
        sectionId: args.sectionId,
        subject: args.subject,
        examDate: args.examDate,
        totalMarks: args.totalMarks,
        passMark: args.passMark ?? undefined,
        source: args.source,
        setId: args.setId ?? undefined,
        questionFileId: args.questionFileId ?? undefined,
        colour: args.colour ?? undefined,
        sides: args.sides ?? undefined,
        copies: args.copies ?? undefined,
        copiesMode: args.copiesMode ?? undefined,
        testNumber: args.testNumber ?? undefined,
        deadlineDays: args.deadlineDays ?? undefined,
        notes: args.notes ?? undefined,
        teacherId: args.teacherId ?? undefined,
        actorId: ctx.auth.userId as string,
        actorCanManage: callerHasPermission(ctx.auth, "roster:manage"),
      });
    },
  }),
);

// D-#339: register a class test as ALREADY official without a print request —
// for tests held (or to be held) without office printing. The subject teacher
// (tracker:write + section write-scope) or Principal/Office can register.
builder.mutationField("registerClassTestOfficial", (t) =>
  t.field({
    type: ClassTestRef,
    description:
      "Register a class test as official WITHOUT a print request (D-#339): born PRINTED " +
      "(printedBy/At = actor/now), no print-queue row — results + overdue tracking start " +
      "immediately. Subject teacher (write-scope) or Principal/Office.",
    authScopes: { authenticated: true },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      examDate: t.arg.string({ required: true }),
      totalMarks: t.arg.int({ required: true }),
      passMark: t.arg.int({ required: false }),
      source: t.arg.string({ required: true }),
      setId: t.arg.string({ required: false }),
      questionFileId: t.arg.string({ required: false }),
      testNumber: t.arg.int({ required: false }),
      deadlineDays: t.arg.int({ required: false }),
      notes: t.arg.string({ required: false }),
      /** Accountable subject teacher — the Principal/Office "on behalf of" pick.
       *  Omitted → the routine decides (else the actor). */
      teacherId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const role = ctx.auth.role as Role;
      const admin = role === "PRINCIPAL" || role === "OFFICE";
      if (!admin) {
        if (!callerHasPermission(ctx.auth, "tracker:write")) throw new ForbiddenError();
        await assertCanWrite(ctx, args.sectionId, await resolveSubjectId(args.subject));
      }
      return createRequestSvc({
        sectionId: args.sectionId,
        subject: args.subject,
        examDate: args.examDate,
        totalMarks: args.totalMarks,
        passMark: args.passMark ?? undefined,
        source: args.source,
        setId: args.setId ?? undefined,
        questionFileId: args.questionFileId ?? undefined,
        testNumber: args.testNumber ?? undefined,
        deadlineDays: args.deadlineDays ?? undefined,
        notes: args.notes ?? undefined,
        teacherId: args.teacherId ?? undefined,
        skipPrint: true,
        actorId: ctx.auth.userId as string,
        actorCanManage: admin || callerHasPermission(ctx.auth, "roster:manage"),
      });
    },
  }),
);

builder.queryField("suggestClassTestNumber", (t) =>
  t.field({
    type: "Int",
    description:
      "The next human Test# for a section's class+subject (max+1). UI pre-fill for the request form (J1).",
    authScopes: { hasPermission: "tracker:write" },
    args: {
      sectionId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanWrite(ctx, args.sectionId, await resolveSubjectId(args.subject));
      const section = (await Section.findById(args.sectionId).select("classId").lean()) as {
        classId: Types.ObjectId;
      } | null;
      if (!section) throw new Error("Section not found");
      const klass = (await Class.findById(section.classId)
        .select("level academicYearId")
        .lean()) as { level: number; academicYearId: Types.ObjectId } | null;
      if (!klass) throw new Error("Class not found for this section");
      return suggestTestNumberSvc(
        klass.academicYearId.toString(),
        klass.level,
        args.subject as never,
      );
    },
  }),
);

// ===========================================================================
// J2 — Office mark-printed / cancel (roster:manage)
// ===========================================================================

builder.mutationField("markClassTestPrinted", (t) =>
  t.field({
    type: ClassTestRef,
    description: "Office: REQUESTED → PRINTED (J2). The record becomes the official exam; stamps printedAt/By.",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return markPrintedSvc(args.id, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("cancelClassTest", (t) =>
  t.field({
    type: ClassTestRef,
    description: "Office: REQUESTED → CANCELLED for a withdrawn print request (a PRINTED exam can't be cancelled here).",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertPrintAdmin(ctx);
      return cancelRequestSvc(args.id, ctx.auth!.userId as string);
    },
  }),
);

builder.mutationField("retireClassTest", (t) =>
  t.field({
    type: ClassTestRef,
    description:
      "Principal/Office: retire a PRINTED exam (→ CANCELLED) with a required reason — it leaves every " +
      "dashboard, report and Overdue count while the record survives, so it can be restored. Refused " +
      "once any result is entered.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return retireClassTestSvc(args.id, args.reason, ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("restoreClassTest", (t) =>
  t.field({
    type: ClassTestRef,
    description: "Principal/Office: put a retired exam back on the boards (CANCELLED → PRINTED).",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return restoreClassTestSvc(args.id, ctx.auth.userId as string);
    },
  }),
);

// ===========================================================================
// Reads
// ===========================================================================

builder.queryField("classTestPrintQueue", (t) =>
  t.field({
    type: [ClassTestRef],
    description: "The Office print queue: pending REQUESTED class tests, oldest first (Principal/Office).",
    authScopes: { hasPermission: "roster:manage" },
    resolve: async (_root, _args, ctx) => {
      assertPrintAdmin(ctx);
      return listPrintQueueSvc();
    },
  }),
);

builder.queryField("myClassTests", (t) =>
  t.field({
    type: [ClassTestRef],
    description: "The calling teacher's own class tests (any status), newest first.",
    authScopes: { hasPermission: "tracker:write" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return listMyClassTestsSvc(ctx.auth.userId as string);
    },
  }),
);

builder.queryField("classTestsForSection", (t) =>
  t.field({
    type: [ClassTestRef],
    description: "Class tests for a section (staff read). Read-scope enforced.",
    authScopes: { hasPermission: "tracker:read" },
    args: {
      sectionId: t.arg.string({ required: true }),
      classId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      await assertCanRead(ctx, args.sectionId, args.classId);
      return listForSectionSvc(args.sectionId);
    },
  }),
);

builder.queryField("classTest", (t) =>
  t.field({
    type: ClassTestRef,
    nullable: true,
    description: "One class test by id (staff read; Principal/Office unscoped, teacher needs read-scope on its section).",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      const shape = await getClassTestSvc(args.id);
      if (!shape) return null;
      // Teachers (not Principal/Office) need read-scope on the test's section.
      if (ctx.auth!.role !== "PRINCIPAL" && ctx.auth!.role !== "OFFICE") {
        await assertCanRead(ctx, shape.sectionId, shape.classId);
      }
      return shape;
    },
  }),
);
