import { builder } from "../../../schema";
import { Guardian, type IGuardian } from "../models/Guardian";
import { GuardianLink } from "../models/GuardianLink";
import { hashPassword } from "../services/AuthService";
import { writeAudit } from "../../platform/services/AuditService";

type GuardianShape = Pick<IGuardian, "name" | "identifierKind" | "active" | "phone" | "loginEnabled"> & {
  _id: { toString(): string };
};

const GuardianRef = builder.objectRef<GuardianShape>("Guardian");
GuardianRef.implement({
  description: "Guardian account — separate collection (ADR-013)",
  fields: (t) => ({
    id: t.string({ resolve: (g) => g._id.toString() }),
    name: t.exposeString("name"),
    identifierKind: t.exposeString("identifierKind"),
    active: t.exposeBoolean("active"),
    phone: t.string({ nullable: true, resolve: (g) => g.phone ?? null }),
    loginEnabled: t.exposeBoolean("loginEnabled"),
  }),
});

builder.queryField("guardians", (t) =>
  t.field({
    type: [GuardianRef],
    authScopes: { hasPermission: "guardian:link" },
    description: "All guardians in the directory (principal/office).",
    resolve: async () => Guardian.find().sort({ name: 1 }).lean(),
  }),
);

builder.mutationField("createGuardian", (t) =>
  t.field({
    type: GuardianRef,
    authScopes: { hasPermission: "guardian:link" },
    args: {
      name: t.arg.string({ required: true }),
      identifierKind: t.arg.string({ required: true }),
      identifier: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
      phone: t.arg.string(),
    },
    resolve: async (_root, args, ctx) => {
      const passwordHash = await hashPassword(args.password);
      const g = await Guardian.create({
        name: args.name,
        identifierKind: args.identifierKind,
        identifier: args.identifier.trim(),
        passwordHash,
        loginEnabled: true,
        phone: args.phone ?? undefined,
      });
      await writeAudit({ eventKind: "ROSTER_MANAGE", actorId: ctx.auth?.userId, actorRole: ctx.auth?.role, targetId: g._id, targetKind: "Guardian" });
      return g;
    },
  }),
);

builder.mutationField("linkGuardianToStudent", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "guardian:link" },
    description: "Create a guardian↔student link (many-to-many, uniform access ADR-013)",
    args: {
      guardianId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
      relation: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const relation = args.relation.trim();
      if (!relation) throw new Error("Relation is required");
      await GuardianLink.updateOne(
        { guardianId: args.guardianId, studentId: args.studentId },
        {
          $set: { relation, active: true },
          $setOnInsert: { guardianId: args.guardianId, studentId: args.studentId },
        },
        { upsert: true },
      );
      await writeAudit({
        eventKind: "GUARDIAN_LINK",
        actorId: ctx.auth?.userId,
        actorRole: ctx.auth?.role,
        meta: { guardianId: args.guardianId, studentId: args.studentId, relation },
      });
      return true;
    },
  }),
);

builder.mutationField("unlinkGuardianFromStudent", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "guardian:link" },
    description: "Deactivate a guardian↔student link so the portal no longer reaches that child.",
    args: {
      guardianId: t.arg.string({ required: true }),
      studentId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      const res = await GuardianLink.updateOne(
        { guardianId: args.guardianId, studentId: args.studentId },
        { $set: { active: false } },
      );
      if (res.matchedCount > 0) {
        await writeAudit({
          eventKind: "GUARDIAN_LINK",
          actorId: ctx.auth?.userId,
          actorRole: ctx.auth?.role,
          meta: { guardianId: args.guardianId, studentId: args.studentId, active: false },
        });
      }
      return res.matchedCount > 0;
    },
  }),
);
