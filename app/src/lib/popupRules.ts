/**
 * The close rules of a pop-up notice, evaluated on screen (D-#852, PRD §5.3).
 *
 * Pure so the rule reads in one place: the pop-up asks "what is still unmet?" on every
 * tick and on every close attempt, and the answer drives the locked ✕, the close button's
 * words and the hint that explains a refused close.
 */
import type { PopupRulesT } from "../graphql/popupNotice";

export type UnmetKind = "scroll" | "time" | "act";
export interface Unmet {
  kind: UnmetKind;
  /** time: whole seconds still to wait. */
  secondsLeft?: number;
}

export interface ReadingState {
  /** The end of the message has been on screen (a body that fits counts as read to the end). */
  atEnd: boolean;
  /** Foreground time this showing has been open, ms. */
  readMs: number;
}

/** Everything still standing between the reader and closing, in the order the hint names them. */
export function unmetRules(rules: PopupRulesT, s: ReadingState): Unmet[] {
  const out: Unmet[] = [];
  if (rules.mustScrollToEnd && !s.atEnd) out.push({ kind: "scroll" });
  if (rules.minReadSec > 0) {
    const left = Math.ceil((rules.minReadSec * 1000 - s.readMs) / 1000);
    if (left > 0) out.push({ kind: "time", secondsLeft: left });
  }
  if (rules.mustAct) out.push({ kind: "act" });
  return out;
}

/** The reading conditions only — what gates the answer buttons too. */
export function readingUnmet(rules: PopupRulesT, s: ReadingState): Unmet[] {
  return unmetRules(rules, s).filter((u) => u.kind !== "act");
}

/** Does this notice have a reading condition worth recording as READ once met? */
export function hasReadingRule(rules: PopupRulesT): boolean {
  return rules.mustScrollToEnd || rules.minReadSec > 0;
}

/**
 * May the auto-close countdown run now? Never on long text that has not been read to
 * the end (rule 5.3-1): a five-second close on a body taller than the screen would hide
 * words nobody saw.
 */
export function autoCloseRunning(rules: PopupRulesT, overflow: boolean, atEnd: boolean): boolean {
  return rules.autoCloseSec > 0 && (!overflow || atEnd);
}

/** 0 must answer · 1 must read · 2 quick info — the composer's preset for a rule set. */
export type PopupPreset = "quick" | "read" | "attentive" | "answer" | "custom";

export function presetOf(rules: PopupRulesT): PopupPreset {
  if (rules.mustAct) return "answer";
  if (rules.minReadSec > 0) return "attentive";
  if (rules.mustScrollToEnd) return "read";
  if (rules.autoCloseSec > 0) return "quick";
  return "custom";
}

export const PRESET_RULES: Record<Exclude<PopupPreset, "custom">, PopupRulesT> = {
  quick: { autoCloseSec: 5, closeButton: true, mustScrollToEnd: false, minReadSec: 0, mustAct: false, allowSnooze: false, maxSnooze: 2, allowAnswerChange: false },
  read: { autoCloseSec: 0, closeButton: true, mustScrollToEnd: true, minReadSec: 0, mustAct: false, allowSnooze: false, maxSnooze: 2, allowAnswerChange: false },
  attentive: { autoCloseSec: 0, closeButton: true, mustScrollToEnd: true, minReadSec: 30, mustAct: false, allowSnooze: false, maxSnooze: 2, allowAnswerChange: false },
  answer: { autoCloseSec: 0, closeButton: false, mustScrollToEnd: false, minReadSec: 0, mustAct: true, allowSnooze: false, maxSnooze: 2, allowAnswerChange: false },
};

/** The composer's mirror of the server's checks (the server stays the gate). Returns STR keys' values via `msg`. */
export function ruleProblems(
  rules: PopupRulesT,
  actionCount: number,
  msg: { autoWithLock: string; actNeedsButton: string; noWayOut: string; autoRange: string; minRange: string },
): string[] {
  const out: string[] = [];
  if (rules.autoCloseSec > 0 && (rules.mustScrollToEnd || rules.minReadSec > 0 || rules.mustAct)) out.push(msg.autoWithLock);
  if (rules.mustAct && actionCount === 0) out.push(msg.actNeedsButton);
  if (!rules.closeButton && !rules.mustAct && rules.autoCloseSec === 0 && actionCount === 0) out.push(msg.noWayOut);
  if (rules.autoCloseSec !== 0 && (rules.autoCloseSec < 3 || rules.autoCloseSec > 60)) out.push(msg.autoRange);
  if (rules.minReadSec !== 0 && (rules.minReadSec < 2 || rules.minReadSec > 300)) out.push(msg.minRange);
  return out;
}
