/**
 * OT-3 building blocks shared by the student view, the evidence trail and the leader dashboard
 * (docs/prd-objective-tree.md §8.1, mock 7). Level words always come from useMasteryLevelLabels
 * (D-#923); colour always travels with text (mock I1/I3 rule).
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery } from "urql";
import {
  MASTERY_SCHOOL_ROLLUP_QUERY,
  type MasteryEarlierStep,
  type MasterySchoolRollupData,
  type MasteryStateSummary,
} from "../../graphql/mastery";
import { Body, Card, Chip, ChipRow, Muted, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel, masteryStateLabel } from "../../lib/labels";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { friendlyError } from "../../lib/errors";
import { space, useColors } from "../../theme";
import { STATE_ORDER, fill, isGoodState, levelFill, stateCell } from "./masteryStateUi";

/**
 * "আগের ধাপ: <label> — আয়ত্তে ✓" per prerequisite of a WEAK row (D-#927). An earlier-class step
 * is marked as such; with no evidence from that class: "আগের শ্রেণির তথ্য নেই".
 */
export function EarlierSteps({ steps }: { steps: MasteryEarlierStep[] }): React.ReactElement | null {
  const colors = useColors();
  if (steps.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      {steps.map((s) => (
        <Muted key={s.code}>
          {STR.msEarlierStep}: <Body style={{ fontWeight: "600", color: colors.textPrimary }}>{s.labelBn}</Body>
          {s.crossClass ? ` (${STR.msEarlierClassTag})` : ""}
          {" — "}
          {s.noData || s.state === null ? STR.msEarlierNoData : `${masteryStateLabel(s.state)}${isGoodState(s.state) ? " ✓" : ""}`}
        </Muted>
      ))}
    </View>
  );
}

/** A thin bar of a summary's states (WEAK first), with a text label for screen readers. */
export function SummaryBar({ summary, height = 10 }: { summary: MasteryStateSummary; height?: number }): React.ReactElement {
  const colors = useColors();
  const count = (s: string) => summary.counts.find((c) => c.state === s)?.count ?? 0;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={STATE_ORDER.map((s) => `${masteryStateLabel(s)} ${bnNum(count(s))}`).join(", ")}
      style={{ flexDirection: "row", height, borderRadius: 999, overflow: "hidden", backgroundColor: colors.surfaceAlt }}
    >
      {STATE_ORDER.map((s) =>
        count(s) ? (
          <View key={s} style={{ flex: count(s), backgroundColor: s === "NOT_ASSESSED" ? colors.border : stateCell(colors, s).bg }} />
        ) : null,
      )}
    </View>
  );
}

/** "আয়ত্তে 3/5 · দুর্বল 20%" */
export function summaryLine(summary: MasteryStateSummary): string {
  const parts = [fill(STR.msDomainMastered, { m: bnNum(summary.mastered), n: bnNum(summary.total) })];
  if (summary.weakPct !== null) parts.push(fill(STR.msWeakShare, { pct: bnNum(summary.weakPct) }));
  return parts.join(" · ");
}

/**
 * The leader dashboard's school-wide card (পুরো স্কুল): per switched-on tree class, domain →
 * objective → tagged row, each with its counts over the class's students. Renders nothing while
 * no switched-on pair runs on a tree (flat catalogues keep the dashboard unchanged).
 */
export function SchoolRollupCard(): React.ReactElement | null {
  const colors = useColors();
  const lv = useMasteryLevelLabels();
  const [subject, setSubject] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [openObj, setOpenObj] = useState<string | null>(null);
  const [{ data, error }] = useQuery({ query: MASTERY_SCHOOL_ROLLUP_QUERY, variables: { subject }, requestPolicy: "cache-and-network" });
  const r = data?.masterySchoolRollup as MasterySchoolRollupData | undefined;
  if (error) return <Notice message={friendlyError(error)} tone="danger" />;
  if (!r || r.classes.length === 0) return null;
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{levelFill(STR.msSchoolRollup, lv)}</Body>
      {r.subjects.length > 1 ? (
        <ChipRow>
          {r.subjects.map((s) => (
            <Chip key={s} label={hwSubjectLabel(s)} selected={s === r.subject} onPress={() => setSubject(s)} />
          ))}
        </ChipRow>
      ) : null}
      {r.classes.map((c) => (
        <View key={c.classToken} style={{ gap: space(1), borderTopWidth: 1, borderTopColor: colors.surfaceAlt, paddingTop: space(2) }}>
          <Body style={{ fontWeight: "700" }}>
            {masteryClassLabel(c.classToken)} · {hwSubjectLabel(r.subject)}
          </Body>
          <Muted>{fill(STR.msSchoolClassLine, { sections: bnNum(c.sections), students: bnNum(c.students) })}</Muted>
          {c.domains.map((d) => {
            const key = `${c.classToken}:${d.code ?? ""}`;
            const isOpen = open === key;
            return (
              <View key={key} style={{ gap: space(1), paddingLeft: space(1) }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : key)} style={{ gap: 4 }}>
                  <Body style={{ fontWeight: "600" }}>
                    {isOpen ? "▾ " : "▸ "}
                    {d.labelBn ?? STR.msNoDomain}
                  </Body>
                  <SummaryBar summary={d.summary} />
                  <Muted>{summaryLine(d.summary)}</Muted>
                </Pressable>
                {isOpen
                  ? c.objectives
                      .filter((o) => d.objectiveCodes.includes(o.code))
                      .map((o) => {
                        const oKey = `${c.classToken}:${o.code}`;
                        const oOpen = openObj === oKey;
                        const rows = c.rows.filter((x) => x.parentCode === o.code);
                        return (
                          <View key={o.code} style={{ paddingLeft: space(3), gap: 2 }}>
                            <Pressable disabled={rows.length === 0} onPress={() => setOpenObj(oOpen ? null : oKey)}>
                              <Body>
                                {rows.length > 0 ? (oOpen ? "▾ " : "▸ ") : "• "}
                                {o.labelBn}
                              </Body>
                              <Muted>
                                {lv.objective}: {summaryLine(o.summary)}
                              </Muted>
                            </Pressable>
                            {oOpen
                              ? rows.map((x) => (
                                  <Muted key={x.code} style={{ paddingLeft: space(3) }}>
                                    {lv.sub}: {x.labelBn} — {summaryLine(x.summary)}
                                  </Muted>
                                ))
                              : null}
                          </View>
                        );
                      })
                  : null}
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

/** A small square for one state (tree drill rows). */
export function StateDot({ state }: { state: string }): React.ReactElement {
  const colors = useColors();
  const c = stateCell(colors, state);
  return (
    <View
      style={{
        width: 14, height: 14, borderRadius: 4, backgroundColor: c.bg, marginTop: space(1),
        borderWidth: c.outline ? 1 : 0, borderColor: colors.border, borderStyle: "dashed",
      }}
    />
  );
}
