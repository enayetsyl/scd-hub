import { Schema, model, Document, Types } from "mongoose";

/**
 * Who listens to a Hifz student's Saturday revision (SR-6, D-#1171). One row per student,
 * standing: it holds every Saturday until a lead, the Office or the Principal changes it
 * (owner, 2026-11-09: "this should be fixed for every Saturday"). Removing a student from
 * a teacher deletes the row — the student is then "not with anyone" until re-assigned.
 *
 * The assigned listener may record that student's entry even when they do not lead the
 * student's Qur'an group (the resolver's write gate). Identity plane (names a studentId);
 * no corpus path (ADR-005).
 */
export interface IRevisionListener extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  listenerUserId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RevisionListenerSchema = new Schema<IRevisionListener>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    listenerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// One listener per student.
RevisionListenerSchema.index({ studentId: 1 }, { unique: true });
// "My students" — the listener's Saturday list.
RevisionListenerSchema.index({ listenerUserId: 1 });

export const RevisionListener = model<IRevisionListener>("RevisionListener", RevisionListenerSchema);
