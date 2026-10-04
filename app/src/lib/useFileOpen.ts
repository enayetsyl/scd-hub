import { useCallback, useState } from "react";
import { useToast } from "../state/ToastContext";
import { FileUploadError } from "./files";
import { STR } from "./labels";

/**
 * Busy-tracked file open (BUG-014). `openStoredFile` / `openPdf` stream the bytes
 * through the server before the browser tab opens, which can take several seconds —
 * without feedback the button feels dead and an impatient double-tap opens duplicate
 * tabs. This tracks WHICH id is opening (so that button can show a spinner) and guards
 * re-entry while a fetch is in flight. The caller passes the actual open work, keeping
 * its own error handling (toast / inline notice).
 *
 * Anything the caller does NOT catch is toasted here (owner report 2026-10-04): the
 * class-test question screens passed `openStoredFile` straight in, so a refusal, a
 * Drive outage or a timeout ended with the spinner stopping and nothing else — the
 * teacher could only tap again.
 *
 * Usage:
 *   const { openingId, runOpen } = useFileOpen();
 *   <Button loading={openingId === id} disabled={!!openingId}
 *           onPress={() => runOpen(id, () => onOpenFile(fileId))} />
 */
export function useFileOpen(): {
  openingId: string | null;
  runOpen: (id: string, fn: () => void | Promise<void>) => Promise<void>;
} {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const toast = useToast();
  const runOpen = useCallback(
    async (id: string, fn: () => void | Promise<void>) => {
      if (openingId) return; // double-tap guard while a fetch is in flight
      setOpeningId(id);
      try {
        await fn();
      } catch (e) {
        toast.show(e instanceof FileUploadError ? e.message : STR.fileOpenFailed, "danger");
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, toast],
  );
  return { openingId, runOpen };
}
