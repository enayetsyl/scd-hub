/**
 * MeetingCommentsScreen (MC-4, docs/prd-meeting-comments.md §2/§5, D-#753/#756;
 * roster:manage) — the Office/Principal side of a meeting's comment chain:
 *
 *   - open comment collection with two due dates (who comments on whom = today's routine),
 *     change the dates, refresh the teacher list;
 *   - progress tiles (subject notes · class-teacher summaries · finals);
 *   - by section, each subject with its teacher and count — skip a subject (teacher on
 *     leave / left / not taught) so the class teacher is not held up, or restore it;
 *   - comments left by teacher, with "Send reminder";
 *   - on to the final comments.
 */
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  MEETING_COMMENT_PROGRESS,
  OPEN_MEETING_COMMENTS,
  REFRESH_MEETING_COMMENT_ROSTER,
  REMIND_MEETING_TEACHER,
  SET_MEETING_SUBJECT_SKIPPED,
  type ProgressSectionT,
} from "../../graphql/meetingChain";
import { Badge, Body, Button, Card, Chip, ChipRow, Loader, Muted, Notice, Screen } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { dayLabel, placeLabel } from "../../components/MeetingChainParts";
import { STR, bnNum, dhakaDateKey, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import type { CommentsStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<CommentsStackParamList, "MeetingComments">;

const addDays = (key: string, n: number): string => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const maxKey = (a: string, b: string): string => (a > b ? a : b);

function ProgressTile({ label, done, total, note, color }: { label: string; done: number; total: number; note: string; color: string }): React.ReactElement {
  const c = useColors();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Card style={{ flexGrow: 1, flexBasis: 240 }}>
      <Muted>{label}</Muted>
      <Text style={{ color: c.textPrimary, fontSize: 28, fontWeight: "700" }}>
        {bnNum(done)}
        <Text style={{ fontSize: 16, color: c.textSecondary, fontWeight: "400" }}>/{bnNum(total)}</Text>
      </Text>
      <View style={{ height: 8, borderRadius: 999, backgroundColor: c.surfaceAlt, overflow: "hidden", marginVertical: space(1) }}>
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: color }} />
      </View>
      <Muted>{note}</Muted>
    </Card>
  );
}

export default function MeetingCommentsScreen({ route, navigation }: Props): React.ReactElement {
  const { meetingId, instanceLabel } = route.params;
  const c = useColors();
  const [q, refetch] = useQuery({ query: MEETING_COMMENT_PROGRESS, variables: { meetingId }, requestPolicy: "cache-and-network" });
  const [openM, openComments] = useMutation(OPEN_MEETING_COMMENTS);
  const [refreshM, refresh] = useMutation(REFRESH_MEETING_COMMENT_ROSTER);
  const [, skip] = useMutation(SET_MEETING_SUBJECT_SKIPPED);
  const [, remind] = useMutation(REMIND_MEETING_TEACHER);
  const p = q.data?.meetingCommentProgress ?? null;

  const [subjectDue, setSubjectDue] = React.useState("");
  const [summaryDue, setSummaryDue] = React.useState("");
  const [editingDates, setEditingDates] = React.useState(false);
  const [openSec, setOpenSec] = React.useState<Record<string, boolean>>({});
  const [asking, setAsking] = React.useState<string | null>(null);
  const [reminded, setReminded] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState<{ text: string; tone: "ok" | "danger" | "info" } | null>(null);

  // Seed the dates: the saved ones, else 4 and 2 days before the meeting (never in the past).
  React.useEffect(() => {
    if (!p || subjectDue) return;
    const today = dhakaDateKey();
    setSubjectDue(p.subjectDueKey ?? maxKey(addDays(p.meetingDateKey, -4), today));
    setSummaryDue(p.summaryDueKey ?? maxKey(addDays(p.meetingDateKey, -2), today));
  }, [p, subjectDue]);

  const reload = () => refetch({ requestPolicy: "network-only" });

  async function onOpen(): Promise<void> {
    setMsg(null);
    const res = await openComments({ meetingId, subjectDueKey: subjectDue, summaryDueKey: summaryDue });
    if (res.error) return setMsg({ text: friendlyError(res.error), tone: "danger" });
    const r = res.data?.openMeetingComments;
    setEditingDates(false);
    if (r && (r.inserted || r.retargeted || r.removed)) setMsg({ text: `${STR.mcRosterAdded} ${bnNum(r.inserted)}`, tone: "ok" });
    reload();
  }

  async function onRefresh(): Promise<void> {
    setMsg(null);
    const res = await refresh({ meetingId });
    if (res.error) return setMsg({ text: friendlyError(res.error), tone: "danger" });
    const r = res.data!.refreshMeetingCommentRoster;
    setMsg({ text: `${STR.mcRosterAdded} ${bnNum(r.inserted)} · ${STR.mcRosterChanged} ${bnNum(r.retargeted)} · ${STR.mcRosterRemoved} ${bnNum(r.removed)}`, tone: "ok" });
    reload();
  }

  async function onSkip(sectionId: string, subject: string, reason: string | null): Promise<void> {
    setMsg(null);
    setAsking(null);
    const res = await skip({ meetingId, sectionId, subject, reason });
    if (res.error) setMsg({ text: friendlyError(res.error), tone: "danger" });
    reload();
  }

  async function onRemind(teacherId: string): Promise<void> {
    const res = await remind({ meetingId, teacherId });
    if (res.error) return setMsg({ text: friendlyError(res.error), tone: "danger" });
    setReminded({ ...reminded, [teacherId]: res.data?.remindMeetingTeacher ? STR.mcReminderSent : STR.mcReminderAlready });
  }

  if (!p) return <Screen>{q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : <Loader label={STR.loading} />}</Screen>;

  const dateForm = (
    <View style={{ gap: space(2) }}>
      <DateField label={STR.mcSubjectDueLabel} value={subjectDue} onChange={setSubjectDue} />
      <DateField label={STR.mcSummaryDueLabel} value={summaryDue} onChange={setSummaryDue} />
    </View>
  );

  const sectionRow = (s: ProgressSectionT) => {
    const isOpen = !!openSec[s.sectionId];
    const pct = s.notesTotal ? Math.round(((s.notesWritten + s.notesSkipped) / s.notesTotal) * 100) : 100;
    return (
      <View key={s.sectionId} style={{ borderTopWidth: 1, borderTopColor: c.surfaceAlt }}>
        <Pressable
          onPress={() => setOpenSec({ ...openSec, [s.sectionId]: !isOpen })}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          style={{ minHeight: 56, paddingVertical: space(2), flexDirection: "row", alignItems: "center", gap: space(3), flexWrap: "wrap" }}
        >
          <View style={{ flexBasis: 150, flexGrow: 1 }}>
            <Body style={{ fontWeight: "700" }}>{placeLabel(s)}</Body>
            <Muted>
              {bnNum(s.students)} {STR.mcStudentsN}
            </Muted>
          </View>
          <View style={{ flexBasis: 180, flexGrow: 2, gap: 4 }}>
            <View style={{ height: 8, borderRadius: 999, backgroundColor: c.surfaceAlt, overflow: "hidden" }}>
              <View style={{ width: `${pct}%`, height: 8, backgroundColor: c.primary }} />
            </View>
            <Muted>
              {STR.mcTileNotes} {bnNum(s.notesWritten)}/{bnNum(s.notesTotal)}
              {s.notesSkipped ? ` · ${STR.mcSkipped} ${bnNum(s.notesSkipped)}` : ""}
            </Muted>
          </View>
          <View style={{ flexBasis: 150, flexGrow: 1 }}>
            <Muted>
              {STR.mcTileSummaries} {bnNum(s.summaryDone)}/{bnNum(s.students)}
            </Muted>
            <Muted>
              {STR.mcFinalQueueTitle} {bnNum(s.finalDone)}/{bnNum(s.students)}
            </Muted>
          </View>
          <Text style={{ color: c.textSecondary, fontSize: 16 }}>{isOpen ? "▴" : "▾"}</Text>
        </Pressable>
        {isOpen ? (
          <View style={{ gap: space(2), paddingBottom: space(3) }}>
            <Muted>
              {STR.mcClassTeacher}: {s.classTeacherName ?? "—"}
            </Muted>
            {s.subjects.map((sub) => {
              const key = `${s.sectionId}|${sub.subject}`;
              const left = sub.total - sub.written - sub.skipped;
              const chip = sub.skipped && !left ? { t: `${STR.mcSkipped}${sub.skipReason ? ` · ${sub.skipReason}` : ""}`, tone: "muted" as const } : left === 0 ? { t: STR.mcDoneShort, tone: "ok" as const } : sub.written === 0 ? { t: STR.mcNotStarted, tone: "danger" as const } : { t: `${bnNum(left)} ${STR.mcLeft}`, tone: "warn" as const };
              return (
                <View key={key} style={{ borderWidth: 1, borderColor: c.surfaceAlt, borderRadius: 8, padding: space(3), gap: space(2) }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
                    <Body style={{ fontWeight: "700", minWidth: 90 }}>{routineSubjectLabel(sub.subject)}</Body>
                    <Muted style={{ flexGrow: 1 }}>{sub.teacherNames.join(", ")}</Muted>
                    <Muted>
                      {bnNum(sub.written)}/{bnNum(sub.total)}
                    </Muted>
                    <Badge text={chip.t} tone={chip.tone} />
                  </View>
                  {left > 0 && asking !== key ? <Button title={STR.mcSkipSubject} variant="secondary" onPress={() => setAsking(key)} /> : null}
                  {sub.skipped > 0 ? <Button title={STR.mcUnskip} variant="ghost" onPress={() => void onSkip(s.sectionId, sub.subject, null)} /> : null}
                  {asking === key ? (
                    <View style={{ gap: space(1) }}>
                      <Muted>{STR.mcWhySkip}</Muted>
                      <ChipRow>
                        {[STR.mcSkipLeave, STR.mcSkipLeft, STR.mcSkipNotTaught].map((r) => (
                          <Chip key={r} label={r} onPress={() => void onSkip(s.sectionId, sub.subject, r)} />
                        ))}
                        <Chip label={STR.mcCancel} onPress={() => setAsking(null)} />
                      </ChipRow>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} keyboardShouldPersistTaps="handled">
        <View>
          <Muted>{instanceLabel}</Muted>
          <Body style={{ fontWeight: "700", fontSize: 20 }}>{dayLabel(p.meetingDateKey)}</Body>
          <Muted>
            {bnNum(p.students)} {STR.mcStudentsN}
          </Muted>
        </View>
        {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}

        {!p.open ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.mcOpenTitle}</Body>
            <Muted>{STR.mcOpenHint}</Muted>
            {dateForm}
            <Button title={STR.mcOpenButton} onPress={() => void onOpen()} loading={openM.fetching} style={{ marginTop: space(2) }} />
          </Card>
        ) : (
          <>
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.mcIsOpen}</Body>
              <Muted>{STR.mcOpenHint}</Muted>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(4), marginTop: space(2) }}>
                <View>
                  <Muted>{STR.mcSubjectDueLabel}</Muted>
                  <Body style={{ fontWeight: "700" }}>{p.subjectDueKey ? dayLabel(p.subjectDueKey) : "—"}</Body>
                </View>
                <View>
                  <Muted>{STR.mcSummaryDueLabel}</Muted>
                  <Body style={{ fontWeight: "700" }}>{p.summaryDueKey ? dayLabel(p.summaryDueKey) : "—"}</Body>
                </View>
                <View>
                  <Muted>{STR.mcNumbersCover}</Muted>
                  <Body style={{ fontWeight: "700" }}>
                    {dayLabel(p.fromKey)} – {dayLabel(p.toKey)}
                  </Body>
                </View>
              </View>
              {editingDates ? (
                <View style={{ gap: space(2), marginTop: space(2) }}>
                  {dateForm}
                  <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                    <Button title={STR.mcSaveDates} onPress={() => void onOpen()} loading={openM.fetching} />
                    <Button title={STR.mcCancel} variant="ghost" onPress={() => setEditingDates(false)} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", marginTop: space(2) }}>
                  <Button title={STR.mcChangeDates} variant="secondary" onPress={() => setEditingDates(true)} />
                  <Button title={STR.mcRefreshRoster} variant="secondary" onPress={() => void onRefresh()} loading={refreshM.fetching} />
                  <Button title={STR.mcFinalButton} onPress={() => navigation.navigate("MeetingFinalQueue", { meetingId, instanceLabel })} />
                </View>
              )}
            </Card>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(3) }}>
              <ProgressTile
                label={STR.mcTileNotes}
                done={p.notesWritten + p.notesSkipped}
                total={p.notesTotal}
                note={`${bnNum(p.notesTotal - p.notesWritten - p.notesSkipped)} ${STR.mcLeftToWrite}${p.notesSkipped ? ` · ${STR.mcSkipped} ${bnNum(p.notesSkipped)}` : ""}`}
                color={c.primary}
              />
              <ProgressTile
                label={STR.mcTileSummaries}
                done={p.summaryDone}
                total={p.students}
                note={`${bnNum(p.summaryReady)} ${STR.mcReadyToWrite} · ${bnNum(p.summaryWaiting)} ${STR.mcWaitingOnSubject}`}
                color={c.info}
              />
              <ProgressTile label={STR.mcTileFinals} done={p.finalDone} total={p.students} note={`${bnNum(p.finalReady)} ${STR.mcReadyForYou}`} color={c.gold} />
            </View>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.mcBySection}</Body>
              <Muted>{STR.mcBySectionHint}</Muted>
              <View style={{ marginTop: space(2) }}>{p.sections.map(sectionRow)}</View>
            </Card>

            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.mcByTeacher}</Body>
              <Muted>{STR.mcByTeacherHint}</Muted>
              {p.teachers.length === 0 ? <Notice message={STR.mcNobodyLeft} tone="ok" /> : null}
              {p.teachers.map((t) => (
                <View key={t.teacherId} style={{ borderTopWidth: 1, borderTopColor: c.surfaceAlt, marginTop: space(2), paddingTop: space(2), gap: 4 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
                    <Body style={{ fontWeight: "600", flex: 1 }}>{t.name}</Body>
                    <Text style={{ color: t.left >= 10 ? c.error : c.warning, fontWeight: "700" }}>
                      {bnNum(t.left)} {STR.mcLeft}
                    </Text>
                  </View>
                  <Muted>{t.places.join(" · ")}</Muted>
                  {reminded[t.teacherId] ? (
                    <Badge text={reminded[t.teacherId]} tone="ok" />
                  ) : (
                    <Button title={STR.mcSendReminder} variant="secondary" onPress={() => void onRemind(t.teacherId)} style={{ alignSelf: "flex-start" }} />
                  )}
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
