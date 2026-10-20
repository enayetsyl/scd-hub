/**
 * holdersOf (PM, docs/prd-permission-matrix.md §5.5, D-#796).
 *
 * "Who should be told" = every ACTIVE staff login that holds the action now — the role
 * template with the Principal's edits, plus each person's own grants and revokes. It
 * replaces recipient lists picked by role ("all OFFICE + PRINCIPAL"), so a teacher given
 * leave:approve is told a leave is waiting, and an Office login switched off is not.
 * With default switches the recipients are the same people as before.
 *
 * Staff only: a guardian never holds a catalogue action. Identity plane; no corpus path.
 */
import { callerHasPermission, type Permission, type Role } from "@scd/shared";
import { User } from "../../foundation/models/User";

export interface PermissionHolder {
  _id: { toString(): string };
  name: string;
  role: Role;
}

/** Active staff logins holding `permission`, in name order. */
export async function holdersOf(permission: Permission): Promise<PermissionHolder[]> {
  const users = await User.find({ active: true, role: { $ne: "GUARDIAN" } })
    .select("name role additionalTemplates grantedPermissions revokedPermissions")
    .sort({ name: 1 })
    .lean();
  return users
    .filter((u) =>
      callerHasPermission(
        {
          role: u.role,
          additionalTemplates: u.additionalTemplates ?? [],
          grantedPermissions: u.grantedPermissions ?? [],
          revokedPermissions: u.revokedPermissions ?? [],
        },
        permission,
      ),
    )
    .map((u) => ({ _id: u._id, name: u.name, role: u.role }));
}

/** The holders' user ids as strings — the shape most emitters want. */
export async function holderIdsOf(permission: Permission): Promise<string[]> {
  return (await holdersOf(permission)).map((u) => u._id.toString());
}
