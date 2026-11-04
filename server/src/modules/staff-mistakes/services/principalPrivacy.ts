/**
 * A Principal's own mistake entries are private (D-#968, owner 2026-11-04): only a holder of
 * `staff_mistakes:review_principal` (PRINCIPAL_DEFAULT — the Principal) sees, decides or moves
 * them, handles the Principal's warning meetings, or moves an entry onto a Principal; the
 * Principal's warnings are told only to those holders. A Principal holding it may decide their
 * own entry — the one exception to "nobody decides their own".
 *
 * Whose entries are protected is a target guard on the stored primary role (PRINCIPAL is never
 * an additional template); who may handle them is the catalogue action (D-#799).
 */
import { User } from "../../foundation/models/User";
import { holderIdsOf } from "../../access-control/services/holders";

export const PRINCIPAL_REVIEW = "staff_mistakes:review_principal" as const;

/** Active Principal accounts, as id strings. */
export async function principalUserIds(): Promise<string[]> {
  const rows = await User.find({ role: "PRINCIPAL", active: true }).select("_id").lean();
  return rows.map((r) => String(r._id));
}

/** The people whose entries this caller may not see: [] for a holder of the action. */
export async function hiddenOwnersFor(mayHandlePrincipal: boolean): Promise<string[]> {
  return mayHandlePrincipal ? [] : principalUserIds();
}

export async function ownedByPrincipal(userId: string): Promise<boolean> {
  return (await principalUserIds()).includes(userId);
}

/** Staff notified about `ownerId`'s warning: for a Principal, only other holders of the action. */
export async function warningAudience(ids: string[], ownerId: string): Promise<string[]> {
  const others = ids.filter((id) => id !== ownerId);
  if (!(await ownedByPrincipal(ownerId))) return others;
  const allowed = new Set(await holderIdsOf(PRINCIPAL_REVIEW));
  return others.filter((id) => allowed.has(id));
}
