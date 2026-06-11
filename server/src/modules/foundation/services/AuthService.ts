import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { Guardian } from "../models/Guardian";
import { writeAudit } from "../../platform/services/AuditService";
import type { Role } from "@scd/shared";

const SALT_ROUNDS = 12;

export interface AuthTokenPayload {
  userId: string;
  role: Role;
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
  // Accept either an email (case-insensitive) or a phone number as the identifier (D-#60).
  const id = input.email.trim();
  const user = await User.findOne({
    $or: [{ email: id.toLowerCase() }, { phone: id }],
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
    token: signToken({ userId: user._id.toString(), role: user.role }),
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
  const guardian = await Guardian.findOne({
    identifierKind: input.identifierKind,
    identifier: input.identifier.trim(),
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
