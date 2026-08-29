import { builder } from "../../../schema";
import { StaffProfile, type IStaffProfile } from "../models/StaffProfile";
import {
  createStaffProfile,
  updateStaffProfile,
  StaffProfileError,
  type StaffProfileInput,
} from "../services/StaffProfileService";
import { expectedGraphQLError } from "../../../observability/sentry";
import type { Types } from "mongoose";

/**
 * Staff-record reads (prd-hr H1). The whole `staff` query is gated on
 * `staff:manage` (Principal/Office) — a TEACHER, even with supervisory scope,
 * cannot read staff rows at all (default-deny row-scope, H1.4/H7.1). Identity
 * plane only; no corpus path (ADR-005 firewall unaffected).
 */
type StaffShape = Pick<
  IStaffProfile,
  | "schoolId" | "name" | "nameBn" | "category" | "designation" | "weeklyHours"
  | "employmentType" | "employmentStatus" | "joiningDate" | "confirmationDate" | "biometricId"
  | "gender" | "dob" | "bloodGroup" | "maritalStatus" | "nationality"
  | "qualification" | "majoredIn" | "studiedAt"
  | "fatherName" | "motherName" | "spouseName"
  | "phone" | "whatsapp" | "email" | "presentAddress" | "permanentAddress"
  | "nid" | "bankAccount" | "bankAccountName" | "bankName" | "bankBranch"
  | "monthlySalary" | "paymentMethod" | "active"
> & { _id: Types.ObjectId };

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

const StaffRef = builder.objectRef<StaffShape>("StaffProfile");
StaffRef.implement({
  description: "HR staff master record (Principal/Office-only; prd-hr H1).",
  fields: (t) => ({
    id: t.string({ resolve: (s) => s._id.toString() }),
    schoolId: t.exposeString("schoolId"),
    name: t.exposeString("name"),
    nameBn: t.string({ nullable: true, resolve: (s) => s.nameBn ?? null }),
    category: t.exposeString("category"),
    designation: t.string({ nullable: true, resolve: (s) => s.designation ?? null }),
    weeklyHours: t.string({ nullable: true, resolve: (s) => s.weeklyHours ?? null }),
    employmentType: t.exposeString("employmentType"),
    employmentStatus: t.exposeString("employmentStatus"),
    joiningDate: t.string({ nullable: true, resolve: (s) => iso(s.joiningDate) }),
    // SH-2 (D-#540): ABSENT means still on probation. Read-only here — it is written
    // only by confirmStaffEmployment, which also settles the held leave debt.
    confirmationDate: t.string({ nullable: true, resolve: (s) => iso(s.confirmationDate) }),
    biometricId: t.string({ nullable: true, resolve: (s) => s.biometricId ?? null }),
    gender: t.string({ nullable: true, resolve: (s) => s.gender ?? null }),
    dob: t.string({ nullable: true, resolve: (s) => iso(s.dob) }),
    bloodGroup: t.string({ nullable: true, resolve: (s) => s.bloodGroup ?? null }),
    maritalStatus: t.string({ nullable: true, resolve: (s) => s.maritalStatus ?? null }),
    nationality: t.string({ nullable: true, resolve: (s) => s.nationality ?? null }),
    qualification: t.string({ nullable: true, resolve: (s) => s.qualification ?? null }),
    majoredIn: t.string({ nullable: true, resolve: (s) => s.majoredIn ?? null }),
    studiedAt: t.string({ nullable: true, resolve: (s) => s.studiedAt ?? null }),
    fatherName: t.string({ nullable: true, resolve: (s) => s.fatherName ?? null }),
    motherName: t.string({ nullable: true, resolve: (s) => s.motherName ?? null }),
    spouseName: t.string({ nullable: true, resolve: (s) => s.spouseName ?? null }),
    phone: t.string({ nullable: true, resolve: (s) => s.phone ?? null }),
    whatsapp: t.string({ nullable: true, resolve: (s) => s.whatsapp ?? null }),
    email: t.string({ nullable: true, resolve: (s) => s.email ?? null }),
    presentAddress: t.string({ nullable: true, resolve: (s) => s.presentAddress ?? null }),
    permanentAddress: t.string({ nullable: true, resolve: (s) => s.permanentAddress ?? null }),
    // sensitive rows (H1.4) — only reachable through this staff:manage-gated type
    nid: t.string({ nullable: true, resolve: (s) => s.nid ?? null }),
    bankAccount: t.string({ nullable: true, resolve: (s) => s.bankAccount ?? null }),
    bankAccountName: t.string({ nullable: true, resolve: (s) => s.bankAccountName ?? null }),
    bankName: t.string({ nullable: true, resolve: (s) => s.bankName ?? null }),
    bankBranch: t.string({ nullable: true, resolve: (s) => s.bankBranch ?? null }),
    monthlySalary: t.float({ nullable: true, resolve: (s) => s.monthlySalary ?? null }),
    paymentMethod: t.string({ nullable: true, resolve: (s) => s.paymentMethod ?? null }),
    active: t.exposeBoolean("active"),
  }),
});

builder.queryField("staff", (t) =>
  t.field({
    type: [StaffRef],
    authScopes: { hasPermission: "staff:manage" },
    args: {
      category: t.arg.string({ required: false }),
    },
    resolve: async (_root, args) => {
      const filter: Record<string, unknown> = { active: true };
      if (args.category) filter.category = args.category;
      return StaffProfile.find(filter).sort({ category: 1, name: 1 }).lean();
    },
  }),
);

/**
 * ONE staff record, live (SH-9). The hub used to render the row object it was handed as
 * a navigation parameter — a snapshot taken when the row was tapped — so after any
 * write it kept showing the old values. In the 2026-08-26 prod E2E test a confirmation
 * succeeded server-side (status flipped, date stamped, letter issued, audit written)
 * and the screen still read শিক্ষানবিশ with the স্থায়ীকরণ button waiting to be pressed
 * a second time. Same `staff:manage` gate and same shape as the list; the hub now
 * refetches this on focus.
 */
builder.queryField("staffProfile", (t) =>
  t.field({
    type: StaffRef,
    nullable: true,
    description: "One staff record by id, live (SH-9). Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { staffProfileId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => StaffProfile.findById(args.staffProfileId).lean(),
  }),
);

// ---------------------------------------------------------------------------
// Writes (D-#526) — create + edit a staff record from the app.
//
// Until this, a StaffProfile could only arrive via server/scripts/import-staff.ts, so
// onboarding one employee needed a developer AND their login could not be provisioned
// at all (provisionStaffLogin keys on a profile, D-#60). Same `staff:manage` gate as the
// read, so Principal/Office only — a TEACHER cannot reach staff rows at all.
//
// PAY IS NOT SETTABLE HERE. monthlySalary/paymentMethod go through setStaffPay under
// `payroll:manage`; accepting them on this input would let anyone who can fix an address
// typo also set a salary.
// ---------------------------------------------------------------------------

const StaffProfileInputRef = builder.inputType("StaffProfileInput", {
  description:
    "Staff record fields writable from the app (D-#526). Pay is deliberately absent — " +
    "it is set through setStaffPay under payroll:manage. On update, an omitted field is " +
    "LEFT ALONE; an empty string CLEARS an optional field.",
  fields: (t) => ({
    schoolId: t.string({ required: false }),
    name: t.string({ required: false }),
    nameBn: t.string({ required: false }),
    category: t.string({ required: false }),
    designation: t.string({ required: false }),
    weeklyHours: t.string({ required: false }),
    employmentType: t.string({ required: false }),
    employmentStatus: t.string({ required: false }),
    joiningDate: t.string({ required: false }),
    biometricId: t.string({ required: false }),
    gender: t.string({ required: false }),
    dob: t.string({ required: false }),
    bloodGroup: t.string({ required: false }),
    maritalStatus: t.string({ required: false }),
    nationality: t.string({ required: false }),
    qualification: t.string({ required: false }),
    majoredIn: t.string({ required: false }),
    studiedAt: t.string({ required: false }),
    fatherName: t.string({ required: false }),
    motherName: t.string({ required: false }),
    spouseName: t.string({ required: false }),
    phone: t.string({ required: false }),
    whatsapp: t.string({ required: false }),
    email: t.string({ required: false }),
    presentAddress: t.string({ required: false }),
    permanentAddress: t.string({ required: false }),
    nid: t.string({ required: false }),
    bankAccount: t.string({ required: false }),
    bankAccountName: t.string({ required: false }),
    bankName: t.string({ required: false }),
    bankBranch: t.string({ required: false }),
    active: t.boolean({ required: false }),
  }),
});

/** A refusal the Principal can act on, not a stack trace. */
function mapStaffError(err: unknown): never {
  if (err instanceof StaffProfileError) throw expectedGraphQLError(err.message);
  throw err as Error;
}

builder.mutationField("createStaffProfile", (t) =>
  t.field({
    type: StaffRef,
    description:
      "Create an HR staff record (D-#526). Staff ID, name, category, employment type and " +
      "status are required; everything else is optional. Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: { input: t.arg({ type: StaffProfileInputRef, required: true }) },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw expectedGraphQLError("Unauthenticated");
      try {
        return (await createStaffProfile(args.input as StaffProfileInput, {
          userId: ctx.auth.userId,
          role: ctx.auth.role,
        })) as unknown as StaffShape;
      } catch (err) {
        return mapStaffError(err);
      }
    },
  }),
);

builder.mutationField("updateStaffProfile", (t) =>
  t.field({
    type: StaffRef,
    description:
      "Edit an HR staff record (D-#526). PATCH semantics — an omitted field is left alone, " +
      "so a partial form cannot blank what it does not show. Requires staff:manage.",
    authScopes: { hasPermission: "staff:manage" },
    args: {
      staffProfileId: t.arg.string({ required: true }),
      input: t.arg({ type: StaffProfileInputRef, required: true }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw expectedGraphQLError("Unauthenticated");
      try {
        return (await updateStaffProfile(args.staffProfileId, args.input as StaffProfileInput, {
          userId: ctx.auth.userId,
          role: ctx.auth.role,
        })) as unknown as StaffShape;
      } catch (err) {
        return mapStaffError(err);
      }
    },
  }),
);
