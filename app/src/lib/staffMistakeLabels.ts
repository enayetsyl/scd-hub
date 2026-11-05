/**
 * Staff mistake record labels (D-#936–#943): the place a mistake was caught, the warning
 * step, and Dhaka date-times. One place so every screen names them the same way.
 */
import { STR, bnNum, fullDateLabel } from "./labels";

const str = (key: string): string | undefined => (STR as unknown as Record<string, string | undefined>)[key];

export function staffMistakeKindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  return str(`smrKindLabel_${kind}`) ?? kind;
}

export function staffWarningStepLabel(step: string | null | undefined): string {
  if (!step) return "";
  return str(`smwStep_${step}`) ?? step;
}

/** HH:mm in Asia/Dhaka (Bangla digits via bnNum). */
export function dhakaClock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 6 * 3600 * 1000);
  return bnNum(`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`);
}

/** "সোমবার, ৯ নভেম্বর ২০২৬ · ১৭:০০". */
export function dhakaWhen(iso: string): string {
  const key = new Date(new Date(iso).getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10);
  return `${fullDateLabel(key)} · ${dhakaClock(iso)}`;
}

/** "2026-11-10 12:30" (Dhaka) → ISO; null when it does not parse. */
export function parseDhakaDateTime(text: string): string | null {
  const m = /^\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]!.padStart(2, "0")}:${m[3]}:00+06:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
