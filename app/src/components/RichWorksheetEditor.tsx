/**
 * RichWorksheetEditor (native stub) — the WYSIWYG worksheet editor (D-#349) is a
 * web-only DOM component (contentEditable + browser print). On native the doc
 * screen never mounts it (it gates on PDF_SUPPORTED); this stub keeps the import
 * resolvable and shows the web-only note if it ever renders.
 */
import React from "react";
import { Muted } from "./ui";
import { STR } from "../lib/labels";

export interface RichWorksheetEditorProps {
  sourceMd: string;
  title: string;
  onDone: () => void;
  onSendToQueue?: () => void;
  onSendToClassTest?: () => void;
}

export function RichWorksheetEditor(_props: RichWorksheetEditorProps): React.ReactElement {
  return <Muted>{STR.pdfWebOnly}</Muted>;
}
