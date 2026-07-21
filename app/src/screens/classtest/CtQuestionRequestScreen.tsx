/**
 * CtQuestionRequestScreen (owner ask 2026-07-20) — a subject teacher asks the
 * OFFICE to produce a class-test question paper. Class/section, subject, chapter,
 * marks, duration and exam date are ALL mandatory; the test number auto-increments
 * server-side. The request lands on the office queue; the review loop and the
 * final print send live on MyCtQuestionsScreen.
 */
import React, { useState } from "react";
import { ScrollView } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import { CREATE_CT_QUESTION_REQUEST } from "../../graphql/classTest";
import { ACADEMIC_YEARS_QUERY } from "../../graphql/operations";
import { Screen, Card, Body, Muted, Button, Field, Select } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { STR, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";
import type { ClassTestStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ClassTestStackParamList>;

export default function CtQuestionRequestScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const toast = useToast();
  // The current academic year — never asked (the RequestClassTest precedent).
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });
  const years = yearsQ.data?.academicYears ?? [];
  const yearId = (years.find((y) => y.current) ?? years[0])?.id ?? "";
  const [section, setSection] = useState<SectionPick | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [chapter, setChapter] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [duration, setDuration] = useState("");
  const [examDate, setExamDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, create] = useMutation(CREATE_CT_QUESTION_REQUEST);

  const canSubmit =
    !!section && !!subject && chapter.trim() !== "" &&
    /^\d+$/.test(totalMarks.trim()) && /^\d+$/.test(duration.trim()) && examDate.trim() !== "";

  async function onSubmit(): Promise<void> {
    if (!canSubmit || busy || !section || !subject) return;
    setBusy(true);
    setError(null);
    const res = await create({
      sectionId: section.sectionId,
      subject,
      chapter: chapter.trim(),
      totalMarks: parseInt(totalMarks, 10),
      durationMinutes: parseInt(duration, 10),
      examDate,
    });
    setBusy(false);
    if (res.error || !res.data?.createCtQuestionRequest) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.cqRequestDone, "ok");
    nav.goBack();
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        <Card>
          <Body style={{ fontWeight: "700" }}>{STR.cqFormTitle}</Body>
          <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} />
          <Select
            label={STR.subject}
            value={subject}
            options={HW_SUBJECTS.map((s) => ({ label: hwSubjectLabel(s), value: s }))}
            onChange={setSubject}
            placeholder={STR.subject}
          />
          <Field label={STR.cqChapter} value={chapter} onChangeText={setChapter} />
          <Field label={STR.ctTotalMarks} value={totalMarks} onChangeText={setTotalMarks} keyboardType="number-pad" />
          <Field label={STR.cqDuration} value={duration} onChangeText={setDuration} keyboardType="number-pad" />
          <DateField label={STR.ctExamDate} value={examDate} onChange={setExamDate} />
          {error ? <Muted style={{ marginTop: space(1) }}>{error}</Muted> : null}
          <Button
            title={STR.cqNewRequest}
            onPress={() => void onSubmit()}
            loading={busy}
            disabled={busy || !canSubmit}
            style={{ marginTop: space(2) }}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
