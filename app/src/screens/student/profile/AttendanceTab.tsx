/**
 * Attendance tab — a month calendar (present / absent / off day) beside the month's
 * counts and two pies: this month and the academic year to date. Each pie splits
 * the marked days into present, absent WITH a leave application, and absent
 * WITHOUT one (the actionable number).
 *
 * The data is one read of the year to date (`studentProfileAttendance`, which now
 * also lists the window's off days); moving between months is local.
 *
 * The calendar paints on its own fixed "paper" colours, like the report tables, so
 * the day colours read the same in light and dark mode.
 */
import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { ProfileAttendanceT } from "../../../graphql/studentProfile";
import { Body, Card, Loader, Muted, Notice } from "../../../components/ui";
import { PieChart, type PieSlice } from "../../../components/PieChart";
import { STR, bnNum, monthLabel } from "../../../lib/labels";
import { radius, space, useColors } from "../../../theme";
import { DataTable, SectionTitle, pctText } from "./parts";

const CAL = {
  present: "#9be3b4",
  absent: "#f6a5a5",
  off: "#fbeeb8",
  notMarked: "#ffffff",
  future: "#f4f6f5",
  text: "#182420",
  textFaint: "#9aa6a0",
  border: "#dfe5e1",
  leaveMark: "#b45309",
} as const;

const PIE = {
  present: "#1f9d55",
  withLeave: "#f59e0b",
  withoutLeave: "#dc2626",
} as const;

interface Counts {
  marked: number;
  present: number;
  withLeave: number;
  withoutLeave: number;
}

function countDays(days: ProfileAttendanceT["days"]): Counts {
  const c: Counts = { marked: 0, present: 0, withLeave: 0, withoutLeave: 0 };
  for (const d of days) {
    c.marked += 1;
    if (!d.absent) c.present += 1;
    else if (d.leaveCovered) c.withLeave += 1;
    else c.withoutLeave += 1;
  }
  return c;
}

const slicesOf = (c: Counts): PieSlice[] => [
  { label: STR.spCalPresent, value: c.present, color: PIE.present },
  { label: STR.spAbsentWithLeave, value: c.withLeave, color: PIE.withLeave },
  { label: STR.spAbsentWithoutLeave, value: c.withoutLeave, color: PIE.withoutLeave },
];

const pad = (n: number) => String(n).padStart(2, "0");
const monthKeyOf = (y: number, m: number) => `${y}-${pad(m + 1)}`;

/** `YYYY-MM` → the next/previous month key. */
function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return monthKeyOf(d.getFullYear(), d.getMonth());
}

/** Consecutive days sharing a holiday name → "ঈদ: 7–12". */
function holidayRuns(off: ProfileAttendanceT["offDays"]): { name: string; from: string; to: string }[] {
  const runs: { name: string; from: string; to: string }[] = [];
  for (const d of off) {
    if (d.dayType !== "HOLIDAY" || !d.holidayNameBn) continue;
    const last = runs[runs.length - 1];
    const prevDay = last ? Number(last.to.slice(8)) : -1;
    if (last && last.name === d.holidayNameBn && Number(d.dateKey.slice(8)) === prevDay + 1) last.to = d.dateKey;
    else runs.push({ name: d.holidayNameBn, from: d.dateKey, to: d.dateKey });
  }
  return runs;
}

export function AttendanceTab({
  attendance,
  fetching,
  error,
  todayKey,
}: {
  attendance: ProfileAttendanceT | null;
  fetching: boolean;
  error: string | null;
  todayKey: string;
}): React.ReactElement {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const lastMonth = (attendance?.toKey ?? todayKey).slice(0, 7);
  const firstMonth = (attendance?.fromKey ?? todayKey).slice(0, 7);
  const [month, setMonth] = useState<string | null>(null);
  const shownMonth = month && month >= firstMonth && month <= lastMonth ? month : lastMonth;

  const byDay = useMemo(() => new Map((attendance?.days ?? []).map((d) => [d.dateKey, d])), [attendance]);
  const offByDay = useMemo(() => new Map((attendance?.offDays ?? []).map((d) => [d.dateKey, d])), [attendance]);

  const monthDays = useMemo(
    () => (attendance?.days ?? []).filter((d) => d.dateKey.startsWith(shownMonth)),
    [attendance, shownMonth],
  );
  const monthCounts = useMemo(() => countDays(monthDays), [monthDays]);
  const yearCounts = useMemo(() => countDays(attendance?.days ?? []), [attendance]);
  const monthHolidays = useMemo(
    () => holidayRuns((attendance?.offDays ?? []).filter((d) => d.dateKey.startsWith(shownMonth))),
    [attendance, shownMonth],
  );
  const monthStart = `${shownMonth}-01`;
  const monthEnd = `${shownMonth}-31`;
  const monthLeaves = (attendance?.leaves ?? []).filter((l) => l.fromKey <= monthEnd && l.toKey >= monthStart);

  if (error) return <Notice message={error} tone="danger" />;
  if (fetching && !attendance) return <Loader label={STR.loading} />;
  if (!attendance) return <Muted>{STR.spNoDataInRange}</Muted>;

  const [y, m] = shownMonth.split("-").map(Number);
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Sunday, like the header row
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weekdays = STR.spWeekdaysShort.split(",");
  const wide = width >= 820;

  const calendar = (
    // No flex sizing here: the wrapper column sets the width, and a flexBasis inside
    // a vertical parent sizes the card's HEIGHT — at 0 the card collapsed to its
    // header row and the calendar spilled out below it (owner screenshot 2026-09-30).
    <Card style={{ gap: space(2) }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STR.spPrevMonth}
          disabled={shownMonth <= firstMonth}
          onPress={() => setMonth(shiftMonth(shownMonth, -1))}
          style={{ padding: space(2), opacity: shownMonth <= firstMonth ? 0.3 : 1 }}
        >
          <Body style={{ fontSize: 18 }}>‹</Body>
        </Pressable>
        <Body style={{ fontWeight: "700" }}>
          {monthLabel(m - 1)} {bnNum(y)}
        </Body>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={STR.spNextMonth}
          disabled={shownMonth >= lastMonth}
          onPress={() => setMonth(shiftMonth(shownMonth, 1))}
          style={{ padding: space(2), opacity: shownMonth >= lastMonth ? 0.3 : 1 }}
        >
          <Body style={{ fontSize: 18 }}>›</Body>
        </Pressable>
      </View>

      <View style={{ borderWidth: 1, borderColor: CAL.border, borderRadius: radius.sm, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", backgroundColor: colors.surfaceAlt }}>
          {weekdays.map((w) => (
            <View key={w} style={{ flex: 1, paddingVertical: space(1), alignItems: "center" }}>
              <Muted style={{ fontSize: 12, fontWeight: "700" }}>{w}</Muted>
            </View>
          ))}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <View key={week} style={{ flexDirection: "row" }}>
            {cells.slice(week * 7, week * 7 + 7).map((day, i) => {
              if (day == null) {
                return <View key={`b${i}`} style={{ flex: 1, height: 44, borderTopWidth: 1, borderLeftWidth: i ? 1 : 0, borderColor: CAL.border, backgroundColor: CAL.future }} />;
              }
              const key = `${shownMonth}-${pad(day)}`;
              const rec = byDay.get(key);
              const off = offByDay.get(key);
              const bg = rec
                ? rec.absent
                  ? CAL.absent
                  : CAL.present
                : off
                  ? CAL.off
                  : key > todayKey
                    ? CAL.future
                    : CAL.notMarked;
              return (
                <View
                  key={key}
                  accessibilityLabel={
                    rec
                      ? rec.absent
                        ? rec.leaveCovered
                          ? STR.spAbsentWithLeave
                          : STR.spAbsentWithoutLeave
                        : STR.spCalPresent
                      : off
                        ? off.holidayNameBn ?? STR.spCalOffDay
                        : STR.spCalNotMarked
                  }
                  style={{
                    flex: 1,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: bg,
                    borderTopWidth: 1,
                    borderLeftWidth: i ? 1 : 0,
                    borderColor: CAL.border,
                  }}
                >
                  <Text style={{ color: key > todayKey && !off ? CAL.textFaint : CAL.text, fontSize: 13 }}>{bnNum(day)}</Text>
                  {rec?.absent && rec.leaveCovered ? (
                    <Text style={{ position: "absolute", top: 2, right: 4, fontSize: 10, fontWeight: "800", color: CAL.leaveMark }}>
                      {STR.spCalLeaveMark}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
        {[
          { label: STR.spCalPresent, color: CAL.present },
          { label: STR.spCalAbsent, color: CAL.absent },
          { label: STR.spCalOffDay, color: CAL.off },
          { label: STR.spCalNotMarked, color: CAL.notMarked },
        ].map((l) => (
          <View key={l.label} style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
            <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: l.color, borderWidth: 1, borderColor: CAL.border }} />
            <Muted style={{ fontSize: 12 }}>{l.label}</Muted>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
          <Text style={{ fontSize: 11, fontWeight: "800", color: CAL.leaveMark }}>{STR.spCalLeaveMark}</Text>
          <Muted style={{ fontSize: 12 }}>= {STR.spAbsentWithLeave}</Muted>
        </View>
      </View>

      {monthHolidays.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Muted style={{ fontWeight: "700" }}>{STR.spHolidaysThisMonth}</Muted>
          {monthHolidays.map((h) => (
            <Muted key={h.from}>
              {h.name}: {bnNum(Number(h.from.slice(8)))}
              {h.to !== h.from ? `–${bnNum(Number(h.to.slice(8)))}` : ""}
            </Muted>
          ))}
        </View>
      ) : null}
    </Card>
  );

  const pctOf = (n: number, of: number) => (of === 0 ? "" : ` (${pctText((n / of) * 100)})`);
  const stats = (
    <View style={{ gap: space(3) }}>
      <Card style={{ gap: space(2) }}>
        <DataTable
          columns={[
            { label: `${monthLabel(m - 1)} ${bnNum(y)}`, width: 200 },
            { label: "", width: 90, align: "right" },
          ]}
          rows={[
            { key: "marked", cells: [STR.spDaysMarked, bnNum(monthCounts.marked)] },
            { key: "present", cells: [STR.spCalPresent, `${bnNum(monthCounts.present)}${pctOf(monthCounts.present, monthCounts.marked)}`] },
            { key: "withLeave", cells: [STR.spAbsentWithLeave, `${bnNum(monthCounts.withLeave)}${pctOf(monthCounts.withLeave, monthCounts.marked)}`] },
            { key: "withoutLeave", cells: [STR.spAbsentWithoutLeave, `${bnNum(monthCounts.withoutLeave)}${pctOf(monthCounts.withoutLeave, monthCounts.marked)}`] },
          ]}
        />
      </Card>
      <Card style={{ gap: space(4) }}>
        <PieChart
          title={STR.spPieMonth}
          slices={slicesOf(monthCounts)}
          emptyText={STR.spNoAttendanceMonth}
          accessibilityLabel={STR.spPieMonth}
        />
        <PieChart
          title={`${STR.spPieYear} · ${bnNum(yearCounts.marked)} ${STR.spLeaveDays}`}
          slices={slicesOf(yearCounts)}
          emptyText={STR.spNoDataInRange}
          accessibilityLabel={STR.spPieYear}
        />
      </Card>
      {monthLeaves.length > 0 ? (
        <Card style={{ gap: space(1) }}>
          <SectionTitle title={STR.spLeavesThisMonth} />
          {monthLeaves.map((l) => (
            <Muted key={l.leaveId}>
              {bnNum(l.fromKey.slice(8))}/{bnNum(l.fromKey.slice(5, 7))}
              {l.toKey !== l.fromKey ? ` – ${bnNum(l.toKey.slice(8))}/${bnNum(l.toKey.slice(5, 7))}` : ""} · {l.reason}
            </Muted>
          ))}
        </Card>
      ) : null}
    </View>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: wide ? "row" : "column", gap: space(3), alignItems: "flex-start" }}>
      <View style={{ width: wide ? undefined : "100%", flex: wide ? 1.2 : undefined }}>{calendar}</View>
      <View style={{ width: wide ? undefined : "100%", flex: wide ? 1 : undefined }}>{stats}</View>
    </View>
  );
}
