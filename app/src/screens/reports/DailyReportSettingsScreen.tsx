/**
 * DailyReportSettingsScreen (D-#1052) — when the daily report is saved and sent, which parts count
 * in the three headline numbers, and whether the Principal is notified. Gated
 * `reports:daily_settings` on the server (Principal by default).
 */
import React, { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { DAILY_REPORT_SECTIONS, type DailyReportSection } from "@scd/shared";
import { DAILY_REPORT_SETTINGS_QUERY, SAVE_DAILY_REPORT_SETTINGS_MUTATION } from "../../graphql/dailyReport";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, Body, Card, Notice, Loader, Button, Select } from "../../components/ui";
import { STR, bnNum, getActiveLang } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";
import { partLabel } from "./DailyReportScreen";

type Props = NativeStackScreenProps<ReportsStackParamList, "DailyReportSettings">;

/** 14:00 → 22:00 in half hours (the server accepts this window). */
const TIMES = Array.from({ length: 17 }, (_v, i) => 14 * 60 + i * 30);
const timeLabel = (m: number): string => {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const s = `${h}:${mm}`;
  return getActiveLang() === "en" ? s : bnNum(s);
};

export default function DailyReportSettingsScreen(_props: Props): React.ReactElement {
  const c = useColors();
  const [q] = useQuery({ query: DAILY_REPORT_SETTINGS_QUERY, requestPolicy: "network-only" });
  const [saveState, save] = useMutation(SAVE_DAILY_REPORT_SETTINGS_MUTATION);
  const [sendMinutes, setSendMinutes] = useState(18 * 60);
  const [headline, setHeadline] = useState<DailyReportSection[]>([...DAILY_REPORT_SECTIONS]);
  const [notifyPrincipal, setNotifyPrincipal] = useState(true);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  useEffect(() => {
    const s = q.data?.dailyReportSettings;
    if (!s) return;
    setSendMinutes(s.sendMinutes);
    setHeadline(s.headlineSections as DailyReportSection[]);
    setNotifyPrincipal(s.notifyPrincipal);
  }, [q.data]);

  if (q.fetching && !q.data) return <Loader label={STR.loading} />;

  const onSave = async () => {
    const res = await save({ sendMinutes, headlineSections: headline, notifyPrincipal });
    setMsg(res.error ? { tone: "danger", text: friendlyError(res.error) } : { tone: "ok", text: STR.drpSetSaved });
  };

  return (
    <Screen scroll>
      <Card>
        <View style={{ gap: space(3) }}>
          {q.error ? <Notice tone="danger" message={friendlyError(q.error)} /> : null}
          <Select
            label={STR.drpSetTime}
            value={String(sendMinutes)}
            options={TIMES.map((m) => ({ label: timeLabel(m), value: String(m) }))}
            onChange={(v) => setSendMinutes(Number(v))}
          />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
            <Body style={{ flex: 1 }}>{STR.drpSetNotifyPrincipal}</Body>
            <Switch value={notifyPrincipal} onValueChange={setNotifyPrincipal} accessibilityLabel={STR.drpSetNotifyPrincipal} />
          </View>
          <Body style={{ fontWeight: "700" }}>{STR.drpSetHeadline}</Body>
          <View>
            {DAILY_REPORT_SECTIONS.map((k) => {
              const on = headline.includes(k);
              return (
                <Pressable
                  key={k}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setHeadline((cur) => (on ? cur.filter((x) => x !== k) : [...cur, k]))}
                  style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(1) + 2 }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      borderWidth: 2,
                      borderColor: on ? c.primary : c.textDisabled,
                      backgroundColor: on ? c.primary : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {on ? <Text style={{ color: c.onPrimary, fontSize: 12, fontWeight: "700" }}>✓</Text> : null}
                  </View>
                  <Text style={{ color: c.textPrimary }}>{partLabel(k)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button title={STR.drpSetSave} onPress={onSave} loading={saveState.fetching} disabled={headline.length === 0} />
          {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        </View>
      </Card>
    </Screen>
  );
}
