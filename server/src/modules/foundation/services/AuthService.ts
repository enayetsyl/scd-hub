import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Guardian } from "../models/Guardian";
import { writeAudit } from "../../platform/services/AuditService";
import type { Role, Permission } from "@scd/shared";

const SALT_ROUNDS = 12;

export interface AuthTokenPayload {
  userId: string;
  role: Role;
  /** Per-user access overrides (AC-1, D-#193/#211) — baked into the staff token so the
   *  resolver seam (`callerHasPermission`) sees them. Absent on a pre-AC / GUARDIAN token
   *  ⇒ identical-to-today. A grant/revoke change applies on the user's next login (re-mint). */
  additionalTemplates?: Role[];
  grantedPermissions?: Permission[];
  revokedPermissions?: Permission[];
}

function signToken(payload: AuthTokenPayload): string {
  const secret = process.env.JWT_SECRET ?? "dev-secret";
  return jwt.sign(payload, secret, { expiresIn: "8h" });
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Phone-format tolerance (D-#315)
// ---------------------------------------------------------------------------

/**
 * Every equivalent spelling of one Bangladeshi mobile number: `01…`, `+8801…`,
 * `8801…` (spaces/dashes stripped). Stored phones are a mix of these formats
 * (roster imports vs app-created), so login matches ANY spelling of the same
 * number. A non-BD-mobile-shaped input returns just its trimmed self —
 * behavior for emails/foreign numbers is unchanged.
 */
export function phoneCandidates(raw: string): string[] {
  const id = raw.trim().replace(/[\s-]/g, "");
  let local: string | null = null;
  if (/^\+8801\d{9}$/.test(id)) local = id.slice(3);
  else if (/^8801\d{9}$/.test(id)) local = id.slice(2);
  else if (/^01\d{9}$/.test(id)) local = id;
  if (!local) return [raw.trim()];
  return [local, `+88${local}`, `88${local}`];
}

// ---------------------------------------------------------------------------
// Staff login (identifier = email OR phone, + password, D-#5/#60)
// ---------------------------------------------------------------------------

export interface StaffLoginInput {
  /** Email or phone — the arg is still named `email` for backward compat (D-#60). */
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  userId: string;
  role: Role;
  name: string;
}

export async function staffLogin(input: StaffLoginInput): Promise<AuthResult | null> {
  // Accept either an email (case-insensitive) or a phone number as the identifier
  // (D-#60); any equivalent phone spelling matches (01…/+8801…/8801…, D-#315).
  const id = input.email.trim();
  const user = await User.findOne({
    $or: [{ email: id.toLowerCase() }, { phone: { $in: phoneCandidates(id) } }],
    active: true,
  });
  if (!user) {
    await writeAudit({ eventKind: "LOGIN_FAIL", meta: { identifier: id, reason: "user_not_found" } });
    return null;
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    await writeAudit({ eventKind: "LOGIN_FAIL", actorId: user._id, actorRole: user.role, meta: { reason: "bad_password" } });
    return null;
  }

  await writeAudit({ eventKind: "LOGIN_SUCCESS", actorId: user._id, actorRole: user.role });

  return {
    token: signToken({
      userId: user._id.toString(),
      role: user.role,
      // Per-user access overrides (AC-1, D-#193/#211). Empty ⇒ identical-to-today.
      additionalTemplates: user.additionalTemplates ?? [],
      grantedPermissions: user.grantedPermissions ?? [],
      revokedPermissions: user.revokedPermissions ?? [],
    }),
    userId: user._id.toString(),
    role: user.role,
    name: user.name,
  };
}

// ---------------------------------------------------------------------------
// Guardian login (flexible identifier: email | phone | school_id, D-#9)
// ---------------------------------------------------------------------------

export interface GuardianLoginInput {
  identifier: string;
  identifierKind: "email" | "phone" | "school_id";
  password: string;
}

export async function guardianLogin(input: GuardianLoginInput): Promise<AuthResult | null> {
  const id = input.identifier.trim();
  const guardian = await Guardian.findOne({
    identifierKind: input.identifierKind,
    // Phone identifiers match any equivalent spelling (01…/+8801…/8801…, D-#315).
    identifier: input.identifierKind === "phone" ? { $in: phoneCandidates(id) } : id,
    active: true,
  });

  if (!guardian) {
    await writeAudit({ eventKind: "LOGIN_FAIL", meta: { reason: "guardian_not_found", kind: input.identifierKind } });
    return null;
  }

  // Contact-only guardians imported from the roster have no password and cannot log in (D-#31).
  if (!guardian.loginEnabled || !guardian.passwordHash) {
    await writeAudit({ eventKind: "LOGIN_FAIL", actorId: guardian._id, actorRole: "GUARDIAN", meta: { reason: "login_disabled" } });
    return null;
  }

  const ok = await verifyPassword(input.password, guardian.passwordHash);
  if (!ok) {
    await writeAudit({ eventKind: "LOGIN_FAIL", actorId: guardian._id, actorRole: "GUARDIAN", meta: { reason: "bad_password" } });
    return null;
  }

  await writeAudit({ eventKind: "LOGIN_SUCCESS", actorId: guardian._id, actorRole: "GUARDIAN" });

  return {
    token: signToken({ userId: guardian._id.toString(), role: "GUARDIAN" }),
    userId: guardian._id.toString(),
    role: "GUARDIAN",
    name: guardian.name,
  };
}
