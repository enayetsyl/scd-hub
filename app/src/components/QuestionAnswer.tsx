/**
 * AnswerCarrier — renders a question's answer by type (teacher-facing). Shared by the
 * Set-detail question list and the Question-bank inline preview so both read the same.
 * MCQ options always show (they're part of the question); the ✓ marks the correct one.
 */
import React from "react";
import { View } from "react-native";
import { Body, Muted } from "./ui";
import { STR, bnNum } from "../lib/labels";
import type { QuestionPayload } from "../lib/question";

export function AnswerCarrier({
  payload,
  correctColor,
}: {
  payload: QuestionPayload;
  correctColor: string;
}): React.ReactElement | null {
  const type = payload.question_type ?? "";

  if (type === "mcq") {
    return (
      <View>
        {(payload.options ?? []).map((o, i) => (
          <Body
            key={o.option_id ?? i}
            style={{ color: o.is_correct ? correctColor : undefined, fontWeight: o.is_correct ? "700" : "400" }}
          >
            {"    "}{o.option_id ? `${o.option_id}. ` : ""}{o.text ?? ""}{o.is_correct ? "  ✓" : ""}
          </Body>
        ))}
      </View>
    );
  }
  if (type === "true_false") {
    const ans = payload.tf_answer === true ? "সত্য (True)" : "মিথ্যা (False)";
    return <Muted>{STR.answerLabel}: {ans}</Muted>;
  }
  if (type === "fill_blank") {
    return (
      <View>
        {(payload.blanks ?? []).map((b, i) => (
          <Muted key={b.blank_no ?? i}>
            {STR.answerLabel} {bnNum(Number(b.blank_no ?? i + 1))}: {(b.accepted ?? []).join(" / ")}
          </Muted>
        ))}
      </View>
    );
  }
  if (type === "matching") {
    return (
      <View>
        {(payload.pairs ?? []).map((p, i) => (
          <Muted key={i}>{p.left ?? ""}  →  {p.right ?? ""}</Muted>
        ))}
      </View>
    );
  }
  if (type === "short_answer") {
    const ak = payload.answer_key ?? {};
    return (
      <View>
        <Muted>{STR.answerLabel}: {(ak.accepted ?? []).join(" / ")}</Muted>
        {ak.model_note ? <Muted>{ak.model_note}</Muted> : null}
      </View>
    );
  }
  if (type === "descriptive") {
    // A descriptive item carries a model_answer, a rubric, or both (D-#528). The rubric
    // itself has no renderer yet, so a rubric-only item still shows the pointer label.
    const ma = payload.model_answer ?? {};
    const keyPoints = ma.key_points ?? [];
    if (!ma.text && keyPoints.length === 0) {
      return <Muted>{STR.descriptiveSeeRubric}</Muted>;
    }
    return (
      <View>
        {ma.text ? <Muted>{STR.modelAnswerLabel}: {ma.text}</Muted> : null}
        {keyPoints.length ? (
          <View>
            <Muted>{STR.keyPointsLabel}:</Muted>
            {keyPoints.map((p, i) => (
              <Muted key={i}>{"    • "}{p}</Muted>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  return null;
}
