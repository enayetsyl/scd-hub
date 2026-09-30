/**
 * TaskDetailScreen (WB-1, D-#701) — one manual task. The assignee works it (status,
 * block with a reason, move its slot); the assigner or a tasks:assign holder also
 * edits, moves its day, hands it over, or withdraws it. The server re-gates every
 * button; a denied tap surfaces its Bangla reason.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { DaySlot, TaskStatus } from "@scd/shared";
import { DAY_SLOTS, TASK_STATUSES } from "@scd/shared";
import {
  ASSIGNABLE_STAFF_QUERY,
  CANCEL_TASK,
  MOVE_TASK,
  REASSIGN_TASK,
  SET_TASK_BLOCKED,
  SET_TASK_STATUS,
  TASK_QUERY,
} from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Card, H2, Body, Muted, Row, Button, Chip, ChipRow, Field, Select, Notice, Badge } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, daySlotLabel, isoDateTimeLabel, taskPriorityLabel, taskStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { minutesLabel } from "../../lib/workBoardNav";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "TaskDetail">;

export default function TaskDetailScreen({ route, navigation }: Props): React.ReactElement {
  const { taskId } = route.params;
  const { user, can } = useAuth();
  const [q, refetchQ] = useQuery({ query: TASK_QUERY, variables: { id: taskId }, requestPolicy: "cache-and-network" });
  const refetch = (): void => refetchQ({ requestPolicy: "network-only" });
  const task = q.data?.task ?? null;

  const isAssignee = !!task && task.assigneeUserId === user?.id;
  const canManage = !!task && (task.assignedBy === user?.id || can("tasks:assign"));
  const canWork = isAssignee || canManage;

  const [, setStatus] = useMutation(SET_TASK_STATUS);
  const [, setBlocked] = useMutation(SET_TASK_BLOCKED);
  const [, move] = useMutation(MOVE_TASK);
  const [, reassign] = useMutation(REASSIGN_TASK);
  const [, cancel] = useMutation(CANCEL_TASK);

  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [showBlock, setShowBlock] = React.useState(false);
  const [moveDue, setMoveDue] = React.useState<string>("");
  const [moveSlot, setMoveSlot] = React.useState<DaySlot | null>(null);
  const [showMove, setShowMove] = React.useState(false);
  const [newAssignee, setNewAssignee] = React.useState<string | null>(null);
  const [showReassign, setShowReassign] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const [staffQ] = useQuery({ query: ASSIGNABLE_STAFF_QUERY, pause: !can("tasks:assign") || !showReassign });
  const staff = staffQ.data?.assignableStaff ?? [];

  async function run(label: string, fn: () => Promise<{ error?: unknown }>): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    setOk(label);
    refetch();
  }

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch} isEmpty={!task} empty={<Muted>{STR.wbEmpty}</Muted>}>
        {task ? (
          <>
            <Card>
              <H2>{task.titleBn}</H2>
              {task.notes ? <Body>{task.notes}</Body> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
                <Badge text={taskStatusLabel(task.status)} tone={task.status === "DONE" ? "ok" : task.status === "DOING" ? "warn" : "muted"} />
                <Badge text={taskPriorityLabel(task.priority)} tone={task.priority === "URGENT" ? "danger" : "muted"} />
                {task.blockedReason ? <Badge text={STR.wbBlock} tone="danger" /> : null}
              </View>
              <Row label={STR.wbAssignee} value={task.assigneeName ?? "—"} />
              <Row label={STR.wbAssignedBy} value={task.assignedByName ?? "—"} />
              {task.forLabel ? <Row label={STR.wbForLabel} value={task.forLabel} /> : null}
              <Row label={STR.wbDue} value={bnNum(task.dueKey)} />
              <Row label={STR.wbSlot} value={daySlotLabel(task.slot)} />
              <Row label={STR.wbEffort} value={minutesLabel(task.effortMin, bnNum)} />
              {task.blockedReason ? <Row label={STR.wbBlockReason} value={task.blockedReason} /> : null}
              {task.doneAt ? <Row label={STR.wbDone} value={isoDateTimeLabel(task.doneAt)} /> : null}
            </Card>

            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            {canWork ? (
              <Card>
                <Muted>{STR.wbStatus}</Muted>
                <ChipRow>
                  {TASK_STATUSES.map((s: TaskStatus) => (
                    <Chip
                      key={s}
                      label={taskStatusLabel(s)}
                      selected={task.status === s}
                      onPress={() => {
                        if (task.status !== s && !busy) void run(taskStatusLabel(s), () => setStatus({ id: task.id, status: s }));
                      }}
                    />
                  ))}
                </ChipRow>
                {task.status !== "DONE" ? (
                  task.blockedReason ? (
                    <Button title={STR.wbUnblock} variant="secondary" loading={busy} onPress={() => run(STR.wbUnblock, () => setBlocked({ id: task.id, reason: null }))} />
                  ) : showBlock ? (
                    <View>
                      <Field label={STR.wbBlockReason} value={reason} onChangeText={setReason} />
                      <View style={{ flexDirection: "row", gap: space(2) }}>
                        <Button
                          title={STR.wbBlock}
                          loading={busy}
                          disabled={!reason.trim()}
                          onPress={() =>
                            run(STR.wbBlock, () => setBlocked({ id: task.id, reason: reason.trim() })).then(() => {
                              setShowBlock(false);
                              setReason("");
                            })
                          }
                        />
                        <Button title={STR.cancel} variant="ghost" onPress={() => setShowBlock(false)} />
                      </View>
                    </View>
                  ) : (
                    <Button title={STR.wbBlock} variant="secondary" onPress={() => setShowBlock(true)} />
                  )
                ) : null}
              </Card>
            ) : null}

            {canWork && task.status !== "DONE" ? (
              <Card>
                <Muted>{STR.wbMove}</Muted>
                {showMove ? (
                  <View>
                    {canManage ? <DateField label={STR.wbDue} value={moveDue || task.dueKey} onChange={setMoveDue} /> : null}
                    <Muted>{STR.wbSlot}</Muted>
                    <ChipRow>
                      {DAY_SLOTS.map((s: DaySlot) => (
                        <Chip key={s} label={daySlotLabel(s)} selected={(moveSlot ?? task.slot) === s} onPress={() => setMoveSlot(s)} />
                      ))}
                    </ChipRow>
                    <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                      <Button
                        title={STR.save}
                        loading={busy}
                        onPress={() =>
                          run(STR.wbMove, () =>
                            move({ id: task.id, dueKey: canManage && moveDue ? moveDue : null, slot: moveSlot ?? null }),
                          ).then(() => setShowMove(false))
                        }
                      />
                      <Button title={STR.cancel} variant="ghost" onPress={() => setShowMove(false)} />
                    </View>
                  </View>
                ) : (
                  <Button title={STR.wbMove} variant="secondary" onPress={() => setShowMove(true)} />
                )}
              </Card>
            ) : null}

            {canManage && task.status !== "DONE" ? (
              <Card>
                {can("tasks:assign") ? (
                  showReassign ? (
                    <View>
                      <Select
                        label={STR.wbReassign}
                        value={newAssignee}
                        options={staff
                          .filter((s) => s.userId !== task.assigneeUserId)
                          .map((s) => ({
                            label: s.name,
                            value: s.userId,
                            hint: `${STR.wbTodayLoad} ${minutesLabel(s.todayMinutes, bnNum)}${s.todayLevel !== "ok" ? ` (${s.todayLevel})` : ""}`,
                          }))}
                        onChange={setNewAssignee}
                        searchable
                      />
                      <View style={{ flexDirection: "row", gap: space(2) }}>
                        <Button
                          title={STR.wbReassign}
                          loading={busy}
                          disabled={!newAssignee}
                          onPress={() => run(STR.wbReassign, () => reassign({ id: task.id, assigneeUserId: newAssignee! })).then(() => setShowReassign(false))}
                        />
                        <Button title={STR.cancel} variant="ghost" onPress={() => setShowReassign(false)} />
                      </View>
                    </View>
                  ) : (
                    <Button title={STR.wbReassign} variant="secondary" onPress={() => setShowReassign(true)} />
                  )
                ) : null}
                <View style={{ height: space(2) }} />
                <Button title={STR.wbEdit} variant="secondary" onPress={() => navigation.navigate("TaskForm", { taskId: task.id })} />
                <View style={{ height: space(2) }} />
                <Button title={STR.wbCancel} variant="danger" onPress={() => setConfirmCancel(true)} />
                <ConfirmSheet
                  visible={confirmCancel}
                  title={STR.wbCancelConfirm}
                  message={task.titleBn}
                  confirmLabel={STR.wbCancel}
                  onCancel={() => setConfirmCancel(false)}
                  onConfirm={() => {
                    setConfirmCancel(false);
                    void run(STR.wbCancel, () => cancel({ id: task.id })).then(() => navigation.goBack());
                  }}
                />
              </Card>
            ) : null}
          </>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
