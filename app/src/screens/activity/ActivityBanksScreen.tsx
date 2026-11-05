/**
 * ActivityBanksScreen (AS-1, A12) — every activity bank, by skill area.
 *
 *  - Staff (activity_sheets:view): browse banks → open one (levels, classes, samples, sheets).
 *  - Office (activity_sheets:manage): add a bank from its files (index CSV + sheets PDF +
 *    answers PDF — the school's existing format; a combined CSV needs the bank code).
 *  - Office (activity_sheets:settings): the rules (D-#991 defaults until saved).
 */
import React, { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ACTIVITY_SKILL_AREAS } from "@scd/shared";
import {
  ACTIVITY_BANKS_QUERY,
  ACTIVITY_RULES_QUERY,
  SAVE_ACTIVITY_RULES,
  type ActivityBankT,
  type ActivityRulesT,
} from "../../graphql/activitySheets";
import { Badge, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { pickActivityFile, uploadActivityForm, type PickedAsset } from "../../lib/files";
import { STR, activitySkillLabel, bnNum } from "../../lib/labels";
import type { ActivityStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";

type Props = NativeStackScreenProps<ActivityStackParamList, "ActivityBanks">;
type Msg = { tone: "ok" | "danger"; text: string } | null;

export function bankStatusBadge(status: string): React.ReactElement {
  if (status === "PUBLISHED") return <Badge text={STR.actPublished} tone="ok" />;
  if (status === "RETIRED") return <Badge text={STR.actBankRetired} tone="muted" />;
  return <Badge text={STR.actDraft} tone="warn" />;
}

export const sheetTotal = (b: ActivityBankT): number => b.levels.reduce((n, l) => n + l.sheetCount, 0);

function FilePick({ label, asset, kind, onPick }: { label: string; asset: PickedAsset | null; kind: "csv" | "pdf"; onPick: (a: PickedAsset | null) => void }): React.ReactElement {
  return (
    <View style={{ marginBottom: space(2) }}>
      <Button title={label} variant="secondary" onPress={() => void pickActivityFile(kind).then((a) => a && onPick(a))} />
      {asset ? <Muted style={{ fontSize: 12, marginTop: space(1) }}>{STR.actPicked.replace("{name}", asset.name)}</Muted> : null}
    </View>
  );
}

function AddBank({ onDone }: { onDone: (m: Msg) => void }): React.ReactElement {
  const [csv, setCsv] = useState<PickedAsset | null>(null);
  const [sheets, setSheets] = useState<PickedAsset | null>(null);
  const [answers, setAnswers] = useState<PickedAsset | null>(null);
  const [nameBn, setNameBn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [code, setCode] = useState("");
  const [bankNo, setBankNo] = useState("");
  const [skill, setSkill] = useState<string>("THINKING");
  const [busy, setBusy] = useState(false);

  const send = async (): Promise<void> => {
    if (!csv) return onDone({ tone: "danger", text: STR.actNeedCsv });
    setBusy(true);
    try {
      const r = await uploadActivityForm<{ code: string; sheets: number; answersFound: number; warnings: string[] }>(
        "activity-bank",
        { nameBn, nameEn, code: code.trim().toUpperCase(), bankNo, skillArea: skill },
        { csv, sheets, answers },
      );
      const head = STR.actImported.replace("{code}", r.code).replace("{n}", bnNum(r.sheets)).replace("{a}", bnNum(r.answersFound));
      onDone({ tone: "ok", text: [head, ...(r.warnings ?? [])].join(" · ") });
      setCsv(null);
      setSheets(null);
      setAnswers(null);
      setNameBn("");
      setNameEn("");
      setCode("");
      setBankNo("");
    } catch (e) {
      onDone({ tone: "danger", text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: space(3) }}>
      <FilePick label={STR.actPickCsv} asset={csv} kind="csv" onPick={setCsv} />
      <FilePick label={`${STR.actPickSheets} ${STR.actOptional}`} asset={sheets} kind="pdf" onPick={setSheets} />
      <FilePick label={`${STR.actPickAnswers} ${STR.actOptional}`} asset={answers} kind="pdf" onPick={setAnswers} />
      <Field label={STR.actNameBn} value={nameBn} onChangeText={setNameBn} autoCapitalize="sentences" />
      <Field label={STR.actNameEn} value={nameEn} onChangeText={setNameEn} autoCapitalize="words" />
      <Field label={STR.actCode} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
      <Field label={STR.actBankNo} value={bankNo} onChangeText={setBankNo} keyboardType="number-pad" />
      <Muted>{STR.actSkill}</Muted>
      <ChipRow>
        {ACTIVITY_SKILL_AREAS.map((s) => (
          <Chip key={s} label={activitySkillLabel(s)} selected={skill === s} onPress={() => setSkill(s)} />
        ))}
      </ChipRow>
      {busy ? <Muted style={{ marginBottom: space(2) }}>{STR.actUploading}</Muted> : null}
      <Button title={STR.actUpload} loading={busy} onPress={() => void send()} />
    </Card>
  );
}

const RULE_FIELDS: Array<[keyof Omit<ActivityRulesT, "busyMode" | "isDefault">, keyof typeof STR]> = [
  ["weeklyRequests", "actRuleWeekly"],
  ["maxOpen", "actRuleMaxOpen"],
  ["monthlyTarget", "actRuleTarget"],
  ["levelUpAfter", "actRuleLevelUp"],
  ["notReturnedDays", "actRuleNotReturned"],
  ["restockSheets", "actRuleRestock"],
  ["restockCopies", "actRuleCopies"],
  ["lowTray", "actRuleLow"],
];

function Rules({ rules, onDone }: { rules: ActivityRulesT; onDone: (m: Msg) => void }): React.ReactElement {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(RULE_FIELDS.map(([k]) => [k, String(rules[k])])));
  const [busyMode, setBusyMode] = useState(rules.busyMode);
  const [{ fetching }, save] = useMutation(SAVE_ACTIVITY_RULES);
  const submit = async (): Promise<void> => {
    const vars: Record<string, number | boolean> = { busyMode };
    for (const [k] of RULE_FIELDS) vars[k] = Number(vals[k]);
    const r = await save(vars);
    onDone(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.actSaved });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      {rules.isDefault ? <Muted style={{ marginBottom: space(2) }}>{STR.actRulesDefault}</Muted> : null}
      {RULE_FIELDS.map(([k, label]) => (
        <Field key={k} label={STR[label]} value={vals[k]} onChangeText={(t) => setVals((v) => ({ ...v, [k]: t.replace(/\D/g, "") }))} keyboardType="number-pad" />
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), marginBottom: space(3) }}>
        <Switch value={busyMode} onValueChange={setBusyMode} />
        <Muted style={{ flex: 1 }}>{STR.actRuleBusy}</Muted>
      </View>
      <Button title={STR.actSave} loading={fetching} onPress={() => void submit()} />
    </Card>
  );
}

export default function ActivityBanksScreen({ navigation }: Props): React.ReactElement {
  const colors = useColors();
  const { can } = useAuth();
  const manage = can("activity_sheets:manage");
  const settings = can("activity_sheets:settings");
  const corner = can("activity_sheets:issue") || manage;
  const desk = can("activity_sheets:issue") || can("activity_sheets:check");
  const [q, refetch] = useQuery({ query: ACTIVITY_BANKS_QUERY });
  const [rulesQ, refetchRules] = useQuery({ query: ACTIVITY_RULES_QUERY, pause: !settings });
  const [panel, setPanel] = useState<"none" | "add" | "rules">("none");
  const [skill, setSkill] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const reload = (): void => refetch({ requestPolicy: "network-only" });
  const banks = (q.data?.activityBanks ?? []).filter((b) => !skill || b.skillArea === skill);

  return (
    <Screen>
      {msg ? <Notice message={msg.text} tone={msg.tone} /> : null}
      {corner || desk ? (
        <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(3), flexWrap: "wrap" }}>
          {desk ? <Button title={STR.actDesk} onPress={() => navigation.navigate("ActivityDesk")} /> : null}
          {corner ? <Button title={STR.actCorner} variant="secondary" onPress={() => navigation.navigate("ActivityCorner")} /> : null}
        </View>
      ) : null}
      {manage || settings ? (
        <ChipRow>
          {manage ? <Chip label={STR.actAddBank} selected={panel === "add"} onPress={() => setPanel(panel === "add" ? "none" : "add")} /> : null}
          {settings ? <Chip label={STR.actRules} selected={panel === "rules"} onPress={() => setPanel(panel === "rules" ? "none" : "rules")} /> : null}
        </ChipRow>
      ) : null}
      {panel === "add" ? (
        <AddBank
          onDone={(m) => {
            setMsg(m);
            if (m?.tone === "ok") reload();
          }}
        />
      ) : null}
      {panel === "rules" && rulesQ.data?.activityRules ? (
        <Rules
          rules={rulesQ.data.activityRules}
          onDone={(m) => {
            setMsg(m);
            refetchRules({ requestPolicy: "network-only" });
          }}
        />
      ) : null}
      <ChipRow>
        <Chip label={STR.actFilterAll} selected={!skill} onPress={() => setSkill(null)} />
        {ACTIVITY_SKILL_AREAS.map((s) => (
          <Chip key={s} label={activitySkillLabel(s)} selected={skill === s} onPress={() => setSkill(s)} />
        ))}
      </ChipRow>
      <QueryGate results={[q]} onRetry={reload} loaderLabel={STR.loading}>
        {banks.length === 0 ? <Muted>{STR.actEmpty}</Muted> : null}
        {banks.map((b) => (
          <Pressable
            key={b.id}
            onPress={() => navigation.navigate("ActivityBank", { bankId: b.id, title: b.nameBn })}
            accessibilityRole="button"
            style={{ paddingVertical: space(2), borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: space(2) }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{b.nameBn}</Text>
              <Muted style={{ fontSize: 12 }}>
                {b.code}
                {b.nameEn ? ` · ${b.nameEn}` : ""} · {activitySkillLabel(b.skillArea)} · {STR.actSheetsCount.replace("{n}", bnNum(sheetTotal(b)))}
              </Muted>
            </View>
            {b.withoutPages > 0 ? <Badge text={STR.actNoPage} tone="danger" /> : null}
            {bankStatusBadge(b.status)}
          </Pressable>
        ))}
      </QueryGate>
    </Screen>
  );
}
