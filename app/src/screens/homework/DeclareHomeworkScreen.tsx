/**
 * DeclareHomeworkScreen (§8.2) — a subject teacher declares one common sheet for
 * the class+subject+day: HW item with ≥1 TOP-tag, TIME_DECL, Q_COUNT, optional
 * Pool ref + revision flag. classLevel is derived from the selected class.
 */
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery, useMutation } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import {
  CLASSES_QUERY,
  DECLARE_HOMEWORK_ITEM,
  ATTACH_HW_QUESTION_FILE,
  HOMEWORK_TOPICS_QUERY,
  HW_NIL_DECLARATIONS,
  DECLARE_NO_HOMEWORK,
  REMOVE_NO_HOMEWORK,
} from "../../graphql/operations";
import {
  pickAndUploadHomeworkFile,
  pickAndUploadHomeworkFiles,
  openStoredFile,
  HW_MAX_ATTACHMENTS,
  FileUploadError,
  type UploadedFile,
} from "../../lib/files";
import type { HomeworkStackParamList } from "../../navigation/types";
import { Screen, Body, Muted, Card, Field, Button, Chip, ChipRow, EmptyState } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { MoreOptions } from "../../components/MoreOptions";
import { ClassSectionDashboard } from "../../components/ClassSectionDashboard";
import { STR, hwSubjectLabel, classLevelLabel, hwNilReasonLabel, HW_NIL_REASONS } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { required } from "../../lib/validate";
import { useSectionContext } from "../../state/SectionContext";
import { useToast } from "../../state/ToastContext";
import { useColors } from "../../theme";
import { space } from "../../theme/tokens";
import { dateKey } from "../../lib/dates";

type Props = NativeStackScreenProps<HomeworkStackParamList, "DeclareHomework">;

const today = (): string => dateKey();

export default function DeclareHomeworkScreen({ navigation, route }: Props): React.ReactElement {
  const { selection, hasSection } = useSectionContext();
  const [subject, setSubject] = useState<string | null>(null);
  // R-Context (UX-5): inherit the date picked on Homework home; still editable here.
  const [date, setDate] = useState(route.params?.date ?? today());
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [timeDecl, setTimeDecl] = useState("20");
  const [qCount, setQCount] = useState("");
  const [poolRef, setPoolRef] = useState("");
  const [revItem, setRevItem] = useState(false);
  // R-Validate (UX-1): per-field errors; the toast names the first offending field.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const colors = useColors();
  /** The just-declared item — target for the optional question-file attach (GP-A). */
  const [lastItem, setLastItem] = useState<{ id: string; hwId: string } | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  /** Declare-form attachments (≤5) — uploaded on pick, bound at declare time. */
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pickBusy, setPickBusy] = useState(false);
  /** "No homework today" (D-#299): reason chip + declare/remove. */
  const [nilReason, setNilReason] = useState<string | null>(null);
  const [nilBusy, setNilBusy] = useState(false);
  const [, declareNil] = useMutation(DECLARE_NO_HOMEWORK);
  const [, removeNil] = useMutation(REMOVE_NO_HOMEWORK);
  const [nilQ, refetchNil] = useQuery({
    query: HW_NIL_DECLARATIONS,
    variables: { sectionId: selection.sectionId ?? "", classId: selection.classId ?? "", date },
    pause: !selection.sectionId || !selection.classId,
  });
  const nilForSubject = subject
    ? (nilQ.data?.homeworkNilDeclarations ?? []).find((n) => n.subject === subject) ?? null
    : null;

  async function onDeclareNil(): Promise<void> {
    if (!subject || nilBusy) return;
    if (!nilReason) {
      toast.show(STR.hwNilPickReason, "danger");
      return;
    }
    setNilBusy(true);
    const res = await declareNil({
      classId: selection.classId!,
      sectionId: selection.sectionId!,
      subject,
      date,
      reason: nilReason,
    });
    setNilBusy(false);
    if (res.error || !res.data?.declareNoHomework) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.hwNilDeclaredOk, "ok");
    setNilReason(null);
    refetchNil({ requestPolicy: "network-only" });
  }

  async function onRemoveNil(): Promise<void> {
    if (!subject || nilBusy) return;
    setNilBusy(true);
    const res = await removeNil({
      classId: selection.classId!,
      sectionId: selection.sectionId!,
      subject,
      date,
    });
    setNilBusy(false);
    if (res.error) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(STR.hwNilRemovedOk, "ok");
    refetchNil({ requestPolicy: "network-only" });
  }
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
    setFieldErrors({});
    const q = parseInt(qCount, 10);
    const { firstErrorKey, errors } = required({
      subject: { value: subject, message: `${STR.hwSubject} — ${STR.fieldRequired}` },
      topics: { value: selectedTopics, message: `${STR.hwTopTags} — ${STR.fieldRequired}` },
      qCount: { value: Number.isFinite(q) ? q : null, message: `${STR.hwQCount} — ${STR.fieldRequired}` },
    });
    if (firstErrorKey) {
      setFieldErrors(errors);
      toast.show(errors[firstErrorKey], "danger");
      return;
    }
    if (classLevel == null) {
      toast.show(STR.hwNoClassLevel, "danger");
      return;
    }
    const tags = selectedTopics;
    const td = timeDecl.trim() === "" ? undefined : parseInt(timeDecl, 10);

    setBusy(true);
    const res = await declare({
      academicYearId: selection.academicYearId!,
      classId: selection.classId!,
      classLevel,
      sectionId: selection.sectionId!,
      subject: subject!,
      dateGiven: date,
      topTags: tags,
      timeDecl: td,
      qCount: q,
      poolRef: poolRef.trim() || undefined,
      revItem,
      attachmentIds: files.length > 0 ? files.map((f) => f.fileId) : undefined,
    });
    setBusy(false);
    if (res.error || !res.data?.declareHomeworkItem) {
      toast.show(friendlyError(res.error), "danger");
      return;
    }
    toast.show(`${res.data.declareHomeworkItem.hwId} ${STR.hwDeclared}`, "ok");
    setLastItem({ id: res.data.declareHomeworkItem.id, hwId: res.data.declareHomeworkItem.hwId });
    setSelectedTopics([]);
    setQCount("");
    setPoolRef("");
    setRevItem(false);
    setFiles([]);
    refetchNil({ requestPolicy: "network-only" }); // a real declaration auto-clears a nil
  }

  /** Multi-pick question attachments (≤5) — each uploads immediately; partial
   *  failures toast but the good ones stay (the print-form pattern). */
  async function onPickFiles(): Promise<void> {
    if (pickBusy || files.length >= HW_MAX_ATTACHMENTS) return;
    setPickBusy(true);
    try {
      const res = await pickAndUploadHomeworkFiles(HW_MAX_ATTACHMENTS - files.length);
      if (res.uploaded.length > 0) setFiles((cur) => [...cur, ...res.uploaded]);
      if (res.failures.length > 0) toast.show(res.failures.join("\n"), "danger");
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.hwFileUploadFail, "danger");
    } finally {
      setPickBusy(false);
    }
  }

  /** Optional question-file attach (GP-A, D-#70) — failure toasts a Bangla
   *  message and never blocks the declaration (GP-J8). */
  async function onAttachQuestion(): Promise<void> {
    if (!lastItem || fileBusy) return;
    setFileBusy(true);
    try {
      const uploaded = await pickAndUploadHomeworkFile("question");
      if (!uploaded) return; // picker cancelled
      const res = await attachQuestion({ hwItemId: lastItem.id, fileId: uploaded.fileId });
      if (res.error || !res.data?.attachHomeworkQuestionFile) {
        toast.show(friendlyError(res.error), "danger");
        return;
      }
      toast.show(`${lastItem.hwId} — ${STR.hwFileAttached}`, "ok");
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.hwFileUploadFail, "danger");
    } finally {
      setFileBusy(false);
    }
  }

  if (!hasSection) {
    return (
      <Screen>
        <ClassSectionDashboard />
        <EmptyState message={STR.pickSection} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={{ padding: space(4), paddingBottom: 0 }}>
        <ClassSectionDashboard />
      </View>
      <ScrollView contentContainerStyle={{ padding: space(4) }}>
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
          {fieldErrors.subject ? <Body style={{ color: colors.error, marginTop: 4 }}>⚠ {fieldErrors.subject}</Body> : null}
          {classLevel != null ? <Muted style={{ marginTop: 4 }}>{classLevelLabel(classLevel)}</Muted> : null}
        </Card>
        <DateField label={STR.hwDate} value={date} onChange={setDate} />
        {subject ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: 4 }}>{STR.hwNilTitle}</Body>
            {nilForSubject ? (
              <>
                <Muted>
                  ✓ {STR.hwNilDeclaredNotice} — {hwNilReasonLabel(nilForSubject.reason)}
                </Muted>
                <Button
                  title={STR.hwNilRemove}
                  variant="ghost"
                  onPress={() => void onRemoveNil()}
                  loading={nilBusy}
                  disabled={nilBusy}
                  style={{ marginTop: space(1) }}
                />
              </>
            ) : (
              <>
                <ChipRow>
                  {HW_NIL_REASONS.map((r) => (
                    <Chip
                      key={r}
                      label={hwNilReasonLabel(r)}
                      selected={nilReason === r}
                      onPress={() => setNilReason((cur) => (cur === r ? null : r))}
                    />
                  ))}
                </ChipRow>
                <Button
                  title={STR.hwNilButton}
                  variant="secondary"
                  onPress={() => void onDeclareNil()}
                  loading={nilBusy}
                  disabled={nilBusy || !nilReason}
                  style={{ marginTop: space(1) }}
                />
              </>
            )}
          </Card>
        ) : null}
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
          {fieldErrors.topics ? <Body style={{ color: colors.error, marginTop: 4 }}>⚠ {fieldErrors.topics}</Body> : null}
        </Card>
        <Field label={STR.hwTimeDecl} value={timeDecl} onChangeText={setTimeDecl} keyboardType="number-pad" />
        <Field label={STR.hwQCount} value={qCount} onChangeText={setQCount} keyboardType="number-pad" error={fieldErrors.qCount} />
        {/* Rarely changed — folded (UX-6): pool ref + revision flag. Time (default 20)
            stays visible above per the PRD. */}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: 4 }}>
            📎 {STR.cnAttachments} ({files.length}/{HW_MAX_ATTACHMENTS})
          </Body>
          {files.map((f, i) => (
            <View key={f.fileId} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => void openStoredFile(f.fileId).catch(() => toast.show(STR.errGeneric, "danger"))}
              >
                <Body>📎 {f.originalName}</Body>
              </Pressable>
              <Button
                title={STR.remove}
                variant="ghost"
                onPress={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
              />
            </View>
          ))}
          <Button
            title={pickBusy ? STR.saving : STR.cnAttachFile}
            variant="secondary"
            onPress={() => void onPickFiles()}
            loading={pickBusy}
            disabled={pickBusy || files.length >= HW_MAX_ATTACHMENTS}
          />
        </Card>
        <MoreOptions>
          <Field label={STR.hwPoolRef} value={poolRef} onChangeText={setPoolRef} placeholder={`QP-${subject ?? "MATH"}-C${classLevel ?? 1}-U01`} />
          <ChipRow>
            <Chip label={STR.hwRevItem} selected={revItem} onPress={() => setRevItem((v) => !v)} />
          </ChipRow>
        </MoreOptions>
        <View style={{ marginTop: space(3) }}>
          <Button title={STR.hwDeclare} onPress={onSubmit} loading={busy} disabled={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}
