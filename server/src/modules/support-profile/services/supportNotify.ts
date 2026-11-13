/**
 * Notices of the support profile (§9.7). Title and body NEVER carry a child's name, report text, a
 * model's question or safeguarding detail: the push channel sends them verbatim to a lock screen.
 * Dedupe keys always include the recipient (the dedupe-scope lesson).
 */
import { SUPPORT_PUSH_PREVIEW_BN, type Permission } from "@scd/shared";
import { emit } from "../../notifications/services/NotificationService";
import { holderIdsOf } from "../../access-control/services/holders";

export async function notifyUser(userId: string, bodyBn: string, dedupe: string, kind: "SUPPORT_PROFILE" | "SAFEGUARDING" = "SUPPORT_PROFILE"): Promise<boolean> {
  try {
    const r = await emit({ recipientUserId: userId, kind, titleBn: SUPPORT_PUSH_PREVIEW_BN, bodyBn, dedupeKey: `${dedupe}:${userId}` });
    return r.created;
  } catch {
    return false; // a notice never blocks the action
  }
}

export async function notifyHolders(perm: Permission, bodyBn: string, dedupe: string, kind: "SUPPORT_PROFILE" | "SAFEGUARDING" = "SUPPORT_PROFILE"): Promise<number> {
  let n = 0;
  for (const id of await holderIdsOf(perm)) if (await notifyUser(id, bodyBn, dedupe, kind)) n++;
  return n;
}
