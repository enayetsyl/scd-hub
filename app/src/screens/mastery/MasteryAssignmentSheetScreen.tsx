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
import { EDIT_MASTERY_ASSIGNMENT_SHEET, MASTERY_ASSIGNMENT_SHEET_QUERY, type MasteryAssignmentSheetData } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Chip, ChipRow, Field, Loader, Notice, Select, H2 } from "../../components/ui";
import { STR, bnNum, masteryBandLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { openPdf } from "../../lib/pdf";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";
import { fill } from "./masteryStateUi";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryAssignmentSheet">;

const bandTone = (b: string) => (b === "WEAK" ? "danger" : b === "IMPROVING" ? "warn" : b === "REVISION" ? "info" : b === "TEACHER" ? "gold" : "muted");

export default function MasteryAssignmentSheetScreen({ navigation, route }: Props): React.ReactElement {
  const { assignmentId, studentId, subject } = route.params;
  const { can } = useAuth();
  const canEdit = can("mastery:create");
  const [{ data, fetching, error }] = useQuery({
    query: MASTERY_ASSIGNMENT_SHEET_QUERY,
    variables: { assignmentId, studentId },
    requestPolicy: "cache-and-network",
  });
  const [editState, edit] = useMutation(EDIT_MASTERY_ASSIGNMENT_SHEET);
  const fresh = editState.data?.editMasteryAssignmentSheet as MasteryAssignmentSheetData | undefined;
  const s = (fresh && fresh.studentId === studentId ? fresh : undefined) ?? (data?.masteryAssignmentSheet as MasteryAssignmentSheetData | undefined);
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
  const editable = canEdit && s.assignmentStatus === "DRAFT";
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
        </Card>
      ))}

      {editable && !adding ? <Button title={STR.msAsAddOwn} variant="secondary" onPress={() => setAdding(true)} /> : null}
      {editable && adding ? (
        <Card>
          <Select
            label={STR.msAsOutcome}
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
              {loChoice.questionTypeCodes.map((t) => (
                <Chip key={t} label={t} selected={qt === t} onPress={() => setQt(t)} />
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
