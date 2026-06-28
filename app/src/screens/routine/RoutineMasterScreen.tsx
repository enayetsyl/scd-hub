/**
 * RoutineMasterScreen (R-3, admin) — the whole timetable in a single grid:
 * rows = every section + Quran/Arabic group, columns = periods (with clock times).
 * A teacher double-booked across two groups in the same period is highlighted red and
 * listed. The day selector adds an "All" option that stacks all five days.
 *
 * EDIT-IN-PLACE: every non-break cell is tappable — it opens a dialog to change that
 * period's subject / teacher / room (or add a slot to an empty cell, or remove one),
 * conflict-checked on the server. `routine:manage`.
 */
import React, { useMemo, useState } from "react";
import { View, ScrollView, Pressable, Modal } from "react-native";
import { useQuery, useMutation } from "urql";
import { ROUTINE_SUBJECTS } from "@scd/shared";
import {
  ROUTINE_MASTER_WEEK_QUERY,
  CREATE_ROUTINE_SLOT,
  UPDATE_ROUTINE_SLOT,
  DELETE_ROUTINE_SLOT,
  type RoutineMasterT,
  type RoutineMasterSlotT,
  type RoutineMasterRowT,
  type RoutineMasterColumnT,
} from "../../graphql/operations";
import { Screen, Body, Muted, Card, Chip, ChipRow, Badge, Button, Loader, Notice, Divider } from "../../components/ui";
import { TeacherSelect, RoomSelect } from "../../components/selects";
import { STR, dayOfWeekLabel, routineSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useColors, type ThemeColors } from "../../theme";
import { space } from "../../theme/tokens";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU"] as const;
const GROUP_W = 150;
const PERIOD_W = 132;
const todayISO = (): string => new Date().toISOString().slice(0, 10);
/** A slot's period track follows its subject (matches the seeder + binding). */
const trackForSubject = (s: string): string => (s === "QURAN" ? "quran" : s === "ARABIC" ? "arabic" : "general");

/** Which cell the editor is open on (existing slot or an empty cell to add). */
interface EditTarget {
  groupType: string;
  groupId: string;
  rowLabel: string;
  day: string;
  period: number;
  slot: RoutineMasterSlotT | null;
}

/** One day's master grid (conflict summary + the rows × periods table). Tapping a
 *  period cell calls onPick with that cell's edit target. */
function DayGrid({
  m,
  c,
  showDayHeader,
  onPick,
}: {
  m: RoutineMasterT;
  c: ThemeColors;
  showDayHeader: boolean;
  onPick: (t: EditTarget) => void;
}): React.ReactElement {
  const cellBy = useMemo(() => {
    const map = new Map<string, RoutineMasterSlotT>();
    for (const s of m.slots) map.set(`${s.groupId}|${s.periodNumber}`, s);
    return map;
  }, [m]);
  const conflictTP = useMemo(() => {
    const set = new Set<string>();
    for (const cf of m.conflicts) set.add(`${cf.teacherId}|${cf.periodNumber}`);
    return set;
  }, [m]);

  const cellBase = { borderWidth: 1, borderColor: c.border, padding: space(1), justifyContent: "center" as const };

  return (
    <View style={{ gap: space(2) }}>
      {showDayHeader ? <Body style={{ fontWeight: "700", fontSize: 16 }}>{dayOfWeekLabel(m.day)}</Body> : null}

      {m.conflicts.length === 0 ? (
        <Badge text={STR.rtNoConflicts} tone="ok" />
      ) : (
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1), color: c.error }}>
            ⚠ {STR.rtConflicts} ({bnNum(m.conflicts.length)})
          </Body>
          {m.conflicts.map((cf, i) => (
            <Muted key={i} style={{ marginTop: 2 }}>
              P{cf.periodNumber} · {cf.teacherName ?? "—"}: {cf.labels.join("  +  ")}
            </Muted>
          ))}
        </Card>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: "row" }}>
            <View style={[cellBase, { width: GROUP_W, backgroundColor: c.surfaceAlt }]}>
              <Muted style={{ fontWeight: "700" }}>{STR.rtSectionRoutine}</Muted>
            </View>
            {m.columns.map((col) => (
              <View key={col.periodNumber} style={[cellBase, { width: PERIOD_W, backgroundColor: c.surfaceAlt }]}>
                <Body style={{ fontSize: 12, fontWeight: "700" }}>P{col.periodNumber}</Body>
                <Muted style={{ fontSize: 10 }}>{col.isBreak ? STR.rtBreak : `${col.startTime ?? ""}–${col.endTime ?? ""}`}</Muted>
              </View>
            ))}
          </View>
          {m.rows.map((row) => (
            <View key={`${row.groupType}:${row.groupId}`} style={{ flexDirection: "row" }}>
              <View style={[cellBase, { width: GROUP_W, backgroundColor: c.surface }]}>
                <Body style={{ fontSize: 12, fontWeight: "600" }}>{row.label}</Body>
                {row.sublabel ? <Muted style={{ fontSize: 10 }}>{row.sublabel}</Muted> : null}
              </View>
              {m.columns.map((col) => {
                const slot = cellBy.get(`${row.groupId}|${col.periodNumber}`);
                const conflict = !!slot?.teacherId && conflictTP.has(`${slot.teacherId}|${col.periodNumber}`);
                const bg = conflict ? c.errorContainer : col.isBreak ? c.surfaceAlt : c.surface;
                return (
                  <Pressable
                    key={col.periodNumber}
                    disabled={col.isBreak}
                    onPress={() =>
                      onPick({ groupType: row.groupType, groupId: row.groupId, rowLabel: row.label, day: m.day, period: col.periodNumber, slot: slot ?? null })
                    }
                    style={({ pressed }) => (pressed && !col.isBreak ? { opacity: 0.6 } : undefined)}
                  >
                    <View style={[cellBase, { width: PERIOD_W, backgroundColor: bg }]}>
                      {slot ? (
                        <>
                          <Body style={{ fontSize: 11, fontWeight: "600", color: conflict ? c.onErrorContainer : c.textPrimary }}>
                            {routineSubjectLabel(slot.subject)}
                          </Body>
                          <Muted style={{ fontSize: 10, color: conflict ? c.onErrorContainer : c.textSecondary }}>
                            {slot.teacherName ?? "—"}
                          </Muted>
                        </>
                      ) : (
                        <Muted style={{ fontSize: 10 }}>{col.isBreak ? "·" : STR.rtEmptyCell}</Muted>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Edit/add/remove a single slot (the tapped cell). Subject is restricted to the
 *  cell's plane (Quran/Arabic group → QURAN/ARABIC; section → general subjects);
 *  the track follows the subject. Conflicts come back from the server as an error. */
function EditSlotModal({
  target,
  c,
  onClose,
  onDone,
}: {
  target: EditTarget;
  c: ThemeColors;
  onClose: () => void;
  onDone: (msg: string, warnings: string[]) => void;
}): React.ReactElement {
  const isNew = target.slot === null;
  const subjectOptions = useMemo(
    () =>
      target.groupType === "subjectgroup"
        ? (["QURAN", "ARABIC"] as string[])
        : (ROUTINE_SUBJECTS as readonly string[]).filter((s) => s !== "QURAN" && s !== "ARABIC"),
    [target.groupType],
  );
  const [subject, setSubject] = useState<string>(target.slot?.subject ?? subjectOptions[0]);
  const [teacherId, setTeacherId] = useState<string>(target.slot?.teacherId ?? "");
  const [roomId, setRoomId] = useState<string>(target.slot?.roomId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, createSlot] = useMutation(CREATE_ROUTINE_SLOT);
  const [, updateSlot] = useMutation(UPDATE_ROUTINE_SLOT);
  const [, deleteSlot] = useMutation(DELETE_ROUTINE_SLOT);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const track = trackForSubject(subject);
    if (isNew) {
      const res = await createSlot({
        groupType: target.groupType,
        groupId: target.groupId,
        dayOfWeek: target.day,
        periodNumber: target.period,
        subject,
        track,
        isBreak: false,
        teacherId: teacherId.trim() || null,
        roomId: roomId.trim() || null,
        effectiveFrom: todayISO(),
        effectiveTo: null,
      });
      setBusy(false);
      if (res.error || !res.data?.createRoutineSlot) {
        setError(friendlyError(res.error));
        return;
      }
      onDone(STR.rtCreated, res.data.createRoutineSlot.warnings);
    } else {
      const res = await updateSlot({
        id: target.slot!.id,
        subject,
        track,
        teacherId: teacherId.trim() || null,
        roomId: roomId.trim() || null,
      });
      setBusy(false);
      if (res.error || !res.data?.updateRoutineSlot) {
        setError(friendlyError(res.error));
        return;
      }
      onDone(STR.rtSaved, res.data.updateRoutineSlot.warnings);
    }
  }

  async function remove(): Promise<void> {
    if (!target.slot) return;
    setBusy(true);
    setError(null);
    const res = await deleteSlot({ id: target.slot.id });
    setBusy(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    onDone(STR.rtDeleted, []);
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: space(4) }}
      >
        <Pressable onPress={() => undefined} style={{ width: "100%", maxWidth: 460, maxHeight: "88%" }}>
          <ScrollView
            style={{ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border }}
            contentContainerStyle={{ padding: space(4), gap: space(2) }}
            keyboardShouldPersistTaps="handled"
          >
            <Body style={{ fontWeight: "700" }}>{STR.rtEditSlot}</Body>
            <Muted>
              {target.rowLabel} · {dayOfWeekLabel(target.day)} · {STR.rtPeriodN} {bnNum(target.period)}
            </Muted>
            {error ? <Notice message={error} tone="danger" /> : null}

            <Muted style={{ marginTop: space(1) }}>{STR.rtSubjectF}</Muted>
            <ChipRow>
              {subjectOptions.map((s) => (
                <Chip key={s} label={routineSubjectLabel(s)} selected={subject === s} onPress={() => setSubject(s)} />
              ))}
            </ChipRow>

            <TeacherSelect label={STR.rtTeacherId} value={teacherId} onChange={setTeacherId} />
            <RoomSelect label={STR.rtRoomId} value={roomId} onChange={setRoomId} />

            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              <Button title={isNew ? STR.rtCreate : STR.save} onPress={save} loading={busy} disabled={busy} style={{ flex: 1 }} />
              {!isNew ? <Button title={STR.remove} variant="danger" onPress={remove} disabled={busy} /> : null}
            </View>
            <Button title={STR.cancel} variant="secondary" onPress={onClose} disabled={busy} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function RoutineMasterScreen(): React.ReactElement {
  const c = useColors();
  const [day, setDay] = useState<string>("ALL");
  const [{ data, fetching, error }, refetch] = useQuery({ query: ROUTINE_MASTER_WEEK_QUERY });
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [notice, setNotice] = useState<{ msg: string; tone: "ok" | "warn" } | null>(null);
  const week = data?.routineMasterWeek ?? [];
  const shown = day === "ALL" ? week : week.filter((m) => m.day === day);

  function handleDone(msg: string, warnings: string[]): void {
    setEdit(null);
    setNotice({ msg: warnings.length ? `${msg} ${warnings.join(" ")}` : msg, tone: warnings.length ? "warn" : "ok" });
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false} wide>
      <View style={{ padding: space(4), paddingBottom: 0, gap: space(2) }}>
        <ChipRow>
          <Chip label={STR.rtAllDays} selected={day === "ALL"} onPress={() => setDay("ALL")} />
          {DAYS.map((d) => (
            <Chip key={d} label={dayOfWeekLabel(d)} selected={day === d} onPress={() => setDay(d)} />
          ))}
        </ChipRow>
        <Muted>{STR.rtTapToEdit}</Muted>
        {notice ? <Notice message={notice.msg} tone={notice.tone} /> : null}
      </View>

      {fetching ? <Loader /> : null}
      {error ? (
        <View style={{ paddingHorizontal: space(4) }}>
          <Notice message={friendlyError(error)} tone="danger" />
        </View>
      ) : null}

      {data ? (
        <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }}>
          {shown.map((m, i) => (
            <View key={m.day} style={{ gap: space(2) }}>
              {i > 0 ? <Divider /> : null}
              <DayGrid m={m} c={c} showDayHeader={day === "ALL"} onPick={(t) => { setNotice(null); setEdit(t); }} />
            </View>
          ))}
        </ScrollView>
      ) : null}

      {edit ? (
        <EditSlotModal
          key={`${edit.groupType}:${edit.groupId}:${edit.day}:${edit.period}`}
          target={edit}
          c={c}
          onClose={() => setEdit(null)}
          onDone={handleDone}
        />
      ) : null}
    </Screen>
  );
}
