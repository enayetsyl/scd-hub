/**
 * S9 ভুল জানান (docs/prd-book-lifecycle.md §8, §9.6): a teacher's report on a book of their class +
 * subject — edition, page, what the book says, what is wrong, category, an optional photo of the page.
 * A fixed note: do not write a student's name. Target: under one minute.
 */
import React, { useState } from "react";
import { useMutation } from "urql";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BOOK_FEEDBACK_CATEGORIES, BOOK_FEEDBACK_CATEGORY_BN, type BookFeedbackCategory } from "@scd/shared";
import { BL_TEACHER_REPORT } from "../../graphql/bookLifecycleRelease";
import { Body, Button, Card, Chip, ChipRow, Field, Notice, Screen } from "../../components/ui";
import { friendlyError } from "../../lib/errors";
import { pickBookLcFile, postBookLc, type BlAsset } from "../../lib/bookLcFiles";
import type { BookLcTeacherStackParamList } from "../../navigation/types";
import { space } from "../../theme";
import { BL } from "./blStrings";
import { useMsg } from "./blCommon";

type Props = NativeStackScreenProps<BookLcTeacherStackParamList, "BookLcReport">;

export default function BookLcReportScreen({ navigation, route }: Props): React.ReactElement {
  const { bookId, titleBn } = route.params;
  const [, send] = useMutation(BL_TEACHER_REPORT);
  const [edition, setEdition] = useState<"STUDENT" | "TEACHER">("STUDENT");
  const [page, setPage] = useState("");
  const [quote, setQuote] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState<BookFeedbackCategory>("spelling");
  const [photo, setPhoto] = useState<BlAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useMsg();
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      let photoFileIds: string[] | null = null;
      if (photo) photoFileIds = [(await postBookLc<{ fileId: string }>("report-photo", { bookId }, { file: photo })).fileId];
      const r = await send({ bookId, edition, page: page || null, quote: quote || null, textBn: text, category, photoFileIds });
      if (r.error) return setMsg({ tone: "danger", text: friendlyError(r.error) });
      navigation.goBack();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen scroll>
      <Card>
        <Body style={{ fontWeight: "700" }}>{titleBn}</Body>
        <Notice tone="warn" message={BL.noStudentNames} />
        <ChipRow>
          <Chip label={BL.studentEd} selected={edition === "STUDENT"} onPress={() => setEdition("STUDENT")} />
          <Chip label={BL.teacherEd} selected={edition === "TEACHER"} onPress={() => setEdition("TEACHER")} />
        </ChipRow>
        <Field label={BL.page} value={page} onChangeText={setPage} keyboardType="number-pad" />
        <Field label={BL.quote} value={quote} onChangeText={setQuote} multiline autoCapitalize="sentences" />
        <Field label={BL.whatWrong} value={text} onChangeText={setText} multiline autoCapitalize="sentences" />
        <ChipRow>
          {BOOK_FEEDBACK_CATEGORIES.filter((c) => c !== "instruction").map((c) => (
            <Chip key={c} label={BOOK_FEEDBACK_CATEGORY_BN[c]} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </ChipRow>
        <Button title={photo ? `${BL.picked}: ${photo.name}` : BL.addPhoto} variant="ghost" onPress={() => void pickBookLcFile("scan").then((a) => a && setPhoto(a))} />
        {msg}
        <Button title={BL.send} loading={busy} disabled={!text.trim()} onPress={() => void go()} style={{ marginTop: space(3) }} />
      </Card>
    </Screen>
  );
}
