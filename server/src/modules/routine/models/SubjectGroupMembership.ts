import { Schema, model, Document, Types } from "mongoose";

/**
 * Membership linking a student to a cross-grade Quran/Arabic `SubjectGroup`
 * (D-#48). A student has one general `Section` + ≤1 Quran group + ≤1 Arabic group;
 * the "≤1 per track" rule is enforced in the service (it needs the group's track,
 * which isn't on this row). Memberships are year-stable — no mid-year class change
 * (D-#54), so there is no auto-follow logic.
 *
 * Identity-bearing (references a Student) → operational/identity plane, behind the
 * ADR-005 firewall; the corpus plane never imports it.
 */
export interface ISubjectGroupMembership extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  studentId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectGroupMembershipSchema = new Schema<ISubjectGroupMembership>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
  },
  { timestamps: true },
);

// A student appears at most once per group.
SubjectGroupMembershipSchema.index({ groupId: 1, studentId: 1 }, { unique: true });

export const SubjectGroupMembership = model<ISubjectGroupMembership>(
  "SubjectGroupMembership",
  SubjectGroupMembershipSchema,
);
