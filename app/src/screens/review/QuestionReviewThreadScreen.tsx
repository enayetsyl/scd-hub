/**
 * QuestionReviewThreadScreen (QR-4) — the round history for one question, oldest→newest.
 *
 * The thread is anchored on the question's `qid`, so it spans every re-imported version of
 * that question and never bleeds into the other questions that share its unit address.
 *
 * Visible to Principal/Office for any question, and to a teacher only for threads they
 * reviewed — enforced server-side; an unrelated teacher gets a denial shown in Bangla.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  QUESTION_REVIEW_THREAD,
  SUBMIT_QUESTION_REVIEW,
  ADD_REVIEW_VOICE_NOTE,
  DELETE_REVIEW_VOICE_NOTE,
  type QuestionReviewRoundT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Button, Field, Notice, Loader, EmptyState, ErrorBanner, Divider } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import PlanBookTabs from "../../components/PlanBookTabs";
import { VoiceNoteList, VoiceNoteRecorder, MAX_VOICE_CLIPS } from "../../components/VoiceNotes";
import type { Recording } from "../../lib/voiceRecorder";
import { STR, subjectLabel, classLevelLabel, reviewVerdictLabel, reviewRoundStatusLabel, bnNum } from "../../lib/labels";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { parsePayload } from "../../lib/question";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import { questionReviewNeighbours } from "../../lib/questionReviewNav";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewThread">;

export default function QuestionReviewThreadScreen({ route, navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { artifactId } = route.params;
  const { can, user } = useAuth();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTION_REVIEW_THREAD,
    variables: { artifactId },
  });
  const [, submit] = useMutation(SUBMIT_QUESTION_REVIEW);
  const [, addVoice] = useMutation(ADD_REVIEW_VOICE_NOTE);
  const [, deleteVoice] = useMutation(DELETE_REVIEW_VOICE_NOTE);
  /** Which decision form is open on my round, the text in it, and the outcome line. */
  const [formMode, setFormMode] = React.useState<"reject" | "condition" | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // Only the very first load shows the bare loader — a refetch after a clip / decision must not
  // unmount the recorder (it would drop a recording in progress and the saved notice).
  if (fetching && !data) return <Loader />;
  if (error && !data) return <Screen scroll><ErrorBanner message={friendlyError(error)} /></Screen>;

  const rounds = data?.questionReviewThread ?? [];
  const first = rounds[0];

  // My own open round = the LAST round I hold that is assigned or submitted and not superseded.
  let mine: QuestionReviewRoundT | null = null;
  for (const r of rounds) {
    if (r.reviewerId === user?.id && (r.status === "assigned" || r.status === "submitted") && !r.artifactSuperseded) mine = r;
  }
  if (!can("question_review:review")) mine = null;

  const reload = (): void => refetch({ requestPolicy: "network-only" });

  async function onAddClip(rec: Recording, spot: string | null): Promise<string | null> {
    if (!mine) return null;
    setSaved(false); // a new draft is not sent yet — the "decision saved" line would mislead
    const res = await addVoice({
      assignmentId: mine.id,
      audioBase64: rec.base64,
      mimeType: rec.mimeType,
      seconds: rec.seconds,
      spot,
    });
    if (res.error) return friendlyError(res.error);
    reload();
    return null;
  }

  async function onDeleteClip(id: string): Promise<string | null> {
    const res = await deleteVoice({ noteId: id });
    if (res.error) return friendlyError(res.error);
    reload();
    return null;
  }

  async function decide(
    round: QuestionReviewRoundT,
    verdict: "APPROVE" | "APPROVE_WITH_CONDITION" | "CHANGES_REQUESTED",
  ): Promise<void> {
    const trimmed = reason.trim();
    // Same guard as the queue card (D-#525): a condition is mandatory text.
    if (verdict === "APPROVE_WITH_CONDITION" && trimmed === "") {
      setFailure(STR.qrConditionRequired);
      return;
    }
    setBusy(true);
    setFailure(null);
    setSaved(false);
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
    setFormMode(null);
    setReason("");
    setSaved(true);
    reload();
  }

  const myClips = mine?.voiceNotes ?? [];

  // ‹ আগের / পরের › through the list this screen was opened from (owner 20 Nov 2026). `replace`, so
  // Back still returns to the list in one tap and each question starts with a fresh decision card.
  const nb = questionReviewNeighbours(artifactId);
  const go = (id: string): void => navigation.replace("QuestionReviewThread", { artifactId: id });
  const navRow = nb ? (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginVertical: space(2) }}>
      <Button title={STR.qrPrevQuestion} variant="secondary" disabled={!nb.prev} onPress={() => nb.prev && go(nb.prev)} />
      <Muted>{`${bnNum(nb.index + 1)} / ${bnNum(nb.total)}`}</Muted>
      <Button title={STR.qrNextQuestion} variant="secondary" disabled={!nb.next} onPress={() => nb.next && go(nb.next)} />
    </View>
  ) : null;

  const body = (
    <>
      {navRow}
      <H2>{STR.reviewThread}</H2>
      {first ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          <Badge text={subjectLabel(first.subject)} />
          <Badge text={classLevelLabel(first.classLevel)} />
          {first.qid ? <Badge text={first.qid} /> : null}
        </View>
      ) : null}
      {first?.questionText ? <Body>{first.questionText}</Body> : null}
      {/* The options and the answer key. A thread exists to explain a verdict, and a
          verdict about an MCQ is unreadable without the options it was cast on. */}
      {first ? (
        <AnswerCarrier payload={parsePayload(first.payloadJson)} correctColor={colors.primary} />
      ) : null}

      <Divider />

      {rounds.length === 0 ? (
        <EmptyState message={STR.qrNoQueue} />
      ) : (
        rounds.map((r) => (
          <Card key={r.id} style={{ marginBottom: space(2) }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
              <Badge text={`#${bnNum(r.roundNumber)}`} />
              <Badge text={reviewRoundStatusLabel(r.status)} />
              {r.verdict ? (
                <Badge
                  text={reviewVerdictLabel(r.verdict)}
                  tone={r.verdict === "APPROVE" ? "ok" : "warn"}
                />
              ) : null}
            </View>
            <Muted>{r.reviewerName ?? r.reviewerId}</Muted>
            {/* Optional by design (Q2.4) — absence is normal, not a gap in the data. */}
            <Muted>
              {STR.qrReason}: {r.reason && r.reason.trim() !== "" ? r.reason : "—"}
            </Muted>
            {/* My own open round's clips (sent + drafts) show once, in "আমার সিদ্ধান্ত" below. */}
            {r.id === mine?.id ? null : <VoiceNoteList clips={(r.voiceNotes ?? []).filter((n) => n.submitted)} />}
          </Card>
        ))
      )}

      {mine ? (
        <Card style={{ marginBottom: space(2) }}>
          <H2>{STR.qrMyDecision}</H2>
          <VoiceNoteRecorder
            clips={myClips}
            spots={[]}
            onAdd={onAddClip}
            onDelete={onDeleteClip}
            maxClips={MAX_VOICE_CLIPS}
            disabled={busy}
            roundSubmitted={mine.status === "submitted"}
            hint={STR.vnHintQuestion}
            resubmitNote={STR.vnResubmitQuestion}
          />
          {formMode ? (
            <View>
              <Field
                label={formMode === "condition" ? STR.qrConditionRequired : STR.qrReasonOptional}
                value={reason}
                onChangeText={setReason}
                multiline
                helper={formMode === "condition" ? STR.qrConditionHint : STR.qrReasonHint}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                {formMode === "condition" ? (
                  <Button
                    title={STR.qrApproveWithCondition}
                    loading={busy}
                    disabled={reason.trim() === ""}
                    onPress={() => void decide(mine!, "APPROVE_WITH_CONDITION")}
                  />
                ) : (
                  <Button title={STR.qrReject} variant="danger" loading={busy} onPress={() => void decide(mine!, "CHANGES_REQUESTED")} />
                )}
                <Button
                  title={STR.cancel}
                  variant="ghost"
                  onPress={() => {
                    setFormMode(null);
                    setReason("");
                  }}
                />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Button title={STR.qrAccept} loading={busy} onPress={() => void decide(mine!, "APPROVE")} />
              <Button
                title={STR.qrApproveWithCondition}
                variant="secondary"
                onPress={() => {
                  setFormMode("condition");
                  setReason(mine!.verdict === "APPROVE_WITH_CONDITION" ? mine!.reason ?? "" : "");
                }}
              />
              <Button
                title={STR.qrReject}
                variant="secondary"
                onPress={() => {
                  setFormMode("reject");
                  setReason(mine!.verdict === "CHANGES_REQUESTED" ? mine!.reason ?? "" : "");
                }}
              />
            </View>
          )}
          {failure ? <Notice message={failure} tone="danger" /> : null}
          {saved ? <Notice message={STR.qrDecisionSaved} tone="ok" /> : null}
        </Card>
      ) : null}
      {navRow}
    </>
  );

  return can("lesson_plans:read_book") ? (
    <Screen>
      <PlanBookTabs
        artifactId={artifactId}
        mainLabel={STR.qrTabQuestion}
        storageKey="qreviewBook"
        noPdfNote
        chapterMissingText={STR.pbQChapterMissing}
      >
        {body}
      </PlanBookTabs>
    </Screen>
  ) : (
    <Screen scroll>{body}</Screen>
  );
}
