/**
 * ActivityCornerScreen (AS-2, A9) — the activity corner's trays on the office PC.
 *
 * Each published bank shows its three trays (সহজ / মাঝারি / কঠিন): how many pre-printed copies
 * wait, how many are out, LOW when below the rule. Office prints a restock run — every low
 * tray at once, or the trays tapped — and the PDF (each page with its copy QR) opens to print.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import { ACTIVITY_TRAYS_QUERY, PRINT_ACTIVITY_STOCK } from "../../graphql/activitySheets";
import { Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { PDF_SUPPORTED, openPdf } from "../../lib/pdf";
import { STR, activityLevelLabel, activitySkillLabel, bnNum } from "../../lib/labels";
import { radius, space, typeScale, useColors } from "../../theme";

type Msg = { tone: "ok" | "danger" | "info"; text: string } | null;

export default function ActivityCornerScreen(): React.ReactElement {
  const colors = useColors();
  const { can } = useAuth();
  const manage = can("activity_sheets:manage");
  const [q, refetch] = useQuery({ query: ACTIVITY_TRAYS_QUERY, requestPolicy: "cache-and-network" });
  const [{ fetching }, print] = useMutation(PRINT_ACTIVITY_STOCK);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheets, setSheets] = useState("");
  const [copies, setCopies] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const data = q.data?.activityTrays;
  const reload = (): void => refetch({ requestPolicy: "network-only" });

  const open = (runId: string): void => {
    if (!PDF_SUPPORTED) return;
    void openPdf(`/files/activity-print?runId=${encodeURIComponent(runId)}`).catch((e) => setMsg({ tone: "danger", text: String((e as Error).message ?? e) }));
  };

  const run = async (picks: string[]): Promise<void> => {
    const res = await print({ picks, sheets: sheets ? Number(sheets) : null, copies: copies ? Number(copies) : null });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    const r = res.data!.printActivityStock;
    setMsg({ tone: "ok", text: STR.actPrintMade.replace("{s}", bnNum(r.sheets)).replace("{c}", bnNum(r.copies)) });
    setLastRun(r.runId);
    setPicked([]);
    reload();
    open(r.runId);
  };

  const toggle = (key: string): void => setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));

  return (
    <Screen scroll>
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      {data?.busyMode ? <Notice tone="info" message={STR.actBusyOn} /> : null}
      {manage ? (
        <Card style={{ marginBottom: space(3) }}>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field label={STR.actPrintSheets} value={sheets} onChangeText={(t) => setSheets(t.replace(/\D/g, ""))} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={STR.actPrintCopies} value={copies} onChangeText={(t) => setCopies(t.replace(/\D/g, ""))} keyboardType="number-pad" />
            </View>
          </View>
          <Button title={STR.actPrintLow} loading={fetching} onPress={() => void run([])} />
          {picked.length > 0 ? (
            <Button title={STR.actPrintPicked.replace("{n}", bnNum(picked.length))} variant="secondary" loading={fetching} onPress={() => void run(picked)} style={{ marginTop: space(2) }} />
          ) : null}
          {lastRun && PDF_SUPPORTED ? <Button title={STR.actPrintOpen} variant="ghost" onPress={() => open(lastRun)} style={{ marginTop: space(2) }} /> : null}
        </Card>
      ) : null}
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {(data?.trays ?? []).map((t) => (
          <Card key={t.bankId} style={{ marginBottom: space(3) }}>
            <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>
              {t.nameBn} <Text style={{ color: colors.textSecondary }}>· {t.code} · {activitySkillLabel(t.skillArea)}</Text>
            </Text>
            <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
              {t.levels.map((l) => {
                const key = `${t.bankId}:${l.level}`;
                const on = picked.includes(key);
                const none = l.printable === 0;
                return (
                  <Pressable
                    key={l.level}
                    disabled={!manage || none}
                    onPress={() => toggle(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      flex: 1,
                      padding: space(2),
                      borderRadius: radius.sm,
                      borderWidth: on ? 2 : 1,
                      borderColor: on ? colors.primary : l.low ? colors.warning : colors.border,
                      backgroundColor: l.low ? colors.warningContainer : undefined,
                      opacity: none ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{activityLevelLabel(l.level)}</Text>
                    <Muted style={{ fontSize: 12 }}>{none ? STR.actTrayNone : STR.actTrayLine.replace("{n}", bnNum(l.inTray)).replace("{o}", bnNum(l.out))}</Muted>
                    {l.low ? <Text style={{ fontSize: 12, color: colors.warning, fontWeight: "700" }}>{STR.actTrayLow}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ))}
      </QueryGate>
    </Screen>
  );
}
