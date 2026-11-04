/**
 * MasteryReviewService — objective-tree review rounds, the append-only review log and the level
 * names (prd-objective-tree §5/§7, D-#923/#924). OT-1 holds the read side and the helpers the
 * import and the switch need; OT-2 adds assign / review writes / submit / lock on top of these.
 *
 *   appendReviewEvent      — THE only writer of MasteryReviewEvent; mirrors each row to the audit log
 *   latestReviewRound      — the newest round of a class × subject (or null)
 *   switchBlockedByReview  — the D-#775 switch gate: a pair that has rounds needs one LOCKED
 *   getReviewRound         — the round view (counts per review state, coverage, flags)
 *   masteryLevelLabels     — the ONE server helper for the level words (PDFs, notifications, guardian payloads)
 */
import { Types } from "mongoose";
import { MASTERY_LEVEL_LABEL_DEFAULTS, MASTERY_REVIEW_STATES } from "@scd/shared";
import type { MasteryClassToken, MasteryLevelLabels, MasteryReviewEventAction, MasterySubject } from "@scd/shared";
import { MasteryCatalogueReview, type IMasteryCatalogueReview } from "../models/MasteryCatalogueReview";
import { MasteryReviewEvent } from "../models/MasteryReviewEvent";
import { MasteryOutcome } from "../models/MasteryOutcome";
import { MasteryPolicy } from "../models/MasteryPolicy";
import { writeAuditMany } from "../../platform/services/AuditService";

export interface ReviewActor {
  userId: string;
  role: string;
}

const oid = (id: string): Types.ObjectId | undefined => (Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined);

export interface ReviewEventInput {
  reviewId: Types.ObjectId;
  code: string | null;
  action: MasteryReviewEventAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  comment?: string;
  parentEventId?: Types.ObjectId;
}

/**
 * Append review events (one per input, in order) and mirror them to the audit log. The ONLY
 * writer of MasteryReviewEvent — OT-2's review writes go through here too.
 */
export async function appendReviewEvents(events: ReviewEventInput[], actor: ReviewActor, at = new Date()): Promise<Types.ObjectId[]> {
  if (events.length === 0) return [];
  const by = oid(actor.userId);
  // Strictly increasing `at` keeps the export order stable even within one millisecond.
  const rows = events.map((e, i) => ({ ...e, _id: new Types.ObjectId(), by, at: new Date(at.getTime() + i) }));
  await MasteryReviewEvent.insertMany(rows, { ordered: true });
  void writeAuditMany(
    rows.map((r) => ({
      eventKind: "MASTERY_REVIEW_EVENT" as const,
      actorId: actor.userId,
      actorRole: actor.role,
      targetKind: "MasteryCatalogueReview",
      targetId: r.reviewId,
      meta: { action: r.action, code: r.code, comment: r.comment },
    })),
  );
  return rows.map((r) => r._id);
}

export async function latestReviewRound(
  classToken: MasteryClassToken,
  subject: MasterySubject,
): Promise<IMasteryCatalogueReview | null> {
  return MasteryCatalogueReview.findOne({ classToken, subject }).sort({ round: -1 }).lean<IMasteryCatalogueReview>();
}

/**
 * The switch gate (prd-objective-tree §7 "Switch", §10 item 12). A class × subject imported as a
 * tree has review rounds and may be switched on only once one of them is LOCKED. A flat M-0
 * catalogue locked before the tree existed has no round and keeps working (its LOCKED rows are
 * checked by the caller, as before). Returns a Bangla refusal or null.
 */
export async function switchBlockedByReview(classToken: MasteryClassToken, subject: MasterySubject): Promise<string | null> {
  const rounds = await MasteryCatalogueReview.find({ classToken, subject }).select("state round").lean();
  if (rounds.length === 0) return null;
  if (rounds.some((r) => r.state === "LOCKED")) return null;
  return "এই শ্রেণি-বিষয়ের শিখনফল তালিকা এখনো পর্যালোচনায় — পর্যালোচনা শেষে লক হলে তবেই চালু করা যাবে।";
}

/** A round still being reviewed blocks the old one-tap lock and DRAFT-row removal. */
export async function openReviewRound(classToken: MasteryClassToken, subject: MasterySubject): Promise<IMasteryCatalogueReview | null> {
  return MasteryCatalogueReview.findOne({ classToken, subject, state: { $in: ["OPEN", "SUBMITTED"] } }).lean<IMasteryCatalogueReview>();
}

export interface ReviewRoundView {
  id: string;
  classToken: string;
  subject: string;
  round: number;
  state: string;
  reviewerIds: string[];
  importedAt: string;
  coverage: { exercisesTotal: number; mapped: number; unmapped: { ref: string; text: string; reason: string; resolution: string | null }[] };
  flags: { code: string | null; kind: string; text: string; ownerRuling: string | null }[];
  /** Rows of the pair per review state (DRAFT rows only). */
  stateCounts: { state: string; count: number }[];
  eventCount: number;
}

export async function getReviewRound(classToken: MasteryClassToken, subject: MasterySubject, round?: number | null): Promise<ReviewRoundView | null> {
  const r = round
    ? await MasteryCatalogueReview.findOne({ classToken, subject, round }).lean<IMasteryCatalogueReview>()
    : await latestReviewRound(classToken, subject);
  if (!r) return null;
  const [byState, eventCount] = await Promise.all([
    MasteryOutcome.aggregate<{ _id: string; n: number }>([
      { $match: { classToken, subject, status: "DRAFT", reviewState: { $exists: true } } },
      { $group: { _id: "$reviewState", n: { $sum: 1 } } },
    ]),
    MasteryReviewEvent.countDocuments({ reviewId: r._id }),
  ]);
  const counts = new Map(byState.map((g) => [g._id, g.n]));
  return {
    id: String(r._id),
    classToken: r.classToken,
    subject: r.subject,
    round: r.round,
    state: r.state,
    reviewerIds: (r.reviewerIds ?? []).map(String),
    importedAt: new Date(r.importedAt).toISOString(),
    coverage: {
      exercisesTotal: r.coverage?.exercisesTotal ?? 0,
      mapped: r.coverage?.mapped ?? 0,
      unmapped: (r.coverage?.unmapped ?? []).map((u) => ({ ref: u.ref, text: u.text, reason: u.reason, resolution: u.resolution ?? null })),
    },
    flags: (r.flags ?? []).map((f) => ({ code: f.code ?? null, kind: f.kind, text: f.text, ownerRuling: f.ownerRuling ?? null })),
    stateCounts: MASTERY_REVIEW_STATES.map((s) => ({ state: s, count: counts.get(s) ?? 0 })),
    eventCount,
  };
}

// ---------------------------------------------------------------------------
// Level names (D-#923)
// ---------------------------------------------------------------------------

export const LEVEL_LABEL_KEYS = Object.keys(MASTERY_LEVEL_LABEL_DEFAULTS) as (keyof MasteryLevelLabels)[];

/** Defaults ⊕ what the SCHOOL row changed. Blank stored values fall back to the default. */
export function resolveLevelLabels(stored: Partial<MasteryLevelLabels> | null | undefined): MasteryLevelLabels {
  const out = { ...MASTERY_LEVEL_LABEL_DEFAULTS } as MasteryLevelLabels;
  for (const k of LEVEL_LABEL_KEYS) {
    const v = stored?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** THE server helper: every PDF / notification / guardian payload that names a level reads this. */
export async function masteryLevelLabels(): Promise<MasteryLevelLabels> {
  const school = await MasteryPolicy.findOne({ scopeKey: "SCHOOL" }).select("levelLabels").lean();
  return resolveLevelLabels(school?.levelLabels);
}
