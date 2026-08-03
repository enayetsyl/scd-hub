/**
 * Lesson CONTENT + per-item comments (SB-3b, D-#440).
 *
 * THE GAP THIS CLOSES: `SupportBookLesson` has stored `blocks` verbatim since SB-1, and
 * nothing exposed them. `supportBookLessons` returned `blockCount` — a NUMBER. So the
 * review screen offered a seven-item checklist over content no reviewer could read,
 * which is the "decorative checklist" failure the module's own design warns about.
 *
 * WHY BLOCKS COME BACK PART-TYPED AND PART-JSON. The model stores blocks exactly as the
 * schema defines them, on purpose: the renderer is frozen and reads those field names,
 * so a typed GraphQL mirror of every block field would be a SECOND contract to keep in
 * step with a file this repo does not own. Instead the three fields a reviewer reads —
 * `id`, `layout_hint`, `text_bn` — are typed, and `json` carries the whole block
 * verbatim. Nothing is hidden, and nothing is frozen twice. A new layout hint appears
 * in `json` on the day it is authored, with no schema change here.
 *
 * `compliance_note` is stripped from the slot payload for the same reason it is absent
 * from the illustrator's surface (README §5) — except here the reason is narrower: the
 * REVIEWER may see it, so it stays in `json` for slots. It is the illustrator's screen
 * that must not carry it, and that screen queries a different field.
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { ESCALATION_TARGETS, callerHasPermission, type EscalationTarget } from "@scd/shared";
import { SupportBookLesson } from "../models/SupportBookLesson";
import {
  addComment, resolveComment, listComments, CommentRuleError,
} from "../services/BookCommentService";
import { writeAudit } from "../../platform/services/AuditService";
import { isBookDbReady } from "../../../bookDb";

function actorId(ctx: AppContext): Types.ObjectId {
  if (!ctx.auth) throw new ForbiddenError("Unauthenticated");
  return new Types.ObjectId(ctx.auth.userId);
}
function assertBookPlane(): void {
  if (!isBookDbReady()) {
    throw new ForbiddenError("বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
  }
}

// ---------------------------------------------------------------------------
// Lesson content
// ---------------------------------------------------------------------------

interface BlockShape {
  id: string;
  layoutHint: string | null;
  textBn: string | null;
  json: string;
}
const BlockRef = builder.objectRef<BlockShape>("SupportBookBlock");
BlockRef.implement({
  description:
    "One content block of a পাঠ. The three fields a reviewer reads are typed; `json` " +
    "carries the block VERBATIM as the frozen renderer's schema defines it, so a new " +
    "layout hint needs no change here.",
  fields: (t) => ({
    id: t.exposeString("id"),
    layoutHint: t.exposeString("layoutHint", { nullable: true }),
    textBn: t.exposeString("textBn", { nullable: true }),
    json: t.exposeString("json"),
  }),
});

interface ContentSlotShape {
  id: string;
  sceneDescription: string | null;
  imageClass: string | null;
  aspect: string | null;
  json: string;
}
const ContentSlotRef = builder.objectRef<ContentSlotShape>("SupportBookContentSlot");
ContentSlotRef.implement({
  description:
    "An image slot AS THE REVIEWER SEES IT — in reading order among the blocks, so " +
    "'the picture does not match the text' is a judgement they can actually make.",
  fields: (t) => ({
    id: t.exposeString("id"),
    sceneDescription: t.exposeString("sceneDescription", { nullable: true }),
    imageClass: t.exposeString("imageClass", { nullable: true }),
    aspect: t.exposeString("aspect", { nullable: true }),
    json: t.exposeString("json"),
  }),
});

interface LessonContentShape {
  bookId: string;
  lessonNo: number;
  nctbTitleBn: string | null;
  state: string;
  action: string | null;
  severity: string | null;
  bwTreatment: string | null;
  policySetHash: string | null;
  blocks: BlockShape[];
  imageSlots: ContentSlotShape[];
}
const LessonContentRef = builder.objectRef<LessonContentShape>("SupportBookLessonContent");
LessonContentRef.implement({
  description: "One পাঠ WITH ITS CONTENT — what a reviewer actually reads.",
  fields: (t) => ({
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    nctbTitleBn: t.exposeString("nctbTitleBn", { nullable: true }),
    state: t.exposeString("state"),
    action: t.exposeString("action", { nullable: true }),
    severity: t.exposeString("severity", { nullable: true }),
    bwTreatment: t.exposeString("bwTreatment", { nullable: true }),
    policySetHash: t.exposeString("policySetHash", { nullable: true }),
    blocks: t.field({ type: [BlockRef], resolve: (l) => l.blocks }),
    imageSlots: t.field({ type: [ContentSlotRef], resolve: (l) => l.imageSlots }),
  }),
});

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

builder.queryField("supportBookLessonContent", (t) =>
  t.field({
    type: LessonContentRef,
    nullable: true,
    description:
      "ONE পাঠ with its blocks and image slots — the reviewer's read. Deliberately " +
      "single-lesson: a 54-lesson book is 764 KB of JSON, and shipping all of it to " +
      "render one page would be slow for everyone to serve nobody. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), lessonNo: t.arg.int({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const l = await SupportBookLesson.findOne({ bookId: args.bookId, lessonNo: args.lessonNo }).lean();
      if (!l) return null;
      return {
        bookId: l.bookId,
        lessonNo: l.lessonNo,
        nctbTitleBn: l.nctbTitleBn ?? null,
        state: l.state,
        action: l.action ?? null,
        severity: l.severity ?? null,
        bwTreatment: l.bwTreatment ?? null,
        policySetHash: l.policySetHash ?? null,
        blocks: (l.blocks ?? []).map((raw) => {
          const b = raw as Record<string, unknown>;
          return {
            // A block with no id cannot be commented on or cited, so it gets a
            // positional fallback rather than being dropped — a reviewer must still
            // be able to READ it, and silently hiding content is the worse failure.
            id: str(b.id) ?? "",
            layoutHint: str(b.layout_hint),
            textBn: str(b.text_bn),
            json: JSON.stringify(b),
          };
        }),
        imageSlots: (l.imageSlots ?? []).map((raw) => {
          const s = raw as Record<string, unknown>;
          return {
            id: str(s.id) ?? "",
            sceneDescription: str(s.scene_description),
            imageClass: str(s.image_class),
            aspect: str(s.aspect),
            json: JSON.stringify(s),
          };
        }),
      };
    },
  }),
);

// ---------------------------------------------------------------------------
// Per-item comments
// ---------------------------------------------------------------------------

interface CommentShape {
  commentId: string;
  bookId: string;
  lessonNo: number;
  target: string;
  targetId: string | null;
  body: string;
  authorId: string;
  resolved: boolean;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}
const CommentRef = builder.objectRef<CommentShape>("SupportBookItemComment");
CommentRef.implement({
  description:
    "A reviewer's note on one item. RESOLVABLE, and an unresolved one blocks sign-off " +
    "(D-#440) — a note nobody has to answer is a note that gets skipped. Resolving " +
    "edits nothing; the text still changes only through a validated patch.",
  fields: (t) => ({
    commentId: t.exposeString("commentId"),
    bookId: t.exposeString("bookId"),
    lessonNo: t.exposeInt("lessonNo"),
    target: t.exposeString("target"),
    targetId: t.exposeString("targetId", { nullable: true }),
    body: t.exposeString("body"),
    authorId: t.exposeString("authorId"),
    resolved: t.exposeBoolean("resolved"),
    resolutionNote: t.exposeString("resolutionNote", { nullable: true }),
    resolvedBy: t.exposeString("resolvedBy", { nullable: true }),
    resolvedAt: t.string({ nullable: true, resolve: (c) => c.resolvedAt?.toISOString() ?? null }),
    createdAt: t.string({ resolve: (c) => c.createdAt.toISOString() }),
  }),
});

const toComment = (c: Record<string, unknown>): CommentShape => ({
  commentId: String(c._id),
  bookId: String(c.bookId),
  lessonNo: Number(c.lessonNo),
  target: String(c.target),
  targetId: (c.targetId as string | null) ?? null,
  body: String(c.body),
  authorId: String(c.authorId),
  resolved: !!c.resolved,
  resolutionNote: (c.resolutionNote as string | null) ?? null,
  resolvedBy: c.resolvedBy ? String(c.resolvedBy) : null,
  resolvedAt: (c.resolvedAt as Date) ?? null,
  createdAt: c.createdAt as Date,
});

builder.queryField("supportBookComments", (t) =>
  t.field({
    type: [CommentRef],
    description:
      "Review notes on a book or one পাঠ, oldest first — a thread reads forwards. " +
      "Open-only by default: the open ones are the work. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: false }),
      openOnly: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args) => {
      assertBookPlane();
      const rows = await listComments({
        bookId: args.bookId,
        lessonNo: args.lessonNo ?? undefined,
        openOnly: args.openOnly ?? undefined,
      });
      return rows.map((c) => toComment(c as unknown as Record<string, unknown>));
    },
  }),
);

builder.mutationField("commentOnSupportBookItem", (t) =>
  t.field({
    type: CommentRef,
    description:
      "Leave a note on a block, a slot, or the whole পাঠ. The ORDINARY reviewer→author " +
      "channel — an escalation is the exceptional one, for what a reviewer cannot rule " +
      "on themselves. Requires book:review.",
    authScopes: { hasPermission: "book:review" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: true }),
      target: t.arg.string({ required: true }),
      body: t.arg.string({ required: true }),
      targetId: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!(ESCALATION_TARGETS as readonly string[]).includes(args.target)) {
        throw new ForbiddenError(`unknown comment target: ${args.target}`);
      }
      const c = await addComment({
        bookId: args.bookId,
        lessonNo: args.lessonNo,
        target: args.target as EscalationTarget,
        targetId: args.targetId ?? null,
        body: args.body,
        authorId: actor,
      });
      return toComment(c as unknown as Record<string, unknown>);
    },
  }),
);

builder.mutationField("resolveSupportBookComment", (t) =>
  t.field({
    type: CommentRef,
    description:
      "Mark a note dealt with. Changes NO lesson field — the text moves only through a " +
      "validated patch (D-#410/#440). `book:author` resolves their own fixes; a " +
      "reviewer may close a note they decided against. Requires book:author or " +
      "book:review.",
    // EITHER side of the channel may close a note — the author resolves what they
    // fixed, the reviewer withdraws what they thought better of; restricting it to one
    // side leaves the other stuck. Declared as a scope rather than checked inside the
    // resolver: a `book:read` field gate with the real rule in the body reads as an
    // ungated mutation, and the static resolver-gate guard caught exactly that.
    authScopes: { hasAnyPermission: ["book:author", "book:review"] },
    args: {
      commentId: t.arg.string({ required: true }),
      resolutionNote: t.arg.string({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      const c = await resolveComment({
        commentId: new Types.ObjectId(args.commentId),
        resolvedBy: actor,
        resolutionNote: args.resolutionNote ?? undefined,
      });
      await writeAudit({
        eventKind: "BOOK_COMMENT_RESOLVED",
        actorId: actor,
        actorRole: ctx.auth?.role,
        targetKind: "BookItemComment",
        targetId: c._id,
        meta: { bookId: c.bookId, lessonNo: c.lessonNo, target: c.target, targetId: c.targetId ?? null },
      });
      return toComment(c as unknown as Record<string, unknown>);
    },
  }),
);

export { CommentRuleError };
