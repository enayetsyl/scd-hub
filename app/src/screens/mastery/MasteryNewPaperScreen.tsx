/**
 * MasteryNewPaperScreen (M-2, mock T2) — build a homework / class-test / rubric sheet for one
 * শাখা × subject. Each question names a LOCKED learning outcome and a question type; its marks
 * come from the question-type table (D-#777) and are shown, never typed. A question is either
 * a gold bank question tagged with that outcome or the teacher's own text (D-#780).
 */
import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  CREATE_MASTERY_PAPER,
  MASTERY_BANK_QUESTIONS_QUERY,
  MASTERY_CATALOGUE_QUERY,
  MASTERY_HOMEWORK_OPTIONS_QUERY,
  type MasteryOutcomeRow,
  type MasteryQuestionTypeRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, H2 } from "../../components/ui";
import { STR, bnNum, classLevelLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryNewPaper">;

const tokenFor = (level: number) => (level === -1 ? "NUR" : level === 0 ? "KG" : `C${level}`);
const todayDhaka = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

type Draft = { origin: "BANK" | "TEACHER"; artifactId?: string; textBn?: string; loCode: string; questionTypeCode: string; label: string };

function questionText(payloadJson: string): string {
  try {
    return String((JSON.parse(payloadJson) as { question_text?: string }).question_text ?? "");
  } catch {
    return "";
  }
}

export default function MasteryNewPaperScreen({ route, navigation }: Props): React.ReactElement {
  const { sectionId, subject, classLevel } = route.params;
  const classToken = tokenFor(classLevel);
  const toast = useToast();
  const [source, setSource] = useState<"HW" | "CT" | "RUBRIC">("HW");
  const [date, setDate] = useState(todayDhaka());
  const [title, setTitle] = useState("");
  const [hwItemId, setHwItemId] = useState<string | null>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [rubric, setRubric] = useState<string[]>([]);
  const [lo, setLo] = useState<string | null>(null);
  const [mode, setMode] = useState<"BANK" | "TEACHER">("BANK");
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [qt, setQt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [{ data: catData, fetching: catFetching, error: catErr }] = useQuery({
    query: MASTERY_CATALOGUE_QUERY,
    variables: { classToken, subject },
  });
  const [{ data: hwData }] = useQuery({ query: MASTERY_HOMEWORK_OPTIONS_QUERY, variables: { sectionId, subject } });
  const [{ data: bankData, fetching: bankFetching }] = useQuery({
    query: MASTERY_BANK_QUESTIONS_QUERY,
    variables: { loCodes: lo ? [lo] : [], subject, classLevel },
    pause: !lo || source === "RUBRIC" || mode !== "BANK",
  });
  const [create, createPaper] = useMutation(CREATE_MASTERY_PAPER);

  const outcomes = ((catData?.masteryCatalogue?.outcomes ?? []) as MasteryOutcomeRow[]).filter((o) => o.status === "LOCKED");
  const qts = ((catData?.masteryCatalogue?.questionTypes ?? []) as MasteryQuestionTypeRow[]).filter((q) => q.active && q.marks !== null);
  const questionLos = outcomes.filter((o) => o.assess === "QUESTION");
  const rubricLos = outcomes.filter((o) => o.assess === "RUBRIC");
  const loRow = questionLos.find((o) => o.code === lo);
  const qtChoices = useMemo(() => {
    const preferred = loRow?.questionTypeCodes ?? [];
    return preferred.length > 0 ? qts.filter((q) => preferred.includes(q.code)) : qts;
  }, [loRow, qts]);
  const qtMarks = new Map(qts.map((q) => [q.code, q.marks ?? 0]));
  const bank = (bankData?.questions ?? []) as { id: string; qid: string | null; payloadJson: string }[];
  const total = items.reduce((s, i) => s + (qtMarks.get(i.questionTypeCode) ?? 0), 0);

  function addItem(): void {
    if (!lo || !qt) return;
    if (mode === "BANK") {
      const b = bank.find((x) => x.id === artifactId);
      if (!b) return;
      setItems((xs) => [...xs, { origin: "BANK", artifactId: b.id, loCode: lo, questionTypeCode: qt, label: questionText(b.payloadJson) || (b.qid ?? b.id) }]);
    } else {
      if (!text.trim()) return;
      setItems((xs) => [...xs, { origin: "TEACHER", textBn: text.trim(), loCode: lo, questionTypeCode: qt, label: text.trim() }]);
      setText("");
    }
    setArtifactId(null);
  }

  async function onCreate(): Promise<void> {
    setError(null);
    const res = await createPaper({
      sectionId,
      subject,
      source,
      date,
      title: title.trim() || null,
      hwItemId: source === "HW" ? hwItemId : null,
      items: source === "RUBRIC" ? [] : items.map(({ label: _l, ...i }) => i),
      rubricLoCodes: source === "RUBRIC" ? rubric : [],
    });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    const paperId = res.data?.createMasteryPaper?.paperId as string;
    toast.show(STR.msSaved);
    navigation.replace("MasteryEntry", { paperId });
  }

  const canCreate = source === "RUBRIC" ? rubric.length > 0 : items.length > 0;

  return (
    <Screen scroll>
      <H2>
        {classLevelLabel(classLevel)} · {hwSubjectLabel(subject)} — {STR.msNewSheet}
      </H2>
      <ChipRow>
        <Chip label={STR.msSourceHW} selected={source === "HW"} onPress={() => setSource("HW")} />
        <Chip label={STR.msSourceCT} selected={source === "CT"} onPress={() => setSource("CT")} />
        <Chip label={STR.msSourceRubric} selected={source === "RUBRIC"} onPress={() => setSource("RUBRIC")} />
      </ChipRow>
      <Field label={STR.msDate} value={date} onChangeText={setDate} />
      <Field label={STR.msTitleOpt} value={title} onChangeText={setTitle} />
      {source === "HW" && (hwData?.masteryHomeworkOptions ?? []).length > 0 ? (
        <>
          <Muted>{STR.msLinkHw}</Muted>
          <ChipRow>
            {(hwData!.masteryHomeworkOptions as { hwItemId: string; hwId: string; date: string }[]).map((h) => (
              <Chip
                key={h.hwItemId}
                label={`${h.date} · ${h.hwId}`}
                selected={hwItemId === h.hwItemId}
                onPress={() => setHwItemId(hwItemId === h.hwItemId ? null : h.hwItemId)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      {catErr ? <Notice message={friendlyError(catErr)} tone="danger" /> : null}
      {catFetching ? <Loader /> : null}

      {source === "RUBRIC" ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msRubricLos}</Body>
          <ChipRow>
            {rubricLos.map((o) => {
              const on = rubric.includes(o.code);
              return (
                <Chip key={o.code} label={o.labelBn} selected={on} onPress={() => setRubric((r) => (on ? r.filter((x) => x !== o.code) : [...r, o.code]))} />
              );
            })}
          </ChipRow>
        </Card>
      ) : (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msPickLo}</Body>
          <ChipRow>
            {questionLos.map((o) => (
              <Chip
                key={o.code}
                label={o.labelBn}
                selected={lo === o.code}
                onPress={() => {
                  setLo(o.code);
                  setQt(null);
                  setArtifactId(null);
                }}
              />
            ))}
          </ChipRow>
          {lo ? (
            <>
              <Muted>{lo}</Muted>
              <ChipRow>
                <Chip label={STR.msFromBank} selected={mode === "BANK"} onPress={() => setMode("BANK")} />
                <Chip label={STR.msOwnQuestion} selected={mode === "TEACHER"} onPress={() => setMode("TEACHER")} />
              </ChipRow>
              {mode === "BANK" ? (
                bankFetching ? (
                  <Loader />
                ) : bank.length === 0 ? (
                  <Muted>{STR.msNoBankQuestion}</Muted>
                ) : (
                  <View style={{ gap: space(1) }}>
                    {bank.map((b) => (
                      <Chip key={b.id} label={questionText(b.payloadJson) || (b.qid ?? b.id)} selected={artifactId === b.id} onPress={() => setArtifactId(b.id)} />
                    ))}
                  </View>
                )
              ) : (
                <Field label={STR.msQuestionText} value={text} onChangeText={setText} multiline />
              )}
              <Muted>{STR.msQType}</Muted>
              <ChipRow>
                {qtChoices.map((q) => (
                  <Chip key={q.code} label={`${q.labelBn} · ${bnNum(q.marks ?? 0)}`} selected={qt === q.code} onPress={() => setQt(q.code)} />
                ))}
              </ChipRow>
              <Button
                title={STR.msAddItem}
                variant="secondary"
                onPress={addItem}
                disabled={!qt || (mode === "BANK" ? !artifactId : !text.trim())}
              />
            </>
          ) : null}
        </Card>
      )}

      {source !== "RUBRIC" && items.length > 0 ? (
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2) }}>
            <Body style={{ fontWeight: "700" }}>{STR.msItems}</Body>
            <Badge text={`${bnNum(items.length)} · ${bnNum(total)}`} tone="brand" />
          </View>
          {items.map((i, idx) => (
            <View key={idx} style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Body style={{ flexShrink: 1 }}>
                {bnNum(idx + 1)}. {i.label}
              </Body>
              <Muted>
                {i.loCode} · {i.questionTypeCode} · {bnNum(qtMarks.get(i.questionTypeCode) ?? 0)}
              </Muted>
              <Button title={STR.msDelete} variant="ghost" onPress={() => setItems((xs) => xs.filter((_, j) => j !== idx))} />
            </View>
          ))}
        </Card>
      ) : null}

      {error ? <Notice message={error} tone="danger" /> : null}
      <Button title={STR.msCreate} onPress={() => void onCreate()} loading={create.fetching} disabled={!canCreate} />
    </Screen>
  );
}
