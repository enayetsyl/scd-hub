/**
 * Evidence rules shared by the result validator and the version recompute (E-2, E-12), so the two
 * can never disagree about what counts.
 */
import { functionTagAllowed, type SupportSide, type SupportTone } from "@scd/shared";

/** E-2: on the positive side a CONCERN report counts only through a concrete good thing. */
export const reportUsableOnSide = (side: SupportSide | null, tone: SupportTone, goodThingOk: boolean): boolean => !(side === "POSITIVE" && tone === "CONCERN" && !goodThingOk);

/** E-2: the report is counted as a positive observation through its good thing. */
export const viaGoodThingOf = (side: SupportSide | null, tone: SupportTone, goodThingOk: boolean): boolean => side === "POSITIVE" && tone === "CONCERN" && goodThingOk;

/** E-12: keep a possible reason only when ≥ 3 observations from ≥ 2 teachers share it. */
export function functionTagKept(tag: string | null | undefined, evidence: { authorId: string; occurredOn: string; slot: string; gotOrAvoided: string[] }[]): string | null {
  if (!tag) return null;
  const sharing = evidence.filter((r) => r.gotOrAvoided.includes(tag));
  const obs = new Set(sharing.map((r) => `${r.occurredOn}|${r.slot}`)).size;
  const teachers = new Set(sharing.map((r) => r.authorId)).size;
  return functionTagAllowed(obs, teachers) ? tag : null;
}
