import { Schema, model, Document, Types } from "mongoose";
import { NOTIFICATION_KINDS } from "@scd/shared";
import type { NotificationKind } from "@scd/shared";

/**
 * A per-recipient notification row (N-1, D-#72): the inbox IS this collection.
 * Recipient is EXACTLY ONE of a staff `User` or a `Guardian` (login-enabled —
 * contact-only guardians have no inbox, the recorded D-#31/D-#72 limitation).
 *
 * Append + markRead ONLY — no edit, no delete (the service exposes nothing else).
 * `dedupeKey` is the idempotency contract: one row per key, ever; a duplicate
 * emit() is a silent no-op (N1.1), which also makes the D-#73 scheduler
 * restart-safe in N-2.
 *
 * Identity-plane (names recipients) behind the ADR-005 firewall — the corpus
 * plane never imports this model and no analytics/export path joins it back
 * to a student/guardian (N5.1).
 */
export interface NotificationRefs {
  /** Class-note publish (deep-link: DailyNote). */
  classNoteId?: string;
  slotId?: string;
  /** Local-date key YYYY-MM-DD (school calendar day, same convention as attendance). */
  date?: string;
  groupType?: string;
  groupId?: string;
  /** HW parent-comms (deep-link: HomeworkHome). */
  hwItemId?: string;
  studentId?: string;
  sectionId?: string;
  /** Review assigned (deep-link: ReviewSubmit). */
  reviewAssignmentId?: string;
  artifactId?: string;
  /** Cover assigned (deep-link: MyRoutine). */
  substitutionId?: string;
  /** Print job delivered (deep-link: PrintHome; PQ-5, D-#281). */
  printRequestId?: string;
  /** Exam custody + report-card publish (deep-link: ExamHome; EX-8/EX-9, D-#382). */
  examId?: string;
  examPaperId?: string;
  /** Library due-soon/overdue reminders (deep-link: LibraryHome; LB-5, D-#84). */
  loanId?: string;
  /** Overdue ladder rung (1 = first school day after due, then every 3rd). */
  rung?: number;
  /** Bell reminder (N-2): which grid + period the bell is for (deep-link: BellSchedule). */
  audienceKey?: string;
  periodNumber?: number;
  /** Attendance reminder tier (N-2/D-#99: T1210 | T1245 | T1400). */
  tier?: string;
  /** Class-note ladder/escalation rung hour (12/13/14 prompt; 15/16 escalation). */
  hour?: number;
  /** Vocab guardian result (deep-link: GuardianVocab; VC-4, D-#154). */
  vocabTestId?: string;
  /** Class-test guardian result (deep-link: GuardianTestResults; CT-3, D-#160). */
  classTestId?: string;
  /** Daily student-comment delivery (deep-link: GuardianComments; CM-2, D-#172). */
  studentCommentId?: string;
  /** Parents'-meeting timing notice (deep-link: GuardianMeetingSlot; CM-4, D-#176). */
  parentMeetingId?: string;
  meetingSlotId?: string;
  /** Classroom-observation release / response / escalation (deep-link: ObservationDetail; CO-3). */
  observationId?: string;
  teacherId?: string;
  /** Escalation ladder rung: REMINDER_1 | REMINDER_2 | PRINCIPAL_FLAG (CO-3). */
  stage?: string;
  /** Calendar days since the observation was released (CO-3 escalation). */
  daysSince?: number;
  /** Saturday-revision delivery (deep-link: GuardianRevision; SR-2, D-#244). */
  revisionEntryId?: string;
  /** Consecutive-absence escalation streak length + flag (SR-2, D-#245). */
  streakLength?: number;
  escalation?: boolean;
  /** CT question-request loop (deep-link: MyCtQuestions / CtQuestionQueue; D-#342). */
  ctQuestionRequestId?: string;
  /** CT-8 submit/approve loop — the human CT_ID carried alongside classTestId
   *  (deep-link: ClassTestDashboard / ClassTestHome). */
  ctId?: string;
  /** Staff leave submitted → approver (deep-link: the Staff leave inbox; owner 2026-07-26). */
  leaveApplicationId?: string;
}

export interface INotification extends Document {
  _id: Types.ObjectId;
  /** Staff recipient — exactly one of the two recipient fields is set. */
  recipientUserId?: Types.ObjectId;
  /** Guardian recipient — exactly one of the two recipient fields is set. */
  recipientGuardianId?: Types.ObjectId;
  kind: NotificationKind;
  titleBn: string;
  bodyBn: string;
  refs?: NotificationRefs;
  /** Idempotency key — unique forever; duplicate emit = silent no-op (N1.1). */
  dedupeKey: string;
  /** Set once by markRead; never cleared (append + markRead only). */
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RefsSchema = new Schema<NotificationRefs>(
  {
    classNoteId: { type: String },
    slotId: { type: String },
    date: { type: String },
    groupType: { type: String },
    groupId: { type: String },
    hwItemId: { type: String },
    studentId: { type: String },
    sectionId: { type: String },
    reviewAssignmentId: { type: String },
    artifactId: { type: String },
    substitutionId: { type: String },
    loanId: { type: String },
    examId: { type: String },
    examPaperId: { type: String },
    rung: { type: Number },
    audienceKey: { type: String },
    periodNumber: { type: Number },
    tier: { type: String },
    hour: { type: Number },
    vocabTestId: { type: String },
    classTestId: { type: String },
    studentCommentId: { type: String },
    parentMeetingId: { type: String },
    meetingSlotId: { type: String },
    observationId: { type: String },
    teacherId: { type: String },
    stage: { type: String },
    daysSince: { type: Number },
    revisionEntryId: { type: String },
    streakLength: { type: Number },
    escalation: { type: Boolean },
    // D-#342 CT question loop (was missing from the sub-schema — mongoose silently
    // stripped it from stored rows) + the CT-8 submit/approve loop's human CT_ID.
    ctQuestionRequestId: { type: String },
    ctId: { type: String },
    leaveApplicationId: { type: String },
  },
  { _id: false },
);

const NotificationSchema = new Schema<INotification>(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User" },
    recipientGuardianId: { type: Schema.Types.ObjectId, ref: "Guardian" },
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true },
    titleBn: { type: String, required: true, trim: true },
    bodyBn: { type: String, required: true, trim: true },
    refs: { type: RefsSchema, default: {} },
    dedupeKey: { type: String, required: true },
    readAt: { type: Date },
  },
  { timestamps: true },
);

/** The exactly-one-recipient invariant (D-#72), shared by every guard site.
 *  Returns true for a user recipient, false for a guardian recipient. */
export function assertExactlyOneRecipient(label: string, userId: unknown, guardianId: unknown): boolean {
  const hasUser = !!userId;
  if (hasUser === !!guardianId) {
    throw new Error(`${label}: exactly one of a user / guardian recipient is required`);
  }
  return hasUser;
}

// Guards direct create()/save() paths only — emit()'s updateOne-upsert bypasses
// document validation (Mongoose), so emit() asserts the same invariant itself.
NotificationSchema.pre("validate", function (next) {
  try {
    assertExactlyOneRecipient("Notification", this.recipientUserId, this.recipientGuardianId);
    next();
  } catch (err) {
    next(err as Error);
  }
});

// The idempotency contract (N1.1) + the two own-row inbox listings (N1.2).
// The readAt composites cover the hot unread paths (myUnreadCount badge +
// unreadOnly listing) — without readAt in the key, those scan every row the
// recipient has ever received.
NotificationSchema.index({ dedupeKey: 1 }, { unique: true });
NotificationSchema.index({ recipientUserId: 1, createdAt: -1 });
NotificationSchema.index({ recipientGuardianId: 1, createdAt: -1 });
NotificationSchema.index({ recipientUserId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ recipientGuardianId: 1, readAt: 1, createdAt: -1 });

export const Notification = model<INotification>("Notification", NotificationSchema);
