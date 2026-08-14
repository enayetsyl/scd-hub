/**
 * ChildLeaveScreen (GP rider) — guardian leave applications for the linked child.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { CHILD_LEAVE_APPLICATIONS_QUERY, SUBMIT_CHILD_LEAVE_APPLICATION, type GuardianLeaveApplicationT } from "../../graphql/operations";
import { Screen, Body, Muted, Card, Field, Button, Loader, EmptyState, Notice, ErrorBanner } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { LoadOlder } from "../../components/LoadOlder";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { STR, dateHeaderLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { dateKey, addDaysKey, daysBetweenKeys, GUARDIAN_MAX_LOOKBACK_DAYS } from "../../lib/dates";

const isoDay = (d: Date): string => dateKey(d);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
};
const daysAhead = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

/** The leave history opens on ±60 days; one "show older" tap reaches back
 *  another 60 (D-#476). */
const HISTORY_SPAN_DAYS = 60;

function LeaveCard({ item }: { item: GuardianLeaveApplicationT }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>
        {dateHeaderLabel(item.fromKey)} {item.fromKey === item.toKey ? "" : `— ${dateHeaderLabel(item.toKey)}`}
      </Body>
      <Muted style={{ marginTop: space(1) }}>{item.reason}</Muted>
      <Muted style={{ marginTop: space(1) }}>{item.submittedAt.slice(0, 10)}</Muted>
    </Card>
  );
}

export default function ChildLeaveScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  useRecordView("LEAVE", selected?.studentId);
  const [fromKey, setFromKey] = useState(daysAgo(1));
  const [toKey, setToKey] = useState(daysAhead(1));
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The HISTORY window, distinct from the fromKey/toKey above (those belong to
  // the application form). D-#476: it used to be a fixed ±60 days with nothing
  // older reachable; "show older" now walks the start back.
  const [historyFrom, setHistoryFrom] = useState(() => daysAgo(HISTORY_SPAN_DAYS));
  const [historyTo] = useState(() => daysAhead(HISTORY_SPAN_DAYS));

  const [q, refetch] = useQuery({
    query: CHILD_LEAVE_APPLICATIONS_QUERY,
    variables: { studentId: selected?.studentId ?? "", fromKey: historyFrom, toKey: historyTo },
    pause: !selected,
    requestPolicy: "cache-and-network",
  });
  const [, submitLeave] = useMutation(SUBMIT_CHILD_LEAVE_APPLICATION);

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

  const child = selected;
  const items = q.data?.childLeaveApplications ?? [];

  async function onSubmit(): Promise<void> {
    setSaved(null);
    setBusy(true);
    const res = await submitLeave({ studentId: child.studentId, fromKey, toKey, reason });
    setBusy(false);
    if (res.error) {
      setSaved(friendlyError(res.error));
      return;
    }
    setReason("");
    setSaved(STR.attLeaveSaved);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.gpLeave}</Body>
          <Muted style={{ marginTop: space(1) }}>{STR.attRecordLeave}</Muted>
          <View style={{ marginTop: space(2) }}>
            <DateField label={STR.attLeaveFrom} value={fromKey} onChange={setFromKey} />
            <DateField label={STR.attLeaveTo} value={toKey} onChange={setToKey} min={fromKey || undefined} />
            <Field label={STR.attLeaveReason} value={reason} onChangeText={setReason} multiline autoCapitalize="sentences" />
            <Button
              title={STR.attRecordLeave}
              onPress={() => void onSubmit()}
              loading={busy}
              disabled={busy || !reason.trim()}
              style={{ marginTop: space(2) }}
            />
          </View>
        </Card>

        {saved ? <Notice message={saved} tone={saved === STR.attLeaveSaved ? "ok" : "danger"} /> : null}
        {q.error ? (
          <ErrorBanner
            message={friendlyError(q.error)}
            onRetry={() => refetch({ requestPolicy: "network-only" })}
          />
        ) : q.fetching && items.length === 0 ? (
          <Loader label={STR.loading} />
        ) : items.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          items.map((item) => <LeaveCard key={item.id} item={item} />)
        )}
        {!q.error ? (
          <LoadOlder
            onPress={() => setHistoryFrom((f) => addDaysKey(f, -HISTORY_SPAN_DAYS))}
            loading={q.fetching}
            exhausted={daysBetweenKeys(historyFrom, historyTo) >= GUARDIAN_MAX_LOOKBACK_DAYS}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
