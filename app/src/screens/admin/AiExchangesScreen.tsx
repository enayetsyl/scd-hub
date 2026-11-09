/**
 * AiExchangesScreen (D-#1179) — the Principal's log of every AI request and reply: each
 * comment check and assistant question as it was sent (names hidden) and the AI's answer,
 * to study the model and improve the instructions, rules and standards.
 *
 * Filter by feature and Dhaka month; open one entry; CSV of the filter (web); delete the
 * filtered entries by hand (nothing is deleted automatically, owner 2026-11-09).
 * `ai_assist:read_ai_log` / `ai_assist:delete_ai_log` (both LOCKED); the server re-enforces.
 */
import React from "react";
import { Platform, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation, useQuery } from "urql";
import { AI_EXCHANGES_EXPORT, AI_EXCHANGES_PAGE, DELETE_AI_EXCHANGES, type AiExchangeRowT } from "../../graphql/aiExchanges";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Notice, Loader, ErrorBanner, Badge, Chip, ChipRow } from "../../components/ui";
import { Pager } from "../../components/Pager";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { usePageState } from "../../lib/paging";
import { STR, bnNum, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AiExchanges">;

const PAGE_SIZE = 25;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
export const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** "2026-11" for the Dhaka month `delta` months from now. */
export function dhakaMonth(delta = 0, now = new Date()): string {
  const local = new Date(now.getTime() + 6 * 3600_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const featureLabel = (f: string) => (f === "comment_check" ? STR.axlCheck : f === "assistant" ? STR.axlAssistant : f);

function csvCell(value: string | number | boolean | null | undefined): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function Row({ r, onOpen }: { r: AiExchangeRowT; onOpen: () => void }): React.ReactElement {
  const outcome =
    r.feature === "comment_check" && r.ok && r.issuesShown !== null
      ? r.issuesShown === 0
        ? STR.axlNoIssues
        : r.saved
          ? r.teacherOverrode
            ? fill(STR.axlKept, { shown: r.issuesShown ?? 0 })
            : fill(STR.axlAccepted, { shown: r.issuesShown ?? 0, accepted: r.issuesAccepted ?? 0 })
          : fill(STR.axlNotSaved, { shown: r.issuesShown ?? 0 })
      : null;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button">
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1), alignItems: "center" }}>
          <Badge text={featureLabel(r.feature)} tone="muted" />
          {!r.ok ? <Badge text={STR.axlFailed} tone="danger" /> : null}
          {r.fellBack ? <Badge text={STR.axlFellBack} tone="warn" /> : null}
        </View>
        <Body style={{ marginTop: space(1) }}>{r.preview || "—"}</Body>
        <Muted>{[isoDateTimeLabel(r.at), r.userName, r.modelName, `${(r.latencyMs / 1000).toFixed(1)} s`, usd(r.costUsd)].filter(Boolean).join(" · ")}</Muted>
        {outcome ? <Muted>{outcome}</Muted> : null}
      </Card>
    </Pressable>
  );
}

export default function AiExchangesScreen({ navigation }: Props): React.ReactElement {
  const { can } = useAuth();
  const canDelete = can("ai_assist:delete_ai_log");
  const client = useClient();
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [feature, setFeature] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState<string | null>(dhakaMonth());
  const [page, setPage] = usePageState(`${feature}-${month}`);
  const [q, refetch] = useQuery({ query: AI_EXCHANGES_PAGE, variables: { page, pageSize: PAGE_SIZE, feature, month }, requestPolicy: "cache-and-network" });
  const [delState, del] = useMutation(DELETE_AI_EXCHANGES);
  const [exporting, setExporting] = React.useState(false);
  const data = q.data?.aiExchangesPage;

  async function onExport(): Promise<void> {
    if (Platform.OS !== "web") return toast.show(STR.axlCsvWebOnly, "info");
    setExporting(true);
    const res = await client.query(AI_EXCHANGES_EXPORT, { feature, month }, { requestPolicy: "network-only" }).toPromise();
    setExporting(false);
    if (res.error || !res.data) return toast.show(friendlyError(res.error as never), "danger");
    const header = ["time", "feature", "person", "role", "model", "ok", "error", "latency_ms", "cost_usd", "fell_back", "policy", "issues_shown", "issues_accepted", "kept_own", "saved", "request", "reply"];
    const rows = res.data.aiExchangesExport.map(({ row: r, request, reply }) => [
      r.at, r.feature, r.userName, r.role, r.modelName, r.ok, r.errorKind, r.latencyMs, r.costUsd, r.fellBack, r.policyHash, r.issuesShown, r.issuesAccepted, r.teacherOverrode, r.saved, request, reply,
    ]);
    const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["﻿", body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-log-${feature ?? "all"}-${month ?? "all-time"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onDeleteFiltered(): Promise<void> {
    if (!data || data.total === 0) return;
    if (!feature && !month) return toast.show(STR.axlDeleteNeedFilter, "info");
    const ok = await confirmAction({ title: STR.axlDeleteTitle, message: fill(STR.axlDeleteConfirm, { n: data.total }), confirmLabel: STR.axlDeleteTitle, tone: "danger" });
    if (!ok) return;
    const res = await del({ feature, month });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(fill(STR.axlDeleted, { n: res.data?.deleteAiExchanges ?? 0 }), "ok");
    setPage(1);
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      <Notice tone="info" message={STR.axlIntro} />
      <ChipRow>
        <Chip label={STR.axlAll} selected={feature === null} onPress={() => setFeature(null)} />
        <Chip label={STR.axlCheck} selected={feature === "comment_check"} onPress={() => setFeature("comment_check")} />
        <Chip label={STR.axlAssistant} selected={feature === "assistant"} onPress={() => setFeature("assistant")} />
      </ChipRow>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), alignItems: "center", marginVertical: space(1) }}>
        <Button title="‹" variant="secondary" onPress={() => setMonth(shiftMonth(month ?? dhakaMonth(), -1))} />
        <Body style={{ fontWeight: "700" }}>{month ?? STR.axlAllTime}</Body>
        <Button title="›" variant="secondary" onPress={() => setMonth(shiftMonth(month ?? dhakaMonth(), 1))} disabled={!!month && month >= dhakaMonth()} />
        <Chip label={STR.axlAllTime} selected={month === null} onPress={() => setMonth(month === null ? dhakaMonth() : null)} />
      </View>
      {data ? <Muted>{fill(STR.axlCount, { n: bnNum(data.total) })}</Muted> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), marginVertical: space(1) }}>
        <Button title={STR.axlCsv} variant="secondary" onPress={() => void onExport()} loading={exporting} disabled={!data || data.total === 0} />
        {canDelete ? (
          <Button title={fill(STR.axlDeleteFiltered, { n: bnNum(data?.total ?? 0) })} variant="secondary" onPress={() => void onDeleteFiltered()} loading={delState.fetching} disabled={!data || data.total === 0} />
        ) : null}
      </View>
      {q.fetching && !data ? <Loader /> : null}
      {q.error ? <ErrorBanner message={friendlyError(q.error as never)} /> : null}
      {data ? (
        <>
          {data.rows.length === 0 ? <Muted>{STR.axlNone}</Muted> : null}
          {data.rows.map((r) => (
            <Row key={r.id} r={r} onOpen={() => navigation.navigate("AiExchange", { id: r.id })} />
          ))}
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => { setPage(p); refetch({ requestPolicy: "network-only" }); }} />
        </>
      ) : null}
    </Screen>
  );
}
