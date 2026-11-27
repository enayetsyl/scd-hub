/**
 * QuestionFoldRow (RF-1/RF-2) — one question inside a reviewer's closed fold.
 *
 *   approved / changes — shows her decision; "সিদ্ধান্ত বদলান" opens the same three choices as the
 *                        queue with her previous verdict and reason PREFILLED (the server already
 *                        accepts a resubmit until the Principal finalises).
 *   final              — the Principal finalised it; the only action is "পরিবর্তনের প্রস্তাব" (RF-2).
 */
import React from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import { SUBMIT_QUESTION_REVIEW, type QuestionReviewRoundT } from "../../graphql/operations";
import type { GoldChangeRequestT, ReviewBucketKey } from "../../graphql/reviewFolds";
import { Badge, Body, Button, Card, ErrorBanner, Field, Muted } from "../../components/ui";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { GoldChangeAsk } from "../../components/GoldChange";
import { STR, subjectLabel, classLevelLabel, reviewVerdictLabel, bnNum } from "../../lib/labels";
import { parsePayload } from "../../lib/question";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Verdict = "APPROVE" | "APPROVE_WITH_CONDITION" | "CHANGES_REQUESTED";

export function QuestionFoldRow({
  round,
  bucket,
  request,
  onChanged,
  onOpenThread,
}: {
  round: QuestionReviewRoundT;
  bucket: ReviewBucketKey;
  /** Her latest gold-change request on this question (final fold). */
  request: GoldChangeRequestT | undefined;
  /** A decision or a request was saved: the parent refreshes counts and open folds. */
  onChanged: () => void;
  onOpenThread: () => void;
}): React.ReactElement {
  const colors = useColors();
  const [editing, setEditing] = React.useState<Verdict | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [, submit] = useMutation(SUBMIT_QUESTION_REVIEW);

  async function save(verdict: Verdict): Promise<void> {
    const trimmed = reason.trim();
    if (verdict === "APPROVE_WITH_CONDITION" && trimmed === "") {
      setFailure(STR.qrConditionRequired);
      return;
    }
    setBusy(true);
    setFailure(null);
    const res = await submit({
      assignmentId: round.id,
      verdict,
      reason: verdict !== "APPROVE" && trimmed !== "" ? trimmed : undefined,
    });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setEditing(null);
    onChanged();
  }

  // Open the form for a verdict; keep her old reason only when it was written for the same verdict.
  function edit(verdict: Verdict): void {
    setEditing(verdict);
    setFailure(null);
    setReason(round.verdict === verdict ? round.reason ?? "" : "");
  }

  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
        <Badge text={subjectLabel(round.subject)} />
        <Badge text={classLevelLabel(round.classLevel)} />
        {round.marks != null ? <Badge text={`${STR.qrMarks} ${bnNum(round.marks)}`} /> : null}
        {round.topicTag ? <Badge text={round.topicTag} tone="muted" /> : null}
        {round.qtCode ? <Badge text={round.qtCode} tone="gold" /> : null}
        {round.verdict ? (
          <Badge
            text={`✓ ${round.verdict === "APPROVE" ? STR.qrDecidedApproved : reviewVerdictLabel(round.verdict)}`}
            tone={round.verdict === "APPROVE" ? "ok" : "warn"}
          />
        ) : null}
        {bucket === "final" ? <Badge text={STR.rfFinal} tone="ok" /> : null}
        {round.important ? <Badge text={STR.qImportant} tone="gold" /> : null}
      </View>
      <Body>{round.questionText ?? "—"}</Body>
      <View style={{ marginTop: space(1) }}>
        <AnswerCarrier payload={parsePayload(round.payloadJson)} correctColor={colors.primary} />
      </View>
      {round.qid ? <Muted>{round.qid}</Muted> : null}
      {round.reason ? <Muted style={{ marginTop: space(1) }}>{`${STR.qrReason}: ${round.reason}`}</Muted> : null}

      {bucket === "final" ? (
        <GoldChangeAsk artifactId={round.artifactId} isQuestion existing={request} onSent={onChanged} />
      ) : editing ? (
        <View style={{ marginTop: space(2) }}>
          <Field
            label={editing === "APPROVE_WITH_CONDITION" ? STR.qrConditionRequired : STR.qrReasonOptional}
            value={reason}
            onChangeText={setReason}
            multiline
            helper={editing === "APPROVE_WITH_CONDITION" ? STR.qrConditionHint : STR.qrReasonHint}
          />
          {failure ? <ErrorBanner message={failure} /> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
            <Button
              title={editing === "APPROVE" ? STR.qrAccept : editing === "APPROVE_WITH_CONDITION" ? STR.qrApproveWithCondition : STR.qrReject}
              variant={editing === "CHANGES_REQUESTED" ? "danger" : "primary"}
              loading={busy}
              onPress={() => void save(editing)}
            />
            <Button title={STR.cancel} variant="ghost" onPress={() => setEditing(null)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {failure ? <ErrorBanner message={failure} /> : null}
          <Button title={STR.qrAccept} variant={round.verdict === "APPROVE" ? "primary" : "secondary"} loading={busy} onPress={() => void save("APPROVE")} />
          <Button title={STR.qrApproveWithCondition} variant="secondary" onPress={() => edit("APPROVE_WITH_CONDITION")} />
          <Button title={STR.qrReject} variant="secondary" onPress={() => edit("CHANGES_REQUESTED")} />
          <Button title={STR.qrOpenBookVoice} variant="ghost" onPress={onOpenThread} />
        </View>
      )}
    </Card>
  );
}
