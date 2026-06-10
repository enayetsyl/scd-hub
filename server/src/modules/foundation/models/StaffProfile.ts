import { Schema, model, Document, Types } from "mongoose";
import {
  HR_CATEGORIES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  type HrCategory,
  type EmploymentType,
  type EmploymentStatus,
} from "@scd/shared";

/** Local to the identity plane (mirrors Student.Gender). */
export type Gender = "male" | "female" | "other";

/**
 * StaffProfile — HR master record for any employee (prd-hr H1; design §2).
 * Operational/identity-plane, behind the ADR-005 firewall (NO corpus path).
 *
 * Data-only like Student: a profile is valid with or without a linked `User`
 * (login is optional and separate — H1.2). This first slice (HR-1) carries the
 * identity/bio + employment fields imported from the real staff roster; later
 * HR slices add leave/attendance/payroll as their own models hanging off this one.
 *
 * Sensitive rows (NID, bank account, salary) are Principal/Office-only by design
 * (H1.4). They live on the model but are only ever surfaced through the
 * `staff:manage`-gated resolver — never the corpus plane.
 */
export interface IStaffProfile extends Document {
  _id: Types.ObjectId;
  /** Stable institution staff ID (the source "ID" column). Upsert key. */
  schoolId: string;
  name: string;
  nameBn?: string;
  /** HR category (teacher / office_accounts / support …) — drives defaults, not auth (H1.3). */
  category: HrCategory;
  /** Free-text job title from the source ("Assistant Teacher", "Admin", "Principal"…). */
  designation?: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  joiningDate?: Date;
  /** Attendance mapping key for later biometric ingest (H1.5); unique when present. */
  biometricId?: string;

  // --- bio / contact -------------------------------------------------------
  gender?: Gender;
  dob?: Date;
  bloodGroup?: string;
  maritalStatus?: string;
  nationality?: string;
  qualification?: string;
  majoredIn?: string;
  studiedAt?: string;
  fatherName?: string;
  motherName?: string;
  spouseName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  presentAddress?: string;
  permanentAddress?: string;

  // --- Principal/Office-only sensitive rows (H1.4) -------------------------
  nid?: string;
  bankAccount?: string;

  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StaffProfileSchema = new Schema<IStaffProfile>(
  {
    schoolId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, trim: true },
    category: { type: String, enum: HR_CATEGORIES, required: true },
    designation: { type: String, trim: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true, default: "full_time" },
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUSES, required: true, default: "confirmed" },
    joiningDate: { type: Date },
    biometricId: { type: String, trim: true, unique: true, sparse: true },

    gender: { type: String, enum: ["male", "female", "other"] },
    dob: { type: Date },
    bloodGroup: { type: String, trim: true },
    maritalStatus: { type: String, trim: true },
    nationality: { type: String, trim: true },
    qualification: { type: String, trim: true },
    majoredIn: { type: String, trim: true },
    studiedAt: { type: String, trim: true },
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    spouseName: { type: String, trim: true },
    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    email: { type: String, trim: true },
    presentAddress: { type: String, trim: true },
    permanentAddress: { type: String, trim: true },

    nid: { type: String, trim: true },
    bankAccount: { type: String, trim: true },

    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

StaffProfileSchema.index({ category: 1, name: 1 });

export const StaffProfile = model<IStaffProfile>("StaffProfile", StaffProfileSchema);
