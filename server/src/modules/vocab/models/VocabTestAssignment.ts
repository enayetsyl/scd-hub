import { Schema, model, Document, Types } from "mongoose";
import {
  VOCAB_PROGRAMS,
  VOCAB_ASSIGNMENT_SOURCES,
  type VocabProgram,
  type VocabAssignmentSource,
} from "@scd/shared";

/**
 * VocabTestAssignment (VC-2; prd-vocabulary-tracker §3.5, D-#106/#127) — the weekly
 * assignment of ONE teacher to a (section × program) for a week. APPEND-ONLY (the
 * D-#64 marker-assignment pattern): re-assigning appends a new row; the CURRENT
 * assignment for a (section, program, weekOf) is the latest row. Never edited.
 *
 * `source`: `direct` = the admin assigned the tester (roster:manage); `proxy` = a
 * recorded cover assignment riding a D-#20 grant. The resolver ALSO composes an
 * active proxy grant at request time (D-#21/#22) so a covering teacher may build/
 * mark even with no stored `proxy` row — the assigned OR covering teacher operates.
 *
 * Identity/operational plane, behind the ADR-005 firewall (NO corpus path).
 */
export interface IVocabTestAssignment extends Document {
  _id: Types.ObjectId;
  sectionId: Types.ObjectId;
  program: VocabProgram;
  /** Normalised week start (the Sunday of the week, local midnight). */
  weekOf: Date;
  assignedTeacherId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  source: VocabAssignmentSource;
  proxyGrantId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const VocabTestAssignmentSchema = new Schema<IVocabTestAssignment>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    program: { type: String, enum: VOCAB_PROGRAMS, required: true },
    weekOf: { type: Date, required: true },
    assignedTeacherId: { type: Schema.Types.ObjectId, required: true },
    assignedBy: { type: Schema.Types.ObjectId, required: true },
    source: { type: String, enum: VOCAB_ASSIGNMENT_SOURCES, required: true, default: "direct" },
    proxyGrantId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

// Latest row for a (section, program, week) = the current assignment.
VocabTestAssignmentSchema.index({ sectionId: 1, program: 1, weekOf: 1, createdAt: -1 });
// The teacher's own assignments.
VocabTestAssignmentSchema.index({ assignedTeacherId: 1, weekOf: -1 });

export const VocabTestAssignment = model<IVocabTestAssignment>(
  "VocabTestAssignment",
  VocabTestAssignmentSchema,
);
