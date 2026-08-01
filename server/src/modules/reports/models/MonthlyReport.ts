import { Schema, model, Document, Types } from "mongoose";

/**
 * MonthlyReport (MR-3, prd-monthly-report §7, D-#393) — ONE REVISION of one child's
 * month. The document, not a live view.
 *
 * **A revision is its own ROW.** A released revision must stay byte-stable while the
 * next one is being built, so revision N+1 is a new document beside it rather than an
 * edit of it — the unique key is `(studentId, periodKey, revision)`. At most one
 * revision per (student × month) may be RELEASED at a time; the service enforces that
 * and stamps the one it replaces SUPERSEDED.
 *
 * `snapshot` is FROZEN: the computed numbers, the cohort, the trends, the flags, AND
 * the MonthlyReportConfig that produced them (D-#395). A released report must stay
 * explicable after the Principal moves a threshold, so nothing here is re-derived at
 * read time — that is the whole point of the collection existing (contrast D-#85,
 * which governs LIVE reads, not issued documents).
 *
 * Identity plane (names a studentId) — no corpus path (ADR-005). No `schoolId`
 * (single school, D-#145).
 */
export const MONTHLY_REPORT_STATUSES = ["DRAFT", "READY", "RELEASED", "SUPERSEDED"] as const;
export type MonthlyReportStatus = (typeof MONTHLY_REPORT_STATUSES)[number];

/** One entry per thing that changed between this revision and the one before it —
 *  what the office reads to decide whether a re-release is worth making. */
export interface IReportChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ICommentDraft {
  text: string;
  /** The model that wrote it + the prompt it was written from — a bad batch has to
   *  be traceable to the prompt that produced it (D-#399). */
  model: string;
  promptVersion: string;
  promptHash: string;
  generatedAt: Date;
  /** True when the template fallback wrote it instead of the model. */
  fallback: boolean;
  /** WHY it fell back — surfaced to the reviewer, so a misconfigured model id is
   *  visible in the app rather than only in a server log. */
  fallbackReason?: string | null;
}

export interface IMonthlyReport extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  academicYearId?: Types.ObjectId | null;
  /** `YYYY-MM`. */
  periodKey: string;
  revision: number;
  status: MonthlyReportStatus;

  /** The frozen computed body (metrics + cohort + trends + flags + config). */
  snapshot: Record<string, unknown>;
  /** The instant the underlying data was read. */
  dataAsOf: Date;
  provisional: boolean;
  coveragePct: { homework: number | null; assignment: number | null; classTest: number | null };

  commentDraft?: ICommentDraft | null;
  /** What actually goes to the family — the reviewed text (D-#399). */
  commentFinal?: string | null;
  reviewedByUserId?: Types.ObjectId | null;
  reviewedAt?: Date | null;

  releasedAt?: Date | null;
  releasedByUserId?: Types.ObjectId | null;
  /** Set when this revision went out as part of a bulk release — one id per batch,
   *  so a wrong bulk release is revocable as a batch (D-#397). */
  releaseBatchId?: string | null;
  /** True when THIS revision replaced one the family had already seen. */
  isRerelease: boolean;

  /** Principal override of the coverage block, with its reason (D-#394). */
  gateOverrideReason?: string | null;
  gateOverriddenByUserId?: Types.ObjectId | null;
  /** Principal reopen after the hard lock, with its reason (D-#398). */
  unlockReason?: string | null;

  revokedAt?: Date | null;
  revokedByUserId?: Types.ObjectId | null;
  revokeReason?: string | null;

  changeLog: IReportChange[];
  createdAt: Date;
  updatedAt: Date;
}

const ReportChangeSchema = new Schema<IReportChange>(
  {
    field: { type: String, required: true },
    before: { type: String, default: null },
    after: { type: String, default: null },
  },
  { _id: false },
);

const CommentDraftSchema = new Schema<ICommentDraft>(
  {
    text: { type: String, required: true },
    model: { type: String, required: true },
    promptVersion: { type: String, required: true },
    promptHash: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    fallback: { type: Boolean, required: true, default: false },
    fallbackReason: { type: String, default: null },
  },
  { _id: false },
);

const MonthlyReportSchema = new Schema<IMonthlyReport>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    academicYearId: { type: Schema.Types.ObjectId, ref: "AcademicYear", default: null },
    periodKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    revision: { type: Number, required: true, min: 1 },
    status: { type: String, enum: MONTHLY_REPORT_STATUSES, required: true, default: "DRAFT" },

    snapshot: { type: Schema.Types.Mixed, required: true },
    dataAsOf: { type: Date, required: true },
    provisional: { type: Boolean, required: true, default: false },
    coveragePct: {
      homework: { type: Number, default: null },
      assignment: { type: Number, default: null },
      classTest: { type: Number, default: null },
    },

    commentDraft: { type: CommentDraftSchema, default: null },
    commentFinal: { type: String, default: null, trim: true },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    releasedAt: { type: Date, default: null },
    releasedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    releaseBatchId: { type: String, default: null },
    isRerelease: { type: Boolean, required: true, default: false },

    gateOverrideReason: { type: String, default: null, trim: true },
    gateOverriddenByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    unlockReason: { type: String, default: null, trim: true },

    revokedAt: { type: Date, default: null },
    revokedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revokeReason: { type: String, default: null, trim: true },

    changeLog: { type: [ReportChangeSchema], default: [] },
  },
  { timestamps: true },
);

// One row per revision — the race loser on a concurrent recompute fails loudly here
// rather than quietly writing a second "revision 2".
MonthlyReportSchema.index({ studentId: 1, periodKey: 1, revision: 1 }, { unique: true });
// The console reads a section's month; the guardian reads a child's released rows.
MonthlyReportSchema.index({ sectionId: 1, periodKey: 1, status: 1 });
MonthlyReportSchema.index({ studentId: 1, periodKey: -1, status: 1 });
MonthlyReportSchema.index({ releaseBatchId: 1 }, { sparse: true });

export const MonthlyReport = model<IMonthlyReport>("MonthlyReport", MonthlyReportSchema);
