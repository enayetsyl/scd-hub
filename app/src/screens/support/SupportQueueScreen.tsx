/**
 * সহায়তা রিপোর্ট যাচাই — the Principal's queue (docs/prd-child-support-profile.md §9.4, §6.5, §6.7).
 * Waiting reports (decide directly, no AI), processed reports, the quick-approve list; a safety
 * question or a bannered child pinned on top. Every report is read and approved one by one.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { DECIDE_SUPPORT_REPORT, RESOLVE_SUPPORT_HOLD, SUPPORT_QUEUE } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Field, Loader, Notice, Badge } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportQueue">;
interface Row {
  id: string;
  studentId: string;
  studentName: string | null;
  authorName: string | null;
  status: string;
  source: string;
  occurredOn: string;
  tone: string;
  safeguardingHold: string;
  checkSkipped: string;
  behaviour: string | null;
  goodThingText: string | null;
  quickApprovable: boolean;
}

export default function SupportQueueScreen({ navigation }: Props): React.ReactElement {
  const toast = useToast();
  const [tab, setTab] = useState<"TO_PROCESS" | "PROCESSED" | "QUICK">("PROCESSED");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [q, refetch] = useQuery<{ supportQueuePage: { total: number; waiting: number; oldestDays: number | null; held: number; rows: Row[] } }>({
    query: SUPPORT_QUEUE,
    variables: { status: tab, page: 1, pageSize: 50 },
    requestPolicy: "cache-and-network",
  });
  const [, decide] = useMutation(DECIDE_SUPPORT_REPORT);
  const [, resolveHold] = useMutation(RESOLVE_SUPPORT_HOLD);
  const page = q.data?.supportQueuePage;
  const act = async (fn: () => Promise<{ error?: Parameters<typeof friendlyError>[0] }>) => {
    const r = await fn();
    if (r.error) return toast.show(friendlyError(r.error), "danger");
    refetch({ requestPolicy: "network-only" });
  };
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {page ? <Body>{`${STR.supWaiting}: ${bnNum(page.waiting)}${page.oldestDays != null ? ` · ${STR.supOldestDays} ${bnNum(page.oldestDays)}` : ""}`}</Body> : null}
        <Button title={STR.supBatchTitle} variant="secondary" onPress={() => navigation.navigate("SupportBatch")} />
        <ChipRow>
          <Chip label={STR.supProcessed} selected={tab === "PROCESSED"} onPress={() => setTab("PROCESSED")} />
          <Chip label={STR.supWaiting} selected={tab === "TO_PROCESS"} onPress={() => setTab("TO_PROCESS")} />
          <Chip label={STR.supQuick} selected={tab === "QUICK"} onPress={() => setTab("QUICK")} />
        </ChipRow>
        {q.fetching && !page ? <Loader /> : null}
        {q.error ? <Notice message={friendlyError(q.error)} tone="danger" /> : null}
        {page?.rows.map((r) => (
          <Card key={r.id}>
            {r.safeguardingHold === "OPEN" ? <Badge text={STR.supHeld} /> : null}
            <Body>{`${r.studentName ?? ""} · ${r.occurredOn} · ${r.authorName ?? ""}`}</Body>
            {r.behaviour ? <Muted>{r.behaviour}</Muted> : null}
            {r.goodThingText ? <Muted>{`${STR.supFieldGood}: ${r.goodThingText}`}</Muted> : null}
            {r.status === "TO_PROCESS" ? <Muted>{STR.supNoAiCheck}</Muted> : null}
            <Button title={STR.supFullProfile} variant="ghost" onPress={() => navigation.navigate("SupportCard", { studentId: r.studentId, via: "QUEUE", full: true })} />
            {r.safeguardingHold === "OPEN" ? (
              <View style={{ gap: space(2) }}>
                <Body style={{ fontWeight: "700" }}>{STR.supSgQuestion}</Body>
                <Button title={STR.supSgHoldYes} variant="danger" onPress={() => act(() => resolveHold({ reportId: r.id, answer: "YES" }))} />
                <Button title={STR.supSgHoldNo} variant="secondary" onPress={() => act(() => resolveHold({ reportId: r.id, answer: "NO" }))} />
              </View>
            ) : (
              <View style={{ gap: space(2) }}>
                <Button title={STR.supApprove} onPress={() => act(() => decide({ reportId: r.id, decision: "APPROVED" }))} />
                <Field label={STR.supReason} value={reason[r.id] ?? ""} onChangeText={(t) => setReason({ ...reason, [r.id]: t })} />
                <Button title={STR.supReturn} variant="secondary" onPress={() => act(() => decide({ reportId: r.id, decision: "RETURNED", reasonBn: reason[r.id] ?? "" }))} />
                <Button title={STR.supNotUsed} variant="ghost" onPress={() => act(() => decide({ reportId: r.id, decision: "NOT_USED", reasonBn: reason[r.id] ?? "" }))} />
              </View>
            )}
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
