/**
 * ActivityChooseScreen (AS-3, A1 + A2) — a guardian chooses an activity sheet for their child.
 *
 * Shows the published banks whose levels suit the child's class, by skill area, with two
 * sample pages a level. "এটি চাই" asks for the next sheet the child has never had; it is
 * printed with the child's name on the next school day and the class teacher hands it over.
 * The week's limit and the open-sheet limit are shown up top (D-#991).
 */
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ACTIVITY_SKILL_AREAS } from "@scd/shared";
import { ACTIVITY_CHOICES_QUERY, REQUEST_ACTIVITY_SHEET, type ActivityChoicesT } from "../../graphql/activitySheets";
import { Button, Card, Chip, ChipRow, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useGuardianChild } from "../../state/GuardianChildContext";
import { friendlyError } from "../../lib/errors";
import { STR, activityLevelLabel, activitySkillLabel, bnNum } from "../../lib/labels";
import type { ActivityStackParamList } from "../../navigation/types";
import { space, typeScale, useColors } from "../../theme";
import { ActivityImage } from "./ActivityImage";

type Props = NativeStackScreenProps<ActivityStackParamList, "ActivityChoose">;
type Msg = { tone: "ok" | "danger" | "info"; text: string } | null;
type Bank = ActivityChoicesT["banks"][number];

function BankCard({ bank, studentId, blocked, onAsked }: { bank: Bank; studentId: string; blocked: boolean; onAsked: (m: Msg) => void }): React.ReactElement {
  const colors = useColors();
  const [level, setLevel] = useState(bank.levels[0]?.level ?? "E");
  const [{ fetching }, request] = useMutation(REQUEST_ACTIVITY_SHEET);
  const lv = bank.levels.find((l) => l.level === level) ?? bank.levels[0];
  const ask = async (): Promise<void> => {
    const res = await request({ studentId, bankId: bank.bankId, level: lv.level });
    if (res.error) return onAsked({ tone: "danger", text: friendlyError(res.error) });
    const issue = res.data!.requestActivitySheet;
    onAsked({ tone: "ok", text: issue.repeat ? `${STR.actChooseAsked.replace("{item}", bank.nameBn)} · ${STR.actChooseRepeat}` : STR.actChooseAsked.replace("{item}", bank.nameBn) });
  };
  return (
    <Card style={{ marginBottom: space(3) }}>
      <Text style={{ ...typeScale.bodyStrong, color: colors.textPrimary }}>{bank.nameBn}</Text>
      <Muted style={{ fontSize: 12, marginBottom: space(2) }}>
        {bank.nameEn ? `${bank.nameEn} · ` : ""}
        {activitySkillLabel(bank.skillArea)}
      </Muted>
      {bank.levels.length > 1 ? (
        <ChipRow>
          {bank.levels.map((l) => (
            <Chip key={l.level} label={activityLevelLabel(l.level)} selected={level === l.level} onPress={() => setLevel(l.level)} />
          ))}
        </ChipRow>
      ) : null}
      {lv.sampleFileIds.length > 0 ? (
        <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(2) }}>
          {lv.sampleFileIds.map((f) => (
            <View key={f} style={{ flex: 1, maxWidth: 200 }}>
              <ActivityImage fileId={f} />
            </View>
          ))}
        </View>
      ) : null}
      <Muted style={{ marginBottom: space(2) }}>{STR.actChooseDone.replace("{d}", bnNum(lv.doneByChild)).replace("{n}", bnNum(lv.sheetCount))}</Muted>
      <Button title={STR.actChooseWant.replace("{level}", activityLevelLabel(lv.level))} loading={fetching} disabled={blocked} onPress={() => void ask()} />
    </Card>
  );
}

export default function ActivityChooseScreen({ navigation }: Props): React.ReactElement {
  const { selected: child } = useGuardianChild();
  const studentId = child?.studentId ?? null;
  const [q, refetch] = useQuery({ query: ACTIVITY_CHOICES_QUERY, variables: { studentId: studentId ?? "" }, pause: !studentId, requestPolicy: "cache-and-network" });
  const [skill, setSkill] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const v = q.data?.activityChoices;
  const blocked = !!v && (v.usedThisWeek >= v.weeklyLimit || v.open >= v.maxOpen);
  const banks = (v?.banks ?? []).filter((b) => !skill || b.skillArea === skill);
  const name = child ? child.nameBn || child.name : "";

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
        <Notice tone="info" message={STR.actChooseIntro.replace("{name}", name)} />
        <Button title={STR.actMySheets} variant="secondary" onPress={() => navigation.navigate("ActivityChildSheets")} style={{ marginBottom: space(3) }} />
        <QueryGate results={[q]} onRetry={() => refetch({ requestPolicy: "network-only" })} loaderLabel={STR.loading}>
          {v ? (
            <View>
              <Muted style={{ marginBottom: space(2) }}>
                {STR.actChooseLimits.replace("{u}", bnNum(v.usedThisWeek)).replace("{w}", bnNum(v.weeklyLimit)).replace("{o}", bnNum(v.open)).replace("{m}", bnNum(v.maxOpen))}
              </Muted>
              <ChipRow>
                <Chip label={STR.actFilterAll} selected={!skill} onPress={() => setSkill(null)} />
                {ACTIVITY_SKILL_AREAS.filter((s) => v.banks.some((b) => b.skillArea === s)).map((s) => (
                  <Chip key={s} label={activitySkillLabel(s)} selected={skill === s} onPress={() => setSkill(s)} />
                ))}
              </ChipRow>
              {banks.length === 0 ? <Muted>{STR.actChooseNone}</Muted> : null}
              {banks.map((b) => (
                <BankCard
                  key={b.bankId}
                  bank={b}
                  studentId={studentId!}
                  blocked={blocked}
                  onAsked={(m) => {
                    setMsg(m);
                    refetch({ requestPolicy: "network-only" });
                  }}
                />
              ))}
            </View>
          ) : null}
        </QueryGate>
      </ScrollView>
    </Screen>
  );
}
