/**
 * EarlierHomeworkChecks (owner ask 2026-10-04) — homework-check cards from months
 * BEFORE the current one, under the work board. A check never expires (the old
 * 45-day window silently dropped unfinished ones), so an old backlog is kept here
 * rather than on the board itself: one collapsed header per month (counts only),
 * newest first, and a month's cards are fetched only when its header is opened.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "urql";
import {
  HOMEWORK_CHECK_CARDS_FOR_MONTH_QUERY,
  HOMEWORK_CHECK_MONTHS_QUERY,
  type HomeworkCheckMonthT,
  type WorkCardT,
} from "../graphql/workBoard";
import { WorkCardView } from "./WorkCardView";
import { Loader, ErrorBanner } from "./ui";
import { STR, bnNum, monthLabel } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { makeStyles, radius, space, typeScale } from "../theme";

type Props = {
  /** Someone else's board (tasks:assign drill-down); null/undefined = the caller's own. */
  userId?: string | null;
  onOpen: (card: WorkCardT) => void;
};

export function EarlierHomeworkChecks({ userId, onOpen }: Props): React.ReactElement | null {
  const styles = useStyles();
  const [q] = useQuery({
    query: HOMEWORK_CHECK_MONTHS_QUERY,
    variables: { userId: userId ?? null },
    requestPolicy: "cache-and-network",
  });
  const months = q.data?.homeworkCheckMonths ?? [];
  if (months.length === 0) return null;
  return (
    <View style={{ marginTop: space(3) }}>
      <Text style={styles.title}>{STR.wbEarlierHwTitle}</Text>
      {months.map((m) => (
        <MonthBlock key={m.monthKey} month={m} userId={userId ?? null} onOpen={onOpen} />
      ))}
    </View>
  );
}

function MonthBlock({
  month,
  userId,
  onOpen,
}: {
  month: HomeworkCheckMonthT;
  userId: string | null;
  onOpen: (card: WorkCardT) => void;
}): React.ReactElement {
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  // Paused until the header is opened — the whole point is not to load old months up front.
  const [q, refetch] = useQuery({
    query: HOMEWORK_CHECK_CARDS_FOR_MONTH_QUERY,
    variables: { monthKey: month.monthKey, userId },
    pause: !open,
    requestPolicy: "cache-and-network",
  });
  const [y, mm] = month.monthKey.split("-").map(Number);
  const cards = q.data?.homeworkCheckCardsForMonth ?? [];
  return (
    <View style={{ marginBottom: space(2) }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Text style={styles.headText}>
          {open ? "▾" : "▸"} {monthLabel(mm - 1)} {bnNum(y)}
        </Text>
        <Text style={styles.headCount}>
          {bnNum(month.copies)}
          {STR.wbEarlierHwCopies}
        </Text>
      </Pressable>
      {open ? (
        q.fetching && cards.length === 0 ? (
          <Loader label={STR.loading} />
        ) : q.error ? (
          <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
        ) : (
          cards.map((c) => <WorkCardView key={c.key} card={c} onOpen={() => onOpen(c)} />)
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  title: { ...typeScale.bodyStrong, color: c.textPrimary, marginBottom: space(1) },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space(2),
    minHeight: 48,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.md,
    backgroundColor: c.surfaceAlt,
    marginBottom: space(1),
  },
  headText: { ...typeScale.button, color: c.textPrimary },
  headCount: { ...typeScale.caption, color: c.textSecondary },
}));
