/**
 * MeetingSummaryTeacherCard (MC-3, docs/prd-meeting-comments.md §5, D-#752) — the class
 * teacher's "Meeting summaries" on Today: ready to write (opens the summary screen),
 * waiting (names the subject teachers still missing), done (folded).
 *
 * Self-contained and mounted OUTSIDE Today's QueryGate (the TodayWorkCard lesson). Renders
 * nothing for a teacher who class-teaches no section, while loading, and on error.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "urql";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MY_MEETING_SUMMARY_WORK } from "../graphql/meetingChain";
import { Badge, Body, Card, Muted } from "./ui";
import { STR, bnNum, routineSubjectLabel } from "../lib/labels";
import { dayLabel, placeLabel } from "./MeetingChainParts";
import { useColors } from "../theme";
import { space } from "../theme/tokens";
import type { HomeStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<HomeStackParamList>;

export function MeetingSummaryTeacherCard(): React.ReactElement | null {
  const c = useColors();
  const nav = useNavigation<Nav>();
  const [q, refetch] = useQuery({ query: MY_MEETING_SUMMARY_WORK, requestPolicy: "cache-and-network" });
  const [showDone, setShowDone] = React.useState<Record<string, boolean>>({});
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );
  const meetings = q.data?.myMeetingSummaryWork ?? [];
  if (q.error || meetings.length === 0) return null;

  return (
    <>
      {meetings.flatMap((m) =>
        m.sections.map((s) => {
          const key = `${m.meetingId}-${s.sectionId}`;
          const ready = s.students.filter((x) => x.state === "READY");
          const waiting = s.students.filter((x) => x.state === "WAITING");
          const done = s.students.filter((x) => x.state === "DONE");
          const tile = (n: number, label: string, bg: string, fg: string) => (
            <View style={{ flex: 1, padding: space(2), borderRadius: 8, backgroundColor: bg }}>
              <Text style={{ color: fg, fontSize: 20, fontWeight: "700" }}>{bnNum(n)}</Text>
              <Text style={{ color: c.textPrimary, fontSize: 12 }}>{label}</Text>
            </View>
          );
          return (
            <Card key={key}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>
                  {STR.mcSummaryCardTitle} · {placeLabel(s)}
                </Body>
                {ready.length ? <Badge text={`${bnNum(ready.length)} ${STR.mcReady}`} tone="info" /> : null}
              </View>
              <Muted>
                {STR.mcSummaryHint} {STR.mcSummaryDueBy} {dayLabel(m.summaryDueKey)}।
              </Muted>
              <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                {tile(s.ready, STR.mcReady, c.infoContainer, c.info)}
                {tile(s.waiting, STR.mcWaiting, c.warningContainer, c.warning)}
                {tile(s.done, STR.mcDoneLower, c.primaryContainer, c.primary)}
              </View>

              {ready.map((x) => (
                <Pressable
                  key={x.studentId}
                  onPress={() => nav.navigate("MeetingSummaryWrite", { meetingId: m.meetingId, studentId: x.studentId, studentName: x.name })}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    marginTop: space(2),
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: space(2),
                    paddingHorizontal: space(3),
                    borderRadius: 8,
                    backgroundColor: c.infoContainer,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.textPrimary, fontWeight: "600" }}>{x.name}</Text>
                    <Muted>
                      {bnNum(x.written + x.skipped)}/{bnNum(x.total)} {STR.mcSubjectsIn}
                    </Muted>
                  </View>
                  <Text style={{ color: c.info, fontWeight: "700" }}>{STR.mcWriteSummary}</Text>
                </Pressable>
              ))}

              {waiting.map((x) => (
                <View key={x.studentId} style={{ minHeight: 44, marginTop: space(2), paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: 8, backgroundColor: c.surfaceAlt, gap: 2 }}>
                  <Text style={{ color: c.textPrimary, fontWeight: "600" }}>{x.name}</Text>
                  <Text style={{ color: c.warning, fontSize: 13 }}>
                    {STR.mcMissing} {x.missing.map((mm) => `${routineSubjectLabel(mm.subject)}${mm.teacherName ? ` (${mm.teacherName})` : ""}`).join(", ")}
                  </Text>
                </View>
              ))}

              {done.length ? (
                <Pressable onPress={() => setShowDone({ ...showDone, [key]: !showDone[key] })} style={{ minHeight: 40, justifyContent: "center", marginTop: space(1) }}>
                  <Text style={{ color: c.info, fontWeight: "600" }}>{showDone[key] ? STR.mcHide : `${STR.mcShowDone} (${bnNum(done.length)})`}</Text>
                </Pressable>
              ) : null}
              {showDone[key]
                ? done.map((x) => (
                    <Pressable
                      key={x.studentId}
                      disabled={x.finalDone}
                      onPress={() => nav.navigate("MeetingSummaryWrite", { meetingId: m.meetingId, studentId: x.studentId, studentName: x.name })}
                      style={{ minHeight: 40, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(3), borderRadius: 8, backgroundColor: c.surfaceAlt }}
                    >
                      <Text style={{ color: c.textPrimary, flex: 1 }}>{x.name}</Text>
                      <Text style={{ color: c.onPrimaryContainer, fontWeight: "600", fontSize: 13 }}>{x.finalDone ? STR.mcStateDone : STR.mcEdit}</Text>
                    </Pressable>
                  ))
                : null}
            </Card>
          );
        }),
      )}
    </>
  );
}
