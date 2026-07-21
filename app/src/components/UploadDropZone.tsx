/**
 * UploadDropZone — native fallback. Drag-and-drop is a web-only browser
 * affordance, so on iOS/Android this renders the children untouched (the
 * pick-button flow stays the only path). The real zone lives in
 * UploadDropZone.web.tsx; Metro picks the platform file automatically.
 */
import React from "react";

export interface UploadDropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function UploadDropZone({ children }: UploadDropZoneProps): React.ReactElement {
  return <>{children}</>;
}
