/**
 * FileDropZone (web) — a drag-and-drop target for content import. Wraps its
 * children (the file-picker button + hint) in a dashed drop area; files dropped
 * onto it are read as text and handed to `onFiles` in the same {filename, content}
 * shape DocumentPicker produces, so the screen's merge/de-dupe logic is shared
 * between drop and pick. Web-only (uses the DOM DragEvent / File APIs).
 */
import React, { useCallback, useState } from "react";
import type { ImportFileT } from "../graphql/operations";
import { useColors } from "../theme";
import { radius, space } from "../theme/tokens";

export interface FileDropZoneProps {
  onFiles: (files: ImportFileT[]) => void;
  children: React.ReactNode;
}

export function FileDropZone({ onFiles, children }: FileDropZoneProps): React.ReactElement {
  const c = useColors();
  const [over, setOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setOver(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      if (dropped.length === 0) return;
      void Promise.all(
        dropped.map(async (file) => ({ filename: file.name, content: await file.text() })),
      ).then((read) => {
        if (read.length > 0) onFiles(read);
      });
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragEnter={(e) => e.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${over ? c.primary : c.border}`,
        borderRadius: radius.md,
        padding: space(2),
        backgroundColor: over ? c.primaryContainer : "transparent",
        transition: "border-color .15s, background-color .15s",
      }}
    >
      {children}
    </div>
  );
}
