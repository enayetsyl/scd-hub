import { builder } from "../../../schema";
import { Guardian, type IGuardian } from "../models/Guardian";
import { GuardianLink } from "../models/GuardianLink";
import { hashPassword } from "../services/AuthService";
import { writeAudit } from "../../platform/services/AuditService";

type GuardianShape = Pick<IGuardian, "name" | "identifierKind" | "active"> & { _id: { toString(): string } };

const GuardianRef = builder.objectRef<GuardianShape>("Guardian");
GuardianRef.implement({
  description: "Guardian account — separate collection (ADR-013)",
  fields: (t) => ({
    id: t.string({ resolve: (g) => g._id.toString() }),
    name: t.exposeString("name"),
    identifierKind: t.exposeString("identifierKind"),
    active: t.exposeBoolean("active"),
  }),
});

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
      await GuardianLink.create({
        guardianId: args.guardianId,
        studentId: args.studentId,
        relation: args.relation,
      });
      await writeAudit({
        eventKind: "GUARDIAN_LINK",
        actorId: ctx.auth?.userId,
        actorRole: ctx.auth?.role,
        meta: { guardianId: args.guardianId, studentId: args.studentId, relation: args.relation },
      });
      return true;
    },
  }),
);
