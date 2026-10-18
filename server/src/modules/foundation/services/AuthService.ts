import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Guardian } from "../models/Guardian";
import { writeAudit } from "../../platform/services/AuditService";
import type { Role, Permission } from "@scd/shared";
import {
  ACCOUNT_FAIL_LIMIT,
  IP_FAIL_LIMIT,
  LoginBlockedError,
  accountKey,
  assertLoginAllowed,
  clearAccountThrottle,
  ipKey,
  recordLoginFailure,
  type LoginAccountKind,
} from "./LoginThrottleService";

const SALT_ROUNDS = 12;

type LoginFailAudit = Omit<Parameters<typeof writeAudit>[0], "eventKind" | "meta"> & { meta?: Record<string, unknown> };

/** The lockout gate (D-#765): a blocked key is refused AND recorded as a LOGIN_FAIL. */
async function assertNotBlocked(key: string, ip: string | null, audit: LoginFailAudit): Promise<void> {
  try {
    await assertLoginAllowed(key);
  } catch (err) {
    if (err instanceof LoginBlockedError) {
      await writeAudit({
        ...audit,
        eventKind: "LOGIN_FAIL",
        meta: { ...audit.meta, reason: key.startsWith("ip:") ? "ip_blocked" : "account_blocked", ip },
      });
    }
    throw err;
  }
}

/** Count a wrong password against the account and the network (D-#765). */
async function countWrongPassword(kind: LoginAccountKind, id: string, ip: string | null): Promise<boolean> {
  const locked = await recordLoginFailure(accountKey(kind, id), ACCOUNT_FAIL_LIMIT);
  if (ip) await recordLoginFailure(ipKey(ip), IP_FAIL_LIMIT);
  return locked;
}

export interface AuthTokenPayload {
  userId: string;
  role: Role;
  /** Per-user access overrides (AC-1, D-#193/#211) — baked into the staff token so the
   *  resolver seam (`callerHasPermission`) sees them. Absent on a pre-AC / GUARDIAN token
   *  ⇒ identical-to-today. A grant/revoke change applies on the user's next login (re-mint). */
  additionalTemplates?: Role[];
  grantedPermissions?: Permission[];
  revokedPermissions?: Permission[];
  /** "View as" (VA-1, D-#638): the Principal behind a borrowed token. Never set at login. */
  impersonatorId?: string;
  impersonatorRole?: Role;
}

/**
 * A login session lasts this long, and every app open re-mints it (`refreshSession`), so
 * a person stays signed in as long as they open the app at least once in the window
 * (owner 2026-10-02, D-#708 — was 8h, which signed everyone out daily). The refresh
 * re-reads the account, so deactivation and access changes take effect on the next open.
 */
export const SESSION_TTL: jwt.SignOptions["expiresIn"] = "30d";

/** Mint a session token. `expiresIn` is the ordinary session unless a caller shortens it —
 *  a borrowed "View as" token is deliberately short-lived (ImpersonationService). */
export function signToken(
  payload: AuthTokenPayload,
  expiresIn: jwt.SignOptions["expiresIn"] = SESSION_TTL,
): string {
  const secret = process.env.JWT_SECRET ?? "dev-secret";
  return jwt.sign(payload, secret, { expiresIn });
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
  /** The caller's address, for the network lockout (D-#765). Absent ⇒ that rule is skipped. */
  ip?: string | null;
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
  const ip = input.ip ?? null;
  if (ip) await assertNotBlocked(ipKey(ip), ip, { meta: { identifier: id } });
  const user = await User.findOne({
    $or: [{ email: id.toLowerCase() }, { phone: { $in: phoneCandidates(id) } }],
    active: true,
  });
  if (!user) {
    await writeAudit({ eventKind: "LOGIN_FAIL", meta: { identifier: id, reason: "user_not_found" } });
    return null;
  }

  // Before the password check: a blocked account is refused even with the right password.
  await assertNotBlocked(accountKey("User", user._id.toString()), ip, { actorId: user._id, actorRole: user.role });
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const lockedOut = await countWrongPassword("User", user._id.toString(), ip);
    await writeAudit({ eventKind: "LOGIN_FAIL", actorId: user._id, actorRole: user.role, meta: { reason: "bad_password", ip, lockedOut } });
    return null;
  }

  await clearAccountThrottle("User", user._id.toString());
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

/**
 * Re-mint the caller's session (D-#708) — called by the app on every open. Takes the
 * already-verified token payload; returns null (the app then signs out) when the account
 * is gone, deactivated, or a guardian whose login was disabled. Re-reads the account's
 * CURRENT role and access overrides, so a change made since login lands now.
 * A "View as" (borrowed) token is never extended: it returns null and the app keeps the
 * short borrowed session it already has.
 */
export async function refreshSession(auth: AuthTokenPayload): Promise<AuthResult | null> {
  if (auth.impersonatorId) return null;
  if (auth.role === "GUARDIAN") {
    const guardian = await Guardian.findOne({ _id: auth.userId, active: true }).lean();
    if (!guardian || !guardian.loginEnabled || !guardian.passwordHash) return null;
    return {
      token: signToken({ userId: guardian._id.toString(), role: "GUARDIAN" }),
      userId: guardian._id.toString(),
      role: "GUARDIAN",
      name: guardian.name,
    };
  }
  const user = await User.findOne({ _id: auth.userId, active: true }).lean();
  if (!user) return null;
  return {
    token: signToken({
      userId: user._id.toString(),
      role: user.role,
      additionalTemplates: user.additionalTemplates ?? [],
      grantedPermissions: user.grantedPermissions ?? [],
      revokedPermissions: user.revokedPermissions ?? [],
    }),
    userId: user._id.toString(),
    role: user.role,
    name: user.name,
  };
}

export interface GuardianLoginInput {
  identifier: string;
  identifierKind: "email" | "phone" | "school_id";
  password: string;
  /** The caller's address, for the network lockout (D-#765). Absent ⇒ that rule is skipped. */
  ip?: string | null;
}

export async function guardianLogin(input: GuardianLoginInput): Promise<AuthResult | null> {
  const id = input.identifier.trim();
  const ip = input.ip ?? null;
  if (ip) await assertNotBlocked(ipKey(ip), ip, { meta: { kind: input.identifierKind } });
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

  await assertNotBlocked(accountKey("Guardian", guardian._id.toString()), ip, { actorId: guardian._id, actorRole: "GUARDIAN" });
  const ok = await verifyPassword(input.password, guardian.passwordHash);
  if (!ok) {
    const lockedOut = await countWrongPassword("Guardian", guardian._id.toString(), ip);
    await writeAudit({ eventKind: "LOGIN_FAIL", actorId: guardian._id, actorRole: "GUARDIAN", meta: { reason: "bad_password", ip, lockedOut } });
    return null;
  }

  await clearAccountThrottle("Guardian", guardian._id.toString());
  await writeAudit({ eventKind: "LOGIN_SUCCESS", actorId: guardian._id, actorRole: "GUARDIAN" });

  return {
    token: signToken({ userId: guardian._id.toString(), role: "GUARDIAN" }),
    userId: guardian._id.toString(),
    role: "GUARDIAN",
    name: guardian.name,
  };
}
