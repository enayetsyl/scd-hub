/**
 * Storybook waitlist resolvers (SB-3, D-#982/#990, docs/prd-storybook-reading.md).
 *
 * Join / leave: `guardian:read_child` (the guardian's own child — link-checked) or
 * `library:lend` (the desk adding a child in person — librarian-gated); both checked in
 * StoryWaitlistService. The child's waits: guardian or staff shelf readers. A book's queue
 * with names: the desk only (`library:lend`).
 */
import { builder } from "../../../schema";
import { ROSTER_CLASS_LABELS_BN, type RosterClassLevel } from "@scd/shared";
import { Student } from "../../foundation/models/Student";
import { Class } from "../../foundation/models/Class";
import { BookReservation } from "../models/BookReservation";
import { assertIsLibrarian } from "../services/LibrarianService";
import { childStoryWaits, joinStoryWaitlist, leaveStoryWaitlist, type ChildWait } from "../services/StoryWaitlistService";

const ChildWaitRef = builder.objectRef<ChildWait>("StoryChildWait");
ChildWaitRef.implement({
  description: "One storybook a child is waiting for — position 0 = held at the office now.",
  fields: (t) => ({
    titleId: t.string({ resolve: (w) => w.title._id.toString() }),
    titleBn: t.string({ resolve: (w) => w.title.titleBn }),
    seriesNo: t.int({ nullable: true, resolve: (w) => w.title.seriesNo ?? null }),
    seriesNameBn: t.string({ nullable: true, resolve: (w) => w.seriesNameBn }),
    coverFileId: t.string({ nullable: true, resolve: (w) => w.title.coverFileId?.toString() ?? null }),
    status: t.string({ resolve: (w) => w.reservation.status }),
    position: t.exposeInt("position"),
    holdUntil: t.string({ nullable: true, resolve: (w) => (w.reservation.status === "READY" && w.reservation.expiresAt ? new Date(w.reservation.expiresAt).toISOString() : null) }),
  }),
});

interface QueueRow {
  studentId: string;
  name: string;
  classLabelBn: string;
  status: string;
  position: number;
  holdUntil: string | null;
}
const QueueRowRef = builder.objectRef<QueueRow>("StoryQueueRow");
QueueRowRef.implement({
  description: "One child in a storybook's queue (desk view).",
  fields: (t) => ({
    studentId: t.exposeString("studentId"),
    name: t.exposeString("name"),
    classLabelBn: t.exposeString("classLabelBn"),
    status: t.exposeString("status"),
    position: t.exposeInt("position"),
    holdUntil: t.string({ nullable: true, resolve: (r) => r.holdUntil }),
  }),
});

builder.mutationField("joinStoryWaitlist", (t) =>
  t.field({
    type: "Boolean",
    description: "Put a child in the queue for a storybook that is out (guardian for their child, or the desk). Max 2 waits a child.",
    authScopes: { hasAnyPermission: ["guardian:read_child", "library:lend"] },
    args: { studentId: t.arg.string({ required: true }), titleId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await joinStoryWaitlist(ctx, args.studentId, args.titleId);
      return true;
    },
  }),
);

builder.mutationField("leaveStoryWaitlist", (t) =>
  t.field({
    type: "Boolean",
    description: "Take a child out of a storybook's queue (a held copy passes to the next child).",
    authScopes: { hasAnyPermission: ["guardian:read_child", "library:lend"] },
    args: { studentId: t.arg.string({ required: true }), titleId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await leaveStoryWaitlist(ctx, args.studentId, args.titleId);
      return true;
    },
  }),
);

builder.queryField("childStoryWaits", (t) =>
  t.field({
    type: [ChildWaitRef],
    description: "The storybooks a child is waiting for, held ones first (W4).",
    authScopes: { hasAnyPermission: ["library:view", "guardian:read_child"] },
    args: { studentId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => childStoryWaits(ctx, args.studentId),
  }),
);

builder.queryField("storyTitleQueue", (t) =>
  t.field({
    type: [QueueRowRef],
    description: "Desk: the children waiting for one storybook, in order (held first).",
    authScopes: { hasPermission: "library:lend" },
    args: { titleId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      await assertIsLibrarian(ctx, "library:lend");
      const rows = await BookReservation.find({ titleId: args.titleId, status: { $in: ["READY", "QUEUED"] }, studentId: { $exists: true } })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const students = await Student.find({ _id: { $in: rows.map((r) => r.studentId) } }).select("name nameBn classId").lean();
      const classes = await Class.find({ _id: { $in: students.map((s) => s.classId) } }).select("level").lean();
      const sById = new Map(students.map((s) => [s._id.toString(), s]));
      const lvl = new Map(classes.map((c) => [c._id.toString(), c.level as number]));
      let place = 0;
      const out = rows.map((r) => {
        const s = sById.get(r.studentId!.toString());
        const level = s ? lvl.get(s.classId.toString()) : undefined;
        const position = r.status === "READY" ? 0 : ++place;
        return {
          studentId: r.studentId!.toString(),
          name: s ? s.nameBn || s.name : "—",
          classLabelBn: level === undefined ? "" : ROSTER_CLASS_LABELS_BN[level as RosterClassLevel] ?? String(level),
          status: r.status,
          position,
          holdUntil: r.status === "READY" && r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        };
      });
      return out.sort((a, b) => a.position - b.position);
    },
  }),
);
