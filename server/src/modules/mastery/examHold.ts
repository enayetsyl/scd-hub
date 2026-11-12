/**
 * Questions held for the exam papers (PR-I, D-#1408).
 *
 * A held question (`ContentArtifact.examPoolAt` set) is never given out before the exam: every
 * mastery picker reads the bank through `goldBank` (default `exclude`), and every path that names
 * a bank question by id (`createPaper`, the extra homework, a top-up) calls `heldRefusal`.
 * The future exam-paper builder is the only reader that asks for `any` or `only`.
 */
import { Types } from "mongoose";
import { ContentArtifact } from "../content/models/ContentArtifact";

/** `only` = the held ones, `exclude` = what a picker may give out (the default), `any` = no constraint. */
export type ExamPoolLens = "only" | "exclude" | "any";

/** Mongo clause for the lens; `null` = no constraint. Unknown words read as `any`. */
export function examPoolClause(lens: string | null | undefined): { examPoolAt: unknown } | null {
  if (lens === "only") return { examPoolAt: { $ne: null } };
  if (lens === "exclude") return { examPoolAt: null };
  return null;
}

/** The qids (in the given set of artifacts) that are held for exams. */
export async function heldQids(artifactIds: string[]): Promise<string[]> {
  const ids = [...new Set(artifactIds)].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  if (ids.length === 0) return [];
  const rows = await ContentArtifact.find({ _id: { $in: ids }, docType: "question", examPoolAt: { $ne: null } })
    .select("envelopeJson.payload.qid")
    .lean();
  return rows.map((r) => String(((r.envelopeJson as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.qid ?? r._id));
}

/** The refusal sentence naming the reason, or null when none of the artifacts is held. */
export async function heldRefusal(artifactIds: string[]): Promise<string | null> {
  const held = await heldQids(artifactIds);
  if (held.length === 0) return null;
  const shown = held.slice(0, 3).join(", ") + (held.length > 3 ? " …" : "");
  return `প্রশ্ন ${shown} পরীক্ষার জন্য রাখা আছে — বাড়ির কাজ, অ্যাসাইনমেন্ট বা ক্লাস টেস্টে দেওয়া যায় না।`;
}
