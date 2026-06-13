import { Schema, model, Document, Types } from "mongoose";

/**
 * GuardianNotice (M-6, D-#79/#111) — a notice the school sends to guardians.
 * Guardians are notice RECIPIENTS, never chat participants (D-#76): delivery is
 * a per-guardian ADR-003 wa.me link fan-out (no guardian login), so this row is
 * just the composed record + an audit handle (`NOTICE_SENT`). The actual links
 * are built at compose time from the live roster and returned to the composer.
 *
 *   scope SCHOOL  — all active students' families        (gated chat:manage)
 *   scope SECTION — one section's families (sectionId set; gated on the
 *                   section's class teacher OR chat:manage — the D-#45 duty)
 *
 * Identity-plane (ADR-005): names a section + composer (staff); no corpus path.
 */
export interface IGuardianNotice extends Document {
  _id: Types.ObjectId;
  scope: "SCHOOL" | "SECTION";
  /** Set only for SECTION scope. */
  sectionId?: Types.ObjectId;
  title: string;
  body: string;
  composedBy: Types.ObjectId;
  /** How many wa.me targets the fan-out produced at compose time (audit aid). */
  recipientCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianNoticeSchema = new Schema<IGuardianNotice>(
  {
    scope: { type: String, enum: ["SCHOOL", "SECTION"], required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    composedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipientCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

// A composer's notices, newest-first (the future history view).
GuardianNoticeSchema.index({ composedBy: 1, createdAt: -1 });
GuardianNoticeSchema.index({ sectionId: 1, createdAt: -1 });

export const GuardianNotice = model<IGuardianNotice>("GuardianNotice", GuardianNoticeSchema);
