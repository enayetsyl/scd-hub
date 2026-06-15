/**
 * DeliverRevisionScreen (J-SR2, SR-2) — deliver one group's Saturday revision to
 * guardians. A "deliver all" button (deliverGroupRevisionSaturday) and a per-entry
 * deliver (deliverRevisionEntry). Each outcome's waLink opens via Linking.openURL
 * (manual send — there is no auto-dispatch); unreachable + escalation counts are
 * summarised. tracker:read writes are re-gated + row-scoped server-side.
 */
import React, { useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  GROUP_REVISION_SATURDAY_QUERY,
  DELIVER_GROUP_REVISION_SATURDAY,
  DELIVER_REVISION_ENTRY,
  type RevisionDeliveryOutcomeT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Badge, Notice, Loader, EmptyState } from "../../components/ui";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "DeliverRevision">;

export default function DeliverRevisionScreen({ route }: Props): React.ReactElement {
  const { groupId, code, nameBn, date } = route.params;
  const [gridQ, refetchGrid] = useQuery({
    query: GROUP_REVISION_SATURDAY_QUERY,
    variables: { groupId, date },
  });
  const rows = gridQ.data?.groupRevisionSaturday ?? [];

  const [outcomes, setOutcomes] = useState<RevisionDeliveryOutcomeT[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, deliverAll] = useMutation(DELIVER_GROUP_REVISION_SATURDAY);
  const [, deliverOne] = useMutation(DELIVER_REVISION_ENTRY);

  /** Undelivered entries are the deliverable set; a delivered row is already done. */
  const undelivered = useMemo(() => rows.filter((r) => r.entry && !r.entry.deliveredAt), [rows]);

  const summary = useMemo(() => {
    const delivered = outcomes.filter((o) => o.deliveredAt).length;
    const unreachable = outcomes.filter((o) => o.unreachableByWa).length;
    const escalated = outcomes.filter((o) => (o.escalatedStreak ?? 0) > 0).length;
    return { delivered, unreachable, escalated };
  }, [outcomes]);

  async function onDeliverAll(): Promise<void> {
    setError(null);
    setBusy(true);
    const res = await deliverAll({ groupId, date });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOutcomes(res.data?.deliverGroupRevisionSaturday ?? []);
    refetchGrid({ requestPolicy: "network-only" });
  }

  async function onDeliverOne(entryId: string): Promise<void> {
    setError(null);
    setBusy(true);
    const res = await deliverOne({ entryId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    const o = res.data?.deliverRevisionEntry;
    if (o) setOutcomes((prev) => [o, ...prev.filter((p) => p.entryId !== o.entryId)]);
    refetchGrid({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{nameBn}</Body>
          <Muted>
            {code} · {bnNum(date)}
          </Muted>
          {error ? <Notice message={error} tone="danger" /> : null}
          {gridQ.fetching ? (
            <Loader label={STR.loading} />
          ) : undelivered.length === 0 && outcomes.length === 0 ? (
            <EmptyState message={STR.revNoEntries} />
          ) : (
            <View style={{ marginTop: space(2) }}>
              <Button title={STR.revDeliverAll} onPress={onDeliverAll} loading={busy} disabled={busy} />
            </View>
          )}
        </Card>

        {outcomes.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.revDeliverTitle}</Body>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Badge text={`${STR.revDeliveredCount}: ${bnNum(summary.delivered)}`} tone="brand" />
              <Badge text={`${STR.revUnreachableCount}: ${bnNum(summary.unreachable)}`} tone="warn" />
              <Badge text={`${STR.revEscalatedCount}: ${bnNum(summary.escalated)}`} tone="danger" />
            </View>
            {outcomes.map((o) => (
              <View key={o.entryId} style={{ marginTop: space(3) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{o.studentName}</Body>
                  <Badge
                    text={o.present ? STR.revPresent : STR.revAbsent}
                    tone={o.present ? "brand" : "muted"}
                  />
                </View>
                <Muted>{o.messageBn}</Muted>
                {(o.escalatedStreak ?? 0) > 0 ? (
                  <Badge text={`${STR.revEscalated}: ${bnNum(o.escalatedStreak ?? 0)}`} tone="danger" />
                ) : null}
                <View style={{ marginTop: space(1) }}>
                  {o.waLink ? (
                    <Button title={STR.revOpenWa} variant="secondary" onPress={() => void Linking.openURL(o.waLink!)} />
                  ) : (
                    <Badge text={o.unreachableByWa ? STR.revUnreachable : STR.revNoPhone} tone="muted" />
                  )}
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {undelivered.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.revDeliverOne}</Body>
            {undelivered.map((r) => (
              <View
                key={r.studentId}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: space(2),
                }}
              >
                <Body style={{ flexShrink: 1 }}>{r.studentName}</Body>
                <Button
                  title={STR.revDeliverOne}
                  variant="ghost"
                  onPress={() => void onDeliverOne(r.entry!.id)}
                  disabled={busy}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
