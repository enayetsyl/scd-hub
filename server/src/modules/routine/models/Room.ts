import { Schema, model, Document, Types } from "mongoose";

/**
 * A physical room / space used by routine slots (D-#47(2)). The conflict engine
 * (R-2) prevents a room being double-booked at the same (day, period). Optional on
 * a slot — the check applies only when a room is set. Operational plane; no PII.
 */
export interface IRoom extends Document {
  _id: Types.ObjectId;
  code: string;
  nameBn: string;
  capacity?: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoomSchema = new Schema<IRoom>(
  {
    code: { type: String, required: true, trim: true },
    nameBn: { type: String, required: true, trim: true },
    capacity: { type: Number, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

RoomSchema.index({ code: 1 }, { unique: true });

export const Room = model<IRoom>("Room", RoomSchema);
