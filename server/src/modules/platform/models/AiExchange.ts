import { Schema, model, Document, Types } from "mongoose";

/**
 * AiExchange (D-#1179) — ONE row per AI call of the new features (comment check, teacher
 * assistant): exactly what was sent and what came back, so the Principal can study how the
 * model behaves and improve the instructions, rules and standards.
 *
 * Everything stored here is the DE-IDENTIFIED text (D-#1094): children, guardians and staff
 * are tokens ([S], [S1], [G1], [T1]), phones and ids [PHONE] / [NUM] / [ID]. The token → name
 * map is NEVER stored, so a row names nobody.
 *
 * The long, repeated parts of a prompt (the fixed instructions + standard, the chapter plan)
 * are stored once in `AiPromptText` and referenced here by hash.
 *
 * Kept until the Principal deletes it (owner 2026-11-09: no automatic deletion). Reading,
 * exporting and deleting are LOCKED Principal-only switches (`ai_assist:read_ai_log`,
 * `ai_assist:delete_ai_log`).
 */
export interface IAiExchangeAttempt {
  provider: string;
  modelName: string;
  outcome: "ok" | "error";
  errorKind?: string;
  fallback: boolean;
  latencyMs: number;
  costUsd: number;
}

export interface IAiExchangeOutcome {
  /** Comment check: issues shown to the writer (after the server's clean-up). */
  issuesShown?: number;
  issueTypes?: Record<string, number>;
  /** Set when the checked comment is saved. */
  saved?: boolean;
  issuesAccepted?: number;
  teacherOverrode?: boolean;
  savedAt?: Date;
}

export interface IAiExchange extends Document {
  _id: Types.ObjectId;
  at: Date;
  feature: string;
  callId: string;
  userId?: Types.ObjectId;
  role?: string;
  refType?: string;
  refId?: string;
  policyHash?: string;
  /** The model that answered (or the last one tried). */
  provider?: string;
  modelName?: string;
  ok: boolean;
  errorKind?: string;
  latencyMs: number;
  costUsd: number;
  attempts: IAiExchangeAttempt[];
  /** AiPromptText hashes. */
  prefixHash: string;
  contextHash?: string;
  history: Array<{ role: string; text: string }>;
  /** AI Workspace (D-#1228): where the history lives instead of a copy ("AiAssistSession:<id>@<n>"). */
  historyRef?: string;
  /** AI Workspace (D-#1228): what the prefix was built from (policy hash + file ids), not its text. */
  prefixRef?: string;
  /** False for a project with name protection OFF — its text was sent as written. */
  deidentified: boolean;
  /** This call's own part (the comment as JSON / the question), de-identified. */
  request: string;
  /** The model's raw answer text, de-identified. Empty when the call failed. */
  reply: string;
  outcome?: IAiExchangeOutcome;
}

const AiExchangeSchema = new Schema<IAiExchange>(
  {
    at: { type: Date, required: true },
    feature: { type: String, required: true },
    callId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    role: { type: String },
    refType: { type: String },
    refId: { type: String },
    policyHash: { type: String },
    provider: { type: String },
    modelName: { type: String },
    ok: { type: Boolean, required: true },
    errorKind: { type: String },
    latencyMs: { type: Number, required: true, default: 0 },
    costUsd: { type: Number, required: true, default: 0 },
    attempts: {
      type: [
        new Schema(
          {
            provider: { type: String, required: true },
            modelName: { type: String, required: true },
            outcome: { type: String, required: true },
            errorKind: { type: String },
            fallback: { type: Boolean, required: true },
            latencyMs: { type: Number, required: true },
            costUsd: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    prefixHash: { type: String, required: true },
    contextHash: { type: String },
    history: { type: [new Schema({ role: { type: String, required: true }, text: { type: String, required: true } }, { _id: false })], default: [] },
    historyRef: { type: String },
    prefixRef: { type: String },
    deidentified: { type: Boolean, default: true },
    request: { type: String, required: true },
    reply: { type: String, default: "" },
    outcome: {
      type: new Schema(
        {
          issuesShown: { type: Number },
          issueTypes: { type: Schema.Types.Mixed },
          saved: { type: Boolean },
          issuesAccepted: { type: Number },
          teacherOverrode: { type: Boolean },
          savedAt: { type: Date },
        },
        { _id: false },
      ),
    },
  },
  { collection: "ai_exchanges" },
);
AiExchangeSchema.index({ at: -1 });
AiExchangeSchema.index({ feature: 1, at: -1 });
AiExchangeSchema.index({ callId: 1 }, { unique: true });

export const AiExchange = model<IAiExchange>("AiExchange", AiExchangeSchema);

/** A long prompt part stored once (the instructions + standard; a chapter plan). */
export interface IAiPromptText extends Document {
  _id: Types.ObjectId;
  hash: string;
  text: string;
  firstAt: Date;
}

const AiPromptTextSchema = new Schema<IAiPromptText>(
  {
    hash: { type: String, required: true },
    text: { type: String, required: true },
    firstAt: { type: Date, required: true },
  },
  { collection: "ai_prompt_texts" },
);
AiPromptTextSchema.index({ hash: 1 }, { unique: true });

export const AiPromptText = model<IAiPromptText>("AiPromptText", AiPromptTextSchema);
