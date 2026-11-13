/**
 * শিশু সুরক্ষা — referrals (docs/prd-child-support-profile.md §16.5 SG-7). Only the holder of
 * `safeguarding:receive`; newest first; mark seen, one note line, handled outside the app. The app is
 * not a case system: what is done, and with whom, happens outside it.
 */
import React, { useState } from "react";
import { ScrollView } from "react-native";
import { useMutation, useQuery } from "urql";
import { SAFEGUARDING_SIGN_LABELS_BN, type SafeguardingSign } from "@scd/shared";
import { MARK_SAFEGUARDING_REFERRAL, SAFEGUARDING_REFERRALS } from "../../graphql/supportProfile";
import { Screen, Card, Body, Muted, Button, Field, Loader, Notice, Badge } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

interface Ref { id: string; studentName: string; raisedAt: string; source: string; signs: string[]; textBn: string; status: string; noteBn: string | null }

/** The referral date in Dhaka time (a UTC slice shows the wrong day after 18:00 UTC). */
const dhakaDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

export default function SafeguardingReferralsScreen(): React.ReactElement {
  const toast = useToast();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [q, refetch] = useQuery<{ safeguardingReferralsPage: { rows: Ref[] } }>({ query: SAFEGUARDING_REFERRALS, variables: { page: 1, pageSize: 50 }, requestPolicy: "network-only" });
  const [, mark] = useMutation(MARK_SAFEGUARDING_REFERRAL);
  const act = async (id: string, action: string) => {
    const r = await mark({ id, action, noteBn: notes[id] ?? null });
    if (r.error) return toast.show(friendlyError(r.error), "danger");
    refetch({ requestPolicy: "network-only" });
  };
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {q.fetching && !q.data ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {q.data?.safeguardingReferralsPage.rows.map((r) => (
          <Card key={r.id}>
            <Badge text={r.status === "RAISED" ? STR.supRefRaised : r.status === "SEEN" ? STR.supRefSeenS : r.status === "CLOSED_OUTSIDE_APP" ? STR.supRefClosedS : r.status} />
            <Body style={{ fontWeight: "700" }}>{`${r.studentName} · ${dhakaDay(r.raisedAt)}`}</Body>
            <Muted>{r.signs.map((s) => SAFEGUARDING_SIGN_LABELS_BN[s as SafeguardingSign] ?? s).join(" · ")}</Muted>
            <Body>{r.textBn}</Body>
            {r.noteBn ? <Muted>{r.noteBn}</Muted> : null}
            <Field label={STR.supRefNote} value={notes[r.id] ?? ""} onChangeText={(t) => setNotes({ ...notes, [r.id]: t })} />
            {r.status === "RAISED" ? <Button title={STR.supRefSeen} onPress={() => act(r.id, "SEEN")} /> : null}
            {r.status !== "CLOSED_OUTSIDE_APP" ? <Button title={STR.supRefClosed} variant="secondary" onPress={() => act(r.id, "CLOSED_OUTSIDE_APP")} /> : null}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
