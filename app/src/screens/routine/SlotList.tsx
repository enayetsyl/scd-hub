/**
 * SlotList (R-3) — renders routine slots grouped by day, periods in order. Shared
 * by the group grid + my-routine views. Each row shows the period's clock window +
 * subject + teacher name (resolved server-side by enrichRoutineSlots).
 */
import React from "react";
import { View } from "react-native";
import { DAYS_OF_WEEK } from "@scd/shared";
import { Card, Body, Muted, Badge } from "../../components/ui";
import { STR, dayOfWeekLabel, routineSubjectLabel, bnNum } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { RoutineSlotT } from "../../graphql/operations";

export function SlotList({
  slots,
  highlightDay,
}: {
  slots: RoutineSlotT[];
  highlightDay?: string | null;
}): React.ReactElement {
  const byDay = DAYS_OF_WEEK.map((d) => ({
    day: d,
    items: slots.filter((s) => s.dayOfWeek === d).sort((a, b) => a.periodNumber - b.periodNumber),
  })).filter((g) => g.items.length > 0);

  if (byDay.length === 0) return <Muted>{STR.rtNoSlots}</Muted>;

  return (
    <View style={{ gap: space(3) }}>
      {byDay.map(({ day, items }) => (
        <Card key={day}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space(2) }}>
            <Body style={{ fontWeight: "700" }}>{dayOfWeekLabel(day)}</Body>
            {highlightDay === day ? <Badge text={STR.rtToday} tone="brand" /> : null}
          </View>
          <View style={{ gap: space(1) }}>
            {items.map((s) => (
              <View key={s.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
                <View style={{ flex: 1 }}>
                  <Body>
                    {STR.rtPeriodN} {bnNum(s.periodNumber)} · {s.isBreak ? STR.rtBreak : routineSubjectLabel(s.subject)}
                  </Body>
                  {!s.isBreak && s.groupName ? <Muted style={{ fontWeight: "600" }}>{s.groupName}</Muted> : null}
                  {s.startTime && s.endTime ? (
                    <Muted>{s.startTime}–{s.endTime}</Muted>
                  ) : null}
                </View>
                <Muted>{s.isBreak ? "" : s.teacherName ?? s.teacherId ?? "—"}</Muted>
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}
