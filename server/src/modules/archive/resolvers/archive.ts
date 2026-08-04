/**
 * Answer-script archive resolvers (AR-1..AR-3, prd-script-archive §7,
 * D-#443–#447).
 *
 * RBAC — composes EXISTING permissions only (D-#447, the D-#94/#17 posture):
 *   - Reads (box register, bundles, lookup lines): staff read — Principal/
 *     Office (unscoped) or `tracker:read` (the classTest assertStaffRead
 *     pattern). `disposableScriptBundles` is `roster:manage` (retention is an
 *     office lever).
 *   - fileScriptBundle: declared `hasAnyPermission: [tracker:write,
 *     roster:manage]` (D-#441 — an OR over permissions is a SCOPE, never an
 *     in-body check); a plain teacher additionally passes `assertCanWrite` on
 *     the test's OWN section, so nobody files someone else's exam.
 *   - Desk ops (ack / checkout / check-in / dispose / void / box CRUD):
 *     `roster:manage` — the library-desk single-custodian posture (D-#444).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { callerHasPermission } from "@scd/shared";
import type { Role, ArchiveSourceKind } from "@scd/shared";
import { ARCHIVE_SOURCE_KINDS } from "@scd/shared";
import {
  createBox as createBoxSvc,
  updateBox as updateBoxSvc,
  retireBox as retireBoxSvc,
  listBoxes as listBoxesSvc,
  getBox as getBoxSvc,
  fileBundle as fileBundleSvc,
  acknowledgeBundle as acknowledgeBundleSvc,
  checkOutBundle as checkOutBundleSvc,
  checkInBundle as checkInBundleSvc,
  disposeBundle as disposeBundleSvc,
  voidBundle as voidBundleSvc,
  getBundle as getBundleSvc,
  getBundleForSource as getBundleForSourceSvc,
  listBundles as listBundlesSvc,
  listBoxBundles as listBoxBundlesSvc,
  listOpenCheckouts as listOpenCheckoutsSvc,
  listPendingAcks as listPendingAcksSvc,
  listDisposable as listDisposableSvc,
  locationsForTests as locationsForTestsSvc,
  decorateNames,
  type StorageBoxShape,
  type ScriptBundleShape,
  type ScriptCheckoutShape,
  type ArchiveLocationShape,
} from "../services/ArchiveService";
import { ClassTest } from "../../trackers/models/ClassTest";
import { Subject } from "../../foundation/models/Subject";
import { assertCanWrite, ForbiddenError } from "../../../middleware/authz";

// ---------------------------------------------------------------------------
// Gate helpers (the classTest.ts pattern)
// ---------------------------------------------------------------------------

/** Staff read: Principal/Office (unscoped) or tracker:read. */
function assertStaffRead(ctx: AppContext): void {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  const role = ctx.auth.role as Role;
  if (role === "PRINCIPAL" || role === "OFFICE") return;
  if (callerHasPermission(ctx.auth, "tracker:read")) return;
  throw new ForbiddenError();
}

function parseSourceKind(kind: string): ArchiveSourceKind {
  if (!(ARCHIVE_SOURCE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown sourceKind: ${kind}`);
  }
  return kind as ArchiveSourceKind;
}

// ---------------------------------------------------------------------------
// Object shapes
// ---------------------------------------------------------------------------

const StorageBoxRef = builder.objectRef<StorageBoxShape>("StorageBox");
StorageBoxRef.implement({
  description:
    "A registered physical container for answer-script bundles (D-#445): one box per class per " +
    "year, server-minted BX-{year}-{seq} code, free-text location. RETIRED closes it to new " +
    "filings; contents stay findable. Counts are derived, never stored (D-#85).",
  fields: (t) => ({
    id: t.exposeString("id"),
    boxCode: t.exposeString("boxCode"),
    label: t.string({ nullable: true, resolve: (r) => r.label }),
    locationNote: t.exposeString("locationNote"),
    status: t.exposeString("status"),
    createdBy: t.exposeString("createdBy"),
    createdAt: t.exposeString("createdAt"),
    bundleCount: t.exposeInt("bundleCount"),
    scriptCount: t.exposeInt("scriptCount"),
  }),
});

const ScriptCheckoutRef = builder.objectRef<ScriptCheckoutShape>("ScriptCheckout");
ScriptCheckoutRef.implement({
  description:
    "One row of a bundle's append-only desk log (D-#444): who took it, why, expected return; " +
    "the open checkout is the last row with no returnedAt.",
  fields: (t) => ({
    toUserId: t.exposeString("toUserId"),
    toUserName: t.string({ nullable: true, resolve: (r) => r.toUserName }),
    purpose: t.exposeString("purpose"),
    expectedReturnDateKey: t.string({ nullable: true, resolve: (r) => r.expectedReturnDateKey }),
    checkedOutBy: t.exposeString("checkedOutBy"),
    checkedOutAt: t.exposeString("checkedOutAt"),
    returnedBy: t.string({ nullable: true, resolve: (r) => r.returnedBy }),
    returnedAt: t.string({ nullable: true, resolve: (r) => r.returnedAt }),
    returnNote: t.string({ nullable: true, resolve: (r) => r.returnNote }),
  }),
});

const ScriptBundleRef = builder.objectRef<ScriptBundleShape>("ScriptBundle");
ScriptBundleRef.implement({
  description:
    "One archived test's answer scripts (D-#443): roll-sorted bundle in a StorageBox. " +
    "FILED → (CHECKED_OUT ↔ FILED) → DISPOSED; VOID = filed-in-error. Overdue is derived.",
  fields: (t) => ({
    id: t.exposeString("id"),
    sourceKind: t.exposeString("sourceKind"),
    sourceRefId: t.exposeString("sourceRefId"),
    sourceLabel: t.exposeString("sourceLabel"),
    academicYearId: t.exposeString("academicYearId"),
    classLevel: t.exposeInt("classLevel"),
    sectionId: t.exposeString("sectionId"),
    subject: t.exposeString("subject"),
    testNumber: t.exposeInt("testNumber"),
    examDate: t.exposeString("examDate"),
    scriptCount: t.exposeInt("scriptCount"),
    boxId: t.exposeString("boxId"),
    filedBy: t.exposeString("filedBy"),
    filedByName: t.string({ nullable: true, resolve: (r) => r.filedByName }),
    filedAt: t.exposeString("filedAt"),
    acknowledgedBy: t.string({ nullable: true, resolve: (r) => r.acknowledgedBy }),
    acknowledgedAt: t.string({ nullable: true, resolve: (r) => r.acknowledgedAt }),
    status: t.exposeString("status"),
    checkouts: t.field({ type: [ScriptCheckoutRef], resolve: (r) => r.checkouts }),
    attachmentFileIds: t.exposeStringList("attachmentFileIds"),
    disposedBy: t.string({ nullable: true, resolve: (r) => r.disposedBy }),
    disposedAt: t.string({ nullable: true, resolve: (r) => r.disposedAt }),
    disposeReason: t.string({ nullable: true, resolve: (r) => r.disposeReason }),
    voidedBy: t.string({ nullable: true, resolve: (r) => r.voidedBy }),
    voidedAt: t.string({ nullable: true, resolve: (r) => r.voidedAt }),
    voidReason: t.string({ nullable: true, resolve: (r) => r.voidReason }),
    notes: t.string({ nullable: true, resolve: (r) => r.notes }),
    overdue: t.exposeBoolean("overdue"),
  }),
});

const ArchiveLocationRef = builder.objectRef<ArchiveLocationShape>("ArchiveLocation");
ArchiveLocationRef.implement({
  description:
    "The lookup-line answer for one test: which box, where it stands, and who holds it if " +
    "checked out. Batched — one query per screen, not per row.",
  fields: (t) => ({
    testId: t.exposeString("testId"),
    bundleId: t.exposeString("bundleId"),
    boxCode: t.exposeString("boxCode"),
    locationNote: t.exposeString("locationNote"),
    status: t.exposeString("status"),
    holderName: t.string({ nullable: true, resolve: (r) => r.holderName }),
  }),
});

// ---------------------------------------------------------------------------
// Queries (staff read unless noted)
// ---------------------------------------------------------------------------

builder.queryField("storageBoxes", (t) =>
  t.field({
    type: [StorageBoxRef],
    description: "The box register with derived fill counts. Staff read.",
    authScopes: { authenticated: true },
    args: { status: t.arg.string({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return listBoxesSvc(args.status ?? undefined);
    },
  }),
);

builder.queryField("storageBox", (t) =>
  t.field({
    type: StorageBoxRef,
    nullable: true,
    description: "One box. Staff read.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return getBoxSvc(args.id);
    },
  }),
);

builder.queryField("storageBoxBundles", (t) =>
  t.field({
    type: [ScriptBundleRef],
    description: "A box's contents in exam-date order (every status). Staff read.",
    authScopes: { authenticated: true },
    args: { boxId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return decorateNames(await listBoxBundlesSvc(args.boxId));
    },
  }),
);

builder.queryField("scriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    nullable: true,
    description: "One bundle by id, with the full desk log. Staff read.",
    authScopes: { authenticated: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      const bundle = await getBundleSvc(args.id);
      if (!bundle) return null;
      return (await decorateNames([bundle]))[0];
    },
  }),
);

builder.queryField("scriptBundleForTest", (t) =>
  t.field({
    type: ScriptBundleRef,
    nullable: true,
    description:
      "THE retrieval query: the live (non-VOID) bundle archiving this source row, or null when " +
      "nothing is filed yet. Staff read.",
    authScopes: { authenticated: true },
    args: {
      sourceKind: t.arg.string({ required: true }),
      refId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      const bundle = await getBundleForSourceSvc(parseSourceKind(args.sourceKind), args.refId);
      if (!bundle) return null;
      return (await decorateNames([bundle]))[0];
    },
  }),
);

builder.queryField("scriptBundles", (t) =>
  t.field({
    type: [ScriptBundleRef],
    description:
      "Browse/search the archive — year/class/subject/status/box filters + a ctId substring " +
      "search over sourceLabel. Staff read.",
    authScopes: { authenticated: true },
    args: {
      academicYearId: t.arg.string({ required: false }),
      classLevel: t.arg.int({ required: false }),
      subject: t.arg.string({ required: false }),
      status: t.arg.string({ required: false }),
      boxId: t.arg.string({ required: false }),
      labelQuery: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return decorateNames(
        await listBundlesSvc({
          academicYearId: args.academicYearId ?? undefined,
          classLevel: args.classLevel ?? undefined,
          subject: args.subject ?? undefined,
          status: args.status ?? undefined,
          boxId: args.boxId ?? undefined,
          labelQuery: args.labelQuery ?? undefined,
        }),
      );
    },
  }),
);

builder.queryField("openScriptCheckouts", (t) =>
  t.field({
    type: [ScriptBundleRef],
    description: "Bundles currently out of their box, oldest first; overdue is derived. Staff read.",
    authScopes: { authenticated: true },
    args: { overdueOnly: t.arg.boolean({ required: false }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return decorateNames(await listOpenCheckoutsSvc(args.overdueOnly ?? undefined));
    },
  }),
);

builder.queryField("pendingScriptAcks", (t) =>
  t.field({
    type: [ScriptBundleRef],
    description:
      "Teacher-filed bundles the office has not acknowledged yet (acknowledgedAt == null, " +
      "derived — D-#444). Staff read.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      assertStaffRead(ctx);
      return decorateNames(await listPendingAcksSvc());
    },
  }),
);

builder.queryField("archiveLocationsForTests", (t) =>
  t.field({
    type: [ArchiveLocationRef],
    description:
      "Batched lookup line for class-test screens: where are the scripts of these tests? One " +
      "entry per test with a live bundle; a missing entry means nothing is filed. Staff read.",
    authScopes: { authenticated: true },
    args: { testIds: t.arg.stringList({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertStaffRead(ctx);
      return locationsForTestsSvc(args.testIds);
    },
  }),
);

builder.queryField("disposableScriptBundles", (t) =>
  t.field({
    type: [ScriptBundleRef],
    description:
      "The DERIVED retention list (D-#446): FILED bundles outside the protected current + " +
      "previous academic year. Office lever — roster:manage.",
    authScopes: { hasPermission: "roster:manage" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return decorateNames(await listDisposableSvc());
    },
  }),
);

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

builder.mutationField("fileScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description:
      "Record 'N scripts of test X filed in box Y' (AR-1). Teacher (tracker:write, own section) " +
      "or Office (roster:manage — auto-acknowledged). Source must be a PRINTED class test; box " +
      "ACTIVE; one live bundle per test.",
    authScopes: { hasAnyPermission: ["tracker:write", "roster:manage"] },
    args: {
      sourceKind: t.arg.string({ required: true }),
      refId: t.arg.string({ required: true }),
      scriptCount: t.arg.int({ required: true }),
      boxId: t.arg.string({ required: true }),
      notes: t.arg.string({ required: false }),
      attachmentFileIds: t.arg.stringList({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      const kind = parseSourceKind(args.sourceKind);
      const canManage = callerHasPermission(ctx.auth, "roster:manage");
      if (!canManage) {
        // Plain teacher: may only file THEIR OWN section's test (write-scope on
        // the test's real section + subject, resolved server-side).
        if (kind !== "CLASS_TEST") throw new ForbiddenError();
        const test = await ClassTest.findById(args.refId).select("sectionId subject").lean();
        if (!test) throw new Error("ক্লাস টেস্ট পাওয়া যায়নি");
        const subjectDoc = await Subject.findOne({ code: test.subject }).select("_id").lean();
        await assertCanWrite(
          ctx,
          test.sectionId.toString(),
          subjectDoc?._id ? subjectDoc._id.toString() : undefined,
        );
      }
      return fileBundleSvc({
        sourceKind: kind,
        sourceRefId: args.refId,
        scriptCount: args.scriptCount,
        boxId: args.boxId,
        notes: args.notes ?? undefined,
        attachmentFileIds: args.attachmentFileIds ?? undefined,
        actorId: ctx.auth.userId as string,
        actorCanManage: canManage,
      });
    },
  }),
);

builder.mutationField("acknowledgeScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description: "The ONE office acknowledgement of a teacher-filed bundle (additive stamp, D-#444).",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return acknowledgeBundleSvc({ bundleId: args.id, actorId: ctx.auth.userId as string });
    },
  }),
);

builder.mutationField("checkOutScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description:
      "Desk action (Office only, D-#444): hand a FILED bundle to a staff member — borrower + " +
      "purpose mandatory, expected return optional (overdue derives from it).",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      toUserId: t.arg.string({ required: true }),
      purpose: t.arg.string({ required: true }),
      expectedReturnDateKey: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return checkOutBundleSvc({
        bundleId: args.id,
        toUserId: args.toUserId,
        purpose: args.purpose,
        expectedReturnDateKey: args.expectedReturnDateKey ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("checkInScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description:
      "Desk action (Office only): a CHECKED_OUT bundle returns — closes the open log row; " +
      "optionally re-files into a different ACTIVE box.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
      boxId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return checkInBundleSvc({
        bundleId: args.id,
        note: args.note ?? undefined,
        boxId: args.boxId ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("disposeScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description:
      "Dispose an outside-retention FILED bundle with a reason (D-#446). Refused while checked " +
      "out or inside the protected window. Shred the paper only AFTER this succeeds.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return disposeBundleSvc({
        bundleId: args.id,
        reason: args.reason,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("voidScriptBundle", (t) =>
  t.field({
    type: ScriptBundleRef,
    description:
      "Void a filed-in-error bundle (terminal; record kept). Frees the one-live-bundle slot so " +
      "the correcting re-file can land.",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      reason: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return voidBundleSvc({
        bundleId: args.id,
        reason: args.reason,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("createStorageBox", (t) =>
  t.field({
    type: StorageBoxRef,
    description: "Register a new box — code is SERVER-MINTED BX-{year}-{seq} (D-#445).",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      label: t.arg.string({ required: false }),
      locationNote: t.arg.string({ required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return createBoxSvc({
        label: args.label ?? undefined,
        locationNote: args.locationNote,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("updateStorageBox", (t) =>
  t.field({
    type: StorageBoxRef,
    description:
      "Edit a box's label/location — relocating a box is THIS one edit; every bundle inside " +
      "follows (D-#445).",
    authScopes: { hasPermission: "roster:manage" },
    args: {
      id: t.arg.string({ required: true }),
      label: t.arg.string({ required: false }),
      locationNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return updateBoxSvc({
        boxId: args.id,
        label: args.label ?? undefined,
        locationNote: args.locationNote ?? undefined,
        actorId: ctx.auth.userId as string,
      });
    },
  }),
);

builder.mutationField("retireStorageBox", (t) =>
  t.field({
    type: StorageBoxRef,
    description:
      "Close a box to NEW filings (contents stay findable; never deleted).",
    authScopes: { hasPermission: "roster:manage" },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return retireBoxSvc({ boxId: args.id, actorId: ctx.auth.userId as string });
    },
  }),
);
