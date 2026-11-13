import { Schema, model, Document, Types } from "mongoose";
import { SUPPORT_LEVELS, SUPPORT_SECTIONS, type SupportLevel, type SupportSection } from "@scd/shared";

/**
 * SupportProfileVersion (§5.2) — immutable once PUBLISHED. Every item cites reports; its level and
 * counts are computed by the server with `evidenceLevel()` and frozen at publishing (D-#1556,
 * D-#1562). `provisionalEvidence` is allowed in a DRAFT only (rules 15–16, D-#1555).
 */
export interface SupportItem {
  itemId: string;
  textBn: string;
  textEn?: string | null;
  evidence: Types.ObjectId[];
  provisionalEvidence: Types.ObjectId[];
  counterEvidence: Types.ObjectId[];
  strategyId?: Types.ObjectId | null;
  sourceKind: "AI" | "PRINCIPAL";
  level: SupportLevel | null;
  obsCount: number;
  teachersCount: number;
  settings: string[];
  firstEvidenceKey: string | null;
  lastEvidenceKey: string | null;
  hasGuardianInfo: boolean;
  mixed: boolean;
  kind?: string | null;
  insteadItemId?: string | null;
  needTag?: string | null;
  functionTag?: string | null;
  skillKey?: string | null;
  baselineBn?: string | null;
  expectedBn?: string | null;
  progress?: "NOT_YET" | "AS_EXPECTED" | "MORE" | null;
  progressAt?: Date | null;
  actionable?: { verbFirst: boolean; observable: boolean; specific: boolean; doable: boolean } | null;
}

export type SupportSections = Record<SupportSection, SupportItem[]>;

export interface ISupportProfileVersion extends Document {
  _id: Types.ObjectId;
  profileId: Types.ObjectId;
  versionNo: number;
  status: "DRAFT" | "PUBLISHED" | "DISCARDED";
  sections: SupportSections;
  card: { doItemIds: string[]; avoidItemIds: string[]; strengthItemIds: string[]; goalItemId: string | null };
  synthesisRunId: Types.ObjectId | null;
  batchId: Types.ObjectId | null;
  mode: "API" | "MANUAL" | "HAND";
  producer: string;
  methodVersion: string | null;
  methodHash: string | null;
  changeNoteBn: string;
  droppedItems: number;
  publishedBy: Types.ObjectId | null;
  publishedAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<SupportItem>(
  {
    itemId: { type: String, required: true },
    textBn: { type: String, required: true },
    textEn: { type: String, default: null },
    evidence: { type: [Schema.Types.ObjectId], default: [] },
    provisionalEvidence: { type: [Schema.Types.ObjectId], default: [] },
    counterEvidence: { type: [Schema.Types.ObjectId], default: [] },
    strategyId: { type: Schema.Types.ObjectId, default: null },
    sourceKind: { type: String, enum: ["AI", "PRINCIPAL"], required: true },
    level: { type: String, enum: [...SUPPORT_LEVELS, null], default: null },
    obsCount: { type: Number, default: 0 },
    teachersCount: { type: Number, default: 0 },
    settings: { type: [String], default: [] },
    firstEvidenceKey: { type: String, default: null },
    lastEvidenceKey: { type: String, default: null },
    hasGuardianInfo: { type: Boolean, default: false },
    mixed: { type: Boolean, default: false },
    kind: { type: String, default: null },
    insteadItemId: { type: String, default: null },
    needTag: { type: String, default: null },
    functionTag: { type: String, default: null },
    skillKey: { type: String, default: null },
    baselineBn: { type: String, default: null },
    expectedBn: { type: String, default: null },
    progress: { type: String, enum: ["NOT_YET", "AS_EXPECTED", "MORE", null], default: null },
    progressAt: { type: Date, default: null },
    actionable: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const sectionsDef = Object.fromEntries(SUPPORT_SECTIONS.map((s) => [s, { type: [ItemSchema], default: [] }]));

const SupportProfileVersionSchema = new Schema<ISupportProfileVersion>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: "SupportProfile", required: true },
    versionNo: { type: Number, required: true },
    status: { type: String, enum: ["DRAFT", "PUBLISHED", "DISCARDED"], default: "DRAFT" },
    sections: { type: new Schema(sectionsDef, { _id: false }), default: () => ({}) },
    card: {
      type: new Schema(
        { doItemIds: [String], avoidItemIds: [String], strengthItemIds: [String], goalItemId: { type: String, default: null } },
        { _id: false },
      ),
      default: () => ({ doItemIds: [], avoidItemIds: [], strengthItemIds: [], goalItemId: null }),
    },
    synthesisRunId: { type: Schema.Types.ObjectId, default: null },
    batchId: { type: Schema.Types.ObjectId, default: null },
    mode: { type: String, enum: ["API", "MANUAL", "HAND"], default: "HAND" },
    producer: { type: String, default: "" },
    methodVersion: { type: String, default: null },
    methodHash: { type: String, default: null },
    changeNoteBn: { type: String, default: "" },
    droppedItems: { type: Number, default: 0 },
    publishedBy: { type: Schema.Types.ObjectId, default: null },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);
SupportProfileVersionSchema.index({ profileId: 1, versionNo: -1 }, { unique: true });

export const SupportProfileVersion = model<ISupportProfileVersion>("SupportProfileVersion", SupportProfileVersionSchema);
