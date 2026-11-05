/**
 * The reason a teacher picks in the submit pass's warning sheet (D-#937). One input type,
 * shared by homeworkSubmitPass and assignmentSubmitPass.
 */
import { staffMistakeReasonError } from "@scd/shared";
import { builder } from "../../../schema";
import { StaffMistakeError } from "../services/StaffMistakeService";
import type { CorrectionReason } from "../services/correctionReasonContext";

export const CorrectionReasonInput = builder.inputType("CorrectionReasonInput", {
  fields: (t) => ({
    code: t.string({ required: true }),
    text: t.string({ required: false }),
  }),
});

/** Validate (MARK_CORRECTION reasons) and trim; null when none was sent. */
export function parseCorrectionReason(
  input: { code: string; text?: string | null } | null | undefined,
): CorrectionReason | null {
  if (!input) return null;
  const text = (input.text ?? "").trim();
  const bad = staffMistakeReasonError("MARK_CORRECTION", input.code, text);
  if (bad) throw new StaffMistakeError(bad);
  return { code: input.code, text };
}
