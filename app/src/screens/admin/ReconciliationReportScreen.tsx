/**
 * ReconciliationReportScreen (D-#290) — Principal/Office oversight: who didn't
 * submit reconciliation. Homework misses grouped per DAY (declare happened, the
 * class teacher's Reconcile & issue didn't — no per-student records exist);
 * assignment misses per WEEK (delivered items still DRAFT, confirmAssignmentWeek
 * owed). Each row names the accountable confirmer. Range chips: 7/14/30 days.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { RECON_REPORT_QUERY, type HwReconMissT, type HwNotDeclaredT } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Chip, ChipRow, Badge, Loader, ErrorBanner } from "../../components/ui";
import { STR, bnNum, classLevelLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

const keyOf = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const RANGES = [
  { labelKey: "rrLast7", days: 7 },
  { labelKey: "rrLast14", days: 14 },
  { labelKey: "rrLast30", days: 30 },
] as const;

export default function ReconciliationReportScreen(): React.ReactElement {
  const colors = useColors();
  const [days, setDays] = useState<number>(7);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return { from: keyOf(start), to: keyOf(now) };
  }, [days]);

  const [q, refetch] = useQuery({
    query: RECON_REPORT_QUERY,
    variables: { from, to },
    requestPolicy: "cache-and-network",
  });
  const report = q.data?.reconciliationReport;
  const hwByDay = useMemo(() => {
    const map = new Map<string, HwReconMissT[]>();
    for (const m of report?.hwMisses ?? []) {
      const list = map.get(m.dateKey);
      if (list) list.push(m);
      else map.set(m.dateKey, [m]);
    }
    return [...map.entries()];
  }, [report]);
  // D-#293: homework never declared at all, grouped per day.
  const hwNdByDay = useMemo(() => {
    const map = new Map<string, HwNotDeclaredT[]>();
    for (const m of report?.hwNotDeclared ?? []) {
      const list = map.get(m.dateKey);
      if (list) list.push(m);
      else map.set(m.dateKey, [m]);
    }
    return [...map.entries()];
  }, [report]);

  return (
    <Screen scroll>
      <H2>{STR.rrTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rrSub}</Muted>

      <ChipRow>
        {RANGES.map((r) => (
          <Chip key={r.days} label={STR[r.labelKey]} selected={days === r.days} onPress={() => setDays(r.days)} />
        ))}
      </ChipRow>

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && !report ? <Loader label={STR.loading} /> : null}

      {report &&
      report.hwMisses.length === 0 &&
      report.asMisses.length === 0 &&
      report.hwNotDeclared.length === 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.rrNoMisses}</Body>
        </Card>
      ) : null}

      {/* Homework — grouped by day, newest first (server order). */}
      {hwByDay.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📒 {STR.rrHwTitle}</Body>
          {hwByDay.map(([dateKey, rows]) => (
            <View key={dateKey} style={{ marginBottom: space(2) }}>
              <Muted style={{ fontWeight: "700" }}>{bnNum(dateKey)}</Muted>
              {rows.map((m) => (
                <View
                  key={`${m.sectionId}-${m.dateKey}`}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
                >
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {classLevelLabel(m.classLevel)}
                      {m.sectionNameBn ? ` — ${m.sectionNameBn}` : ""}
                    </Body>
                    <Muted>
                      {STR.rrConfirmer}:{" "}
                      <Muted style={{ color: m.confirmerName ? undefined : colors.error }}>
                        {m.confirmerName ?? STR.rrNoConfirmer}
                      </Muted>{" "}
                      · {bnNum(m.declaredItems)} {STR.rrDeclaredItems} · {bnNum(m.declaredMinutes)} {STR.rrMinutes}
                    </Muted>
                  </View>
                  <Badge text={bnNum(m.declaredItems)} tone="danger" />
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : null}

      {/* Assignments — per week (the AS-T6 confirm cadence). */}
      {(report?.asMisses.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📋 {STR.rrAsTitle}</Body>
          {report!.asMisses.map((m) => (
            <View
              key={`${m.sectionId}-${m.weekNumber}`}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>
                  {classLevelLabel(m.classLevel)}
                  {m.sectionNameBn ? ` — ${m.sectionNameBn}` : ""} · {STR.rrWeek} {bnNum(m.weekNumber)}
                </Body>
                <Muted>
                  {bnNum(m.deliveryDateKey)} · {STR.rrConfirmer}:{" "}
                  <Muted style={{ color: m.confirmerName ? undefined : colors.error }}>
                    {m.confirmerName ?? STR.rrNoConfirmer}
                  </Muted>{" "}
                  · {bnNum(m.draftItems)} {STR.rrDraftItems} · {bnNum(m.draftMinutes)} {STR.rrMinutes}
                </Muted>
              </View>
              <Badge text={bnNum(m.draftItems)} tone="danger" />
            </View>
          ))}
        </Card>
      ) : null}

      {/* D-#293: homework never DECLARED — per class × subject, grouped by day.
          The routine defines what was expected; the named teacher owes the declaration. */}
      {hwNdByDay.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📕 {STR.rrHwNdTitle}</Body>
          <Muted style={{ marginBottom: space(1) }}>{STR.rrHwNdSub}</Muted>
          {hwNdByDay.map(([dateKey, rows]) => (
            <View key={dateKey} style={{ marginBottom: space(2) }}>
              <Muted style={{ fontWeight: "700" }}>{bnNum(dateKey)}</Muted>
              {rows.map((m) => (
                <View
                  key={`${m.sectionId}-${m.subject}-${m.dateKey}`}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
                >
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "600" }}>
                      {classLevelLabel(m.classLevel)}
                      {m.sectionNameBn ? ` — ${m.sectionNameBn}` : ""} · {hwSubjectLabel(m.subject)}
                    </Body>
                    <Muted>
                      {STR.rrConfirmer}:{" "}
                      <Muted style={{ color: m.teacherName ? undefined : colors.error }}>
                        {m.teacherName ?? STR.rrNoConfirmer}
                      </Muted>
                    </Muted>
                  </View>
                  <Badge text={STR.rrNotDeclared} tone="danger" />
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
