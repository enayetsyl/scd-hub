/**
 * ExamDutyRosterScreen (D-#1660) — "পরীক্ষার ডিউটি", the Office's roster: every sitting of the
 * exam routine by day with the teachers on duty, conflicts flagged (same teacher at the same
 * time, approved leave), and a per-teacher count so the load can be kept fair. Tap a sitting's
 * "ডিউটি দিন" / "বদলান" to put someone on or swap them (a reason is needed to swap or remove);
 * the teacher gets a notification either way. Takes no params.
 */
import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import {
  ASSIGN_EXAM_DUTY,
  CLEAR_EXAM_DUTY,
  EXAM_DUTY_CANDIDATES,
  EXAM_DUTY_ROSTER,
  type ExamDutySittingT,
  type ExamDutyT,
} from "../../graphql/examDuty";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, Field, H2, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { currentExamId } from "../../components/ExamRoutineView";
import { useSyllabusPickers } from "../../lib/useSyllabusPickers";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, dhakaDateKey, fullDateLabel, routineSubjectLabel } from "../../lib/labels";
import { qxRange } from "../../lib/quranExam";
import { space, typeScale } from "../../theme/tokens";

/** Mirrors the server cap (ExamDutyService MAX_SEAT). */
const MAX_SEAT = 6;
const sittingKey = (s: ExamDutySittingT) => `${s.classId}|${s.dateKey}|${s.subject}|${s.kind}`;

interface Editing {
  key: string;
  seat: number;
  duty: ExamDutyT | null;
}

export default function ExamDutyRosterScreen(): React.ReactElement {
  const pick = useSyllabusPickers();
  const [chosen, setChosen] = useState<string | null>(null);
  const examId = chosen ?? currentExamId(pick.exams, dhakaDateKey());
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [room, setRoom] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const [q, reexec] = useQuery({ query: EXAM_DUTY_ROSTER, variables: { examId: examId ?? "" }, pause: !examId });
  const [cq] = useQuery({ query: EXAM_DUTY_CANDIDATES });
  const [saving, assign] = useMutation(ASSIGN_EXAM_DUTY);
  const [removing, clear] = useMutation(CLEAR_EXAM_DUTY);
  const refetch = React.useCallback(() => examId && reexec({ requestPolicy: "network-only" }), [examId, reexec]);
  const refresh = usePullRefresh(q.fetching, () => {
    pick.refetch();
    refetch();
  });
  const r = q.data?.sittingDutyRoster ?? null;
  const candidates = cq.data?.sittingDutyCandidates ?? [];

  if (!pick.loading && pick.exams.length === 0) {
    return (
      <Screen scroll>
        <EmptyState message={STR.syNoExam} />
      </Screen>
    );
  }

  const days = [...new Set((r?.sittings ?? []).map((s) => s.dateKey))];
  const shown = (r?.sittings ?? []).filter((s) => !day || s.dateKey === day);

  const open = (s: ExamDutySittingT, seat: number, duty: ExamDutyT | null) => {
    setMsg(null);
    setEditing({ key: sittingKey(s), seat, duty });
    setTeacherId(duty?.teacherId ?? null);
    setRoom(duty?.room ?? "");
    setReason("");
  };

  async function save(s: ExamDutySittingT) {
    if (!editing || !teacherId || !examId) return;
    const res = await assign({
      examId,
      classId: s.classId,
      dateKey: s.dateKey,
      subject: s.subject,
      kind: s.kind,
      seat: editing.seat,
      teacherId,
      room: room.trim() || null,
      reason: reason.trim() || null,
    });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.edSaved });
    setEditing(null);
    refetch();
  }

  async function remove() {
    if (!editing?.duty) return;
    const res = await clear({ dutyId: editing.duty.id, reason: reason.trim() });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.edRemoved });
    setEditing(null);
    refetch();
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} />}>
      <Select
        label={STR.syPickExam}
        value={examId}
        options={pick.exams.map((e) => ({ label: e.name, value: e.id }))}
        onChange={(v) => {
          setChosen(v);
          setDay(null);
          setEditing(null);
        }}
      />
      <QueryGate result={q} onRetry={refetch}>
        {r ? (
          <View style={{ gap: space(3), marginTop: space(3) }}>
            <Muted>{STR.edHint}</Muted>
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
            {r.sittings.length === 0 ? (
              <EmptyState message={STR.edNoRoutine} />
            ) : (
              <>
                <Badge
                  tone={r.emptyCount || r.conflictCount ? "warn" : "ok"}
                  text={STR.edSummary.replace("{empty}", bnNum(r.emptyCount)).replace("{conflicts}", bnNum(r.conflictCount))}
                />
                <ChipRow>
                  <Chip label={STR.edAllDays} selected={!day} onPress={() => setDay(null)} />
                  {days.map((d) => (
                    <Chip key={d} label={fullDateLabel(d)} selected={day === d} onPress={() => setDay(d)} />
                  ))}
                </ChipRow>

                {shown.map((s) => (
                  <Card key={sittingKey(s)}>
                    <Body style={{ ...typeScale.bodyStrong }}>
                      {s.classLabelBn} · {routineSubjectLabel(s.subject, s.level)}
                    </Body>
                    <Muted>
                      {fullDateLabel(s.dateKey)} · {s.kind === "ORAL" ? STR.exrOral : STR.exrWritten}
                      {s.start && s.end ? ` · ${qxRange(s.start, s.end)}` : ""}
                    </Muted>
                    <View style={{ gap: space(2), marginTop: space(2) }}>
                      {s.duties.length === 0 ? <Muted>{STR.edNobody}</Muted> : null}
                      {s.duties.map((d) => (
                        <View key={d.id} style={{ gap: 4 }}>
                          <Body style={{ ...typeScale.bodyStrong }}>
                            {d.teacherName}
                            {d.room ? ` · ${STR.edRoomPrefix.replace("{room}", d.room)}` : ""}
                          </Body>
                          {d.conflicts.map((c) => (
                            <Badge key={c} tone="danger" text={(STR as unknown as Record<string, string>)[`edConflict${c}`] ?? c} />
                          ))}
                          <View>
                            <Button title={STR.edChange} variant="ghost" onPress={() => open(s, d.seat, d)} />
                          </View>
                        </View>
                      ))}
                      {!s.orphan && s.duties.length < MAX_SEAT && editing?.key !== sittingKey(s) ? (
                        <Button
                          title={s.duties.length ? STR.edAddSecond : STR.edAdd}
                          variant="secondary"
                          onPress={() => open(s, Math.max(0, ...s.duties.map((d) => d.seat)) + 1, null)}
                        />
                      ) : null}
                    </View>

                    {editing?.key === sittingKey(s) ? (
                      <View style={{ gap: space(2), marginTop: space(3) }}>
                        <Select
                          label={STR.edPickTeacher}
                          value={teacherId}
                          searchable
                          options={candidates.map((c) => ({ label: c.name, value: c.userId }))}
                          onChange={setTeacherId}
                        />
                        <Field label={STR.edRoom} value={room} onChangeText={setRoom} />
                        {editing.duty ? <Field label={STR.edReason} value={reason} onChangeText={setReason} multiline /> : null}
                        <Button title={STR.edSave} onPress={() => save(s)} loading={saving.fetching} disabled={!teacherId} />
                        {editing.duty ? (
                          <Button title={STR.edRemove} variant="danger" onPress={remove} loading={removing.fetching} disabled={reason.trim().length < 3} />
                        ) : null}
                        <Button title={STR.cancel} variant="ghost" onPress={() => setEditing(null)} />
                      </View>
                    ) : null}
                  </Card>
                ))}

                {r.counts.length ? (
                  <Card>
                    <H2>{STR.edCounts}</H2>
                    <View style={{ gap: 4, marginTop: space(2) }}>
                      {r.counts.map((c) => (
                        <View key={c.teacherId} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
                          <Body style={{ flex: 1 }}>{c.teacherName}</Body>
                          <Body style={{ ...typeScale.bodyStrong }}>{bnNum(c.count)}</Body>
                        </View>
                      ))}
                    </View>
                  </Card>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
