/**
 * Push-device + guardian-chase resolvers (AT-4, D-#65).
 *   registerPushDevice / unregisterPushDevice — any authenticated recipient
 *     manages their OWN device tokens (own-row; no new permission). The owner
 *     is derived from the auth context (a GUARDIAN token registers a
 *     guardian-owned device, N-4/D-#75 — same split as the notification inbox).
 *   guardianChaseLink — Office (attendance:manage) gets the AT4.7 manual wa.me
 *     link for an absent-no-application student. Teachers never chase (O3).
 * Identity-plane (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { Student } from "../../foundation/models/Student";
import {
  registerPushDevice,
  unregisterPushDevice,
  buildGuardianChaseLink,
} from "../services/PushDeviceService";

builder.mutationField("registerPushDevice", (t) =>
  t.boolean({
    authScopes: { authenticated: true },
    args: {
      token: t.arg.string({ required: true }),
      platform: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      const platform = args.platform as "ios" | "android" | "web" | undefined;
      const owner =
        ctx.auth!.role === "GUARDIAN"
          ? { guardianId: ctx.auth!.userId }
          : { userId: ctx.auth!.userId };
      await registerPushDevice(owner, args.token, platform ?? undefined);
      return true;
    },
  }),
);

builder.mutationField("unregisterPushDevice", (t) =>
  t.boolean({
    authScopes: { authenticated: true },
    args: { token: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      // Owner-scoped (same split as register) — a caller can only deactivate
      // a device they own, never another user's token.
      const owner =
        ctx.auth!.role === "GUARDIAN"
          ? { guardianId: ctx.auth!.userId }
          : { userId: ctx.auth!.userId };
      await unregisterPushDevice(owner, args.token);
      return true;
    },
  }),
);

builder.queryField("guardianChaseLink", (t) =>
  t.field({
    type: "String",
    nullable: true,
    description:
      "AT4.7 — Office-only wa.me link nudging an absent student's guardian to file a leave reason. null when no phone on file.",
    authScopes: { hasPermission: "attendance:manage" },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      const student = await Student.findById(args.studentId).select("name nameBn phone").lean();
      if (!student) throw new ForbiddenError("Student not found");
      if (!student.phone) return null;
      return buildGuardianChaseLink({
        toPhone: student.phone,
        studentName: student.nameBn ?? student.name,
      });
    },
  }),
);
