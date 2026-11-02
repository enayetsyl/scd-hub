/**
 * The mark-submission guard's two warnings (D-#892, docs/prd-mark-submission-guard.md §4),
 * shared by the homework and assignment workspaces.
 *
 *   first submission  — rows still GIVEN/DUE are being marked: the guardian of every child
 *                       left "not submitted" is told at once, so mark carefully.
 *   correcting one    — a row chased TODAY is being flipped to submitted: the server records
 *                       it as the teacher's mistake, tells Office + Principal and sends the
 *                       guardian a correction.
 *
 * The app reads "chased today" from the row's last stamp; the server is the truth (it also
 * excludes the 17:30 system chase), and its `correctedCount` drives the after-save alert.
 */
import type { ConfirmOptions } from "../state/ConfirmContext";
import { STR, bnNum, dhakaDateKey } from "./labels";

interface PassRow {
  id: string;
  state: string;
  lastStateAt: string;
}

/** Ask before a submit pass. Resolves false when the teacher backs out. */
export async function confirmMarkPass(
  confirmAction: (o: ConfirmOptions) => Promise<boolean>,
  rows: readonly PassRow[],
  entries: readonly { id: string; on: boolean }[],
): Promise<boolean> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const today = dhakaDateKey();
  const correcting = entries.filter((e) => {
    const r = byId.get(e.id);
    return e.on && r?.state === "CHASE" && dhakaDateKey(r.lastStateAt) === today;
  }).length;
  if (correcting > 0) {
    return confirmAction({
      title: STR.msgFixTitle,
      message: STR.msgFixBody.replace("{n}", bnNum(correcting)),
      confirmLabel: STR.msgFixGo,
    });
  }
  const fresh = entries.some((e) => {
    const s = byId.get(e.id)?.state;
    return s === "GIVEN" || s === "DUE";
  });
  if (!fresh) return true; // only re-crossing already-chased rows: a no-op, nothing to warn
  return confirmAction({
    title: STR.msgFirstTitle,
    message: STR.msgFirstBody,
    confirmLabel: STR.msgFirstGo,
    tone: "primary",
  });
}
