/**
 * Shared pieces of the fake-2027 scenarios (AL-2 gap fixes).
 */
import type { MasterySubject } from "@scd/shared";
import { ContentArtifact } from "../../../modules/content/models/ContentArtifact";
import { isMasteryEnabled } from "../../../modules/mastery/services/MasteryCatalogueService";
import { sectionContext, type Auth } from "../../../modules/mastery/services/MasteryWorkService";
import { MasteryAssignmentSheet } from "../../../modules/mastery/models/MasteryAssignmentSheet";
import { approveAllSheets, editSheet } from "../../../modules/mastery/services/MasteryAssignmentService";
import { bankItemsOf } from "../../../modules/mastery/services/HomeworkPaperService";
import { assertPicksAllowed, pickLedger, pickStatus } from "../../../modules/mastery/services/HomeworkPickRules";
import type { ScenarioCtx, SectionInfo } from "./types";

/**
 * Up to `k` bank qids a homework sheet for this section x subject x day will be ACCEPTED with.
 *
 * The declare path (`syncPaperForItem` -> `assertPicksAllowed`) refuses a question the section had inside the no-repeat window, one
 * of an open extra sheet, and any question past the homework share of its objective (R21). A blind pick from the first 30 gold
 * questions collides with the ledger a few days into the run (the run's own earlier sheets), which is why scenario 2 saw
 * "declareRefused 40 of 160". Here every candidate goes through the SAME guard before it is chosen, so the declare that follows does
 * not refuse for a pick reason. Returns [] when the bank has nothing usable (a free-line-only sheet is then declared).
 */
export async function pickAllowedHomeworkQids(ctx: ScenarioCtx, sec: SectionInfo, subject: string, dayKey: string, k: number): Promise<string[]> {
  const sc = await sectionContext(sec.sectionId);
  const arts = await ContentArtifact.find({
    docType: "question", current: true, retiredAt: null, reviewStatus: "gold", examPoolAt: null, subject, classLevel: sec.level,
  })
    .select("envelopeJson.payload.qid")
    .limit(80)
    .lean(); // bounded: the dev bank of one class x subject
  const pool = arts
    .map((a) => String(((a.envelopeJson as Record<string, unknown>).payload as Record<string, unknown> | undefined)?.qid ?? ""))
    .filter(Boolean);
  if (pool.length === 0) return [];
  const [enabled, ledger] = await Promise.all([isMasteryEnabled(sc.academicYearId, sc.classToken, subject as MasterySubject), pickLedger(sc, subject as MasterySubject, dayKey)]);
  const open = pool.filter((q) => pickStatus(q, ledger) !== "BLOCKED");
  const chosen: string[] = [];
  for (const qid of ctx.pick(open, Math.min(open.length, k + 8))) {
    if (chosen.length >= k) break;
    try {
      const next = [...chosen, qid];
      const { objectiveOf } = await bankItemsOf({ subject, classLevel: sec.level }, next, enabled, sc);
      await assertPicksAllowed(sc, subject as MasterySubject, dayKey, next, objectiveOf);
      chosen.push(qid);
    } catch {
      /* this one is not allowed today (held, over the objective's share, ...): try the next */
    }
  }
  return chosen;
}

/**
 * The teacher's approve step for a weekly assignment draft: approve every clean sheet, then look at each sheet with a gap (no unseen
 * question left for that child, flagged NEEDS_REVIEW) and approve it as it stands - the "দেখে অনুমোদন দিন" step. `sendAssignment` refuses
 * to send while any sheet is still NEEDS_REVIEW, which refused the engine's drafts in the dev run. Returns how many gap sheets were reviewed.
 */
export async function approveWithReview(assignmentId: string, auth: Auth): Promise<number> {
  await approveAllSheets(assignmentId, auth);
  const gaps = await MasteryAssignmentSheet.find({ assignmentId, status: "NEEDS_REVIEW" }).select("studentId").lean(); // bounded: one roster
  for (const g of gaps) await editSheet(assignmentId, String(g.studentId), { op: "APPROVE" }, auth);
  return gaps.length;
}
