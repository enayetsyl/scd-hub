/**
 * Applying teacher exclusions (D-#782) to the evidence log. One place, called when evidence is
 * written (a confirmation or a correction must not bring an excluded item back) and when an
 * exclusion is added or revoked.
 */
import { Types } from "mongoose";
import { MasteryEvidence } from "./models/MasteryEvidence";
import { MasteryExclusion, type IMasteryExclusion } from "./models/MasteryExclusion";

type ExclusionLike = Pick<IMasteryExclusion, "sectionId" | "scope" | "paperId" | "itemNo" | "qid">;

/** The live evidence rows one exclusion covers. */
export function exclusionMatch(ex: ExclusionLike): Record<string, unknown> {
  const base = { sectionId: ex.sectionId, supersededAt: null };
  return ex.scope === "QID" && ex.qid ? { ...base, qid: ex.qid } : { ...base, paperId: ex.paperId, itemNo: ex.itemNo };
}

/**
 * Mark every live row in the section that an ACTIVE exclusion covers; `only` narrows the
 * write (e.g. to the rows of the paper just written). Rows already marked keep their first mark.
 */
export async function reapplyExclusions(sectionId: Types.ObjectId, only: Record<string, unknown> = {}): Promise<void> {
  const active = await MasteryExclusion.find({ sectionId, revokedAt: null }).sort({ at: 1 }).lean();
  for (const ex of active) {
    await MasteryEvidence.updateMany(
      { ...exclusionMatch(ex), ...only, excludedAt: null },
      { $set: { excludedAt: ex.at, excludedBy: ex.by, excludeReason: ex.reason } },
    );
  }
}

/** After a revoke: clear the marks it made, then let the remaining exclusions re-mark theirs. */
export async function clearExclusion(ex: ExclusionLike): Promise<void> {
  await MasteryEvidence.updateMany(exclusionMatch(ex), { $unset: { excludedAt: 1, excludedBy: 1, excludeReason: 1 } });
  await reapplyExclusions(ex.sectionId);
}
