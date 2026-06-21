/**
 * ChildRoutineScreen (GP-2) — the selected child's WEEKLY routine: the current
 * week's days, each resolved via childRoutine (Section + SubjectGroup slots
 * merged server-side). Slots carry subject + period + time ONLY (D-#69 — no
 * teacher, no room, no cover anywhere). Friday shows ছুটি; Saturday is the
 * child's Quran-group day (GP-J3); a holiday shows its label.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { CHILD_ROUTINE_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Loader, EmptyState } from "../../components/ui";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, dayOfWeekLabel, subjectLabel, dayTypeLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The current week's dates, Sunday-first (index-aligned to DAYS_OF_WEEK). */
function weekDates(): string[] {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  return DAYS_OF_WEEK.map((_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return isoDay(d);
  });
}

function DayBlock({ studentId, date, dow }: { studentId: string; date: string; dow: string }): React.ReactElement {
  const [q] = useQuery({ query: CHILD_ROUTINE_QUERY, variables: { studentId, date } });
  const day = q.data?.childRoutine;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body style={{ fontWeight: "700" }}>{dayOfWeekLabel(dow)}</Body>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Muted>{bnNum(date)}</Muted>
          {day ? (
            <Badge
              text={day.dayType === "HOLIDAY" && day.holidayNameBn ? day.holidayNameBn : dayTypeLabel(day.dayType)}
              tone={day.dayType === "FULL" ? "brand" : "warn"}
            />
          ) : null}
        </View>
      </View>
      {q.fetching ? (
        <Loader label={STR.loading} />
      ) : !day || day.slots.length === 0 ? (
        <Muted style={{ marginTop: space(1) }}>{day ? dayTypeLabel(day.dayType) : ""}</Muted>
      ) : (
        day.slots.map((s) => (
          <View
            key={`${s.periodNumber}-${s.subject}`}
            style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
          >
            <Body>
              {bnNum(s.periodNumber)}. {subjectLabel(s.subject)}
            </Body>
            <Muted>{s.startHHMM && s.endHHMM ? `${s.startHHMM}–${s.endHHMM}` : ""}</Muted>
          </View>
        ))
      )}
    </Card>
  );
}

export default function ChildRoutineScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();

  if (fetching && !selected) {
    return (
      <Screen>
        <Loader label={STR.loading} />
      </Screen>
    );
  }
  if (!selected) {
    return (
      <Screen>
        <EmptyState message={STR.gpNoChildren} />
      </Screen>
    );
  }

  const dates = weekDates();
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.gpWeeklyRoutine}</Body>
        {DAYS_OF_WEEK.map((dow, i) => (
          <DayBlock key={dow} studentId={selected.studentId} date={dates[i]} dow={dow} />
        ))}
      </ScrollView>
    </Screen>
  );
}
