/**
 * পপ-আপ বার্তা — the sender's list (D-#852). Office / Principal: every notice, newest first
 * (paged), with its derived status and progress; a draft opens the composer, a sent one
 * opens its report. "নতুন বার্তা" for holders of either send action.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { POPUP_NOTICES_PAGE, type PopupNoticeT } from "../../graphql/popupNotice";
import { Badge, Body, Button, Card, Chip, ChipRow, EmptyState, ErrorBanner, Loader, Muted, Screen } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { STR, bnNum } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import type { PopupStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<PopupStackParamList, "PopupNoticeList">;

const FILTERS: Array<{ key: string | null; label: () => string }> = [
  { key: null, label: () => STR.ppFilterAll },
  { key: "PUBLISHED", label: () => STR.ppFilterSent },
  { key: "DRAFT", label: () => STR.ppFilterDraft },
  { key: "WITHDRAWN", label: () => STR.ppFilterWithdrawn },
];

export function statusBadge(n: Pick<PopupNoticeT, "displayStatus">): { text: string; tone: "ok" | "info" | "muted" | "gold" | "danger" } {
  switch (n.displayStatus) {
    case "LIVE": return { text: STR.ppStatusLive, tone: "ok" };
    case "SCHEDULED": return { text: STR.ppStatusScheduled, tone: "info" };
    case "ENDED": return { text: STR.ppStatusEnded, tone: "muted" };
    case "WITHDRAWN": return { text: STR.ppStatusWithdrawn, tone: "danger" };
    default: return { text: STR.ppStatusDraft, tone: "gold" };
  }
}

export default function PopupNoticeListScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canSend = can("popup_notice:send_staff") || can("popup_notice:send_guardian");
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, refetch] = useQuery({ query: POPUP_NOTICES_PAGE, variables: { page, pageSize: 20, status }, requestPolicy: "cache-and-network" });
  useFocusEffect(React.useCallback(() => refetch({ requestPolicy: "network-only" }), [refetch]));

  const data = q.data?.popupNoticesPage;

  return (
    <Screen scroll>
      <Muted style={{ marginBottom: space(3) }}>{STR.ppListHint}</Muted>
      {canSend ? <Button title={STR.ppNew} onPress={() => navigation.navigate("PopupCompose", {})} style={{ marginBottom: space(3) }} /> : null}
      <ChipRow>
        {FILTERS.map((f) => (
          <Chip key={f.key ?? "all"} label={f.label()} selected={status === f.key} onPress={() => { setStatus(f.key); setPage(1); }} />
        ))}
      </ChipRow>
      {q.error ? <ErrorBanner message={friendlyError(q.error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}
      {q.fetching && !data ? <Loader label={STR.loading} /> : null}
      {data && data.rows.length === 0 ? <EmptyState message={STR.ppListEmpty} /> : null}
      {(data?.rows ?? []).map((n) => {
        const b = statusBadge(n);
        const reach = n.recipientCount - n.unreachableCount;
        return (
          <Card
            key={n.id}
            onPress={() => (n.status === "DRAFT" ? navigation.navigate("PopupCompose", { id: n.id }) : navigation.navigate("PopupReport", { id: n.id }))}
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center" }}>
              <Body style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180, fontWeight: "600" }}>{n.titleBn}</Body>
              <Badge text={b.text} tone={b.tone} />
            </View>
            <Muted>{n.audienceSummary}</Muted>
            {n.status !== "DRAFT" ? (
              <Muted>
                {STR.ppListProgress
                  .replace("{seen}", bnNum(n.seenCount))
                  .replace("{reach}", bnNum(reach))
                  .replace("{done}", bnNum(n.doneCount))}
                {n.unreachableCount > 0 ? ` · ${STR.ppNoLoginCount.replace("{n}", bnNum(n.unreachableCount))}` : ""}
              </Muted>
            ) : (
              <Muted>{STR.ppDraftBy.replace("{name}", n.createdByName)}</Muted>
            )}
          </Card>
        );
      })}
      {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
    </Screen>
  );
}
