/**
 * DailyNoteScreen (R5.3) — the class-note / daily-diary. For a group + date, the
 * subject teacher (or cover/admin) publishes "what was taught" per slot, optionally
 * linking the day's HW-T1 homework declaration. Published notes are listed (guardian
 * read + the on-publish notification ride the deferred push pipeline). `routine:read`.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { ROUTINE_FOR_DATE_QUERY, CLASS_NOTES_FOR_DATE_QUERY, PUBLISH_CLASS_NOTE } from "../../graphql/operations";
import type { RoutineStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Badge, Notice, Loader } from "../../components/ui";
import { STR, routineSubjectLabel, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

const todayISO = (): string => new Date().toISOString().slice(0, 10);

type Props = NativeStackScreenProps<RoutineStackParamList, "DailyNote">;

export default function DailyNoteScreen({ route }: Props): React.ReactElement {
  const { groupType, groupId, title } = route.params;
  const [date, setDate] = useState(todayISO());
  const [sel, setSel] = useState<string | null>(null);
  const [taught, setTaught] = useState("");
  const [hwId, setHwId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slotsQ, refetchSlots] = useQuery({ query: ROUTINE_FOR_DATE_QUERY, variables: { groupType, groupId, date } });
  const [notesQ, refetchNotes] = useQuery({ query: CLASS_NOTES_FOR_DATE_QUERY, variables: { groupType, groupId, date } });
  const [, publish] = useMutation(PUBLISH_CLASS_NOTE);

  const notesBySlot = new Map((notesQ.data?.classNotesForDate ?? []).map((n) => [n.slotId, n]));
  const slots = (slotsQ.data?.routineForDate ?? []).filter((s) => !s.isBreak);

  async function submit(slotId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await publish({ slotId, date, taughtSummaryBn: taught.trim(), homeworkItemId: hwId.trim() || null });
    setBusy(false);
    if (res.error || !res.data?.publishClassNote) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(STR.rtPublished);
    setSel(null);
    setTaught("");
    setHwId("");
    refetchSlots({ requestPolicy: "network-only" });
    refetchNotes({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <Muted style={{ fontWeight: "700" }}>{title}</Muted>
        <Field label={STR.rtDate} value={date} onChangeText={setDate} />
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {slotsQ.fetching ? <Loader /> : null}
        {!slotsQ.fetching && slots.length === 0 ? <Muted>{STR.rtNoSlots}</Muted> : null}

        {slots.map((s) => {
          const note = notesBySlot.get(s.id);
          return (
            <Card key={s.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Body style={{ fontWeight: "700", flex: 1 }}>
                  {STR.rtPeriodN} {bnNum(s.periodNumber)} · {routineSubjectLabel(s.subject)}
                </Body>
                {note ? <Badge text={STR.rtPublished} tone="ok" /> : null}
              </View>

              {note ? (
                <Muted style={{ marginTop: space(1) }}>{note.taughtSummaryBn}</Muted>
              ) : sel === s.id ? (
                <View style={{ marginTop: space(2), gap: space(1) }}>
                  <Field label={STR.rtTaughtSummary} value={taught} onChangeText={setTaught} multiline />
                  <Field label={STR.rtHomeworkId} value={hwId} onChangeText={setHwId} />
                  <Button title={STR.rtPublish} onPress={() => submit(s.id)} loading={busy} disabled={busy || taught.trim() === ""} />
                </View>
              ) : (
                <Button title={STR.rtClassNote} variant="secondary" onPress={() => setSel(s.id)} style={{ marginTop: space(2) }} />
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
