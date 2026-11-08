/**
 * AiRuleScreen (AI-3, D-#1093) — one AI rules document.
 *   Principal (`ai_assist:edit_rules`): every version (paged, D-#761), its text, switch a
 *     version on, switch the document off, write a new version from any version.
 *   Reader (`ai_assist:read_rules`): the ACTIVE version only — the training sheet.
 */
import React from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  ACTIVATE_AI_POLICY_VERSION,
  ACTIVE_AI_POLICY,
  AI_POLICY_VERSIONS_PAGE,
  DEACTIVATE_AI_POLICY,
  type AiPolicyVersionT,
} from "../../graphql/aiPolicies";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Notice, Loader, ErrorBanner, Badge, Button, Chip, ChipRow } from "../../components/ui";
import Markdown from "../../components/Markdown";
import { Pager } from "../../components/Pager";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { useAuth } from "../../auth/AuthContext";
import { usePageState } from "../../lib/paging";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "AiRule">;

const PAGE_SIZE = 20;
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

function VersionMeta({ v }: { v: AiPolicyVersionT }): React.ReactElement {
  const when = new Date(v.createdAt).toLocaleDateString();
  return (
    <>
      <Muted>{v.createdByName ? fill(STR.airWrittenBy, { name: v.createdByName, when }) : fill(STR.airSeeded, { when })}</Muted>
      {v.note ? <Muted>{v.note}</Muted> : null}
      <Muted>{v.hash}</Muted>
    </>
  );
}

function ReaderView({ keyName }: { keyName: AdminStackParamList["AiRule"]["key"] }): React.ReactElement {
  const [q] = useQuery({ query: ACTIVE_AI_POLICY, variables: { key: keyName }, requestPolicy: "cache-and-network" });
  if (q.fetching && !q.data) return <Loader />;
  if (q.error) return <ErrorBanner message={friendlyError(q.error as never)} />;
  const v = q.data?.activeAiPolicy;
  if (!v) return <Screen><Notice tone="warn" message={STR.airNotActiveYet} /></Screen>;
  return (
    <Screen scroll>
      <Card>
        <Badge text={fill(STR.airActive, { v: v.version })} tone="ok" />
        <Markdown source={v.body} />
      </Card>
    </Screen>
  );
}

export default function AiRuleScreen({ navigation, route }: Props): React.ReactElement {
  const { key } = route.params;
  const { can } = useAuth();
  if (!can("ai_assist:edit_rules")) return <ReaderView keyName={key} />;
  return <EditorView navigation={navigation} keyName={key} />;
}

function EditorView({ navigation, keyName }: { navigation: Props["navigation"]; keyName: Props["route"]["params"]["key"] }): React.ReactElement {
  const [page, setPage] = usePageState(keyName);
  const [q, refetch] = useQuery({
    query: AI_POLICY_VERSIONS_PAGE,
    variables: { key: keyName, page, pageSize: PAGE_SIZE },
    requestPolicy: "cache-and-network",
  });
  const [, activate] = useMutation(ACTIVATE_AI_POLICY_VERSION);
  const [, deactivate] = useMutation(DEACTIVATE_AI_POLICY);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<"on" | "off" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const rows = q.data?.aiPolicyVersionsPage.rows;
  if (q.fetching && !rows) return <Loader />;
  if (q.error || !rows) return <ErrorBanner message={friendlyError(q.error as never)} />;

  const selected = rows.find((r) => r.id === selectedId) ?? rows.find((r) => r.active) ?? rows[0] ?? null;

  async function run(kind: "on" | "off"): Promise<void> {
    if (!selected) return;
    setConfirm(null);
    setBusy(true);
    setError(null);
    const res = kind === "on" ? await activate({ id: selected.id }) : await deactivate({ key: keyName });
    setBusy(false);
    if (res.error) setError(friendlyError(res.error as never));
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Screen scroll>
      {rows.length === 0 ? (
        <Card>
          <Muted>{STR.airNone}</Muted>
          <Button title={STR.airWriteFirst} onPress={() => navigation.navigate("AiRuleEdit", { key: keyName })} />
        </Card>
      ) : (
        <>
          <Card>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <ChipRow>
                {rows.map((r) => (
                  <Chip
                    key={r.id}
                    label={`${fill(STR.airVersion, { v: r.version })} · ${r.active ? STR.airBadgeActive : STR.airBadgeDraft}`}
                    selected={selected?.id === r.id}
                    onPress={() => setSelectedId(r.id)}
                  />
                ))}
              </ChipRow>
            </ScrollView>
            <Pager page={page} pageSize={PAGE_SIZE} total={q.data?.aiPolicyVersionsPage.total ?? 0} onPage={setPage} />
          </Card>
          {selected ? (
            <Card>
              <Badge text={selected.active ? STR.airBadgeActive : STR.airBadgeDraft} tone={selected.active ? "ok" : "muted"} />
              <Body style={{ fontWeight: "700" }}>{fill(STR.airVersion, { v: selected.version })}</Body>
              <VersionMeta v={selected} />
              {error ? <Notice tone="danger" message={error} /> : null}
              <View style={{ gap: space(2), marginTop: space(2) }}>
                {selected.active ? (
                  <Button title={STR.airDeactivate} variant="secondary" onPress={() => setConfirm("off")} loading={busy} />
                ) : (
                  <Button title={STR.airActivate} onPress={() => setConfirm("on")} loading={busy} />
                )}
                <Button title={STR.airEditFrom} variant="secondary" onPress={() => navigation.navigate("AiRuleEdit", { key: keyName, fromId: selected.id })} />
              </View>
              <View style={{ marginTop: space(3) }}>
                <Markdown source={selected.body} />
              </View>
            </Card>
          ) : null}
        </>
      )}
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === "off" ? STR.airDeactivateConfirm : STR.airActivateConfirm}
        confirmLabel={confirm === "off" ? STR.airDeactivate : STR.airActivate}
        tone={confirm === "off" ? "danger" : "primary"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(confirm ?? "on")}
      />
    </Screen>
  );
}
