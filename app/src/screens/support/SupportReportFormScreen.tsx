/**
 * সহায়তা রিপোর্ট — the report form (docs/prd-child-support-profile.md §9.3, §6.9, §6.12, §16.5).
 * before → what the child did → after, + the good thing (OA-2). Saving runs only deterministic checks
 * on the server: a blocked word or another child's name is refused with the words shown; a safety
 * sign asks the question first. The always-present line goes straight to the Principal. A report
 * that came back with questions shows them under the fields (এভাবে লিখুন · আমি একমত নই · মনে নেই).
 */
import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import {
  SAFEGUARDING_STEPS_BN,
  SUPPORT_ANTECEDENTS,
  SUPPORT_ANTECEDENT_LABELS_BN,
  SUPPORT_FLAG_FIELDS,
  SUPPORT_FUNCTIONS,
  SUPPORT_FUNCTION_LABELS_BN,
  SUPPORT_GOOD_NONE_REASONS,
  SUPPORT_GOOD_NONE_REASON_LABELS_BN,
  SUPPORT_STARTER_STRATEGIES,
} from "@scd/shared";
import { RAISE_SAFEGUARDING, SAVE_SUPPORT_DRAFT, SUBMIT_SUPPORT_REPORT, SUPPORT_REPORT, type SupportReportT } from "../../graphql/supportProfile";
import type { HomeStackParamList } from "../../navigation/types";
import { Screen, Card, Body, Muted, Button, Field, Chip, ChipRow, Notice, Loader } from "../../components/ui";
import { useToast } from "../../state/ToastContext";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { dateKey } from "../../lib/dates";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeStackParamList, "SupportReportForm">;
type Answer = { answer: "REWRITTEN" | "USED_SUGGESTION" | "DISAGREE" | "DONT_REMEMBER"; reasonBn?: string };

const toggle = (list: string[], v: string, max = 99): string[] => (list.includes(v) ? list.filter((x) => x !== v) : list.length >= max ? list : [...list, v]);

export default function SupportReportFormScreen({ route, navigation }: Props): React.ReactElement {
  const { studentId, reportId, source } = route.params;
  const toast = useToast();
  const guardian = source === "GUARDIAN_INFO";
  const [existing] = useQuery<{ supportReport: SupportReportT }>({ query: SUPPORT_REPORT, variables: { reportId: reportId ?? "", via: "MY_REPORTS" }, pause: !reportId });
  const [occurredOn, setOccurredOn] = useState(dateKey());
  const [periodNo, setPeriodNo] = useState("");
  const [subject, setSubject] = useState("");
  const [antecedents, setAntecedents] = useState<string[]>([]);
  const [situation, setSituation] = useState("");
  const [settingNote, setSettingNote] = useState("");
  const [behaviour, setBehaviour] = useState("");
  const [howOften, setHowOften] = useState<string | null>(null);
  const [tried, setTried] = useState("");
  const [starters, setStarters] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [resultNote, setResultNote] = useState("");
  const [got, setGot] = useState<string[]>([]);
  const [exception, setException] = useState("");
  const [whatWorked, setWhatWorked] = useState("");
  const [good, setGood] = useState("");
  const [goodNone, setGoodNone] = useState(false);
  const [goodReason, setGoodReason] = useState<string | null>(null);
  const [goodReasonBn, setGoodReasonBn] = useState("");
  const [tone, setTone] = useState<string | null>(guardian ? "POSITIVE" : null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [askWords, setAskWords] = useState<string[]>([]);
  const [sgSigns, setSgSigns] = useState<string[] | null>(null);
  const [sgText, setSgText] = useState("");
  const [sgOpen, setSgOpen] = useState(false);
  const [submitState, submit] = useMutation(SUBMIT_SUPPORT_REPORT);
  const [, saveDraft] = useMutation(SAVE_SUPPORT_DRAFT);
  const [, raise] = useMutation(RAISE_SAFEGUARDING);

  const rep = existing.data?.supportReport;
  useEffect(() => {
    if (!rep) return;
    setOccurredOn(rep.occurredOn);
    setPeriodNo(rep.periodNo != null ? String(rep.periodNo) : "");
    setSubject(rep.subject ?? "");
    setAntecedents(rep.antecedentTags);
    setSituation(rep.situation ?? "");
    setSettingNote(rep.settingNote ?? "");
    setBehaviour(rep.behaviour ?? "");
    setHowOften(rep.howOften);
    setTried(rep.tried ?? "");
    setStarters(rep.starterKeys);
    setResult(rep.result);
    setResultNote(rep.resultNote ?? "");
    setGot(rep.gotOrAvoided);
    setException(rep.exception ?? "");
    setWhatWorked(rep.whatWorked ?? "");
    setGood(rep.goodThingText ?? "");
    setGoodNone(rep.goodThingNone);
    setGoodReason(rep.goodThingReasonKey);
    setTone(rep.tone);
  }, [rep]);

  const input = () => ({
    studentId,
    source: source ?? (rep?.source === "COMMENT_SEED" ? "COMMENT_SEED" : undefined),
    occurredOn,
    groupType: "section",
    subject: subject || undefined,
    periodNo: periodNo ? Number(periodNo) : undefined,
    antecedentTags: antecedents,
    situation,
    settingNote,
    behaviour,
    howOften: howOften ?? undefined,
    tried,
    starterKeys: starters,
    result: result ?? undefined,
    resultNote,
    gotOrAvoided: got,
    exception,
    whatWorked,
    goodThingText: goodNone ? undefined : good,
    goodThingNone: goodNone,
    goodThingReasonKey: goodNone ? (goodReason ?? undefined) : undefined,
    goodThingReasonBn: goodNone ? goodReasonBn : undefined,
    tone: tone ?? "MIXED", // never reached without a choice: doSubmit / draft check it first
  });

  const doSubmit = async (sg?: "YES" | "NO") => {
    if (!tone) return toast.show(STR.supToneRequired, "danger");
    const questionAnswers = Object.entries(answers).map(([flagId, a]) => ({ flagId, answer: a.answer, reasonBn: a.reasonBn }));
    const res = await submit({ input: input(), reportId: reportId ?? null, safeguardingAnswer: sg ?? null, questionAnswers: questionAnswers.length ? questionAnswers : null });
    if (res.error) return toast.show(friendlyError(res.error), "danger");
    const o = res.data?.submitSupportReport;
    setAskWords((o?.askHits ?? []).map((h: { term: string }) => h.term));
    if (o?.outcome === "BLOCKED") return setBlocked((o.blocked ?? []).map((b: { term: string }) => b.term));
    if (o?.outcome === "SAFEGUARDING_QUESTION") return setSgSigns(o.signs ?? []);
    setBlocked([]);
    setSgSigns(null);
    toast.show(o?.outcome === "ROUTED" ? STR.supSgRouted : STR.supSubmitted, "ok");
    if (o?.balanceNudge) toast.show(STR.supBalance, "info");
    navigation.goBack();
  };

  const questionsFor = (field: string) => (rep?.status === "NEEDS_REWRITE" ? rep.questions.filter((q) => q.field === field) : []);
  /** A plain render function (NOT a component defined in render — that would remount the field and lose focus). */
  const renderQuestions = (field: string, set?: (v: string) => void) =>
    questionsFor(field).map((q) => (
      <Card key={q.flagId}>
        <Body>{`“${q.quote}” — ${q.askBn}`}</Body>
        <ChipRow>
          {q.suggestionBn && set ? (
            <Chip label={STR.supUseSuggestion} selected={answers[q.flagId]?.answer === "USED_SUGGESTION"} onPress={() => (set(q.suggestionBn!), setAnswers({ ...answers, [q.flagId]: { answer: "USED_SUGGESTION" } }))} />
          ) : null}
          {q.severity !== "BLOCK" ? <Chip label={STR.supDisagree} selected={answers[q.flagId]?.answer === "DISAGREE"} onPress={() => setAnswers({ ...answers, [q.flagId]: { answer: "DISAGREE", reasonBn: "" } })} /> : null}
          <Chip label={STR.supDontRemember} selected={answers[q.flagId]?.answer === "DONT_REMEMBER"} onPress={() => setAnswers({ ...answers, [q.flagId]: { answer: "DONT_REMEMBER" } })} />
        </ChipRow>
        {answers[q.flagId]?.answer === "DISAGREE" ? (
          <Field label={STR.supDisagreeReason} value={answers[q.flagId]?.reasonBn ?? ""} onChangeText={(t) => setAnswers({ ...answers, [q.flagId]: { answer: "DISAGREE", reasonBn: t } })} />
        ) : null}
      </Card>
    ));
  // A question about a field this form does not show is listed at the top, never lost.
  const unmatched = rep?.status === "NEEDS_REWRITE" ? rep.questions.filter((q) => !(SUPPORT_FLAG_FIELDS as readonly string[]).includes(q.field)) : [];

  if (reportId && existing.fetching) return <Loader />;
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        {rep?.status === "NEEDS_REWRITE" ? <Notice message={STR.supQuestions} tone="info" /> : null}
        {unmatched.length ? <Body style={{ fontWeight: "700" }}>{STR.supUnmatchedQs}</Body> : null}
        {unmatched.map((q) => (
          <Card key={q.flagId}>
            <Body>{`“${q.quote}” — ${q.askBn}`}</Body>
            <ChipRow>
              <Chip label={STR.supDontRemember} selected={answers[q.flagId]?.answer === "DONT_REMEMBER"} onPress={() => setAnswers({ ...answers, [q.flagId]: { answer: "DONT_REMEMBER" } })} />
            </ChipRow>
          </Card>
        ))}
        {rep?.status === "RETURNED" && rep.decisionReasonBn ? <Notice message={`${STR.supReturnedReason}: ${rep.decisionReasonBn}`} tone="warn" /> : null}
        <Field label={STR.supFieldDate} value={occurredOn} onChangeText={setOccurredOn} />
        {!guardian ? (
          <>
            <Field label={STR.supFieldPeriod} value={periodNo} onChangeText={(t) => setPeriodNo(t.replace(/\D/g, ""))} keyboardType="number-pad" />
            <Field label={STR.supFieldSubject} value={subject} onChangeText={setSubject} />
            <Body>{STR.supFieldBefore}</Body>
            <ChipRow>
              {SUPPORT_ANTECEDENTS.map((a) => (
                <Chip key={a} label={SUPPORT_ANTECEDENT_LABELS_BN[a]} selected={antecedents.includes(a)} onPress={() => setAntecedents(toggle(antecedents, a, 3))} />
              ))}
            </ChipRow>
          </>
        ) : null}
        <Field label={STR.supFieldSituation} value={situation} onChangeText={setSituation} multiline />
        {renderQuestions("situation", setSituation)}
        {!guardian ? (
          <>
            <Field label={STR.supFieldSettingNote} helper={STR.supFieldSettingHelp} value={settingNote} onChangeText={setSettingNote} multiline />
            {renderQuestions("settingNote", setSettingNote)}
            <Field label={STR.supFieldBehaviour} helper={STR.supFieldBehaviourHelp} value={behaviour} onChangeText={setBehaviour} multiline />
            {renderQuestions("behaviour", setBehaviour)}
            <Body>{STR.supFieldHowOften}</Body>
            <ChipRow>
              {[["ONCE", STR.supOftenOnce], ["TWO_THREE", STR.supOften23], ["MORE", STR.supOftenMore]].map(([k, l]) => (
                <Chip key={k} label={l} selected={howOften === k} onPress={() => setHowOften(howOften === k ? null : k)} />
              ))}
            </ChipRow>
            <Field label={STR.supFieldTried} value={tried} onChangeText={setTried} multiline />
            {renderQuestions("tried", setTried)}
            <Body>{STR.supFieldStarters}</Body>
            <ChipRow>
              {SUPPORT_STARTER_STRATEGIES.map((s) => (
                <Chip key={s.key} label={s.bn} selected={starters.includes(s.key)} onPress={() => setStarters(toggle(starters, s.key, 3))} />
              ))}
            </ChipRow>
            <Body>{STR.supFieldResult}</Body>
            <ChipRow>
              {[["WORKED", STR.supResWorked], ["PARTLY", STR.supResPartly], ["DID_NOT_WORK", STR.supResNot], ["UNCLEAR", STR.supResUnclear]].map(([k, l]) => (
                <Chip key={k} label={l} selected={result === k} onPress={() => setResult(k)} />
              ))}
            </ChipRow>
            <Field label={STR.supFieldResultNote} value={resultNote} onChangeText={setResultNote} />
            {renderQuestions("result", setResultNote)}
            <Body>{STR.supFieldGot}</Body>
            <ChipRow>
              {SUPPORT_FUNCTIONS.map((f) => (
                <Chip key={f} label={SUPPORT_FUNCTION_LABELS_BN[f]} selected={got.includes(f)} onPress={() => setGot(toggle(got, f))} />
              ))}
            </ChipRow>
            <Field label={STR.supFieldException} value={exception} onChangeText={setException} multiline />
            {renderQuestions("exception", setException)}
          </>
        ) : null}
        <Field label={STR.supFieldWhatWorked} value={whatWorked} onChangeText={setWhatWorked} multiline />
        {renderQuestions("whatWorked", setWhatWorked)}
        {!guardian ? (
          <>
            <Field label={STR.supFieldGood} helper={STR.supFieldGoodHelp} value={good} onChangeText={(t) => (setGood(t), setGoodNone(false))} editable={!goodNone} />
            {renderQuestions("goodThing", setGood)}
            <ChipRow>
              <Chip label={STR.supGoodNone} selected={goodNone} onPress={() => setGoodNone(!goodNone)} />
            </ChipRow>
            {goodNone ? (
              <>
                <Body>{STR.supGoodNoneReason}</Body>
                <ChipRow>
                  {SUPPORT_GOOD_NONE_REASONS.map((r) => (
                    <Chip key={r} label={SUPPORT_GOOD_NONE_REASON_LABELS_BN[r]} selected={goodReason === r} onPress={() => setGoodReason(r)} />
                  ))}
                </ChipRow>
                {goodReason === "OTHER" ? <Field label={STR.supGoodNoneReason} value={goodReasonBn} onChangeText={setGoodReasonBn} /> : null}
              </>
            ) : null}
          </>
        ) : null}
        <Body>{STR.supFieldTone}</Body>
        <ChipRow>
          {[["POSITIVE", STR.supToneP], ["CONCERN", STR.supToneC], ["MIXED", STR.supToneM]].map(([k, l]) => (
            <Chip key={k} label={l} selected={tone === k} onPress={() => setTone(k)} />
          ))}
        </ChipRow>
        {blocked.length ? <Notice message={`${STR.supBlocked} ${blocked.join(", ")}`} tone="danger" /> : null}
        {askWords.length ? <Notice message={`${STR.supAskWords} ${askWords.join(", ")}`} tone="info" /> : null}
        {sgSigns ? (
          <Card>
            <Body style={{ fontWeight: "700" }}>{STR.supSgQuestion}</Body>
            <View style={{ gap: space(2), marginTop: space(2) }}>
              <Button title={STR.supSgYes} variant="danger" onPress={() => doSubmit("YES")} />
              <Button title={STR.supSgNo} variant="secondary" onPress={() => doSubmit("NO")} />
            </View>
          </Card>
        ) : (
          <View style={{ gap: space(2) }}>
            <Button title={rep?.status === "NEEDS_REWRITE" || rep?.status === "RETURNED" ? STR.supResubmit : STR.supSubmit} loading={submitState.fetching} onPress={() => doSubmit()} />
            {!reportId || rep?.status === "DRAFT" ? (
              <Button
                title={STR.supSaveDraft}
                variant="secondary"
                onPress={async () => {
                  const r = await saveDraft({ input: { ...input(), tone: tone ?? "MIXED" }, reportId: reportId ?? null });
                  toast.show(r.error ? friendlyError(r.error) : STR.supDraftSaved, r.error ? "danger" : "ok");
                  // a safety sign in the draft: ask the question now, before anything else
                  const signs = r.data?.saveSupportReportDraft?.signs ?? [];
                  if (!r.error && signs.length) setSgSigns(signs);
                }}
              />
            ) : null}
          </View>
        )}
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.supSgFormLine}</Body>
          {sgOpen ? (
            <>
              <Muted>{STR.supSgSteps}</Muted>
              {SAFEGUARDING_STEPS_BN.map((s, i) => (
                <Muted key={i}>{`${i + 1}. ${s}`}</Muted>
              ))}
              <Field label={STR.supSgText} value={sgText} onChangeText={setSgText} multiline />
              <Button
                title={STR.supSgRaise}
                variant="danger"
                onPress={async () => {
                  const r = await raise({ studentId, textBn: sgText });
                  if (r.error) return toast.show(friendlyError(r.error), "danger");
                  toast.show(STR.supSgRouted, "ok");
                  setSgOpen(false);
                  setSgText("");
                }}
              />
            </>
          ) : (
            <Button title={STR.supSgRaise} variant="ghost" onPress={() => setSgOpen(true)} />
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
