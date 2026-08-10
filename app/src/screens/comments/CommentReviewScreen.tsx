/**
 * CommentReviewScreen (D-#264) — the Principal/Office review dashboard. Lists every
 * UNDELIVERED daily comment (school-wide, newest first) with the child + author names.
 * Tap one → the entry screen to edit it if needed and Deliver it to the guardian.
 * Each card also carries a "Discard" action (D-#365): drop an unwanted draft with a
 * reason WITHOUT sending it to the guardian — it leaves the inbox and is kept greyed
 * on the child's staff timeline. Gated `roster:manage` (Principal/Office) — the tab/card
 * only shows for them and the server re-gates `commentReviewInbox` +
 * `deliverStudentComment` + `discardStudentComment`.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { COMMENT_REVIEW_INBOX_QUERY, DISCARD_STUDENT_COMMENT } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Badge, Button, Field, EmptyState, ErrorBanner } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, commentTypeLabel, commentSentimentLabel, isoDateTimeLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function CommentReviewScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [q, refetch] = useQuery({ query: COMMENT_REVIEW_INBOX_QUERY });
  const items = q.data?.commentReviewInbox ?? [];

  // Inline discard: the card whose reason field is open, its draft reason, and any error.
  const [discardingId, setDiscardingId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [localErr, setLocalErr] = React.useState<string | null>(null);
  const [discardRes, discard] = useMutation(DISCARD_STUDENT_COMMENT);

  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  function openDiscard(id: string): void {
    setDiscardingId(id);
    setReason("");
    setLocalErr(null);
  }

  function cancelDiscard(): void {
    setDiscardingId(null);
    setReason("");
    setLocalErr(null);
  }

  async function confirmDiscard(commentId: string): Promise<void> {
    const trimmed = reason.trim();
    if (!trimmed) {
      setLocalErr(STR.cmDiscardReasonRequired);
      return;
    }
    setLocalErr(null);
    const res = await discard({ commentId, reason: trimmed });
    if (res.error) {
      setLocalErr(res.error.graphQLErrors[0]?.message ?? res.error.message);
      return;
    }
    cancelDiscard();
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmReview}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.cmReviewSub}</Muted>
        </Card>

        <QueryGate
          result={q}
          onRetry={() => refetch({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {items.length === 0 ? (
          <EmptyState message={STR.cmNoPending} />
        ) : (
          items.map((c) => {
            const isDiscarding = discardingId === c.id;
            const busy = discardRes.fetching && isDiscarding;
            return (
              <Card
                key={c.id}
                onPress={
                  isDiscarding
                    ? undefined
                    : () =>
                        nav.navigate("CommentEntry", {
                          sectionId: c.sectionId,
                          studentId: c.studentId,
                          studentName: c.studentName,
                          commentId: c.id,
                        })
                }
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{c.studentName}</Body>
                  <Badge text={STR.cmDraftBadge} tone="muted" />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {commentTypeLabel(c.type)} · {commentSentimentLabel(c.sentiment)} · {c.authorName} ·{" "}
                  {isoDateTimeLabel(c.createdAt)}
                </Muted>
                <Body style={{ marginTop: space(1) }}>{c.text}</Body>

                {isDiscarding ? (
                  <View style={{ marginTop: space(3) }}>
                    <Muted style={{ marginBottom: space(1) }}>{STR.cmDiscardHint}</Muted>
                    <Field
                      label={STR.cmDiscardReasonLabel}
                      value={reason}
                      onChangeText={setReason}
                      placeholder={STR.cmDiscardReasonPlaceholder}
                      multiline
                      autoCapitalize="sentences"
                      editable={!busy}
                    />
                    {localErr ? <ErrorBanner message={localErr} /> : null}
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <Button
                        title={STR.cmDiscardConfirm}
                        variant="danger"
                        loading={busy}
                        disabled={busy}
                        onPress={() => void confirmDiscard(c.id)}
                        style={{ flex: 1 }}
                      />
                      <Button
                        title={STR.cmDiscardCancel}
                        variant="ghost"
                        disabled={busy}
                        onPress={cancelDiscard}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: space(2), alignItems: "flex-start" }}>
                    <Button title={STR.cmDiscard} variant="secondary" onPress={() => openDiscard(c.id)} />
                  </View>
                )}
              </Card>
            );
          })
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
