/**
 * TeacherClassLoadScreen (D-#327) — Principal/Office oversight: every teacher's
 * teaching load for a month as a card (week + month totals + per-weekday row).
 * Tapping a card opens the per-teacher weekly-grid detail. Month selector + a
 * teacher name search. Lives in the Reports hub.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { TEACHER_CLASS_LOAD } from "../../graphql/classLoad";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Chip, Field, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, dayOfWeekLabel } from "../../lib/labels";
import { space } from "../../theme/tokens";

type Nav = NativeStackNavigationProp<ReportsStackParamList>;

const monthKeyOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function shiftMonth(mk: string, delta: number): string {
  const [y, m] = mk.split("-").map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

export default function TeacherClassLoadScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [month, setMonth] = useState(monthKeyOf(new Date()));
  const [search, setSearch] = useState("");

  const [q, refetch] = useQuery({ query: TEACHER_CLASS_LOAD, variables: { month } });
  const rows = q.data?.teacherClassLoad ?? [];

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? rows.filter((r) => r.teacherName.toLowerCase().includes(s)) : rows;
  }, [rows, search]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.clTitle}</Body>
          <Muted>{STR.clSub}</Muted>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginTop: space(2) }}>
            <Chip label="◀" onPress={() => setMonth((m) => shiftMonth(m, -1))} />
            <Body>{month}</Body>
            <Chip label="▶" onPress={() => setMonth((m) => shiftMonth(m, 1))} />
          </View>
          <Field label={undefined} value={search} onChangeText={setSearch} placeholder={STR.clSearchTeacher} />
        </Card>

        <QueryGate
          result={q}
          onRetry={() => refetch({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {filtered.length === 0 ? (
          <EmptyState message={STR.clNoLoad} />
        ) : (
          filtered.map((r) => (
            <Card
              key={r.teacherId}
              onPress={() =>
                nav.navigate("TeacherClassLoadDetail", { teacherId: r.teacherId, teacherName: r.teacherName, month })
              }
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.teacherName}</Body>
                <View style={{ flexDirection: "row", gap: space(1) }}>
                  <Badge text={`${STR.clWeek} ${bnNum(r.weekTotal)}`} tone="brand" />
                  <Badge text={`${STR.clMonth} ${bnNum(r.monthTotal)}`} tone="ok" />
                </View>
              </View>
              <Muted style={{ marginTop: 4 }}>
                {r.perWeekday.map((w) => `${dayOfWeekLabel(w.dayOfWeek)} ${bnNum(w.count)}`).join(" · ") || "—"}
              </Muted>
            </Card>
          ))
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
