/**
 * ClassTestDashboardScreen (CT-5 / J5, Principal/Office) — the school-wide KPIs
 * (logged / complete / in-progress / not-started / overdue + completion rate),
 * a per-test DRILL-DOWN under the tiles (D-#339: tap a tile = state filter; each
 * row shows who/when and taps through to the results), the overdue-by-teacher
 *
 * TWO INDEPENDENT AXES (owner ask 2026-07-28). The tiles are the ENTRY state — "are the
 * marks in?". The chip row under the drill-down is the PUBLISH state — "can the guardian
 * see them?" (`lib/ctPublishStatus`, derived from submittedAt/publishedAt, which the
 * reports-status row already carried). They AND-combine, so Complete + Unpublished is
 * the release backlog — a number this screen previously could not show at all. Each row
 * carries both badges for the same reason.
 * breakdown, and the Office overdue-chase (a rendered wa.me nudge per teacher —
 * message:dispatch). Reads are gated Principal/Office server-side; a teacher
 * reaching here sees the Bangla deny inline.
 */
import React, { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  CLASS_TEST_DASHBOARD_QUERY,
  CLASS_TEST_OVERDUE_CHASE_QUERY,
  CLASS_TEST_REPORTS_STATUS_QUERY,
} from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Chip, ChipRow, Loader, Notice } from "../../components/ui";
import {
  CT_PUBLISH_FILTERS,
  ctPublishBadge,
  ctPublishFilterLabel,
  matchesCtPublishFilter,
  type CtPublishFilter,
} from "../../lib/ctPublishStatus";
import { CT_PAGE_SIZE, ctOrderRows, ctPageOf } from "../../lib/ctDashboardOrder";
import { STR, hwSubjectLabel, ctReportStateLabel, bnNum, isoDateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

/** null = all logged tests (the default drill-down scope). */
type StateFilter = "complete" | "in_progress" | "not_started" | "overdue" | null;


const stateTone = (s: string): "ok" | "danger" | "brand" | "muted" =>
  s === "complete" ? "ok" : s === "overdue" ? "danger" : s === "in_progress" ? "brand" : "muted";

function Kpi({
  label,
  value,
  selected,
  onPress,
}: {
  label: string;
  value: string;
  selected?: boolean;
  onPress?: () => void;
}): React.ReactElement {
  return (
    <Pressable style={{ flexGrow: 1, minWidth: 96 }} onPress={onPress} disabled={!onPress}>
      <Card>
        <Body style={{ fontWeight: "700", fontSize: 20 }}>{value}</Body>
        <Muted style={selected ? { fontWeight: "700" } : undefined}>
          {selected ? "▸ " : ""}
          {label}
        </Muted>
      </Card>
    </Pressable>
  );
}

export default function ClassTestDashboardScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  // D-#339: tap a tile → filter the per-test drill-down below (logged = all).
  const [stateFilter, setStateFilter] = useState<StateFilter>(null);
  // Owner ask 2026-07-28: the PUBLISH axis, independent of the entry state above — the
  // tiles only ever answered "are the marks in?", never "can the guardian see them?".
  // The two AND-combine, so "Complete + Unpublished" = the actual release backlog.
  const [publishFilter, setPublishFilter] = useState<CtPublishFilter | null>(null);
  // Current page of the drill-down; either filter changing sends you back to page 1,
  // because page 4 of the old list means nothing in the new one.
  const [pageAt, setPageAt] = useState(0);
  const pickState = (s: StateFilter): void => {
    setStateFilter(s);
    setPageAt(0);
  };
  const pickPublish = (f: CtPublishFilter | null): void => {
    setPublishFilter(f);
    setPageAt(0);
  };
  const [dashQ] = useQuery({ query: CLASS_TEST_DASHBOARD_QUERY, variables: {} });
  const [chaseQ] = useQuery({ query: CLASS_TEST_OVERDUE_CHASE_QUERY, variables: {} });
  const [rowsQ] = useQuery({ query: CLASS_TEST_REPORTS_STATUS_QUERY, variables: {} });
  const d = dashQ.data?.classTestPrincipalDashboard ?? null;
  const chase = chaseQ.data?.classTestOverdueChase ?? null;
  const allRows = rowsQ.data?.classTestReportsStatus ?? [];
  const stateRows = stateFilter ? allRows.filter((r) => r.state === stateFilter) : allRows;
  const filtered = publishFilter ? stateRows.filter((r) => matchesCtPublishFilter(r, publishFilter)) : stateRows;
  // Release backlog → overdue → in hand → done (lib/ctDashboardOrder), then 50 a page.
  const rows = ctOrderRows(filtered);
  const { page, pageCount, from, rows: pageRows } = ctPageOf(rows, pageAt);
  // Chip counts are computed WITHIN the tile selection so they always add up to what the
  // list below is showing, rather than to a school-wide total the user cannot see.
  const publishCount = (f: CtPublishFilter): number =>
    stateRows.filter((r) => matchesCtPublishFilter(r, f)).length;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {dashQ.error ? <Notice message={friendlyError(dashQ.error)} tone="danger" /> : null}
        {dashQ.fetching ? (
          <Loader label={STR.loading} />
        ) : d ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              <Kpi label={STR.ctLogged} value={bnNum(d.logged)} selected={stateFilter === null} onPress={() => pickState(null)} />
              <Kpi label={STR.ctComplete} value={bnNum(d.complete)} selected={stateFilter === "complete"} onPress={() => pickState("complete")} />
              <Kpi label={STR.ctInProgress} value={bnNum(d.inProgress)} selected={stateFilter === "in_progress"} onPress={() => pickState("in_progress")} />
              <Kpi label={STR.ctNotStarted} value={bnNum(d.notStarted)} selected={stateFilter === "not_started"} onPress={() => pickState("not_started")} />
              <Kpi label={STR.ctOverdue} value={bnNum(d.overdue)} selected={stateFilter === "overdue"} onPress={() => pickState("overdue")} />
              <Kpi label={STR.ctCompletionRate} value={d.completionRatePct == null ? "—" : `${bnNum(d.completionRatePct)}%`} />
            </View>

            {/* D-#339: per-test drill-down — who submitted / logged what, filtered by the tapped tile. */}
            <Card>
              <Body style={{ fontWeight: "700" }}>
                {STR.ctDrilldownTitle} · {stateFilter ? ctReportStateLabel(stateFilter) : STR.ctLogged}
                {publishFilter ? ` · ${ctPublishFilterLabel(publishFilter)}` : ""} ({bnNum(rows.length)})
              </Body>

              {/* The publish axis (owner ask 2026-07-28) — AND-combines with the tile above. */}
              <Muted style={{ marginTop: space(2) }}>{STR.ctFilterPublishTitle}</Muted>
              <ChipRow>
                <Chip
                  label={`${STR.all} (${bnNum(stateRows.length)})`}
                  selected={publishFilter === null}
                  onPress={() => pickPublish(null)}
                />
                {CT_PUBLISH_FILTERS.map((f) => (
                  <Chip
                    key={f}
                    label={`${ctPublishFilterLabel(f)} (${bnNum(publishCount(f))})`}
                    selected={publishFilter === f}
                    onPress={() => pickPublish(publishFilter === f ? null : f)}
                  />
                ))}
              </ChipRow>

              {rowsQ.error ? (
                <Notice message={friendlyError(rowsQ.error)} tone="danger" />
              ) : rowsQ.fetching ? (
                <Loader label={STR.loading} />
              ) : rows.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.ctNoReports}</Muted>
              ) : (
                pageRows.map((r) => (
                  <Pressable
                    key={r.testId}
                    onPress={() =>
                      nav.navigate("ClassTestResults", {
                        testId: r.testId,
                        title: `${hwSubjectLabel(r.subject)} · ${STR.ctTestNumber} ${bnNum(r.testNumber)}`,
                      })
                    }
                    style={{ marginTop: space(3) }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flexShrink: 1 }}>
                        <Body style={{ fontWeight: "700" }}>
                          {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                        </Body>
                        <Muted>
                          {r.ctId} · {isoDateLabel(r.examDate)} · {r.teacherName}
                        </Muted>
                      </View>
                      {/* Two independent axes, two badges: entry state + publish state. */}
                      <View style={{ alignItems: "flex-end", gap: space(1) }}>
                        <Badge text={ctReportStateLabel(r.state)} tone={stateTone(r.state)} />
                        <Badge {...ctPublishBadge(r)} />
                      </View>
                    </View>
                    <Muted style={{ marginTop: space(1) }}>
                      {STR.ctEntered} {bnNum(r.enteredCount)}/{bnNum(r.rosterCount)} · {STR.ctPending} {bnNum(r.pendingCount)}
                      {r.overdue ? ` · ${STR.ctSchoolDaysLate} ${bnNum(r.schoolDaysLate)}` : ""}
                      {r.submittedAt
                        ? ` · ${STR.ctSubmittedBadge} ${isoDateLabel(r.submittedAt)}`
                        : ""}
                      {r.publishedAt
                        ? ` · ${STR.ctPublishedBadge} ${isoDateLabel(r.publishedAt)}`
                        : ""}
                    </Muted>
                  </Pressable>
                ))
              )}

              {/* Pager — 50 rows a page. Hidden when everything fits on one, so the
                  common case is unchanged. */}
              {rows.length > CT_PAGE_SIZE ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: space(2),
                    marginTop: space(4),
                  }}
                >
                  <Button
                    title={`◀ ${STR.pagePrev}`}
                    variant="secondary"
                    disabled={page === 0}
                    onPress={() => setPageAt(page - 1)}
                  />
                  <Muted>
                    {STR.pageLabel} {bnNum(page + 1)} / {bnNum(pageCount)} · {bnNum(from + 1)}–
                    {bnNum(from + pageRows.length)} / {bnNum(rows.length)}
                  </Muted>
                  <Button
                    title={`${STR.pageNext} ▶`}
                    variant="secondary"
                    disabled={page >= pageCount - 1}
                    onPress={() => setPageAt(page + 1)}
                  />
                </View>
              ) : null}
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.ctOverdueByTeacher}</Body>
              {d.overdueByTeacher.length === 0 ? (
                <Muted style={{ marginTop: space(2) }}>{STR.ctNoOverdue}</Muted>
              ) : (
                d.overdueByTeacher.map((r) => (
                  <View
                    key={r.teacherId}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
                  >
                    <Body>{r.teacherName}</Body>
                    <Badge text={bnNum(r.overdueCount)} tone="danger" />
                  </View>
                ))
              )}
            </Card>
          </>
        ) : null}

        {/* Office overdue-chase — a wa.me nudge per overdue teacher (message:dispatch) */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.ctChaseTitle}</Body>
          {chaseQ.error ? (
            <Notice message={friendlyError(chaseQ.error)} tone="danger" />
          ) : chaseQ.fetching ? (
            <Loader label={STR.loading} />
          ) : !chase || chase.entries.length === 0 ? (
            <Muted style={{ marginTop: space(2) }}>{STR.ctNoOverdue}</Muted>
          ) : (
            chase.entries.map((e) => (
              <View
                key={e.teacherId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(3) }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Body style={{ fontWeight: "700" }}>{e.teacherName}</Body>
                  <Muted>
                    {e.exams
                      .map((x) => `${hwSubjectLabel(x.subject)} ${STR.ctTestNumber} ${bnNum(x.testNumber)}`)
                      .join(", ")}
                  </Muted>
                </View>
                {e.waLink ? (
                  <Button title={STR.ctSendWa} variant="secondary" onPress={() => void Linking.openURL(e.waLink as string)} />
                ) : (
                  <Badge text={STR.ctUnreachable} tone="muted" />
                )}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
