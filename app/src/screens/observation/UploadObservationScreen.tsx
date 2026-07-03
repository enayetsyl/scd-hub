/**
 * UploadObservationScreen (CO-1 / J1, observation:upload = Principal/Office) —
 * one-step form: pick teacher, section, reviewer, subject, date, YouTube URL.
 * Subjects are filtered by form (QURAN form → QURAN subject only; REF11 → HW_SUBJECTS).
 * On submit: uploadClassroomObservation → if YouTube URL given, recordSessionFootage
 * (video ID extracted from full URL) in a second automatic call.
 */
import React, { useState, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { OBSERVATION_FORMS, HW_SUBJECTS } from "@scd/shared";
import {
  UPLOAD_CLASSROOM_OBSERVATION,
  RECORD_SESSION_FOOTAGE,
} from "../../graphql/observation";
import {
  TEACHERS_QUERY,
  ACADEMIC_YEARS_QUERY,
  CLASSES_QUERY,
} from "../../graphql/operations";
import { DateField } from "../../components/DateField";
import {
  Screen,
  Card,
  Body,
  Button,
  Field,
  Chip,
  Select,
  Notice,
  Loader,
} from "../../components/ui";
import {
  STR,
  obsFormLabel,
  hwSubjectLabel,
} from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { ObservationStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<ObservationStackParamList>;

/** Extract the 11-char video ID from a full YouTube URL or bare ID. */
function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m) return m[1];
  // Accept a bare 11-char ID directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

/** Subject options filtered by selected form. */
function subjectOptions(form: string | null) {
  if (form === "QURAN") return [{ label: "কুরআন / Quran", value: "QURAN" }];
  return (HW_SUBJECTS as readonly string[]).map((s) => ({
    label: hwSubjectLabel(s),
    value: s,
  }));
}

export default function UploadObservationScreen(): React.ReactElement {
  const nav = useNavigation<Nav>();

  // --- form state ---
  const [form, setForm] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [classDate, setClassDate] = useState("");
  const [anchor, setAnchor] = useState<"SECTION" | "SUBJECT_GROUP">("SECTION");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectGroupId, setSubjectGroupId] = useState("");
  const [periodNumber, setPeriodNumber] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [observerId, setObserverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- queries ---
  const [teachersQ] = useQuery({ query: TEACHERS_QUERY });
  const [yearsQ] = useQuery({ query: ACADEMIC_YEARS_QUERY });

  const currentYearId = useMemo(() => {
    const years = yearsQ.data?.academicYears ?? [];
    return years.find((y) => y.current)?.id ?? years[0]?.id ?? null;
  }, [yearsQ.data]);

  const [classesQ] = useQuery({
    query: CLASSES_QUERY,
    variables: { academicYearId: currentYearId ?? "" },
    pause: !currentYearId,
  });

  // Flatten all active sections into Select options "ClassName — SectionCode"
  const sectionOptions = useMemo(() => {
    const classes = classesQ.data?.classes ?? [];
    return classes.flatMap((c) =>
      c.sections
        .filter((s) => s.active)
        .map((s) => ({
          label: `${c.nameBn} — ${s.nameBn || s.code}`,
          value: s.id,
        })),
    );
  }, [classesQ.data]);

  const teacherOptions = useMemo(() => {
    return (teachersQ.data?.teachers ?? []).map((t) => ({
      label: t.name,
      value: t.id,
    }));
  }, [teachersQ.data]);

  // Observer options: same teachers list, exclude the selected observed teacher
  const observerOptions = useMemo(() => {
    return (teachersQ.data?.teachers ?? [])
      .filter((t) => t.id !== teacherId)
      .map((t) => ({ label: t.name, value: t.id }));
  }, [teachersQ.data, teacherId]);

  // Reset subject when form changes
  function handleFormChange(v: string | null) {
    setForm(v);
    setSubject(null);
  }

  // --- mutations ---
  const [, upload] = useMutation(UPLOAD_CLASSROOM_OBSERVATION);
  const [, attachFootage] = useMutation(RECORD_SESSION_FOOTAGE);

  async function onSubmit(): Promise<void> {
    setError(null);
    setOk(null);
    if (!form || !subject || !teacherId || !classDate.trim() || !youtubeUrl.trim()) {
      return setError(STR.errGeneric);
    }
    if (anchor === "SECTION" && !sectionId) return setError(STR.errGeneric);
    if (anchor === "SUBJECT_GROUP" && !subjectGroupId.trim())
      return setError(STR.errGeneric);

    setBusy(true);
    const res = await upload({
      form,
      subject,
      teacherId,
      classDate: classDate.trim(),
      sectionId: anchor === "SECTION" ? sectionId : null,
      subjectGroupId:
        anchor === "SUBJECT_GROUP" ? subjectGroupId.trim() : null,
      periodNumber: periodNumber.trim() ? Number(periodNumber) : null,
      recordingId: null,
      observerId: observerId ?? null,
    });

    if (res.error) {
      setBusy(false);
      return setError(friendlyError(res.error));
    }

    const observationId = res.data?.uploadClassroomObservation.id;

    // Attach YouTube footage (always present — URL is mandatory)
    if (observationId) {
      const videoId = extractYoutubeId(youtubeUrl);
      if (videoId) {
        const recRes = await attachFootage({ observationId, youtubeVideoId: videoId });
        if (recRes.error) {
          setBusy(false);
          setError(friendlyError(recRes.error));
          nav.navigate("ObservationDetail", { observationId });
          return;
        }
      } else {
        setBusy(false);
        setError("Invalid YouTube URL — observation was created without footage.");
        nav.navigate("ObservationDetail", { observationId });
        return;
      }
    }

    setBusy(false);
    if (observationId) {
      setOk(STR.obsUploaded);
      nav.navigate("ObservationDetail", { observationId });
    }
  }

  const loading =
    teachersQ.fetching || yearsQ.fetching || (!!currentYearId && classesQ.fetching);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: space(4) }}
        keyboardShouldPersistTaps="handled"
      >
        {ok ? <Notice message={ok} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        {loading ? (
          <Loader label={STR.loading} />
        ) : (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>
              {STR.obsUploadTitle}
            </Body>

            {/* Form */}
            <Select
              label={STR.obsForm}
              value={form}
              options={(OBSERVATION_FORMS as readonly string[]).map((f) => ({
                label: obsFormLabel(f),
                value: f,
              }))}
              onChange={handleFormChange}
              placeholder={STR.obsPickForm}
            />

            {/* Subject — filtered by selected form */}
            <Select
              label={STR.obsSubject}
              value={subject}
              options={subjectOptions(form)}
              onChange={setSubject}
              placeholder={STR.obsPickForm}
            />

            {/* Observed teacher */}
            <Select
              label={STR.obsTeacherId}
              value={teacherId}
              options={teacherOptions}
              onChange={setTeacherId}
              placeholder={STR.obsPickTeacher}
              searchable
            />

            {/* Reviewer (observer) */}
            <Select
              label={STR.obsObserverId}
              value={observerId}
              options={observerOptions}
              onChange={setObserverId}
              placeholder={STR.obsPickObserver}
              searchable
            />

            {/* Class date */}
            <DateField
              label={STR.obsClassDate}
              value={classDate}
              onChange={setClassDate}
            />

            {/* Anchor toggle */}
            <Body style={{ marginTop: space(1) }}>{STR.obsAnchor}</Body>
            <View
              style={{
                flexDirection: "row",
                gap: space(2),
                marginTop: space(2),
              }}
            >
              <Chip
                label={STR.obsAnchorSection}
                selected={anchor === "SECTION"}
                onPress={() => setAnchor("SECTION")}
              />
              <Chip
                label={STR.obsAnchorSubjectGroup}
                selected={anchor === "SUBJECT_GROUP"}
                onPress={() => setAnchor("SUBJECT_GROUP")}
              />
            </View>

            {anchor === "SECTION" ? (
              <Select
                label={STR.obsSectionId}
                value={sectionId}
                options={sectionOptions}
                onChange={setSectionId}
                placeholder={STR.obsPickSection}
              />
            ) : (
              <Field
                label={STR.obsSubjectGroupId}
                value={subjectGroupId}
                onChangeText={setSubjectGroupId}
              />
            )}

            {/* Period */}
            <Field
              label={STR.obsPeriodNumber}
              value={periodNumber}
              onChangeText={setPeriodNumber}
              keyboardType="number-pad"
            />

            {/* YouTube URL */}
            <Field
              label={STR.obsYoutubeUrl}
              value={youtubeUrl}
              onChangeText={setYoutubeUrl}
              helper={STR.obsYoutubeUrlHint}
              placeholder="https://youtube.com/watch?v=..."
            />

            <View style={{ marginTop: space(2) }}>
              <Button
                title={STR.obsSubmitUpload}
                onPress={onSubmit}
                loading={busy}
                disabled={busy}
              />
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
