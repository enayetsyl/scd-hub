/**
 * useFormDraft — keep a long form's typed content across a reload, a crash or a
 * dropped connection (owner ask 2026-08-03: an observer's typed observation must
 * survive a network hiccup or a browser refresh).
 *
 * The draft is LOCAL ONLY. It is not a save to the server and never becomes one:
 * the form still has to be submitted. That is deliberate — a half-filled review is
 * not a record, and writing partial reviews server-side would put unsubmitted
 * judgements in front of other people.
 *
 * Mechanics:
 *   - every change to `snapshot` is written, debounced, through `lib/storage`
 *     (localStorage on web, SecureStore on native);
 *   - on mount an existing draft is handed back ONCE via `onRestore`, so the caller
 *     decides how to apply it to its own state;
 *   - `clear()` drops it — call this after a successful submit, or the next visit
 *     restores a draft of something already sent.
 *
 * Every storage call is best-effort and swallowed: a full quota on web, or
 * SecureStore's 2048-byte value limit on Android, must never break the form the
 * user is typing into. Losing a draft is a nuisance; losing the form is the bug we
 * are fixing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getItem, setItem, removeItem } from "./storage";

/** Debounce before writing. Long enough not to hit storage on every keystroke,
 *  short enough that a reload seconds after typing still finds the text. */
const WRITE_DELAY_MS = 700;

const PREFIX = "draft:v1:";

interface StoredDraft<T> {
  savedAt: number;
  data: T;
}

export interface FormDraft {
  /** When the draft was last written (ms epoch), or null if nothing is stored. */
  savedAt: number | null;
  /** True once a stored draft has been handed to `onRestore` this mount. */
  restored: boolean;
  /** Forget the draft — call after a successful submit, or to discard explicitly. */
  clear: () => void;
}

/**
 * @param key       stable per form INSTANCE and per user, e.g.
 *                  `obs-review:${observationId}:${userId}` — including the user id
 *                  keeps one person's draft off another's screen on a shared device.
 *                  Pass null to disable (e.g. before the id is known).
 * @param snapshot  the form's current values; must be JSON-serialisable.
 * @param onRestore called at most once per mount, with a previously stored snapshot.
 */
export function useFormDraft<T>(
  key: string | null,
  snapshot: T,
  onRestore: (draft: T) => void,
): FormDraft {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  /** Restore must not race the first debounced write, or an empty initial snapshot
   *  would overwrite the stored draft before it has been read back. */
  const readyToWrite = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const storageKey = key ? PREFIX + key : null;

  // ---- restore (once per key) ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    readyToWrite.current = false;
    setRestored(false);
    setSavedAt(null);
    if (!storageKey) return;

    void (async () => {
      let stored: StoredDraft<T> | null = null;
      try {
        const raw = await getItem(storageKey);
        if (raw) stored = JSON.parse(raw) as StoredDraft<T>;
      } catch {
        stored = null; // unreadable or corrupt — treat as no draft
      }
      if (cancelled) return;
      if (stored && stored.data != null) {
        onRestoreRef.current(stored.data);
        setSavedAt(typeof stored.savedAt === "number" ? stored.savedAt : null);
        setRestored(true);
      }
      // Only now may writes proceed: the caller has had its draft back.
      readyToWrite.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // ---- write (debounced) ----------------------------------------------------
  const serialised = safeStringify(snapshot);
  useEffect(() => {
    if (!storageKey || !readyToWrite.current || serialised === null) return;
    const t = setTimeout(() => {
      const at = Date.now();
      void (async () => {
        try {
          await setItem(storageKey, JSON.stringify({ savedAt: at, data: JSON.parse(serialised) }));
          setSavedAt(at);
        } catch {
          /* quota / size limit — drafting is best-effort, never fatal */
        }
      })();
    }, WRITE_DELAY_MS);
    return () => clearTimeout(t);
  }, [storageKey, serialised]);

  const clear = useCallback(() => {
    setSavedAt(null);
    setRestored(false);
    if (!storageKey) return;
    void (async () => {
      try {
        await removeItem(storageKey);
      } catch {
        /* non-fatal */
      }
    })();
  }, [storageKey]);

  return { savedAt, restored, clear };
}

/** JSON.stringify that yields null instead of throwing on a non-serialisable value. */
function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}
