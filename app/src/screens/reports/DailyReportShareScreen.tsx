/**
 * DailyReportShareScreen (D-#1034) — give one person the whole daily report or some parts, with
 * the 18:00 notification on or off and an optional end date; list who has what; remove.
 * Parts usually kept for the Principal (mistakes, guardians, finance, system) ask a second press
 * (owner 2026-11-06: shareable with a warning). Gated `reports:daily_share` on the server.
 */
import React, { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { DAILY_REPORT_SECTIONS, DAILY_REPORT_SENSITIVE_SECTIONS, type DailyReportSection } from "@scd/shared";
import {
  DAILY_REPORT_SHARES_QUERY,
  REMOVE_DAILY_REPORT_SHARE_MUTATION,
  SHARE_DAILY_REPORT_MUTATION,
  type DailyReportShareT,
} from "../../graphql/dailyReport";
import type { ReportsStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Badge, Notice, Loader, Button, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR, roleViewLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";
import { dateKey } from "../../lib/dates";
import { partLabel } from "./DailyReportScreen";

type Props = NativeStackScreenProps<ReportsStackParamList, "DailyReportShare">;

const fill = (s: string, vars: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");

function Check({ on, label, note, onPress }: { on: boolean; label: string; note?: string; onPress: () => void }): React.ReactElement {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
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
      <Text style={{ color: c.textPrimary, flex: 1 }}>{label}</Text>
      {note ? <Text style={{ color: c.gold, fontSize: 12 }}>{note}</Text> : null}
    </Pressable>
  );
}

export default function DailyReportShareScreen(_props: Props): React.ReactElement {
  const [q, refetch] = useQuery({ query: DAILY_REPORT_SHARES_QUERY, requestPolicy: "cache-and-network" });
  const [saveState, save] = useMutation(SHARE_DAILY_REPORT_MUTATION);
  const [, remove] = useMutation(REMOVE_DAILY_REPORT_SHARE_MUTATION);
  const [userId, setUserId] = useState<string | null>(null);
  const [sections, setSections] = useState<DailyReportSection[]>([]);
  const [notify, setNotify] = useState(true);
  const [untilKey, setUntilKey] = useState("");
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const shares = q.data?.dailyReportShares ?? [];
  const candidates = q.data?.dailyReportShareCandidates ?? [];

  const load = (s: DailyReportShareT | null, id: string) => {
    setUserId(id);
    setSections((s?.sections ?? []) as DailyReportSection[]);
    setNotify(s?.notify ?? true);
    setUntilKey(s?.untilKey ?? "");
    setConfirmSensitive(false);
    setMsg(null);
  };

  const toggle = (k: DailyReportSection) => {
    setConfirmSensitive(false);
    setSections((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };
  const all = sections.length === DAILY_REPORT_SECTIONS.length;
  const sensitivePicked = sections.filter((s) => DAILY_REPORT_SENSITIVE_SECTIONS.includes(s));

  const onSave = async () => {
    if (!userId) return;
    if (sensitivePicked.length > 0 && !confirmSensitive) {
      setConfirmSensitive(true);
      return;
    }
    const res = await save({ userId, sections, notify, untilKey: untilKey || null });
    if (res.error) {
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    setMsg({ tone: "ok", text: STR.drpShareSaved });
    setConfirmSensitive(false);
    refetch({ requestPolicy: "network-only" });
  };

  const onRemove = async (id: string) => {
    const res = await remove({ userId: id });
    if (res.error) {
      setMsg({ tone: "danger", text: friendlyError(res.error) });
      return;
    }
    if (id === userId) load(null, "");
    setUserId(id === userId ? null : userId);
    setMsg({ tone: "ok", text: STR.drpShareRemoved });
    refetch({ requestPolicy: "network-only" });
  };

  if (q.fetching && !q.data) return <Loader label={STR.loading} />;

  return (
    <Screen scroll>
      <View style={{ gap: space(3) }}>
        {q.error ? <Notice tone="danger" message={friendlyError(q.error)} /> : null}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.drpShareTitle}</Body>
          <Select
            label={STR.drpSharePerson}
            value={userId}
            placeholder={STR.drpSharePick}
            searchable
            options={candidates.map((u) => ({ label: u.name, value: u.id, hint: roleViewLabel(u.role) }))}
            onChange={(id) => load(shares.find((s) => s.userId === id) ?? null, id)}
          />
          {userId ? (
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <View>
                <Check on={all} label={STR.drpShareAll} onPress={() => setSections(all ? [] : [...DAILY_REPORT_SECTIONS])} />
                {DAILY_REPORT_SECTIONS.map((k) => (
                  <Check
                    key={k}
                    on={sections.includes(k)}
                    label={partLabel(k)}
                    note={DAILY_REPORT_SENSITIVE_SECTIONS.includes(k) ? STR.drpShareSensitive : undefined}
                    onPress={() => toggle(k)}
                  />
                ))}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
                <Body style={{ flex: 1 }}>{STR.drpShareNotify}</Body>
                <Switch value={notify} onValueChange={setNotify} accessibilityLabel={STR.drpShareNotify} />
              </View>
              <DateField label={STR.drpShareUntil} value={untilKey} onChange={setUntilKey} min={dateKey()} helper={untilKey ? undefined : STR.drpShareUntilNone} />
              {untilKey ? <Button title={STR.drpShareClearUntil} variant="ghost" onPress={() => setUntilKey("")} /> : null}
              <Muted>{STR.drpShareOwnNote}</Muted>
              {confirmSensitive ? (
                <Notice tone="warn" message={fill(STR.drpShareWarn, { parts: sensitivePicked.map(partLabel).join(", ") })} />
              ) : null}
              <Button
                title={confirmSensitive ? STR.drpShareConfirm : STR.drpShareSave}
                onPress={onSave}
                loading={saveState.fetching}
                disabled={sections.length === 0}
              />
              <Muted>{STR.drpShareRefreshNote}</Muted>
            </View>
          ) : null}
          {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        </Card>

        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.drpShareGiven}</Body>
          {shares.length === 0 ? <Muted>{STR.drpShareNone}</Muted> : null}
          {shares.map((s) => (
            <View key={s.userId} style={{ paddingVertical: space(2), gap: space(1) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), flexWrap: "wrap" }}>
                <Body style={{ fontWeight: "700", flexShrink: 1 }}>{s.name}</Body>
                {s.expired ? <Badge text={STR.drpShareExpired} tone="muted" /> : null}
                {s.untilKey && !s.expired ? <Badge text={fill(STR.drpShareUntilLabel, { d: s.untilKey })} tone="info" /> : null}
              </View>
              <Muted>
                {`${s.sections.map(partLabel).join(", ")} · ${s.notify ? STR.drpShareNotifyOn : STR.drpShareNotifyOff}`}
              </Muted>
              <View style={{ flexDirection: "row", gap: space(2) }}>
                <Button title={STR.drpShareEdit} variant="ghost" onPress={() => load(s, s.userId)} />
                <Button title={STR.drpShareRemove} variant="ghost" onPress={() => onRemove(s.userId)} />
              </View>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}
