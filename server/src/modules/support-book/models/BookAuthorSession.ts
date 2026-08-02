/**
 * BookAuthorSession — one chapter's authoring conversation (SB-6, D-#403/#408/#412).
 *
 * One session per attempt at a পাঠ. Turns are embedded rather than a second
 * collection: they are only ever read with their session, never queried across
 * sessions, and a chapter's conversation is bounded by the nine-step loop.
 *
 * EVERY TURN RECORDS WHAT PRODUCED IT — model, resolved model version, the
 * `policySetHash` in force, the prompt version, and token usage. Not for tidiness: a
 * bad batch has to be traceable to the exact configuration that made it, and the
 * monthly-report work already learned that an ALIAS like `gemini-flash-latest`
 * resolves to a dated model that is what actually answered.
 *
 * Sessions are RETAINED after a patch merges. The conversation is the rationale — SB-5
 * links a merged patch back to its session, and deleting it would make the timeline
 * end at "a patch appeared".
 */
import { Schema, Types, type Document } from "mongoose";
import { bookConnection } from "../../../bookDb";

export const AUTHOR_TURN_ROLES = ["user", "model"] as const;
export type AuthorTurnRole = (typeof AUTHOR_TURN_ROLES)[number];

export interface IBookAuthorTurn {
  role: AuthorTurnRole;
  text: string;
  /** Set on a model turn that emitted a patch envelope. */
  emittedPatch?: Record<string, unknown> | null;
  model?: string;
  /** What the alias actually resolved to — the thing a bad batch is traced to. */
  resolvedModel?: string;
  policySetHash?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** True when the policy prefix was served from the provider's cache. */
  cached?: boolean;
  createdAt: Date;
}

export const AUTHOR_SESSION_STATES = ["OPEN", "MERGED", "ABANDONED"] as const;
export type AuthorSessionState = (typeof AUTHOR_SESSION_STATES)[number];

export interface IBookAuthorSession extends Document {
  _id: Types.ObjectId;
  bookId: string;
  lessonNo: number;
  authorId: Types.ObjectId;
  state: AuthorSessionState;
  turns: IBookAuthorTurn[];
  /** The patch this session produced, once one merged (SB-5 reads it backwards). */
  mergedPatchId?: Types.ObjectId;
  /** Running totals, so a ceiling check is one read rather than a fold over turns. */
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

const TurnSchema = new Schema<IBookAuthorTurn>(
  {
    role: { type: String, enum: AUTHOR_TURN_ROLES, required: true },
    text: { type: String, required: true },
    emittedPatch: { type: Schema.Types.Mixed, default: null },
    model: { type: String },
    resolvedModel: { type: String },
    policySetHash: { type: String },
    promptVersion: { type: String },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    cached: { type: Boolean },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: false },
);

const BookAuthorSessionSchema = new Schema<IBookAuthorSession>(
  {
    bookId: { type: String, required: true },
    lessonNo: { type: Number, required: true },
    // Identity is on the other connection (D-#404) — a bare id, never a ref.
    authorId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, enum: AUTHOR_SESSION_STATES, required: true, default: "OPEN" },
    turns: { type: [TurnSchema], default: [] },
    mergedPatchId: { type: Schema.Types.ObjectId },
    totalInputTokens: { type: Number, required: true, default: 0 },
    totalOutputTokens: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

// An author's open session for a পাঠ.
BookAuthorSessionSchema.index({ bookId: 1, lessonNo: 1, state: 1 });
// The monthly spend read the ceiling checks.
BookAuthorSessionSchema.index({ bookId: 1, createdAt: -1 });

export const BookAuthorSession = bookConnection.model<IBookAuthorSession>(
  "BookAuthorSession",
  BookAuthorSessionSchema,
);
