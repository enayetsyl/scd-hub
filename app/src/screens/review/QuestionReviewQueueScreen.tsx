/**
 * QuestionReviewQueueScreen (QR-4, Q4.1) — the reviewer's queue.
 *
 * One card per assigned question with the question rendered in place, and Accept / Reject
 * on the card itself: a reviewer works through dozens of questions here, so making them
 * open a detail screen per question would be the wrong shape entirely.
 *
 * The rejection reason is OPTIONAL (Q2.4 / D-#508) — the box appears on Reject, is labelled
 * as optional, and Reject stays enabled while it is empty. That is the deliberate divergence
 * from the plan loop, where feedback is mandatory on CHANGES_REQUESTED.
 *
 * An already-decided round stays editable until it closes, so the card keeps its verdict
 * badge and the reviewer can change their mind.
 */
import React, { useState, useCallback } from "react";
import { View, ScrollView, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "urql";
import {
  MY_QUESTION_REVIEWS,
  SUBMIT_QUESTION_REVIEW,
  type QuestionReviewRoundT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, reviewVerdictLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewQueue">;

export default function QuestionReviewQueueScreen({ navigation }: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: MY_QUESTION_REVIEWS });
  const [, submit] = useMutation(SUBMIT_QUESTION_REVIEW);

  const [openReasonFor, setOpenReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const rounds = data?.myQuestionReviews ?? [];

  async function decide(
    round: QuestionReviewRoundT,
    verdict: "APPROVE" | "CHANGES_REQUESTED",
  ): Promise<void> {
    setBusyId(round.id);
    setFailure(null);
    const trimmed = reason.trim();
    const res = await submit({
      assignmentId: round.id,
      verdict,
      // Empty → undefined: an omitted reason is the normal case, not an error (Q2.4).
      reason: verdict === "CHANGES_REQUESTED" && trimmed !== "" ? trimmed : undefined,
    });
    setBusyId(null);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    setOpenReasonFor(null);
    setReason("");
    setNotice(STR.qrDecisionSaved);
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && rounds.length === 0) return <Loader />;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={
          <RefreshControl
            refreshing={fetching}
            onRefresh={() => refetch({ requestPolicy: "network-only" })}
          />
        }
      >
        <H2>{STR.qrMyQueue}</H2>
        {error ? <ErrorBanner message={friendlyError(error)} /> : null}
        {failure ? <ErrorBanner message={failure} /> : null}
        {notice ? <Notice tone="ok" message={notice} /> : null}

        {rounds.length === 0 ? (
          <EmptyState message={STR.qrNoQueue} />
        ) : (
          rounds.map((round) => {
            const decided = round.status === "submitted";
            const reasonOpen = openReasonFor === round.id;
            return (
              <Card key={round.id} style={{ marginBottom: space(3) }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
                  <Badge text={subjectLabel(round.subject)} />
                  <Badge text={classLevelLabel(round.classLevel)} />
                  {round.marks != null ? <Badge text={`${STR.qrMarks} ${bnNum(round.marks)}`} /> : null}
                  {decided && round.verdict ? (
                    <Badge
                      text={reviewVerdictLabel(round.verdict)}
                      tone={round.verdict === "APPROVE" ? "ok" : "warn"}
                    />
                  ) : null}
                </View>

                <Body>{round.questionText ?? "—"}</Body>
                {round.qid ? <Muted>{round.qid}</Muted> : null}
                {round.artifactSuperseded ? <Notice tone="warn" message={STR.qrRoundClosed} /> : null}

                <Divider />

                {reasonOpen ? (
                  <View>
                    <Field
                      label={STR.qrReasonOptional}
                      value={reason}
                      onChangeText={setReason}
                      multiline
                      helper={STR.qrReasonHint}
                    />
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <Button
                        title={STR.qrReject}
                        variant="danger"
                        loading={busyId === round.id}
                        onPress={() => void decide(round, "CHANGES_REQUESTED")}
                      />
                      <Button
                        title={STR.cancel}
                        variant="ghost"
                        onPress={() => {
                          setOpenReasonFor(null);
                          setReason("");
                        }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                    <Button
                      title={STR.qrAccept}
                      loading={busyId === round.id}
                      onPress={() => void decide(round, "APPROVE")}
                    />
                    <Button
                      title={STR.qrReject}
                      variant="secondary"
                      onPress={() => {
                        setOpenReasonFor(round.id);
                        setReason(round.reason ?? "");
                      }}
                    />
                    <Button
                      title={STR.reviewThread}
                      variant="ghost"
                      onPress={() =>
                        navigation.navigate("QuestionReviewThread", { artifactId: round.artifactId })
                      }
                    />
                  </View>
                )}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
