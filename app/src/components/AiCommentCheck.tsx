/**
 * AI comment check (AI-5, D-#1095 / D-#1099 / D-#1100) — the hook and the panel shared by
 * the daily comment composer and the class-test result form.
 *
 *   useAiCommentCheck(kind)  is the checker on for me? run a check; remember which text
 *                            was checked; build the claim the save mutation carries; and
 *                            say whether the text may be saved now (`gate`).
 *   <AiCheckPanel>           the Check button, the suggestions (accept one / accept all /
 *                            keep my text), the "not checked" notice, and the standard.
 *
 * The AI never changes the text by itself: a suggestion lands in the box only when the
 * teacher taps Accept, and "keep my text" saves exactly what was written.
 *
 * Round 2 (owner 2026-11-09, D-#1175): the check is REQUIRED before saving while the checker
 * is on — Save stays locked until the current text is checked, and EVERY edit after a check
 * needs a new check. Accepting the AI's own suggestion is not an edit. If the check cannot
 * run (switched off, a limit, the AI down, a name it could not hide, no connection) the text
 * may be saved as written. Text loaded from an earlier save may be re-saved unchanged.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { CHECK_COMMENT, COMMENT_CHECK_AVAILABILITY, type CheckKindT, type CommentCheckIssueT, type CommentCheckResultT, type AiCheckClaimT } from "../graphql/commentCheck";
import { ACTIVE_AI_POLICY } from "../graphql/aiPolicies";
import { useAuth } from "../auth/AuthContext";
import { Body, Muted, Button, Notice, Badge } from "./ui";
import Markdown from "./Markdown";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { space } from "../theme/tokens";

export type CheckFields = Array<{ field: string; text: string }>;

const snap = (fields: CheckFields) => JSON.stringify(fields.map((f) => [f.field, f.text.trim()]).sort());

/** A blank the AI left for the writer ("[কয়টি]") or a token that was not put back. */
const BLANK = /\[[^[\]]*[ঀ-৿][^[\]]*\]|\[(?:S\d*|G\d+|T\d+|PHONE|NUM|ID)\]/;
export const hasBlank = (fields: CheckFields) => fields.some((f) => BLANK.test(f.text));

/** Why Save is locked right now (null = may save). */
export type CheckGate = null | "NEED_CHECK" | "CHANGED" | "DECIDE" | "BLANKS";

export interface AiCommentCheck {
  available: boolean;
  kind: CheckKindT;
  busy: boolean;
  result: CommentCheckResultT | null;
  error: string | null;
  /** Issues still open (not yet accepted). */
  open: CommentCheckIssueT[];
  /** True when these fields are exactly what was last checked / accepted / kept. */
  isCurrent: (fields: CheckFields) => boolean;
  /** Whether these fields may be saved now, and if not, why. */
  gate: (fields: CheckFields) => CheckGate;
  check: (studentId: string, fields: CheckFields, extra?: { markPct?: number | null; commentType?: string; sentiment?: string }) => Promise<CommentCheckResultT | null>;
  /** The writer settled on these fields (accepted or kept their own, or loaded unchanged). */
  settle: (fields: CheckFields) => void;
  /** An accepted suggestion changed the text but other suggestions are still open. */
  advance: (fields: CheckFields) => void;
  accept: (issue: CommentCheckIssueT) => void;
  acceptAll: () => void;
  keepMine: () => void;
  claim: () => AiCheckClaimT;
  reset: () => void;
}

export function useAiCommentCheck(kind: CheckKindT): AiCommentCheck {
  const { can } = useAuth();
  const allowed = can("ai_assist:check_comment");
  const [q] = useQuery({ query: COMMENT_CHECK_AVAILABILITY, pause: !allowed, requestPolicy: "cache-and-network" });
  const available = allowed && (kind === "DAILY" ? !!q.data?.commentCheckAvailability.daily : !!q.data?.commentCheckAvailability.ct);
  const [, run] = useMutation(CHECK_COMMENT);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<CommentCheckResultT | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState<number[]>([]);
  const [overrode, setOverrode] = React.useState(false);
  // settled: may be saved as is. reviewing: checked, suggestions still open.
  const [settled, setSettled] = React.useState<string | null>(null);
  const [reviewing, setReviewing] = React.useState<string | null>(null);
  const [everChecked, setEverChecked] = React.useState(false);

  const reset = React.useCallback(() => {
    setResult(null);
    setError(null);
    setAccepted([]);
    setOverrode(false);
    setSettled(null);
    setReviewing(null);
    setEverChecked(false);
  }, []);

  const check: AiCommentCheck["check"] = async (studentId, fields, extra) => {
    setBusy(true);
    setError(null);
    const res = await run({ kind, studentId, fields: fields.filter((f) => f.text.trim()), markPct: extra?.markPct ?? null, commentType: extra?.commentType ?? null, sentiment: extra?.sentiment ?? null });
    setBusy(false);
    setEverChecked(true);
    setAccepted([]);
    setOverrode(false);
    if (res.error || !res.data) {
      // Fail-open (D-#1100): no connection / a server error never blocks the save.
      setError(friendlyError(res.error as never));
      setResult(null);
      setSettled(snap(fields));
      setReviewing(null);
      return null;
    }
    const r = res.data.checkComment;
    setResult(r);
    // Nothing to fix (or not checked at all): the text as it stands is settled.
    if (r.status !== "CHECKED" || r.issues.length === 0) {
      setSettled(snap(fields));
      setReviewing(null);
    } else {
      setSettled(null);
      setReviewing(snap(fields));
    }
    return r;
  };

  const open = (result?.issues ?? []).filter((_i, idx) => !accepted.includes(idx));

  const gate = (fields: CheckFields): CheckGate => {
    if (!available) return null;
    if (!fields.some((f) => f.text.trim())) return null;
    const s = snap(fields);
    if (settled === s) return hasBlank(fields) ? "BLANKS" : null;
    if (reviewing === s && open.length > 0) return "DECIDE";
    return everChecked ? "CHANGED" : "NEED_CHECK";
  };

  return {
    available,
    kind,
    busy,
    result,
    error,
    open,
    isCurrent: (fields) => settled !== null && settled === snap(fields),
    gate,
    check,
    settle: (fields) => {
      setSettled(snap(fields));
      setReviewing(null);
    },
    advance: (fields) => setReviewing(snap(fields)),
    accept: (issue) => {
      const idx = (result?.issues ?? []).indexOf(issue);
      if (idx >= 0 && !accepted.includes(idx)) setAccepted([...accepted, idx]);
    },
    acceptAll: () => setAccepted((result?.issues ?? []).map((_i, idx) => idx)),
    keepMine: () => setOverrode(true),
    claim: () =>
      result?.status === "CHECKED" && result.token
        ? { aiCheckToken: result.token, aiIssuesAccepted: accepted.length, aiTeacherOverrode: result.issues.length > 0 && (overrode || accepted.length === 0) }
        : {},
    reset,
  };
}

/** The sentence shown above a locked Save button. */
export function gateMessage(g: CheckGate): string | null {
  return g === "NEED_CHECK" ? STR.aicNeedCheck : g === "CHANGED" ? STR.aicChanged : g === "DECIDE" ? STR.aicDecide : g === "BLANKS" ? STR.aicFillBlanks : null;
}

/** Read at render, so a language switch shows at once. */
function typeLabel(type: string): string {
  const m: Record<string, string> = {
    punctuation: STR.aicTypePunctuation,
    tone: STR.aicTypeTone,
    honorific: STR.aicTypeHonorific,
    structure: STR.aicTypeStructure,
    standard: STR.aicTypeStandard,
    marks: STR.aicTypeMarks,
    spelling: STR.aicTypeSpelling,
  };
  return m[type] ?? type;
}

/** Replace the quoted words with the suggestion; if the quote is not found, leave the text. */
export function applySuggestion(text: string, issue: CommentCheckIssueT): string {
  if (!issue.quote) return text;
  const i = text.indexOf(issue.quote);
  return i < 0 ? text : text.slice(0, i) + issue.suggestion + text.slice(i + issue.quote.length);
}

export function AiCheckPanel({
  ai,
  studentId,
  fields,
  fieldLabels,
  extra,
  onChange,
  onKeepMine,
  disabled,
}: {
  ai: AiCommentCheck;
  studentId: string;
  fields: CheckFields;
  /** Shown before each issue when there is more than one field. */
  fieldLabels?: Record<string, string>;
  extra?: { markPct?: number | null; commentType?: string; sentiment?: string };
  /** Put new text into a field (an accepted suggestion). */
  onChange: (field: string, text: string) => void;
  /** "Keep my text and save" — the screen saves right away. */
  onKeepMine: () => void;
  disabled?: boolean;
}): React.ReactElement | null {
  const [showStandard, setShowStandard] = React.useState(false);
  const [sq] = useQuery({ query: ACTIVE_AI_POLICY, variables: { key: "comment_standard" }, pause: !showStandard });
  const [ctq] = useQuery({ query: ACTIVE_AI_POLICY, variables: { key: "ct_comment_standard" }, pause: !showStandard || ai.kind !== "CT" });
  if (!ai.available) return null;
  const r = ai.result;
  const textOf = (field: string) => fields.find((f) => f.field === field)?.text ?? "";
  const hasText = fields.some((f) => f.text.trim().length > 0);
  const g = ai.gate(fields);
  const canCheck = hasText && (g === "NEED_CHECK" || g === "CHANGED");

  function acceptOne(issue: CommentCheckIssueT): void {
    // A note (no quote) changes nothing — it is only acknowledged.
    const next = issue.quote ? applySuggestion(textOf(issue.field), issue) : textOf(issue.field);
    if (issue.quote) onChange(issue.field, next);
    ai.accept(issue);
    const nextFields = fields.map((f) => (f.field === issue.field ? { ...f, text: next } : f));
    if (ai.open.length === 1) ai.settle(nextFields);
    else ai.advance(nextFields);
  }

  function acceptAll(): void {
    const next = fields.map((f) => ({ ...f, text: r?.corrected.find((c) => c.field === f.field)?.text ?? f.text }));
    for (const f of next) onChange(f.field, f.text);
    ai.acceptAll();
    ai.settle(next);
  }

  function keepMine(): void {
    ai.keepMine();
    ai.settle(fields);
    onKeepMine();
  }

  return (
    <View style={{ marginTop: space(2), marginBottom: space(3), gap: space(2) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
        <Button
          title={ai.busy ? STR.aicChecking : STR.aicCheck}
          variant={canCheck ? "primary" : "secondary"}
          onPress={() => void ai.check(studentId, fields, extra)}
          loading={ai.busy}
          disabled={disabled || ai.busy || !canCheck}
        />
        <Button title={showStandard ? STR.aicHideStandard : STR.aicShowStandard} variant="ghost" onPress={() => setShowStandard(!showStandard)} />
      </View>

      {ai.error ? <Notice tone="warn" message={`${STR.aicNotChecked} (${ai.error})`} /> : null}
      {r && r.status === "NOT_CHECKED" ? <Notice tone="warn" message={r.message ?? STR.aicNotChecked} /> : null}
      {r && r.status === "CHECKED" && r.issues.length === 0 ? <Notice tone="ok" message={STR.aicNoIssues} /> : null}

      {r && r.status === "CHECKED" && ai.open.length > 0 && g === "DECIDE" ? (
        <View style={{ gap: space(2) }}>
          <Body style={{ fontWeight: "700" }}>{STR.aicSuggestions}</Body>
          {ai.open.map((issue, i) => {
            const isNote = !issue.quote;
            const placeable = isNote || textOf(issue.field).includes(issue.quote);
            return (
              <View key={`${issue.field}-${i}-${issue.quote}`} style={{ gap: space(1) }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                  <Badge text={typeLabel(issue.type)} tone="warn" />
                  {fieldLabels && fields.length > 1 ? <Badge text={fieldLabels[issue.field] ?? issue.field} tone="muted" /> : null}
                </View>
                {issue.quote ? <Muted>{`${STR.aicWritten}: ${issue.quote}`}</Muted> : null}
                <Body>{isNote ? issue.suggestion : `${STR.aicBetter}: ${issue.suggestion}`}</Body>
                {placeable ? (
                  <View style={{ flexDirection: "row" }}>
                    <Button title={isNote ? STR.aicNoted : STR.aicAccept} variant="secondary" onPress={() => acceptOne(issue)} disabled={disabled} />
                  </View>
                ) : (
                  <Muted>{STR.aicCantPlace}</Muted>
                )}
              </View>
            );
          })}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
            <Button title={STR.aicAcceptAll} onPress={acceptAll} disabled={disabled} />
            <Button title={STR.aicKeepMine} variant="secondary" onPress={keepMine} disabled={disabled} />
          </View>
        </View>
      ) : null}

      {g && g !== "DECIDE" ? <Muted>{gateMessage(g)}</Muted> : null}

      {showStandard ? (
        <View style={{ marginTop: space(1) }}>
          {sq.data?.activeAiPolicy ? <Markdown source={sq.data.activeAiPolicy.body} /> : <Muted>{STR.airNotActiveYet}</Muted>}
          {ai.kind === "CT" && ctq.data?.activeAiPolicy ? <Markdown source={ctq.data.activeAiPolicy.body} /> : null}
        </View>
      ) : null}
    </View>
  );
}
