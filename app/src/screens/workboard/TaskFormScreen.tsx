/**
 * TaskFormScreen (WB-1/WB-2, D-#701) — create a task (once, or recurring → template)
 * or edit an existing one. A tasks:assign holder picks anyone from the staff list,
 * with TODAY's open load beside each name — the place where "the superior can't see
 * the load" is fixed at the source. Everyone else creates for themselves only.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { DaySlot, TaskPriority, TaskRecurrence } from "@scd/shared";
import { DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES } from "@scd/shared";
import { ASSIGNABLE_STAFF_QUERY, CREATE_TASK, CREATE_TASK_TEMPLATE, TASK_QUERY, UPDATE_TASK } from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Card, Muted, Button, Chip, ChipRow, Field, Select, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, daySlotLabel, taskPriorityLabel, taskRecurrenceLabel, weekdayShortLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { dateKey } from "../../lib/dates";
import { minutesLabel } from "../../lib/workBoardNav";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "TaskForm">;
type Recurrence = "ONCE" | TaskRecurrence;

export default function TaskFormScreen({ route, navigation }: Props): React.ReactElement {
  const { user, can } = useAuth();
  const editId = route.params?.taskId ?? null;
  const canAssign = can("tasks:assign");

  const [title, setTitle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [assignee, setAssignee] = React.useState<string | null>(route.params?.assigneeUserId ?? user?.id ?? null);
  const [forLabel, setForLabel] = React.useState("");
  const [dueKey, setDueKey] = React.useState(route.params?.dueKey ?? dateKey());
  const [slot, setSlot] = React.useState<DaySlot>("ANY");
  const [priority, setPriority] = React.useState<TaskPriority>("NORMAL");
  const [effort, setEffort] = React.useState("30");
  const [recurrence, setRecurrence] = React.useState<Recurrence>(route.params?.template ? "SCHOOL_DAYS" : "ONCE");
  const [weekdays, setWeekdays] = React.useState<number[]>([]);
  const [monthDay, setMonthDay] = React.useState("1");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    navigation.setOptions({ title: editId ? STR.wbEdit : route.params?.template ? STR.wbNewTemplate : STR.wbNewTask });
  }, [editId, route.params?.template, navigation]);

  const [existingQ] = useQuery({ query: TASK_QUERY, variables: { id: editId ?? "" }, pause: !editId });
  const loaded = React.useRef(false);
  React.useEffect(() => {
    const t = existingQ.data?.task;
    if (!t || loaded.current) return;
    loaded.current = true;
    setTitle(t.titleBn);
    setNotes(t.notes ?? "");
    setAssignee(t.assigneeUserId);
    setForLabel(t.forLabel ?? "");
    setDueKey(t.dueKey);
    setSlot(t.slot);
    setPriority(t.priority);
    setEffort(String(t.effortMin));
  }, [existingQ.data]);

  const [staffQ] = useQuery({ query: ASSIGNABLE_STAFF_QUERY, pause: !canAssign, requestPolicy: "cache-and-network" });
  const staff = staffQ.data?.assignableStaff ?? [];
  const picked = staff.find((s) => s.userId === assignee) ?? null;

  const [, createTask] = useMutation(CREATE_TASK);
  const [, createTemplate] = useMutation(CREATE_TASK_TEMPLATE);
  const [, updateTask] = useMutation(UPDATE_TASK);

  const effortMin = Number(effort);
  const valid =
    title.trim().length > 0 &&
    !!assignee &&
    Number.isFinite(effortMin) &&
    effortMin >= 5 &&
    effortMin <= 480 &&
    (recurrence !== "WEEKLY" || weekdays.length > 0) &&
    (recurrence !== "MONTHLY" || (Number(monthDay) >= 1 && Number(monthDay) <= 31));

  async function submit(): Promise<void> {
    if (!valid || !assignee) return;
    setError(null);
    setBusy(true);
    let res: { error?: unknown };
    if (editId) {
      res = await updateTask({
        id: editId,
        patch: { titleBn: title.trim(), notes: notes.trim() || null, forLabel: forLabel.trim() || null, priority, dueKey, slot, effortMin },
      });
    } else if (recurrence === "ONCE") {
      res = await createTask({
        input: { titleBn: title.trim(), notes: notes.trim() || null, assigneeUserId: assignee, forLabel: forLabel.trim() || null, priority, dueKey, slot, effortMin },
      });
    } else {
      res = await createTemplate({
        input: {
          titleBn: title.trim(),
          notes: notes.trim() || null,
          assigneeUserId: assignee,
          forLabel: forLabel.trim() || null,
          priority,
          slot,
          effortMin,
          recurrence,
          weekdays: recurrence === "WEEKLY" ? weekdays : null,
          monthDay: recurrence === "MONTHLY" ? Number(monthDay) : null,
        },
      });
    }
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error as never));
      return;
    }
    navigation.goBack();
  }

  return (
    <Screen scroll>
      <Card>
        <Field label={STR.wbTitle} value={title} onChangeText={setTitle} autoCapitalize="sentences" />
        <Field label={STR.wbNotes} value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
        {canAssign && !editId ? (
          <Select
            label={STR.wbAssignee}
            value={assignee}
            options={staff.map((s) => ({
              label: s.userId === user?.id ? `${s.name} (${STR.wbSelf})` : s.name,
              value: s.userId,
              hint: `${STR.wbTodayLoad} ${minutesLabel(s.todayMinutes, bnNum)}${s.todayLevel !== "ok" ? ` · ${s.todayLevel}` : ""}`,
            }))}
            onChange={setAssignee}
            searchable
            helper={picked ? `${picked.name}: ${STR.wbTodayLoad} ${minutesLabel(picked.todayMinutes, bnNum)}${picked.todayLevel !== "ok" ? ` (${picked.todayLevel})` : ""}` : undefined}
          />
        ) : (
          <Muted style={{ marginBottom: space(3) }}>{`${STR.wbAssignee}: ${editId ? existingQ.data?.task?.assigneeName ?? "—" : STR.wbSelf}`}</Muted>
        )}
        {canAssign ? <Field label={STR.wbForLabel} value={forLabel} onChangeText={setForLabel} autoCapitalize="words" /> : null}

        {!editId ? (
          <>
            <Muted>{STR.wbRecurrence}</Muted>
            <ChipRow>
              <Chip label={STR.wbOnce} selected={recurrence === "ONCE"} onPress={() => setRecurrence("ONCE")} />
              {TASK_RECURRENCES.map((r: TaskRecurrence) => (
                <Chip key={r} label={taskRecurrenceLabel(r)} selected={recurrence === r} onPress={() => setRecurrence(r)} />
              ))}
            </ChipRow>
          </>
        ) : null}

        {recurrence === "ONCE" || editId ? (
          <DateField label={STR.wbDue} value={dueKey} onChange={setDueKey} />
        ) : recurrence === "WEEKLY" ? (
          <>
            <Muted>{STR.wbWeekdays}</Muted>
            <ChipRow>
              {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                <Chip
                  key={d}
                  label={weekdayShortLabel(d)}
                  selected={weekdays.includes(d)}
                  onPress={() => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]))}
                />
              ))}
            </ChipRow>
          </>
        ) : recurrence === "MONTHLY" ? (
          <Field label={STR.wbMonthDay} value={monthDay} onChangeText={setMonthDay} keyboardType="number-pad" />
        ) : null}

        <Muted>{STR.wbSlot}</Muted>
        <ChipRow>
          {DAY_SLOTS.map((s: DaySlot) => (
            <Chip key={s} label={daySlotLabel(s)} selected={slot === s} onPress={() => setSlot(s)} />
          ))}
        </ChipRow>

        <Muted>{STR.wbPriority}</Muted>
        <ChipRow>
          {TASK_PRIORITIES.map((p: TaskPriority) => (
            <Chip key={p} label={taskPriorityLabel(p)} selected={priority === p} onPress={() => setPriority(p)} />
          ))}
        </ChipRow>

        <Field label={STR.wbEffort} value={effort} onChangeText={setEffort} keyboardType="number-pad" />

        {error ? <Notice message={error} tone="danger" /> : null}
        <View style={{ marginTop: space(2) }}>
          <Button title={editId ? STR.save : STR.wbSave} onPress={submit} loading={busy} disabled={!valid} />
        </View>
      </Card>
    </Screen>
  );
}
