/**
 * BucketFold (RF-1, owner 25 Nov 2026) — one CLOSED-by-default fold of a reviewer's list
 * ("অনুমোদন দিয়েছি (n)", "পরিবর্তন চেয়েছি (n)", "চূড়ান্ত … (n)").
 *
 * A FoldCard whose header carries the count and whose body — mounted only while the fold is
 * open — runs its own paged query, so three long histories cost nothing until somebody opens
 * one. The body is keyed on the filter + `reloadKey`, so a new filter or a decision made
 * elsewhere on the screen starts it clean instead of showing stale rows.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, type TypedDocumentNode } from "urql";
import { FoldCard } from "./FoldCard";
import { LoadOlder } from "./LoadOlder";
import { Badge, EmptyState, ErrorBanner, Loader } from "./ui";
import { STR, bnNum } from "../lib/labels";
import { friendlyError } from "../lib/errors";

const PAGE = 20;

export function BucketList<D, V extends object, Row extends { id: string }>({
  query,
  variables,
  pick,
  renderRow,
  emptyText,
}: {
  query: TypedDocumentNode<D, V>;
  variables: Record<string, unknown>;
  pick: (data: D) => Row[];
  renderRow: (row: Row, reload: () => void) => React.ReactElement;
  /** Shown when the list is empty (default: "nothing here"). */
  emptyText?: string;
}): React.ReactElement {
  const [offset, setOffset] = React.useState(0);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [lastSize, setLastSize] = React.useState<number | null>(null);
  const [{ data, fetching, error }, refetch] = useQuery({
    query,
    variables: { ...variables, limit: PAGE, offset } as unknown as V,
    requestPolicy: "cache-and-network",
  });
  React.useEffect(() => {
    if (!data) return;
    const page = pick(data);
    setLastSize(page.length);
    // The first page REPLACES the rows (a reload must drop rows that left the fold); later pages merge.
    if (offset === 0) {
      setRows(page);
      return;
    }
    setRows((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r]));
      for (const r of page) byId.set(r.id, r);
      return [...byId.values()];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) return <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />;
  if (fetching && rows.length === 0) return <Loader label={STR.loading} />;
  if (rows.length === 0) return <EmptyState message={emptyText ?? STR.rfEmptyFold} />;
  return (
    <View>
      {rows.map((r) => renderRow(r, () => refetch({ requestPolicy: "network-only" })))}
      <LoadOlder
        onPress={() => setOffset(rows.length)}
        loading={fetching}
        exhausted={lastSize === null || lastSize < PAGE}
        label={`${STR.qrLoadMore} (${bnNum(rows.length)})`}
      />
    </View>
  );
}

export function BucketFold<D, V extends object, Row extends { id: string }>({
  id,
  title,
  count,
  query,
  variables,
  reloadKey,
  pick,
  renderRow,
}: {
  /** Stable id: FoldCard remembers open/closed per id for the session. */
  id: string;
  title: string;
  count: number;
  query: TypedDocumentNode<D, V>;
  /** Filter variables WITHOUT paging — the fold adds limit/offset itself. */
  variables: Record<string, unknown>;
  /** Bump to make an open fold reload (a decision was made elsewhere on the screen). */
  reloadKey: number;
  pick: (data: D) => Row[];
  renderRow: (row: Row, reload: () => void) => React.ReactElement;
}): React.ReactElement {
  return (
    <FoldCard id={id} title={title} aside={<Badge text={bnNum(count)} tone="muted" />}>
      <BucketList
        key={`${JSON.stringify(variables)}|${reloadKey}`}
        query={query}
        variables={variables}
        pick={pick}
        renderRow={renderRow}
      />
    </FoldCard>
  );
}
