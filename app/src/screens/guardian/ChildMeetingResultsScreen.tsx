/**
 * ChildMeetingResultsScreen (D-#1634) — "অভিভাবক সভার ফলাফল": what the school published
 * to this family after a parents' meeting. Per child (the shared child switcher):
 *   - the meeting label + date and the window the figures cover;
 *   - the figures, the child's value beside the section best (same four measures as the print);
 *   - the FINAL Principal/Office comment — ভালো দিক (green) and চিন্তার বিষয় (peach).
 * The query has no field for a class- or subject-teacher comment, so none can appear here.
 * Built as stacked rows (label + two values) so it wraps at 360 dp with no sideways scroll.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { GUARDIAN_MEETING_RESULTS_QUERY, type GuardianMeetingResultT } from "../../graphql/meetingRelease";
import { Screen, Body, Muted, Card, Loader, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { useColors } from "../../theme";
import { space, radius } from "../../theme/tokens";

const pct = (n: number | null | undefined): string => (n == null ? "—" : `${bnNum(Math.round(n))}%`);
const ratioPct = (done: number, of: number): string => (of > 0 ? `${bnNum(Math.round((done / of) * 100))}%` : "—");

/** One measure: its label and the child's / section best's text. */
function MetricRow({ label, mine, best, showBest }: { label: string; mine: string; best: string; showBest: boolean }): React.ReactElement {
  const colors = useColors();
  return (
    <View style={{ paddingVertical: space(2), borderTopWidth: 1, borderTopColor: colors.border }}>
      <Body style={{ fontWeight: "700" }}>{label}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
        <View style={{ flexGrow: 1, flexBasis: 140, flexShrink: 1 }}>
          <Muted>{STR.mgrThisChild}</Muted>
          <Body>{mine}</Body>
        </View>
        {showBest ? (
          <View style={{ flexGrow: 1, flexBasis: 140, flexShrink: 1 }}>
            <Muted>{STR.mgrSectionBest}</Muted>
            <Body>{best}</Body>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ResultCard({ r }: { r: GuardianMeetingResultT }): React.ReactElement {
  const colors = useColors();
  const n = r.numbers;
  const b = r.classBest && !r.classBest.withheld ? r.classBest : null;
  const windowText = [STR.mgrNumbersLead, fullDateLabel(r.fromKey), STR.mgrFrom, fullDateLabel(r.toKey), STR.mgrUntil].filter(Boolean).join(" ");
  const leaveAbsent = STR.mgrLeaveAbsent.replace("{leave}", bnNum(n.leaveDays)).replace("{absent}", bnNum(n.absentDays));
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{r.instanceLabel}</Body>
      <Muted>{fullDateLabel(r.meetingDateKey)}</Muted>
      <Muted style={{ marginTop: space(1) }}>{windowText}</Muted>

      <View style={{ marginTop: space(2) }}>
        <MetricRow
          label={STR.mgrColAttendance}
          mine={`${bnNum(n.presentDays)}/${bnNum(n.markedDays)} ${STR.mgrDaysPresent}; ${leaveAbsent}`}
          best={b?.attendancePresentDays != null ? `${bnNum(b.attendancePresentDays)} ${STR.mgrDaysPresent}` : "—"}
          showBest={!!b}
        />
        <MetricRow
          label={STR.mgrColClassTest}
          mine={`${bnNum(n.classTestsSat)}/${bnNum(n.classTestsHeld)} ${STR.mgrSatOf}; ${STR.mgrAvg} ${pct(n.classTestAvgPercent)}`}
          best={`${STR.mgrAvg} ${pct(b?.classTestAvgPct)}`}
          showBest={!!b}
        />
        <MetricRow
          label={STR.mgrColHomework}
          mine={`${bnNum(n.homeworkSubmitted)}/${bnNum(n.homeworkReceived)} ${STR.mgrSubmitted} (${ratioPct(n.homeworkSubmitted, n.homeworkReceived)})`}
          best={`${pct(b?.homeworkPct)} ${STR.mgrSubmitted}`}
          showBest={!!b}
        />
        <MetricRow
          label={STR.mgrColAssignment}
          mine={`${bnNum(n.assignmentSubmitted)}/${bnNum(n.assignmentReceived)} ${STR.mgrSubmitted} (${ratioPct(n.assignmentSubmitted, n.assignmentReceived)})`}
          best={`${pct(b?.assignmentPct)} ${STR.mgrSubmitted}`}
          showBest={!!b}
        />
      </View>
      {r.classBest?.withheld ? <Muted style={{ marginTop: space(1) }}>{STR.mgrWithheld}</Muted> : null}

      <Body style={{ fontWeight: "700", marginTop: space(3) }}>{STR.mgrFinalTitle}</Body>
      {r.final ? (
        <View style={{ marginTop: space(2), gap: space(2) }}>
          <View style={{ backgroundColor: colors.primaryContainer, borderRadius: radius.md, padding: space(3) }}>
            <Body style={{ fontWeight: "700", color: colors.onPrimaryContainer }}>{STR.mgrStrengths}</Body>
            <Body style={{ color: colors.onPrimaryContainer }}>{r.final.strengths || "—"}</Body>
          </View>
          <View style={{ backgroundColor: colors.warningContainer, borderRadius: radius.md, padding: space(3) }}>
            <Body style={{ fontWeight: "700", color: colors.warning }}>{STR.mgrConcerns}</Body>
            <Body style={{ color: colors.warning }}>{r.final.concerns || "—"}</Body>
          </View>
        </View>
      ) : (
        <Muted style={{ marginTop: space(1) }}>{STR.mgrNoFinal}</Muted>
      )}
    </Card>
  );
}

export default function ChildMeetingResultsScreen(): React.ReactElement {
  const { selected, fetching } = useGuardianChild();
  const sid = selected?.studentId ?? "";
  const [q, refetch] = useQuery({
    query: GUARDIAN_MEETING_RESULTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
    requestPolicy: "cache-and-network",
  });

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

  const rows = q.data?.guardianMeetingResults ?? [];
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <ChildSwitcher />
        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {rows.length === 0 ? <EmptyState message={STR.mgrNone} /> : rows.map((r) => <ResultCard key={r.meetingId} r={r} />)}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
