/**
 * UploadDropZone (web) — a drag-and-drop target for BINARY uploads (the
 * FileDropZone sibling is text-only and belongs to content import). Wraps the
 * screen's existing pick-button UI in a dashed drop area and hands dropped
 * browser File objects to `onFiles`; the screen uploads them through the
 * upload*WebFile(s) helpers in lib/files.ts, so the post-upload logic is
 * shared between drop and pick. Web-only (DOM DragEvent / File APIs); the
 * native sibling renders children untouched.
 */
import React, { useState } from "react";
import { STR } from "../lib/labels";
import { useColors } from "../theme";
import { radius, space } from "../theme/tokens";

export interface UploadDropZoneProps {
  /** Dropped files, in drop order. Screens with a single-file flow take [0]. */
  onFiles: (files: File[]) => void;
  /** Ignore drops (e.g. while an upload is already running). */
  disabled?: boolean;
  children: React.ReactNode;
}

export function UploadDropZone({ onFiles, disabled, children }: UploadDropZoneProps): React.ReactElement {
  const c = useColors();
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !over) setOver(true);
      }}
      onDragEnter={(e) => e.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const dropped = Array.from(e.dataTransfer?.files ?? []);
        if (dropped.length > 0) onFiles(dropped);
      }}
      style={{
        border: `2px dashed ${over ? c.primary : c.border}`,
        borderRadius: radius.md,
        padding: space(2),
        backgroundColor: over ? c.primaryContainer : "transparent",
        transition: "border-color .15s, background-color .15s",
      }}
    >
      {children}
      <div style={{ color: c.textSecondary, fontSize: 12, textAlign: "center", marginTop: space(1) }}>
        {STR.uploadDropHint}
      </div>
    </div>
  );
}
