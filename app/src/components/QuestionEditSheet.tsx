/**
 * QuestionEditSheet (QR-8, D-#548) — the in-place correction form, shared by every screen
 * that shows a question to somebody holding `question:manage`.
 *
 * One component rather than a form per screen, because the rules it enforces (exactly one
 * correct option, no empty text, positive marks) have to match the server's refusals, and
 * three copies would drift. The server is still the authority — this only saves a round trip
 * on the obvious mistakes.
 *
 * It sends ONLY the fields it touched. A patch is not a replace: everything the form does
 * not render (qid, topic tags, paper role, bloom level) has to survive untouched, and the
 * safest way to guarantee that is never to send it.
 */
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation } from "urql";
import {
  UPDATE_QUESTION_CONTENT,
  RETIRE_QUESTION,
  type QuestionOptionInputT,
} from "../graphql/operations";
import { Body, Muted, Card, Button, Field, Chip, ChipRow, Notice, Divider } from "./ui";
import { STR } from "../lib/labels";
import { friendlyError } from "../lib/errors";
import type { QuestionPayload } from "../lib/question";
import { space } from "../theme/tokens";

export interface QuestionEditSheetProps {
  artifactId: string;
  payload: QuestionPayload;
  /** True when the question is already on the published shelf — changes the warning. */
  isPublished: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}

interface OptionDraft {
  optionId: string | null;
  text: string;
  isCorrect: boolean;
}

/** Accepted answers are edited as one comma-separated line — the way they read on paper. */
function splitAccepted(v: string): string[] {
  return v
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function QuestionEditSheet({
  artifactId,
  payload,
  isPublished,
  onDone,
  onCancel,
}: QuestionEditSheetProps): React.ReactElement {
  const type = payload.question_type ?? "";

  const [questionText, setQuestionText] = useState(payload.question_text ?? "");
  const [marks, setMarks] = useState(payload.marks != null ? String(payload.marks) : "");
  const [options, setOptions] = useState<OptionDraft[]>(
    (payload.options ?? []).map((o) => ({
      optionId: o.option_id ?? null,
      text: o.text ?? "",
      isCorrect: o.is_correct === true,
    })),
  );
  const [tfAnswer, setTfAnswer] = useState<boolean>(payload.tf_answer === true);
  const [accepted, setAccepted] = useState((payload.answer_key?.accepted ?? []).join(", "));
  const [modelNote, setModelNote] = useState(payload.answer_key?.model_note ?? "");

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");

  const [, updateQuestion] = useMutation(UPDATE_QUESTION_CONTENT);
  const [, retire] = useMutation(RETIRE_QUESTION);

  function setOption(i: number, patch: Partial<OptionDraft>): void {
    setOptions((prev) => prev.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }

  /** Exactly one correct, always — ticking a new one unticks the rest. */
  function markCorrect(i: number): void {
    setOptions((prev) => prev.map((o, j) => ({ ...o, isCorrect: j === i })));
  }

  async function save(): Promise<void> {
    setFailure(null);

    const vars: Record<string, unknown> = { artifactId };
    if (questionText.trim() !== (payload.question_text ?? "").trim()) {
      vars.questionText = questionText;
    }
    const marksNum = marks.trim() === "" ? null : Number(marks);
    if (marksNum != null && marksNum !== payload.marks) {
      if (!Number.isFinite(marksNum) || marksNum <= 0) {
        setFailure(STR.qeMarks);
        return;
      }
      vars.marks = marksNum;
    }
    if (type === "mcq" && options.length > 0) {
      if (options.filter((o) => o.isCorrect).length !== 1) {
        setFailure(STR.qeCorrect);
        return;
      }
      vars.options = options.map<QuestionOptionInputT>((o) => ({
        optionId: o.optionId,
        text: o.text,
        isCorrect: o.isCorrect,
      }));
    }
    if (type === "true_false" && tfAnswer !== (payload.tf_answer === true)) {
      vars.tfAnswer = tfAnswer;
    }
    if (type !== "mcq" && type !== "true_false") {
      const next = splitAccepted(accepted);
      if (next.join("|") !== (payload.answer_key?.accepted ?? []).join("|")) {
        vars.answerAccepted = next;
      }
      if (modelNote.trim() !== (payload.answer_key?.model_note ?? "").trim()) {
        vars.modelNote = modelNote;
      }
    }

    setBusy(true);
    const res = await updateQuestion(vars as never);
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    const changed = res.data?.updateQuestionContent.changedFields ?? [];
    onDone(changed.length === 0 ? STR.qeNoChange : STR.qeSaved);
  }

  async function doDelete(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const reason = deleteReason.trim();
    const res = await retire({ artifactId, reason: reason === "" ? null : reason });
    setBusy(false);
    if (res.error) {
      setFailure(friendlyError(res.error));
      return;
    }
    onDone(STR.qeDeleted);
  }

  if (confirmDelete) {
    return (
      <Card style={{ marginTop: space(2) }}>
        <Body style={{ fontWeight: "700" }}>{STR.qeDeleteTitle}</Body>
        <Muted style={{ marginTop: space(1) }}>{STR.qeDeleteHint}</Muted>
        <Field label={STR.qeDeleteReason} value={deleteReason} onChangeText={setDeleteReason} multiline />
        {failure ? <Notice tone="danger" message={failure} /> : null}
        <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
          <Button title={STR.qeDelete} variant="danger" loading={busy} onPress={() => void doDelete()} />
          <Button title={STR.cancel} variant="ghost" onPress={() => setConfirmDelete(false)} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ marginTop: space(2) }}>
      <Body style={{ fontWeight: "700" }}>{STR.qeEditTitle}</Body>
      {/* Both warnings are about consequences the editor cannot see from this screen. */}
      {isPublished ? <Notice tone="warn" message={STR.qeGoldWarn} /> : null}
      <Muted style={{ marginTop: space(1) }}>{STR.qeReimportWarn}</Muted>

      <Field label={STR.qeQuestionText} value={questionText} onChangeText={setQuestionText} multiline />
      <Field label={STR.qeMarks} value={marks} onChangeText={setMarks} keyboardType="numeric" />

      {type === "mcq" && options.length > 0 ? (
        <View style={{ marginTop: space(2) }}>
          <Muted>{STR.qeOptions}</Muted>
          {options.map((o, i) => (
            <View key={o.optionId ?? i} style={{ marginTop: space(2) }}>
              <Field
                label={`${o.optionId ?? i + 1}`}
                value={o.text}
                onChangeText={(v) => setOption(i, { text: v })}
              />
              <ChipRow>
                <Chip label={STR.qeCorrect} selected={o.isCorrect} onPress={() => markCorrect(i)} />
              </ChipRow>
            </View>
          ))}
        </View>
      ) : null}

      {type === "true_false" ? (
        <View style={{ marginTop: space(2) }}>
          <Muted>{STR.qeTfAnswer}</Muted>
          <ChipRow>
            <Chip label={STR.qeTrue} selected={tfAnswer} onPress={() => setTfAnswer(true)} />
            <Chip label={STR.qeFalse} selected={!tfAnswer} onPress={() => setTfAnswer(false)} />
          </ChipRow>
        </View>
      ) : null}

      {type !== "mcq" && type !== "true_false" ? (
        <View>
          <Field label={STR.qeAnswer} value={accepted} onChangeText={setAccepted} multiline />
          <Muted>{STR.qeAnswerHint}</Muted>
          <Field label={STR.qeModelNote} value={modelNote} onChangeText={setModelNote} multiline />
        </View>
      ) : null}

      {failure ? <Notice tone="danger" message={failure} /> : null}

      <Divider />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button title={STR.qeSave} loading={busy} onPress={() => void save()} />
        <Button title={STR.cancel} variant="ghost" onPress={onCancel} />
        <Button title={STR.qeDelete} variant="danger" onPress={() => setConfirmDelete(true)} />
      </View>
    </Card>
  );
}
