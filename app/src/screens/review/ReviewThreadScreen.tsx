/**
 * ReviewThreadScreen (PR-3, R3.3) — the admin view of a plan's review loop.
 *
 * Shows the full round history (oldest→newest) with each reviewer's verdict +
 * feedback and a copy-to-clipboard (the text to carry to Claude Desktop). Actions:
 *   • Assign next round (content:assign_review — Principal/Office): enter a reviewer
 *     id; supersedes any open round.
 *   • Approve / sign off (content:promote_gold — Principal) when the plan is
 *     `reviewed`: advances it to gold and closes the thread.
 *
 * Re-uploading a revised plan is the existing Import flow (Admin tab); after a
 * re-import the open round is superseded server-side (PR-2, R2.2).
 */
import React, { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { roleHasPermission } from "@scd/shared";
import {
  ARTIFACT_QUERY,
  PLAN_REVIEW_THREAD,
  ASSIGN_PLAN_REVIEW,
  APPROVE_PLAN,
  TEACHERS_QUERY,
  type ReviewAssignmentT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import { useAuth } from "../../auth/AuthContext";
import {
  Screen,
  H1,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Select,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  reviewStatusLabel,
  reviewVerdictLabel,
  reviewRoundStatusLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "ReviewThread">;

function RoundCard({ r }: { r: ReviewAssignmentT }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  async function onCopy(): Promise<void> {
    if (!r.feedback) return;
    await Clipboard.setStringAsync(r.feedback);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>
          {STR.reviewRound} {bnNum(r.roundNumber)}
        </Body>
        <View style={{ flexDirection: "row", gap: space(2) }}>
          {r.verdict ? <Badge text={reviewVerdictLabel(r.verdict)} tone={r.verdict === "APPROVE" ? "ok" : "warn"} /> : null}
          <Badge text={reviewRoundStatusLabel(r.status)} tone="muted" />
        </View>
      </View>
      {r.feedback ? (
        <>
          <Muted style={{ marginTop: space(2) }}>{r.feedback}</Muted>
          <Button title={copied ? STR.copied : STR.copyFeedback} onPress={onCopy} variant="ghost" style={{ marginTop: space(2) }} />
        </>
      ) : (
        <Muted style={{ marginTop: space(2) }}>{STR.awaitingReviewer}</Muted>
      )}
    </Card>
  );
}

export default function ReviewThreadScreen({ route }: Props): React.ReactElement {
  const { artifactId } = route.params;
  const { role } = useAuth();
  const canAssign = !!role && roleHasPermission(role, "content:assign_review");
  const canApprove = !!role && roleHasPermission(role, "content:promote_gold");

  const [{ data: tData, fetching, error }, refetchThread] = useQuery({
    query: PLAN_REVIEW_THREAD,
    variables: { artifactId },
  });
  const [{ data: aData }, refetchArtifact] = useQuery({ query: ARTIFACT_QUERY, variables: { id: artifactId } });
  const [, assignReview] = useMutation(ASSIGN_PLAN_REVIEW);
  const [, approvePlan] = useMutation(APPROVE_PLAN);
  const [{ data: teacherData }] = useQuery({ query: TEACHERS_QUERY, pause: !canAssign });
  const teacherOptions = (teacherData?.teachers ?? []).map((t) => ({
    label: t.name,
    value: t.id,
    hint: t.phone ?? undefined,
  }));

  const [reviewerId, setReviewerId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);

  const thread = tData?.planReviewThread ?? [];
  const artifact = aData?.artifact;

  function refresh(): void {
    refetchThread({ requestPolicy: "network-only" });
    refetchArtifact({ requestPolicy: "network-only" });
  }

  async function onAssign(): Promise<void> {
    if (assignBusy || reviewerId.trim() === "") return;
    setMsg(null);
    setAssignBusy(true);
    const res = await assignReview({ artifactId, reviewerId: reviewerId.trim() });
    setAssignBusy(false);
    if (res.error) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setReviewerId("");
    setMsg({ text: STR.reviewerAssigned, tone: "ok" });
    refresh();
  }

  async function onApprove(): Promise<void> {
    if (approveBusy) return;
    setMsg(null);
    setApproveBusy(true);
    const res = await approvePlan({ artifactId });
    setApproveBusy(false);
    if (res.error) {
      setMsg({ text: friendlyError(res.error), tone: "danger" });
      return;
    }
    setMsg({ text: STR.planApproved, tone: "ok" });
    refresh();
  }

  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetchThread({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }

  const title = artifact
    ? artifact.address.title || `${artifact.address.anchorWord} ${artifact.address.number}`
    : STR.reviewThread;
  const isReviewed = artifact?.reviewStatus === "reviewed";

  return (
    <Screen scroll>
      <H1>{title}</H1>
      {artifact ? (
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(1) }}>
          <Muted>
            {subjectLabel(artifact.subject)} · {classLevelLabel(artifact.classLevel)}
          </Muted>
          <Badge
            text={reviewStatusLabel(artifact.reviewStatus)}
            tone={artifact.reviewStatus === "gold" ? "ok" : artifact.reviewStatus === "reviewed" ? "brand" : "muted"}
          />
        </View>
      ) : null}

      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}

      <Divider />
      <H2>{STR.reviewThread}</H2>
      {thread.length === 0 ? <EmptyState message={STR.noInbox} /> : thread.map((r) => <RoundCard key={r.id} r={r} />)}

      {canApprove ? (
        <View style={{ marginTop: space(3) }}>
          <Button
            title={approveBusy ? STR.approving : STR.approveSignOff}
            onPress={onApprove}
            loading={approveBusy}
            disabled={!isReviewed}
            variant="primary"
          />
          {!isReviewed ? <Muted style={{ marginTop: 4 }}>{STR.approveNeedsReviewed}</Muted> : null}
        </View>
      ) : null}

      {canAssign ? (
        <Card style={{ marginTop: space(3) }}>
          <H2>{STR.assignForReview}</H2>
          <Select
            label={STR.reviewer}
            value={reviewerId === "" ? null : reviewerId}
            options={teacherOptions}
            onChange={setReviewerId}
            placeholder={STR.selectTeacher}
            emptyText={STR.noTeachers}
          />
          <Button
            title={assignBusy ? STR.assigning : STR.assignNextRound}
            onPress={onAssign}
            loading={assignBusy}
            disabled={reviewerId.trim() === ""}
            variant="secondary"
            style={{ marginTop: space(2) }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
