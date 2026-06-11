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
  Body,
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
import { STR, subjectLabel, classLevelLabel, reviewStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewSubmit">;
type Verdict = "APPROVE" | "CHANGES_REQUESTED";

export default function ReviewSubmitScreen({ route, navigation }: Props): React.ReactElement {
  const { assignmentId, artifactId } = route.params;
  const [{ data, fetching, error }, refetch] = useQuery({ query: ARTIFACT_QUERY, variables: { id: artifactId } });
  const [, submitReview] = useMutation(SUBMIT_PLAN_REVIEW);

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const a = data?.artifact;

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

  return (
    <Screen scroll>
      <H1>{title}</H1>
      <Muted>
        {subjectLabel(a.subject)} · {classLevelLabel(a.classLevel)}
      </Muted>
      <View style={{ flexDirection: "row", marginTop: space(2) }}>
        <Badge
          text={reviewStatusLabel(a.reviewStatus)}
          tone={a.reviewStatus === "gold" ? "ok" : a.reviewStatus === "reviewed" ? "brand" : "muted"}
        />
      </View>

      <Divider />

      {a.renderedMarkdown ? <Body>{a.renderedMarkdown}</Body> : <Notice message={STR.noMarkdown} tone="warn" />}

      <Divider />

      <Card>
        <H2>{STR.submitReview}</H2>
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
          title={busy ? STR.submittingReview : STR.submitReview}
          onPress={onSubmit}
          loading={busy}
          disabled={!verdict}
          style={{ marginTop: space(2) }}
        />
      </Card>
    </Screen>
  );
}
