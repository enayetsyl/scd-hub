/**
 * NeedsCoverInboxScreen (PXG-2, D-#268) — the cross-leave needs-cover worklist: every
 * uncovered class meeting (across every approved leave) in a date range, so Office
 * doesn't have to open each leave application to find them. Assigning from a row
 * mints the grant directly (decideStaffCoverSlot with an override — no proposal
 * required), same as a needs_cover slot on LeaveCoverScreen.
 */
import React from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { NEEDS_COVER_SLOTS_QUERY, DECIDE_STAFF_COVER_SLOT } from "../../graphql/operations";
import type { HrStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Button, Loader, EmptyState, ErrorBanner, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { AvailableTeacherSelect } from "../../components/selects";
import { STR, dateHeaderLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { groupByDate } from "../../lib/groupByDate";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<HrStackParamList, "NeedsCoverInbox">;

function todayKey(): string {
  return dateKey();
}
function plusDaysKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export default function NeedsCoverInboxScreen(_props: Props): React.ReactElement {
  const [from, setFrom] = React.useState(todayKey());
  const [to, setTo] = React.useState(plusDaysKey(7));
  const [assignFor, setAssignFor] = React.useState<Record<string, string>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [rowsQ, refetch] = useQuery({ query: NEEDS_COVER_SLOTS_QUERY, variables: { from, to } });
  const [, decide] = useMutation(DECIDE_STAFF_COVER_SLOT);

  const rows = rowsQ.data?.needsCoverSlots ?? [];
  const groups = groupByDate(rows, (r) => r.dateKey);

  async function assign(slotId: string): Promise<void> {
    const teacherId = assignFor[slotId];
    if (!teacherId) return;
    setError(null);
    setOk(null);
    setBusyId(slotId);
    const res = await decide({ slotId, approve: true, overrideCoverTeacherUserId: teacherId });
    setBusyId(null);
    if (res.error || !res.data?.decideStaffCoverSlot) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.hrCoverApproved);
    setAssignFor((a) => {
      const next = { ...a };
      delete next[slotId];
      return next;
    });
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <H2>{STR.hrNeedsCoverTitle}</H2>

      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}>
          <DateField label={STR.rtDate} value={from} onChange={setFrom} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label={STR.rtDate} value={to} onChange={setTo} />
        </View>
      </View>

      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}

      {rowsQ.fetching ? (
        <Loader label={STR.loading} />
      ) : rowsQ.error ? (
        <ErrorBanner message={friendlyError(rowsQ.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : rows.length === 0 ? (
        <EmptyState message={STR.hrAllCovered} />
      ) : (
        groups.map((g) => (
          <View key={g.dateKey} style={{ marginBottom: space(2) }}>
            <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{dateHeaderLabel(g.dateKey)}</Muted>
            {g.items.map((r) => (
              <Card key={r.slotId}>
                <Body style={{ fontWeight: "700" }}>
                  {STR.rtPeriodN} {bnNum(r.periodNumber)} ·{" "}
                  {r.subjectGroupName
                    ? r.subjectGroupName
                    : `${r.subjectName ?? STR.hrCoverSubject} · ${r.className ?? ""} ${r.sectionName ?? ""}`.trim()}
                </Body>
                <Muted>{r.absentTeacherName ?? "—"}</Muted>
                <AvailableTeacherSelect
                  date={r.dateKey}
                  periodNumber={r.periodNumber}
                  absentTeacherUserId={r.absentTeacherUserId}
                  value={assignFor[r.slotId] ?? ""}
                  onChange={(v) => setAssignFor((a) => ({ ...a, [r.slotId]: v }))}
                />
                <Button
                  title={STR.hrCoverApprove}
                  onPress={() => assign(r.slotId)}
                  loading={busyId === r.slotId}
                  disabled={busyId !== null || !assignFor[r.slotId]}
                />
              </Card>
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}
