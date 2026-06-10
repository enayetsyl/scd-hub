/**
 * QuestionPreviewScreen (S5 / J2.3) — full question detail with the answer
 * carrier rendered per type (MCQ options, T/F, fill-blank, matching, short
 * answer, descriptive). Add-to-basket from here too.
 */
import React from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "urql";
import { QUESTION_QUERY } from "../../graphql/operations";
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
            <Body key={o.option_id ?? i} style={{ marginTop: 2 }}>
              {(o.option_id ? `${o.option_id}. ` : "") + (o.text ?? "")}
              {o.is_correct ? "  ✓" : ""}
            </Body>
          ))}
        </View>
      );
    case "true_false":
      return (
        <Body>
          {STR.answer}: {p.tf_answer === true ? "সত্য (True)" : "মিথ্যা (False)"}
        </Body>
      );
    case "fill_blank":
      return (
        <View>
          <Muted>{STR.answer}</Muted>
          {(p.blanks ?? []).map((b, i) => (
            <Body key={i} style={{ marginTop: 2 }}>
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
            <Body key={i} style={{ marginTop: 2 }}>
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
          {p.answer_key?.model_note ? <Muted style={{ marginTop: 2 }}>{p.answer_key.model_note}</Muted> : null}
        </View>
      );
    case "descriptive":
      return <Muted>[বর্ণনামূলক — রুব্রিক দেখুন]</Muted>;
    default:
      return null;
  }
}

export default function QuestionPreviewScreen({ route }: Props): React.ReactElement {
  const { id } = route.params;
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
    </Screen>
  );
}
