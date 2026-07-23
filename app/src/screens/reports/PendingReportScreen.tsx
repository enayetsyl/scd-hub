/**
 * PendingReportScreen (D-#309) — ONE screen behind the Reports hub's four
 * pending-work reports, keyed by route name; each renders a filtered slice of
 * the reconciliationReport read with the shared range + Class/Teacher/Subject
 * filters (client-side — the payloads are small):
 *
 *   HwDeclarePending — hwNotDeclared: routine-expected homework nobody declared
 *   HwIssuePending   — hwMisses: declared but never confirmed/issued
 *   AsDeclarePending — asNotDeclared: rotation-expected assignment nobody declared
 *   AsDeliverPending — asMisses: delivered items stuck in DRAFT (week unconfirmed)
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { RECON_REPORT_QUERY } from "../../graphql/operations";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Badge, Loader, ErrorBanner } from "../../components/ui";
import { useReportRange, useRowFilters } from "../../components/ReportFilters";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, monthLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";

type Kind = "HwDeclarePending" | "HwIssuePending" | "AsDeclarePending" | "AsDeliverPending";
type Props = NativeStackScreenProps<ReportsStackParamList, Kind>;

/** A normalized row every report kind maps into. */
interface Row {
  key: string;
  /** Group header — the day (homework) or the week start (assignments). */
  groupKey: string;
  groupLabel: string;
  classLevel: number;
  sectionNameBn: string;
  subject?: string;
  teacherName: string | null;
  detail?: string;
  badge: string;
}
export default function PendingReportScreen({ route }: Props): React.ReactElement {
  const kind = route.name as Kind;
  const colors = useColors();
  const { fromKey: from, toKey: to, node: rangeNode } = useReportRange(7);

  const [q, refetch] = useQuery({
    query: RECON_REPORT_QUERY,
    variables: { from, to },
    requestPolicy: "cache-and-network",
  });
  const report = q.data?.reconciliationReport;

  const rows: Row[] = React.useMemo(() => {
    if (!report) return [];
    // Assignment week keys arrive as full ISO instants — show the DATE only
    // (owner ask 2026-07-21). Safe on bare YYYY-MM-DD keys too.
    const dayOf = (k: string): string => bnNum(k.slice(0, 10));
    const assignmentWeekLabel = (deliveryKey: string | null | undefined, fallbackWeekNumber: number, fallbackDateKey: string): string => {
      const key = deliveryKey?.slice(0, 10) ?? fallbackDateKey.slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return `${STR.rrWeek} ${bnNum(fallbackWeekNumber)} - ${dayOf(key)}`;
      const month = Number(m[2]) - 1;
      const weekOfMonth = Math.floor((Number(m[3]) - 1) / 7) + 1;
      return `${monthLabel(month)} - ${STR.rrWeek} ${bnNum(weekOfMonth)} - ${dayOf(key)}`;
    };
    switch (kind) {
      case "HwDeclarePending":
        return report.hwNotDeclared.map((m) => ({
          key: `${m.sectionId}|${m.subject}|${m.dateKey}`,
          groupKey: m.dateKey,
          groupLabel: bnNum(m.dateKey),
          classLevel: m.classLevel,
          sectionNameBn: m.sectionNameBn,
          subject: m.subject,
          teacherName: m.teacherName,
          badge: STR.rrNotDeclared,
        }));
      case "HwIssuePending":
        return report.hwMisses.map((m) => ({
          key: `${m.sectionId}|${m.dateKey}`,
          groupKey: m.dateKey,
          groupLabel: bnNum(m.dateKey),
          classLevel: m.classLevel,
          sectionNameBn: m.sectionNameBn,
          teacherName: m.confirmerName,
          detail: `${bnNum(m.declaredItems)} ${STR.rrDeclaredItems} · ${bnNum(m.declaredMinutes)} ${STR.rrMinutes}`,
          badge: bnNum(m.declaredItems),
        }));
      case "AsDeclarePending":
        return report.asNotDeclared.map((m) => ({
          key: `${m.sectionId}|${m.subject}|${m.weekNumber}`,
          groupKey: m.deliveryDateKey ?? m.weekStartKey,
          groupLabel: assignmentWeekLabel(m.deliveryDateKey, m.weekNumber, m.weekStartKey),
          classLevel: m.classLevel,
          sectionNameBn: m.sectionNameBn,
          subject: m.subject,
          teacherName: m.teacherName,
          detail: m.deliveryDateKey ? dayOf(m.deliveryDateKey) : undefined,
          badge: STR.rrNotDeclared,
        }));
      case "AsDeliverPending":
        return report.asMisses.map((m) => ({
          key: `${m.sectionId}|${m.weekNumber}`,
          groupKey: m.deliveryDateKey,
          groupLabel: assignmentWeekLabel(m.deliveryDateKey, m.weekNumber, m.deliveryDateKey),
          classLevel: m.classLevel,
          sectionNameBn: m.sectionNameBn,
          teacherName: m.confirmerName,
          detail: `${bnNum(m.draftItems)} ${STR.rrDraftItems} · ${bnNum(m.draftMinutes)} ${STR.rrMinutes}`,
          badge: bnNum(m.draftItems),
        }));
    }
  }, [report, kind]);

  const hasSubject = kind === "HwDeclarePending" || kind === "AsDeclarePending";
  const { filtered, node: filterNode } = useRowFilters(rows, {
    classOf: (r) => r.classLevel,
    teacherOf: (r) => r.teacherName,
    ...(hasSubject ? { subjectOf: (r: Row) => r.subject ?? "" } : {}),
  });

  // Group by day/week, preserving server order (newest first).
  const groups: Array<[string, Row[]]> = [];
  {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const list = map.get(r.groupKey);
      if (list) list.push(r);
      else {
        const fresh = [r];
        map.set(r.groupKey, fresh);
        groups.push([r.groupKey, fresh]);
      }
    }
  }

  const TITLES: Record<Kind, string> = {
    HwDeclarePending: STR.rptHwDeclarePending,
    HwIssuePending: STR.rptHwIssuePending,
    AsDeclarePending: STR.rptAsDeclarePending,
    AsDeliverPending: STR.rptAsDeliverPending,
  };
  const SUBS: Partial<Record<Kind, string>> = {
    HwDeclarePending: STR.rrHwNdSub,
    HwIssuePending: STR.admSubReconReport,
    AsDeclarePending: STR.rptAsNdSub,
  };

  return (
    <Screen scroll>
      <H2>{TITLES[kind]}</H2>
      {SUBS[kind] ? <Muted style={{ marginBottom: space(2) }}>{SUBS[kind]}</Muted> : null}

      {rangeNode}
      <View style={{ marginBottom: space(2) }}>{filterNode}</View>

      {q.error ? (
        <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      ) : null}
      {q.fetching && !report ? <Loader label={STR.loading} /> : null}

      {report && filtered.length === 0 ? (
        <Card>
          <Body style={{ fontWeight: "600" }}>{STR.rptNoRows}</Body>
        </Card>
      ) : null}

      {groups.map(([groupKey, list]) => (
        <Card key={groupKey}>
          <Muted style={{ fontWeight: "700", marginBottom: space(1) }}>{list[0].groupLabel}</Muted>
          {list.map((r) => (
            <View
              key={r.key}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: space(1), gap: space(2) }}
            >
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: "600" }}>
                  {classLevelLabel(r.classLevel)}
                  {r.sectionNameBn ? ` — ${r.sectionNameBn}` : ""}
                  {r.subject ? ` · ${hwSubjectLabel(r.subject)}` : ""}
                </Body>
                <Muted>
                  {STR.rrConfirmer}:{" "}
                  <Muted style={{ color: r.teacherName ? undefined : colors.error }}>
                    {r.teacherName ?? STR.rrNoConfirmer}
                  </Muted>
                  {r.detail ? ` · ${r.detail}` : ""}
                </Muted>
              </View>
              <Badge text={r.badge} tone="danger" />
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}