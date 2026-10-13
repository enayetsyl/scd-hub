/**
 * StudentProgressStudentScreen (SP-1/SP-2, docs/prd-student-progress.md §3) — one student
 * for Office / Principal: overall vs class, direction, at-risk, recurring weaknesses,
 * every subject against the class average with the last three results and the latest
 * teacher's note, and the improvement-action log (the student's own actions and the
 * class actions that cover them). "+ New action" opens the form for this student.
 */
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { PROGRESS_STUDENT, type ImprovementActionSummaryT } from "../../graphql/improvement";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Divider } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, classSectionLabel, subjectShortLabel } from "../../lib/labels";
import { isWholeClassSectionName } from "../../lib/sectionPicks";
import { usePullRefresh } from "../../lib/useRefresh";
import {
  periodRange,
  periodLabel,
  actionStateLabel,
  actionStateTone,
  bandColors,
  trendArrow,
  trajectoryLabel,
  type PeriodKey,
} from "../../lib/improvement";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "StudentProgressStudent">;

const pct = (v: number | null | undefined): string => (v == null ? "—" : `${bnNum(Math.round(v))}%`);

/** One action, as a card: what, who, how far along, and — once it has ended — before/after. */
export function ActionCard({ a, onPress }: { a: ImprovementActionSummaryT; onPress: () => void }): React.ReactElement {
  const c = useColors();
  const who =
    a.scope === "CLASS"
      ? `${STR.impScopeClass} · ${a.classLevel != null ? classSectionLabel(a.classLevel, isWholeClassSectionName(a.sectionNameBn) ? null : a.sectionNameBn) : a.sectionNameBn}`
      : `${STR.impScopeStudent}${a.studentName ? ` · ${a.studentName}` : ""}`;
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space(2), alignItems: "center" }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>
          {subjectShortLabel(a.subject)} · {who}
        </Body>
        <Badge text={actionStateLabel(a.state)} tone={actionStateTone(a.state)} />
      </View>
      <Muted>
        {a.startKey} – {a.endKey} · {bnNum(a.totalDays)} {STR.impDay}
        {a.state === "RUNNING" && a.dayNumber > 0 ? ` · ${STR.impDay} ${bnNum(a.dayNumber)}/${bnNum(a.totalDays)}` : ""}
        {a.createdByName ? ` · ${a.createdByName}` : ""}
      </Muted>
      {a.teacherTask ? (
        <Text style={{ color: c.textPrimary, marginTop: 4 }}>
          <Text style={{ fontWeight: "700" }}>
            {STR.impTeacherPart}
            {a.teacherName ? ` (${a.teacherName})` : ""}:{" "}
          </Text>
          {a.teacherTask} — {bnNum(a.teacherDone)}/{bnNum(a.teacherOwed)}
          {a.teacherNotMarked ? ` · ${bnNum(a.teacherNotMarked)} ${STR.impLegendNotMarked}` : ""}
        </Text>
      ) : null}
      {a.guardianTask ? (
        <Text style={{ color: c.textPrimary, marginTop: 4 }}>
          <Text style={{ fontWeight: "700" }}>{STR.impGuardianPart}: </Text>
          {a.guardianTask} — {bnNum(a.guardianDone)}/{bnNum(a.guardianOwed)}
        </Text>
      ) : null}
      {a.state === "ENDED" ? (
        <Muted style={{ marginTop: 4 }}>
          {STR.impBefore} {pct(a.before)} → {STR.impAfter} {a.after == null ? STR.impAfterPending : pct(a.after)}
        </Muted>
      ) : null}
    </Card>
  );
}

export default function StudentProgressStudentScreen({ route, navigation }: Props): React.ReactElement {
  const { studentId } = route.params;
  const c = useColors();
  const [period, setPeriod] = React.useState<PeriodKey>("YEAR");
  const range = periodRange(period);
  const [q, refetch] = useQuery({ query: PROGRESS_STUDENT, variables: { studentId, ...range }, requestPolicy: "cache-and-network" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const p = q.data?.progressStudent;

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <ChipRow>
          {(["YEAR", "TERM", "D30"] as PeriodKey[]).map((k) => (
            <Chip key={k} label={periodLabel(k)} selected={period === k} onPress={() => setPeriod(k)} />
          ))}
        </ChipRow>
        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {p ? (
            <View style={{ gap: space(3) }}>
              <Card>
                <Body style={{ fontWeight: "700", fontSize: 18 }}>{p.name}</Body>
                <Muted>{p.classLevel != null ? classSectionLabel(p.classLevel, isWholeClassSectionName(p.sectionNameBn) ? null : p.sectionNameBn) : p.sectionNameBn}</Muted>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(4), marginTop: space(2) }}>
                  <View>
                    <Muted>{STR.impAverage}</Muted>
                    <Body style={{ fontWeight: "700", fontSize: 22 }}>
                      {pct(p.overall)} <Text style={{ fontSize: 13, fontWeight: "400", color: c.textSecondary }}>{STR.impClassWord} {pct(p.classOverall)}</Text>
                    </Body>
                  </View>
                  <View>
                    <Muted>{STR.impDirection}</Muted>
                    <Body style={{ fontWeight: "700", color: p.trajectory === "down" ? c.error : c.textPrimary }}>{trajectoryLabel(p.trajectory)}</Body>
                  </View>
                  {p.atRisk ? (
                    <View style={{ justifyContent: "center" }}>
                      <Badge text={STR.impAtRisk} tone="danger" />
                    </View>
                  ) : null}
                </View>
                {p.recurringWeaknesses.length ? (
                  <Muted style={{ marginTop: space(2) }}>
                    {STR.impRecurring}: {p.recurringWeaknesses.join(" · ")}
                  </Muted>
                ) : null}
              </Card>

              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.impBySubject}</Body>
                {p.subjects.length === 0 ? <Muted style={{ marginTop: space(2) }}>{STR.impNoResults}</Muted> : null}
                {p.subjects.map((s, i) => {
                  const b = bandColors(s.avgPercent, c);
                  return (
                    <View key={s.subject} style={{ marginTop: space(2) }}>
                      {i ? <Divider /> : null}
                      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2), marginTop: i ? space(2) : 0 }}>
                        <Body style={{ fontWeight: "700", minWidth: 110 }}>{subjectShortLabel(s.subject)}</Body>
                        <Text style={{ backgroundColor: b.bg, color: b.fg, fontWeight: "700", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          {pct(s.avgPercent)}
                          {trendArrow(s.trend)}
                        </Text>
                        <Muted>
                          {STR.impClassWord} {pct(s.classAverage)} · {STR.impLast3}: {s.last3.map((x) => `${bnNum(Math.round(x))}%`).join(" → ")}
                        </Muted>
                      </View>
                      {s.latestWeakness ? (
                        <Muted>
                          {STR.impTeacherNote}: {s.latestWeakness}
                        </Muted>
                      ) : null}
                      <Pressable
                        onPress={() => navigation.navigate("NewImprovementAction", { scope: "STUDENT", sectionId: p.sectionId, studentId: p.studentId, studentName: p.name, subject: s.subject })}
                        accessibilityRole="button"
                        style={{ alignSelf: "flex-start", minHeight: 36, justifyContent: "center" }}
                      >
                        <Text style={{ color: c.info, fontWeight: "600" }}>{STR.impNewStudentAction}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </Card>

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{STR.impActionLog}</Body>
                <Button
                  title={STR.impNewStudentAction}
                  onPress={() => navigation.navigate("NewImprovementAction", { scope: "STUDENT", sectionId: p.sectionId, studentId: p.studentId, studentName: p.name })}
                />
              </View>
              {p.actions.length === 0 ? <Muted>{STR.impNoActions}</Muted> : null}
              {p.actions.map((a) => (
                <ActionCard key={a.id} a={a} onPress={() => navigation.navigate("ImprovementAction", { id: a.id })} />
              ))}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
