/**
 * AiRulesScreen (AI-3, D-#1093) — the AI rules documents: which version of each is
 * switched on. `ai_assist:edit_rules` (Principal) or `ai_assist:read_rules`.
 */
import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { AI_POLICY_SUMMARIES } from "../../graphql/aiPolicies";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Notice, Loader, ErrorBanner, Badge } from "../../components/ui";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";

type Props = NativeStackScreenProps<AdminStackParamList, "AiRules">;

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export default function AiRulesScreen({ navigation }: Props): React.ReactElement {
  const [q] = useQuery({ query: AI_POLICY_SUMMARIES, requestPolicy: "cache-and-network" });
  const rows = q.data?.aiPolicySummaries;
  if (q.fetching && !rows) return <Loader />;
  if (q.error || !rows) return <ErrorBanner message={friendlyError(q.error as never)} />;

  return (
    <Screen scroll>
      <Notice tone="info" message={STR.airIntro} />
      {rows.map((r) => (
        <Card key={r.key} onPress={() => navigation.navigate("AiRule", { key: r.key })}>
          <Body style={{ fontWeight: "700" }}>{r.labelBn}</Body>
          <Badge text={r.activeVersion ? fill(STR.airActive, { v: r.activeVersion }) : STR.airOff} tone={r.activeVersion ? "ok" : "warn"} />
          <Muted>{fill(STR.airCount, { n: r.versions })}</Muted>
        </Card>
      ))}
    </Screen>
  );
}
