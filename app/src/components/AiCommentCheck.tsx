/**
 * AI comment check (AI-5, D-#1095 / D-#1099 / D-#1100) — the hook and the panel shared by
 * the daily comment composer and the class-test result form.
 *
 *   useAiCommentCheck(kind)  is the checker on for me? run a check; remember which text
 *                            was checked; build the claim the save mutation carries.
 *   <AiCheckPanel>           the Check button, the suggestions (accept one / accept all /
 *                            keep my text), the "not checked" notice, and the standard.
 *
 * The AI never changes the text by itself: a suggestion lands in the box only when the
 * teacher taps Accept, and "keep my text" saves exactly what was written.
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
  check: (studentId: string, fields: CheckFields, extra?: { markPct?: number | null; commentType?: string; sentiment?: string }) => Promise<CommentCheckResultT | null>;
  /** The writer settled on these fields (accepted or kept their own). */
  settle: (fields: CheckFields) => void;
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
  const [settled, setSettled] = React.useState<string | null>(null);

  const reset = React.useCallback(() => {
    setResult(null);
    setError(null);
    setAccepted([]);
    setOverrode(false);
    setSettled(null);
  }, []);

  const check: AiCommentCheck["check"] = async (studentId, fields, extra) => {
    setBusy(true);
    setError(null);
    const res = await run({ kind, studentId, fields: fields.filter((f) => f.text.trim()), markPct: extra?.markPct ?? null, commentType: extra?.commentType ?? null, sentiment: extra?.sentiment ?? null });
    setBusy(false);
    if (res.error || !res.data) {
      setError(friendlyError(res.error as never));
      return null;
    }
    const r = res.data.checkComment;
    setResult(r);
    setAccepted([]);
    setOverrode(false);
    // Nothing to fix (or not checked at all): the text as it stands is settled.
    if (r.status !== "CHECKED" || r.issues.length === 0) setSettled(snap(fields));
    else setSettled(null);
    return r;
  };

  const open = (result?.issues ?? []).filter((_i, idx) => !accepted.includes(idx));

  return {
    available,
    kind,
    busy,
    result,
    error,
    open,
    isCurrent: (fields) => settled !== null && settled === snap(fields),
    check,
    settle: (fields) => setSettled(snap(fields)),
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

  function acceptOne(issue: CommentCheckIssueT): void {
    const next = applySuggestion(textOf(issue.field), issue);
    onChange(issue.field, next);
    ai.accept(issue);
    if (ai.open.length === 1) ai.settle(fields.map((f) => (f.field === issue.field ? { ...f, text: next } : f)));
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
    <View style={{ marginTop: space(2), gap: space(1) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button
          title={ai.busy ? STR.aicChecking : STR.aicCheck}
          variant="secondary"
          onPress={() => void ai.check(studentId, fields, extra)}
          loading={ai.busy}
          disabled={disabled || ai.busy || !hasText || ai.isCurrent(fields)}
        />
        <Button title={showStandard ? STR.aicHideStandard : STR.aicShowStandard} variant="ghost" onPress={() => setShowStandard(!showStandard)} />
      </View>

      {ai.error ? <Notice tone="danger" message={ai.error} /> : null}
      {r && r.status === "NOT_CHECKED" ? <Notice tone="warn" message={r.message ?? STR.aicNotChecked} /> : null}
      {r && r.status === "CHECKED" && r.issues.length === 0 ? <Notice tone="ok" message={STR.aicNoIssues} /> : null}

      {r && r.status === "CHECKED" && ai.open.length > 0 ? (
        <View style={{ gap: space(1) }}>
          <Body style={{ fontWeight: "700" }}>{STR.aicSuggestions}</Body>
          {ai.open.map((issue, i) => (
            <View key={`${issue.field}-${i}-${issue.quote}`} style={{ gap: space(1), paddingVertical: space(1) }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                <Badge text={typeLabel(issue.type)} tone="warn" />
                {fieldLabels && fields.length > 1 ? <Badge text={fieldLabels[issue.field] ?? issue.field} tone="muted" /> : null}
              </View>
              {issue.quote ? <Muted>{`${STR.aicWritten}: ${issue.quote}`}</Muted> : null}
              <Body>{`${STR.aicBetter}: ${issue.suggestion}`}</Body>
              <View style={{ flexDirection: "row" }}>
                <Button title={STR.aicAccept} variant="secondary" onPress={() => acceptOne(issue)} disabled={disabled || !issue.quote || !textOf(issue.field).includes(issue.quote)} />
              </View>
            </View>
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button title={STR.aicAcceptAll} onPress={acceptAll} disabled={disabled} />
            <Button title={STR.aicKeepMine} variant="secondary" onPress={keepMine} disabled={disabled} />
          </View>
        </View>
      ) : null}

      {showStandard ? (
        <View style={{ marginTop: space(1) }}>
          {sq.data?.activeAiPolicy ? <Markdown source={sq.data.activeAiPolicy.body} /> : <Muted>{STR.airNotActiveYet}</Muted>}
          {ai.kind === "CT" && ctq.data?.activeAiPolicy ? <Markdown source={ctq.data.activeAiPolicy.body} /> : null}
        </View>
      ) : null}
    </View>
  );
}
