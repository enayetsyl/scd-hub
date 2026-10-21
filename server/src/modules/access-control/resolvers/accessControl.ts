/**
 * Access-control resolvers (AC-1, prd-access-control §6, D-#193/#210–#215).
 *
 * The Principal-only per-user permission editor. EVERY field here is gated
 * `authScopes: { hasPermission: "access_control:edit" }` — a RESERVED-locked, Principal-only
 * permission (the server re-enforces what the AC-2 screen presents). The mutations tune
 * the three additive `User` fields; a reserved-locked perm is refused at write-time with a
 * Bangla message (surfaced as the GraphQL error); a revoke always wins. The read returns
 * the raw arrays + the derived effective set for the screen.
 *
 * Identity plane (the fields live on the staff `User`); no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import {
  setAdditionalTemplates,
  addGrantedPermission,
  removeGrantedPermission,
  addRevokedPermission,
  removeRevokedPermission,
  effectiveUserAccess,
  type AccessActor,
  type UserAccessShape,
} from "../services/AccessControlService";
import {
  roleTemplates,
  setRoleTemplatePermission,
  resetRoleTemplate,
  type RoleTemplateShape,
} from "../services/RoleTemplateService";

/** The acting Principal (gated `access:manage`) — used as the audit actor. */
function actorOf(ctx: AppContext): AccessActor {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return { userId: ctx.auth.userId, role: ctx.auth.role };
}

const UserAccessRef = builder.objectRef<UserAccessShape>("UserAccess");
UserAccessRef.implement({
  description:
    "A staff user's per-user access (AC-1): the primary role + the additional templates / " +
    "granted / revoked overrides, plus the DERIVED effective permission set the seam resolves.",
  fields: (t) => ({
    userId: t.exposeString("userId"),
    role: t.exposeString("role"),
    additionalTemplates: t.exposeStringList("additionalTemplates"),
    grantedPermissions: t.exposeStringList("grantedPermissions"),
    revokedPermissions: t.exposeStringList("revokedPermissions"),
    effectivePermissions: t.exposeStringList("effectivePermissions"),
  }),
});

// ---------------------------------------------------------------------------
// Mutations (access:manage — Principal only)
// ---------------------------------------------------------------------------

builder.mutationField("setUserAdditionalTemplates", (t) =>
  t.field({
    type: UserAccessRef,
    description:
      "Set (or clear, with []) the additional role templates a staff user holds. Only " +
      "TEACHER/OFFICE are assignable (PRINCIPAL/GUARDIAN refused). Requires access:manage. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      userId: t.arg.string({ required: true }),
      templates: t.arg.stringList({ required: true }),
    },
    resolve: (_root, args, ctx) => setAdditionalTemplates(actorOf(ctx), args.userId, args.templates),
  }),
);

builder.mutationField("addUserGrantedPermission", (t) =>
  t.field({
    type: UserAccessRef,
    description:
      "Add a per-user granted permission. A RESERVED-locked perm or guardian:read_child is " +
      "refused (Bangla error). Requires access:manage. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      userId: t.arg.string({ required: true }),
      permission: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => addGrantedPermission(actorOf(ctx), args.userId, args.permission),
  }),
);

builder.mutationField("removeUserGrantedPermission", (t) =>
  t.field({
    type: UserAccessRef,
    description: "Remove a per-user granted permission (back to the template baseline). Requires access:manage. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      userId: t.arg.string({ required: true }),
      permission: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => removeGrantedPermission(actorOf(ctx), args.userId, args.permission),
  }),
);

builder.mutationField("addUserRevokedPermission", (t) =>
  t.field({
    type: UserAccessRef,
    description: "Add a per-user revoked permission (a revoke always wins). Requires access:manage. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      userId: t.arg.string({ required: true }),
      permission: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => addRevokedPermission(actorOf(ctx), args.userId, args.permission),
  }),
);

builder.mutationField("removeUserRevokedPermission", (t) =>
  t.field({
    type: UserAccessRef,
    description: "Remove a per-user revoked permission (the perm may flow from a template/grant again). Requires access:manage. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      userId: t.arg.string({ required: true }),
      permission: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => removeRevokedPermission(actorOf(ctx), args.userId, args.permission),
  }),
);

// ---------------------------------------------------------------------------
// Read (access:manage) — for the AC-2 editor screen
// ---------------------------------------------------------------------------

builder.queryField("userEffectiveAccess", (t) =>
  t.field({
    type: UserAccessRef,
    description:
      "A staff user's per-user access overrides + the DERIVED effective permission set " +
      "(for the AC-2 editor). Requires access:manage.",
    authScopes: { hasPermission: "access_control:edit" },
    args: { userId: t.arg.string({ required: true }) },
    resolve: (_root, args) => effectiveUserAccess(args.userId),
  }),
);

// ---------------------------------------------------------------------------
// Role templates (PM, docs/prd-permission-matrix.md §7, D-#791/#800) — the Roles tab.
// Gated `access_control:edit` (LOCKED, Principal-only; today's access:manage).
// ---------------------------------------------------------------------------

const RoleTemplateRef = builder.objectRef<RoleTemplateShape>("RoleTemplate");
RoleTemplateRef.implement({
  description:
    "One editable role (TEACHER / OFFICE): the Principal's switches as a delta on the code " +
    "default, the role's catalogue actions now, and how many active logins it reaches.",
  fields: (t) => ({
    role: t.exposeString("role"),
    granted: t.exposeStringList("granted"),
    revoked: t.exposeStringList("revoked"),
    permissions: t.exposeStringList("permissions"),
    userCount: t.exposeInt("userCount"),
  }),
});

builder.queryField("roleTemplates", (t) =>
  t.field({
    type: [RoleTemplateRef],
    description: "The editable role templates (TEACHER, OFFICE) with the Principal's edits. Requires access_control:edit.",
    authScopes: { hasPermission: "access_control:edit" },
    resolve: () => roleTemplates(),
  }),
);

builder.mutationField("setRoleTemplatePermission", (t) =>
  t.field({
    type: RoleTemplateRef,
    description:
      "Switch one catalogue action on or off for every login of a role (TEACHER / OFFICE). " +
      "LOCKED and SELF actions are refused (Bangla error). Requires access_control:edit. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: {
      role: t.arg.string({ required: true }),
      permission: t.arg.string({ required: true }),
      enabled: t.arg.boolean({ required: true }),
    },
    resolve: (_root, args, ctx) => setRoleTemplatePermission(actorOf(ctx), args.role, args.permission, args.enabled),
  }),
);

builder.mutationField("resetRoleTemplate", (t) =>
  t.field({
    type: RoleTemplateRef,
    description: "Put a role (TEACHER / OFFICE) back to the code default. Requires access_control:edit. Audited.",
    authScopes: { hasPermission: "access_control:edit" },
    args: { role: t.arg.string({ required: true }) },
    resolve: (_root, args, ctx) => resetRoleTemplate(actorOf(ctx), args.role),
  }),
);
