/**
 * CommentUnreadScreen (D-#882) — the Office's follow-up list: comments that were sent but
 * that no one in the family has confirmed with "পড়েছি" yet, oldest first. A family with
 * no app login can never see the pop-up, so its row says so and offers the phone.
 * Gated `student_comments:read_status` (the hub card and the server both check it).
 * Pages on the server (`unreadStudentCommentsPage`, 50 a page, D-#761).
 */
import React from "react";
import { Linking, ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "urql";
import { UNREAD_STUDENT_COMMENTS_PAGE_QUERY } from "../../graphql/comments";
import { Screen, Card, Body, Muted, Badge, Button, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { usePageState, PAGE_SIZE } from "../../lib/paging";
import { STR, bnNum, commentTypeLabel, commentSentimentLabel, isoDateTimeLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

export default function CommentUnreadScreen(): React.ReactElement {
  const [page, setPage] = usePageState();
  const [q, refetch] = useQuery({ query: UNREAD_STUDENT_COMMENTS_PAGE_QUERY, variables: { page, pageSize: PAGE_SIZE } });
  const pageData = q.data?.unreadStudentCommentsPage;
  const items = pageData?.rows ?? [];

  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cmrUnreadTitle}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.cmrUnreadSub}</Muted>
          {pageData ? <Muted style={{ marginTop: space(1) }}>{STR.cmrUnreadCount.replace("{n}", bnNum(pageData.total))}</Muted> : null}
        </Card>

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {items.length === 0 ? (
            <EmptyState message={STR.cmrUnreadEmpty} />
          ) : (
            items.map((c) => (
              <Card key={c.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{c.studentName}</Body>
                  <Badge text={commentSentimentLabel(c.sentiment)} tone={c.sentiment === "CONCERN" ? "danger" : "ok"} />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {[c.classLabel, commentTypeLabel(c.type), STR.cmrSentBy.replace("{name}", c.authorName)].filter(Boolean).join(" · ")}
                </Muted>
                <Muted>{STR.cmrSentAt.replace("{time}", isoDateTimeLabel(c.deliveredAt))}</Muted>
                <Body style={{ marginTop: space(1) }} numberOfLines={4}>
                  {c.text}
                </Body>
                {!c.hasAppLogin ? (
                  <View style={{ marginTop: space(2), alignItems: "flex-start" }}>
                    <Badge text={STR.cmrNoLogin} tone="warn" />
                  </View>
                ) : null}
                <View style={{ marginTop: space(2), alignItems: "flex-start" }}>
                  {c.phone ? (
                    <Button title={`${STR.cmrCall} · ${c.phone}`} variant="secondary" onPress={() => void Linking.openURL(`tel:${c.phone}`)} />
                  ) : (
                    <Muted>{STR.cmrNoPhone}</Muted>
                  )}
                </View>
              </Card>
            ))
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={pageData?.total ?? 0} onPage={setPage} />
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
