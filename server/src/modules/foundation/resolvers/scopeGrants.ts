import { builder } from "../../../schema";
import {
  assignProxy,
  revokeProxy,
  extendProxy,
  grantTeaching,
  revokeTeaching,
  teachingGrantsForSection,
  grantSupervisory,
  revokeSupervisory,
  supervisoryGrants,
  grantDelegation,
  revokeDelegation,
  delegationGrants,
  grantView,
  type ScopeGrantView,
} from "../services/ScopeGrantService";
import type { SupervisoryExtent } from "../models/ScopeGrant";
import { ScopeGrant } from "../models/ScopeGrant";

const SupervisoryPairRef = builder.objectRef<{ classId: string; subjectId: string }>("SupervisoryPair");
SupervisoryPairRef.implement({
  description: "An explicit_set supervisory pair: one (class, subject) the grant covers.",
  fields: (t) => ({
    classId: t.exposeString("classId"),
    subjectId: t.exposeString("subjectId"),
  }),
});

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
    // supervisory-only detail (null on teaching/proxy grants)
    extent: t.string({ nullable: true, resolve: (g) => g.extent }),
    explicitSet: t.field({
      type: [SupervisoryPairRef],
      nullable: true,
      resolve: (g) => g.explicitSet,
    }),
    // delegation-only detail (null on the other three kinds) — ACS-1, D-#484
    actions: t.stringList({ nullable: true, resolve: (g) => g.actions }),
    expiresAt: t.string({ nullable: true, resolve: (g) => g.expiresAt }),
  }),
});

const SupervisoryPairInput = builder.inputType("SupervisoryPairInput", {
  description: "An explicit_set pair: the class and subject this supervisory grant covers.",
  fields: (t) => ({
    classId: t.string({ required: true }),
    subjectId: t.string({ required: true }),
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

builder.queryField("supervisoryGrants", (t) =>
  t.field({
    type: [ScopeGrantRef],
    authScopes: { hasPermission: "user:manage" },
    description:
      "Active supervisory (read-oversight) grants for the admin list, newest first — D-#262. " +
      "Pass teacherId to scope to one teacher; omit to list all.",
    args: { teacherId: t.arg.string({ required: false }) },
    resolve: (_root, args) => supervisoryGrants(args.teacherId ?? undefined),
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

builder.mutationField("grantSupervisory", (t) =>
  t.field({
    type: ProxyGrantIdResultRef,
    authScopes: { hasPermission: "user:manage" },
    description:
      "Grant a teacher read-oversight at a configurable extent (D-#262) — Principal/Admin only. " +
      "extent ∈ whole_school | subject_dept (needs subjectId) | grade_class (needs classId) | " +
      "explicit_set (needs explicitSet). Idempotent for the single-target extents.",
    args: {
      teacherId: t.arg.string({ required: true }),
      extent: t.arg.string({ required: true }),
      subjectId: t.arg.string({ required: false }),
      classId: t.arg.string({ required: false }),
      explicitSet: t.arg({ type: [SupervisoryPairInput], required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      const grantId = await grantSupervisory({
        teacherId: args.teacherId,
        extent: args.extent as SupervisoryExtent,
        subjectId: args.subjectId ?? undefined,
        classId: args.classId ?? undefined,
        explicitSet: args.explicitSet?.map((p) => ({ classId: p.classId, subjectId: p.subjectId })),
        assignedBy: ctx.auth.userId,
      });
      return { grantId };
    },
  }),
);

builder.mutationField("revokeSupervisory", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "user:manage" },
    description: "Revoke a supervisory (read-oversight) grant — D-#262",
    args: { grantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      await revokeSupervisory(args.grantId, ctx.auth.userId);
      return true;
    },
  }),
);

// ---------------------------------------------------------------------------
// Delegation grants (ACS-1, D-#484..#489) — the fine-grained "who may do what,
// WHERE" kind. Gated `access:manage`: RESERVED, Principal-only and ungrantable,
// NOT the `user:manage` the other grant mutations use. A delegation manufactures
// write authority across the school, so the power to mint one must not itself be
// handed onward by AC-1 (D-#487).
// ---------------------------------------------------------------------------

builder.queryField("delegationGrants", (t) =>
  t.field({
    type: [ScopeGrantRef],
    authScopes: { hasPermission: "access:manage" },
    description:
      "Active delegation grants (write-capable extent + action allow-list) for the access " +
      "editor, newest first — ACS-1. Pass teacherId to scope to one person; omit to list all.",
    args: { teacherId: t.arg.string({ required: false }) },
    resolve: (_root, args) => delegationGrants(args.teacherId ?? undefined),
  }),
);

builder.mutationField("grantDelegation", (t) =>
  t.field({
    type: ProxyGrantIdResultRef,
    authScopes: { hasPermission: "access:manage" },
    description:
      "Grant one person a named DUTY across a wider extent than they teach (D-#484) — " +
      "e.g. {extent: whole_school, actions: [declare_assignment]}. Read over the extent " +
      "plus write on the listed actions only; the holder still needs tracker:write. " +
      "extent ∈ whole_school | subject_dept (needs subjectId) | grade_class (needs classId) | " +
      "explicit_set (needs explicitSet). expiresAt is optional (open-ended when omitted).",
    args: {
      teacherId: t.arg.string({ required: true }),
      extent: t.arg.string({ required: true }),
      actions: t.arg.stringList({ required: true }),
      subjectId: t.arg.string({ required: false }),
      classId: t.arg.string({ required: false }),
      explicitSet: t.arg({ type: [SupervisoryPairInput], required: false }),
      expiresAt: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      const grantId = await grantDelegation({
        teacherId: args.teacherId,
        extent: args.extent as SupervisoryExtent,
        actions: [...args.actions],
        subjectId: args.subjectId ?? undefined,
        classId: args.classId ?? undefined,
        explicitSet: args.explicitSet?.map((p) => ({ classId: p.classId, subjectId: p.subjectId })),
        expiresAt: args.expiresAt ? new Date(args.expiresAt) : undefined,
        assignedBy: ctx.auth.userId,
      });
      return { grantId };
    },
  }),
);

builder.mutationField("revokeDelegation", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "access:manage" },
    description: "Revoke a delegation grant — ACS-1, D-#484",
    args: { grantId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new Error("Unauthenticated");
      await revokeDelegation(args.grantId, ctx.auth.userId);
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
      subjectId: t.arg.string({ required: true }),
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
        subjectId: args.subjectId,
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
