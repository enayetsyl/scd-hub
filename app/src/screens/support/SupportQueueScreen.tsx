/**
 * সহায়তা রিপোর্ট যাচাই — the Principal's queue (docs/prd-child-support-profile.md §9.4, §6.5, §6.7).
 * Waiting reports (decide directly, no AI), processed reports, the quick-approve list; a safety
 * question or a bannered child pinned on top. Every report is read and approved one by one.
 */
import React, { useState } from "react";
import { ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { SUPPORT_QUEUE } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Chip, ChipRow, Loader, Notice, Badge } from "../../components/ui";
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
  quickApprovable: boolean;
}

export default function SupportQueueScreen({ navigation }: Props): React.ReactElement {
  const [tab, setTab] = useState<"TO_PROCESS" | "PROCESSED" | "QUICK">("PROCESSED");
  const [q] = useQuery<{ supportQueuePage: { total: number; waiting: number; oldestDays: number | null; held: number; rows: Row[] } }>({
    query: SUPPORT_QUEUE,
    variables: { status: tab, page: 1, pageSize: 50 },
    requestPolicy: "cache-and-network",
  });
  const page = q.data?.supportQueuePage;
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
            <Muted>{r.tone === "POSITIVE" ? STR.supToneP : r.tone === "CONCERN" ? STR.supToneC : r.tone ? STR.supToneM : ""}</Muted>
            {r.status === "TO_PROCESS" ? <Muted>{STR.supNoAiCheck}</Muted> : null}
            <Button title={r.safeguardingHold === "OPEN" ? STR.supSgQuestion : STR.supOpenRead} onPress={() => navigation.navigate("SupportReview", { reportId: r.id })} />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}
