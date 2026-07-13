import { Schema, model, Document, Types } from "mongoose";
import type { PrintColour, PrintPurpose, PrintRequestStatus, PrintSides, PrintSource } from "@scd/shared";

/**
 * PrintRequest (PQ-1, D-#281) — ONE queue for everything the Office prints.
 *
 * Generalizes the Class Test tracker's built-in print request (a `ClassTest` is
 * literally born as one, `REQUESTED → PRINTED`). Two things change:
 *
 *   1. **The missing `DELIVERED` state.** The Office tracks three buckets — yet to
 *      print, printing done, delivered to the teacher — so the machine is
 *      `REQUESTED → PRINTED → DELIVERED` (+ `CANCELLED`). No in-progress state.
 *   2. **Four sources, not two.** `sourceType` selects EXACTLY ONE of `setId`,
 *      `contentArtifactId`, `fileIds[]` or `linkUrl` (validated below, the
 *      `StudentAttendanceDay` XOR pattern).
 *
 * NO PDF snapshot is stored. `GET /pdf/set/:id` refuses a set that is not
 * `assembled`, and an assembled set is LOCKED (add/remove is draft-only, D-#276),
 * so a bare `setId` is already immutable in content. An upload is its own snapshot.
 * A link is external by nature. Every source is therefore a reference by id —
 * exactly as `ClassTest` does today.
 *
 * Gates (D-#281, no new permission): teachers submit under `tracker:write`; the
 * Office/Principal operate the queue under `roster:manage`.
 *
 * Operational/identity plane (names a requester) — no corpus path (ADR-005).
 */
export interface IPrintRequest extends Document {
  _id: Types.ObjectId;
  title: string;
  purpose: PrintPurpose;
  sourceType: PrintSource;

  /** EXACTLY ONE of the four, per `sourceType`. */
  setId?: Types.ObjectId;
  contentArtifactId?: Types.ObjectId;
  fileIds?: Types.ObjectId[];
  linkUrl?: string;

  /** How to print it. MANDATORY on a teacher's request (the Office cannot start a job
   *  without them); defaulted for the internal class-test path and back-filled rows. */
  colour: PrintColour;
  sides: PrintSides;
  /** Set when this job IS a class-test paper (PQ-5) — the ClassTest keeps its own
   *  lifecycle (results, publish), but its PRINTING lives here. Not a `sourceType`. */
  classTestId?: Types.ObjectId;

  copies: number;
  /** D-#294: how `copies` is determined. FIXED = the teacher typed a number (default,
   *  all pre-existing rows). CLASS_PRESENT = print one per student PRESENT in
   *  `copiesClassId` on the day the print is USED (`neededByKey`) — resolved live
   *  from attendance when the Office views/prints, finalized onto `copies` at
   *  markPrinted (live count, or a manual count while attendance is pending). */
  copiesMode: "FIXED" | "CLASS_PRESENT";
  copiesClassId?: Types.ObjectId;
  /** Local date the print will be USED, `YYYY-MM-DD`. Mandatory on a teacher's
   *  request; drives the CLASS_PRESENT attendance lookup (D-#294). */
  neededByKey?: string;
  classId?: Types.ObjectId;
  sectionId?: Types.ObjectId;
  subject?: string;
  notes?: string;

  status: PrintRequestStatus;
  requestedBy: Types.ObjectId;
  requestedAt: Date;
  printedBy?: Types.ObjectId;
  printedAt?: Date;
  deliveredBy?: Types.ObjectId;
  deliveredAt?: Date;
  cancelledBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const PrintRequestSchema = new Schema<IPrintRequest>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    purpose: { type: String, required: true },
    sourceType: { type: String, required: true },

    setId: { type: Schema.Types.ObjectId, ref: "AssessmentSet" },
    contentArtifactId: { type: Schema.Types.ObjectId, ref: "ContentArtifact" },
    fileIds: [{ type: Schema.Types.ObjectId, ref: "StoredFile" }],
    linkUrl: { type: String, trim: true },

    // Defaults keep the internal class-test path and migration-backfilled rows valid;
    // the SERVICE enforces them as mandatory on a teacher-submitted request.
    colour: { type: String, required: true, default: "BW" },
    sides: { type: String, required: true, default: "SINGLE" },
    classTestId: { type: Schema.Types.ObjectId, ref: "ClassTest" },

    copies: { type: Number, required: true, min: 1, max: 1000, default: 1 },
    copiesMode: { type: String, enum: ["FIXED", "CLASS_PRESENT"], required: true, default: "FIXED" },
    copiesClassId: { type: Schema.Types.ObjectId, ref: "Class" },
    neededByKey: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    classId: { type: Schema.Types.ObjectId, ref: "Class" },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section" },
    subject: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    status: { type: String, required: true, default: "REQUESTED" },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedAt: { type: Date, required: true },
    printedBy: { type: Schema.Types.ObjectId, ref: "User" },
    printedAt: { type: Date },
    deliveredBy: { type: Schema.Types.ObjectId, ref: "User" },
    deliveredAt: { type: Date },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

/** The source discriminator and its payload must agree — exactly one is set. */
PrintRequestSchema.pre("validate", function (next) {
  const present = [
    this.sourceType === "SET" && !!this.setId,
    this.sourceType === "CONTENT_ARTIFACT" && !!this.contentArtifactId,
    this.sourceType === "UPLOAD" && (this.fileIds?.length ?? 0) > 0,
    this.sourceType === "LINK" && !!this.linkUrl,
  ];
  if (present.filter(Boolean).length !== 1) {
    next(new Error(`PrintRequest source '${this.sourceType}' has no matching payload`));
    return;
  }
  // Guard against a second payload smuggled alongside the declared one.
  const set = [this.setId, this.contentArtifactId, this.linkUrl].filter(Boolean).length;
  const uploads = (this.fileIds?.length ?? 0) > 0 ? 1 : 0;
  if (set + uploads !== 1) {
    next(new Error("PrintRequest requires exactly one source payload"));
    return;
  }
  next();
});

// The Office queue: one status bucket, oldest request first.
PrintRequestSchema.index({ status: 1, requestedAt: 1 });
// A teacher's own list.
PrintRequestSchema.index({ requestedBy: 1, requestedAt: -1 });

export const PrintRequest = model<IPrintRequest>("PrintRequest", PrintRequestSchema);
