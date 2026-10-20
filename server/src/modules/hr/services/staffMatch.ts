/**
 * staffMatch (HR-2) — the User ⇄ StaffProfile bridge.
 *
 * There is NO stored FK between `User` (auth identity) and `StaffProfile` (HR
 * record): provisioning (D-#60) links them by phone (User.phone ===
 * normalizePhone(StaffProfile.phone)). HR-2 reuses that exact join rather than
 * backfilling a userId field (a bulk write against the shared live Atlas is barred
 * by worktree rule 3, and no migration is needed). This is the build ruling behind
 * own-row teacher self-service (a teacher applies for their OWN leave with no new
 * permission) and behind cover fan-out (the absent StaffProfile → its User id → the
 * teaching ScopeGrants that name the classes to cover).
 *
 * D-#788: EMAIL is the fallback key when the phone finds no one. A teacher whose
 * mobile already carries her guardian login (one phone, one User — sparse-unique)
 * logs in by email, and phone-only matching left her with no leave, payslip or
 * cover routing (prod 2026-10-20, 20166). Same fail-closed rule as the phone: one
 * match only. A GUARDIAN login never stands in for a staff member, either way.
 * Support staff (no login) still never self-resolve.
 */
import { normalizePhone } from "../../foundation/services/credentials";
import { User } from "../../foundation/models/User";
import { StaffProfile, type IStaffProfile } from "../../foundation/models/StaffProfile";

/** User.email is stored lowercased + trimmed; StaffProfile.email is only trimmed. */
function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** The covering/absent teacher's User id for a StaffProfile (proxy/grant key). */
export async function resolveUserIdForStaff(staffProfileId: string): Promise<string | null> {
  const staff = (await StaffProfile.findById(staffProfileId).select("phone email").lean()) as {
    phone?: string | null;
    email?: string | null;
  } | null;
  if (!staff) return null;
  // Never a GUARDIAN: a teacher-parent's guardian login can sit on the same phone, and
  // cover fan-out must not land on it.
  const notGuardian = { active: true, role: { $ne: "GUARDIAN" } };
  if (staff.phone) {
    const user = await User.findOne({ phone: normalizePhone(staff.phone), ...notGuardian })
      .select("_id")
      .lean();
    if (user) return user._id.toString();
  }
  const email = normalizeEmail(staff.email);
  if (email) {
    const user = await User.findOne({ email, ...notGuardian }).select("_id").lean();
    if (user) return user._id.toString();
  }
  return null;
}

/** The StaffProfile behind a logged-in User (own-row self-service). Phone first, then
 *  email (D-#788); the live roster is small so the normalized compare is done in app. */
export async function resolveStaffProfileForUser(userId: string): Promise<IStaffProfile | null> {
  const user = (await User.findById(userId).select("phone email role").lean()) as {
    phone?: string | null;
    email?: string | null;
    role?: string;
  } | null;
  if (!user || user.role === "GUARDIAN") return null;

  if (user.phone) {
    const candidates = await StaffProfile.find({ active: true, phone: { $ne: null } }).lean();
    const matches = candidates.filter((s) => s.phone && normalizePhone(s.phone) === user.phone);
    // Fail CLOSED on an ambiguous phone: User.phone is sparse-unique (the auth side
    // is 1:1), but StaffProfile carries no unique phone constraint (the HR-2 RBAC
    // ruling adds no index/migration). If two active StaffProfiles share the caller's
    // phone the join can't say which is theirs — deny self-service rather than
    // silently resolve to the wrong record (an own-row masquerade). One match only.
    // An ambiguous phone is a refusal, not a cue to try the email.
    if (matches.length === 1) return matches[0] as unknown as IStaffProfile;
    if (matches.length > 1) return null;
  }

  const email = normalizeEmail(user.email);
  if (!email) return null;
  const candidates = await StaffProfile.find({ active: true, email: { $nin: [null, ""] } }).lean();
  const matches = candidates.filter((s) => normalizeEmail(s.email) === email);
  // The same one-match rule: StaffProfile.email is not unique either.
  if (matches.length !== 1) return null;
  return matches[0] as unknown as IStaffProfile;
}
