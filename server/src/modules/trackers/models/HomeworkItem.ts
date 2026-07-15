/**
 * HomeworkItem — Layer A of the Homework Tracker (handoff §2.1, HW-T1).
 *
 * ONE common sheet per class per subject per day (handoff §0/§4.1) — there is no
 * per-student variant at this layer (the only per-student divergence anywhere is
 * the §5 resubmission top-up, on Layer B). Created by the subject teacher's daily
 * declaration. Rides the existing `homework` tracker-kind — no new tracker-kind,
 * no envelope/harness sync (D-#33).
 *
 * Class-level by intent; we also carry `sectionId` because the app keys
 * read/write scope to a section (ADR-016) and the rosters here are predominantly
 * single-section. Multi-section fan-out is deferred (flag if a class ever needs
 * distinct sheets per section — it would be a contract question for the Principal).
 *
 * `status`: declared → issued. Issuing (spawning Layer-B per-student records)
 * happens here in HW-T1 via the service; HW-T2 will gate it behind the daily
 * 120-min reconciliation/confirm.
 */
import { Schema, model, Document, Types } from "mongoose";
import { HW_SUBJECTS, ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";
import type { HwSubject } from "@scd/shared";

export const HOMEWORK_ITEM_STATUSES = ["declared", "issued"] as const;
export type HomeworkItemStatus = (typeof HOMEWORK_ITEM_STATUSES)[number];

export interface IHomeworkItem extends Document {
  _id: Types.ObjectId;
  /** HW_ID — HW-C{class}-{SUBJECT}-{nnnn} (handoff §2.1). Unique, year-continuous. */
  hwId: string;
  academicYearId: Types.ObjectId;
  classId: Types.ObjectId;
  /** Roster class level (Nursery/KG/C1–C5); homework uses the selected class's roster axis. */
  classLevel: number;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  /** DATE_GIVEN — a school night (Sun–Thu, handoff §6.1). */
  dateGiven: Date;
  /** TOP_TAGS — ≥1, never empty (handoff §2.1 / REF-07 §3.5). TOP-{SUBJECT}-C{class}-{nn}. */
  topTags: string[];
  /** TIME_DECL — declared minutes, 0–40 band, default 20 (0 is valid, D-030). */
  timeDecl: number;
  /** Q_COUNT — tuned so the average student finishes inside TIME_DECL. */
  qCount: number;
  /** POOL_REF — QP-{SUBJECT}-C{class}-U{nn} (selection, never authoring). Optional. */
  poolRef?: string;
  /** Selected Pool question ids referenced by this sheet (HW-T3 enforces Pool membership). */
  selectedQids: string[];
  /** REV_ITEM — does the sheet carry the optional one revision item? (trims cut these first, §4.4a). */
  revItem: boolean;
  /** SESSION_REF — the Session Plan / lesson this reinforces (§2.7 traceability). */
  sessionRef?: string;
  /** D-#317: the teacher's brief "what is the homework" — REQUIRED at declare
   *  (optional on the schema only for pre-D-#317 rows); shown on every card so
   *  collection/marking/checking can tell items apart. */
  description?: string;
  status: HomeworkItemStatus;
  declaredBy: Types.ObjectId;
  issuedAt?: Date;
  /** Optional teacher-attached QUESTION file (GP-A, D-#70) — one per item, shared
   *  by the class. A `StoredFile` ref; re-attach replaces the reference (the old
   *  Drive file stays under the year's retention). */
  questionFileId?: Types.ObjectId;
  /** Multi-file question attachments picked in the declare form (≤5, `hw_question`
   *  kind) — the class-note pattern. `questionFileId` stays as the legacy single
   *  post-declare slot; readers surface both. */
  attachmentIds?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const HomeworkItemSchema = new Schema<IHomeworkItem>(
  {
    hwId: { type: String, required: true, unique: true },
    academicYearId: { type: Schema.Types.ObjectId, required: true },
    classId: { type: Schema.Types.ObjectId, required: true },
    classLevel: { type: Number, required: true, min: ROSTER_CLASS_LEVEL_MIN, max: ROSTER_CLASS_LEVEL_MAX },
    sectionId: { type: Schema.Types.ObjectId, required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    dateGiven: { type: Date, required: true },
    topTags: {
      type: [String],
      required: true,
      validate: { validator: (v: string[]) => v.length > 0, message: "topTags must not be empty" },
    },
    // 0–40 is the working band, but a subject MAY exceed 40 on reduced-roster days
    // (handoff §2.1 / §4 close): >40 WARNS at reconciliation, never hard-blocks here.
    // The only hard limit is the §4 day-SUM (120), enforced in the reconciliation service.
    timeDecl: { type: Number, required: true, min: 0, default: 20 },
    qCount: { type: Number, required: true, min: 0 },
    poolRef: { type: String },
    selectedQids: { type: [String], default: [] },
    revItem: { type: Boolean, required: true, default: false },
    sessionRef: { type: String },
    description: { type: String, trim: true },
    status: { type: String, enum: HOMEWORK_ITEM_STATUSES, required: true, default: "declared" },
    declaredBy: { type: Schema.Types.ObjectId, required: true },
    issuedAt: { type: Date },
    questionFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: "StoredFile", default: undefined },
  },
  { timestamps: true },
);

// Daily declaration view (handoff §8.1): items for a class on a day.
HomeworkItemSchema.index({ classId: 1, dateGiven: 1 });
// Reverse lookup for the GET /files/:id read gate (which item owns this file?).
HomeworkItemSchema.index({ attachmentIds: 1 }, { sparse: true });
HomeworkItemSchema.index({ academicYearId: 1, classLevel: 1, subject: 1 });

export const HomeworkItem = model<IHomeworkItem>("HomeworkItem", HomeworkItemSchema);
