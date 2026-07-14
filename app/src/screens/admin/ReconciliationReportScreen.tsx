/**
 * ReconciliationReportScreen (D-#290) — Principal/Office oversight: who didn't
 * submit reconciliation. Homework misses grouped per DAY (declare happened, the
 * class teacher's Reconcile & issue didn't — no per-student records exist);
 * assignment misses per WEEK (delivered items still DRAFT, confirmAssignmentWeek
 * owed). Each row names the accountable confirmer. Range chips: 7/14/30 days.
 */
import React, { useMemo } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import { RECON_REPORT_QUERY, type HwReconMissT, type HwNotDeclaredT } from "../../graphql/operations";
import { Screen, H2, Body, Muted, Card, Badge, Loader, ErrorBanner } from "../../components/ui";
import { useReportRange, useReportFilterState } from "../../components/ReportFilters";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, hwNilReasonLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

export default function ReconciliationReportScreen(): React.ReactElement {
  const colors = useColors();
  // D-#309: range chips + custom from–to, shared with the Reports hub screens.
  const { fromKey: from, toKey: to, node: rangeNode } = useReportRange(7);

  const [q, refetch] = useQuery({
    query: RECON_REPORT_QUERY,
    variables: { from, to },
    requestPolicy: "cache-and-network",
  });
  const report = q.data?.reconciliationReport;

  // D-#309: one Class/Teacher/Subject filter over every section — option sets
  // are the union of what the fetched report actually contains.
  const filterSets = useMemo(() => {
    const r = report;
    const all = [
      ...(r?.hwMisses ?? []).map((m) => ({ cls: m.classLevel, t: m.confirmerName, s: undefined as string | undefined })),
      ...(r?.asMisses ?? []).map((m) => ({ cls: m.classLevel, t: m.confirmerName, s: undefined as string | undefined })),
      ...(r?.hwNotDeclared ?? []).map((m) => ({ cls: m.classLevel, t: m.teacherName, s: m.subject })),
      ...(r?.hwNilDeclared ?? []).map((m) => ({ cls: m.classLevel, t: m.teacherName, s: m.subject })),
    ];
    return {
      classLevels: all.map((x) => x.cls),
      teachers: all.map((x) => x.t).filter(Boolean) as string[],
      subjects: all.map((x) => x.s).filter(Boolean) as string[],
    };
  }, [report]);
  const { node: filterNode, match } = useReportFilterState(filterSets);

  const hwMisses = (report?.hwMisses ?? []).filter((m) => match(m.classLevel, m.confirmerName));
  const asMisses = (report?.asMisses ?? []).filter((m) => match(m.classLevel, m.confirmerName));
  const hwNotDeclared = (report?.hwNotDeclared ?? []).filter((m) => match(m.classLevel, m.teacherName, m.subject));
  const hwNilDeclared = (report?.hwNilDeclared ?? []).filter((m) => match(m.classLevel, m.teacherName, m.subject));

  const hwByDay = useMemo(() => {
    const map = new Map<string, HwReconMissT[]>();
    for (const m of hwMisses) {
      const list = map.get(m.dateKey);
      if (list) list.push(m);
      else map.set(m.dateKey, [m]);
    }
    return [...map.entries()];
  }, [hwMisses]);
  // D-#293: homework never declared at all, grouped per day.
  const hwNdByDay = useMemo(() => {
    const map = new Map<string, HwNotDeclaredT[]>();
    for (const m of hwNotDeclared) {
      const list = map.get(m.dateKey);
      if (list) list.push(m);
      else map.set(m.dateKey, [m]);
    }
    return [...map.entries()];
  }, [hwNotDeclared]);

  return (
    <Screen scroll>
      <H2>{STR.rrTitle}</H2>
      <Muted style={{ marginBottom: space(2) }}>{STR.rrSub}</Muted>

      {rangeNode}
      <View style={{ marginBottom: space(2) }}>{filterNode}</View>

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && !report ? <Loader label={STR.loading} /> : null}

      {report && hwMisses.length === 0 && asMisses.length === 0 && hwNotDeclared.length === 0 ? (
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
      {asMisses.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📋 {STR.rrAsTitle}</Body>
          {asMisses.map((m) => (
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

      {/* D-#299: explicit "no homework today" declarations — the NEUTRAL list.
          These cells are excluded from the red not-declared list above. */}
      {hwNilDeclared.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>📗 {STR.hwNilReportTitle}</Body>
          {hwNilDeclared.map((m) => (
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
                  {bnNum(m.dateKey)} · {m.teacherName ?? "—"}
                </Muted>
              </View>
              <Badge text={hwNilReasonLabel(m.reason)} tone="brand" />
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
