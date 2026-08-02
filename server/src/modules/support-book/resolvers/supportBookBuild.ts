/**
 * Assembly resolvers (SB-4, D-#407/#413/#417).
 *
 * `book:assemble` queues and reads; the gate override is PRINCIPAL-only, because
 * building over a known-stale artifact is a judgement about what reaches print rather
 * than a routine action, and it is recorded either way (never silent).
 */
import { Types } from "mongoose";
import { builder } from "../../../schema";
import type { AppContext } from "../../../context";
import { ForbiddenError } from "../../../middleware/authz";
import { BUILD_SCOPES, type BuildScope } from "@scd/shared";
import { BookBuildJob } from "../models/BookBuildJob";
import { assemblyGate, queueBuild, materializeBookJson } from "../services/BookBuildService";
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

interface GateShape { ok: boolean; reasons: string[] }
const GateRef = builder.objectRef<GateShape>("SupportBookAssemblyGate");
GateRef.implement({
  description:
    "Whether a render is worth starting, and every reason it is not — ALL of them at " +
    "once, because fixing one blocker only to be told about the next is the worst " +
    "version of a gate.",
  fields: (t) => ({
    ok: t.exposeBoolean("ok"),
    reasons: t.exposeStringList("reasons"),
  }),
});

interface JobShape {
  jobId: string; bookId: string; scope: string; lessonNos: number[]; profiles: string[];
  state: string; queuedAt: Date; startedAt: Date | null; finishedAt: Date | null;
  failureReason: string | null; outputFileIds: string[]; log: string;
}
const JobRef = builder.objectRef<JobShape>("SupportBookBuildJob");
JobRef.implement({
  description:
    "One render. Every job's PDFs stay downloadable, so an older render is never lost " +
    "— with 100 TB of pooled Drive quota there is no reason to prune one.",
  fields: (t) => ({
    jobId: t.exposeString("jobId"),
    bookId: t.exposeString("bookId"),
    scope: t.exposeString("scope"),
    lessonNos: t.exposeIntList("lessonNos"),
    profiles: t.exposeStringList("profiles"),
    state: t.exposeString("state"),
    queuedAt: t.string({ resolve: (j) => j.queuedAt.toISOString() }),
    startedAt: t.string({ nullable: true, resolve: (j) => j.startedAt?.toISOString() ?? null }),
    finishedAt: t.string({ nullable: true, resolve: (j) => j.finishedAt?.toISOString() ?? null }),
    failureReason: t.exposeString("failureReason", { nullable: true }),
    outputFileIds: t.exposeStringList("outputFileIds"),
    log: t.exposeString("log"),
  }),
});

const toJob = (j: Record<string, unknown>): JobShape => ({
  jobId: String(j._id),
  bookId: String(j.bookId),
  scope: String(j.scope),
  lessonNos: (j.lessonNos ?? []) as number[],
  profiles: (j.profiles ?? []) as string[],
  state: String(j.state),
  queuedAt: j.queuedAt as Date,
  startedAt: (j.startedAt as Date) ?? null,
  finishedAt: (j.finishedAt as Date) ?? null,
  failureReason: (j.failureReason as string) ?? null,
  outputFileIds: ((j.outputs ?? []) as Array<{ storedFileId: unknown }>).map((o) => String(o.storedFileId)),
  log: String(j.log ?? ""),
});

builder.queryField("supportBookAssemblyGate", (t) =>
  t.field({
    type: GateRef,
    description: "Preview the gate WITHOUT queueing — what would stop this build. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), lessonNos: t.arg.intList({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      return assemblyGate(args.bookId, args.lessonNos ?? []);
    },
  }),
);

builder.queryField("supportBookBuildJobs", (t) =>
  t.field({
    type: [JobRef],
    description: "A book's render history, newest first. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), limit: t.arg.int({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const rows = await BookBuildJob.find({ bookId: args.bookId })
        .sort({ queuedAt: -1 })
        .limit(Math.min(args.limit ?? 25, 100))
        .lean();
      return rows.map((j) => toJob(j as unknown as Record<string, unknown>));
    },
  }),
);

builder.queryField("supportBookExportJson", (t) =>
  t.field({
    type: "String",
    description:
      "The book folder's `book.json`, materialized from the lesson rows — the export " +
      "escape hatch (D-#406). The app must never become the only way to build a book. " +
      "Requires book:assemble.",
    authScopes: { hasPermission: "book:assemble" },
    args: { bookId: t.arg.string({ required: true }), lessonNos: t.arg.intList({ required: false }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      const json = await materializeBookJson(args.bookId, args.lessonNos ?? []);
      return JSON.stringify(json, null, 2);
    },
  }),
);

builder.mutationField("queueSupportBookBuild", (t) =>
  t.field({
    type: JobRef,
    description:
      "Queue a render (per-chapter, range or full). Refuses on a failed gate; `force` " +
      "overrides it and is PRINCIPAL-only, recorded on the job and in the timeline. " +
      "Requires book:assemble.",
    authScopes: { hasPermission: "book:assemble" },
    args: {
      bookId: t.arg.string({ required: true }),
      scope: t.arg.string({ required: true }),
      lessonNos: t.arg.intList({ required: false }),
      force: t.arg.boolean({ required: false }),
    },
    resolve: async (_root, args, ctx) => {
      assertBookPlane();
      const actor = actorId(ctx);
      if (!(BUILD_SCOPES as readonly string[]).includes(args.scope)) {
        throw new ForbiddenError(`unknown build scope: ${args.scope}`);
      }
      // Overriding the gate decides what reaches print — a role property, not a grant
      // AC-1 could hand to anyone.
      const force = !!args.force && ctx.auth?.role === "PRINCIPAL";
      if (args.force && !force) {
        throw new ForbiddenError("গেট override শুধু প্রিন্সিপাল করতে পারেন");
      }
      const job = await queueBuild({
        bookId: args.bookId,
        scope: args.scope as BuildScope,
        lessonNos: args.lessonNos ?? [],
        queuedBy: actor,
        force,
      });
      await writeAudit({
        eventKind: "BOOK_BUILD_QUEUED", actorId: actor, actorRole: ctx.auth?.role,
        targetKind: "BookBuildJob", targetId: job._id,
        meta: { bookId: args.bookId, scope: args.scope, lessonNos: args.lessonNos ?? [], forced: force },
      });
      return toJob(job as unknown as Record<string, unknown>);
    },
  }),
);
