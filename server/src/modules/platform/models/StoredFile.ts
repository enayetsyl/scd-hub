import { Schema, model, Document, Types } from "mongoose";

/**
 * StoredFile — metadata for an uploaded file (GP-A, D-#70): the app's FIRST
 * file capability. The bytes live in the school's Google Drive (the LIVE
 * store, D-#70 ruling); this row is the server-side handle.
 *
 * SECURITY (prd-guardian-portal §5): `driveFileId` is SERVER-INTERNAL. It is
 * never exposed in any GraphQL type or HTTP response — clients only ever see
 * this document's Mongo `_id` and stream bytes through `GET /files/:id`
 * (server-in-the-middle; no Drive URL or redirect ever reaches a client).
 *
 * Identity plane (an answer file is child PII, ADR-005): no corpus path, no
 * public URL, default-deny access via the per-kind read gate.
 *
 * GENERALIZED for chat attachments (M-4, prd-messaging §5): rather than a twin
 * `Attachment` model + storage path (the PRD §9 VM-disk proposal), chat
 * attachments REUSE this Drive-backed store — new `chat_*` kinds + an optional
 * `conversationId` (chat files only). The GP-A §9 reason for VM-disk (Atlas
 * GridFS can't hold 10 MB video) is moot: Drive already holds the bytes. The
 * `GET /files/:id` route dispatches the read gate by kind (hw → HomeworkFile,
 * chat → ChatFile membership, classtest → ClassTestFile Office/requesting-teacher).
 *
 * EXTENDED for class-test uploaded papers (CT-1, prd-tracker-class-test §5.2):
 * the same Drive-backed store gains a `classtest_question` kind (the M-4 pattern)
 * under the `SCD-Hub-Files/<year>/classtest/` subfolder — no twin store/route.
 */
export type StoredFileKind =
  | "hw_question"
  | "hw_answer"
  | "chat_image"
  | "chat_pdf"
  | "chat_video"
  | "chat_audio"
  | "classtest_question"
  | "comment_image"
  | "comment_pdf"
  | "comment_video"
  | "comment_audio"
  | "classnote_attachment"
  /** A document a teacher sent to the Office for printing (PQ-2, D-#281). */
  | "print_upload"
  /** An assignment sheet/instruction file attached at the delivery pass (D-#298). */
  | "assignment_attachment";

export const STORED_FILE_KINDS: readonly StoredFileKind[] = [
  "hw_question",
  "hw_answer",
  "chat_image",
  "chat_pdf",
  "chat_video",
  "chat_audio",
  "classtest_question",
  "comment_image",
  "comment_pdf",
  "comment_video",
  "comment_audio",
  "classnote_attachment",
  "print_upload",
  "assignment_attachment",
];

/** The chat-attachment subset (M-4) — the read gate routes these to chat. */
export const CHAT_STORED_FILE_KINDS: readonly StoredFileKind[] = [
  "chat_image",
  "chat_pdf",
  "chat_video",
  "chat_audio",
];

/** The student-comment attachment subset (CM-2) — the read gate routes these to
 *  the comment file gate (author OR the child's guardian for a DELIVERED comment). */
export const COMMENT_STORED_FILE_KINDS: readonly StoredFileKind[] = [
  "comment_image",
  "comment_pdf",
  "comment_video",
  "comment_audio",
];

export interface IStoredFile extends Document {
  _id: Types.ObjectId;
  kind: StoredFileKind;
  mime: string;
  sizeBytes: number;
  originalName: string;
  /** Google Drive file id — SERVER-INTERNAL, never serialized to a client. */
  driveFileId: string;
  uploadedBy: Types.ObjectId;
  uploadedAt: Date;
  /** Chat attachments only (M-4): the conversation the file was uploaded for —
   *  bound at upload (membership-gated) + matched at sendMessage. Unset for hw. */
  conversationId?: Types.ObjectId;
  /** Student-comment attachments only (CM-2): the comment the file is bound to —
   *  set at recordComment time so the read gate can resolve the child + delivery. */
  studentCommentId?: Types.ObjectId;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    kind: { type: String, enum: STORED_FILE_KINDS, required: true },
    mime: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    originalName: { type: String, required: true, trim: true },
    driveFileId: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, required: true, default: () => new Date() },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    studentCommentId: { type: Schema.Types.ObjectId, ref: "StudentComment" },
  },
  { timestamps: false, versionKey: false },
);

export const StoredFile = model<IStoredFile>("StoredFile", StoredFileSchema);
