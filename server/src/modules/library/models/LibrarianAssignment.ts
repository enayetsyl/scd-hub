import { Schema, model, Document, Types } from "mongoose";

/**
 * Append-only log of librarian duty assignments (prd-library §5, D-#81 —
 * the D-#42/#64 duty pattern, mirrors `ClassTeacherAssignment`). A TEACHER
 * whose LATEST row is `assign` passes `assertIsLibrarian`; rows are never
 * mutated or deleted (ADR-008). No new role — Principal/Office pass the gate
 * via `library:manage` without any row here.
 */
export interface ILibrarianAssignment extends Document {
  _id: Types.ObjectId;
  /** The TEACHER taking/leaving the desk duty. */
  userId: Types.ObjectId;
  action: "assign" | "revoke";
  actorId: Types.ObjectId;
  at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LibrarianAssignmentSchema = new Schema<ILibrarianAssignment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: ["assign", "revoke"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { timestamps: true },
);

LibrarianAssignmentSchema.index({ userId: 1, at: -1 });

export const LibrarianAssignment = model<ILibrarianAssignment>(
  "LibrarianAssignment",
  LibrarianAssignmentSchema,
);
