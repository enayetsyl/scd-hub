/**
 * HwLifecycleReportScreen (D-#300) — Principal/Office homework lifecycle
 * monitoring per subject × class, five sections (owner: "i want all 5"):
 * checking backlog (red, on top — the actionable stall), lifecycle funnel,
 * chase rate, declaration consistency (uses the D-#299 nil markers), and the
 * per-teacher scorecard. Range chips like the reconciliation report.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { HW_LIFECYCLE_REPORT_QUERY } from "../../graphql/operations";
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

const pctText = (v: number | null): string => (v == null ? "—" : `${bnNum(v)}%`);

export default function HwLifecycleReportScreen(): React.ReactElement {
  const colors = useColors();
  const [days, setDays] = useState<number>(14);

  const { from, to } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return { from: keyOf(start), to: keyOf(now) };
  }, [days]);

  const [q, refetch] = useQuery({
    query: HW_LIFECYCLE_REPORT_QUERY,
    variables: { from, to },
    requestPolicy: "cache-and-network",
  });
  const report = q.data?.homeworkLifecycleReport;
  const cellTitle = (r: { classLevel: number; sectionNameBn: string; subject: string }): string =>
    `${classLevelLabel(r.classLevel)}${r.sectionNameBn ? ` — ${r.sectionNameBn}` : ""} · ${hwSubjectLabel(r.subject)}`;

  const chaseRows = useMemo(
    () =>
      (report?.funnel ?? [])
        .filter((r) => (r.chaseRatePct ?? 0) > 0)
        .slice()
        .sort((a, b) => (b.chaseRatePct ?? 0) - (a.chaseRatePct ?? 0)),
    [report],
  );

  return (
    <Screen scroll>
      <H2>{STR.hlrTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.hlrSub}</Muted>

      <ChipRow>
        {RANGES.map((r) => (
          <Chip key={r.days} label={STR[r.labelKey]} selected={days === r.days} onPress={() => setDays(r.days)} />
        ))}
      </ChipRow>

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && !report ? <Loader label={STR.loading} /> : null}

      {report && report.funnel.length === 0 && report.consistency.length === 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.hlrEmpty}</Body>
        </Card>
      ) : null}

      {/* 2 — checking backlog: the actionable stall, red, on top. */}
      {(report?.backlog.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 2 }}>🔴 {STR.hlrBacklogTitle}</Body>
          <Muted style={{ marginBottom: space(1) }}>
            &gt; {bnNum(report!.backlogThresholdDays)} {STR.hlrDays} {STR.hlrBacklogSub}
          </Muted>
          {report!.backlog.map((b) => (
            <View
              key={`${b.sectionId}-${b.subject}-${b.teacherName ?? ""}`}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>{cellTitle(b)}</Body>
                <Muted>
                  {b.teacherName ?? "—"} · {STR.hlrOldest} {bnNum(b.oldestDays)} {STR.hlrDays}
                </Muted>
              </View>
              <Badge text={bnNum(b.count)} tone="danger" />
            </View>
          ))}
        </Card>
      ) : null}

      {/* 1 — lifecycle funnel per (section × subject). */}
      {(report?.funnel.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📊 {STR.hlrFunnelTitle}</Body>
          {report!.funnel.map((r) => (
            <View key={`${r.sectionId}-${r.subject}`} style={{ paddingVertical: space(1) }}>
              <Body style={{ fontWeight: "600" }}>{cellTitle(r)}</Body>
              <Muted>
                {STR.hlrDeclared} {bnNum(r.declaredItems)} → {STR.hlrIssued} {bnNum(r.issuedItems)} → {STR.hlrGiven}{" "}
                {bnNum(r.given)} → {STR.hlrSubmitted} {bnNum(r.submitted)} → {STR.hlrChecked} {bnNum(r.checked)} →{" "}
                {STR.hlrReturned} {bnNum(r.returned)}
              </Muted>
              <Muted>
                {STR.hlrOnTime} {pctText(r.onTimePct)}
                {r.stuckSubmitted > 0 ? (
                  <Muted style={{ color: colors.error }}>
                    {" "}
                    · {STR.hlrStuck} {bnNum(r.stuckSubmitted)}
                  </Muted>
                ) : null}
              </Muted>
            </View>
          ))}
        </Card>
      ) : null}

      {/* 3 — chase rate, worst first. */}
      {chaseRows.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📣 {STR.hlrChaseTitle}</Body>
          {chaseRows.map((r) => (
            <View
              key={`${r.sectionId}-${r.subject}`}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>{cellTitle(r)}</Body>
                <Muted>
                  {bnNum(r.chasedRecords)}/{bnNum(r.given)} · {STR.hlrChases} {bnNum(r.chases)}
                </Muted>
              </View>
              <Badge text={pctText(r.chaseRatePct)} tone={(r.chaseRatePct ?? 0) >= 25 ? "danger" : "warn"} />
            </View>
          ))}
        </Card>
      ) : null}

      {/* 4 — declaration consistency (routine-expected vs declared + nil). */}
      {(report?.consistency.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>🗓️ {STR.hlrConsistencyTitle}</Body>
          {report!.consistency.map((r) => (
            <View
              key={`${r.sectionId}-${r.subject}`}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>{cellTitle(r)}</Body>
                <Muted>
                  {STR.hlrRoutineDays} {bnNum(r.routineDays)} · {STR.hlrDeclared} {bnNum(r.declaredDays)} ·{" "}
                  {STR.hlrNilDays} {bnNum(r.nilDays)}
                  {r.missedDays > 0 ? (
                    <Muted style={{ color: colors.error }}>
                      {" "}
                      · {STR.hlrMissedDays} {bnNum(r.missedDays)}
                    </Muted>
                  ) : null}
                </Muted>
              </View>
              <Badge
                text={pctText(r.respondedPct)}
                tone={(r.respondedPct ?? 0) >= 100 ? "ok" : (r.respondedPct ?? 0) >= 80 ? "warn" : "danger"}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {/* 5 — teacher scorecard, worst first. */}
      {(report?.scorecard.length ?? 0) > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>🧑‍🏫 {STR.hlrScorecardTitle}</Body>
          {report!.scorecard.map((s) => (
            <View key={s.teacherId} style={{ paddingVertical: space(1) }}>
              <Body style={{ fontWeight: "600" }}>{s.teacherName}</Body>
              <Muted>
                {STR.hlrDeclared} {bnNum(s.declaredItems)} · {STR.hlrNilDays} {bnNum(s.nilDays)}
                {s.missedDeclarations > 0 ? (
                  <Muted style={{ color: colors.error }}>
                    {" "}
                    · {STR.hlrMissedDecl} {bnNum(s.missedDeclarations)}
                  </Muted>
                ) : null}{" "}
                · {STR.hlrOnTime} {pctText(s.onTimePct)}
              </Muted>
              <Muted>
                {STR.hlrCheckLatency}{" "}
                {s.avgCheckLatencyDays == null ? "—" : `${bnNum(s.avgCheckLatencyDays)} ${STR.hlrDays}`} ·{" "}
                {STR.hlrReturnLatency}{" "}
                {s.avgReturnLatencyDays == null ? "—" : `${bnNum(s.avgReturnLatencyDays)} ${STR.hlrDays}`} ·{" "}
                {STR.hlrChases} {bnNum(s.chases)} · {STR.hlrWrongRate} {pctText(s.wrongRatePct)}
              </Muted>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
