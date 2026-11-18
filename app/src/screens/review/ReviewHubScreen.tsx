/**
 * ReviewHubScreen (H-1, .claude/plans/review-hub-and-quality.md) — "আমার পর্যালোচনা".
 *
 * ONE list of every review the caller still owes — plans, questions, exam papers, syllabus
 * sign-offs, objective lists, observations, class videos, class-test question requests, support
 * books, winter booklets and review cards on the work board — grouped by kind, with the বাকি
 * count and the due date on each row. A tap opens the EXISTING screen where that review is done;
 * nothing here changes how a review is done. The server shows each group only when the caller
 * holds that review's permission, so this screen needs no permission checks of its own.
 */
import React, { useCallback, useMemo, useRef } from "react";
import { RefreshControl, View } from "react-native";
import { StackActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_REVIEW_HUB, type ReviewHubRowT } from "../../graphql/reviewHub";
import { Badge, Body, Card, EmptyState, H2, Muted, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, dhakaDateKey, fullDateLabel } from "../../lib/labels";
import { usePullRefresh } from "../../lib/useRefresh";
import { space } from "../../theme";

type LabelKey = keyof typeof STR;

/** The order the groups appear in: the long-running work first, the small desks after. */
const KIND_ORDER = [
  "PLAN",
  "QUESTION",
  "EXAM_PAPER",
  "SYLLABUS",
  "MASTERY",
  "OBSERVATION",
  "VIDEO",
  "CT_QUESTION",
  "BOOK",
  "WINTER",
  "TASK",
] as const;

const kindTitle = (kind: string): string => (STR[`rhKind${kind}` as LabelKey] as string | undefined) ?? kind;

type DueState = "overdue" | "today" | "later";
export function dueState(dueKey: string, todayKey: string): DueState {
  if (dueKey < todayKey) return "overdue";
  return dueKey === todayKey ? "today" : "later";
}

/** Opens the screen a row names, the way a notification link does: root → tab → screen. */
function useOpenRow(): (row: ReviewHubRowT) => void {
  const nav = useNavigation();
  return useCallback(
    (row: ReviewHubRowT): void => {
      let params: Record<string, unknown> | undefined;
      try {
        params = row.paramsJson ? (JSON.parse(row.paramsJson) as Record<string, unknown>) : undefined;
      } catch {
        params = undefined;
      }
      // A row of the hub's OWN stack (ReviewHome, a queue) is PUSHED: navigate() would pop back down to
      // ReviewHome at index 0 and the hub would vanish from the Back path.
      if (row.tab === "ReviewTab") {
        nav.dispatch(StackActions.push(row.screen, params));
        return;
      }
      (nav as unknown as { navigate: (n: string, p?: object) => void }).navigate("App", {
        screen: row.tab,
        params: params ? { screen: row.screen, params, initial: false } : { screen: row.screen, initial: false },
      });
    },
    [nav],
  );
}

function HubRow({ row, todayKey, onOpen }: { row: ReviewHubRowT; todayKey: string; onOpen: (r: ReviewHubRowT) => void }): React.ReactElement {
  const due = row.dueKey ? dueState(row.dueKey, todayKey) : null;
  return (
    <Card onPress={() => onOpen(row)}>
      <Body style={{ fontWeight: "700" }}>{row.titleBn}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: space(2) }}>
        <Badge text={`${STR.rhLeft} ${bnNum(row.left)}${row.total > row.left ? ` / ${STR.rhOf} ${bnNum(row.total)}` : ""}`} tone="warn" />
        {row.dueKey && due ? (
          <Badge
            text={due === "overdue" ? STR.rhOverdue : due === "today" ? STR.rhDueToday : STR.rhDue}
            tone={due === "overdue" ? "danger" : due === "today" ? "warn" : "muted"}
          />
        ) : null}
      </View>
      {row.dueKey ? (
        <Muted style={{ marginTop: space(1) }}>
          {STR.rhDue}: {fullDateLabel(row.dueKey)}
        </Muted>
      ) : null}
    </Card>
  );
}

export default function ReviewHubScreen(): React.ReactElement {
  const [q, refetch] = useQuery({ query: MY_REVIEW_HUB, requestPolicy: "cache-and-network" });
  const open = useOpenRow();
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));

  // Coming back from a review: the counts must drop without a reload. Skip the first focus
  // (the query above is already fetching).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );

  const rows = q.data?.myReviewHub.rows ?? [];
  const totalLeft = q.data?.myReviewHub.totalLeft ?? 0;
  const todayKey = dhakaDateKey();
  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) })).filter((g) => g.rows.length > 0),
    [rows],
  );

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate
        result={q}
        onRetry={() => refetch({ requestPolicy: "network-only" })}
        isEmpty={rows.length === 0}
        empty={<EmptyState message={STR.rhEmpty} />}
      >
        <Body style={{ fontWeight: "700", marginBottom: space(1) }}>
          {STR.rhTodayCard}: {bnNum(totalLeft)}
        </Body>
        <Muted style={{ marginBottom: space(3) }}>{STR.rhSubtitle}</Muted>
        {groups.map((g) => {
          const left = g.rows.reduce((n, r) => n + r.left, 0);
          return (
            <View key={g.kind} style={{ marginBottom: space(3) }}>
              <H2>
                {kindTitle(g.kind)} · {bnNum(left)}
              </H2>
              {g.rows.map((r) => (
                <HubRow key={r.key} row={r} todayKey={todayKey} onOpen={open} />
              ))}
            </View>
          );
        })}
      </QueryGate>
    </Screen>
  );
}
