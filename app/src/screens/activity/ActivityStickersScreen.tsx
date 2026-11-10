/**
 * ActivityStickersScreen (AS-4) — stickers owed for sheets returned through the box.
 * A class teacher sees their own sections (activity_sheets:check); the office sees all
 * (activity_sheets:issue). Tick the children who got their sticker → "দেওয়া হলো".
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACTIVITY_STICKERS_OWED, GIVE_ACTIVITY_STICKERS } from "../../graphql/activitySheets";
import { Button, Card, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, activityResultLabel, bnNum, classLevelLabel } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

export default function ActivityStickersScreen(): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: ACTIVITY_STICKERS_OWED, requestPolicy: "cache-and-network" });
  const [{ fetching }, give] = useMutation(GIVE_ACTIVITY_STICKERS);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const rows = q.data?.activityStickersOwed ?? [];
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const submit = async (): Promise<void> => {
    const res = await give({ issueIds: picked });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.actStickersDone.replace("{n}", bnNum(Number(res.data?.giveActivityStickers ?? 0))) });
    setPicked([]);
    reload();
  };
  return (
    <Screen scroll>
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {rows.length === 0 ? <Muted>{STR.actStickersEmpty}</Muted> : null}
        {rows.length > 0 ? (
          <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(3), flexWrap: "wrap" }}>
            <Button title={STR.actHandOutAll} variant="secondary" onPress={() => setPicked(rows.map((r) => r.issue.id))} />
            <Button title={STR.actStickersGive.replace("{n}", bnNum(picked.length))} loading={fetching} disabled={picked.length === 0} onPress={() => void submit()} />
          </View>
        ) : null}
        <Card>
          {rows.map((r) => {
            const on = picked.includes(r.issue.id);
            return (
              <Pressable
                key={r.issue.id}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== r.issue.id) : [...p, r.issue.id]))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}
              >
                <Text style={{ fontSize: 18 }}>{on ? "☑" : "☐"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{r.studentName}</Text>
                  <Muted style={{ fontSize: 12 }}>
                    {r.classLevel === null ? "" : classLevelLabel(r.classLevel)}
                    {r.sectionNameBn ? ` · ${r.sectionNameBn}` : ""} · {r.bankNameBn} · {activityResultLabel(r.issue.result ?? "")}
                  </Muted>
                </View>
              </Pressable>
            );
          })}
        </Card>
      </QueryGate>
    </Screen>
  );
}
