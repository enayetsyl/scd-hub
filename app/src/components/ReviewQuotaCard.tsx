/**
 * ReviewQuotaCard (owner ask 2026-10-12) — "আমার রিভিউ লক্ষ্য" on Today.
 *
 * For an observer with a daily review target (Mahzabin Yasmin: 3 per working day from
 * 2 Oct). Renders nothing for everyone else — `myReviewQuota` is null without a quota.
 * Headline: ahead/behind as of YESTERDAY (today is still running), then today's count
 * and what today still needs to be level by tonight; below, the day-by-day table
 * (newest first): reviewed, running total, target, difference.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "urql";
import { MY_REVIEW_QUOTA_QUERY, type ReviewQuotaDayT } from "../graphql/observation";
import { Body, Muted, Card, Badge } from "./ui";
import { STR, bnNum, monthLabel } from "../lib/labels";
import { makeStyles, space, typeScale } from "../theme";

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => bnNum(vars[k] ?? ""));

const shortDate = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${bnNum(d)} ${monthLabel(m - 1)}`;
};

const signed = (n: number) => (n > 0 ? `+${bnNum(n)}` : n < 0 ? `−${bnNum(-n)}` : bnNum(0));

const VISIBLE_ROWS = 7;

export function ReviewQuotaCard(): React.ReactElement | null {
  const styles = useStyles();
  const [q] = useQuery({ query: MY_REVIEW_QUOTA_QUERY, requestPolicy: "cache-and-network" });
  const [showAll, setShowAll] = React.useState(false);
  const p = q.data?.myReviewQuota;
  if (!p) return null;

  const diff = p.diffThroughYesterday;
  const headline =
    diff < 0 ? fill(STR.rqBehind, { n: -diff }) : diff > 0 ? fill(STR.rqAhead, { n: diff }) : STR.rqLevel;
  const tone = diff < 0 ? "danger" : diff > 0 ? "ok" : "brand";
  const rows: ReviewQuotaDayT[] = [...p.days].reverse();
  const shown = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <Card>
      <View style={styles.head}>
        <View style={{ flexShrink: 1 }}>
          <Body style={{ fontWeight: "700" }}>{STR.rqTitle}</Body>
          <Muted>{fill(STR.rqSubtitle, { n: p.perDay, date: shortDate(p.startKey) })}</Muted>
        </View>
        <Badge text={headline} tone={tone} />
      </View>

      <View style={styles.today}>
        {p.todayWorking ? (
          <>
            <Body style={{ fontWeight: "600" }}>{fill(STR.rqToday, { done: p.todayReviewed, target: p.todayTarget })}</Body>
            <Muted>{p.neededToday > 0 ? fill(STR.rqNeedToday, { n: p.neededToday }) : STR.rqOnTrackToday}</Muted>
          </>
        ) : (
          <Muted>{STR.rqNotWorking}</Muted>
        )}
        <Muted>{fill(STR.rqTotals, { done: p.reviewedThroughYesterday, target: p.expectedThroughYesterday })}</Muted>
      </View>

      <View style={[styles.row, styles.headRow]}>
        <Text style={[styles.cell, styles.dateCell, styles.th]}>{STR.rqColDate}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColReviewed}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColTotal}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColTarget}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColDiff}</Text>
      </View>
      {shown.map((d) => (
        <View key={d.dateKey} style={[styles.row, !d.working && styles.offRow]}>
          <Text style={[styles.cell, styles.dateCell, styles.td]} numberOfLines={1}>
            {shortDate(d.dateKey)}
            {d.isToday ? ` · ${STR.rqTodayTag}` : !d.working ? ` · ${STR.rqDayOff}` : ""}
          </Text>
          <Text style={[styles.cell, styles.td]}>{bnNum(d.reviewed)}</Text>
          <Text style={[styles.cell, styles.td]}>{bnNum(d.cumulative)}</Text>
          <Text style={[styles.cell, styles.td]}>{bnNum(d.expected)}</Text>
          <Text style={[styles.cell, styles.td, d.diff < 0 ? styles.neg : d.diff > 0 ? styles.pos : null]}>{signed(d.diff)}</Text>
        </View>
      ))}
      {rows.length > VISIBLE_ROWS ? (
        <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" style={{ marginTop: space(2) }}>
          <Text style={styles.link}>{showAll ? STR.rqShowLess : STR.rqShowAll}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space(2) },
  today: { marginTop: space(2), marginBottom: space(2), gap: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space(1), borderBottomWidth: 1, borderBottomColor: c.border },
  headRow: { borderBottomColor: c.border },
  offRow: { opacity: 0.6 },
  cell: { flex: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  dateCell: { flex: 2.2, textAlign: "left" },
  th: { ...typeScale.caption, color: c.textSecondary },
  td: { ...typeScale.body, color: c.textPrimary },
  neg: { color: c.error, fontWeight: "600" },
  pos: { color: c.primary, fontWeight: "600" },
  link: { ...typeScale.caption, color: c.primary },
}));
