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
import { MiniBarChart, type BarDatum } from "../../../components/MiniBarChart";
import { STR, bnNum, ctTrendGlyph, hwSubjectLabel, isoDateLabel } from "../../../lib/labels";
import { space, useColors } from "../../../theme";
import { DataTable, SectionTitle, StatTile, TileRow, ToneText, pctText, toneForPct } from "./parts";

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

  const newestFirst = useMemo(
    () => [...(profile?.results ?? [])].sort((a, b) => new Date(b.examDate).getTime() - new Date(a.examDate).getTime()),
    [profile],
  );
  const chart: BarDatum[] = useMemo(
    () =>
      [...newestFirst]
        .reverse()
        .filter((r) => r.subject === subject && r.percent != null)
        .map((r) => ({ label: bnNum(r.testNumber), value: r.percent ?? 0, pass: r.pass })),
    [newestFirst, subject],
  );

  if (error) return <Notice message={error} tone="danger" />;
  if (fetching && !profile) return <Loader label={STR.loading} />;
  if (!profile || profile.results.length === 0) {
    return <Muted>{narrowed ? STR.spNoDataMySubjects : STR.ctNoProfile}</Muted>;
  }

  const a = profile.analytics;
  const listed = subject ? newestFirst.filter((r) => r.subject === subject) : newestFirst.slice(0, 8);

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
            { label: STR.spColTests, width: 70, align: "right" },
            { label: STR.ctAvgPercent, width: 100, align: "right" },
            { label: STR.spColLatest, width: 90, align: "right" },
            { label: STR.ctTrajectory, width: 80, align: "center" },
          ]}
          rows={profile.bySubject.map((b) => ({
            key: b.subject,
            selected: subject === b.subject,
            onPress: () => setSubject(subject === b.subject ? null : b.subject),
            cells: [
              hwSubjectLabel(b.subject),
              bnNum(b.examsTaken),
              <ToneText key="a" tone={toneForPct(b.avgPercent, 80, 50)}>{pctText(b.avgPercent)}</ToneText>,
              <ToneText key="l" tone={toneForPct(b.latestPercent, 80, 50)}>{pctText(b.latestPercent)}</ToneText>,
              <ToneText key="t" tone={trendTone(b.trend)}>{ctTrendGlyph(b.trend)}</ToneText>,
            ],
          }))}
        />
      </View>

      <Card style={{ gap: space(2) }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space(2) }}>
          <SectionTitle title={subject ? hwSubjectLabel(subject) : STR.spRecentTests} />
          {subject ? (
            <ChipRow>
              <Chip label={`✕ ${hwSubjectLabel(subject)}`} selected onPress={() => setSubject(null)} />
            </ChipRow>
          ) : null}
        </View>
        {subject && chart.length > 0 ? <MiniBarChart data={chart} /> : null}
        {listed.map((r) => (
          <TestRow key={r.testId} r={r} />
        ))}
      </Card>
    </View>
  );
}
