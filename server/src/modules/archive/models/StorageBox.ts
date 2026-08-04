/**
 * StorageBox (AR-1, prd-script-archive §5, D-#445) — a REGISTERED physical
 * container for answer-script bundles: one box per class per year (all
 * subjects mixed, bundles in exam-date order), so a whole class-year retires
 * together and scripts stay findable even without the app.
 *
 *  - `boxCode` is SERVER-MINTED `BX-{year}-{seq}` via StorageBoxSequence (the
 *    ClassTestSequence atomic-$inc pattern) — a typed code would inherit the
 *    library accession-typo risk; the label text stays free.
 *  - `locationNote` is the free-text "where it stands" (the BookTitle.shelf
 *    posture, e.g. "অফিস আলমারি, তাক ২"). Relocating a box = editing THIS one
 *    record; every bundle inside follows.
 *  - RETIRED = closed to NEW filings; contents stay findable; never deleted.
 *  - D-#145: no schoolId. D-#85: bundle/script counts are DERIVED on read
 *    (aggregate over ScriptBundle), never stored here.
 *
 * Operational/identity plane (ADR-005); no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import { STORAGE_BOX_STATUSES } from "@scd/shared";
import type { StorageBoxStatus } from "@scd/shared";

export interface IStorageBox extends Document {
  _id: Types.ObjectId;
  /** BX-{year}-{seq} — unique, server-minted (D-#445). */
  boxCode: string;
  /** Free-text label, e.g. "Class Five · ২০২৬". */
  label?: string;
  /** Free text, Bangla — where the box physically stands. */
  locationNote: string;
  status: StorageBoxStatus;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const StorageBoxSchema = new Schema<IStorageBox>(
  {
    boxCode: { type: String, required: true, unique: true },
    label: { type: String, trim: true },
    locationNote: { type: String, required: true, trim: true },
    status: { type: String, enum: STORAGE_BOX_STATUSES, required: true, default: "ACTIVE" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

StorageBoxSchema.index({ status: 1 });

export const StorageBox = model<IStorageBox>("StorageBox", StorageBoxSchema);
