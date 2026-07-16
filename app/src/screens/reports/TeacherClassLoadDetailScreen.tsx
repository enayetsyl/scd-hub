/**
 * TeacherClassLoadDetailScreen (D-#327) — one teacher's teaching load for a month:
 * week/month totals + the weekly grid grouped by day (period · time · class · subject).
 * Stack-agnostic (mounted in both the Reports stack for oversight and the Routine
 * stack for a teacher's own load) — reads params via useRoute.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQuery } from "urql";
import { DAYS_OF_WEEK } from "@scd/shared";
import { TEACHER_CLASS_LOAD } from "../../graphql/classLoad";
import { Screen, Body, Muted, Card, Badge, Chip, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, dayOfWeekLabel, routineSubjectLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Params = { teacherId: string; teacherName?: string; month?: string };

const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function shiftMonth(mk: string, delta: number): string {
  const [y, m] = mk.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

export default function TeacherClassLoadDetailScreen(): React.ReactElement {
  const route = useRoute<RouteProp<Record<string, Params>, string>>();
  const { teacherId, teacherName } = route.params;
  const [month, setMonth] = useState(route.params.month ?? monthKeyOf(new Date()));

  const [q, refetch] = useQuery({ query: TEACHER_CLASS_LOAD, variables: { month, teacherId } });
  const load = q.data?.teacherClassLoad?.[0] ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{teacherName ?? load?.teacherName ?? STR.clTitle}</Body>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}>
            <Chip label="◀" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
            <Body>{month}</Body>
            <Chip label="▶" onPress={() => setMonth((m) => shiftMonth(m, 1))} />
          </View>
          {load ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Badge text={`${STR.clWeek}: ${bnNum(load.weekTotal)} ${STR.clPeriods}`} tone="brand" />
              <Badge text={`${STR.clMonth}: ${bnNum(load.monthTotal)} ${STR.clPeriods}`} tone="ok" />
              <Badge text={`${bnNum(load.monthTeachingDays)} ${STR.clTeachingDays}`} tone="muted" />
            </View>
          ) : null}
        </Card>

        <QueryGate
          result={q}
          onRetry={() => refetch({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {!load || load.slots.length === 0 ? (
          <EmptyState message={STR.clNoLoad} />
        ) : (
          DAYS_OF_WEEK.map((dow) => {
            const daySlots = load.slots.filter((s) => s.dayOfWeek === dow);
            if (daySlots.length === 0) return null;
            return (
              <Card key={dow}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <Body style={{ fontWeight: "700" }}>{dayOfWeekLabel(dow)}</Body>
                  <Badge text={`${bnNum(daySlots.length)} ${STR.clPeriods}`} tone="brand" />
                </View>
                {daySlots.map((s, i) => (
                  <View
                    key={`${dow}-${s.periodNumber}-${i}`}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}
                  >
                    <View style={{ flexShrink: 1 }}>
                      <Body>
                        {s.groupName ?? "—"} · {routineSubjectLabel(s.subject)}
                      </Body>
                      <Muted>
                        #{bnNum(s.periodNumber)}
                        {s.startTime ? ` · ${s.startTime}–${s.endTime ?? ""}` : ""}
                      </Muted>
                    </View>
                  </View>
                ))}
              </Card>
            );
          })
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
