/**
 * QuranExamMonitorScreen (D-#878, mockup screens 8–9) — the Office's progress board:
 * how many sittings are marked, which examiners still owe marks for sittings whose time
 * has passed (with a reminder per examiner and for everyone), and the absent students
 * waiting for a make-up (each opens its day, where the make-up is set).
 */
import React from "react";
import { RefreshControl, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_MONITOR, QX_REMIND } from "../../graphql/quranExam";
import { Badge, Body, Button, Card, H2, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { usePullRefresh } from "../../lib/useRefresh";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, fullDateLabel } from "../../lib/labels";
import { qxReasonLabel, qxTime } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { SittingRow } from "./MyQuranExamScreen";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamMonitor">;

export default function QuranExamMonitorScreen({ route, navigation }: Props): React.ReactElement {
  const { examId } = route.params;
  const { can } = useAuth();
  const [q, reexec] = useQuery({ query: QX_MONITOR, variables: { examId }, requestPolicy: "cache-and-network" });
  const [rm, remind] = useMutation(QX_REMIND);
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, refetch);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const m = q.data?.quranExamMonitor;

  async function send(userIds: string[] | null) {
    const r = await remind({ examId, userIds });
    if (r.error) setMsg({ tone: "danger", text: friendlyError(r.error) });
    else setMsg({ tone: "ok", text: STR.qxReminded.replace("{n}", bnNum(r.data?.remindQuranExamExaminers ?? 0)) });
    refetch();
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <QueryGate result={q} onRetry={refetch}>
        {m ? (
          <View style={{ gap: space(3) }}>
            <Muted>{STR.qxAsOf.replace("{d}", fullDateLabel(m.asOfDateKey)).replace("{t}", qxTime(m.asOfTime))}</Muted>
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.qxMarked.replace("{n}", bnNum(m.done)).replace("{m}", bnNum(m.total))}</Body>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), marginTop: space(1) }}>
                <Badge text={STR.qxOverdueN.replace("{n}", bnNum(m.overdue))} tone={m.overdue ? "warn" : "muted"} />
                <Badge text={`${STR.qxAbsent} ${bnNum(m.absent)}`} tone={m.absent ? "danger" : "muted"} />
                <Badge text={STR.qxUpcomingN.replace("{n}", bnNum(m.upcoming))} tone="info" />
              </View>
            </Card>
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}

            <H2>{STR.qxOverdueN.replace("{n}", bnNum(m.overdue))}</H2>
            {!m.examiners.length ? <Muted>{STR.qxAllMarked}</Muted> : null}
            {m.examiners.map((e) => (
              <Card key={e.userId}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: "700" }}>{e.name}</Body>
                    <Muted>
                      {STR.qxOverdueN.replace("{n}", bnNum(e.overdue))}
                      {e.remindedAt ? ` · ${e.reminderSeenAt ? STR.qxReminderSeen : STR.qxReminderUnseen}` : ""}
                    </Muted>
                  </View>
                  {can("quran_exam:remind") ? (
                    <Button title={STR.qxRemind} variant="secondary" loading={rm.fetching} onPress={() => send([e.userId])} />
                  ) : null}
                </View>
                <View style={{ gap: space(1), marginTop: space(2) }}>
                  {e.sittings.map((s) => (
                    <SittingRow key={s.id} s={s} onPress={() => navigation.navigate("QuranExamSitting", { id: s.id })} />
                  ))}
                </View>
              </Card>
            ))}
            {m.examiners.length && can("quran_exam:remind") ? (
              <Button title={STR.qxRemindAll} loading={rm.fetching} onPress={() => send(null)} />
            ) : null}

            <H2>{STR.qxAbsentList}</H2>
            {!m.absentSittings.length ? <Muted>{STR.qxNoAbsent}</Muted> : null}
            {m.absentSittings.map((s) => (
              <View key={s.id} style={{ gap: space(1) }}>
                <SittingRow s={s} showExaminer onPress={() => navigation.navigate("QuranExamDay", { examId, dateKey: s.dateKey })} />
                <Muted>
                  {qxReasonLabel(s.absenceReason)} · {STR.qxOpenDay}
                </Muted>
              </View>
            ))}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
