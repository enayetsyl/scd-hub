/**
 * ClassTestStudentProfileScreen (CT-5 / J6) — one student across subjects: a
 * per-subject roll-up (avg / latest / trend) + the full per-exam result list (newest
 * first). Staff read (tracker:read; teacher scoped to the student's section
 * server-side). %/pass-fail are derived server-side (D-#85).
 */
import React, { useMemo } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { CLASS_TEST_STUDENT_PROFILE_QUERY } from "../../graphql/classTest";
import { STUDENT_WHOLE_PICTURE_QUERY } from "../../graphql/wholePicture";
import { WholePictureCard } from "../../components/WholePictureCard";
import { Screen, Card, Body, Muted, Badge, Loader, Notice } from "../../components/ui";
import { MiniBarChart, type BarDatum } from "../../components/MiniBarChart";
import { STR, hwSubjectLabel, ctTrendGlyph, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ClassTestStudentProfile">;

export default function ClassTestStudentProfileScreen({ route }: Props): React.ReactElement {
  const { studentId, studentName } = route.params;
  const [q] = useQuery({ query: CLASS_TEST_STUDENT_PROFILE_QUERY, variables: { studentId } });
  // The cross-tracker view (D-#277 follow-up) — class-test marks alone spot a problem a
  // term late; homework/assignment behaviour moves first.
  const [wpQ] = useQuery({ query: STUDENT_WHOLE_PICTURE_QUERY, variables: { studentId } });
  const wp = wpQ.data?.studentWholePicture ?? null;
  const p = q.data?.classTestStudentProfile ?? null;

  // CT-9: per-subject % trajectory (oldest → newest) for the bar chart.
  const seriesBySubject = useMemo(() => {
    const m = new Map<string, BarDatum[]>();
    const oldestFirst = [...(p?.results ?? [])].sort(
      (a, b) => new Date(a.examDate).getTime() - new Date(b.examDate).getTime(),
    );
    for (const r of oldestFirst) {
      const arr = m.get(r.subject) ?? [];
      arr.push({ label: bnNum(r.testNumber), value: r.percent, pass: r.pass });
      m.set(r.subject, arr);
    }
    return m;
  }, [p]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{p?.studentName || studentName}</Body>
        </Card>

        {/* Cross-tracker roll-up sits ABOVE the class-test detail: it is the answer to
            "how is this child doing", of which marks are only one quarter. */}
        {wp ? <WholePictureCard wp={wp} /> : null}

        {q.error ? (
          <Notice message={friendlyError(q.error)} tone="danger" />
        ) : q.fetching ? (
          <Loader label={STR.loading} />
        ) : !p || p.results.length === 0 ? (
          <Card>
            <Muted>{STR.ctNoProfile}</Muted>
          </Card>
        ) : (
          <>
            {/* CT-10 analytics — derived, staff-facing. */}
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700" }}>{STR.ctAnalytics}</Body>
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <Badge
                    text={`${ctTrendGlyph(p.analytics.trajectory)} ${STR.ctTrajectory}`}
                    tone={p.analytics.trajectory === "up" ? "ok" : p.analytics.trajectory === "down" ? "danger" : "muted"}
                  />
                  {p.analytics.atRisk ? <Badge text={STR.ctAtRisk} tone="danger" /> : null}
                </View>
              </View>
              <View style={{ marginTop: space(2), gap: 2 }}>
                <Muted>{STR.ctAvgPercent}: {p.analytics.avgPercent == null ? "—" : `${bnNum(p.analytics.avgPercent)}%`} · {STR.ctExamsTaken} {bnNum(p.analytics.examsPresent)}</Muted>
                {p.analytics.consistency != null ? <Muted>{STR.ctConsistency}: {bnNum(p.analytics.consistency)}%</Muted> : null}
                {p.analytics.streakKind ? <Muted>{STR.ctStreak}: {bnNum(p.analytics.streakLength)} {p.analytics.streakKind === "pass" ? STR.ctPass : STR.ctFail}</Muted> : null}
                {p.analytics.latestRank != null ? <Muted>{STR.ctRank}: {bnNum(p.analytics.latestRank)}/{bnNum(p.analytics.latestRankOf ?? 0)}</Muted> : null}
                {p.analytics.bestSubject ? <Muted>{STR.ctStrongest}: {hwSubjectLabel(p.analytics.bestSubject)}</Muted> : null}
                {p.analytics.weakestSubject ? <Muted>{STR.ctWeakest}: {hwSubjectLabel(p.analytics.weakestSubject)}</Muted> : null}
                {p.analytics.recurringWeaknesses.length > 0 ? (
                  <Muted>
                    {STR.ctRecurringWeakness}: {p.analytics.recurringWeaknesses.map((w) => `${w.tag} ×${bnNum(w.count)}`).join(", ")}
                  </Muted>
                ) : null}
              </View>
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.ctBySubject}</Body>
              {p.bySubject.map((b) => (
                <View key={b.subject} style={{ marginTop: space(3) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flexShrink: 1 }}>
                      <Body>{hwSubjectLabel(b.subject)}</Body>
                      <Muted>
                        {STR.ctAvgPercent} {b.avgPercent == null ? "—" : `${bnNum(b.avgPercent)}%`} · {STR.ctExamsTaken}{" "}
                        {bnNum(b.examsTaken)}
                      </Muted>
                    </View>
                    <Badge
                      text={`${ctTrendGlyph(b.trend)} ${b.latestPercent == null ? "" : bnNum(b.latestPercent) + "%"}`}
                      tone={b.trend === "up" ? "ok" : b.trend === "down" ? "danger" : "muted"}
                    />
                  </View>
                  {/* CT-9: % trajectory across this subject's tests (bar height = %, color = pass/fail). */}
                  <View style={{ marginTop: space(2) }}>
                    <MiniBarChart data={seriesBySubject.get(b.subject) ?? []} />
                  </View>
                </View>
              ))}
            </Card>

            {p.results.map((r) => (
              <Card key={r.testId}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexShrink: 1 }}>
                    <Body style={{ fontWeight: "700" }}>
                      {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)}
                    </Body>
                    <Muted>
                      {r.ctId} · {new Date(r.examDate).toLocaleDateString()}
                    </Muted>
                  </View>
                  {r.status === "ABSENT" ? (
                    <Badge text={STR.ctAbsent} tone="muted" />
                  ) : (
                    <Badge
                      text={`${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)} · ${r.percent == null ? "" : bnNum(r.percent) + "%"}`}
                      tone={r.pass ? "ok" : "danger"}
                    />
                  )}
                </View>
                {/* CT-7: the teacher's per-test comment history, read in one place. */}
                {r.weakness || r.teacherAction || r.guardianAction ? (
                  <View style={{ marginTop: space(2), gap: 2 }}>
                    {r.weakness ? <Muted>{STR.ctWeakness}: {r.weakness}</Muted> : null}
                    {r.teacherAction ? <Muted>{STR.ctTeacherAction}: {r.teacherAction}</Muted> : null}
                    {r.guardianAction ? <Muted>{STR.ctGuardianAction}: {r.guardianAction}</Muted> : null}
                  </View>
                ) : null}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
