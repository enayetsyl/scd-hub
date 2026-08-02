/**
 * ObservationRota (CO-14, D-#426) — a saved review rota plus the instruction that
 * produced it.
 *
 * The INSTRUCTION is stored, not just its output. The routine changes often (and is
 * edited in place rather than versioned), so a rota is a perishable artefact:
 * regenerating from the stored instruction is one call, whereas a frozen table with no
 * provenance can only be retyped.
 *
 * Each row keeps the candidate id it was chosen from — `${date}#${slotId}` — so a later
 * read can ask whether that routine slot is still live and flag the row rather than
 * quietly presenting a period that has moved. The resolved values (teacher, class,
 * period, clock time) are stored ALONGSIDE the id: they are what the Principal actually
 * read when they accepted it, and a re-resolve must not rewrite history.
 *
 * `constraintEcho` is the model's own restatement of the instruction, kept because it is
 * what the validator checked against and what the Principal confirmed on screen.
 *
 * Deliberately NOT an assignment: saving a rota creates no `ClassroomObservation` rows.
 * CO-6's guardrail — the system suggests, humans assign — is unchanged (owner ruling).
 *
 * Staff/operational plane (names teachers); no corpus or student path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IObservationRotaRow {
  /** YYYY-MM-DD. */
  date: string;
  /** `${date}#${slotId}` — the server-built candidate the model picked. */
  candidateId: string;
  teacherId: Types.ObjectId;
  /** Snapshotted: the name shown when this rota was accepted. */
  teacherName: string;
  sectionId?: Types.ObjectId | null;
  subjectGroupId?: Types.ObjectId | null;
  groupLabel: string;
  subject: string;
  periodNumber: number;
  startHHMM: string;
  endHHMM: string;
  /** The model's one-line justification for this pick (advisory, never validated). */
  reason?: string | null;
}

export interface IObservationRota extends Document {
  _id: Types.ObjectId;
  periodFrom: string;
  periodTo: string;
  /** The Principal's words, verbatim — the regeneration key. */
  instruction: string;
  /** The model's structured restatement, as validated + displayed. */
  constraintEcho: Record<string, unknown>;
  rows: IObservationRotaRow[];
  /** Resolved model id + prompt version, so a bad batch is traceable (D-#399 pattern).
   *  NOT named `model` — that collides with mongoose's Document.model() method. */
  modelId: string;
  promptVersion: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RowSchema = new Schema<IObservationRotaRow>(
  {
    date: { type: String, required: true },
    candidateId: { type: String, required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    teacherName: { type: String, required: true, trim: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", default: null },
    subjectGroupId: { type: Schema.Types.ObjectId, ref: "SubjectGroup", default: null },
    groupLabel: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    periodNumber: { type: Number, required: true },
    startHHMM: { type: String, required: true },
    endHHMM: { type: String, required: true },
    reason: { type: String, trim: true, default: null },
  },
  { _id: false },
);

const ObservationRotaSchema = new Schema<IObservationRota>(
  {
    periodFrom: { type: String, required: true },
    periodTo: { type: String, required: true },
    instruction: { type: String, required: true, trim: true },
    constraintEcho: { type: Schema.Types.Mixed, default: {} },
    rows: { type: [RowSchema], default: [] },
    modelId: { type: String, required: true },
    promptVersion: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ObservationRotaSchema.index({ periodFrom: 1, periodTo: 1, createdAt: -1 });

export const ObservationRota = model<IObservationRota>("ObservationRota", ObservationRotaSchema);
