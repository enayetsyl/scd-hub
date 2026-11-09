/**
 * RevisionReleaseScreen (SR-6, D-#1173) — a lead, the Office or the Principal sends a
 * Saturday's comments to the families. Shows each listener's progress, every recorded
 * entry still to go (to read first), who is still waiting, then one release button.
 * Releasing runs SR-2 delivery for each entry: inbox + push for families with the app,
 * and a WhatsApp link for each family (shown after). Gated on saturday_revision:release.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  RELEASE_REVISION_SATURDAY,
  REVISION_RELEASE_BOARD_QUERY,
  type RevisionDeliveryOutcomeT,
  type RevisionListenEntryT,
} from "../../graphql/revision";
import { Screen, Card, Body, Muted, Button, Badge, Notice, EmptyState } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { DateField } from "../../components/DateField";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { STR, bnNum, revCategoryLabel, revStatusLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { RevisionStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RevisionStackParamList, "RevisionRelease">;

/** "ফাতহ ২ · তানবিহ ৩ · ভুল ৩" for a present entry. */
function entryCounts(e: RevisionListenEntryT): string {
  if (!e.present) return STR.revAbsent;
  let fath = 0;
  let tanbih = 0;
  let mistakes = 0;
  for (const p of e.portions) {
    fath += p.fath;
    tanbih += p.tanbih;
    mistakes += p.mistakes.harf + p.mistakes.ghunnah + p.mistakes.madd + p.mistakes.other;
  }
  const notDone = e.portions.filter((p) => p.status !== "COMPLETED").map((p) => `${revCategoryLabel(p.category)} ${revStatusLabel(p.status)}`);
  return [`${STR.revFath} ${bnNum(fath)}`, `${STR.revTanbih} ${bnNum(tanbih)}`, `${STR.revMistakes} ${bnNum(mistakes)}`, ...notDone].join(" · ");
}

export default function RevisionReleaseScreen({ route }: Props): React.ReactElement {
  const [date, setDate] = useState(route.params.date);
  const [q, refetch] = useQuery({ query: REVISION_RELEASE_BOARD_QUERY, variables: { date }, requestPolicy: "cache-and-network" });
  const [, release] = useMutation(RELEASE_REVISION_SATURDAY);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<RevisionDeliveryOutcomeT[]>([]);

  const board = q.data?.revisionReleaseBoard;
  const ready = board?.ready ?? [];
  const pending = board?.pending ?? [];

  async function onRelease(): Promise<void> {
    setConfirming(false);
    setError(null);
    setBusy(true);
    const res = await release({ date, entryIds: ready.map((r) => r.entry.id) });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    setOutcomes(res.data?.releaseRevisionSaturday ?? []);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.revReleaseTitle}</Body>
          <DateField label={STR.revSaturdayDate} value={date} onChange={(d) => { setDate(d); setOutcomes([]); }} />
          {board ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
              <Badge text={`${STR.revReleaseReady}: ${bnNum(ready.length)}`} tone="brand" />
              <Badge text={`${STR.revListenPending}: ${bnNum(pending.length)}`} tone="warn" />
              <Badge text={`${STR.revReleaseAlready}: ${bnNum(board.releasedCount)}`} tone="muted" />
            </View>
          ) : null}
        </Card>

        {outcomes.length > 0 ? (
          <Card>
            <Notice message={STR.revReleaseDone} tone="ok" />
            {outcomes.map((o) => (
              <View key={o.entryId} style={{ marginTop: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{o.studentName}</Body>
                {o.waLink ? (
                  <Button title={STR.revOpenWa} variant="secondary" onPress={() => void Linking.openURL(o.waLink!)} />
                ) : (
                  <Muted>{o.unreachableByWa ? STR.revUnreachable : STR.revNoPhone}</Muted>
                )}
              </View>
            ))}
          </Card>
        ) : null}

        <QueryGate result={q} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {board && board.listeners.length > 0 ? (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.revReleaseByTeacher}</Body>
              {board.listeners.map((l) => (
                <View key={l.userId} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space(2) }}>
                  <Body style={{ flexShrink: 1 }}>{l.name}</Body>
                  <Badge
                    text={`${bnNum(l.recorded)}/${bnNum(l.assigned)} ${STR.revListenFinished}`}
                    tone={l.recorded >= l.assigned ? "brand" : "warn"}
                  />
                </View>
              ))}
            </Card>
          ) : null}

          {ready.length === 0 ? (
            <EmptyState message={STR.revReleaseNothing} />
          ) : (
            <Card>
              <Body style={{ fontWeight: "700" }}>{STR.revReleaseReview}</Body>
              {ready.map((r) => (
                <View key={r.entry.id} style={{ marginTop: space(3) }}>
                  <Body style={{ fontWeight: "700" }}>
                    {r.studentName} <Muted>· {r.groupNameBn}</Muted>
                  </Body>
                  <Muted>
                    {STR.revRecordedBy}: {r.recordedByName}
                  </Muted>
                  <Muted>{entryCounts(r.entry)}</Muted>
                  {r.entry.portions
                    .filter((p) => p.note)
                    .map((p, i) => (
                      <Body key={i}>
                        {revCategoryLabel(p.category)}: {p.note}
                      </Body>
                    ))}
                  {r.entry.teacherComment ? <Body>{r.entry.teacherComment}</Body> : null}
                </View>
              ))}
            </Card>
          )}

          {pending.length > 0 ? (
            <Card>
              <Notice message={`${bnNum(pending.length)} ${STR.revReleasePendingWarn}`} tone="warn" />
              {pending.map((p) => (
                <Muted key={p.studentId} style={{ marginTop: space(1) }}>
                  {p.studentName} · {p.groupNameBn} · {p.listenerName ?? STR.revReleaseNoListener}
                </Muted>
              ))}
            </Card>
          ) : null}

          {error ? <Notice message={error} tone="danger" /> : null}
          {ready.length > 0 ? (
            <Card>
              <Button title={`${STR.revReleaseButton} (${bnNum(ready.length)})`} onPress={() => setConfirming(true)} loading={busy} disabled={busy} />
              <Muted style={{ marginTop: space(1), textAlign: "center" }}>{STR.revReleaseHint}</Muted>
            </Card>
          ) : null}
        </QueryGate>
      </ScrollView>
      <ConfirmSheet
        visible={confirming}
        title={STR.revReleaseTitle}
        message={STR.revReleaseConfirm}
        confirmLabel={STR.revReleaseButton}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onRelease()}
      />
    </Screen>
  );
}
