/**
 * Parents'-meeting slot answers (D-#840–#843, docs/prd-meeting-rsvp.md).
 *
 *   myMeetingSlots / respondToMeetingSlot — GUARDIAN plane (`guardian:read_child`); the
 *     service scopes to the caller's own linked children by Guardian id.
 *   reviewMeetingChange — `parents_meeting:approve_change` (PRINCIPAL_DEFAULT; the
 *     Principal turns it on for the Vice Principal).
 *   meetingResponseSummary — `parents_meeting:view`.
 *
 * Identity plane; no corpus path (ADR-005).
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import {
  myMeetingSlots,
  respondToMeetingSlot,
  reviewMeetingChange,
  meetingResponseSummary,
  type GuardianMeetingAsk,
  type MeetingTimeChoice,
  type ReviewMeetingChangeResult,
  type MeetingResponseSummary,
} from "../services/MeetingResponseService";
import { MeetingSlotResponseRef } from "./parentMeeting";

const MeetingTimeChoiceRef = builder.objectRef<MeetingTimeChoice>("MeetingTimeChoice");
MeetingTimeChoiceRef.implement({
  description: "Another family's slot, as a time only (never the family) — option 2 of the answer.",
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    slotTime: t.exposeInt("slotTime"),
  }),
});

const GuardianMeetingAskRef = builder.objectRef<GuardianMeetingAsk>("GuardianMeetingAsk");
GuardianMeetingAskRef.implement({
  description:
    "The guardian's family slot in a dispatched, not-yet-past parents' meeting, with the family's answer " +
    "(null = not answered → the pop-up asks) and the other times it may ask for (D-#840/#841).",
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    meetingId: t.exposeString("meetingId"),
    instanceLabel: t.exposeString("instanceLabel"),
    meetingDate: t.exposeString("meetingDate"),
    slotTime: t.int({ nullable: true, resolve: (a) => a.slotTime }),
    onCall: t.exposeBoolean("onCall"),
    childNames: t.exposeStringList("childNames"),
    classLabels: t.exposeStringList("classLabels"),
    response: t.field({ type: MeetingSlotResponseRef, nullable: true, resolve: (a) => a.response }),
    rescheduledAt: t.string({ nullable: true, resolve: (a) => a.rescheduledAt }),
    choices: t.field({ type: [MeetingTimeChoiceRef], resolve: (a) => a.choices }),
  }),
});

const ReviewMeetingChangeResultRef = builder.objectRef<ReviewMeetingChangeResult>("ReviewMeetingChangeResult");
ReviewMeetingChangeResultRef.implement({
  fields: (t) => ({
    slotId: t.exposeString("slotId"),
    outcome: t.exposeString("outcome"),
    movedSlotId: t.string({ nullable: true, resolve: (r) => r.movedSlotId }),
    mutual: t.exposeBoolean("mutual"),
  }),
});

const MeetingResponseSummaryRef = builder.objectRef<MeetingResponseSummary>("MeetingResponseSummary");
MeetingResponseSummaryRef.implement({
  description: "Derived answer counts for a meeting (D-#843).",
  fields: (t) => ({
    meetingId: t.exposeString("meetingId"),
    total: t.exposeInt("total"),
    confirmed: t.exposeInt("confirmed"),
    changePending: t.exposeInt("changePending"),
    changeApproved: t.exposeInt("changeApproved"),
    changeDeclined: t.exposeInt("changeDeclined"),
    cantCome: t.exposeInt("cantCome"),
    noAnswer: t.exposeInt("noAnswer"),
  }),
});

// ---------------------------------------------------------------------------
// Guardian plane
// ---------------------------------------------------------------------------

builder.queryField("myMeetingSlots", (t) =>
  t.field({
    type: [GuardianMeetingAskRef],
    description:
      "The caller's family slots in dispatched parents' meetings dated today or later (Asia/Dhaka). " +
      "An entry with response = null is unanswered — the app asks with a pop-up (D-#841).",
    authScopes: { hasPermission: "guardian:read_child" },
    resolve: async (_root, _args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return myMeetingSlots(ctx.auth.userId as string);
    },
  }),
);

builder.mutationField("respondToMeetingSlot", (t) =>
  t.field({
    type: GuardianMeetingAskRef,
    description:
      "Answer the family's slot once: CONFIRMED, CHANGE_REQUESTED (+ preferredSlotId, another timed slot of " +
      "the same meeting) or CANT_COME (+ optional reason). Final — a second answer is refused (D-#840).",
    authScopes: { hasPermission: "guardian:read_child" },
    args: {
      slotId: t.arg.string({ required: true }),
      choice: t.arg.string({ required: true }),
      preferredSlotId: t.arg.string({ required: false }),
      reason: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return respondToMeetingSlot({
        slotId: args.slotId,
        guardianId: ctx.auth.userId as string,
        choice: args.choice,
        preferredSlotId: args.preferredSlotId,
        reason: args.reason,
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

builder.mutationField("reviewMeetingChange", (t) =>
  t.field({
    type: ReviewMeetingChangeResultRef,
    description:
      "Approve (swap the requesting family with the family at the wanted time) or decline a change request. " +
      "Requires parents_meeting:approve_change. Audited (D-#842).",
    authScopes: { hasPermission: "parents_meeting:approve_change" },
    args: {
      slotId: t.arg.string({ required: true }),
      approve: t.arg.boolean({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
      return reviewMeetingChange(args.slotId, args.approve, args.note, ctx.auth.userId as string);
    },
  }),
);

builder.queryField("meetingResponseSummary", (t) =>
  t.field({
    type: MeetingResponseSummaryRef,
    description: "Answer counts for a meeting (confirmed / change pending·approved·declined / can't come / no answer).",
    authScopes: { hasPermission: "parents_meeting:view" },
    args: { meetingId: t.arg.string({ required: true }) },
    resolve: async (_root, args) => meetingResponseSummary(args.meetingId),
  }),
);
