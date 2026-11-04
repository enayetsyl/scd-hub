/**
 * MasteryHeatmapScreen (M-3, mock I3) — one শাখা × subject: the outcomes the section has
 * evidence on × its students, each cell the student's state and recent %, the section's weak %
 * per outcome, and a banner for every outcome over the trigger line (D-#779). The extra-class
 * proposal itself arrives in M-5; here the banner only says the line was crossed.
 *
 * The table scrolls sideways inside its card; the name column stays readable on a phone by
 * being the first column of a fixed width.
 *
 * OT-3 (docs/prd-objective-tree.md §8.1): on a TREE catalogue three levels — domain (each student's
 * roll-up, the section's share weak), objective (rolled up from its sub-objectives) and the tagged
 * rows — with drill-down: tap a domain to see its objectives, an objective to see its tagged rows.
 * The trigger stays on tagged rows (D-#813); its banner names the parent objective. A flat
 * catalogue renders exactly as before. Level words from পলিসি (D-#923).
 */
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_SECTION_HEATMAP_QUERY, type MasteryHeatColumn, type MasteryHeatmap } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryActionLabel, masteryStateLabel } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill, levelFill, shortLo, stateCell } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryHeatmap">;
type Level = "DOMAIN" | "OBJECTIVE" | "TAGGED";

const NAME_W = 150;
const CELL_W = 64;

export default function MasteryHeatmapScreen({ navigation, route }: Props): React.ReactElement {
  const { sectionId, subject } = route.params;
  const colors = useColors();
  const lv = useMasteryLevelLabels();
  const [level, setLevel] = useState<Level>("DOMAIN");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [objectiveFilter, setObjectiveFilter] = useState<string | null>(null);
  const [{ data, fetching, error }, refetch] = useQuery({
    query: MASTERY_SECTION_HEATMAP_QUERY,
    variables: { sectionId, subject },
    requestPolicy: "cache-and-network",
  });
  const h = data?.masterySectionHeatmap as MasteryHeatmap | undefined;
  // Back from a child screen (entry, sheet, action) must show what changed there.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);


  if (fetching && !h) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !h) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.msNoEvidenceYet} tone={error ? "danger" : "info"} />
      </Screen>
    );
  }

  const legend = ["WEAK", "IMPROVING", "MASTERED", "REVISION_DUE", "INSUFFICIENT", "NOT_ASSESSED"];
  const triggered = h.outcomes.filter((o) => o.triggered);
  const tree = Boolean(h.isTree);
  const shown: Level = tree ? level : "TAGGED";

  // The columns at the chosen level, narrowed by the drill-down.
  let columns: MasteryHeatColumn[] = h.outcomes;
  if (shown === "DOMAIN") columns = h.domainColumns ?? [];
  else if (shown === "OBJECTIVE") columns = (h.objectiveColumns ?? []).filter((o) => !domainFilter || o.domainCode === domainFilter);
  else if (tree && objectiveFilter) {
    const obj = (h.objectiveColumns ?? []).find((o) => o.loCode === objectiveFilter);
    const keep = new Set(obj && obj.childCodes.length > 0 ? obj.childCodes : [objectiveFilter]);
    columns = h.outcomes.filter((o) => keep.has(o.loCode));
  } else if (tree && domainFilter) columns = h.outcomes.filter((o) => o.domainCode === domainFilter);
  const filtered = tree && (domainFilter !== null || objectiveFilter !== null);

  const pick = (l: Level) => {
    setLevel(l);
    setDomainFilter(null);
    setObjectiveFilter(null);
  };
  const drill = (c: MasteryHeatColumn) => {
    if (c.level === "DOMAIN") {
      setLevel("OBJECTIVE");
      setDomainFilter(c.domainCode ?? c.loCode);
      setObjectiveFilter(null);
    } else if (c.level === "OBJECTIVE") {
      setLevel("TAGGED");
      setObjectiveFilter(c.loCode);
    }
  };
  const studentsWeak = (si: number) => columns.filter((c) => c.cells[si]?.state === "WEAK").length;

  return (
    <Screen scroll wide>
      <H2>
        {h.className} · {h.sectionName} · {hwSubjectLabel(h.subject)}
      </H2>
      <Muted>
        {bnNum(h.students.length)} · {levelFill(STR.msOutcomesCount, lv, { n: bnNum(h.outcomes.length) })}
        {h.notYetAssessed > 0 ? ` · ${levelFill(STR.msNotYetAssessed, lv, { n: bnNum(h.notYetAssessed) })}` : ""}
      </Muted>

      {triggered.map((o) => (
        <View
          key={o.loCode}
          style={{ backgroundColor: colors.errorContainer, borderRadius: 12, padding: space(3), gap: space(1) }}
        >
          {o.parentLabelBn ? (
            <Body style={{ color: colors.onErrorContainer }}>
              {lv.objective}: {o.parentLabelBn}
            </Body>
          ) : null}
          <Body style={{ color: colors.onErrorContainer, fontWeight: "700" }}>
            {fill(STR.msTriggerBanner, {
              pct: bnNum(o.weakPct ?? 0),
              weak: bnNum(o.weak),
              of: bnNum(o.verdicts),
              lo: o.labelBn,
              line: bnNum(h.triggerPct),
            })}
          </Body>
          <Body style={{ color: colors.onErrorContainer }}>{fill(STR.msTriggerAfter, { n: bnNum(o.assessments) })}</Body>
          {o.parentLabelBn ? <Body style={{ color: colors.onErrorContainer }}>{levelFill(STR.msPlanAtObjective, lv)}</Body> : null}
          {o.actionId ? (
            <View style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Badge text={masteryActionLabel(o.actionStatus ?? "")} tone="gold" />
              <Button title={STR.msSeeAction} variant="secondary" onPress={() => navigation.navigate("MasteryAction", { actionId: o.actionId! })} />
            </View>
          ) : null}
        </View>
      ))}

      {h.outcomes.length === 0 ? (
        <EmptyState message={STR.msNoEvidenceYet} />
      ) : (
        <>
          {tree ? (
            <ChipRow>
              <Chip label={lv.domain} selected={shown === "DOMAIN"} onPress={() => pick("DOMAIN")} />
              <Chip label={lv.objective} selected={shown === "OBJECTIVE" && !filtered} onPress={() => pick("OBJECTIVE")} />
              <Chip label={lv.sub} selected={shown === "TAGGED" && !filtered} onPress={() => pick("TAGGED")} />
              {filtered ? <Chip label={STR.msShowAll} selected={false} onPress={() => pick(shown)} /> : null}
            </ChipRow>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
            {legend.map((s) => {
              const c = stateCell(colors, s);
              return (
                <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: space(1) }}>
                  <View
                    style={{
                      width: 18, height: 14, borderRadius: 4, backgroundColor: c.bg,
                      borderWidth: c.outline ? 1 : 0, borderColor: colors.border, borderStyle: "dashed",
                    }}
                  />
                  <Muted>{masteryStateLabel(s)}</Muted>
                </View>
              );
            })}
          </View>
          <Muted>{shown === "TAGGED" ? levelFill(STR.msTapStudent, lv) : `${levelFill(STR.msRollupNote, lv)} ${STR.msTapToOpen}`}</Muted>

          <Card>
            <ScrollView horizontal>
              <View style={{ gap: 3 }}>
                {/* Header: codes + labels (tap a roll-up column to drill down) */}
                <View style={{ flexDirection: "row", gap: 3 }}>
                  <View style={{ width: NAME_W }} />
                  {columns.map((o) => (
                    <Pressable
                      key={o.loCode}
                      accessibilityRole={o.level === "TAGGED" ? undefined : "button"}
                      disabled={o.level === "TAGGED"}
                      onPress={() => drill(o)}
                      style={{ width: CELL_W, gap: 2 }}
                    >
                      {o.level !== "DOMAIN" ? <Body style={{ fontWeight: "700", fontSize: 12 }}>{bnNum(shortLo(o.loCode))}</Body> : null}
                      <Body
                        numberOfLines={3}
                        style={{ fontSize: 11, lineHeight: 14, color: o.level === "TAGGED" ? colors.textSecondary : colors.primary }}
                      >
                        {o.labelBn}
                      </Body>
                    </Pressable>
                  ))}
                </View>
                {/* Section weak % */}
                <View style={{ flexDirection: "row", gap: 3, alignItems: "center" }}>
                  <Muted style={{ width: NAME_W }}>{STR.msSectionWeakPct}</Muted>
                  {columns.map((o) => {
                    const hot = o.triggered;
                    return (
                      <View
                        key={o.loCode}
                        style={{
                          width: CELL_W, paddingVertical: space(1), borderRadius: 6, alignItems: "center",
                          backgroundColor: hot ? colors.error : colors.surfaceAlt,
                        }}
                      >
                        <Body style={{ fontWeight: "700", fontSize: 13, color: hot ? "#FFFFFF" : colors.textPrimary }}>
                          {o.weakPct === null ? "—" : `${bnNum(o.weakPct)}%`}
                        </Body>
                      </View>
                    );
                  })}
                </View>
                {/* One row per student */}
                {h.students.map((s, si) => (
                  <View key={s.studentId} style={{ flexDirection: "row", gap: 3, alignItems: "center" }}>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => navigation.navigate("MasteryStudent", { studentId: s.studentId, subject: h.subject })}
                      style={{ width: NAME_W, minHeight: 34, justifyContent: "center" }}
                    >
                      <Body numberOfLines={1} style={{ color: colors.primary }}>
                        {s.rollNumber ? `${bnNum(s.rollNumber)}. ` : ""}
                        {s.name}
                        {tree && shown !== "TAGGED" && studentsWeak(si) > 0 ? ` (${bnNum(studentsWeak(si))})` : ""}
                      </Body>
                    </Pressable>
                    {columns.map((o) => {
                      const cell = o.cells[si];
                      const c = stateCell(colors, cell.state);
                      return (
                        <Pressable
                          key={o.loCode}
                          accessibilityRole="button"
                          accessibilityLabel={`${s.name} · ${o.labelBn} · ${masteryStateLabel(cell.state)}`}
                          disabled={cell.state === "NOT_ASSESSED"}
                          onPress={() =>
                            o.level === "TAGGED"
                              ? navigation.navigate("MasteryOutcomeTrail", { studentId: s.studentId, loCode: o.loCode })
                              : navigation.navigate("MasteryStudent", { studentId: s.studentId, subject: h.subject })
                          }
                          style={{
                            width: CELL_W, height: 34, borderRadius: 6, alignItems: "center", justifyContent: "center",
                            backgroundColor: c.bg, borderWidth: c.outline ? 1 : 0, borderColor: colors.border, borderStyle: "dashed",
                          }}
                        >
                          {o.level === "TAGGED" ? (
                            <Body style={{ color: c.fg, fontWeight: "700", fontSize: 12 }}>
                              {cell.pct === null ? "—" : `${bnNum(cell.pct)}%`}
                            </Body>
                          ) : (
                            // A roll-up cell carries the state word (no recent % at this level).
                            <Body numberOfLines={2} style={{ color: c.fg, fontWeight: "600", fontSize: 10, lineHeight: 12, textAlign: "center" }}>
                              {cell.state === "NOT_ASSESSED" ? "—" : masteryStateLabel(cell.state)}
                            </Body>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>
        </>
      )}
    </Screen>
  );
}
