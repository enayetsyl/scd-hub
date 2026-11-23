/**
 * MasteryAssignmentSheetScreen (M-4, mock T7) — one student's Part B: each question with the
 * outcome, its band (why it was picked), type and marks; swap for the next unseen gold question
 * of the same outcome, remove, add the teacher's own question (outcome + type; marks from the
 * table), approve. A gap the bank could not fill is shown plainly (D-#780).
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { CHILD_HINT_STEPS } from "../../graphql/homeworkIntegrity";
import { EDIT_MASTERY_ASSIGNMENT_SHEET, MASTERY_ASSIGNMENT_SHEET_QUERY, MASTERY_LOOP_POLICY_QUERY, type MasteryAssignmentSheetData } from "../../graphql/mastery";
import { AssignmentBankPicker } from "../../components/AssignmentBankPicker";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, Select, H2 } from "../../components/ui";
import { useMasteryLevelLabels } from "../../lib/useMasteryLevelLabels";
import { STR, bnNum, masteryBandLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf } from "../../lib/pdf";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { levelFill, fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryAssignmentSheet">;

const bandTone = (b: string) => (b === "WEAK" ? "danger" : b === "IMPROVING" ? "warn" : b === "REVISION" ? "info" : b === "TEACHER" ? "gold" : "muted");

export default function MasteryAssignmentSheetScreen({ navigation, route }: Props): React.ReactElement {
  const lv = useMasteryLevelLabels();
  const { assignmentId, studentId, subject } = route.params;
  // AL-8: "add from the bank" belongs to the 2027 loop only (§3.6) — with the switch off the 2026 sheet is unchanged.
  const [loopQ] = useQuery({ query: MASTERY_LOOP_POLICY_QUERY });
  const loopOn = loopQ.data?.masteryPolicy?.resolved?.academicLoop2027On === true;
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_ASSIGNMENT_SHEET_QUERY,
    variables: { assignmentId, studentId },
    requestPolicy: "cache-and-network",
  });
  const [editState, edit] = useMutation(EDIT_MASTERY_ASSIGNMENT_SHEET);
  const fresh = editState.data?.editMasteryAssignmentSheet as MasteryAssignmentSheetData | undefined;
  const s = (fresh && fresh.studentId === studentId ? fresh : undefined) ?? (data?.masteryAssignmentSheet as MasteryAssignmentSheetData | undefined);
  // GH-1 follow-up: how many hint steps this child's family opened per question (read-only).
  const sheetQids = (s?.items ?? []).map((q) => q.qid).filter((x): x is string => !!x);
  const [{ data: hintData }] = useQuery({
    query: CHILD_HINT_STEPS,
    variables: { studentId, assignmentId, qids: sheetQids },
    pause: sheetQids.length === 0,
    requestPolicy: "cache-and-network",
  });
  const hintSteps = new Map<string, number>(((hintData?.childHintSteps ?? []) as { qid: string; step: number }[]).map((h) => [h.qid, h.step]));
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [lo, setLo] = useState<string | null>(null);
  const [qt, setQt] = useState<string | null>(null);
  const [text, setText] = useState("");

  const run = async (vars: Record<string, unknown>): Promise<boolean> => {
    setMsg(null);
    const res = await edit({ assignmentId, studentId, ...vars });
    if (res.error) {
      setMsg(friendlyError(res.error));
      return false;
    }
    return true;
  };

  if (fetching && !s) {
    return (
      <Screen>
        <Loader />
      </Screen>
    );
  }
  if (error || !s) {
    return (
      <Screen>
        <Notice message={error ? friendlyError(error) : STR.errGeneric} tone="danger" />
      </Screen>
    );
  }
  // Editable = the server says so (the rule the edit mutation applies, incl. the Office on a leave day); read from the loaded
  // copy — an edit result does not carry the flag. A read-only reader (class teacher, another subject's teacher, the Office on a
  // normal day) sees the sheet and nothing to press.
  const editable = (data?.masteryAssignmentSheet as MasteryAssignmentSheetData | undefined)?.mayEdit === true && s.assignmentStatus === "DRAFT";
  const loChoice = s.outcomeChoices.find((o) => o.loCode === lo);

  return (
    <Screen scroll>
      <H2>
        {s.name} · {STR.msAsSheet}
      </H2>
      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap", alignItems: "center" }}>
        <Badge text={fill(STR.msAsMarksOf, { have: bnNum(s.marks), target: bnNum(s.targetMarks) })} tone={s.marks === s.targetMarks ? "ok" : "gold"} />
        <Button title={STR.msStudent} variant="ghost" onPress={() => navigation.navigate("MasteryStudent", { studentId, subject })} />
      </View>
      {msg ? <Notice message={msg} tone="danger" /> : null}
      {s.warnings.map((w, i) =>
        w.code === "NO_UNSEEN_QUESTION" ? (
          <Notice key={i} tone="warn" message={fill(STR.msAsNoUnseen, { lo: w.labelBn ?? w.loCode ?? "" })} />
        ) : w.code === "TYPE_HAS_NO_MARKS" ? (
          <Notice key={i} tone="warn" message={fill(STR.msAsNoMarks, { lo: w.labelBn ?? w.loCode ?? "" })} />
        ) : (
          <Notice key={i} tone="info" message={STR.msAsNothing} />
        ),
      )}

      {s.items.map((q, i) => (
        <Card key={`${q.qid ?? q.textBn}-${i}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
            <View style={{ flexDirection: "row", gap: space(1), flexWrap: "wrap", alignItems: "center", flexShrink: 1 }}>
              <Body style={{ fontWeight: "700" }}>{bnNum(i + 1)}.</Body>
              <Badge text={masteryBandLabel(q.band)} tone={bandTone(q.band)} />
              <Badge text={`${q.questionTypeCode} · ${bnNum(q.marks)}`} tone="muted" />
              {q.repeat ? <Badge text={STR.al8Again} tone="warn" /> : null}
            </View>
            {editable ? (
              <View style={{ flexDirection: "row", gap: space(1) }}>
                {q.origin === "BANK" ? <Button title={STR.msAsSwap} variant="secondary" disabled={editState.fetching} onPress={() => run({ op: "SWAP", index: i })} /> : null}
                <Button title={STR.msAsRemove} variant="ghost" disabled={editState.fetching} onPress={() => run({ op: "REMOVE", index: i })} />
              </View>
            ) : null}
          </View>
          <Muted style={{ fontSize: 12 }}>
            {q.loCode} · {q.labelBn}
            {q.qid ? ` · ${q.qid}` : ""}
          </Muted>
          <Body>{q.textBn ?? q.qid}</Body>
          {q.reasonBn ? <Muted>{q.reasonBn}</Muted> : null}
          {q.qid && (hintSteps.get(q.qid) ?? 0) > 0 ? <Muted>{STR.hiHints.replace("{n}", bnNum(hintSteps.get(q.qid) ?? 0))}</Muted> : null}
        </Card>
      ))}

      {/* AL-8 (§4.6): the child's Part B takes a bank question picked from the filtered list (or typed by code); the server
          re-checks §4.3 and its refusal shows above. Switch on only. */}
      {editable && loopOn ? <AssignmentBankPicker assignmentId={assignmentId} studentId={studentId} disabled={editState.fetching} onAdd={(q) => run({ op: "ADD_BANK", qid: q })} /> : null}
      {!editable && s.assignmentStatus === "DRAFT" && loopOn ? <Notice message={STR.al8ReadOnly} tone="info" /> : null}
      {editable && !adding ? <Button title={STR.msAsAddOwn} variant="secondary" onPress={() => setAdding(true)} /> : null}
      {editable && adding ? (
        <Card>
          <Select
            label={levelFill(STR.msAsOutcome, lv)}
            value={lo}
            searchable
            options={s.outcomeChoices.map((o) => ({ label: `${o.labelBn} · ${o.loCode}`, value: o.loCode }))}
            onChange={(v) => {
              setLo(v);
              setQt(null);
            }}
          />
          {loChoice ? (
            <ChipRow>
              {/* PR-K: every active type of the marks table; the objective's suggested ones first. */}
              {[...s.typeChoices]
                .sort((a, b) => Number(loChoice.questionTypeCodes.includes(b.code)) - Number(loChoice.questionTypeCodes.includes(a.code)))
                .map(({ code: t, labelBn, marks }) => (
                <Chip key={t} label={`${labelBn} · ${bnNum(marks)}`} selected={qt === t} onPress={() => setQt(t)} />
              ))}
            </ChipRow>
          ) : null}
          <Field label={STR.msAsText} value={text} onChangeText={setText} multiline />
          <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
            <Button
              title={STR.msAsAdd}
              disabled={!lo || !qt || !text.trim() || editState.fetching}
              onPress={async () => {
                if (await run({ op: "ADD_OWN", loCode: lo, questionTypeCode: qt, textBn: text })) {
                  setAdding(false);
                  setText("");
                }
              }}
            />
            <Button title={STR.msCancel} variant="secondary" onPress={() => setAdding(false)} />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
        <Button
          title={STR.msAsPdf}
          variant="secondary"
          onPress={async () => {
            try {
              await openPdf(`/pdf/mastery-assignment/${assignmentId}?studentId=${studentId}`);
            } catch {
              setMsg(STR.errGeneric);
            }
          }}
        />
        {editable && s.status !== "APPROVED" ? (
          <Button
            title={STR.msAsApprove}
            disabled={editState.fetching}
            onPress={async () => {
              if (await run({ op: "APPROVE" })) navigation.goBack();
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}
