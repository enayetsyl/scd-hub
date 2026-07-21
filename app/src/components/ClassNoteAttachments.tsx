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
  uploadClassNoteWebFile,
  openStoredFile,
  CLASSNOTE_MAX_FILES,
  FileUploadError,
} from "../lib/files";
import { UploadDropZone } from "./UploadDropZone";
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

  // One post-upload path for both entry points (pick button + web drop zone):
  // same cap check, same busy state, same FileUploadError toast. `upload` gets
  // the remaining capacity and returns the refs that made it.
  async function runAdd(upload: (remaining: number) => Promise<AttachmentRef[]>): Promise<void> {
    const remaining = CLASSNOTE_MAX_FILES - value.length;
    if (remaining <= 0) {
      toast.show(STR.cnMaxFiles, "danger");
      return;
    }
    setBusy(true);
    try {
      const added = await upload(remaining);
      if (added.length > 0) onChange([...value, ...added]);
    } catch (e) {
      toast.show(e instanceof FileUploadError ? e.message : STR.errGeneric, "danger");
    } finally {
      setBusy(false);
    }
  }

  const add = (): Promise<void> =>
    runAdd(async () => {
      const f = await pickAndUploadClassNoteAttachment();
      return f ? [{ fileId: f.fileId, name: f.originalName }] : [];
    });

  // Multi-file drop: honour the same remaining-capacity cap the button enforces
  // (extras beyond it are ignored); a mid-batch failure keeps the files that
  // already uploaded and surfaces the error once.
  const onDrop = (files: File[]): Promise<void> =>
    runAdd(async (remaining) => {
      const added: AttachmentRef[] = [];
      for (const file of files.slice(0, remaining)) {
        try {
          const f = await uploadClassNoteWebFile(file);
          added.push({ fileId: f.fileId, name: f.originalName });
        } catch (e) {
          if (added.length === 0) throw e; // nothing kept — runAdd's catch reports it
          toast.show(e instanceof FileUploadError ? e.message : STR.errGeneric, "danger");
          break;
        }
      }
      return added;
    });

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
      <UploadDropZone
        onFiles={(files) => void onDrop(files)}
        disabled={busy || value.length >= CLASSNOTE_MAX_FILES}
      >
        <Button
          title={busy ? STR.saving : STR.cnAttachFile}
          variant="secondary"
          onPress={() => void add()}
          loading={busy}
          disabled={busy || value.length >= CLASSNOTE_MAX_FILES}
        />
      </UploadDropZone>
    </View>
  );
}
