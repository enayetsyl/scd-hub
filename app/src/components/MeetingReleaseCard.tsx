/**
 * MeetingReleaseCard (D-#1635) — the Principal's "publish to guardians" card on the meeting
 * admin screen. Shows how many children have a final comment, asks for confirmation (and
 * says that teacher comments are NEVER shown), then shows the published state with a
 * withdraw action. Only the Principal sees the buttons; others see the state.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery, useMutation } from "urql";
import {
  MEETING_RELEASE_STATUS_QUERY,
  PUBLISH_MEETING_TO_GUARDIANS,
  WITHDRAW_MEETING_RELEASE,
} from "../graphql/meetingRelease";
import { Card, Body, Muted, Button, Badge, Notice, Loader } from "./ui";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../state/ConfirmContext";
import { friendlyError } from "../lib/errors";
import { STR, bnNum, isoDateLabel } from "../lib/labels";
import { space } from "../theme/tokens";

export function MeetingReleaseCard({ meetingId }: { meetingId: string }): React.ReactElement | null {
  const { role } = useAuth();
  const { confirmAction } = useConfirm();
  const [q, refetch] = useQuery({ query: MEETING_RELEASE_STATUS_QUERY, variables: { meetingId }, requestPolicy: "cache-and-network" });
  const [, publish] = useMutation(PUBLISH_MEETING_TO_GUARDIANS);
  const [, withdraw] = useMutation(WITHDRAW_MEETING_RELEASE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const s = q.data?.meetingReleaseStatus ?? null;
  if (q.error && !s) return null; // a caller without the meeting read permission: no card
  if (!s) {
    return (
      <Card>
        <Loader label={STR.loading} />
      </Card>
    );
  }
  const isPrincipal = role === "PRINCIPAL";

  async function onPublish(): Promise<void> {
    const yes = await confirmAction({ title: STR.mgrConfirmTitle, message: STR.mgrConfirmMsg, confirmLabel: STR.mgrConfirmYes, tone: "primary" });
    if (!yes) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await publish({ meetingId });
    setBusy(false);
    if (res.error) setError(friendlyError(res.error));
    else {
      setOk(STR.mgrPublishOk);
      refetch({ requestPolicy: "network-only" });
    }
  }

  async function onWithdraw(): Promise<void> {
    const yes = await confirmAction({ title: STR.mgrWithdrawTitle, message: STR.mgrWithdrawMsg, confirmLabel: STR.mgrWithdrawBtn, tone: "danger" });
    if (!yes) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await withdraw({ meetingId });
    setBusy(false);
    if (res.error) setError(friendlyError(res.error));
    else {
      setOk(STR.mgrWithdrawOk);
      refetch({ requestPolicy: "network-only" });
    }
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{STR.mgrCardTitle}</Body>
        {s.published ? <Badge text={STR.mgrPublished} tone="ok" /> : null}
      </View>
      <Muted style={{ marginTop: space(1) }}>{STR.mgrCardIntro}</Muted>
      <Muted style={{ marginTop: space(1) }}>
        {STR.mgrWithFinal}: {bnNum(s.withFinal)} · {STR.mgrWithoutFinal}: {bnNum(s.withoutFinal)}
      </Muted>
      {s.published && s.publishedAt ? (
        <Muted>
          {STR.mgrPublishedOn}: {isoDateLabel(s.publishedAt)}
          {s.publishedByName ? ` · ${s.publishedByName}` : ""}
        </Muted>
      ) : null}
      {ok ? <Notice message={ok} tone="ok" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {isPrincipal ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginTop: space(2) }}>
          {s.published ? (
            <Button title={STR.mgrWithdrawBtn} variant="secondary" onPress={() => void onWithdraw()} disabled={busy} />
          ) : (
            <Button title={STR.mgrPublishBtn} onPress={() => void onPublish()} loading={busy} disabled={busy} />
          )}
        </View>
      ) : (
        <Muted style={{ marginTop: space(1) }}>{STR.mgrPrincipalOnly}</Muted>
      )}
    </Card>
  );
}
