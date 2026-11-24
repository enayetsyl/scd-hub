/**
 * AL-14 - the dev-site clock (owner ruling 23 Nov 2026, overrides R36 for the dev site only).
 *
 * The dev site runs as if "today" were a 2027 school day the lead sets, moving forward with real time:
 * `installDevClock()` patches the process-wide `Date` with an offset clock (see devClockOffset.ts).
 *
 * It can NEVER be active on prod:
 *   1. `DEV_CLOCK_ALLOWED=1` must be in the environment (set on the dev VM only); absent -> nothing is read or patched;
 *   2. the connected database name must end in `_dev`; otherwise refused, nothing patched.
 *
 * The offset lives in one doc of the dev collection `devclocks` `{ _id: "clock", offsetMs, setAt, setBy, note }`,
 * re-read every 60 s on the REAL clock so a lead change applies without a restart. Offset 0 / no doc = no shift.
 */
import { makeOffsetDate } from "./devClockOffset";
import { currentDbName } from "./outgoing";
import { dhakaDayKey } from "./dhakaDay";

export const DEV_CLOCK_COLLECTION = "devclocks";
export const DEV_CLOCK_REFRESH_MS = 60_000;

export interface DevClockState {
  active: boolean;
  todayKey: string | null;
  offsetMs: number | null;
}

let realDate: DateConstructor | null = null;
let offsetMs = 0;
let installed = false;
let timer: NodeJS.Timeout | null = null;

/** Read the offset from the DB (production wiring; tests inject `readOffset`). */
async function readOffsetFromDb(): Promise<number> {
  const { mongoose } = await import("../db");
  const db = mongoose.connection.db;
  if (!db) return 0;
  const doc = (await db.collection(DEV_CLOCK_COLLECTION).findOne({ _id: "clock" as never })) as { offsetMs?: unknown } | null;
  const v = doc?.offsetMs;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface InstallOptions {
  env?: NodeJS.ProcessEnv;
  /** Override the connected DB name (tests). Default: `currentDbName()`. */
  dbName?: string | null;
  /** Override the DB read (tests). */
  readOffset?: () => Promise<number>;
  /** Where to patch (tests). Default: globalThis. */
  target?: { Date: DateConstructor };
  log?: (line: string) => void;
}

export type InstallResult = { installed: false; reason: "env_missing" | "not_dev_db" | "already_installed" } | { installed: true };

function logLine(log: (l: string) => void, off: number): void {
  const days = Math.round((off / 86_400_000) * 100) / 100;
  log(`[dev-clock] ON today=${dhakaDayKey(new Date())} offsetDays=${days}`);
}

/** Install the offset clock if (and only if) both safety checks pass. Never throws on a refusal. */
export async function installDevClock(opts: InstallOptions = {}): Promise<InstallResult> {
  const env = opts.env ?? process.env;
  if (env.DEV_CLOCK_ALLOWED !== "1") return { installed: false, reason: "env_missing" }; // no DB read at all
  const log = opts.log ?? ((l: string) => console.log(l));
  const name = opts.dbName !== undefined ? opts.dbName : currentDbName();
  if (!name || !name.endsWith("_dev")) {
    console.warn("[dev-clock] refused: the connected database name does not end in `_dev` - the clock stays real");
    return { installed: false, reason: "not_dev_db" };
  }
  if (installed) return { installed: false, reason: "already_installed" };
  const read = opts.readOffset ?? readOffsetFromDb;
  const target = opts.target ?? (globalThis as unknown as { Date: DateConstructor });
  offsetMs = await read().catch(() => 0);
  const real = target.Date;
  realDate = real;
  target.Date = makeOffsetDate(real, () => offsetMs);
  installed = true;
  logLine(log, offsetMs);
  timer = setInterval(() => {
    void read()
      .then((next) => {
        if (next !== offsetMs) {
          offsetMs = next;
          logLine(log, offsetMs);
        }
      })
      .catch(() => undefined); // keep the last offset on a read error
  }, DEV_CLOCK_REFRESH_MS);
  timer.unref?.();
  return { installed: true };
}

/** Test helper: remove the patch and stop the refresh timer. */
export function uninstallDevClock(target: { Date: DateConstructor } = globalThis as unknown as { Date: DateConstructor }): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (installed && realDate) target.Date = realDate;
  realDate = null;
  installed = false;
  offsetMs = 0;
}

/** What the app / readyz may learn: active only when installed with a non-zero offset. */
export function devClockState(): DevClockState {
  if (!installed || offsetMs === 0) return { active: false, todayKey: null, offsetMs: null };
  return { active: true, todayKey: dhakaDayKey(new Date()), offsetMs };
}
