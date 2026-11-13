/**
 * Comment → report (docs/prd-child-support-profile.md §7.4; owner Q-8, Q-14; D-#1561).
 *
 * THE WALL: `comments/` imports nothing from this module and StudentComment gets no field. So the
 * prompt is offered from THIS side: after the teacher's comment is saved, the app asks
 * `offerSupportSeed(commentId)`; the server checks the comment (its author is the caller, CONCERN or
 * POSITIVE), that the author holds `support_profile:report` and reads the child today, and writes a
 * SupportSeedPrompt (no text). "এখন লিখুন" makes ONE COMMENT_SEED draft per comment (unique
 * seedCommentId) with the comment's text in `behaviour` and the tone from its sentiment; every other
 * field stays empty. "পরে" keeps it until the comment's day + 7; then it goes silently. "না" closes it.
 * A seeded report goes through the same intake, batch and approval as any report.
 */
import { Types } from "mongoose";
import { callerHasPermission, type Permission } from "@scd/shared";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { StudentComment } from "../../comments/models/StudentComment";
import { SupportSeedPrompt, type ISupportSeedPrompt } from "../models/SupportSeedPrompt";
import { SupportReport, type ISupportReport } from "../models/SupportReport";
import { SupportProfileRefusal } from "./errors";
import { isSwitchedOn, supportCaller, type SupportCtx } from "./supportAccess";
import { readerOf } from "./supportScope";

const addDays = (key: string, n: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export interface SeedOffer {
  offered: boolean;
  /** SERIOUS_MATTER: the safeguarding question comes first (§7.4). */
  safeguardingFirst: boolean;
  /** A praise comment: the form adds "ঠিক তার আগে আপনি কী করেছিলেন যা সাহায্য করল?" */
  praise: boolean;
  state: string | null;
}

const NO: SeedOffer = { offered: false, safeguardingFirst: false, praise: false, state: null };

export async function offerSeed(ctx: SupportCtx, commentId: string): Promise<SeedOffer> {
  const auth = await supportCaller(ctx);
  if (!Types.ObjectId.isValid(commentId)) return NO;
  const c = await StudentComment.findById(commentId).select("studentId authorUserId type sentiment createdAt").lean();
  if (!c || String(c.authorUserId) !== auth.userId) return NO;
  if (c.sentiment !== "CONCERN" && c.sentiment !== "POSITIVE") return NO;
  if (!callerHasPermission(auth, "support_profile:report" as Permission) || !(await isSwitchedOn())) return NO;
  if (!(await readerOf(String(c.studentId), auth.userId))) return NO;
  const day = dhakaDayKey(new Date(c.createdAt));
  const p = await SupportSeedPrompt.findOneAndUpdate(
    { commentId: c._id },
    { $setOnInsert: { commentId: c._id, studentId: c.studentId, authorId: new Types.ObjectId(auth.userId), state: "OFFERED", expiresKey: addDays(day, 7) } },
    { upsert: true, new: true },
  );
  return { offered: p.state === "OFFERED" || p.state === "LATER", safeguardingFirst: c.type === "SERIOUS_MATTER", praise: c.sentiment === "POSITIVE", state: p.state };
}

export async function answerSeed(ctx: SupportCtx, commentId: string, choice: "NOW" | "LATER" | "NO"): Promise<{ prompt: ISupportSeedPrompt; draft: ISupportReport | null }> {
  const auth = await supportCaller(ctx);
  const p = await SupportSeedPrompt.findOne({ commentId: new Types.ObjectId(commentId), authorId: new Types.ObjectId(auth.userId) });
  if (!p) throw new SupportProfileRefusal("এই মন্তব্যের জন্য রিপোর্টের প্রস্তাব নেই।");
  if (choice === "NO") {
    p.state = "DECLINED";
    await p.save();
    return { prompt: p, draft: null };
  }
  if (choice === "LATER") {
    if (p.state === "OFFERED") p.state = "LATER";
    await p.save();
    return { prompt: p, draft: null };
  }
  // NOW — one draft per comment; a second tap opens the same draft.
  const existing = await SupportReport.findOne({ seedCommentId: p.commentId });
  if (existing) return { prompt: p, draft: existing };
  const rd = await readerOf(String(p.studentId), auth.userId);
  if (!rd) throw new SupportProfileRefusal("এই শিক্ষার্থীর সহায়তা রিপোর্ট লেখার অনুমতি এখন নেই।");
  const c = await StudentComment.findById(p.commentId).select("text sentiment createdAt").lean();
  if (!c) throw new SupportProfileRefusal("মন্তব্যটি পাওয়া যায়নি।");
  // The comment text is copied ONCE, at the tap; the teacher rewrites it for a colleague.
  const draft = await SupportReport.create({
    studentId: p.studentId,
    authorId: new Types.ObjectId(auth.userId),
    authorVia: rd.via === "CLASS_TEACHER" ? "CLASS_TEACHER" : rd.via === "COVER" ? "COVER" : "TEACHING",
    source: "COMMENT_SEED",
    seedCommentId: p.commentId,
    occurredOn: dhakaDayKey(new Date(c.createdAt)),
    behaviour: (c.text ?? "").slice(0, 600),
    tone: c.sentiment === "POSITIVE" ? "POSITIVE" : "CONCERN",
    status: "DRAFT",
  });
  p.state = "WRITTEN";
  p.reportId = draft._id;
  await p.save();
  return { prompt: p, draft };
}

/** "লেখা বাকি" — the author's open prompts (OFFERED / LATER, not expired). */
export async function pendingSeeds(ctx: SupportCtx): Promise<ISupportSeedPrompt[]> {
  const auth = await supportCaller(ctx);
  return SupportSeedPrompt.find({ authorId: new Types.ObjectId(auth.userId), state: { $in: ["OFFERED", "LATER"] }, expiresKey: { $gte: dhakaDayKey(new Date()) } })
    .sort({ createdAt: -1 })
    .limit(50);
}

/** After the comment day + 7 a prompt goes away silently: no overdue mark, no count, nothing to anyone. */
export async function sweepSeedPrompts(now: Date = new Date()): Promise<number> {
  const res = await SupportSeedPrompt.deleteMany({ state: { $in: ["OFFERED", "LATER"] }, expiresKey: { $lt: dhakaDayKey(now) } });
  return res.deletedCount ?? 0;
}
