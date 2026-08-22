/**
 * TeachingNoteUploadScreen (TN-1, prd-teaching-notes) — the Principal/Office
 * upload: pick ONE file (.md / PDF / Word), confirm the (class, subject, kind,
 * seq) identity and the title, upload.
 *
 * ONE FILE AT A TIME, deliberately, where English Drive stages many: a note is a
 * curated artifact whose identity a person chooses, not a batch of machine-named
 * block files a parser can key. Replacing the wrong (class × subject) silently is
 * the failure worth spending a screen to prevent, so the replace conflict is
 * shown before the button and names the versions.
 *
 * The route params are all optional — arriving from a note's "new version"
 * button prefills the identity, and opening the screen cold prefills nothing.
 */
import React, { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation, useQuery } from "urql";
import { ROSTER_CLASS_LEVELS, ROUTINE_SUBJECTS } from "@scd/shared";
import { TEACHING_NOTES, UPLOAD_TEACHING_NOTE } from "../../graphql/teachingNotes";
import type { TeachingNotesStackParamList } from "../../navigation/types";
import {
  Screen,
  H2,
  Body,
  Muted,
  Card,
  Badge,
  Button,
  Field,
  Notice,
  Select,
  Divider,
  Loader,
} from "../../components/ui";
import { UploadDropZone } from "../../components/UploadDropZone";
import {
  uploadTeachingNoteAsset,
  uploadTeachingNoteWebFile,
  englishDriveFormatOf,
  FileUploadError,
} from "../../lib/files";
import { titleFromMarkdown } from "../../lib/englishDrive";
import {
  TEACHING_NOTE_KINDS,
  teachingNoteKindLabel,
  looksLikeMojibake,
} from "../../lib/teachingNotes";
import { STR, bnNum, classLevelLabel, routineSubjectLabel } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<TeachingNotesStackParamList, "TeachingNoteUpload">;

interface Staged {
  filename: string;
  format: "MD" | "PDF" | "DOCX";
  /** MD only — the markdown body. */
  content: string;
  fileId?: string;
  pdfFileId?: string;
  fileMime?: string;
}

const baseName = (f: string): string => f.replace(/\.[^.]+$/, "");

export default function TeachingNoteUploadScreen({ route }: Props): React.ReactElement {
  const prefill = route.params ?? {};

  const [staged, setStaged] = useState<Staged | null>(null);
  const [classLevel, setClassLevel] = useState<string | null>(
    prefill.classLevel !== undefined ? String(prefill.classLevel) : null,
  );
  const [subject, setSubject] = useState<string | null>(prefill.subject ?? null);
  const [kind, setKind] = useState<string | null>(prefill.kind ?? "ANSWER_GUIDE");
  const [seq, setSeq] = useState<string>(prefill.seq ? String(prefill.seq) : "1");
  const [title, setTitle] = useState<string>(prefill.title ?? "");

  const [ingesting, setIngesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [, upload] = useMutation(UPLOAD_TEACHING_NOTE);

  // The whole library — Principal/Office are unrestricted, so this is what the
  // replace-conflict notice reads.
  const [existingQ, refetchExisting] = useQuery({ query: TEACHING_NOTES, variables: {} });
  const existing = existingQ.data?.teachingNotes ?? [];

  const seqNum = useMemo(() => {
    const n = Number(seq.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [seq]);

  const conflict = useMemo(() => {
    if (classLevel === null || !subject || !kind || seqNum === null) return null;
    const hit = existing.find(
      (d) =>
        d.classLevel === Number(classLevel) &&
        d.subject === subject &&
        d.kind === kind &&
        d.seq === seqNum,
    );
    return hit ?? null;
  }, [existing, classLevel, subject, kind, seqNum]);

  /** Stage a markdown body — the encoding guard fires HERE, before any upload. */
  const stageMarkdown = useCallback((filename: string, content: string): boolean => {
    if (looksLikeMojibake(content)) {
      setError(STR.tnMojibake);
      setStaged(null);
      return false;
    }
    setError(null);
    setStaged({ filename, format: "MD", content });
    setTitle((t) => (t.trim() === "" ? titleFromMarkdown(content) ?? baseName(filename) : t));
    return true;
  }, []);

  const pick = useCallback(async (): Promise<void> => {
    setError(null);
    setDone(null);
    const res = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: [
        "text/markdown",
        "text/plain",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
    if (res.canceled || res.assets.length === 0) return;
    const asset = res.assets[0];
    const binary = englishDriveFormatOf(asset.mimeType ?? "", asset.name);

    setIngesting(true);
    try {
      if (binary === null) {
        // Treated as markdown/plain text.
        const text = await fetch(asset.uri).then((r) => r.text());
        stageMarkdown(asset.name, text);
      } else {
        const up = await uploadTeachingNoteAsset(asset);
        setStaged({
          filename: asset.name,
          format: binary,
          content: "",
          fileId: up.fileId,
          pdfFileId: up.pdfFileId ?? undefined,
          fileMime: up.mime,
        });
        setTitle((t) => (t.trim() === "" ? baseName(asset.name) : t));
      }
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
    } finally {
      setIngesting(false);
    }
  }, [stageMarkdown]);

  const onDropFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      const file = files[0];
      setError(null);
      setDone(null);
      const binary = englishDriveFormatOf(file.type, file.name);
      setIngesting(true);
      try {
        if (binary === null) {
          stageMarkdown(file.name, await file.text());
        } else {
          const up = await uploadTeachingNoteWebFile(file);
          setStaged({
            filename: file.name,
            format: binary,
            content: "",
            fileId: up.fileId,
            pdfFileId: up.pdfFileId ?? undefined,
            fileMime: up.mime,
          });
          setTitle((t) => (t.trim() === "" ? baseName(file.name) : t));
        }
      } catch (e) {
        setError(e instanceof FileUploadError ? e.message : STR.errGeneric);
      } finally {
        setIngesting(false);
      }
    },
    [stageMarkdown],
  );

  const ready =
    staged !== null &&
    classLevel !== null &&
    subject !== null &&
    kind !== null &&
    seqNum !== null &&
    title.trim() !== "" &&
    !busy &&
    !ingesting;

  const submit = useCallback(async (): Promise<void> => {
    if (!ready || staged === null) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await upload({
        classLevel: Number(classLevel),
        subject: subject as string,
        kind: kind as string,
        seq: seqNum,
        title: title.trim(),
        format: staged.format,
        contentMd: staged.format === "MD" ? staged.content : null,
        fileId: staged.fileId ?? null,
        pdfFileId: staged.pdfFileId ?? null,
        fileName: staged.format === "MD" ? null : staged.filename,
        fileMime: staged.fileMime ?? null,
      });
      if (res.error) {
        setError(friendlyError(res.error));
        return;
      }
      const replaced = res.data?.uploadTeachingNote.replacedVersion ?? null;
      setDone(replaced === null ? STR.tnUploaded : `${STR.tnUploaded} ${STR.tnReplacedToast}`);
      setStaged(null);
      setTitle("");
      refetchExisting({ requestPolicy: "network-only" });
    } catch (e) {
      setError(STR.errGeneric);
    } finally {
      setBusy(false);
    }
  }, [ready, staged, classLevel, subject, kind, seqNum, title, upload, refetchExisting]);

  return (
    <Screen>
      <UploadDropZone onFiles={onDropFiles} disabled={busy || ingesting}>
        <H2>{STR.tnUploadTitle}</H2>
        <Muted style={{ marginBottom: space(3) }}>{STR.tnSubtitle}</Muted>

        {error ? <Notice message={error} tone="danger" /> : null}
        {done ? <Notice message={done} tone="ok" /> : null}

        <Card>
          <Button
            title={STR.tnPickFile}
            variant="secondary"
            onPress={pick}
            disabled={busy || ingesting}
          />
          {ingesting ? <Loader label={STR.loading} /> : null}
          {staged ? (
            <View style={{ marginTop: space(2), flexDirection: "row", alignItems: "center", gap: space(2) }}>
              <Badge text={staged.format} tone={staged.format === "MD" ? "ok" : "info"} />
              <Body style={{ flex: 1 }}>{staged.filename}</Body>
            </View>
          ) : null}
        </Card>

        <Divider />

        <Select
          label={STR.tnPickClass}
          value={classLevel}
          options={ROSTER_CLASS_LEVELS.map((l) => ({
            label: classLevelLabel(l),
            value: String(l),
          }))}
          onChange={setClassLevel}
        />
        <Select
          label={STR.tnPickSubject}
          value={subject}
          options={ROUTINE_SUBJECTS.map((s) => ({ label: routineSubjectLabel(s), value: s }))}
          onChange={setSubject}
        />
        <Select
          label={STR.tnKind}
          value={kind}
          options={TEACHING_NOTE_KINDS.map((k) => ({ label: teachingNoteKindLabel(k), value: k }))}
          onChange={setKind}
        />
        <Field label={STR.tnSeq} value={seq} onChangeText={setSeq} keyboardType="numeric" />
        <Field label={STR.tnDocTitle} value={title} onChangeText={setTitle} />

        {conflict ? (
          <Notice
            tone="warn"
            message={`${STR.tnVersion} v${bnNum(conflict.version)} → v${bnNum(
              conflict.version + 1,
            )} — ${conflict.title}`}
          />
        ) : null}

        <Button
          title={conflict ? STR.tnNewVersion : STR.tnUpload}
          onPress={submit}
          disabled={!ready}
        />
      </UploadDropZone>
    </Screen>
  );
}
