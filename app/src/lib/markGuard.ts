/**
 * The mark-submission guard's two warnings (D-#892, docs/prd-mark-submission-guard.md §4),
 * shared by the homework and assignment workspaces.
 *
 *   first submission  — rows still GIVEN/DUE are being marked: the guardian of every child
 *                       left "not submitted" is told at once, so mark carefully.
 *   correcting one    — a row chased TODAY is being flipped to submitted: the server records
 *                       it as the teacher's mistake, tells Office + Principal and sends the
 *                       guardian a correction. D-#937: the warning IS the reason sheet — the
 *                       pass is not sent without a reason, which rides the mutation.
 *
 * The app reads "chased today" from the row's last stamp; the server is the truth (it also
 * excludes the 17:30 system chase), and its `correctedCount` drives the after-save alert.
 */
import type { ConfirmOptions } from "../state/ConfirmContext";
import type { MistakeReasonPick, MistakeReasonRequest } from "../components/MistakeReasonSheet";
import { STR, bnNum, dhakaDateKey } from "./labels";

interface PassRow {
  id: string;
  state: string;
  lastStateAt: string;
}

export interface MarkPassGo {
  ok: boolean;
  /** Set when the pass corrects a same-day chase (D-#937). */
  reason: MistakeReasonPick | null;
}

/** Ask before a submit pass. `ok: false` when the teacher backs out. */
export async function confirmMarkPass(
  confirmAction: (o: ConfirmOptions) => Promise<boolean>,
  askMistakeReason: (r: MistakeReasonRequest) => Promise<MistakeReasonPick | null>,
  rows: readonly PassRow[],
  entries: readonly { id: string; on: boolean }[],
  /** D-#1020: the teacher holds staff_mistakes:view_own. If not, the sheet says nothing about
   *  mistakes or who is told — it only asks what happened, for the guardian's correction. */
  told = false,
): Promise<MarkPassGo> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const today = dhakaDateKey();
  const correcting = entries.filter((e) => {
    const r = byId.get(e.id);
    return e.on && r?.state === "CHASE" && dhakaDateKey(r.lastStateAt) === today;
  }).length;
  if (correcting > 0) {
    const reason = await askMistakeReason({
      kind: "MARK_CORRECTION",
      title: told ? STR.msgFixTitle : STR.smrSheetTitle,
      message: (told ? STR.msgFixBody : STR.msgFixBodyQuiet).replace("{n}", bnNum(correcting)),
      guardianPreview: true,
      hideHint: !told,
      submitLabel: STR.smrSendAndChange,
    });
    return { ok: reason !== null, reason };
  }
  const fresh = entries.some((e) => {
    const s = byId.get(e.id)?.state;
    return s === "GIVEN" || s === "DUE";
  });
  if (!fresh) return { ok: true, reason: null }; // only re-crossing already-chased rows: a no-op, nothing to warn
  const ok = await confirmAction({
    title: STR.msgFirstTitle,
    message: STR.msgFirstBody,
    confirmLabel: STR.msgFirstGo,
    tone: "primary",
  });
  return { ok, reason: null };
}
