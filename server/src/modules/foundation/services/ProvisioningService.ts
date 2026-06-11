import type { HrCategory, Role } from "@scd/shared";
import { Student } from "../models/Student";
import { Class } from "../models/Class";
import { Guardian } from "../models/Guardian";
import { GuardianLink } from "../models/GuardianLink";
import { User } from "../models/User";
import { StaffProfile } from "../models/StaffProfile";
import { hashPassword } from "./AuthService";
import { generatePassword, normalizePhone, buildCredentialShareLink } from "./credentials";
import { writeAudit } from "../../platform/services/AuditService";

/**
 * Login provisioning (D-#59 guardians, D-#60 staff).
 *
 * Guardians: one login per FAMILY, keyed by the family's primary contact phone
 * (Student.phone). Both parents share it; it auto-links to every active student
 * on that phone, so it reaches all siblings. Re-running resets the password and
 * picks up any new siblings — never duplicates a link.
 *
 * Staff: a phone-identified User minted from a StaffProfile, with the role mapped
 * from the HR category. Support staff (no app login, D-#25) and phoneless staff
 * are flagged not-provisionable.
 *
 * Passwords are auto-generated and returned in plaintext ONCE; only the bcrypt
 * hash is persisted. Identity-plane only — no corpus path (ADR-005 unaffected).
 */

export interface ProvisionedCredential {
  identifier: string;
  identifierKind: "phone" | "email";
  /** Plaintext, shown once — never stored. */
  password: string;
  name: string;
  /** Human label of what the login covers (e.g. "৩ জন শিক্ষার্থী" or the role). */
  contextLabel: string;
  studentCount: number;
  waLink: string;
  /** True when a login already existed (this call was a reset / re-provision). */
  alreadyExisted: boolean;
}

export interface GuardianCandidate {
  phone: string;
  suggestedName: string;
  students: Array<{ id: string; name: string; className: string }>;
  loginExists: boolean;
  loginEnabled: boolean;
  guardianId: string | null;
}

export interface StaffCandidate {
  staffId: string;
  name: string;
  category: string;
  phone: string | null;
  mappedRole: Role | null;
  provisionable: boolean;
  reason: string | null;
  loginExists: boolean;
  userId: string | null;
}

export interface Actor {
  userId?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// HR category → auth role (D-#60). Support has no login (D-#25).
// ---------------------------------------------------------------------------
export function roleForCategory(category: HrCategory): Role | null {
  switch (category) {
    case "teacher":
    case "assistant_hifz":
      return "TEACHER";
    case "office_accounts":
      return "OFFICE";
    case "support":
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

export async function guardianCredentialCandidates(): Promise<GuardianCandidate[]> {
  const students = await Student.find({ active: true }).lean();

  // Group active students by normalized primary-contact phone.
  const byPhone = new Map<string, Array<(typeof students)[number]>>();
  for (const s of students) {
    if (!s.phone) continue;
    const p = normalizePhone(s.phone);
    if (!p) continue;
    const list = byPhone.get(p) ?? [];
    list.push(s);
    byPhone.set(p, list);
  }

  // Class names for display.
  const classIds = [...new Set(students.map((s) => s.classId?.toString()).filter(Boolean))];
  const classes = await Class.find({ _id: { $in: classIds } }).lean();
  const classNameById = new Map(classes.map((c) => [c._id.toString(), c.nameBn]));

  // Existing phone-keyed guardian logins.
  const phones = [...byPhone.keys()];
  const guardians = await Guardian.find({ identifierKind: "phone", identifier: { $in: phones } }).lean();
  const guardianByPhone = new Map(guardians.map((g) => [g.identifier, g]));

  const out: GuardianCandidate[] = [];
  for (const [phone, list] of byPhone) {
    const g = guardianByPhone.get(phone);
    out.push({
      phone,
      suggestedName: g?.name ?? `${list[0].name} এর অভিভাবক`,
      students: list.map((s) => ({
        id: s._id.toString(),
        name: s.name,
        className: (s.classId && classNameById.get(s.classId.toString())) || "",
      })),
      loginExists: !!g,
      loginEnabled: !!g?.loginEnabled,
      guardianId: g ? g._id.toString() : null,
    });
  }
  // Most students first (the families that matter most), then by phone.
  out.sort((a, b) => b.students.length - a.students.length || a.phone.localeCompare(b.phone));
  return out;
}

export async function provisionGuardianLogin(phoneRaw: string, actor: Actor): Promise<ProvisionedCredential> {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw new Error("A phone number is required");

  const all = await Student.find({ active: true }).lean();
  const students = all.filter((s) => s.phone && normalizePhone(s.phone) === phone);
  if (students.length === 0) {
    throw new Error(`No active students found for phone ${phone}`);
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  let guardian = await Guardian.findOne({ identifierKind: "phone", identifier: phone });
  let alreadyExisted = false;
  if (guardian) {
    alreadyExisted = guardian.loginEnabled === true;
    guardian.passwordHash = passwordHash;
    guardian.loginEnabled = true;
    if (!guardian.phone) guardian.phone = phone;
    await guardian.save();
  } else {
    guardian = await Guardian.create({
      name: `${students[0].name} এর অভিভাবক`,
      identifierKind: "phone",
      identifier: phone,
      phone,
      passwordHash,
      loginEnabled: true,
    });
  }

  // Link to every sibling on this phone (idempotent — skip existing).
  for (const s of students) {
    const exists = await GuardianLink.findOne({ guardianId: guardian._id, studentId: s._id }).lean();
    if (!exists) {
      await GuardianLink.create({ guardianId: guardian._id, studentId: s._id, relation: "Guardian" });
    }
  }

  await writeAudit({
    eventKind: "CREDENTIAL_PROVISIONED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: guardian._id,
    targetKind: "Guardian",
    meta: { audience: "guardian", action: alreadyExisted ? "reset" : "provision", phone, studentCount: students.length },
  });

  return {
    identifier: phone,
    identifierKind: "phone",
    password,
    name: guardian.name,
    contextLabel: `${students.length} জন শিক্ষার্থী`,
    studentCount: students.length,
    waLink: buildCredentialShareLink({ toPhone: phone, identifier: phone, password, name: guardian.name, audience: "guardian" }),
    alreadyExisted,
  };
}

export async function resetGuardianPassword(guardianId: string, actor: Actor): Promise<ProvisionedCredential> {
  const guardian = await Guardian.findById(guardianId);
  if (!guardian) throw new Error("Guardian not found");
  if (guardian.identifierKind !== "phone") throw new Error("Only phone-login guardians are managed here");

  const password = generatePassword();
  guardian.passwordHash = await hashPassword(password);
  guardian.loginEnabled = true;
  await guardian.save();

  const studentCount = await GuardianLink.countDocuments({ guardianId: guardian._id });

  await writeAudit({
    eventKind: "CREDENTIAL_PROVISIONED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: guardian._id,
    targetKind: "Guardian",
    meta: { audience: "guardian", action: "reset", phone: guardian.identifier },
  });

  return {
    identifier: guardian.identifier,
    identifierKind: "phone",
    password,
    name: guardian.name,
    contextLabel: `${studentCount} জন শিক্ষার্থী`,
    studentCount,
    waLink: buildCredentialShareLink({ toPhone: guardian.identifier, identifier: guardian.identifier, password, name: guardian.name, audience: "guardian" }),
    alreadyExisted: true,
  };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export async function staffCredentialCandidates(): Promise<StaffCandidate[]> {
  const staff = await StaffProfile.find({ active: true }).sort({ category: 1, name: 1 }).lean();

  const phones = staff.map((s) => (s.phone ? normalizePhone(s.phone) : "")).filter(Boolean);
  const users = await User.find({ phone: { $in: phones } }).lean();
  const userByPhone = new Map(users.map((u) => [u.phone as string, u]));

  return staff.map((s) => {
    const phone = s.phone ? normalizePhone(s.phone) : null;
    const mappedRole = roleForCategory(s.category);
    const user = phone ? userByPhone.get(phone) : undefined;
    let reason: string | null = null;
    if (!mappedRole) reason = "সাপোর্ট স্টাফের অ্যাপ লগইন নেই";
    else if (!phone) reason = "ফোন নম্বর নেই";
    return {
      staffId: s._id.toString(),
      name: s.name,
      category: s.category,
      phone,
      mappedRole,
      provisionable: !!mappedRole && !!phone,
      reason,
      loginExists: !!user,
      userId: user ? user._id.toString() : null,
    };
  });
}

export async function provisionStaffLogin(staffProfileId: string, actor: Actor): Promise<ProvisionedCredential> {
  const staff = await StaffProfile.findById(staffProfileId);
  if (!staff) throw new Error("Staff profile not found");

  const role = roleForCategory(staff.category);
  if (!role) throw new Error("Support staff have no app login (D-#25)");
  if (!staff.phone) throw new Error("Staff has no phone number to use as a login id");
  const phone = normalizePhone(staff.phone);

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  let user = await User.findOne({ phone });
  let alreadyExisted = false;
  if (user) {
    alreadyExisted = true;
    user.passwordHash = passwordHash;
    user.active = true;
    if (!user.name) user.name = staff.name;
    await user.save();
  } else {
    user = await User.create({ phone, name: staff.name, role, passwordHash, active: true });
  }

  await writeAudit({
    eventKind: "CREDENTIAL_PROVISIONED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: user._id,
    targetKind: "User",
    meta: { audience: "staff", action: alreadyExisted ? "reset" : "provision", phone, role: user.role, staffId: staff._id.toString() },
  });

  return {
    identifier: phone,
    identifierKind: "phone",
    password,
    name: staff.name,
    contextLabel: user.role,
    studentCount: 0,
    waLink: buildCredentialShareLink({ toPhone: phone, identifier: phone, password, name: staff.name, audience: "staff" }),
    alreadyExisted,
  };
}

export async function resetStaffPassword(userId: string, actor: Actor): Promise<ProvisionedCredential> {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");
  if (!user.phone) throw new Error("Only phone-login staff are managed here");

  const password = generatePassword();
  user.passwordHash = await hashPassword(password);
  user.active = true;
  await user.save();

  await writeAudit({
    eventKind: "CREDENTIAL_PROVISIONED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: user._id,
    targetKind: "User",
    meta: { audience: "staff", action: "reset", phone: user.phone, role: user.role },
  });

  return {
    identifier: user.phone,
    identifierKind: "phone",
    password,
    name: user.name,
    contextLabel: user.role,
    studentCount: 0,
    waLink: buildCredentialShareLink({ toPhone: user.phone, identifier: user.phone, password, name: user.name, audience: "staff" }),
    alreadyExisted: true,
  };
}
