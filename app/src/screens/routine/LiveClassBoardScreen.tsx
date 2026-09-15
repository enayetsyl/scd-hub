/**
 * LiveClassBoardScreen (D-#670) — the whole day, class by class and period by period,
 * with the name of whoever actually takes each meeting: the routine's own teacher, the
 * APPROVED cover teacher, or a red cell saying nobody does.
 *
 * This is the management view the owner asked for alongside the Today card — the one
 * you open to decide something that is not about this minute ("who is free period 6",
 * "which classes went untaught on Sunday"). It is NOT the master routine grid: that
 * one is the weekly TEMPLATE and knows nothing about leave, cover or a date. This one
 * is a DATE, cover-resolved, and read-only.
 *
 * The running period's column is highlighted from the DEVICE clock and re-derived on a
 * 30-second tick (the LiveClassCard rule), so the highlight walks across the board as
 * the day goes on. "শুধু শিক্ষকবিহীন" filters to the cells that need a decision.
 *
 * `routine:manage` (Principal/Office) — the same gate the server applies.
 */
import React from "react";
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { LIVE_CLASS_BOARD_QUERY, type LiveClassCellT } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { DateField } from "../../components/DateField";
import { Screen, Body, Muted, Card, Badge, Chip, ChipRow, Loader, Notice } from "../../components/ui";
import {
  STR,
  bnNum,
  dayTypeLabel,
  routineSubjectLabel,
  absenceReasonLabel,
  liveClassStatusLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors, type ThemeColors } from "../../theme";
import { space } from "../../theme/tokens";
import { usePullRefresh } from "../../lib/useRefresh";
import { dateKey } from "../../lib/dates";

const GROUP_W = 150;
const PERIOD_W = 132;

const nowHHMM = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const noTeacher = (c: LiveClassCellT): boolean => c.status === "UNCOVERED" || c.status === "UNASSIGNED";

/** Who to print in a cell: the cover teacher when one is approved, else the routine's. */
const cellTeacher = (c: LiveClassCellT): string => {
  if (c.status === "COVERED") return `${STR.lcbCoverPrefix}: ${c.coverTeacherName ?? "—"}`;
  if (c.status === "UNASSIGNED") return STR.lcbNoTeacher;
  return c.teacherName ?? "—";
};

function cellTone(c: LiveClassCellT, colors: ThemeColors): { bg: string; fg: string } {
  if (noTeacher(c)) return { bg: colors.errorContainer, fg: colors.onErrorContainer };
  if (c.status === "COVERED") return { bg: colors.goldContainer, fg: colors.onGoldContainer };
  return { bg: colors.surface, fg: colors.textPrimary };
}

type Props = NativeStackScreenProps<RoutineStackParamList, "LiveClassBoard">;

export default function LiveClassBoardScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const [date, setDate] = React.useState(dateKey());
  const [onlyUncovered, setOnlyUncovered] = React.useState(false);
  const [hm, setHm] = React.useState(nowHHMM);
  const [q, refetch] = useQuery({ query: LIVE_CLASS_BOARD_QUERY, variables: { date } });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));

  // The highlight walks with the clock — device-side, like the Today card.
  React.useEffect(() => {
    const id = setInterval(() => setHm(nowHHMM()), 30_000);
    return () => clearInterval(id);
  }, []);

  const board = q.data?.liveClassBoard ?? null;
  const today = date === dateKey();
  const cellBy = React.useMemo(() => {
    const map = new Map<string, LiveClassCellT>();
    for (const c of board?.cells ?? []) map.set(`${c.groupId}|${c.periodNumber}`, c);
    return map;
  }, [board]);
  const rows = React.useMemo(() => {
    const all = board?.rows ?? [];
    if (!onlyUncovered) return all;
    const flagged = new Set((board?.cells ?? []).filter(noTeacher).map((c) => c.groupId));
    return all.filter((r) => flagged.has(r.groupId));
  }, [board, onlyUncovered]);
  const uncovered = (board?.cells ?? []).filter(noTeacher);

  const cellBase = { borderWidth: 1, borderColor: colors.border, padding: space(1), justifyContent: "center" as const };
  /** Only a TODAY board has a "now" — a past/future date must not highlight a column. */
  const liveColumn = (start: string, end: string): boolean => today && start <= hm && end > hm;

  return (
    <Screen padded={false} wide>
      <View style={{ padding: space(4), paddingBottom: 0, gap: space(2) }}>
        <DateField label={STR.rtDate} value={date} onChange={setDate} />
        <Muted>{STR.lcbBoardHint}</Muted>
        <ChipRow>
          <Chip label={STR.lcbOnlyUncovered} selected={onlyUncovered} onPress={() => setOnlyUncovered((v) => !v)} />
        </ChipRow>
        {board ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), alignItems: "center" }}>
            <Badge text={dayTypeLabel(board.dayType)} tone="info" />
            <Badge
              text={`${STR.lcbUncoveredToday}: ${bnNum(uncovered.length)}`}
              tone={uncovered.length > 0 ? "danger" : "ok"}
            />
            {/* The day-start the whole grid is computed from (winter slides it, D-#55). */}
            <Muted>{bnNum(board.dayStartHHMM)}</Muted>
          </View>
        ) : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
      </View>

      {q.fetching && !board ? <Loader label={STR.loading} /> : null}

      {board ? (
        <ScrollView
          contentContainerStyle={{ padding: space(4), gap: space(3) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {board.cells.length === 0 ? (
            <Muted>{STR.lcbNoBoard}</Muted>
          ) : (
            <>
              {/* The decisions list first: every cell with nobody in front of it. */}
              {uncovered.length > 0 ? (
                <Card>
                  <Body style={{ fontWeight: "700", color: colors.error, marginBottom: space(1) }}>
                    {STR.lcbUncoveredTitle} ({bnNum(uncovered.length)})
                  </Body>
                  {/* Each row opens কভার ব্যবস্থাপনা for THAT group and date — the board
                      is read-only, but the decision it surfaces has one place to be made
                      and it should not cost a hunt through the routine home. */}
                  {uncovered.map((c) => (
                    <Pressable
                      key={c.slotId}
                      accessibilityRole="button"
                      accessibilityLabel={`${STR.lcbAssignCover}: ${c.groupName ?? ""}`}
                      onPress={() =>
                        navigation.navigate("CoverManage", {
                          groupType: c.groupType,
                          groupId: c.groupId,
                          title: c.groupName ?? STR.rtCover,
                        })
                      }
                      style={({ pressed }) => [{ paddingVertical: space(1) }, pressed && { opacity: 0.6 }]}
                    >
                      <Muted>
                        {STR.rtPeriodN} {bnNum(c.periodNumber)} · {c.groupName ?? "—"} ·{" "}
                        {routineSubjectLabel(c.subject)} — {c.teacherName ?? STR.lcbUnassigned}
                        {c.absenceReason ? ` (${absenceReasonLabel(c.absenceReason)})` : ""}
                        {c.pendingCoverTeacherName ? ` · ${c.pendingCoverTeacherName}: ${STR.lcbProposedNotApproved}` : ""}
                        {" › "}
                        {STR.lcbAssignCover}
                      </Muted>
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <Badge text={STR.lcbAllStaffed} tone="ok" />
              )}

              <ScrollView horizontal showsHorizontalScrollIndicator>
                <View>
                  <View style={{ flexDirection: "row" }}>
                    <View style={[cellBase, { width: GROUP_W, backgroundColor: colors.surfaceAlt }]}>
                      <Muted style={{ fontWeight: "700" }}>{STR.rtSectionRoutine}</Muted>
                    </View>
                    {board.periods.map((col) => {
                      const live = liveColumn(col.startTime, col.endTime);
                      return (
                        <View
                          key={col.periodNumber}
                          style={[
                            cellBase,
                            { width: PERIOD_W, backgroundColor: live ? colors.primaryContainer : colors.surfaceAlt },
                          ]}
                        >
                          <Body
                            style={{ fontSize: 12, fontWeight: "700", color: live ? colors.onPrimaryContainer : colors.textPrimary }}
                          >
                            {STR.rtPeriodN} {bnNum(col.periodNumber)}
                            {live ? ` · ${STR.tdNow}` : ""}
                          </Body>
                          <Muted style={{ fontSize: 10, color: live ? colors.onPrimaryContainer : colors.textSecondary }}>
                            {col.isBreak ? STR.rtBreak : `${bnNum(col.startTime)}–${bnNum(col.endTime)}`}
                          </Muted>
                        </View>
                      );
                    })}
                  </View>

                  {rows.map((row) => (
                    <View key={`${row.groupType}:${row.groupId}`} style={{ flexDirection: "row" }}>
                      <View style={[cellBase, { width: GROUP_W, backgroundColor: colors.surface }]}>
                        <Body style={{ fontSize: 12, fontWeight: "600" }}>{row.label}</Body>
                        {row.sublabel ? <Muted style={{ fontSize: 10 }}>{row.sublabel}</Muted> : null}
                      </View>
                      {board.periods.map((col) => {
                        const c = cellBy.get(`${row.groupId}|${col.periodNumber}`);
                        if (!c) {
                          return (
                            <View
                              key={col.periodNumber}
                              style={[cellBase, { width: PERIOD_W, backgroundColor: colors.surfaceAlt }]}
                            >
                              <Muted style={{ fontSize: 10 }}>{col.isBreak ? STR.rtBreak : "·"}</Muted>
                            </View>
                          );
                        }
                        const tone = cellTone(c, colors);
                        return (
                          <View
                            key={col.periodNumber}
                            style={[cellBase, { width: PERIOD_W, backgroundColor: tone.bg }]}
                          >
                            <Body style={{ fontSize: 11, fontWeight: "600", color: tone.fg }} numberOfLines={1}>
                              {routineSubjectLabel(c.subject)}
                            </Body>
                            <Muted style={{ fontSize: 10, color: tone.fg }}>
                              {cellTeacher(c)}
                            </Muted>
                            {noTeacher(c) ? (
                              <Muted style={{ fontSize: 10, fontWeight: "700", color: tone.fg }}>
                                {liveClassStatusLabel(c.status)}
                              </Muted>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>
          )}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
