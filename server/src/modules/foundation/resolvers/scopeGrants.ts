import { builder } from "../../../schema";
import {
  assignProxy,
  revokeProxy,
  extendProxy,
  grantTeaching,
  revokeTeaching,
  teachingGrantsForSection,
  grantView,
  type ScopeGrantView,
} from "../services/ScopeGrantService";
import { ScopeGrant } from "../models/ScopeGrant";

const ScopeGrantRef = builder.objectRef<ScopeGrantView>("ScopeGrant");
ScopeGrantRef.implement({
  description: "A scope grant (teaching / supervisory / proxy) — ADR-017",
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    active: t.exposeBoolean("active"),
    teacherId: t.string({ nullable: true, resolve: (g) => g.teacherId }),
    classId: t.string({ nullable: true, resolve: (g) => g.classId }),
    sectionId: t.string({ nullable: true, resolve: (g) => g.sectionId }),
    subjectId: t.string({ nullable: true, resolve: (g) => g.subjectId }),
    // proxy-only detail (null on teaching/supervisory grants)
    coveringTeacherId: t.string({ nullable: true, resolve: (g) => g.coveringTeacherId }),
    absentTeacherId: t.string({ nullable: true, resolve: (g) => g.absentTeacherId }),
    startDate: t.string({ nullable: true, resolve: (g) => g.startDate }),
    durationDays: t.int({ nullable: true, resolve: (g) => g.durationDays }),
    proxyStatus: t.string({ nullable: true, resolve: (g) => g.proxyStatus }),
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
    description:
      "Active scope grants for the current teacher, with class/section/subject ids " +
      "so the app can offer the teacher's own sections directly (Slice-4 follow-up).",
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) return [];
      const grants = await ScopeGrant.find({ teacherId: ctx.auth.userId, active: true }).lean();
      return grants.map(grantView);
    },
  }),
);

builder.queryField("proxyGrants", (t) =>
  t.field({
    type: [ScopeGrantRef],
    authScopes: { hasPermission: "user:manage" },
    description:
      "Proxy/cover grants for the admin grant list (newest first) — extend/revoke " +
      "without pasting GRANT_IDs. activeOnly=false includes revoked/expired history.",
    args: {
      activeOnly: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) => {
      const filter: Record<string, unknown> = { kind: "proxy" };
      if (args.activeOnly !== false) filter.active = true;
      const grants = await ScopeGrant.find(filter).sort({ createdAt: -1 }).lean();
      return grants.map(grantView);
    },
  }),
);

builder.queryField("teachingGrants", (t) =>
  t.field({
    type: [ScopeGrantRef],
    authScopes: { hasPermission: "user:manage" },
    description: "Active teaching grants (subject-teacher assignments) for a section — D-#17.",
    args: { sectionId: t.arg.string({ required: true }) },
    resolve: (_root, args) => teachingGrantsForSection(args.sectionId),
  }),
);

builder.mutationField("grantTeaching", (t) =>
  t.field({
    type: ProxyGrantIdResultRef,
    authScopes: { hasPermission: "user:manage" },
    description: "Assign a subject teacher (teaching grant) to a section — Principal/Admin only. Idempotent on (teacher, section, subject).",
    args: {
      teacherId: t.arg.string({ required: true }),
      sectionId: t.arg.string({ required: true }),
      subjectId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      const grantId = await grantTeaching({
        teacherId: args.teacherId,
        sectionId: args.sectionId,
        subjectId: args.subjectId,
        assignedBy: ctx.auth.userId,
      });
      return { grantId };
    },
  }),
);

builder.mutationField("revokeTeaching", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "user:manage" },
    description: "Revoke a subject-teacher (teaching) grant",
    args: { grantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      await revokeTeaching(args.grantId, ctx.auth.userId);
      return true;
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
