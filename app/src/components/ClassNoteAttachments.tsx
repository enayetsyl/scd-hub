/**
 * ClassNoteAttachments — a controlled picker for class-note attachments (≤5, ≤10 MB,
 * jpeg/png/pdf). Each pick uploads immediately (POST /files/classnote) and returns a
 * fileId; the parent passes the collected list to publishClassNote / updateClassNote.
 * Reused by the teacher submit flow (MyClassNotes / DailyNote) and the admin edit form.
 */
import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Body, Muted, Button } from "./ui";
import {
  pickAndUploadClassNoteAttachment,
  openStoredFile,
  CLASSNOTE_MAX_FILES,
  FileUploadError,
} from "../lib/files";
import { useToast } from "../state/ToastContext";
import { STR } from "../lib/labels";
import { space } from "../theme/tokens";

export interface AttachmentRef {
  fileId: string;
  name: string;
}

export function ClassNoteAttachments({
  value,
  onChange,
}: {
  value: AttachmentRef[];
  onChange: (v: AttachmentRef[]) => void;
}): React.ReactElement {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function add(): Promise<void> {
    if (value.length >= CLASSNOTE_MAX_FILES) {
      toast.show(STR.cnMaxFiles, "danger");
      return;
    }
    setBusy(true);
    try {
      const f = await pickAndUploadClassNoteAttachment();
      if (f) onChange([...value, { fileId: f.fileId, name: f.originalName }]);
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.errGeneric, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(1) }}>
      <Muted>
        {STR.cnAttachments} ({value.length}/{CLASSNOTE_MAX_FILES})
      </Muted>
      {value.map((a, i) => (
        <View key={a.fileId} style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
          <Pressable style={{ flex: 1 }} onPress={() => void openStoredFile(a.fileId).catch(() => toast.show(STR.errGeneric, "danger"))}>
            <Body>📎 {a.name}</Body>
          </Pressable>
          <Button title={STR.remove} variant="ghost" onPress={() => onChange(value.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button
        title={busy ? STR.saving : STR.cnAttachFile}
        variant="secondary"
        onPress={() => void add()}
        loading={busy}
        disabled={busy || value.length >= CLASSNOTE_MAX_FILES}
      />
    </View>
  );
}
