import { builder } from "../../../schema";
import {
  assignProxy,
  revokeProxy,
  extendProxy,
} from "../services/ScopeGrantService";
import { ScopeGrant, type IScopeGrant } from "../models/ScopeGrant";

type ScopeGrantShape = Pick<IScopeGrant, "kind" | "active"> & { _id: { toString(): string } };

const ScopeGrantRef = builder.objectRef<ScopeGrantShape>("ScopeGrant");
ScopeGrantRef.implement({
  description: "A scope grant (teaching / supervisory / proxy) — ADR-017",
  fields: (t) => ({
    id: t.string({ resolve: (g) => g._id.toString() }),
    kind: t.exposeString("kind"),
    active: t.exposeBoolean("active"),
  }),
});

const ProxyGrantIdResultRef = builder.objectRef<{ grantId: string }>("ProxyGrantIdResult");
ProxyGrantIdResultRef.implement({
  fields: (t) => ({ grantId: t.exposeString("grantId") }),
});

builder.queryField("myScopes", (t) =>
  t.field({
    type: [ScopeGrantRef],
    authScopes: { authenticated: true },
    description: "Active scope grants for the current teacher",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) return [];
      return ScopeGrant.find({ teacherId: ctx.auth.userId, active: true }).lean();
    },
  }),
);

builder.mutationField("assignProxy", (t) =>
  t.field({
    type: ProxyGrantIdResultRef,
    authScopes: { hasPermission: "user:manage" },
    description: "Assign a proxy/cover grant (Principal/Admin only) — D-#20",
    args: {
      coveringTeacherId: t.arg.string({ required: true }),
      absentTeacherId: t.arg.string(),
      classId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      startDate: t.arg.string({ required: true }),
      durationDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      const grantId = await assignProxy({
        coveringTeacherId: args.coveringTeacherId,
        absentTeacherId: args.absentTeacherId ?? undefined,
        classId: args.classId,
        sectionId: args.sectionId,
        startDate: new Date(args.startDate),
        durationDays: args.durationDays,
        assignedBy: ctx.auth.userId,
      });
      return { grantId };
    },
  }),
);

builder.mutationField("revokeProxy", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "user:manage" },
    description: "Early-revoke a proxy grant",
    args: { grantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      await revokeProxy(args.grantId, ctx.auth.userId);
      return true;
    },
  }),
);

builder.mutationField("extendProxy", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "user:manage" },
    description: "Extend a proxy grant by N additional days",
    args: {
      grantId: t.arg.string({ required: true }),
      additionalDays: t.arg.int({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      await extendProxy({ grantId: args.grantId, additionalDays: args.additionalDays, extendedBy: ctx.auth.userId });
      return true;
    },
  }),
);
