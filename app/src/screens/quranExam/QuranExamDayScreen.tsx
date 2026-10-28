/**
 * QuranExamDayScreen (D-#875/#876, mockup screen 12) — one exam day for the Office:
 * every examiner and their students in time order.
 *
 *  - Move a student: pick another examiner; the new time is previewed (same time when that
 *    examiner is free, otherwise right after their last student) before tapping.
 *  - Add an examiner (any teacher; warned that a class may need a cover) / remove one
 *    (their students are shared out fewest-first on the server).
 *  - Absent student: schedule the make-up (date, start, examiner).
 *  Tapping a student opens the mark screen (Office can enter or correct marks).
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  QX_ADD_EXAMINER,
  QX_CANDIDATES,
  QX_DAY,
  QX_EXAMS,
  QX_MAKE_UP,
  QX_MOVE,
  QX_REMOVE_EXAMINER,
  type QxDayT,
  type QxSittingT,
} from "../../graphql/quranExam";
import { Body, Button, Card, Chip, Field, H2, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { qxLaterThan, qxPlaceForMove, qxRange, qxReasonLabel } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { SittingRow } from "./MyQuranExamScreen";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamDay">;

function MovePanel({ day, s, onDone }: { day: QxDayT; s: QxSittingT; onDone: (err: string | null) => void }): React.ReactElement {
  const [m, move] = useMutation(QX_MOVE);
  const dayEnd = day.examiners
    .flatMap((e) => e.sittings)
    .map((x) => x.end)
    .reduce((a, b) => (qxLaterThan(b, a) ? b : a), "00:00");
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>{STR.qxMoveTo.replace("{name}", s.studentName)}</Body>
      <Muted>{STR.qxMoveNote}</Muted>
      <View style={{ gap: space(2), marginTop: space(2) }}>
        {day.examiners
          .filter((e) => e.userId !== s.examinerId)
          .map((e) => {
            const busy = e.sittings.filter((x) => x.status !== "ABSENT");
            const at = qxPlaceForMove({ start: s.start, end: s.end }, busy);
            const late = qxLaterThan(at.end, dayEnd);
            return (
              <Card
                key={e.userId}
                onPress={async () => {
                  const r = await move({ id: s.id, toExaminerId: e.userId });
                  onDone(r.error ? friendlyError(r.error) : null);
                }}
              >
                <Body style={{ fontWeight: "700" }}>{e.name}</Body>
                <Muted>
                  {STR.qxStudentsN.replace("{n}", bnNum(busy.length))} ·{" "}
                  {at.kept ? STR.qxMoveKeep.replace("{t}", qxRange(at.start, at.end)) : STR.qxMoveNext.replace("{t}", qxRange(at.start, at.end))}
                  {late ? ` · ${STR.qxMoveLate}` : ""}
                </Muted>
              </Card>
            );
          })}
        <Button title={STR.qxCancel} variant="ghost" loading={m.fetching} onPress={() => onDone(null)} />
      </View>
    </Card>
  );
}

function MakeUpPanel({ day, s, defaultDate, onDone }: { day: QxDayT; s: QxSittingT; defaultDate: string; onDone: (err: string | null) => void }): React.ReactElement {
  const [m, save] = useMutation(QX_MAKE_UP);
  const [dateKey, setDateKey] = React.useState(defaultDate);
  const [start, setStart] = React.useState("07:00");
  const [examinerId, setExaminerId] = React.useState<string | null>(s.examinerId);
  return (
    <Card>
      <Body style={{ fontWeight: "700" }}>
        {STR.qxMakeUp} · {s.studentName}
      </Body>
      <Muted>{qxReasonLabel(s.absenceReason)}</Muted>
      <Field label={STR.qxMakeUpDate} value={dateKey} onChangeText={setDateKey} />
      <Field label={STR.qxMakeUpStart} value={start} onChangeText={setStart} />
      <Select
        label={STR.qxMakeUpExaminer}
        value={examinerId}
        options={day.examiners.map((e) => ({ label: e.name, value: e.userId }))}
        onChange={setExaminerId}
      />
      <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
        <Button
          title={STR.qxMakeUpSave}
          loading={m.fetching}
          disabled={!examinerId}
          onPress={async () => {
            const r = await save({ id: s.id, dateKey: dateKey.trim(), start: start.trim(), examinerId: examinerId! });
            onDone(r.error ? friendlyError(r.error) : null);
          }}
        />
        <Button title={STR.qxCancel} variant="ghost" onPress={() => onDone(null)} />
      </View>
    </Card>
  );
}

export default function QuranExamDayScreen({ route, navigation }: Props): React.ReactElement {
  const { examId, dateKey } = route.params;
  const { can } = useAuth();
  const manage = can("quran_exam:manage");
  const { confirmAction } = useConfirm();
  const [q, reexec] = useQuery({ query: QX_DAY, variables: { examId, dateKey } });
  const [exams] = useQuery({ query: QX_EXAMS });
  const [cands] = useQuery({ query: QX_CANDIDATES, pause: !manage });
  const [, addExaminer] = useMutation(QX_ADD_EXAMINER);
  const [, removeExaminer] = useMutation(QX_REMOVE_EXAMINER);
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [makeUp, setMakeUp] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const day = q.data?.quranExamDay;
  const plan = exams.data?.quranExams?.find((e) => e.examId === examId);
  const locked = !!plan?.marksLockedAt;
  const done = (e: string | null) => {
    setErr(e);
    setMoving(null);
    setMakeUp(null);
    refetch();
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <H2>{fullDateLabel(dateKey)}</H2>
      {err ? <Notice tone="danger" message={err} /> : null}
      <QueryGate result={q} onRetry={refetch}>
        {day ? (
          <View style={{ gap: space(4), marginTop: space(2) }}>
            {day.examiners.map((e) => (
              <View key={e.userId} style={{ gap: space(2) }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{e.name}</Body>
                    <Muted>{STR.qxStudentsN.replace("{n}", bnNum(e.sittings.length))}</Muted>
                  </View>
                  {manage && !locked ? (
                    <Button
                      title={STR.qxRemoveExaminer}
                      variant="danger"
                      onPress={async () => {
                        const n = e.sittings.length;
                        if (n && !(await confirmAction({ title: STR.qxRemoveExaminer, message: STR.qxRemoveConfirm.replace("{name}", e.name).replace("{n}", bnNum(n)) }))) return;
                        const r = await removeExaminer({ examId, dateKey, userId: e.userId });
                        done(r.error ? friendlyError(r.error) : null);
                      }}
                    />
                  ) : null}
                </View>
                {!e.sittings.length ? <Muted>{STR.qxNoStudentsYet}</Muted> : null}
                {e.sittings.map((s) => (
                  <View key={s.id} style={{ gap: space(1) }}>
                    <SittingRow s={s} onPress={() => navigation.navigate("QuranExamSitting", { id: s.id })} />
                    {manage && !locked ? (
                      <View style={{ flexDirection: "row", gap: space(2) }}>
                        <Chip label={STR.qxMove} selected={moving === s.id} onPress={() => setMoving(moving === s.id ? null : s.id)} />
                        {s.status === "ABSENT" ? (
                          <Chip label={STR.qxMakeUp} selected={makeUp === s.id} onPress={() => setMakeUp(makeUp === s.id ? null : s.id)} />
                        ) : null}
                      </View>
                    ) : null}
                    {moving === s.id ? <MovePanel day={day} s={s} onDone={done} /> : null}
                    {makeUp === s.id ? <MakeUpPanel day={day} s={s} defaultDate={plan?.makeUpDateKey ?? dateKey} onDone={done} /> : null}
                  </View>
                ))}
              </View>
            ))}

            {manage && !locked ? (
              adding ? (
                <Card>
                  <Select
                    label={STR.qxAddPick}
                    value={null}
                    placeholder={STR.qxAddPick}
                    searchable
                    options={(cands.data?.quranExamExaminerCandidates ?? [])
                      .filter((c) => !day.examiners.some((e) => e.userId === c.userId))
                      .map((c) => ({ label: c.name, value: c.userId }))}
                    onChange={async (userId) => {
                      setAdding(false);
                      const r = await addExaminer({ examId, dateKey, userId });
                      done(r.error ? friendlyError(r.error) : null);
                    }}
                  />
                  <Muted>{STR.qxAddWarn}</Muted>
                  <Button title={STR.qxCancel} variant="ghost" onPress={() => setAdding(false)} />
                </Card>
              ) : (
                <Button title={STR.qxAddExaminer} variant="secondary" onPress={() => setAdding(true)} />
              )
            ) : null}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
