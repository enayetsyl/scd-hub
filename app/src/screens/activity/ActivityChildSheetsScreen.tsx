/**
 * ActivityChildSheetsScreen (AS-3, A3) — a child's activity sheets, newest first: asked,
 * printed, with the child, back (how it went + sticker), not returned. A request can be
 * withdrawn until it is printed. Guardian: the selected child. (AS-4 adds the answer page.)
 */
import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACTIVITY_ANSWER_IMAGE, ACTIVITY_LEVEL_UP_HINTS, CANCEL_ACTIVITY_REQUEST, CHILD_ACTIVITY_SHEETS_QUERY, type ActivityChildSheetT } from "../../graphql/activitySheets";
import { Image } from "react-native";
import { Badge, Button, Card, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { friendlyError } from "../../lib/errors";
import { STR, activityLevelLabel, activityResultLabel, isoDateLabel } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

/** The answer page — only once the sheet is back (AS-4, D-#991). */
function AnswerToggle({ issueId }: { issueId: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [q] = useQuery({ query: ACTIVITY_ANSWER_IMAGE, variables: { issueId }, pause: !open });
  return (
    <View style={{ marginTop: space(2) }}>
      <Button title={open ? STR.actHideAnswer : STR.actShowAnswer} variant="ghost" onPress={() => setOpen((v) => !v)} />
      {open && q.error ? <Notice tone="danger" message={friendlyError(q.error)} /> : null}
      {open && q.data?.activityAnswerImage ? (
        <Image source={{ uri: q.data.activityAnswerImage }} style={{ width: "100%", aspectRatio: 595 / 842 }} resizeMode="contain" />
      ) : null}
    </View>
  );
}

const statusText = (s: string): string => (STR as unknown as Record<string, string>)[`actStatus${s}`] ?? s;
const pathText = (p: string): string => (STR as unknown as Record<string, string>)[`actPath${p}`] ?? p;

export function ActivitySheetRow({ row, onCancel, extra }: { row: ActivityChildSheetT; onCancel?: () => void; extra?: React.ReactNode }): React.ReactElement {
  const colors = useColors();
  const i = row.issue;
  const tone = i.status === "RETURNED" ? (i.result === "ALL_CORRECT" ? "ok" : i.result === "INCOMPLETE" ? "warn" : "info") : i.status === "NOT_RETURNED" ? "danger" : "muted";
  return (
    <Card style={{ marginBottom: space(3) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
        <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, flex: 1 }}>
          {row.bankNameBn} · {activityLevelLabel(row.level)}
        </Text>
        <Badge text={i.status === "RETURNED" && i.result ? activityResultLabel(i.result) : statusText(i.status).split(" — ")[0]} tone={tone as never} />
      </View>
      <Muted style={{ fontSize: 12 }}>
        {row.itemId} · {pathText(i.path)} · {isoDateLabel(i.returnedAt ?? i.handedAt ?? i.requestedAt)}
      </Muted>
      {i.status !== "RETURNED" ? <Muted style={{ marginTop: space(1) }}>{statusText(i.status)}</Muted> : null}
      {i.stickerGiven ? <Muted style={{ marginTop: space(1) }}>⭐ {STR.actSticker}</Muted> : null}
      {i.stickerOwed ? <Muted style={{ marginTop: space(1) }}>⭐ {STR.actStickerOwed}</Muted> : null}
      {extra}
      {onCancel && i.status === "REQUESTED" ? <Button title={STR.actCancelAsk} variant="ghost" onPress={onCancel} /> : null}
    </Card>
  );
}

export default function ActivityChildSheetsScreen(): React.ReactElement {
  const { selected: child } = useGuardianChild();
  const studentId = child?.studentId ?? null;
  const [q, refetch] = useQuery({ query: CHILD_ACTIVITY_SHEETS_QUERY, variables: { studentId: studentId ?? "" }, pause: !studentId, requestPolicy: "cache-and-network" });
  const [, cancel] = useMutation(CANCEL_ACTIVITY_REQUEST);
  const [hintsQ] = useQuery({ query: ACTIVITY_LEVEL_UP_HINTS, variables: { studentId: studentId ?? "" }, pause: !studentId });
  const [msg, setMsg] = React.useState<string | null>(null);
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const rows = q.data?.childActivitySheets ?? [];
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} refreshControl={<RefreshControl refreshing={q.fetching} onRefresh={reload} />}>
        {msg ? <Notice tone="danger" message={msg} /> : null}
        {(hintsQ.data?.activityLevelUpHints ?? []).map((h) => (
          <Notice key={h.bankId} tone="ok" message={STR.actLevelHint.replace("{bank}", h.bankNameBn).replace("{from}", activityLevelLabel(h.from)).replace("{to}", activityLevelLabel(h.to))} />
        ))}
        <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
          {rows.length === 0 ? <Muted>{STR.actMySheetsEmpty}</Muted> : null}
          {rows.map((r) => (
            <ActivitySheetRow
              key={r.issue.id}
              row={r}
              extra={r.issue.status === "RETURNED" && r.hasAnswer ? <AnswerToggle issueId={r.issue.id} /> : null}
              onCancel={() =>
                void cancel({ issueId: r.issue.id }).then((res) => {
                  if (res.error) setMsg(friendlyError(res.error));
                  reload();
                })
              }
            />
          ))}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
