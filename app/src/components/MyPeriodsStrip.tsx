/**
 * আমার পিরিয়ড — the caller's own periods for today as a horizontal timeline; past
 * slots dimmed, the CURRENT slot highlighted primaryContainer + "এখন" badge.
 *
 * Lifted out of TodayScreen (D-#918) so the admin dashboard can show it too: a
 * Principal/Office login that ALSO teaches (admin_dashboard:view lands them on
 * AdminTodayScreen) never saw their own periods. TodayScreen passes its myDay
 * data in; `MyPeriodsSelfCard` fetches the slots itself and renders nothing for
 * a caller with no periods today, so a non-teaching admin sees no change.
 */
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "urql";
import { MY_DAY_SLOTS_QUERY, type RoutineSlotT } from "../graphql/operations";
import { H2, Body, Muted, Badge } from "./ui";
import { STR, bnNum, dayTypeLabel, routineSubjectLabel } from "../lib/labels";
import { useAuth } from "../auth/AuthContext";
import { useColors } from "../theme";
import { radius, space, typeScale } from "../theme/tokens";
import { dateKey } from "../lib/dates";

/** Cross-tab navigation (the Basket→Sets convention): navigate bubbles up to the drawer. */
type CrossNav = { navigate: (name: string, params?: object) => void };

/** "HH:MM" for the local clock — comparable against the slots' zero-padded times. */
const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type SlotPhase = "past" | "current" | "upcoming";
const slotPhase = (s: RoutineSlotT, nowHM: string): SlotPhase => {
  if (!s.startTime || !s.endTime) return "upcoming";
  if (s.endTime <= nowHM) return "past";
  if (s.startTime <= nowHM) return "current";
  return "upcoming";
};

export function MyPeriodsStrip({
  dayType,
  slots,
  nowMs,
}: {
  /** null while myDay is still loading — then the strip shows no empty-day line. */
  dayType: string | null;
  slots: RoutineSlotT[];
  nowMs: number;
}): React.ReactElement {
  const nav = useNavigation() as unknown as CrossNav;
  const { can } = useAuth();
  const colors = useColors();
  const canClassNotesView = can("class_note:view");
  const nowHM = hhmm(nowMs);

  return (
    <>
      <H2>{STR.myPeriods}</H2>
      {dayType && slots.length === 0 ? (
        <Muted style={{ marginBottom: space(3) }}>
          {dayType !== "FULL" && dayType !== "QURAN_ONLY" ? dayTypeLabel(dayType) : STR.rtNoSlots}
        </Muted>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -space(4), marginBottom: space(3) }}
          contentContainerStyle={{ gap: space(2), paddingHorizontal: space(4), paddingVertical: space(1) }}
        >
          {slots.map((s) => {
            const phase = slotPhase(s, nowHM);
            const current = phase === "current";
            const fg = current ? colors.onPrimaryContainer : colors.textPrimary;
            const fgMuted = current ? colors.onPrimaryContainer : colors.textSecondary;
            return (
              <Pressable
                key={s.id}
                // Owner rule (2026-10-25): the slot opens MyClassNotes only for a
                // viewer who can read class notes; otherwise it is a plain card.
                disabled={!canClassNotesView}
                onPress={canClassNotesView ? () => nav.navigate("ClassNotesTab", { screen: "MyClassNotes" }) : undefined}
                accessibilityRole={canClassNotesView ? "button" : undefined}
                accessibilityLabel={`${STR.rtPeriodN} ${bnNum(s.periodNumber)} — ${routineSubjectLabel(s.subject)}${current ? ` — ${STR.tdNow}` : ""}`}
                style={({ pressed }) => [
                  {
                    width: 136,
                    padding: space(3),
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: current ? colors.primary : colors.border,
                    backgroundColor: current ? colors.primaryContainer : colors.surface,
                  },
                  phase === "past" && { opacity: 0.6 },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(1) }}>
                  <Body style={{ ...typeScale.caption, fontWeight: current ? "700" : "400", color: fgMuted }}>
                    {STR.rtPeriodN} {bnNum(s.periodNumber)}
                    {s.startTime ? ` · ${bnNum(s.startTime)}` : ""}
                  </Body>
                  {current ? (
                    <View
                      style={{
                        backgroundColor: colors.primary,
                        borderRadius: radius.pill,
                        paddingHorizontal: space(2),
                      }}
                    >
                      {/* 12sp minimum — the caption floor (the prototype's 11px is below it) */}
                      <Body style={{ ...typeScale.caption, fontWeight: "700", color: colors.onPrimary }}>
                        {STR.tdNow}
                      </Body>
                    </View>
                  ) : null}
                </View>
                <Body style={{ fontWeight: "700", color: fg }} numberOfLines={1}>
                  {routineSubjectLabel(s.subject)}
                </Body>
                <Body style={{ ...typeScale.caption, color: fgMuted }} numberOfLines={1}>
                  {s.groupName ?? "—"}
                  {s.isCovering && s.teacherName ? ` · ${STR.rtCoveringFor} ${s.teacherName}` : ""}
                  {!s.isCovering && s.coverTeacherName ? ` · ${STR.rtCovered}: ${s.coverTeacherName}` : ""}
                </Body>
                {s.isCovering ? (
                  <View style={{ alignSelf: "flex-start", marginTop: space(1) }}>
                    <Badge text={STR.rtCoveringFor} tone="warn" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}

/**
 * The admin dashboard's copy (D-#918): fetches only the slots, ticks its own
 * minute clock, and renders NOTHING unless the caller has a period today — an
 * admin who does not teach keeps the dashboard exactly as it was.
 */
export function MyPeriodsSelfCard(): React.ReactElement | null {
  const date = dateKey();
  const [q] = useQuery({ query: MY_DAY_SLOTS_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const day = q.data?.myDay;
  if (!day || day.slots.length === 0) return null;
  return <MyPeriodsStrip dayType={day.dayType} slots={day.slots} nowMs={now} />;
}
