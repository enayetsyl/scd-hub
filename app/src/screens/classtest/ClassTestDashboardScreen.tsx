/**
 * ClassTestDashboardScreen (CT-5 / J5, Principal/Office) — the school-wide KPIs
 * (logged / complete / in-progress / not-started / overdue + completion rate),
 * the overdue-by-teacher breakdown, and the Office overdue-chase (a rendered wa.me
 * nudge per teacher with overdue reports — message:dispatch). Both reads are gated
 * Principal/Office server-side; a teacher reaching here sees the Bangla deny inline.
 */
import React from "react";
import { Linking, ScrollView, View } from "react-native";
import { useQuery } from "urql";
import { CLASS_TEST_DASHBOARD_QUERY, CLASS_TEST_OVERDUE_CHASE_QUERY } from "../../graphql/classTest";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { STR, hwSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

function Kpi({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={{ flexGrow: 1, minWidth: 96 }}>
      <Card>
        <Body style={{ fontWeight: "700", fontSize: 20 }}>{value}</Body>
        <Muted>{label}</Muted>
      </Card>
    </View>
  );
}

export default function ClassTestDashboardScreen(): React.ReactElement {
  const [dashQ] = useQuery({ query: CLASS_TEST_DASHBOARD_QUERY, variables: {} });
  const [chaseQ] = useQuery({ query: CLASS_TEST_OVERDUE_CHASE_QUERY, variables: {} });
  const d = dashQ.data?.classTestPrincipalDashboard ?? null;
  const chase = chaseQ.data?.classTestOverdueChase ?? null;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {dashQ.error ? <Notice message={friendlyError(dashQ.error)} tone="danger" /> : null}
        {dashQ.fetching ? (
          <Loader label={STR.loading} />
        ) : d ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
              <Kpi label={STR.ctLogged} value={bnNum(d.logged)} />
              <Kpi label={STR.ctComplete} value={bnNum(d.complete)} />
              <Kpi label={STR.ctInProgress} value={bnNum(d.inProgress)} />
              <Kpi label={STR.ctNotStarted} value={bnNum(d.notStarted)} />
              <Kpi label={STR.ctOverdue} value={bnNum(d.overdue)} />
              <Kpi label={STR.ctCompletionRate} value={d.completionRatePct == null ? "—" : `${bnNum(d.completionRatePct)}%`} />
            </View>

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
