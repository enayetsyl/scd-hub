import { Schema, model, Document, Types } from "mongoose";

/**
 * AiProjectFile (AI Workspace W-1, PRD §3, D-#1227) — one knowledge file of a project: the
 * original lives in Drive (a `StoredFile` of kind `ai_workspace_file`), this row holds the
 * TEXT read from it, which is what the model sees.
 *
 *   status       processing → ready | failed (reading runs after the upload answers; OCR of
 *                a long scanned PDF takes minutes)
 *   textSource   how the text was read: "text" (md/txt/json/csv, docx, xlsx, a text PDF),
 *                "tesseract" (OCR on the VM, the default for pictures and scanned PDFs) or
 *                "gemini" (Gemini vision, a per-file choice — the `workspace_ocr` feature)
 *   tokenCount   tokenMethod "tokenizer" (DeepSeek's offline tokenizer via Python), "estimate"
 *                (characters; used when the helper is missing) or "measured" (the real count
 *                DeepSeek returned once the file was sent, W-2) — D-#1230
 *   pinned       pinned files go into every message's cached prefix, in `order`
 *   sessionId    W-2: a file attached to ONE chat only (null = a project file)
 */
export const AI_FILE_STATUSES = ["processing", "ready", "failed"] as const;
export type AiFileStatus = (typeof AI_FILE_STATUSES)[number];
export const AI_TEXT_SOURCES = ["text", "tesseract", "gemini"] as const;
export type AiTextSource = (typeof AI_TEXT_SOURCES)[number];
export const AI_TOKEN_METHODS = ["tokenizer", "estimate", "measured"] as const;
export type AiTokenMethod = (typeof AI_TOKEN_METHODS)[number];

/** ~6 MB of Bangla UTF-8 — far above the 400k-token prefix limit, well under Mongo's 16 MB. */
export const AI_FILE_MAX_TEXT_CHARS = 2_000_000;

export interface IAiProjectFile extends Document {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  sessionId?: Types.ObjectId | null;
  name: string;
  mime: string;
  sizeBytes: number;
  storedFileId?: Types.ObjectId;
  status: AiFileStatus;
  /** Bangla, shown to the person when status is failed. */
  error?: string | null;
  text: string;
  textSource?: AiTextSource | null;
  /** Pages read (PDF) — shown so a partly read scan is visible. */
  pages?: number | null;
  tokenCount: number;
  tokenMethod?: AiTokenMethod | null;
  pinned: boolean;
  order: number;
  uploadedBy: Types.ObjectId;
  at: Date;
  updatedAt: Date;
}

const AiProjectFileSchema = new Schema<IAiProjectFile>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "AiProject", required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "AiAssistSession", default: null },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    mime: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    storedFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    status: { type: String, required: true, enum: AI_FILE_STATUSES },
    error: { type: String, default: null },
    text: { type: String, default: "" },
    textSource: { type: String, enum: [...AI_TEXT_SOURCES, null], default: null },
    pages: { type: Number, default: null },
    tokenCount: { type: Number, required: true, default: 0 },
    tokenMethod: { type: String, enum: [...AI_TOKEN_METHODS, null], default: null },
    pinned: { type: Boolean, required: true, default: true },
    order: { type: Number, required: true, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

AiProjectFileSchema.index({ projectId: 1, sessionId: 1, order: 1 });
AiProjectFileSchema.index({ storedFileId: 1 }, { sparse: true });

export const AiProjectFile = model<IAiProjectFile>("AiProjectFile", AiProjectFileSchema);
