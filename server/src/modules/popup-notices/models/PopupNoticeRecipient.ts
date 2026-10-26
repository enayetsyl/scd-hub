/**
 * PopupNoticeRecipient — one person's progress through one pop-up notice (D-#852/#855).
 *
 * Written once per (notice, person) at publish, then moved forward by the app's events.
 * `state` only ever moves forward (NOT_SEEN → SEEN → READ → ACTED), so a late or repeated
 * event from a second device cannot undo what the first one recorded. `doneAt` is
 * separate from `state`: an auto-close is DONE but only SEEN — the person was shown it,
 * not shown to have read it.
 *
 * `vars` is the personalisation snapshot ({নাম}, {সন্তান}, {শ্রেণি}) taken at publish,
 * so the message a guardian reads names their own child without a join on every open.
 *
 * `reachable: false` rows are guardians with no app login (and families with no guardian
 * at all, kind STUDENT). They can never see the pop-up; they exist so the report can
 * count them and hand the sender a wa.me list.
 *
 * Identity/operational plane; no corpus path (ADR-005).
 */
import { Schema, model, Document, Types } from "mongoose";

export const POPUP_RECIPIENT_KINDS = ["USER", "GUARDIAN", "STUDENT"] as const;
export type PopupRecipientKind = (typeof POPUP_RECIPIENT_KINDS)[number];

export const POPUP_STATES = ["NOT_SEEN", "SEEN", "READ", "ACTED"] as const;
export type PopupState = (typeof POPUP_STATES)[number];
export const POPUP_STATE_RANK: Record<PopupState, number> = { NOT_SEEN: 0, SEEN: 1, READ: 2, ACTED: 3 };

export const POPUP_CLOSE_METHODS = ["auto", "button", "action"] as const;
export type PopupCloseMethod = (typeof POPUP_CLOSE_METHODS)[number];

export interface PopupRecipientVars {
  name: string;
  /** Guardians: the matched children's names. Staff: empty. */
  childNames: string[];
  /** Guardians: the matched children's class + section labels. Staff: empty. */
  classLabels: string[];
  /** Report grouping: a guardian's first child's class label, or a staff role label. */
  group: string;
  /** For the wa.me list (guardians / families). */
  phone: string;
}

export interface IPopupNoticeRecipient extends Document {
  _id: Types.ObjectId;
  noticeId: Types.ObjectId;
  recipientKind: PopupRecipientKind;
  recipientId: Types.ObjectId;
  reachable: boolean;
  /** "Send to me first" rows — shown to the sender, never counted in a report. */
  test: boolean;
  vars: PopupRecipientVars;
  state: PopupState;
  doneAt?: Date | null;
  closeMethod?: PopupCloseMethod | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  /** Dhaka day key of the last showing — what "once a day" compares against. */
  lastShownDayKey: string;
  showCount: number;
  readAt?: Date | null;
  /** Longest foreground time any one showing stayed open, in ms. */
  readMs: number;
  choiceId?: string | null;
  actedAt?: Date | null;
  snoozeCount: number;
  /** A snooze or a sender's "remind" brings it back on the next open, whatever the repeat rule. */
  pending: boolean;
  deviceKinds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const PopupNoticeRecipientSchema = new Schema<IPopupNoticeRecipient>(
  {
    noticeId: { type: Schema.Types.ObjectId, ref: "PopupNotice", required: true },
    recipientKind: { type: String, enum: POPUP_RECIPIENT_KINDS, required: true },
    recipientId: { type: Schema.Types.ObjectId, required: true },
    reachable: { type: Boolean, default: true },
    test: { type: Boolean, default: false },
    vars: {
      name: { type: String, default: "" },
      childNames: [{ type: String }],
      classLabels: [{ type: String }],
      group: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    state: { type: String, enum: POPUP_STATES, default: "NOT_SEEN" },
    doneAt: { type: Date, default: null },
    closeMethod: { type: String, enum: [...POPUP_CLOSE_METHODS, null], default: null },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    lastShownDayKey: { type: String, default: "" },
    showCount: { type: Number, default: 0 },
    readAt: { type: Date, default: null },
    readMs: { type: Number, default: 0 },
    choiceId: { type: String, default: null },
    actedAt: { type: Date, default: null },
    snoozeCount: { type: Number, default: 0 },
    pending: { type: Boolean, default: false },
    deviceKinds: [{ type: String }],
  },
  { timestamps: true },
);

/** One row per person per notice; a test row lives beside a real one. */
PopupNoticeRecipientSchema.index({ noticeId: 1, recipientKind: 1, recipientId: 1, test: 1 }, { unique: true });
/** The read on every app open: "my rows that are still in play". */
PopupNoticeRecipientSchema.index({ recipientKind: 1, recipientId: 1, noticeId: 1 });
/** The report: one notice's rows by state. */
PopupNoticeRecipientSchema.index({ noticeId: 1, test: 1, state: 1 });

export const PopupNoticeRecipient = model<IPopupNoticeRecipient>("PopupNoticeRecipient", PopupNoticeRecipientSchema);
