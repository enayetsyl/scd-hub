/**
 * HomeworkRecordsScreen (§8.2) — the per-student lifecycle view that was missing.
 * Pick a day's issued item → see every student's record with its state → apply one
 * legal transition (GIVEN→DUE→SUBMITTED/CHASE, ABSENT_REDELIVER→GIVEN, CHECKED→RETURNED).
 * Once a record reaches SUBMITTED, the teacher records the result in the Checking queue.
 *
 * Server already exposes `transitionHomeworkRecord` + the 6-stage engine (lifecycle.ts);
 * this screen is the UI that drives it. Identity-bearing / operational plane (tracker:write).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  HOMEWORK_ITEMS,
  HOMEWORK_STUDENT_RECORDS,
  TRANSITION_HOMEWORK_RECORD,
  STUDENTS_QUERY,
} from "../../graphql/operations";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Notice, Loader, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, hwSubjectLabel, lifecycleStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "HomeworkRecords">;

const today = (): string => new Date().toISOString().slice(0, 10);

/** Legal next states per state (language-free; mirrors lifecycle.ts LIFECYCLE_EDGES). */
const NEXT_STATES: Record<string, string[]> = {
  GIVEN: ["DUE"],
  ABSENT_REDELIVER: ["GIVEN"],
  DUE: ["SUBMITTED", "CHASE"],
  CHASE: ["SUBMITTED", "CHASE"],
  CHECKED: ["RETURNED"],
  RESUBMIT: ["RETURNED"],
  SUBMITTED: [],
  RETURNED: [],
};

/** Resolve a move's button label at RENDER time so it follows the current language. */
function moveLabel(from: string, to: string): string {
  switch (to) {
    case "DUE":
      return STR.hwMarkDue;
    case "SUBMITTED":
      return STR.hwMarkSubmitted;
    case "CHASE":
      return from === "CHASE" ? STR.hwChaseAgain : STR.hwChaseAction;
    case "GIVEN":
      return STR.hwRedeliver;
    case "RETURNED":
      return STR.hwReturnAction;
    default:
      return to;
  }
}

export default function HomeworkRecordsScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [date, setDate] = useState(today());
  const [itemId, setItemId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const base = { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "" };

  const [itemsQ] = useQuery({
    query: HOMEWORK_ITEMS,
    variables: { ...base, dateGiven: date },
    pause: !hasSection,
  });
  const [studentsQ] = useQuery({
    query: STUDENTS_QUERY,
    variables: { sectionId: base.sectionId },
    pause: !hasSection,
  });
  const [recsQ, refetchRecs] = useQuery({
    query: HOMEWORK_STUDENT_RECORDS,
    variables: { ...base, itemId: itemId ?? "" },
    pause: !hasSection || !itemId,
  });
  const [, transition] = useMutation(TRANSITION_HOMEWORK_RECORD);

  const items = (itemsQ.data?.homeworkItems ?? []).filter((i) => i.status === "issued");
  const records = recsQ.data?.homeworkStudentRecords ?? [];
  const nameMap = new Map((studentsQ.data?.studentsInSection ?? []).map((s) => [s.id, s.name]));

  async function onMove(recordId: string, toState: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusyId(recordId);
    const res = await transition({ sectionId: base.sectionId, recordId, toState });
    setBusyId(null);
    if (res.error || !res.data?.transitionHomeworkRecord) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(lifecycleStateLabel(res.data.transitionHomeworkRecord.state));
    refetchRecs({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        {hasSection ? <Field label={STR.hwDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" /> : null}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {!hasSection ? (
          <EmptyState message={STR.pickSection} />
        ) : itemsQ.fetching && items.length === 0 ? (
          <Loader label={STR.loading} />
        ) : items.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            {ok ? <Notice message={ok} tone="ok" /> : null}
            {error ? <Notice message={error} tone="danger" /> : null}

            <Card>
              <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.hwToday}</Body>
              <ChipRow>
                {items.map((i) => (
                  <Chip key={i.id} label={hwSubjectLabel(i.subject)} selected={itemId === i.id} onPress={() => setItemId(i.id)} />
                ))}
              </ChipRow>
            </Card>

            {!itemId ? (
              <Muted>{STR.pickSet}</Muted>
            ) : recsQ.fetching && records.length === 0 ? (
              <Loader label={STR.loading} />
            ) : records.length === 0 ? (
              <EmptyState message={STR.hwNoRecords} />
            ) : (
              records.map((r) => {
                const moves = NEXT_STATES[r.state] ?? [];
                return (
                  <Card key={r.id}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Body style={{ fontWeight: "700", flexShrink: 1 }}>{nameMap.get(r.studentId) ?? r.studentId}</Body>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                        {r.chaseCount > 0 ? <Badge text={`${STR.hwChaseAction} ${r.chaseCount}`} tone="warn" /> : null}
                        <Badge text={lifecycleStateLabel(r.state)} tone="brand" />
                      </View>
                    </View>
                    {moves.length > 0 ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: 8 }}>
                        {moves.map((to) => (
                          <View key={to} style={{ flexGrow: 1 }}>
                            <Button
                              title={moveLabel(r.state, to)}
                              variant="secondary"
                              onPress={() => onMove(r.id, to)}
                              loading={busyId === r.id}
                              disabled={busyId !== null}
                            />
                          </View>
                        ))}
                      </View>
                    ) : r.state === "SUBMITTED" ? (
                      <View style={{ marginTop: 8 }}>
                        <Muted style={{ marginBottom: 6 }}>{STR.hwCheckHint}</Muted>
                        <Button title={STR.hwGoChecking} onPress={() => navigation.navigate("CheckingQueue")} />
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
