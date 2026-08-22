/**
 * StaffProfile writes — create + edit an HR staff record from the app (D-#526).
 *
 * Until now a StaffProfile could ONLY arrive through `server/scripts/import-staff.ts`,
 * a developer-run script against Atlas: `foundation/resolvers/staff.ts` exposed a query
 * and nothing else. So onboarding one new employee required a developer, and a login
 * could not be provisioned for them at all — `provisionStaffLogin` keys on a profile
 * (D-#60). This service closes that hole without touching the import path, which stays
 * the right tool for a bulk roster load.
 *
 * DELIBERATELY NOT HERE — pay. `monthlySalary` and `paymentMethod` live on the model but
 * are set through `setStaffPay` under `payroll:manage`, a different permission from
 * `staff:manage` (HR-3 §4.1). Accepting them here would let anyone who can fix a typo in
 * an address also set a salary, which is exactly the separation the two permissions exist
 * to keep. `update` therefore ignores them if sent.
 *
 * Identity plane, behind the ADR-005 firewall — no corpus path is added.
 */
import {
  HR_CATEGORIES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  type HrCategory,
  type EmploymentType,
  type EmploymentStatus,
} from "@scd/shared";
import { StaffProfile, type IStaffProfile } from "../models/StaffProfile";
import { writeAudit } from "../../platform/services/AuditService";

export class StaffProfileError extends Error {}

const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

/** Every field the app may write. Pay is absent on purpose (see the file header). */
export interface StaffProfileInput {
  schoolId?: string | null;
  name?: string | null;
  nameBn?: string | null;
  category?: string | null;
  designation?: string | null;
  employmentType?: string | null;
  employmentStatus?: string | null;
  joiningDate?: string | null;
  biometricId?: string | null;
  gender?: string | null;
  dob?: string | null;
  bloodGroup?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  qualification?: string | null;
  majoredIn?: string | null;
  studiedAt?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  spouseName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  presentAddress?: string | null;
  permanentAddress?: string | null;
  nid?: string | null;
  bankAccount?: string | null;
  active?: boolean | null;
}

/** Trim; empty string becomes undefined so a cleared field is UNSET, not stored blank. */
export function clean(v?: string | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * Phone digits, normalised the way `provisionStaffLogin` will read them back.
 *
 * The login id IS the phone (D-#60), so "01712-345678" and "+8801712345678" must not be
 * able to become two different staff members with two different logins for one person.
 */
export function normalizeStaffPhone(v?: string | null): string | undefined {
  const raw = clean(v);
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+880")) return digits;
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("0")) return `+88${digits}`;
  return digits;
}

/** A date the app sent as YYYY-MM-DD or an ISO string. Rejects nonsense rather than storing Invalid Date. */
export function parseDate(v?: string | null, field = "date"): Date | undefined {
  const raw = clean(v);
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new StaffProfileError(`${field} is not a valid date`);
  return d;
}

function assertEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new StaffProfileError(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

/** The patch a create/update applies, with every value already validated and normalised. */
export function buildPatch(input: StaffProfileInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => {
    if (v !== undefined) patch[k] = v;
  };

  put("schoolId", clean(input.schoolId));
  put("name", clean(input.name));
  put("nameBn", clean(input.nameBn));
  put("category", assertEnum(clean(input.category) as HrCategory | undefined, HR_CATEGORIES, "category"));
  put("designation", clean(input.designation));
  put("employmentType", assertEnum(clean(input.employmentType) as EmploymentType | undefined, EMPLOYMENT_TYPES, "employmentType"));
  put("employmentStatus", assertEnum(clean(input.employmentStatus) as EmploymentStatus | undefined, EMPLOYMENT_STATUSES, "employmentStatus"));
  put("joiningDate", parseDate(input.joiningDate, "joiningDate"));
  put("biometricId", clean(input.biometricId));
  put("gender", assertEnum(clean(input.gender) as Gender | undefined, GENDERS, "gender"));
  put("dob", parseDate(input.dob, "dob"));
  put("bloodGroup", clean(input.bloodGroup));
  put("maritalStatus", clean(input.maritalStatus));
  put("nationality", clean(input.nationality));
  put("qualification", clean(input.qualification));
  put("majoredIn", clean(input.majoredIn));
  put("studiedAt", clean(input.studiedAt));
  put("fatherName", clean(input.fatherName));
  put("motherName", clean(input.motherName));
  put("spouseName", clean(input.spouseName));
  put("phone", normalizeStaffPhone(input.phone));
  put("whatsapp", normalizeStaffPhone(input.whatsapp));
  put("email", clean(input.email)?.toLowerCase());
  put("presentAddress", clean(input.presentAddress));
  put("permanentAddress", clean(input.permanentAddress));
  put("nid", clean(input.nid));
  put("bankAccount", clean(input.bankAccount));
  if (typeof input.active === "boolean") patch.active = input.active;
  return patch;
}

/** Turn a duplicate-key write into a sentence the Principal can act on. */
function friendlyDuplicate(err: unknown): never {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code === 11000) {
    const field = Object.keys(e.keyPattern ?? {})[0] ?? "value";
    const label =
      field === "schoolId" ? "staff ID" : field === "biometricId" ? "biometric ID" : field;
    throw new StaffProfileError(`That ${label} already belongs to another staff member`);
  }
  throw err as Error;
}

export async function createStaffProfile(
  input: StaffProfileInput,
  actor: { userId: string; role: string },
): Promise<IStaffProfile> {
  const patch = buildPatch(input);

  // The four the model marks required. Checked here so the caller gets one clear message
  // per missing field instead of a Mongoose ValidationError blob.
  for (const [field, label] of [
    ["schoolId", "Staff ID"],
    ["name", "Name"],
    ["category", "Category"],
    ["employmentType", "Employment type"],
    ["employmentStatus", "Employment status"],
  ] as const) {
    if (patch[field] === undefined) throw new StaffProfileError(`${label} is required`);
  }
  if (patch.active === undefined) patch.active = true;

  let created: IStaffProfile;
  try {
    created = await StaffProfile.create(patch);
  } catch (err) {
    friendlyDuplicate(err);
  }

  await writeAudit({
    eventKind: "STAFF_PROFILE_CREATED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: created._id.toString(),
    targetKind: "StaffProfile",
    meta: { schoolId: created.schoolId, name: created.name, category: created.category },
  });
  return created;
}

export async function updateStaffProfile(
  staffProfileId: string,
  input: StaffProfileInput,
  actor: { userId: string; role: string },
): Promise<IStaffProfile> {
  const existing = await StaffProfile.findById(staffProfileId);
  if (!existing) throw new StaffProfileError("Staff profile not found");

  const patch = buildPatch(input);
  // A field the caller did not send is left alone (patch semantics) — an edit form that
  // only shows half the record must never blank the half it did not show.
  if (Object.keys(patch).length === 0) return existing;

  // Required fields may be CHANGED but never emptied.
  for (const [field, label] of [
    ["schoolId", "Staff ID"],
    ["name", "Name"],
    ["category", "Category"],
    ["employmentType", "Employment type"],
    ["employmentStatus", "Employment status"],
  ] as const) {
    if (field in patch && patch[field] === undefined) {
      throw new StaffProfileError(`${label} cannot be empty`);
    }
  }

  const changed = Object.keys(patch).filter(
    (k) => String((existing as unknown as Record<string, unknown>)[k] ?? "") !== String(patch[k] ?? ""),
  );
  Object.assign(existing, patch);
  try {
    await existing.save();
  } catch (err) {
    friendlyDuplicate(err);
  }

  await writeAudit({
    eventKind: "STAFF_PROFILE_UPDATED",
    actorId: actor.userId,
    actorRole: actor.role,
    targetId: existing._id.toString(),
    targetKind: "StaffProfile",
    // WHICH fields moved, never their values: this row is read by anyone with audit
    // access and the record carries NID and bank details.
    meta: { schoolId: existing.schoolId, changedFields: changed },
  });
  return existing;
}
