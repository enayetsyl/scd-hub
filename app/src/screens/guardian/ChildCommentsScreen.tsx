/**
 * ChildCommentsScreen (D-#769) — the guardian's Teacher comments, opened from the
 * sidebar. Same rows and paging as the Today card (`ChildCommentRows`, LoadOlder);
 * before this the comments were reachable only by scrolling to the bottom of Today.
 */
import React from "react";
import { ScrollView } from "react-native";
import { useQuery } from "urql";
import { CHILD_COMMENTS_QUERY } from "../../graphql/comments";
import { Screen, Body, Card, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { LoadOlder } from "../../components/LoadOlder";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { ChildCommentRows } from "../../components/ChildCommentRevisionRows";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecentLimit } from "../../lib/useRecentLimit";
import { useFileOpen } from "../../lib/useFileOpen";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";

export default function ChildCommentsScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  const sid = selected?.studentId ?? "";
  const { openingId, runOpen } = useFileOpen();
  const limit = useRecentLimit(sid);
  const [q, refetchQ] = useQuery({
    query: CHILD_COMMENTS_QUERY,
    variables: { studentId: sid, limit: limit.limit },
    pause: !selected,
    requestPolicy: "cache-and-network",
  });

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const rows = q.data?.childComments ?? [];
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <QueryGate result={q} onRetry={() => refetchQ({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.gpComments}</Body>
            <ChildCommentRows rows={rows} openingId={openingId} runOpen={runOpen} />
            {limit.more(rows.length, q.fetching) ? <LoadOlder onPress={limit.older} loading={q.fetching} /> : null}
          </Card>
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
