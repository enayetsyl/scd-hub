/**
 * MasteryHeatmapScreen (M-3, mock I3) — one শাখা × subject: the outcomes the section has
 * evidence on × its students, each cell the student's state and recent %, the section's weak %
 * per outcome, and a banner for every outcome over the trigger line (D-#779). The extra-class
 * proposal itself arrives in M-5; here the banner only says the line was crossed.
 *
 * The table scrolls sideways inside its card; the name column stays readable on a phone by
 * being the first column of a fixed width.
 */
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MASTERY_SECTION_HEATMAP_QUERY, type MasteryHeatmap } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryActionLabel, masteryStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill, shortLo, stateCell } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryHeatmap">;

const NAME_W = 150;
const CELL_W = 64;

export default function MasteryHeatmapScreen({ navigation, route }: Props): React.ReactElement {
  const { sectionId, subject } = route.params;
  const colors = useColors();
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_SECTION_HEATMAP_QUERY,
    variables: { sectionId, subject },
    requestPolicy: "cache-and-network",
  });
  const h = data?.masterySectionHeatmap as MasteryHeatmap | undefined;

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

  return (
    <Screen scroll wide>
      <H2>
        {h.className} · {h.sectionName} · {hwSubjectLabel(h.subject)}
      </H2>
      <Muted>
        {bnNum(h.students.length)} · {fill(STR.msOutcomesCount, { n: bnNum(h.outcomes.length) })}
        {h.notYetAssessed > 0 ? ` · ${fill(STR.msNotYetAssessed, { n: bnNum(h.notYetAssessed) })}` : ""}
      </Muted>

      {triggered.map((o) => (
        <View
          key={o.loCode}
          style={{ backgroundColor: colors.errorContainer, borderRadius: 12, padding: space(3), gap: space(1) }}
        >
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
          <Muted>{STR.msTapStudent}</Muted>

          <Card>
            <ScrollView horizontal>
              <View style={{ gap: 3 }}>
                {/* Header: outcome codes + labels */}
                <View style={{ flexDirection: "row", gap: 3 }}>
                  <View style={{ width: NAME_W }} />
                  {h.outcomes.map((o) => (
                    <View key={o.loCode} style={{ width: CELL_W, gap: 2 }}>
                      <Body style={{ fontWeight: "700", fontSize: 12 }}>{bnNum(shortLo(o.loCode))}</Body>
                      <Body numberOfLines={3} style={{ fontSize: 11, lineHeight: 14, color: colors.textSecondary }}>
                        {o.labelBn}
                      </Body>
                    </View>
                  ))}
                </View>
                {/* Section weak % */}
                <View style={{ flexDirection: "row", gap: 3, alignItems: "center" }}>
                  <Muted style={{ width: NAME_W }}>{STR.msSectionWeakPct}</Muted>
                  {h.outcomes.map((o) => {
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
                      </Body>
                    </Pressable>
                    {h.outcomes.map((o) => {
                      const cell = o.cells[si];
                      const c = stateCell(colors, cell.state);
                      return (
                        <Pressable
                          key={o.loCode}
                          accessibilityRole="button"
                          accessibilityLabel={`${s.name} · ${o.labelBn} · ${masteryStateLabel(cell.state)}`}
                          disabled={cell.state === "NOT_ASSESSED"}
                          onPress={() => navigation.navigate("MasteryOutcomeTrail", { studentId: s.studentId, loCode: o.loCode })}
                          style={{
                            width: CELL_W, height: 34, borderRadius: 6, alignItems: "center", justifyContent: "center",
                            backgroundColor: c.bg, borderWidth: c.outline ? 1 : 0, borderColor: colors.border, borderStyle: "dashed",
                          }}
                        >
                          <Body style={{ color: c.fg, fontWeight: "700", fontSize: 12 }}>
                            {cell.pct === null ? "—" : `${bnNum(cell.pct)}%`}
                          </Body>
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
