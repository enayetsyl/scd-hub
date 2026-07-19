/**
 * CommentReviewScreen (D-#264) — the Principal/Office review dashboard. Lists every
 * UNDELIVERED daily comment (school-wide, newest first) with the child + author names.
 * Tap one → the entry screen to edit it if needed and Deliver it to the guardian.
 * Gated `roster:manage` (Principal/Office) — the tab/card only shows for them and the
 * server re-gates `commentReviewInbox` + `deliverStudentComment`.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { COMMENT_REVIEW_INBOX_QUERY } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Badge, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, commentTypeLabel, commentSentimentLabel, isoDateLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<CommentsStackParamList>;

export default function CommentReviewScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [q, refetch] = useQuery({ query: COMMENT_REVIEW_INBOX_QUERY });
  const items = q.data?.commentReviewInbox ?? [];

  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

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
          items.map((c) => (
            <Card
              key={c.id}
              onPress={() =>
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
                {isoDateLabel(c.createdAt)}
              </Muted>
              <Body style={{ marginTop: space(1) }}>{c.text}</Body>
            </Card>
          ))
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
