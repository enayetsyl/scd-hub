/**
 * VivaExaminersScreen (D-#1073, mockup screen 4) — who hears which child. Each child sits
 * with exactly one examiner; the Office adds a teacher, splits the class evenly by roll,
 * or moves one child by tapping another examiner's name beside them. Marks already
 * entered stay with the child when they move.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { VIVA_CANDIDATES, VIVA_SAVE_EXAMINERS, VIVA_SHEET } from "../../graphql/viva";
import { Body, Button, Card, Chip, ChipRow, Muted, Notice, Screen, Select } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaExaminers">;

export default function VivaExaminersScreen({ route, navigation }: Props): React.ReactElement {
  const { paperId } = route.params;
  const [q, reexec] = useQuery({ query: VIVA_SHEET, variables: { paperId } });
  const [cq] = useQuery({ query: VIVA_CANDIDATES });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const sheet = q.data?.vivaSheet;
  const candidates = cq.data?.vivaExaminerCandidates ?? [];
  const nameOf = React.useMemo(() => new Map(candidates.map((c) => [c.userId, c.name])), [candidates]);
  // examiner order + child → examiner
  const [order, setOrder] = React.useState<string[]>([]);
  const [who, setWho] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [st, save] = useMutation(VIVA_SAVE_EXAMINERS);

  React.useEffect(() => {
    if (!sheet) return;
    setOrder(sheet.paper.examiners.map((e) => e.userId));
    const m: Record<string, string> = {};
    for (const r of sheet.rows) if (r.examinerId) m[r.studentId] = r.examinerId;
    setWho(m);
  }, [sheet]);

  const label = (id: string) => nameOf.get(id) ?? sheet?.paper.examiners.find((e) => e.userId === id)?.name ?? "";
  const ro = !!sheet?.paper.lockedAt;
  const rows = sheet?.rows ?? [];

  const add = (userId: string) => {
    if (order.includes(userId)) return;
    const next = [...order, userId];
    setOrder(next);
    // The first examiner takes every child who has none yet.
    if (!order.length) setWho(Object.fromEntries(rows.map((r) => [r.studentId, userId])));
  };
  const remove = (userId: string) => {
    const next = order.filter((x) => x !== userId);
    setOrder(next);
    setWho((w) => Object.fromEntries(Object.entries(w).map(([s, e]) => [s, e === userId ? next[0] ?? "" : e]).filter(([, e]) => e)));
  };
  const splitByRoll = () => {
    if (!order.length) return;
    const per = Math.ceil(rows.length / order.length);
    setWho(Object.fromEntries(rows.map((r, i) => [r.studentId, order[Math.min(order.length - 1, Math.floor(i / per))]!])));
  };
  const onSave = async () => {
    setMsg(null);
    const res = await save({
      paperId,
      examiners: order.map((userId) => ({ userId, studentIds: rows.filter((r) => who[r.studentId] === userId).map((r) => r.studentId) })),
    });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.vivaSaved });
    refetch();
    navigation.goBack();
  };

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch}>
        {sheet ? (
          <View style={{ gap: space(3) }}>
            <Body style={{ fontWeight: "700" }}>
              {sheet.paper.classLabelBn} · {sheet.paper.subjectLabelBn}
            </Body>
            <Muted>{STR.vivaExHelp}</Muted>
            {ro ? <Notice tone="warn" message={STR.vivaLockedBadge} /> : null}
            {order.map((id) => (
              <Card key={id}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
                  <Body style={{ flex: 1, fontWeight: "700" }}>{label(id)}</Body>
                  <Muted>{STR.vivaChildrenN.replace("{n}", bnNum(rows.filter((r) => who[r.studentId] === id).length))}</Muted>
                </View>
                {ro || order.length < 2 ? null : <Button title={STR.vivaRemoveExaminer} variant="ghost" onPress={() => remove(id)} />}
              </Card>
            ))}
            {ro ? null : (
              <Select
                label={STR.vivaAddExaminer}
                value={null}
                placeholder={STR.vivaPickTeacher}
                searchable
                options={candidates.filter((c) => !order.includes(c.userId)).map((c) => ({ label: c.name, value: c.userId }))}
                onChange={(v) => add(v)}
              />
            )}
            {!ro && order.length > 1 ? <Button title={STR.vivaSplitRoll} variant="secondary" onPress={splitByRoll} /> : null}
            {order.length > 1
              ? rows.map((r) => (
                  <Card key={r.studentId}>
                    <Body>
                      {r.roll ? `${bnNum(r.roll)}. ` : ""}
                      {r.name}
                    </Body>
                    <ChipRow>
                      {order.map((id) => (
                        <Chip key={id} label={label(id)} selected={who[r.studentId] === id} onPress={() => !ro && setWho((w) => ({ ...w, [r.studentId]: id }))} />
                      ))}
                    </ChipRow>
                  </Card>
                ))
              : null}
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
            {ro ? null : <Button title={STR.vivaSave} loading={st.fetching} onPress={() => void onSave()} />}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
