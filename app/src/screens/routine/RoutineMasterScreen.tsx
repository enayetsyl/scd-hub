/**
 * RoutineMasterScreen (R-3, admin) — the whole timetable in a single grid:
 * rows = every section + Quran/Arabic group, columns = periods (with clock times).
 * A teacher double-booked across two groups in the same period is highlighted red and
 * listed. The day selector adds an "All" option that stacks all five days. `routine:manage`.
 */
import React, { useMemo, useState } from "react";
import { View, ScrollView } from "react-native";
import { useQuery } from "urql";
import { ROUTINE_MASTER_WEEK_QUERY, type RoutineMasterT, type RoutineMasterSlotT } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Chip, ChipRow, Badge, Loader, Notice, Divider } from "../../components/ui";
import { STR, dayOfWeekLabel, routineSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors, type ThemeColors } from "../../theme";
import { space } from "../../theme/tokens";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU"] as const;
const GROUP_W = 150;
const PERIOD_W = 132;

/** One day's master grid (conflict summary + the rows × periods table). */
function DayGrid({ m, c, showDayHeader }: { m: RoutineMasterT; c: ThemeColors; showDayHeader: boolean }): React.ReactElement {
  const cellBy = useMemo(() => {
    const map = new Map<string, RoutineMasterSlotT>();
    for (const s of m.slots) map.set(`${s.groupId}|${s.periodNumber}`, s);
    return map;
  }, [m]);
  const conflictTP = useMemo(() => {
    const set = new Set<string>();
    for (const cf of m.conflicts) set.add(`${cf.teacherId}|${cf.periodNumber}`);
    return set;
  }, [m]);

  const cellBase = { borderWidth: 1, borderColor: c.border, padding: space(1), justifyContent: "center" as const };

  return (
    <View style={{ gap: space(2) }}>
      {showDayHeader ? <Body style={{ fontWeight: "700", fontSize: 16 }}>{dayOfWeekLabel(m.day)}</Body> : null}

      {m.conflicts.length === 0 ? (
        <Badge text={STR.rtNoConflicts} tone="ok" />
      ) : (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1), color: c.error }}>
            ⚠ {STR.rtConflicts} ({bnNum(m.conflicts.length)})
          </Body>
          {m.conflicts.map((cf, i) => (
            <Muted key={i} style={{ marginTop: 2 }}>
              P{cf.periodNumber} · {cf.teacherName ?? "—"}: {cf.labels.join("  +  ")}
            </Muted>
          ))}
        </Card>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: "row" }}>
            <View style={[cellBase, { width: GROUP_W, backgroundColor: c.surfaceAlt }]}>
              <Muted style={{ fontWeight: "700" }}>{STR.rtSectionRoutine}</Muted>
            </View>
            {m.columns.map((col) => (
              <View key={col.periodNumber} style={[cellBase, { width: PERIOD_W, backgroundColor: c.surfaceAlt }]}>
                <Body style={{ fontSize: 12, fontWeight: "700" }}>P{col.periodNumber}</Body>
                <Muted style={{ fontSize: 10 }}>{col.isBreak ? STR.rtBreak : `${col.startTime ?? ""}–${col.endTime ?? ""}`}</Muted>
              </View>
            ))}
          </View>
          {m.rows.map((row) => (
            <View key={`${row.groupType}:${row.groupId}`} style={{ flexDirection: "row" }}>
              <View style={[cellBase, { width: GROUP_W, backgroundColor: c.surface }]}>
                <Body style={{ fontSize: 12, fontWeight: "600" }}>{row.label}</Body>
                {row.sublabel ? <Muted style={{ fontSize: 10 }}>{row.sublabel}</Muted> : null}
              </View>
              {m.columns.map((col) => {
                const slot = cellBy.get(`${row.groupId}|${col.periodNumber}`);
                const conflict = !!slot?.teacherId && conflictTP.has(`${slot.teacherId}|${col.periodNumber}`);
                const bg = conflict ? c.errorContainer : col.isBreak ? c.surfaceAlt : c.surface;
                return (
                  <View key={col.periodNumber} style={[cellBase, { width: PERIOD_W, backgroundColor: bg }]}>
                    {slot ? (
                      <>
                        <Body style={{ fontSize: 11, fontWeight: "600", color: conflict ? c.onErrorContainer : c.textPrimary }}>
                          {routineSubjectLabel(slot.subject)}
                        </Body>
                        <Muted style={{ fontSize: 10, color: conflict ? c.onErrorContainer : c.textSecondary }}>
                          {slot.teacherName ?? "—"}
                        </Muted>
                      </>
                    ) : (
                      <Muted style={{ fontSize: 10 }}>·</Muted>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function RoutineMasterScreen(): React.ReactElement {
  const c = useColors();
  const [day, setDay] = useState<string>("ALL");
  const [{ data, fetching, error }] = useQuery({ query: ROUTINE_MASTER_WEEK_QUERY });
  const week = data?.routineMasterWeek ?? [];
  const shown = day === "ALL" ? week : week.filter((m) => m.day === day);

  return (
    <Screen padded={false} wide>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChipRow>
          <Chip label={STR.rtAllDays} selected={day === "ALL"} onPress={() => setDay("ALL")} />
          {DAYS.map((d) => (
            <Chip key={d} label={dayOfWeekLabel(d)} selected={day === d} onPress={() => setDay(d)} />
          ))}
        </ChipRow>
      </View>

      {fetching ? <Loader /> : null}
      {error ? (
        <View style={{ paddingHorizontal: space(4) }}>
          <Notice message={friendlyError(error)} tone="danger" />
        </View>
      ) : null}

      {data ? (
        <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }}>
          {shown.map((m, i) => (
            <View key={m.day} style={{ gap: space(2) }}>
              {i > 0 ? <Divider /> : null}
              <DayGrid m={m} c={c} showDayHeader={day === "ALL"} />
            </View>
          ))}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
