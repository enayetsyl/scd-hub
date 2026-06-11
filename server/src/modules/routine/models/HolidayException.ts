import { Schema, model, Document, Types } from "mongoose";
import type { HolidayType } from "@scd/shared";

/**
 * An ad-hoc holiday (Eid, govt holiday, special closure) that OVERRIDES a day to
 * no-school (D-#50): no routine resolves and attendance is not expected for the
 * covered date(s). Layered on the same calendar source as the Sun–Thu / Fri-off /
 * Sat-Quran-only day-types (the HW Fri/Sat block stays correct for homework).
 * Operational config; no PII.
 */
export interface IHolidayException extends Document {
  _id: Types.ObjectId;
  fromDate: Date;
  toDate: Date;
  type: HolidayType;
  nameBn: string;
  note?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HolidayExceptionSchema = new Schema<IHolidayException>(
  {
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    type: { type: String, enum: ["eid", "govt", "special"], required: true },
    nameBn: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

HolidayExceptionSchema.index({ fromDate: 1, toDate: 1 });

export const HolidayException = model<IHolidayException>(
  "HolidayException",
  HolidayExceptionSchema,
);
