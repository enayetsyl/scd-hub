/**
 * LiveClassCard (D-#670, owner ask 2026-09-15) — "which classes are running RIGHT NOW,
 * and who is standing in front of each one?" on the Principal/Office Today screen.
 *
 * One row per period running this minute: the class, the subject, and the teacher —
 * the COVER teacher's name when a cover is approved, and a red "শিক্ষক নেই" row when
 * the teacher is out and no cover is approved (a cover that is only PROPOSED is shown
 * beside the alert, never instead of it: an unapproved proposal is not a teacher in
 * the room). A footer line carries the day's total uncovered count and opens the full
 * class × period board.
 *
 * It TICKS: a 30-second timer re-derives each cell's phase from the DEVICE clock (the
 * TodayScreen `slotPhase` precedent), so the card rolls over to the next period on its
 * own; crossing a period boundary also refetches, which is what picks up a cover that
 * an admin approved since the last read. The server sends `phase` too — both read the
 * same `startTime`/`endTime` strings — but a card that only trusted the server's phase
 * would freeze on whatever period was running when the screen was opened.
 *
 * Gated by the caller on `routine:manage` (Principal/Office), the same permission the
 * server requires — and by PERMISSION rather than role, so a per-user grant (D-#193)
 * reaches it on the teacher Today screen too (the D-#668 lesson).
 */
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { LIVE_CLASS_BOARD_QUERY, type LiveClassCellT } from "../graphql/operations";
import { Body, Muted, Card, Badge, Divider, Loader } from "./ui";
import { Icon } from "./Icon";
import { STR, bnNum, routineSubjectLabel, absenceReasonLabel } from "../lib/labels";
import { useColors } from "../theme";
import { space, typeScale } from "../theme/tokens";
import { dateKey } from "../lib/dates";

/** Cross-tab navigation (the Basket→Sets convention): navigate bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

/** "HH:MM" on the device clock — comparable against the cells' zero-padded times. */
const nowHHMM = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const isLive = (c: LiveClassCellT, hm: string): boolean =>
  !!c.startTime && !!c.endTime && c.startTime <= hm && c.endTime > hm;

const noTeacher = (c: LiveClassCellT): boolean => c.status === "UNCOVERED" || c.status === "UNASSIGNED";

export function LiveClassCard(): React.ReactElement | null {
  const nav = useNavigation() as unknown as CrossNav;
  const colors = useColors();
  const date = dateKey();
  const [hm, setHm] = React.useState(nowHHMM);
  const [q, refetch] = useQuery({
    query: LIVE_CLASS_BOARD_QUERY,
    variables: { date },
    requestPolicy: "cache-and-network",
  });

  // The tick. Re-rendering every 30s is what makes the card follow the day; the
  // REFETCH is deliberately tied to the minute changing rather than to every tick,
  // so a card left open all morning makes ~1 request a minute, not one every 30s.
  const lastMinute = React.useRef(hm);
  // `refetch` through a ref, and the effect with EMPTY deps (the TodayScreen tick
  // precedent): a dep on urql's execute function re-creates the timer whenever its
  // identity changes, and a timer that keeps being re-created never reaches 30s.
  const refetchRef = React.useRef(refetch);
  refetchRef.current = refetch;
  React.useEffect(() => {
    const id = setInterval(() => {
      const next = nowHHMM();
      setHm(next);
      if (next !== lastMinute.current) {
        lastMinute.current = next;
        refetchRef.current({ requestPolicy: "network-only" });
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const board = q.data?.liveClassBoard ?? null;
  const cells = board?.cells ?? [];
  const live = React.useMemo(
    () =>
      cells
        .filter((c) => isLive(c, hm))
        .sort((a, b) => Number(noTeacher(b)) - Number(noTeacher(a)) || (a.groupName ?? "").localeCompare(b.groupName ?? "")),
    [cells, hm],
  );
  // Counted from the DEVICE clock like `live` above, so the badge can never contradict
  // the rows underneath it (the server's own count is a minute-old snapshot).
  const uncoveredToday = cells.filter(noTeacher).length;

  const openBoard = (): void => nav.navigate("RoutineTab", { screen: "LiveClassBoard", initial: false });

  if (q.fetching && !board) return <Loader label={STR.loading} />;
  if (!board) return null;

  const period = live[0]?.periodNumber ?? null;
  const window = live[0]?.startTime && live[0]?.endTime ? `${bnNum(live[0].startTime)}–${bnNum(live[0].endTime)}` : null;

  return (
    <Card onPress={openBoard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Icon name="clock" size={18} color={colors.textPrimary} />
        <Body style={{ fontWeight: "700", flex: 1 }}>{STR.lcbNowTitle}</Body>
        {period != null ? (
          <Badge text={`${STR.rtPeriodN} ${bnNum(period)}${window ? ` · ${window}` : ""}`} tone="brand" />
        ) : null}
      </View>

      {live.length === 0 ? (
        <Muted style={{ marginTop: space(2) }}>
          {board.cells.length === 0 ? STR.lcbNoBoard : STR.lcbNoneLive}
        </Muted>
      ) : (
        <View style={{ marginTop: space(2) }}>
          {live.map((c) => {
            const alert = noTeacher(c);
            const fg = alert ? colors.onErrorContainer : colors.textPrimary;
            return (
              <View
                key={c.slotId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space(2),
                  paddingVertical: space(2),
                  paddingHorizontal: alert ? space(2) : 0,
                  borderRadius: alert ? 8 : 0,
                  backgroundColor: alert ? colors.errorContainer : "transparent",
                  marginBottom: space(1),
                }}
              >
                {alert ? <Icon name="alert-triangle" size={18} color={fg} label={STR.lcbNoTeacher} /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Body style={{ fontWeight: "600", color: fg }} numberOfLines={1}>
                    {c.groupName ?? "—"} · {routineSubjectLabel(c.subject)}
                  </Body>
                  <Body style={{ ...typeScale.secondary, color: alert ? fg : colors.textSecondary }} numberOfLines={2}>
                    {c.status === "COVERED"
                      ? `${STR.lcbCoverPrefix}: ${c.coverTeacherName ?? "—"} (${c.teacherName ?? "—"})`
                      : c.status === "UNASSIGNED"
                        ? STR.lcbUnassigned
                        : c.status === "UNCOVERED"
                          ? `${c.teacherName ?? "—"} — ${absenceReasonLabel(c.absenceReason)}${
                              c.pendingCoverTeacherName
                                ? ` · ${c.pendingCoverTeacherName}: ${STR.lcbProposedNotApproved}`
                                : ""
                            }`
                          : (c.teacherName ?? "—")}
                  </Body>
                </View>
                {alert ? <Badge text={STR.lcbNoTeacher} tone="danger" /> : null}
              </View>
            );
          })}
        </View>
      )}

      <Divider />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        {uncoveredToday > 0 ? (
          <Badge text={`${STR.lcbUncoveredToday}: ${bnNum(uncoveredToday)}`} tone="danger" />
        ) : (
          <Muted style={{ flex: 1 }}>{STR.lcbAllStaffed}</Muted>
        )}
        <Body style={{ fontWeight: "600", marginLeft: "auto" }}>{STR.lcbBoardOpen}</Body>
        <Icon name="chevron-right" size={18} color={colors.textSecondary} />
      </View>
    </Card>
  );
}
