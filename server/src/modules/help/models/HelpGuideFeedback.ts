/**
 * HelpGuideFeedback (D-#968) — one person's কাজে লেগেছে? হ্যাঁ / না on one guide.
 *
 * One row per guide × account; pressing again changes the answer. It tells the owner which
 * guides need rewriting. Reading the totals is a later report (it will need its own
 * `reports:*` switch, D-#861); HC-1 only stores the answers.
 */
import { Schema, model, Document, Types } from "mongoose";

export interface IHelpGuideFeedback extends Document {
  _id: Types.ObjectId;
  guideId: string;
  ownerKind: "USER" | "GUARDIAN";
  ownerId: Types.ObjectId;
  helpful: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HelpGuideFeedbackSchema = new Schema<IHelpGuideFeedback>(
  {
    guideId: { type: String, required: true },
    ownerKind: { type: String, enum: ["USER", "GUARDIAN"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    helpful: { type: Boolean, required: true },
  },
  { timestamps: true },
);

HelpGuideFeedbackSchema.index({ guideId: 1, ownerKind: 1, ownerId: 1 }, { unique: true });

export const HelpGuideFeedback = model<IHelpGuideFeedback>("HelpGuideFeedback", HelpGuideFeedbackSchema);
