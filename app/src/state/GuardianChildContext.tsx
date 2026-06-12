/**
 * Guardian child context (GP-2, J5.3) — the selected child that scopes every
 * guardian screen. Fed by `myChildren` (link-scoped on the server); the first
 * child auto-selects, a single-child family simply never shows the chooser.
 * Mounted above the guardian tab set; the query pauses for staff roles.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { MY_CHILDREN_QUERY, type GuardianChildT } from "../graphql/operations";

interface GuardianChildContextValue {
  children: GuardianChildT[];
  selected: GuardianChildT | null;
  selectChild: (studentId: string) => void;
  fetching: boolean;
}

const GuardianChildContext = createContext<GuardianChildContextValue | null>(null);

export function GuardianChildProvider({
  enabled,
  children: node,
}: {
  /** True only for the GUARDIAN role — pauses the query for staff. */
  enabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [res] = useQuery({ query: MY_CHILDREN_QUERY, pause: !enabled });
  const list = useMemo(() => res.data?.myChildren ?? [], [res.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select the first child once the list arrives (GP-J1).
  useEffect(() => {
    if (list.length > 0 && !list.some((c) => c.studentId === selectedId)) {
      setSelectedId(list[0].studentId);
    }
  }, [list, selectedId]);

  const value = useMemo<GuardianChildContextValue>(
    () => ({
      children: list,
      selected: list.find((c) => c.studentId === selectedId) ?? null,
      selectChild: setSelectedId,
      fetching: res.fetching,
    }),
    [list, selectedId, res.fetching],
  );

  return <GuardianChildContext.Provider value={value}>{node}</GuardianChildContext.Provider>;
}

export function useGuardianChild(): GuardianChildContextValue {
  const ctx = useContext(GuardianChildContext);
  if (!ctx) throw new Error("useGuardianChild must be used within GuardianChildProvider");
  return ctx;
}
