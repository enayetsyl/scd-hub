/**
 * MasteryMarksScreen (M-0, mock A2) — what each question type is worth in one
 * class × subject (D-#777). Seeded from the book's mark distribution by import; the
 * Principal edits it here. Every item copies the marks when it is created, so a change
 * never rewrites past work — the history line under each row says what it used to be.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { MASTERY_CATALOGUE_QUERY, SAVE_MASTERY_QUESTION_TYPE, type MasteryQuestionTypeRow } from "../../graphql/mastery";
import { Screen, Card, Body, Muted, Badge, Button, Field, Loader, EmptyState, Notice, H2 } from "../../components/ui";
import { STR, bnNum, hwSubjectLabel, masteryClassLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
import { space } from "../../theme";
import type { MasteryStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<MasteryStackParamList, "MasteryMarks">;

const parseMarks = (s: string): number | null | undefined => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))));
  return Number.isFinite(n) && n >= 0 && Math.round(n * 2) === n * 2 ? n : undefined;
};

export default function MasteryMarksScreen({ route }: Props): React.ReactElement {
  const { classToken, subject } = route.params;
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("mastery:settings");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState("QT-");
  const [newLabel, setNewLabel] = useState("");
  const [newMarks, setNewMarks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [{ data, fetching, error: qErr }, refetch] = useQuery({ query: MASTERY_CATALOGUE_QUERY, variables: { classToken, subject } });
  const [save, saveQt] = useMutation(SAVE_MASTERY_QUESTION_TYPE);
  const qts = (data?.masteryCatalogue?.questionTypes ?? []) as MasteryQuestionTypeRow[];

  async function onSave(q: { code: string; labelBn: string; answerForm?: string | null }, marksText: string): Promise<boolean> {
    setError(null);
    const marks = parseMarks(marksText);
    if (marks === undefined) {
      setError(STR.msMarksNote);
      return false;
    }
    const res = await saveQt({ classToken, subject, code: q.code, labelBn: q.labelBn, marks, answerForm: q.answerForm ?? undefined });
    if (res.error) {
      setError(friendlyError(res.error));
      return false;
    }
    toast.show(STR.msSaved);
    setDrafts((d) => {
      const n = { ...d };
      delete n[q.code];
      return n;
    });
    refetch({ requestPolicy: "network-only" });
    return true;
  }

  return (
    <Screen scroll>
      <H2>
        {masteryClassLabel(classToken)} · {hwSubjectLabel(subject)} — {STR.msMarks}
      </H2>
      <Notice message={STR.msMarksNote} tone="info" />
      {qErr ? <Notice message={friendlyError(qErr)} tone="danger" /> : null}
      {error ? <Notice message={error} tone="danger" /> : null}
      {fetching && qts.length === 0 ? <Loader /> : null}
      {!fetching && qts.length === 0 ? <EmptyState message={STR.msNoCoverage} /> : null}

      {qts.map((q) => {
        const draft = drafts[q.code];
        const shown = draft ?? (q.marks === null ? "" : String(q.marks));
        const dirty = draft !== undefined && draft !== (q.marks === null ? "" : String(q.marks));
        const earlier = q.history.slice(0, -1).map((h) => bnNum(h.marks));
        return (
          <Card key={q.code}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space(2), flexWrap: "wrap" }}>
              <Body style={{ fontWeight: "700", flexShrink: 1 }}>{q.labelBn}</Body>
              <Badge text={q.marks === null ? STR.msNoMarks : `${bnNum(q.marks)}`} tone={q.marks === null ? "muted" : "brand"} />
            </View>
            <Muted>
              {q.code}
              {q.answerForm ? ` · ${STR.msAnswerForm}: ${q.answerForm}` : ""}
            </Muted>
            {q.notes ? <Muted>{q.notes}</Muted> : null}
            {earlier.length > 0 ? (
              <Muted>
                {STR.msMarksHistory}: {earlier.join(" → ")}
              </Muted>
            ) : null}
            {canManage ? (
              <View style={{ flexDirection: "row", gap: space(2), alignItems: "flex-end", flexWrap: "wrap" }}>
                <View style={{ minWidth: 120 }}>
                  <Field
                    label={STR.msMarksEach}
                    value={shown}
                    onChangeText={(t) => setDrafts((d) => ({ ...d, [q.code]: t }))}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Button title={STR.msSave} onPress={() => void onSave(q, shown)} disabled={!dirty} loading={save.fetching} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {canManage ? (
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.msAddQt}</Body>
          <Field label={STR.msQtCode} value={newCode} onChangeText={(t) => setNewCode(t.toUpperCase())} autoCapitalize="characters" />
          <Field label={STR.msQtLabel} value={newLabel} onChangeText={setNewLabel} />
          <Field label={STR.msMarksEach} value={newMarks} onChangeText={setNewMarks} keyboardType="decimal-pad" />
          <Button
            title={STR.msAddQt}
            onPress={() =>
              void onSave({ code: newCode.trim(), labelBn: newLabel.trim() }, newMarks).then((ok) => {
                if (!ok) return;
                setNewCode("QT-");
                setNewLabel("");
                setNewMarks("");
              })
            }
            disabled={!/^QT-[A-Z0-9]/.test(newCode.trim()) || !newLabel.trim()}
            loading={save.fetching}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
