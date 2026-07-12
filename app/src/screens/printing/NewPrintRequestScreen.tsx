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
import {
  PRINT_PURPOSES,
  PRINT_PURPOSE_LABELS_EN,
  PRINT_COLOURS,
  PRINT_COLOUR_LABELS_EN,
  PRINT_SIDES,
  PRINT_SIDES_LABELS_EN,
  MAX_PRINT_UPLOADS,
} from "@scd/shared";
import { CREATE_PRINT_REQUEST } from "../../graphql/printing";
import type { PrintStackParamList } from "../../navigation/types";
import { Screen, H2, Body, Muted, Card, Field, Chip, ChipRow, Button, Notice } from "../../components/ui";
import { DateField } from "../../components/DateField";
import { STR } from "../../lib/labels";
import { friendlyError } from "../../lib/errors";
import { pickAndUploadPrintFile, FileUploadError } from "../../lib/files";
import { useToast } from "../../state/ToastContext";
import { useAuth } from "../../auth/AuthContext";
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

  const { user } = useAuth();
  // Autofill the title from the requesting teacher (live-testing ask) — still editable.
  const [title, setTitle] = useState(
    preset.title ?? (user?.name ? `${STR.prTitleFor} ${user.name}` : ""),
  );
  const [purpose, setPurpose] = useState<string>("CLASSWORK");
  const [colour, setColour] = useState<string | null>(null);
  const [sides, setSides] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
    setUploading(true);
    try {
      const uploaded = await pickAndUploadPrintFile();
      if (uploaded) setFiles((prev) => [...prev, { fileId: uploaded.fileId, originalName: uploaded.originalName }]);
    } catch (e) {
      setError(e instanceof FileUploadError ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  /** Drop an attached file before submitting (it stays uploaded but is not bound). */
  function removeFile(fileId: string): void {
    setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  }

  async function onSubmit(): Promise<void> {
    setError(null);
    const n = Number(copies);
    if (!title.trim()) return setError(STR.prDocTitle);
    if (!colour) return setError(STR.prNeedColour);
    if (!sides) return setError(STR.prNeedSides);
    if (!Number.isInteger(n) || n < 1) return setError(STR.prCopies);
    if (!neededByKey) return setError(STR.prNeedNeededBy);
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
      colour,
      sides,
      copies: n,
      neededByKey,
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
                  <View
                    key={f.fileId}
                    style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}
                  >
                    <Muted style={{ flex: 1 }}>📄 {f.originalName}</Muted>
                    <Button
                      title={STR.prRemove}
                      variant="danger"
                      onPress={() => removeFile(f.fileId)}
                      disabled={busy || uploading}
                    />
                  </View>
                ))}
                <Button
                  title={uploading ? STR.prUploading : STR.prPickFile}
                  variant="secondary"
                  onPress={onPickFile}
                  loading={uploading}
                  disabled={busy || uploading || files.length >= MAX_PRINT_UPLOADS}
                />
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

      {/* Colour + sides are MANDATORY (live-testing requirement) — the Office cannot start
          a job without them, so nothing is pre-selected: the teacher must choose. */}
      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prColour} *</Body>
        <ChipRow>
          {PRINT_COLOURS.map((c) => (
            <Chip key={c} label={PRINT_COLOUR_LABELS_EN[c]} selected={colour === c} onPress={() => setColour(c)} />
          ))}
        </ChipRow>
      </Card>

      <Card>
        <Body style={{ fontWeight: "700", marginBottom: space(2) }}>{STR.prSides} *</Body>
        <ChipRow>
          {PRINT_SIDES.map((sd) => (
            <Chip key={sd} label={PRINT_SIDES_LABELS_EN[sd]} selected={sides === sd} onPress={() => setSides(sd)} />
          ))}
        </ChipRow>
      </Card>

      <Field label={`${STR.prCopies} *`} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
      <DateField label={`${STR.prNeededBy} *`} value={neededByKey} onChange={setNeededByKey} />
      <Field label={STR.prNotes} value={notes} onChangeText={setNotes} multiline />

      <Button title={STR.prSend} onPress={onSubmit} loading={busy} />
      <View style={{ height: space(4) }} />
    </Screen>
  );
}
