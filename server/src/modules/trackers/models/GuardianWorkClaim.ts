/**
 * GuardianWorkClaim (GC-1, D-#551..#554/#557) — "বাড়িতে সম্পন্ন হয়েছে".
 *
 * A guardian asserts that homework/assignment sitting at DUE or CHASE was in fact
 * done at home. The row is PARALLEL to the tracker and NEVER writes a lifecycle
 * state (D-#551): only a teacher moves a record to SUBMITTED. What this collection
 * records is the assertion, and whether anybody has answered it yet.
 *
 * ONE row type spans both trackers (owner ruling 2026-08-25) because
 * `HomeworkStudentRecord` and `AssignmentStudentRecord` are symmetric — `tracker`
 * says which collection `recordId` points into. There is deliberately no ref on
 * the field: mongoose cannot ref two collections conditionally, and the services
 * always know which tracker they are in.
 *
 * IDENTITY-BEARING (student + guardian), operational plane only. The corpus module
 * never imports this model and no analytics path joins it back — ADR-005 firewall
 * untouched, exactly like `HomeworkStudentRecord`.
 *
 * The one-open-claim invariant is a PARTIAL UNIQUE INDEX, not just a service
 * check (D-#553): two guardians of the same child tapping at the same moment is a
 * real race, and a service-level guard loses it.
 */
import { Schema, model, Document, Types } from "mongoose";
import {
  WORK_CLAIM_TRACKERS,
  WORK_CLAIM_STATUSES,
  WORK_CLAIM_REJECT_REASONS,
} from "@scd/shared";
import type {
  WorkClaimTracker,
  WorkClaimStatus,
  WorkClaimRejectReason,
} from "@scd/shared";

/** How a claim reached a terminal status — AUTO means the teacher's ordinary
 *  submit pass closed it without a second tap (D-#552). */
export const WORK_CLAIM_RESOLUTIONS = ["AUTO", "MANUAL"] as const;
export type WorkClaimResolution = (typeof WORK_CLAIM_RESOLUTIONS)[number];

export interface IGuardianWorkClaim extends Document {
  _id: Types.ObjectId;
  tracker: WorkClaimTracker;
  /** → HomeworkStudentRecord | AssignmentStudentRecord, per `tracker`. */
  recordId: Types.ObjectId;
  /** Denormalised human handle (hwId / assignment id) — shown on every surface. */
  workId: string;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  classId: Types.ObjectId;
  /** Denormalised so the Office queue reads at a glance without a second lookup. */
  subject: string;
  /** The record's due date at file time — context for the queue, NOT the clock. */
  dueDate?: Date;
  /** WHO must answer this — derived from the ROUTINE, not from issuedBy (BUG-WC-5).
   *  See ClaimRecipient.resolveClaimRecipient for the chain. */
  teacherId: Types.ObjectId;
  /** How the recipient was found: ROUTINE | CONFIRMER | CLASS_TEACHER | ISSUER.
   *  Stored so a mis-addressed claim can be explained rather than guessed at. */
  teacherSource?: string;
  claimedByGuardianId: Types.ObjectId;
  /** The portal logs in as a User; kept for the audit trail. */
  claimedByUserId: Types.ObjectId;
  claimedAt: Date;
  /**
   * THE ACTION DAY (D-#557) — `YYYY-MM-DD`, resolved ONCE at file time and stored.
   * The 11:30 / 13:00 rungs read this field and never re-derive it, so the ladder
   * cannot depend on when the ticker happened to run. It is the first school day
   * on which BOTH rungs still lie ahead: filed before 11:30 on a school day → that
   * day; filed at any other time → the next school day.
   */
  actionDateKey: string;
  /** Optional parent note, ≤200 chars ("খাতা ব্যাগে দিয়ে দিয়েছি"). */
  note?: string;
  status: WorkClaimStatus;
  /** 1 = the original, 2 = the single retry allowed after a rejection (D-#553). */
  attemptNumber: number;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  resolution?: WorkClaimResolution;
  /** Required when status is REJECTED — a picker value, never free text (D-#552). */
  rejectReason?: WorkClaimRejectReason;
  /** ≤200 chars; only meaningful (and only required) when rejectReason is OTHER. */
  rejectNote?: string;
  /** Rung idempotency — set once each, which is what makes the sweep restart-safe. */
  officeNotifiedAt?: Date;
  principalNotifiedAt?: Date;
  /** The Office nudge, rate-limited to once per claim per day (D-#554). */
  lastNudgedAt?: Date;
  nudgeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianWorkClaimSchema = new Schema<IGuardianWorkClaim>(
  {
    tracker: { type: String, enum: WORK_CLAIM_TRACKERS, required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    workId: { type: String, required: true, trim: true },
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: "Section", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "Class", required: true },
    subject: { type: String, required: true },
    dueDate: { type: Date },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    teacherSource: { type: String },
    claimedByGuardianId: { type: Schema.Types.ObjectId, ref: "Guardian", required: true },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    claimedAt: { type: Date, required: true },
    actionDateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    note: { type: String, trim: true, maxlength: 200 },
    status: { type: String, enum: WORK_CLAIM_STATUSES, required: true, default: "PENDING" },
    attemptNumber: { type: Number, required: true, default: 1, min: 1 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
    resolution: { type: String, enum: WORK_CLAIM_RESOLUTIONS },
    rejectReason: { type: String, enum: WORK_CLAIM_REJECT_REASONS },
    rejectNote: { type: String, trim: true, maxlength: 200 },
    officeNotifiedAt: { type: Date },
    principalNotifiedAt: { type: Date },
    lastNudgedAt: { type: Date },
    nudgeCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

/** A REJECTED row without a reason would make the Office queue unreadable and
 *  defeat the whole point of D-#552 — so the shape is enforced, not trusted. */
GuardianWorkClaimSchema.pre("validate", function (next) {
  if (this.status === "REJECTED" && !this.rejectReason) {
    next(new Error("GuardianWorkClaim: a REJECTED claim requires a rejectReason"));
    return;
  }
  if (this.rejectReason === "OTHER" && !this.rejectNote?.trim()) {
    next(new Error("GuardianWorkClaim: rejectReason OTHER requires a rejectNote"));
    return;
  }
  next();
});

// THE one-open-claim invariant (D-#553), enforced by the database.
GuardianWorkClaimSchema.index(
  { recordId: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } },
);
// The roster badge + "does this record have a claim" lookups.
GuardianWorkClaimSchema.index({ recordId: 1, status: 1 });
// The 11:30 / 13:00 sweep: open claims whose action day has arrived (D-#554/#557).
GuardianWorkClaimSchema.index({ status: 1, actionDateKey: 1 });
// The student's own history (guardian screen, student profile).
GuardianWorkClaimSchema.index({ studentId: 1, claimedAt: -1 });
// The teacher's Today card.
GuardianWorkClaimSchema.index({ teacherId: 1, status: 1, claimedAt: -1 });

export const GuardianWorkClaim = model<IGuardianWorkClaim>(
  "GuardianWorkClaim",
  GuardianWorkClaimSchema,
);
