/**
 * QuestionBankScreen (S4 / J2.2, J2.4) — filter questions by any combination of
 * subject / classLevel / questionType / paperRole / difficulty / bloom / marks
 * range. Each row shows qid + truncated question_text + tag chips, with an
 * add-to-basket toggle (basket count badges the tab). Scope is enforced
 * server-side so a supervisor sees banks beyond their teaching classes.
 */
import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import {
  SUBJECTS,
  CLASS_LEVELS,
  QUESTION_TYPES,
  PAPER_ROLES,
  DIFFICULTIES,
  BLOOM_LEVELS,
} from "@scd/shared";
import { QUESTIONS_QUERY, ADD_QUESTION_TO_SET } from "../../graphql/operations";
import type { QuestionsStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Chip,
  ChipRow,
  Badge,
  Button,
  Field,
  Loader,
  EmptyState,
  ErrorBanner,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  difficultyLabel,
  paperRoleLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useBasket } from "../../state/BasketContext";
import { questionText, truncate, prettyCode, parsePayload } from "../../lib/question";
import { AnswerCarrier } from "../../components/QuestionAnswer";
import { space } from "../../theme/tokens";
import { useColors } from "../../theme";

type Props = NativeStackScreenProps<QuestionsStackParamList, "QuestionBank">;

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && !Number.isNaN(n) ? n : null;
}

export default function QuestionBankScreen({ navigation, route }: Props): React.ReactElement {
  const basket = useBasket();
  // Add-to-set mode: rows push straight into the given draft set (addQuestionToSet)
  // rather than the basket. `addedIds` tracks what this session already added so the
  // row flips to "Added" (server dedupes too). See SetDetail's "Add questions".
  const addToSetId = route.params?.addToSetId;
  const [, addToSetMut] = useMutation(ADD_QUESTION_TO_SET);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Inline preview: details (full text + answer) show by DEFAULT; "Hide" collapses a
  // card. We track the collapsed set so the default (nothing collapsed) is fully open.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const colors = useColors();

  function toggleCollapse(id: string): void {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Clear the add-mode param when leaving the screen so a later drawer visit to
  // Questions opens the normal basket mode (route params otherwise persist, incl. in
  // the restored web nav state).
  React.useEffect(() => {
    const unsub = navigation.addListener("blur", () => {
      if (route.params?.addToSetId) navigation.setParams({ addToSetId: undefined });
    });
    return unsub;
  }, [navigation, route.params?.addToSetId]);

  async function onAddToSet(artifactId: string): Promise<void> {
    if (!addToSetId || addedIds.has(artifactId)) return;
    const res = await addToSetMut({ setId: addToSetId, artifactId });
    if (!res.error) setAddedIds((prev) => new Set(prev).add(artifactId));
  }

  const [subject, setSubject] = useState<string | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [questionType, setQuestionType] = useState<string | null>(null);
  const [paperRole, setPaperRole] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [bloomLevel, setBloomLevel] = useState<string | null>(null);
  const [marksMin, setMarksMin] = useState("");
  const [marksMax, setMarksMax] = useState("");

  const [{ data, fetching, error }, refetch] = useQuery({
    query: QUESTIONS_QUERY,
    variables: {
      subject,
      classLevel,
      questionType,
      paperRole,
      difficulty,
      bloomLevel,
      marksMin: num(marksMin),
      marksMax: num(marksMax),
    },
  });

  const questions = data?.questions ?? [];

  function toggle<T>(current: T | null, value: T, set: (v: T | null) => void): void {
    set(current === value ? null : value);
  }

  return (
    <Screen padded={false} bleed>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {/* Add-to-set banner, or the basket summary in normal browse mode */}
        {addToSetId ? (
          <Card>
            <Muted>{STR.addingToSet}</Muted>
          </Card>
        ) : (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Muted>
                {STR.basket}: {bnNum(basket.count)} · {STR.totalMarks} {bnNum(basket.totalMarks)}
              </Muted>
              <Button title={STR.basket} variant="ghost" onPress={() => navigation.navigate("Basket")} />
            </View>
          </Card>
        )}

        {/* Filters */}
        <Muted>{STR.subject}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={subject === null} onPress={() => setSubject(null)} />
          {SUBJECTS.map((s) => (
            <Chip key={s} label={subjectLabel(s)} selected={subject === s} onPress={() => toggle(subject, s, setSubject)} />
          ))}
        </ChipRow>

        <Muted>{STR.classLevel}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={classLevel === null} onPress={() => setClassLevel(null)} />
          {CLASS_LEVELS.map((c) => (
            <Chip key={c} label={bnNum(c)} selected={classLevel === c} onPress={() => toggle(classLevel, c, setClassLevel)} />
          ))}
        </ChipRow>

        <Muted>{STR.questionType}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={questionType === null} onPress={() => setQuestionType(null)} />
          {QUESTION_TYPES.map((q) => (
            <Chip key={q} label={prettyCode(q)} selected={questionType === q} onPress={() => toggle(questionType, q, setQuestionType)} />
          ))}
        </ChipRow>

        <Muted>{STR.paperRole}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={paperRole === null} onPress={() => setPaperRole(null)} />
          {PAPER_ROLES.map((p) => (
            <Chip key={p} label={paperRoleLabel(p)} selected={paperRole === p} onPress={() => toggle(paperRole, p, setPaperRole)} />
          ))}
        </ChipRow>

        <Muted>{STR.difficulty}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={difficulty === null} onPress={() => setDifficulty(null)} />
          {DIFFICULTIES.map((d) => (
            <Chip key={d} label={difficultyLabel(d)} selected={difficulty === d} onPress={() => toggle(difficulty, d, setDifficulty)} />
          ))}
        </ChipRow>

        <Muted>{STR.bloom}</Muted>
        <ChipRow>
          <Chip label={STR.all} selected={bloomLevel === null} onPress={() => setBloomLevel(null)} />
          {BLOOM_LEVELS.map((b) => (
            <Chip key={b} label={b} selected={bloomLevel === b} onPress={() => toggle(bloomLevel, b, setBloomLevel)} />
          ))}
        </ChipRow>

        <View style={{ flexDirection: "row", gap: space(3) }}>
          <View style={{ flex: 1 }}>
            <Field label={STR.marksMin} value={marksMin} onChangeText={setMarksMin} keyboardType="numeric" placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={STR.marksMax} value={marksMax} onChangeText={setMarksMax} keyboardType="numeric" placeholder="100" />
          </View>
        </View>

        {error ? <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} /> : null}

        {fetching ? (
          <Loader label={STR.loading} />
        ) : questions.length === 0 ? (
          <EmptyState message={STR.empty} />
        ) : (
          questions.map((q) => {
            const inBasket = basket.has(q.id);
            const text = questionText(q.payloadJson);
            const expanded = !collapsedIds.has(q.id);
            return (
              <Card key={q.id}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                  <Muted style={{ fontWeight: "700" }}>{q.qid ?? q.id.slice(-6)}</Muted>
                  <Badge text={`${bnNum(q.marks ?? 0)} ${STR.marks}`} tone="brand" />
                </View>
                <Body style={{ marginTop: 4 }}>{text ? (expanded ? text : truncate(text)) : "—"}</Body>
                <ChipRow>
                  {q.questionType ? <Badge text={prettyCode(q.questionType)} tone="muted" /> : null}
                  {q.paperRole ? <View style={{ marginLeft: space(2) }}><Badge text={paperRoleLabel(q.paperRole)} tone="muted" /></View> : null}
                  {q.difficulty ? <View style={{ marginLeft: space(2) }}><Badge text={difficultyLabel(q.difficulty)} tone="muted" /></View> : null}
                  {q.bloomLevel ? <View style={{ marginLeft: space(2) }}><Badge text={q.bloomLevel} tone="muted" /></View> : null}
                </ChipRow>

                {/* Inline details — full text is already shown above when expanded; here
                    we add the answer carrier (options with the correct one marked, etc.). */}
                {expanded ? (
                  <View style={{ marginTop: space(2) }}>
                    <AnswerCarrier payload={parsePayload(q.payloadJson)} correctColor={colors.primary} />
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={expanded ? STR.hideDetails : STR.details}
                      variant="ghost"
                      onPress={() => toggleCollapse(q.id)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    {addToSetId ? (
                      <Button
                        title={addedIds.has(q.id) ? STR.addedToSet : STR.addToSet}
                        variant={addedIds.has(q.id) ? "secondary" : "primary"}
                        disabled={addedIds.has(q.id)}
                        onPress={() => void onAddToSet(q.id)}
                      />
                    ) : (
                      <Button
                        title={inBasket ? STR.inBasket : STR.addToBasket}
                        variant={inBasket ? "secondary" : "primary"}
                        onPress={() =>
                          inBasket
                            ? basket.remove(q.id)
                            : basket.add({
                                artifactId: q.id,
                                qid: q.qid ?? q.id,
                                marks: q.marks ?? 0,
                                label: text || q.qid || q.id,
                                subject: q.subject,
                                classLevel: q.classLevel,
                              })
                        }
                      />
                    )}
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
