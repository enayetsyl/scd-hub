/**
 * SyllabusClassNoteScreen (SY-2 §5.5) — the per-CLASS question-type footer.
 *
 * The source sheet closes each class's table with ONE line naming the question
 * types that class will face ("পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর …",
 * with Class 3 adding সৃজনশীল). It is a CLASS fact covering all eight of that
 * class's subjects at once, which is why it is edited here rather than on each
 * subject — eight copies of one sentence is eight chances to disagree.
 *
 * No approval chain: this states exam FORMAT, not what a teacher must cover, so
 * it stays editable after the class's first subject has gone for sign-off.
 */
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { EXAM_SYLLABUS_CLASS, SAVE_EXAM_CLASS_NOTE } from "../../graphql/examSyllabus";
import type { SyllabusStackParamList } from "../../navigation/types";
import {
  Screen,
  Body,
  Muted,
  Card,
  Field,
  Button,
  ChipRow,
  Chip,
  Notice,
  ErrorBanner,
} from "../../components/ui";
import { STR, syllabusItemTypeLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space, typeScale } from "../../theme/tokens";
import { SYLLABUS_ITEM_TYPES } from "@scd/shared";

type Props = NativeStackScreenProps<SyllabusStackParamList, "SyllabusClassNote">;

export default function SyllabusClassNoteScreen({ route, navigation }: Props): React.ReactElement {
  const { examId, classId } = route.params;

  const [classQ] = useQuery({ query: EXAM_SYLLABUS_CLASS, variables: { examId, classId } });
  const view = classQ.data?.examSyllabusClass ?? null;

  const [types, setTypes] = useState<string[]>([]);
  const [noteMd, setNoteMd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate once the server row arrives. Keyed on classId so moving between
  // classes reloads rather than carrying the previous class's sentence over.
  useEffect(() => {
    if (!view) return;
    setTypes(view.questionTypes);
    setNoteMd(view.noteMd);
  }, [view?.classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [, save] = useMutation(SAVE_EXAM_CLASS_NOTE);

  async function onSave(): Promise<void> {
    setErr(null);
    const res = await save({ examId, classId, questionTypes: types, noteMd });
    if (res.error) {
      setErr(friendlyError(res.error));
      return;
    }
    setSaved(true);
    navigation.goBack();
  }

  return (
    <Screen scroll>
      {err ? <ErrorBanner message={err} /> : null}
      {saved ? <Notice message={STR.sySaved} tone="ok" /> : null}

      <Card>
        <Body style={typeScale.bodyStrong}>{view?.classLabel ?? ""}</Body>
        <Muted>{STR.syClassNote}</Muted>
      </Card>

      <Card>
        <Body style={{ ...typeScale.bodyStrong, marginBottom: space(2) }}>
          {STR.syQuestionTypes}
        </Body>
        <ChipRow>
          {SYLLABUS_ITEM_TYPES.map((qt) => (
            <Chip
              key={qt}
              label={syllabusItemTypeLabel(qt)}
              selected={types.includes(qt)}
              onPress={() => {
                setTypes((prev) =>
                  prev.includes(qt) ? prev.filter((x) => x !== qt) : [...prev, qt],
                );
                setSaved(false);
              }}
            />
          ))}
        </ChipRow>
      </Card>

      <Card>
        <Field
          label={STR.syClassNote}
          value={noteMd}
          onChangeText={(v) => {
            setNoteMd(v);
            setSaved(false);
          }}
          multiline
          placeholder="পরীক্ষায় ক্লাস অনুযায়ী বহুনির্বাচনী প্রশ্ন-উত্তর, শূন্যস্থান পূরণ, সত্য-মিথ্যা নির্ণয়, মিলকরণ, ছোট প্রশ্ন, বড় প্রশ্ন ইত্যাদি থাকবে, ইন শা আল্লাহ।"
        />
      </Card>

      <View style={{ marginTop: space(3) }}>
        <Button title={STR.sySave} onPress={onSave} />
      </View>
    </Screen>
  );
}
