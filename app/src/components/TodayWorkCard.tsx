/**
 * TodayWorkCard (WB-4, D-#701) — the work board's presence on the Today screens.
 * Owner, on the first prod test: *"the tasks are not showing in the today but in the
 * tasks. shouldn't it show in the today section."* One card: today's open count,
 * overdue count, and the first few open cards as compact rows; every row and the
 * header open the board. Self-contained (own query) so it drops into BOTH Today
 * screens without touching their data flow. Renders nothing while loading with no
 * data, and nothing on error — a broken card must never break Today.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_WORK_BOARD_QUERY, type WorkCardT } from "../graphql/workBoard";
import type { TabParamList } from "../navigation/types";
import { Card } from "./ui";
import { STR, bnNum, daySlotLabel, taskPriorityLabel, workCardKindLabel } from "../lib/labels";
import { dateKey } from "../lib/dates";
import { cardTarget, minutesLabel } from "../lib/workBoardNav";
import { makeStyles, radius, space, typeScale, useColors } from "../theme";

const MAX_ROWS = 5;

export function TodayWorkCard(): React.ReactElement | null {
  const styles = useStyles();
  const colors = useColors();
  const nav = useNavigation<NavigationProp<TabParamList>>();
  const today = dateKey();
  const [q] = useQuery({ query: MY_WORK_BOARD_QUERY, variables: { fromKey: today, toKey: today }, requestPolicy: "cache-and-network" });
  const cards: WorkCardT[] = q.data?.myWorkBoard ?? [];
  if (q.error || (q.fetching && !q.data)) return null;

  const open = cards.filter((c) => c.status !== "DONE");
  const overdue = open.filter((c) => c.overdue);
  const done = cards.filter((c) => c.status === "DONE");
  const minutes = open.reduce((n, c) => n + c.effortMin, 0);
  const shown = open.slice(0, MAX_ROWS);

  const go = (screen: string, params?: object): void =>
    (nav.navigate as unknown as (name: string, p?: object) => void)("WorkBoardTab", { screen, params, initial: false });

  const openCard = (c: WorkCardT): void => {
    if (c.kind === "TASK" && c.taskId) {
      go("TaskDetail", { taskId: c.taskId });
      return;
    }
    const t = cardTarget(c.link);
    if (!t) {
      go("WorkBoard");
      return;
    }
    (nav.navigate as unknown as (name: string, p?: object) => void)(t.tab, { screen: t.screen, params: t.params, initial: false });
  };

  return (
    <Card>
      <Pressable onPress={() => go("WorkBoard")} style={styles.head}>
        <Text style={styles.title}>{STR.wbTodayCount}</Text>
        <Text style={[styles.link, { color: colors.primary }]}>{STR.wbSeeAll}</Text>
      </Pressable>
      <View style={styles.stats}>
        <Text style={styles.stat}>
          <Text style={styles.statN}>{bnNum(open.length)}</Text> {STR.wbOpen}
        </Text>
        <Text style={styles.stat}>
          <Text style={styles.statN}>{bnNum(done.length)}</Text> {STR.wbDone}
        </Text>
        <Text style={[styles.stat, overdue.length > 0 && { color: colors.error }]}>
          <Text style={[styles.statN, overdue.length > 0 && { color: colors.error }]}>{bnNum(overdue.length)}</Text> {STR.wbOverdue}
        </Text>
        {open.length > 0 ? <Text style={styles.stat}>{minutesLabel(minutes, bnNum)}</Text> : null}
      </View>
      {shown.length === 0 ? (
        <Text style={styles.empty}>{STR.wbNothingToday}</Text>
      ) : (
        shown.map((c) => {
          const manual = c.kind === "TASK";
          return (
            <Pressable key={c.key} onPress={() => openCard(c)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={[styles.dot, { backgroundColor: c.overdue ? colors.error : manual ? colors.primary : colors.info }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {c.titleBn}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[
                    c.overdue ? STR.wbOverdue : c.slot !== "ANY" ? daySlotLabel(c.slot) : null,
                    manual ? (c.priority === "URGENT" ? taskPriorityLabel("URGENT") : null) : workCardKindLabel(c.kind),
                    manual && c.assignedByName ? c.assignedByName : null,
                    minutesLabel(c.effortMin, bnNum),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Text style={[styles.chev, { color: colors.textDisabled }]}>›</Text>
            </Pressable>
          );
        })
      )}
      {open.length > MAX_ROWS ? (
        <Pressable onPress={() => go("WorkBoard")}>
          <Text style={[styles.more, { color: colors.primary }]}>{`+${bnNum(open.length - MAX_ROWS)} · ${STR.wbSeeAll}`}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: space(1) },
  title: { ...typeScale.sectionTitle, color: c.textPrimary },
  link: { ...typeScale.chip },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: space(3), marginBottom: space(2) },
  stat: { ...typeScale.caption, color: c.textSecondary },
  statN: { ...typeScale.bodyStrong, color: c.textPrimary },
  empty: { ...typeScale.secondary, color: c.textSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingVertical: space(2),
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  pressed: { opacity: 0.7 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  rowTitle: { ...typeScale.secondary, color: c.textPrimary },
  rowMeta: { ...typeScale.caption, color: c.textSecondary },
  chev: { ...typeScale.body },
  more: { ...typeScale.chip, paddingTop: space(2) },
}));
