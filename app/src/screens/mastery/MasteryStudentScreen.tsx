/**
 * MasteryStudentScreen (M-3, mock I1) — one student × subject: a summary bar of states, the
 * outcomes that need attention with WHY (recent %, re-work, section mean, reasons), and a
 * chapter grid where every cell is one outcome. Tapping an outcome opens its evidence trail.
 * Subject chips list only the subjects the caller may open (server-filtered).
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_STUDENT_DIAGNOSIS_QUERY, type MasteryOutcomeStateRow, type MasteryStudentDiagnosisData } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Chip, ChipRow, Loader, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryReasonLabel, masteryStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { STATE_ORDER, fill, stateCell, stateTone } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryStudent">;

const ATTENTION = new Set(["WEAK", "IMPROVING", "REVISION_DUE"]);

function whyLine(o: MasteryOutcomeStateRow): string {
  const parts: string[] = [];
  if (o.recentPct !== null) parts.push(`${STR.msRecent} ${bnNum(o.recentPct)}%`);
  if (o.reworkCount > 0) parts.push(`${STR.msReworkCount} ${bnNum(o.reworkCount)}`);
  if (o.sectionMeanPct !== null) parts.push(`${STR.msSectionMean} ${bnNum(o.sectionMeanPct)}%`);
  for (const r of o.reasons) if (r !== "REWORK") parts.push(masteryReasonLabel(r));
  return parts.join(" · ");
}

export default function MasteryStudentScreen({ navigation, route }: Props): React.ReactElement {
  const { studentId } = route.params;
  const [subject, setSubject] = useState(route.params.subject);
  const colors = useColors();
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_STUDENT_DIAGNOSIS_QUERY,
    variables: { studentId, subject },
    requestPolicy: "cache-and-network",
  });
  const d = data?.masteryStudentDiagnosis as MasteryStudentDiagnosisData | undefined;

  if (fetching && !d) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !d) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.msNoEvidenceYet} tone={error ? "danger" : "info"} />
      </Screen>
    );
  }

  const counts = new Map<string, number>();
  for (const o of d.outcomes) counts.set(o.state, (counts.get(o.state) ?? 0) + 1);
  const attention = d.outcomes
    .filter((o) => ATTENTION.has(o.state))
    .sort((a, b) => STATE_ORDER.indexOf(a.state as never) - STATE_ORDER.indexOf(b.state as never));
  const chapters = new Map<number, MasteryOutcomeStateRow[]>();
  const strands: MasteryOutcomeStateRow[] = [];
  for (const o of d.outcomes) {
    if (o.strand || o.chapterNumber === null) strands.push(o);
    else chapters.set(o.chapterNumber, [...(chapters.get(o.chapterNumber) ?? []), o]);
  }
  const openTrail = (loCode: string) => navigation.navigate("MasteryOutcomeTrail", { studentId, loCode });

  const cellRow = (list: MasteryOutcomeStateRow[]) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, flex: 1 }}>
      {list.map((o) => {
        const c = stateCell(colors, o.state);
        return (
          <Pressable
            key={o.loCode}
            accessibilityRole="button"
            accessibilityLabel={`${o.labelBn} · ${masteryStateLabel(o.state)}`}
            disabled={o.state === "NOT_ASSESSED"}
            onPress={() => openTrail(o.loCode)}
            style={{
              width: 24, height: 24, borderRadius: 5, backgroundColor: c.bg,
              borderWidth: c.outline ? 1 : 0, borderColor: colors.border, borderStyle: "dashed",
            }}
          />
        );
      })}
    </View>
  );

  return (
    <Screen scroll>
      <H2>{d.name}</H2>
      <Muted>
        {d.className} · {d.sectionName}
        {d.rollNumber ? ` · ${bnNum(d.rollNumber)}` : ""}
      </Muted>

      {d.subjects.length > 1 ? (
        <ChipRow>
          {d.subjects.map((s) => (
            <Chip key={s} label={hwSubjectLabel(s)} selected={s === subject} onPress={() => setSubject(s)} />
          ))}
        </ChipRow>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{fill(STR.msOutcomesCount, { n: bnNum(d.outcomes.length) })}</Body>
        <View
          accessibilityRole="image"
          accessibilityLabel={STATE_ORDER.map((s) => `${masteryStateLabel(s)} ${bnNum(counts.get(s) ?? 0)}`).join(", ")}
          style={{ flexDirection: "row", height: 14, borderRadius: 999, overflow: "hidden", backgroundColor: colors.surfaceAlt }}
        >
          {STATE_ORDER.map((s) =>
            counts.get(s) ? <View key={s} style={{ flex: counts.get(s), backgroundColor: stateCell(colors, s).bg }} /> : null,
          )}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          {STATE_ORDER.map((s) => (
            <Badge key={s} text={`${masteryStateLabel(s)} ${bnNum(counts.get(s) ?? 0)}`} tone={stateTone(s)} />
          ))}
        </View>
        <Muted>{fill(STR.msStanding, { n: bnNum(d.moreWeakThan), size: bnNum(d.sectionSize) })}</Muted>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msNeedsAttention}</Body>
        {attention.length === 0 ? <Muted>{STR.msNothingWeak}</Muted> : null}
        {attention.map((o) => (
          <Pressable
            key={o.loCode}
            accessibilityRole="link"
            onPress={() => openTrail(o.loCode)}
            style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderTopWidth: 1, borderTopColor: colors.surfaceAlt }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={{ fontWeight: "600" }}>{o.labelBn}</Body>
              <Muted>{whyLine(o)}</Muted>
            </View>
            <Badge text={masteryStateLabel(o.state)} tone={stateTone(o.state)} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msByChapter}</Body>
        {[...chapters.entries()].map(([n, list]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Muted style={{ width: 96 }}>{fill(STR.msChapterN, { n: bnNum(n) })}</Muted>
            {cellRow(list)}
          </View>
        ))}
        {strands.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: space(2) }}>
            <Muted style={{ width: 96 }}>{STR.msStrands}</Muted>
            {cellRow(strands)}
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
