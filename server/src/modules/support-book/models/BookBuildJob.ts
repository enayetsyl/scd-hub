/**
 * BookBuildJob — one render of a book, or part of one (SB-4, D-#407/#413/#417).
 *
 * A job is CLAIMED by a worker running in a SEPARATE PROCESS on the same VM: Chromium
 * is hundreds of MB per render and a 54-lesson book is minutes of work, so an OOM in a
 * book render must not take down attendance and homework.
 *
 * **Concurrency is 1** (D-#423). Two simultaneous Chromiums are the only realistic way
 * to pressure the host, and the VM carries no swap — real pressure means an OOM kill
 * rather than a slowdown. `claimNextJob` enforces it with an atomic findOneAndUpdate;
 * the state machine is what makes a killed worker recoverable rather than wedged.
 *
 * The four report fields mirror the pipeline's four frozen invariants (ASSEMBLY §2):
 * validator, geometry assert, text-fit guard, post-render font audit. Each exists
 * because it caught a real silent failure, so each is stored rather than collapsed
 * into a pass/fail.
 */
import { Schema, Types, type Document } from "mongoose";
import { BUILD_STATES, BUILD_SCOPES, type BuildState, type BuildScope } from "@scd/shared";
import { bookConnection } from "../../../bookDb";

export interface IBookBuildJob extends Document {
  _id: Types.ObjectId;
  bookId: string;
  scope: BuildScope;
  /** Empty for FULL; the chapter list for LESSON/RANGE. */
  lessonNos: number[];
  /** The render profiles to produce. ALL must pass or the job fails (ASSEMBLY §5). */
  profiles: string[];
  state: BuildState;
  queuedBy: Types.ObjectId;
  queuedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /** Set while RUNNING so a stuck job is identifiable; cleared on exit. */
  workerId?: string;
  validatorReport?: Record<string, unknown>;
  geometryReport?: string;
  fitGuardReport?: string;
  fontAuditReport?: string;
  /** The produced PDFs, as StoredFile handles. */
  outputs: Array<{ profile: string; storedFileId: Types.ObjectId }>;
  /** Full spawned-process output, also streamed live over SSE (D-#418). */
  log: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookBuildJobSchema = new Schema<IBookBuildJob>(
  {
    bookId: { type: String, required: true },
    scope: { type: String, enum: BUILD_SCOPES, required: true },
    lessonNos: { type: [Number], default: [] },
    profiles: { type: [String], default: [] },
    state: { type: String, enum: BUILD_STATES, required: true, default: "QUEUED" },
    queuedBy: { type: Schema.Types.ObjectId, required: true },
    queuedAt: { type: Date, required: true, default: () => new Date() },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    workerId: { type: String },
    validatorReport: { type: Schema.Types.Mixed },
    geometryReport: { type: String },
    fitGuardReport: { type: String },
    fontAuditReport: { type: String },
    outputs: {
      type: [{
        _id: false,
        profile: { type: String, required: true },
        storedFileId: { type: Schema.Types.ObjectId, required: true },
      }],
      default: [],
    },
    log: { type: String, default: "" },
    failureReason: { type: String },
  },
  { timestamps: true },
);

// The claim query — oldest QUEUED first.
BookBuildJobSchema.index({ state: 1, queuedAt: 1 });
// A book's build history, newest first.
BookBuildJobSchema.index({ bookId: 1, queuedAt: -1 });

export const BookBuildJob = bookConnection.model<IBookBuildJob>("BookBuildJob", BookBuildJobSchema);
