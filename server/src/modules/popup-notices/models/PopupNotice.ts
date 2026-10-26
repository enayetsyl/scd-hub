/**
 * PopupNotice — a message the Office or the Principal composes once and the app shows
 * as a pop-up to a chosen audience of staff and/or guardians (D-#852, docs/prd-popup-notice.md).
 *
 * It generalises the D-#700 guardian announcement: that was one guardian-only row seeded
 * by a script, tracked per device. This row carries its own audience, close rules,
 * answer buttons and schedule, and every recipient's progress is a server row
 * (`PopupNoticeRecipient`), so "who has not seen it" is a true statement.
 *
 * WHY THE AUDIENCE IS FROZEN AT PUBLISH. The recipient rows are written once, when the
 * notice goes out (D-#853). A list that re-ran its filter on every read would make the
 * report's denominator move under the sender's feet; "add new matches" re-runs it on
 * purpose instead.
 *
 * Status is stored as DRAFT | PUBLISHED | WITHDRAWN. Scheduled / live / ended are
 * DERIVED from `startsAt` and `endsOn` against the clock, so nothing has to flip a
 * row at midnight.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const POPUP_TONES = ["info", "important", "urgent"] as const;
export type PopupTone = (typeof POPUP_TONES)[number];

/**
 *   once        shown on the next app open until done (a snooze or a reminder brings it back)
 *   daily       first app open of each school day, until done (the default)
 *   every_open  every app open until done
 *   window      first app open of each school day for the whole window, even after done (D-#700)
 */
export const POPUP_REPEATS = ["once", "daily", "every_open", "window"] as const;
export type PopupRepeat = (typeof POPUP_REPEATS)[number];

export const POPUP_ACTION_KINDS = ["ACK", "CHOICE", "OPEN_SCREEN", "OPEN_LINK"] as const;
export type PopupActionKind = (typeof POPUP_ACTION_KINDS)[number];

export const POPUP_STATUSES = ["DRAFT", "PUBLISHED", "WITHDRAWN"] as const;
export type PopupStatus = (typeof POPUP_STATUSES)[number];

export interface PopupRules {
  /** Closes by itself after N seconds (3–60). 0 = off. Never combined with a lock. */
  autoCloseSec: number;
  /** ✕ / "বন্ধ করুন" shown. Forced off when `mustAct`. */
  closeButton: boolean;
  /** Close stays locked until the end of the message has been on screen. */
  mustScrollToEnd: boolean;
  /** Close stays locked until it has been open in the foreground this long (5–300). 0 = off. */
  minReadSec: number;
  /** Only an action button closes it. */
  mustAct: boolean;
  /** "পরে মনে করিয়ে দিন" — closes for now, back on the next app open, at most `maxSnooze` times. */
  allowSnooze: boolean;
  maxSnooze: number;
  /** May a recipient change a CHOICE answer later (from আমার বার্তা) while the notice runs (D-#856). */
  allowAnswerChange: boolean;
}

export interface PopupAction {
  /** Stable id within the notice ("a1", "a2", …) — what an answer records. */
  id: string;
  kind: PopupActionKind;
  labelBn: string;
  labelEn: string;
  /** OPEN_SCREEN: an app route name; OPEN_LINK: an https URL. Empty otherwise. */
  target: string;
}

/** The audience, as the sender built it. Resolved to people only at publish. */
export interface PopupStaffFilter {
  /** Empty = every staff role. */
  roles: string[];
  /** "current" = probation + confirmed (owner, 2026-10-26); or exactly one of them. */
  employment: "current" | "probation" | "confirmed";
  /** Empty = any. Values "male" | "female". */
  genders: string[];
  /** Roster class levels (-1 Nursery, 0 KG, 1..5) the person teaches in the live routine. */
  classLevels: number[];
  /** ROUTINE_SUBJECTS codes the person teaches in the live routine. */
  subjects: string[];
  classTeachersOnly: boolean;
}

export interface PopupGuardianFilter {
  /** Empty with no sections = every class. */
  classLevels: number[];
  sectionIds: Types.ObjectId[];
}

export interface PopupAudience {
  staff?: PopupStaffFilter | null;
  guardian?: PopupGuardianFilter | null;
  /** Hand-picked staff logins (a custom list, D-#854). */
  userIds: Types.ObjectId[];
  /** Hand-picked families, by child: every active guardian linked to the child. */
  studentIds: Types.ObjectId[];
  /**
   * People taken OUT of the result by the sender's ✕ on the name list (owner, 2026-10-26):
   * "all teachers except these two". Applied after the union, so they stay out even when a
   * filter matches them. One list per recipient kind, because a guardian and a staff login
   * can share an id space only by accident, never by meaning.
   */
  excludeUserIds?: Types.ObjectId[];
  excludeGuardianIds?: Types.ObjectId[];
  /** Families with no guardian row (STUDENT recipients). */
  excludeStudentIds?: Types.ObjectId[];
}

export interface IPopupNotice extends Document {
  _id: Types.ObjectId;
  titleBn: string;
  bodyBn: string;
  titleEn: string;
  bodyEn: string;
  tone: PopupTone;
  attachmentUrl: string;
  audience: PopupAudience;
  /** The saved list this audience came from, if any (display only). */
  audienceListId?: Types.ObjectId;
  /** A Bangla one-line description of the audience, written when saved. */
  audienceSummary: string;
  rules: PopupRules;
  actions: PopupAction[];
  /** When it starts showing. Null on a draft means "on publish". */
  startsAt?: Date | null;
  /** Dhaka date key, inclusive. */
  endsOn: string;
  repeat: PopupRepeat;
  status: PopupStatus;
  /** Bumped on every content edit after publish. */
  version: number;
  recipientCount: number;
  /** Guardians in the audience with no app login (they cannot see a pop-up). */
  unreachableCount: number;
  publishedAt?: Date;
  publishedBy?: Types.ObjectId;
  withdrawnAt?: Date;
  withdrawnBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ActionSchema = new Schema<PopupAction>(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: POPUP_ACTION_KINDS, required: true },
    labelBn: { type: String, required: true, trim: true },
    labelEn: { type: String, default: "", trim: true },
    target: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const PopupNoticeSchema = new Schema<IPopupNotice>(
  {
    titleBn: { type: String, required: true, trim: true },
    bodyBn: { type: String, required: true },
    titleEn: { type: String, default: "", trim: true },
    bodyEn: { type: String, default: "" },
    tone: { type: String, enum: POPUP_TONES, default: "info" },
    attachmentUrl: { type: String, default: "", trim: true },
    audience: {
      staff: { type: Schema.Types.Mixed, default: null },
      guardian: {
        type: new Schema(
          {
            classLevels: [{ type: Number }],
            sectionIds: [{ type: Schema.Types.ObjectId, ref: "Section" }],
          },
          { _id: false },
        ),
        default: null,
      },
      userIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      studentIds: [{ type: Schema.Types.ObjectId, ref: "Student" }],
      excludeUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      excludeGuardianIds: [{ type: Schema.Types.ObjectId, ref: "Guardian" }],
      excludeStudentIds: [{ type: Schema.Types.ObjectId, ref: "Student" }],
    },
    audienceListId: { type: Schema.Types.ObjectId, ref: "PopupAudienceList" },
    audienceSummary: { type: String, default: "" },
    rules: {
      autoCloseSec: { type: Number, default: 0 },
      closeButton: { type: Boolean, default: true },
      mustScrollToEnd: { type: Boolean, default: false },
      minReadSec: { type: Number, default: 0 },
      mustAct: { type: Boolean, default: false },
      allowSnooze: { type: Boolean, default: false },
      maxSnooze: { type: Number, default: 2 },
      allowAnswerChange: { type: Boolean, default: false },
    },
    actions: { type: [ActionSchema], default: [] },
    startsAt: { type: Date, default: null },
    endsOn: { type: String, required: true },
    repeat: { type: String, enum: POPUP_REPEATS, default: "daily" },
    status: { type: String, enum: POPUP_STATUSES, default: "DRAFT" },
    version: { type: Number, default: 1 },
    recipientCount: { type: Number, default: 0 },
    unreachableCount: { type: Number, default: 0 },
    publishedAt: { type: Date },
    publishedBy: { type: Schema.Types.ObjectId, ref: "User" },
    withdrawnAt: { type: Date },
    withdrawnBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

/** The sender's list (newest first) and the live-notice lookup behind every app open. */
PopupNoticeSchema.index({ createdAt: -1, _id: -1 });
PopupNoticeSchema.index({ status: 1, endsOn: 1 });

export const PopupNotice = model<IPopupNotice>("PopupNotice", PopupNoticeSchema);
