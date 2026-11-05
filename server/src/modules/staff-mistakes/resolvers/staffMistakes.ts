/**
 * Staff mistake record (D-#936–#939, docs/prd-staff-mistakes.md).
 *
 *   myStaffMistakes        own entries (staff_mistakes:view_own, SELF)
 *   explainStaffMistake    own entry: a reason button + optional text (SELF)
 *   staffMistakes          anyone's entries / one staff file (staff_mistakes:view_all)
 *   staffMistakeQueue      entries waiting for a decision, minus the caller's own (review)
 *   decideStaffMistake     excuse / count / move (review)
 *   staffMistakeMoveTargets  the move picker (review)
 *
 * Each entry carries the source's detail: the নম্বর জমায় ভুল note for MARK_CORRECTION.
 */
import { builder } from "../../../schema";
import { resolveUserIdForStaff } from "../../hr/services/staffMatch";
import { NoteRef } from "../../trackers/resolvers/markSubmission";
import { markCorrectionNotesByIds, type MarkCorrectionNoteShape } from "../../trackers/services/MarkCorrectionService";
import {
  decideMistake,
  explainMistake,
  listMoveTargets,
  listStaffMistakes,
  type StaffMistakeShape,
} from "../services/StaffMistakeService";

type Row = StaffMistakeShape & { markNote: MarkCorrectionNoteShape | null };

/** Attach each entry's source detail in one batch per kind. */
async function withDetail(rows: StaffMistakeShape[]): Promise<Row[]> {
  const notes = await markCorrectionNotesByIds(
    rows.filter((r) => r.kind === "MARK_CORRECTION").map((r) => r.sourceId),
  );
  return rows.map((r) => ({ ...r, markNote: r.kind === "MARK_CORRECTION" ? (notes.get(r.sourceId) ?? null) : null }));
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

const StaffMistakeRef = builder.objectRef<Row>("StaffMistake").implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    staffUserId: t.exposeString("staffUserId"),
    staffName: t.exposeString("staffName"),
    kind: t.exposeString("kind"),
    tier: t.exposeInt("tier"),
    dateKey: t.exposeString("dateKey"),
    status: t.exposeString("status"),
    reasonCode: t.string({ nullable: true, resolve: (r) => r.reasonCode }),
    reasonText: t.string({ nullable: true, resolve: (r) => r.reasonText }),
    explainedAt: t.string({ nullable: true, resolve: (r) => iso(r.explainedAt) }),
    explainDueAt: t.string({ resolve: (r) => new Date(r.explainDueAt).toISOString() }),
    autoCounted: t.exposeBoolean("autoCounted"),
    decidedByName: t.string({ nullable: true, resolve: (r) => r.decidedByName }),
    decidedAt: t.string({ nullable: true, resolve: (r) => iso(r.decidedAt) }),
    decisionNote: t.string({ nullable: true, resolve: (r) => r.decisionNote }),
    movedFromName: t.string({ nullable: true, resolve: (r) => r.movedFromName }),
    movedToName: t.string({ nullable: true, resolve: (r) => r.movedToName }),
    createdAt: t.string({ resolve: (r) => new Date(r.createdAt).toISOString() }),
    markNote: t.field({ type: NoteRef, nullable: true, resolve: (r) => r.markNote }),
  }),
});

const MoveTargetRef = builder.objectRef<{ userId: string; name: string }>("StaffMistakeMoveTarget").implement({
  fields: (t) => ({
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
  }),
});

builder.queryField("myStaffMistakes", (t) =>
  t.field({
    type: [StaffMistakeRef],
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    resolve: async (_r, _a, ctx) => withDetail(await listStaffMistakes({ staffUserId: ctx.auth!.userId })),
  }),
);

builder.mutationField("explainStaffMistake", (t) =>
  t.field({
    type: StaffMistakeRef,
    authScopes: { hasPermission: "staff_mistakes:view_own" },
    args: {
      id: t.arg.string({ required: true }),
      reasonCode: t.arg.string({ required: true }),
      reasonText: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const self = ctx.auth!.userId;
      await explainMistake({ mistakeId: args.id, actorId: self, reasonCode: args.reasonCode, reasonText: args.reasonText ?? "" });
      const rows = await listStaffMistakes({ staffUserId: self });
      const row = rows.find((r) => r.id === args.id);
      if (!row) throw new Error("এন্ট্রিটি পাওয়া যায়নি।");
      return (await withDetail([row]))[0]!;
    },
  }),
);

builder.queryField("staffMistakes", (t) =>
  t.field({
    type: [StaffMistakeRef],
    // One staff file (staffProfileId) or the whole school.
    authScopes: { hasPermission: "staff_mistakes:view_all" },
    args: { staffProfileId: t.arg.string({ required: false }) },
    resolve: async (_r, args) => {
      if (args.staffProfileId) {
        const target = await resolveUserIdForStaff(args.staffProfileId);
        if (!target) return [];
        return withDetail(await listStaffMistakes({ staffUserId: target }));
      }
      return withDetail(await listStaffMistakes({}));
    },
  }),
);

builder.queryField("staffMistakeQueue", (t) =>
  t.field({
    type: [StaffMistakeRef],
    authScopes: { hasPermission: "staff_mistakes:review" },
    resolve: async (_r, _a, ctx) =>
      withDetail(
        await listStaffMistakes({
          statuses: ["PENDING_REVIEW", "EXPLANATION_DUE"],
          excludeStaffUserId: ctx.auth!.userId,
        }),
      ),
  }),
);

builder.mutationField("decideStaffMistake", (t) =>
  t.field({
    type: StaffMistakeRef,
    authScopes: { hasPermission: "staff_mistakes:review" },
    args: {
      id: t.arg.string({ required: true }),
      decision: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
      moveToUserId: t.arg.string({ required: false }),
    },
    resolve: async (_r, args, ctx) => {
      const row = await decideMistake({
        mistakeId: args.id,
        actorId: ctx.auth!.userId,
        actorRole: ctx.auth!.role,
        decision: args.decision,
        note: args.note,
        moveToUserId: args.moveToUserId,
      });
      const rows = await listStaffMistakes({ staffUserId: row.staffUserId.toString() });
      const shaped = rows.find((r) => r.id === args.id);
      if (!shaped) throw new Error("এন্ট্রিটি পাওয়া যায়নি।");
      return (await withDetail([shaped]))[0]!;
    },
  }),
);

builder.queryField("staffMistakeMoveTargets", (t) =>
  t.field({
    type: [MoveTargetRef],
    authScopes: { hasPermission: "staff_mistakes:review" },
    resolve: () => listMoveTargets(),
  }),
);
