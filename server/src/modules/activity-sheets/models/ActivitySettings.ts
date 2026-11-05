import { Schema, model, Document, Types } from "mongoose";

/**
 * Activity-sheet rules (D-#991 defaults, owner-unconfirmed) — ONE singleton row, read-time
 * defaults when it does not exist (the D-#97 pattern; never seeded).
 */
export interface IActivitySettings extends Document {
  _id: Types.ObjectId;
  key: "singleton";
  weeklyRequests: number;
  maxOpen: number;
  monthlyTarget: number;
  levelUpAfter: number;
  notReturnedDays: number;
  restockSheets: number;
  restockCopies: number;
  lowTray: number;
  /** Busy time: children take tray sheets without a desk scan; the record is made at return. */
  busyMode: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_ACTIVITY_SETTINGS = {
  weeklyRequests: 3,
  maxOpen: 3,
  monthlyTarget: 8,
  levelUpAfter: 5,
  notReturnedDays: 14,
  restockSheets: 10,
  restockCopies: 2,
  lowTray: 5,
  busyMode: false,
} as const;

const ActivitySettingsSchema = new Schema<IActivitySettings>(
  {
    key: { type: String, required: true, default: "singleton" },
    weeklyRequests: { type: Number, min: 0, max: 50 },
    maxOpen: { type: Number, min: 1, max: 50 },
    monthlyTarget: { type: Number, min: 1, max: 100 },
    levelUpAfter: { type: Number, min: 1, max: 50 },
    notReturnedDays: { type: Number, min: 1, max: 120 },
    restockSheets: { type: Number, min: 1, max: 50 },
    restockCopies: { type: Number, min: 1, max: 10 },
    lowTray: { type: Number, min: 0, max: 100 },
    busyMode: { type: Boolean },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ActivitySettingsSchema.index({ key: 1 }, { unique: true });

export const ActivitySettings = model<IActivitySettings>("ActivitySettings", ActivitySettingsSchema);
