import { useCallback, useState } from "react";

/**
 * Busy-tracked file open (BUG-014). `openStoredFile` / `openPdf` stream the bytes
 * through the server before the browser tab opens, which can take several seconds —
 * without feedback the button feels dead and an impatient double-tap opens duplicate
 * tabs. This tracks WHICH id is opening (so that button can show a spinner) and guards
 * re-entry while a fetch is in flight. The caller passes the actual open work, keeping
 * its own error handling (toast / inline notice).
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
  const runOpen = useCallback(
    async (id: string, fn: () => void | Promise<void>) => {
      if (openingId) return; // double-tap guard while a fetch is in flight
      setOpeningId(id);
      try {
        await fn();
      } finally {
        setOpeningId(null);
      }
    },
    [openingId],
  );
  return { openingId, runOpen };
}
