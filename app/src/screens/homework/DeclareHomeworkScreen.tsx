/**
 * DeclareHomeworkScreen (§8.2) — a subject teacher declares one common sheet for
 * the class+subject+day: HW item with ≥1 TOP-tag, TIME_DECL, Q_COUNT, optional
 * Pool ref + revision flag. classLevel is derived from the selected class.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import { CLASSES_QUERY, DECLARE_HOMEWORK_ITEM, ATTACH_HW_QUESTION_FILE, HOMEWORK_TOPICS_QUERY } from "../../graphql/operations";
import { pickAndUploadHomeworkFile, FileUploadError } from "../../lib/files";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Chip, ChipRow, Notice, EmptyState } from "../../components/ui";
import { SectionBar } from "../../components/SectionBar";
import { STR, hwSubjectLabel, classLevelLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { useSectionContext } from "../../state/SectionContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<HomeworkStackParamList, "DeclareHomework">;

const today = (): string => new Date().toISOString().slice(0, 10);

export default function DeclareHomeworkScreen({ navigation }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [subject, setSubject] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [timeDecl, setTimeDecl] = useState("20");
  const [qCount, setQCount] = useState("");
  const [poolRef, setPoolRef] = useState("");
  const [revItem, setRevItem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The just-declared item — target for the optional question-file attach (GP-A). */
  const [lastItem, setLastItem] = useState<{ id: string; hwId: string } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [, declare] = useMutation(DECLARE_HOMEWORK_ITEM);
  const [, attachQuestion] = useMutation(ATTACH_HW_QUESTION_FILE);

  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: selection.academicYearId ?? "" },
    pause: !selection.academicYearId,
  });
  const classLevel = classesQ.data?.classes.find((c) => c.id === selection.classId)?.level ?? null;

  // Topic picker — load the catalog for the chosen (subject, class); a topic code is
  // subject-specific, so clear the selection whenever the subject changes.
  const [topicsQ] = useQuery({
    query: HOMEWORK_TOPICS_QUERY,
    variables: { subject: subject ?? "", classLevel: classLevel ?? 0 },
    pause: !subject || classLevel == null,
  });
  const topics = topicsQ.data?.homeworkTopics ?? [];
  function chooseSubject(s: string): void {
    setSubject(s);
    setSelectedTopics([]);
  }
  function toggleTopic(code: string): void {
    setSelectedTopics((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!subject) return setError(STR.hwSubject);
    if (classLevel == null) return setError(STR.hwNoClassLevel);
    const tags = selectedTopics;
    if (tags.length === 0) return setError(STR.hwTopicRequired);
    const q = parseInt(qCount, 10);
    if (!Number.isFinite(q)) return setError(STR.hwQCount);
    const td = timeDecl.trim() === "" ? undefined : parseInt(timeDecl, 10);

    setBusy(true);
    const res = await declare({
      academicYearId: selection.academicYearId!,
      classId: selection.classId!,
      classLevel,
      sectionId: selection.sectionId!,
      subject,
      dateGiven: date,
      topTags: tags,
      timeDecl: td,
      qCount: q,
      poolRef: poolRef.trim() || undefined,
      revItem,
    });
    setBusy(false);
    if (res.error || !res.data?.declareHomeworkItem) {
      setError(friendlyError(res.error));
      return;
    }
    setOk(`${res.data.declareHomeworkItem.hwId} ${STR.hwDeclared}`);
    setLastItem({ id: res.data.declareHomeworkItem.id, hwId: res.data.declareHomeworkItem.hwId });
    setFileNote(null);
    setSelectedTopics([]);
    setQCount("");
    setPoolRef("");
    setRevItem(false);
  }

  /** Optional question-file attach (GP-A, D-#70) — failure shows a Bangla
   *  notice and never blocks the declaration (GP-J8). */
  async function onAttachQuestion(): Promise<void> {
    if (!lastItem || fileBusy) return;
    setFileNote(null);
    setFileBusy(true);
    try {
      const uploaded = await pickAndUploadHomeworkFile("question");
      if (!uploaded) return; // picker cancelled
      const res = await attachQuestion({ hwItemId: lastItem.id, fileId: uploaded.fileId });
      if (res.error || !res.data?.attachHomeworkQuestionFile) {
        setFileNote(friendlyError(res.error));
        return;
      }
      setFileNote(`${lastItem.hwId} — ${STR.hwFileAttached}`);
    } catch (e) {
      setFileNote(e instanceof FileUploadError ? e.message : STR.hwFileUploadFail);
    } finally {
      setFileBusy(false);
    }
  }

  if (!hasSection) {
    return (
      <Screen>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
        <EmptyState message={STR.pickSection} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <SectionBar onChange={() => navigation.navigate("SectionPicker")} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        {fileNote ? (
          <Notice message={fileNote} tone={fileNote.endsWith(STR.hwFileAttached) ? "ok" : "danger"} />
        ) : null}
        {lastItem ? (
          <View style={{ marginBottom: space(3) }}>
            <Button
              title={`${STR.hwAttachQuestion} (${lastItem.hwId})`}
              variant="secondary"
              onPress={onAttachQuestion}
              loading={fileBusy}
              disabled={fileBusy}
            />
          </View>
        ) : null}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 8 }}>{STR.hwSubject}</Body>
          <ChipRow>
            {HW_SUBJECTS.map((s) => (
              <Chip key={s} label={hwSubjectLabel(s)} selected={subject === s} onPress={() => chooseSubject(s)} />
            ))}
          </ChipRow>
          {classLevel != null ? <Muted style={{ marginTop: 4 }}>{classLevelLabel(classLevel)}</Muted> : null}
        </Card>
        <Field label={STR.hwDate} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.hwTopTags}</Body>
          <Muted style={{ marginBottom: space(2) }}>{STR.hwTopicHint}</Muted>
          {!subject || classLevel == null ? (
            <Muted>{STR.hwPickSubjectFirst}</Muted>
          ) : topicsQ.fetching ? (
            <Muted>{STR.hwTopicsLoading}</Muted>
          ) : (
            <ChipRow>
              {topics.map((tp) => (
                <Chip
                  key={tp.code}
                  label={tp.labelBn}
                  selected={selectedTopics.includes(tp.code)}
                  onPress={() => toggleTopic(tp.code)}
                />
              ))}
            </ChipRow>
          )}
        </Card>
        <Field label={STR.hwTimeDecl} value={timeDecl} onChangeText={setTimeDecl} keyboardType="number-pad" />
        <Field label={STR.hwQCount} value={qCount} onChangeText={setQCount} keyboardType="number-pad" />
        <Field label={STR.hwPoolRef} value={poolRef} onChangeText={setPoolRef} placeholder={`QP-${subject ?? "MATH"}-C${classLevel ?? 1}-U01`} />
        <ChipRow>
          <Chip label={STR.hwRevItem} selected={revItem} onPress={() => setRevItem((v) => !v)} />
        </ChipRow>
        <View style={{ marginTop: space(3) }}>
          <Button title={STR.hwDeclare} onPress={onSubmit} loading={busy} disabled={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}
