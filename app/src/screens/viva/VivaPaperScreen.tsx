/**
 * VivaPaperScreen (D-#1071, mockup screen 3) — the Office writes one oral paper: each
 * question, its marks (halves allowed) and an optional book page (pictures are shown from
 * the book). The questions' sum is checked against the syllabus oral marks. Read-only once
 * a mark exists or the paper is locked.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { VIVA_SAVE_PAPER, VIVA_SHEET, vivaNum, type VivaItemT } from "../../graphql/viva";
import { Body, Button, Card, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaPaper">;
type Draft = { key: string | null; label: string; marks: string; ref: string };

const toDraft = (i: VivaItemT): Draft => ({ key: i.key, label: i.label, marks: String(i.marks), ref: i.ref });
/** "২.৫", "2.5", "২½" → 2.5; NaN when unreadable. */
function readMarks(t: string): number {
  const ascii = t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace("½", ".5").trim();
  return ascii === "" ? NaN : Number(ascii);
}

export default function VivaPaperScreen({ route, navigation }: Props): React.ReactElement {
  const { paperId } = route.params;
  const [q, reexec] = useQuery({ query: VIVA_SHEET, variables: { paperId } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const paper = q.data?.vivaSheet.paper;
  const [items, setItems] = React.useState<Draft[]>([]);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [st, save] = useMutation(VIVA_SAVE_PAPER);

  React.useEffect(() => {
    if (paper) setItems(paper.items.map(toDraft));
  }, [paper]);

  const ro = !paper || paper.frozen || !!paper.lockedAt;
  const sum = Math.round(items.reduce((a, x) => a + (Number.isFinite(readMarks(x.marks)) ? readMarks(x.marks) : 0), 0) * 2) / 2;
  const set = (i: number, patch: Partial<Draft>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const onSave = async () => {
    setMsg(null);
    const bad = items.findIndex((x) => !x.label.trim() || !Number.isFinite(readMarks(x.marks)));
    if (bad >= 0) return setMsg({ tone: "danger", text: `${STR.vivaQLabel.replace("{n}", bnNum(bad + 1))}: ${STR.vivaQMarks}?` });
    const res = await save({
      paperId,
      items: items.map((x) => ({ key: x.key, label: x.label.trim(), marks: readMarks(x.marks), ref: x.ref.trim() || null })),
    });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.vivaSaved });
    refetch();
    navigation.goBack();
  };

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch}>
        {paper ? (
          <View style={{ gap: space(3) }}>
            <Body style={{ fontWeight: "700" }}>
              {paper.classLabelBn} · {paper.subjectLabelBn}
            </Body>
            {ro ? <Notice tone="warn" message={paper.lockedAt ? STR.vivaLockedBadge : STR.vivaPaperFrozen} /> : <Muted>{STR.vivaPaperHelp}</Muted>}
            {items.map((x, i) => (
              <Card key={x.key ?? `new-${i}`}>
                <Field label={STR.vivaQLabel.replace("{n}", bnNum(i + 1))} value={x.label} editable={!ro} multiline onChangeText={(t) => set(i, { label: t })} />
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <View style={{ width: 96 }}>
                    <Field label={STR.vivaQMarks} value={x.marks} editable={!ro} keyboardType="decimal-pad" onChangeText={(t) => set(i, { marks: t })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.vivaQRef} value={x.ref} editable={!ro} onChangeText={(t) => set(i, { ref: t })} />
                  </View>
                </View>
                {ro ? null : (
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    {i > 0 ? (
                      <Button
                        title={STR.vivaMoveUp}
                        variant="ghost"
                        onPress={() => setItems((xs) => xs.map((y, j) => (j === i - 1 ? xs[i]! : j === i ? xs[i - 1]! : y)))}
                      />
                    ) : null}
                    {items.length > 1 ? <Button title={STR.vivaRemoveQ} variant="ghost" onPress={() => setItems((xs) => xs.filter((_, j) => j !== i))} /> : null}
                  </View>
                )}
              </Card>
            ))}
            {ro ? null : (
              <Button title={STR.vivaAddQ} variant="secondary" onPress={() => setItems((xs) => [...xs, { key: null, label: "", marks: "1", ref: "" }])} />
            )}
            <Muted>
              {paper.syllabusMarks != null
                ? STR.vivaSumLine.replace("{s}", vivaNum(sum)).replace("{y}", vivaNum(paper.syllabusMarks))
                : STR.vivaSumNoSyl.replace("{s}", vivaNum(sum))}
            </Muted>
            {paper.syllabusMarks != null && sum !== paper.syllabusMarks ? <Notice tone="warn" message={STR.vivaSumMismatch} /> : null}
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
            {ro ? null : <Button title={STR.vivaSave} loading={st.fetching} onPress={() => void onSave()} />}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
