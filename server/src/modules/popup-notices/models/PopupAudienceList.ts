/**
 * PopupAudienceList — a named, reusable audience for pop-up notices (D-#854).
 *
 * The owner's ask: "make a custom list with either guardians or teachers, whatever, and
 * send a tailored message to them". A list is the same audience shape a notice carries —
 * filters, hand-picked staff, hand-picked families, or any mix — saved under a name so
 * the next notice to "Sports-day volunteers" is one tap. The list stores the RECIPE, not
 * the resolved people: a filter list picks up a new KG teacher next time, and a
 * hand-picked list stays exactly the people picked.
 *
 * Shared by every sender (Office and Principal work the same lists).
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";
import type { PopupAudience } from "./PopupNotice";

export interface IPopupAudienceList extends Document {
  _id: Types.ObjectId;
  name: string;
  audience: PopupAudience;
  active: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PopupAudienceListSchema = new Schema<IPopupAudienceList>(
  {
    name: { type: String, required: true, trim: true },
    audience: {
      staff: { type: Schema.Types.Mixed, default: null },
      guardian: {
        type: new Schema(
          {
            classLevels: [{ type: Number }],
            sectionIds: [{ type: Schema.Types.ObjectId, ref: "Section" }],
          },
          { _id: false },
        ),
        default: null,
      },
      userIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      studentIds: [{ type: Schema.Types.ObjectId, ref: "Student" }],
    },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

PopupAudienceListSchema.index({ active: 1, name: 1 });

export const PopupAudienceList = model<IPopupAudienceList>("PopupAudienceList", PopupAudienceListSchema);
