/**
 * ChildAttendanceScreen (GP rider) — the selected child's attendance summary and
 * history over a date range.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_ATTENDANCE_HISTORY_QUERY } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Badge, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { LoadOlder } from "../../components/LoadOlder";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { STR, bnNum, dateHeaderLabel, getActiveLang } from "../../lib/labels";
import { space } from "../../theme/tokens";
import { dateKey, addDaysKey, daysBetweenKeys, GUARDIAN_MAX_LOOKBACK_DAYS } from "../../lib/dates";

const isoDay = (d: Date): string => dateKey(d);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};

/** One "show older" tap = another month, matching the month this screen opens on
 *  (D-#476). */
const STEP_DAYS = 30;

function DayRow({
  dateKey,
  absent,
  leaveCovered,
}: {
  dateKey: string;
  absent: boolean;
  leaveCovered: boolean;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}>
      <View style={{ flexShrink: 1 }}>
        <Body>{dateHeaderLabel(dateKey)}</Body>
        {leaveCovered ? <Muted>{STR.attLeaveCovered}</Muted> : null}
      </View>
      <Badge
        text={absent ? STR.attAbsentWord : STR.attPresentWord}
        tone={absent ? (leaveCovered ? "warn" : "danger") : "ok"}
      />
    </View>
  );
}

export default function ChildAttendanceScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  useRecordView("ATTENDANCE", selected?.studentId);
  const lang = getActiveLang();
  const [fromKey, setFromKey] = useState(daysAgo(30));
  const [toKey, setToKey] = useState(isoDay(new Date()));

  const [q, refetchQ] = useQuery({
    query: CHILD_ATTENDANCE_HISTORY_QUERY,
    variables: { studentId: selected?.studentId ?? "", fromKey, toKey },
    pause: !selected,
  });
  const history = q.data?.childAttendanceHistory;

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

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.attReportTitle}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.open}</Muted>
          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
            <View style={{ flex: 1 }}>
              <DateField label={STR.attFrom} value={fromKey} onChange={setFromKey} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label={STR.attTo} value={toKey} onChange={setToKey} min={fromKey || undefined} />
            </View>
          </View>
        </Card>

        <QueryGate
          result={q}
          onRetry={() => refetchQ({ requestPolicy: "network-only" })}
          loaderLabel={STR.loading}
        >
        {history ? (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>{lang === "en" ? selected.name : selected.nameBn}</Body>
              <Muted style={{ marginTop: space(1) }}>
                {bnNum(history.markedDays)} {STR.attDaysWord} · {STR.attPresentWord}: {bnNum(history.markedDays - history.absentDays)} ·{" "}
                {STR.attAbsentWord}: {bnNum(history.absentDays)}
              </Muted>
              <Muted>
                {STR.attReportTitle}: {bnNum(history.presentPct)}%
              </Muted>
            </Card>

            {history.days.length === 0 ? (
              <EmptyState message={STR.attNoAbsentees} />
            ) : (
              history.days.map((d) => <Card key={d.dateKey}><DayRow {...d} /></Card>)
            )}
            <LoadOlder
              onPress={() => setFromKey((f) => addDaysKey(f, -STEP_DAYS))}
              loading={q.fetching}
              exhausted={daysBetweenKeys(fromKey, toKey) >= GUARDIAN_MAX_LOOKBACK_DAYS}
            />
          </>
        ) : (
          <EmptyState message={STR.empty} />
        )}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
