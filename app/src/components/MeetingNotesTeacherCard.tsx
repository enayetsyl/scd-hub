/**
 * MeetingNotesTeacherCard (MC-3, docs/prd-meeting-comments.md §5, D-#752) — the subject
 * teacher's "Parents' meeting comments" on Today: per class × subject, the children still
 * due first (each opens the write screen), the written ones folded away.
 *
 * Self-contained (own query) and mounted OUTSIDE Today's QueryGate: comments are owed on
 * a day with no periods too (the TodayWorkCard lesson). Renders nothing while loading,
 * when there is no open meeting with rows for the caller, and on error.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "urql";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MY_MEETING_NOTE_WORK, type NoteWorkGroupT } from "../graphql/meetingChain";
import { Badge, Body, Muted } from "./ui";
import { FoldCard } from "./FoldCard";
import { STR, bnNum, routineSubjectLabel } from "../lib/labels";
import { dayLabel, placeLabel } from "./MeetingChainParts";
import { useColors } from "../theme";
import { space } from "../theme/tokens";
import type { HomeStackParamList } from "../navigation/types";

type Nav = NativeStackNavigationProp<HomeStackParamList>;

function Group({ meetingId, g, initiallyOpen }: { meetingId: string; g: NoteWorkGroupT; initiallyOpen: boolean }): React.ReactElement {
  const c = useColors();
  const nav = useNavigation<Nav>();
  const [open, setOpen] = React.useState(initiallyOpen);
  const [showDone, setShowDone] = React.useState(false);
  const due = g.students.filter((s) => !s.written && !s.skipped && !s.locked);
  const done = g.students.filter((s) => s.written);
  const pct = g.total ? Math.round((g.written / g.total) * 100) : 100;
  const queue = due.map((s) => s.studentId);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: space(2), paddingTop: space(1) }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space(2) }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Body style={{ fontWeight: "700" }}>
            {placeLabel(g)} · {routineSubjectLabel(g.subject)}
          </Body>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <View style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: c.surfaceAlt, overflow: "hidden" }}>
              <View style={{ width: `${pct}%`, height: 6, backgroundColor: c.primary }} />
            </View>
            <Muted>
              {bnNum(g.written)}/{bnNum(g.total)} {STR.mcWrittenOf}
            </Muted>
          </View>
        </View>
        <Text style={{ color: c.textSecondary, fontSize: 16 }}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 6, paddingBottom: space(2) }}>
          {due.length === 0 ? <Muted>{STR.mcGroupDone}</Muted> : null}
          {due.map((s) => (
            <Pressable
              key={s.studentId}
              onPress={() => nav.navigate("MeetingSubjectNote", { meetingId, studentId: s.studentId, subject: g.subject, queue })}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space(2),
                paddingHorizontal: space(3),
                borderRadius: 8,
                backgroundColor: c.warningContainer,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: c.textPrimary, fontWeight: "600", flex: 1 }}>{s.name}</Text>
              <Text style={{ color: c.warning, fontWeight: "700" }}>{STR.mcWrite}</Text>
            </Pressable>
          ))}
          {done.length ? (
            <Pressable onPress={() => setShowDone(!showDone)} style={{ minHeight: 40, justifyContent: "center" }}>
              <Text style={{ color: c.info, fontWeight: "600" }}>
                {showDone ? STR.mcHide : `${STR.mcShowDone} (${bnNum(done.length)})`}
              </Text>
            </Pressable>
          ) : null}
          {showDone
            ? done.map((s) => (
                <Pressable
                  key={s.studentId}
                  disabled={s.locked}
                  onPress={() => nav.navigate("MeetingSubjectNote", { meetingId, studentId: s.studentId, subject: g.subject })}
                  style={{ minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(3), borderRadius: 8, backgroundColor: c.surfaceAlt }}
                >
                  <Text style={{ color: c.textPrimary, flex: 1 }}>{s.name}</Text>
                  <Text style={{ color: c.onPrimaryContainer, fontWeight: "600" }}>
                    {STR.mcDoneShort}
                    {s.locked ? ` · ${STR.mcLocked}` : ` · ${STR.mcEdit}`}
                  </Text>
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

export function MeetingNotesTeacherCard(): React.ReactElement | null {
  const [q, refetch] = useQuery({ query: MY_MEETING_NOTE_WORK, requestPolicy: "cache-and-network" });
  useFocusEffect(
    React.useCallback(() => {
      refetch({ requestPolicy: "network-only" });
    }, [refetch]),
  );
  const meetings = q.data?.myMeetingNoteWork ?? [];
  if (q.error || meetings.length === 0) return null;
  return (
    <>
      {meetings.map((m) => {
        const firstDue = m.groups.findIndex((g) => g.due > 0);
        // D-#758: the due count and the dates are the summary; the class × subject groups open on tap.
        return (
          <FoldCard
            key={m.meetingId}
            id={`today:meetingNotes:${m.meetingId}`}
            title={STR.mcTodayNotesTitle}
            aside={<Badge text={m.due ? `${bnNum(m.due)} ${STR.mcDue}` : STR.mcAllDone} tone={m.due ? "warn" : "ok"} />}
            summary={
              <Muted>
                {STR.mcMeetingOn} {dayLabel(m.meetingDateKey)} · {STR.mcNotesDueBy} {dayLabel(m.subjectDueKey)}
              </Muted>
            }
          >
            {m.groups.map((g, i) => (
              <Group key={`${g.sectionId}-${g.subject}`} meetingId={m.meetingId} g={g} initiallyOpen={i === firstDue} />
            ))}
          </FoldCard>
        );
      })}
    </>
  );
}
