/**
 * ClassTestReportScreen (D-#340) — the Principal/Office class-test report in the
 * Reports hub: every official exam in the picked exam-date range, with the
 * D-#309 filter set (range chips + class / teacher / subject selects) plus a
 * state chip row (all / complete / in-progress / not-started / overdue) and a
 * per-state count summary. Rows carry teacher + জমা (submittedAt) and tap
 * through to the exam's result-entry grid. Data: classTestReportsStatus —
 * unscoped for Principal/Office server-side; rows are small, so range + row
 * filtering stays client-side (the useRowFilters philosophy).
 */
import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { CLASS_TEST_REPORTS_STATUS_QUERY } from "../../graphql/classTest";
import { Screen, Body, Muted, Card, Badge, Chip, ChipRow, Loader, Notice, EmptyState } from "../../components/ui";
import { useReportRange, useRowFilters } from "../../components/ReportFilters";
import { STR, hwSubjectLabel, ctReportStateLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { dateKey } from "../../lib/dates";
import { space } from "../../theme/tokens";

/** Cross-tab navigation (the TodayScreen convention): bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

const STATES = ["complete", "in_progress", "not_started", "overdue"] as const;

const stateTone = (s: string): "ok" | "danger" | "brand" | "muted" =>
  s === "complete" ? "ok" : s === "overdue" ? "danger" : s === "in_progress" ? "brand" : "muted";

export default function ClassTestReportScreen(): React.ReactElement {
  const nav = useNavigation() as unknown as CrossNav;
  const [rowsQ, refetch] = useQuery({ query: CLASS_TEST_REPORTS_STATUS_QUERY, variables: {} });
  const all = rowsQ.data?.classTestReportsStatus ?? [];

  // Exam-date range (D-#309 chips) — applied before the row filters so the
  // class/teacher/subject options only offer values present in the range.
  const { fromKey, toKey, node: rangeNode } = useReportRange(30);
  const inRange = all.filter((r) => {
    const k = dateKey(new Date(r.examDate));
    return k >= fromKey && k <= toKey;
  });

  const { filtered, node: filterNode } = useRowFilters(inRange, {
    classOf: (r) => r.classLevel,
    teacherOf: (r) => r.teacherName,
    subjectOf: (r) => r.subject,
  });

  // State chips — one more axis on top of the shared filters.
  const [stateFilter, setStateFilter] = useState<string>("");
  const rows = stateFilter ? filtered.filter((r) => r.state === stateFilter) : filtered;
  const countOf = (s: string): number => filtered.filter((r) => r.state === s).length;

  const { refreshing, onRefresh } = usePullRefresh(rowsQ.fetching, () =>
    refetch({ requestPolicy: "network-only" }),
  );

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Card>
          {rangeNode}
          {filterNode}
          <ChipRow>
            <Chip label={`${STR.all} (${bnNum(filtered.length)})`} selected={stateFilter === ""} onPress={() => setStateFilter("")} />
            {STATES.map((s) => (
              <Chip
                key={s}
                label={`${ctReportStateLabel(s)} (${bnNum(countOf(s))})`}
                selected={stateFilter === s}
                onPress={() => setStateFilter(stateFilter === s ? "" : s)}
              />
            ))}
          </ChipRow>
        </Card>

        {rowsQ.error ? (
          <Notice message={friendlyError(rowsQ.error)} tone="danger" />
        ) : rowsQ.fetching && all.length === 0 ? (
          <Loader label={STR.loading} />
        ) : rows.length === 0 ? (
          <EmptyState message={STR.ctNoReports} />
        ) : (
          rows.map((r) => (
            <Card key={r.testId}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  nav.navigate("ClassTestTab", {
                    screen: "ClassTestResults",
                    params: {
                      testId: r.testId,
                      title: `${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`,
                    },
                    initial: false,
                  })
                }
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                    </Body>
                    <Muted>
                      {r.ctId} · {bnNum(dateKey(new Date(r.examDate)))} · {r.teacherName}
                    </Muted>
                  </View>
                  <Badge text={ctReportStateLabel(r.state)} tone={stateTone(r.state)} />
                </View>
                <Muted style={{ marginTop: space(1) }}>
                  {STR.ctEntered} {bnNum(r.enteredCount)}/{bnNum(r.rosterCount)} · {STR.ctPending} {bnNum(r.pendingCount)}
                  {r.overdue ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}` : ""}
                  {r.submittedAt ? ` · ${STR.ctSubmittedBadge} ${bnNum(dateKey(new Date(r.submittedAt)))}` : ""}
                </Muted>
              </Pressable>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
