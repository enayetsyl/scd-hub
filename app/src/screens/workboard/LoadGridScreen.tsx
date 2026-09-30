/**
 * LoadGridScreen (WB-3, D-#701) — the Principal's load grid: open hours per person
 * per day for a Sat–Thu week, coloured PER CATEGORY (teacher / office / support
 * thresholds live in shared vocab). A cell opens that person's board on that day,
 * where a manual task can be moved to another slot, day or person.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { HR_CATEGORY_LABELS_BN, HR_CATEGORY_LABELS_EN, WORK_LOAD_THRESHOLDS_MIN, type HrCategory } from "@scd/shared";
import { WORK_LOAD_GRID_QUERY, type LoadRowT } from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Muted, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, getActiveLang, weekdayShortLabel } from "../../lib/labels";
import { addDaysKey, dateKey } from "../../lib/dates";
import { hoursLabel } from "../../lib/workBoardNav";
import { makeStyles, radius, space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "LoadGrid">;

/** Local weekday (0 = Sun … 6 = Sat) of a YYYY-MM-DD key — component-parsed, never
 *  `new Date(key)` (UTC midnight shifts the weekday, D-#304). */
function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** The Saturday on or before `key` — the school week starts on Saturday (Friday off). */
function weekStart(key: string): string {
  const back = (weekdayOf(key) + 1) % 7; // Sat → 0, Sun → 1, … Fri → 6
  return addDaysKey(key, -back);
}

export default function LoadGridScreen({ navigation }: Props): React.ReactElement {
  const styles = useStyles();
  const colors = useColors();
  const today = dateKey();
  const [start, setStart] = React.useState(weekStart(today));
  const fromKey = start;
  const toKey = addDaysKey(start, 5); // Sat … Thu
  const [q, refetchQ] = useQuery({ query: WORK_LOAD_GRID_QUERY, variables: { fromKey, toKey }, requestPolicy: "cache-and-network" });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const rows: LoadRowT[] = q.data?.workLoadGrid ?? [];
  const days = rows[0]?.cells.map((c) => c.dateKey) ?? Array.from({ length: 6 }, (_, i) => addDaysKey(start, i));

  const catLabel = (c: string | null): string => {
    if (!c) return "—";
    const map = getActiveLang() === "en" ? HR_CATEGORY_LABELS_EN : HR_CATEGORY_LABELS_BN;
    return (map as Record<string, string>)[c] ?? c;
  };
  const threshold = (c: string | null): string => {
    const t = WORK_LOAD_THRESHOLDS_MIN[(c ?? "teacher") as HrCategory] ?? WORK_LOAD_THRESHOLDS_MIN.teacher;
    return `amber ≥ ${hoursLabel(t.amber, bnNum)}h · red ≥ ${hoursLabel(t.red, bnNum)}h`;
  };
  const cellBg = (level: string): string | undefined => (level === "red" ? colors.errorContainer : level === "amber" ? colors.warningContainer : undefined);
  const cellFg = (level: string): string => (level === "red" ? colors.error : level === "amber" ? colors.warning : colors.textPrimary);

  // Group rows by category, in the server's order.
  const groups: Array<{ category: string | null; rows: LoadRowT[] }> = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === r.category) last.rows.push(r);
    else groups.push({ category: r.category, rows: [r] });
  }

  return (
    <Screen scroll wide>
      <View style={styles.nav}>
        <Pressable onPress={() => setStart(addDaysKey(start, -7))}>
          <Text style={styles.navBtn}>{STR.wbPrevWeek}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{`${bnNum(fromKey)} – ${bnNum(toKey)}`}</Text>
        <Pressable onPress={() => setStart(addDaysKey(start, 7))}>
          <Text style={styles.navBtn}>{STR.wbNextWeek}</Text>
        </Pressable>
      </View>
      <Muted style={{ marginBottom: space(2) }}>{STR.wbLoadLegend}</Muted>
      <QueryGate result={q} onRetry={refetch} isEmpty={rows.length === 0} empty={<EmptyState message={STR.wbEmpty} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={styles.tr}>
              <View style={[styles.th, styles.nameCol]}>
                <Text style={styles.thText}>{STR.wbAssignee}</Text>
              </View>
              {days.map((d) => (
                <View key={d} style={[styles.th, styles.dayCol, d === today && styles.todayCol]}>
                  <Text style={styles.thText}>{`${weekdayShortLabel(weekdayOf(d))} ${bnNum(d.slice(8))}`}</Text>
                </View>
              ))}
              <View style={[styles.th, styles.dayCol]}>
                <Text style={styles.thText}>{STR.wbWeekTotal}</Text>
              </View>
            </View>
            {groups.map((g) => (
              <View key={g.category ?? "none"}>
                <View style={[styles.tr, styles.catRow]}>
                  <Text style={styles.catText}>{`${catLabel(g.category)} · ${threshold(g.category)}`}</Text>
                </View>
                {g.rows.map((r) => (
                  <View key={r.userId} style={styles.tr}>
                    <Pressable style={[styles.td, styles.nameCol]} onPress={() => navigation.navigate("WorkBoard", { userId: r.userId, name: r.name })}>
                      <Text style={styles.name} numberOfLines={1}>
                        {r.name}
                      </Text>
                    </Pressable>
                    {r.cells.map((c) => (
                      <Pressable
                        key={c.dateKey}
                        style={[styles.td, styles.dayCol, c.dateKey === today && styles.todayCol, cellBg(c.level) ? { backgroundColor: cellBg(c.level) } : null]}
                        onPress={() => navigation.navigate("WorkBoard", { userId: r.userId, name: r.name, dateKey: c.dateKey })}
                      >
                        <Text style={[styles.cell, { color: cellFg(c.level) }, c.level !== "ok" && styles.cellStrong]}>{hoursLabel(c.minutes, bnNum)}</Text>
                      </Pressable>
                    ))}
                    <View style={[styles.td, styles.dayCol]}>
                      <Text style={styles.cell}>{hoursLabel(r.weekMinutes, bnNum)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </QueryGate>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  nav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space(2) },
  navBtn: { ...typeScale.chip, color: c.primary },
  navTitle: { ...typeScale.secondary, color: c.textSecondary },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.border },
  th: { paddingVertical: space(2), paddingHorizontal: space(2), backgroundColor: c.surfaceAlt },
  thText: { ...typeScale.caption, color: c.textSecondary, textAlign: "center" },
  td: { paddingVertical: space(2), paddingHorizontal: space(2), justifyContent: "center" },
  nameCol: { width: 150 },
  dayCol: { width: 72, alignItems: "center" },
  todayCol: { borderTopWidth: 3, borderTopColor: c.primary },
  catRow: { backgroundColor: c.surfaceAlt, paddingVertical: space(1), paddingHorizontal: space(2) },
  catText: { ...typeScale.caption, color: c.textSecondary },
  name: { ...typeScale.secondary, color: c.textPrimary },
  cell: { ...typeScale.secondary, color: c.textPrimary, fontVariant: ["tabular-nums"] },
  cellStrong: { fontFamily: typeScale.bodyStrong.fontFamily },
  radius: { borderRadius: radius.sm },
}));
