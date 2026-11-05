/**
 * VoiceTaskScreen (VT-2/VT-3, D-#960–#965) — speak one or more tasks, review the draft
 * cards, save. The server only DRAFTS (parseVoiceTasks writes nothing); saving goes
 * through the same createTask / createTaskTemplate the task form uses, one card at a
 * time, so every rule, audit row and notification is the form's.
 *
 * Correction: speaking (or typing) again while cards are on screen sends the current
 * cards along, and the server returns the FULL corrected list. Undo after a save
 * cancels exactly the tasks just made and switches off exactly the templates.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import type { DaySlot, TaskPriority } from "@scd/shared";
import { DAY_SLOTS, TASK_PRIORITIES, TASK_RECURRENCES, WEEKS_OF_MONTH } from "@scd/shared";
import {
  ASSIGNABLE_STAFF_QUERY,
  CANCEL_TASK,
  CREATE_TASK,
  CREATE_TASK_TEMPLATE,
  PARSE_VOICE_TASKS,
  SET_TASK_TEMPLATE_ACTIVE,
  type VoiceRecurrence,
  type VoiceTaskCardT,
} from "../../graphql/workBoard";
import type { WorkBoardStackParamList } from "../../navigation/types";
import { Screen, Card, Muted, Button, Chip, ChipRow, Field, Select, Notice, H2 } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum, daySlotLabel, taskPriorityLabel, taskRecurrenceLabel, weekOfMonthLabel, weekdayShortLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { dateKey } from "../../lib/dates";
import { canRecordHere, MAX_RECORD_SECONDS, startRecording, type Recorder } from "../../lib/voiceRecorder";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<WorkBoardStackParamList, "VoiceTask">;
type Phase = "idle" | "recording" | "thinking" | "saving";

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

const FIELD_LABEL: Record<string, string> = {
  assignee: STR.wbAssignee,
  slot: STR.wbSlot,
  priority: STR.wbPriority,
  effortMin: STR.wbEffort,
};

/** What the server needs back to apply a correction — the editable fields only. */
const forCorrection = (cards: VoiceTaskCardT[]) =>
  JSON.stringify({
    tasks: cards.map(({ defaulted: _d, warnings: _w, ...rest }) => rest),
  });

function cardComplete(c: VoiceTaskCardT): boolean {
  if (!c.assigneeUserId || c.titleBn.trim().length === 0) return false;
  if (!Number.isFinite(c.effortMin) || c.effortMin < 5 || c.effortMin > 480) return false;
  if (c.recurrence === "ONCE") return !!c.dueKey && c.dueKey >= dateKey();
  if (c.recurrence === "WEEKLY") return c.weekdays.length > 0;
  if (c.recurrence === "MONTHLY") return c.monthDay !== null && c.monthDay >= 1 && c.monthDay <= 31;
  if (c.recurrence === "MONTHLY_WEEKDAY") return c.weekdays.length === 1 && c.weekOfMonth !== null;
  return true;
}

export default function VoiceTaskScreen({ navigation }: Props): React.ReactElement {
  const { user, can } = useAuth();
  const canAssign = can("work_board:assign");
  const micHere = canRecordHere();

  const [phase, setPhase] = React.useState<Phase>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [cards, setCards] = React.useState<VoiceTaskCardT[]>([]);
  const [transcript, setTranscript] = React.useState("");
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [typed, setTyped] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ taskIds: string[]; templateIds: string[] } | null>(null);
  const [undone, setUndone] = React.useState(false);
  const recorder = React.useRef<Recorder | null>(null);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    navigation.setOptions({ title: STR.vtOpen });
  }, [navigation]);

  const [staffQ] = useQuery({ query: ASSIGNABLE_STAFF_QUERY, pause: !canAssign, requestPolicy: "cache-and-network" });
  const staff = staffQ.data?.assignableStaff ?? [];

  const [, parse] = useMutation(PARSE_VOICE_TASKS);
  const [, createTask] = useMutation(CREATE_TASK);
  const [, createTemplate] = useMutation(CREATE_TASK_TEMPLATE);
  const [, cancelTask] = useMutation(CANCEL_TASK);
  const [, setTemplateActive] = useMutation(SET_TASK_TEMPLATE_ACTIVE);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  React.useEffect(
    () => () => {
      stopTimer();
      recorder.current?.cancel();
    },
    [],
  );

  async function send(input: { audioBase64?: string; mimeType?: string; text?: string }): Promise<void> {
    setPhase("thinking");
    setError(null);
    const res = await parse({ ...input, priorDraftJson: cards.length > 0 ? forCorrection(cards) : null });
    setPhase("idle");
    if (res.error || !res.data) {
      setError(friendlyError(res.error as never));
      return;
    }
    const d = res.data.parseVoiceTasks;
    setCards(d.tasks);
    setTranscript(d.transcript);
    setWarnings(d.warnings);
    setSaved(null);
    setUndone(false);
  }

  async function stop(): Promise<void> {
    stopTimer();
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setPhase("thinking");
    try {
      const rec = await r.stop();
      await send({ audioBase64: rec.base64, mimeType: rec.mimeType });
    } catch (e) {
      setPhase("idle");
      setError(friendlyError(e as never));
    }
  }

  async function record(): Promise<void> {
    setError(null);
    try {
      recorder.current = await startRecording();
    } catch {
      setError(STR.vtMicDenied);
      return;
    }
    setSeconds(0);
    setPhase("recording");
    const started = Date.now();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) void stop();
    }, 250);
  }

  async function sendTyped(): Promise<void> {
    const text = typed.trim();
    if (!text) return;
    await send({ text });
    setTyped("");
  }

  const patch = (i: number, p: Partial<VoiceTaskCardT>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const remove = (i: number) => setCards((cs) => cs.filter((_c, j) => j !== i));

  async function saveAll(): Promise<void> {
    setPhase("saving");
    setError(null);
    const done = { taskIds: [] as string[], templateIds: [] as string[] };
    let i = 0;
    for (; i < cards.length; i++) {
      const c = cards[i];
      const common = {
        titleBn: c.titleBn.trim(),
        notes: c.notes?.trim() || null,
        assigneeUserId: c.assigneeUserId!,
        priority: c.priority,
        slot: c.slot,
        effortMin: c.effortMin,
        viaVoice: true,
      };
      if (c.recurrence === "ONCE") {
        const res = await createTask({ input: { ...common, dueKey: c.dueKey! } });
        if (res.error || !res.data) {
          setError(friendlyError(res.error as never));
          break;
        }
        done.taskIds.push(res.data.createTask.id);
      } else {
        const res = await createTemplate({
          input: {
            ...common,
            recurrence: c.recurrence,
            weekdays: c.recurrence === "WEEKLY" || c.recurrence === "MONTHLY_WEEKDAY" ? c.weekdays : null,
            monthDay: c.recurrence === "MONTHLY" ? c.monthDay : null,
            weekOfMonth: c.recurrence === "MONTHLY_WEEKDAY" ? c.weekOfMonth : null,
            endKey: c.endKey,
          },
        });
        if (res.error || !res.data) {
          setError(friendlyError(res.error as never));
          break;
        }
        done.templateIds.push(res.data.createTaskTemplate.id);
      }
    }
    // Saved cards leave the screen; a card that failed (and the ones after it) stay to fix.
    setCards((cs) => cs.slice(i));
    if (i === cards.length) {
      setTranscript("");
      setWarnings([]);
    }
    if (done.taskIds.length + done.templateIds.length > 0) {
      setSaved(done);
      setUndone(false);
    }
    setPhase("idle");
  }

  async function undo(): Promise<void> {
    if (!saved) return;
    setPhase("saving");
    for (const id of saved.taskIds) await cancelTask({ id });
    for (const id of saved.templateIds) await setTemplateActive({ id, active: false });
    setPhase("idle");
    setUndone(true);
  }

  const busy = phase === "thinking" || phase === "saving";
  const allComplete = cards.length > 0 && cards.every(cardComplete);
  const staffOptions = staff.map((s) => ({ label: s.userId === user?.id ? `${s.name} (${STR.wbSelf})` : s.name, value: s.userId }));

  return (
    <Screen scroll>
      <Card>
        <Muted>{STR.vtHint}</Muted>
        {micHere ? (
          <View style={{ marginTop: space(2) }}>
            {phase === "recording" ? (
              <>
                <Notice tone="info" message={fill(STR.vtRecording, { s: bnNum(seconds) })} />
                <Button title={STR.vtStop} onPress={() => void stop()} />
              </>
            ) : (
              <Button title={cards.length > 0 ? STR.vtCorrect : STR.vtSpeak} onPress={() => void record()} loading={phase === "thinking"} disabled={busy} />
            )}
          </View>
        ) : (
          <Notice tone="warn" message={STR.vtNativeUpdate} />
        )}
        <View style={{ marginTop: space(2) }}>
          <Field label={STR.vtTyped} value={typed} onChangeText={setTyped} multiline autoCapitalize="sentences" />
          <Button title={STR.vtSend} variant="secondary" onPress={() => void sendTyped()} disabled={busy || phase === "recording" || typed.trim().length === 0} />
        </View>
        {phase === "thinking" ? <Muted style={{ marginTop: space(2) }}>{STR.vtThinking}</Muted> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
      </Card>

      {saved ? (
        <Card>
          <Notice tone="ok" message={undone ? STR.vtUndone : fill(STR.vtSavedBanner, { n: bnNum(saved.taskIds.length + saved.templateIds.length) })} />
          {!undone ? <Button title={STR.vtUndo} variant="secondary" onPress={() => void undo()} disabled={busy} /> : null}
        </Card>
      ) : null}

      {transcript ? (
        <Card>
          <Muted>{`${STR.vtHeard}: “${transcript}”`}</Muted>
          {warnings.map((w) => (
            <Notice key={w} tone="warn" message={w} />
          ))}
        </Card>
      ) : null}

      {cards.map((c, i) => (
        <Card key={i}>
          <H2>{fill(STR.vtCardN, { n: bnNum(i + 1) })}</H2>
          {c.warnings.map((w) => (
            <Notice key={w} tone="warn" message={w} />
          ))}
          {c.defaulted.length > 0 ? <Muted>{fill(STR.vtAssumed, { f: c.defaulted.map((f) => FIELD_LABEL[f] ?? f).join(", ") })}</Muted> : null}

          {canAssign ? (
            <Select
              label={STR.wbAssignee}
              value={c.assigneeUserId}
              options={staffOptions}
              onChange={(v) => patch(i, { assigneeUserId: v })}
              searchable
              error={c.assigneeUserId ? undefined : STR.vtNeedAssignee}
            />
          ) : (
            <Muted style={{ marginBottom: space(3) }}>{`${STR.wbAssignee}: ${STR.wbSelf}`}</Muted>
          )}
          <Field label={STR.wbTitle} value={c.titleBn} onChangeText={(v) => patch(i, { titleBn: v })} autoCapitalize="sentences" />
          <Field label={STR.wbNotes} value={c.notes ?? ""} onChangeText={(v) => patch(i, { notes: v })} multiline autoCapitalize="sentences" />

          <Muted>{STR.wbRecurrence}</Muted>
          <ChipRow>
            <Chip label={STR.wbOnce} selected={c.recurrence === "ONCE"} onPress={() => patch(i, { recurrence: "ONCE" })} />
            {TASK_RECURRENCES.map((r) => (
              <Chip key={r} label={taskRecurrenceLabel(r)} selected={c.recurrence === r} onPress={() => patch(i, { recurrence: r as VoiceRecurrence })} />
            ))}
          </ChipRow>

          {c.recurrence === "ONCE" ? (
            <>
              <DateField label={STR.wbDue} value={c.dueKey ?? ""} onChange={(v) => patch(i, { dueKey: v || null })} min={dateKey()} />
              {!c.dueKey ? <Notice tone="warn" message={STR.vtNeedDate} /> : null}
            </>
          ) : c.recurrence === "WEEKLY" ? (
            <>
              <Muted>{STR.wbWeekdays}</Muted>
              <ChipRow>
                {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                  <Chip
                    key={d}
                    label={weekdayShortLabel(d)}
                    selected={c.weekdays.includes(d)}
                    onPress={() => patch(i, { weekdays: c.weekdays.includes(d) ? c.weekdays.filter((x) => x !== d) : [...c.weekdays, d] })}
                  />
                ))}
              </ChipRow>
            </>
          ) : c.recurrence === "MONTHLY" ? (
            <Field
              label={STR.wbMonthDay}
              value={c.monthDay === null ? "" : String(c.monthDay)}
              onChangeText={(v) => patch(i, { monthDay: v.trim() === "" ? null : Number(v) })}
              keyboardType="number-pad"
            />
          ) : (
            <>
              <Muted>{STR.wbWeekOfMonth}</Muted>
              <ChipRow>
                {WEEKS_OF_MONTH.map((w) => (
                  <Chip key={w} label={weekOfMonthLabel(w)} selected={c.weekOfMonth === w} onPress={() => patch(i, { weekOfMonth: w })} />
                ))}
              </ChipRow>
              <Muted>{STR.wbWeekday}</Muted>
              <ChipRow>
                {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                  <Chip key={d} label={weekdayShortLabel(d)} selected={c.weekdays[0] === d} onPress={() => patch(i, { weekdays: [d] })} />
                ))}
              </ChipRow>
            </>
          )}
          {c.recurrence !== "ONCE" ? (
            <DateField label={STR.wbEndDate} value={c.endKey ?? ""} onChange={(v) => patch(i, { endKey: v || null })} min={dateKey()} />
          ) : null}

          <Muted>{STR.wbSlot}</Muted>
          <ChipRow>
            {DAY_SLOTS.map((s: DaySlot) => (
              <Chip key={s} label={daySlotLabel(s)} selected={c.slot === s} onPress={() => patch(i, { slot: s })} />
            ))}
          </ChipRow>
          <Muted>{STR.wbPriority}</Muted>
          <ChipRow>
            {TASK_PRIORITIES.map((p: TaskPriority) => (
              <Chip key={p} label={taskPriorityLabel(p)} selected={c.priority === p} onPress={() => patch(i, { priority: p })} />
            ))}
          </ChipRow>
          <Field
            label={STR.wbEffort}
            value={String(c.effortMin)}
            onChangeText={(v) => patch(i, { effortMin: Number(v) })}
            keyboardType="number-pad"
          />
          <Button title={STR.vtRemove} variant="secondary" onPress={() => remove(i)} disabled={busy} />
        </Card>
      ))}

      {cards.length > 0 ? (
        <Card>
          <Button title={fill(STR.vtSaveAll, { n: bnNum(cards.length) })} onPress={() => void saveAll()} loading={phase === "saving"} disabled={!allComplete || busy} />
          <View style={{ marginTop: space(2) }}>
            <Button
              title={STR.vtStartOver}
              variant="secondary"
              onPress={() => {
                setCards([]);
                setTranscript("");
                setWarnings([]);
              }}
              disabled={busy}
            />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
