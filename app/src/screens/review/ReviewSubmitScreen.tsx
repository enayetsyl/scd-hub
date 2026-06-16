/**
 * ReviewSubmitScreen (PR-3, R3.1) — a teacher reads an assigned plan and submits a
 * verdict + feedback. The plan is fetched via ARTIFACT_QUERY; the PR-1 reviewer
 * read-scope override lets the assignee read it even outside their teaching subject.
 *
 * APPROVE advances the plan draft→reviewed server-side; CHANGES_REQUESTED requires
 * feedback (the text the admin carries to Claude Desktop). On success → back to the
 * review home.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ARTIFACT_QUERY, SUBMIT_PLAN_REVIEW } from "../../graphql/operations";
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
import Markdown from "../../components/Markdown";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  reviewStatusLabel,
  docTypeLabel,
  curationTagLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf, PDF_SUPPORTED } from "../../lib/pdf";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSubmit">;
type Verdict = "APPROVE" | "CHANGES_REQUESTED";

export default function ReviewSubmitScreen({ route, navigation }: Props): React.ReactElement {
  const { assignmentId, artifactId, initialVerdict, initialFeedback, roundStatus } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({ query: ARTIFACT_QUERY, variables: { id: artifactId } });
  const [, submitReview] = useMutation(SUBMIT_PLAN_REVIEW);

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
    if (verdict === "CHANGES_REQUESTED" && feedback.trim() === "") {
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
    navigation.goBack();
  }

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

  return (
    <Screen scroll>
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
    </Screen>
  );
}
