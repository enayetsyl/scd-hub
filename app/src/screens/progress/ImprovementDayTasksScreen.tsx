/**
 * ImprovementDayTasksScreen (SP-4, docs/prd-student-progress.md §6–§7, D-#737/#738) — every
 * teacher task of today for Office / Principal, not-ticked first: who does it (the cover
 * teacher on a leave day), and "Mark done on behalf" (with how they know) or "Mark
 * couldn't". The 11:00 notification opens this list.
 */
import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { IMPROVEMENT_ON_BEHALF_REASONS, IMPROVEMENT_TEACHER_REASONS } from "@scd/shared";
import { IMPROVEMENT_DAY_TASKS, TICK_IMPROVEMENT_TASK, UNTICK_IMPROVEMENT_TASK } from "../../graphql/improvement";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Notice, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, improvementReasonLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { usePullRefresh } from "../../lib/useRefresh";
import { taskTargetLabel } from "../../components/ImprovementTasksTeacherCard";
import { useColors } from "../../theme";
import { radius, space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<ClassTestStackParamList, "ImprovementDayTasks">;

export default function ImprovementDayTasksScreen({ navigation }: Props): React.ReactElement {
  const c = useColors();
  const [q, refetch] = useQuery({ query: IMPROVEMENT_DAY_TASKS, requestPolicy: "cache-and-network" });
  const { refreshing, onRefresh } = usePullRefresh(q.fetching, () => refetch({ requestPolicy: "network-only" }));
  const [, tick] = useMutation(TICK_IMPROVEMENT_TASK);
  const [, untick] = useMutation(UNTICK_IMPROVEMENT_TASK);
  const [open, setOpen] = React.useState<{ id: string; mode: "DONE" | "COULDNT" } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const rows = [...(q.data?.improvementDayTasks ?? [])].sort((a, b) => Number(!!a.status) - Number(!!b.status));
  const pending = rows.filter((r) => !r.status).length;

  async function run(p: Promise<{ error?: unknown }>): Promise<void> {
    setErr(null);
    const res = await p;
    if (res.error) setErr(friendlyError(res.error as never));
    setOpen(null);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Badge text={`${STR.impNotTicked}: ${bnNum(pending)}`} tone={pending ? "warn" : "ok"} />
            <Badge text={`${STR.impDoneWord}: ${bnNum(rows.length - pending)}`} tone="ok" />
          </View>
          {err ? <Notice message={err} tone="danger" /> : null}
          {rows.length === 0 ? <EmptyState message={STR.impAllDone} /> : null}
          {rows.map((r) => (
            <Card key={r.actionId}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space(2) }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>{r.responsibleName ?? STR.impNobody}</Body>
                {r.responsibleSource === "COVER" ? <Badge text={`${STR.impCoveringFor} ${r.assignedTeacherName ?? ""}`} tone="warn" /> : null}
                {r.responsibleSource === "NONE" ? <Badge text={STR.impNeedsPerson} tone="danger" /> : null}
              </View>
              <Text style={{ color: c.info, fontWeight: "600" }} onPress={() => navigation.navigate("ImprovementAction", { id: r.actionId })}>
                {taskTargetLabel(r)}
              </Text>
              <Text style={{ color: c.textPrimary }}>{r.task}</Text>
              <Muted>
                {STR.impDay} {bnNum(r.dayNumber)}/{bnNum(r.totalDays)}
              </Muted>
              {r.status ? (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: r.status === "DONE" ? c.primaryContainer : c.warningContainer, borderRadius: radius.sm, paddingHorizontal: space(2), marginTop: 4 }}>
                  <Text style={{ color: r.status === "DONE" ? c.onPrimaryContainer : c.warning, fontWeight: "600", paddingVertical: 8, flex: 1 }}>
                    {r.status === "DONE" ? STR.impLegendDone : STR.impLegendCouldnt}
                    {r.markedByName ? ` — ${r.markedByName}` : ""}
                    {r.reason ? ` (${improvementReasonLabel(r.reason)})` : ""}
                  </Text>
                  {r.markedByMe ? <Button title={STR.impUndo} variant="ghost" onPress={() => void run(untick({ actionId: r.actionId, dayKey: r.dayKey }))} /> : null}
                </View>
              ) : open?.id === r.actionId ? (
                <View style={{ gap: 4, marginTop: 4 }}>
                  <Muted>{open.mode === "DONE" ? STR.impHowKnow : STR.impWhyNot}</Muted>
                  <ChipRow>
                    {(open.mode === "DONE" ? IMPROVEMENT_ON_BEHALF_REASONS : IMPROVEMENT_TEACHER_REASONS).map((reason) => (
                      <Chip key={reason} label={improvementReasonLabel(reason)} onPress={() => void run(tick({ actionId: r.actionId, dayKey: r.dayKey, status: open.mode, reason }))} />
                    ))}
                  </ChipRow>
                </View>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: 4 }}>
                  <Button title={STR.impMarkOnBehalf} onPress={() => setOpen({ id: r.actionId, mode: "DONE" })} />
                  <Button title={STR.impMarkCouldnt} variant="secondary" onPress={() => setOpen({ id: r.actionId, mode: "COULDNT" })} />
                </View>
              )}
            </Card>
          ))}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
