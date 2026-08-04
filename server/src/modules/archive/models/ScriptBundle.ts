/**
 * ScriptBundle (AR-1/AR-2, prd-script-archive §5, D-#443/#444) — ONE record per
 * archived test: that test's answer scripts, roll-sorted, cover sheet on top,
 * filed into a StorageBox. Bundle-per-test granularity — NO per-student rows
 * (roll order inside the bundle IS the per-student index).
 *
 *  - `source` is SOURCE-AGNOSTIC (D-#443): CLASS_TEST → ClassTest._id today;
 *    EXAM is reserved for the term-exam module (prd-exams.md EX-7 stage 13
 *    files into THIS archive when it builds — no second archival record).
 *  - Denormalized year/level/section/subject/testNumber/examDate are RESOLVED
 *    server-side from the source row at filing (the D-#143 posture), never
 *    client-supplied — they power browse + retention reads without cross-module
 *    joins.
 *  - The office acknowledgement is an ADDITIVE stamp, not a status (the
 *    CT-8/CO-8 publishedAt pattern); pending-ack = `acknowledgedAt == null`,
 *    derived. Auto-stamped when the filer already holds roster:manage.
 *  - Lifecycle FILED → (CHECKED_OUT ↔ FILED) → DISPOSED; VOID = filed-in-error,
 *    terminal, record kept (BookCopy WITHDRAWN posture). OVERDUE is computed
 *    from the open checkout's expectedReturnDateKey, never stored (D-#85).
 *  - `checkouts` is an embedded APPEND-ONLY array (the
 *    ClassTestQuestionRequest.rounds[] precedent) — the open checkout is the
 *    last element with `returnedAt == null`. Office desk action only (D-#444).
 *  - ONE live (non-VOID) bundle per source, enforced by a partial unique index
 *    from day one (the CT-11 lesson inverted: no pre-existing duplicates here).
 *  - D-#145: no schoolId. Operational/identity plane (ADR-005); no corpus path.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  ARCHIVE_SOURCE_KINDS,
  SCRIPT_BUNDLE_STATUSES,
  HW_SUBJECTS,
} from "@scd/shared";
import type { ArchiveSourceKind, ScriptBundleStatus, HwSubject } from "@scd/shared";

export interface IScriptCheckout {
  /** The staff member the bundle was handed to. */
  toUserId: Types.ObjectId;
  /** Why it left the box — mandatory (a log nobody fills is a log that lies). */
  purpose: string;
  /** YYYY-MM-DD; overdue is derived from this at read time, never stored. */
  expectedReturnDateKey?: string | null;
  checkedOutBy: Types.ObjectId;
  checkedOutAt: Date;
  returnedBy?: Types.ObjectId | null;
  returnedAt?: Date | null;
  returnNote?: string | null;
}

export interface IScriptBundle extends Document {
  _id: Types.ObjectId;
  source: { kind: ArchiveSourceKind; refId: Types.ObjectId };
  /** The source's HUMAN id (ClassTest.ctId, e.g. CT-C5-BAN-0001) — denormalized
   *  at filing because it is the retrieval key people type/search and it never
   *  changes on the source row. */
  sourceLabel: string;
  academicYearId: Types.ObjectId;
  classLevel: number;
  sectionId: Types.ObjectId;
  subject: HwSubject;
  testNumber: number;
  examDate: Date;
  /** Declared once by the filer (D-#444 — single actor, no two-signature count). */
  scriptCount: number;
  boxId: Types.ObjectId;
  filedBy: Types.ObjectId;
  filedAt: Date;
  acknowledgedBy?: Types.ObjectId | null;
  acknowledgedAt?: Date | null;
  status: ScriptBundleStatus;
  checkouts: IScriptCheckout[];
  /** archive_photo StoredFiles — a photo of the bundle / cover sheet. */
  attachmentFileIds: Types.ObjectId[];
  disposedBy?: Types.ObjectId | null;
  disposedAt?: Date | null;
  disposeReason?: string | null;
  voidedBy?: Types.ObjectId | null;
  voidedAt?: Date | null;
  voidReason?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CheckoutSchema = new Schema<IScriptCheckout>(
  {
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, required: true, trim: true },
    expectedReturnDateKey: { type: String, default: null },
    checkedOutBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    checkedOutAt: { type: Date, required: true },
    returnedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    returnedAt: { type: Date, default: null },
    returnNote: { type: String, default: null, trim: true },
  },
  { _id: false },
);

const ScriptBundleSchema = new Schema<IScriptBundle>(
  {
    source: {
      kind: { type: String, enum: ARCHIVE_SOURCE_KINDS, required: true },
      refId: { type: Schema.Types.ObjectId, required: true },
    },
    sourceLabel: { type: String, required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", required: true },
    classLevel: { type: Number, required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    subject: { type: String, enum: HW_SUBJECTS, required: true },
    testNumber: { type: Number, required: true },
    examDate: { type: Date, required: true },
    scriptCount: { type: Number, required: true, min: 1 },
    boxId: { type: Schema.Types.ObjectId, ref: "StorageBox", required: true },
    filedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    filedAt: { type: Date, required: true },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedAt: { type: Date, default: null },
    status: { type: String, enum: SCRIPT_BUNDLE_STATUSES, required: true, default: "FILED" },
    checkouts: { type: [CheckoutSchema], default: [] },
    attachmentFileIds: { type: [Schema.Types.ObjectId], ref: "StoredFile", default: [] },
    disposedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    disposedAt: { type: Date, default: null },
    disposeReason: { type: String, default: null, trim: true },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null, trim: true },
    notes: { type: String, default: null, trim: true },
  },
  { timestamps: true },
);

// ONE live bundle per test (D-#444): partial-unique over non-VOID rows, shipped
// day one. A VOID row frees the slot so the correcting re-file can land.
ScriptBundleSchema.index(
  { "source.kind": 1, "source.refId": 1 },
  { unique: true, partialFilterExpression: { status: { $ne: "VOID" } } },
);
// Box contents + derived fill counts.
ScriptBundleSchema.index({ boxId: 1, status: 1 });
// Browse / pending-ack / open-checkout scans.
ScriptBundleSchema.index({ status: 1, filedAt: -1 });
// Retention (disposable list) + class/subject browse.
ScriptBundleSchema.index({ academicYearId: 1, classLevel: 1, subject: 1 });

export const ScriptBundle = model<IScriptBundle>("ScriptBundle", ScriptBundleSchema);
