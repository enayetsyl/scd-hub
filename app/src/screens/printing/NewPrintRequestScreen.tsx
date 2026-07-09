/**
 * NewPrintRequestScreen (PQ-3, D-#281) — a teacher sends a document to the Office.
 *
 * Four sources, exactly one per request (the server enforces the XOR):
 *   UPLOAD           — pick up to 5 jpeg/png/pdf files (POST /files/print)
 *   LINK             — a Google Form / Doc URL
 *   SET              — an assembled question set, passed in via route params from
 *                      Set detail's "Send to print"
 *   CONTENT_ARTIFACT — a chapter/session plan, passed in from the plan viewer
 *
 * No PDF snapshot is taken: an assembled set is locked, so its id is enough.
 */
import React, { useState } from "react";
import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMutation } from "urql";
import { PRINT_PURPOSES, PRINT_PURPOSE_LABELS_EN, MAX_PRINT_UPLOADS } from "@scd/shared";
import { CREATE_PRINT_REQUEST } from "../../graphql/printing";
import type { PrintStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Field, Chip, ChipRow, Button, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickAndUploadPrintFile, FileUploadError } from "../../lib/files";
import { useToast } from "../../state/ToastContext";
import { space } from "../../theme/tokens";

type Props = NativeStackScreenProps<PrintStackParamList, "NewPrintRequest">;

interface Attached {
  fileId: string;
  originalName: string;
}

export default function NewPrintRequestScreen({ route, navigation }: Props): React.ReactElement {
  const preset = route.params ?? {};
  const toast = useToast();

  // A set / plan arrives pre-selected from its own screen; otherwise the teacher picks.
  const presetSource = preset.setId ? "SET" : preset.contentArtifactId ? "CONTENT_ARTIFACT" : null;

  const [title, setTitle] = useState(preset.title ?? "");
  const [purpose, setPurpose] = useState<string>("CLASSWORK");
  const [sourceType, setSourceType] = useState<string>(presetSource ?? "UPLOAD");
  const [files, setFiles] = useState<Attached[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [copies, setCopies] = useState("1");
  const [neededByKey, setNeededByKey] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, create] = useMutation(CREATE_PRINT_REQUEST);

  async function onPickFile(): Promise<void> {
    if (files.length >= MAX_PRINT_UPLOADS) {
      setError(`${MAX_PRINT_UPLOADS} ${STR.prMaxFiles}`);
      return;
    }
    setError(null);
    try {
      const uploaded = await pickAndUploadPrintFile();
      if (uploaded) setFiles((prev) => [...prev, { fileId: uploaded.fileId, originalName: uploaded.originalName }]);
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : String(e));
    }
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    const n = Number(copies);
    if (!title.trim()) return setError(STR.prDocTitle);
    if (!Number.isInteger(n) || n < 1) return setError(STR.prCopies);
    if (sourceType === "UPLOAD" && files.length === 0) return setError(STR.prPickFile);
    if (sourceType === "LINK" && !linkUrl.trim()) return setError(STR.prLinkUrl);

    setBusy(true);
    const res = await create({
      title: title.trim(),
      purpose,
      sourceType,
      setId: sourceType === "SET" ? preset.setId ?? null : null,
      contentArtifactId: sourceType === "CONTENT_ARTIFACT" ? preset.contentArtifactId ?? null : null,
      fileIds: sourceType === "UPLOAD" ? files.map((f) => f.fileId) : null,
      linkUrl: sourceType === "LINK" ? linkUrl.trim() : null,
      copies: n,
      neededByKey: neededByKey || null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (res.error || !res.data?.createPrintRequest) {
      setError(friendlyError(res.error));
      return;
    }
    toast.show(STR.prCreated, "ok");
    navigation.goBack();
  }

  /** A pre-selected set/plan is fixed — don't let the teacher switch it away. */
  const sourceLocked = presetSource !== null;

  return (
    <Screen scroll>
      <H2>{STR.prNew}</H2>
      {error ? <Notice message={error} tone="danger" /> : null}

      <Field label={STR.prDocTitle} value={title} onChangeText={setTitle} />

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prPurpose}</Body>
        <ChipRow>
          {PRINT_PURPOSES.map((p) => (
            <Chip key={p} label={PRINT_PURPOSE_LABELS_EN[p]} selected={purpose === p} onPress={() => setPurpose(p)} />
          ))}
        </ChipRow>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prSource}</Body>
        {sourceLocked ? (
          <Muted>{presetSource === "SET" ? STR.prSourceSet : STR.prSourcePlan}</Muted>
        ) : (
          <>
            <ChipRow>
              <Chip label={STR.prSourceUpload} selected={sourceType === "UPLOAD"} onPress={() => setSourceType("UPLOAD")} />
              <Chip label={STR.prSourceLink} selected={sourceType === "LINK"} onPress={() => setSourceType("LINK")} />
            </ChipRow>

            {sourceType === "UPLOAD" ? (
              <View style={{ marginTop: space(2), gap: space(1) }}>
                {files.map((f) => (
                  <Muted key={f.fileId}>📄 {f.originalName}</Muted>
                ))}
                <Button title={STR.prPickFile} variant="secondary" onPress={onPickFile} disabled={busy} />
              </View>
            ) : (
              <View style={{ marginTop: space(2) }}>
                <Field
                  label={STR.prLinkUrl}
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://forms.gle/…"
                />
              </View>
            )}
          </>
        )}
      </Card>

      <Field label={STR.prCopies} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
      <DateField label={STR.prNeededBy} value={neededByKey} onChange={setNeededByKey} />
      <Field label={STR.prNotes} value={notes} onChangeText={setNotes} multiline />

      <Button title={STR.prSend} onPress={onSubmit} loading={busy} />
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
