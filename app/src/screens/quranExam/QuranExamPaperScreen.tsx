/**
 * QuranExamPaperScreen (D-#874, mockup screen 11) — the Office keeps one level's paper:
 * ITEMS papers as sections → questions → marks (the questions must add up to the full
 * marks), Hifz papers as paras + the তানবীহ/ফাত্হ rule. The teacher's mark screen is
 * built from exactly this. Read-only once any mark exists (the server refuses too).
 */
import React from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QX_EXAMS, QX_SAVE_PAPER, type QxPaperT } from "../../graphql/quranExam";
import { Body, Button, Card, Chip, ChipRow, Field, H2, Muted, Notice, Screen } from "../../components/ui";
import { QueryGate } from "../../components/QueryGate";
import { useAuth } from "../../auth/AuthContext";
import { friendlyError } from "../../lib/errors";
import { STR, bnNum } from "../../lib/labels";
import { qxLevelLabel } from "../../lib/quranExam";
import type { QuranExamStackParamList } from "../../navigation/types";
import { space } from "../../theme";

type Props = NativeStackScreenProps<QuranExamStackParamList, "QuranExamPaper">;
/** deduct = marked by তানবীহ/ফাত্হ with per/cost (D-#881). */
type Draft = { title: string; items: { label: string; marks: string }[]; deduct: boolean; per: string; cost: string }[];

const toInt = (t: string) => {
  const n = Number(t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).trim());
  return Number.isInteger(n) ? n : NaN;
};

function Editor({ examId, paper, readOnly }: { examId: string; paper: QxPaperT; readOnly: boolean }): React.ReactElement {
  const [sections, setSections] = React.useState<Draft>(() =>
    paper.sections.map((s) => ({
      title: s.title,
      items: s.items.map((i) => ({ label: i.label, marks: String(i.marks) })),
      deduct: s.tanbihPerMark != null,
      per: String(s.tanbihPerMark ?? 4),
      cost: String(s.fathCost ?? 2),
    })),
  );
  const [fullMarks, setFullMarks] = React.useState(String(paper.fullMarks));
  const [duration, setDuration] = React.useState(String(paper.durationMin));
  const [paras, setParas] = React.useState(paper.paras.join(", "));
  const [per, setPer] = React.useState(String(paper.tanbihPerMark ?? 4));
  const [cost, setCost] = React.useState(String(paper.fathCost ?? 2));
  const [st, save] = useMutation(QX_SAVE_PAPER);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const items = paper.scheme === "ITEMS";
  const sum = sections.reduce((a, s) => a + s.items.reduce((b, i) => b + (toInt(i.marks) || 0), 0), 0);
  const full = toInt(fullMarks);
  const upd = (fn: (d: Draft) => Draft) => setSections((d) => fn(d.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }))));

  async function submit() {
    const r = await save({
      examId,
      level: paper.level,
      scheme: paper.scheme,
      fullMarks: full,
      durationMin: toInt(duration),
      sections: items
        ? sections.map((s) => ({
            title: s.title.trim(),
            labels: s.items.map((i) => i.label.trim()),
            marks: s.items.map((i) => toInt(i.marks)),
            tanbihPerMark: s.deduct ? toInt(s.per) : null,
            fathCost: s.deduct ? toInt(s.cost) : null,
          }))
        : null,
      paras: items ? null : paras.split(/[,\s]+/).filter(Boolean).map(toInt),
      tanbihPerMark: items ? null : toInt(per),
      fathCost: items ? null : toInt(cost),
    });
    setMsg(r.error ? { tone: "danger", text: friendlyError(r.error) } : { tone: "ok", text: STR.qxPaperSaved });
  }

  return (
    <View style={{ gap: space(3) }}>
      {readOnly ? <Notice tone="info" message={STR.qxPaperFrozen} /> : null}
      <Field label={STR.qxFullMarksLabel} value={fullMarks} onChangeText={(t) => !readOnly && setFullMarks(t)} />
      <Field label={STR.qxDuration} value={duration} onChangeText={(t) => !readOnly && setDuration(t)} />
      {items ? (
        <>
          {sections.map((s, si) => (
            <Card key={si}>
              <Field label={STR.qxSectionTitle} value={s.title} onChangeText={(t) => !readOnly && upd((d) => ((d[si]!.title = t), d))} />
              <ChipRow>
                <Chip label={STR.qxSecDeduct} selected={s.deduct} onPress={() => !readOnly && upd((d) => ((d[si]!.deduct = !d[si]!.deduct), d))} />
              </ChipRow>
              {s.deduct ? (
                <View style={{ flexDirection: "row", gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.qxTanbihPer} value={s.per} onChangeText={(t) => !readOnly && upd((d) => ((d[si]!.per = t), d))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.qxFathCostLabel} value={s.cost} onChangeText={(t) => !readOnly && upd((d) => ((d[si]!.cost = t), d))} />
                  </View>
                </View>
              ) : null}
              {s.deduct ? <Muted>{STR.qxSecDeductNote}</Muted> : null}
              {s.items.map((it, ii) => (
                <View key={ii} style={{ flexDirection: "row", gap: space(2), alignItems: "flex-end" }}>
                  <View style={{ flex: 1 }}>
                    <Field label={STR.qxItemLabel} value={it.label} onChangeText={(t) => !readOnly && upd((d) => ((d[si]!.items[ii]!.label = t), d))} />
                  </View>
                  <View style={{ width: 72 }}>
                    <Field label={STR.qxItemMarks} value={it.marks} onChangeText={(t) => !readOnly && upd((d) => ((d[si]!.items[ii]!.marks = t), d))} />
                  </View>
                  {!readOnly ? (
                    <Button title={STR.qxRemove} variant="ghost" onPress={() => upd((d) => (d[si]!.items.splice(ii, 1), d))} />
                  ) : null}
                </View>
              ))}
              {!readOnly ? (
                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                  <Button title={STR.qxAddItem} variant="secondary" onPress={() => upd((d) => (d[si]!.items.push({ label: "", marks: "" }), d))} />
                  <Button title={STR.qxRemove} variant="ghost" onPress={() => upd((d) => (d.splice(si, 1), d))} />
                </View>
              ) : null}
            </Card>
          ))}
          {!readOnly ? <Button title={STR.qxAddSection} variant="secondary" onPress={() => upd((d) => (d.push({ title: "", items: [{ label: "", marks: "" }], deduct: false, per: "4", cost: "2" }), d))} /> : null}
          <Body style={{ fontWeight: "700" }}>{STR.qxSum.replace("{n}", bnNum(sum)).replace("{m}", bnNum(Number.isNaN(full) ? 0 : full))}</Body>
          {sum !== full ? <Notice tone="warn" message={STR.qxSumBad} /> : null}
        </>
      ) : (
        <>
          <Field label={STR.qxParasLabel} value={paras} onChangeText={(t) => !readOnly && setParas(t)} />
          <Field label={STR.qxTanbihPer} value={per} onChangeText={(t) => !readOnly && setPer(t)} />
          <Field label={STR.qxFathCostLabel} value={cost} onChangeText={(t) => !readOnly && setCost(t)} />
        </>
      )}
      {msg ? <Notice tone={msg.tone} message={msg.text} /> : null}
      {!readOnly ? <Button title={STR.qxSave} loading={st.fetching} onPress={submit} /> : null}
    </View>
  );
}

export default function QuranExamPaperScreen({ route }: Props): React.ReactElement {
  const { examId, level } = route.params;
  const { can } = useAuth();
  const [q, reexec] = useQuery({ query: QX_EXAMS });
  const paper = q.data?.quranExams?.find((e) => e.examId === examId)?.papers.find((p) => p.level === level);
  return (
    <Screen scroll>
      <H2>{qxLevelLabel(level)}</H2>
      <Muted>{STR.qxEditPaper}</Muted>
      <QueryGate result={q} onRetry={() => reexec({ requestPolicy: "network-only" })}>
        {paper ? <Editor key={paper.id} examId={examId} paper={paper} readOnly={paper.frozen || !can("quran_exam:manage")} /> : null}
      </QueryGate>
    </Screen>
  );
}
