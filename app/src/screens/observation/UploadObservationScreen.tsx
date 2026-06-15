/**
 * UploadObservationScreen (CO-1 / J1, observation:upload = Principal/Office) — record
 * a session + optionally assign a senior-teacher observer in one step. Pick the form
 * (REF-11 / Quran), the session anchor (section OR subject-group), the observed teacher,
 * the class date; optionally a recording id + observer id. uploadClassroomObservation
 * rides observation:upload + the service conflict guard (observer ≠ observed teacher) —
 * the Bangla deny surfaces inline.
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { OBSERVATION_FORMS, HW_SUBJECTS } from "@scd/shared";
import { UPLOAD_CLASSROOM_OBSERVATION } from "../../graphql/observation";
import { Screen, Card, Body, Button, Field, Chip, Select, Notice } from "../../components/ui";
import { STR, obsFormLabel, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

export default function UploadObservationScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();
  const [form, setForm] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [classDate, setClassDate] = useState("");
  const [anchor, setAnchor] = useState<"SECTION" | "SUBJECT_GROUP">("SECTION");
  const [sectionId, setSectionId] = useState("");
  const [subjectGroupId, setSubjectGroupId] = useState("");
  const [periodNumber, setPeriodNumber] = useState("");
  const [recordingId, setRecordingId] = useState("");
  const [observerId, setObserverId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [, upload] = useMutation(UPLOAD_CLASSROOM_OBSERVATION);

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!form || !subject || !teacherId.trim() || !classDate.trim()) return setError(STR.errGeneric);
    if (anchor === "SECTION" && !sectionId.trim()) return setError(STR.errGeneric);
    if (anchor === "SUBJECT_GROUP" && !subjectGroupId.trim()) return setError(STR.errGeneric);
    setBusy(true);
    const res = await upload({
      form,
      subject,
      teacherId: teacherId.trim(),
      classDate: classDate.trim(),
      sectionId: anchor === "SECTION" ? sectionId.trim() : null,
      subjectGroupId: anchor === "SUBJECT_GROUP" ? subjectGroupId.trim() : null,
      periodNumber: periodNumber.trim() ? Number(periodNumber) : null,
      recordingId: recordingId.trim() || null,
      observerId: observerId.trim() || null,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) {
      setOk(STR.obsUploaded);
      nav.navigate("ObservationDetail", { observationId: res.data.uploadClassroomObservation.id });
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}
        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.obsUploadTitle}</Body>
          <Select
            label={STR.obsForm}
            value={form}
            options={(OBSERVATION_FORMS as readonly string[]).map((f) => ({ label: obsFormLabel(f), value: f }))}
            onChange={setForm}
            placeholder={STR.obsPickForm}
          />
          <Select
            label={STR.obsSubject}
            value={subject}
            options={(HW_SUBJECTS as readonly string[]).map((s) => ({ label: hwSubjectLabel(s), value: s }))}
            onChange={setSubject}
            placeholder={STR.obsPickForm}
          />
          <Field label={STR.obsTeacherId} value={teacherId} onChangeText={setTeacherId} helper={STR.obsTeacherIdHint} />
          <Field label={STR.obsClassDate} value={classDate} onChangeText={setClassDate} placeholder="YYYY-MM-DD" />

          <Body style={{ marginTop: space(1) }}>{STR.obsAnchor}</Body>
          <View style={{ flexDirection: "row", gap: space(2), marginTop: space(2) }}>
            <Chip label={STR.obsAnchorSection} selected={anchor === "SECTION"} onPress={() => setAnchor("SECTION")} />
            <Chip label={STR.obsAnchorSubjectGroup} selected={anchor === "SUBJECT_GROUP"} onPress={() => setAnchor("SUBJECT_GROUP")} />
          </View>
          {anchor === "SECTION" ? (
            <Field label={STR.obsSectionId} value={sectionId} onChangeText={setSectionId} />
          ) : (
            <Field label={STR.obsSubjectGroupId} value={subjectGroupId} onChangeText={setSubjectGroupId} />
          )}

          <Field label={STR.obsPeriodNumber} value={periodNumber} onChangeText={setPeriodNumber} keyboardType="number-pad" />
          <Field label={STR.obsRecordingId} value={recordingId} onChangeText={setRecordingId} />
          <Field label={STR.obsObserverId} value={observerId} onChangeText={setObserverId} helper={STR.obsObserverIdHint} />

          <View style={{ marginTop: space(2) }}>
            <Button title={STR.obsSubmitUpload} onPress={onSubmit} loading={busy} disabled={busy} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
