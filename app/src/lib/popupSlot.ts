/**
 * One pop-up on screen at a time (D-#871).
 *
 * The meeting RSVP pop-up (D-#841) and the meeting-comment reminder (D-#851) open on their
 * own schedules. A pop-up notice (D-#852) opened ~400 ms after login and, as the later
 * Modal, landed ON TOP of them — hiding the reminder's "নির্দেশিকা দেখুন" behind the
 * notice's sheet (prod, 2026-10-27). The system pop-ups announce themselves here while they
 * are on screen, and the notice host waits until none is.
 */
import { useEffect, useState } from "react";

const active = new Set<string>();
const listeners = new Set<() => void>();

/** A system pop-up says it is (or is no longer) on screen. */
export function setSystemPopup(id: string, on: boolean): void {
  const had = active.has(id);
  if (on) active.add(id);
  else active.delete(id);
  if (had !== on) listeners.forEach((fn) => fn());
}

/** True while any system pop-up is on screen. */
export function useSystemPopupActive(): boolean {
  const [busy, setBusy] = useState(active.size > 0);
  useEffect(() => {
    const fn = () => setBusy(active.size > 0);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return busy;
}

/** A system pop-up component calls this with its own "am I on screen" answer. */
export function useAnnounceSystemPopup(id: string, showing: boolean): void {
  useEffect(() => {
    setSystemPopup(id, showing);
    return () => setSystemPopup(id, false);
  }, [id, showing]);
}
