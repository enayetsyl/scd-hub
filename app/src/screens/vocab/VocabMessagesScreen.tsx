/**
 * VocabMessagesScreen (VC-5 / J6) — generate the Bangla guardian messages for a test
 * (or the cumulative period for its section) and deliver them: a wa.me click-to-send
 * link per family (ADR-003, opened on tap) + an in-app Notification for login-enabled
 * guardians (server-side, D-#72). Generation rides message:dispatch (Principal/Teacher/
 * Office); the Bangla deny surfaces inline if the caller can't.
 */
import React, { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  VOCAB_TEST_QUERY,
  GENERATE_VOCAB_TEST_MESSAGES,
  GENERATE_VOCAB_CUMULATIVE_MESSAGES,
  type VocabMessageRecipientT,
} from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Badge, Loader, Notice } from "../../components/ui";
import { STR, bnNum, vocabMessageKindLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { VocabStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<VocabStackParamList, "VocabMessages">;

export default function VocabMessagesScreen({ route }: Props): React.ReactElement {
  const { testId } = route.params;
  const [testQ] = useQuery({ query: VOCAB_TEST_QUERY, variables: { testId } });
  const test = testQ.data?.vocabTest ?? null;

  const [, genTest] = useMutation(GENERATE_VOCAB_TEST_MESSAGES);
  const [, genCum] = useMutation(GENERATE_VOCAB_CUMULATIVE_MESSAGES);

  const [recipients, setRecipients] = useState<VocabMessageRecipientT[]>([]);
  const [unreachable, setUnreachable] = useState<number>(0);
  const [notified, setNotified] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(rs: VocabMessageRecipientT[], unreachableCount: number): void {
    setRecipients(rs);
    setUnreachable(unreachableCount);
    setNotified(rs.reduce((n, r) => n + r.notifiedGuardianIds.length, 0));
    setOk(STR.vbGenerated);
  }

  async function onGenTest(): Promise<void> {
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await genTest({ testId });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) apply(res.data.generateVocabTestMessages.recipients, res.data.generateVocabTestMessages.unreachableCount);
  }

  async function onGenCumulative(): Promise<void> {
    if (!test) return;
    setError(null);
    setOk(null);
    setBusy(true);
    const res = await genCum({ sectionId: test.sectionId, program: test.program, mode: "WEEKLY" });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) apply(res.data.generateVocabCumulativeMessages.recipients, res.data.generateVocabCumulativeMessages.unreachableCount);
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{test?.label ?? STR.vbMessages}</Body>
          <View style={{ marginTop: space(2), gap: space(2) }}>
            <Button title={STR.vbGenMessages} onPress={onGenTest} loading={busy} disabled={busy} />
            <Button title={STR.vbGenCumulative} variant="secondary" onPress={onGenCumulative} loading={busy} disabled={busy || !test} />
          </View>
        </Card>

        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {recipients.length > 0 ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.vbRecipients}</Body>
            <Muted style={{ marginTop: space(1) }}>
              {STR.vbNotifiedCount}: {bnNum(notified)} · {STR.vbUnreachableCount}: {bnNum(unreachable)}
            </Muted>
            {recipients.map((r) => (
              <View key={r.studentId} style={{ marginTop: space(3) }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Body style={{ fontWeight: "700", flexShrink: 1 }}>{r.studentName}</Body>
                  <Badge text={vocabMessageKindLabel(r.kind)} tone="brand" />
                </View>
                <Muted style={{ marginTop: space(1) }}>{r.messageBn}</Muted>
                <View style={{ marginTop: space(2) }}>
                  {r.waLink ? (
                    <Button title={STR.vbSendWa} variant="secondary" onPress={() => void Linking.openURL(r.waLink!)} />
                  ) : (
                    <Badge text={STR.vbNoPhone} tone="muted" />
                  )}
                </View>
              </View>
            ))}
          </Card>
        ) : testQ.fetching ? (
          <Loader label={STR.loading} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
