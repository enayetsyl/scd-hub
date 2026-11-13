/**
 * Profile versions and history (docs/prd-child-support-profile.md §6.6, §9.5; CSP-4).
 *   publishSupportVersion / discardSupportVersion / editSupportDraftItem / createHandSupportVersion  support_profile:approve (LOCKED)
 *   markSupportGoalProgress                                   support_profile:manage (LOCKED; goals, §8.1)
 *   supportVersionsPage / supportVersionDiff / supportReadersPage   support_profile:view_all (LOCKED)
 */
import { builder } from "../../../schema";
import { pageRef } from "../../../pageRef";
import { SUPPORT_SECTIONS } from "@scd/shared";
import type { ISupportProfileVersion } from "../models/SupportProfileVersion";
import {
  diffVersions,
  discardVersion,
  editDraftItem,
  handVersion,
  markGoalProgress,
  publishVersion,
  readersPage,
  versionDiff,
  versionsPage,
  type HandItemInput,
} from "../services/supportVersions";

const VersionRef = builder.objectRef<ISupportProfileVersion>("SupportProfileVersionRow").implement({
  fields: (t) => ({
    id: t.string({ resolve: (v) => String(v._id) }),
    versionNo: t.exposeInt("versionNo"),
    status: t.exposeString("status"),
    mode: t.exposeString("mode"),
    producer: t.exposeString("producer"),
    methodVersion: t.string({ nullable: true, resolve: (v) => v.methodVersion }),
    changeNoteBn: t.exposeString("changeNoteBn"),
    droppedItems: t.exposeInt("droppedItems"),
    itemCount: t.int({ resolve: (v) => SUPPORT_SECTIONS.reduce((n, s) => n + (v.sections?.[s]?.length ?? 0), 0) }),
    provisionalCount: t.int({ resolve: (v) => SUPPORT_SECTIONS.reduce((n, s) => n + (v.sections?.[s] ?? []).filter((i) => i.provisionalEvidence.length > 0).length, 0) }),
    publishedAt: t.string({ nullable: true, resolve: (v) => v.publishedAt?.toISOString() ?? null }),
    createdAt: t.string({ resolve: (v) => v.createdAt.toISOString() }),
  }),
});
const VersionPageRef = pageRef("SupportProfileVersionPage", VersionRef);

const DiffRef = builder.objectRef<ReturnType<typeof diffVersions>>("SupportVersionDiff").implement({
  fields: (t) => ({
    added: t.exposeStringList("added"),
    removed: t.exposeStringList("removed"),
    changedBefore: t.stringList({ resolve: (d) => d.changed.map((c) => c.before) }),
    changedAfter: t.stringList({ resolve: (d) => d.changed.map((c) => c.after) }),
  }),
});

const ReaderRef = builder.objectRef<{ who: string; at: Date; surface: string; via: string }>("SupportProfileReader").implement({
  fields: (t) => ({ who: t.exposeString("who"), at: t.string({ resolve: (r) => new Date(r.at).toISOString() }), surface: t.exposeString("surface"), via: t.exposeString("via") }),
});
const ReaderPageRef = pageRef("SupportProfileReaderPage", ReaderRef);

const HandItemInputRef = builder.inputType("SupportHandItemInput", {
  fields: (t) => ({
    section: t.string({ required: true }),
    textBn: t.string({ required: true }),
    reportIds: t.stringList({ required: true }),
    kind: t.string({ required: false }),
    skillKey: t.string({ required: false }),
    baselineBn: t.string({ required: false }),
    expectedBn: t.string({ required: false }),
    verbFirst: t.boolean({ required: false, description: "The do passes the four actionable checks (§16.7 A-1…A-4) — the Principal's call." }),
  }),
});

builder.mutationField("publishSupportVersion", (t) =>
  t.field({
    type: VersionRef,
    description: "প্রকাশ করুন — refused while any citation is provisional; levels recomputed from APPROVED reports and frozen.",
    authScopes: { hasPermission: "support_profile:approve" },
    args: { versionId: t.arg.string({ required: true }), changeNoteBn: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => publishVersion(ctx, a.versionId, a.changeNoteBn),
  }),
);
builder.mutationField("discardSupportVersion", (t) =>
  t.field({ type: VersionRef, authScopes: { hasPermission: "support_profile:approve" }, args: { versionId: t.arg.string({ required: true }) }, resolve: (_r, a, ctx) => discardVersion(ctx, a.versionId) }),
);
builder.mutationField("editSupportDraftItem", (t) =>
  t.field({
    type: VersionRef,
    description: "Edit a DRAFT item's wording (its evidence stays); textBn null deletes it. A published version is never edited.",
    authScopes: { hasPermission: "support_profile:approve" },
    args: { versionId: t.arg.string({ required: true }), itemId: t.arg.string({ required: true }), textBn: t.arg.string({ required: false }) },
    resolve: (_r, a, ctx) => editDraftItem(ctx, a.versionId, a.itemId, a.textBn ?? null),
  }),
);
builder.mutationField("createHandSupportVersion", (t) =>
  t.field({
    type: VersionRef,
    description: "A version written by hand (no AI): every item picks APPROVED reports; same levels and minimums.",
    authScopes: { hasPermission: "support_profile:approve" },
    args: { studentId: t.arg.string({ required: true }), items: t.arg({ type: [HandItemInputRef], required: true }), doItems: t.arg.stringList({ required: false }), strengthItems: t.arg.stringList({ required: false }) },
    resolve: (_r, a, ctx) => handVersion(ctx, a.studentId, a.items as HandItemInput[], { doItemIds: a.doItems ?? undefined, strengthItemIds: a.strengthItems ?? undefined }),
  }),
);
builder.mutationField("markSupportGoalProgress", (t) =>
  t.boolean({
    description: "এখনো নয় · প্রত্যাশামতো · প্রত্যাশার চেয়ে বেশি — against the goal's own baseline (§11).",
    authScopes: { hasPermission: "support_profile:manage" },
    args: { studentId: t.arg.string({ required: true }), itemId: t.arg.string({ required: true }), progress: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => markGoalProgress(ctx, a.studentId, a.itemId, a.progress),
  }),
);

builder.queryField("supportVersionsPage", (t) =>
  t.field({
    type: VersionPageRef,
    description: "ইতিহাস — versions newest first (audited as HISTORY).",
    authScopes: { hasPermission: "support_profile:view_all" },
    args: { studentId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => versionsPage(ctx, a.studentId, a),
  }),
);
builder.queryField("supportVersionDiff", (t) =>
  t.field({
    type: DiffRef,
    authScopes: { hasPermission: "support_profile:view_all" },
    args: { studentId: t.arg.string({ required: true }), fromVersionId: t.arg.string({ required: true }), toVersionId: t.arg.string({ required: true }) },
    resolve: (_r, a, ctx) => versionDiff(ctx, a.studentId, a.fromVersionId, a.toVersionId),
  }),
);
builder.queryField("supportReadersPage", (t) =>
  t.field({
    type: ReaderPageRef,
    description: "কে পড়েছেন — reads of this child's profile (who, when, where).",
    authScopes: { hasPermission: "support_profile:view_all" },
    args: { studentId: t.arg.string({ required: true }), page: t.arg.int({ required: false }), pageSize: t.arg.int({ required: false }) },
    resolve: (_r, a, ctx) => readersPage(ctx, a.studentId, a),
  }),
);
