/**
 * AccessControlService (AC-1, prd-access-control §4/§5/§6, D-#193/#210–#215) — the
 * per-user access editor over the three additive `User` fields. The Principal (gated
 * `access:manage`) tunes a staff member's effective permissions WITHOUT minting roles:
 *
 *   setAdditionalTemplates  — set/clear the extra role templates a user holds. Only
 *                             ASSIGNABLE_TEMPLATES (TEACHER/OFFICE) accepted (J-AC2).
 *   addGrantedPermission    — per-user ADD. A RESERVED-locked perm is REJECTED at write
 *   removeGrantedPermission   time (Bangla); `guardian:read_child` is a guardian-plane
 *                             perm, ungrantable to a staff User (the guardian wall, J-AC4).
 *   addRevokedPermission    — per-user REMOVE. A revoke always wins (no reserved guard —
 *   removeRevokedPermission   revoke is purely subtractive).
 *   effectiveUserAccess     — the read for the AC-2 screen: the raw arrays + the derived
 *                             effective set (via the shared `effectivePermissions` seam).
 *
 * Every mutation captures PRIOR + NEW {templates, granted, revoked} into one
 * `USER_ACCESS_CHANGED` audit row (ADR-008 / D-#101 prior-state pattern). The actual
 * grant CHECK at every gate runs through the shared `callerHasPermission`; this service
 * only governs what those three arrays hold. Row-scope is a SEPARATE axis (ADR-004) — a
 * per-user grant never widens which sections a teacher reaches.
 *
 * Identity/operational plane (the fields live on the staff `User`); NO corpus path (ADR-005).
 */
import {
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ASSIGNABLE_TEMPLATES,
  effectivePermissions,
  type Role,
  type Permission,
} from "@scd/shared";
import { User, type IUser } from "../../foundation/models/User";
import { writeAudit } from "../../platform/services/AuditService";

/** A write-time rejection surfaced to the caller as a Bangla message (the "422" shape). */
export class AccessControlError extends Error {}

export interface AccessActor {
  userId: string;
  role: string;
}

export interface UserAccessSnapshot {
  additionalTemplates: Role[];
  grantedPermissions: Permission[];
  revokedPermissions: Permission[];
}

export interface UserAccessShape extends UserAccessSnapshot {
  userId: string;
  role: Role;
  /** The derived set (sorted) the AC-2 screen renders — the shared seam, never stored. */
  effectivePermissions: Permission[];
}

const RESERVED_SET = new Set<Permission>(RESERVED_PERMISSIONS);
const ASSIGNABLE_SET = new Set<Role>(ASSIGNABLE_TEMPLATES);
const PERMISSION_SET = new Set<string>(PERMISSIONS);

function snapshot(user: IUser): UserAccessSnapshot {
  return {
    additionalTemplates: [...(user.additionalTemplates ?? [])],
    grantedPermissions: [...(user.grantedPermissions ?? [])],
    revokedPermissions: [...(user.revokedPermissions ?? [])],
  };
}

/** Load the target staff User. The model governs the staff User ONLY — a GUARDIAN is a
 *  walled-off login plane (a different collection), so a guardian id never resolves here;
 *  the explicit role guard is the belt-and-braces (J-AC4). */
async function loadStaffUser(userId: string): Promise<IUser> {
  const user = await User.findById(userId);
  if (!user) throw new AccessControlError("ব্যবহারকারী পাওয়া যায়নি");
  if (user.role === "GUARDIAN") {
    throw new AccessControlError("অভিভাবক অ্যাকাউন্টে স্টাফ অনুমতি প্রযোজ্য নয়");
  }
  return user;
}

/** Validate a permission a Principal is trying to GRANT to a staff user. Reserved-locked
 *  ⇒ rejected (Principal-only); guardian:read_child ⇒ rejected (guardian-plane, J-AC4). */
function assertGrantable(perm: string): asserts perm is Permission {
  if (!PERMISSION_SET.has(perm)) {
    throw new AccessControlError(`অজানা অনুমতি: ${perm}`);
  }
  if (RESERVED_SET.has(perm as Permission)) {
    throw new AccessControlError(`সংরক্ষিত অনুমতি “${perm}” কোনো ব্যবহারকারীকে বরাদ্দ করা যায় না (শুধু অধ্যক্ষ)`);
  }
  if (perm === "guardian:read_child") {
    throw new AccessControlError("অভিভাবক-প্লেনের অনুমতি স্টাফ ব্যবহারকারীকে দেওয়া যায় না");
  }
}

function assertKnownPermission(perm: string): asserts perm is Permission {
  if (!PERMISSION_SET.has(perm)) {
    throw new AccessControlError(`অজানা অনুমতি: ${perm}`);
  }
}

/** The shared apply→audit wrapper: load, snapshot prior, mutate, save, audit prior+new. */
async function applyAccessChange(
  actor: AccessActor,
  userId: string,
  change: string,
  mutate: (user: IUser) => void,
  extraMeta: Record<string, unknown> = {},
): Promise<UserAccessShape> {
  const user = await loadStaffUser(userId);
  const prior = snapshot(user);
  mutate(user);
  await user.save();
  const next = snapshot(user);

  await writeAudit({
    eventKind: "USER_ACCESS_CHANGED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: user._id,
    targetKind: "User",
    meta: { change, ...extraMeta, prior, next },
  });

  return toShape(user);
}

function toShape(user: IUser): UserAccessShape {
  const snap = snapshot(user);
  const eff = effectivePermissions({
    role: user.role,
    additionalTemplates: snap.additionalTemplates,
    grantedPermissions: snap.grantedPermissions,
    revokedPermissions: snap.revokedPermissions,
  });
  return {
    userId: user._id.toString(),
    role: user.role,
    ...snap,
    effectivePermissions: [...eff].sort(),
  };
}

// ---------------------------------------------------------------------------
// Mutations (all gated `access:manage` at the resolver; Principal-only)
// ---------------------------------------------------------------------------

/** Set (or clear, with []) the additional role templates. Only TEACHER/OFFICE accepted. */
export async function setAdditionalTemplates(
  actor: AccessActor,
  userId: string,
  templates: string[],
): Promise<UserAccessShape> {
  for (const t of templates) {
    if (!ASSIGNABLE_SET.has(t as Role)) {
      throw new AccessControlError(
        `“${t}” একটি বরাদ্দযোগ্য টেমপ্লেট নয় (শুধু TEACHER/OFFICE)`,
      );
    }
  }
  const clean = [...new Set(templates)] as Role[];
  return applyAccessChange(actor, userId, "templates_set", (u) => {
    u.additionalTemplates = clean;
  });
}

/** Add a per-user granted permission (reserved-locked + guardian-plane perms rejected). */
export async function addGrantedPermission(
  actor: AccessActor,
  userId: string,
  permission: string,
): Promise<UserAccessShape> {
  assertGrantable(permission);
  return applyAccessChange(
    actor,
    userId,
    "grant_added",
    (u) => {
      u.grantedPermissions = [...new Set([...(u.grantedPermissions ?? []), permission as Permission])];
    },
    { permission },
  );
}

/** Remove a per-user granted permission (back to the template baseline for that perm). */
export async function removeGrantedPermission(
  actor: AccessActor,
  userId: string,
  permission: string,
): Promise<UserAccessShape> {
  assertKnownPermission(permission);
  return applyAccessChange(
    actor,
    userId,
    "grant_removed",
    (u) => {
      u.grantedPermissions = (u.grantedPermissions ?? []).filter((p) => p !== permission);
    },
    { permission },
  );
}

/** Add a per-user revoked permission (a revoke always wins over template + grant). */
export async function addRevokedPermission(
  actor: AccessActor,
  userId: string,
  permission: string,
): Promise<UserAccessShape> {
  assertKnownPermission(permission);
  return applyAccessChange(
    actor,
    userId,
    "revoke_added",
    (u) => {
      u.revokedPermissions = [...new Set([...(u.revokedPermissions ?? []), permission as Permission])];
    },
    { permission },
  );
}

/** Remove a per-user revoked permission (the perm may flow from a template/grant again). */
export async function removeRevokedPermission(
  actor: AccessActor,
  userId: string,
  permission: string,
): Promise<UserAccessShape> {
  assertKnownPermission(permission);
  return applyAccessChange(
    actor,
    userId,
    "revoke_removed",
    (u) => {
      u.revokedPermissions = (u.revokedPermissions ?? []).filter((p) => p !== permission);
    },
    { permission },
  );
}

// ---------------------------------------------------------------------------
// Read (gated `access:manage`) — the raw arrays + the derived effective set
// ---------------------------------------------------------------------------

export async function effectiveUserAccess(userId: string): Promise<UserAccessShape> {
  const user = await loadStaffUser(userId);
  return toShape(user);
}
