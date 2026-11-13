import { Schema, model, Document, Types } from "mongoose";

/**
 * SupportBatch (docs/prd-child-support-profile.md §5.10, §6.10, D-#1585/#1586) — one processing run.
 * It HOLDS THE CODE MAP: random codes for this batch only (DE-8). No resolver returns the map; it is
 * read only by the pack export and the import, and deleted 30 days after the batch closes (DE-9).
 * The pack itself is never stored (DE-10): only its hash and the download entries.
 */
export const SUPPORT_BATCH_STATUSES = ["OPEN", "RESULT_PENDING", "IMPORTED", "CANCELLED", "EXPIRED", "FAILED"] as const;
export type SupportBatchStatus = (typeof SUPPORT_BATCH_STATUSES)[number];

export interface SupportCodeMap {
  children: { code: string; studentId: Types.ObjectId }[];
  teachers: { code: string; userId: Types.ObjectId }[];
  reports: { code: string; reportId: Types.ObjectId; isNew: boolean }[];
  strategies: { code: string; strategyId: Types.ObjectId; studentId?: Types.ObjectId }[];
  items: { code: string; itemId: string; studentId: Types.ObjectId }[];
}

export interface ISupportBatch extends Document {
  _id: Types.ObjectId;
  batchNo: number;
  code: string;
  mode: "MANUAL" | "API";
  stages: ("CHECK" | "COMPARE" | "SYNTHESIS")[];
  status: SupportBatchStatus;
  reportIds: Types.ObjectId[];
  childIds: Types.ObjectId[];
  methodVersion: string;
  methodHash: string;
  packNonce: string;
  packHash: string | null;
  packDownloads: { by: Types.ObjectId; at: Date }[];
  /** Day 0 of the relative days in the pack (DE-6) — the batch's creation day. */
  dayZeroKey: string;
  codeMap: SupportCodeMap | null;
  codeMapDeletedAt: Date | null;
  producer: { kind: "API" | "CHAT"; provider?: string | null; model?: string | null; chatLabel?: string | null } | null;
  summary: { valid: { reports: number; returns: number; drafts: number }; rejected: Record<string, number>; backToQueue: number } | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  expiresKey: string;
  closedAt: Date | null;
  lastReminderKey: string | null;
}

const SupportBatchSchema = new Schema<ISupportBatch>(
  {
    batchNo: { type: Number, required: true, unique: true },
    code: { type: String, required: true },
    mode: { type: String, enum: ["MANUAL", "API"], default: "MANUAL" },
    stages: { type: [String], enum: ["CHECK", "COMPARE", "SYNTHESIS"], default: ["CHECK", "COMPARE", "SYNTHESIS"] },
    status: { type: String, enum: SUPPORT_BATCH_STATUSES, default: "OPEN" },
    reportIds: { type: [Schema.Types.ObjectId], default: [] },
    childIds: { type: [Schema.Types.ObjectId], default: [] },
    methodVersion: { type: String, required: true },
    methodHash: { type: String, required: true },
    packNonce: { type: String, required: true, unique: true },
    packHash: { type: String, default: null },
    packDownloads: { type: [new Schema({ by: Schema.Types.ObjectId, at: Date }, { _id: false })], default: [] },
    dayZeroKey: { type: String, required: true },
    codeMap: { type: Schema.Types.Mixed, default: null },
    codeMapDeletedAt: { type: Date, default: null },
    producer: { type: Schema.Types.Mixed, default: null },
    summary: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    expiresKey: { type: String, required: true },
    closedAt: { type: Date, default: null },
    lastReminderKey: { type: String, default: null },
  },
  { timestamps: true },
);
SupportBatchSchema.index({ status: 1, createdAt: -1 });

export const SupportBatch = model<ISupportBatch>("SupportBatch", SupportBatchSchema);
