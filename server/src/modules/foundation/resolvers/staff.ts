import { builder } from "../../../schema";
import { StaffProfile, type IStaffProfile } from "../models/StaffProfile";
import type { Types } from "mongoose";

/**
 * Staff-record reads (prd-hr H1). The whole `staff` query is gated on
 * `staff:manage` (Principal/Office) — a TEACHER, even with supervisory scope,
 * cannot read staff rows at all (default-deny row-scope, H1.4/H7.1). Identity
 * plane only; no corpus path (ADR-005 firewall unaffected).
 */
type StaffShape = Pick<
  IStaffProfile,
  | "schoolId" | "name" | "nameBn" | "category" | "designation"
  | "employmentType" | "employmentStatus" | "joiningDate" | "biometricId"
  | "gender" | "dob" | "bloodGroup" | "maritalStatus" | "nationality"
  | "qualification" | "majoredIn" | "studiedAt"
  | "fatherName" | "motherName" | "spouseName"
  | "phone" | "whatsapp" | "email" | "presentAddress" | "permanentAddress"
  | "nid" | "bankAccount" | "active"
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
    employmentType: t.exposeString("employmentType"),
    employmentStatus: t.exposeString("employmentStatus"),
    joiningDate: t.string({ nullable: true, resolve: (s) => iso(s.joiningDate) }),
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
