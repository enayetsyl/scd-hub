/**
 * MasteryStudentScreen (M-3, mock I1; OT-3 mock 7) — one student × subject: a summary bar of states,
 * the outcomes that need attention with WHY (recent %, re-work, section mean, reasons), and a
 * chapter grid where every cell is one outcome. Tapping an outcome opens its evidence trail.
 * Subject chips list only the subjects the caller may open (server-filtered).
 *
 * OT-3 (docs/prd-objective-tree.md §8.1): on a TREE catalogue the summary counts objectives (each
 * rolled up from its sub-objectives), a domain card drills domain → objective → sub-objective,
 * and a WEAK row lists its earlier steps with this student's state (D-#927). A flat catalogue
 * (`isTree: false`) renders exactly as before. Level words come from পলিসি (D-#923).
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import {
  MASTERY_STUDENT_DIAGNOSIS_QUERY,
  type MasteryOutcomeStateRow,
  type MasteryRollupObjective,
  type MasteryStudentDiagnosisData,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Chip, ChipRow, Loader, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryReasonLabel, masteryStateLabel } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { STATE_ORDER, levelFill, stateCell, stateTone } from "./masteryStateUi";
import { EarlierSteps, StateDot, SummaryBar, summaryLine } from "./MasteryTreeParts";
import { ObjectiveLessonNote } from "../../components/ObjectiveLessonNote";

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
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  const [openObjective, setOpenObjective] = useState<string | null>(null);
  const colors = useColors();
  const lv = useMasteryLevelLabels();
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

  const tree = d.isTree;
  // Summary: tagged rows on a flat catalogue (as before); objectives (rolled up) on a tree.
  const counts = new Map<string, number>();
  for (const s of tree ? d.objectives.map((o) => o.state) : d.outcomes.map((o) => o.state)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const summaryN = tree ? d.objectives.length : d.outcomes.length;
  const attention = d.outcomes
    .filter((o) => ATTENTION.has(o.state))
    .sort((a, b) => STATE_ORDER.indexOf(a.state as never) - STATE_ORDER.indexOf(b.state as never));
  const chapters = new Map<number, MasteryOutcomeStateRow[]>();
  const strands: MasteryOutcomeStateRow[] = [];
  for (const o of d.outcomes) {
    if (o.strand || o.chapterNumber === null) strands.push(o);
    else chapters.set(o.chapterNumber, [...(chapters.get(o.chapterNumber) ?? []), o]);
  }
  const byCode = new Map(d.outcomes.map((o) => [o.loCode, o]));
  const objectiveLabel = new Map(d.objectives.map((o) => [o.code, o.labelBn]));
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

  /** One tagged row inside the drill: label, state, tap → trail. */
  const leafRow = (code: string, indent: number) => {
    const o = byCode.get(code);
    if (!o) return null;
    return (
      <Pressable
        key={code}
        accessibilityRole="link"
        disabled={o.state === "NOT_ASSESSED"}
        onPress={() => openTrail(code)}
        style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1), paddingLeft: indent }}
      >
        <StateDot state={o.state} />
        <Body style={{ flex: 1 }}>{o.labelBn}</Body>
        <Muted>{masteryStateLabel(o.state)}</Muted>
      </Pressable>
    );
  };

  const objectiveRow = (o: MasteryRollupObjective) => {
    if (o.tagged) return leafRow(o.code, 0);
    const open = openObjective === o.code;
    return (
      <View key={o.code}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpenObjective(open ? null : o.code)}
          style={{ flexDirection: "row", gap: space(2), paddingVertical: space(1) }}
        >
          <StateDot state={o.state} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: "600" }}>
              {open ? "▾ " : "▸ "}
              {o.labelBn}
            </Body>
            <Muted>
              {lv.sub}: {summaryLine(o.summary)}
            </Muted>
          </View>
          <Badge text={masteryStateLabel(o.state)} tone={stateTone(o.state)} />
        </Pressable>
        {open ? o.childCodes.map((c) => leafRow(c, space(5))) : null}
      </View>
    );
  };

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
        <Body style={{ fontWeight: "700" }}>{levelFill(STR.msOutcomesCount, lv, { n: bnNum(summaryN) })}</Body>
        <View
          accessibilityRole="image"
          accessibilityLabel={STATE_ORDER.map((s) => `${masteryStateLabel(s)} ${bnNum(counts.get(s) ?? 0)}`).join(", ")}
          style={{ flexDirection: "row", height: 14, borderRadius: 999, overflow: "hidden", backgroundColor: colors.surfaceAlt }}
        >
          {STATE_ORDER.map((s) =>
            counts.get(s) ? (
              <View
                key={s}
                style={{ flex: counts.get(s), backgroundColor: s === "NOT_ASSESSED" ? colors.border : stateCell(colors, s).bg }}
              />
            ) : null,
          )}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          {STATE_ORDER.map((s) => (
            <Badge key={s} text={`${masteryStateLabel(s)} ${bnNum(counts.get(s) ?? 0)}`} tone={stateTone(s)} />
          ))}
        </View>
        {tree ? <Muted>{levelFill(STR.msRollupNote, lv)}</Muted> : null}
        <Muted>{levelFill(STR.msStanding, lv, { n: bnNum(d.moreWeakThan), size: bnNum(d.sectionSize) })}</Muted>
      </Card>

      {tree ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{levelFill(STR.msByDomain, lv)}</Body>
          {d.domains.map((dm) => {
            const key = dm.code ?? "";
            const open = openDomain === key;
            return (
              <View key={key} style={{ borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: space(2), gap: space(1) }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityHint={STR.msTapToOpen}
                  onPress={() => setOpenDomain(open ? null : key)}
                  style={{ gap: space(1) }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), alignItems: "center" }}>
                    <Body style={{ fontWeight: "700", flexShrink: 1 }}>
                      {open ? "▾ " : "▸ "}
                      {dm.labelBn ?? STR.msNoDomain}
                    </Body>
                    <Badge text={masteryStateLabel(dm.state)} tone={stateTone(dm.state)} />
                  </View>
                  <SummaryBar summary={dm.summary} />
                  <Muted>{summaryLine(dm.summary)}</Muted>
                </Pressable>
                {open ? (
                  <View style={{ paddingLeft: space(2) }}>
                    {d.objectives.filter((o) => dm.objectiveCodes.includes(o.code)).map(objectiveRow)}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msNeedsAttention}</Body>
        {attention.length === 0 ? <Muted>{levelFill(STR.msNothingWeak, lv)}</Muted> : null}
        {attention.map((o) => (
          <Pressable
            key={o.loCode}
            accessibilityRole="link"
            onPress={() => openTrail(o.loCode)}
            style={{ flexDirection: "row", gap: space(2), paddingVertical: space(2), borderTopWidth: 1, borderTopColor: colors.surfaceAlt }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              {o.parentCode && objectiveLabel.get(o.parentCode) ? (
                <Muted>
                  {lv.objective}: {objectiveLabel.get(o.parentCode)}
                </Muted>
              ) : null}
              <Body style={{ fontWeight: "600" }}>{o.labelBn}</Body>
              <Muted>{whyLine(o)}</Muted>
              <EarlierSteps steps={o.earlierSteps ?? []} />
              {/* OT-5 (D-#950): a WEAK row says whether it was taught and whether the child was there. */}
              {o.state === "WEAK" ? <ObjectiveLessonNote lesson={d.objectiveLessons?.find((l) => l.loCode === o.loCode)} state={o.state} /> : null}
            </View>
            <Badge text={masteryStateLabel(o.state)} tone={stateTone(o.state)} />
          </Pressable>
        ))}
      </Card>

      <Card>
        <Body style={{ fontWeight: "700" }}>{STR.msByChapter}</Body>
        {[...chapters.entries()].map(([n, list]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Muted style={{ width: 96 }}>{levelFill(STR.msChapterN, lv, { n: bnNum(n) })}</Muted>
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
