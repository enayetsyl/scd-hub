/**
 * RoleTemplateService (PM, docs/prd-permission-matrix.md §4.2/§4.3/§7, D-#791/#792/#800).
 *
 * The Principal's role editor: switch a catalogue action on or off for every TEACHER or
 * every OFFICE login at once. Stored as a DELTA on the code default (RoleTemplateOverride).
 *
 * The stored deltas are published into the shared registry (`setRoleTemplateOverrides`),
 * which `effectivePermissions` / `callerHasPermission` read at every gate:
 *   - loaded at boot (`loadRoleTemplateOverrides`),
 *   - replaced on every write here, so the next request already sees the edit,
 *   - re-read every 60 s as a safety net (`startRoleTemplateRefresh`).
 * Prod and dev each run one server process (D-#792).
 *
 * Every change writes a ROLE_TEMPLATE_CHANGED audit row with the prior and next delta.
 */
import {
  CATALOGUE_ROLE_DEFAULTS,
  EDITABLE_ROLES,
  catalogueAction,
  getRoleTemplateOverrides,
  isCataloguePermission,
  isSwitchablePermission,
  roleTemplatePermissions,
  setRoleTemplateOverrides,
  type CataloguePermission,
  type EditableRole,
  type RoleTemplateOverrides,
} from "@scd/shared";
import { RoleTemplateOverride } from "../models/RoleTemplateOverride";
import { User } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";
import { AccessControlError, ESCALATION_GUARDS_READY, type AccessActor } from "./AccessControlService";
export { ESCALATION_GUARDS_READY };

export interface RoleTemplateShape {
  role: EditableRole;
  /** Catalogue actions turned on beyond the code default. */
  granted: CataloguePermission[];
  /** Code-default actions turned off. */
  revoked: CataloguePermission[];
  /** The role's catalogue actions now (default + edits), sorted. */
  permissions: CataloguePermission[];
  /** Active staff logins this role reaches (primary role or an additional template). */
  userCount: number;
}

function assertEditableRole(role: string): asserts role is EditableRole {
  if (!(EDITABLE_ROLES as readonly string[]).includes(role)) {
    throw new AccessControlError("শুধু শিক্ষক ও অফিসের ভূমিকা বদলানো যায়");
  }
}

function assertSwitchable(perm: string): asserts perm is CataloguePermission {
  if (!isCataloguePermission(perm)) throw new AccessControlError(`অজানা অনুমতি: ${perm}`);
  const flags = catalogueAction(perm).flags;
  if (flags.includes("LOCKED")) throw new AccessControlError("এই অনুমতি শুধু প্রধান শিক্ষকের — বদলানো যায় না");
  if (flags.includes("SELF")) throw new AccessControlError("এটি সবার নিজের কাজ — বন্ধ করা যায় না");
  if (flags.includes("ESCALATION") && !ESCALATION_GUARDS_READY) {
    throw new AccessControlError("এই অনুমতি এখনো চালু করা যায় না (নিরাপত্তা যাচাই বাকি)");
  }
  if (!isSwitchablePermission(perm)) throw new AccessControlError("এই অনুমতি বদলানো যায় না");
}

const clean = (list: readonly string[]): CataloguePermission[] =>
  [...new Set(list)].filter(isCataloguePermission).sort();

/** Read every stored delta and publish it to the shared registry. */
export async function loadRoleTemplateOverrides(): Promise<RoleTemplateOverrides> {
  const rows = await RoleTemplateOverride.find({}).lean();
  const next: RoleTemplateOverrides = {};
  for (const r of rows) next[r.role] = { granted: clean(r.granted), revoked: clean(r.revoked) };
  setRoleTemplateOverrides(next);
  return next;
}

let refreshTimer: NodeJS.Timeout | null = null;
/** 60 s re-read — a safety net; writes through this service already replace the cache. */
export function startRoleTemplateRefresh(intervalMs = 60_000): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    loadRoleTemplateOverrides().catch((err) => console.error("[role-templates] refresh failed:", err));
  }, intervalMs);
  refreshTimer.unref?.();
}

async function countUsers(role: EditableRole): Promise<number> {
  return User.countDocuments({ active: true, $or: [{ role }, { additionalTemplates: role }] });
}

async function shapeOf(role: EditableRole): Promise<RoleTemplateShape> {
  const delta = getRoleTemplateOverrides()[role];
  return {
    role,
    granted: clean(delta?.granted ?? []),
    revoked: clean(delta?.revoked ?? []),
    permissions: [...roleTemplatePermissions(role)].sort(),
    userCount: await countUsers(role),
  };
}

export async function roleTemplates(): Promise<RoleTemplateShape[]> {
  return Promise.all(EDITABLE_ROLES.map((r) => shapeOf(r)));
}

async function writeDelta(
  actor: AccessActor,
  role: EditableRole,
  change: string,
  next: { granted: CataloguePermission[]; revoked: CataloguePermission[] },
  extraMeta: Record<string, unknown>,
): Promise<RoleTemplateShape> {
  const prior = getRoleTemplateOverrides()[role] ?? { granted: [], revoked: [] };
  await RoleTemplateOverride.findOneAndUpdate(
    { role },
    { $set: { granted: next.granted, revoked: next.revoked, updatedBy: actor.userId } },
    { upsert: true, new: true },
  );
  setRoleTemplateOverrides({ ...getRoleTemplateOverrides(), [role]: next });
  const shape = await shapeOf(role);
  await writeAudit({
    eventKind: "ROLE_TEMPLATE_CHANGED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetKind: "RoleTemplate",
    meta: {
      role,
      change,
      ...extraMeta,
      prior: { granted: clean(prior.granted), revoked: clean(prior.revoked) },
      next,
      affectedUsers: shape.userCount,
    },
  });
  return shape;
}

/** Switch one catalogue action on or off for a whole role. Setting it back to the code
 *  default leaves no trace in the delta (on/off is always relative to the default). */
export async function setRoleTemplatePermission(
  actor: AccessActor,
  role: string,
  permission: string,
  enabled: boolean,
): Promise<RoleTemplateShape> {
  assertEditableRole(role);
  assertSwitchable(permission);
  const current = getRoleTemplateOverrides()[role] ?? { granted: [], revoked: [] };
  const granted = new Set(clean(current.granted));
  const revoked = new Set(clean(current.revoked));
  const byDefault = CATALOGUE_ROLE_DEFAULTS[role].includes(permission);
  granted.delete(permission);
  revoked.delete(permission);
  if (enabled && !byDefault) granted.add(permission);
  if (!enabled && byDefault) revoked.add(permission);
  return writeDelta(
    actor,
    role,
    enabled ? "enable" : "disable",
    { granted: [...granted].sort(), revoked: [...revoked].sort() },
    { permission },
  );
}

/** Put a whole role back to the code default. */
export async function resetRoleTemplate(actor: AccessActor, role: string): Promise<RoleTemplateShape> {
  assertEditableRole(role);
  return writeDelta(actor, role, "reset", { granted: [], revoked: [] }, {});
}
