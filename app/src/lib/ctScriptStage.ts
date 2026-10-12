/**
 * The class-test SCRIPT stage on screen (CS-1..CS-3, D-#715–#719) — the third axis
 * beside entry state and publish state (D-#370, `ctPublishStatus.ts`). The stage is
 * always the SERVER's value; this file only decides how it looks and how the
 * dashboard orders its tiles, so the Today cards, the upload screen and the
 * dashboard can never disagree on a colour.
 */
import { CT_SCRIPT_STAGES, type CtScriptStage } from "@scd/shared";

export type CtScriptTone = "brand" | "ok" | "warn" | "danger" | "muted" | "info" | "gold";

export function ctScriptStageTone(stage?: string | null): CtScriptTone {
  switch (stage as CtScriptStage) {
    case "DUE":
      return "warn";
    case "OVERDUE":
    case "RETURN_OVERDUE":
      return "danger";
    case "UPLOAD_PENDING":
    case "WITH_TEACHER":
      return "info";
    case "UPLOAD_IN_PROGRESS":
      return "gold";
    case "UPLOAD_DONE":
    case "PUBLISHED":
    case "RETURNED":
      return "ok";
    default:
      return "muted";
  }
}

/** Dashboard tile order = the paper's journey. */
export const CT_SCRIPT_TILE_ORDER: readonly CtScriptStage[] = CT_SCRIPT_STAGES;

/** A one-line "where / who" for a script row: "৪র্থ শ্রেণি · খ · গণিত · টেস্ট নং ৩". */
export function ctScriptRowTitle(
  r: { unitLabelBn: string; subjectBn: string; testNumber: number },
  testNoLabel: string,
  num: (n: number) => string,
): string {
  return [r.unitLabelBn, r.subjectBn, `${testNoLabel} ${num(r.testNumber)}`].filter(Boolean).join(" · ");
}
