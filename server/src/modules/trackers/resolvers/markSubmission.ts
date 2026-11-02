/**
 * Mark-submission guard (D-#889–#893, docs/prd-mark-submission-guard.md) — the Sunday
 * pop-ups and the staff file's "নম্বর জমায় ভুল" list.
 *
 *   myMarkReminder / acknowledgeMarkReminder       a teacher's own MORNING / NINE pop-up (SELF)
 *   myMarkEscalation / acknowledgeMarkEscalation   the 09:30 list (mark_submission:alerts)
 *   markCorrectionNotes                            own notes (SELF); anyone's needs view_notes
 */
import { callerHasPermission } from "@scd/shared";
import { builder } from "../../../schema";
import { resolveUserIdForStaff } from "../../hr/services/staffMatch";
import {
  acknowledgeMarkEscalation,
  acknowledgeMarkReminder,
  myMarkEscalation,
  myMarkReminder,
  type DueItemShape,
  type MarkEscalationRowShape,
  type MyMarkEscalationShape,
  type MyMarkReminderShape,
} from "../services/MarkReminderService";
import {
  listMarkCorrectionNotes,
  type MarkCorrectionNoteShape,
  type MarkCorrectionStudentShape,
} from "../services/MarkCorrectionService";

const DueItemRef = builder.objectRef<DueItemShape>("MarkDueItem").implement({
  fields: (t) => ({
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    sectionLabel: t.exposeString("sectionLabel"),
    marked: t.exposeBoolean("marked"),
  }),
});

const MyReminderRef = builder.objectRef<MyMarkReminderShape>("MyMarkReminder").implement({
  fields: (t) => ({
    stage: t.exposeString("stage"),
    dateKey: t.exposeString("dateKey"),
    items: t.field({ type: [DueItemRef], resolve: (r) => r.items }),
  }),
});

const EscalationRowRef = builder.objectRef<MarkEscalationRowShape>("MarkEscalationRow").implement({
  fields: (t) => ({
    asItemId: t.exposeString("asItemId"),
    asId: t.exposeString("asId"),
    subject: t.exposeString("subject"),
    sectionLabel: t.exposeString("sectionLabel"),
    teacherNames: t.exposeStringList("teacherNames"),
    markedNow: t.exposeBoolean("markedNow"),
  }),
});

const EscalationRef = builder.objectRef<MyMarkEscalationShape>("MyMarkEscalation").implement({
  fields: (t) => ({
    dateKey: t.exposeString("dateKey"),
    createdAt: t.string({ resolve: (e) => new Date(e.createdAt).toISOString() }),
    rows: t.field({ type: [EscalationRowRef], resolve: (e) => e.rows }),
  }),
});

const NoteStudentRef = builder.objectRef<MarkCorrectionStudentShape>("MarkCorrectionStudent").implement({
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    studentName: t.exposeString("studentName"),
    chasedAt: t.string({ resolve: (s) => new Date(s.chasedAt).toISOString() }),
    correctedAt: t.string({ resolve: (s) => new Date(s.correctedAt).toISOString() }),
    correctedByName: t.exposeString("correctedByName"),
    via: t.exposeString("via"),
  }),
});

const NoteRef = builder.objectRef<MarkCorrectionNoteShape>("MarkCorrectionNote").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    tracker: t.exposeString("tracker"),
    itemCode: t.exposeString("itemCode"),
    subject: t.exposeString("subject"),
    dateKey: t.exposeString("dateKey"),
    sectionLabel: t.exposeString("sectionLabel"),
    staffUserId: t.exposeString("staffUserId"),
    staffName: t.exposeString("staffName"),
    students: t.field({ type: [NoteStudentRef], resolve: (n) => n.students }),
    createdAt: t.string({ resolve: (n) => new Date(n.createdAt).toISOString() }),
  }),
});

builder.queryField("myMarkReminder", (t) =>
  t.field({
    type: MyReminderRef,
    nullable: true,
    // SELF: only the caller's own due-day assignments.
    authScopes: { hasPermission: "mark_submission:view_own" },
    resolve: (_r, _a, ctx) => myMarkReminder(ctx.auth!.userId),
  }),
);

builder.mutationField("acknowledgeMarkReminder", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "mark_submission:view_own" },
    args: { stage: t.arg.string({ required: true }) },
    resolve: (_r, args, ctx) => {
      if (args.stage !== "MORNING" && args.stage !== "NINE") throw new Error("অজানা ধাপ");
      return acknowledgeMarkReminder(ctx.auth!.userId, args.stage);
    },
  }),
);

builder.queryField("myMarkEscalation", (t) =>
  t.field({
    type: EscalationRef,
    nullable: true,
    authScopes: { hasPermission: "mark_submission:alerts" },
    resolve: (_r, _a, ctx) => myMarkEscalation(ctx.auth!.userId),
  }),
);

builder.mutationField("acknowledgeMarkEscalation", (t) =>
  t.field({
    type: "Boolean",
    authScopes: { hasPermission: "mark_submission:alerts" },
    resolve: (_r, _a, ctx) => acknowledgeMarkEscalation(ctx.auth!.userId),
  }),
);

builder.queryField("markCorrectionNotes", (t) =>
  t.field({
    type: [NoteRef],
    // SELF by default; someone else's file (or the whole school) needs view_notes.
    authScopes: { hasPermission: "mark_submission:view_own" },
    args: {
      staffProfileId: t.arg.string({ required: false }),
      all: t.arg.boolean({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const self = ctx.auth!.userId;
      const canAll = callerHasPermission(ctx.auth!, "mark_submission:view_notes");
      if (args.all) {
        if (!canAll) throw new Error("সবার জমার হিসাবের ভুল দেখার অনুমতি নেই");
        return listMarkCorrectionNotes({});
      }
      if (args.staffProfileId) {
        const target = await resolveUserIdForStaff(args.staffProfileId);
        if (!target) return [];
        if (target !== self && !canAll) throw new Error("অন্যের জমার হিসাবের ভুল দেখার অনুমতি নেই");
        return listMarkCorrectionNotes({ staffUserId: target });
      }
      return listMarkCorrectionNotes({ staffUserId: self });
    },
  }),
);
