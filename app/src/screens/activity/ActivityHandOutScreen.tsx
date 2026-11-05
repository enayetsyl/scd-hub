/**
 * ActivityHandOutScreen (AS-3, A6) — printed sheets waiting to reach the children.
 *
 * A class teacher sees their own sections (activity_sheets:check); the office sees every
 * section (activity_sheets:issue). Tick the children who got their sheet → "দেওয়া হলো".
 * Untapped sheets still close when they come back (the return records the hand-out).
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACTIVITY_HANDOUT, ACTIVITY_HANDOUT_ROSTER } from "../../graphql/activitySheets";
import { Button, Card, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum, classLevelLabel } from "../../lib/labels";
import { space, typeScale, useColors } from "../../theme";

export default function ActivityHandOutScreen(): React.ReactElement {
  const colors = useColors();
  const [q, refetch] = useQuery({ query: ACTIVITY_HANDOUT_ROSTER, requestPolicy: "cache-and-network" });
  const [{ fetching }, handOut] = useMutation(ACTIVITY_HANDOUT);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const rows = q.data?.activityHandOutRoster ?? [];
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const give = async (): Promise<void> => {
    const res = await handOut({ issueIds: picked });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.actHandOutDone.replace("{n}", bnNum(Number(res.data?.activityHandOut ?? 0))) });
    setPicked([]);
    reload();
  };
  let lastGroup = "";
  return (
    <Screen>
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {rows.length === 0 ? <Muted>{STR.actHandOutEmpty}</Muted> : null}
        {rows.length > 0 ? (
          <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(3), flexWrap: "wrap" }}>
            <Button title={STR.actHandOutAll} variant="secondary" onPress={() => setPicked(rows.map((r) => r.issue.id))} />
            <Button title={STR.actHandOutGive.replace("{n}", bnNum(picked.length))} loading={fetching} disabled={picked.length === 0} onPress={() => void give()} />
          </View>
        ) : null}
        <Card>
          {rows.map((r) => {
            const group = `${r.classLevel === null ? "" : classLevelLabel(r.classLevel)}${r.sectionNameBn ? ` · ${r.sectionNameBn}` : ""}`;
            const head = group !== lastGroup;
            lastGroup = group;
            const on = picked.includes(r.issue.id);
            return (
              <View key={r.issue.id}>
                {head ? <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary, marginTop: space(2) }}>{group}</Text> : null}
                <Pressable
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== r.issue.id) : [...p, r.issue.id]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}
                >
                  <Text style={{ fontSize: 18 }}>{on ? "☑" : "☐"}</Text>
                  <Text style={{ ...typeScale.body, color: colors.textPrimary, flex: 1 }}>
                    {r.studentName} — {r.bankNameBn} · {r.itemId}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </Card>
      </QueryGate>
    </Screen>
  );
}
