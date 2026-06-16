/**
 * FileDropZone — native fallback. Drag-and-drop is a web-only browser affordance,
 * so on iOS/Android this is a transparent passthrough that just renders its
 * children (the file-picker button). The real drop target lives in
 * FileDropZone.web.tsx; Metro picks the platform file automatically.
 */
import React from "react";
import type { ImportFileT } from "../graphql/operations";

export interface FileDropZoneProps {
  /** Called with the dropped files (web only); unused on native. */
  onFiles: (files: ImportFileT[]) => void;
  children: React.ReactNode;
}

export function FileDropZone({ children }: FileDropZoneProps): React.ReactElement {
  return <>{children}</>;
}
