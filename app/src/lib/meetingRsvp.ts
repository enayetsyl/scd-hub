/**
 * The words + badge tone for a family's answer to its parents'-meeting slot
 * (D-#840–#843). Shared by the guardian Home card and the office meeting screen so
 * the two never describe the same answer differently.
 */
import type { MeetingSlotResponseT } from "../graphql/comments";
import { STR } from "./labels";

export type RsvpTone = "ok" | "warn" | "danger" | "brand" | "muted";

export function rsvpStatus(r: MeetingSlotResponseT | null | undefined): { text: string; tone: RsvpTone } {
  if (!r) return { text: STR.rsStNoAnswer, tone: "muted" };
  if (r.choice === "CONFIRMED") return { text: STR.rsStConfirmed, tone: "ok" };
  if (r.choice === "CANT_COME") return { text: STR.rsStCantCome, tone: "danger" };
  if (r.reviewOutcome === "APPROVED") return { text: STR.rsStChangeApproved, tone: "ok" };
  if (r.reviewOutcome === "DECLINED") return { text: STR.rsStChangeDeclined, tone: "warn" };
  return { text: STR.rsStChangePending, tone: "brand" };
}
