import { Schema, model, Document, Types } from "mongoose";

/**
 * A student left a Quran/Arabic `SubjectGroup` (D-#865). Written by `removeGroupMember`
 * just before the membership row is deleted — memberships themselves keep no history,
 * so without this row "where did this group's children go?" has no answer once the
 * group is empty.
 *
 * Read when the group is retired: Class 1–5 attendance is captured on the Quran group
 * (D-#278), and a student's history reads only their CURRENT group, so the retired
 * group's days would vanish from every moved child's attendance. The departures say
 * which groups received the children, and the retired group's days are copied there.
 *
 * Identity-bearing (references a Student) → operational/identity plane, behind the
 * ADR-005 firewall; the corpus plane never imports it.
 */
export interface ISubjectGroupDeparture extends Document {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  studentId: Types.ObjectId;
  track: string;
  leftAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectGroupDepartureSchema = new Schema<ISubjectGroupDeparture>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    track: { type: String, required: true },
    leftAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The hot read: "who left this group" at retire time.
SubjectGroupDepartureSchema.index({ groupId: 1, leftAt: -1 });

export const SubjectGroupDeparture = model<ISubjectGroupDeparture>("SubjectGroupDeparture", SubjectGroupDepartureSchema);
