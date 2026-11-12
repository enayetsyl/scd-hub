/**
 * Class-test weak objectives (docs/prd-ct-weak-objectives.md, D-#1360–#1364).
 *
 *   classTestWeakObjectiveOptions — the picker's list for one test (tagged, LOCKED objective rows
 *                                   of its class × subject; `available: false` → no picker).
 *                                   `class_test:enter_results` + read scope on the test's unit.
 *   classTestWeakObjectivesPage   — one student's picks in a subject, newest first (D-#761).
 *                                   The `classTestStudentProfile` gate: `class_test:view_all`
 *                                   unscoped, `class_test:view` scoped to the student's section.
 *
 * No new permission: both reuse the class-test actions. Writes go through enterClassTestResult.
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { ForbiddenError } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import { getClassTest } from "../services/ClassTestService";
import {
  classTestWeakObjectivesPage,
  weakLoOptions,
  type WeakLoOption,
  type WeakLoOptions,
  type WeakObjectiveRow,
} from "../services/ClassTestWeakObjectiveService";
import { assertAnchorRead, CLASS_TEST_REACH } from "../classTestAnchor";
import { assertReportRead, CLASS_TEST_REPORT_GATE, holdsViewAll } from "./classTestSummary";

const WeakLoOptionRef = builder.objectRef<WeakLoOption>("ClassTestWeakObjectiveOption").implement({
  description: "One pickable weak objective: a tagged, LOCKED row of the test's class × subject (D-#1360).",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    level: t.exposeString("level"),
    chapterNumber: t.int({ nullable: true, resolve: (r) => r.chapterNumber }),
    chapterTitleBn: t.string({ nullable: true, resolve: (r) => r.chapterTitleBn }),
    strand: t.string({ nullable: true, resolve: (r) => r.strand }),
  }),
});

const WeakLoOptionsRef = builder.objectRef<WeakLoOptions>("ClassTestWeakObjectiveOptions").implement({
  description: "The weak-objective picker for one class test. `available: false` → the marks screen is unchanged.",
  fields: (t) => ({
    available: t.exposeBoolean("available"),
    max: t.exposeInt("max"),
    options: t.field({ type: [WeakLoOptionRef], resolve: (r) => r.options }),
  }),
});

builder.queryField("classTestWeakObjectiveOptions", (t) =>
  t.field({
    type: WeakLoOptionsRef,
    description:
      "D-#1360: the objectives a teacher may pick as a child's weak areas on this test — tagged, LOCKED rows of " +
      "its class × subject, in book order. Unavailable on a group-anchored test or without a locked catalogue. " +
      "Requires class_test:enter_results + read scope on the test.",
    authScopes: { hasPermission: "class_test:enter_results" },
    args: { testId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const test = await getClassTest(args.testId);
      if (!test) throw new ForbiddenError("Class test not found");
      await assertAnchorRead(ctx, test, CLASS_TEST_REACH);
      return weakLoOptions(test);
    },
  }),
);

const WeakObjectiveRowRef = builder.objectRef<WeakObjectiveRow>("ClassTestWeakObjectiveRow").implement({
  description: "One picked weak objective of one student on one class test (D-#1360).",
  fields: (t) => ({
    code: t.exposeString("code"),
    labelBn: t.exposeString("labelBn"),
    testId: t.exposeString("testId"),
    ctId: t.exposeString("ctId"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    published: t.exposeBoolean("published"),
  }),
});

const WeakObjectivePageRef = pageRef("ClassTestWeakObjectivePage", WeakObjectiveRowRef);

builder.queryField("classTestWeakObjectivesPage", (t) =>
  t.field({
    type: WeakObjectivePageRef,
    description:
      "D-#1360: one student's picked weak objectives in one subject, one row per code, newest exam first (paged, " +
      "D-#761). class_test:view_all unscoped; class_test:view scoped to the student's section (the profile gate).",
    authScopes: { hasAnyPermission: ["class_test:view", "class_test:view_all"] },
    args: {
      studentId: t.arg.string({ required: true }),
      subject: t.arg.string({ required: true }),
      page: t.arg.int({ required: false }),
      pageSize: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!holdsViewAll(ctx, CLASS_TEST_REPORT_GATE)) {
        const student = (await Student.findById(args.studentId).select("sectionId").lean()) as { sectionId?: unknown } | null;
        if (!student?.sectionId) throw new ForbiddenError("Student not found");
        await assertReportRead(ctx, String(student.sectionId), { gate: CLASS_TEST_REPORT_GATE });
      }
      return classTestWeakObjectivesPage(args.studentId, args.subject, args);
    },
  }),
);
