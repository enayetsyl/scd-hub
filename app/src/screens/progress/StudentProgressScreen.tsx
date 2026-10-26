/**
 * StudentProgressScreen (SP-1, docs/prd-student-progress.md §2, D-#734) — the Office /
 * Principal board: whole-school tiles, the needs-attention list across classes, and per
 * section a grid of every student × subject with Class highest above Class average.
 *
 * Every number is derived on the server from class-test results; this screen only lays
 * them out. Tap a name for the student page; "+ Class action" opens the New action form
 * for the section.
 */
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { ACADEMIC_YEARS_QUERY, CLASSES_QUERY } from "../../graphql/operations";
import { PROGRESS_SCHOOL_OVERVIEW, PROGRESS_SECTION_BOARD, type ProgressGridStudentT } from "../../graphql/improvement";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, classSectionLabel, subjectShortLabel } from "../../lib/labels";
import { pickableSections, isWholeClassSectionName } from "../../lib/sectionPicks";
import { usePullRefresh } from "../../lib/useRefresh";
import { hasRoute } from "../../lib/hasRoute";
import {
  periodRange,
  periodLabel,
  rowStateLabel,
  rowStateTone,
  bandColors,
  trendArrow,
  type PeriodKey,
} from "../../lib/improvement";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;
type View_ = "ALL" | "RISK" | "OPEN";

const pct = (v: number | null | undefined): string => (v == null ? "—" : `${bnNum(Math.round(v))}%`);

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "danger" | "warn" | "ok" }): React.ReactElement {
  const c = useColors();
  const bg = tone === "danger" ? c.errorContainer : tone === "warn" ? c.warningContainer : tone === "ok" ? c.primaryContainer : c.surface;
  const fg = tone === "danger" ? c.onErrorContainer : tone === "warn" ? c.warning : tone === "ok" ? c.onPrimaryContainer : c.textPrimary;
  return (
    <View style={{ flexGrow: 1, flexBasis: 150, minWidth: 150, backgroundColor: bg, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: space(3) }}>
      <Text style={{ color: fg, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: fg, fontSize: 24, fontWeight: "700", marginTop: 2 }}>{value}</Text>
      <Text style={{ color: fg, fontSize: 12, opacity: 0.85 }}>{hint}</Text>
    </View>
  );
}

export default function StudentProgressScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const c = useColors();
  const [period, setPeriod] = React.useState<PeriodKey>("YEAR");
  const range = periodRange(period);

  const [overviewQ, refetchOverview] = useQuery({ query: PROGRESS_SCHOOL_OVERVIEW, variables: range, requestPolicy: "cache-and-network" });

  // Sections to pick from: the current year's classes, minus the emptied সম্মিলিত (D-#722).
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const yearId = yearsQ.data?.academicYears?.find((y) => y.current)?.id ?? yearsQ.data?.academicYears?.[0]?.id ?? null;
  const [classesQ] = useQuery({ query: CLASSES_QUERY, variables: { academicYearId: yearId ?? "" }, pause: !yearId });
  const sections = React.useMemo(() => {
    const out: Array<{ id: string; label: string }> = [];
    for (const cl of [...(classesQ.data?.classes ?? [])].filter((x) => x.active).sort((a, b) => a.level - b.level)) {
      for (const s of pickableSections(cl.sections)) {
        out.push({ id: s.id, label: classSectionLabel(cl.level, isWholeClassSectionName(s.nameBn) ? null : s.nameBn) });
      }
    }
    return out;
  }, [classesQ.data]);
  const [sectionId, setSectionId] = React.useState<string | null>(null);
  const activeSection = sectionId ?? sections[0]?.id ?? null;

  const [boardQ, refetchBoard] = useQuery({
    query: PROGRESS_SECTION_BOARD,
    variables: { sectionId: activeSection ?? "", ...range },
    pause: !activeSection,
    requestPolicy: "cache-and-network",
  });
  const [view, setView] = React.useState<View_>("ALL");

  const refetchAll = (): void => {
    const opts = { requestPolicy: "network-only" as const };
    refetchOverview(opts);
    if (activeSection) refetchBoard(opts);
  };
  const { refreshing, onRefresh } = usePullRefresh(overviewQ.fetching || boardQ.fetching, refetchAll);

  const o = overviewQ.data?.progressSchoolOverview;
  const board = boardQ.data?.progressSectionBoard;
  const students: ProgressGridStudentT[] = (board?.students ?? []).filter(
    (s) => view === "ALL" || (view === "RISK" ? s.atRisk : s.openActions > 0),
  );
  const subjects = board?.subjects ?? [];
  const sectionLabel = sections.find((s) => s.id === activeSection)?.label ?? "";

  const openStudent = (studentId: string, name: string): void => nav.navigate("StudentProgressStudent", { studentId, name });

  const NAME_W = 150;
  const CELL_W = 76;
  const headCell = (text: string, key: string, w = CELL_W) => (
    <Text key={key} style={{ width: w, paddingHorizontal: 4, fontSize: 12, fontWeight: "700", color: c.textSecondary, textAlign: "center" }} numberOfLines={2}>
      {text}
    </Text>
  );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <ChipRow>
          {(["YEAR", "TERM", "D30"] as PeriodKey[]).map((p) => (
            <Chip key={p} label={periodLabel(p)} selected={period === p} onPress={() => setPeriod(p)} />
          ))}
        </ChipRow>

        <QueryGate result={overviewQ} onRetry={() => refetchOverview({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {o ? (
            <View style={{ gap: space(3) }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                <Tile label={STR.impSchoolAvg} value={pct(o.schoolAverage)} hint={`${bnNum(o.studentsWithResults)} ${STR.impStudent}`} />
                <Tile label={STR.impAtRisk} value={bnNum(o.atRisk)} hint={STR.impAtRiskHint} tone="danger" />
                <Tile label={STR.impNoActionYet} value={bnNum(o.atRiskNoAction)} hint={STR.impNoActionHint} tone="warn" />
                <Tile label={STR.impBehind} value={bnNum(o.actionsBehind)} hint={STR.impBehindHint} />
                <Tile label={STR.impImproved} value={`${bnNum(o.improved)}/${bnNum(o.improvedOf)}`} hint={STR.impImprovedHint} tone="ok" />
              </View>

              <Card>
                <Body style={{ fontWeight: "700" }}>{STR.impAttentionTitle}</Body>
                <Muted>{STR.impAttentionHint}</Muted>
                {o.attention.length === 0 ? <Muted style={{ marginTop: space(2) }}>—</Muted> : null}
                {o.attention.map((a) => (
                  <Pressable
                    key={`${a.studentId}-${a.subject}`}
                    onPress={() => openStudent(a.studentId, a.name)}
                    accessibilityRole="button"
                    style={({ pressed }) => [{ paddingVertical: space(2), borderTopWidth: 1, borderTopColor: c.border, gap: 4 }, pressed && { opacity: 0.7 }]}
                  >
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                      <Body style={{ fontWeight: "700" }}>{a.name}</Body>
                      <Muted>
                        {a.classLevel != null ? classSectionLabel(a.classLevel, isWholeClassSectionName(a.sectionNameBn) ? null : a.sectionNameBn) : a.sectionNameBn} · {subjectShortLabel(a.subject)}
                      </Muted>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                      <Badge text={a.why === "AT_RISK" ? STR.impWhyAtRisk : STR.impWhyFalling} tone={a.why === "AT_RISK" ? "danger" : "warn"} />
                      <Muted>
                        {STR.impLast3}: {a.last3.map((p) => `${bnNum(Math.round(p))}%`).join(" → ")}
                      </Muted>
                      <Badge
                        text={`${rowStateLabel(a.actionState)}${a.actionDelta != null ? ` ${a.actionDelta >= 0 ? "+" : ""}${bnNum(a.actionDelta)}%` : ""}`}
                        tone={rowStateTone(a.actionState)}
                      />
                    </View>
                  </Pressable>
                ))}
              </Card>
            </View>
          ) : null}
        </QueryGate>

        <Card>
          <ChipRow>
            {sections.map((s) => (
              <Chip key={s.id} label={s.label} selected={s.id === activeSection} onPress={() => setSectionId(s.id)} />
            ))}
          </ChipRow>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space(2), marginTop: space(2) }}>
            <Body style={{ fontWeight: "700" }}>
              {sectionLabel} — {STR.impGridTitle}
            </Body>
            {activeSection && hasRoute(nav, "NewImprovementAction") ? (
              <Button
                title={STR.impNewClassAction}
                variant="secondary"
                onPress={() => nav.navigate("NewImprovementAction", { scope: "CLASS", sectionId: activeSection })}
              />
            ) : null}
          </View>
          <ChipRow>
            {([
              ["ALL", STR.impViewAll],
              ["RISK", STR.impViewRisk],
              ["OPEN", STR.impViewOpen],
            ] as Array<[View_, string]>).map(([k, l]) => (
              <Chip key={k} label={l} selected={view === k} onPress={() => setView(k)} />
            ))}
          </ChipRow>
          <Muted style={{ marginTop: space(1) }}>{STR.impLegendTrend}</Muted>

          <QueryGate result={boardQ} onRetry={() => refetchBoard({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
            {board && subjects.length === 0 ? <EmptyState message={STR.impNoResults} /> : null}
            {board && subjects.length > 0 ? (
              <ScrollView horizontal style={{ marginTop: space(2) }} contentContainerStyle={{ paddingBottom: space(1) }}>
                <View>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
                    <Text style={{ width: NAME_W, fontSize: 12, fontWeight: "700", color: c.textSecondary }}>{STR.impStudent}</Text>
                    {subjects.map((s) => headCell(subjectShortLabel(s), s))}
                    {headCell(STR.impOverall, "overall")}
                    {headCell(STR.impActionsCol, "acts", 110)}
                  </View>
                  {(
                    [
                      [STR.impClassHighest, board.highest, board.highestOverall],
                      [STR.impClassAverage, board.average, board.averageOverall],
                    ] as const
                  ).map(([label, row, overall]) => (
                    <View key={label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, backgroundColor: c.surfaceAlt, borderBottomWidth: 1, borderBottomColor: c.border }}>
                      <Text style={{ width: NAME_W, fontWeight: "700", color: c.textPrimary, paddingLeft: 4 }}>{label}</Text>
                      {subjects.map((s) => (
                        <Text key={s} style={{ width: CELL_W, textAlign: "center", fontWeight: "700", color: c.textPrimary }}>
                          {pct(row.find((x) => x.subject === s)?.value)}
                        </Text>
                      ))}
                      <Text style={{ width: CELL_W, textAlign: "center", fontWeight: "700", color: c.textPrimary }}>{pct(overall)}</Text>
                      <View style={{ width: 110 }} />
                    </View>
                  ))}
                  {students.map((st) => (
                    <View key={st.studentId} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>
                      <Pressable
                        onPress={() => openStudent(st.studentId, st.name)}
                        accessibilityRole="link"
                        style={{ width: NAME_W, paddingRight: 6, minHeight: 40, justifyContent: "center" }}
                      >
                        <Text style={{ color: c.info, fontWeight: "600" }} numberOfLines={2}>
                          {st.name}
                        </Text>
                        {st.atRisk ? (
                          <Text style={{ color: c.onErrorContainer, backgroundColor: c.errorContainer, fontSize: 11, fontWeight: "700", alignSelf: "flex-start", paddingHorizontal: 5, borderRadius: 4, marginTop: 2 }}>
                            {STR.impAtRisk}
                          </Text>
                        ) : null}
                      </Pressable>
                      {subjects.map((s) => {
                        const cell = st.cells.find((x) => x.subject === s);
                        if (!cell) return <Text key={s} style={{ width: CELL_W, textAlign: "center", color: c.textSecondary }}>—</Text>;
                        const b = bandColors(cell.avgPercent, c);
                        return (
                          <View key={s} style={{ width: CELL_W, paddingHorizontal: 3 }}>
                            <Text style={{ backgroundColor: b.bg, color: b.fg, fontWeight: b.bold ? "700" : "400", textAlign: "center", borderRadius: 6, paddingVertical: 6 }}>
                              {pct(cell.avgPercent)}
                              {trendArrow(cell.trend)}
                            </Text>
                          </View>
                        );
                      })}
                      <Text style={{ width: CELL_W, textAlign: "center", fontWeight: "700", color: c.textPrimary }}>{pct(st.overall)}</Text>
                      <Text style={{ width: 110, fontSize: 12, color: st.behindActions ? c.warning : c.textSecondary, paddingLeft: 4 }}>
                        {st.openActions || st.doneActions
                          ? [
                              st.openActions ? `${bnNum(st.openActions)} ${STR.impOpenN}` : "",
                              st.behindActions ? `${bnNum(st.behindActions)} ${STR.impBehindN}` : "",
                              st.doneActions ? `${bnNum(st.doneActions)} ${STR.impDoneN}` : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            ) : null}
          </QueryGate>
        </Card>
      </ScrollView>
    </Screen>
  );
}
