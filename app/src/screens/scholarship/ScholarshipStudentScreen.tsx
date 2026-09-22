/**
 * ScholarshipStudentScreen (SC-3) — one student's weakness profile.
 *
 * The payoff screen. Weakest topic first, with the class mean beside it so an absolute
 * band and a relative gap can disagree visibly (D-#663) — a student below the bar on a
 * topic the whole class is below is a teaching problem, not hers.
 *
 * A row under the floor renders GREY with no percentage at all (D-#662), and never red:
 * "not enough data" must not be mistakable for "failing". Since D-#691 a topic set on two
 * separate papers clears that floor whatever its marks add up to, which is what lets a
 * 5-mark item failed twice finally say so.
 *
 * SC-7 adds the two halves PRD §6.4 contracted and SC-3 shipped without: a per-topic
 * trend across the sittings, and the paper-by-paper list — plus her place among the
 * students who actually sat each thing.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SCHOLARSHIP_STUDENT_QUERY } from "../../graphql/scholarship";
import {
  Screen,
  Card,
  Body,
  Muted,
  Badge,
  Chip,
  ChipRow,
  Loader,
  EmptyState,
  Notice,
} from "../../components/ui";
import { MiniLineChart } from "../../components/MiniCharts";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { radius, space, useColors } from "../../theme";
import type { ScholarshipStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ScholarshipStackParamList, "ScholarshipStudent">;

const SUBJECTS = ["ENG", "BAN", "MATH", "SCI", "BGS"] as const;

interface Row {
  key: string;
  label: string;
  earned: number;
  available: number;
  percent: number | null;
  band: string;
  classPercent: number | null;
  classGap: number | null;
  behindClass: boolean;
  series: { paperId: string; label: string; percent: number }[];
  classRank: RankView | null;
}

interface RankView {
  rank: number;
  of: number;
}

interface PaperResult {
  paperId: string;
  label: string;
  date: string | null;
  earned: number;
  available: number;
  percent: number | null;
  rank: RankView | null;
}

/** "অবস্থান ৩/৬" — the place is never printed without what it is out of, because 1st of
 *  2 and 1st of 8 are not the same news and only the denominator says which one it is. */
export function rankText(r: { rank: number; of: number }): string {
  return `${STR.scRankLabel} ${bnNum(r.rank)}/${bnNum(r.of)}`;
}

export function bandLabel(band: string): string {
  if (band === "weak") return STR.scBandWeak;
  if (band === "fair") return STR.scBandFair;
  if (band === "good") return STR.scBandGood;
  return STR.scBandNone;
}

export default function ScholarshipStudentScreen({ route }: Props): React.ReactElement {
  const { sectionId, classLevel, studentId, name } = route.params;
  const colors = useColors();
  const [subject, setSubject] = useState<string | null>(null);
  const [axis, setAxis] = useState<"topic" | "chapter">("topic");

  const [{ data, fetching, error }] = useQuery({
    query: SCHOLARSHIP_STUDENT_QUERY,
    variables: { sectionId, classLevel, studentId, subject },
  });

  const a = data?.scholarshipStudent as
    | {
        papersSat: number;
        totalEarned: number;
        totalAvailable: number;
        overallPercent: number | null;
        topics: Row[];
        chapters: Row[];
        papers: PaperResult[];
      }
    | undefined;

  // Meaning is never carried by colour alone — every row also prints its band word.
  function barColor(band: string): string {
    if (band === "weak") return colors.error;
    if (band === "fair") return colors.warning;
    if (band === "good") return colors.primary;
    return colors.border;
  }
  function badgeTone(band: string): "danger" | "warn" | "ok" | "muted" {
    if (band === "weak") return "danger";
    if (band === "fair") return "warn";
    if (band === "good") return "ok";
    return "muted";
  }

  const rows = (axis === "topic" ? a?.topics : a?.chapters) ?? [];

  return (
    <Screen scroll>
      <Card>
        <Body style={{ fontWeight: "700" }}>{name ?? STR.scPickStudent}</Body>
        {a ? (
          <Muted>
            {bnNum(a.papersSat)} {STR.scPapersSat}
            {a.overallPercent !== null ? ` · ${STR.scTotal} ${bnNum(a.overallPercent)}%` : ""}
          </Muted>
        ) : null}
      </Card>

      {/* Paper by paper, oldest first (SC-7). Above the topic rows on purpose: "how did
          she do, and where did that put her" is the question a teacher opens this
          screen with, and the topic breakdown is the answer to the next one. */}
      {a && a.papers.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.scPaperWise}</Body>
          {a.papers.map((p) => (
            <View
              key={p.paperId}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: space(3),
                marginTop: space(2),
              }}
            >
              <View style={{ flexShrink: 1 }}>
                <Body>{p.label}</Body>
                <Muted>
                  {bnNum(p.earned)} / {bnNum(p.available)} {STR.scItemMarks}
                  {p.date ? ` · ${p.date}` : ""}
                </Muted>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Body style={{ fontWeight: "700" }}>
                  {p.percent === null ? "—" : `${bnNum(p.percent)}%`}
                </Body>
                {p.rank ? <Muted>{rankText(p.rank)}</Muted> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <ChipRow>
        {SUBJECTS.map((s) => (
          <Chip
            key={s}
            label={hwSubjectLabel(s)}
            selected={subject === s}
            onPress={() => setSubject(subject === s ? null : s)}
          />
        ))}
      </ChipRow>

      <ChipRow>
        <Chip label={STR.scAxisTopic} selected={axis === "topic"} onPress={() => setAxis("topic")} />
        <Chip label={STR.scAxisChapter} selected={axis === "chapter"} onPress={() => setAxis("chapter")} />
      </ChipRow>

      {error ? <Notice message={friendlyError(error)} tone="danger" /> : null}
      {fetching ? <Loader /> : null}
      {!fetching && rows.length === 0 ? <EmptyState message={STR.scNoAnalysis} /> : null}

      {rows.map((r) => (
        <View key={r.key} style={{ marginBottom: space(4) }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
            <Body style={{ flexShrink: 1, fontWeight: "700" }}>
              {axis === "chapter" ? `${STR.scChapterShort} ${bnNum(r.key)}` : r.label}
            </Body>
            <Body style={{ fontWeight: "700" }}>{r.percent === null ? "—" : `${bnNum(r.percent)}%`}</Body>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceAlt,
              overflow: "hidden",
              marginVertical: space(1),
            }}
          >
            <View
              style={{
                width: `${Math.max(0, Math.min(100, r.percent ?? 0))}%`,
                height: 6,
                backgroundColor: barColor(r.band),
              }}
            />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
            <Badge text={bandLabel(r.band)} tone={badgeTone(r.band)} />
            <Muted>
              {bnNum(r.earned)} / {bnNum(r.available)} {STR.scItemMarks}
              {r.classPercent !== null ? ` · ${STR.scClassAvg} ${bnNum(r.classPercent)}%` : ""}
              {r.classGap !== null ? ` (${r.classGap > 0 ? "+" : ""}${bnNum(r.classGap)})` : ""}
            </Muted>
            {r.behindClass ? <Badge text={STR.scBehindClass} tone="warn" /> : null}
            {r.classRank ? <Badge text={rankText(r.classRank)} tone="muted" /> : null}
          </View>

          {/* The trend only appears from the SECOND sitting: a single dot is not a
              direction, and drawing one would suggest a movement nobody measured. */}
          {r.series.length > 1 ? (
            <View style={{ marginTop: space(2) }}>
              <Muted>
                {STR.scTrend} · {r.series.map((p) => `${bnNum(p.percent)}%`).join(" → ")}
              </Muted>
              <MiniLineChart
                height={44}
                points={r.series.map((p) => ({ label: p.label, value: p.percent }))}
                accessibilityLabel={`${r.label}: ${r.series
                  .map((p) => `${p.label} ${p.percent}%`)
                  .join(", ")}`}
              />
            </View>
          ) : null}
        </View>
      ))}

      {rows.length > 0 ? <Notice message={STR.scFloorHint} tone="info" /> : null}
    </Screen>
  );
}
