/**
 * ReviewSubmitScreen (PR-3, R3.1) — a teacher reads an assigned plan and submits a
 * verdict + feedback. The plan is fetched via ARTIFACT_QUERY; the PR-1 reviewer
 * read-scope override lets the assignee read it even outside their teaching subject.
 *
 * APPROVE advances the plan draft→reviewed server-side; CHANGES_REQUESTED requires
 * feedback (the text the admin carries to Claude Desktop). On success → back to the
 * review home.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation, useClient } from "urql";
import {
  ARTIFACT_QUERY,
  SUBMIT_PLAN_REVIEW,
  REVIEW_VOICE_NOTES,
  ADD_REVIEW_VOICE_NOTE,
  DELETE_REVIEW_VOICE_NOTE,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H1,
  H2,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Field,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import Markdown from "../../components/Markdown";
import { VoiceNoteRecorder, MAX_VOICE_CLIPS } from "../../components/VoiceNotes";
import { planSpotOptions } from "../../lib/reviewSpots";
import type { Recording } from "../../lib/voiceRecorder";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  reviewStatusLabel,
  docTypeLabel,
  curationTagLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { fetchNextItem, openItemAction } from "../../lib/reviewPath";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

import { PLAN_DOC_TYPES } from "@scd/shared";
import PlanBookTabs from "../../components/PlanBookTabs";
type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSubmit">;
type Verdict = "APPROVE" | "CHANGES_REQUESTED";

export default function ReviewSubmitScreen({ route, navigation }: Props): React.ReactElement {
  const { assignmentId, artifactId, initialVerdict, initialFeedback, roundStatus, fromPath } = route.params;
  const client = useClient();
  const [{ data, fetching, error }, refetch] = useQuery({ query: ARTIFACT_QUERY, variables: { id: artifactId } });
  const [, submitReview] = useMutation(SUBMIT_PLAN_REVIEW);
  // Voice notes (VN-1): clips are saved server-side the moment they are recorded (drafts), so an app
  // restart or a dropped connection before Submit loses nothing; Submit then sends them with the text.
  const [{ data: voiceData }, refetchVoice] = useQuery({
    query: REVIEW_VOICE_NOTES,
    variables: { assignmentId },
    requestPolicy: "cache-and-network",
  });
  const [, addVoice] = useMutation(ADD_REVIEW_VOICE_NOTE);
  const [, deleteVoice] = useMutation(DELETE_REVIEW_VOICE_NOTE);
  const clips = voiceData?.reviewVoiceNotes ?? [];

  // Re-opening an already-decided round (R4): prefill the prior verdict + feedback so
  // the reviewer edits, not re-enters. submitPlanReview treats this as a resubmit.
  const isResubmit = roundStatus === "submitted";
  const [verdict, setVerdict] = useState<Verdict | null>(
    initialVerdict === "APPROVE" || initialVerdict === "CHANGES_REQUESTED" ? initialVerdict : null,
  );
  const [feedback, setFeedback] = useState(initialFeedback ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const a = data?.artifact;
  const spots = useMemo(() => planSpotOptions(a?.renderedMarkdown), [a?.renderedMarkdown]);

  async function onAddClip(rec: Recording, spot: string | null): Promise<string | null> {
    const res = await addVoice({
      assignmentId,
      audioBase64: rec.base64,
      mimeType: rec.mimeType,
      seconds: rec.seconds,
      spot,
    });
    if (res.error) return friendlyError(res.error);
    refetchVoice({ requestPolicy: "network-only" });
    return null;
  }

  async function onDeleteClip(id: string): Promise<string | null> {
    const res = await deleteVoice({ noteId: id });
    if (res.error) return friendlyError(res.error);
    refetchVoice({ requestPolicy: "network-only" });
    return null;
  }

  async function onExport(): Promise<void> {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await openPdf(`/pdf/artifact/${artifactId}`);
    } catch {
      setPdfError(STR.pdfError);
    } finally {
      setPdfBusy(false);
    }
  }

  async function onSubmit(): Promise<void> {
    if (busy || !verdict) return;
    setErr(null);
    if (verdict === "CHANGES_REQUESTED" && feedback.trim() === "" && clips.length === 0) {
      setErr(STR.feedbackRequired);
      return;
    }
    setBusy(true);
    const res = await submitReview({ assignmentId, verdict, feedback: feedback.trim() || null });
    setBusy(false);
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    // Opened from the ordered path: carry straight on to the next item (the next plan, or the next
    // chapter's questions). Nothing left, or the read failing, falls back to the normal way back.
    if (fromPath && !isResubmit) {
      const next = await fetchNextItem(client);
      if (next.item) {
        navigation.dispatch(openItemAction(next.item, "replace"));
        return;
      }
    }
    navigation.goBack();
  }

  const { can } = useAuth();
  // "পরিকল্পনা | বই" tabs only for people who may read the book (lesson_plans:read_book).
  const showBook = can("lesson_plans:read_book") && !!a && (PLAN_DOC_TYPES as readonly string[]).includes(a.docType);
  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  if (!a) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  const title = a.address.title || `${a.address.anchorWord} ${a.address.number}`;
  // The review round is closed once the Principal signs off (gold) or a newer
  // version supersedes this one (current=false). The plan stays readable, but no
  // further verdict can be submitted — show why instead of a dead form/error.
  const closed = a.reviewStatus === "gold" || a.current === false;

  const planBody = (
    <>
      <H1>{title}</H1>
      <Muted>
        {subjectLabel(a.subject)} · {classLevelLabel(a.classLevel)}
      </Muted>
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2), flexWrap: "wrap" }}>
        <Badge text={docTypeLabel(a.docType)} tone="info" />
        <Badge text={curationTagLabel(a.curationTag)} tone="muted" />
        <Badge
          text={reviewStatusLabel(a.reviewStatus)}
          tone={a.reviewStatus === "gold" ? "ok" : a.reviewStatus === "reviewed" ? "brand" : "muted"}
        />
      </View>

      {PDF_SUPPORTED ? (
        <Button
          title={pdfBusy ? STR.preparingPdf : STR.exportPdf}
          onPress={onExport}
          loading={pdfBusy}
          variant="secondary"
          style={{ marginTop: space(3) }}
        />
      ) : null}
      {pdfError ? <Notice message={pdfError} tone="danger" /> : null}

      <Divider />

      {a.renderedMarkdown ? <Markdown source={a.renderedMarkdown} /> : <Notice message={STR.noMarkdown} tone="warn" />}

      <Divider />

      {closed ? (
        <Notice message={a.reviewStatus === "gold" ? STR.reviewClosedSignedOff : STR.reviewClosedSuperseded} tone="warn" />
      ) : (
      <Card>
        <H2>{isResubmit ? STR.editMyReview : STR.submitReview}</H2>
        <ChipRow>
          <Chip label={STR.verdictApprove} selected={verdict === "APPROVE"} onPress={() => setVerdict("APPROVE")} />
          <Chip
            label={STR.verdictChanges}
            selected={verdict === "CHANGES_REQUESTED"}
            onPress={() => setVerdict("CHANGES_REQUESTED")}
          />
        </ChipRow>
        <Field
          label={STR.feedback}
          value={feedback}
          onChangeText={setFeedback}
          multiline
          placeholder={STR.feedbackForClaude}
        />
        <VoiceNoteRecorder
          clips={clips}
          spots={spots}
          onAdd={onAddClip}
          onDelete={onDeleteClip}
          maxClips={MAX_VOICE_CLIPS}
          disabled={busy}
          roundSubmitted={isResubmit}
        />
        {err ? <Notice message={err} tone="danger" /> : null}
        <Button
          title={busy ? STR.submittingReview : isResubmit ? STR.resubmitReview : STR.submitReview}
          onPress={onSubmit}
          loading={busy}
          disabled={!verdict}
          style={{ marginTop: space(2) }}
        />
      </Card>
      )}
    </>
  );
  return showBook ? (
    <Screen>
      <PlanBookTabs artifactId={artifactId}>{planBody}</PlanBookTabs>
    </Screen>
  ) : (
    <Screen scroll>{planBody}</Screen>
  );
}
