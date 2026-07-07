import { Schema, model, Document, Types } from "mongoose";

/**
 * Membership linking a student to a cross-grade Quran/Arabic `SubjectGroup`
 * (D-#48). A student has one general `Section` + ≤1 Quran group + ≤1 Arabic group.
 * The "≤1 per track" rule is enforced at TWO levels: the `addGroupMember` resolver
 * rejects it with a friendly error, AND the `track` denormalized onto this row
 * backs a UNIQUE (studentId, track) index so the database itself refuses a second
 * same-track membership (race-proof + script-proof). Memberships are year-stable —
 * no mid-year class change (D-#54), so there is no auto-follow logic.
 *
 * Identity-bearing (references a Student) → operational/identity plane, behind the
 * ADR-005 firewall; the corpus plane never imports it.
 */
export interface ISubjectGroupMembership extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  studentId: Types.ObjectId;
  /** The owning group's track ("quran" | "arabic") — denormalized so the DB can
   *  enforce ≤1 group per track via the unique (studentId, track) index. */
  track: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectGroupMembershipSchema = new Schema<ISubjectGroupMembership>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    track: { type: String, required: true },
  },
  { timestamps: true },
);

// A student appears at most once per group.
SubjectGroupMembershipSchema.index({ groupId: 1, studentId: 1 }, { unique: true });
// A student belongs to at most ONE group per track (Khadija can't be in Najera AND
// Qaida — both quran). The hard, race-proof guarantee behind the resolver's check.
SubjectGroupMembershipSchema.index({ studentId: 1, track: 1 }, { unique: true });

export const SubjectGroupMembership = model<ISubjectGroupMembership>(
  "SubjectGroupMembership",
  SubjectGroupMembershipSchema,
);
