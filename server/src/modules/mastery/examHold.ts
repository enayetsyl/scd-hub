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
import { stimulusRefOf } from "./parts";

/** `only` = the held ones, `exclude` = what a picker may give out (the default), `any` = no constraint. */
export type ExamPoolLens = "only" | "exclude" | "any";

/** Mongo clause for the lens; `null` = no constraint. Unknown words read as `any`. */
export function examPoolClause(lens: string | null | undefined): { examPoolAt: unknown } | null {
  if (lens === "only") return { examPoolAt: { $ne: null } };
  if (lens === "exclude") return { examPoolAt: null };
  return null;
}

const refOf = (r: { envelopeJson?: unknown }) =>
  stimulusRefOf(((r.envelopeJson as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined) ?? null);
const qidOfRow = (r: { _id: unknown; envelopeJson?: unknown }) => {
  const q = ((r.envelopeJson as Record<string, unknown> | undefined)?.payload as Record<string, unknown> | undefined)?.qid;
  return typeof q === "string" ? q : String(r._id);
};

/** Of these stimulus refs, the ones that have at least one HELD part (a live, current question). */
export async function heldStimulusRefs(refs: string[]): Promise<Set<string>> {
  const wanted = [...new Set(refs.filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const rows = await ContentArtifact.find({
    docType: "question", current: true, retiredAt: null, examPoolAt: { $ne: null },
    "envelopeJson.payload.stimulus_ref": { $in: wanted },
  }).select("envelopeJson.payload.stimulus_ref").lean();
  return new Set(rows.map((r) => refOf(r)).filter((x): x is string => Boolean(x)));
}

/**
 * Why these artifacts may not be handed out, or null. A question is refused when it is held, or when it
 * is another part (same `stimulus_ref`) of a passage that has a held part: the parts of one passage go
 * to the exam together (D-#1408).
 */
export async function heldRefusal(artifactIds: string[]): Promise<string | null> {
  const ids = [...new Set(artifactIds)].filter((i) => Types.ObjectId.isValid(i)).map((i) => new Types.ObjectId(i));
  if (ids.length === 0) return null;
  const rows = await ContentArtifact.find({ _id: { $in: ids }, docType: "question" })
    .select("examPoolAt envelopeJson.payload.qid envelopeJson.payload.stimulus_ref")
    .lean();
  const held = rows.filter((r) => r.examPoolAt != null).map(qidOfRow);
  const rest = rows.filter((r) => r.examPoolAt == null);
  const heldRefs = await heldStimulusRefs(rest.map((r) => refOf(r)).filter((x): x is string => Boolean(x)));
  const sibs = rest.filter((r) => {
    const ref = refOf(r);
    return ref !== null && heldRefs.has(ref);
  }).map(qidOfRow);
  const shown = (l: string[]) => l.slice(0, 3).join(", ") + (l.length > 3 ? " …" : "");
  if (held.length > 0) {
    return `প্রশ্ন ${shown(held)} পরীক্ষার জন্য রাখা আছে — বাড়ির কাজ, অ্যাসাইনমেন্ট বা ক্লাস টেস্টে দেওয়া যায় না।`;
  }
  if (sibs.length > 0) {
    return `প্রশ্ন ${shown(sibs)} পরীক্ষার জন্য রাখা প্রশ্নের একই অনুচ্ছেদের (same passage as a held question) — বাড়ির কাজ, অ্যাসাইনমেন্ট বা ক্লাস টেস্টে দেওয়া যায় না।`;
  }
  return null;
}
