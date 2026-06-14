/**
 * RecordSessionScreen (CO-2, observation:upload — Principal/Office) — link a
 * YouTube-unlisted recording of a taught session to a session anchor.
 *
 * Two sources (cf. ClassEcho's dual mode):
 *   • Upload video (WEB ONLY) — authorize YouTube (GIS) → pick a file → it uploads
 *     straight to YouTube as unlisted, and we keep only the returned video id.
 *   • Paste a YouTube link/id (every platform) — for a video already uploaded.
 *
 * recordSessionRecording rides observation:upload + the server anchor validation —
 * the Bangla deny surfaces inline. The saved recording plays via RecordingPlayer,
 * which works on web AND native (an unlisted link needs no auth to watch).
 */
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { HW_SUBJECTS } from "@scd/shared";
import { RECORD_SESSION_RECORDING, type SessionRecordingT } from "../../graphql/sessionRecording";
import { Screen, Card, Body, Muted, Button, Field, Chip, Select, Notice } from "../../components/ui";
import { RecordingPlayer } from "../../components/RecordingPlayer";
import { ClassSectionSelect, type SectionPick } from "../../components/vocabPickers";
import { AcademicYearSelect, TeacherSelect } from "../../components/selects";
import {
  isYouTubeUploadSupported,
  authorizeYouTube,
  pickVideoFile,
  uploadVideoFile,
  YouTubeUploadError,
} from "../../lib/youtubeUpload";
import { STR, hwSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";
import type { AdminStackParamList } from "../../navigation/types";

type Nav = NativeStackNavigationProp<AdminStackParamList>;

export default function RecordSessionScreen(): React.ReactElement {
  useNavigation<Nav>();
  const uploadSupported = isYouTubeUploadSupported();

  const [yearId, setYearId] = useState("");
  const [section, setSection] = useState<SectionPick | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [classDate, setClassDate] = useState("");
  const [mode, setMode] = useState<"upload" | "url">(uploadSupported ? "upload" : "url");
  const [videoUrl, setVideoUrl] = useState("");
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SessionRecordingT | null>(null);

  const [, record] = useMutation(RECORD_SESSION_RECORDING);

  async function onAuthorize(): Promise<void> {
    setError(null);
    try {
      await authorizeYouTube();
      setAuthed(true);
    } catch (e) {
      setError(e instanceof YouTubeUploadError ? e.message : STR.errGeneric);
    }
  }

  async function onPickUpload(): Promise<void> {
    setError(null);
    if (!subject || !classDate.trim()) return setError(STR.coNeedAnchorFirst);
    try {
      const file = await pickVideoFile();
      if (!file) return;
      setUploading(true);
      const title = `${section?.sectionName ?? ""} ${hwSubjectLabel(subject)} ${classDate.trim()}`.trim();
      const res = await uploadVideoFile(file, { title });
      setUploadedVideoId(res.videoId);
    } catch (e) {
      setError(e instanceof YouTubeUploadError ? e.message : STR.errGeneric);
    } finally {
      setUploading(false);
    }
  }

  async function onSave(): Promise<void> {
    setError(null);
    const yt = mode === "upload" ? uploadedVideoId : videoUrl.trim();
    if (!teacherId || !section || !subject || !classDate.trim() || !yt) return setError(STR.errGeneric);
    setBusy(true);
    const res = await record({
      subject,
      teacherId,
      classDate: classDate.trim(),
      youtubeVideoId: yt,
      sectionId: section.sectionId,
    });
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    if (res.data) setSaved(res.data.recordSessionRecording);
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: space(4) }} keyboardShouldPersistTaps="handled">
        {saved ? <Notice message={STR.coSaved} tone="ok" /> : null}
        {error ? <Notice message={error} tone="danger" /> : null}

        <Card>
          <Body style={{ fontWeight: "700", marginBottom: space(1) }}>{STR.coRecordTitle}</Body>
          <Muted style={{ marginBottom: space(2) }}>{STR.coRecordHint}</Muted>
          <AcademicYearSelect value={yearId} onChange={setYearId} />
          {yearId ? <ClassSectionSelect academicYearId={yearId} value={section} onChange={setSection} /> : null}
          <TeacherSelect label={STR.coTeacherLabel} value={teacherId} onChange={setTeacherId} />
          <Select
            label={STR.ctSubject}
            value={subject}
            options={(HW_SUBJECTS as readonly string[]).map((s) => ({ label: hwSubjectLabel(s), value: s }))}
            onChange={setSubject}
            placeholder={STR.ctPickSubject}
          />
          <Field label={STR.coClassDate} value={classDate} onChangeText={setClassDate} placeholder="YYYY-MM-DD" />
        </Card>

        <Card>
          <View style={{ flexDirection: "row", gap: space(2), marginBottom: space(2) }}>
            <Chip label={STR.coModeUpload} selected={mode === "upload"} onPress={() => setMode("upload")} />
            <Chip label={STR.coModeUrl} selected={mode === "url"} onPress={() => setMode("url")} />
          </View>

          {mode === "upload" ? (
            !uploadSupported ? (
              <Notice message={STR.coWebOnly} tone="info" />
            ) : (
              <View>
                {!authed ? (
                  <Button title={STR.coAuthorize} variant="secondary" onPress={onAuthorize} />
                ) : (
                  <>
                    <Muted style={{ marginBottom: space(2) }}>{STR.coAuthorized}</Muted>
                    <Button title={STR.coPickUpload} onPress={onPickUpload} loading={uploading} disabled={uploading} />
                  </>
                )}
                {uploadedVideoId ? (
                  <Muted style={{ marginTop: space(2) }}>{STR.coUploadedVideo}: {uploadedVideoId}</Muted>
                ) : null}
              </View>
            )
          ) : (
            <Field
              label={STR.coUrlLabel}
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder="https://youtu.be/… "
              helper={STR.coUrlHint}
            />
          )}

          <View style={{ marginTop: space(3) }}>
            <Button title={STR.coSave} onPress={onSave} loading={busy} disabled={busy} />
          </View>
        </Card>

        {saved ? (
          <Card>
            <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.coSaved}</Body>
            <RecordingPlayer youtubeVideoId={saved.youtubeVideoId} />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
