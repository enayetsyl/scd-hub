/**
 * Corpus/analytics plane events (ADR-005, ADR-007).
 *
 * FIREWALL INVARIANT: No identity references here — no userId, studentId,
 * guardianId. Actors are stored as pseudoActorId only. The fail-closed
 * firewall test (J5.6) asserts this boundary holds.
 */
import { Schema, model, Document, Types } from "mongoose";

export type CorpusEventKind =
  | "content_imported"
  | "questions_selected"
  | "set_assembled"
  | "tracker_recorded";

export interface ICorpusEvent extends Document {
  _id: Types.ObjectId;
  eventKind: CorpusEventKind;
  /** Pseudonymous actor — NOT a reference to the users collection (ADR-005). */
  pseudoActorId: string;
  occurredAt: Date;
  meta?: Record<string, unknown>;
}

const CorpusEventSchema = new Schema<ICorpusEvent>(
  {
    eventKind: { type: String, required: true },
    pseudoActorId: { type: String, required: true },
    occurredAt: { type: Date, required: true, default: () => new Date() },
    meta: { type: Schema.Types.Mixed },
  },
  {
    timestamps: false,
    versionKey: false,
    // Append-only — no updates (ADR-007)
  },
);

CorpusEventSchema.index({ eventKind: 1, occurredAt: -1 });

export const CorpusEvent = model<ICorpusEvent>("CorpusEvent", CorpusEventSchema);
