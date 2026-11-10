import { Schema, model, Document, Types } from "mongoose";

/**
 * AiDraft (AI Workspace W-3, docs/prd-ai-workspace.md §5; D-#1211) — an answer turned into a
 * managed document. Every edit or AI revision is a new `AiDraftVersion`; approving locks the
 * current version (`approvedVersion`). A later change adds a version and the draft is a
 * draft again until it is approved again — the approved version stays on record.
 *
 *   kind   free | lesson_plan (Markdown + the plan JSON, D-#1229) | question_bank (bank JSON)
 *          | book_chapter (support-book patch JSON) | storybook | paper
 *   revise W-3 "Revise with notes": an AI call that writes the next version; it can wait for
 *          off-peak like a chat turn (status queued with runAfter).
 *   sends  every send to a pipeline (send = publish, D-#1229) with its verdict.
 */
export const AI_DRAFT_KINDS = ["free", "lesson_plan", "question_bank", "book_chapter", "storybook", "paper"] as const;
export type AiDraftKind = (typeof AI_DRAFT_KINDS)[number];
/** The kinds that go into an existing pipeline; the others export only. */
export const AI_PIPELINE_KINDS: readonly AiDraftKind[] = ["lesson_plan", "question_bank", "book_chapter"];

export interface IAiDraftRevise {
  status: "queued" | "running" | "failed" | "stopped";
  notes: string;
  model: string;
  thinking: "off" | "low" | "high";
  runAt: "now" | "offpeak";
  runAfter?: Date | null;
  error?: string | null;
  requestedBy: Types.ObjectId;
  at: Date;
}

export interface IAiDraftSend {
  pipeline: "lesson_plan" | "question_bank" | "book_chapter";
  version: number;
  ok: boolean;
  summary: string;
  by: Types.ObjectId;
  at: Date;
}

export interface IAiDraft extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  kind: AiDraftKind;
  currentVersion: number;
  approvedVersion?: number | null;
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  sourceSessionId?: Types.ObjectId | null;
  sourceMessageId?: Types.ObjectId | null;
  /** W-4: the batch job that wrote it. */
  jobId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  /** "claude" when started through the MCP bridge (W-5). */
  origin: "app" | "claude";
  revise?: IAiDraftRevise | null;
  sends: IAiDraftSend[];
  /** W-6 pilot (PRD §8): the owner judges the AI's draft against a Claude-made one. */
  review?: { score: "usable" | "minor" | "rewrite"; note?: string | null; by: Types.ObjectId; at: Date; version: number } | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AiDraftSchema = new Schema<IAiDraft>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    kind: { type: String, required: true, enum: AI_DRAFT_KINDS },
    currentVersion: { type: Number, required: true, min: 1 },
    approvedVersion: { type: Number, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    sourceSessionId: { type: Schema.Types.ObjectId, ref: "AiAssistSession", default: null },
    sourceMessageId: { type: Schema.Types.ObjectId, ref: "AiAssistMessage", default: null },
    jobId: { type: Schema.Types.ObjectId, ref: "AiJob", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    origin: { type: String, required: true, enum: ["app", "claude"], default: "app" },
    revise: {
      type: new Schema(
        {
          status: { type: String, required: true, enum: ["queued", "running", "failed", "stopped"] },
          notes: { type: String, required: true },
          model: { type: String, required: true },
          thinking: { type: String, required: true, enum: ["off", "low", "high"] },
          runAt: { type: String, required: true, enum: ["now", "offpeak"] },
          runAfter: { type: Date, default: null },
          error: { type: String, default: null },
          requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    sends: {
      type: [
        new Schema(
          {
            pipeline: { type: String, required: true, enum: ["lesson_plan", "question_bank", "book_chapter"] },
            version: { type: Number, required: true },
            ok: { type: Boolean, required: true },
            summary: { type: String, required: true },
            by: { type: Schema.Types.ObjectId, ref: "User", required: true },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    archived: { type: Boolean, required: true, default: false },
    review: {
      type: new Schema(
        {
          score: { type: String, required: true, enum: ["usable", "minor", "rewrite"] },
          note: { type: String, default: null, maxlength: 1000 },
          by: { type: Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, required: true },
          version: { type: Number, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

AiDraftSchema.index({ projectId: 1, archived: 1, updatedAt: -1 });
AiDraftSchema.index({ "revise.status": 1, "revise.runAfter": 1 }, { partialFilterExpression: { "revise.status": "queued" } });
AiDraftSchema.index({ jobId: 1 }, { sparse: true });

export const AiDraft = model<IAiDraft>("AiDraft", AiDraftSchema);

/**
 * One version of a draft — never edited. `body` is Markdown (free / lesson_plan / storybook /
 * paper) or JSON text (question_bank / book_chapter); a lesson plan also carries `planJson`.
 */
export interface IAiDraftVersion extends Document {
  _id: Types.ObjectId;
  draftId: Types.ObjectId;
  projectId: Types.ObjectId;
  version: number;
  body: string;
  planJson?: string | null;
  note?: string | null;
  source: "manual" | "chat" | "revise" | "job";
  /** The instructions version the AI wrote it under (revise / job). */
  policyHash?: string | null;
  costUsd?: number | null;
  createdBy?: Types.ObjectId | null;
  origin: "app" | "claude";
  at: Date;
}

const AiDraftVersionSchema = new Schema<IAiDraftVersion>(
  {
    draftId: { type: Schema.Types.ObjectId, ref: "AiDraft", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", required: true },
    version: { type: Number, required: true, min: 1 },
    body: { type: String, default: "" },
    planJson: { type: String, default: null },
    note: { type: String, default: null, maxlength: 500 },
    source: { type: String, required: true, enum: ["manual", "chat", "revise", "job"] },
    policyHash: { type: String, default: null },
    costUsd: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    origin: { type: String, required: true, enum: ["app", "claude"], default: "app" },
    at: { type: Date, required: true },
  },
  { versionKey: false },
);

AiDraftVersionSchema.index({ draftId: 1, version: 1 }, { unique: true });

export const AiDraftVersion = model<IAiDraftVersion>("AiDraftVersion", AiDraftVersionSchema);
