/**
 * VivaPaperScreen (D-#1081, mockup screen 3) — the Office writes one oral paper: each
 * question, its marks (halves allowed) and an optional book page (pictures are shown from
 * the book). The questions' sum is checked against the syllabus oral marks. Read-only once
 * a mark exists, a set is drawn, or the paper is locked.
 *
 * Question sets (D-#1275): "+ সেট" copies the open set into a new tab; every set must add up
 * to the same total. Each child is given one set when the examiner taps their name (D-#1276).
 * Letter questions (D-#1277): the letters (comma separated) and the marks per letter; the
 * question's marks are letters × per-letter, and the examiner marks each letter.
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { VIVA_SAVE_PAPER, VIVA_SHEET, vivaNum, type VivaItemT, type VivaPaperT } from "../../graphql/viva";
import { Body, Button, Card, Chip, ChipRow, Field, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import type { VivaStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<VivaStackParamList, "VivaPaper">;
type Draft = { key: string | null; label: string; marks: string; ref: string; letters: boolean; parts: string; partMarks: string };
type DraftSet = { key: string | null; label: string; items: Draft[] };

const toDraft = (i: VivaItemT): Draft => ({
  key: i.key,
  label: i.label,
  marks: String(i.marks),
  ref: i.ref,
  letters: i.parts.length > 0,
  parts: i.parts.join(", "),
  partMarks: i.parts.length ? String(i.partMarks) : "0.5",
});
const toDraftSets = (p: VivaPaperT): DraftSet[] =>
  (p.sets.length ? p.sets : [{ key: "s1", label: "", items: p.items, drawn: 0 }]).map((s) => ({ key: s.key, label: s.label, items: s.items.map(toDraft) }));

/** "২.৫", "2.5", "২½" → 2.5; NaN when unreadable. */
function readMarks(t: string): number {
  const ascii = t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace("½", ".5").trim();
  return ascii === "" ? NaN : Number(ascii);
}
/** "ট, ষ, ঈ, ব" → ["ট","ষ","ঈ","ব"] (commas or spaces). */
const readParts = (t: string): string[] => t.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
/** A draft question's marks: letters × per-letter, or the typed marks. */
function draftMarks(x: Draft): number {
  if (x.letters) return readParts(x.parts).length * readMarks(x.partMarks);
  return readMarks(x.marks);
}
const setSum = (s: DraftSet): number =>
  Math.round(s.items.reduce((a, x) => a + (Number.isFinite(draftMarks(x)) ? draftMarks(x) : 0), 0) * 2) / 2;
const setName = (s: DraftSet, i: number, many: boolean): string => (many ? s.label.trim() || STR.vivaSetN.replace("{n}", bnNum(i + 1)) : "");

export default function VivaPaperScreen({ route, navigation }: Props): React.ReactElement {
  const { paperId } = route.params;
  const [q, reexec] = useQuery({ query: VIVA_SHEET, variables: { paperId } });
  const refetch = React.useCallback(() => reexec({ requestPolicy: "network-only" }), [reexec]);
  const paper = q.data?.vivaSheet.paper;
  const [sets, setSets] = React.useState<DraftSet[]>([]);
  const [cur, setCur] = React.useState(0);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [st, save] = useMutation(VIVA_SAVE_PAPER);

  React.useEffect(() => {
    if (paper) {
      setSets(toDraftSets(paper));
      setCur(0);
    }
  }, [paper]);

  const ro = !paper || paper.frozen || !!paper.lockedAt;
  const many = sets.length > 1;
  const open = sets[Math.min(cur, sets.length - 1)];
  const items = open?.items ?? [];
  const sum = open ? setSum(open) : 0;
  const sums = sets.map(setSum);
  const unequal = many && sums.some((s) => s !== sums[0]);

  const setItems = (fn: (xs: Draft[]) => Draft[]) => setSets((ss) => ss.map((s, j) => (j === cur ? { ...s, items: fn(s.items) } : s)));
  const set = (i: number, patch: Partial<Draft>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const addSet = () => {
    if (!open) return;
    // A new set starts as a copy of the open one (new keys), so Office only edits what differs.
    const copy: DraftSet = { key: null, label: "", items: open.items.map((x) => ({ ...x, key: null })) };
    setSets((ss) => [...ss, copy]);
    setCur(sets.length);
  };
  const removeSet = () => {
    setSets((ss) => ss.filter((_, j) => j !== cur));
    setCur(0);
  };

  const onSave = async () => {
    setMsg(null);
    for (const [si, s] of sets.entries()) {
      const bad = s.items.findIndex((x) => !x.label.trim() || !Number.isFinite(draftMarks(x)) || (x.letters && !readParts(x.parts).length));
      if (bad >= 0) {
        setCur(si);
        return setMsg({ tone: "danger", text: `${setName(s, si, many) ? `${setName(s, si, many)} · ` : ""}${STR.vivaQLabel.replace("{n}", bnNum(bad + 1))}: ${STR.vivaQMarks}?` });
      }
    }
    if (unequal) return setMsg({ tone: "danger", text: STR.vivaSetsUnequal });
    const res = await save({
      paperId,
      sets: sets.map((s, si) => ({
        key: s.key,
        label: setName(s, si, many) || null,
        items: s.items.map((x) =>
          x.letters
            ? { key: x.key, label: x.label.trim(), marks: draftMarks(x), ref: x.ref.trim() || null, parts: readParts(x.parts), partMarks: readMarks(x.partMarks) }
            : { key: x.key, label: x.label.trim(), marks: readMarks(x.marks), ref: x.ref.trim() || null },
        ),
      })),
    });
    if (res.error) return setMsg({ tone: "danger", text: friendlyError(res.error) });
    setMsg({ tone: "ok", text: STR.vivaSaved });
    refetch();
    navigation.goBack();
  };

  return (
    <Screen scroll>
      <QueryGate result={q} onRetry={refetch}>
        {paper && open ? (
          <View style={{ gap: space(3) }}>
            <Body style={{ fontWeight: "700" }}>
              {paper.classLabelBn} · {paper.subjectLabelBn}
            </Body>
            {ro ? <Notice tone="warn" message={paper.lockedAt ? STR.vivaLockedBadge : STR.vivaPaperFrozen} /> : <Muted>{STR.vivaPaperHelp}</Muted>}
            {many || !ro ? (
              <ChipRow>
                {sets.map((s, i) => (
                  <Chip
                    key={s.key ?? `new-${i}`}
                    label={`${setName(s, i, true)} · ${vivaNum(sums[i]!)}`}
                    selected={i === cur}
                    onPress={() => setCur(i)}
                  />
                ))}
                {ro ? null : <Chip label={STR.vivaAddSet} selected={false} onPress={addSet} />}
              </ChipRow>
            ) : null}
            {many ? <Muted>{STR.vivaSetsHelp}</Muted> : null}
            {many ? (
              <Field
                label={STR.vivaSetName}
                value={open.label}
                placeholder={STR.vivaSetN.replace("{n}", bnNum(cur + 1))}
                editable={!ro}
                onChangeText={(t) => setSets((ss) => ss.map((s, j) => (j === cur ? { ...s, label: t } : s)))}
              />
            ) : null}
            {items.map((x, i) => (
              <Card key={x.key ?? `new-${cur}-${i}`}>
                <Field label={STR.vivaQLabel.replace("{n}", bnNum(i + 1))} value={x.label} editable={!ro} multiline onChangeText={(t) => set(i, { label: t })} />
                {x.letters ? (
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <View style={{ flex: 1 }}>
                      <Field label={STR.vivaQLetters} value={x.parts} editable={!ro} onChangeText={(t) => set(i, { parts: t })} />
                    </View>
                    <View style={{ width: 110 }}>
                      <Field label={STR.vivaQPerLetter} value={x.partMarks} editable={!ro} keyboardType="decimal-pad" onChangeText={(t) => set(i, { partMarks: t })} />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", gap: space(2) }}>
                    <View style={{ width: 96 }}>
                      <Field label={STR.vivaQMarks} value={x.marks} editable={!ro} keyboardType="decimal-pad" onChangeText={(t) => set(i, { marks: t })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label={STR.vivaQRef} value={x.ref} editable={!ro} onChangeText={(t) => set(i, { ref: t })} />
                    </View>
                  </View>
                )}
                {x.letters ? (
                  <Muted>
                    {STR.vivaQLetterSum
                      .replace("{n}", bnNum(readParts(x.parts).length))
                      .replace("{m}", Number.isFinite(draftMarks(x)) ? vivaNum(draftMarks(x)) : "?")}
                  </Muted>
                ) : null}
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
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Button
                  title={STR.vivaAddQ}
                  variant="secondary"
                  onPress={() => setItems((xs) => [...xs, { key: null, label: "", marks: "1", ref: "", letters: false, parts: "", partMarks: "0.5" }])}
                />
                <Button
                  title={STR.vivaAddLetterQ}
                  variant="secondary"
                  onPress={() => setItems((xs) => [...xs, { key: null, label: "", marks: "0", ref: "", letters: true, parts: "", partMarks: "0.5" }])}
                />
              </View>
            )}
            <Muted>
              {(many ? `${setName(open, cur, true)}: ` : "") +
                (paper.syllabusMarks != null
                  ? STR.vivaSumLine.replace("{s}", vivaNum(sum)).replace("{y}", vivaNum(paper.syllabusMarks))
                  : STR.vivaSumNoSyl.replace("{s}", vivaNum(sum)))}
            </Muted>
            {paper.syllabusMarks != null && sum !== paper.syllabusMarks ? <Notice tone="warn" message={STR.vivaSumMismatch} /> : null}
            {unequal ? <Notice tone="warn" message={STR.vivaSetsUnequal} /> : null}
            {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
            {ro ? null : (
              <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                <Button title={STR.vivaSave} loading={st.fetching} onPress={() => void onSave()} />
                {many ? <Button title={STR.vivaRemoveSet} variant="ghost" onPress={removeSet} /> : null}
              </View>
            )}
          </View>
        ) : null}
      </QueryGate>
    </Screen>
  );
}
