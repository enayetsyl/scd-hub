import { Schema, model, Document, Types } from "mongoose";

/**
 * A reversible **section merge** (D-#62) — the Principal combines a class's
 * gender-split sections (e.g. Boys + Girls) into one section so the children sit
 * as a single class. The students are physically moved to a `combinedSectionId`
 * and the source sections are deactivated (not deleted). One snapshot row per
 * merge captures everything needed to reverse it:
 *   - `moves` — each moved student's original section, so a split restores the
 *     exact prior placement for students present at merge time.
 *   - students enrolled into the combined section AFTER the merge are placed on
 *     split by gender (the dominant gender of each source section, derived from
 *     `moves`), so the roster stays consistent across cycles.
 *
 * Identity-plane (it references students/sections); no corpus path (ADR-005).
 * At most one `active` merge per class at a time.
 */
export interface ISectionMerge extends Document {
  _id: Types.ObjectId;
  classId: Types.ObjectId;
  combinedSectionId: Types.ObjectId;
  sourceSectionIds: Types.ObjectId[];
  moves: { studentId: Types.ObjectId; fromSectionId: Types.ObjectId }[];
  status: "active" | "split";
  mergedBy: Types.ObjectId;
  mergedAt: Date;
  splitBy?: Types.ObjectId;
  splitAt?: Date;
}

const SectionMergeSchema = new Schema<ISectionMerge>(
  {
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    combinedSectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    sourceSectionIds: [{ type: Schema.Types.ObjectId, ref: "Section", required: true }],
    moves: [
      {
        _id: false,
        studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
        fromSectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
      },
    ],
    status: { type: String, enum: ["active", "split"], required: true, default: "active" },
    mergedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mergedAt: { type: Date, required: true, default: () => new Date() },
    splitBy: { type: Schema.Types.ObjectId, ref: "User" },
    splitAt: { type: Date },
  },
  { timestamps: true },
);

// Fast lookup of a class's open merge; the service guards one active per class.
SectionMergeSchema.index({ classId: 1, status: 1 });

export const SectionMerge = model<ISectionMerge>("SectionMerge", SectionMergeSchema);
