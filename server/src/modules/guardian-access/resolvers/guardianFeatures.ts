/**
 * Guardian release switch resolvers (D-#1011).
 *
 *   myGuardianFeatures            a guardian — the features on for them (sidebar + Today cards)
 *   guardianFeatureAccess         `library:guardian_access` / `activity_sheets:guardian_access`
 *   searchGuardiansForFeature     the same — find a family by guardian name / phone / child
 *   setGuardianFeatureForAll      the same — on/off for every guardian
 *   setGuardianFeatureForGuardian the same — on/off for one guardian
 * The per-feature permission is checked in the resolver (GUARDIAN_FEATURE_PERMISSION).
 */
import { GUARDIAN_FEATURE_PERMISSION, callerHasPermission, type GuardianFeature } from "@scd/shared";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  guardianFeatureAccess,
  guardianFeaturesFor,
  searchGuardians,
  setGuardianFeatureFor,
  setGuardianFeatureForAll,
  type GuardianFeatureAccessView,
  type GuardianPick,
} from "../services/GuardianFeatureService";

function assertSwitcher(ctx: AppContext, feature: string): void {
  const perm = GUARDIAN_FEATURE_PERMISSION[feature as GuardianFeature];
  if (!perm) throw new ForbiddenError(`Unknown guardian feature: ${feature}`);
  if (!ctx.auth || !callerHasPermission(ctx.auth, perm)) throw new ForbiddenError("এই সুবিধা চালু/বন্ধ করার অনুমতি নেই");
}

const GuardianPickRef = builder.objectRef<GuardianPick>("GuardianFeaturePick");
GuardianPickRef.implement({
  description: "A guardian login on the release-switch screen, with the children it is linked to.",
  fields: (t) => ({
    guardianId: t.exposeString("guardianId"),
    name: t.exposeString("name"),
    phone: t.string({ nullable: true, resolve: (g) => g.phone }),
    childrenText: t.exposeString("childrenText"),
  }),
});

const AccessRef = builder.objectRef<GuardianFeatureAccessView>("GuardianFeatureAccess");
AccessRef.implement({
  description: "Who sees a guardian-facing feature: everyone, or only the chosen guardians (D-#1011).",
  fields: (t) => ({
    feature: t.exposeString("feature"),
    onForAll: t.exposeBoolean("onForAll"),
    guardians: t.field({ type: [GuardianPickRef], resolve: (r) => r.guardians }),
  }),
});

builder.queryField("myGuardianFeatures", (t) =>
  t.stringList({
    description: "The guardian-facing features switched on for the calling guardian (STORYBOOKS / ACTIVITY_SHEETS).",
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: async (_root, _args, ctx) => (ctx.auth?.role === "GUARDIAN" ? guardianFeaturesFor(ctx.auth.userId) : []),
  }),
);

builder.queryField("guardianFeatureAccess", (t) =>
  t.field({
    type: AccessRef,
    authScopes: { hasAnyPermission: ["library:guardian_access", "activity_sheets:guardian_access"] },
    args: { feature: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertSwitcher(ctx, args.feature);
      return guardianFeatureAccess(args.feature);
    },
  }),
);

builder.queryField("searchGuardiansForFeature", (t) =>
  t.field({
    type: [GuardianPickRef],
    description: "Find guardian logins by guardian name, phone, child's name or school ID (at most 30).",
    authScopes: { hasAnyPermission: ["library:guardian_access", "activity_sheets:guardian_access"] },
    args: { feature: t.arg.string({ required: true }), q: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertSwitcher(ctx, args.feature);
      return searchGuardians(args.q);
    },
  }),
);

builder.mutationField("setGuardianFeatureForAll", (t) =>
  t.field({
    type: AccessRef,
    description: "Switch a guardian feature on/off for every guardian. Audited (GUARDIAN_FEATURE_SET).",
    authScopes: { hasAnyPermission: ["library:guardian_access", "activity_sheets:guardian_access"] },
    args: { feature: t.arg.string({ required: true }), on: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertSwitcher(ctx, args.feature);
      return setGuardianFeatureForAll(args.feature, args.on, ctx.auth!.userId);
    },
  }),
);

builder.mutationField("setGuardianFeatureForGuardian", (t) =>
  t.field({
    type: AccessRef,
    description: "Switch a guardian feature on/off for one guardian login. Audited (GUARDIAN_FEATURE_SET).",
    authScopes: { hasAnyPermission: ["library:guardian_access", "activity_sheets:guardian_access"] },
    args: { feature: t.arg.string({ required: true }), guardianId: t.arg.string({ required: true }), on: t.arg.boolean({ required: true }) },
    resolve: async (_root, args, ctx) => {
      assertSwitcher(ctx, args.feature);
      return setGuardianFeatureFor(args.feature, args.guardianId, args.on, ctx.auth!.userId);
    },
  }),
);
