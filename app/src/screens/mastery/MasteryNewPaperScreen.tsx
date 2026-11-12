/**
 * MasteryNewPaperScreen (M-2, mock T2) — build a homework / class-test / rubric sheet for one
 * শাখা × subject. Each question names a LOCKED learning outcome and a question type; its marks
 * come from the question-type table (D-#777) and are shown, never typed. A question is either
 * a gold bank question tagged with that outcome or the teacher's own text (D-#780).
 *
 * PR-B (D-#1314): a switch adds an EARLIER class's codes (same subject) — pick the class, then the
 * same picker for that class; marks come from that class's table, and the item chips show the class.
 * A sheet made only of earlier-class codes is titled "ভিত্তি যাচাই" unless the teacher names it.
 *
 * PR-C (D-#1317): a class-test sheet may name its class test (pre-picked when opened from the class
 * test); the sheet then writes that test's totals, so the required total is shown beside the running one.
 *
 * PR-D (D-#1321): on a homework sheet, "আজকের পাঠ থেকে খসড়া" fills the item list from the lesson
 * marked taught that day (bank questions nobody has seen; the book's exercises when there are none);
 * the teacher edits and saves as usual, with that day's tracker homework pre-selected as the link.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Switch, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient, useMutation, useQuery } from "urql";
import {
  CREATE_MASTERY_PAPER,
  MASTERY_BANK_QUESTIONS_QUERY,
  MASTERY_CATALOGUE_QUERY,
  MASTERY_CLASS_TEST_OPTIONS_QUERY,
  MASTERY_HOMEWORK_DRAFT_QUERY,
  MASTERY_HOMEWORK_OPTIONS_QUERY,
  type MasteryHomeworkDraft,
  type MasteryClassTestOption,
  type MasteryOutcomeRow,
  type MasteryQuestionTypeRow,
} from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, H2 } from "../../components/ui";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { fill, levelFill } from "./masteryStateUi";
import { STR, bnNum, classLevelLabel, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryNewPaper">;

const tokenFor = (level: number) => (level === -1 ? "NUR" : level === 0 ? "KG" : `C${level}`);
/** Class order (NUR < KG < C1 … C6) and back to a roster level for the bank filter. */
const CLASS_ORDER = ["NUR", "KG", "C1", "C2", "C3", "C4", "C5", "C6"];
const levelFor = (token: string) => (token === "NUR" ? -1 : token === "KG" ? 0 : Number(token.slice(1)));
const tokenOfCode = (code: string) => /^LO-(NUR|KG|C\d)-/.exec(code)?.[1] ?? "";
const todayDhaka = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

type Draft = {
  origin: "BANK" | "TEACHER";
  artifactId?: string;
  textBn?: string;
  loCode: string;
  questionTypeCode: string;
  label: string;
  /** Snapshot of the marks shown when added (an earlier-class code uses its own class's table). */
  marks: number;
};

function questionText(payloadJson: string): string {
  try {
    return String((JSON.parse(payloadJson) as { question_text?: string }).question_text ?? "");
  } catch {
    return "";
  }
}

export default function MasteryNewPaperScreen({ route, navigation }: Props): React.ReactElement {
  const lv = useMasteryLevelLabels();
  const { sectionId, subject, classLevel } = route.params;
  const classToken = tokenFor(classLevel);
  const toast = useToast();
  const [source, setSource] = useState<"HW" | "CT" | "RUBRIC">(route.params.classTestId ? "CT" : "HW");
  const [classTestId, setClassTestId] = useState<string | null>(route.params.classTestId ?? null);
  const [date, setDate] = useState(route.params.date ?? todayDhaka());
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
  const [earlierOn, setEarlierOn] = useState(false);
  const [earlierToken, setEarlierToken] = useState<string | null>(null);
  const earlierTokens = CLASS_ORDER.slice(0, Math.max(0, CLASS_ORDER.indexOf(classToken)));
  // The catalogue the picker shows: the section's own class, or the chosen earlier class.
  const pickToken = earlierOn && earlierToken ? earlierToken : classToken;
  const [rubricLabels, setRubricLabels] = useState<Record<string, string>>({});

  const [{ data: catData, fetching: catFetching, error: catErr }] = useQuery({
    query: MASTERY_CATALOGUE_QUERY,
    variables: { classToken: pickToken, subject },
  });
  const [{ data: hwData }] = useQuery({ query: MASTERY_HOMEWORK_OPTIONS_QUERY, variables: { sectionId, subject } });
  const [{ data: ctData }] = useQuery({ query: MASTERY_CLASS_TEST_OPTIONS_QUERY, variables: { sectionId, subject }, pause: source !== "CT" });
  const ctOptions = (ctData?.masteryClassTestOptions ?? []) as MasteryClassTestOption[];
  const linkedTest = ctOptions.find((c) => c.classTestId === classTestId) ?? null;
  const [{ data: bankData, fetching: bankFetching }] = useQuery({
    query: MASTERY_BANK_QUESTIONS_QUERY,
    variables: { loCodes: lo ? [lo] : [], subject, classLevel: levelFor(pickToken) },
    pause: !lo || source === "RUBRIC" || mode !== "BANK",
  });
  const [create, createPaper] = useMutation(CREATE_MASTERY_PAPER);
  const client = useClient();
  const [drafting, setDrafting] = useState(false);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);

  /** PR-D: fill the items from the lesson marked taught on `date` (no write; the teacher still saves). */
  async function draftFromLesson(): Promise<void> {
    setError(null);
    setDrafting(true);
    const res = await client.query(MASTERY_HOMEWORK_DRAFT_QUERY, { sectionId, subject, dateKey: date }, { requestPolicy: "network-only" }).toPromise();
    setDrafting(false);
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    const d = res.data?.masteryHomeworkDraft as MasteryHomeworkDraft | undefined;
    if (!d) return;
    if (d.reason) {
      // Nothing to propose — the screen stays as it is.
      setDraftNotes([d.reason === "NO_LESSON_MARKED" ? STR.msDraftNoLesson : levelFill(STR.msDraftNoCodes, lv)]);
      return;
    }
    setItems(
      d.items.map((i) => ({
        origin: i.origin,
        ...(i.artifactId ? { artifactId: i.artifactId } : {}),
        ...(i.origin === "TEACHER" ? { textBn: i.textBn ?? "" } : {}),
        loCode: i.loCode,
        questionTypeCode: i.questionTypeCode,
        label: `${i.fromBook ? `${STR.msDraftFromBook}: ` : ""}${i.textBn ?? i.qid ?? i.loCode}`,
        marks: i.marks,
      })),
    );
    if (d.hwItemId) setHwItemId(d.hwItemId);
    const short = (codes: string[]) => codes.join(", ");
    setDraftNotes([
      ...(d.gaps.length ? [fill(STR.msDraftGaps, { codes: short(d.gaps) })] : []),
      ...(d.leftOut.length ? [fill(STR.msDraftLeftOut, { codes: short(d.leftOut) })] : []),
      ...(d.rubricCodes.length ? [fill(STR.msDraftRubric, { codes: short(d.rubricCodes) })] : []),
    ]);
  }

  // PR-K (D-#1425): arriving from the class-note link loads the lesson draft once, without a tap.
  // Any other way in (no `fromLesson`) is unchanged. Nothing is saved; the teacher still reviews and saves.
  const autoDrafted = useRef(false);
  useEffect(() => {
    if (route.params.fromLesson && !autoDrafted.current) {
      autoDrafted.current = true;
      void draftFromLesson();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const bank = (bankData?.questions ?? []) as { id: string; qid: string | null; payloadJson: string; qtCode?: string | null }[];
  // PR-G: a bank question that carries its school type is used as that type only.
  const lockedQt = mode === "BANK" ? bank.find((x) => x.id === artifactId)?.qtCode ?? null : null;
  const effQt = lockedQt ?? qt;
  const shownQtChoices = lockedQt ? qts.filter((q) => q.code === lockedQt) : qtChoices;
  // The locked type must be usable: in the class's list, active, with marks. Say why when it is not.
  const lockedRow = lockedQt ? ((catData?.masteryCatalogue?.questionTypes ?? []) as MasteryQuestionTypeRow[]).find((q) => q.code === lockedQt) : null;
  const lockedProblem = !lockedQt
    ? null
    : !lockedRow || !lockedRow.active
      ? fill(STR.msQtNotActive, { qt: lockedQt })
      : lockedRow.marks === null
        ? fill(STR.msQtNoMarks, { qt: lockedQt })
        : null;
  const total = items.reduce((s, i) => s + i.marks, 0);
  const chosenCodes = source === "RUBRIC" ? rubric : items.map((i) => i.loCode);
  const earlierOnly = chosenCodes.length > 0 && chosenCodes.every((c) => tokenOfCode(c) !== classToken);

  function addItem(): void {
    if (!lo || !effQt) return;
    if (mode === "BANK") {
      const b = bank.find((x) => x.id === artifactId);
      if (!b) return;
      setItems((xs) => [
        ...xs,
        { origin: "BANK", artifactId: b.id, loCode: lo, questionTypeCode: effQt, label: questionText(b.payloadJson) || (b.qid ?? b.id), marks: qtMarks.get(effQt) ?? 0 },
      ]);
    } else {
      if (!text.trim()) return;
      setItems((xs) => [...xs, { origin: "TEACHER", textBn: text.trim(), loCode: lo, questionTypeCode: effQt, label: text.trim(), marks: qtMarks.get(effQt) ?? 0 }]);
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
      classTestId: source === "CT" ? classTestId : null,
      items: source === "RUBRIC" ? [] : items.map(({ label: _l, marks: _m, ...i }) => i),
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
      {source === "CT" && ctOptions.length > 0 ? (
        <>
          <Muted>{STR.msCtLinkPick}</Muted>
          <ChipRow>
            <Chip label={STR.msCtLinkNone} selected={!classTestId} onPress={() => setClassTestId(null)} />
            {ctOptions.map((c) => (
              <Chip
                key={c.classTestId}
                label={`${c.examDate} · ${c.ctId} · ${bnNum(c.totalMarks)}`}
                selected={classTestId === c.classTestId}
                onPress={() => {
                  setClassTestId(c.classTestId);
                  setDate(c.examDate); // the sheet's date is the test's exam date
                }}
              />
            ))}
          </ChipRow>
        </>
      ) : null}
      <Field label={STR.msDate} value={date} onChangeText={setDate} />
      <Field label={STR.msTitleOpt} value={title} onChangeText={setTitle} />
      {earlierOnly && !title.trim() ? <Muted>{`${STR.msTitleOpt}: ${STR.msEarlierOnlyTitle}`}</Muted> : null}
      {earlierTokens.length > 0 ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Switch
              value={earlierOn}
              onValueChange={(v) => {
                setEarlierOn(v);
                if (!v) setEarlierToken(null);
                setLo(null);
                setQt(null);
                setArtifactId(null);
              }}
            />
            <Body style={{ flex: 1 }}>{levelFill(STR.msEarlierAdd, lv)}</Body>
          </View>
          {earlierOn ? (
            <>
              <Muted>{STR.msEarlierPickClass}</Muted>
              <ChipRow>
                {earlierTokens.map((t) => (
                  <Chip
                    key={t}
                    label={masteryClassLabel(t)}
                    selected={earlierToken === t}
                    onPress={() => {
                      setEarlierToken(t);
                      setLo(null);
                      setQt(null);
                      setArtifactId(null);
                    }}
                  />
                ))}
              </ChipRow>
            </>
          ) : null}
        </Card>
      ) : null}
      {source === "HW" ? (
        <Button title={STR.msDraftFromLesson} variant="secondary" onPress={() => void draftFromLesson()} loading={drafting} />
      ) : null}
      {source === "HW" ? draftNotes.map((n, i) => <Notice key={i} message={n} tone="info" />) : null}
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
          <Body style={{ fontWeight: "700" }}>{levelFill(STR.msRubricLos, lv)}</Body>
          <ChipRow>
            {rubricLos.map((o) => {
              const on = rubric.includes(o.code);
              return (
                <Chip
                  key={o.code}
                  label={o.labelBn}
                  selected={on}
                  onPress={() => {
                    setRubricLabels((m) => ({ ...m, [o.code]: o.labelBn }));
                    setRubric((r) => (on ? r.filter((x) => x !== o.code) : [...r, o.code]));
                  }}
                />
              );
            })}
          </ChipRow>
          {rubric.some((c) => tokenOfCode(c) !== pickToken) ? (
            <ChipRow>
              {rubric
                .filter((c) => tokenOfCode(c) !== pickToken)
                .map((c) => (
                  <Chip
                    key={c}
                    label={`${masteryClassLabel(tokenOfCode(c))} · ${rubricLabels[c] ?? c}`}
                    selected
                    onPress={() => setRubric((r) => r.filter((x) => x !== c))}
                  />
                ))}
            </ChipRow>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Body style={{ fontWeight: "700" }}>{levelFill(STR.msPickLo, lv)}</Body>
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
                  <Muted>{levelFill(STR.msNoBankQuestion, lv)}</Muted>
                ) : (
                  <View style={{ gap: space(1) }}>
                    {bank.map((b) => (
                      <Chip
                        key={b.id}
                        label={`${b.qtCode ? `${b.qtCode} · ` : ""}${questionText(b.payloadJson) || (b.qid ?? b.id)}`}
                        selected={artifactId === b.id}
                        // Tap again to deselect; the locked type follows the selection (it is never carried to the next item).
                        onPress={() => setArtifactId(artifactId === b.id ? null : b.id)}
                      />
                    ))}
                  </View>
                )
              ) : (
                <Field label={STR.msQuestionText} value={text} onChangeText={setText} multiline />
              )}
              <Muted>{STR.msQType}</Muted>
              {lockedProblem ? <Notice message={lockedProblem} tone="warn" /> : null}
              <ChipRow>
                {shownQtChoices.map((q) => (
                  <Chip key={q.code} label={`${q.labelBn} · ${bnNum(q.marks ?? 0)}`} selected={effQt === q.code} onPress={() => setQt(q.code)} />
                ))}
              </ChipRow>
              <Button
                title={STR.msAddItem}
                variant="secondary"
                onPress={addItem}
                disabled={!effQt || Boolean(lockedProblem) || (mode === "BANK" ? !artifactId : !text.trim())}
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
          {source === "CT" && linkedTest ? (
            <Notice
              tone={total === linkedTest.totalMarks ? "ok" : "warn"}
              message={fill(STR.msCtLinkNeedTotal, { have: bnNum(total), need: bnNum(linkedTest.totalMarks) })}
            />
          ) : null}
          {items.map((i, idx) => (
            <View key={idx} style={{ flexDirection: "row", gap: space(2), alignItems: "center", flexWrap: "wrap" }}>
              <Body style={{ flexShrink: 1 }}>
                {bnNum(idx + 1)}. {i.label}
              </Body>
              {tokenOfCode(i.loCode) !== classToken ? <Badge text={masteryClassLabel(tokenOfCode(i.loCode))} tone="info" /> : null}
              <Muted>
                {i.loCode} · {i.questionTypeCode} · {bnNum(i.marks)}
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
