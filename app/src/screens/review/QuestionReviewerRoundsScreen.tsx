/**
 * QuestionReviewerRoundsScreen (QR-5, Q5.2; D-#537) — the list behind one progress counter.
 *
 * One reviewer × one bucket × the class/subject filter carried in from the progress screen.
 * The four tabs are the same four counters, so arriving on "with condition" and switching to
 * "rejected" does not mean going back and re-filtering.
 *
 * PAGINATED, in the shape the reviewer queue settled on after the 2026-08-24 freeze: pages
 * accumulate in local state, "another page exists" is inferred from the LAST PAGE'S SIZE
 * rather than from the count query, and the count is only ever the denominator it prints.
 * A refused or slow count must not be able to hide the Load-more button.
 */
import React, { useState, useEffect, useCallback } from "react";
import { View, RefreshControl } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import {
  QUESTION_REVIEWER_ROUNDS,
  QUESTION_REVIEWER_ROUND_COUNT,
  type QuestionReviewRoundT,
  type ReviewerBucketT,
} from "../../graphql/operations";
import type { ReviewStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Notice,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import { STR, subjectLabel, classLevelLabel, reviewStatusLabel, bnNum } from "../../lib/labels";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { QuestionEditSheet } from "../../components/QuestionEditSheet";
import { useAuth } from "../../auth/AuthContext";
import { parsePayload } from "../../lib/question";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<ReviewStackParamList, "QuestionReviewerRounds">;

const PAGE_SIZE = 50;

const TABS: { bucket: ReviewerBucketT; label: () => string }[] = [
  { bucket: "PENDING", label: () => STR.qpPending },
  { bucket: "APPROVE", label: () => STR.qpApproved },
  { bucket: "APPROVE_WITH_CONDITION", label: () => STR.qpWithCondition },
  { bucket: "CHANGES_REQUESTED", label: () => STR.qpRejected },
  { bucket: "CANCELLED", label: () => STR.qpCancelled },
];

export default function QuestionReviewerRoundsScreen({
  route,
  navigation,
}: Props): React.ReactElement {
  const colors = useColors();
  const { reviewerId, reviewerName, classLevel, subject } = route.params;
  const [bucket, setBucket] = useState<ReviewerBucketT>(route.params.bucket as ReviewerBucketT);
  const [offset, setOffset] = useState(0);
  const [rounds, setRounds] = useState<QuestionReviewRoundT[]>([]);
  const [lastPageSize, setLastPageSize] = useState<number | null>(null);

  /**
   * Correct the question from HERE (QR-15, D-#572).
   *
   * This is the screen where a condition is actually read — the reviewer’s বাক্য সহ কারণ
   * sits under the answer she objected to. The publish queue got সম্পাদনা in QR-8; this
   * drill-down did not, so reading the condition here meant navigating away to act on it.
   */
  const { can } = useAuth();
  const mayManage = can("question:manage");
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTION_REVIEWER_ROUNDS,
    variables: { reviewerId, bucket, classLevel, subject, limit: PAGE_SIZE, offset },
  });
  const [countQ, refetchCount] = useQuery({
    query: QUESTION_REVIEWER_ROUND_COUNT,
    variables: { reviewerId, bucket, classLevel, subject },
  });
  const total = countQ.data?.questionReviewerRoundCount ?? 0;
  const hasMore = lastPageSize === null ? false : lastPageSize === PAGE_SIZE;

  // Append each arriving page, keyed by id so re-fetching a page cannot duplicate a row.
  useEffect(() => {
    const page = data?.questionReviewerRounds;
    if (!page) return;
    setLastPageSize(page.length);
    setRounds((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of page) byId.set(r.id, r);
      return [...byId.values()];
    });
  }, [data]);

  const reset = useCallback(() => {
    setRounds([]);
    setOffset(0);
    setLastPageSize(null);
    refetch({ requestPolicy: "network-only" });
    refetchCount({ requestPolicy: "network-only" });
  }, [refetch, refetchCount]);

  useFocusEffect(
    useCallback(() => {
      refetch({ requestPolicy: "network-only" });
      refetchCount({ requestPolicy: "network-only" });
    }, [refetch, refetchCount]),
  );

  function switchTab(next: ReviewerBucketT): void {
    if (next === bucket) return;
    setBucket(next);
    setRounds([]);
    setOffset(0);
    setLastPageSize(null);
  }

  const scope = [
    classLevel != null ? classLevelLabel(classLevel) : null,
    subject ? subjectLabel(subject) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen
      scroll
      refreshControl={<RefreshControl refreshing={false} onRefresh={reset} />}
    >
      <H2>{reviewerName ?? "—"}</H2>
      {scope !== "" ? <Muted>{scope}</Muted> : null}
      {notice ? <Notice tone="ok" message={notice} /> : null}

      <View style={{ height: space(3) }} />
      <ChipRow>
        {TABS.map((t) => (
          <Chip
            key={t.bucket}
            label={t.label()}
            selected={bucket === t.bucket}
            onPress={() => switchTab(t.bucket)}
          />
        ))}
      </ChipRow>

      {/* A page is not the list — 50 rows out of 2,742 must not read as "nearly done". */}
      {rounds.length > 0 ? (
        <Muted>
          {total > 0 ? `${bnNum(rounds.length)} / ${bnNum(total)}` : bnNum(rounds.length)}
        </Muted>
      ) : null}
      {bucket === "CANCELLED" && rounds.length > 0 ? (
        <Muted style={{ marginTop: space(1) }}>{STR.qpCancelledHint}</Muted>
      ) : null}

      <View style={{ height: space(2) }} />
      {error ? (
        <ErrorBanner message={friendlyError(error)} onRetry={reset} />
      ) : fetching && rounds.length === 0 ? (
        <Loader label={STR.loading} />
      ) : rounds.length === 0 ? (
        <EmptyState message={STR.qpNoRounds} />
      ) : (
        <>
          {rounds.map((r) => (
            <Card
              key={r.id}
              onPress={() =>
                navigation.navigate("QuestionReviewThread", { artifactId: r.artifactId })
              }
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{r.qid ?? r.addressNumber}</Body>
                {r.questionType ? (
                  <View style={{ marginLeft: space(2) }}>
                    <Badge text={r.questionType} />
                  </View>
                ) : null}
                {r.artifactReviewStatus === "gold" ? (
                  <View style={{ marginLeft: space(2) }}>
                    {/* Why an approval can appear here and NOT in the publish queue. */}
                    <Badge text={reviewStatusLabel(r.artifactReviewStatus)} tone="gold" />
                  </View>
                ) : null}
              </View>
              {r.questionText ? (
                <Body numberOfLines={2} style={{ marginTop: space(1) }}>
                  {r.questionText}
                </Body>
              ) : null}
              {/* The options and the answer key — the same carrier the reviewer decided
                  against, so the Principal reads exactly what she read. */}
              <AnswerCarrier payload={parsePayload(r.payloadJson)} correctColor={colors.primary} />
              {r.reason ? (
                <Muted style={{ marginTop: space(1) }}>{`${STR.qrReason}: ${r.reason}`}</Muted>
              ) : null}

              {/* The condition is READ here, so it should be actionable here (D-#572).
                  The publish queue got this in QR-8; this drill-down did not, so acting on
                  a condition meant navigating away from the screen that showed it. */}
              {mayManage ? (
                <Button
                  title={STR.qeEdit}
                  variant="ghost"
                  onPress={() => setEditing(editing === r.id ? null : r.id)}
                />
              ) : null}
              {mayManage && editing === r.id ? (
                <QuestionEditSheet
                  artifactId={r.artifactId}
                  payload={parsePayload(r.payloadJson)}
                  isPublished={r.artifactReviewStatus === "gold"}
                  onDone={(message) => {
                    setEditing(null);
                    setNotice(message);
                    setRounds([]);
                    setOffset(0);
                    setLastPageSize(null);
                    refetch({ requestPolicy: "network-only" });
                    refetchCount({ requestPolicy: "network-only" });
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </Card>
          ))}
          {hasMore ? (
            <View style={{ marginTop: space(3) }}>
              <Button
                title={STR.qrLoadMore}
                variant="secondary"
                onPress={() => setOffset(rounds.length)}
                disabled={fetching}
              />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
