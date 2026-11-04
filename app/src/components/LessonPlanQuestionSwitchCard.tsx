/**
 * LessonPlanQuestionSwitchCard (D-#952) — the school switch "ক্লাস নোটে পাঠ পরিকল্পনার প্রশ্ন".
 * Owner ruling 2026-11-04: lesson-plan progress ships to production but the class note must not
 * change this year, so the question is OFF by default and the Principal turns it on (2027).
 * Shown only to `routine:settings` holders (the server refuses anyone else).
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "urql";
import { Card, Body, Muted, Button, Badge, Notice } from "./ui";
import { space } from "../theme/tokens";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import { useToast } from "../state/ToastContext";
import { LESSON_PLAN_QUESTION_SETTING_QUERY, SET_LESSON_PLAN_QUESTION_ON } from "../graphql/operations";

export default function LessonPlanQuestionSwitchCard(): React.ReactElement {
  const [q, refetch] = useQuery({ query: LESSON_PLAN_QUESTION_SETTING_QUERY, variables: {} });
  const [saveMut, save] = useMutation(SET_LESSON_PLAN_QUESTION_ON);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const on = q.data?.lessonPlanQuestionSetting.on ?? false;

  async function flip(): Promise<void> {
    setError(null);
    const res = await save({ on: !on });
    if (res.error) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(res.data?.setLessonPlanQuestionOn.on ? STR.lpQuestionSavedOn : STR.lpQuestionSavedOff, "ok");
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: space(2) }}>
        <Body style={{ fontWeight: "700", flexShrink: 1 }}>{STR.lpQuestionTitle}</Body>
        {q.data ? <Badge text={on ? STR.lpQuestionOn : STR.lpQuestionOff} tone={on ? "ok" : "muted"} /> : null}
      </View>
      <Muted style={{ marginTop: space(1) }}>{STR.lpQuestionHint}</Muted>
      {error || q.error ? (
        <View style={{ marginTop: space(2) }}>
          <Notice tone="danger" message={error ?? friendlyError(q.error!)} />
        </View>
      ) : null}
      {q.data ? (
        <View style={{ marginTop: space(2), alignItems: "flex-start" }}>
          <Button
            title={on ? STR.lpQuestionTurnOff : STR.lpQuestionTurnOn}
            variant={on ? "secondary" : "primary"}
            loading={saveMut.fetching}
            onPress={() => void flip()}
          />
        </View>
      ) : null}
    </Card>
  );
}
