/**
 * Pull-to-refresh helper (UX-7, prd-ux-improvements.md §4.7, D-#265) — ties a
 * RefreshControl to an urql refetch: the spinner shows from the pull gesture
 * until the refetch settles (urql's reexecute is fire-and-forget, so completion
 * is observed via the query's `fetching` flag).
 *
 *   const { refreshing, onRefresh } = usePullRefresh(q.fetching, () =>
 *     refetch({ requestPolicy: "network-only" }));
 *   <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} …
 */
import React from "react";

export function usePullRefresh(
  fetching: boolean,
  refetch: () => void,
): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = React.useState(false);
  React.useEffect(() => {
    if (refreshing && !fetching) setRefreshing(false);
  }, [refreshing, fetching]);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    refetch();
  }, [refetch]);
  return { refreshing, onRefresh };
}
