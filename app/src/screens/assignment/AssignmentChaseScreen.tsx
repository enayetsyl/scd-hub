/**
 * AssignmentChaseScreen (AS-T4, D-#88) — the OFFICE follow-up worklist.
 * Every CHASE record with contact + days overdue; per record the escalation
 * ladder: steps 1–2 in-app (skippable while delivery is pipeline-gated),
 * step 3+ the generated Bangla WhatsApp message + wa.me link (manual send,
 * ADR-003) with the sent-status/outcome stamp. History is append-only.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  AS_CHASE_LIST,
  AS_FOLLOWUPS,
  ESCALATE_AS_CHASE,
  RECORD_AS_FOLLOWUP_OUTCOME,
} from "../../graphql/operations";
import type { AssignmentStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Button, Field, Chip, ChipRow, Loader, EmptyState, Notice } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AssignmentStackParamList, "AssignmentChase">;

export default function AssignmentChaseScreen(_props: Props): React.ReactElement {
  const [listQ, refetchList] = useQuery({ query: AS_CHASE_LIST });
  const entries = listQ.data?.assignmentChaseList ?? [];

  const [expanded, setExpanded] = useState<string | null>(null);
  const [followUpsQ, refetchFollowUps] = useQuery({
    query: AS_FOLLOWUPS,
    variables: { recordId: expanded ?? "" },
    pause: !expanded,
  });
  const followUps = expanded ? followUpsQ.data?.assignmentFollowUps ?? [] : [];

  const [, escalate] = useMutation(ESCALATE_AS_CHASE);
  const [, stampOutcome] = useMutation(RECORD_AS_FOLLOWUP_OUTCOME);

  const [skipInApp, setSkipInApp] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh(): void {
    refetchList({ requestPolicy: "network-only" });
    if (expanded) refetchFollowUps({ requestPolicy: "network-only" });
  }

  async function onEscalate(recordId: string): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await escalate({ recordId, skipInApp: skipInApp || undefined });
    setBusy(false);
    if (res.error || !res.data?.escalateAssignmentChase) return setError(friendlyError(res.error));
    const step = res.data.escalateAssignmentChase;
    setOk(`${STR.asStep} ${bnNum(step.stepNumber)} — ${step.step} (${step.sentStatus})`);
    setSkipInApp(false);
    refresh();
  }

  async function onStamp(followUpId: string, sentStatus: "SENT" | "SKIPPED"): Promise<void> {
    setError(null);
    setOk(null);
    const res = await stampOutcome({
      followUpId,
      sentStatus,
      outcome: outcome.trim() === "" ? undefined : outcome.trim(),
    });
    if (res.error || !res.data?.recordAssignmentFollowUpOutcome) return setError(friendlyError(res.error));
    setOutcome("");
    refresh();
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {listQ.fetching && entries.length === 0 ? (
          <Loader label={STR.loading} />
        ) : entries.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          entries.map((e) => {
            const isOpen = expanded === e.recordId;
            const pendingRow = isOpen ? followUps.find((f) => f.sentStatus === "PENDING") : undefined;
            return (
              <Card key={e.recordId}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700" }}>{e.studentName}</Body>
                  <Badge text={`${bnNum(e.daysOverdue)} ${STR.asDaysOverdue}`} tone="warn" />
                </View>
                <Muted style={{ marginTop: 2 }}>
                  {e.asId} · {hwSubjectLabel(e.subject)} · {STR.asWeek} {bnNum(e.weekNumber)}
                  {e.guardianPhone ? ` · ${e.guardianPhone}` : ""}
                </Muted>
                <Muted>
                  {STR.asNextStep}: {bnNum(e.nextStepNumber)}
                </Muted>
                <ChipRow>
                  <Chip
                    label={isOpen ? "▴" : `${STR.asFollowUpHistory} (${bnNum(e.followUpCount)})`}
                    onPress={() => setExpanded(isOpen ? null : e.recordId)}
                  />
                  {e.nextStepNumber <= 2 ? (
                    <Chip label={STR.asSkipInApp} selected={skipInApp && isOpen} onPress={() => { setExpanded(e.recordId); setSkipInApp((v) => !v); }} />
                  ) : null}
                </ChipRow>
                <View style={{ marginTop: 8 }}>
                  <Button title={STR.asEscalate} onPress={() => onEscalate(e.recordId)} loading={busy} disabled={busy} />
                </View>

                {isOpen ? (
                  followUpsQ.fetching ? (
                    <Loader label={STR.loading} />
                  ) : (
                    <View style={{ marginTop: 8 }}>
                      {followUps.map((f) => (
                        <View key={f.id} style={{ marginTop: 6 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Body>
                              {STR.asStep} {bnNum(f.stepNumber)} — {f.step}
                            </Body>
                            <Badge
                              text={f.sentStatus}
                              tone={f.sentStatus === "SENT" || f.sentStatus === "RECORDED" ? "ok" : f.sentStatus === "PENDING" ? "warn" : "muted"}
                            />
                          </View>
                          {f.outcome ? <Muted>{f.outcome}</Muted> : null}
                          <Muted>{f.followUpDate.slice(0, 10)}</Muted>
                        </View>
                      ))}
                      {pendingRow ? (
                        <View style={{ marginTop: 8 }}>
                          <Muted>{pendingRow.messageBn}</Muted>
                          {pendingRow.waLink ? (
                            <View style={{ marginTop: 8 }}>
                              <Button title={STR.asOpenWa} onPress={() => void Linking.openURL(pendingRow.waLink as string)} />
                            </View>
                          ) : null}
                          <Field label={STR.asOutcome} value={outcome} onChangeText={setOutcome} />
                          <ChipRow>
                            <Chip label={STR.asMarkSent} onPress={() => void onStamp(pendingRow.id, "SENT")} />
                            <Chip label={STR.asMarkSkipped} onPress={() => void onStamp(pendingRow.id, "SKIPPED")} />
                          </ChipRow>
                        </View>
                      ) : null}
                    </View>
                  )
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
