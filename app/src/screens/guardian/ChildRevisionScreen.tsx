/**
 * ChildRevisionScreen (D-#769) — the guardian's Saturday Hifz revision, opened from the
 * sidebar. Same rows and paging as the Today card (`ChildRevisionRows`, LoadOlder).
 */
import React from "react";
import { ScrollView } from "react-native";
import { useQuery } from "urql";
import { CHILD_REVISION_QUERY } from "../../graphql/revision";
import { Screen, Body, Card, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { LoadOlder } from "../../components/LoadOlder";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { ChildRevisionRows } from "../../components/ChildCommentRevisionRows";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecentLimit } from "../../lib/useRecentLimit";
import { STR } from "../../lib/labels";
import { space } from "../../theme/tokens";

export default function ChildRevisionScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  const sid = selected?.studentId ?? "";
  const limit = useRecentLimit(sid);
  const [q, refetchQ] = useQuery({
    query: CHILD_REVISION_QUERY,
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

  const rows = q.data?.childRevision ?? [];
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <QueryGate result={q} onRetry={() => refetchQ({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.gpRevision}</Body>
            <ChildRevisionRows rows={rows} />
            {limit.more(rows.length, q.fetching) ? <LoadOlder onPress={limit.older} loading={q.fetching} /> : null}
          </Card>
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
