/**
 * MessageTemplatesScreen (MT-3, D-#129) — the Principal's list of every generated-
 * message template, grouped by feature, each row showing a Default/Edited badge.
 * Tap a row → MessageTemplateEdit. Gated `template:manage` (server re-checks).
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { MESSAGE_TEMPLATES_QUERY, type MessageTemplateRow } from "../../graphql/operations";
import type { AdminStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Loader, ErrorBanner, EmptyState } from "../../components/ui";
import { STR, mtGroupLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<AdminStackParamList, "MessageTemplates">;

export default function MessageTemplatesScreen({ navigation }: Props): React.ReactElement {
  const [{ data, fetching, error }, refetch] = useQuery({ query: MESSAGE_TEMPLATES_QUERY });

  React.useEffect(() => {
    const unsub = navigation.addListener("focus", () => refetch({ requestPolicy: "network-only" }));
    return unsub;
  }, [navigation, refetch]);

  if (fetching && !data) return <Loader label={STR.mtTitle} />;
  if (error) return <Screen padded><ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /></Screen>;

  const rows = data?.messageTemplates ?? [];
  if (rows.length === 0) return <Screen padded><EmptyState message={STR.mtHistoryEmpty} /></Screen>;

  // Group by feature, preserving the registry order.
  const groups: { group: string; items: MessageTemplateRow[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.group === r.group);
    if (!g) {
      g = { group: r.group, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }

  return (
    <Screen scroll>
      <Muted style={{ marginBottom: space(3) }}>{STR.mtSubtitle}</Muted>
      {groups.map((g) => (
        <View key={g.group} style={{ marginBottom: space(3) }}>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{mtGroupLabel(g.group)}</Body>
          {g.items.map((r) => (
            <Card key={r.key} onPress={() => navigation.navigate("MessageTemplateEdit", { key: r.key, labelBn: r.labelBn })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Body style={{ flex: 1, fontWeight: "700" }}>{r.labelBn}</Body>
                <Badge
                  text={r.isDefault ? STR.mtDefaultBadge : STR.mtOverriddenBadge}
                  tone={r.isDefault ? "muted" : "info"}
                />
              </View>
              <Muted style={{ marginTop: 2 }}>{r.bnBody}</Muted>
            </Card>
          ))}
        </View>
      ))}
    </Screen>
  );
}
