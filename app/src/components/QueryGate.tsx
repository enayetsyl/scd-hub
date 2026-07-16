/**
 * QueryGate — the standard wrapper for a screen's urql query states
 * (ux-audit F2). It renders the four states with the EXISTING primitives, in
 * the same order screens hand-roll today (see SetDetailScreen):
 *
 *   1. first load  → <Loader/>            (fetching and no data yet — a
 *                                          pull-refresh refetch never blanks
 *                                          a screen that already has data)
 *   2. query error → <ErrorBanner onRetry/> — no connectivity (NetInfo) shows
 *                    STR.errOffline; online failures show friendlyError()
 *                    (server-down keeps the errNetwork copy). If SOME queries
 *                    still have data the banner renders ABOVE the children
 *                    instead of replacing them, so a partial failure keeps
 *                    the good sections.
 *   3. empty       → the screen's own `empty` node (existing copy — QueryGate
 *                    never invents empty-state text)
 *   4. success     → children
 *
 * `onRetry` should reexecute every gated query with
 * `{ requestPolicy: "network-only" }` (the same handle usePullRefresh uses).
 */
import React from "react";
import type { CombinedError } from "urql";
import { ErrorBanner, Loader } from "./ui";
import { friendlyError } from "../lib/errors";
import { STR } from "../lib/labels";
import { useOnline } from "../lib/useOnline";

type GateResult = {
  data?: unknown;
  fetching: boolean;
  error?: CombinedError;
};

export function QueryGate({
  result,
  results,
  onRetry,
  isEmpty,
  empty,
  loaderLabel,
  children,
}: {
  /** A single urql query result… */
  result?: GateResult;
  /** …or several — the gate trips on the first error / first still-loading. */
  results?: GateResult[];
  /** Reexecute the gated query/queries with `requestPolicy: "network-only"`. */
  onRetry: () => void;
  /** Screen-computed "nothing to show" flag; keeps the screen's own copy via `empty`. */
  isEmpty?: boolean;
  empty?: React.ReactNode;
  loaderLabel?: string;
  children: React.ReactNode;
}): React.ReactElement | null {
  const online = useOnline();
  const all = results ?? (result ? [result] : []);
  const failed = all.find((r) => r.error);

  if (failed?.error) {
    const banner = (
      <ErrorBanner
        message={online ? friendlyError(failed.error) : STR.errOffline}
        onRetry={onRetry}
      />
    );
    // Partial data (e.g. one card's query failed, the rest resolved): keep the
    // resolved content visible under the banner.
    const anyData = all.some((r) => r.data !== undefined);
    return anyData ? (
      <>
        {banner}
        {children}
      </>
    ) : (
      banner
    );
  }
  if (all.some((r) => r.fetching && r.data === undefined)) {
    return <Loader label={loaderLabel} />;
  }
  if (isEmpty) return <>{empty ?? null}</>;
  return <>{children}</>;
}
