/**
 * Class test tab — headline numbers (average, latest rank, trend, risk), recurring
 * weaknesses, one row per subject, and a tap-to-deep-dive: the chosen subject's
 * test-by-test chart and each test with the teacher's weakness / action notes.
 * With no subject chosen, the most recent tests across subjects are listed.
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { ProfileClassTestT } from "../../../graphql/studentProfile";
import { Badge, Body, Card, Chip, ChipRow, Loader, Muted, Notice } from "../../../components/ui";
import { AxisBarChart, type AxisBarDatum } from "../../../components/AxisBarChart";
import { STR, bnNum, ctTrendGlyph, hwSubjectLabel, isoDateLabel } from "../../../lib/labels";
import { space, useColors } from "../../../theme";
import { DataTable, SectionTitle, StatTile, TileRow, ToneText, pctText, toneForPct, withN } from "./parts";

type Result = ProfileClassTestT["results"][number];

const trendTone = (t: string) => (t === "up" ? "ok" : t === "down" ? "danger" : "muted");

function TestRow({ r }: { r: Result }): React.ReactElement {
  const colors = useColors();
  const absent = r.percent == null;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: space(2), gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: "600" }}>
          {hwSubjectLabel(r.subject)} · {STR.ctTestNumber} {bnNum(r.testNumber)} · <Muted>{isoDateLabel(r.examDate)}</Muted>
        </Body>
        {absent ? (
          <Badge text={STR.spCtAbsent} tone="muted" />
        ) : (
          <Badge
            text={`${bnNum(r.marks ?? 0)}/${bnNum(r.totalMarks)} · ${pctText(r.percent)}`}
            tone={r.pass === false ? "danger" : toneForPct(r.percent, 80, 50) === "ok" ? "ok" : "warn"}
          />
        )}
      </View>
      {r.weakness ? (
        <Muted>
          {STR.ctWeakness}: {r.weakness}
        </Muted>
      ) : null}
      {r.teacherAction ? (
        <Muted>
          {STR.ctTeacherAction}: {r.teacherAction}
        </Muted>
      ) : null}
      {r.guardianAction ? (
        <Muted>
          {STR.ctGuardianAction}: {r.guardianAction}
        </Muted>
      ) : null}
    </View>
  );
}

export function ClassTestTab({
  profile,
  fetching,
  error,
  narrowed,
}: {
  profile: ProfileClassTestT | null;
  fetching: boolean;
  error: string | null;
  narrowed: boolean;
}): React.ReactElement {
  const [subject, setSubject] = useState<string | null>(null);
  const [missedOnly, setMissedOnly] = useState(false);

  // Tests the student did not sit: result rows marked ABSENT (percent null). A test
  // with no result row yet is the teacher's pending entry, not a missed test.
  const missedBySubject = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of profile?.results ?? []) if (r.status === "ABSENT") m.set(r.subject, (m.get(r.subject) ?? 0) + 1);
    return m;
  }, [profile]);
  const missedTotal = [...missedBySubject.values()].reduce((n, v) => n + v, 0);

  const newestFirst = useMemo(
    () => [...(profile?.results ?? [])].sort((a, b) => new Date(b.examDate).getTime() - new Date(a.examDate).getTime()),
    [profile],
  );
  const chart: AxisBarDatum[] = useMemo(
    () =>
      [...newestFirst]
        .reverse()
        .filter((r) => r.subject === subject && r.percent != null)
        .map((r) => ({ label: `#${bnNum(r.testNumber)}`, value: r.percent ?? 0, pass: r.pass })),
    [newestFirst, subject],
  );

  if (error) return <Notice message={error} tone="danger" />;
  if (fetching && !profile) return <Loader label={STR.loading} />;
  if (!profile || profile.results.length === 0) {
    return <Muted>{narrowed ? STR.spNoDataMySubjects : STR.ctNoProfile}</Muted>;
  }

  const a = profile.analytics;
  const listed = newestFirst.filter(
    (r) => (!subject || r.subject === subject) && (!missedOnly || r.status === "ABSENT"),
  );
  const shown = subject || missedOnly ? listed : listed.slice(0, 8);
  // bySubject is built from scores, so a subject whose every test was missed has no
  // row there — add it, or its misses would be invisible in the table.
  const subjectRows = [
    ...profile.bySubject,
    ...[...missedBySubject.keys()]
      .filter((s) => !profile.bySubject.some((b) => b.subject === s))
      .map((s) => ({
        subject: s, examsTaken: 0, avgPercent: null, latestPercent: null, previousPercent: null, trend: "flat",
        classAvgPercent: null, classHighestPercent: null,
      })),
  ];
  const listTitle = [subject ? hwSubjectLabel(subject) : null, missedOnly ? STR.spCtNotAttendedList : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={{ gap: space(3) }}>
      {narrowed ? <Muted>{STR.spMySubjectsNote}</Muted> : null}
      <TileRow>
        <StatTile
          label={STR.ctAvgPercent}
          value={pctText(a.avgPercent)}
          sub={`${STR.ctExamsTaken} ${bnNum(a.examsPresent)}`}
          tone={toneForPct(a.avgPercent, 80, 50)}
        />
        {/* The class alongside the student: the mean and the best of every classmate's
            own average over the same tests. */}
        <StatTile
          label={STR.spClassAvg}
          value={pctText(a.classAvgPercent)}
          sub={`${STR.spClassHighest} ${pctText(a.classHighestPercent)}`}
        />
        <StatTile
          label={STR.spCtNotAttended}
          value={bnNum(missedTotal)}
          sub={withN(STR.spCtNotAttendedSub, a.examsPresent + missedTotal)}
          tone={missedTotal === 0 ? "ok" : missedTotal >= 3 ? "danger" : "warn"}
          onPress={missedTotal > 0 ? () => setMissedOnly((v) => !v) : undefined}
        />
        <StatTile
          label={STR.spLatestRank}
          value={a.latestRank != null ? `${bnNum(a.latestRank)}/${bnNum(a.latestRankOf ?? 0)}` : "—"}
        />
        <StatTile
          label={STR.ctTrajectory}
          value={ctTrendGlyph(a.trajectory)}
          sub={a.weakestSubject ? `${STR.spWeakest}: ${hwSubjectLabel(a.weakestSubject)}` : undefined}
          tone={trendTone(a.trajectory)}
        />
        <StatTile
          label={STR.ctAtRisk}
          value={a.atRisk ? "⚠" : "✓"}
          sub={a.atRisk ? STR.ctAtRisk : STR.spAtRiskNo}
          tone={a.atRisk ? "danger" : "ok"}
        />
      </TileRow>

      {a.recurringWeaknesses.length > 0 ? (
        <View style={{ gap: space(1) }}>
          <Muted style={{ fontWeight: "700" }}>{STR.ctRecurringWeakness}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            {a.recurringWeaknesses.map((w) => (
              <Badge key={w.tag} text={`${w.tag} ×${bnNum(w.count)}`} tone="warn" />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: space(2) }}>
        <SectionTitle title={STR.spBySubject} hint={STR.spTapSubjectCtHint} />
        <DataTable
          columns={[
            { label: STR.spColSubject, width: 150 },
            { label: STR.spColTaken, width: 70, align: "right" },
            { label: STR.spColMissed, width: 70, align: "right" },
            { label: STR.ctAvgPercent, width: 100, align: "right" },
            { label: STR.spClassAvg, width: 100, align: "right" },
            { label: STR.spClassHighest, width: 100, align: "right" },
            { label: STR.spColLatest, width: 90, align: "right" },
            { label: STR.ctTrajectory, width: 80, align: "center" },
          ]}
          rows={subjectRows.map((b) => ({
            key: b.subject,
            selected: subject === b.subject,
            onPress: () => setSubject(subject === b.subject ? null : b.subject),
            cells: [
              hwSubjectLabel(b.subject),
              bnNum(b.examsTaken),
              <ToneText key="m" tone={(missedBySubject.get(b.subject) ?? 0) > 0 ? "danger" : "muted"}>
                {bnNum(missedBySubject.get(b.subject) ?? 0)}
              </ToneText>,
              <ToneText key="a" tone={toneForPct(b.avgPercent, 80, 50)}>{pctText(b.avgPercent)}</ToneText>,
              pctText(b.classAvgPercent),
              pctText(b.classHighestPercent),
              <ToneText key="l" tone={toneForPct(b.latestPercent, 80, 50)}>{pctText(b.latestPercent)}</ToneText>,
              <ToneText key="t" tone={trendTone(b.trend)}>{ctTrendGlyph(b.trend)}</ToneText>,
            ],
          }))}
        />
      </View>

      <Card style={{ gap: space(2) }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space(2) }}>
          <SectionTitle title={listTitle || STR.spRecentTests} />
          {subject || missedOnly ? (
            <ChipRow>
              {subject ? <Chip label={`✕ ${hwSubjectLabel(subject)}`} selected onPress={() => setSubject(null)} /> : null}
              {missedOnly ? <Chip label={`✕ ${STR.spCtNotAttended}`} selected onPress={() => setMissedOnly(false)} /> : null}
            </ChipRow>
          ) : null}
        </View>
        {subject && !missedOnly && chart.length > 0 ? (
          <AxisBarChart
            data={chart}
            accessibilityLabel={hwSubjectLabel(subject)}
            reference={(() => {
              const row = subjectRows.find((b) => b.subject === subject);
              return row?.classAvgPercent != null ? { value: row.classAvgPercent, label: STR.spClassAvg } : null;
            })()}
          />
        ) : null}
        {shown.length === 0 ? <Muted>{STR.spNoItemsFilter}</Muted> : null}
        {shown.map((r) => (
          <TestRow key={r.testId} r={r} />
        ))}
      </Card>
    </View>
  );
}
