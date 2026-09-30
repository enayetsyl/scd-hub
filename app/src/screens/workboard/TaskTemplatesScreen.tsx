/**
 * TaskTemplatesScreen (WB-2, D-#701) — recurring tasks. A tasks:assign holder sees
 * every template; anyone else the ones on their own board. Pause/resume in place;
 * "নতুন নিয়মিত কাজ" opens the form in template mode.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { SET_TASK_TEMPLATE_ACTIVE, TASK_TEMPLATES_QUERY, type TaskTemplateT } from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Badge, EmptyState, Notice } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { STR, bnNum, daySlotLabel, taskRecurrenceLabel, weekdayShortLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { minutesLabel } from "../../lib/workBoardNav";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "TaskTemplates">;

function scheduleLabel(t: TaskTemplateT): string {
  if (t.recurrence === "WEEKLY") return `${taskRecurrenceLabel(t.recurrence)} · ${t.weekdays.map(weekdayShortLabel).join(", ")}`;
  if (t.recurrence === "MONTHLY") return `${taskRecurrenceLabel(t.recurrence)} · ${bnNum(t.monthDay ?? 0)}`;
  return taskRecurrenceLabel(t.recurrence);
}

export default function TaskTemplatesScreen({ navigation }: Props): React.ReactElement {
  const [q, refetchQ] = useQuery({ query: TASK_TEMPLATES_QUERY, requestPolicy: "cache-and-network" });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const [, setActive] = useMutation(SET_TASK_TEMPLATE_ACTIVE);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const templates = q.data?.taskTemplates ?? [];

  async function toggle(t: TaskTemplateT): Promise<void> {
    setError(null);
    setBusyId(t.id);
    const res = await setActive({ id: t.id, active: !t.active });
    setBusyId(null);
    if (res.error) setError(friendlyError(res.error));
    else refetch();
  }

  return (
    <Screen scroll>
      <View style={{ marginBottom: space(3) }}>
        <Button title={`+ ${STR.wbNewTemplate}`} variant="secondary" onPress={() => navigation.navigate("TaskForm", { template: true })} />
      </View>
      {error ? <Notice message={error} tone="danger" /> : null}
      <QueryGate result={q} onRetry={refetch} isEmpty={templates.length === 0} empty={<EmptyState message={STR.wbNoTemplates} />}>
        {templates.map((t) => (
          <Card key={t.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space(2) }}>
              <Body style={{ fontWeight: "700", flex: 1 }}>{t.titleBn}</Body>
              <Badge text={t.active ? STR.wbActive : STR.wbPaused} tone={t.active ? "ok" : "muted"} />
            </View>
            <Muted>{`${t.assigneeName ?? "—"}${t.forLabel ? ` · ${t.forLabel}` : ""}`}</Muted>
            <Muted>{`${scheduleLabel(t)} · ${daySlotLabel(t.slot)} · ${minutesLabel(t.effortMin, bnNum)}`}</Muted>
            <View style={{ marginTop: space(2) }}>
              <Button title={t.active ? STR.wbPause : STR.wbResume} variant="secondary" loading={busyId === t.id} onPress={() => toggle(t)} />
            </View>
          </Card>
        ))}
      </QueryGate>
    </Screen>
  );
}
