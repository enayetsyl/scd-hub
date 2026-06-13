/**
 * CollectAssignmentScreen (AS-T2, AJ-4) — the due-date pass. Per-student
 * submitted toggle for the open records (GIVEN/DUE/CHASE); absent students get
 * a redeliver action (ABSENT_REDELIVER → GIVEN, item-wide due date). The
 * missing list and every count are DERIVED from records — never typed.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  AS_RECORDS,
  STUDENTS_QUERY,
  COLLECT_ASSIGNMENT,
  REDELIVER_AS_RECORD,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, lifecycleStateLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "CollectAssignment">;

/** States the collection pass acts on (the engine moves GIVEN→DUE itself). */
const OPEN_STATES = new Set(["GIVEN", "DUE", "CHASE"]);

export default function CollectAssignmentScreen({ route }: Props): React.ReactElement {
  const { itemId, sectionId, classId, asId } = route.params;

  const [recsQ, refetchRecs] = useQuery({
    query: AS_RECORDS,
    variables: { sectionId, classId, itemId },
  });
  const [studentsQ] = useQuery({ query: STUDENTS_QUERY, variables: { sectionId } });
  const nameOf = (id: string): string =>
    (studentsQ.data?.studentsInSection ?? []).find((s) => s.id === id)?.name ?? id;

  const [, collect] = useMutation(COLLECT_ASSIGNMENT);
  const [, redeliver] = useMutation(REDELIVER_AS_RECORD);

  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const records = recsQ.data?.assignmentRecords ?? [];
  const open = records.filter((r) => OPEN_STATES.has(r.state));
  const awaitingRedelivery = records.filter((r) => r.state === "ABSENT_REDELIVER");
  const done = records.filter((r) => !OPEN_STATES.has(r.state) && r.state !== "ABSENT_REDELIVER");

  async function onCollect(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await collect({
      sectionId,
      itemId,
      entries: open.map((r) => ({ recordId: r.id, submitted: !!submitted[r.id] })),
    });
    setBusy(false);
    if (res.error || !res.data?.collectAssignment) return setError(friendlyError(res.error));
    const c = res.data.collectAssignment;
    setOk(
      `${STR.asCollectDone} — ${STR.asSubmitted} ${bnNum(c.submittedCount)}, ${STR.asNotSubmitted} ${bnNum(
        c.chaseCount + c.pendingCount,
      )}`,
    );
    setSubmitted({});
    refetchRecs({ requestPolicy: "network-only" });
  }

  async function onRedeliver(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    const res = await redeliver({ sectionId, recordId });
    if (res.error || !res.data?.redeliverAssignmentRecord) return setError(friendlyError(res.error));
    refetchRecs({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{asId}</Body>
          <Muted style={{ marginTop: 2 }}>
            {STR.asSubmitted} {bnNum(records.filter((r) => r.state === "SUBMITTED" || r.state === "CHECKED" || r.state === "RESUBMIT" || r.state === "RETURNED").length)} ·{" "}
            {STR.asNotSubmitted} {bnNum(open.length)}
          </Muted>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {recsQ.fetching && records.length === 0 ? (
          <Loader label={STR.loading} />
        ) : records.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          <>
            {awaitingRedelivery.length > 0 ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: 4 }}>{lifecycleStateLabel("ABSENT_REDELIVER")}</Body>
                {awaitingRedelivery.map((r) => (
                  <View
                    key={r.id}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 48 }}
                  >
                    <Body>{nameOf(r.studentId)}</Body>
                    <Button title={STR.asRedeliver} variant="secondary" onPress={() => void onRedeliver(r.id)} />
                  </View>
                ))}
              </Card>
            ) : null}

            {open.length > 0 ? (
              <Card>
                <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.asCollectTitle}</Body>
                {open.map((r) => {
                  const isSubmitted = !!submitted[r.id];
                  return (
                    <Pressable
                      key={r.id}
                      onPress={() => setSubmitted((m) => ({ ...m, [r.id]: !m[r.id] }))}
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 48 }}
                    >
                      <View style={{ flexShrink: 1 }}>
                        <Body>{nameOf(r.studentId)}</Body>
                        <Muted>
                          {lifecycleStateLabel(r.state)}
                          {r.chaseCount > 0 ? ` · ${lifecycleStateLabel("CHASE")} ${bnNum(r.chaseCount)}` : ""}
                          {r.resubOf ? ` · ${STR.hwResubmissions}` : ""}
                        </Muted>
                      </View>
                      <Badge text={isSubmitted ? STR.asSubmitted : STR.asNotSubmitted} tone={isSubmitted ? "ok" : "warn"} />
                    </Pressable>
                  );
                })}
                <View style={{ marginTop: 8 }}>
                  <Button title={STR.asCollect} onPress={onCollect} loading={busy} disabled={busy} />
                </View>
              </Card>
            ) : null}

            {done.length > 0 ? (
              <Card>
                {done.map((r) => (
                  <View
                    key={r.id}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40 }}
                  >
                    <Body>{nameOf(r.studentId)}</Body>
                    <Badge text={lifecycleStateLabel(r.state)} tone="brand" />
                  </View>
                ))}
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
