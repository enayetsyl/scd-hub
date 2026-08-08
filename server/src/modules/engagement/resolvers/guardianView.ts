/**
 * Guardian view-recording resolver (GE-2, D-#465).
 *
 * ONE mutation, and it is deliberately the narrowest thing that could work:
 *   - the guardian is taken from the AUTH TOKEN, never from an argument, so no caller
 *     can attribute a view to another family;
 *   - it returns Boolean and never throws — a telemetry write must not be able to
 *     break a guardian's screen (the writeAudit posture, ADR-008);
 *   - it accepts only the GUARDIAN_VIEW_SURFACES vocabulary; anything else is dropped.
 *
 * There is NO read here. The report side lives behind `audit:read` in
 * guardianEngagement.ts — a guardian can contribute to the numbers, never see them.
 */
import { builder } from "../../../schema";
import { recordView } from "../services/GuardianViewService";

builder.mutationField("recordGuardianView", (t) =>
  t.field({
    type: "Boolean",
    description:
      "Record that the calling guardian opened a portal surface (GE-2). Collapses to one " +
      "row per surface per child per Dhaka day with a count, so repeat opens and " +
      "pull-to-refresh do not inflate the figures. Returns false for an unknown surface.",
    // GUARDIAN is the only role holding this permission (D-#68), which is exactly the
    // set of callers whose views the report is about.
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      surface: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: false }),
      refId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) =>
      recordView({
        guardianId: ctx.auth!.userId,
        surface: args.surface,
        studentId: args.studentId,
        refId: args.refId,
      }),
  }),
);
