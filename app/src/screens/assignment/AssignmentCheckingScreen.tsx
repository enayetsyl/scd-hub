/**
 * AssignmentCheckingScreen (AS-T3, AJ-5) — SUBMITTED → CHECKED with result +
 * optional marks (≤ totalMarks) + feedback. NOTHING auto-spawns (D-#87): the
 * resubmission button is the teacher's explicit call on any checked record;
 * RETURNED hands the paper back.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_RESULTS } from "@scd/shared";
import {
  AS_RECORDS,
  STUDENTS_QUERY,
  CHECK_AS_RECORD,
  ISSUE_AS_RESUBMISSION,
  TRANSITION_AS_RECORD,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwResultLabel, lifecycleStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentChecking">;

interface Pending {
  result: string;
  marks: string;
  feedback: string;
}

export default function AssignmentCheckingScreen({ route }: Props): React.ReactElement {
  const { itemId, sectionId, classId, asId } = route.params;

  const [recsQ, refetchRecs] = useQuery({
    query: AS_RECORDS,
    variables: { sectionId, classId, itemId },
  });
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId } });
  const nameOf = (id: string): string =>
    (studentsQ.data?.studentsInSection ?? []).find((s) => s.id === id)?.name ?? id;

  const [, check] = useMutation(CHECK_AS_RECORD);
  const [, resub] = useMutation(ISSUE_AS_RESUBMISSION);
  const [, transition] = useMutation(TRANSITION_AS_RECORD);

  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Records arrive in insertion order — list students alphabetically (owner
  // request; matches the studentsInSection server sort).
  const records = [...(recsQ.data?.assignmentRecords ?? [])].sort((a, b) =>
    nameOf(a.studentId).localeCompare(nameOf(b.studentId)),
  );
  const submitted = records.filter((r) => r.state === "SUBMITTED");
  const checked = records.filter((r) => r.state === "CHECKED");

  function setPend(id: string, patch: Partial<Pending>): void {
    setPending((m) => {
      const cur: Pending = m[id] ?? { result: "", marks: "", feedback: "" };
      return { ...m, [id]: { ...cur, ...patch } };
    });
  }

  function refresh(): void {
    refetchRecs({ requestPolicy: "network-only" });
  }

  async function onCheck(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    const p = pending[recordId];
    if (!p?.result) return setError(STR.hwResult);
    setBusy(true);
    const res = await check({
      sectionId,
      recordId,
      result: p.result,
      marks: p.marks.trim() === "" ? undefined : parseInt(p.marks, 10),
      feedback: p.feedback.trim() === "" ? undefined : p.feedback.trim(),
    });
    setBusy(false);
    if (res.error || !res.data?.checkAssignmentRecord) return setError(friendlyError(res.error));
    setOk(hwResultLabel(p.result));
    setPending((m) => {
      const next = { ...m };
      delete next[recordId];
      return next;
    });
    refresh();
  }

  async function onResubmit(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    const res = await resub({ sectionId, recordId });
    if (res.error || !res.data?.issueAssignmentResubmission) return setError(friendlyError(res.error));
    setOk(STR.asResubIssued);
    refresh();
  }

  async function onReturn(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    const res = await transition({ sectionId, recordId, toState: "RETURNED" });
    if (res.error || !res.data?.transitionAssignmentRecord) return setError(friendlyError(res.error));
    refresh();
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{asId}</Body>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : submitted.length === 0 && checked.length === 0 ? (
          <EmptyState message={STR.asNoSubmitted} />
        ) : (
          <>
            {submitted.map((r) => {
              const p = pending[r.id];
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Body style={{ fontWeight: "700" }}>{nameOf(r.studentId)}</Body>
                    <Badge text={lifecycleStateLabel(r.state)} tone="brand" />
                  </View>
                  {r.resubOf ? <Muted>{STR.hwResubmissions}</Muted> : null}
                  <Muted style={{ marginTop: 4 }}>{STR.hwResult}</Muted>
                  <ChipRow>
                    {HW_RESULTS.map((rv) => (
                      <Chip key={rv} label={hwResultLabel(rv)} selected={p?.result === rv} onPress={() => setPend(r.id, { result: rv })} />
                    ))}
                  </ChipRow>
                  <Field label={STR.asMarks} value={p?.marks ?? ""} onChangeText={(t) => setPend(r.id, { marks: t })} keyboardType="number-pad" />
                  <Field label={STR.asFeedback} value={p?.feedback ?? ""} onChangeText={(t) => setPend(r.id, { feedback: t })} />
                  <View style={{ marginTop: 8 }}>
                    <Button title={STR.asCheck} onPress={() => onCheck(r.id)} loading={busy} disabled={busy || !p?.result} />
                  </View>
                </Card>
              );
            })}

            {checked.map((r) => (
              <Card key={r.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{nameOf(r.studentId)}</Body>
                  <Badge text={lifecycleStateLabel(r.state)} tone="ok" />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {hwResultLabel(r.result)}
                  {r.marks !== null ? ` · ${STR.asMarks} ${bnNum(r.marks)}` : ""}
                  {r.feedback ? ` · ${r.feedback}` : ""}
                </Muted>
                <ChipRow>
                  <Chip label={STR.asReturn} onPress={() => void onReturn(r.id)} />
                  <Chip label={STR.asResubmit} onPress={() => void onResubmit(r.id)} />
                </ChipRow>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
