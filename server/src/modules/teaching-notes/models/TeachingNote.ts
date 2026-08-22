/**
 * TeachingNote — one TEACHER-FACING pedagogy document for a (class × subject):
 * "how to answer a Class 5 Bangla long question", a chapter helper note, a
 * subject syllabus (TN-1, prd-teaching-notes, D-#513–#516).
 *
 * NOT curriculum content: no envelope, no import contract, no ContentArtifact,
 * no corpus path (ADR-005). This is an operational-plane STAFF library —
 * guardians and students have no resolver and no file-gate path to it.
 *
 * SHAPE BORROWED WHOLESALE from `EnglishDriveDoc` (D-#344), which solved the
 * same problem one axis narrower: a versioned document library where an upload
 * of an existing identity REPLACES the previous row (old row stamped
 * `replacedAt`, never deleted) and reads take the unreplaced row. Two
 * deliberate widenings:
 *
 *   1. `subject` is a real axis. English Drive is English-only; this library
 *      covers every ROUTINE_SUBJECT (incl. ARABIC/ISLAM/QURAN) — reused, not
 *      mirrored, because it is the same operational subject question about the
 *      same subjects, and a second enum saying those words is a second contract
 *      to keep in step for no benefit. No wire twin, no verifier change.
 *   2. `classLevel` is the ROSTER axis (−1..5), not the content axis (1..5).
 *      Nursery and KG are taught and their teachers need notes too; the content
 *      envelope's 1..5 is about authored curriculum, which this is not.
 *
 * `kind` is a module-local enum with no shared-vocab twin — the routine/HR shape
 * (D-#46/#52), like ENGLISH_DRIVE_KINDS and HW_NIL_REASONS before it.
 */
import { Schema, model, Document, Types } from "mongoose";
import type { RoutineSubject } from "@scd/shared";
import { ROSTER_CLASS_LEVEL_MIN, ROSTER_CLASS_LEVEL_MAX } from "@scd/shared";

export const TEACHING_NOTE_KINDS = [
  /** How to answer this subject's exam questions — structure, point-picking, worked types. */
  "ANSWER_GUIDE",
  /** A teaching/lesson helper note for the subject. */
  "LESSON_NOTE",
  /** The subject's syllabus / scheme of work. */
  "SYLLABUS",
  "OTHER",
] as const;
export type TeachingNoteKind = (typeof TEACHING_NOTE_KINDS)[number];

/** How the body is stored — MD = markdown in `contentMd` (the primary path:
 *  searchable, diff-able, renders + prints without a round trip); PDF/DOCX = a
 *  binary StoredFile referenced by `fileId`, opened via GET /files/:id. */
export const TEACHING_NOTE_FORMATS = ["MD", "PDF", "DOCX"] as const;
export type TeachingNoteFormat = (typeof TEACHING_NOTE_FORMATS)[number];

/** Upload cap for one markdown note (the English Drive cap). */
export const TEACHING_NOTE_MD_MAX_BYTES = 1024 * 1024;

export interface ITeachingNote extends Document {
  _id: Types.ObjectId;
  /** Roster axis: −1 = Nursery, 0 = KG, 1..5 = One..Five. */
  classLevel: number;
  subject: RoutineSubject;
  kind: TeachingNoteKind;
  /** Sequence within (class × subject × kind) — several notes of one kind. */
  seq: number;
  title: string;
  /** Monotonic per identity, SERVER-ASSIGNED (prev.version + 1). */
  version: number;
  format: TeachingNoteFormat;
  /** The full markdown source (≤ 1 MB) — set for MD, empty for PDF/DOCX. */
  contentMd: string;
  /** The binary StoredFile (kind `teaching_note`) for PDF/DOCX; null for MD.
   *  Always the ORIGINAL upload (the .docx for a DOCX note) — the download. */
  fileId?: Types.ObjectId | null;
  /** For a DOCX note: the LibreOffice-converted PDF — what previews and prints.
   *  Null for PDF (fileId already IS the pdf), for MD, and on a failed convert. */
  pdfFileId?: Types.ObjectId | null;
  fileName?: string | null;
  fileMime?: string | null;
  uploadedBy: Types.ObjectId;
  /** Stamped when a newer upload of the same identity replaced this row. */
  replacedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeachingNoteSchema = new Schema<ITeachingNote>(
  {
    classLevel: {
      type: Number,
      min: ROSTER_CLASS_LEVEL_MIN,
      max: ROSTER_CLASS_LEVEL_MAX,
      required: true,
    },
    subject: { type: String, required: true },
    kind: { type: String, enum: TEACHING_NOTE_KINDS, required: true },
    seq: { type: Number, required: true, min: 1, default: 1 },
    title: { type: String, required: true, trim: true },
    version: { type: Number, required: true, min: 1 },
    format: { type: String, enum: TEACHING_NOTE_FORMATS, required: true, default: "MD" },
    contentMd: { type: String, default: "" },
    fileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    pdfFileId: { type: Schema.Types.ObjectId, ref: "StoredFile", default: null },
    fileName: { type: String, default: null },
    fileMime: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    replacedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The library list ("the latest of every (class, subject, kind, seq)") is the hot read.
TeachingNoteSchema.index({ classLevel: 1, subject: 1, kind: 1, seq: 1, replacedAt: 1 });
// The file read-gate reverse-resolves the owning note by StoredFile id.
TeachingNoteSchema.index({ fileId: 1 }, { sparse: true });
TeachingNoteSchema.index({ pdfFileId: 1 }, { sparse: true });

export const TeachingNote = model<ITeachingNote>("TeachingNote", TeachingNoteSchema);
