/**
 * QuestionPreviewScreen (S5 / J2.3) — full question detail with the answer
 * carrier rendered per type (MCQ options, T/F, fill-blank, matching, short
 * answer, descriptive). Add-to-basket from here too.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { QUESTION_QUERY, SET_QUESTION_IMPORTANT, RESTORE_QUESTION } from "../../graphql/operations";
import { QuestionEditSheet } from "../../components/QuestionEditSheet";
import { useAuth } from "../../auth/AuthContext";
import type { QuestionsStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  ChipRow,
  Loader,
  ErrorBanner,
  Notice,
  Divider,
} from "../../components/ui";
import {
  STR,
  subjectLabel,
  classLevelLabel,
  difficultyLabel,
  paperRoleLabel,
  curationTagLabel,
  reviewStatusLabel,
  bnNum,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useBasket } from "../../state/BasketContext";
import { parsePayload, prettyCode, type QuestionPayload } from "../../lib/question";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<QuestionsStackParamList, "QuestionPreview">;

function AnswerCarrier({ p }: { p: QuestionPayload }): React.ReactElement | null {
  switch (p.question_type) {
    case "mcq":
      return (
        <View>
          <Muted>{STR.options}</Muted>
          {(p.options ?? []).map((o, i) => (
            <Body key={o.option_id ?? i} style={{ marginTop: 4 }}>
              {(o.option_id ? `${o.option_id}. ` : "") + (o.text ?? "")}
              {o.is_correct ? "  ✓" : ""}
            </Body>
          ))}
        </View>
      );
    case "true_false":
      return (
        <Body>
          {STR.answer}: {p.tf_answer === true ? STR.true : STR.false}
        </Body>
      );
    case "fill_blank":
      return (
        <View>
          <Muted>{STR.answer}</Muted>
          {(p.blanks ?? []).map((b, i) => (
            <Body key={i} style={{ marginTop: 4 }}>
              {bnNum(String(b.blank_no ?? i + 1))}: {(b.accepted ?? []).join(" / ")}
            </Body>
          ))}
        </View>
      );
    case "matching":
      return (
        <View>
          <Muted>{STR.answer}</Muted>
          {(p.pairs ?? []).map((pair, i) => (
            <Body key={i} style={{ marginTop: 4 }}>
              {pair.left ?? ""} → {pair.right ?? ""}
            </Body>
          ))}
        </View>
      );
    case "short_answer":
      return (
        <View>
          <Body>
            {STR.answer}: {(p.answer_key?.accepted ?? []).join(" / ")}
          </Body>
          {p.answer_key?.model_note ? <Muted style={{ marginTop: 4 }}>{p.answer_key.model_note}</Muted> : null}
        </View>
      );
    case "descriptive":
      return <Muted>{STR.descriptiveSeeRubric}</Muted>;
    default:
      return null;
  }
}

export default function QuestionPreviewScreen({ route }: Props): React.ReactElement {
  const { id } = route.params;
  const { can } = useAuth();
  const mayManage = can("question:manage");
  const [editing, setEditing] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [, setImportant] = useMutation(SET_QUESTION_IMPORTANT);
  const [, restore] = useMutation(RESTORE_QUESTION);
  const [notice, setNotice] = useState<string | null>(null);
  const basket = useBasket();
  const [{ data, fetching, error }, refetch] = useQuery({ query: QUESTION_QUERY, variables: { id } });

  if (fetching) return <Loader label={STR.loading} />;
  if (error) {
    return (
      <Screen>
        <ErrorBanner message={friendlyError(error)} onRetry={() => refetch({ requestPolicy: "network-only" })} />
      </Screen>
    );
  }
  const q = data?.question;
  if (!q) {
    return (
      <Screen>
        <Notice message={STR.empty} tone="warn" />
      </Screen>
    );
  }

  const p = parsePayload(q.payloadJson);
  const inBasket = basket.has(q.id);
  const text = p.question_text ?? "";

  return (
    <Screen scroll>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Muted style={{ fontWeight: "700" }}>{q.qid ?? q.id.slice(-6)}</Muted>
        <Badge text={`${bnNum(q.marks ?? 0)} ${STR.marks}`} tone="brand" />
        {/* The IMPORTANT mark (QR-9, D-#550) — visible to EVERY caller who can open the
            question, teachers included, because it is a signal for whoever assembles a set. */}
        {q.important ? (
          <View style={{ marginLeft: space(2) }}>
            <Badge text={STR.qImportant} tone="gold" />
          </View>
        ) : null}
      </View>

      <H2>{text || "—"}</H2>

      <ChipRow>
        <Badge text={subjectLabel(q.subject)} tone="muted" />
        <View style={{ marginLeft: space(2) }}>
          <Badge text={classLevelLabel(q.classLevel)} tone="muted" />
        </View>
        {q.questionType ? (
          <View style={{ marginLeft: space(2) }}>
            <Badge text={prettyCode(q.questionType)} tone="muted" />
          </View>
        ) : null}
      </ChipRow>

      <Card>
        <AnswerCarrier p={p} />
      </Card>

      <Divider />

      <Card>
        <Muted>{STR.paperRole}: {paperRoleLabel(q.paperRole)}</Muted>
        <Muted>{STR.difficulty}: {difficultyLabel(q.difficulty)}</Muted>
        <Muted>{STR.bloom}: {q.bloomLevel ?? "—"}</Muted>
        <Muted>{STR.curationTag}: {curationTagLabel(q.curationTag)}</Muted>
        <Muted>{STR.reviewStatus}: {reviewStatusLabel(q.reviewStatus)}</Muted>
      </Card>

      {/* A RETIRED question offers no basket (D-#566). The server refuses it now —
          assertPublished checks `retiredAt` as well — but a button that exists only to fail
          is worse than no button: it says the question is still usable, directly under a
          notice saying it is not. */}
      {q.retired ? null : (
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
                  questionType: q.questionType,
                  classLevel: q.classLevel,
                })
          }
        />
      )}

      {/* Correct or retire the question in place (QR-8, D-#548) — Principal + Office. The
          bank is where a wrong answer is usually spotted, so the fix belongs here too, not
          only on the review screens. */}
      {mayManage ? (
        editing ? (
          <QuestionEditSheet
            artifactId={q.id}
            payload={p}
            isPublished={q.reviewStatus === "gold"}
            onDone={(message) => {
              setEditing(false);
              setNotice(message);
              refetch({ requestPolicy: "network-only" });
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <View style={{ marginTop: space(3) }}>
            {/* A RETIRED question is a different object to act on (D-#558). Editing or
                marking one is meaningless while it is out of the bank, so the only offer
                here is the way back — which is what made retire a one-way door until now. */}
            {q.retired ? (
              <View>
                <Notice tone="warn" message={STR.qeRetiredNotice} />
                <View style={{ marginTop: space(2) }}>
                  <Button
                    title={STR.qeRestore}
                    loading={markBusy}
                    onPress={() => {
                      setMarkBusy(true);
                      void restore({ artifactId: q.id }).then((res) => {
                        setMarkBusy(false);
                        if (res.error) { setNotice(friendlyError(res.error)); return; }
                        setNotice(STR.qeRestored);
                        refetch({ requestPolicy: "network-only" });
                      });
                    }}
                  />
                </View>
              </View>
            ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            <Button title={STR.qeEdit} variant="secondary" onPress={() => setEditing(true)} />
            {/* Office and the Principal mark from the bank at ANY time (QR-9, D-#550) — not
                only while a review round is open, which is the reviewer’s path. */}
            <Button
              title={q.important ? STR.qUnmarkImportant : STR.qMarkImportant}
              variant="secondary"
              loading={markBusy}
              onPress={() => {
                setMarkBusy(true);
                void setImportant({ artifactId: q.id, important: !q.important }).then((res) => {
                  setMarkBusy(false);
                  if (res.error) { setNotice(friendlyError(res.error)); return; }
                  setNotice(q.important ? STR.qImportantCleared : STR.qImportantMarked);
                  refetch({ requestPolicy: "network-only" });
                });
              }}
            />
            </View>
            )}
          </View>
        )
      ) : null}
      {notice ? <Notice tone="ok" message={notice} /> : null}
    </Screen>
  );
}
