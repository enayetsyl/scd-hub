/**
 * A history card's row bound (D-#761): starts at RECENT_ROWS, "load older" widens it,
 * and a newly selected child starts over. `more` = the last fetch filled the bound, so
 * older rows may exist (or a widening is in flight — keep the button up, spinning).
 *
 * Moved out of GuardianHomeScreen (D-#769) so the guardian's own Teacher comments and
 * Saturday revision screens page the same way the Today cards do.
 */
import React from "react";

export const RECENT_ROWS = 5;

export function useRecentLimit(childId: string): {
  limit: number;
  older: () => void;
  more: (rows: number, fetching?: boolean) => boolean;
} {
  const [limit, setLimit] = React.useState(RECENT_ROWS);
  React.useEffect(() => setLimit(RECENT_ROWS), [childId]);
  return {
    limit,
    older: () => setLimit((n) => n + RECENT_ROWS * 2),
    more: (rows, fetching = false) => rows >= limit || (fetching && limit > RECENT_ROWS),
  };
}
