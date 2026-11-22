/**
 * ReviewStatsScreen — "পর্যালোচনার হিসাব" (owner 22 Nov 2026, .claude/plans/review-daily-stats.md).
 *
 * How many chapter plans, session plans and questions were reviewed each day, and how that compares
 * with the day before. A review counts on the day its FIRST decision was given. A reviewer sees only
 * their OWN numbers (review_stats:view_own); Office and the Principal (review_stats:view_all) get a
 * picker: the whole team, or any one reviewer.
 *
 * Top card = today vs yesterday per kind + the last 7 days and all-time totals. Below = the day-by-day
 * list, server-paged (D-#761): newest first, zero days included, each with the change on the day before.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useQuery } from "urql";
import {
  MY_REVIEW_STATS,
  MY_REVIEW_STATS_SUMMARY,
  REVIEW_STATS,
  REVIEW_STATS_REVIEWERS,
  REVIEW_STATS_SUMMARY,
  type KindCountsT,
  type ReviewStatsDayT,
} from "../../graphql/reviewStats";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Body, Card, EmptyState, ErrorBanner, H2, Muted, Screen, Select, wrapRowText } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { PAGE_SIZE, usePageState } from "../../lib/paging";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { space } from "../../theme";

const TEAM = "ALL";

/** "↑ ৩" / "↓ ২" / "সমান" - the change against the previous day. */
export function deltaText(n: number): string {
  if (n > 0) return `↑ ${bnNum(n)}`;
  if (n < 0) return `↓ ${bnNum(-n)}`;
  return STR.rvsSame;
}

const deltaTone = (n: number): "ok" | "danger" | "muted" => (n > 0 ? "ok" : n < 0 ? "danger" : "muted");

const KINDS: Array<{ key: "chapterPlans" | "sessionPlans" | "questions"; label: () => string }> = [
  { key: "chapterPlans", label: () => STR.rvsChapterPlans },
  { key: "sessionPlans", label: () => STR.rvsSessionPlans },
  { key: "questions", label: () => STR.rvsQuestions },
];

/** One kind (or the total) of the top card: today's number and the change against yesterday. */
function KindLine({ label, today, delta, bold }: { label: string; today: number; delta: number; bold?: boolean }): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), paddingVertical: space(1) }}>
      <Body style={[wrapRowText, bold ? { fontWeight: "700" } : null]}>{label}</Body>
      <Body style={{ fontWeight: "700" }}>{bnNum(today)}</Body>
      <Badge text={deltaText(delta)} tone={deltaTone(delta)} />
    </View>
  );
}

function TotalsLine({ label, c }: { label: string; c: KindCountsT }): React.ReactElement {
  return (
    <Muted style={{ marginTop: space(1) }}>
      {label}: {STR.rvsChapterPlans} {bnNum(c.chapterPlans)}, {STR.rvsSessionPlans} {bnNum(c.sessionPlans)}, {STR.rvsQuestions}{" "}
      {bnNum(c.questions)} — {STR.rvsTotal} {bnNum(c.total)}
    </Muted>
  );
}

function DayRow({ row }: { row: ReviewStatsDayT }): React.ReactElement {
  const c = row.counts;
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <Body style={[wrapRowText, { fontWeight: "700" }]}>{fullDateLabel(row.dayKey)}</Body>
        <Badge text={`${STR.rvsTotal} ${bnNum(c.total)} · ${deltaText(row.delta.total)}`} tone={c.total === 0 ? "muted" : deltaTone(row.delta.total)} />
      </View>
      <Muted style={{ marginTop: space(1) }}>
        {STR.rvsChapterPlans} {bnNum(c.chapterPlans)}, {STR.rvsSessionPlans} {bnNum(c.sessionPlans)}, {STR.rvsQuestions} {bnNum(c.questions)}
      </Muted>
    </Card>
  );
}

export default function ReviewStatsScreen(): React.ReactElement {
  const { can } = useAuth();
  const canAll = can("review_stats:view_all");
  const [who, setWho] = useState<string>(TEAM);
  const [page, setPage] = usePageState(`${canAll}|${who}`);

  const [reviewersQ] = useQuery({ query: REVIEW_STATS_REVIEWERS, pause: !canAll });
  const reviewerId = who === TEAM ? null : who;

  const [ownSumQ, refetchOwnSum] = useQuery({ query: MY_REVIEW_STATS_SUMMARY, requestPolicy: "cache-and-network", pause: canAll });
  const [ownPageQ, refetchOwnPage] = useQuery({
    query: MY_REVIEW_STATS,
    variables: { page, pageSize: PAGE_SIZE },
    requestPolicy: "cache-and-network",
    pause: canAll,
  });
  const [allSumQ, refetchAllSum] = useQuery({
    query: REVIEW_STATS_SUMMARY,
    variables: { reviewerId },
    requestPolicy: "cache-and-network",
    pause: !canAll,
  });
  const [allPageQ, refetchAllPage] = useQuery({
    query: REVIEW_STATS,
    variables: { reviewerId, page, pageSize: PAGE_SIZE },
    requestPolicy: "cache-and-network",
    pause: !canAll,
  });

  const sumQ = canAll ? allSumQ : ownSumQ;
  const pageQ = canAll ? allPageQ : ownPageQ;
  const summary = canAll ? allSumQ.data?.reviewStatsSummary : ownSumQ.data?.myReviewStatsSummary;
  const paged = canAll ? allPageQ.data?.reviewStats : ownPageQ.data?.myReviewStats;

  const reload = useCallback((): void => {
    const opts = { requestPolicy: "network-only" as const };
    if (canAll) {
      refetchAllSum(opts);
      refetchAllPage(opts);
    } else {
      refetchOwnSum(opts);
      refetchOwnPage(opts);
    }
  }, [canAll, refetchAllSum, refetchAllPage, refetchOwnSum, refetchOwnPage]);
  const { refreshing, onRefresh } = usePullRefresh(sumQ.fetching || pageQ.fetching, reload);

  // A reviewer gone from the picker (list reloaded) must not leave the screen on a stale id.
  const reviewers = reviewersQ.data?.reviewStatsReviewers;
  useEffect(() => {
    if (reviewers && who !== TEAM && !reviewers.some((r) => r.id === who)) setWho(TEAM);
  }, [reviewers, who]);

  const options = useMemo(
    () => [{ label: STR.rvsEveryone, value: TEAM }, ...(reviewers ?? []).map((r) => ({ label: r.name, value: r.id }))],
    [reviewers],
  );

  const rows = paged?.rows ?? [];
  const nothing = summary != null && summary.allTime.total === 0 && rows.every((r) => r.counts.total === 0);

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={pageQ} onRetry={reload} isEmpty={false} empty={<EmptyState message={STR.rvsEmpty} />}>
        <Muted style={{ marginBottom: space(3) }}>{STR.rvsSubtitle}</Muted>

        {canAll ? (
          <View style={{ marginBottom: space(3) }}>
            <Select label={STR.rvsWho} value={who} options={options} onChange={setWho} searchable />
          </View>
        ) : null}

        {!summary && sumQ.error ? <ErrorBanner message={friendlyError(sumQ.error)} onRetry={reload} /> : null}

        {summary ? (
          <Card>
            <H2>
              {STR.rvsToday} · {fullDateLabel(summary.todayKey)}
            </H2>
            <Muted style={{ marginBottom: space(1) }}>{STR.rvsVsYesterday}</Muted>
            {KINDS.map((k) => (
              <KindLine key={k.key} label={k.label()} today={summary.today[k.key]} delta={summary.delta[k.key]} />
            ))}
            <KindLine label={STR.rvsTotal} today={summary.today.total} delta={summary.delta.total} bold />
            <TotalsLine label={STR.rvsYesterday} c={summary.yesterday} />
            <TotalsLine label={STR.rvsLast7} c={summary.last7Days} />
            <TotalsLine label={STR.rvsAllTime} c={summary.allTime} />
          </Card>
        ) : null}

        <View style={{ marginTop: space(3) }}>
          <H2>{STR.rvsDaily}</H2>
        </View>
        {nothing ? <EmptyState message={STR.rvsEmpty} /> : rows.map((r) => <DayRow key={r.dayKey} row={r} />)}
        <Pager page={paged?.page ?? page} pageSize={paged?.pageSize ?? PAGE_SIZE} total={paged?.total ?? 0} onPage={setPage} />
      </QueryGate>
    </Screen>
  );
}
