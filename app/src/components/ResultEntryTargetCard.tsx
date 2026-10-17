/**
 * ResultEntryTargetCard (owner ask 2026-10-14, D-#739) — a teacher's class-test result
 * backlog on Today, the ReviewQuotaCard's sibling for a FIXED total with a due day.
 *
 * For a teacher with a target (Akter: 270 Arabic results — Book 1 14×4, Book 2 21×6,
 * Book 3 13×4, Level 4 9×4 — by 22 Oct). Renders nothing for everyone else —
 * `myResultEntryTarget` is null without a target. Headline: ahead/behind as of YESTERDAY;
 * then today's count, what today still needs, and the per-day pace to finish on time;
 * the per-level table (entered / left, plus a warning when a level's tests are not in
 * the app yet); and the day-by-day table, oldest first, with the planned days to come (dimmed, target only).
 */
import React from "react";
import { Text, View } from "react-native";
import { useQuery } from "urql";
import { MY_RESULT_ENTRY_TARGET_QUERY } from "../graphql/classTest";
import { Body, Muted, Badge, Notice } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum, monthLabel, hwSubjectLabel } from "../lib/labels";
import { makeStyles, space, typeScale } from "../theme";

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => bnNum(vars[k] ?? ""));

const shortDate = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${bnNum(d)} ${monthLabel(m - 1)}`;
};

const signed = (n: number) => (n > 0 ? `+${bnNum(n)}` : n < 0 ? `−${bnNum(-n)}` : bnNum(0));

export function ResultEntryTargetCard(): React.ReactElement | null {
  const styles = useStyles();
  const [q] = useQuery({ query: MY_RESULT_ENTRY_TARGET_QUERY, requestPolicy: "cache-and-network" });
  const p = q.data?.myResultEntryTarget;
  if (!p) return null;

  const diff = p.diffThroughYesterday;
  const headline = p.done
    ? STR.retDone
    : p.overdue
      ? fill(STR.retOverdue, { n: p.remaining })
      : diff < 0
        ? fill(STR.rqBehind, { n: -diff })
        : diff > 0
          ? fill(STR.rqAhead, { n: diff })
          : STR.rqLevel;
  const tone = p.done ? "ok" : p.overdue || diff < 0 ? "danger" : diff > 0 ? "ok" : "brand";
  const missing = p.lines.filter((l) => l.testsFound < l.tests);

  // D-#758: the headline and today's numbers are the summary; the level and day tables open on tap.
  return (
    <FoldCard
      id="today:resultEntryTarget"
      title={
        <View>
          <Body style={{ fontWeight: "700" }}>{fill(STR.retTitle, { subject: hwSubjectLabel(p.subject) })}</Body>
          <Muted>{fill(STR.retSubtitle, { total: p.total, due: shortDate(p.dueKey) })}</Muted>
        </View>
      }
      aside={<Badge text={headline} tone={tone} />}
      summary={
        <View style={styles.today}>
          {!p.done && p.todayWorking ? (
            <>
              <Body style={{ fontWeight: "600" }}>{fill(STR.rqToday, { done: p.todayEntered, target: p.todayTarget })}</Body>
              <Muted>{p.neededToday > 0 ? fill(STR.rqNeedToday, { n: p.neededToday }) : STR.rqOnTrackToday}</Muted>
            </>
          ) : !p.done ? (
            <Muted>{STR.rqNotWorking}</Muted>
          ) : null}
          <Muted>{fill(STR.retProgress, { done: p.enteredTotal, total: p.total, left: p.remaining })}</Muted>
          {p.perDayToFinish > 0 ? <Muted>{fill(STR.retPerDay, { n: p.perDayToFinish, days: p.workingDaysLeft })}</Muted> : null}
        </View>
      }
    >

      {missing.map((l) => (
        <Notice key={l.label} tone="warn" message={fill(STR.retTestsMissing, { label: l.label, found: l.testsFound, tests: l.tests })} />
      ))}

      <Text style={styles.section}>{STR.retLevelsHead}</Text>
      <View style={[styles.row, styles.headRow]}>
        <Text style={[styles.cell, styles.labelCell, styles.th]}>{STR.retColLevel}</Text>
        <Text style={[styles.cell, styles.planCell, styles.th]}>{STR.retColPlan}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.retColEntered}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.retColLeft}</Text>
      </View>
      {p.lines.map((l) => (
        <View key={l.label} style={styles.row}>
          <Text style={[styles.cell, styles.labelCell, styles.td]} numberOfLines={1}>
            {l.label}
          </Text>
          <Text style={[styles.cell, styles.planCell, styles.td]}>
            {`${bnNum(l.students)} × ${bnNum(l.tests)} = ${bnNum(l.total)}`}
          </Text>
          <Text style={[styles.cell, styles.td]}>{bnNum(l.entered)}</Text>
          <Text style={[styles.cell, styles.td, l.remaining > 0 ? null : styles.pos]}>{bnNum(l.remaining)}</Text>
        </View>
      ))}

      <Text style={styles.section}>{STR.retDaysHead}</Text>
      <View style={[styles.row, styles.headRow]}>
        <Text style={[styles.cell, styles.dateCell, styles.th]}>{STR.rqColDate}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.retColEntries}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColTotal}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColTarget}</Text>
        <Text style={[styles.cell, styles.th]}>{STR.rqColDiff}</Text>
      </View>
      {p.days.map((d) => (
        <View key={d.dateKey} style={[styles.row, (!d.working || d.future) && styles.offRow]}>
          <Text style={[styles.cell, styles.dateCell, styles.td]} numberOfLines={1}>
            {shortDate(d.dateKey)}
            {d.isToday ? ` · ${STR.rqTodayTag}` : !d.working && !d.future ? ` · ${STR.rqDayOff}` : ""}
          </Text>
          <Text style={[styles.cell, styles.td]}>{d.future ? "—" : bnNum(d.entered)}</Text>
          <Text style={[styles.cell, styles.td]}>{d.future ? "—" : bnNum(d.cumulative)}</Text>
          <Text style={[styles.cell, styles.td]}>{bnNum(d.expected)}</Text>
          <Text style={[styles.cell, styles.td, !d.future && d.diff < 0 ? styles.neg : !d.future && d.diff > 0 ? styles.pos : null]}>
            {d.future ? "—" : signed(d.diff)}
          </Text>
        </View>
      ))}
    </FoldCard>
  );
}

const useStyles = makeStyles((c) => ({
  today: { gap: 2 },
  section: { ...typeScale.caption, color: c.textSecondary, fontWeight: "700", marginTop: space(2), marginBottom: space(1) },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space(1), borderBottomWidth: 1, borderBottomColor: c.border },
  headRow: { borderBottomColor: c.border },
  offRow: { opacity: 0.6 },
  cell: { flex: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  dateCell: { flex: 2.2, textAlign: "left" },
  labelCell: { flex: 1.4, textAlign: "left" },
  planCell: { flex: 2 },
  th: { ...typeScale.caption, color: c.textSecondary },
  td: { ...typeScale.body, color: c.textPrimary },
  neg: { color: c.error, fontWeight: "600" },
  pos: { color: c.primary, fontWeight: "600" },
}));
