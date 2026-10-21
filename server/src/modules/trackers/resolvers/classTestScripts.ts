/**
 * Class-test script resolvers (CS-1..CS-3, docs/prd-ct-scripts.md §6, D-#715–#719).
 *
 * RBAC — composes EXISTING permissions only (no new role/permission, D-#715):
 *   - The Office side (receive, tag, publish, hand back, waive, the queue + sheet):
 *     `roster:manage` — Office template + Principal, which includes the TEACHER
 *     logins carrying the OFFICE template (Tazkir, Akter Hossen).
 *   - The teacher's reminders: `tracker:write`, own tests only (`teacherId = me`).
 *   - "Returned to the students" (D-#719): the ACCOUNTABLE teacher under
 *     `tracker:write`, or `roster:manage` for an absent teacher — a declared
 *     `hasAnyPermission` scope (D-#441), with the ownership check in the body.
 * PM: the desk is `class_test_script:scan` (+ `:publish`, `:hand_back`), the teacher
 *   `class_test_script:return` (own tests), a stage read `class_test_script:view`.
 */
import { builder } from "../../../schema";
import { callerHasPermission } from "@scd/shared";
import { ForbiddenError } from "../../../middleware/authz";
import {
  teacherScriptTasks,
  officeScriptQueue,
  scriptSheet,
  scriptTestRow,
  receiveScripts,
  undoReceiveScripts,
  waiveScripts,
  unwaiveScripts,
  attachScriptPages,
  removeScriptPage,
  setScriptMissing,
  publishScripts,
  unpublishScripts,
  handBackScripts,
  markScriptsReturned,
  accountableTeacherId,
  type ScriptTestRow,
  type ScriptSheet,
  type ScriptSheetStudent,
  type ScriptPage,
  type ScriptPublishOutcome,
} from "../services/ClassTestScriptService";

const ScriptTestRowRef = builder.objectRef<ScriptTestRow>("ClassTestScriptRow").implement({
  description:
    "A class test's SCRIPT stage (CS-1, D-#715) — DERIVED on read. stage ∈ CT_SCRIPT_STAGES; " +
    "presentCount/resolvedCount/pageCount count PRESENT students only.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    subject: t.exposeString("subject"),
    subjectBn: t.exposeString("subjectBn"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    classLevel: t.int({ nullable: true, resolve: (r) => r.classLevel }),
    sectionId: t.string({ nullable: true, resolve: (r) => r.sectionId }),
    subjectGroupId: t.string({ nullable: true, resolve: (r) => r.subjectGroupId }),
    unitLabelBn: t.exposeString("unitLabelBn"),
    teacherId: t.exposeString("teacherId"),
    teacherName: t.exposeString("teacherName"),
    stage: t.exposeString("stage"),
    dueDateKey: t.exposeString("dueDateKey"),
    returnDueDateKey: t.string({ nullable: true, resolve: (r) => r.returnDueDateKey }),
    presentCount: t.exposeInt("presentCount"),
    resolvedCount: t.exposeInt("resolvedCount"),
    pageCount: t.exposeInt("pageCount"),
    receivedCount: t.int({ nullable: true, resolve: (r) => r.receivedCount }),
    receivedAt: t.string({ nullable: true, resolve: (r) => r.receivedAt }),
    publishedAt: t.string({ nullable: true, resolve: (r) => r.publishedAt }),
    handedBackAt: t.string({ nullable: true, resolve: (r) => r.handedBackAt }),
    returnedAt: t.string({ nullable: true, resolve: (r) => r.returnedAt }),
    waivedAt: t.string({ nullable: true, resolve: (r) => r.waivedAt }),
    waiveReason: t.string({ nullable: true, resolve: (r) => r.waiveReason }),
    backfilled: t.exposeBoolean("backfilled"),
  }),
});

const ScriptPageRef = builder.objectRef<ScriptPage>("ClassTestScriptPage").implement({
  fields: (t) => ({
    fileId: t.exposeString("fileId"),
    mime: t.exposeString("mime"),
    originalName: t.exposeString("originalName"),
  }),
});

const ScriptSheetStudentRef = builder.objectRef<ScriptSheetStudent>("ClassTestScriptStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (s) => s.nameBn }),
    rollNumber: t.string({ nullable: true, resolve: (s) => s.rollNumber }),
    status: t.exposeString("status"),
    marks: t.float({ nullable: true, resolve: (s) => s.marks }),
    pages: t.field({ type: [ScriptPageRef], resolve: (s) => s.pages }),
    missing: t.exposeBoolean("missing"),
    missingReason: t.string({ nullable: true, resolve: (s) => s.missingReason }),
  }),
});

const ScriptSheetRef = builder.objectRef<ScriptSheet>("ClassTestScriptSheet").implement({
  description: "The Office's scan & tag sheet (CS-2): the test's stage + every result row in roll order.",
  fields: (t) => ({
    test: t.field({ type: ScriptTestRowRef, resolve: (s) => s.test }),
    totalMarks: t.exposeInt("totalMarks"),
    students: t.field({ type: [ScriptSheetStudentRef], resolve: (s) => s.students }),
  }),
});

const ScriptPublishOutcomeRef = builder.objectRef<ScriptPublishOutcome>("ClassTestScriptPublishOutcome").implement({
  fields: (t) => ({
    test: t.field({ type: ScriptTestRowRef, resolve: (o) => o.test }),
    notifiedGuardianCount: t.exposeInt("notifiedGuardianCount"),
  }),
});

const actor = (ctx: { auth?: { userId: unknown } | null }): string => {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return ctx.auth.userId as string;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

builder.queryField("myClassTestScriptTasks", (t) =>
  t.field({
    type: [ScriptTestRowRef],
    description:
      "The caller's own script reminders (Today): scripts to hand in to the Office (DUE/OVERDUE) and " +
      "scripts handed back to return in class (WITH_TEACHER/RETURN_OVERDUE). Requires class_test_script:return.",
    authScopes: { hasPermission: "class_test_script:return" },
    resolve: async (_root, _args, ctx) => teacherScriptTasks(actor(ctx)),
  }),
);

builder.queryField("classTestScriptQueue", (t) =>
  t.field({
    type: [ScriptTestRowRef],
    description: "Every unfinished test in the script flow, oldest due first (the Office card). class_test_script:scan.",
    authScopes: { hasPermission: "class_test_script:scan" },
    resolve: async () => officeScriptQueue(),
  }),
);

builder.queryField("classTestScriptSheet", (t) =>
  t.field({
    type: ScriptSheetRef,
    description: "One test's scan & tag sheet (CS-2). class_test_script:scan.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => scriptSheet(args.testId),
  }),
);

builder.queryField("classTestScriptRow", (t) =>
  t.field({
    type: ScriptTestRowRef,
    nullable: true,
    description: "One test's script stage, or null when it is not in the flow. class_test_script:view (no row scope yet, F-16).",
    authScopes: { hasPermission: "class_test_script:view" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => scriptTestRow(args.testId),
  }),
);

// ---------------------------------------------------------------------------
// Office transitions (class_test_script:scan / publish / hand_back)
// ---------------------------------------------------------------------------

builder.mutationField("receiveClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: the scripts arrived at the desk (count = what was counted). Clears the teacher's reminder.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: { testId: t.arg.string({ required: true }), count: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => receiveScripts(args.testId, args.count, actor(ctx)),
  }),
);

builder.mutationField("undoReceiveClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: take a receipt back — only before anything was tagged.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => undoReceiveScripts(args.testId, actor(ctx)),
  }),
);

builder.mutationField("waiveClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: close a test with no scans (e.g. the paper already went home), with a reason (D-#718).",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: { testId: t.arg.string({ required: true }), reason: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => waiveScripts(args.testId, args.reason, actor(ctx)),
  }),
);

builder.mutationField("unwaiveClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: undo a waive — the test returns to the stage its stamps imply.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => unwaiveScripts(args.testId, actor(ctx)),
  }),
);

builder.mutationField("attachClassTestScriptPages", (t) =>
  t.field({
    type: ScriptSheetRef,
    description: "Office: tag uploaded scan pages (StoredFile classtest_script) to one PRESENT student, in order.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      fileIds: t.arg.stringList({ required: true }),
    },
    resolve: async (_root, args, ctx) => attachScriptPages(args.testId, args.studentId, args.fileIds, actor(ctx)),
  }),
);

builder.mutationField("removeClassTestScriptPage", (t) =>
  t.field({
    type: ScriptSheetRef,
    description: "Office: untag one page from a student's script (before publish).",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      fileId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => removeScriptPage(args.testId, args.studentId, args.fileId, actor(ctx)),
  }),
);

builder.mutationField("setClassTestScriptMissing", (t) =>
  t.field({
    type: ScriptSheetRef,
    description: "Office: mark a PRESENT student's script as not received (খাতা নেই), or undo it.",
    authScopes: { hasPermission: "class_test_script:scan" },
    args: {
      testId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      missing: t.arg.boolean({ required: true }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      setScriptMissing(args.testId, args.studentId, args.missing, args.reason, actor(ctx)),
  }),
);

builder.mutationField("publishClassTestScripts", (t) =>
  t.field({
    type: ScriptPublishOutcomeRef,
    description: "Office: release the scans to guardians (needs UPLOAD_DONE); notifies each child's guardians.",
    authScopes: { hasPermission: "class_test_script:publish" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => publishScripts(args.testId, actor(ctx)),
  }),
);

builder.mutationField("unpublishClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: pull the scans back from guardians (before the paper is handed to the teacher).",
    authScopes: { hasPermission: "class_test_script:publish" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => unpublishScripts(args.testId, actor(ctx)),
  }),
);

builder.mutationField("handBackClassTestScripts", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description: "Office: gave the paper to the teacher to return in class (D-#719). Needs PUBLISHED.",
    authScopes: { hasPermission: "class_test_script:hand_back" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => handBackScripts(args.testId, actor(ctx)),
  }),
);

// ---------------------------------------------------------------------------
// The teacher's return (own test) — or the Office for an absent teacher
// ---------------------------------------------------------------------------

builder.mutationField("markClassTestScriptsReturned", (t) =>
  t.field({
    type: ScriptTestRowRef,
    description:
      "The students have their scripts back (D-#719). The test's accountable teacher (class_test_script:return) or " +
      "class_test_script:scan. Needs WITH_TEACHER / RETURN_OVERDUE.",
    authScopes: { hasAnyPermission: ["class_test_script:return", "class_test_script:scan"] },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const userId = actor(ctx);
      if (!callerHasPermission(ctx.auth!, "class_test_script:scan")) {
        const owner = await accountableTeacherId(args.testId);
        if (owner !== userId) throw new ForbiddenError("শুধু এই টেস্টের শিক্ষক ফেরত চিহ্নিত করতে পারেন");
      }
      return markScriptsReturned(args.testId, userId);
    },
  }),
);
