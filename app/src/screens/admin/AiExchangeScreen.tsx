/**
 * AiExchangeScreen (D-#1179) — one logged AI request in full: who and when, the model, time
 * and cost, the instructions + standard exactly as sent, the chapter plan (assistant), the
 * earlier turns, the request and the reply (names hidden as [S] / [S1] …), and what the
 * writer did with the suggestions. Delete by hand. `ai_assist:read_ai_log` (LOCKED).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { AI_EXCHANGE, DELETE_AI_EXCHANGE } from "../../graphql/aiExchanges";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Loader, ErrorBanner, Badge, breakAnywhere } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { useConfirm } from "../../state/ConfirmContext";
import { useToast } from "../../state/ToastContext";
import { STR, isoDateTimeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { featureLabel, usd } from "./AiExchangesScreen";

type Props = NativeStackScreenProps<AdminStackParamList, "AiExchange">;

/** A JSON request / reply shown indented; anything else as it is. */
function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function TextBlock({ title, text, collapsible }: { title: string; text: string; collapsible?: boolean }): React.ReactElement {
  const [open, setOpen] = React.useState(!collapsible);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <Body style={{ fontWeight: "700" }}>{title}</Body>
        {collapsible ? <Button title={open ? STR.axlHide : STR.axlShow} variant="ghost" onPress={() => setOpen(!open)} /> : null}
      </View>
      {open ? (
        <Body style={[{ marginTop: space(1) }, breakAnywhere]}>{text || "—"}</Body>
      ) : null}
    </Card>
  );
}

export default function AiExchangeScreen({ route, navigation }: Props): React.ReactElement {
  const { id } = route.params;
  const { can } = useAuth();
  const { confirmAction } = useConfirm();
  const toast = useToast();
  const [q] = useQuery({ query: AI_EXCHANGE, variables: { id } });
  const [delState, del] = useMutation(DELETE_AI_EXCHANGE);
  const d = q.data?.aiExchange;

  async function onDelete(): Promise<void> {
    const ok = await confirmAction({ title: STR.axlDelete, message: STR.axlDeleteOne, confirmLabel: STR.axlDelete, tone: "danger" });
    if (!ok) return;
    const res = await del({ id });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    toast.show(STR.axlDeletedOne, "ok");
    navigation.goBack();
  }

  if (q.fetching && !d) return <Screen><Loader /></Screen>;
  if (q.error || !d) return <Screen><ErrorBanner message={friendlyError(q.error as never)} /></Screen>;
  const r = d.row;

  return (
    <Screen scroll>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(1) }}>
          <Badge text={featureLabel(r.feature)} tone="muted" />
          {!r.ok ? <Badge text={STR.axlFailed} tone="danger" /> : null}
          {r.fellBack ? <Badge text={STR.axlFellBack} tone="warn" /> : null}
        </View>
        <Body style={{ marginTop: space(1) }}>{[isoDateTimeLabel(r.at), r.userName].filter(Boolean).join(" · ")}</Body>
        <Muted>{[r.modelName, `${(r.latencyMs / 1000).toFixed(1)} s`, usd(r.costUsd)].filter(Boolean).join(" · ")}</Muted>
        {r.policyHash ? <Muted>{`${STR.axlStandard}: ${r.policyHash}`}</Muted> : null}
        {r.feature === "comment_check" && r.issuesShown !== null ? (
          <Muted>
            {[
              `${STR.axlShown}: ${r.issuesShown}`,
              r.saved ? `${STR.axlAcceptedShort}: ${r.issuesAccepted ?? 0}` : STR.axlNotSavedShort,
              r.saved && r.teacherOverrode ? STR.axlKeptShort : null,
              ...d.issueTypes.map((t) => `${t.type} ${t.count}`),
            ].filter(Boolean).join(" · ")}
          </Muted>
        ) : null}
        {d.attempts.length > 1 || !r.ok ? (
          <Muted>{d.attempts.map((a) => `${a.provider}/${a.modelName}: ${a.outcome}${a.errorKind ? ` (${a.errorKind})` : ""}`).join(" → ")}</Muted>
        ) : null}
      </Card>

      <TextBlock title={STR.axlRequest} text={pretty(d.request)} />
      <TextBlock title={STR.axlReply} text={r.ok ? pretty(d.reply) : `${STR.axlNoReply} ${r.errorKind ?? ""}`} />
      {d.history.length > 0 ? <TextBlock title={STR.axlHistory} text={d.history.map((h) => `${h.role === "user" ? "Q" : "A"}: ${h.text}`).join("\n\n")} collapsible /> : null}
      <TextBlock title={STR.axlPrefix} text={d.prefix} collapsible />
      {d.context ? <TextBlock title={STR.axlContext} text={d.context} collapsible /> : null}

      {can("ai_assist:delete_ai_log") ? (
        <View style={{ marginTop: space(2) }}>
          <Button title={STR.axlDelete} variant="secondary" onPress={() => void onDelete()} loading={delState.fetching} />
        </View>
      ) : null}
    </Screen>
  );
}
