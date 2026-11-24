/** AL-14 - offset arithmetic for `server/scripts/dev-clock.ts` (pure; Asia/Dhaka is a fixed +06:00, no DST). */
const DAY_MS = 86_400_000;
const DHAKA_MS = 6 * 3_600_000;

/** Offset (ms) so that NOW reads as `dayKey` at `time` (HH:MM), or at the current real Dhaka time-of-day. */
export function offsetForSet(dayKey: string, realNow: Date, time?: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error("day must be YYYY-MM-DD");
  if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("--time must be HH:MM (00:00-23:59)");
  let hhmmss: string;
  if (time) hhmmss = `${time}:00`;
  else {
    const d = new Date(realNow.getTime() + DHAKA_MS); // read the Dhaka wall clock through UTC fields
    const p = (n: number) => String(n).padStart(2, "0");
    hhmmss = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
  const target = new Date(`${dayKey}T${hhmmss}+06:00`);
  if (Number.isNaN(target.getTime()) || new Date(target.getTime() + DHAKA_MS).toISOString().slice(0, 10) !== dayKey) {
    throw new Error("not a real calendar day");
  }
  return target.getTime() - realNow.getTime();
}

/** New offset after moving forward (or back, negative) by whole days. */
export function offsetAdvanced(currentOffsetMs: number, days: number): number {
  if (!Number.isInteger(days)) throw new Error("days must be a whole number");
  return currentOffsetMs + days * DAY_MS;
}

/** No backward moves (a forward move is a one-way door for dev data): refuse a negative advance and a `set` to a day
 *  before the current shifted Dhaka day. `shiftedTodayKey` is the Dhaka day key of now + the current offset. */
export function assertForwardOnly(cmd: "set" | "advance", shiftedTodayKey: string, arg: string): void {
  if (cmd === "advance" && Number(arg) < 0) throw new Error("refused: the dev clock never moves backwards (refresh the dev copy to undo)");
  if (cmd === "set" && arg < shiftedTodayKey) {
    throw new Error(`refused: ${arg} is before the current dev day ${shiftedTodayKey}; the dev clock never moves backwards (refresh the dev copy to undo)`);
  }
}
