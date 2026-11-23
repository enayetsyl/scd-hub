/**
 * AssignmentComment — AL-8 (docs/prd-academic-loop-2027.md §4.6, D-#1668): an Office / Principal comment on a
 * weekly assignment (a draft or a finalised week). Append-only; each comment notifies the subject teacher
 * (`AS_COMMENT`). Written only by a holder of `assignment:comment`, with the 2027 release switch on.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IAssignmentComment extends Document {
  _id: Types.ObjectId;
  assignmentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subject: string;
  week: string;
  authorId: Types.ObjectId;
  authorName: string;
  textBn: string;
  createdAt: Date;
}

const AssignmentCommentSchema = new Schema<IAssignmentComment>(
  {
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, required: true },
    week: { type: String, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    authorName: { type: String, default: "" },
    textBn: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AssignmentCommentSchema.index({ assignmentId: 1, createdAt: 1 });

export const AssignmentComment = model<IAssignmentComment>("AssignmentComment", AssignmentCommentSchema);
