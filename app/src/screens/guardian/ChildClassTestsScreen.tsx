/**
 * ChildClassTestsScreen (D-#732) — the guardian's Class Test tab: the child's
 * upcoming class tests, a summary of their PUBLISHED results (tests taken, average,
 * strongest / weakest subject), an average per subject, and every published result
 * filterable by subject, newest first.
 *
 * Reads `childUpcomingClassTests`, `childTestResultStats` (light rows for every result)
 * and `childTestResultsPage` (the list, paged — D-#761), all link-gated by
 * guardian:read_child + assertGuardianOfStudent, with the figures derived in
 * `lib/childClassTests` so this tab, the sidebar badge and Today's "new result" row
 * use one rule. Read-only; teacherAction is never fetched (J7, D-#68).
 */
import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "urql";
import { CHILD_UPCOMING_CLASS_TESTS_QUERY } from "../../graphql/operations";
import { CHILD_TEST_RESULTS_PAGE_QUERY, CHILD_TEST_RESULT_STATS_QUERY } from "../../graphql/classTest";
import { Screen, Body, Muted, Card, Chip, ChipRow, Loader } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { Pager } from "../../components/Pager";
import { ChildSwitcher } from "../../components/ChildSwitcher";
import { UpcomingClassTestsCard, ClassTestResultRow } from "../../components/ChildClassTestCards";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { useRecordView } from "../../lib/useRecordView";
import { usePullRefresh } from "../../lib/useRefresh";
import { usePageState, PAGE_SIZE } from "../../lib/paging";
import { isNewResult, summarizeChildResults } from "../../lib/childClassTests";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";

/** Subject names on this tab — "Bangladesh & Global Studies" is shortened to BGS
 *  (owner, 2026-10-13): it took two lines in the summary and was cut off on the bars. */
const subjectName = (code: string): string => (code === "BGS" ? STR.gctBgsShort : hwSubjectLabel(code));

/** One summary figure. */
function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}): React.ReactElement {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, minWidth: 140 }}>
      <Muted>{label}</Muted>
      <Body style={{ fontWeight: "700", fontSize: 22, marginTop: 2, ...(accent ? { color: accent } : null) }}>
        {value}
      </Body>
      {sub ? <Muted>{sub}</Muted> : null}
    </View>
  );
}

export default function ChildClassTestsScreen(): React.ReactElement {
  const colors = useColors();
  const { selected } = useGuardianChild();
  useRecordView("CLASS_TEST", selected?.studentId);
  const sid = selected?.studentId ?? "";

  const [upcomingQ, refetchUpcoming] = useQuery({
    query: CHILD_UPCOMING_CLASS_TESTS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  // D-#761: the summary, the subject chips (and their order) still cover EVERY result,
  // so they come from the light stats rows; the result list itself pages on the server.
  const [statsQ, refetchStats] = useQuery({
    query: CHILD_TEST_RESULT_STATS_QUERY,
    variables: { studentId: sid },
    pause: !selected,
  });
  const upcoming = upcomingQ.data?.childUpcomingClassTests ?? [];
  const stats = useMemo(() => statsQ.data?.childTestResultStats ?? [], [statsQ.data]);
  const summary = useMemo(() => summarizeChildResults(stats), [stats]);

  // Subject filter: "all" or a subject code. A different child starts from "all" —
  // the previous child's subject may not exist for this one.
  const [subject, setSubject] = useState<string>("all");
  useEffect(() => setSubject("all"), [sid]);
  // Chips in the order subjects first appear (newest result first), so the subject
  // with the latest result sits next to "All".
  const subjects = useMemo(() => [...new Set(stats.map((r) => r.subject))], [stats]);
  const [page, setPage] = usePageState(`${sid}|${subject}`);
  const [resultsQ, refetchResults] = useQuery({
    query: CHILD_TEST_RESULTS_PAGE_QUERY,
    variables: { studentId: sid, subject: subject === "all" ? null : subject, page, pageSize: PAGE_SIZE },
    pause: !selected,
  });
  const shown = resultsQ.data?.childTestResultsPage?.rows ?? [];
  const now = Date.now();

  const refetchAll = (): void => {
    const opts = { requestPolicy: "network-only" as const };
    refetchUpcoming(opts);
    refetchStats(opts);
    refetchResults(opts);
  };
  const { refreshing, onRefresh } = usePullRefresh(
    upcomingQ.fetching || statsQ.fetching || resultsQ.fetching,
    refetchAll,
  );

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ChildSwitcher />
      </View>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!selected ? (
          <Loader label={STR.loading} />
        ) : (
          <QueryGate results={[upcomingQ, statsQ, resultsQ]} onRetry={refetchAll} loaderLabel={STR.loading}>
            {summary.taken + summary.absent > 0 ? (
              <Card>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(4) }}>
                  <Stat
                    label={STR.gctTaken}
                    value={bnNum(summary.taken)}
                    sub={summary.absent > 0 ? `${STR.ctAbsent}: ${bnNum(summary.absent)}` : undefined}
                  />
                  {summary.avgPercent !== null ? (
                    <Stat label={STR.gctAverage} value={`${bnNum(summary.avgPercent)}%`} />
                  ) : null}
                  {summary.best ? <Stat label={STR.gctBest} value={subjectName(summary.best)} /> : null}
                  {summary.weakest ? (
                    <Stat
                      label={STR.gctNeedsAttention}
                      value={subjectName(summary.weakest)}
                      accent={colors.warning}
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}

            <UpcomingClassTestsCard tests={upcoming} emptyText={STR.gctNoUpcoming} />

            {summary.bySubject.length >= 2 ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.gctBySubject}</Body>
                {summary.bySubject.map((s) => {
                  const weak = s.subject === summary.weakest;
                  return (
                    <View
                      key={s.subject}
                      style={{ flexDirection: "row", alignItems: "center", gap: space(3), marginTop: space(2) }}
                    >
                      {/* Wide enough for "Islamic Studies" / "ইসলাম শিক্ষা" on one line; a
                          longer name wraps rather than being cut to "Islamic Stu…". */}
                      <Text style={{ width: 120, color: colors.textPrimary, fontWeight: "600" }}>
                        {subjectName(s.subject)}
                      </Text>
                      <View
                        style={{ flex: 1, height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" }}
                        accessibilityLabel={`${subjectName(s.subject)} ${bnNum(s.avgPercent)}%`}
                      >
                        <View
                          style={{
                            width: `${Math.max(0, Math.min(100, s.avgPercent))}%`,
                            height: 10,
                            backgroundColor: weak ? colors.warning : colors.primary,
                          }}
                        />
                      </View>
                      <Muted style={{ minWidth: 92, textAlign: "right" }}>
                        {bnNum(s.avgPercent)}% · {bnNum(s.tests)}
                        {STR.gctTestsSuffix}
                      </Muted>
                    </View>
                  );
                })}
              </Card>
            ) : null}

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.gpTestResults}</Body>
              {subjects.length >= 2 ? (
                <View style={{ marginTop: space(2) }}>
                  <ChipRow>
                    <Chip label={STR.all} selected={subject === "all"} onPress={() => setSubject("all")} />
                    {subjects.map((s) => (
                      <Chip key={s} label={subjectName(s)} selected={subject === s} onPress={() => setSubject(s)} />
                    ))}
                  </ChipRow>
                </View>
              ) : null}
              {stats.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.gpNoTestResults}</Muted>
              ) : shown.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.gctNoSubjectResults}</Muted>
              ) : (
                shown.map((r) => (
                  <ClassTestResultRow key={r.testId} r={r} isNew={isNewResult(r.publishedAt, now)} showOutcome subjectName={subjectName} />
                ))
              )}
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={resultsQ.data?.childTestResultsPage?.total ?? 0}
                onPage={setPage}
              />
            </Card>
          </QueryGate>
        )}
      </ScrollView>
    </Screen>
  );
}
