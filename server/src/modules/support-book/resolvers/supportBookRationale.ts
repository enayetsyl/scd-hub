/**
 * Rationale resolvers (SB-5, D-#403/#404/#411).
 *
 * The editorial log has been written since SB-1; what was missing was the three reads
 * that make it usable:
 *
 *   1. **Per-item** timelines — the `targetType`/`targetId` index existed but nothing
 *      queried it, so "why does THIS BLOCK read this way" was unanswerable even though
 *      the data was there.
 *   2. **Policy text at a hash** — every event carries a `policySetHash`, but without
 *      resolution that stamp proves only that two things shared a policy, never what
 *      the policy said. That is the whole of D-#403 sitting behind one lookup.
 *   3. **Actor names** — a timeline of "actor 6512ab…" is not a record anyone can
 *      read, and reading it years later is the point.
 */
import { builder } from "../../../schema";
import { ForbiddenError } from "../../../middleware/authz";
import { ESCALATION_TARGETS, type EscalationTarget } from "@scd/shared";
import { BookEvent } from "../models/BookEvent";
import { resolvePolicySet } from "../services/PolicySetService";
import { resolveActors } from "../services/BookActorService";
import { isBookDbReady } from "../../../bookDb";

function assertBookPlane(): void {
  if (!isBookDbReady()) {
    throw new ForbiddenError("বই-প্রোডাকশন ডেটাবেস কনফিগার করা হয়নি (BOOK_MONGODB_URI)");
  }
}

interface RationaleEntryShape {
  kind: string; summary: string; reason: string | null; at: Date;
  lessonNo: number | null; targetType: string | null; targetId: string | null;
  actorId: string; actorName: string; actorKnown: boolean;
  policySetHash: string | null;
}
const EntryRef = builder.objectRef<RationaleEntryShape>("SupportBookRationaleEntry");
EntryRef.implement({
  description:
    "One row of the editorial record, with the actor RESOLVED to a name — the only " +
    "place a book read crosses to identity, by id, at the resolver layer (D-#404).",
  fields: (t) => ({
    kind: t.exposeString("kind"),
    summary: t.exposeString("summary"),
    reason: t.exposeString("reason", { nullable: true }),
    at: t.string({ resolve: (e) => e.at.toISOString() }),
    lessonNo: t.exposeInt("lessonNo", { nullable: true }),
    targetType: t.exposeString("targetType", { nullable: true }),
    targetId: t.exposeString("targetId", { nullable: true }),
    actorId: t.exposeString("actorId"),
    actorName: t.exposeString("actorName"),
    actorKnown: t.exposeBoolean("actorKnown"),
    policySetHash: t.exposeString("policySetHash", { nullable: true }),
  }),
});

interface PolicyMemberShape { docKey: string; version: number; body: string; supersededSince: Date | null }
const PolicyMemberRef = builder.objectRef<PolicyMemberShape>("SupportBookPolicyMember");
PolicyMemberRef.implement({
  description:
    "One document of a policy set, AS IT WAS. `supersededSince` is set when this " +
    "version is no longer active — the case where quoting today's text would mislead.",
  fields: (t) => ({
    docKey: t.exposeString("docKey"),
    version: t.exposeInt("version"),
    body: t.exposeString("body"),
    supersededSince: t.string({ nullable: true, resolve: (m) => m.supersededSince?.toISOString() ?? null }),
  }),
});

interface ResolvedSetShape {
  hash: string; bookId: string; firstSeenAt: Date; missing: string[]; members: PolicyMemberShape[];
}
const ResolvedSetRef = builder.objectRef<ResolvedSetShape>("SupportBookResolvedPolicySet");
ResolvedSetRef.implement({
  description:
    "What a policySetHash REFERS TO: the exact document versions and their text. This " +
    "is what makes 'why is পাঠ 40 written this way' answerable with the policy as it " +
    "stood that day rather than as it reads now (D-#403).",
  fields: (t) => ({
    hash: t.exposeString("hash"),
    bookId: t.exposeString("bookId"),
    firstSeenAt: t.string({ resolve: (s) => s.firstSeenAt.toISOString() }),
    missing: t.exposeStringList("missing"),
    members: t.field({ type: [PolicyMemberRef], resolve: (s) => s.members }),
  }),
});

/** Shared shaping: rows → entries with actor names filled in one batched lookup. */
async function toEntries(rows: Array<Record<string, unknown>>): Promise<RationaleEntryShape[]> {
  const names = await resolveActors(rows.map((r) => String(r.actorId)));
  return rows.map((e) => {
    const id = String(e.actorId);
    const who = names.get(id);
    const refs = (e.refs ?? {}) as Record<string, unknown>;
    return {
      kind: String(e.kind),
      summary: String(e.summary),
      reason: (e.reason as string) ?? null,
      at: e.at as Date,
      lessonNo: (e.lessonNo as number) ?? null,
      targetType: (e.targetType as string) ?? null,
      targetId: (e.targetId as string) ?? null,
      actorId: id,
      actorName: who?.name ?? "(unknown account)",
      actorKnown: who?.known ?? false,
      policySetHash: (refs.policySetHash as string) ?? null,
    };
  });
}

builder.queryField("supportBookItemRationale", (t) =>
  t.field({
    type: [EntryRef],
    description:
      "Why ONE ITEM reads the way it does — a block or an image slot, oldest first so " +
      "the story reads forwards. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: {
      bookId: t.arg.string({ required: true }),
      target: t.arg.string({ required: true }),
      targetId: t.arg.string({ required: true }),
    },
    resolve: async (_root, args) => {
      assertBookPlane();
      if (!(ESCALATION_TARGETS as readonly string[]).includes(args.target)) {
        throw new ForbiddenError(`unknown target: ${args.target}`);
      }
      const rows = await BookEvent.find({
        bookId: args.bookId,
        targetType: args.target as EscalationTarget,
        targetId: args.targetId,
      })
        // Oldest first: a rationale is a story, and a story told backwards is a list.
        .sort({ at: 1 })
        .lean();
      return toEntries(rows as unknown as Array<Record<string, unknown>>);
    },
  }),
);

builder.queryField("supportBookRationale", (t) =>
  t.field({
    type: [EntryRef],
    description:
      "The editorial record for a book or one পাঠ, with actors resolved — the same " +
      "rows as supportBookTimeline but readable. Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: {
      bookId: t.arg.string({ required: true }),
      lessonNo: t.arg.int({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args) => {
      assertBookPlane();
      const q: Record<string, unknown> = { bookId: args.bookId };
      if (args.lessonNo != null) q.lessonNo = args.lessonNo;
      const rows = await BookEvent.find(q).sort({ at: 1 }).limit(Math.min(args.limit ?? 200, 500)).lean();
      return toEntries(rows as unknown as Array<Record<string, unknown>>);
    },
  }),
);

builder.queryField("supportBookPolicyAt", (t) =>
  t.field({
    type: ResolvedSetRef,
    nullable: true,
    description:
      "The policy set behind a `policySetHash` — the document versions AND their text, " +
      "as they were (D-#403). Null when the hash predates the snapshot memo. " +
      "Requires book:read.",
    authScopes: { hasPermission: "book:read" },
    args: { bookId: t.arg.string({ required: true }), hash: t.arg.string({ required: true }) },
    resolve: async (_root, args) => {
      assertBookPlane();
      return resolvePolicySet(args.hash, args.bookId);
    },
  }),
);
