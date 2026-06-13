/**
 * staffMatch (HR-2) — the User ⇄ StaffProfile bridge.
 *
 * There is NO stored FK between `User` (auth identity) and `StaffProfile` (HR
 * record): provisioning (D-#60) links them ONLY by phone (User.phone ===
 * normalizePhone(StaffProfile.phone)). HR-2 reuses that exact join rather than
 * backfilling a userId field (a bulk write against the shared live Atlas is barred
 * by worktree rule 3, and no migration is needed). This is the build ruling behind
 * own-row teacher self-service (a teacher applies for their OWN leave with no new
 * permission) and behind cover fan-out (the absent StaffProfile → its User id → the
 * teaching ScopeGrants that name the classes to cover).
 *
 * Phone-only by design: support staff (no login) never self-resolve; an email-login
 * admin uses the leave:manage surface, not self-apply.
 */
import { normalizePhone } from "../../foundation/services/credentials";
import { User } from "../../foundation/models/User";
import { StaffProfile, type IStaffProfile } from "../../foundation/models/StaffProfile";

/** The covering/absent teacher's User id for a StaffProfile (proxy/grant key). */
export async function resolveUserIdForStaff(staffProfileId: string): Promise<string | null> {
  const staff = await StaffProfile.findById(staffProfileId).select("phone").lean();
  if (!staff?.phone) return null;
  const user = await User.findOne({ phone: normalizePhone(staff.phone), active: true })
    .select("_id")
    .lean();
  return user ? user._id.toString() : null;
}

/** The StaffProfile behind a logged-in User (own-row self-service). Phone-keyed;
 *  the live roster is small so the normalized compare is done in app. */
export async function resolveStaffProfileForUser(userId: string): Promise<IStaffProfile | null> {
  const user = await User.findById(userId).select("phone").lean();
  if (!user?.phone) return null;
  const candidates = await StaffProfile.find({ active: true, phone: { $ne: null } }).lean();
  return (
    (candidates.find((s) => s.phone && normalizePhone(s.phone) === user.phone) as IStaffProfile | undefined) ??
    null
  );
}
