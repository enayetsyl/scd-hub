/**
 * RevisionDashboardScreen (J-SR3, SR-3) — Principal/Office analytics for the
 * Saturday revision. A level dashboard (revisionLevelDashboard) when a group is
 * carried in, the group coverage/overdue list (revisionGroupCoverage), the weekly
 * trend (revisionWeeklyTrend) and mistake breakdown (revisionMistakeBreakdown),
 * an optional per-student juz-weakness heat list (studentJuzWeakness), and the
 * completeness view (revisionCompletenessStatus + revisionCompletenessChase with
 * wa.me links). Charts are kept to numeric/bar-ish lists, consistent with the
 * existing CT/VC dashboards (no charting lib). roster:manage re-gated server-side.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  REVISION_LEVEL_DASHBOARD_QUERY,
  REVISION_GROUP_COVERAGE_QUERY,
  REVISION_WEEKLY_TREND_QUERY,
  REVISION_MISTAKE_BREAKDOWN_QUERY,
  STUDENT_JUZ_WEAKNESS_QUERY,
  REVISION_COMPLETENESS_STATUS_QUERY,
  REVISION_COMPLETENESS_CHASE_QUERY,
  type RevisionDashboardT,
  type RevisionMistakesAggT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Field, Badge, Notice, Loader } from "../../components/ui";
import { STR, bnNum, classLevelLabel, revCategoryLabel, revMistakeLabel, revTrendGlyph } from "../../lib/labels";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "RevisionDashboard">;

/** A row of the structured mistakes object → a labelled count list (HARF/…/OTHER). */
function MistakeList({ m }: { m: RevisionMistakesAggT }): React.ReactElement {
  const rows: [string, number][] = [
    ["HARF", m.harf],
    ["GHUNNAH", m.ghunnah],
    ["MADD", m.madd],
    ["OTHER", m.other],
  ];
  return (
    <View style={{ marginTop: space(1) }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
          <Muted>{revMistakeLabel(k)}</Muted>
          <Body>{bnNum(v)}</Body>
        </View>
      ))}
    </View>
  );
}

function DashboardCard({ dash }: { dash: RevisionDashboardT }): React.ReactElement {
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.revLevelDash}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
        <Badge text={`${STR.revEntries}: ${bnNum(dash.entries)}`} tone="muted" />
        <Badge text={`${STR.revPresent}: ${bnNum(dash.present)}`} tone="brand" />
        <Badge text={`${STR.revAbsent}: ${bnNum(dash.absent)}`} tone="muted" />
      </View>
      <Muted style={{ marginTop: space(2) }}>{STR.revPortions}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(1) }}>
        <Badge text={`${revCategoryLabel("SABAQ")}: ${bnNum(dash.portionsByCategory.SABAQ)}`} tone="muted" />
        <Badge text={`${revCategoryLabel("SABQI")}: ${bnNum(dash.portionsByCategory.SABQI)}`} tone="muted" />
        <Badge text={`${revCategoryLabel("MANZIL")}: ${bnNum(dash.portionsByCategory.MANZIL)}`} tone="muted" />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
        <Muted>{STR.revTanbih}</Muted>
        <Body>{bnNum(dash.totalTanbih)}</Body>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(1) }}>
        <Muted>{STR.revFath}</Muted>
        <Body>{bnNum(dash.totalFath)}</Body>
      </View>
      <Muted style={{ marginTop: space(2) }}>{STR.revMistakeBreakdown}</Muted>
      <MistakeList m={dash.mistakes} />
      {dash.weakestJuz ? (
        <Muted style={{ marginTop: space(2) }}>
          {STR.revWeakestJuz}: {STR.revJuz} {bnNum(dash.weakestJuz.juz)} ({STR.revTotalMistakes}{" "}
          {bnNum(dash.weakestJuz.total)})
        </Muted>
      ) : null}
    </Card>
  );
}

export default function RevisionDashboardScreen({ route }: Props): React.ReactElement {
  const { groupId, nameBn, date } = route.params;
  const asOf = date;
  const [studentId, setStudentId] = useState("");
  const [activeStudent, setActiveStudent] = useState<string | null>(null);

  const [levelQ] = useQuery({
    query: REVISION_LEVEL_DASHBOARD_QUERY,
    variables: { groupId: groupId ?? "", asOf },
    pause: !groupId,
  });
  const [coverageQ] = useQuery({
    query: REVISION_GROUP_COVERAGE_QUERY,
    variables: { groupId: groupId ?? "", asOf, windowDays: null },
    pause: !groupId,
  });
  const [trendQ] = useQuery({
    query: REVISION_WEEKLY_TREND_QUERY,
    variables: { groupId: groupId ?? null, studentId: null, asOf },
    pause: !groupId,
  });
  const [mistakeQ] = useQuery({
    query: REVISION_MISTAKE_BREAKDOWN_QUERY,
    variables: { groupId: groupId ?? null, studentId: null, asOf },
    pause: !groupId,
  });
  const [weaknessQ] = useQuery({
    query: STUDENT_JUZ_WEAKNESS_QUERY,
    variables: { studentId: activeStudent ?? "", asOf },
    pause: !activeStudent,
  });
  const [completeQ] = useQuery({ query: REVISION_COMPLETENESS_STATUS_QUERY, variables: { date } });
  const [chaseQ] = useQuery({ query: REVISION_COMPLETENESS_CHASE_QUERY, variables: { date } });

  const coverage = coverageQ.data?.revisionGroupCoverage ?? [];
  const overdue = coverage.filter((c) => c.overdue);
  const trend = trendQ.data?.revisionWeeklyTrend;
  const incomplete = completeQ.data?.revisionCompletenessStatus ?? [];
  const chase = chaseQ.data?.revisionCompletenessChase ?? [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revDashTitle}</Body>
          <Muted>
            {nameBn ? `${nameBn} · ` : ""}
            {bnNum(date)}
          </Muted>
        </Card>

        {/* Level dashboard — only when a group is in scope */}
        {groupId ? (
          levelQ.fetching ? (
            <Loader label={STR.loading} />
          ) : levelQ.data?.revisionLevelDashboard ? (
            <DashboardCard dash={levelQ.data.revisionLevelDashboard} />
          ) : null
        ) : null}

        {/* Weekly trend */}
        {groupId ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>
              {STR.revTrend} {trend ? revTrendGlyph(trend.trend) : ""}
            </Body>
            {trendQ.fetching ? (
              <Loader label={STR.loading} />
            ) : !trend || trend.points.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.revNoData}</Muted>
            ) : (
              trend.points.map((p) => (
                <View
                  key={p.date}
                  style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}
                >
                  <Muted>{bnNum(p.date)}</Muted>
                  <Body>
                    {STR.revTanbih} {bnNum(p.tanbih)} · {STR.revFath} {bnNum(p.fath)} · {STR.revMistakes}{" "}
                    {bnNum(p.mistakes)}
                  </Body>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Mistake breakdown */}
        {groupId ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.revMistakeBreakdown}</Body>
            {mistakeQ.fetching ? (
              <Loader label={STR.loading} />
            ) : mistakeQ.data?.revisionMistakeBreakdown ? (
              <MistakeList m={mistakeQ.data.revisionMistakeBreakdown} />
            ) : (
              <Muted style={{ marginTop: space(2) }}>{STR.revNoData}</Muted>
            )}
          </Card>
        ) : null}

        {/* Coverage / overdue list */}
        {groupId ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.revCoverage}</Body>
            {coverageQ.fetching ? (
              <Loader label={STR.loading} />
            ) : overdue.length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.revNoData}</Muted>
            ) : (
              overdue.map((c, i) => (
                <View key={`${c.studentId}-${c.juz}-${i}`} style={{ marginTop: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ flexShrink: 1 }}>
                      {c.studentName} · {STR.revJuz} {bnNum(c.juz)}
                    </Body>
                    <Badge text={STR.revOverdue} tone="danger" />
                  </View>
                  <Muted>
                    {STR.revLastRevised}: {c.lastRevised ? bnNum(c.lastRevised) : "—"}
                    {c.daysSince != null ? ` · ${STR.revDaysSince} ${bnNum(c.daysSince)}` : ""}
                  </Muted>
                </View>
              ))
            )}
          </Card>
        ) : null}

        {/* Per-student juz-weakness heat list */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revWeaknessHeat}</Body>
          <Field label={STR.revStudentId} value={studentId} onChangeText={setStudentId} />
          <Button title={STR.revLoad} variant="secondary" onPress={() => setActiveStudent(studentId.trim() || null)} />
          {activeStudent ? (
            weaknessQ.fetching ? (
              <Loader label={STR.loading} />
            ) : (weaknessQ.data?.studentJuzWeakness ?? []).length === 0 ? (
              <Muted style={{ marginTop: space(2) }}>{STR.revNoData}</Muted>
            ) : (
              (weaknessQ.data?.studentJuzWeakness ?? []).map((w) => (
                <View
                  key={w.juz}
                  style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
                >
                  <Body>
                    {STR.revJuz} {bnNum(w.juz)}
                  </Body>
                  <Badge
                    text={`${STR.revTotalMistakes}: ${bnNum(w.total)}`}
                    tone={w.total >= 10 ? "danger" : w.total >= 3 ? "warn" : "muted"}
                  />
                </View>
              ))
            )
          ) : null}
        </Card>

        {/* Completeness — which level groups still owe a Saturday entry */}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revCompleteness}</Body>
          <Muted>{STR.revIncompleteGroups}</Muted>
          {completeQ.fetching ? (
            <Loader label={STR.loading} />
          ) : incomplete.length === 0 ? (
            <Notice message={STR.revAllComplete} tone="ok" />
          ) : (
            incomplete.map((g) => (
              <View
                key={g.groupId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space(2) }}
              >
                <Body style={{ flexShrink: 1 }}>
                  {g.nameBn} · {g.code}
                </Body>
                <Badge text={classLevelLabel(g.level)} tone="warn" />
              </View>
            ))
          )}
        </Card>

        {/* Chase list — wa.me links to the owing groups' teachers */}
        {chase.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.revChaseTitle}</Body>
            {chase.map((c) => (
              <View key={c.groupId} style={{ marginTop: space(3) }}>
                <Body style={{ fontWeight: "700" }}>
                  {c.nameBn} · {c.code}
                </Body>
                <Muted>
                  {STR.revTeacher}: {c.teacherName ?? "—"}
                </Muted>
                <Muted>{c.messageBn}</Muted>
                <View style={{ marginTop: space(1) }}>
                  {c.waLink ? (
                    <Button title={STR.revOpenWa} variant="secondary" onPress={() => void Linking.openURL(c.waLink!)} />
                  ) : (
                    <Badge text={c.unreachableByWa ? STR.revUnreachable : STR.revNoPhone} tone="muted" />
                  )}
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
