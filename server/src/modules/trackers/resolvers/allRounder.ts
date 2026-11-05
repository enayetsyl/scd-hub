/**
 * The all-rounder card (SB-7, D-#987) — same gates as the progress card it sits beside:
 *   childAllRounder    a linked guardian, for their own child (guardian:read_child + link)
 *   studentAllRounder  staff on the student profile (student_profile:view, section-scoped
 *                      unless view_all — the studentWholePicture rule)
 */
import type { Types } from "mongoose";
import { builder } from "../../../schema";
import { ForbiddenError, assertGuardianOfStudent } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import { allRounder, withoutAreas, type AllRounder, type AreaScore } from "../services/AllRounderService";
import { guardianFeaturesFor } from "../../guardian-access/services/GuardianFeatureService";
import { assertReportRead, holdsViewAll, STUDENT_PROFILE_REPORT_GATE } from "./classTestSummary";

const AreaRef = builder.objectRef<AreaScore>("AllRounderArea").implement({
  description: "One area of the all-rounder card: a 0–100 score (null = no data) and its band.",
  fields: (t) => ({
    area: t.exposeString("area"),
    score: t.int({ nullable: true, resolve: (a) => a.score }),
    band: t.exposeString("band"),
    value: t.float({ nullable: true, resolve: (a) => a.value }),
  }),
});

const AllRounderRef = builder.objectRef<AllRounder>("AllRounder").implement({
  description: "How balanced a child is across the areas that have data (D-#987). No classmate comparison.",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    score: t.int({ nullable: true, resolve: (r) => r.score }),
    band: t.exposeString("band"),
    strongCount: t.exposeInt("strongCount"),
    countedAreas: t.exposeInt("countedAreas"),
    areas: t.field({ type: [AreaRef], resolve: (r) => r.areas }),
  }),
});

builder.queryField("childAllRounder", (t) =>
  t.field({
    type: AllRounderRef,
    nullable: true,
    description:
      "A guardian's all-rounder card for their own child (Today). It came with the storybook shelf and activity " +
      "sheets, so it follows their guardian switch (D-#1011): null while both are off for this guardian; an off " +
      "feature's area is left out.",
    authScopes: { hasPermission: "guardian:read_child" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertGuardianOfStudent(ctx, args.studentId);
      const on = await guardianFeaturesFor(ctx.auth!.userId);
      if (on.length === 0) return null;
      const drop: AreaScore["area"][] = [];
      if (!on.includes("STORYBOOKS")) drop.push("READING");
      if (!on.includes("ACTIVITY_SHEETS")) drop.push("ACTIVITY");
      return withoutAreas(await allRounder(args.studentId), drop);
    },
  }),
);

builder.queryField("studentAllRounder", (t) =>
  t.field({
    type: AllRounderRef,
    description: "The all-rounder card on the staff student profile (studentWholePicture's scope rule).",
    authScopes: { hasPermission: "student_profile:view" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      if (!holdsViewAll(ctx, STUDENT_PROFILE_REPORT_GATE)) {
        const student = (await Student.findById(args.studentId).select("sectionId").lean()) as { sectionId: Types.ObjectId } | null;
        if (!student) throw new ForbiddenError("Student not found");
        await assertReportRead(ctx, student.sectionId.toString(), { gate: STUDENT_PROFILE_REPORT_GATE });
      }
      return allRounder(args.studentId);
    },
  }),
);
