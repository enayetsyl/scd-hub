/**
 * AcademicPauseService (D-#1655) — Office/Principal-managed date windows that switch
 * off assignment generation / chasing, homework-required chasing and class-note
 * chasing. ONE mechanism read by every scheduler family, pending card and overdue
 * count; nothing outside a window changes.
 *
 * Days are Asia/Dhaka "YYYY-MM-DD" keys compared as strings (inclusive both ends), so a
 * window never depends on the server's clock zone. Callers holding an INSTANT convert it
 * with `dhakaDayKey`; callers holding a school-local date (midnight Date) use `dateKeyOf`.
 */
import { AcademicPause, PAUSE_KINDS, type IAcademicPause, type PauseKind } from "../models/AcademicPause";
import { dhakaDayKey } from "../../../lib/dhakaDay";
import { dateKeyOf, isValidDateKey } from "../../attendance/dates";

export { PAUSE_KINDS };
export type { PauseKind };

export type PausePredicate = (kind: PauseKind, dateKey: string) => boolean;

type Lean = Pick<IAcademicPause, "fromKey" | "toKey" | "pauses">;

const covers = (w: Lean, kind: PauseKind, key: string): boolean =>
  w.fromKey <= key && key <= w.toKey && w.pauses.includes(kind);

/** A sync predicate over [fromKey, toKey] — ONE query, for loops over many days. */
export async function loadPausePredicate(fromKey: string, toKey: string): Promise<PausePredicate> {
  const windows = (await AcademicPause.find({
    active: true,
    fromKey: { $lte: toKey },
    toKey: { $gte: fromKey },
  })
    .select("fromKey toKey pauses")
    .lean()) as unknown as Lean[];
  return (kind, key) => windows.some((w) => covers(w, kind, key));
}

/** Is `kind` paused on this school-local day key? */
export async function isPausedOn(kind: PauseKind, dateKey: string): Promise<boolean> {
  const hit = await AcademicPause.exists({
    active: true,
    pauses: kind,
    fromKey: { $lte: dateKey },
    toKey: { $gte: dateKey },
  });
  return hit !== null;
}

/** Is `kind` paused on the Dhaka day of this instant? */
export const isPausedNow = (kind: PauseKind, now: Date = new Date()): Promise<boolean> =>
  isPausedOn(kind, dhakaDayKey(now));

/** Is `kind` paused on this school-local date (a Date at local midnight)? */
export const isPausedOnDate = (kind: PauseKind, date: Date): Promise<boolean> =>
  isPausedOn(kind, dateKeyOf(date));

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export interface PauseInput {
  fromKey: string;
  toKey: string;
  label: string;
  pauses: string[];
}

function clean(input: PauseInput): PauseInput & { pauses: PauseKind[] } {
  const fromKey = input.fromKey.trim();
  const toKey = (input.toKey || input.fromKey).trim();
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey)) throw new Error("Dates must be YYYY-MM-DD");
  if (fromKey > toKey) throw new Error("fromKey must be on or before toKey");
  const label = input.label.trim();
  if (!label) throw new Error("A label is required");
  const pauses = [...new Set(input.pauses)];
  if (pauses.length === 0) throw new Error("Choose at least one thing to pause");
  for (const p of pauses) {
    if (!(PAUSE_KINDS as readonly string[]).includes(p)) throw new Error(`Unknown pause kind: ${p}`);
  }
  return { fromKey, toKey, label, pauses: pauses as PauseKind[] };
}

export async function listPauses(): Promise<IAcademicPause[]> {
  return (await AcademicPause.find({ active: true }).sort({ fromKey: 1 }).lean()) as unknown as IAcademicPause[];
}

export async function createPause(input: PauseInput, actorId?: string): Promise<IAcademicPause> {
  return AcademicPause.create({ ...clean(input), ...(actorId ? { createdBy: actorId } : {}) });
}

export async function updatePause(id: string, input: PauseInput): Promise<IAcademicPause> {
  const row = await AcademicPause.findOneAndUpdate({ _id: id, active: true }, clean(input), { new: true }).lean();
  if (!row) throw new Error("Pause window not found");
  return row as unknown as IAcademicPause;
}

/** Deleting really deletes — a window is configuration, not a record of anything done. */
export async function deletePause(id: string): Promise<boolean> {
  const res = await AcademicPause.deleteOne({ _id: id });
  return res.deletedCount === 1;
}

/** Windows overlapping a day range, for the "what is paused" banner on a screen. */
export async function pausesInRange(fromKey: string, toKey: string): Promise<IAcademicPause[]> {
  return (await AcademicPause.find({ active: true, fromKey: { $lte: toKey }, toKey: { $gte: fromKey } })
    .sort({ fromKey: 1 })
    .lean()) as unknown as IAcademicPause[];
}
