/** Exam paper bank (D-#1030–#1034) — labels shared by the four screens. */
import { ROUTINE_SUBJECT_LABELS_BN, ROUTINE_SUBJECT_LABELS_EN } from "@scd/shared";
import type { RoutineSubject } from "@scd/shared";
import { STR, getActiveLang } from "../../lib/labels";

type Tone = "brand" | "ok" | "warn" | "danger" | "muted" | "info" | "gold";

export function subjectLabel(code: string): string {
  const table = getActiveLang() === "en" ? ROUTINE_SUBJECT_LABELS_EN : ROUTINE_SUBJECT_LABELS_BN;
  return table[code as RoutineSubject] ?? code;
}

export function termLabel(term: string): string {
  return term === "HALF_YEARLY" ? STR.epTermHalf : STR.epTermAnnual;
}

export function paperStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "IN_REVIEW":
      return { label: STR.epStatusInReview, tone: "warn" };
    case "REVIEWED":
      return { label: STR.epStatusReviewed, tone: "info" };
    case "FINAL":
      return { label: STR.epStatusFinal, tone: "ok" };
    default:
      return { label: STR.epStatusDraft, tone: "muted" };
  }
}

export function sourceBadge(source: string): { label: string; tone: Tone } {
  switch (source) {
    case "MP2026":
      return { label: STR.epSrcMP2026, tone: "brand" };
    case "MP2026_ADAPTED":
      return { label: STR.epSrcMP2026A, tone: "brand" };
    case "MP_OTHER":
      return { label: STR.epSrcMPO, tone: "info" };
    case "MP_OTHER_ADAPTED":
      return { label: STR.epSrcMPOA, tone: "info" };
    case "REVIEWER":
      return { label: STR.epSrcRev, tone: "gold" };
    default:
      return { label: STR.epSrcNew, tone: "muted" };
  }
}

export function suggestionKind(kind: string): string {
  return kind === "EDIT" ? STR.epKindEdit : kind === "DELETE" ? STR.epKindDelete : STR.epKindAdd;
}

export function suggestionStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "ACCEPTED":
      return { label: STR.epSugAccepted, tone: "ok" };
    case "REJECTED":
      return { label: STR.epSugRejected, tone: "danger" };
    case "WITHDRAWN":
      return { label: STR.epSugWithdrawn, tone: "muted" };
    default:
      return { label: STR.epSugOpen, tone: "warn" };
  }
}

/** "{a} … {b}" placeholder fill. */
export function fill(tpl: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), tpl);
}
